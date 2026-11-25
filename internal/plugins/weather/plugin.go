package weather

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"orbit/internal/db"
	"orbit/internal/plugin"
)

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

type Location struct {
	Name        string  `json:"name"`
	DisplayName string  `json:"display_name"`
	City        string  `json:"city"`
	Admin       string  `json:"admin"`
	Country     string  `json:"country"`
	StationID   string  `json:"station_id,omitempty"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
}

type Slot struct {
	Label string `json:"label"`
	Temp  string `json:"temp"`
}

type Day struct {
	Date       string  `json:"date"`
	Label      string  `json:"label"`
	Cond       string  `json:"cond"`
	Kind       string  `json:"kind"`
	TempMinC   float64 `json:"temp_min_c"`
	TempMaxC   float64 `json:"temp_max_c"`
	PrecipProb int     `json:"precip_prob"`
}

type Payload struct {
	City        string  `json:"city"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	TempC       float64 `json:"temp_c"`
	FeelsLikeC  float64 `json:"feels_like_c"`
	Cond        string  `json:"cond"`
	Kind        string  `json:"kind"`
	IsDay       bool    `json:"is_day"`
	Humidity    int     `json:"humidity"`
	WindKMH     float64 `json:"wind_kmh"`
	PressureHPA float64 `json:"pressure_hpa"`
	TempMinC    float64 `json:"temp_min_c"`
	TempMaxC    float64 `json:"temp_max_c"`
	PrecipProb  int     `json:"precip_prob"`
	Daily       []Day   `json:"daily"`
	Slots       []Slot  `json:"slots"`
	UpdatedAt   string  `json:"updated_at"`
	Source      string  `json:"source"`
	Fallback    bool    `json:"fallback"`
}

type Query struct {
	City        string
	Label       string
	StationID   string
	Provider    string // "auto" | "china" | "caiyun"
	CaiyunToken string
	Lat         *float64
	Lon         *float64
	Refresh     bool
}

type weatherEntry struct {
	fetchedAt time.Time
	payload   Payload
}

type searchEntry struct {
	fetchedAt time.Time
	results   []Location
}

type Plugin struct {
	host         plugin.Host
	client       *http.Client
	directClient *http.Client
	mu           sync.Mutex
	cache        map[string]weatherEntry
	searchCache  map[string]searchEntry
}

func New() *Plugin {
	return &Plugin{
		cache:       make(map[string]weatherEntry),
		searchCache: make(map[string]searchEntry),
	}
}

func (p *Plugin) Manifest() plugin.Manifest {
	return plugin.Manifest{
		ID:             "orbit.weather",
		Name:           "实时天气",
		Version:        "1.1.0",
		Description:    "支持中国天气 / 彩云天气数据源、一键直接定位与多日预报自定义",
		Icon:           "cloud-sun",
		Tier:           "light",
		Source:         "official",
		DefaultEnabled: true,
		Access: plugin.AccessSpec{
			MinRole:     "public",
			Guest:       plugin.GuestSpec{Mode: "readonly"},
			AllowPublic: true,
		},
		Style: &plugin.StyleSpec{
			Managed:          true,
			SupportsCardless: true,
		},
		Contributes: plugin.ContributesSpec{
			Widgets: []plugin.WidgetContrib{
				{
					ID:             "main",
					LayoutKey:      "weather",
					Label:          "天气",
					MinW:           260,
					DefaultW:       420,
					Resizable:      true,
					DefaultVisible: true,
				},
			},
			Settings: &plugin.SettingsContrib{
				TabID:          "weather",
				Label:          "天气卡片",
				Icon:           "cloud-sun",
				SearchKeywords: []string{"天气", "区县", "城市", "定位", "中国天气", "彩云天气", "经纬度", "温度", "体感", "湿度", "风速", "预报"},
			},
		},
	}
}

func (p *Plugin) Init(host plugin.Host) error {
	p.host = host
	p.client = host.Network().HTTPClient(6*time.Second, false)
	// Direct client bypasses overseas HTTP_PROXY/HTTPS_PROXY so domestic China Weather,
	// Caiyun Weather, and domestic IP geolocation resolve fast and accurately.
	p.directClient = &http.Client{
		Timeout: 6 * time.Second,
		Transport: &http.Transport{
			Proxy: nil,
			DialContext: (&net.Dialer{
				Timeout:   4 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
		},
	}
	return nil
}

func (p *Plugin) RegisterRoutes(r plugin.RouteGroup) {
	r.HandleAuth("GET /search", p.handleSearch)
	r.HandleAuth("GET /locate", p.handleLocate)
	r.HandleAuth("GET /current", p.handleWeather)
	r.Handle("GET /public", p.handlePublicWeather)

	r.HandleCompat("GET /api/weather/search", p.handleSearch, true)
	r.HandleCompat("GET /api/weather/locate", p.handleLocate, true)
	r.HandleCompat("GET /api/weather", p.handleWeather, true)
	r.HandleCompat("GET /api/public/weather", p.handlePublicWeather, false)
}

func (p *Plugin) doDirectFirst(req *http.Request) (*http.Response, error) {
	if p.directClient != nil {
		if resp, err := p.directClient.Do(req.Clone(req.Context())); err == nil && resp.StatusCode < 500 {
			return resp, nil
		} else if resp != nil {
			_ = resp.Body.Close()
		}
	}
	return p.client.Do(req)
}

func (p *Plugin) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		plugin.WriteJSON(w, http.StatusOK, map[string]any{"results": []Location{}})
		return
	}
	res := p.searchLocations(q)
	if res == nil {
		res = []Location{}
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"results": res})
}

func (p *Plugin) handleLocate(w http.ResponseWriter, r *http.Request) {
	latStr := strings.TrimSpace(r.URL.Query().Get("lat"))
	lonStr := strings.TrimSpace(r.URL.Query().Get("lon"))
	if latStr != "" && lonStr != "" {
		lat, e1 := strconv.ParseFloat(latStr, 64)
		lon, e2 := strconv.ParseFloat(lonStr, 64)
		if e1 == nil && e2 == nil && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 {
			loc := p.reverseLocate(lat, lon)
			plugin.WriteJSON(w, http.StatusOK, map[string]any{
				"location": loc,
				"method":   "gps",
			})
			return
		}
	}

	loc, ok := p.locateByIP()
	if !ok {
		plugin.WriteErr(w, http.StatusBadGateway, "定位失败，请尝试手动搜索城市")
		return
	}
	plugin.WriteJSON(w, http.StatusOK, map[string]any{
		"location": loc,
		"method":   "ip",
	})
}

