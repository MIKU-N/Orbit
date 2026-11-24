package kernel

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"orbit/internal/auth"
	"orbit/internal/db"
	"orbit/internal/plugin"
)

func (k *Kernel) userCount() (int, error) {
	var n int
	err := k.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// EnsureEnvAdmin creates an initial admin user from ORBIT_ADMIN_USER/ORBIT_ADMIN_PASS if no users exist.
func (k *Kernel) EnsureEnvAdmin() error {
	if k.cfg.AdminUser == "" || k.cfg.AdminPass == "" {
		return nil
	}
	n, err := k.userCount()
	if err != nil || n > 0 {
		return err
	}
	hash, err := auth.HashPassword(k.cfg.AdminPass)
	if err != nil {
		return err
	}
	tok, err := auth.GenerateAPIToken()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	res, err := k.db.Exec(
		`INSERT INTO users (username, password_hash, role, api_token, created_at) VALUES (?, ?, 'admin', ?, ?)`,
		k.cfg.AdminUser, hash, tok, now,
	)
	if err != nil {
		return err
	}
	uid, err := res.LastInsertId()
	if err != nil {
		return err
	}
	return db.SeedStarterData(k.db, uid)
}

func (k *Kernel) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	n, err := k.userCount()
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	zone, clientIP := auth.DetectZone(r, k.cfg)
	var user *db.User
	if u, err := k.authenticateRequest(r); err == nil {
		user = u
	}

	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"initialized":   n > 0,
		"authenticated": user != nil,
		"user":          user,
		"detected_zone": zone,
		"client_ip":     clientIP,
		"limits": map[string]int64{
			"lan_mb": k.cfg.LANMaxMB,
			"ts_mb":  k.cfg.TSMaxMB,
			"wan_mb": k.cfg.WANMaxMB,
		},
	})
}

func (k *Kernel) handleSetup(w http.ResponseWriter, r *http.Request) {
	n, err := k.userCount()
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if n > 0 {
		plugin.WriteErr(w, http.StatusForbidden, "already initialized")
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if len(req.Username) < 2 || len(req.Password) < 6 {
		plugin.WriteErr(w, http.StatusBadRequest, "username >= 2 chars and password >= 6 chars required")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "hash error")
		return
	}
	tok, err := auth.GenerateAPIToken()
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "token error")
		return
	}
	now := time.Now().UTC()
	res, err := k.db.Exec(
		`INSERT INTO users (username, password_hash, role, api_token, created_at) VALUES (?, ?, 'admin', ?, ?)`,
		req.Username, hash, tok, now,
	)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "failed to create user")
		return
	}
	uid, _ := res.LastInsertId()
	if err := db.SeedStarterData(k.db, uid); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "failed to seed starter data")
		return
	}

	jwtTok, err := auth.SignJWT(auth.Claims{
		UserID:   uid,
		Username: req.Username,
		Role:     "admin",
		Exp:      time.Now().Add(7 * 24 * time.Hour).Unix(),
	}, k.cfg.JWTSecret)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "jwt sign failed")
		return
	}
	auth.SetSessionCookie(w, r, jwtTok)
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{
		"user": db.User{
			ID:        uid,
			Username:  req.Username,
			Role:      "admin",
			APIToken:  tok,
			CreatedAt: now,
		},
	})
}

func (k *Kernel) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Username = strings.TrimSpace(req.Username)

	var u db.User
	var scopesRaw string
	err := k.db.QueryRow(
		`SELECT id, username, password_hash, role, parent_id, share_scopes, api_token, created_at FROM users WHERE username = ?`,
		req.Username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.ParentID, &scopesRaw, &u.APIToken, &u.CreatedAt)
	if err == sql.ErrNoRows || !auth.CheckPassword(u.PasswordHash, req.Password) {
		plugin.WriteErr(w, http.StatusUnauthorized, "invalid username or password")
		return
	}
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	u.ShareScopes = db.ParseShareScopes(scopesRaw)

	jwtTok, err := auth.SignJWT(auth.Claims{
		UserID:   u.ID,
		Username: u.Username,
		Role:     u.Role,
		Exp:      time.Now().Add(7 * 24 * time.Hour).Unix(),
	}, k.cfg.JWTSecret)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "jwt sign failed")
		return
	}
	auth.SetSessionCookie(w, r, jwtTok)
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (k *Kernel) handleLogout(w http.ResponseWriter, r *http.Request) {
	auth.ClearSessionCookie(w, r)
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (k *Kernel) handleMe(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	zone, ip := auth.DetectZone(r, k.cfg)
	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"user":          u,
		"detected_zone": zone,
		"client_ip":     ip,
	})
}

func (k *Kernel) handleRotateToken(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	tok, err := auth.GenerateAPIToken()
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "token error")
		return
	}
	if _, err := k.db.Exec(`UPDATE users SET api_token = ? WHERE id = ?`, tok, u.ID); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"api_token": tok})
}

