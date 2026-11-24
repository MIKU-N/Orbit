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
	MinRole     string       `json:"minRole"` // "public" | "user" | "admin"
	Guest       GuestSpec    `json:"guest"`
	Sharing     *SharingSpec `json:"sharing,omitempty"`
	Permissions []string     `json:"permissions,omitempty"`
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
	Tier           string          `json:"tier"` // "builtin" | "external"
	DefaultEnabled bool            `json:"defaultEnabled"`
	Access         AccessSpec      `json:"access"`
	Contributes    ContributesSpec `json:"contributes"`
	External       *ExternalSpec   `json:"external,omitempty"`
}

type PluginStateRecord struct {
	Manifest Manifest       `json:"manifest"`
	Enabled  bool           `json:"enabled"`
	Config   map[string]any `json:"config"`
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
	if m.Tier != "builtin" && m.Tier != "external" {
		m.Tier = "external"
	}
	if m.Access.MinRole == "" {
		m.Access.MinRole = "user"
	}
	if m.Access.Guest.Mode == "" {
		m.Access.Guest.Mode = "hidden"
	}
	if m.Access.Sharing != nil {
		m.Access.Sharing.DefaultShared = false
	}
	if m.Tier == "external" && m.External != nil {
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
	if m.Tier == "builtin" {
		return true
	}
	for _, p := range m.Access.Permissions {
		if p == perm {
			return true
		}
	}
	return false
}
