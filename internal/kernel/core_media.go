package kernel

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"orbit/internal/plugin"
)

// ---------- Bing & Custom Wallpapers ----------

type BingItem struct {
	Idx   int    `json:"idx"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

type BingService struct {
	dataDir   string
	client    *http.Client
	mu        sync.Mutex
	fetchedAt time.Time
	items     []BingItem
	rawURLs   map[int]string
}

func NewBingService(dataDir string) *BingService {
	return &BingService{
		dataDir: dataDir,
		client:  &http.Client{Timeout: 6 * time.Second, Transport: NewDirectLANTransport(false)},
		rawURLs: make(map[int]string),
	}
}

func (b *BingService) list(force bool) ([]BingItem, bool) {
	b.mu.Lock()
	if !force && len(b.items) > 0 && time.Since(b.fetchedAt) < 6*time.Hour {
		out := append([]BingItem(nil), b.items...)
		b.mu.Unlock()
		return out, false
	}
	b.mu.Unlock()

	req, err := http.NewRequest(http.MethodGet, "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN", nil)
	if err != nil {
		return nil, true
	}
	req.Header.Set("User-Agent", "Orbit/1.0")
	resp, err := b.client.Do(req)
	if err != nil {
		return b.cachedOrFallback()
	}
	defer resp.Body.Close()

	var payload struct {
		Images []struct {
			URL       string `json:"url"`
			URLBase   string `json:"urlbase"`
			Title     string `json:"title"`
			Copyright string `json:"copyright"`
		} `json:"images"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil || len(payload.Images) == 0 {
		return b.cachedOrFallback()
	}

	items := make([]BingItem, 0, len(payload.Images))
	rawMap := make(map[int]string, len(payload.Images))
	for i, img := range payload.Images {
		fullURL := img.URL
		if fullURL == "" && img.URLBase != "" {
			fullURL = img.URLBase + "_1920x1080.jpg"
		}
		if strings.HasPrefix(fullURL, "/") {
			fullURL = "https://www.bing.com" + fullURL
		}
		title := plugin.FirstNonEmpty(img.Title, img.Copyright, fmt.Sprintf("Bing 壁纸 #%d", i+1))
		items = append(items, BingItem{
			Idx:   i,
			Title: title,
			URL:   fmt.Sprintf("/api/wallpaper/bing/image?idx=%d", i),
		})
		rawMap[i] = fullURL
	}

	b.mu.Lock()
	b.items = items
	b.rawURLs = rawMap
	b.fetchedAt = time.Now()
	b.mu.Unlock()
	return items, false
}

func (b *BingService) cachedOrFallback() ([]BingItem, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.items) > 0 {
		return append([]BingItem(nil), b.items...), false
	}
	return []BingItem{}, true
}

func (b *BingService) getImagePath(idx int) (string, error) {
	if idx < 0 || idx > 7 {
		idx = 0
	}
	cacheFile := filepath.Join(b.dataDir, "cache", "bing", fmt.Sprintf("bing_%d.jpg", idx))
	if st, err := os.Stat(cacheFile); err == nil && st.Size() > 1024 && time.Since(st.ModTime()) < 6*time.Hour {
		return cacheFile, nil
	}

	b.mu.Lock()
	remoteURL := b.rawURLs[idx]
	b.mu.Unlock()
	if remoteURL == "" {
		_, _ = b.list(true)
		b.mu.Lock()
		remoteURL = b.rawURLs[idx]
		b.mu.Unlock()
	}
	if remoteURL == "" {
		if _, err := os.Stat(cacheFile); err == nil {
			return cacheFile, nil
		}
		return "", os.ErrNotExist
	}

	resp, err := b.client.Get(remoteURL)
	if err != nil {
		if _, stErr := os.Stat(cacheFile); stErr == nil {
			return cacheFile, nil
		}
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("bing image status %d", resp.StatusCode)
	}

	tmpPath := cacheFile + ".tmp"
	f, err := os.Create(tmpPath)
	if err != nil {
		return "", err
	}
	_, copyErr := io.Copy(f, io.LimitReader(resp.Body, 15<<20))
	_ = f.Close()
	if copyErr != nil {
		_ = os.Remove(tmpPath)
		return "", copyErr
	}
	if err := os.Rename(tmpPath, cacheFile); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	return cacheFile, nil
}

func (k *Kernel) handleBingList(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("refresh") == "1"
	items, fallback := k.bing.list(force)
	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"items":    items,
		"fallback": fallback,
	})
}

