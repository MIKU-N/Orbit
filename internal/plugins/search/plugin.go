package search

import "orbit/internal/plugin"

type Plugin struct {
	host plugin.Host
}

func New() *Plugin { return &Plugin{} }

func (p *Plugin) Manifest() plugin.Manifest {
	return plugin.Manifest{
		ID:             "orbit.search",
		Name:           "统一搜索",
		Version:        "1.0.0",
		Description:    "多引擎快捷切换、仅图标模式、站内书签/剪贴板/文件统一检索",
		Icon:           "search",
		Tier:           "core",
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
					LayoutKey:      "search",
					Label:          "搜索",
					MinW:           280,
					DefaultW:       580,
					Resizable:      true,
					DefaultVisible: true,
				},
			},
			Settings: &plugin.SettingsContrib{
				TabID:          "search",
				Label:          "搜索设置",
				Icon:           "search",
				SearchKeywords: []string{"搜索", "引擎", "仅图标", "快捷键", "图标", "google", "bing"},
			},
		},
	}
}

func (p *Plugin) Init(host plugin.Host) error {
	p.host = host
	return nil
}

func (p *Plugin) RegisterRoutes(_ plugin.RouteGroup) {}
