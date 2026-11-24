package db

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const DefaultSettingsJSON = `{
  "glassTheme": "dark",
  "glassBlur": 55,
  "glassBlurMode": "pct",
  "glassAlpha": 32,
  "glassRadius": 16,
  "bgDim": 22,
  "fontConfig": {
    "activeId": "noto-sans",
    "customFonts": []
  },
  "wallpaperMode": "bing",
  "wallpaperPreset": 0,
  "wallpaperCustom": "",
  "localWallpapers": [],
  "localWallpaperRotate": false,
  "localWallpaperIntervalMin": 15,
  "bingAuto": true,
  "enableTilt": true,
  "showSeconds": false,
  "dockStyle": "card",
  "searchIconOnly": false,
  "allowGuest": true,
  "weatherCity": "Shanghai",
  "weatherLabel": "上海",
  "weatherConfig": {
    "label": "上海",
    "query": "上海",
    "lat": 31.2304,
    "lon": 121.4737,
    "unit": "C",
    "showFeelsLike": true,
    "showHumidity": true,
    "showWind": false,
    "showPrecip": false,
    "showPressure": false,
    "showHiLo": true,
    "forecastDays": 2,
    "refreshMinutes": 30
  },
  "monitorConfig": {
    "title": "",
    "showNetSpeed": true,
    "showSparkline": true,
    "showLanIP": false,
    "diskMount": "",
    "columns": 3,
    "metrics": ["cpu", "ram", "disk"],
    "refreshSeconds": 3
  },
  "footer": {
    "enabled": true,
    "text": "Orbit · 星轨",
    "align": "center",
    "links": [],
    "showPoweredBy": true,
    "glassBg": false
  },
  "visibleItems": {
    "clock": true,
    "search": true,
    "weather": true,
    "monitor": true,
    "bookmarks": true
  },
  "hasCustomLayout": false,
  "layout": null,
  "engines": [
    { "id": "google", "name": "Google", "key": "g", "url": "https://www.google.com/search?q={q}", "color": "#60a5fa", "icon": "" },
    { "id": "bing", "name": "Bing", "key": "b", "url": "https://www.bing.com/search?q={q}", "color": "#38bdf8", "icon": "" },
    { "id": "github", "name": "GitHub", "key": "gh", "url": "https://github.com/search?q={q}", "color": "#e2e8f0", "icon": "" },
    { "id": "bilibili", "name": "Bilibili", "key": "bl", "url": "https://search.bilibili.com/all?keyword={q}", "color": "#f472b6", "icon": "" },
    { "id": "local", "name": "站内", "key": "s", "url": "", "color": "#a78bfa", "icon": "" }
  ],
  "activeEngineId": "google"
}`

// Open initializes SQLite with WAL mode and runs schema migrations.
func Open(dataDir string) (*sql.DB, error) {
	dbPath := filepath.Join(dataDir, "orbit.db")
	conn, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1)

	pragmas := []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA foreign_keys=ON;",
		"PRAGMA busy_timeout=5000;",
		"PRAGMA synchronous=NORMAL;",
	}
	for _, p := range pragmas {
		if _, err := conn.Exec(p); err != nil {
			conn.Close()
			return nil, err
		}
	}

	if err := migrate(conn); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

func migrate(conn *sql.DB) error {
	schema := `
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'user',
	api_token TEXT NOT NULL UNIQUE,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	lan_url TEXT NOT NULL DEFAULT '',
	ts_url TEXT NOT NULL DEFAULT '',
	wan_url TEXT NOT NULL DEFAULT '',
	icon TEXT NOT NULL DEFAULT 'globe',
	color TEXT NOT NULL DEFAULT '#6366f1',
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS clips (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT NOT NULL DEFAULT 'text',
	content TEXT NOT NULL DEFAULT '',
	image_path TEXT NOT NULL DEFAULT '',
	device TEXT NOT NULL DEFAULT '',
	pinned INTEGER NOT NULL DEFAULT 0,
	expires_at DATETIME,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS staged_files (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	orig_name TEXT NOT NULL,
	stored_name TEXT NOT NULL,
	mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
	size_bytes INTEGER NOT NULL,
	zone TEXT NOT NULL DEFAULT 'lan',
	uploader TEXT NOT NULL DEFAULT '',
	expires_at DATETIME NOT NULL,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
	code TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,
	target_id INTEGER NOT NULL,
	burn_after_read INTEGER NOT NULL DEFAULT 0,
	used_count INTEGER NOT NULL DEFAULT 0,
	expires_at DATETIME NOT NULL,
	created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
	user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	data_json TEXT NOT NULL,
	updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_states (
	plugin_id   TEXT PRIMARY KEY,
	enabled     INTEGER NOT NULL DEFAULT 1,
	config_json TEXT NOT NULL DEFAULT '{}',
	updated_at  DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_kv (
	plugin_id   TEXT NOT NULL,
	user_id     INTEGER NOT NULL DEFAULT 0,
	k           TEXT NOT NULL,
	v_json      TEXT NOT NULL,
	updated_at  DATETIME NOT NULL,
	PRIMARY KEY (plugin_id, user_id, k)
);

CREATE INDEX IF NOT EXISTS idx_groups_user ON groups(user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_clips_user ON clips(user_id, pinned DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_user ON staged_files(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_shares_exp ON shares(expires_at);
`
	if _, err := conn.Exec(schema); err != nil {
		return err
	}

	alterCols := []string{
		`ALTER TABLE users ADD COLUMN parent_id INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE users ADD COLUMN share_scopes TEXT NOT NULL DEFAULT '{}'`,
	}
	for _, stmt := range alterCols {
		if _, err := conn.Exec(stmt); err != nil {
			if !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
				return err
			}
		}
	}
	return nil
}