func (p *Plugin) handleWeather(w http.ResponseWriter, r *http.Request) {
	q := Query{
		City:        r.URL.Query().Get("city"),
		Label:       r.URL.Query().Get("label"),
		StationID:   strings.TrimSpace(r.URL.Query().Get("station_id")),
		Provider:    strings.ToLower(strings.TrimSpace(r.URL.Query().Get("provider"))),
		CaiyunToken: strings.TrimSpace(r.URL.Query().Get("token")),
		Refresh:     r.URL.Query().Get("refresh") == "1",
	}
	if latStr, lonStr := strings.TrimSpace(r.URL.Query().Get("lat")), strings.TrimSpace(r.URL.Query().Get("lon")); latStr != "" && lonStr != "" {
		if lat, e1 := strconv.ParseFloat(latStr, 64); e1 == nil {
			if lon, e2 := strconv.ParseFloat(lonStr, 64); e2 == nil {
				q.Lat = &lat
				q.Lon = &lon
			}
		}
	}
	plugin.WriteJSON(w, http.StatusOK, p.getWeather(q))
}

func (p *Plugin) handlePublicWeather(w http.ResponseWriter, r *http.Request) {
	rawJSON := db.DefaultSettingsJSON
	var dataJSON string
	if err := p.host.DB().QueryRow(
		`SELECT us.data_json FROM user_settings us JOIN users u ON u.id = us.user_id WHERE u.role = 'admin' ORDER BY u.id ASC LIMIT 1`,
	).Scan(&dataJSON); err == nil && dataJSON != "" {
		rawJSON = dataJSON
	}

	var src map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &src); err != nil || src == nil {
		_ = json.Unmarshal([]byte(db.DefaultSettingsJSON), &src)
	}
	if allow, ok := src["allowGuest"].(bool); ok && !allow {
		plugin.WriteErr(w, http.StatusForbidden, "guest mode disabled")
		return
	}

	q := Query{City: "上海", Label: "上海", Provider: "auto"}
	if wc, ok := src["weatherConfig"].(map[string]any); ok {
		if v, ok := wc["query"].(string); ok && v != "" {
			q.City = v
		}
		if v, ok := wc["label"].(string); ok && v != "" {
			q.Label = v
		}
		if v, ok := wc["stationId"].(string); ok && v != "" {
			q.StationID = strings.TrimSpace(v)
		}
		if v, ok := wc["provider"].(string); ok && v != "" {
			q.Provider = strings.ToLower(strings.TrimSpace(v))
		}
		if v, ok := wc["caiyunToken"].(string); ok && v != "" {
			q.CaiyunToken = strings.TrimSpace(v)
		}
		if lat, ok := wc["lat"].(float64); ok {
			if lon, ok2 := wc["lon"].(float64); ok2 {
				q.Lat = &lat
				q.Lon = &lon
			}
		}
	} else {
		if v, ok := src["weatherCity"].(string); ok && v != "" {
			q.City = v
		}
		if v, ok := src["weatherLabel"].(string); ok && v != "" {
			q.Label = v
		}
	}
	plugin.WriteJSON(w, http.StatusOK, p.getWeather(q))
}

// ---------- Location Search & Direct Geolocation ----------

func (p *Plugin) searchLocations(q string) []Location {
	q = strings.TrimSpace(q)
	if q == "" {
		return nil
	}
	key := strings.ToLower(q)

	p.mu.Lock()
	if ent, ok := p.searchCache[key]; ok && time.Since(ent.fetchedAt) < time.Hour {
		out := append([]Location(nil), ent.results...)
		p.mu.Unlock()
		return out
	}
	p.mu.Unlock()

	results := p.searchCMA(q)
	if len(results) == 0 {
		results = p.searchNominatim(q)
	}
	if len(results) == 0 {
		results = p.searchOpenMeteoGeo(q)
	}
	if len(results) > 0 {
		p.mu.Lock()
		p.searchCache[key] = searchEntry{fetchedAt: time.Now(), results: results}
		p.mu.Unlock()
	}
	return results
}

var majorCMAStations = map[string]Location{
	"上海":  {Name: "上海", DisplayName: "上海 · 中国", Admin: "上海", Country: "中国", StationID: "58367", Lat: 31.19, Lon: 121.43},
	"北京":  {Name: "北京", DisplayName: "北京 · 中国", Admin: "北京", Country: "中国", StationID: "54511", Lat: 39.80, Lon: 116.47},
	"天津":  {Name: "天津", DisplayName: "天津 · 中国", Admin: "天津", Country: "中国", StationID: "54527", Lat: 39.08, Lon: 117.07},
	"重庆":  {Name: "重庆", DisplayName: "重庆 · 中国", Admin: "重庆", Country: "中国", StationID: "57516", Lat: 29.58, Lon: 106.46},
	"广州":  {Name: "广州", DisplayName: "广州 · 广东", Admin: "广东", Country: "中国", StationID: "59287", Lat: 23.21, Lon: 113.48},
	"深圳":  {Name: "深圳", DisplayName: "深圳 · 广东", Admin: "广东", Country: "中国", StationID: "59493", Lat: 22.54, Lon: 114.00},
	"杭州":  {Name: "杭州", DisplayName: "杭州 · 浙江", Admin: "浙江", Country: "中国", StationID: "58457", Lat: 30.23, Lon: 120.16},
	"南京":  {Name: "南京", DisplayName: "南京 · 江苏", Admin: "江苏", Country: "中国", StationID: "58238", Lat: 31.93, Lon: 118.90},
	"苏州":  {Name: "苏州", DisplayName: "苏州 · 江苏", Admin: "江苏", Country: "中国", StationID: "58357", Lat: 31.26, Lon: 120.63},
	"武汉":  {Name: "武汉", DisplayName: "武汉 · 湖北", Admin: "湖北", Country: "中国", StationID: "57494", Lat: 30.60, Lon: 114.05},
	"成都":  {Name: "成都", DisplayName: "成都 · 四川", Admin: "四川", Country: "中国", StationID: "56294", Lat: 30.75, Lon: 103.86},
	"西安":  {Name: "西安", DisplayName: "西安 · 陕西", Admin: "陕西", Country: "中国", StationID: "57036", Lat: 34.43, Lon: 108.97},
	"长沙":  {Name: "长沙", DisplayName: "长沙 · 湖南", Admin: "湖南", Country: "中国", StationID: "57687", Lat: 28.22, Lon: 112.92},
	"郑州":  {Name: "郑州", DisplayName: "郑州 · 河南", Admin: "河南", Country: "中国", StationID: "57083", Lat: 34.72, Lon: 113.65},
	"青岛":  {Name: "青岛", DisplayName: "青岛 · 山东", Admin: "山东", Country: "中国", StationID: "54857", Lat: 36.07, Lon: 120.33},
	"厦门":  {Name: "厦门", DisplayName: "厦门 · 福建", Admin: "福建", Country: "中国", StationID: "59134", Lat: 24.48, Lon: 118.07},
	"香港":  {Name: "香港", DisplayName: "香港 · 中国", Admin: "香港", Country: "中国", StationID: "45007", Lat: 22.30, Lon: 114.17},
	"澳门":  {Name: "澳门", DisplayName: "澳门 · 中国", Admin: "澳门", Country: "中国", StationID: "45011", Lat: 22.16, Lon: 113.57},
	"台北":  {Name: "台北", DisplayName: "台北 · 台湾", Admin: "台湾", Country: "中国", StationID: "58968", Lat: 25.04, Lon: 121.51},
	"shanghai":  {Name: "上海", DisplayName: "上海 · 中国", Admin: "上海", Country: "中国", StationID: "58367", Lat: 31.19, Lon: 121.43},
	"beijing":   {Name: "北京", DisplayName: "北京 · 中国", Admin: "北京", Country: "中国", StationID: "54511", Lat: 39.80, Lon: 116.47},
	"shenzhen":  {Name: "深圳", DisplayName: "深圳 · 广东", Admin: "广东", Country: "中国", StationID: "59493", Lat: 22.54, Lon: 114.00},
	"guangzhou": {Name: "广州", DisplayName: "广州 · 广东", Admin: "广东", Country: "中国", StationID: "59287", Lat: 23.21, Lon: 113.48},
	"hangzhou":  {Name: "杭州", DisplayName: "杭州 · 浙江", Admin: "浙江", Country: "中国", StationID: "58457", Lat: 30.23, Lon: 120.16},
}

