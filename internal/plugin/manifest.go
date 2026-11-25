package plugin

import (
	"errors"
	"regexp"
	"strings"
)

var validPluginIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]*\.[a-z0-9][a-z0-9.-]*$`)

type GuestSpec struct {
	Mode   string `json:"mode"` // "hidden" | "readonly" | "full" | "login-prompt"
	Prompt string `json:"prompt,omitempty"`
}

type SharingSpec struct {
	Shareable     bool   `json:"shareable"`
	ScopeKey      string `json:"scopeKey"`
	Label         string `json:"label"`
	DefaultShared bool   `json:"defaultShared"`
	Mode          string `json:"mode"` // "readonly" | "sync"
}

type AccessSpec struct {
	MinRole      string       `json:"minRole"` // "public" | "user" | "admin"
	Guest        GuestSpec    `json:"guest"`
	Sharing      *SharingSpec `json:"sharing,omitempty"`
	Permissions  []string     `json:"permissions,omitempty"`
	AllowPublic  bool         `json:"allowPublic,omitempty"` // whether admin may expose this plugin to unauthenticated guests
}

type StyleSpec struct {
	Managed          bool `json:"managed"`                    // accepts global managed theme/font/radius/glass tokens
	SupportsCardless bool `json:"supportsCardless"`           // supports rendering without outer card chrome
	DefaultCardless  bool `json:"defaultCardless,omitempty"`  // render without outer card chrome by default
	HideHeader       bool `json:"hideHeader,omitempty"`       // hide external widget title header
}

type VisibilityOverride struct {
	MinRole   string `json:"minRole,omitempty"`   // "public" | "user" | "admin"
	GuestMode string `json:"guestMode,omitempty"` // "hidden" | "readonly" | "full" | "login-prompt"
}

type StyleOverride struct {
	Managed    *bool `json:"managed,omitempty"`
	Cardless   *bool `json:"cardless,omitempty"`
	HideHeader *bool `json:"hideHeader,omitempty"`
}

type WidgetContrib struct {
	ID             string `json:"id"`
	LayoutKey      string `json:"layoutKey,omitempty"`
	Label          string `json:"label"`
	MinW           int    `json:"minW"`
	DefaultW       int    `json:"defaultW"`
	Resizable      bool   `json:"resizable"`
	DefaultVisible bool   `json:"defaultVisible"`
}

type DrawerContrib struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Icon       string `json:"icon"`
	Shortcut   string `json:"shortcut,omitempty"`
	TopBar     bool   `json:"topBar"`
	MobileDock bool   `json:"mobileDock"`
	Order      int    `json:"order"`
}

type SettingsContrib struct {
	TabID          string   `json:"tabId"`
	Label          string   `json:"label"`
	Icon           string   `json:"icon"`
	SearchKeywords []string `json:"searchKeywords,omitempty"`
}

type SearchProviderContrib struct {
	Enabled  bool `json:"enabled"`
	Priority int  `json:"priority"`
}

type DropHandlerContrib struct {
	Accept   string `json:"accept"`
	Priority int    `json:"priority"`
}

type ContributesSpec struct {
	Widgets        []WidgetContrib        `json:"widgets,omitempty"`
	Drawers        []DrawerContrib        `json:"drawers,omitempty"`
	Settings       *SettingsContrib       `json:"settings,omitempty"`
	SearchProvider *SearchProviderContrib `json:"searchProvider,omitempty"`
	DropHandler    *DropHandlerContrib    `json:"dropHandler,omitempty"`
}

type ProxyRule struct {
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers,omitempty"`
	TimeoutMs int               `json:"timeoutMs,omitempty"`
	Public    bool              `json:"public,omitempty"`
}

type ConfigField struct {
	Key          string `json:"key"`
	Label        string `json:"label"`
	Type         string `json:"type"` // "text" | "password" | "url" | "number" | "boolean"
	Placeholder  string `json:"placeholder,omitempty"`
	Secret       bool   `json:"secret,omitempty"`
	DefaultValue string `json:"defaultValue,omitempty"`
}

type ExternalSpec struct {
	Entry        string               `json:"entry"`      // relative file in plugin dir, e.g. widget.html or widget.mjs
	RenderMode   string               `json:"renderMode"` // "iframe" | "esm"
	HTTPProxy    map[string]ProxyRule `json:"httpProxy,omitempty"`
	ConfigFields []ConfigField        `json:"configFields,omitempty"`
}

