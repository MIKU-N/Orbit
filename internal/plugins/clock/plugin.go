package clock

import "orbit/internal/plugin"

type Plugin struct {
	host plugin.Host
}

func New() *Plugin { return &Plugin{} }

func (p *Plugin) Manifest() plugin.Manifest {
	return plugin.Manifest{
		ID:             "orbit.clock",
		Name:           "数字时钟",
		Version:        "1.0.0",
		Description:    "居中极简数字时钟，支持秒数显示开关",
		Icon:           "clock",
		Tier:           "light",
		Source:         "official",
		DefaultEnabled: true,
		Access: plugin.AccessSpec{
			MinRole:     "public",
			Guest:       plugin.GuestSpec{Mode: "full"},
			AllowPublic: true,
		},
		Style: &plugin.StyleSpec{
			Managed:          true,
			SupportsCardless: true,
			DefaultCardless:  true,
		},
		Contributes: plugin.ContributesSpec{
			Widgets: []plugin.WidgetContrib{
				{
					ID:             "main",
					LayoutKey:      "clock",
					Label:          "时钟",
					MinW:           220,
					DefaultW:       340,
					Resizable:      true,
					DefaultVisible: true,
				},
			},
		},
	}
}

func (p *Plugin) Init(host plugin.Host) error {
	p.host = host
	return nil
}

func (p *Plugin) RegisterRoutes(_ plugin.RouteGroup) {}
