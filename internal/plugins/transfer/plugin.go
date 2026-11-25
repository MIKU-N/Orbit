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
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"orbit/internal/db"
	"orbit/internal/plugin"
)

const (
	shareAlphabet       = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	defaultChunkBytes   = 8 << 20 // 8 MB parallel raw binary chunk size
	uploadSessionMaxAge = 2 * time.Hour
)

var copyBufPool = sync.Pool{
	New: func() any {
		buf := make([]byte, 1<<20) // 1 MB reusable copy buffer
		return &buf
	},
}

type uploadSession struct {
	ID           string
	UserID       int64
	OrigName     string
	StoredName   string
	TempPath     string
	FinalPath    string
	MimeType     string
	TotalSize    int64
	Zone         string
	Uploader     string
	TTLHours     int
	Permanent    bool
	SenderPeerID string
	TargetPeerID string
	LastActivity time.Time
	File         *os.File
	Received     map[int64]int64
	mu           sync.Mutex
	closed       bool
}

type Plugin struct {
	host       plugin.Host
	sessionsMu sync.Mutex
	sessions   map[string]*uploadSession
}

func New() *Plugin {
	return &Plugin{
		sessions: make(map[string]*uploadSession),
	}
}

func (p *Plugin) Manifest() plugin.Manifest {
	return plugin.Manifest{
		ID:             "orbit.transfer",
		Name:           "极速快传",
		Version:        "1.0.0",
		Description:    "局域网 WebRTC P2P 直传、三网限额文件暂存箱与 6 位阅后即焚取件码",
		Icon:           "upload-cloud",
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
	r.HandleAuth("POST /files/upload/init", p.handleInitChunkedUpload)
	r.HandleAuth("PUT /files/upload/{id}/chunk", p.handleUploadChunk)
	r.HandleAuth("POST /files/upload/{id}/complete", p.handleCompleteChunkedUpload)
	r.HandleAuth("DELETE /files/upload/{id}", p.handleAbortChunkedUpload)
	r.HandleAuth("GET /files/{id}/download", p.handleDownloadFile)
	r.HandleAuth("PATCH /files/{id}", p.handlePatchFile)
	r.HandleAuth("DELETE /files/{id}", p.handleDeleteFile)
	r.HandleAuth("POST /files/batch-delete", p.handleBatchDeleteFiles)
	r.HandleAuth("POST /shares", p.handleCreateShare)
	r.Handle("GET /public/share/{code}", p.handlePublicShareMeta)
	r.Handle("GET /public/share/{code}/download", p.handlePublicShareDownload)

	r.HandleCompat("GET /api/files", p.handleListFiles, true)
	r.HandleCompat("POST /api/files", p.handleUploadFile, true)
	r.HandleCompat("POST /api/files/upload/init", p.handleInitChunkedUpload, true)
	r.HandleCompat("PUT /api/files/upload/{id}/chunk", p.handleUploadChunk, true)
	r.HandleCompat("POST /api/files/upload/{id}/complete", p.handleCompleteChunkedUpload, true)
	r.HandleCompat("DELETE /api/files/upload/{id}", p.handleAbortChunkedUpload, true)
	r.HandleCompat("GET /api/files/{id}/download", p.handleDownloadFile, true)
	r.HandleCompat("PATCH /api/files/{id}", p.handlePatchFile, true)
	r.HandleCompat("DELETE /api/files/{id}", p.handleDeleteFile, true)
	r.HandleCompat("POST /api/files/batch-delete", p.handleBatchDeleteFiles, true)
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

	// Clean up stale incomplete chunked upload sessions
	p.sessionsMu.Lock()
	var expired []*uploadSession
	for id, sess := range p.sessions {
		sess.mu.Lock()
		stale := time.Since(sess.LastActivity) > uploadSessionMaxAge
		sess.mu.Unlock()
		if stale {
			expired = append(expired, sess)
			delete(p.sessions, id)
		}
	}
	p.sessionsMu.Unlock()
	for _, sess := range expired {
		p.discardSession(sess)
	}
}

func (p *Plugin) discardSession(sess *uploadSession) {
	sess.mu.Lock()
	if !sess.closed {
		sess.closed = true
		if sess.File != nil {
			_ = sess.File.Close()
			sess.File = nil
		}
	}
	tempPath := sess.TempPath
	sess.mu.Unlock()
	if tempPath != "" {
		_ = os.Remove(tempPath)
	}
}

func (p *Plugin) handleInitChunkedUpload(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	zone, _ := p.host.Network().DetectZone(r)
	maxBytes := p.host.Network().MaxUploadBytes(zone)
	limitMB := int64(0)
	if maxBytes > 0 {
		limitMB = maxBytes >> 20
	}

	var req struct {
		FileName     string `json:"file_name"`
		Size         int64  `json:"size"`
		MimeType     string `json:"mime_type"`
		TTLHours     *int   `json:"ttl_hours"`
		Permanent    bool   `json:"permanent"`
		TargetPeerID string `json:"target_peer_id"`
		SenderPeerID string `json:"sender_peer_id"`
		Uploader     string `json:"uploader"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Size < 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid file size")
		return
	}
	if maxBytes > 0 && req.Size > maxBytes {
		plugin.WriteJSON(w, http.StatusRequestEntityTooLarge, map[string]any{
			"error":    fmt.Sprintf("file exceeds %s upload limit of %d MB", zone, limitMB),
			"zone":     zone,
			"limit_mb": limitMB,
		})
		return
	}

	if maxStorageMB := p.host.Config().MaxStorageMB; maxStorageMB > 0 {
		var totalUsed int64
		_ = p.host.DB().QueryRow(`SELECT COALESCE(SUM(size_bytes), 0) FROM staged_files`).Scan(&totalUsed)
		if totalUsed+req.Size > (maxStorageMB << 20) {
			plugin.WriteErr(w, http.StatusInsufficientStorage, "total staging storage quota exceeded")
			return
		}
	}

	origName := filepath.Base(strings.TrimSpace(req.FileName))
	if origName == "" || origName == "." || origName == ".." {
		origName = "upload.bin"
	}
	mimeType := strings.TrimSpace(req.MimeType)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	ttlHours := 24
	permanent := req.Permanent
	if req.TTLHours != nil {
		if *req.TTLHours <= 0 {
			permanent = true
		} else if *req.TTLHours <= 24*365 {
			ttlHours = *req.TTLHours
		}
	}
	uploader := strings.TrimSpace(req.Uploader)
	if uploader == "" {
		uploader = strings.ToUpper(zone)
	}
	senderPeerID := strings.TrimSpace(r.Header.Get("X-Orbit-Peer-Id"))
	if senderPeerID == "" {
		senderPeerID = strings.TrimSpace(req.SenderPeerID)
	}
	targetPeerID := strings.TrimSpace(r.Header.Get("X-Orbit-Target-Peer-Id"))
	if targetPeerID == "" {
		targetPeerID = strings.TrimSpace(req.TargetPeerID)
	}

	var idBuf, nameBuf [16]byte
	_, _ = rand.Read(idBuf[:])
	_, _ = rand.Read(nameBuf[:])
	uploadID := hex.EncodeToString(idBuf[:])
	storedName := hex.EncodeToString(nameBuf[:]) + filepath.Ext(origName)
	uploadsDir := filepath.Join(p.host.Config().DataDir, "uploads")
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "failed to prepare uploads dir")
		return
	}
	finalPath := filepath.Join(uploadsDir, storedName)
	tempPath := finalPath + ".part"

	f, err := os.OpenFile(tempPath, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0o644)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "failed to create upload target")
		return
	}
	if req.Size > 0 {
		if err := f.Truncate(req.Size); err != nil {
			_ = f.Close()
			_ = os.Remove(tempPath)
			plugin.WriteErr(w, http.StatusInsufficientStorage, "failed to allocate file space")
			return
		}
	}

	sess := &uploadSession{
		ID:           uploadID,
		UserID:       u.ID,
		OrigName:     origName,
		StoredName:   storedName,
		TempPath:     tempPath,
		FinalPath:    finalPath,
		MimeType:     mimeType,
		TotalSize:    req.Size,
		Zone:         zone,
		Uploader:     uploader,
		TTLHours:     ttlHours,
		Permanent:    permanent,
		SenderPeerID: senderPeerID,
		TargetPeerID: targetPeerID,
		LastActivity: time.Now(),
		File:         f,
		Received:     make(map[int64]int64),
	}

	p.sessionsMu.Lock()
	p.sessions[uploadID] = sess
	p.sessionsMu.Unlock()

	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"upload_id":  uploadID,
		"chunk_size": defaultChunkBytes,
	})
}

func (p *Plugin) handleUploadChunk(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	uploadID := strings.TrimSpace(r.PathValue("id"))
	offset, err := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	if err != nil || offset < 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid chunk offset")
		return
	}

	p.sessionsMu.Lock()
	sess := p.sessions[uploadID]
	p.sessionsMu.Unlock()
	if sess == nil || sess.UserID != u.ID {
		plugin.WriteErr(w, http.StatusNotFound, "upload session not found")
		return
	}

	sess.mu.Lock()
	if sess.closed || sess.File == nil {
		sess.mu.Unlock()
		plugin.WriteErr(w, http.StatusGone, "upload session closed")
		return
	}
	if offset > sess.TotalSize {
		sess.mu.Unlock()
		plugin.WriteErr(w, http.StatusBadRequest, "offset exceeds total file size")
		return
	}
	f := sess.File
	maxChunkRemain := sess.TotalSize - offset
	sess.LastActivity = time.Now()
	sess.mu.Unlock()

	bufPtr := copyBufPool.Get().(*[]byte)
	buf := *bufPtr
	defer copyBufPool.Put(bufPtr)

	reader := io.LimitReader(r.Body, maxChunkRemain+1)
	var written int64
	writeOff := offset
	for {
		nr, rErr := reader.Read(buf)
		if nr > 0 {
			if written+int64(nr) > maxChunkRemain {
				plugin.WriteErr(w, http.StatusRequestEntityTooLarge, "chunk exceeds declared file size")
				return
			}
			nw, wErr := f.WriteAt(buf[:nr], writeOff)
			written += int64(nw)
			writeOff += int64(nw)
			if wErr != nil {
				plugin.WriteErr(w, http.StatusInternalServerError, "disk write error")
				return
			}
			if nw != nr {
				plugin.WriteErr(w, http.StatusInternalServerError, "short disk write")
				return
			}
		}
		if rErr == io.EOF {
			break
		}
		if rErr != nil {
			plugin.WriteErr(w, http.StatusBadRequest, "chunk stream interrupted")
			return
		}
	}

	sess.mu.Lock()
	if !sess.closed {
		sess.Received[offset] = written
		sess.LastActivity = time.Now()
	}
	sess.mu.Unlock()

	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"offset":  offset,
		"written": written,
	})
}

func (p *Plugin) handleCompleteChunkedUpload(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	uploadID := strings.TrimSpace(r.PathValue("id"))

	p.sessionsMu.Lock()
	sess := p.sessions[uploadID]
	if sess != nil && sess.UserID == u.ID {
		delete(p.sessions, uploadID)
	}
	p.sessionsMu.Unlock()

	if sess == nil || sess.UserID != u.ID {
		plugin.WriteErr(w, http.StatusNotFound, "upload session not found")
		return
	}

	sess.mu.Lock()
	if sess.closed {
		sess.mu.Unlock()
		plugin.WriteErr(w, http.StatusGone, "upload session already closed")
		return
	}
	sess.closed = true
	f := sess.File
	sess.File = nil
	receivedCopy := make([][2]int64, 0, len(sess.Received))
	for off, ln := range sess.Received {
		receivedCopy = append(receivedCopy, [2]int64{off, off + ln})
	}
	sess.mu.Unlock()

	if f != nil {
		if err := f.Close(); err != nil {
			_ = os.Remove(sess.TempPath)
			plugin.WriteErr(w, http.StatusInternalServerError, "failed to flush uploaded file")
			return
		}
	}

	// Verify full contiguous range [0, TotalSize) was uploaded
	if sess.TotalSize > 0 {
		sort.Slice(receivedCopy, func(i, j int) bool { return receivedCopy[i][0] < receivedCopy[j][0] })
		var covered int64
		for _, seg := range receivedCopy {
			if seg[0] > covered {
				break
			}
			if seg[1] > covered {
				covered = seg[1]
			}
		}
		if covered < sess.TotalSize {
			_ = os.Remove(sess.TempPath)
			plugin.WriteErr(w, http.StatusBadRequest, "incomplete upload chunks")
			return
		}
	}

	if err := os.Rename(sess.TempPath, sess.FinalPath); err != nil {
		_ = os.Remove(sess.TempPath)
		plugin.WriteErr(w, http.StatusInternalServerError, "failed to finalize uploaded file")
		return
	}

	if maxStorageMB := p.host.Config().MaxStorageMB; maxStorageMB > 0 {
		var totalUsed int64
		_ = p.host.DB().QueryRow(`SELECT COALESCE(SUM(size_bytes), 0) FROM staged_files`).Scan(&totalUsed)
		if totalUsed+sess.TotalSize > (maxStorageMB << 20) {
			_ = os.Remove(sess.FinalPath)
			plugin.WriteErr(w, http.StatusInsufficientStorage, "total staging storage quota exceeded")
			return
		}
	}

	now := time.Now().UTC()
	exp := now.Add(time.Duration(sess.TTLHours) * time.Hour)
	if sess.Permanent {
		exp = time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)
	}
	res, err := p.host.DB().Exec(
		`INSERT INTO staged_files (user_id, orig_name, stored_name, mime_type, size_bytes, zone, uploader, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, sess.OrigName, sess.StoredName, sess.MimeType, sess.TotalSize, sess.Zone, sess.Uploader, exp, now,
	)
	if err != nil {
		_ = os.Remove(sess.FinalPath)
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	id, _ := res.LastInsertId()
	staged := db.StagedFile{
		ID: id, UserID: u.ID, OrigName: sess.OrigName, MimeType: sess.MimeType,
		SizeBytes: sess.TotalSize, Zone: sess.Zone, Uploader: sess.Uploader, ExpiresAt: exp, CreatedAt: now,
	}
	p.notifyFileCreated(u.ID, staged, sess.SenderPeerID, sess.TargetPeerID)
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{"file": staged})
}

func (p *Plugin) handleAbortChunkedUpload(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	uploadID := strings.TrimSpace(r.PathValue("id"))

	p.sessionsMu.Lock()
	sess := p.sessions[uploadID]
	if sess != nil && sess.UserID == u.ID {
		delete(p.sessions, uploadID)
	}
	p.sessionsMu.Unlock()

	if sess != nil && sess.UserID == u.ID {
		p.discardSession(sess)
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
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

	storageLimit := int64(0)
	if p.host.Config().MaxStorageMB > 0 {
		storageLimit = p.host.Config().MaxStorageMB << 20
	}
	zoneLimitMB := int64(0)
	if zoneLimitBytes > 0 {
		zoneLimitMB = zoneLimitBytes >> 20
	}

	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"files":            files,
		"storage_used":     totalUsed,
		"storage_limit":    storageLimit,
		"detected_zone":    zone,
		"zone_limit_bytes": zoneLimitBytes,
		"zone_limit_mb":    zoneLimitMB,
	})
}

func (p *Plugin) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	zone, _ := p.host.Network().DetectZone(r)
	maxBytes := p.host.Network().MaxUploadBytes(zone)
	limitMB := int64(0)
	if maxBytes > 0 {
		limitMB = maxBytes >> 20
		if r.ContentLength > maxBytes+(2<<20) {
			plugin.WriteJSON(w, http.StatusRequestEntityTooLarge, map[string]any{
				"error":    fmt.Sprintf("file exceeds %s upload limit of %d MB", zone, limitMB),
				"zone":     zone,
				"limit_mb": limitMB,
			})
			return
		}
	}

	mr, err := r.MultipartReader()
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "multipart/form-data required")
		return
	}

	ttlHours := 24
	permanent := false
	uploader := strings.ToUpper(zone)
	senderPeerID := strings.TrimSpace(r.Header.Get("X-Orbit-Peer-Id"))
	targetPeerID := strings.TrimSpace(r.Header.Get("X-Orbit-Target-Peer-Id"))
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
			if h, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil {
				if h <= 0 {
					permanent = true
				} else if h <= 24*365 {
					ttlHours = h
					permanent = false
				}
			}
			_ = part.Close()
			continue
		}
		if formName == "permanent" {
			b, _ := io.ReadAll(io.LimitReader(part, 16))
			v := strings.ToLower(strings.TrimSpace(string(b)))
			if v == "1" || v == "true" {
				permanent = true
			}
			_ = part.Close()
			continue
		}
		if formName == "target_peer_id" {
			b, _ := io.ReadAll(io.LimitReader(part, 128))
			if v := strings.TrimSpace(string(b)); v != "" {
				targetPeerID = v
			}
			_ = part.Close()
			continue
		}
		if formName == "sender_peer_id" {
			b, _ := io.ReadAll(io.LimitReader(part, 128))
			if v := strings.TrimSpace(string(b)); v != "" && senderPeerID == "" {
				senderPeerID = v
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
			uploadsDir := filepath.Join(p.host.Config().DataDir, "uploads")
			if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
				_ = part.Close()
				plugin.WriteErr(w, http.StatusInternalServerError, "failed to prepare uploads dir")
				return
			}
			dstPath := filepath.Join(uploadsDir, storedName)
			dst, err := os.Create(dstPath)
			if err != nil {
				_ = part.Close()
				plugin.WriteErr(w, http.StatusInternalServerError, "failed to create target file")
				return
			}

			bw := bufio.NewWriterSize(dst, 1<<20)
			copyBuf := make([]byte, 1<<20)
			var reader io.Reader = part
			if maxBytes > 0 {
				reader = io.LimitReader(part, maxBytes+1)
			}
			n, copyErr := io.CopyBuffer(bw, reader, copyBuf)
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
			if maxBytes > 0 && n > maxBytes {
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

	if maxStorageMB := p.host.Config().MaxStorageMB; maxStorageMB > 0 {
		var totalUsed int64
		_ = p.host.DB().QueryRow(`SELECT COALESCE(SUM(size_bytes), 0) FROM staged_files`).Scan(&totalUsed)
		if totalUsed+savedSize > (maxStorageMB << 20) {
			cleanupSaved()
			plugin.WriteErr(w, http.StatusInsufficientStorage, "total staging storage quota exceeded")
			return
		}
	}

	now := time.Now().UTC()
	exp := now.Add(time.Duration(ttlHours) * time.Hour)
	if permanent {
		exp = time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)
	}
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
	p.notifyFileCreated(u.ID, staged, senderPeerID, targetPeerID)
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{"file": staged})
}