func (k *Kernel) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	if u.Role != "admin" {
		plugin.WriteErr(w, http.StatusForbidden, "admin only")
		return
	}
	var req struct {
		Username    string          `json:"username"`
		Password    string          `json:"password"`
		Role        string          `json:"role"`
		ShareScopes *db.ShareScopes `json:"share_scopes"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if len(req.Username) < 2 || len(req.Password) < 6 {
		plugin.WriteErr(w, http.StatusBadRequest, "username >= 2 chars and password >= 6 chars required")
		return
	}
	role := "user"
	parentID := u.ID
	if req.Role == "admin" {
		role = "admin"
		parentID = 0
	}
	var scopes db.ShareScopes
	if req.ShareScopes != nil && role != "admin" {
		scopes = *req.ShareScopes
	}
	scopesBytes, _ := json.Marshal(scopes)

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "hash error")
		return
	}
	tok, err := auth.GenerateAPIToken()
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "token error")
		return
	}
	now := time.Now().UTC()
	res, err := k.db.Exec(
		`INSERT INTO users (username, password_hash, role, parent_id, share_scopes, api_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		req.Username, hash, role, parentID, string(scopesBytes), tok, now,
	)
	if err != nil {
		plugin.WriteErr(w, http.StatusConflict, "username already exists")
		return
	}
	uid, _ := res.LastInsertId()
	_ = db.SeedStarterData(k.db, uid)
	if scopes.Appearance {
		k.syncAppearanceSettings(u.ID, uid)
	}
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{
		"user": db.User{
			ID:          uid,
			Username:    req.Username,
			Role:        role,
			ParentID:    parentID,
			ShareScopes: scopes,
			CreatedAt:   now,
		},
	})
}

func (k *Kernel) handleListUsers(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	if u.Role != "admin" {
		plugin.WriteErr(w, http.StatusForbidden, "admin only")
		return
	}
	rows, err := k.db.Query(`SELECT id, username, role, parent_id, share_scopes, created_at FROM users ORDER BY id ASC`)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()
	list := make([]db.User, 0)
	for rows.Next() {
		var item db.User
		var scopesRaw string
		if err := rows.Scan(&item.ID, &item.Username, &item.Role, &item.ParentID, &scopesRaw, &item.CreatedAt); err == nil {
			item.ShareScopes = db.ParseShareScopes(scopesRaw)
			list = append(list, item)
		}
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"users": list})
}

func (k *Kernel) handleUpdateUserShares(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	if u.Role != "admin" {
		plugin.WriteErr(w, http.StatusForbidden, "仅管理员可执行此操作")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var req struct {
		ShareScopes db.ShareScopes `json:"share_scopes"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	scopesBytes, _ := json.Marshal(req.ShareScopes)
	res, err := k.db.Exec(
		`UPDATE users SET share_scopes = ?, parent_id = CASE WHEN parent_id = 0 THEN ? ELSE parent_id END WHERE id = ? AND role != 'admin'`,
		string(scopesBytes), u.ID, id,
	)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		plugin.WriteErr(w, http.StatusNotFound, "子账号不存在或该账号为管理员")
		return
	}
	if req.ShareScopes.Appearance {
		k.syncAppearanceSettings(u.ID, id)
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"share_scopes": req.ShareScopes})
}

func (k *Kernel) syncAppearanceSettings(srcUserID, dstUserID int64) {
	var srcRaw string
	if err := k.db.QueryRow(`SELECT data_json FROM user_settings WHERE user_id = ?`, srcUserID).Scan(&srcRaw); err != nil || srcRaw == "" {
		return
	}
	var srcMap map[string]any
	if err := json.Unmarshal([]byte(srcRaw), &srcMap); err != nil {
		return
	}
	var dstRaw string
	_ = k.db.QueryRow(`SELECT data_json FROM user_settings WHERE user_id = ?`, dstUserID).Scan(&dstRaw)
	if dstRaw == "" {
		dstRaw = db.DefaultSettingsJSON
	}
	var dstMap map[string]any
	if err := json.Unmarshal([]byte(dstRaw), &dstMap); err != nil || dstMap == nil {
		dstMap = make(map[string]any)
	}
	for _, key := range []string{
		"glassTheme", "glassBlur", "glassBlurMode", "glassAlpha", "glassRadius", "bgDim",
		"fontConfig", "wallpaperMode", "wallpaperPreset", "wallpaperCustom",
		"localWallpapers", "localWallpaperRotate", "localWallpaperIntervalMin",
		"bingAuto", "enableTilt", "footer",
	} {
		if v, ok := srcMap[key]; ok {
			dstMap[key] = v
		}
	}
	merged, err := json.Marshal(dstMap)
	if err != nil {
		return
	}
	now := time.Now().UTC()
	_, _ = k.db.Exec(
		`INSERT INTO user_settings (user_id, data_json, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
		dstUserID, string(merged), now,
	)
}

func (k *Kernel) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(req.NewPassword) < 6 {
		plugin.WriteErr(w, http.StatusBadRequest, "新密码至少需要 6 位")
		return
	}

	var currentHash string
	if err := k.db.QueryRow(`SELECT password_hash FROM users WHERE id = ?`, u.ID).Scan(&currentHash); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if !auth.CheckPassword(currentHash, req.OldPassword) {
		plugin.WriteErr(w, http.StatusUnauthorized, "当前密码不正确")
		return
	}

	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "hash error")
		return
	}
	if _, err := k.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, newHash, u.ID); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (k *Kernel) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	if u.Role != "admin" {
		plugin.WriteErr(w, http.StatusForbidden, "仅管理员可执行此操作")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if id == u.ID {
		plugin.WriteErr(w, http.StatusBadRequest, "不能删除当前登录账号")
		return
	}
	res, err := k.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	aff, _ := res.RowsAffected()
	if aff == 0 {
		plugin.WriteErr(w, http.StatusNotFound, "用户不存在")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------- User Settings & Guest Public Config ----------

func (k *Kernel) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	var dataJSON string
	err := k.db.QueryRow(`SELECT data_json FROM user_settings WHERE user_id = ?`, u.ID).Scan(&dataJSON)
	if err == sql.ErrNoRows || dataJSON == "" {
		dataJSON = db.DefaultSettingsJSON
	} else if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}

	var parsed json.RawMessage
	if err := json.Unmarshal([]byte(dataJSON), &parsed); err != nil {
		parsed = json.RawMessage(db.DefaultSettingsJSON)
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"settings": parsed})
}

