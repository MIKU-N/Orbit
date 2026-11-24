package bookmarks

import (
	"database/sql"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"regexp"
	"sort"
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
		ID:             "orbit.bookmarks",
		Name:           "极简导航",
		Version:        "1.0.0",
		Description:    "三网自适应路由书签分组、拖拽排序、浏览器 HTML 与 Sun-Panel 导入",
		Icon:           "bookmark",
		Tier:           "builtin",
		DefaultEnabled: true,
		Access: plugin.AccessSpec{
			MinRole: "user",
			Guest:   plugin.GuestSpec{Mode: "hidden"},
			Sharing: &plugin.SharingSpec{
				Shareable:     true,
				ScopeKey:      "bookmarks",
				Label:         "书签",
				DefaultShared: false,
				Mode:          "readonly",
			},
		},
		Contributes: plugin.ContributesSpec{
			Widgets: []plugin.WidgetContrib{
				{
					ID:             "main",
					LayoutKey:      "bookmarks",
					Label:          "书签",
					MinW:           300,
					DefaultW:       980,
					Resizable:      true,
					DefaultVisible: true,
				},
			},
			Settings: &plugin.SettingsContrib{
				TabID:          "bookmarks",
				Label:          "书签管理",
				Icon:           "bookmark",
				SearchKeywords: []string{"书签", "分组", "导入", "浏览器", "html", "sun-panel", "卡片视图", "图标视图", "批量删除", "编辑", "列表"},
			},
			SearchProvider: &plugin.SearchProviderContrib{
				Enabled:  true,
				Priority: 10,
			},
		},
	}
}

func (p *Plugin) Init(host plugin.Host) error {
	p.host = host
	return nil
}

func (p *Plugin) RegisterRoutes(r plugin.RouteGroup) {
	r.HandleAuth("GET /groups", p.handleListGroups)
	r.HandleAuth("POST /groups", p.handleCreateGroup)
	r.HandleAuth("PUT /groups/{id}", p.handleUpdateGroup)
	r.HandleAuth("DELETE /groups/{id}", p.handleDeleteGroup)
	r.HandleAuth("GET /bookmarks", p.handleListBookmarks)
	r.HandleAuth("POST /bookmarks", p.handleCreateBookmark)
	r.HandleAuth("PUT /bookmarks/reorder", p.handleReorderBookmarks)
	r.HandleAuth("POST /bookmarks/batch-delete", p.handleBatchDeleteBookmarks)
	r.HandleAuth("POST /bookmarks/batch-move", p.handleBatchMoveBookmarks)
	r.HandleAuth("PUT /bookmarks/{id}", p.handleUpdateBookmark)
	r.HandleAuth("DELETE /bookmarks/{id}", p.handleDeleteBookmark)
	r.HandleAuth("POST /import/sunpanel", p.handleImportSunPanel)
	r.HandleAuth("POST /import/browser", p.handleImportBrowserBookmarks)

	// Compat routes
	r.HandleCompat("GET /api/groups", p.handleListGroups, true)
	r.HandleCompat("POST /api/groups", p.handleCreateGroup, true)
	r.HandleCompat("PUT /api/groups/{id}", p.handleUpdateGroup, true)
	r.HandleCompat("DELETE /api/groups/{id}", p.handleDeleteGroup, true)
	r.HandleCompat("GET /api/bookmarks", p.handleListBookmarks, true)
	r.HandleCompat("POST /api/bookmarks", p.handleCreateBookmark, true)
	r.HandleCompat("PUT /api/bookmarks/reorder", p.handleReorderBookmarks, true)
	r.HandleCompat("POST /api/bookmarks/batch-delete", p.handleBatchDeleteBookmarks, true)
	r.HandleCompat("POST /api/bookmarks/batch-move", p.handleBatchMoveBookmarks, true)
	r.HandleCompat("PUT /api/bookmarks/{id}", p.handleUpdateBookmark, true)
	r.HandleCompat("DELETE /api/bookmarks/{id}", p.handleDeleteBookmark, true)
	r.HandleCompat("POST /api/bookmarks/import/sunpanel", p.handleImportSunPanel, true)
	r.HandleCompat("POST /api/bookmarks/import/browser", p.handleImportBrowserBookmarks, true)
}