func (k *Kernel) handleBingImage(w http.ResponseWriter, r *http.Request) {
	idx, _ := strconv.Atoi(r.URL.Query().Get("idx"))
	path, err := k.bing.getImagePath(idx)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=21600")
	http.ServeFile(w, r, path)
}

func (k *Kernel) handleWallpaperUpload(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	const maxSize = 15 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxSize+1024)
	if err := r.ParseMultipartForm(maxSize); err != nil {
		plugin.WriteErr(w, http.StatusRequestEntityTooLarge, "wallpaper exceeds 15MB limit")
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		file, hdr, err = r.FormFile("image")
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
		plugin.WriteErr(w, http.StatusBadRequest, "only image files allowed")
		return
	}

	ext := filepath.Ext(hdr.Filename)
	if ext == "" {
		ext = ".jpg"
	}
	var randBuf [10]byte
	_, _ = rand.Read(randBuf[:])
	fileName := fmt.Sprintf("u%d_%s%s", u.ID, hex.EncodeToString(randBuf[:]), ext)
	dstPath := filepath.Join(k.cfg.DataDir, "wallpapers", fileName)
	dst, err := os.Create(dstPath)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "failed to save wallpaper")
		return
	}
	defer dst.Close()

	if _, err := dst.Write(head[:n]); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "write error")
		return
	}
	if _, err := io.Copy(dst, file); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "write error")
		return
	}

	plugin.WriteJSON(w, http.StatusCreated, map[string]any{
		"url": "/api/wallpaper/custom/" + fileName,
	})
}

func (k *Kernel) handleServeCustomWallpaper(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.PathValue("name"))
	if name == "" || name == "." || strings.Contains(name, "..") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, r, filepath.Join(k.cfg.DataDir, "wallpapers", name))
}

func (k *Kernel) handleDeleteCustomWallpaper(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	name := filepath.Base(r.PathValue("name"))
	if name == "" || name == "." || strings.Contains(name, "..") {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid wallpaper name")
		return
	}
	prefix := fmt.Sprintf("u%d_", u.ID)
	if u.Role != "admin" && !strings.HasPrefix(name, prefix) {
		plugin.WriteErr(w, http.StatusForbidden, "无权删除此壁纸")
		return
	}
	_ = os.Remove(filepath.Join(k.cfg.DataDir, "wallpapers", name))
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------- Custom Icons (Upload / Auto-Fetch / Serve) ----------

const maxIconBytes = 2 << 20

var (
	linkTagRe  = regexp.MustCompile(`(?is)<link\b[^>]*>`)
	linkRelRe  = regexp.MustCompile(`(?is)\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`)
	linkHrefRe = regexp.MustCompile(`(?is)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`)
)

func detectIconExt(data []byte, contentType, nameHint string) string {
	if len(data) == 0 {
		return ""
	}
	if len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}) {
		return ".png"
	}
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return ".jpg"
	}
	if len(data) >= 6 && (bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a"))) {
		return ".gif"
	}
	if len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")) {
		return ".webp"
	}
	if len(data) >= 4 && data[0] == 0x00 && data[1] == 0x00 && (data[2] == 0x01 || data[2] == 0x02) && data[3] == 0x00 {
		return ".ico"
	}

	trimmed := strings.TrimSpace(string(bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})))
	lowerHead := strings.ToLower(trimmed)
	if len(lowerHead) > 2048 {
		lowerHead = lowerHead[:2048]
	}
	if !strings.HasPrefix(lowerHead, "<!doctype html") && !strings.HasPrefix(lowerHead, "<html") {
		if strings.HasPrefix(lowerHead, "<svg") ||
			((strings.HasPrefix(lowerHead, "<?xml") || strings.Contains(strings.ToLower(contentType), "svg") || strings.HasSuffix(strings.ToLower(nameHint), ".svg")) &&
				strings.Contains(strings.ToLower(trimmed), "<svg")) {
			return ".svg"
		}
	}

	ct := strings.ToLower(contentType)
	switch {
	case strings.Contains(ct, "image/x-icon") || strings.Contains(ct, "image/vnd.microsoft.icon"):
		return ".ico"
	case strings.Contains(ct, "image/png"):
		return ".png"
	case strings.Contains(ct, "image/jpeg"):
		return ".jpg"
	case strings.Contains(ct, "image/webp"):
		return ".webp"
	case strings.Contains(ct, "image/gif"):
		return ".gif"
	}
	return ""
}