func (p *Plugin) notifyFileCreated(userID int64, staged db.StagedFile, senderPeerID, targetPeerID string) {
	if targetPeerID != "" {
		p.host.Hub().SendToPeer(userID, targetPeerID, "files_updated", map[string]any{
			"action":         "created",
			"id":             staged.ID,
			"file":           staged,
			"notify":         true,
			"sender_peer_id": senderPeerID,
			"target_peer_id": targetPeerID,
		})
		p.host.Hub().BroadcastUserExcept(userID, []string{targetPeerID, senderPeerID}, "files_updated", map[string]any{
			"action":         "synced",
			"id":             staged.ID,
			"notify":         false,
			"sender_peer_id": senderPeerID,
			"target_peer_id": targetPeerID,
		})
		return
	}
	p.host.Hub().BroadcastUserExcept(userID, []string{senderPeerID}, "files_updated", map[string]any{
		"action":         "created",
		"id":             staged.ID,
		"file":           staged,
		"notify":         true,
		"sender_peer_id": senderPeerID,
	})
}

func (p *Plugin) handlePatchFile(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "无效的文件 ID")
		return
	}
	var req struct {
		OrigName  *string `json:"orig_name"`
		TTLHours  *int    `json:"ttl_hours"`
		Permanent *bool   `json:"permanent"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	var curName string
	var curExp time.Time
	if err := p.host.DB().QueryRow(
		`SELECT orig_name, expires_at FROM staged_files WHERE id = ? AND user_id = ?`,
		id, u.ID,
	).Scan(&curName, &curExp); err != nil {
		plugin.WriteErr(w, http.StatusNotFound, "文件不存在")
		return
	}

	nextName := curName
	if req.OrigName != nil {
		cleaned := filepath.Base(strings.TrimSpace(*req.OrigName))
		if cleaned == "" || cleaned == "." || cleaned == ".." {
			plugin.WriteErr(w, http.StatusBadRequest, "文件名不能为空")
			return
		}
		nextName = cleaned
	}

	nextExp := curExp
	if req.Permanent != nil && *req.Permanent {
		nextExp = time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)
	} else if req.TTLHours != nil {
		if *req.TTLHours <= 0 {
			nextExp = time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)
		} else {
			h := *req.TTLHours
			if h > 24*365 {
				h = 24 * 365
			}
			nextExp = time.Now().UTC().Add(time.Duration(h) * time.Hour)
		}
	}

	if _, err := p.host.DB().Exec(
		`UPDATE staged_files SET orig_name = ?, expires_at = ? WHERE id = ? AND user_id = ?`,
		nextName, nextExp, id, u.ID,
	); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "更新文件失败")
		return
	}
	p.host.Hub().BroadcastUser(u.ID, "files_updated", map[string]any{"action": "updated", "id": id, "notify": false})
	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"orig_name":  nextName,
		"expires_at": nextExp,
	})
}

func (p *Plugin) handleBatchDeleteFiles(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil || len(req.IDs) == 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "请选择要删除的文件")
		return
	}
	deleted := 0
	for _, id := range req.IDs {
		if id <= 0 {
			continue
		}
		var storedName string
		if err := p.host.DB().QueryRow(`SELECT stored_name FROM staged_files WHERE id = ? AND user_id = ?`, id, u.ID).Scan(&storedName); err != nil {
			continue
		}
		_, _ = p.host.DB().Exec(`DELETE FROM shares WHERE kind = 'file' AND target_id = ? AND user_id = ?`, id, u.ID)
		if res, err := p.host.DB().Exec(`DELETE FROM staged_files WHERE id = ? AND user_id = ?`, id, u.ID); err == nil {
			if aff, _ := res.RowsAffected(); aff > 0 {
				_ = os.Remove(filepath.Join(p.host.Config().DataDir, "uploads", storedName))
				deleted++
			}
		}
	}
	p.host.Hub().BroadcastUser(u.ID, "files_updated", map[string]any{"action": "deleted", "notify": false})
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
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
	w.Header().Set("X-Content-Type-Options", "nosniff")
	safeName := strings.ReplaceAll(origName, `"`, "")
	if r.URL.Query().Get("inline") == "1" {
		if strings.HasPrefix(mimeType, "image/svg") || strings.Contains(strings.ToLower(mimeType), "html") {
			w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, safeName))
	} else {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, safeName))
	}
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

	st, statErr := f.Stat()
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, strings.ReplaceAll(origName, `"`, "")))
	if statErr == nil {
		http.ServeContent(w, r, origName, st.ModTime(), f)
		return
	}
	w.Header().Set("Content-Length", fmt.Sprintf("%d", sizeBytes))
	bufPtr := copyBufPool.Get().(*[]byte)
	defer copyBufPool.Put(bufPtr)
	_, _ = io.CopyBuffer(w, f, *bufPtr)
}
