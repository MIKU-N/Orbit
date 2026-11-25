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
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"orbit/internal/config"
	"orbit/internal/db"
	"orbit/internal/kernel"
	"orbit/internal/plugin"
	"orbit/internal/plugins/bookmarks"
	"orbit/internal/plugins/clipboard"
	"orbit/internal/plugins/clock"
	"orbit/internal/plugins/hitokoto"
	"orbit/internal/plugins/monitor"
	"orbit/internal/plugins/search"
	"orbit/internal/plugins/transfer"
	"orbit/internal/plugins/weather"
)

func newTestKernel(t *testing.T, wanMaxMB int64) (*kernel.Kernel, http.Handler) {
	t.Helper()
	dir := t.TempDir()
	for _, sub := range []string{"uploads", "clips", "wallpapers", "icons", "avatars", "fonts", "plugins", "cache/bing"} {
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
		LANMaxMB:     0,
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
		hitokoto.New(),
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

	// 3. Verify 8 builtin plugins registered
	rr = doJSONReq(t, h, http.MethodGet, "/api/plugins", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list plugins got %d: %s", rr.Code, rr.Body.String())
	}
	var pluginsRes struct {
		Plugins []plugin.PluginStateRecord `json:"plugins"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &pluginsRes)
	if len(pluginsRes.Plugins) != 8 {
		t.Fatalf("expected 8 builtin plugins, got %d", len(pluginsRes.Plugins))
	}

	// Verify Hitokoto builtin quote endpoint works (both public and plugin path)
	rr = doJSONReq(t, h, http.MethodGet, "/api/hitokoto?mode=builtin", nil, nil, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("hitokoto builtin got %d: %s", rr.Code, rr.Body.String())
	}
	var hkRes struct {
		Text   string `json:"text"`
		Source string `json:"source"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &hkRes)
	if hkRes.Text == "" || hkRes.Source != "builtin" {
		t.Fatalf("unexpected hitokoto response: %+v", hkRes)
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

	// LAN upload with LANMaxMB=0 (unlimited) must succeed even above 2MB
	lanBigData := bytes.Repeat([]byte("B"), 3*1024*1024)
	rr = uploadMultipart(lanBigData, "lan-unlimited.bin", "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201 on unlimited LAN upload, got %d: %s", rr.Code, rr.Body.String())
	}
	rr = doJSONReq(t, h, http.MethodGet, "/api/files", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list files got %d: %s", rr.Code, rr.Body.String())
	}
	var filesListRes struct {
		ZoneLimitMB    int64 `json:"zone_limit_mb"`
		ZoneLimitBytes int64 `json:"zone_limit_bytes"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &filesListRes)
	if filesListRes.ZoneLimitMB != 0 || filesListRes.ZoneLimitBytes != 0 {
		t.Fatalf("expected LAN zone_limit 0 (unlimited), got mb=%d bytes=%d", filesListRes.ZoneLimitMB, filesListRes.ZoneLimitBytes)
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

func TestStarterDataSunPanelBatchDeleteAndAvatar(t *testing.T) {
	_, h := newTestKernel(t, 10)

	// 1. Setup admin user and verify minimal starter data
	rr := doJSONReq(t, h, http.MethodPost, "/api/auth/setup", map[string]string{
		"username": "admin",
		"password": "password123",
	}, nil, "", "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("setup got %d: %s", rr.Code, rr.Body.String())
	}
	adminCookies := rr.Result().Cookies()

	rr = doJSONReq(t, h, http.MethodGet, "/api/bookmarks", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list bookmarks got %d", rr.Code)
	}
	var initBM struct {
		Groups    []db.Group    `json:"groups"`
		Bookmarks []db.Bookmark `json:"bookmarks"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &initBM)
	if len(initBM.Groups) != 1 || len(initBM.Bookmarks) != 1 {
		t.Fatalf("expected minimal starter data (1 group, 1 bookmark), got %d groups and %d bookmarks", len(initBM.Groups), len(initBM.Bookmarks))
	}
	if initBM.Bookmarks[0].WANUrl == "" {
		t.Fatalf("expected starter bookmark to have a valid public URL, got %+v", initBM.Bookmarks[0])
	}

	// 2. Import exact Sun-Panel v1.8.1 JSON (17 children under icons[0].children)
	sunPanelV181 := `{"version":1,"appName":"Sun-Panel-Config","exportTime":"2026-11-25 02:56:43","appVersion":"1.8.1","md5":"419cfb4b040d1e463b24f138993c09d0","icons":[{"title":"服务列表","sort":0,"children":[{"icon":{"itemType":2,"src":"/uploads/2025/4/3/bec84bd0f92769117e3bf82192f0a26c.ico","text":"","backgroundColor":""},"sort":9999,"title":"CloudDrive2","url":"http://10.0.0.7:19798/","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"http://10.0.0.7:8096/web/favicon.ico","text":"","backgroundColor":""},"sort":9999,"title":"Rain's Media","url":"http://10.0.0.7:8096/web/index.html#!/home","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2025/4/4/ecee57ca252a0603fcccddb3691040b8.png","text":"","backgroundColor":""},"sort":9999,"title":"ImmortalWrt - LuCI","url":"http://10.0.0.3/cgi-bin/luci/","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"https://10.0.0.2:8006/pve2/images/logo-128.png","text":"","backgroundColor":""},"sort":9999,"title":"PVE","url":"https://10.0.0.2:8006/","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2025/4/4/89c1c3e83e0cb12fe877914ec573aff6.svg","text":"","backgroundColor":""},"sort":9999,"title":"Rain's GitTea","url":"http://10.0.0.7:4000/","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2025/4/4/92c66e8b8ef86e8f1c23b54c1bdc5abe.ico","text":"","backgroundColor":""},"sort":9999,"title":"Home Assistant","url":"http://10.0.0.155:8123","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2025/4/9/22da0ef7f30df40ea08caac362e481c5.ico","text":"","backgroundColor":""},"sort":9999,"title":"Misskey","url":"https://misskey.nekovo.dev/","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2025/4/14/a1076e8b1086a8e6b70a91194f495af5.png","text":"","backgroundColor":""},"sort":9999,"title":"qBittorrent","url":"http://10.0.0.7:8085/","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2025/4/14/b36897641597913ff03481789afe7a42.ico","text":"","backgroundColor":""},"sort":9999,"title":"PeerBanHelper","url":"http://10.0.0.7:9898/dashboard","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"https://cdn.wallpaperswide.com/templates/custom/ds/ds.1.png","text":"","backgroundColor":""},"sort":9999,"title":"小雅-Alist","url":"http://10.0.0.7:5678/","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2025/5/1/72cb54530e8e7a48d25ff724a104679c.ico","text":"","backgroundColor":""},"sort":9999,"title":"MoviePilot","url":"http://10.0.0.7:3000/#/login","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2025/8/31/64821326ba020e6b7bfa54df6222c3f6.svg","text":"","backgroundColor":""},"sort":9999,"title":"青龙面板","url":"http://10.0.0.7:5700/","lanUrl":"","description":"","openMethod":2,"cardType":1,"backgroundColor":"#2a2a2a6b","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2025/9/30/f29666f96f3490d395fe1c68a6ac32da.ico","text":"","backgroundColor":""},"sort":9999,"title":"饥荒服务器控制面板","url":"http://dst.i-f.work/","lanUrl":"http://10.0.0.7:8082/#/login","description":"","openMethod":2,"cardType":1,"backgroundColor":"#2a2a2a6b","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2026/1/20/1bde9cefcd810627f70cab3ea558dcec.png","text":"","backgroundColor":""},"sort":9999,"title":"MusciTag","url":"http://10.0.0.7:8002/#/","lanUrl":"http://10.0.0.7:8002/#/","description":"","openMethod":2,"cardType":1,"backgroundColor":"#2a2a2a6b","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2026/3/24/aec3f50d7528fb1e669e5329f3197c5e.png","text":"","backgroundColor":""},"sort":9999,"title":"米家自动化极客版","url":"http://10.0.0.55/","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2026/5/25/96282bd4a17f51cb084b8e26c675ac52.svg","text":"","backgroundColor":""},"sort":9999,"title":"AstrBot - 仪表盘","url":"http://10.0.0.11:6185/#/","lanUrl":"","description":"","openMethod":2,"cardType":0,"backgroundColor":"","expandParam":{}},{"icon":{"itemType":2,"src":"/uploads/2026/9/1/48701efd5ab1ce4f006de7173a05ea5f.ico","text":"","backgroundColor":""},"sort":9999,"title":"相册","url":"https://photo.i-f.work/auth/login","lanUrl":"http://10.0.0.7:2283","description":"","openMethod":2,"cardType":1,"backgroundColor":"#2a2a2a6b","expandParam":{}}],"cardStyle":{"style":0,"textColor":"#ffffff","textInfoHideDescription":false,"textIconHideTitle":false}}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/import/sunpanel", bytes.NewBufferString(sunPanelV181))
	req.RemoteAddr = "192.168.1.50:12345"
	req.Header.Set("Content-Type", "application/json")
	for _, c := range adminCookies {
		req.AddCookie(c)
	}
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("import sunpanel v1.8.1 got %d: %s", rr.Code, rr.Body.String())
	}
	var importRes struct {
		Imported int `json:"imported"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &importRes)
	if importRes.Imported != 17 {
		t.Fatalf("expected 17 imported bookmarks, got %d", importRes.Imported)
	}

	rr = doJSONReq(t, h, http.MethodGet, "/api/bookmarks", nil, adminCookies, "", "")
	var afterImport struct {
		Groups    []db.Group    `json:"groups"`
		Bookmarks []db.Bookmark `json:"bookmarks"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &afterImport)
	var serviceGroupID int64
	for _, g := range afterImport.Groups {
		if g.Name == "服务列表" {
			serviceGroupID = g.ID
		}
	}
	if serviceGroupID == 0 {
		t.Fatalf("expected group 服务列表 to be created, got %+v", afterImport.Groups)
	}
	byTitle := map[string]db.Bookmark{}
	for _, b := range afterImport.Bookmarks {
		byTitle[b.Title] = b
	}
	if bm := byTitle["CloudDrive2"]; bm.GroupID != serviceGroupID || bm.LANUrl != "http://10.0.0.7:19798/" || bm.WANUrl != "" || bm.Icon != "globe" {
		t.Fatalf("unexpected CloudDrive2 bookmark: %+v", bm)
	}
	if bm := byTitle["Rain's Media"]; bm.Icon != "http://10.0.0.7:8096/web/favicon.ico" {
		t.Fatalf("expected external icon preserved for Rain's Media, got %+v", bm)
	}
	if bm := byTitle["Misskey"]; bm.WANUrl != "https://misskey.nekovo.dev/" || bm.LANUrl != "" {
		t.Fatalf("unexpected Misskey bookmark: %+v", bm)
	}
	if bm := byTitle["MusciTag"]; bm.LANUrl != "http://10.0.0.7:8002/#/" || bm.WANUrl != "" || bm.Color != "#6366f1" {
		t.Fatalf("unexpected MusciTag bookmark: %+v", bm)
	}
	if bm := byTitle["相册"]; bm.LANUrl != "http://10.0.0.7:2283" || bm.WANUrl != "https://photo.i-f.work/auth/login" {
		t.Fatalf("unexpected 相册 bookmark: %+v", bm)
	}

	// 3. Rename group, batch move, and batch delete
	rr = doJSONReq(t, h, http.MethodPut, "/api/groups/"+strconv.FormatInt(serviceGroupID, 10), map[string]string{
		"name": "内网服务",
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("rename group got %d: %s", rr.Code, rr.Body.String())
	}

	moveIDs := []int64{byTitle["CloudDrive2"].ID, byTitle["Misskey"].ID}
	rr = doJSONReq(t, h, http.MethodPost, "/api/bookmarks/batch-move", map[string]any{
		"ids":      moveIDs,
		"group_id": initBM.Groups[0].ID,
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("batch move got %d: %s", rr.Code, rr.Body.String())
	}

	deleteIDs := []int64{byTitle["CloudDrive2"].ID, byTitle["MusciTag"].ID, byTitle["相册"].ID}
	rr = doJSONReq(t, h, http.MethodPost, "/api/bookmarks/batch-delete", map[string]any{
		"ids": deleteIDs,
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("batch delete got %d: %s", rr.Code, rr.Body.String())
	}
	var batchDelRes struct {
		Deleted int64 `json:"deleted"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &batchDelRes)
	if batchDelRes.Deleted != 3 {
		t.Fatalf("expected 3 deleted bookmarks, got %d", batchDelRes.Deleted)
	}

	// 4. Avatar upload, serve, persist in auth/me, and reset
	pngHeader := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
	var avBody bytes.Buffer
	mw := multipart.NewWriter(&avBody)
	fw, _ := mw.CreateFormFile("file", "avatar.png")
	_, _ = fw.Write(pngHeader)
	_ = mw.Close()

	avReq := httptest.NewRequest(http.MethodPost, "/api/auth/avatar", &avBody)
	avReq.RemoteAddr = "192.168.1.50:12345"
	avReq.Header.Set("Content-Type", mw.FormDataContentType())
	for _, c := range adminCookies {
		avReq.AddCookie(c)
	}
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, avReq)
	if rr.Code != http.StatusOK {
		t.Fatalf("upload avatar got %d: %s", rr.Code, rr.Body.String())
	}
	var avRes struct {
		Avatar string `json:"avatar"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &avRes)
	if avRes.Avatar == "" {
		t.Fatal("expected non-empty avatar url")
	}

	rr = doJSONReq(t, h, http.MethodGet, avRes.Avatar, nil, nil, "", "")
	if rr.Code != http.StatusOK || !bytes.Equal(rr.Body.Bytes(), pngHeader) {
		t.Fatalf("serve avatar failed: %d", rr.Code)
	}

	rr = doJSONReq(t, h, http.MethodGet, "/api/auth/me", nil, adminCookies, "", "")
	var meRes struct {
		User db.User `json:"user"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &meRes)
	if meRes.User.Avatar != avRes.Avatar {
		t.Fatalf("expected user avatar %q, got %q", avRes.Avatar, meRes.User.Avatar)
	}

	rr = doJSONReq(t, h, http.MethodDelete, "/api/auth/avatar", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("delete avatar got %d: %s", rr.Code, rr.Body.String())
	}
	rr = doJSONReq(t, h, http.MethodGet, avRes.Avatar, nil, nil, "", "")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("deleted avatar expected 404, got %d", rr.Code)
	}
}

