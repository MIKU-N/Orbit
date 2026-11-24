package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"orbit/internal/db"
)

const SessionCookieName = "orbit_session"

type Claims struct {
	UserID   int64  `json:"uid"`
	Username string `json:"usr"`
	Role     string `json:"rol"`
	Exp      int64  `json:"exp"`
}

func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func GenerateAPIToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "orb_" + hex.EncodeToString(buf), nil
}

func SignJWT(claims Claims, secret []byte) (string, error) {
	headerJSON := `{"alg":"HS256","typ":"JWT"}`
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	h := base64.RawURLEncoding.EncodeToString([]byte(headerJSON))
	p := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signingInput := h + "." + p
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + sig, nil
}

func VerifyJWT(token string, secret []byte) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("malformed token")
	}
	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signingInput))
	expected := mac.Sum(nil)
	actual, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(expected, actual) {
		return nil, errors.New("invalid signature")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("invalid payload")
	}
	var c Claims
	if err := json.Unmarshal(payloadBytes, &c); err != nil {
		return nil, err
	}
	if time.Now().Unix() > c.Exp {
		return nil, errors.New("token expired")
	}
	return &c, nil
}

func SetSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	isHTTPS := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   7 * 24 * 3600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS,
	})
}

func ClearSessionCookie(w http.ResponseWriter, r *http.Request) {
	isHTTPS := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS,
	})
}

// AuthenticateRequest resolves the current authenticated user from either
// Bearer API token (header or ?token= query for WS) or the session JWT cookie.
func AuthenticateRequest(r *http.Request, conn *sql.DB, secret []byte) (*db.User, error) {
	// 1. Bearer API token or ?token=
	token := ""
	authz := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(authz), "bearer ") {
		token = strings.TrimSpace(authz[7:])
	} else if qTok := strings.TrimSpace(r.URL.Query().Get("token")); qTok != "" {
		token = qTok
	}

	if token != "" {
		if strings.HasPrefix(token, "orb_") {
			var u db.User
			var scopesRaw string
			err := conn.QueryRow(
				`SELECT id, username, role, avatar, parent_id, share_scopes, api_token, created_at FROM users WHERE api_token = ?`,
				token,
			).Scan(&u.ID, &u.Username, &u.Role, &u.Avatar, &u.ParentID, &scopesRaw, &u.APIToken, &u.CreatedAt)
			if err != nil {
				return nil, errors.New("invalid api token")
			}
			u.ShareScopes = db.ParseShareScopes(scopesRaw)
			return &u, nil
		}
		if claims, err := VerifyJWT(token, secret); err == nil {
			return loadUserByID(conn, claims.UserID)
		}
	}

	// 2. HttpOnly Cookie
	c, err := r.Cookie(SessionCookieName)
	if err != nil || strings.TrimSpace(c.Value) == "" {
		return nil, errors.New("unauthenticated")
	}
	claims, err := VerifyJWT(c.Value, secret)
	if err != nil {
		return nil, err
	}
	return loadUserByID(conn, claims.UserID)
}

func loadUserByID(conn *sql.DB, id int64) (*db.User, error) {
	var u db.User
	var scopesRaw string
	err := conn.QueryRow(
		`SELECT id, username, role, avatar, parent_id, share_scopes, api_token, created_at FROM users WHERE id = ?`,
		id,
	).Scan(&u.ID, &u.Username, &u.Role, &u.Avatar, &u.ParentID, &scopesRaw, &u.APIToken, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	u.ShareScopes = db.ParseShareScopes(scopesRaw)
	return &u, nil
}
