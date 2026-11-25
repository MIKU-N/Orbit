package hitokoto

import (
	"encoding/json"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"time"

	"orbit/internal/plugin"
)

type Quote struct {
	Text    string `json:"text"`
	From    string `json:"from"`
	FromWho string `json:"from_who"`
	Source  string `json:"source"` // "api" | "builtin"
}

var builtinQuotes = []Quote{
	{Text: "凡是过往，皆为序章。", From: "暴风雨", FromWho: "莎士比亚", Source: "builtin"},
	{Text: "星光不问赶路人，时光不负有心人。", From: "随笔", FromWho: "", Source: "builtin"},
	{Text: "世界以痛吻我，要我报之以歌。", From: "飞鸟集", FromWho: "泰戈尔", Source: "builtin"},
	{Text: "山有木兮木有枝，心悦君兮君不知。", From: "越人歌", FromWho: "", Source: "builtin"},
	{Text: "海内存知己，天涯若比邻。", From: "送杜少府之任蜀州", FromWho: "王勃", Source: "builtin"},
	{Text: "行到水穷处，坐看云起时。", From: "终南别业", FromWho: "王维", Source: "builtin"},
	{Text: "长风破浪会有时，直挂云帆济沧海。", From: "行路难", FromWho: "李白", Source: "builtin"},
	{Text: "落霞与孤鹜齐飞，秋水共长天一色。", From: "滕王阁序", FromWho: "王勃", Source: "builtin"},
	{Text: "醉后不知天在水，满船清梦压星河。", From: "题龙阳县青草湖", FromWho: "唐温如", Source: "builtin"},
	{Text: "知足且上进，温柔而坚定。", From: "日常", FromWho: "", Source: "builtin"},
	{Text: "人生如逆旅，我亦是行人。", From: "临江仙", FromWho: "苏轼", Source: "builtin"},
	{Text: "生活明朗，万物可爱。", From: "随笔", FromWho: "", Source: "builtin"},
	{Text: "愿你走出半生，归来仍是少年。", From: "致青春", FromWho: "", Source: "builtin"},
	{Text: "道阻且长，行则将至；行而不辍，未来可期。", From: "荀子", FromWho: "", Source: "builtin"},
	{Text: "心之所向，素履以往；生如逆旅，一苇以航。", From: "尘曲", FromWho: "七堇年", Source: "builtin"},
	{Text: "且将新火试新茶，诗酒趁年华。", From: "望江南", FromWho: "苏轼", Source: "builtin"},
	{Text: "保持热爱，奔赴下一场山海。", From: "随笔", FromWho: "", Source: "builtin"},
	{Text: "黑夜无论怎样悠长，白昼总会到来。", From: "麦克白", FromWho: "莎士比亚", Source: "builtin"},
	{Text: "万物皆有裂痕，那是光照进来的地方。", From: "Anthem", FromWho: "莱昂纳德·科恩", Source: "builtin"},
	{Text: "宁静致远，淡泊明志。", From: "诫子书", FromWho: "诸葛亮", Source: "builtin"},
	{Text: "追风赶月莫停留，平芜尽处是春山。", From: "春山", FromWho: "田锡", Source: "builtin"},
	{Text: "满怀希望就会所向披靡。", From: "撒野", FromWho: "巫哲", Source: "builtin"},
	{Text: "代码如诗，架构如星轨，简洁即永恒。", From: "Orbit · 星轨", FromWho: "", Source: "builtin"},
	{Text: "慢慢来，谁还没有一个努力的过程。", From: "日常", FromWho: "", Source: "builtin"},
}

type Plugin struct {
	host   plugin.Host
	client *http.Client
}

func New() *Plugin { return &Plugin{} }

func (p *Plugin) Manifest() plugin.Manifest {
	return plugin.Manifest{
		ID:             "orbit.hitokoto",
		Name:           "每日一言",
		Version:        "1.0.0",
		Description:    "支持在线一言 API 与内置精选文案库，支持自动轮播与点击刷新",
		Icon:           "quote",
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
					LayoutKey:      "hitokoto",
					Label:          "一言",
					MinW:           260,
					DefaultW:       620,
					Resizable:      true,
					DefaultVisible: true,
				},
			},
			Settings: &plugin.SettingsContrib{
				TabID:          "hitokoto",
				Label:          "一言卡片",
				Icon:           "quote",
				SearchKeywords: []string{"一言", "hitokoto", "语录", "文案", "轮播", "刷新", "api", "内置"},
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
	r.Handle("GET /quote", p.handleQuote)
	r.Handle("GET /builtin", p.handleBuiltinList)

	r.HandleCompat("GET /api/hitokoto", p.handleQuote, false)
	r.HandleCompat("GET /api/hitokoto/builtin", p.handleBuiltinList, false)
}

