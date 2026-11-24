package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"orbit/internal/config"
)

func TestDetectZone(t *testing.T) {
	cfg := &config.Config{
		TrustProxy: true,
		WANHosts: map[string]struct{}{
			"beam.example.com": {},
		},
		LANMaxMB: 10240,
		TSMaxMB:  2048,
		WANMaxMB: 100,
	}

	cases := []struct {
		name       string
		host       string
		remoteAddr string
		xff        string
		wantZone   string
		wantIP     string
	}{
		{
			name:       "Direct LAN IP",
			host:       "192.168.1.10:8080",
			remoteAddr: "192.168.1.42:54321",
			wantZone:   ZoneLAN,
			wantIP:     "192.168.1.42",
		},
		{
			name:       "Direct Tailscale IP",
			host:       "100.88.12.5:8080",
			remoteAddr: "100.92.1.7:41234",
			wantZone:   ZoneTailscale,
			wantIP:     "100.92.1.7",
		},
		{
			name:       "VPS Reverse Proxy via Tailscale with Public XFF",
			host:       "orbit.home.org",
			remoteAddr: "100.101.2.3:50000",
			xff:        "203.0.113.88, 100.101.2.3",
			wantZone:   ZoneWAN,
			wantIP:     "203.0.113.88",
		},
		{
			name:       "Explicit WAN Host Override",
			host:       "beam.example.com:443",
			remoteAddr: "192.168.1.2:443",
			xff:        "192.168.1.5",
			wantZone:   ZoneWAN,
			wantIP:     "192.168.1.5",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "http://"+tc.host+"/", nil)
			req.Host = tc.host
			req.RemoteAddr = tc.remoteAddr
			if tc.xff != "" {
				req.Header.Set("X-Forwarded-For", tc.xff)
			}
			gotZone, gotIP := DetectZone(req, cfg)
			if gotZone != tc.wantZone || gotIP != tc.wantIP {
				t.Fatalf("DetectZone() = (%q, %q), want (%q, %q)", gotZone, gotIP, tc.wantZone, tc.wantIP)
			}
		})
	}
}