func (p *Plugin) handleListGroups(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	shareOwner := p.host.Auth().SharedOwnerID(u, "bookmarks")

	var (
		rows *sql.Rows
		err  error
	)
	if shareOwner > 0 && shareOwner != u.ID {
		rows, err = p.host.DB().Query(
			`SELECT id, user_id, name, sort_order, created_at FROM groups
			 WHERE user_id IN (?, ?)
			 ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, sort_order ASC, id ASC`,
			u.ID, shareOwner, u.ID,
		)
	} else {
		rows, err = p.host.DB().Query(
			`SELECT id, user_id, name, sort_order, created_at FROM groups WHERE user_id = ? ORDER BY sort_order ASC, id ASC`,
			u.ID,
		)
	}
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()

	groups := make([]db.Group, 0)
	for rows.Next() {
		var g db.Group
		if err := rows.Scan(&g.ID, &g.UserID, &g.Name, &g.SortOrder, &g.CreatedAt); err == nil {
			g.Shared = g.UserID != u.ID
			groups = append(groups, g)
		}
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

func (p *Plugin) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	var req struct {
		Name string `json:"name"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "group name required")
		return
	}
	var maxOrder int
	_ = p.host.DB().QueryRow(`SELECT COALESCE(MAX(sort_order), -1) FROM groups WHERE user_id = ?`, u.ID).Scan(&maxOrder)
	now := time.Now().UTC()
	res, err := p.host.DB().Exec(
		`INSERT INTO groups (user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)`,
		u.ID, req.Name, maxOrder+1, now,
	)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "failed to create group")
		return
	}
	id, _ := res.LastInsertId()
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{
		"group": db.Group{ID: id, UserID: u.ID, Name: req.Name, SortOrder: maxOrder + 1, CreatedAt: now},
	})
}

func (p *Plugin) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid group id")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "group name required")
		return
	}
	res, err := p.host.DB().Exec(`UPDATE groups SET name = ? WHERE id = ? AND user_id = ?`, req.Name, id, u.ID)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		plugin.WriteErr(w, http.StatusNotFound, "group not found")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id, "name": req.Name})
}

func (p *Plugin) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid group id")
		return
	}
	res, err := p.host.DB().Exec(`DELETE FROM groups WHERE id = ? AND user_id = ?`, id, u.ID)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		plugin.WriteErr(w, http.StatusNotFound, "group not found")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (p *Plugin) handleListBookmarks(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	shareOwner := p.host.Auth().SharedOwnerID(u, "bookmarks")

	var (
		gRows *sql.Rows
		err   error
	)
	if shareOwner > 0 && shareOwner != u.ID {
		gRows, err = p.host.DB().Query(
			`SELECT id, user_id, name, sort_order, created_at FROM groups
			 WHERE user_id IN (?, ?)
			 ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, sort_order ASC, id ASC`,
			u.ID, shareOwner, u.ID,
		)
	} else {
		gRows, err = p.host.DB().Query(
			`SELECT id, user_id, name, sort_order, created_at FROM groups WHERE user_id = ? ORDER BY sort_order ASC, id ASC`,
			u.ID,
		)
	}
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	groups := make([]db.Group, 0)
	for gRows.Next() {
		var g db.Group
		if err := gRows.Scan(&g.ID, &g.UserID, &g.Name, &g.SortOrder, &g.CreatedAt); err == nil {
			g.Shared = g.UserID != u.ID
			groups = append(groups, g)
		}
	}
	gRows.Close()

	var bRows *sql.Rows
	if shareOwner > 0 && shareOwner != u.ID {
		bRows, err = p.host.DB().Query(
			`SELECT id, user_id, group_id, title, description, lan_url, ts_url, wan_url, icon, color, sort_order, created_at
			 FROM bookmarks WHERE user_id IN (?, ?)
			 ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, sort_order ASC, id ASC`,
			u.ID, shareOwner, u.ID,
		)
	} else {
		bRows, err = p.host.DB().Query(
			`SELECT id, user_id, group_id, title, description, lan_url, ts_url, wan_url, icon, color, sort_order, created_at
			 FROM bookmarks WHERE user_id = ? ORDER BY sort_order ASC, id ASC`,
			u.ID,
		)
	}
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	defer bRows.Close()

	bookmarks := make([]db.Bookmark, 0)
	for bRows.Next() {
		var b db.Bookmark
		if err := bRows.Scan(
			&b.ID, &b.UserID, &b.GroupID, &b.Title, &b.Description,
			&b.LANUrl, &b.TSUrl, &b.WANUrl, &b.Icon, &b.Color, &b.SortOrder, &b.CreatedAt,
		); err == nil {
			b.Shared = b.UserID != u.ID
			bookmarks = append(bookmarks, b)
		}
	}

	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"groups":    groups,
		"bookmarks": bookmarks,
	})
}

func (p *Plugin) handleCreateBookmark(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	var req struct {
		GroupID     int64  `json:"group_id"`
		Title       string `json:"title"`
		Description string `json:"description"`
		LANUrl      string `json:"lan_url"`
		TSUrl       string `json:"ts_url"`
		WANUrl      string `json:"wan_url"`
		Icon        string `json:"icon"`
		Color       string `json:"color"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "title required")
		return
	}
	gid, err := p.resolveOrCreateGroup(u.ID, req.GroupID, "默认")
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid group")
		return
	}
	if strings.TrimSpace(req.Icon) == "" {
		req.Icon = "globe"
	}
	if strings.TrimSpace(req.Color) == "" {
		req.Color = "#6366f1"
	}

	var maxOrder int
	_ = p.host.DB().QueryRow(`SELECT COALESCE(MAX(sort_order), -1) FROM bookmarks WHERE user_id = ?`, u.ID).Scan(&maxOrder)
	now := time.Now().UTC()
	res, err := p.host.DB().Exec(
		`INSERT INTO bookmarks (user_id, group_id, title, description, lan_url, ts_url, wan_url, icon, color, sort_order, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, gid, req.Title, strings.TrimSpace(req.Description),
		strings.TrimSpace(req.LANUrl), strings.TrimSpace(req.TSUrl), strings.TrimSpace(req.WANUrl),
		strings.TrimSpace(req.Icon), strings.TrimSpace(req.Color), maxOrder+1, now,
	)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "failed to create bookmark")
		return
	}
	id, _ := res.LastInsertId()
	plugin.WriteJSON(w, http.StatusCreated, map[string]any{
		"bookmark": db.Bookmark{
			ID: id, UserID: u.ID, GroupID: gid, Title: req.Title, Description: strings.TrimSpace(req.Description),
			LANUrl: strings.TrimSpace(req.LANUrl), TSUrl: strings.TrimSpace(req.TSUrl), WANUrl: strings.TrimSpace(req.WANUrl),
			Icon: strings.TrimSpace(req.Icon), Color: strings.TrimSpace(req.Color), SortOrder: maxOrder + 1, CreatedAt: now,
		},
	})
}

func (p *Plugin) handleUpdateBookmark(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid bookmark id")
		return
	}
	var req struct {
		GroupID     int64  `json:"group_id"`
		Title       string `json:"title"`
		Description string `json:"description"`
		LANUrl      string `json:"lan_url"`
		TSUrl       string `json:"ts_url"`
		WANUrl      string `json:"wan_url"`
		Icon        string `json:"icon"`
		Color       string `json:"color"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "title required")
		return
	}
	gid, err := p.resolveOrCreateGroup(u.ID, req.GroupID, "默认")
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid group")
		return
	}
	if strings.TrimSpace(req.Icon) == "" {
		req.Icon = "globe"
	}
	if strings.TrimSpace(req.Color) == "" {
		req.Color = "#6366f1"
	}
	res, err := p.host.DB().Exec(
		`UPDATE bookmarks SET group_id = ?, title = ?, description = ?, lan_url = ?, ts_url = ?, wan_url = ?, icon = ?, color = ?
		 WHERE id = ? AND user_id = ?`,
		gid, req.Title, strings.TrimSpace(req.Description),
		strings.TrimSpace(req.LANUrl), strings.TrimSpace(req.TSUrl), strings.TrimSpace(req.WANUrl),
		strings.TrimSpace(req.Icon), strings.TrimSpace(req.Color), id, u.ID,
	)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		plugin.WriteErr(w, http.StatusNotFound, "bookmark not found")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (p *Plugin) handleDeleteBookmark(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid bookmark id")
		return
	}
	res, err := p.host.DB().Exec(`DELETE FROM bookmarks WHERE id = ? AND user_id = ?`, id, u.ID)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		plugin.WriteErr(w, http.StatusNotFound, "bookmark not found")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (p *Plugin) handleBatchDeleteBookmarks(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	seen := make(map[int64]struct{}, len(req.IDs))
	ids := make([]int64, 0, len(req.IDs))
	for _, id := range req.IDs {
		if id > 0 {
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				ids = append(ids, id)
			}
		}
	}
	if len(ids) == 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "请选择要删除的书签")
		return
	}

	tx, err := p.host.DB().Begin()
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback()

	var deleted int64
	for _, id := range ids {
		res, err := tx.Exec(`DELETE FROM bookmarks WHERE id = ? AND user_id = ?`, id, u.ID)
		if err != nil {
			plugin.WriteErr(w, http.StatusInternalServerError, "database error")
			return
		}
		aff, _ := res.RowsAffected()
		deleted += aff
	}
	if err := tx.Commit(); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
}

