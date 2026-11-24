package kernel

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"orbit/internal/plugin"
)

type externalPluginEntry struct {
	manifest plugin.Manifest
	dir      string
}

func (k *Kernel) LoadExternalPlugins() error {
	baseDir := filepath.Join(k.cfg.DataDir, "plugins")
	_ = os.MkdirAll(baseDir, 0o755)
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		return err
	}

	loaded := make(map[string]*externalPluginEntry)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirPath := filepath.Join(baseDir, entry.Name())
		manifestPath := filepath.Join(dirPath, "manifest.json")
		raw, err := os.ReadFile(manifestPath)
		if err != nil {
			continue
		}
		var m plugin.Manifest
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		m.Tier = "external"
		if err := plugin.ValidateManifest(&m); err != nil {
			continue
		}
		// Never allow an external plugin to shadow a builtin plugin ID
		k.mu.RLock()
		_, isBuiltin := k.builtins[m.ID]
		k.mu.RUnlock()
		if isBuiltin {
			continue
		}
		k.ensurePluginStateRow(m)
		loaded[m.ID] = &externalPluginEntry{manifest: m, dir: dirPath}
	}

	k.mu.Lock()
	k.externals = loaded
	k.mu.Unlock()
	return nil
}

func (k *Kernel) getExternalPlugin(id string) (*externalPluginEntry, bool) {
	k.mu.RLock()
	defer k.mu.RUnlock()
	ext, ok := k.externals[id]
	return ext, ok
}

func (k *Kernel) handleExternalAsset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ext, ok := k.getExternalPlugin(id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if !k.IsPluginEnabled(id) {
		plugin.WriteErr(w, http.StatusForbidden, "plugin disabled")
		return
	}
	rel := strings.TrimPrefix(filepath.ToSlash(filepath.Clean("/"+r.PathValue("path"))), "/")
	if rel == "" || strings.Contains(rel, "..") {
		http.NotFound(w, r)
		return
	}
	fullPath := filepath.Join(ext.dir, filepath.FromSlash(rel))
	if absBase, err1 := filepath.Abs(ext.dir); err1 == nil {
		if absTarget, err2 := filepath.Abs(fullPath); err2 != nil || !strings.HasPrefix(absTarget, absBase+string(filepath.Separator)) {
			http.NotFound(w, r)
			return
		}
	}
	st, err := os.Stat(fullPath)
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	low := strings.ToLower(rel)
	switch {
	case strings.HasSuffix(low, ".mjs") || strings.HasSuffix(low, ".js"):
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	case strings.HasSuffix(low, ".css"):
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case strings.HasSuffix(low, ".html") || strings.HasSuffix(low, ".htm"):
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	case strings.HasSuffix(low, ".json"):
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, fullPath)
}

