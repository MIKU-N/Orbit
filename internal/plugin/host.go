package plugin

import (
	"context"
	"database/sql"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
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
	BroadcastUserExcept(userID int64, excludePeerIDs []string, msgType string, payload any)
	SendToPeer(userID int64, targetPeerID string, msgType string, payload any) bool
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

func extractURLHost(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(u.Hostname()))
}

func IsTailscaleURL(raw string) bool {
	host := extractURLHost(raw)
	if host == "" {
		return false
	}
	if strings.HasSuffix(host, ".ts.net") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip4 := ip.To4(); ip4 != nil {
			// 100.64.0.0/10 (Tailscale CGNAT)
			return ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127
		}
		// Tailscale IPv6 ULA prefix fd7a:115c:a1e0::/48
		if len(ip) == net.IPv6len && ip[0] == 0xfd && ip[1] == 0x7a && ip[2] == 0x11 && ip[3] == 0x5c && ip[4] == 0xa1 && ip[5] == 0xe0 {
			return true
		}
	}
	return false
}

func IsLikelyLocalURL(raw string) bool {
	host := extractURLHost(raw)
	if host == "" {
		return false
	}
	if host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".lan") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".home.arpa") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		if IsTailscaleURL(raw) {
			return false
		}
		return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
	}
	return false
}
