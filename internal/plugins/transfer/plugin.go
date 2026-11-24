package transfer

import (
	"bufio"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"orbit/internal/db"
	"orbit/internal/plugin"
)

const shareAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

type Plugin struct {
	host plugin.Host
}

func New() *Plugin { return &Plugin{} }

func (p *Plugin) Manifest() plugin.Manifest {
	return plugin.Manifest{
		ID:             "orbit.transfer",
		Name:           "极速快传",
		Version:        "1.0.0",
		Description:    "局域网 WebRTC P2P 直传、三网限额文件暂存箱与 6 位阅后即焚取件码",
		Icon:           "upload-cloud",
		Tier:           "builtin",
		DefaultEnabled: true,
		Access: plugin.AccessSpec{
			MinRole: "user",
			Guest: plugin.GuestSpec{
				Mode:   "login-prompt",
				Prompt: "文件上传与快传需要登录后使用（访客支持输入取件码提取）",
			},
			Sharing: &plugin.SharingSpec{
				Shareable:     true,
				ScopeKey:      "files",
				Label:         "文件",
				DefaultShared: false,
				Mode:          "readonly",
			},
			Permissions: []string{"storage", "ws", "net:zone"},
		},
		Contributes: plugin.ContributesSpec{
			Drawers: []plugin.DrawerContrib{
				{
					ID:         "files",
					Title:      "快传",
					Icon:       "upload-cloud",
					Shortcut:   "f",
					TopBar:     true,
					MobileDock: true,
					Order:      20,
				},
			},
			SearchProvider: &plugin.SearchProviderContrib{
				Enabled:  true,
				Priority: 30,
			},
			DropHandler: &plugin.DropHandlerContrib{
				Accept:   "files",
				Priority: 10,
			},
		},
	}
}

func (p *Plugin) Init(host plugin.Host) error {
	p.host = host
	host.Schedule(5*time.Minute, func(ctx context.Context) {
		p.cleanupExpired()
	})
	return nil
}

func (p *Plugin) RegisterRoutes(r plugin.RouteGroup) {
	r.HandleAuth("GET /files", p.handleListFiles)
	r.HandleAuth("POST /files", p.handleUploadFile)
	r.HandleAuth("GET /files/{id}/download", p.handleDownloadFile)
	r.HandleAuth("DELETE /files/{id}", p.handleDeleteFile)
	r.HandleAuth("POST /shares", p.handleCreateShare)
	r.Handle("GET /public/share/{code}", p.handlePublicShareMeta)
	r.Handle("GET /public/share/{code}/download", p.handlePublicShareDownload)

	r.HandleCompat("GET /api/files", p.handleListFiles, true)
	r.HandleCompat("POST /api/files", p.handleUploadFile, true)
	r.HandleCompat("GET /api/files/{id}/download", p.handleDownloadFile, true)
	r.HandleCompat("DELETE /api/files/{id}", p.handleDeleteFile, true)
	r.HandleCompat("POST /api/shares", p.handleCreateShare, true)
	r.HandleCompat("GET /api/public/share/{code}", p.handlePublicShareMeta, false)
	r.HandleCompat("GET /api/public/share/{code}/download", p.handlePublicShareDownload, false)
}

func (p *Plugin) cleanupExpired() {
	now := time.Now().UTC()
	rows, err := p.host.DB().Query(`SELECT id, stored_name FROM staged_files WHERE expires_at <= ?`, now)
	if err == nil {
		type item struct {
			id   int64
			name string
		}
		var list []item
		for rows.Next() {
			var it item
			if err := rows.Scan(&it.id, &it.name); err == nil {
				list = append(list, it)
			}
		}
		rows.Close()
		for _, it := range list {
			_ = os.Remove(filepath.Join(p.host.Config().DataDir, "uploads", it.name))
			if _, err := p.host.DB().Exec(`DELETE FROM staged_files WHERE id = ?`, it.id); err != nil {
				log.Printf("cleanup staged_file %d: %v", it.id, err)
			}
		}
	}
	_, _ = p.host.DB().Exec(`DELETE FROM shares WHERE expires_at <= ?`, now)
}