func lookupMajorCMA(term string) (Location, bool) {
	t := strings.ToLower(strings.TrimSpace(term))
	if loc, ok := majorCMAStations[t]; ok {
		return loc, true
	}
	if stripped := strings.ToLower(stripChineseAdminSuffix(term)); stripped != t {
		if loc, ok := majorCMAStations[stripped]; ok {
			return loc, true
		}
	}
	return Location{}, false
}

func cmaNameMatches(query, candidateName, candidateEn string) bool {
	q := strings.ToLower(strings.TrimSpace(query))
	n := strings.ToLower(strings.TrimSpace(candidateName))
	en := strings.ToLower(strings.TrimSpace(candidateEn))
	if q == "" || n == "" {
		return false
	}
	if n == q || strings.Contains(n, q) || (len([]rune(n)) >= 2 && strings.Contains(q, n)) {
		return true
	}
	if en != "" && (en == q || strings.HasPrefix(en, q)) {
		return true
	}
	return false
}

func (p *Plugin) searchCMA(q string) []Location {
	queryOnce := func(term string) []Location {
		out := make([]Location, 0, 8)
		seen := make(map[string]bool)
		if major, ok := lookupMajorCMA(term); ok {
			out = append(out, major)
			seen[major.StationID] = true
		}

		u := "https://weather.cma.cn/api/autocomplete?q=" + url.QueryEscape(term) + "&limit=10"
		req, err := http.NewRequest(http.MethodGet, u, nil)
		if err != nil {
			return out
		}
		req.Header.Set("User-Agent", browserUA)
		resp, err := p.doDirectFirst(req)
		if err != nil {
			return out
		}
		defer resp.Body.Close()

		var raw struct {
			Code int      `json:"code"`
			Data []string `json:"data"`
		}
		if err := json.NewDecoder(io.LimitReader(resp.Body, 256<<10)).Decode(&raw); err != nil || raw.Code != 0 {
			return out
		}

		// Keep only entries whose name/pinyin actually matches the query (prevents "上海" -> "上党" or "福田" -> "福山")
		for _, entry := range raw.Data {
			parts := strings.Split(entry, "|")
			if len(parts) < 4 {
				continue
			}
			sid := strings.TrimSpace(parts[0])
			name := strings.TrimSpace(parts[1])
			en := strings.TrimSpace(parts[2])
			country := strings.TrimSpace(parts[3])
			if sid == "" || name == "" || seen[sid] {
				continue
			}
			if !cmaNameMatches(term, name, en) {
				continue
			}
			seen[sid] = true
			disp := name
			if country != "" && country != name {
				disp = name + " · " + country
			}
			out = append(out, Location{
				Name:        name,
				DisplayName: disp,
				Country:     country,
				StationID:   sid,
			})
		}

		// Populate lat/lon/province for top results asynchronously (cap at 4 to keep search snappy)
		limit := len(out)
		if limit > 4 {
			limit = 4
		}
		var wg sync.WaitGroup
		for i := 0; i < limit; i++ {
			if out[i].Lat != 0 || out[i].Lon != 0 {
				continue
			}
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				if meta, ok := p.fetchCMAStationMeta(out[idx].StationID); ok {
					out[idx].Lat = meta.Lat
					out[idx].Lon = meta.Lon
					if meta.Admin != "" {
						out[idx].Admin = meta.Admin
						out[idx].DisplayName = out[idx].Name + " · " + meta.Admin
					}
					if meta.City != "" {
						out[idx].City = meta.City
					}
				}
			}(i)
		}
		wg.Wait()
		return out
	}

	res := queryOnce(q)
	if len(res) == 0 {
		stripped := stripChineseAdminSuffix(q)
		if stripped != "" && stripped != q {
			res = queryOnce(stripped)
		}
	}
	return res
}

func stripChineseAdminSuffix(q string) string {
	s := strings.TrimSpace(q)
	for _, suf := range []string{"新区", "特别行政区", "自治区", "自治州", "自治县", "区", "县", "市", "省"} {
		if strings.HasSuffix(s, suf) && len([]rune(s)) > len([]rune(suf))+1 {
			return strings.TrimSuffix(s, suf)
		}
	}
	return s
}