func (k *Kernel) handleIconUpload(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	r.Body = http.MaxBytesReader(w, r.Body, maxIconBytes+4096)
	if err := r.ParseMultipartForm(maxIconBytes + 4096); err != nil {
		plugin.WriteErr(w, http.StatusRequestEntityTooLarge, "图标文件不能超过 2 MB")
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		file, hdr, err = r.FormFile("icon")
	}
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "请上传图标文件")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxIconBytes+1))
	if err != nil || len(data) > maxIconBytes {
		plugin.WriteErr(w, http.StatusRequestEntityTooLarge, "图标文件不能超过 2 MB")
		return
	}

	ext := detectIconExt(data, hdr.Header.Get("Content-Type"), hdr.Filename)
	if ext == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "仅支持 PNG / JPG / WebP / GIF / ICO / SVG 图标")
		return
	}

	var randBuf [8]byte
	_, _ = rand.Read(randBuf[:])
	fileName := fmt.Sprintf("u%d_%s%s", u.ID, hex.EncodeToString(randBuf[:]), ext)
	dstPath := filepath.Join(k.cfg.DataDir, "icons", fileName)
	if err := os.WriteFile(dstPath, data, 0o644); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "保存图标失败")
		return
	}

	plugin.WriteJSON(w, http.StatusCreated, map[string]any{
		"url": "/api/icons/custom/" + fileName,
	})
}

func (k *Kernel) handleIconFetch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	target := strings.TrimSpace(req.URL)
	if target == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "请先填写目标网址")
		return
	}
	target = strings.ReplaceAll(target, "{q}", "orbit")
	if !strings.Contains(target, "://") {
		target = "https://" + target
	}
	parsed, err := url.Parse(target)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		plugin.WriteErr(w, http.StatusBadRequest, "无效的网址格式")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	client := &http.Client{
		Timeout:   4 * time.Second,
		Transport: NewDirectLANTransport(true),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}

	type iconCand struct {
		url      string
		priority int
	}
	var originCands []iconCand
	originBase := parsed.Scheme + "://" + parsed.Host

	originDead := false
	reqPage, _ := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	reqPage.Header.Set("User-Agent", "Mozilla/5.0 Orbit/1.0")
	if resp, err := client.Do(reqPage); err == nil {
		finalURL := resp.Request.URL
		if finalURL == nil {
			finalURL = parsed
		}
		originBase = finalURL.Scheme + "://" + finalURL.Host
		ct := resp.Header.Get("Content-Type")
		bodyBytes, readErr := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
		_ = resp.Body.Close()

		if readErr == nil && resp.StatusCode == http.StatusOK {
			if ext := detectIconExt(bodyBytes, ct, finalURL.Path); ext != "" {
				fileName, saveErr := k.saveAutoIcon(bodyBytes, ext)
				if saveErr == nil {
					plugin.WriteJSON(w, http.StatusOK, map[string]any{
						"url":    "/api/icons/custom/" + fileName,
						"source": finalURL.String(),
					})
					return
				}
			}
			for _, m := range linkTagRe.FindAllString(string(bodyBytes), -1) {
				relM := linkRelRe.FindStringSubmatch(m)
				hrefM := linkHrefRe.FindStringSubmatch(m)
				if len(relM) == 0 || len(hrefM) == 0 {
					continue
				}
				relVal := strings.ToLower(plugin.FirstNonEmpty(relM[1:]...))
				if !strings.Contains(relVal, "icon") {
					continue
				}
				hrefVal := strings.TrimSpace(plugin.FirstNonEmpty(hrefM[1:]...))
				if hrefVal == "" || strings.HasPrefix(hrefVal, "data:") {
					continue
				}
				ref, refErr := url.Parse(hrefVal)
				if refErr != nil {
					continue
				}
				resolved := finalURL.ResolveReference(ref).String()
				prio := 10
				if strings.Contains(relVal, "apple-touch-icon") {
					prio = 1
				} else if strings.HasSuffix(strings.ToLower(ref.Path), ".svg") {
					prio = 2
				} else if strings.HasSuffix(strings.ToLower(ref.Path), ".png") {
					prio = 3
				}
				originCands = append(originCands, iconCand{url: resolved, priority: prio})
			}
		}
	} else {
		originDead = true
	}

	sort.SliceStable(originCands, func(i, j int) bool {
		return originCands[i].priority < originCands[j].priority
	})

	candidates := make([]string, 0, 10)
	seen := make(map[string]struct{})
	addCand := func(u string) {
		if u == "" {
			return
		}
		if _, ok := seen[u]; !ok {
			seen[u] = struct{}{}
			candidates = append(candidates, u)
		}
	}

	if !originDead {
		for _, c := range originCands {
			addCand(c.url)
		}
		for _, suffix := range []string{"/apple-touch-icon.png", "/favicon.svg", "/favicon.png", "/favicon.ico"} {
			addCand(originBase + suffix)
		}
	}

	host := parsed.Hostname()
	if isPublicDomain(host) {
		addCand("https://icons.duckduckgo.com/ip3/" + host + ".ico")
		addCand("https://www.google.com/s2/favicons?domain=" + url.QueryEscape(host) + "&sz=128")
	}

	for _, candURL := range candidates {
		reqImg, err := http.NewRequestWithContext(ctx, http.MethodGet, candURL, nil)
		if err != nil {
			continue
		}
		reqImg.Header.Set("User-Agent", "Mozilla/5.0 Orbit/1.0")
		resp, err := client.Do(reqImg)
		if err != nil {
			continue
		}
		ct := resp.Header.Get("Content-Type")
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, maxIconBytes+1))
		status := resp.StatusCode
		_ = resp.Body.Close()
		if readErr != nil || status != http.StatusOK || len(data) == 0 || len(data) > maxIconBytes {
			continue
		}
		ext := detectIconExt(data, ct, candURL)
		if ext == "" {
			continue
		}
		fileName, saveErr := k.saveAutoIcon(data, ext)
		if saveErr != nil {
			continue
		}
		plugin.WriteJSON(w, http.StatusOK, map[string]any{
			"url":    "/api/icons/custom/" + fileName,
			"source": candURL,
		})
		return
	}

	plugin.WriteErr(w, http.StatusNotFound, "未能从该地址自动获取图标，可尝试上传本地图片或手动填写图标 URL")
}

