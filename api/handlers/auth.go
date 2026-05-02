package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"vibemeter/config"

	"github.com/gin-gonic/gin"
)

type googleTokenResponse struct {
	IDToken     string `json:"id_token"`
	AccessToken string `json:"access_token"`
	Error       string `json:"error"`
}

// ExchangeGoogleCode handles POST /v1/auth/google
// Exchanges a Google OAuth authorization code for an id_token.
// The id_token is returned to the mobile client which signs into Firebase with it.
func ExchangeGoogleCode(c *gin.Context) {
	var req struct {
		Code        string `json:"code" binding:"required"`
		RedirectURI string `json:"redirect_uri" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code and redirect_uri required"})
		return
	}

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", req.Code)
	form.Set("client_id", config.C.GoogleWebClientID)
	form.Set("client_secret", config.C.GoogleClientSecret)
	form.Set("redirect_uri", req.RedirectURI)

	resp, err := http.Post(
		"https://oauth2.googleapis.com/token",
		"application/x-www-form-urlencoded",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to reach Google"})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var tokenResp googleTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil || tokenResp.IDToken == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "invalid response from Google: " + tokenResp.Error})
		return
	}

	c.JSON(http.StatusOK, gin.H{"id_token": tokenResp.IDToken})
}