func (p *Plugin) handleListFiles(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	now := time.Now().UTC()
	zone, _ := p.host.Network().DetectZone(r)
	zoneLimitBytes := p.host.Network().MaxUploadBytes(zone)
	shareOwner := p.host.Auth().SharedOwnerID(u, "files")

	var (
		rows *sql.Rows
		err  error
	)
	if shareOwner > 0 && shareOwner != u.ID {
		rows, err = p.host.DB().Query(
			`SELECT id, user_id, orig_name, stored_name, mime_type, size_bytes, zone, uploader, expires_at, created_at
			 FROM staged_files WHERE user_id IN (?, ?) AND expires_at > ?
			 ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, id DESC`,
			u.ID, shareOwner, now, u.ID,
		)
	} else {
		rows, err = p.host.DB().Query(
			`SELECT id, user_id, orig_name, stored_name, mime_type, size_bytes, zone, uploader, expires_at, created_at
			 FROM staged_files WHERE user_id = ? AND expires_at > ? ORDER BY id DESC`,
			u.ID, now,
		)
	}
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()

	files := make([]db.StagedFile, 0)
	for rows.Next() {
		var f db.StagedFile
		if err := rows.Scan(&f.ID, &f.UserID, &f.OrigName, &f.StoredName, &f.MimeType, &f.SizeBytes, &f.Zone, &f.Uploader, &f.ExpiresAt, &f.CreatedAt); err == nil {
			f.Shared = f.UserID != u.ID
			files = append(files, f)
		}
	}

	var totalUsed int64
	_ = p.host.DB().QueryRow(`SELECT COALESCE(SUM(size_bytes), 0) FROM staged_files`).Scan(&totalUsed)

	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"files":            files,
		"storage_used":     totalUsed,
		"storage_limit":    p.host.Config().MaxStorageMB << 20,
		"detected_zone":    zone,
		"zone_limit_bytes": zoneLimitBytes,
		"zone_limit_mb":    zoneLimitBytes >> 20,
	})
}

