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

	states := make(map[string]struct {
		enabled bool
		cfg     map[string]any
	})
	rows, err := k.db.Query(`SELECT plugin_id, enabled, config_json FROM plugin_states`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, cfgRaw string
			var en int
			if err := rows.Scan(&id, &en, &cfgRaw); err == nil {
				var cfgMap map[string]any
				_ = json.Unmarshal([]byte(cfgRaw), &cfgMap)
				if cfgMap == nil {
					cfgMap = map[string]any{}
				}
				states[id] = struct {
					enabled bool
					cfg     map[string]any
				}{enabled: en == 1, cfg: cfgMap}
			}
		}
	}

	buildRecord := func(m plugin.Manifest) plugin.PluginStateRecord {
		rec := plugin.PluginStateRecord{
			Manifest: m,
			Enabled:  m.DefaultEnabled,
			Config:   map[string]any{},
		}
		if st, ok := states[m.ID]; ok {
			rec.Enabled = st.enabled
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
		Enabled *bool          `json:"enabled"`
		Config  map[string]any `json:"config"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	curEnabled := 1
	curCfgRaw := "{}"
	err := k.db.QueryRow(`SELECT enabled, config_json FROM plugin_states WHERE plugin_id = ?`, id).Scan(&curEnabled, &curCfgRaw)
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

	if _, err := k.db.Exec(
		`INSERT INTO plugin_states (plugin_id, enabled, config_json, updated_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(plugin_id) DO UPDATE SET enabled = excluded.enabled, config_json = excluded.config_json, updated_at = excluded.updated_at`,
		id, curEnabled, curCfgRaw, time.Now().UTC(),
	); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}

	// Broadcast state update to connected sessions so dashboards sync immediately
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
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
