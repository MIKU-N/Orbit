package auth

import (
	"net"
	"net/http"
	"strings"

	"orbit/internal/config"
)

const (
	ZoneLAN       = "lan"
	ZoneTailscale = "tailscale"
	ZoneWAN       = "wan"
)

var (
	_, tailscaleCIDR, _ = net.ParseCIDR("100.64.0.0/10")
	_, cgnat6CIDR, _    = net.ParseCIDR("fd7a:115c:a1e0::/48")
)

// DetectZone classifies the request into "lan", "tailscale", or "wan",
// and returns the effective client IP string.
func DetectZone(r *http.Request, cfg *config.Config) (string, string) {
	host := strings.ToLower(strings.TrimSpace(r.Host))
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if cfg != nil && host != "" {
		if _, isWANHost := cfg.WANHosts[host]; isWANHost {
			clientIP := extractClientIP(r, cfg.TrustProxy)
			return ZoneWAN, clientIP
		}
	}

	remoteIP := parseIP(r.RemoteAddr)
	if remoteIP == nil {
		return ZoneWAN, ""
	}

	trustHeaders := cfg != nil && cfg.TrustProxy && (isPrivateOrLoopback(remoteIP) || isTailscaleIP(remoteIP))
	if trustHeaders {
		if forwarded := extractForwardedIP(r); forwarded != nil {
			return classifyIP(forwarded), forwarded.String()
		}
	}

	return classifyIP(remoteIP), remoteIP.String()
}

// MaxUploadBytes returns the maximum allowed file upload size in bytes for a zone.
func MaxUploadBytes(zone string, cfg *config.Config) int64 {
	if cfg == nil {
		return 100 << 20
	}
	switch zone {
	case ZoneLAN:
		return cfg.LANMaxMB << 20
	case ZoneTailscale:
		return cfg.TSMaxMB << 20
	default:
		return cfg.WANMaxMB << 20
	}
}

func extractClientIP(r *http.Request, trustProxy bool) string {
	remoteIP := parseIP(r.RemoteAddr)
	if trustProxy && remoteIP != nil && (isPrivateOrLoopback(remoteIP) || isTailscaleIP(remoteIP)) {
		if fwd := extractForwardedIP(r); fwd != nil {
			return fwd.String()
		}
	}
	if remoteIP != nil {
		return remoteIP.String()
	}
	return r.RemoteAddr
}

func extractForwardedIP(r *http.Request) net.IP {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		for _, p := range parts {
			if ip := parseIP(strings.TrimSpace(p)); ip != nil {
				return ip
			}
		}
	}
	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
		if ip := parseIP(xri); ip != nil {
			return ip
		}
	}
	return nil
}

func parseIP(raw string) net.IP {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if host, _, err := net.SplitHostPort(raw); err == nil {
		raw = host
	}
	raw = strings.Trim(raw, "[]")
	return net.ParseIP(raw)
}

func classifyIP(ip net.IP) string {
	if ip == nil {
		return ZoneWAN
	}
	if isTailscaleIP(ip) {
		return ZoneTailscale
	}
	if isPrivateOrLoopback(ip) {
		return ZoneLAN
	}
	return ZoneWAN
}

func isTailscaleIP(ip net.IP) bool {
	if ip4 := ip.To4(); ip4 != nil {
		return tailscaleCIDR != nil && tailscaleCIDR.Contains(ip4)
	}
	return cgnat6CIDR != nil && cgnat6CIDR.Contains(ip)
}

func isPrivateOrLoopback(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}