func (k *Kernel) saveAutoIcon(data []byte, ext string) (string, error) {
	sum := sha256.Sum256(data)
	fileName := fmt.Sprintf("auto_%s%s", hex.EncodeToString(sum[:8]), ext)
	dstPath := filepath.Join(k.cfg.DataDir, "icons", fileName)
	if _, err := os.Stat(dstPath); err == nil {
		return fileName, nil
	}
	if err := os.WriteFile(dstPath, data, 0o644); err != nil {
		return "", err
	}
	return fileName, nil
}

func (k *Kernel) handleServeCustomIcon(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.PathValue("name"))
	if name == "" || name == "." || strings.Contains(name, "..") {
		http.NotFound(w, r)
		return
	}
	fullPath := filepath.Join(k.cfg.DataDir, "icons", name)
	if _, err := os.Stat(fullPath); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=604800")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	switch strings.ToLower(filepath.Ext(name)) {
	case ".svg":
		w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	case ".ico":
		w.Header().Set("Content-Type", "image/x-icon")
	}
	http.ServeFile(w, r, fullPath)
}

func isPublicDomain(host string) bool {
	if host == "" || strings.EqualFold(host, "localhost") || !strings.Contains(host, ".") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return false
	}
	l := strings.ToLower(host)
	return !strings.HasSuffix(l, ".local") && !strings.HasSuffix(l, ".lan") && !strings.HasSuffix(l, ".internal")
}

// ---------- Custom Fonts ----------

const maxFontBytes = 20 << 20

func detectFontFormat(data []byte, origName string) (ext string, format string) {
	if len(data) < 4 {
		return "", ""
	}
	lowerExt := strings.ToLower(filepath.Ext(origName))
	head := data[:4]
	switch {
	case bytes.Equal(head, []byte("wOF2")):
		return ".woff2", "woff2"
	case bytes.Equal(head, []byte("wOFF")):
		return ".woff", "woff"
	case bytes.Equal(head, []byte("OTTO")):
		return ".otf", "opentype"
	case bytes.Equal(head, []byte{0x00, 0x01, 0x00, 0x00}) || bytes.Equal(head, []byte("true")):
		return ".ttf", "truetype"
	case lowerExt == ".ttf":
		return ".ttf", "truetype"
	case lowerExt == ".otf":
		return ".otf", "opentype"
	case lowerExt == ".woff2":
		return ".woff2", "woff2"
	case lowerExt == ".woff":
		return ".woff", "woff"
	}
	return "", ""
}

