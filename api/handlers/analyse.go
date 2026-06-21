package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"vibemeter/config"

	"github.com/gin-gonic/gin"
)

// yamnetResponse matches the JSON returned by the Python sidecar.
type yamnetResponse struct {
	AmbientDB   float64 `json:"ambient_db"`
	CrowdEnergy float64 `json:"crowd_energy"`
	MusicEnergy float64 `json:"music_energy"`
}

// AnalyseAudio accepts a multipart audio upload, proxies it to the YAMNet
// sidecar, and returns the three vibe signals. Audio is never written to disk
// or persisted — it flows through memory only.
//
// POST /v1/vibe/analyse
// Content-Type: multipart/form-data; field name: "audio"
// Response: { ambient_db, crowd_energy, music_energy }
func AnalyseAudio(c *gin.Context) {
	file, header, err := c.Request.FormFile("audio")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "multipart field 'audio' required"})
		return
	}
	defer file.Close()

	const maxSize = 30 << 20 // 30 MB
	audioBytes, err := io.ReadAll(io.LimitReader(file, maxSize+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read audio"})
		return
	}
	if len(audioBytes) > maxSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "audio file too large (max 30 MB)"})
		return
	}
	if len(audioBytes) < 1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "audio file too small"})
		return
	}

	// Build multipart body for the sidecar
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("audio", filepath.Base(header.Filename))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build sidecar request"})
		return
	}
	if _, err = fw.Write(audioBytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to write audio to sidecar request"})
		return
	}
	mw.Close()

	yamnetURL := fmt.Sprintf("%s/analyse", config.C.YAMNetURL)
	resp, err := http.Post(yamnetURL, mw.FormDataContentType(), &buf) //nolint:gosec
	if err != nil {
		log.Printf("yamnet POST to %q failed: %v", yamnetURL, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "audio analysis service unavailable"})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to read sidecar response"})
		return
	}
	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "analysis failed", "detail": string(body)})
		return
	}

	var result yamnetResponse
	if err := json.Unmarshal(body, &result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid response from analysis service"})
		return
	}

	c.JSON(http.StatusOK, result)
}