func (p *Plugin) fetchCMAStationMeta(stationID string) (Location, bool) {
	if stationID == "" {
		return Location{}, false
	}
	u := "https://weather.cma.cn/api/weather/view?stationid=" + url.QueryEscape(stationID)
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return Location{}, false
	}
	req.Header.Set("User-Agent", browserUA)
	resp, err := p.doDirectFirst(req)
	if err != nil {
		return Location{}, false
	}
	defer resp.Body.Close()

	var raw struct {
		Code int `json:"code"`
		Data struct {
			Location struct {
				ID        string  `json:"id"`
				Name      string  `json:"name"`
				Path      string  `json:"path"`
				Longitude float64 `json:"longitude"`
				Latitude  float64 `json:"latitude"`
			} `json:"location"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 256<<10)).Decode(&raw); err != nil || raw.Code != 0 || raw.Data.Location.ID == "" {
		return Location{}, false
	}
	return parseCMALocation(raw.Data.Location.ID, raw.Data.Location.Name, raw.Data.Location.Path, raw.Data.Location.Latitude, raw.Data.Location.Longitude), true
}

func parseCMALocation(id, name, path string, lat, lon float64) Location {
	parts := strings.Split(path, ",")
	var country, admin, city string
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	if len(parts) >= 1 {
		country = parts[0]
	}
	if len(parts) >= 2 && parts[1] != name {
		admin = parts[1]
	}
	if len(parts) >= 3 && parts[2] != name {
		city = parts[2]
	}
	disp := name
	var suffix []string
	if city != "" && city != name {
		suffix = append(suffix, city)
	}
	if admin != "" && admin != city && admin != name {
		suffix = append(suffix, admin)
	}
	if len(suffix) > 0 {
		disp = name + " · " + strings.Join(suffix, ", ")
	} else if country != "" {
		disp = name + " · " + country
	}
	return Location{
		Name:        name,
		DisplayName: disp,
		City:        city,
		Admin:       admin,
		Country:     country,
		StationID:   id,
		Lat:         math.Round(lat*10000) / 10000,
		Lon:         math.Round(lon*10000) / 10000,
	}
}

func (p *Plugin) locateByIP() (Location, bool) {
	// 1. Primary: China Meteorological Administration auto IP location (fast, domestic, returns exact station ID + coords)
	req, err := http.NewRequest(http.MethodGet, "https://weather.cma.cn/api/weather/view", nil)
	if err == nil {
		req.Header.Set("User-Agent", browserUA)
		if resp, err := p.doDirectFirst(req); err == nil {
			defer resp.Body.Close()
			var raw struct {
				Code int `json:"code"`
				Data struct {
					Location struct {
						ID        string  `json:"id"`
						Name      string  `json:"name"`
						Path      string  `json:"path"`
						Longitude float64 `json:"longitude"`
						Latitude  float64 `json:"latitude"`
					} `json:"location"`
				} `json:"data"`
			}
			if err := json.NewDecoder(io.LimitReader(resp.Body, 256<<10)).Decode(&raw); err == nil &&
				raw.Code == 0 && raw.Data.Location.Name != "" {
				return parseCMALocation(
					raw.Data.Location.ID,
					raw.Data.Location.Name,
					raw.Data.Location.Path,
					raw.Data.Location.Latitude,
					raw.Data.Location.Longitude,
				), true
			}
		}
	}

	// 2. Fallback: ip-api.com (works globally if outside China)
	req2, err := http.NewRequest(http.MethodGet, "http://ip-api.com/json/?lang=zh-CN", nil)
	if err == nil {
		req2.Header.Set("User-Agent", browserUA)
		if resp, err := p.doDirectFirst(req2); err == nil {
			defer resp.Body.Close()
			var ipRes struct {
				Status     string  `json:"status"`
				Country    string  `json:"country"`
				RegionName string  `json:"regionName"`
				City       string  `json:"city"`
				Lat        float64 `json:"lat"`
				Lon        float64 `json:"lon"`
			}
			if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&ipRes); err == nil &&
				ipRes.Status == "success" && ipRes.City != "" {
				loc := Location{
					Name:        ipRes.City,
					DisplayName: plugin.FirstNonEmpty(ipRes.City+" · "+ipRes.RegionName, ipRes.City),
					City:        ipRes.City,
					Admin:       ipRes.RegionName,
					Country:     ipRes.Country,
					Lat:         math.Round(ipRes.Lat*10000) / 10000,
					Lon:         math.Round(ipRes.Lon*10000) / 10000,
				}
				if cmaMatches := p.searchCMA(ipRes.City); len(cmaMatches) > 0 {
					loc.StationID = cmaMatches[0].StationID
				}
				return loc, true
			}
		}
	}
	return Location{}, false
}

func (p *Plugin) reverseLocate(lat, lon float64) Location {
	loc := Location{
		Name:        fmt.Sprintf("%.2f, %.2f", lat, lon),
		DisplayName: fmt.Sprintf("%.4f, %.4f", lat, lon),
		Lat:         math.Round(lat*10000) / 10000,
		Lon:         math.Round(lon*10000) / 10000,
	}

	u := fmt.Sprintf(
		"https://nominatim.openstreetmap.org/reverse?lat=%.5f&lon=%.5f&format=json&accept-language=zh-CN&zoom=10&addressdetails=1",
		lat, lon,
	)
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err == nil {
		req.Header.Set("User-Agent", "OrbitHomePanel/1.1")
		if resp, err := p.client.Do(req); err == nil {
			defer resp.Body.Close()
			var raw struct {
				Name        string `json:"name"`
				DisplayName string `json:"display_name"`
				Address     struct {
					District     string `json:"district"`
					CityDistrict string `json:"city_district"`
					County       string `json:"county"`
					City         string `json:"city"`
					Municipality string `json:"municipality"`
					Town         string `json:"town"`
					State        string `json:"state"`
					Province     string `json:"province"`
					Country      string `json:"country"`
				} `json:"address"`
			}
			if err := json.NewDecoder(io.LimitReader(resp.Body, 128<<10)).Decode(&raw); err == nil {
				district := plugin.FirstNonEmpty(raw.Address.District, raw.Address.CityDistrict, raw.Address.County)
				city := plugin.FirstNonEmpty(raw.Address.City, raw.Address.Municipality, raw.Address.Town)
				admin := plugin.FirstNonEmpty(raw.Address.State, raw.Address.Province)
				bestName := plugin.FirstNonEmpty(district, city, raw.Name, admin)
				if bestName != "" {
					loc.Name = bestName
					loc.City = city
					loc.Admin = admin
					loc.Country = raw.Address.Country
					var parts []string
					if city != "" && city != bestName {
						parts = append(parts, city)
					}
					if admin != "" && admin != city && admin != bestName {
						parts = append(parts, admin)
					}
					if len(parts) > 0 {
						loc.DisplayName = bestName + " · " + strings.Join(parts, ", ")
					} else {
						loc.DisplayName = bestName
					}

					// Build ordered candidates including parent city tokens from display_name
					candidates := []string{bestName, stripChineseAdminSuffix(bestName), city, stripChineseAdminSuffix(city)}
					for _, seg := range strings.Split(raw.DisplayName, ",") {
						s := strings.TrimSpace(seg)
						if s != "" && s != "中国" && s != admin {
							candidates = append(candidates, s, stripChineseAdminSuffix(s))
						}
					}
					for _, candidate := range candidates {
						if candidate == "" {
							continue
						}
						if matches := p.searchCMA(candidate); len(matches) > 0 {
							for _, m := range matches {
								if m.StationID == "" {
									continue
								}
								// Verify matched station is geographically close to requested coords (~100km)
								if (m.Lat == 0 && m.Lon == 0) || (math.Abs(m.Lat-lat) < 1.2 && math.Abs(m.Lon-lon) < 1.2) {
									loc.StationID = m.StationID
									break
								}
							}
							if loc.StationID != "" {
								break
							}
						}
					}
				}
			}
		}
	}

	// If Nominatim was unavailable, still attempt CMA IP match for station ID if close
	if loc.StationID == "" {
		if ipLoc, ok := p.locateByIP(); ok && math.Abs(ipLoc.Lat-lat) < 1.5 && math.Abs(ipLoc.Lon-lon) < 1.5 {
			loc.StationID = ipLoc.StationID
			if strings.Contains(loc.Name, ",") {
				loc.Name = ipLoc.Name
				loc.DisplayName = ipLoc.DisplayName
				loc.City = ipLoc.City
				loc.Admin = ipLoc.Admin
				loc.Country = ipLoc.Country
			}
		}
	}
	return loc
}

func (p *Plugin) searchNominatim(q string) []Location {
	u := "https://nominatim.openstreetmap.org/search?q=" + url.QueryEscape(q) +
		"&format=json&limit=8&accept-language=zh-CN&addressdetails=1"
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "OrbitHomePanel/1.1")
	resp, err := p.client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	var raw []struct {
		Name    string `json:"name"`
		Lat     string `json:"lat"`
		Lon     string `json:"lon"`
		Address struct {
			District     string `json:"district"`
			CityDistrict string `json:"city_district"`
			Suburb       string `json:"suburb"`
			County       string `json:"county"`
			City         string `json:"city"`
			Town         string `json:"town"`
			Municipality string `json:"municipality"`
			State        string `json:"state"`
			Province     string `json:"province"`
			Country      string `json:"country"`
		} `json:"address"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 512<<10)).Decode(&raw); err != nil {
		return nil
	}

	out := make([]Location, 0, len(raw))
	seen := make(map[string]bool)
	for _, r := range raw {
		lat, e1 := strconv.ParseFloat(r.Lat, 64)
		lon, e2 := strconv.ParseFloat(r.Lon, 64)
		if e1 != nil || e2 != nil {
			continue
		}
		district := plugin.FirstNonEmpty(r.Address.District, r.Address.CityDistrict, r.Address.Suburb, r.Address.County)
		city := plugin.FirstNonEmpty(r.Address.City, r.Address.Municipality, r.Address.Town)
		admin := plugin.FirstNonEmpty(r.Address.State, r.Address.Province)
		name := plugin.FirstNonEmpty(r.Name, district, city, admin)
		if name == "" {
			continue
		}
		parts := make([]string, 0, 3)
		if city != "" && city != name {
			parts = append(parts, city)
		}
		if admin != "" && admin != city && admin != name {
			parts = append(parts, admin)
		}
		if r.Address.Country != "" && len(parts) == 0 {
			parts = append(parts, r.Address.Country)
		}
		disp := name
		if len(parts) > 0 {
			disp = name + " · " + strings.Join(parts, ", ")
		}
		dedup := fmt.Sprintf("%s|%.2f|%.2f", name, lat, lon)
		if seen[dedup] {
			continue
		}
		seen[dedup] = true
		out = append(out, Location{
			Name:        name,
			DisplayName: disp,
			City:        city,
			Admin:       admin,
			Country:     r.Address.Country,
			Lat:         math.Round(lat*10000) / 10000,
			Lon:         math.Round(lon*10000) / 10000,
		})
	}
	return out
}