func (k *Kernel) handleFontUpload(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	r.Body = http.MaxBytesReader(w, r.Body, maxFontBytes+4096)
	if err := r.ParseMultipartForm(maxFontBytes + 4096); err != nil {
		plugin.WriteErr(w, http.StatusRequestEntityTooLarge, "字体文件不能超过 20 MB")
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		file, hdr, err = r.FormFile("font")
	}
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "请选择字体文件")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxFontBytes+1))
	if err != nil || len(data) > maxFontBytes {
		plugin.WriteErr(w, http.StatusRequestEntityTooLarge, "字体文件不能超过 20 MB")
		return
	}

	ext, format := detectFontFormat(data, hdr.Filename)
	if ext == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "仅支持 .woff2 / .woff / .ttf / .otf 字体文件")
		return
	}

	var randBuf [8]byte
	_, _ = rand.Read(randBuf[:])
	fileName := fmt.Sprintf("u%d_%s%s", u.ID, hex.EncodeToString(randBuf[:]), ext)
	dstPath := filepath.Join(k.cfg.DataDir, "fonts", fileName)
	if err := os.WriteFile(dstPath, data, 0o644); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "保存字体文件失败")
		return
	}

	baseName := strings.TrimSpace(strings.TrimSuffix(filepath.Base(hdr.Filename), filepath.Ext(hdr.Filename)))
	if baseName == "" {
		baseName = "自定义字体"
	}
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{
		"url":    "/api/fonts/custom/" + fileName,
		"name":   baseName,
		"format": format,
	})
}

func (k *Kernel) handleServeCustomFont(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.PathValue("name"))
	if name == "" || name == "." || strings.Contains(name, "..") {
		http.NotFound(w, r)
		return
	}
	fullPath := filepath.Join(k.cfg.DataDir, "fonts", name)
	if _, err := os.Stat(fullPath); err != nil {
		http.NotFound(w, r)
		return
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".woff2":
		w.Header().Set("Content-Type", "font/woff2")
	case ".woff":
		w.Header().Set("Content-Type", "font/woff")
	case ".ttf":
		w.Header().Set("Content-Type", "font/ttf")
	case ".otf":
		w.Header().Set("Content-Type", "font/otf")
	}
	w.Header().Set("Cache-Control", "public, max-age=2592000")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, fullPath)
}

func (k *Kernel) handleDeleteCustomFont(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	name := filepath.Base(r.PathValue("name"))
	if name == "" || name == "." || strings.Contains(name, "..") {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid font name")
		return
	}
	prefix := fmt.Sprintf("u%d_", u.ID)
	if u.Role != "admin" && !strings.HasPrefix(name, prefix) {
		plugin.WriteErr(w, http.StatusForbidden, "无权删除此字体")
		return
	}
	_ = os.Remove(filepath.Join(k.cfg.DataDir, "fonts", name))
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------- User Avatars (Upload / Delete / Serve) ----------

const maxAvatarBytes = 5 << 20

func detectAvatarExt(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	if len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}) {
		return ".png"
	}
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return ".jpg"
	}
	if len(data) >= 6 && (bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a"))) {
		return ".gif"
	}
	if len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")) {
		return ".webp"
	}
	return ""
}

func (k *Kernel) removeLocalAvatar(avatarURL string) {
	if !strings.HasPrefix(avatarURL, "/api/avatars/") {
		return
	}
	name := filepath.Base(strings.TrimPrefix(avatarURL, "/api/avatars/"))
	if name == "" || name == "." || strings.Contains(name, "..") {
		return
	}
	_ = os.Remove(filepath.Join(k.cfg.DataDir, "avatars", name))
}

