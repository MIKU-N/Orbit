package kernel

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"orbit/internal/auth"
	"orbit/internal/plugin"
)

type PeerInfo struct {
	PeerID     string `json:"peer_id"`
	DeviceName string `json:"device_name"`
	Zone       string `json:"zone"`
	ClientIP   string `json:"-"`
	SameLAN    bool   `json:"same_lan"`
	Connected  int64  `json:"connected_at"`
}

type wsClient struct {
	peerID     string
	userID     int64
	deviceName string
	zone       string
	clientIP   string
	connected  int64
	conn       *websocket.Conn
	send       chan []byte
}

type Hub struct {
	mu    sync.RWMutex
	users map[int64]map[string]*wsClient
}

func NewHub() *Hub {
	return &Hub{
		users: make(map[int64]map[string]*wsClient),
	}
}

func (h *Hub) add(c *wsClient) {
	h.mu.Lock()
	if h.users[c.userID] == nil {
		h.users[c.userID] = make(map[string]*wsClient)
	}
	h.users[c.userID][c.peerID] = c
	h.mu.Unlock()
	h.broadcastPeers(c.userID)
}

func (h *Hub) remove(c *wsClient) {
	h.mu.Lock()
	if peers := h.users[c.userID]; peers != nil {
		delete(peers, c.peerID)
		if len(peers) == 0 {
			delete(h.users, c.userID)
		}
	}
	h.mu.Unlock()
	h.broadcastPeers(c.userID)
}

func (h *Hub) BroadcastUser(userID int64, msgType string, payload any) {
	frame, err := json.Marshal(map[string]any{
		"type":    msgType,
		"payload": payload,
	})
	if err != nil {
		return
	}
	h.mu.RLock()
	peers := h.users[userID]
	targets := make([]*wsClient, 0, len(peers))
	for _, p := range peers {
		targets = append(targets, p)
	}
	h.mu.RUnlock()

	for _, p := range targets {
		select {
		case p.send <- frame:
		default:
		}
	}
}

func (h *Hub) broadcastPeers(userID int64) {
	h.mu.RLock()
	peers := h.users[userID]
	snapshot := make([]*wsClient, 0, len(peers))
	for _, p := range peers {
		snapshot = append(snapshot, p)
	}
	h.mu.RUnlock()

	for _, receiver := range snapshot {
		peerList := make([]PeerInfo, 0, len(snapshot))
		for _, other := range snapshot {
			if other.peerID == receiver.peerID {
				continue
			}
			sameLAN := (receiver.zone == auth.ZoneLAN && other.zone == auth.ZoneLAN) ||
				(receiver.clientIP != "" && receiver.clientIP == other.clientIP)
			peerList = append(peerList, PeerInfo{
				PeerID:     other.peerID,
				DeviceName: other.deviceName,
				Zone:       other.zone,
				SameLAN:    sameLAN,
				Connected:  other.connected,
			})
		}
		frame, err := json.Marshal(map[string]any{
			"type":    "peers_updated",
			"payload": map[string]any{"self_peer_id": receiver.peerID, "peers": peerList},
		})
		if err != nil {
			continue
		}
		select {
		case receiver.send <- frame:
		default:
		}
	}
}

func (h *Hub) RelaySignal(userID int64, fromPeerID, targetPeerID string, signal json.RawMessage) {
	h.mu.RLock()
	var target *wsClient
	if peers := h.users[userID]; peers != nil {
		target = peers[targetPeerID]
	}
	h.mu.RUnlock()
	if target == nil {
		return
	}
	frame, err := json.Marshal(map[string]any{
		"type":         "rtc_signal",
		"from_peer_id": fromPeerID,
		"payload":      signal,
	})
	if err != nil {
		return
	}
	select {
	case target.send <- frame:
	default:
	}
}

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func (k *Kernel) handleWS(w http.ResponseWriter, r *http.Request) {
	u := k.CurrentUser(r)
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	var idBuf [8]byte
	_, _ = rand.Read(idBuf[:])
	peerID := "peer_" + hex.EncodeToString(idBuf[:])
	zone, clientIP := auth.DetectZone(r, k.cfg)

	deviceName := strings.TrimSpace(r.URL.Query().Get("device"))
	if deviceName == "" {
		deviceName = guessDeviceName(r.UserAgent())
	}

	client := &wsClient{
		peerID:     peerID,
		userID:     u.ID,
		deviceName: deviceName,
		zone:       zone,
		clientIP:   clientIP,
		connected:  time.Now().Unix(),
		conn:       conn,
		send:       make(chan []byte, 64),
	}

	k.hub.add(client)

	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer func() {
			ticker.Stop()
			_ = conn.Close()
		}()
		for {
			select {
			case msg, ok := <-client.send:
				if !ok {
					_ = conn.WriteMessage(websocket.CloseMessage, []byte{})
					return
				}
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			case <-ticker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	defer func() {
		k.hub.remove(client)
		close(client.send)
	}()

	conn.SetReadLimit(256 << 10)
	_ = conn.SetReadDeadline(time.Now().Add(65 * time.Second))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(65 * time.Second))
		return nil
	})

	wsCtx := plugin.WSContext{
		User:     u,
		PeerID:   client.peerID,
		Zone:     zone,
		ClientIP: clientIP,
		Hub:      k.hub,
	}

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(65 * time.Second))
		var msg struct {
			Type         string          `json:"type"`
			TargetPeerID string          `json:"target_peer_id"`
			DeviceName   string          `json:"device_name"`
			Payload      json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		switch msg.Type {
		case "rtc_signal":
			if msg.TargetPeerID != "" {
				k.hub.RelaySignal(u.ID, client.peerID, msg.TargetPeerID, msg.Payload)
			}
		case "hello":
			if name := strings.TrimSpace(msg.DeviceName); name != "" {
				k.hub.mu.Lock()
				client.deviceName = name
				k.hub.mu.Unlock()
				k.hub.broadcastPeers(u.ID)
			}
		default:
			k.dispatchWSMessage(wsCtx, msg.Type, msg.Payload)
		}
	}
}

func guessDeviceName(ua string) string {
	l := strings.ToLower(ua)
	switch {
	case strings.Contains(l, "iphone"):
		return "iPhone"
	case strings.Contains(l, "ipad"):
		return "iPad"
	case strings.Contains(l, "android"):
		return "Android 设备"
	case strings.Contains(l, "macintosh") || strings.Contains(l, "mac os"):
		return "Mac"
	case strings.Contains(l, "windows"):
		return "Windows PC"
	case strings.Contains(l, "linux"):
		return "Linux 桌面"
	default:
		return "Web 浏览器"
	}
}