func (p *Plugin) searchOpenMeteoGeo(q string) []Location {
	queryOnce := func(term string) []Location {
		geoURL := "https://geocoding-api.open-meteo.com/v1/search?name=" + url.QueryEscape(term) + "&count=6&language=zh&format=json"
		resp, err := p.client.Get(geoURL)
		if err != nil {
			return nil
		}
		defer resp.Body.Close()

		var geo struct {
			Results []struct {
				Name      string  `json:"name"`
				Latitude  float64 `json:"latitude"`
				Longitude float64 `json:"longitude"`
				Country   string  `json:"country"`
				Admin1    string  `json:"admin1"`
				Admin2    string  `json:"admin2"`
			} `json:"results"`
		}
		if err := json.NewDecoder(io.LimitReader(resp.Body, 256<<10)).Decode(&geo); err != nil {
			return nil
		}
		list := make([]Location, 0, len(geo.Results))
		for _, r := range geo.Results {
			parts := make([]string, 0, 2)
			if r.Admin2 != "" && r.Admin2 != r.Name {
				parts = append(parts, r.Admin2)
			}
			if r.Admin1 != "" && r.Admin1 != r.Admin2 && r.Admin1 != r.Name {
				parts = append(parts, r.Admin1)
			}
			disp := r.Name
			if len(parts) > 0 {
				disp += " · " + strings.Join(parts, ", ")
			} else if r.Country != "" {
				disp += " · " + r.Country
			}
			list = append(list, Location{
				Name:        r.Name,
				DisplayName: disp,
				City:        r.Admin2,
				Admin:       r.Admin1,
				Country:     r.Country,
				Lat:         math.Round(r.Latitude*10000) / 10000,
				Lon:         math.Round(r.Longitude*10000) / 10000,
			})
		}
		return list
	}
	res := queryOnce(q)
	if len(res) == 0 {
		stripped := stripChineseAdminSuffix(q)
		if stripped != "" && stripped != q {
			res = queryOnce(stripped)
		}
	}
	return res
}

// ---------- Weather Aggregation (Caiyun / China CMA / Open-Meteo Fallback) ----------

func (p *Plugin) getWeather(q Query) Payload {
	label := strings.TrimSpace(q.Label)
	city := strings.TrimSpace(q.City)
	if city == "" && label != "" {
		city = label
	}
	if city == "" {
		city = "上海"
	}

	provider := strings.ToLower(strings.TrimSpace(q.Provider))
	if provider != "china" && provider != "caiyun" {
		provider = "auto"
	}
	caiyunToken := strings.TrimSpace(q.CaiyunToken)
	if caiyunToken == "" {
		caiyunToken = strings.TrimSpace(os.Getenv("ORBIT_CAIYUN_TOKEN"))
	}

	hasCoords := q.Lat != nil && q.Lon != nil
	cacheKey := provider + "|city:" + strings.ToLower(city)
	if q.StationID != "" {
		cacheKey = provider + "|st:" + q.StationID
	} else if hasCoords {
		cacheKey = fmt.Sprintf("%s|coord:%.4f,%.4f", provider, *q.Lat, *q.Lon)
	}
	if caiyunToken != "" && (provider == "caiyun" || provider == "auto") {
		cacheKey += "|cy"
	}

	if !q.Refresh {
		p.mu.Lock()
		if ent, ok := p.cache[cacheKey]; ok && time.Since(ent.fetchedAt) < 20*time.Minute {
			payload := ent.payload
			if label != "" {
				payload.City = label
			}
			p.mu.Unlock()
			return payload
		}
		p.mu.Unlock()
	}

	var lat, lon float64
	stationID := strings.TrimSpace(q.StationID)
	resolvedName := plugin.FirstNonEmpty(label, city)

	if hasCoords {
		lat, lon = *q.Lat, *q.Lon
	} else {
		locs := p.searchLocations(city)
		if len(locs) > 0 {
			lat, lon = locs[0].Lat, locs[0].Lon
			if stationID == "" {
				stationID = locs[0].StationID
			}
			resolvedName = plugin.FirstNonEmpty(label, locs[0].Name, city)
			hasCoords = lat != 0 || lon != 0
		}
	}

	tryCacheAndReturn := func(live Payload) Payload {
		p.mu.Lock()
		p.cache[cacheKey] = weatherEntry{fetchedAt: time.Now(), payload: live}
		p.mu.Unlock()
		if label != "" {
			live.City = label
		}
		return live
	}

	// 1. Caiyun Weather (v2.6) when explicitly selected or auto with a valid token
	if (provider == "caiyun" || (provider == "auto" && caiyunToken != "")) && caiyunToken != "" {
		if !hasCoords && stationID != "" {
			if meta, ok := p.fetchCMAStationMeta(stationID); ok {
				lat, lon = meta.Lat, meta.Lon
				hasCoords = lat != 0 || lon != 0
			}
		}
		if hasCoords {
			if live, ok := p.fetchCaiyun(caiyunToken, lat, lon, resolvedName); ok {
				return tryCacheAndReturn(live)
			}
		}
	}

	// 2. China Weather (CMA 中国气象局官方实况与多日预报，免 Token 开箱即用)
	if stationID == "" {
		for _, cand := range []string{label, city, stripChineseAdminSuffix(label), stripChineseAdminSuffix(city)} {
			if cand == "" {
				continue
			}
			if matches := p.searchCMA(cand); len(matches) > 0 {
				for _, m := range matches {
					if m.StationID == "" {
						continue
					}
					if !hasCoords || (m.Lat == 0 && m.Lon == 0) || (math.Abs(m.Lat-lat) < 1.5 && math.Abs(m.Lon-lon) < 1.5) {
						stationID = m.StationID
						break
					}
				}
				if stationID != "" {
					break
				}
			}
		}
	}
	if stationID == "" && hasCoords {
		rev := p.reverseLocate(lat, lon)
		stationID = rev.StationID
	}
	if stationID != "" {
		if live, ok := p.fetchCMAWeather(stationID, resolvedName); ok {
			return tryCacheAndReturn(live)
		}
	}

	// 3. Open-Meteo fallback (for international coordinates not covered by CMA)
	if hasCoords {
		if live, ok := p.fetchOpenMeteo(lat, lon, resolvedName); ok {
			return tryCacheAndReturn(live)
		}
	}

	return fallbackWeather(resolvedName, label)
}

