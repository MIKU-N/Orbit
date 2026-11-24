package config

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

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
		LANMaxMB:     envInt64("ORBIT_LAN_MAX_MB", 10240),
		TSMaxMB:      envInt64("ORBIT_TS_MAX_MB", 2048),
		WANMaxMB:     envInt64("ORBIT_WAN_MAX_MB", 100),
		MaxStorageMB: envInt64("ORBIT_MAX_STORAGE_MB", 20480),
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

func envInt64(key string, def int64) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		return def
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