func (p *Plugin) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	zone, _ := p.host.Network().DetectZone(r)
	maxBytes := p.host.Network().MaxUploadBytes(zone)
	limitMB := maxBytes >> 20

	if r.ContentLength > maxBytes+(2<<20) {
		plugin.WriteJSON(w, http.StatusRequestEntityTooLarge, map[string]any{
			"error":    fmt.Sprintf("file exceeds %s upload limit of %d MB", zone, limitMB),
			"zone":     zone,
			"limit_mb": limitMB,
		})
		return
	}

	mr, err := r.MultipartReader()
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "multipart/form-data required")
		return
	}

	ttlHours := 24
	uploader := strings.ToUpper(zone)
	var savedName, origName, mimeType string
	var savedSize int64

	cleanupSaved := func() {
		if savedName != "" {
			_ = os.Remove(filepath.Join(p.host.Config().DataDir, "uploads", savedName))
			savedName = ""
		}
	}

	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			cleanupSaved()
			plugin.WriteErr(w, http.StatusBadRequest, "invalid multipart stream")
			return
		}

		formName := part.FormName()
		if formName == "ttl_hours" {
			b, _ := io.ReadAll(io.LimitReader(part, 32))
			if h, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && h > 0 && h <= 24*30 {
				ttlHours = h
			}
			_ = part.Close()
			continue
		}
		if formName == "uploader" {
			b, _ := io.ReadAll(io.LimitReader(part, 128))
			if v := strings.TrimSpace(string(b)); v != "" {
				uploader = v
			}
			_ = part.Close()
			continue
		}

		if (formName == "file" || part.FileName() != "") && savedName == "" {
			origName = filepath.Base(strings.TrimSpace(part.FileName()))
			if origName == "" || origName == "." {
				origName = "upload.bin"
			}
			mimeType = part.Header.Get("Content-Type")
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}

			var randBuf [16]byte
			_, _ = rand.Read(randBuf[:])
			storedName := hex.EncodeToString(randBuf[:]) + filepath.Ext(origName)
			dstPath := filepath.Join(p.host.Config().DataDir, "uploads", storedName)
			dst, err := os.Create(dstPath)
			if err != nil {
				_ = part.Close()
				plugin.WriteErr(w, http.StatusInternalServerError, "failed to create target file")
				return
			}

			bw := bufio.NewWriterSize(dst, 1<<20)
			copyBuf := make([]byte, 1<<20)
			n, copyErr := io.CopyBuffer(bw, io.LimitReader(part, maxBytes+1), copyBuf)
			flushErr := bw.Flush()
			closeErr := dst.Close()
			_ = part.Close()
			if copyErr == nil && flushErr != nil {
				copyErr = flushErr
			}
			if copyErr == nil && closeErr != nil {
				copyErr = closeErr
			}

			if copyErr != nil {
				_ = os.Remove(dstPath)
				plugin.WriteErr(w, http.StatusInternalServerError, "failed to stream upload")
				return
			}
			if n > maxBytes {
				_ = os.Remove(dstPath)
				plugin.WriteJSON(w, http.StatusRequestEntityTooLarge, map[string]any{
					"error":    fmt.Sprintf("file exceeds %s upload limit of %d MB", zone, limitMB),
					"zone":     zone,
					"limit_mb": limitMB,
				})
				return
			}
			savedName = storedName
			savedSize = n
			continue
		}
		_ = part.Close()
	}

	if savedName == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "file part missing")
		return
	}

	var totalUsed int64
	_ = p.host.DB().QueryRow(`SELECT COALESCE(SUM(size_bytes), 0) FROM staged_files`).Scan(&totalUsed)
	if totalUsed+savedSize > (p.host.Config().MaxStorageMB << 20) {
		cleanupSaved()
		plugin.WriteErr(w, http.StatusInsufficientStorage, "total staging storage quota exceeded")
		return
	}

	now := time.Now().UTC()
	exp := now.Add(time.Duration(ttlHours) * time.Hour)
	res, err := p.host.DB().Exec(
		`INSERT INTO staged_files (user_id, orig_name, stored_name, mime_type, size_bytes, zone, uploader, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, origName, savedName, mimeType, savedSize, zone, uploader, exp, now,
	)
	if err != nil {
		cleanupSaved()
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	id, _ := res.LastInsertId()
	staged := db.StagedFile{
		ID: id, UserID: u.ID, OrigName: origName, MimeType: mimeType,
		SizeBytes: savedSize, Zone: zone, Uploader: uploader, ExpiresAt: exp, CreatedAt: now,
	}
	p.host.Hub().BroadcastUser(u.ID, "files_updated", map[string]any{
		"action": "created",
		"id":     id,
		"file":   staged,
	})
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{"file": staged})
}

func (p *Plugin) handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid file id")
		return
	}
	var origName, storedName, mimeType string
	var exp time.Time
	err = p.host.DB().QueryRow(
		`SELECT orig_name, stored_name, mime_type, expires_at FROM staged_files WHERE id = ? AND user_id = ?`,
		id, u.ID,
	).Scan(&origName, &storedName, &mimeType, &exp)
	if err != nil {
		if ownerID := p.host.Auth().SharedOwnerID(u, "files"); ownerID > 0 {
			err = p.host.DB().QueryRow(
				`SELECT orig_name, stored_name, mime_type, expires_at FROM staged_files WHERE id = ? AND user_id = ?`,
				id, ownerID,
			).Scan(&origName, &storedName, &mimeType, &exp)
		}
	}
	if err != nil || time.Now().UTC().After(exp) {
		plugin.WriteErr(w, http.StatusNotFound, "file not found or expired")
		return
	}
	fullPath := filepath.Join(p.host.Config().DataDir, "uploads", storedName)
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, strings.ReplaceAll(origName, `"`, "")))
	http.ServeFile(w, r, fullPath)
}

