package db

import (
	"encoding/json"
	"strings"
	"time"
)

type ShareScopes struct {
	Bookmarks  bool `json:"bookmarks"`
	Clips      bool `json:"clips"`
	Files      bool `json:"files"`
	Monitor    bool `json:"monitor"`
	Appearance bool `json:"appearance"`
}

func ParseShareScopes(raw string) ShareScopes {
	var sc ShareScopes
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &sc)
	}
	return sc
}

type User struct {
	ID           int64       `json:"id"`
	Username     string      `json:"username"`
	PasswordHash string      `json:"-"`
	Role         string      `json:"role"`
	ParentID     int64       `json:"parent_id"`
	ShareScopes  ShareScopes `json:"share_scopes"`
	APIToken     string      `json:"api_token,omitempty"`
	CreatedAt    time.Time   `json:"created_at"`
}

type Group struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	Name      string    `json:"name"`
	SortOrder int       `json:"sort_order"`
	Shared    bool      `json:"shared,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type Bookmark struct {
	ID          int64     `json:"id"`
	UserID      int64     `json:"user_id"`
	GroupID     int64     `json:"group_id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	LANUrl      string    `json:"lan_url"`
	TSUrl       string    `json:"ts_url"`
	WANUrl      string    `json:"wan_url"`
	Icon        string    `json:"icon"`
	Color       string    `json:"color"`
	SortOrder   int       `json:"sort_order"`
	Shared      bool      `json:"shared,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

type Clip struct {
	ID        int64      `json:"id"`
	UserID    int64      `json:"user_id"`
	Kind      string     `json:"kind"` // text | code | link | image
	Content   string     `json:"content"`
	ImagePath string     `json:"image_path"`
	Device    string     `json:"device"`
	Pinned    bool       `json:"pinned"`
	Shared    bool       `json:"shared,omitempty"`
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
}

type StagedFile struct {
	ID         int64     `json:"id"`
	UserID     int64     `json:"user_id"`
	OrigName   string    `json:"orig_name"`
	StoredName string    `json:"-"`
	MimeType   string    `json:"mime_type"`
	SizeBytes  int64     `json:"size_bytes"`
	Zone       string    `json:"zone"`
	Uploader   string    `json:"uploader"`
	Shared     bool      `json:"shared,omitempty"`
	ExpiresAt  time.Time `json:"expires_at"`
	CreatedAt  time.Time `json:"created_at"`
}

type Share struct {
	Code          string    `json:"code"`
	UserID        int64     `json:"user_id"`
	Kind          string    `json:"kind"` // file | clip
	TargetID      int64     `json:"target_id"`
	BurnAfterRead bool      `json:"burn_after_read"`
	UsedCount     int       `json:"used_count"`
	ExpiresAt     time.Time `json:"expires_at"`
	CreatedAt     time.Time `json:"created_at"`
}