func (p *Plugin) handleBatchMoveBookmarks(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	var req struct {
		IDs     []int64 `json:"ids"`
		GroupID int64   `json:"group_id"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(req.IDs) == 0 || req.GroupID <= 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid bookmark ids or group_id")
		return
	}
	var exists int64
	if err := p.host.DB().QueryRow(`SELECT id FROM groups WHERE id = ? AND user_id = ?`, req.GroupID, u.ID).Scan(&exists); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "目标分组不存在")
		return
	}

	tx, err := p.host.DB().Begin()
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback()

	var moved int64
	for _, id := range req.IDs {
		if id <= 0 {
			continue
		}
		res, err := tx.Exec(`UPDATE bookmarks SET group_id = ? WHERE id = ? AND user_id = ?`, req.GroupID, id, u.ID)
		if err != nil {
			plugin.WriteErr(w, http.StatusInternalServerError, "database error")
			return
		}
		aff, _ := res.RowsAffected()
		moved += aff
	}
	if err := tx.Commit(); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "moved": moved})
}

func (p *Plugin) handleReorderBookmarks(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := plugin.DecodeJSON(r, &req); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	tx, err := p.host.DB().Begin()
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback()

	for idx, bid := range req.IDs {
		if _, err := tx.Exec(`UPDATE bookmarks SET sort_order = ? WHERE id = ? AND user_id = ?`, idx, bid, u.ID); err != nil {
			plugin.WriteErr(w, http.StatusInternalServerError, "database error")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "database error")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type rawSunIcon struct {
	ItemType        int    `json:"itemType"`
	Src             string `json:"src"`
	Text            string `json:"text"`
	BackgroundColor string `json:"backgroundColor"`
}

type rawSunNode struct {
	Title           string          `json:"title"`
	Name            string          `json:"name"`
	Description     string          `json:"description"`
	Desc            string          `json:"desc"`
	URL             string          `json:"url"`
	LanURL          string          `json:"lanUrl"`
	LanURLSnake     string          `json:"lan_url"`
	WanURL          string          `json:"wanUrl"`
	WanURLSnake     string          `json:"wan_url"`
	TsURL           string          `json:"tsUrl"`
	TsURLSnake      string          `json:"ts_url"`
	Group           string          `json:"group"`
	GroupName       string          `json:"groupName"`
	Sort            int             `json:"sort"`
	BackgroundColor string          `json:"backgroundColor"`
	Icon            json.RawMessage `json:"icon"`
	Items           []rawSunNode    `json:"items"`
	Children        []rawSunNode    `json:"children"`
	Icons           []rawSunNode    `json:"icons"`
}

func normalizeHexColor(raw string) string {
	s := strings.TrimSpace(raw)
	if !strings.HasPrefix(s, "#") {
		return ""
	}
	hexPart := s[1:]
	if len(hexPart) == 3 {
		for i := 0; i < 3; i++ {
			if !isHexChar(hexPart[i]) {
				return ""
			}
		}
		return strings.ToLower("#" + string([]byte{hexPart[0], hexPart[0], hexPart[1], hexPart[1], hexPart[2], hexPart[2]}))
	}
	if len(hexPart) == 6 {
		for i := 0; i < 6; i++ {
			if !isHexChar(hexPart[i]) {
				return ""
			}
		}
		return strings.ToLower(s)
	}
	return ""
}

func isHexChar(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

func isUsableIconSrc(raw string) bool {
	s := strings.TrimSpace(raw)
	if s == "" {
		return false
	}
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return true
	}
	if strings.HasPrefix(lower, "data:image/") && len(s) <= 65536 {
		return true
	}
	return false
}

func parseSunIconAndColor(rawIcon json.RawMessage, itemBg string) (string, string) {
	iconVal := "globe"
	colorVal := "#6366f1"

	trimmed := strings.TrimSpace(string(rawIcon))
	if trimmed != "" && trimmed != "null" {
		var iconStr string
		if err := json.Unmarshal(rawIcon, &iconStr); err == nil {
			if isUsableIconSrc(iconStr) {
				iconVal = strings.TrimSpace(iconStr)
			}
		} else {
			var obj rawSunIcon
			if err := json.Unmarshal(rawIcon, &obj); err == nil {
				if c := normalizeHexColor(obj.BackgroundColor); c != "" {
					colorVal = c
				}
				switch obj.ItemType {
				case 1:
					if t := strings.TrimSpace(obj.Text); t != "" {
						iconVal = "text:" + t
					}
				default:
					if isUsableIconSrc(obj.Src) {
						iconVal = strings.TrimSpace(obj.Src)
					} else if t := strings.TrimSpace(obj.Text); t != "" {
						iconVal = "text:" + t
					}
				}
			}
		}
	}

	if colorVal == "#6366f1" {
		if c := normalizeHexColor(itemBg); c != "" {
			colorVal = c
		}
	}
	return iconVal, colorVal
}

func (p *Plugin) handleImportSunPanel(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	raw, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "failed to read body")
		return
	}

	cleaned := strings.TrimSpace(strings.TrimPrefix(string(raw), "\ufeff"))
	if cleaned == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "JSON 内容不能为空")
		return
	}
	rawBytes := []byte(cleaned)

	var roots []rawSunNode
	var parseContainer func(data []byte) error
	parseContainer = func(data []byte) error {
		t := strings.TrimSpace(string(data))
		if t == "" || t == "null" {
			return nil
		}
		if strings.HasPrefix(t, "[") {
			var arr []rawSunNode
			if err := json.Unmarshal(data, &arr); err != nil {
				return err
			}
			roots = append(roots, arr...)
			return nil
		}
		if strings.HasPrefix(t, "{") {
			var wrapped struct {
				Groups   []rawSunNode    `json:"groups"`
				Icons    []rawSunNode    `json:"icons"`
				Items    []rawSunNode    `json:"items"`
				Children []rawSunNode    `json:"children"`
				Data     json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(data, &wrapped); err != nil {
				return err
			}
			roots = append(roots, wrapped.Groups...)
			roots = append(roots, wrapped.Icons...)
			roots = append(roots, wrapped.Items...)
			roots = append(roots, wrapped.Children...)
			if len(wrapped.Data) > 0 && strings.TrimSpace(string(wrapped.Data)) != "null" {
				if err := parseContainer(wrapped.Data); err != nil {
					return err
				}
			}
			// Fallback: single bookmark/group object directly
			if len(roots) == 0 {
				var single rawSunNode
				if err := json.Unmarshal(data, &single); err == nil && (single.Title != "" || single.Name != "") {
					roots = append(roots, single)
				}
			}
			return nil
		}
		return json.Unmarshal(data, &roots)
	}

	if err := parseContainer(rawBytes); err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "无法解析 Sun-Panel JSON，请检查文件内容是否完整")
		return
	}

	imported := 0
	var maxOrder int
	_ = p.host.DB().QueryRow(`SELECT COALESCE(MAX(sort_order), -1) FROM bookmarks WHERE user_id = ?`, u.ID).Scan(&maxOrder)
	now := time.Now().UTC()

	insertLeaf := func(groupName string, it rawSunNode) {
		title := plugin.FirstNonEmpty(it.Title, it.Name)
		if title == "" {
			return
		}
		lanURL := plugin.FirstNonEmpty(it.LanURL, it.LanURLSnake)
		tsURL := plugin.FirstNonEmpty(it.TsURL, it.TsURLSnake)
		wanURL := plugin.FirstNonEmpty(it.WanURL, it.WanURLSnake, it.URL)

		if wanURL != "" {
			if plugin.IsLikelyLocalURL(wanURL) {
				if lanURL == "" {
					lanURL = wanURL
				}
				wanURL = ""
			} else if plugin.IsTailscaleURL(wanURL) {
				if tsURL == "" {
					tsURL = wanURL
				}
				wanURL = ""
			}
		}
		if lanURL != "" && tsURL == "" && plugin.IsTailscaleURL(lanURL) {
			tsURL = lanURL
			lanURL = ""
		}
		if lanURL == "" && tsURL == "" && wanURL == "" {
			return
		}

		gName := plugin.FirstNonEmpty(groupName, it.Group, it.GroupName, "导入书签")
		gid, err := p.findOrCreateGroupByName(u.ID, gName)
		if err != nil {
			return
		}

		desc := plugin.FirstNonEmpty(it.Description, it.Desc)
		iconVal, colorVal := parseSunIconAndColor(it.Icon, it.BackgroundColor)
		maxOrder++
		if _, err := p.host.DB().Exec(
			`INSERT INTO bookmarks (user_id, group_id, title, description, lan_url, ts_url, wan_url, icon, color, sort_order, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			u.ID, gid, title, desc, lanURL, tsURL, wanURL, iconVal, colorVal, maxOrder, now,
		); err == nil {
			imported++
		}
	}

	var walkNodes func(nodes []rawSunNode, parentGroup string)
	walkNodes = func(nodes []rawSunNode, parentGroup string) {
		if len(nodes) == 0 {
			return
		}
		ordered := append([]rawSunNode(nil), nodes...)
		sort.SliceStable(ordered, func(i, j int) bool {
			return ordered[i].Sort < ordered[j].Sort
		})
		for _, node := range ordered {
			hasChildren := len(node.Children) > 0 || len(node.Items) > 0 || len(node.Icons) > 0
			if hasChildren {
				gName := plugin.FirstNonEmpty(node.Title, node.Name, parentGroup)
				walkNodes(node.Children, gName)
				walkNodes(node.Items, gName)
				walkNodes(node.Icons, gName)
				continue
			}
			insertLeaf(parentGroup, node)
		}
	}

	walkNodes(roots, "")
	if imported == 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "未在 JSON 中识别到可导入的书签条目，请确认是 Sun-Panel 导出的配置文件")
		return
	}

	plugin.WriteJSON(w, http.StatusOK, map[string]any{"imported": imported})
}

