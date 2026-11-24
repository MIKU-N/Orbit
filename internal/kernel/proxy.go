package kernel

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"orbit/internal/plugin"
)

var _, tailscaleProxyBypassCIDR, _ = net.ParseCIDR("100.64.0.0/10")

// NewDirectLANTransport bypasses HTTP_PROXY/HTTPS_PROXY for private LAN,
// Tailscale CGNAT, loopback, and .local/.lan/.internal hosts while preserving
// environment proxy settings for public Internet addresses.
func NewDirectLANTransport(insecureTLS bool) *http.Transport {
	return &http.Transport{
		Proxy: func(req *http.Request) (*url.URL, error) {
			if req != nil && req.URL != nil && shouldBypassProxyHost(req.URL.Hostname()) {
				return nil, nil
			}
			return http.ProxyFromEnvironment(req)
		},
		DialContext: (&net.Dialer{
			Timeout:   4 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSClientConfig: &tls.Config{InsecureSkipVerify: insecureTLS},
	}
}

func shouldBypassProxyHost(host string) bool {
	if host == "" {
		return true
	}
	lower := strings.ToLower(host)
	if lower == "localhost" ||
		strings.HasSuffix(lower, ".local") ||
		strings.HasSuffix(lower, ".lan") ||
		strings.HasSuffix(lower, ".internal") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil && tailscaleProxyBypassCIDR != nil && tailscaleProxyBypassCIDR.Contains(ip4) {
		return true
	}
	return false
}

func (k *Kernel) executePluginProxy(w http.ResponseWriter, r *http.Request, m plugin.Manifest, routeName string, userID int64) {
	if !m.HasPermission("http:proxy") || m.External == nil {
		plugin.WriteErr(w, http.StatusForbidden, "plugin lacks http:proxy permission")
		return
	}
	rule, ok := m.External.HTTPProxy[routeName]
	if !ok {
		plugin.WriteErr(w, http.StatusNotFound, "proxy route not found")
		return
	}
	if !rule.Public && userID <= 0 {
		plugin.WriteErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	vars := k.resolvePluginProxyVars(r, m.ID, userID)
	targetURL := expandTemplate(rule.URL, vars)
	if strings.Contains(targetURL, "{{") {
		plugin.WriteErr(w, http.StatusBadRequest, "插件尚未配置所需参数（例如地址或密钥）")
		return
	}
	parsed, err := url.Parse(targetURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		plugin.WriteErr(w, http.StatusBadRequest, "目标代理地址无效")
		return
	}

	method := strings.ToUpper(strings.TrimSpace(rule.Method))
	if method == "" {
		method = http.MethodGet
	}

	var body io.Reader
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch {
		body = io.LimitReader(r.Body, 1<<20)
	}

	timeout := time.Duration(rule.TimeoutMs) * time.Millisecond
	if timeout <= 0 || timeout > 15*time.Second {
		timeout = 6 * time.Second
	}

	reqProxy, err := http.NewRequestWithContext(r.Context(), method, targetURL, body)
	if err != nil {
		plugin.WriteErr(w, http.StatusBadRequest, "failed to create proxy request")
		return
	}
	reqProxy.Header.Set("User-Agent", "Orbit-PluginProxy/1.0")
	if ct := r.Header.Get("Content-Type"); ct != "" && body != nil {
		reqProxy.Header.Set("Content-Type", ct)
	}
	for hk, hv := range rule.Headers {
		reqProxy.Header.Set(hk, expandTemplate(hv, vars))
	}

	client := k.HTTPClient(timeout, true)
	resp, err := client.Do(reqProxy)
	if err != nil {
		plugin.WriteErr(w, http.StatusBadGateway, "目标服务不可达: "+err.Error())
		return
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		plugin.WriteErr(w, http.StatusBadGateway, "读取上游响应失败")
		return
	}
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/json; charset=utf-8"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("X-Orbit-Proxy-Status", fmt.Sprintf("%d", resp.StatusCode))
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBytes)
}

func (k *Kernel) resolvePluginProxyVars(r *http.Request, pluginID string, userID int64) map[string]string {
	vars := make(map[string]string)
	for kName, v := range k.PluginConfig(pluginID) {
		if str, ok := toString(v); ok && str != "" {
			vars[kName] = strings.TrimRight(str, "/")
		}
	}
	if userID > 0 {
		if kvMap, err := k.KV(pluginID).List(r.Context(), userID); err == nil {
			for kName, raw := range kvMap {
				var s string
				if err := unmarshalScalar(raw, &s); err == nil && s != "" {
					vars[kName] = s
				}
			}
		}
	}
	// Also pass safe query params (?q=...) as template vars
	for qk, qvs := range r.URL.Query() {
		if len(qvs) > 0 && qk != "" {
			if _, exists := vars[qk]; !exists {
				vars[qk] = url.QueryEscape(qvs[0])
			}
		}
	}
	return vars
}

func expandTemplate(tpl string, vars map[string]string) string {
	out := tpl
	for k, v := range vars {
		out = strings.ReplaceAll(out, "{{"+k+"}}", v)
	}
	return out
}

func unmarshalScalar(raw json.RawMessage, out *string) error {
	if err := json.Unmarshal(raw, out); err == nil {
		return nil
	}
	var num float64
	if err := json.Unmarshal(raw, &num); err == nil {
		*out = fmt.Sprintf("%g", num)
		return nil
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err == nil {
		if b {
			*out = "true"
		} else {
			*out = "false"
		}
		return nil
	}
	return fmt.Errorf("not scalar")
}

func toString(v any) (string, bool) {
	switch val := v.(type) {
	case string:
		return val, true
	case float64:
		return fmt.Sprintf("%g", val), true
	case bool:
		if val {
			return "true", true
		}
		return "false", true
	default:
		return "", false
	}
}
