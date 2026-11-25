package kernel

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"orbit/internal/plugin"
	"orbit/internal/webui"
)

func (k *Kernel) ListPluginRecords(isAdmin bool) []plugin.PluginStateRecord {
	k.mu.RLock()
	builtinIDs := append([]string(nil), k.builtinOrder...)
	builtinsCopy := make(map[string]plugin.Plugin, len(k.builtins))
	for id, p := range k.builtins {
		builtinsCopy[id] = p
	}
	extIDs := make([]string, 0, len(k.externals))
	extCopy := make(map[string]*externalPluginEntry, len(k.externals))
	for id, e := range k.externals {
		extIDs = append(extIDs, id)
		extCopy[id] = e
	}
	k.mu.RUnlock()

	sort.Strings(extIDs)

	type pluginRowState struct {
		enabled    bool
		cfg        map[string]any
		visibility *plugin.VisibilityOverride
		style      *plugin.StyleOverride
	}
	states := make(map[string]pluginRowState)
	rows, err := k.db.Query(`SELECT plugin_id, enabled, config_json, visibility_json, style_json FROM plugin_states`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, cfgRaw, visRaw, styleRaw string
			var en int
			if err := rows.Scan(&id, &en, &cfgRaw, &visRaw, &styleRaw); err == nil {
				var cfgMap map[string]any
				_ = json.Unmarshal([]byte(cfgRaw), &cfgMap)
				if cfgMap == nil {
					cfgMap = map[string]any{}
				}
				var visOv *plugin.VisibilityOverride
				if trimmed := strings.TrimSpace(visRaw); trimmed != "" && trimmed != "{}" && trimmed != "null" {
					var v plugin.VisibilityOverride
					if json.Unmarshal([]byte(trimmed), &v) == nil && (v.MinRole != "" || v.GuestMode != "") {
						visOv = &v
					}
				}
				var styleOv *plugin.StyleOverride
				if trimmed := strings.TrimSpace(styleRaw); trimmed != "" && trimmed != "{}" && trimmed != "null" {
					var s plugin.StyleOverride
					if json.Unmarshal([]byte(trimmed), &s) == nil && (s.Managed != nil || s.Cardless != nil || s.HideHeader != nil) {
						styleOv = &s
					}
				}
				states[id] = pluginRowState{
					enabled:    en == 1,
					cfg:        cfgMap,
					visibility: visOv,
					style:      styleOv,
				}
			}
		}
	}

	buildRecord := func(m plugin.Manifest) plugin.PluginStateRecord {
		_ = plugin.ValidateManifest(&m)
		rec := plugin.PluginStateRecord{
			Manifest: m,
			Enabled:  m.DefaultEnabled,
			Config:   map[string]any{},
		}
		if st, ok := states[m.ID]; ok {
			rec.Enabled = st.enabled
			rec.Visibility = st.visibility
			rec.Style = st.style
			if st.visibility != nil {
				rec.Manifest.Access = rec.Manifest.EffectiveAccess(st.visibility)
			}
			if st.style != nil {
				if rec.Manifest.Style == nil {
					rec.Manifest.Style = &plugin.StyleSpec{Managed: true, SupportsCardless: true}
				}
				styleCopy := *rec.Manifest.Style
				if st.style.Managed != nil {
					styleCopy.Managed = *st.style.Managed
				}
				if st.style.Cardless != nil {
					styleCopy.DefaultCardless = *st.style.Cardless
				}
				if st.style.HideHeader != nil {
					styleCopy.HideHeader = *st.style.HideHeader
				}
				rec.Manifest.Style = &styleCopy
			}
			if isAdmin {
				rec.Config = st.cfg
			} else if m.External != nil {
				masked := make(map[string]any)
				secretKeys := make(map[string]bool)
				for _, f := range m.External.ConfigFields {
					if f.Secret {
						secretKeys[f.Key] = true
					}
				}
				for ck, cv := range st.cfg {
					if !secretKeys[ck] {
						masked[ck] = cv
					}
				}
				rec.Config = masked
			}
		}
		return rec
	}

	out := make([]plugin.PluginStateRecord, 0, len(builtinIDs)+len(extIDs))
	for _, id := range builtinIDs {
		out = append(out, buildRecord(builtinsCopy[id].Manifest()))
	}
	for _, id := range extIDs {
		out = append(out, buildRecord(extCopy[id].manifest))
	}
	return out
}

func (k *Kernel) handleListPlugins(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	isAdmin := u != nil && u.Role == "admin"
	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"plugins": k.ListPluginRecords(isAdmin),
	})
}

