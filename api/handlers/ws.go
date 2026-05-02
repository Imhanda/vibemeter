package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"vibemeter/cache"
	"vibemeter/middleware"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type wsInMessage struct {
	Type    string `json:"type"`
	PlaceID string `json:"place_id"`
}

// WSHandler handles WebSocket connections at GET /ws.
// Clients send {"type":"subscribe","place_id":"..."} to receive score_update events.
func WSHandler(c *gin.Context) {
	_ = c.GetString(middleware.UserIDKey)

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("ws upgrade:", err)
		return
	}
	defer conn.Close()

	var (
		mu        sync.Mutex
		cancelSub context.CancelFunc
	)

	subscribe := func(placeID string) {
		mu.Lock()
		defer mu.Unlock()
		if cancelSub != nil {
			cancelSub()
		}
		subCtx, cancel := context.WithCancel(context.Background())
		cancelSub = cancel
		go forwardMessages(subCtx, conn, placeID)
	}

	defer func() {
		mu.Lock()
		if cancelSub != nil {
			cancelSub()
		}
		mu.Unlock()
	}()

	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg wsInMessage
		if json.Unmarshal(msgBytes, &msg) != nil {
			continue
		}
		if msg.Type == "subscribe" && msg.PlaceID != "" {
			subscribe(msg.PlaceID)
		}
	}
}

func forwardMessages(ctx context.Context, conn *websocket.Conn, placeID string) {
	ps := cache.SubscribeToVenue(ctx, placeID)
	defer ps.Close()

	ch := ps.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, []byte(msg.Payload)); err != nil {
				return
			}
		}
	}
}

// Ensure redis.PubSub satisfies the interface used above — it does via ps.Channel() and ps.Close().
var _ *redis.PubSub = nil