type Manifest struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Version        string          `json:"version"`
	Description    string          `json:"description"`
	Icon           string          `json:"icon"`
	Tier           string          `json:"tier"`             // "core" | "light"
	Source         string          `json:"source,omitempty"` // "official" | "external"
	DefaultEnabled bool            `json:"defaultEnabled"`
	Access         AccessSpec      `json:"access"`
	Style          *StyleSpec      `json:"style,omitempty"`
	Contributes    ContributesSpec `json:"contributes"`
	External       *ExternalSpec   `json:"external,omitempty"`
}

type PluginStateRecord struct {
	Manifest   Manifest            `json:"manifest"`
	Enabled    bool                `json:"enabled"`
	Config     map[string]any      `json:"config"`
	Visibility *VisibilityOverride `json:"visibility,omitempty"`
	Style      *StyleOverride      `json:"style,omitempty"`
}

func IsValidPluginID(id string) bool {
	if len(id) < 3 || len(id) > 64 {
		return false
	}
	if strings.Contains(id, "..") {
		return false
	}
	return validPluginIDRe.MatchString(id)
}

func NormalizeTier(tier, source string) (string, string) {
	switch tier {
	case "core":
		if source == "" {
			source = "official"
		}
		return "core", source
	case "light":
		if source == "" {
			source = "external"
		}
		return "light", source
	case "builtin":
		return "core", "official"
	case "external":
		return "light", "external"
	default:
		if source == "official" {
			return "light", "official"
		}
		return "light", "external"
	}
}

func ValidateManifest(m *Manifest) error {
	if m == nil {
		return errors.New("manifest is nil")
	}
	m.ID = strings.TrimSpace(strings.ToLower(m.ID))
	if !IsValidPluginID(m.ID) {
		return errors.New("plugin id must use <namespace>.<name> lowercase format")
	}
	if strings.TrimSpace(m.Name) == "" {
		return errors.New("plugin name required")
	}
	if strings.TrimSpace(m.Version) == "" {
		m.Version = "1.0.0"
	}
	m.Tier, m.Source = NormalizeTier(m.Tier, m.Source)
	if m.Access.MinRole == "" {
		m.Access.MinRole = "user"
	}
	if m.Access.Guest.Mode == "" {
		m.Access.Guest.Mode = "hidden"
	}
	if m.Access.MinRole == "public" || m.Source == "external" {
		m.Access.AllowPublic = true
	}
	if m.Access.Sharing != nil {
		m.Access.Sharing.DefaultShared = false
	}
	if m.Style == nil {
		m.Style = &StyleSpec{
			Managed:          true,
			SupportsCardless: true,
		}
	}
	if m.Source == "external" && m.External != nil {
		if m.External.RenderMode == "" {
			if strings.HasSuffix(strings.ToLower(m.External.Entry), ".mjs") || strings.HasSuffix(strings.ToLower(m.External.Entry), ".js") {
				m.External.RenderMode = "esm"
			} else {
				m.External.RenderMode = "iframe"
			}
		}
		if m.External.Entry == "" {
			m.External.Entry = "widget.html"
		}
	}
	return nil
}

func (m Manifest) HasPermission(perm string) bool {
	if m.Source == "official" || m.Tier == "core" {
		return true
	}
	for _, p := range m.Access.Permissions {
		if p == perm {
			return true
		}
	}
	return false
}

// EffectiveAccess applies an optional admin VisibilityOverride onto the manifest default access spec.
func (m Manifest) EffectiveAccess(ov *VisibilityOverride) AccessSpec {
	acc := m.Access
	if ov == nil {
		return acc
	}
	switch ov.MinRole {
	case "public":
		if m.Access.AllowPublic || m.Access.MinRole == "public" || m.Source == "external" {
			acc.MinRole = "public"
			if ov.GuestMode != "" {
				acc.Guest.Mode = ov.GuestMode
			} else if acc.Guest.Mode == "hidden" || acc.Guest.Mode == "login-prompt" {
				acc.Guest.Mode = "readonly"
			}
		}
	case "user":
		acc.MinRole = "user"
		if ov.GuestMode == "hidden" || ov.GuestMode == "login-prompt" {
			acc.Guest.Mode = ov.GuestMode
		} else {
			acc.Guest.Mode = "hidden"
		}
	case "admin":
		acc.MinRole = "admin"
		acc.Guest.Mode = "hidden"
	default:
		if ov.GuestMode != "" {
			switch ov.GuestMode {
			case "hidden", "login-prompt":
				acc.Guest.Mode = ov.GuestMode
			case "readonly", "full":
				if m.Access.AllowPublic || m.Access.MinRole == "public" || m.Source == "external" {
					acc.Guest.Mode = ov.GuestMode
				}
			}
		}
	}
	return acc
}
