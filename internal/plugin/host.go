package plugin

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"orbit/internal/config"
	"orbit/internal/db"
)

type KVStore interface {
	Get(ctx context.Context, userID int64, key string) (json.RawMessage, bool, error)
	Set(ctx context.Context, userID int64, key string, val json.RawMessage) error
	Delete(ctx context.Context, userID int64, key string) error
	List(ctx context.Context, userID int64) (map[string]json.RawMessage, error)
}

type WSHub interface {
	BroadcastUser(userID int64, msgType string, payload any)
	RelaySignal(userID int64, fromPeerID, targetPeerID string, signal json.RawMessage)
}

type AuthService interface {
	RequireAuth(next http.HandlerFunc) http.HandlerFunc
	CurrentUser(r *http.Request) *db.User
	HasShareScope(u *db.User, scopeKey string) bool
	SharedOwnerID(u *db.User, scopeKey string) int64
}

type NetworkService interface {
	DetectZone(r *http.Request) (zone string, clientIP string)
	MaxUploadBytes(zone string) int64
	HTTPClient(timeout time.Duration, insecureTLS bool) *http.Client
}

type RouteGroup interface {
	Handle(pattern string, handler http.HandlerFunc)
	HandleAuth(pattern string, handler http.HandlerFunc)
	HandleCompat(pattern string, handler http.HandlerFunc, requireAuth bool)
}

type Host interface {
	DB() *sql.DB
	KV(pluginID string) KVStore
	DataDir(pluginID string) string
	Config() *config.Config
	Hub() WSHub
	Auth() AuthService
	Network() NetworkService
	Schedule(interval time.Duration, job func(context.Context))
	PluginConfig(pluginID string) map[string]any
}

type WSContext struct {
	User     *db.User
	PeerID   string
	Zone     string
	ClientIP string
	Hub      WSHub
}

// Plugin is the minimal interface every Orbit builtin or Go plugin implements.
type Plugin interface {
	Manifest() Manifest
	Init(host Host) error
	RegisterRoutes(r RouteGroup)
}

// PublicConfigContributor optionally contributes non-sensitive public config keys.
type PublicConfigContributor interface {
	PublicConfig(adminUserID int64) map[string]any
}

// WSEventHandler optionally handles WebSocket messages targeting a plugin.
type WSEventHandler interface {
	HandleWSMessage(ctx WSContext, msgType string, payload json.RawMessage) error
}

// Shutdowner optionally releases background resources on graceful shutdown.
type Shutdowner interface {
	Shutdown(ctx context.Context) error
}

// ---------- Shared HTTP & Utility Helpers ----------

func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func WriteErr(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]any{"error": msg})
}

func DecodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 4<<20))
	return dec.Decode(dst)
}

func FirstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if t := strings.TrimSpace(v); t != "" {
			return t
		}
	}
	return ""
}

func IsLikelyLocalURL(raw string) bool {
	l := strings.ToLower(raw)
	return strings.Contains(l, "192.168.") ||
		strings.Contains(l, "10.") ||
		strings.Contains(l, "172.16.") ||
		strings.Contains(l, "127.0.0.1") ||
		strings.Contains(l, "localhost")
}
