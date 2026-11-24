package kernel_test

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"orbit/internal/config"
	"orbit/internal/db"
	"orbit/internal/kernel"
	"orbit/internal/plugin"
	"orbit/internal/plugins/bookmarks"
	"orbit/internal/plugins/clipboard"
	"orbit/internal/plugins/clock"
	"orbit/internal/plugins/monitor"
	"orbit/internal/plugins/search"
	"orbit/internal/plugins/transfer"
	"orbit/internal/plugins/weather"
)

func newTestKernel(t *testing.T, wanMaxMB int64) (*kernel.Kernel, http.Handler) {
	t.Helper()
	dir := t.TempDir()
	for _, sub := range []string{"uploads", "clips", "wallpapers", "icons", "fonts", "plugins", "cache/bing"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	conn, err := db.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	cfg := &config.Config{
		Addr:         ":0",
		DataDir:      dir,
		LANMaxMB:     100,
		TSMaxMB:      50,
		WANMaxMB:     wanMaxMB,
		MaxStorageMB: 500,
		TrustProxy:   true,
		WANHosts:     map[string]struct{}{},
		JWTSecret:    []byte("test-secret-0123456789abcdef0123456789"),
	}
	k := kernel.New(conn, cfg)
	for _, p := range []plugin.Plugin{
		clock.New(),
		search.New(),
		weather.New(),
		bookmarks.New(),
		monitor.New(),
		clipboard.New(),
		transfer.New(),
	} {
		if err := k.Register(p); err != nil {
			t.Fatalf("register %s: %v", p.Manifest().ID, err)
		}
	}
	_ = k.LoadExternalPlugins()
	return k, k.Routes()
}

func doJSONReq(t *testing.T, h http.Handler, method, path string, body any, cookies []*http.Cookie, bearer string, xff string) *httptest.ResponseRecorder {
	t.Helper()
	var buf io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		buf = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, buf)
	req.RemoteAddr = "192.168.1.50:12345"
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func TestKernelPluginsAndIsolation(t *testing.T) {
	_, h := newTestKernel(t, 1) // 1 MB WAN limit

	// 1. Initial auth status
	rr := doJSONReq(t, h, http.MethodGet, "/api/auth/status", nil, nil, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status got %d", rr.Code)
	}

	// 2. Setup first admin user
	rr = doJSONReq(t, h, http.MethodPost, "/api/auth/setup", map[string]string{
		"username": "rain",
		"password": "password123",
	}, nil, "", "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("setup got %d: %s", rr.Code, rr.Body.String())
	}
	adminCookies := rr.Result().Cookies()
	var setupRes struct {
		User struct {
			ID       int64  `json:"id"`
			APIToken string `json:"api_token"`
		} `json:"user"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &setupRes)
	if setupRes.User.APIToken == "" {
		t.Fatal("expected api_token on setup")
	}

	// 3. Verify 7 builtin plugins registered
	rr = doJSONReq(t, h, http.MethodGet, "/api/plugins", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list plugins got %d: %s", rr.Code, rr.Body.String())
	}
	var pluginsRes struct {
		Plugins []plugin.PluginStateRecord `json:"plugins"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &pluginsRes)
	if len(pluginsRes.Plugins) != 7 {
		t.Fatalf("expected 7 builtin plugins, got %d", len(pluginsRes.Plugins))
	}

	// 4. Push clip via Bearer API token
	rr = doJSONReq(t, h, http.MethodPost, "/api/clips", map[string]string{
		"content": "hello from shortcut",
	}, nil, setupRes.User.APIToken, "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("api token clip create got %d: %s", rr.Code, rr.Body.String())
	}

	// 5. Bookmarks + Sun-Panel + Browser HTML import
	rr = doJSONReq(t, h, http.MethodPost, "/api/bookmarks/import/sunpanel", []map[string]any{
		{
			"title": "NAS",
			"items": []map[string]any{
				{"title": "Synology", "lanUrl": "http://192.168.1.88:5000", "url": "https://nas.test"},
			},
		},
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("import sunpanel got %d: %s", rr.Code, rr.Body.String())
	}

	htmlBookmarks := `<DL><DT><A HREF="https://github.com">GitHub</A><DT><A HREF="http://192.168.1.5:8080">Local</A></DL>`
	rr = doJSONReq(t, h, http.MethodPost, "/api/p/orbit.bookmarks/import/browser", map[string]string{
		"html":       htmlBookmarks,
		"group_name": "浏览器书签导入",
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("import browser bookmarks got %d: %s", rr.Code, rr.Body.String())
	}

	// 6. Upload small file as LAN -> succeeds, oversized WAN -> 413
	uploadMultipart := func(payload []byte, filename, xff string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		fw, _ := mw.CreateFormFile("file", filename)
		_, _ = fw.Write(payload)
		_ = mw.Close()
		req := httptest.NewRequest(http.MethodPost, "/api/files", &body)
		req.RemoteAddr = "192.168.1.50:12345"
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		req.Header.Set("Content-Type", mw.FormDataContentType())
		for _, c := range adminCookies {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	smallData := []byte("orbit-secret-file-contents")
	rr = uploadMultipart(smallData, "secret.txt", "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("small upload got %d: %s", rr.Code, rr.Body.String())
	}
	var fileRes struct {
		File struct {
			ID int64 `json:"id"`
		} `json:"file"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &fileRes)

	bigData := bytes.Repeat([]byte("A"), 1536*1024)
	rr = uploadMultipart(bigData, "big.bin", "8.8.8.8")
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 on oversized WAN upload, got %d", rr.Code)
	}

	// 7. Burn-after-read share
	rr = doJSONReq(t, h, http.MethodPost, "/api/p/orbit.transfer/shares", map[string]any{
		"kind": "file", "target_id": fileRes.File.ID, "ttl_minutes": 30, "burn_after_read": true,
	}, adminCookies, "", "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("create share got %d: %s", rr.Code, rr.Body.String())
	}
	var shareRes struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &shareRes)

	rr = doJSONReq(t, h, http.MethodGet, "/api/public/share/"+shareRes.Code+"/download", nil, nil, "", "8.8.8.8")
	if rr.Code != http.StatusOK || !bytes.Equal(rr.Body.Bytes(), smallData) {
		t.Fatalf("first public download failed: %d", rr.Code)
	}
	rr = doJSONReq(t, h, http.MethodGet, "/api/public/share/"+shareRes.Code+"/download", nil, nil, "", "8.8.8.8")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("second download expected 404, got %d", rr.Code)
	}

	// 8. Public config whitelist
	rr = doJSONReq(t, h, http.MethodGet, "/api/public/config", nil, nil, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("public config got %d", rr.Code)
	}
	var pubCfg map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &pubCfg)
	if _, leaked := pubCfg["bookmarks"]; leaked {
		t.Fatal("public config must not leak bookmarks")
	}

	// 9. Disable/Re-enable plugin runtime enforcement
	rr = doJSONReq(t, h, http.MethodPatch, "/api/plugins/orbit.monitor", map[string]any{
		"enabled": false,
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("disable monitor got %d: %s", rr.Code, rr.Body.String())
	}
	rr = doJSONReq(t, h, http.MethodGet, "/api/system/metrics", nil, adminCookies, "", "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("disabled monitor compat route expected 403, got %d", rr.Code)
	}
	rr = doJSONReq(t, h, http.MethodGet, "/api/p/orbit.monitor/metrics", nil, adminCookies, "", "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("disabled monitor plugin route expected 403, got %d", rr.Code)
	}
	// Re-enable
	rr = doJSONReq(t, h, http.MethodPatch, "/api/plugins/orbit.monitor", map[string]any{
		"enabled": true,
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("re-enable monitor got %d", rr.Code)
	}
	rr = doJSONReq(t, h, http.MethodGet, "/api/p/orbit.monitor/metrics", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("re-enabled monitor expected 200, got %d", rr.Code)
	}

	// 10. Sub-account default isolation + selective share
	rr = doJSONReq(t, h, http.MethodPost, "/api/auth/users", map[string]any{
		"username": "child1", "password": "password123",
	}, adminCookies, "", "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("create child1 got %d", rr.Code)
	}
	var childRes struct {
		User db.User `json:"user"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &childRes)

	rr = doJSONReq(t, h, http.MethodPost, "/api/auth/login", map[string]string{
		"username": "child1", "password": "password123",
	}, nil, "", "")
	childCookies := rr.Result().Cookies()

	// Sub-account cannot disable plugins
	rr = doJSONReq(t, h, http.MethodPatch, "/api/plugins/orbit.monitor", map[string]any{"enabled": false}, childCookies, "", "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("non-admin toggling plugin expected 403, got %d", rr.Code)
	}
	// Sub-account denied monitor until shared
	rr = doJSONReq(t, h, http.MethodGet, "/api/system/metrics", nil, childCookies, "", "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("child metrics without share expected 403, got %d", rr.Code)
	}
	// Grant share scopes
	_ = doJSONReq(t, h, http.MethodPatch, "/api/auth/users/"+strconv.FormatInt(childRes.User.ID, 10)+"/shares", map[string]any{
		"share_scopes": db.ShareScopes{Bookmarks: true, Clips: true, Files: true, Monitor: true},
	}, adminCookies, "", "")
	rr = doJSONReq(t, h, http.MethodGet, "/api/system/metrics", nil, childCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("child metrics with share expected 200, got %d", rr.Code)
	}

	// 11. External light plugin install, KV isolation, declarative HTTP proxy, and uninstall
	mockUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "supersecret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","torrents":3}`))
	}))
	defer mockUpstream.Close()

	extManifest := plugin.Manifest{
		ID:             "community.qbt",
		Name:           "qBittorrent 概览",
		Version:        "1.0.0",
		Description:    "外部轻量插件代理卡片",
		Icon:           "server",
		Tier:           "external",
		DefaultEnabled: true,
		Access: plugin.AccessSpec{
			MinRole:     "user",
			Guest:       plugin.GuestSpec{Mode: "hidden"},
			Permissions: []string{"kv", "http:proxy"},
		},
		Contributes: plugin.ContributesSpec{
			Widgets: []plugin.WidgetContrib{
				{ID: "main", Label: "qBt", MinW: 260, DefaultW: 360, Resizable: true, DefaultVisible: true},
			},
		},
		External: &plugin.ExternalSpec{
			Entry:      "widget.html",
			RenderMode: "iframe",
			ConfigFields: []plugin.ConfigField{
				{Key: "baseUrl", Label: "地址", Type: "url"},
				{Key: "apiKey", Label: "API 密钥", Type: "password", Secret: true},
			},
			HTTPProxy: map[string]plugin.ProxyRule{
				"stats": {
					Method:  "GET",
					URL:     "{{baseUrl}}/api/stats",
					Headers: map[string]string{"X-Api-Key": "{{apiKey}}"},
				},
			},
		},
	}

	rr = doJSONReq(t, h, http.MethodPost, "/api/plugins/external/install", map[string]any{
		"manifest": extManifest,
		"files": map[string]string{
			"widget.html": "<!doctype html><html><body>qBt Widget</body></html>",
		},
	}, adminCookies, "", "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("install external plugin got %d: %s", rr.Code, rr.Body.String())
	}

	// Serve widget.html
	rr = doJSONReq(t, h, http.MethodGet, "/api/p/community.qbt/assets/widget.html", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte("qBt Widget")) {
		t.Fatalf("serve external asset failed: %d", rr.Code)
	}

	// Admin configures baseUrl & secret apiKey on plugin
	rr = doJSONReq(t, h, http.MethodPatch, "/api/plugins/community.qbt", map[string]any{
		"config": map[string]string{
			"baseUrl": mockUpstream.URL,
			"apiKey":  "supersecret",
		},
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("config external plugin got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify secret field is masked for non-admin user
	rr = doJSONReq(t, h, http.MethodGet, "/api/plugins", nil, childCookies, "", "")
	var childPlugins struct {
		Plugins []plugin.PluginStateRecord `json:"plugins"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &childPlugins)
	for _, pr := range childPlugins.Plugins {
		if pr.Manifest.ID == "community.qbt" {
			if _, leaked := pr.Config["apiKey"]; leaked {
				t.Fatal("secret config field apiKey leaked to non-admin")
			}
		}
	}

	// Declarative HTTP proxy injects credentials server-side
	rr = doJSONReq(t, h, http.MethodGet, "/api/p/community.qbt/proxy/stats", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte(`"torrents":3`)) {
		t.Fatalf("external proxy failed: %d %s", rr.Code, rr.Body.String())
	}

	// Plugin KV user isolation
	rr = doJSONReq(t, h, http.MethodPut, "/api/p/community.qbt/kv/note", map[string]any{
		"value": "admin-secret-note",
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("kv put failed: %d", rr.Code)
	}
	rr = doJSONReq(t, h, http.MethodGet, "/api/p/community.qbt/kv/note", nil, childCookies, "", "")
	var kvGet struct {
		Found bool `json:"found"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &kvGet)
	if kvGet.Found {
		t.Fatal("child user must not see admin plugin_kv entry")
	}

	// Delete external plugin
	rr = doJSONReq(t, h, http.MethodDelete, "/api/plugins/external/community.qbt", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("delete external plugin got %d", rr.Code)
	}
	rr = doJSONReq(t, h, http.MethodGet, "/api/p/community.qbt/assets/widget.html", nil, adminCookies, "", "")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("deleted plugin asset expected 404, got %d", rr.Code)
	}
}