func (p *Plugin) fetchCaiyun(token string, lat, lon float64, resolvedName string) (Payload, bool) {
	u := fmt.Sprintf(
		"https://api.caiyunapp.com/v2.6/%s/%.4f,%.4f/weather?dailysteps=4&hourlysteps=1&lang=zh_CN",
		url.PathEscape(token), lon, lat,
	)
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return Payload{}, false
	}
	req.Header.Set("User-Agent", browserUA)
	resp, err := p.doDirectFirst(req)
	if err != nil {
		return Payload{}, false
	}
	defer resp.Body.Close()

	var cy struct {
		Status string `json:"status"`
		Result struct {
			Realtime struct {
				Temperature         float64 `json:"temperature"`
				ApparentTemperature float64 `json:"apparent_temperature"`
				Humidity            float64 `json:"humidity"`
				Skycon              string  `json:"skycon"`
				Pressure            float64 `json:"pressure"`
				Wind                struct {
					Speed float64 `json:"speed"`
				} `json:"wind"`
			} `json:"realtime"`
			Daily struct {
				Temperature []struct {
					Date string  `json:"date"`
					Max  float64 `json:"max"`
					Min  float64 `json:"min"`
				} `json:"temperature"`
				Skycon []struct {
					Date  string `json:"date"`
					Value string `json:"value"`
				} `json:"skycon"`
				Precipitation []struct {
					Date        string  `json:"date"`
					Probability float64 `json:"probability"`
				} `json:"precipitation"`
			} `json:"daily"`
		} `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 512<<10)).Decode(&cy); err != nil || cy.Status != "ok" {
		return Payload{}, false
	}

	rt := cy.Result.Realtime
	cond, kind, isDay := mapCaiyunSkycon(rt.Skycon)

	days := make([]Day, 0, len(cy.Result.Daily.Temperature))
	for i, dt := range cy.Result.Daily.Temperature {
		dStr := dt.Date
		if len(dStr) >= 10 {
			dStr = dStr[:10]
		}
		dCond, dKind := cond, kind
		if i < len(cy.Result.Daily.Skycon) {
			dCond, dKind, _ = mapCaiyunSkycon(cy.Result.Daily.Skycon[i].Value)
		}
		pp := 0
		if i < len(cy.Result.Daily.Precipitation) {
			pp = int(math.Round(cy.Result.Daily.Precipitation[i].Probability))
		}
		days = append(days, Day{
			Date:       dStr,
			Label:      formatDayLabel(i, dStr),
			Cond:       dCond,
			Kind:       dKind,
			TempMinC:   round1(dt.Min),
			TempMaxC:   round1(dt.Max),
			PrecipProb: pp,
		})
	}

	todayMin, todayMax := round1(rt.Temperature), round1(rt.Temperature)
	todayPP := 0
	tomorrow := fmt.Sprintf("%.0f°", rt.Temperature)
	if len(days) > 0 {
		todayMin, todayMax = days[0].TempMinC, days[0].TempMaxC
		todayPP = days[0].PrecipProb
	}
	if len(days) > 1 {
		tomorrow = fmt.Sprintf("%.0f°", days[1].TempMaxC)
	}

	pressureHPA := math.Round(rt.Pressure / 100.0)
	if pressureHPA < 800 || pressureHPA > 1100 {
		pressureHPA = 1013
	}

	return Payload{
		City:        resolvedName,
		Lat:         math.Round(lat*10000) / 10000,
		Lon:         math.Round(lon*10000) / 10000,
		TempC:       round1(rt.Temperature),
		FeelsLikeC:  round1(rt.ApparentTemperature),
		Cond:        cond,
		Kind:        kind,
		IsDay:       isDay,
		Humidity:    int(math.Round(rt.Humidity * 100)),
		WindKMH:     round1(rt.Wind.Speed),
		PressureHPA: pressureHPA,
		TempMinC:    todayMin,
		TempMaxC:    todayMax,
		PrecipProb:  todayPP,
		Daily:       days,
		Slots: []Slot{
			{Label: "最高", Temp: fmt.Sprintf("%.0f°", todayMax)},
			{Label: "明", Temp: tomorrow},
		},
		UpdatedAt: time.Now().Format("15:04"),
		Source:    "caiyun",
		Fallback:  false,
	}, true
}

func (p *Plugin) fetchCMAWeather(stationID, resolvedName string) (Payload, bool) {
	u := "https://weather.cma.cn/api/weather/view?stationid=" + url.QueryEscape(stationID)
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return Payload{}, false
	}
	req.Header.Set("User-Agent", browserUA)
	resp, err := p.doDirectFirst(req)
	if err != nil {
		return Payload{}, false
	}
	defer resp.Body.Close()

	var cma struct {
		Code int `json:"code"`
		Data struct {
			Location struct {
				ID        string  `json:"id"`
				Name      string  `json:"name"`
				Longitude float64 `json:"longitude"`
				Latitude  float64 `json:"latitude"`
			} `json:"location"`
			Now struct {
				Temperature   float64 `json:"temperature"`
				FeelsLike     float64 `json:"feelst"`
				Humidity      float64 `json:"humidity"`
				Pressure      float64 `json:"pressure"`
				WindSpeed     float64 `json:"windSpeed"`
				Precipitation float64 `json:"precipitation"`
			} `json:"now"`
			Daily []struct {
				Date      string  `json:"date"`
				High      float64 `json:"high"`
				Low       float64 `json:"low"`
				DayText   string  `json:"dayText"`
				DayCode   int     `json:"dayCode"`
				NightText string  `json:"nightText"`
				NightCode int     `json:"nightCode"`
			} `json:"daily"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 512<<10)).Decode(&cma); err != nil || cma.Code != 0 || len(cma.Data.Daily) == 0 {
		return Payload{}, false
	}

	loc := cma.Data.Location
	now := cma.Data.Now
	hour := time.Now().Hour()
	isDay := hour >= 6 && hour < 19

	validVal := func(v float64) bool { return !math.IsNaN(v) && math.Abs(v) < 9000 }

	days := make([]Day, 0, 4)
	for i, d := range cma.Data.Daily {
		if i >= 4 {
			break
		}
		dDate := strings.ReplaceAll(strings.TrimSpace(d.Date), "/", "-")
		code := d.DayCode
		text := strings.TrimSpace(d.DayText)
		if text == "" || text == "9999" {
			code = d.NightCode
			text = strings.TrimSpace(d.NightText)
		}
		dCond, dKind, dPP := mapCMACode(code, text)
		tMin, tMax := d.Low, d.High
		if !validVal(tMax) && validVal(tMin) {
			tMax = tMin
		}
		if !validVal(tMin) && validVal(tMax) {
			tMin = tMax
		}
		days = append(days, Day{
			Date:       dDate,
			Label:      formatDayLabel(i, dDate),
			Cond:       dCond,
			Kind:       dKind,
			TempMinC:   round1(tMin),
			TempMaxC:   round1(tMax),
			PrecipProb: dPP,
		})
	}

	// Pick current weather condition from today's day/night code + live precipitation
	curCode := cma.Data.Daily[0].DayCode
	curText := strings.TrimSpace(cma.Data.Daily[0].DayText)
	if !isDay && cma.Data.Daily[0].NightText != "" && cma.Data.Daily[0].NightText != "9999" {
		curCode = cma.Data.Daily[0].NightCode
		curText = strings.TrimSpace(cma.Data.Daily[0].NightText)
	}
	cond, kind, todayPP := mapCMACode(curCode, curText)
	if validVal(now.Precipitation) && now.Precipitation >= 0.1 {
		if kind != "rain" && kind != "snow" && kind != "storm" {
			cond = "小雨"
			kind = "rain"
		}
		if todayPP < 80 {
			todayPP = 80
		}
	}

	tempC := now.Temperature
	if !validVal(tempC) {
		tempC = (days[0].TempMaxC + days[0].TempMinC) / 2
	}
	feelsC := now.FeelsLike
	if !validVal(feelsC) {
		feelsC = tempC
	}
	humidity := 50
	if validVal(now.Humidity) && now.Humidity >= 0 && now.Humidity <= 100 {
		humidity = int(math.Round(now.Humidity))
	}
	pressure := 1013.0
	if validVal(now.Pressure) && now.Pressure >= 850 && now.Pressure <= 1090 {
		pressure = math.Round(now.Pressure)
	}
	windKMH := 0.0
	if validVal(now.WindSpeed) && now.WindSpeed >= 0 {
		windKMH = round1(now.WindSpeed * 3.6) // CMA windSpeed is m/s
	}

	todayMin, todayMax := days[0].TempMinC, days[0].TempMaxC
	tomorrow := fmt.Sprintf("%.0f°", todayMax)
	if len(days) > 1 {
		tomorrow = fmt.Sprintf("%.0f°", days[1].TempMaxC)
	}

	return Payload{
		City:        plugin.FirstNonEmpty(resolvedName, loc.Name),
		Lat:         math.Round(loc.Latitude*10000) / 10000,
		Lon:         math.Round(loc.Longitude*10000) / 10000,
		TempC:       round1(tempC),
		FeelsLikeC:  round1(feelsC),
		Cond:        cond,
		Kind:        kind,
		IsDay:       isDay,
		Humidity:    humidity,
		WindKMH:     windKMH,
		PressureHPA: pressure,
		TempMinC:    todayMin,
		TempMaxC:    todayMax,
		PrecipProb:  todayPP,
		Daily:       days,
		Slots: []Slot{
			{Label: "最高", Temp: fmt.Sprintf("%.0f°", todayMax)},
			{Label: "明", Temp: tomorrow},
		},
		UpdatedAt: time.Now().Format("15:04"),
		Source:    "china",
		Fallback:  false,
	}, true
}