func (k *Kernel) handleAvatarUpload(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarBytes+4096)
	if err := r.ParseMultipartForm(maxAvatarBytes + 4096); err != nil {
		plugin.WriteErr(w, http.StatusRequestEntityTooLarge, "头像文件不能超过 5 MB")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		file, _, err = r.FormFile("avatar")
	}
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "请上传头像图片")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxAvatarBytes+1))
	if err != nil || len(data) > maxAvatarBytes {
		plugin.WriteErr(w, http.StatusRequestEntityTooLarge, "头像文件不能超过 5 MB")
		return
	}

	ext := detectAvatarExt(data)
	if ext == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "仅支持 PNG / JPG / WebP / GIF 格式图片")
		return
	}

	avatarDir := filepath.Join(k.cfg.DataDir, "avatars")
	if err := os.MkdirAll(avatarDir, 0o755); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "无法创建头像目录")
		return
	}

	var randBuf [8]byte
	_, _ = rand.Read(randBuf[:])
	fileName := fmt.Sprintf("u%d_%s%s", u.ID, hex.EncodeToString(randBuf[:]), ext)
	dstPath := filepath.Join(avatarDir, fileName)
	if err := os.WriteFile(dstPath, data, 0o644); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "保存头像失败")
		return
	}

	var oldAvatar string
	_ = k.db.QueryRow(`SELECT avatar FROM users WHERE id = ?`, u.ID).Scan(&oldAvatar)

	newURL := "/api/avatars/" + fileName
	if _, err := k.db.Exec(`UPDATE users SET avatar = ? WHERE id = ?`, newURL, u.ID); err != nil {
		_ = os.Remove(dstPath)
		plugin.WriteErr(w, http.StatusInternalServerError, "更新用户头像失败")
		return
	}
	if oldAvatar != "" && oldAvatar != newURL {
		k.removeLocalAvatar(oldAvatar)
	}

	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"avatar": newURL,
	})
}

func (k *Kernel) handleAvatarDelete(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	var oldAvatar string
	_ = k.db.QueryRow(`SELECT avatar FROM users WHERE id = ?`, u.ID).Scan(&oldAvatar)

	if _, err := k.db.Exec(`UPDATE users SET avatar = '' WHERE id = ?`, u.ID); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "重置头像失败")
		return
	}
	k.removeLocalAvatar(oldAvatar)
	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"avatar": "",
	})
}

func (k *Kernel) handleServeAvatar(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.PathValue("name"))
	if name == "" || name == "." || strings.Contains(name, "..") {
		http.NotFound(w, r)
		return
	}
	fullPath := filepath.Join(k.cfg.DataDir, "avatars", name)
	if _, err := os.Stat(fullPath); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=604800")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, fullPath)
}

// ---------- Unified Uploaded Asset Manager ----------

type ManagedAsset struct {
	Category  string    `json:"category"` // wallpapers | icons | fonts | clips
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	SizeBytes int64     `json:"size_bytes"`
	ModTime   time.Time `json:"mod_time"`
	MimeHint  string    `json:"mime_hint"`
	Owned     bool      `json:"owned"`
}

func mimeHintFromExt(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".ico":
		return "image/x-icon"
	case ".woff2":
		return "font/woff2"
	case ".woff":
		return "font/woff"
	case ".ttf":
		return "font/ttf"
	case ".otf":
		return "font/otf"
	default:
		return "application/octet-stream"
	}
}

