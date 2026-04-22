package notifications

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

const expoPushURL = "https://exp.host/--/api/v2/push/send"

type pushPayload struct {
	To    string `json:"to"`
	Title string `json:"title"`
	Body  string `json:"body"`
	Data  any    `json:"data,omitempty"`
}

// SendPush sends an Expo push notification to a single device token.
// Audio is never involved — this is a fire-and-forget best-effort call.
func SendPush(token, title, body string, data any) error {
	payload := pushPayload{To: token, Title: title, Body: body, Data: data}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := http.Post(expoPushURL, "application/json", bytes.NewReader(b))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("expo push returned %d", resp.StatusCode)
	}
	return nil
}