func (p *Plugin) fetchOpenMeteo(lat, lon float64, resolvedName string) (Payload, bool) {
	wURL := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,surface_pressure,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=4",
		lat, lon,
	)
	wResp, err := p.client.Get(wURL)
	if err != nil {
		return Payload{}, false
	}
	defer wResp.Body.Close()

	var fc struct {
		Current struct {
			Temp      float64 `json:"temperature_2m"`
			FeelsLike float64 `json:"apparent_temperature"`
			Humidity  int     `json:"relative_humidity_2m"`
			Code      int     `json:"weather_code"`
			WindKMH   float64 `json:"wind_speed_10m"`
			Pressure  float64 `json:"surface_pressure"`
			IsDay     int     `json:"is_day"`
		} `json:"current"`
		Daily struct {
			Time       []string  `json:"time"`
			Code       []int     `json:"weather_code"`
			TempMax    []float64 `json:"temperature_2m_max"`
			TempMin    []float64 `json:"temperature_2m_min"`
			PrecipProb []int     `json:"precipitation_probability_max"`
		} `json:"daily"`
	}
	if err := json.NewDecoder(io.LimitReader(wResp.Body, 256<<10)).Decode(&fc); err != nil {
		return Payload{}, false
	}

	cond, kind := mapWMO(fc.Current.Code)
	days := make([]Day, 0, len(fc.Daily.Time))
	for i, dStr := range fc.Daily.Time {
		dCond, dKind := cond, kind
		if i < len(fc.Daily.Code) {
			dCond, dKind = mapWMO(fc.Daily.Code[i])
		}
		var tMin, tMax float64
		if i < len(fc.Daily.TempMin) {
			tMin = round1(fc.Daily.TempMin[i])
		}
		if i < len(fc.Daily.TempMax) {
			tMax = round1(fc.Daily.TempMax[i])
		}
		pp := 0
		if i < len(fc.Daily.PrecipProb) {
			pp = fc.Daily.PrecipProb[i]
		}
		days = append(days, Day{
			Date: dStr, Label: formatDayLabel(i, dStr),
			Cond: dCond, Kind: dKind, TempMinC: tMin, TempMaxC: tMax, PrecipProb: pp,
		})
	}

	tomorrow := fmt.Sprintf("%.0f°", fc.Current.Temp)
	if len(fc.Daily.TempMax) > 1 {
		tomorrow = fmt.Sprintf("%.0f°", fc.Daily.TempMax[1])
	}
	todayMax, todayMin := round1(fc.Current.Temp), round1(fc.Current.Temp)
	if len(fc.Daily.TempMax) > 0 {
		todayMax = round1(fc.Daily.TempMax[0])
	}
	if len(fc.Daily.TempMin) > 0 {
		todayMin = round1(fc.Daily.TempMin[0])
	}
	todayPP := 0
	if len(fc.Daily.PrecipProb) > 0 {
		todayPP = fc.Daily.PrecipProb[0]
	}

	return Payload{
		City: resolvedName, Lat: lat, Lon: lon,
		TempC: round1(fc.Current.Temp), FeelsLikeC: round1(fc.Current.FeelsLike),
		Cond: cond, Kind: kind, IsDay: fc.Current.IsDay == 1,
		Humidity: fc.Current.Humidity, WindKMH: round1(fc.Current.WindKMH),
		PressureHPA: math.Round(fc.Current.Pressure),
		TempMinC: todayMin, TempMaxC: todayMax, PrecipProb: todayPP,
		Daily: days,
		Slots: []Slot{
			{Label: "最高", Temp: fmt.Sprintf("%.0f°", todayMax)},
			{Label: "明", Temp: tomorrow},
		},
		UpdatedAt: time.Now().Format("15:04"),
		Source:    "open-meteo",
		Fallback:  false,
	}, true
}