func (k *Kernel) handlePatchPlugin(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	if u.Role != "admin" {
		plugin.WriteErr(w, http.StatusForbidden, "仅管理员可管理插件状态")
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if !plugin.IsValidPluginID(id) {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid plugin id")
		return
	}

	// Confirm plugin is registered (builtin or external)
	k.mu.RLock()
	_, isBuiltin := k.builtins[id]
	_, isExternal := k.externals[id]
	k.mu.RUnlock()
	if !isBuiltin && !isExternal {
		plugin.WriteErr(w, http.StatusNotFound, "插件不存在")
		return
	}

	var req struct {
		Enabled    *bool                      `json:"enabled"`
		Config     map[string]any             `json:"config"`
		Visibility *plugin.VisibilityOverride `json:"visibility"`
		Style      *plugin.StyleOverride      `json:"style"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	curEnabled := 1
	curCfgRaw := "{}"
	curVisRaw := "{}"
	curStyleRaw := "{}"
	err := k.db.QueryRow(
		`SELECT enabled, config_json, visibility_json, style_json FROM plugin_states WHERE plugin_id = ?`,
		id,
	).Scan(&curEnabled, &curCfgRaw, &curVisRaw, &curStyleRaw)
	if err != nil && err != sql.ErrNoRows {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}

	if req.Enabled != nil {
		if *req.Enabled {
			curEnabled = 1
		} else {
			curEnabled = 0
		}
	}
	if req.Config != nil {
		if b, err := json.Marshal(req.Config); err == nil {
			curCfgRaw = string(b)
		}
	}
	if req.Visibility != nil {
		var clean plugin.VisibilityOverride
		switch req.Visibility.MinRole {
		case "public", "user", "admin":
			clean.MinRole = req.Visibility.MinRole
		}
		switch req.Visibility.GuestMode {
		case "hidden", "readonly", "full", "login-prompt":
			clean.GuestMode = req.Visibility.GuestMode
		}
		if b, err := json.Marshal(clean); err == nil {
			curVisRaw = string(b)
		}
	}
	if req.Style != nil {
		var merged plugin.StyleOverride
		_ = json.Unmarshal([]byte(curStyleRaw), &merged)
		if req.Style.Managed != nil {
			merged.Managed = req.Style.Managed
		}
		if req.Style.Cardless != nil {
			merged.Cardless = req.Style.Cardless
		}
		if req.Style.HideHeader != nil {
			merged.HideHeader = req.Style.HideHeader
		}
		if b, err := json.Marshal(merged); err == nil {
			curStyleRaw = string(b)
		}
	}

	if _, err := k.db.Exec(
		`INSERT INTO plugin_states (plugin_id, enabled, config_json, visibility_json, style_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(plugin_id) DO UPDATE SET enabled = excluded.enabled, config_json = excluded.config_json, visibility_json = excluded.visibility_json, style_json = excluded.style_json, updated_at = excluded.updated_at`,
		id, curEnabled, curCfgRaw, curVisRaw, curStyleRaw, time.Now().UTC(),
	); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}

	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"plugins": k.ListPluginRecords(true),
	})
}

// Routes constructs the complete Kernel HTTP handler including all builtin plugins,
// external lightweight plugins, CORS middleware for LAN access, and the embedded SPA.
func (k *Kernel) Routes() http.Handler {
	mux := http.NewServeMux()

	// Public & Guest Whitelisted Routes
	mux.HandleFunc("GET /api/public/config", k.handlePublicConfig)

	// Auth & Sub-account Share Control
	mux.HandleFunc("GET /api/auth/status", k.handleAuthStatus)
	mux.HandleFunc("POST /api/auth/setup", k.handleSetup)
	mux.HandleFunc("POST /api/auth/login", k.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", k.handleLogout)
	mux.HandleFunc("GET /api/auth/me", k.RequireAuth(k.handleMe))
	mux.HandleFunc("POST /api/auth/avatar", k.RequireAuth(k.handleAvatarUpload))
	mux.HandleFunc("DELETE /api/auth/avatar", k.RequireAuth(k.handleAvatarDelete))
	mux.HandleFunc("GET /api/avatars/{name}", k.handleServeAvatar)
	mux.HandleFunc("POST /api/auth/password", k.RequireAuth(k.handleChangePassword))
	mux.HandleFunc("POST /api/auth/token/rotate", k.RequireAuth(k.handleRotateToken))
	mux.HandleFunc("GET /api/auth/users", k.RequireAuth(k.handleListUsers))
	mux.HandleFunc("POST /api/auth/users", k.RequireAuth(k.handleCreateUser))
	mux.HandleFunc("PATCH /api/auth/users/{id}/shares", k.RequireAuth(k.handleUpdateUserShares))
	mux.HandleFunc("DELETE /api/auth/users/{id}", k.RequireAuth(k.handleDeleteUser))

	// Global Settings, Wallpapers, Icons & Fonts (Kernel UI Theme Layer)
	mux.HandleFunc("GET /api/settings", k.RequireAuth(k.handleGetSettings))
	mux.HandleFunc("PUT /api/settings", k.RequireAuth(k.handlePutSettings))
	mux.HandleFunc("GET /api/wallpaper/bing", k.handleBingList)
	mux.HandleFunc("GET /api/wallpaper/bing/image", k.handleBingImage)
	mux.HandleFunc("POST /api/wallpaper/upload", k.RequireAuth(k.handleWallpaperUpload))
	mux.HandleFunc("GET /api/wallpaper/custom/{name}", k.handleServeCustomWallpaper)
	mux.HandleFunc("DELETE /api/wallpaper/custom/{name}", k.RequireAuth(k.handleDeleteCustomWallpaper))
	mux.HandleFunc("POST /api/fonts/upload", k.RequireAuth(k.handleFontUpload))
	mux.HandleFunc("GET /api/fonts/custom/{name}", k.handleServeCustomFont)
	mux.HandleFunc("DELETE /api/fonts/custom/{name}", k.RequireAuth(k.handleDeleteCustomFont))
	mux.HandleFunc("POST /api/icons/upload", k.RequireAuth(k.handleIconUpload))
	mux.HandleFunc("POST /api/icons/fetch", k.RequireAuth(k.handleIconFetch))
	mux.HandleFunc("GET /api/icons/custom/{name}", k.handleServeCustomIcon)
	mux.HandleFunc("GET /api/assets", k.RequireAuth(k.handleListAssets))
	mux.HandleFunc("DELETE /api/assets/{category}/{name}", k.RequireAuth(k.handleDeleteAsset))
	mux.HandleFunc("POST /api/assets/batch-delete", k.RequireAuth(k.handleBatchDeleteAssets))

	// Plugin Management & Phase 2 External Light Plugin Host Routes
	mux.HandleFunc("GET /api/plugins", k.RequireAuth(k.handleListPlugins))
	mux.HandleFunc("PATCH /api/plugins/{id}", k.RequireAuth(k.handlePatchPlugin))
	mux.HandleFunc("POST /api/plugins/external/install", k.RequireAuth(k.handleInstallExternalPlugin))
	mux.HandleFunc("POST /api/plugins/external/reload", k.RequireAuth(k.handleReloadExternalPlugins))
	mux.HandleFunc("DELETE /api/plugins/external/{id}", k.RequireAuth(k.handleDeleteExternalPlugin))

	mux.HandleFunc("GET /api/p/{id}/assets/{path...}", k.handleExternalAsset)
	mux.HandleFunc("GET /api/p/{id}/kv", k.RequireAuth(k.handleExternalKV))
	mux.HandleFunc("GET /api/p/{id}/kv/{key}", k.RequireAuth(k.handleExternalKV))
	mux.HandleFunc("PUT /api/p/{id}/kv/{key}", k.RequireAuth(k.handleExternalKV))
	mux.HandleFunc("DELETE /api/p/{id}/kv/{key}", k.RequireAuth(k.handleExternalKV))
	mux.HandleFunc("GET /api/p/{id}/proxy/{route}", k.handleExternalProxy)
	mux.HandleFunc("POST /api/p/{id}/proxy/{route}", k.handleExternalProxy)

	// WebSocket Bus
	mux.HandleFunc("GET /api/ws", k.RequireAuth(k.handleWS))

	// Register All Phase 1 Builtin Plugins
	k.mu.RLock()
	order := append([]string(nil), k.builtinOrder...)
	pluginsCopy := make(map[string]plugin.Plugin, len(k.builtins))
	for id, p := range k.builtins {
		pluginsCopy[id] = p
	}
	k.mu.RUnlock()

	for _, id := range order {
		p := pluginsCopy[id]
		p.RegisterRoutes(&routeGroup{k: k, mux: mux, pluginID: id})
	}

	// Embedded React SPA
	mux.Handle("/", webui.Handler())

	return withCORS(mux)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Orbit-Peer-Id, X-Orbit-Target-Peer-Id")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