func (k *Kernel) handleListAssets(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	category := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("category")))
	if category == "" {
		category = "all"
	}

	userPrefix := fmt.Sprintf("u%d_", u.ID)
	assets := make([]ManagedAsset, 0)
	totals := map[string]int64{
		"wallpapers": 0,
		"icons":      0,
		"fonts":      0,
		"clips":      0,
	}

	scanDir := func(cat, dirName, urlPrefix string, requireOwnerPrefix bool) {
		dir := filepath.Join(k.cfg.DataDir, dirName)
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, ent := range entries {
			if ent.IsDir() {
				continue
			}
			name := ent.Name()
			if strings.HasPrefix(name, ".") || strings.HasSuffix(name, ".tmp") {
				continue
			}
			owned := u.Role == "admin" || strings.HasPrefix(name, userPrefix)
			if requireOwnerPrefix && !owned {
				continue
			}
			info, err := ent.Info()
			if err != nil {
				continue
			}
			totals[cat] += info.Size()
			if category != "all" && category != cat {
				continue
			}
			assets = append(assets, ManagedAsset{
				Category:  cat,
				Name:      name,
				URL:       urlPrefix + name,
				SizeBytes: info.Size(),
				ModTime:   info.ModTime().UTC(),
				MimeHint:  mimeHintFromExt(name),
				Owned:     owned,
			})
		}
	}

	scanDir("wallpapers", "wallpapers", "/api/wallpaper/custom/", true)
	scanDir("icons", "icons", "/api/icons/custom/", u.Role != "admin")
	scanDir("fonts", "fonts", "/api/fonts/custom/", true)

	// Clip images: strictly scoped to the user's own clips table records (or all for admin)
	var clipRowsQuery string
	var clipArgs []any
	if u.Role == "admin" {
		clipRowsQuery = `SELECT image_path FROM clips WHERE kind = 'image' AND image_path != ''`
	} else {
		clipRowsQuery = `SELECT image_path FROM clips WHERE kind = 'image' AND image_path != '' AND user_id = ?`
		clipArgs = append(clipArgs, u.ID)
	}
	clipSet := make(map[string]bool)
	if rows, err := k.db.Query(clipRowsQuery, clipArgs...); err == nil {
		for rows.Next() {
			var p string
			if rows.Scan(&p) == nil && p != "" {
				clipSet[filepath.Base(p)] = true
			}
		}
		rows.Close()
	}
	if entries, err := os.ReadDir(filepath.Join(k.cfg.DataDir, "clips")); err == nil {
		for _, ent := range entries {
			if ent.IsDir() {
				continue
			}
			name := ent.Name()
			if !clipSet[name] && u.Role != "admin" {
				continue
			}
			info, err := ent.Info()
			if err != nil {
				continue
			}
			totals["clips"] += info.Size()
			if category != "all" && category != "clips" {
				continue
			}
			assets = append(assets, ManagedAsset{
				Category:  "clips",
				Name:      name,
				URL:       "/api/clips/image/" + name,
				SizeBytes: info.Size(),
				ModTime:   info.ModTime().UTC(),
				MimeHint:  mimeHintFromExt(name),
				Owned:     true,
			})
		}
	}

	sort.Slice(assets, func(i, j int) bool {
		return assets[i].ModTime.After(assets[j].ModTime)
	})

	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"assets": assets,
		"totals": totals,
	})
}

func (k *Kernel) deleteSingleAsset(uRole string, uID int64, category, name string) (int, string) {
	base := filepath.Base(strings.TrimSpace(name))
	if base == "" || base == "." || strings.Contains(base, "..") {
		return http.StatusBadRequest, "无效的文件名"
	}
	userPrefix := fmt.Sprintf("u%d_", uID)

	switch category {
	case "wallpapers", "icons", "fonts":
		if uRole != "admin" && !strings.HasPrefix(base, userPrefix) {
			return http.StatusForbidden, "无权删除此文件"
		}
		target := filepath.Join(k.cfg.DataDir, category, base)
		if _, err := os.Stat(target); err != nil {
			return http.StatusNotFound, "文件不存在"
		}
		if err := os.Remove(target); err != nil {
			return http.StatusInternalServerError, "删除文件失败"
		}
		return http.StatusOK, ""
	case "clips":
		imgURL := "/api/clips/image/" + base
		if uRole != "admin" {
			var cid int64
			if err := k.db.QueryRow(`SELECT id FROM clips WHERE user_id = ? AND image_path = ?`, uID, imgURL).Scan(&cid); err != nil {
				return http.StatusForbidden, "无权删除此剪贴板图片"
			}
			_, _ = k.db.Exec(`DELETE FROM clips WHERE user_id = ? AND image_path = ?`, uID, imgURL)
		} else {
			_, _ = k.db.Exec(`DELETE FROM clips WHERE image_path = ?`, imgURL)
		}
		_ = os.Remove(filepath.Join(k.cfg.DataDir, "clips", base))
		k.hub.BroadcastUser(uID, "clip_updated", map[string]any{"action": "deleted"})
		return http.StatusOK, ""
	default:
		return http.StatusBadRequest, "不支持的文件分类"
	}
}

func (k *Kernel) handleDeleteAsset(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	category := strings.ToLower(strings.TrimSpace(r.PathValue("category")))
	name := r.PathValue("name")
	status, errMsg := k.deleteSingleAsset(u.Role, u.ID, category, name)
	if status != http.StatusOK {
		plugin.WriteErr(w, status, errMsg)
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (k *Kernel) handleBatchDeleteAssets(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	var req struct {
		Items []struct {
			Category string `json:"category"`
			Name     string `json:"name"`
		} `json:"items"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil || len(req.Items) == 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "请选择要删除的文件")
		return
	}
	deleted := 0
	for _, it := range req.Items {
		if status, _ := k.deleteSingleAsset(u.Role, u.ID, strings.ToLower(it.Category), it.Name); status == http.StatusOK {
			deleted++
		}
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
}