func (k *Kernel) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	var wrapper struct {
		Settings json.RawMessage `json:"settings"`
	}
	var payload json.RawMessage
	if err := json.Unmarshal(raw, &wrapper); err == nil && len(wrapper.Settings) > 0 && string(wrapper.Settings) != "null" {
		payload = wrapper.Settings
	} else {
		var obj map[string]any
		if err := json.Unmarshal(raw, &obj); err != nil || obj == nil {
			plugin.WriteErr(w, http.StatusBadRequest, "settings JSON object required")
			return
		}
		payload = raw
	}

	var check map[string]any
	if err := json.Unmarshal(payload, &check); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid settings JSON")
		return
	}
	normalized, _ := json.Marshal(check)

	now := time.Now().UTC()
	if _, err := k.db.Exec(
		`INSERT INTO user_settings (user_id, data_json, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
		u.ID, string(normalized), now,
	); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"settings": json.RawMessage(normalized)})
}

func (k *Kernel) LoadAdminSettingsMap() (int64, map[string]any) {
	rawJSON := db.DefaultSettingsJSON
	var adminID int64
	var dataJSON string
	err := k.db.QueryRow(
		`SELECT u.id, us.data_json
		 FROM user_settings us
		 JOIN users u ON u.id = us.user_id
		 WHERE u.role = 'admin'
		 ORDER BY u.id ASC LIMIT 1`,
	).Scan(&adminID, &dataJSON)
	if err == nil && dataJSON != "" {
		rawJSON = dataJSON
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &parsed); err != nil || parsed == nil {
		_ = json.Unmarshal([]byte(db.DefaultSettingsJSON), &parsed)
	}
	return adminID, parsed
}

func (k *Kernel) handlePublicConfig(w http.ResponseWriter, r *http.Request) {
	adminID, src := k.LoadAdminSettingsMap()

	allowGuest := true
	if v, ok := src["allowGuest"].(bool); ok {
		allowGuest = v
	}

	out := map[string]any{
		"allowGuest": allowGuest,
	}
	if !allowGuest {
		plugin.WriteJSON(w, http.StatusOK, out)
		return
	}

	safeKeys := []string{
		"glassTheme",
		"glassBlur",
		"glassBlurMode",
		"glassAlpha",
		"glassRadius",
		"bgDim",
		"fontConfig",
		"wallpaperMode",
		"wallpaperPreset",
		"wallpaperCustom",
		"localWallpapers",
		"localWallpaperRotate",
		"localWallpaperIntervalMin",
		"bingAuto",
		"enableTilt",
		"showSeconds",
		"searchIconOnly",
		"activeEngineId",
		"weatherConfig",
		"weatherCity",
		"weatherLabel",
		"footer",
	}
	for _, key := range safeKeys {
		if val, ok := src[key]; ok {
			out[key] = val
		}
	}

	if rawEngines, ok := src["engines"].([]any); ok {
		publicEngines := make([]any, 0, len(rawEngines))
		for _, item := range rawEngines {
			if m, ok := item.(map[string]any); ok {
				if u, _ := m["url"].(string); u != "" {
					publicEngines = append(publicEngines, m)
				}
			}
		}
		out["engines"] = publicEngines
	}

	// Merge any PublicConfigContributor plugins
	k.mu.RLock()
	pluginsCopy := make([]plugin.Plugin, 0, len(k.builtins))
	for _, id := range k.builtinOrder {
		pluginsCopy = append(pluginsCopy, k.builtins[id])
	}
	k.mu.RUnlock()

	for _, p := range pluginsCopy {
		if !k.IsPluginEnabled(p.Manifest().ID) {
			continue
		}
		if contrib, ok := p.(plugin.PublicConfigContributor); ok {
			for ck, cv := range contrib.PublicConfig(adminID) {
				out[ck] = cv
			}
		}
	}

	out["plugins"] = k.ListPluginRecords(false)
	plugin.WriteJSON(w, http.StatusOK, out)
}
