package clipboard

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"orbit/internal/db"
	"orbit/internal/plugin"
)

type Plugin struct {
	host plugin.Host
}

func New() *Plugin { return &Plugin{} }

func (p *Plugin) Manifest() plugin.Manifest {
	return plugin.Manifest{
		ID:             "orbit.clipboard",
		Name:           "跨端剪贴板",
		Version:        "1.0.0",
		Description:    "多设备实时云剪贴板同步，支持 Ctrl+V 直接上传截图、置顶与取件码分享",
		Icon:           "clipboard",
		Tier:           "core",
		Source:         "official",
		DefaultEnabled: true,
		Style: &plugin.StyleSpec{
			Managed:          true,
			SupportsCardless: false,
		},
		Access: plugin.AccessSpec{
			MinRole: "user",
			Guest: plugin.GuestSpec{
				Mode:   "login-prompt",
				Prompt: "云剪贴板同步需要登录后使用",
			},
			Sharing: &plugin.SharingSpec{
				Shareable:     true,
				ScopeKey:      "clips",
				Label:         "剪贴板",
				DefaultShared: false,
				Mode:          "readonly",
			},
			Permissions: []string{"storage", "ws", "net:zone"},
		},
		Contributes: plugin.ContributesSpec{
			Drawers: []plugin.DrawerContrib{
				{
					ID:         "clipboard",
					Title:      "剪贴板",
					Icon:       "clipboard",
					Shortcut:   "c",
					TopBar:     true,
					MobileDock: true,
					Order:      10,
				},
			},
			SearchProvider: &plugin.SearchProviderContrib{
				Enabled:  true,
				Priority: 20,
			},
		},
	}
}

func (p *Plugin) Init(host plugin.Host) error {
	p.host = host
	host.Schedule(5*time.Minute, func(ctx context.Context) {
		p.cleanupExpiredClips()
	})
	return nil
}

func (p *Plugin) RegisterRoutes(r plugin.RouteGroup) {
	r.HandleAuth("GET /clips", p.handleListClips)
	r.HandleAuth("POST /clips", p.handleCreateClip)
	r.HandleAuth("POST /clips/image", p.handleUploadClipImage)
	r.HandleAuth("GET /clips/image/{name}", p.handleServeClipImage)
	r.HandleAuth("PATCH /clips/{id}", p.handlePatchClip)
	r.HandleAuth("DELETE /clips/{id}", p.handleDeleteClip)

	r.HandleCompat("GET /api/clips", p.handleListClips, true)
	r.HandleCompat("POST /api/clips", p.handleCreateClip, true)
	r.HandleCompat("POST /api/clips/image", p.handleUploadClipImage, true)
	r.HandleCompat("GET /api/clips/image/{name}", p.handleServeClipImage, true)
	r.HandleCompat("PATCH /api/clips/{id}", p.handlePatchClip, true)
	r.HandleCompat("DELETE /api/clips/{id}", p.handleDeleteClip, true)
}

func (p *Plugin) cleanupExpiredClips() {
	now := time.Now().UTC()
	cRows, err := p.host.DB().Query(`SELECT id, image_path FROM clips WHERE expires_at IS NOT NULL AND expires_at <= ?`, now)
	if err != nil {
		return
	}
	type item struct {
		id  int64
		img string
	}
	var list []item
	for cRows.Next() {
		var it item
		if err := cRows.Scan(&it.id, &it.img); err == nil {
			list = append(list, it)
		}
	}
	cRows.Close()
	for _, it := range list {
		if it.img != "" {
			_ = os.Remove(filepath.Join(p.host.Config().DataDir, "clips", filepath.Base(it.img)))
		}
		_, _ = p.host.DB().Exec(`DELETE FROM clips WHERE id = ?`, it.id)
	}
}

func (p *Plugin) handleListClips(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	now := time.Now().UTC()
	shareOwner := p.host.Auth().SharedOwnerID(u, "clips")

	var (
		rows *sql.Rows
		err  error
	)
	if shareOwner > 0 && shareOwner != u.ID {
		rows, err = p.host.DB().Query(
			`SELECT id, user_id, kind, content, image_path, device, pinned, expires_at, created_at
			 FROM clips
			 WHERE user_id IN (?, ?) AND (expires_at IS NULL OR expires_at > ?)
			 ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, pinned DESC, id DESC LIMIT 120`,
			u.ID, shareOwner, now, u.ID,
		)
	} else {
		rows, err = p.host.DB().Query(
			`SELECT id, user_id, kind, content, image_path, device, pinned, expires_at, created_at
			 FROM clips
			 WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)
			 ORDER BY pinned DESC, id DESC LIMIT 100`,
			u.ID, now,
		)
	}
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()

	clips := make([]db.Clip, 0)
	for rows.Next() {
		var c db.Clip
		var pinnedInt int
		var exp sql.NullTime
		if err := rows.Scan(&c.ID, &c.UserID, &c.Kind, &c.Content, &c.ImagePath, &c.Device, &pinnedInt, &exp, &c.CreatedAt); err == nil {
			c.Pinned = pinnedInt == 1
			c.Shared = c.UserID != u.ID
			if exp.Valid {
				t := exp.Time
				c.ExpiresAt = &t
			}
			clips = append(clips, c)
		}
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"clips": clips})
}

