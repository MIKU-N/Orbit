package config

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Version is the current Orbit release version (overridable via -ldflags).
var Version = "0.2.0"

// Config holds runtime configuration for Orbit.
type Config struct {
	Addr         string
	DataDir      string
	LANMaxMB     int64
	TSMaxMB      int64
	WANMaxMB     int64
	MaxStorageMB int64
	TrustProxy   bool
	WANHosts     map[string]struct{}
	JWTSecret    []byte
	AdminUser    string
	AdminPass    string
}

// Load reads configuration from environment variables and ensures data directories exist.
func Load() (*Config, error) {
	addr := strings.TrimSpace(os.Getenv("ORBIT_ADDR"))
	if addr == "" {
		if port := strings.TrimSpace(os.Getenv("ORBIT_PORT")); port != "" {
			if strings.HasPrefix(port, ":") {
				addr = port
			} else {
				addr = ":" + port
			}
		} else {
			addr = ":8080"
		}
	}

	dataDir := strings.TrimSpace(os.Getenv("ORBIT_DATA_DIR"))
	if dataDir == "" {
		dataDir = "./data"
	}
	absData, err := filepath.Abs(dataDir)
	if err == nil {
		dataDir = absData
	}

	for _, sub := range []string{
		dataDir,
		filepath.Join(dataDir, "uploads"),
		filepath.Join(dataDir, "clips"),
		filepath.Join(dataDir, "wallpapers"),
		filepath.Join(dataDir, "icons"),
		filepath.Join(dataDir, "avatars"),
		filepath.Join(dataDir, "fonts"),
		filepath.Join(dataDir, "plugins"),
		filepath.Join(dataDir, "cache", "bing"),
	} {
		if err := os.MkdirAll(sub, 0o755); err != nil {
			return nil, err
		}
	}

	wanHosts := make(map[string]struct{})
	for _, h := range strings.Split(os.Getenv("ORBIT_WAN_HOSTS"), ",") {
		h = strings.ToLower(strings.TrimSpace(h))
		if h != "" {
			wanHosts[h] = struct{}{}
		}
	}

	secret, err := loadOrCreateSecret(dataDir, strings.TrimSpace(os.Getenv("ORBIT_JWT_SECRET")))
	if err != nil {
		return nil, err
	}

	return &Config{
		Addr:         addr,
		DataDir:      dataDir,
		LANMaxMB:     envLimitMB("ORBIT_LAN_MAX_MB", 0),
		TSMaxMB:      envLimitMB("ORBIT_TS_MAX_MB", 2048),
		WANMaxMB:     envLimitMB("ORBIT_WAN_MAX_MB", 100),
		MaxStorageMB: envLimitMB("ORBIT_MAX_STORAGE_MB", 20480),
		TrustProxy:   envBool("ORBIT_TRUST_PROXY", true),
		WANHosts:     wanHosts,
		JWTSecret:    secret,
		AdminUser:    strings.TrimSpace(os.Getenv("ORBIT_ADMIN_USER")),
		AdminPass:    os.Getenv("ORBIT_ADMIN_PASS"),
	}, nil
}

func loadOrCreateSecret(dataDir, envSecret string) ([]byte, error) {
	if envSecret != "" {
		return []byte(envSecret), nil
	}
	secretPath := filepath.Join(dataDir, ".jwt_secret")
	if raw, err := os.ReadFile(secretPath); err == nil {
		trimmed := strings.TrimSpace(string(raw))
		if len(trimmed) >= 32 {
			return []byte(trimmed), nil
		}
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	hexSecret := hex.EncodeToString(buf)
	if err := os.WriteFile(secretPath, []byte(hexSecret), 0o600); err != nil {
		return nil, err
	}
	return []byte(hexSecret), nil
}

// envLimitMB parses a size limit in MB where 0 / negative / "unlimited" explicitly disables the limit.
func envLimitMB(key string, def int64) int64 {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if v == "" {
		return def
	}
	if v == "0" || v == "unlimited" || v == "none" || v == "off" || v == "false" {
		return 0
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	if n <= 0 {
		return 0
	}
	return n
}

func envBool(key string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if v == "" {
		return def
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}