func TestPluginProtocolTiersPolicyAndFileManager(t *testing.T) {
	_, h := newTestKernel(t, 10)

	// Setup admin + sub-account
	rr := doJSONReq(t, h, http.MethodPost, "/api/auth/setup", map[string]string{
		"username": "admin",
		"password": "password123",
	}, nil, "", "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("setup got %d: %s", rr.Code, rr.Body.String())
	}
	adminCookies := rr.Result().Cookies()

	rr = doJSONReq(t, h, http.MethodPost, "/api/auth/users", map[string]any{
		"username": "member",
		"password": "password123",
	}, adminCookies, "", "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("create member got %d: %s", rr.Code, rr.Body.String())
	}
	rr = doJSONReq(t, h, http.MethodPost, "/api/auth/login", map[string]string{
		"username": "member",
		"password": "password123",
	}, nil, "", "")
	memberCookies := rr.Result().Cookies()

	// 1. Verify 5 core + 3 light official plugins
	rr = doJSONReq(t, h, http.MethodGet, "/api/plugins", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list plugins got %d", rr.Code)
	}
	var pRes struct {
		Plugins []plugin.PluginStateRecord `json:"plugins"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &pRes)
	coreCount, lightCount := 0, 0
	for _, rec := range pRes.Plugins {
		switch rec.Manifest.Tier {
		case "core":
			coreCount++
		case "light":
			lightCount++
		default:
			t.Fatalf("unexpected plugin tier %q for %s", rec.Manifest.Tier, rec.Manifest.ID)
		}
		if rec.Manifest.Source != "official" {
			t.Fatalf("expected official source for %s, got %q", rec.Manifest.ID, rec.Manifest.Source)
		}
	}
	if coreCount != 5 || lightCount != 3 {
		t.Fatalf("expected 5 core + 3 light plugins, got core=%d light=%d", coreCount, lightCount)
	}

	// 2. Visibility + Style overrides on hitokoto
	managed := true
	cardless := true
	rr = doJSONReq(t, h, http.MethodPatch, "/api/plugins/orbit.hitokoto", map[string]any{
		"visibility": map[string]any{
			"minRole":   "admin",
			"guestMode": "hidden",
		},
		"style": map[string]any{
			"managed":  managed,
			"cardless": cardless,
		},
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("patch plugin policy got %d: %s", rr.Code, rr.Body.String())
	}

	// Member should now be blocked from hitokoto plugin route, admin still allowed
	rr = doJSONReq(t, h, http.MethodGet, "/api/hitokoto?mode=builtin", nil, memberCookies, "", "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for member on admin-only hitokoto, got %d", rr.Code)
	}
	rr = doJSONReq(t, h, http.MethodGet, "/api/hitokoto?mode=builtin", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for admin on admin-only hitokoto, got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify persisted overrides returned in listPlugins
	rr = doJSONReq(t, h, http.MethodGet, "/api/plugins", nil, adminCookies, "", "")
	_ = json.Unmarshal(rr.Body.Bytes(), &pRes)
	foundPolicy := false
	for _, rec := range pRes.Plugins {
		if rec.Manifest.ID == "orbit.hitokoto" {
			if rec.Visibility == nil || rec.Visibility.MinRole != "admin" {
				t.Fatalf("visibility override not persisted: %+v", rec.Visibility)
			}
			if rec.Style == nil || rec.Style.Cardless == nil || !*rec.Style.Cardless {
				t.Fatalf("style override not persisted: %+v", rec.Style)
			}
			foundPolicy = true
		}
	}
	if !foundPolicy {
		t.Fatal("orbit.hitokoto not found in plugin list")
	}

	// 3. Staged file management: permanent upload, rename, inline preview, batch delete
	uploadFile := func(name string, content []byte, permanent bool, cookies []*http.Cookie) int64 {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		if permanent {
			_ = mw.WriteField("permanent", "1")
			_ = mw.WriteField("ttl_hours", "0")
		} else {
			_ = mw.WriteField("ttl_hours", "24")
		}
		fw, _ := mw.CreateFormFile("file", name)
		_, _ = fw.Write(content)
		_ = mw.Close()
		req := httptest.NewRequest(http.MethodPost, "/api/files", &body)
		req.RemoteAddr = "192.168.1.50:12345"
		req.Header.Set("Content-Type", mw.FormDataContentType())
		for _, c := range cookies {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("upload %s got %d: %s", name, rec.Code, rec.Body.String())
		}
		var out struct {
			File struct {
				ID        int64  `json:"id"`
				ExpiresAt string `json:"expires_at"`
			} `json:"file"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if permanent && !strings.HasPrefix(out.File.ExpiresAt, "9999-") {
			t.Fatalf("expected permanent expires_at 9999-..., got %q", out.File.ExpiresAt)
		}
		return out.File.ID
	}

	f1 := uploadFile("notes.txt", []byte("hello orbit"), true, adminCookies)
	f2 := uploadFile("temp.txt", []byte("temp"), false, adminCookies)

	// Rename + update TTL on f2
	rr = doJSONReq(t, h, http.MethodPatch, "/api/files/"+strconv.FormatInt(f2, 10), map[string]any{
		"orig_name": "renamed.txt",
		"permanent": true,
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("patch file got %d: %s", rr.Code, rr.Body.String())
	}

	// Inline preview header check
	rr = doJSONReq(t, h, http.MethodGet, "/api/files/"+strconv.FormatInt(f1, 10)+"/download?inline=1", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK || !strings.HasPrefix(rr.Header().Get("Content-Disposition"), "inline;") {
		t.Fatalf("expected inline disposition, got code=%d header=%q", rr.Code, rr.Header().Get("Content-Disposition"))
	}

	// Batch delete both staged files
	rr = doJSONReq(t, h, http.MethodPost, "/api/files/batch-delete", map[string]any{
		"ids": []int64{f1, f2},
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("batch delete files got %d: %s", rr.Code, rr.Body.String())
	}
	var delFilesRes struct {
		Deleted int `json:"deleted"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &delFilesRes)
	if delFilesRes.Deleted != 2 {
		t.Fatalf("expected 2 deleted files, got %d", delFilesRes.Deleted)
	}

	// 4. Unified asset manager: upload wallpaper + icon, list, ownership check, batch delete
	pngBytes := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
	uploadMultipartPath := func(path, field, filename string, data []byte, cookies []*http.Cookie) string {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		fw, _ := mw.CreateFormFile(field, filename)
		_, _ = fw.Write(data)
		_ = mw.Close()
		req := httptest.NewRequest(http.MethodPost, path, &body)
		req.RemoteAddr = "192.168.1.50:12345"
		req.Header.Set("Content-Type", mw.FormDataContentType())
		for _, c := range cookies {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
			t.Fatalf("upload %s got %d: %s", path, rec.Code, rec.Body.String())
		}
		var out struct {
			URL string `json:"url"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out.URL
	}

	wpURL := uploadMultipartPath("/api/wallpaper/upload", "file", "bg.png", pngBytes, adminCookies)
	iconURL := uploadMultipartPath("/api/icons/upload", "file", "app.png", pngBytes, adminCookies)
	wpName := filepath.Base(wpURL)
	iconName := filepath.Base(iconURL)

	rr = doJSONReq(t, h, http.MethodGet, "/api/assets?category=all", nil, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list assets got %d: %s", rr.Code, rr.Body.String())
	}
	var assetsRes struct {
		Assets []struct {
			Category string `json:"category"`
			Name     string `json:"name"`
			Owned    bool   `json:"owned"`
		} `json:"assets"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &assetsRes)
	if len(assetsRes.Assets) < 2 {
		t.Fatalf("expected >= 2 assets, got %+v", assetsRes.Assets)
	}

	// Member must not delete admin's wallpaper
	rr = doJSONReq(t, h, http.MethodDelete, "/api/assets/wallpapers/"+wpName, nil, memberCookies, "", "")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("member deleting admin asset expected 403, got %d", rr.Code)
	}

	// Admin batch-deletes both assets
	rr = doJSONReq(t, h, http.MethodPost, "/api/assets/batch-delete", map[string]any{
		"items": []map[string]string{
			{"category": "wallpapers", "name": wpName},
			{"category": "icons", "name": iconName},
		},
	}, adminCookies, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("batch delete assets got %d: %s", rr.Code, rr.Body.String())
	}
	var delAssetsRes struct {
		Deleted int `json:"deleted"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &delAssetsRes)
	if delAssetsRes.Deleted != 2 {
		t.Fatalf("expected 2 deleted assets, got %d", delAssetsRes.Deleted)
	}
}

func TestTargetedWSNotifications(t *testing.T) {
	_, h := newTestKernel(t, 10)
	srv := httptest.NewServer(h)
	defer srv.Close()

	// Setup user
	rr := doJSONReq(t, h, http.MethodPost, "/api/auth/setup", map[string]string{
		"username": "wsuser",
		"password": "password123",
	}, nil, "", "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("setup got %d", rr.Code)
	}
	cookies := rr.Result().Cookies()
	cookieHeader := http.Header{}
	for _, c := range cookies {
		cookieHeader.Add("Cookie", c.Name+"="+c.Value)
	}

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/ws?device="
	dialPeer := func(name string) (*websocket.Conn, string) {
		conn, _, err := websocket.DefaultDialer.Dial(wsURL+name, cookieHeader)
		if err != nil {
			t.Fatalf("dial %s: %v", name, err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read initial peers for %s: %v", name, err)
		}
		var env struct {
			Type    string `json:"type"`
			Payload struct {
				SelfPeerID string `json:"self_peer_id"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(data, &env); err != nil || env.Type != "peers_updated" || env.Payload.SelfPeerID == "" {
			t.Fatalf("unexpected initial ws frame for %s: %s", name, string(data))
		}
		return conn, env.Payload.SelfPeerID
	}

	connA, peerA := dialPeer("DeviceA")
	connB, peerB := dialPeer("DeviceB")
	connC, peerC := dialPeer("DeviceC")

	readEventOfType := func(conn *websocket.Conn, wantType string, timeout time.Duration) (map[string]any, bool) {
		deadline := time.Now().Add(timeout)
		for time.Now().Before(deadline) {
			_ = conn.SetReadDeadline(deadline)
			_, data, err := conn.ReadMessage()
			if err != nil {
				return nil, false
			}
			var env struct {
				Type    string         `json:"type"`
				Payload map[string]any `json:"payload"`
			}
			if json.Unmarshal(data, &env) == nil && env.Type == wantType {
				return env.Payload, true
			}
		}
		return nil, false
	}

	// 1. PeerA sends clip specifically targeting PeerB
	bodyBytes, _ := json.Marshal(map[string]string{
		"content":        "only notify B",
		"target_peer_id": peerB,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/clips", bytes.NewReader(bodyBytes))
	req.RemoteAddr = "192.168.1.50:12345"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Orbit-Peer-Id", peerA)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("targeted clip create got %d: %s", rec.Code, rec.Body.String())
	}

	// PeerB must receive notify=true
	evB, okB := readEventOfType(connB, "clip_updated", 2*time.Second)
	if !okB || evB["notify"] != true || evB["target_peer_id"] != peerB {
		t.Fatalf("expected PeerB notify=true, got ok=%v ev=%+v", okB, evB)
	}
	// PeerC must receive silent sync (notify=false)
	evC, okC := readEventOfType(connC, "clip_updated", 2*time.Second)
	if !okC || evC["notify"] != false {
		t.Fatalf("expected PeerC notify=false, got ok=%v ev=%+v", okC, evC)
	}
	// Sender PeerA must NOT receive a notification frame
	if evA, okA := readEventOfType(connA, "clip_updated", 250*time.Millisecond); okA {
		t.Fatalf("sender PeerA should not receive clip_updated frame, got %+v", evA)
	}

	// 2. PeerA uploads file specifically targeting PeerC
	var upBody bytes.Buffer
	mw := multipart.NewWriter(&upBody)
	_ = mw.WriteField("target_peer_id", peerC)
	fw, _ := mw.CreateFormFile("file", "for-c.txt")
	_, _ = fw.Write([]byte("target-c-only"))
	_ = mw.Close()
	upReq := httptest.NewRequest(http.MethodPost, "/api/files", &upBody)
	upReq.RemoteAddr = "192.168.1.50:12345"
	upReq.Header.Set("Content-Type", mw.FormDataContentType())
	upReq.Header.Set("X-Orbit-Peer-Id", peerA)
	for _, c := range cookies {
		upReq.AddCookie(c)
	}
	upRec := httptest.NewRecorder()
	h.ServeHTTP(upRec, upReq)
	if upRec.Code != http.StatusCreated {
		t.Fatalf("targeted file upload got %d: %s", upRec.Code, upRec.Body.String())
	}

	fEvC, fOkC := readEventOfType(connC, "files_updated", 2*time.Second)
	if !fOkC || fEvC["notify"] != true || fEvC["target_peer_id"] != peerC {
		t.Fatalf("expected PeerC file notify=true, got ok=%v ev=%+v", fOkC, fEvC)
	}
	fEvB, fOkB := readEventOfType(connB, "files_updated", 2*time.Second)
	if !fOkB || fEvB["notify"] != false {
		t.Fatalf("expected PeerB file notify=false, got ok=%v ev=%+v", fOkB, fEvB)
	}
	if fEvA, fOkA := readEventOfType(connA, "files_updated", 250*time.Millisecond); fOkA {
		t.Fatalf("sender PeerA should not receive files_updated frame, got %+v", fEvA)
	}
}