func fallbackWeather(city, label string) Payload {
	return Payload{
		City: plugin.FirstNonEmpty(label, city, "上海"),
		Lat: 31.2304, Lon: 121.4737, TempC: 18, FeelsLikeC: 17.5,
		Cond: "晴转多云", Kind: "cloud", IsDay: true, Humidity: 52,
		WindKMH: 9.5, PressureHPA: 1016, TempMinC: 13, TempMaxC: 21, PrecipProb: 10,
		Daily: []Day{
			{Label: "今", Cond: "晴转多云", Kind: "cloud", TempMinC: 13, TempMaxC: 21, PrecipProb: 10},
			{Label: "明", Cond: "晴朗", Kind: "clear", TempMinC: 14, TempMaxC: 22, PrecipProb: 5},
			{Label: "后天", Cond: "多云", Kind: "cloud", TempMinC: 15, TempMaxC: 20, PrecipProb: 15},
		},
		Slots:     []Slot{{Label: "最高", Temp: "21°"}, {Label: "明", Temp: "22°"}},
		UpdatedAt: time.Now().Format("15:04"),
		Source:    "fallback",
		Fallback:  true,
	}
}

func formatDayLabel(idx int, dateStr string) string {
	switch idx {
	case 0:
		return "今"
	case 1:
		return "明"
	case 2:
		return "后天"
	default:
		if t, err := time.Parse("2006-01-02", dateStr); err == nil {
			wds := []string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}
			return wds[t.Weekday()]
		}
		return fmt.Sprintf("+%dd", idx)
	}
}

func mapCaiyunSkycon(skycon string) (cond, kind string, isDay bool) {
	hour := time.Now().Hour()
	isDay = hour >= 6 && hour < 19
	switch strings.ToUpper(strings.TrimSpace(skycon)) {
	case "CLEAR_DAY":
		return "晴朗", "clear", true
	case "CLEAR_NIGHT":
		return "晴夜", "clear", false
	case "PARTLY_CLOUDY_DAY":
		return "多云", "cloud", true
	case "PARTLY_CLOUDY_NIGHT":
		return "多云", "cloud", false
	case "CLOUDY":
		return "阴", "cloud", isDay
	case "LIGHT_HAZE":
		return "轻度雾霾", "cloud", isDay
	case "MODERATE_HAZE":
		return "中度雾霾", "cloud", isDay
	case "HEAVY_HAZE":
		return "重度雾霾", "cloud", isDay
	case "LIGHT_RAIN":
		return "小雨", "rain", isDay
	case "MODERATE_RAIN":
		return "中雨", "rain", isDay
	case "HEAVY_RAIN":
		return "大雨", "rain", isDay
	case "STORM_RAIN":
		return "暴雨", "storm", isDay
	case "FOG":
		return "雾", "cloud", isDay
	case "LIGHT_SNOW":
		return "小雪", "snow", isDay
	case "MODERATE_SNOW":
		return "中雪", "snow", isDay
	case "HEAVY_SNOW":
		return "大雪", "snow", isDay
	case "STORM_SNOW":
		return "暴雪", "snow", isDay
	case "DUST":
		return "浮尘", "cloud", isDay
	case "SAND":
		return "沙尘", "cloud", isDay
	case "WIND":
		return "大风", "cloud", isDay
	default:
		return "多云", "cloud", isDay
	}
}

func mapCMACode(code int, rawText string) (cond, kind string, precipProb int) {
	label := strings.TrimSpace(rawText)
	if label == "9999" {
		label = ""
	}
	switch {
	case code == 0:
		return plugin.FirstNonEmpty(label, "晴"), "clear", 5
	case code == 1:
		return plugin.FirstNonEmpty(label, "多云"), "cloud", 15
	case code == 2:
		return plugin.FirstNonEmpty(label, "阴"), "cloud", 25
	case code == 4 || code == 5:
		return plugin.FirstNonEmpty(label, "雷阵雨"), "storm", 80
	case code == 3 || (code >= 7 && code <= 12) || code == 19 || (code >= 21 && code <= 25):
		return plugin.FirstNonEmpty(label, "雨"), "rain", 75
	case code == 6 || (code >= 13 && code <= 17) || (code >= 26 && code <= 28):
		return plugin.FirstNonEmpty(label, "雪"), "snow", 70
	case code == 18 || code == 32 || code == 49 || code == 53 || code == 54 || code == 55 || code == 56:
		return plugin.FirstNonEmpty(label, "雾霾"), "cloud", 15
	case code == 20 || (code >= 29 && code <= 31):
		return plugin.FirstNonEmpty(label, "沙尘"), "cloud", 10
	default:
		switch {
		case strings.Contains(label, "雷"):
			return label, "storm", 80
		case strings.Contains(label, "雪"):
			return label, "snow", 70
		case strings.Contains(label, "雨"):
			return label, "rain", 75
		case strings.Contains(label, "晴"):
			return label, "clear", 5
		default:
			return plugin.FirstNonEmpty(label, "多云"), "cloud", 20
		}
	}
}

func mapWMO(code int) (string, string) {
	switch {
	case code == 0:
		return "晴朗", "clear"
	case code <= 3:
		return "多云", "cloud"
	case code <= 48:
		return "雾霾", "cloud"
	case code <= 67 || (code >= 80 && code <= 82):
		return "小雨", "rain"
	case code <= 77 || (code >= 85 && code <= 86):
		return "降雪", "snow"
	case code >= 95:
		return "雷暴", "storm"
	default:
		return "阵雨", "rain"
	}
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}