func (k *Kernel) handleExternalKV(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ext, ok := k.getExternalPlugin(id)
	if !ok {
		plugin.WriteErr(w, http.StatusNotFound, "external plugin not found")
		return
	}
	if !k.IsPluginEnabled(id) {
		plugin.WriteErr(w, http.StatusForbidden, "plugin disabled")
		return
	}
	if !ext.manifest.HasPermission("kv") {
		plugin.WriteErr(w, http.StatusForbidden, "plugin lacks kv permission")
		return
	}
	u := k.CurrentUser(r)
	key := strings.TrimSpace(r.PathValue("key"))
	store := k.KV(id)

	switch r.Method {
	case http.MethodGet:
		if key == "" {
			items, err := store.List(r.Context(), u.ID)
			if err != nil {
				plugin.WriteErr(w, http.StatusInternalServerError, "database error")
				return
			}
			plugin.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
			return
		}
		val, found, err := store.Get(r.Context(), u.ID, key)
		if err != nil {
			plugin.WriteErr(w, http.StatusInternalServerError, "database error")
			return
		}
		if !found {
			plugin.WriteJSON(w, http.StatusOK, map[string]any{"key": key, "found": false, "value": nil})
			return
		}
		plugin.WriteJSON(w, http.StatusOK, map[string]any{"key": key, "found": true, "value": val})

	case http.MethodPut:
		if key == "" {
			plugin.WriteErr(w, http.StatusBadRequest, "key required")
			return
		}
		var req struct {
			Value json.RawMessage `json:"value"`
		}
		if err := plugin.DecodeJSON(r, &req); err != nil || len(req.Value) == 0 {
			plugin.WriteErr(w, http.StatusBadRequest, "value json required")
			return
		}
		if err := store.Set(r.Context(), u.ID, key, req.Value); err != nil {
			plugin.WriteErr(w, http.StatusBadRequest, "invalid value json")
			return
		}
		plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})

	case http.MethodDelete:
		if key == "" {
			plugin.WriteErr(w, http.StatusBadRequest, "key required")
			return
		}
		if err := store.Delete(r.Context(), u.ID, key); err != nil {
			plugin.WriteErr(w, http.StatusInternalServerError, "database error")
			return
		}
		plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func (k *Kernel) handleExternalProxy(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	route := r.PathValue("route")
	ext, ok := k.getExternalPlugin(id)
	if !ok {
		plugin.WriteErr(w, http.StatusNotFound, "external plugin not found")
		return
	}
	if !k.IsPluginEnabled(id) {
		plugin.WriteErr(w, http.StatusForbidden, "plugin disabled")
		return
	}
	var uid int64
	if u, err := k.authenticateRequest(r); err == nil && u != nil {
		uid = u.ID
	}
	k.executePluginProxy(w, r, ext.manifest, route, uid)
}

