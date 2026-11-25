package kernel

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"orbit/internal/auth"
	"orbit/internal/config"
	"orbit/internal/db"
	"orbit/internal/plugin"
)

type ctxKey string

const userCtxKey ctxKey = "orbit_user"

type scheduledTask struct {
	interval time.Duration
	job      func(context.Context)
}

type Kernel struct {
	db     *sql.DB
	cfg    *config.Config
	hub    *Hub
	bing   *BingService
	client *http.Client

	mu           sync.RWMutex
	builtins     map[string]plugin.Plugin
	builtinOrder []string
	externals    map[string]*externalPluginEntry
	jobs         []scheduledTask
	cancelJobs   context.CancelFunc
}

func New(conn *sql.DB, cfg *config.Config) *Kernel {
	return &Kernel{
		db:        conn,
		cfg:       cfg,
		hub:       NewHub(),
		bing:      NewBingService(cfg.DataDir),
		client:    &http.Client{Timeout: 5 * time.Second, Transport: NewDirectLANTransport(true)},
		builtins:  make(map[string]plugin.Plugin),
		externals: make(map[string]*externalPluginEntry),
	}
}

func (k *Kernel) Register(p plugin.Plugin) error {
	m := p.Manifest()
	if err := plugin.ValidateManifest(&m); err != nil {
		return err
	}
	if err := p.Init(k); err != nil {
		return err
	}
	k.ensurePluginStateRow(m)
	k.mu.Lock()
	if _, exists := k.builtins[m.ID]; !exists {
		k.builtinOrder = append(k.builtinOrder, m.ID)
	}
	k.builtins[m.ID] = p
	k.mu.Unlock()
	return nil
}

func (k *Kernel) Start(ctx context.Context) {
	runCtx, cancel := context.WithCancel(ctx)
	k.mu.Lock()
	k.cancelJobs = cancel
	jobsCopy := append([]scheduledTask(nil), k.jobs...)
	k.mu.Unlock()

	for _, t := range jobsCopy {
		task := t
		go func() {
			task.job(runCtx)
			ticker := time.NewTicker(task.interval)
			defer ticker.Stop()
			for {
				select {
				case <-runCtx.Done():
					return
				case <-ticker.C:
					task.job(runCtx)
				}
			}
		}()
	}
}

func (k *Kernel) Shutdown(ctx context.Context) {
	k.mu.RLock()
	cancel := k.cancelJobs
	pluginsCopy := make([]plugin.Plugin, 0, len(k.builtins))
	for _, id := range k.builtinOrder {
		pluginsCopy = append(pluginsCopy, k.builtins[id])
	}
	k.mu.RUnlock()

	if cancel != nil {
		cancel()
	}
	for _, p := range pluginsCopy {
		if sd, ok := p.(plugin.Shutdowner); ok {
			_ = sd.Shutdown(ctx)
		}
	}
}

// ---------- plugin.Host Implementation ----------

func (k *Kernel) DB() *sql.DB { return k.db }

func (k *Kernel) KV(pluginID string) plugin.KVStore {
	return &dbKVStore{db: k.db, pluginID: pluginID}
}

func (k *Kernel) DataDir(pluginID string) string {
	dir := filepath.Join(k.cfg.DataDir, "plugins", pluginID)
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func (k *Kernel) Config() *config.Config { return k.cfg }

func (k *Kernel) Hub() plugin.WSHub { return k.hub }

func (k *Kernel) Auth() plugin.AuthService { return k }

func (k *Kernel) Network() plugin.NetworkService { return k }

func (k *Kernel) Schedule(interval time.Duration, job func(context.Context)) {
	k.mu.Lock()
	k.jobs = append(k.jobs, scheduledTask{interval: interval, job: job})
	k.mu.Unlock()
}

func (k *Kernel) PluginConfig(pluginID string) map[string]any {
	var raw string
	err := k.db.QueryRow(`SELECT config_json FROM plugin_states WHERE plugin_id = ?`, pluginID).Scan(&raw)
	if err != nil || strings.TrimSpace(raw) == "" {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil || out == nil {
		return map[string]any{}
	}
	return out
}

// ---------- plugin.AuthService Implementation ----------

func (k *Kernel) authenticateRequest(r *http.Request) (*db.User, error) {
	return auth.AuthenticateRequest(r, k.db, k.cfg.JWTSecret)
}

func (k *Kernel) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := k.authenticateRequest(r)
		if err != nil {
			plugin.WriteErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, u)
		next(w, r.WithContext(ctx))
	}
}

func (k *Kernel) CurrentUser(r *http.Request) *db.User {
	u, _ := r.Context().Value(userCtxKey).(*db.User)
	return u
}

func (k *Kernel) HasShareScope(u *db.User, scopeKey string) bool {
	if u == nil {
		return false
	}
	if u.Role == "admin" {
		return true
	}
	switch scopeKey {
	case "bookmarks":
		return u.ShareScopes.Bookmarks
	case "clips":
		return u.ShareScopes.Clips
	case "files":
		return u.ShareScopes.Files
	case "monitor":
		return u.ShareScopes.Monitor
	case "appearance":
		return u.ShareScopes.Appearance
	default:
		return false
	}
}