func (p *Plugin) handleBuiltinList(w http.ResponseWriter, r *http.Request) {
	plugin.WriteJSON(w, http.StatusOK, map[string]any{"quotes": builtinQuotes})
}

func (p *Plugin) handleQuote(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	mode := strings.ToLower(strings.TrimSpace(q.Get("mode")))
	if mode == "" {
		mode = "auto"
	}
	exclude := strings.TrimSpace(q.Get("exclude"))
	typesRaw := strings.TrimSpace(q.Get("types"))
	customAPI := strings.TrimSpace(q.Get("api_url"))

	if mode == "builtin" {
		plugin.WriteJSON(w, http.StatusOK, pickBuiltin(exclude))
		return
	}

	if quote, ok := p.fetchFromAPI(customAPI, typesRaw); ok {
		plugin.WriteJSON(w, http.StatusOK, quote)
		return
	}

	if mode == "api" {
		plugin.WriteErr(w, http.StatusBadGateway, "一言 API 请求失败，请检查网络或切换为自动/内置模式")
		return
	}

	// auto mode gracefully falls back to curated builtin quotes
	plugin.WriteJSON(w, http.StatusOK, pickBuiltin(exclude))
}

func pickBuiltin(exclude string) Quote {
	if len(builtinQuotes) == 0 {
		return Quote{Text: "凡是过往，皆为序章。", From: "暴风雨", FromWho: "莎士比亚", Source: "builtin"}
	}
	if len(builtinQuotes) == 1 {
		return builtinQuotes[0]
	}
	for i := 0; i < 6; i++ {
		cand := builtinQuotes[rand.IntN(len(builtinQuotes))]
		if cand.Text != exclude {
			return cand
		}
	}
	return builtinQuotes[rand.IntN(len(builtinQuotes))]
}

func (p *Plugin) fetchFromAPI(customAPI, typesRaw string) (Quote, bool) {
	targetURL := "https://v1.hitokoto.cn/?encode=json"
	if customAPI != "" {
		parsed, err := url.Parse(customAPI)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return Quote{}, false
		}
		targetURL = customAPI
	} else if typesRaw != "" {
		params := url.Values{}
		params.Set("encode", "json")
		for _, t := range strings.Split(typesRaw, ",") {
			t = strings.TrimSpace(t)
			if len(t) == 1 && t[0] >= 'a' && t[0] <= 'l' {
				params.Add("c", t)
			}
		}
		targetURL = "https://v1.hitokoto.cn/?" + params.Encode()
	}

	req, err := http.NewRequest(http.MethodGet, targetURL, nil)
	if err != nil {
		return Quote{}, false
	}
	req.Header.Set("User-Agent", "Orbit/1.0")
	req.Header.Set("Accept", "application/json, text/plain;q=0.9")

	resp, err := p.client.Do(req)
	if err != nil {
		return Quote{}, false
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Quote{}, false
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil || len(raw) == 0 {
		return Quote{}, false
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return Quote{}, false
	}

	if strings.HasPrefix(trimmed, "{") {
		var obj struct {
			Hitokoto string `json:"hitokoto"`
			Text     string `json:"text"`
			Content  string `json:"content"`
			Quote    string `json:"quote"`
			From     string `json:"from"`
			FromWho  string `json:"from_who"`
			Author   string `json:"author"`
			Source   string `json:"source"`
			Data     *struct {
				Hitokoto string `json:"hitokoto"`
				Text     string `json:"text"`
				Content  string `json:"content"`
				From     string `json:"from"`
				FromWho  string `json:"from_who"`
				Author   string `json:"author"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &obj); err == nil {
			txt := plugin.FirstNonEmpty(obj.Hitokoto, obj.Text, obj.Content, obj.Quote)
			from := plugin.FirstNonEmpty(obj.From, obj.Source)
			who := plugin.FirstNonEmpty(obj.FromWho, obj.Author)
			if txt == "" && obj.Data != nil {
				txt = plugin.FirstNonEmpty(obj.Data.Hitokoto, obj.Data.Text, obj.Data.Content)
				from = plugin.FirstNonEmpty(from, obj.Data.From)
				who = plugin.FirstNonEmpty(who, obj.Data.FromWho, obj.Data.Author)
			}
			if txt != "" {
				return Quote{
					Text:    txt,
					From:    from,
					FromWho: who,
					Source:  "api",
				}, true
			}
		}
		return Quote{}, false
	}

	// Plain-text quote API support
	if len(trimmed) <= 300 && !strings.HasPrefix(strings.ToLower(trimmed), "<!doctype") && !strings.HasPrefix(strings.ToLower(trimmed), "<html") {
		return Quote{
			Text:   trimmed,
			Source: "api",
		}, true
	}
	return Quote{}, false
}