var (
	browserAnchorRe = regexp.MustCompile(`(?is)<a\b([^>]*)>(.*?)</a>`)
	attrHrefRe      = regexp.MustCompile(`(?is)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`)
	attrIconRe      = regexp.MustCompile(`(?is)\bicon\s*=\s*(?:"([^"]*)"|'([^']*)')`)
	stripHTMLTagRe  = regexp.MustCompile(`(?is)<[^>]+>`)
)

func (p *Plugin) handleImportBrowserBookmarks(w http.ResponseWriter, r *http.Request) {
	u := p.host.Auth().CurrentUser(r)
	rawBody, err := io.ReadAll(io.LimitReader(r.Body, 12<<20))
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "failed to read body")
		return
	}

	htmlContent := string(rawBody)
	groupName := "浏览器书签"
	var req struct {
		HTML      string `json:"html"`
		GroupName string `json:"group_name"`
	}
	if strings.HasPrefix(strings.TrimSpace(htmlContent), "{") {
		if err := json.Unmarshal(rawBody, &req); err == nil && req.HTML != "" {
			htmlContent = req.HTML
			if g := strings.TrimSpace(req.GroupName); g != "" {
				groupName = g
			}
		}
	}

	matches := browserAnchorRe.FindAllStringSubmatch(htmlContent, -1)
	if len(matches) == 0 {
		plugin.WriteErr(w, http.StatusBadRequest, "未解析到浏览器书签链接，请确认导入的是浏览器导出的 HTML 文件")
		return
	}

	gid, err := p.findOrCreateGroupByName(u.ID, groupName)
	if err != nil {
		plugin.WriteErr(w, http.StatusInternalServerError, "创建书签分组失败")
		return
	}

	var maxOrder int
	_ = p.host.DB().QueryRow(`SELECT COALESCE(MAX(sort_order), -1) FROM bookmarks WHERE user_id = ?`, u.ID).Scan(&maxOrder)
	now := time.Now().UTC()
	imported := 0

	for _, m := range matches {
		attrs, inner := m[1], m[2]
		hm := attrHrefRe.FindStringSubmatch(attrs)
		if len(hm) == 0 {
			continue
		}
		rawHref := strings.TrimSpace(html.UnescapeString(plugin.FirstNonEmpty(hm[1:]...)))
		lowerHref := strings.ToLower(rawHref)
		if rawHref == "" || (!strings.HasPrefix(lowerHref, "http://") && !strings.HasPrefix(lowerHref, "https://")) {
			continue
		}
		title := strings.TrimSpace(html.UnescapeString(stripHTMLTagRe.ReplaceAllString(inner, "")))
		if title == "" {
			title = rawHref
		}
		iconVal := "globe"
		if im := attrIconRe.FindStringSubmatch(attrs); len(im) > 0 {
			ic := strings.TrimSpace(plugin.FirstNonEmpty(im[1:]...))
			if strings.HasPrefix(ic, "data:image/") && len(ic) <= 65536 {
				iconVal = ic
			}
		}
		lanURL, wanURL := rawHref, rawHref
		if plugin.IsLikelyLocalURL(rawHref) {
			wanURL = ""
		}
		maxOrder++
		if _, err := p.host.DB().Exec(
			`INSERT INTO bookmarks (user_id, group_id, title, description, lan_url, ts_url, wan_url, icon, color, sort_order, created_at)
			 VALUES (?, ?, ?, '', ?, '', ?, ?, '#6366f1', ?, ?)`,
			u.ID, gid, title, lanURL, wanURL, iconVal, maxOrder, now,
		); err == nil {
			imported++
		}
	}

	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"imported":   imported,
		"group_name": groupName,
		"group_id":   gid,
	})
}

func (p *Plugin) resolveOrCreateGroup(userID, groupID int64, fallbackName string) (int64, error) {
	if groupID > 0 {
		var exists int64
		if err := p.host.DB().QueryRow(`SELECT id FROM groups WHERE id = ? AND user_id = ?`, groupID, userID).Scan(&exists); err == nil {
			return exists, nil
		}
	}
	return p.findOrCreateGroupByName(userID, fallbackName)
}

func (p *Plugin) findOrCreateGroupByName(userID int64, name string) (int64, error) {
	var id int64
	if err := p.host.DB().QueryRow(`SELECT id FROM groups WHERE user_id = ? AND name = ? LIMIT 1`, userID, name).Scan(&id); err == nil {
		return id, nil
	}
	var maxOrder int
	_ = p.host.DB().QueryRow(`SELECT COALESCE(MAX(sort_order), -1) FROM groups WHERE user_id = ?`, userID).Scan(&maxOrder)
	res, err := p.host.DB().Exec(
		`INSERT INTO groups (user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)`,
		userID, name, maxOrder+1, time.Now().UTC(),
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