func (p *Plugin) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid file id")
		return
	}
	var storedName string
	if err := p.host.DB().QueryRow(`SELECT stored_name FROM staged_files WHERE id = ? AND user_id = ?`, id, u.ID).Scan(&storedName); err != nil {
		plugin.WriteErr(w, http.StatusNotFound, "file not found")
		return
	}
	_, _ = p.host.DB().Exec(`DELETE FROM shares WHERE kind = 'file' AND target_id = ? AND user_id = ?`, id, u.ID)
	if _, err := p.host.DB().Exec(`DELETE FROM staged_files WHERE id = ? AND user_id = ?`, id, u.ID); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	_ = os.Remove(filepath.Join(p.host.Config().DataDir, "uploads", storedName))
	p.host.Hub().BroadcastUser(u.ID, "files_updated", map[string]any{"action": "deleted", "id": id})
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func randomShareCode(length int) (string, error) {
	out := make([]byte, length)
	max := big.NewInt(int64(len(shareAlphabet)))
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = shareAlphabet[n.Int64()]
	}
	return string(out), nil
}

func (p *Plugin) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	var req struct {
		Kind          string `json:"kind"`
		TargetID      int64  `json:"target_id"`
		TTLMinutes    int    `json:"ttl_minutes"`
		BurnAfterRead bool   `json:"burn_after_read"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Kind != "file" && req.Kind != "clip" {
		plugin.WriteErr(w, http.StatusBadRequest, "kind must be file or clip")
		return
	}
	var exists int64
	if req.Kind == "file" {
		if err := p.host.DB().QueryRow(`SELECT id FROM staged_files WHERE id = ? AND user_id = ?`, req.TargetID, u.ID).Scan(&exists); err != nil {
			plugin.WriteErr(w, http.StatusNotFound, "staged file not found")
			return
		}
	} else {
		if err := p.host.DB().QueryRow(`SELECT id FROM clips WHERE id = ? AND user_id = ?`, req.TargetID, u.ID).Scan(&exists); err != nil {
			plugin.WriteErr(w, http.StatusNotFound, "clip not found")
			return
		}
	}

	if req.TTLMinutes <= 0 {
		req.TTLMinutes = 60
	}
	if req.TTLMinutes > 7*24*60 {
		req.TTLMinutes = 7 * 24 * 60
	}

	var code string
	var err error
	for attempt := 0; attempt < 5; attempt++ {
		code, err = randomShareCode(6)
		if err != nil {
			plugin.WriteErr(w, http.StatusInternalServerError, "code gen error")
			return
		}
		var dup string
		if p.host.DB().QueryRow(`SELECT code FROM shares WHERE code = ?`, code).Scan(&dup) == sql.ErrNoRows {
			break
		}
	}

	now := time.Now().UTC()
	exp := now.Add(time.Duration(req.TTLMinutes) * time.Minute)
	burnInt := 0
	if req.BurnAfterRead {
		burnInt = 1
	}
	if _, err := p.host.DB().Exec(
		`INSERT INTO shares (code, user_id, kind, target_id, burn_after_read, used_count, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
		code, u.ID, req.Kind, req.TargetID, burnInt, exp, now,
	); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}

	plugin.WriteJSON(w, http.StatusCreated, map[string]any{
		"code": code, "kind": req.Kind, "url": "/s/" + code,
		"burn_after_read": req.BurnAfterRead, "expires_at": exp,
	})
}