// SeedStarterData creates initial groups, bookmarks, and settings for a new user.
func SeedStarterData(conn *sql.DB, userID int64) error {
	now := time.Now().UTC()
	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	groupNames := []string{"实验室", "开发", "工具"}
	groupIDs := make([]int64, len(groupNames))
	for i, name := range groupNames {
		res, err := tx.Exec(
			`INSERT INTO groups (user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)`,
			userID, name, i, now,
		)
		if err != nil {
			return err
		}
		gid, err := res.LastInsertId()
		if err != nil {
			return err
		}
		groupIDs[i] = gid
	}

	starters := []struct {
		groupIdx int
		title    string
		desc     string
		lan      string
		ts       string
		wan      string
		icon     string
		color    string
	}{
		{0, "Proxmox", "虚拟化控制台", "https://192.168.1.10:8006", "https://100.64.0.10:8006", "", "server", "#f97316"},
		{0, "TrueNAS", "ZFS 文件存储", "http://192.168.1.12", "http://100.64.0.12", "", "harddrive", "#38bdf8"},
		{0, "Jellyfin", "家庭影音库", "http://192.168.1.10:8096", "http://100.64.0.10:8096", "https://tv.example.com", "play", "#a855f7"},
		{0, "Home Assistant", "智能家居中枢", "http://192.168.1.15:8123", "http://100.64.0.15:8123", "https://home.example.com", "home", "#0ea5e9"},
		{1, "Gitea", "私有 Git 代码库", "http://192.168.1.10:3005", "http://100.64.0.10:3005", "https://git.example.com", "code", "#22c55e"},
		{1, "Portainer", "Docker 容器面板", "https://192.168.1.10:9443", "https://100.64.0.10:9443", "", "box", "#06b6d4"},
		{1, "Grafana", "节点监控看板", "http://192.168.1.10:3001", "http://100.64.0.10:3001", "https://metrics.example.com", "chart", "#fb923c"},
		{1, "Tailscale", "组网节点管理", "https://login.tailscale.com/admin", "https://login.tailscale.com/admin", "https://login.tailscale.com/admin", "globe", "#818cf8"},
		{2, "Vaultwarden", "私有密码库", "https://192.168.1.10:8443", "https://100.64.0.10:8443", "https://vault.example.com", "lock", "#3b82f6"},
		{2, "Memos", "轻量碎片笔记", "http://192.168.1.10:5230", "http://100.64.0.10:5230", "https://memos.example.com", "note", "#10b981"},
	}

	for i, s := range starters {
		if _, err := tx.Exec(
			`INSERT INTO bookmarks (user_id, group_id, title, description, lan_url, ts_url, wan_url, icon, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID, groupIDs[s.groupIdx], s.title, s.desc, s.lan, s.ts, s.wan, s.icon, s.color, i, now,
		); err != nil {
			return err
		}
	}

	var compact json.RawMessage
	if err := json.Unmarshal([]byte(DefaultSettingsJSON), &compact); err == nil {
		if b, err := json.Marshal(compact); err == nil {
			_, err = tx.Exec(
				`INSERT OR IGNORE INTO user_settings (user_id, data_json, updated_at) VALUES (?, ?, ?)`,
				userID, string(b), now,
			)
			if err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}