func (k *Kernel) handleInstallExternalPlugin(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	if u.Role != "admin" {
		plugin.WriteErr(w, http.StatusForbidden, "仅管理员可安装外部插件")
		return
	}

	ct := strings.ToLower(r.Header.Get("Content-Type"))
	if strings.Contains(ct, "multipart/form-data") {
		r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			plugin.WriteErr(w, http.StatusRequestEntityTooLarge, "插件包不能超过 10 MB")
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			plugin.WriteErr(w, http.StatusBadRequest, "请上传插件 .zip 压缩包")
			return
		}
		defer file.Close()
		zipBytes, err := io.ReadAll(io.LimitReader(file, 10<<20))
		if err != nil {
			plugin.WriteErr(w, http.StatusBadRequest, "读取压缩包失败")
			return
		}
		manifest, err := k.installFromZip(zipBytes)
		if err != nil {
			plugin.WriteErr(w, http.StatusBadRequest, err.Error())
			return
		}
		plugin.WriteJSON(w, http.StatusCreated, map[string]any{"manifest": manifest})
		return
	}

	var req struct {
		Manifest plugin.Manifest   `json:"manifest"`
		Files    map[string]string `json:"files"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid plugin JSON payload")
		return
	}
	req.Manifest.Tier = "external"
	if err := plugin.ValidateManifest(&req.Manifest); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, err.Error())
		return
	}
	k.mu.RLock()
	_, isBuiltin := k.builtins[req.Manifest.ID]
	k.mu.RUnlock()
	if isBuiltin {
		plugin.WriteErr(w, http.StatusConflict, "不能覆盖内置官方插件 ID")
		return
	}

	dstDir := filepath.Join(k.cfg.DataDir, "plugins", req.Manifest.ID)
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "创建插件目录失败")
		return
	}
	manifestBytes, _ := json.MarshalIndent(req.Manifest, "", "  ")
	if err := os.WriteFile(filepath.Join(dstDir, "manifest.json"), manifestBytes, 0o644); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "写入 manifest.json 失败")
		return
	}
	for relPath, content := range req.Files {
		clean := strings.TrimPrefix(filepath.ToSlash(filepath.Clean("/"+relPath)), "/")
		if clean == "" || clean == "manifest.json" || strings.Contains(clean, "..") {
			continue
		}
		target := filepath.Join(dstDir, filepath.FromSlash(clean))
		_ = os.MkdirAll(filepath.Dir(target), 0o755)
		_ = os.WriteFile(target, []byte(content), 0o644)
	}

	if err := k.LoadExternalPlugins(); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "重载插件失败")
		return
	}
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{"manifest": req.Manifest})
}

func (k *Kernel) installFromZip(data []byte) (plugin.Manifest, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return plugin.Manifest{}, err
	}

	// Find manifest.json (allow top-level folder wrapper inside zip)
	var manifestRaw []byte
	stripPrefix := ""
	for _, f := range zr.File {
		slash := filepath.ToSlash(f.Name)
		if slash == "manifest.json" || strings.HasSuffix(slash, "/manifest.json") && strings.Count(slash, "/") == 1 {
			rc, err := f.Open()
			if err != nil {
				return plugin.Manifest{}, err
			}
			manifestRaw, err = io.ReadAll(io.LimitReader(rc, 512<<10))
			_ = rc.Close()
			if err != nil {
				return plugin.Manifest{}, err
			}
			if idx := strings.Index(slash, "manifest.json"); idx > 0 {
				stripPrefix = slash[:idx]
			}
			break
		}
	}
	if len(manifestRaw) == 0 {
		return plugin.Manifest{}, os.ErrNotExist
	}

	var m plugin.Manifest
	if err := json.Unmarshal(manifestRaw, &m); err != nil {
		return plugin.Manifest{}, err
	}
	m.Tier = "external"
	if err := plugin.ValidateManifest(&m); err != nil {
		return plugin.Manifest{}, err
	}
	k.mu.RLock()
	_, isBuiltin := k.builtins[m.ID]
	k.mu.RUnlock()
	if isBuiltin {
		return plugin.Manifest{}, os.ErrPermission
	}

	dstDir := filepath.Join(k.cfg.DataDir, "plugins", m.ID)
	_ = os.RemoveAll(dstDir)
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		return plugin.Manifest{}, err
	}

	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		slash := filepath.ToSlash(f.Name)
		if stripPrefix != "" {
			if !strings.HasPrefix(slash, stripPrefix) {
				continue
			}
			slash = strings.TrimPrefix(slash, stripPrefix)
		}
		clean := strings.TrimPrefix(filepath.ToSlash(filepath.Clean("/"+slash)), "/")
		if clean == "" || strings.Contains(clean, "..") {
			continue
		}
		target := filepath.Join(dstDir, filepath.FromSlash(clean))
		_ = os.MkdirAll(filepath.Dir(target), 0o755)
		rc, err := f.Open()
		if err != nil {
			continue
		}
		outBytes, err := io.ReadAll(io.LimitReader(rc, 5<<20))
		_ = rc.Close()
		if err == nil {
			_ = os.WriteFile(target, outBytes, 0o644)
		}
	}
	if err := k.LoadExternalPlugins(); err != nil {
		return plugin.Manifest{}, err
	}
	return m, nil
}

func (k *Kernel) handleReloadExternalPlugins(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	if u.Role != "admin" {
		plugin.WriteErr(w, http.StatusForbidden, "admin only")
		return
	}
	if err := k.LoadExternalPlugins(); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"plugins": k.ListPluginRecords(true)})
}

func (k *Kernel) handleDeleteExternalPlugin(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	if u.Role != "admin" {
		plugin.WriteErr(w, http.StatusForbidden, "仅管理员可卸载插件")
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if !plugin.IsValidPluginID(id) {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid plugin id")
		return
	}
	ext, ok := k.getExternalPlugin(id)
	if !ok {
		plugin.WriteErr(w, http.StatusNotFound, "外部插件不存在")
		return
	}
	_ = os.RemoveAll(ext.dir)
	_, _ = k.db.Exec(`DELETE FROM plugin_states WHERE plugin_id = ?`, id)
	_, _ = k.db.Exec(`DELETE FROM plugin_kv WHERE plugin_id = ?`, id)
	_ = k.LoadExternalPlugins()
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}