func (p *Plugin) handlePublicShareMeta(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	if code == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "code required")
		return
	}
	var userID, targetID int64
	var kind string
	var burnInt, usedCount int
	var exp time.Time
	err := p.host.DB().QueryRow(
		`SELECT user_id, kind, target_id, burn_after_read, used_count, expires_at FROM shares WHERE code = ?`,
		code,
	).Scan(&userID, &kind, &targetID, &burnInt, &usedCount, &exp)
	if err != nil || time.Now().UTC().After(exp) {
		plugin.WriteErr(w, http.StatusNotFound, "share code not found or expired")
		return
	}
	burn := burnInt == 1

	if kind == "clip" {
		var cKind, content, imgPath string
		if err := p.host.DB().QueryRow(`SELECT kind, content, image_path FROM clips WHERE id = ? AND user_id = ?`, targetID, userID).Scan(&cKind, &content, &imgPath); err != nil {
			plugin.WriteErr(w, http.StatusNotFound, "clip no longer exists")
			return
		}
		if burn {
			_, _ = p.host.DB().Exec(`DELETE FROM shares WHERE code = ?`, code)
		} else {
			_, _ = p.host.DB().Exec(`UPDATE shares SET used_count = used_count + 1 WHERE code = ?`, code)
		}
		plugin.WriteJSON(w, http.StatusOK, map[string]any{
			"code": code, "kind": "clip", "clip_kind": cKind, "content": content,
			"burn_after_read": burn, "expires_at": exp,
		})
		return
	}

	var origName, mimeType string
	var sizeBytes int64
	var fileExp time.Time
	err = p.host.DB().QueryRow(
		`SELECT orig_name, mime_type, size_bytes, expires_at FROM staged_files WHERE id = ? AND user_id = ?`,
		targetID, userID,
	).Scan(&origName, &mimeType, &sizeBytes, &fileExp)
	if err != nil || time.Now().UTC().After(fileExp) {
		plugin.WriteErr(w, http.StatusNotFound, "file no longer exists")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"code": code, "kind": "file", "file_name": origName, "mime_type": mimeType,
		"size_bytes": sizeBytes, "burn_after_read": burn, "expires_at": exp,
		"download_url": "/api/public/share/" + code + "/download",
	})
}

func (p *Plugin) handlePublicShareDownload(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	if code == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "code required")
		return
	}
	var userID, targetID int64
	var kind string
	var burnInt int
	var exp time.Time
	err := p.host.DB().QueryRow(
		`SELECT user_id, kind, target_id, burn_after_read, expires_at FROM shares WHERE code = ?`,
		code,
	).Scan(&userID, &kind, &targetID, &burnInt, &exp)
	if err != nil || time.Now().UTC().After(exp) || kind != "file" {
		plugin.WriteErr(w, http.StatusNotFound, "share code not found or expired")
		return
	}

	var origName, storedName, mimeType string
	var sizeBytes int64
	var fileExp time.Time
	err = p.host.DB().QueryRow(
		`SELECT orig_name, stored_name, mime_type, size_bytes, expires_at FROM staged_files WHERE id = ? AND user_id = ?`,
		targetID, userID,
	).Scan(&origName, &storedName, &mimeType, &sizeBytes, &fileExp)
	if err != nil || time.Now().UTC().After(fileExp) {
		plugin.WriteErr(w, http.StatusNotFound, "file no longer exists")
		return
	}

	fullPath := filepath.Join(p.host.Config().DataDir, "uploads", storedName)
	f, err := os.Open(fullPath)
	if err != nil {
		plugin.WriteErr(w, http.StatusNotFound, "file missing on disk")
		return
	}
	defer f.Close()

	if burnInt == 1 {
		res, err := p.host.DB().Exec(`DELETE FROM shares WHERE code = ?`, code)
		if err != nil {
			plugin.WriteErr(w, http.StatusInternalServerError, "database error")
			return
		}
		if aff, _ := res.RowsAffected(); aff == 0 {
			plugin.WriteErr(w, http.StatusNotFound, "share already consumed")
			return
		}
	} else {
		_, _ = p.host.DB().Exec(`UPDATE shares SET used_count = used_count + 1 WHERE code = ?`, code)
	}

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", sizeBytes))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, strings.ReplaceAll(origName, `"`, "")))
	copyBuf := make([]byte, 1<<20)
	_, _ = io.CopyBuffer(w, f, copyBuf)
}