func (k *Kernel) SharedOwnerID(u *db.User, scopeKey string) int64 {
	if u == nil || u.Role == "admin" || !k.HasShareScope(u, scopeKey) {
		return 0
	}
	if u.ParentID > 0 {
		return u.ParentID
	}
	var adminID int64
	_ = k.db.QueryRow(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`).Scan(&adminID)
	if adminID == u.ID {
		return 0
	}
	return adminID
}

// ---------- plugin.NetworkService Implementation ----------

func (k *Kernel) DetectZone(r *http.Request) (string, string) {
	return auth.DetectZone(r, k.cfg)
}

func (k *Kernel) MaxUploadBytes(zone string) int64 {
	return auth.MaxUploadBytes(zone, k.cfg)
}

func (k *Kernel) HTTPClient(timeout time.Duration, insecureTLS bool) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: NewDirectLANTransport(insecureTLS),
	}
}

// ---------- Plugin State, Dispatch & RouteGroup ----------

func (k *Kernel) ensurePluginStateRow(m plugin.Manifest) {
	def := 1
	if !m.DefaultEnabled {
		def = 0
	}
	_, _ = k.db.Exec(
		`INSERT OR IGNORE INTO plugin_states (plugin_id, enabled, config_json, updated_at) VALUES (?, ?, '{}', ?)`,
		m.ID, def, time.Now().UTC(),
	)
}

func (k *Kernel) IsPluginEnabled(pluginID string) bool {
	var en int
	err := k.db.QueryRow(`SELECT enabled FROM plugin_states WHERE plugin_id = ?`, pluginID).Scan(&en)
	if err == sql.ErrNoRows {
		return true
	}
	if err != nil {
		return true
	}
	return en == 1
}

func (k *Kernel) EffectivePluginAccess(pluginID string) (plugin.AccessSpec, bool) {
	k.mu.RLock()
	var m plugin.Manifest
	var found bool
	if p, ok := k.builtins[pluginID]; ok {
		m = p.Manifest()
		found = true
	} else if ext, ok := k.externals[pluginID]; ok {
		m = ext.manifest
		found = true
	}
	k.mu.RUnlock()
	if !found {
		return plugin.AccessSpec{}, false
	}
	_ = plugin.ValidateManifest(&m)

	var visRaw string
	if err := k.db.QueryRow(`SELECT visibility_json FROM plugin_states WHERE plugin_id = ?`, pluginID).Scan(&visRaw); err == nil {
		if trimmed := strings.TrimSpace(visRaw); trimmed != "" && trimmed != "{}" && trimmed != "null" {
			var ov plugin.VisibilityOverride
			if json.Unmarshal([]byte(trimmed), &ov) == nil {
				return m.EffectiveAccess(&ov), true
			}
		}
	}
	return m.Access, true
}

func (k *Kernel) CanUserAccessPlugin(pluginID string, u *db.User) bool {
	acc, ok := k.EffectivePluginAccess(pluginID)
	if !ok {
		return false
	}
	if u != nil && u.Role == "admin" {
		return true
	}
	if acc.MinRole == "admin" {
		return false
	}
	if u == nil {
		return acc.MinRole == "public" && (acc.Guest.Mode == "readonly" || acc.Guest.Mode == "full")
	}
	return true
}

func (k *Kernel) dispatchWSMessage(ctx plugin.WSContext, msgType string, payload json.RawMessage) {
	k.mu.RLock()
	list := make([]plugin.Plugin, 0, len(k.builtins))
	for _, id := range k.builtinOrder {
		list = append(list, k.builtins[id])
	}
	k.mu.RUnlock()

	for _, p := range list {
		if !k.IsPluginEnabled(p.Manifest().ID) {
			continue
		}
		if h, ok := p.(plugin.WSEventHandler); ok {
			_ = h.HandleWSMessage(ctx, msgType, payload)
		}
	}
}

type routeGroup struct {
	k        *Kernel
	mux      *http.ServeMux
	pluginID string
}

func (rg *routeGroup) wrapEnabled(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !rg.k.IsPluginEnabled(rg.pluginID) {
			plugin.WriteErr(w, http.StatusForbidden, "plugin disabled")
			return
		}
		if acc, ok := rg.k.EffectivePluginAccess(rg.pluginID); ok && acc.MinRole == "admin" {
			u := rg.k.CurrentUser(r)
			if u == nil {
				u, _ = rg.k.authenticateRequest(r)
			}
			if u == nil || u.Role != "admin" {
				plugin.WriteErr(w, http.StatusForbidden, "该插件仅限管理员使用")
				return
			}
		}
		h(w, r)
	}
}

func (rg *routeGroup) rewritePattern(pattern string) string {
	parts := strings.SplitN(strings.TrimSpace(pattern), " ", 2)
	method := ""
	sub := parts[0]
	if len(parts) == 2 {
		method = parts[0] + " "
		sub = parts[1]
	}
	if !strings.HasPrefix(sub, "/") {
		sub = "/" + sub
	}
	if sub == "/" {
		return method + "/api/p/" + rg.pluginID
	}
	return method + "/api/p/" + rg.pluginID + sub
}

func (rg *routeGroup) Handle(pattern string, handler http.HandlerFunc) {
	rg.mux.HandleFunc(rg.rewritePattern(pattern), rg.wrapEnabled(handler))
}

func (rg *routeGroup) HandleAuth(pattern string, handler http.HandlerFunc) {
	rg.mux.HandleFunc(rg.rewritePattern(pattern), rg.wrapEnabled(rg.k.RequireAuth(handler)))
}

func (rg *routeGroup) HandleCompat(pattern string, handler http.HandlerFunc, requireAuth bool) {
	h := handler
	if requireAuth {
		h = rg.k.RequireAuth(handler)
	}
	rg.mux.HandleFunc(pattern, rg.wrapEnabled(h))
}
