package middleware

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
	"vibemeter/config"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const (
	UserIDKey      = "userID"
	firebaseKeyURL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
)

var (
	keyCache    map[string]*rsa.PublicKey
	keyCachedAt time.Time
	keyMu       sync.RWMutex
)

type firebaseClaims struct {
	jwt.RegisteredClaims
}

// AuthMiddleware validates Firebase JWTs. Set SKIP_AUTH=true for local dev
// and pass X-User-ID header instead.
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if config.C.SkipAuth {
			userID := c.GetHeader("X-User-ID")
			if userID == "" {
				userID = "dev-user"
			}
			c.Set(UserIDKey, userID)
			c.Next()
			return
		}

		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			return
		}
		tokenStr := strings.TrimPrefix(header, "Bearer ")

		userID, err := verifyFirebaseToken(tokenStr)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		c.Set(UserIDKey, userID)
		c.Next()
	}
}

func verifyFirebaseToken(tokenStr string) (string, error) {
	keys, err := getFirebasePublicKeys()
	if err != nil {
		return "", fmt.Errorf("could not fetch public keys: %w", err)
	}

	token, err := jwt.ParseWithClaims(
		tokenStr,
		&firebaseClaims{},
		func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			kid, ok := t.Header["kid"].(string)
			if !ok {
				return nil, fmt.Errorf("missing kid header")
			}
			key, ok := keys[kid]
			if !ok {
				return nil, fmt.Errorf("unknown kid: %s", kid)
			}
			return key, nil
		},
		jwt.WithAudience(config.C.FirebaseProjectID),
		jwt.WithIssuer("https://securetoken.google.com/"+config.C.FirebaseProjectID),
	)
	if err != nil || !token.Valid {
		return "", fmt.Errorf("token invalid: %w", err)
	}

	claims, ok := token.Claims.(*firebaseClaims)
	if !ok {
		return "", fmt.Errorf("unexpected claims type")
	}
	sub, err := claims.GetSubject()
	if err != nil || sub == "" {
		return "", fmt.Errorf("missing subject claim")
	}
	return sub, nil
}

func getFirebasePublicKeys() (map[string]*rsa.PublicKey, error) {
	keyMu.RLock()
	if keyCache != nil && time.Since(keyCachedAt) < time.Hour {
		defer keyMu.RUnlock()
		return keyCache, nil
	}
	keyMu.RUnlock()

	keyMu.Lock()
	defer keyMu.Unlock()

	resp, err := http.Get(firebaseKeyURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var rawKeys map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&rawKeys); err != nil {
		return nil, err
	}

	keys := make(map[string]*rsa.PublicKey, len(rawKeys))
	for kid, certPEM := range rawKeys {
		block, _ := pem.Decode([]byte(certPEM))
		if block == nil {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			continue
		}
		rsaKey, ok := cert.PublicKey.(*rsa.PublicKey)
		if !ok {
			continue
		}
		keys[kid] = rsaKey
	}

	keyCache = keys
	keyCachedAt = time.Now()
	return keys, nil
}
