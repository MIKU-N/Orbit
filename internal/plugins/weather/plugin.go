package weather

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"orbit/internal/db"
	"orbit/internal/plugin"
)

type Location struct {
	Name        string  `json:"name"`
	DisplayName string  `json:"display_name"`
	City        string  `json:"city"`
	Admin       string  `json:"admin"`
	Country     string  `json:"country"`
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
	Fallback    bool    `json:"fallback"`
}

type Query struct {
	City    string
	Label   string
	Lat     *float64
	Lon     *float64
	Refresh bool
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
	host        plugin.Host
	client      *http.Client
	mu          sync.Mutex
	cache       map[string]weatherEntry
	searchCache map[string]searchEntry
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
		Version:        "1.0.0",
		Description:    "支持区/县级精确定位、体感/风速/降水/气压多字段自定义与游客只读展示",
		Icon:           "cloud-sun",
		Tier:           "builtin",
		DefaultEnabled: true,
		Access: plugin.AccessSpec{
			MinRole: "public",
			Guest:   plugin.GuestSpec{Mode: "readonly"},
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
				SearchKeywords: []string{"天气", "区县", "城市", "经纬度", "温度", "体感", "湿度", "风速", "预报"},
			},
		},
	}
}

func (p *Plugin) Init(host plugin.Host) error {
	p.host = host
	p.client = host.Network().HTTPClient(5*time.Second, false)
	return nil
}

func (p *Plugin) RegisterRoutes(r plugin.RouteGroup) {
	r.HandleAuth("GET /search", p.handleSearch)
	r.HandleAuth("GET /current", p.handleWeather)
	r.Handle("GET /public", p.handlePublicWeather)

	r.HandleCompat("GET /api/weather/search", p.handleSearch, true)
	r.HandleCompat("GET /api/weather", p.handleWeather, true)
	r.HandleCompat("GET /api/public/weather", p.handlePublicWeather, false)
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

func (p *Plugin) handleWeather(w http.ResponseWriter, r *http.Request) {
	q := Query{
		City:    r.URL.Query().Get("city"),
		Label:   r.URL.Query().Get("label"),
		Refresh: r.URL.Query().Get("refresh") == "1",
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

	q := Query{City: "Shanghai", Label: "上海"}
	if wc, ok := src["weatherConfig"].(map[string]any); ok {
		if v, ok := wc["query"].(string); ok && v != "" {
			q.City = v
		}
		if v, ok := wc["label"].(string); ok && v != "" {
			q.Label = v
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

	results := p.searchNominatim(q)
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

func (p *Plugin) searchNominatim(q string) []Location {
	u := "https://nominatim.openstreetmap.org/search?q=" + url.QueryEscape(q) +
		"&format=json&limit=8&accept-language=zh-CN&addressdetails=1"
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "OrbitHomePanel/1.0")
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
		stripped := strings.TrimRight(q, "区县市 ")
		if stripped != "" && stripped != q {
			res = queryOnce(stripped)
		}
	}
	return res
}

func (p *Plugin) getWeather(q Query) Payload {
	label := strings.TrimSpace(q.Label)
	city := strings.TrimSpace(q.City)
	if city == "" && label != "" {
		city = label
	}
	if city == "" {
		city = "Shanghai"
	}

	hasCoords := q.Lat != nil && q.Lon != nil
	cacheKey := "city:" + strings.ToLower(city)
	if hasCoords {
		cacheKey = fmt.Sprintf("coord:%.4f,%.4f", *q.Lat, *q.Lon)
	}

	if !q.Refresh {
		p.mu.Lock()
		if ent, ok := p.cache[cacheKey]; ok && time.Since(ent.fetchedAt) < 30*time.Minute {
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
	resolvedName := city
	if hasCoords {
		lat, lon = *q.Lat, *q.Lon
		if label != "" {
			resolvedName = label
		}
	} else {
		locs := p.searchLocations(city)
		if len(locs) > 0 {
			lat, lon = locs[0].Lat, locs[0].Lon
			resolvedName = plugin.FirstNonEmpty(label, locs[0].Name, city)
		} else {
			return fallbackWeather(city, label)
		}
	}

	if live, ok := p.fetchForecast(lat, lon, resolvedName); ok {
		p.mu.Lock()
		p.cache[cacheKey] = weatherEntry{fetchedAt: time.Now(), payload: live}
		p.mu.Unlock()
		if label != "" {
			live.City = label
		}
		return live
	}
	return fallbackWeather(resolvedName, label)
}

func (p *Plugin) fetchForecast(lat, lon float64, resolvedName string) (Payload, bool) {
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
		UpdatedAt: time.Now().Format("15:04"), Fallback: true,
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