func (p *Plugin) notifyClipCreated(userID int64, clip db.Clip, senderPeerID, targetPeerID string) {
	if targetPeerID != "" {
		// Notify ONLY the target client
		p.host.Hub().SendToPeer(userID, targetPeerID, "clip_updated", map[string]any{
			"action":         "created",
			"id":             clip.ID,
			"clip":           clip,
			"notify":         true,
			"sender_peer_id": senderPeerID,
			"target_peer_id": targetPeerID,
		})
		// Silently sync other clients (excluding sender and target) without popping notifications
		p.host.Hub().BroadcastUserExcept(userID, []string{targetPeerID, senderPeerID}, "clip_updated", map[string]any{
			"action":         "synced",
			"id":             clip.ID,
			"notify":         false,
			"sender_peer_id": senderPeerID,
			"target_peer_id": targetPeerID,
		})
		return
	}
	// Default: broadcast to all OTHER connected clients of this user (never notify the sender itself)
	p.host.Hub().BroadcastUserExcept(userID, []string{senderPeerID}, "clip_updated", map[string]any{
		"action":         "created",
		"id":             clip.ID,
		"clip":           clip,
		"notify":         true,
		"sender_peer_id": senderPeerID,
	})
}

func (p *Plugin) handleCreateClip(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	var req struct {
		Kind         string `json:"kind"`
		Content      string `json:"content"`
		Device       string `json:"device"`
		TTLHours     int    `json:"ttl_hours"`
		TargetPeerID string `json:"target_peer_id"`
		SenderPeerID string `json:"sender_peer_id"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	senderPeerID := plugin.FirstNonEmpty(r.Header.Get("X-Orbit-Peer-Id"), req.SenderPeerID)
	targetPeerID := plugin.FirstNonEmpty(req.TargetPeerID, r.Header.Get("X-Orbit-Target-Peer-Id"))
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "content required")
		return
	}
	kind := req.Kind
	if kind == "" {
		if strings.HasPrefix(req.Content, "http://") || strings.HasPrefix(req.Content, "https://") {
			kind = "link"
		} else {
			kind = "text"
		}
	}
	zone, _ := p.host.Network().DetectZone(r)
	device := strings.TrimSpace(req.Device)
	if device == "" {
		device = strings.ToUpper(zone)
	}

	var exp *time.Time
	if req.TTLHours > 0 {
		t := time.Now().UTC().Add(time.Duration(req.TTLHours) * time.Hour)
		exp = &t
	} else if req.TTLHours == 0 {
		t := time.Now().UTC().Add(7 * 24 * time.Hour)
		exp = &t
	}

	now := time.Now().UTC()
	res, err := p.host.DB().Exec(
		`INSERT INTO clips (user_id, kind, content, image_path, device, pinned, expires_at, created_at)
		 VALUES (?, ?, ?, '', ?, 0, ?, ?)`,
		u.ID, kind, req.Content, device, exp, now,
	)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "failed to create clip")
		return
	}
	id, _ := res.LastInsertId()
	clip := db.Clip{
		ID: id, UserID: u.ID, Kind: kind, Content: req.Content,
		Device: device, ExpiresAt: exp, CreatedAt: now,
	}
	p.notifyClipCreated(u.ID, clip, senderPeerID, targetPeerID)
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{"clip": clip})
}

func (p *Plugin) handleUploadClipImage(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	const maxClipImg = 10 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxClipImg+1024)
	if err := r.ParseMultipartForm(maxClipImg); err != nil {
		plugin.WriteErr(w, http.StatusRequestEntityTooLarge, "clip image exceeds 10MB")
		return
	}
	file, hdr, err := r.FormFile("image")
	if err != nil {
		file, hdr, err = r.FormFile("file")
	}
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "image file required")
		return
	}
	defer file.Close()

	head := make([]byte, 512)
	n, _ := io.ReadFull(file, head)
	mimeType := http.DetectContentType(head[:n])
	if !strings.HasPrefix(mimeType, "image/") {
		plugin.WriteErr(w, http.StatusBadRequest, "only image uploads are allowed")
		return
	}

	ext := filepath.Ext(hdr.Filename)
	if ext == "" {
		switch mimeType {
		case "image/png":
			ext = ".png"
		case "image/webp":
			ext = ".webp"
		case "image/gif":
			ext = ".gif"
		default:
			ext = ".jpg"
		}
	}
	randBuf := make([]byte, 12)
	_, _ = rand.Read(randBuf)
	fileName := hex.EncodeToString(randBuf) + ext
	dstPath := filepath.Join(p.host.Config().DataDir, "clips", fileName)
	dst, err := os.Create(dstPath)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "failed to store image")
		return
	}
	defer dst.Close()

	if _, err := dst.Write(head[:n]); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "write error")
		return
	}
	written, err := io.Copy(dst, file)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "write error")
		return
	}

	zone, _ := p.host.Network().DetectZone(r)
	device := strings.TrimSpace(r.FormValue("device"))
	if device == "" {
		device = strings.ToUpper(zone)
	}
	totalKB := (int64(n) + written) / 1024
	caption := strings.TrimSpace(hdr.Filename)
	if caption == "" {
		caption = "截图"
	}
	content := caption + " (" + strconv.FormatInt(totalKB, 10) + " KB)"
	imgURL := "/api/clips/image/" + fileName
	now := time.Now().UTC()
	exp := now.Add(7 * 24 * time.Hour)

	res, err := p.host.DB().Exec(
		`INSERT INTO clips (user_id, kind, content, image_path, device, pinned, expires_at, created_at)
		 VALUES (?, 'image', ?, ?, ?, 0, ?, ?)`,
		u.ID, content, imgURL, device, exp, now,
	)
	if err != nil {
		_ = os.Remove(dstPath)
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	id, _ := res.LastInsertId()
	clip := db.Clip{
		ID: id, UserID: u.ID, Kind: "image", Content: content,
		ImagePath: imgURL, Device: device, ExpiresAt: &exp, CreatedAt: now,
	}
	senderPeerID := plugin.FirstNonEmpty(r.Header.Get("X-Orbit-Peer-Id"), r.FormValue("sender_peer_id"))
	targetPeerID := plugin.FirstNonEmpty(r.FormValue("target_peer_id"), r.Header.Get("X-Orbit-Target-Peer-Id"))
	p.notifyClipCreated(u.ID, clip, senderPeerID, targetPeerID)
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{"clip": clip})
}

func (p *Plugin) handleServeClipImage(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	name := filepath.Base(r.PathValue("name"))
	if name == "" || name == "." || strings.Contains(name, "..") {
		http.NotFound(w, r)
		return
	}
	var exists int64
	imgURL := "/api/clips/image/" + name
	err := p.host.DB().QueryRow(`SELECT id FROM clips WHERE user_id = ? AND image_path = ?`, u.ID, imgURL).Scan(&exists)
	if err != nil {
		if ownerID := p.host.Auth().SharedOwnerID(u, "clips"); ownerID > 0 {
			err = p.host.DB().QueryRow(`SELECT id FROM clips WHERE user_id = ? AND image_path = ?`, ownerID, imgURL).Scan(&exists)
		}
	}
	if err != nil {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(p.host.Config().DataDir, "clips", name))
}

func (p *Plugin) handlePatchClip(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid clip id")
		return
	}
	var req struct {
		Pinned *bool `json:"pinned"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil || req.Pinned == nil {
		plugin.WriteErr(w, http.StatusBadRequest, "pinned boolean required")
		return
	}
	pinVal := 0
	if *req.Pinned {
		pinVal = 1
	}
	res, err := p.host.DB().Exec(`UPDATE clips SET pinned = ? WHERE id = ? AND user_id = ?`, pinVal, id, u.ID)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		plugin.WriteErr(w, http.StatusNotFound, "clip not found")
		return
	}
	p.host.Hub().BroadcastUser(u.ID, "clip_updated", map[string]any{"action": "patched", "id": id})
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (p *Plugin) handleDeleteClip(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid clip id")
		return
	}
	var imgPath string
	_ = p.host.DB().QueryRow(`SELECT image_path FROM clips WHERE id = ? AND user_id = ?`, id, u.ID).Scan(&imgPath)
	_, _ = p.host.DB().Exec(`DELETE FROM shares WHERE kind = 'clip' AND target_id = ? AND user_id = ?`, id, u.ID)
	res, err := p.host.DB().Exec(`DELETE FROM clips WHERE id = ? AND user_id = ?`, id, u.ID)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		plugin.WriteErr(w, http.StatusNotFound, "clip not found")
		return
	}
	if imgPath != "" {
		_ = os.Remove(filepath.Join(p.host.Config().DataDir, "clips", filepath.Base(imgPath)))
	}
	p.host.Hub().BroadcastUser(u.ID, "clip_updated", map[string]any{"action": "deleted", "id": id})
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}
