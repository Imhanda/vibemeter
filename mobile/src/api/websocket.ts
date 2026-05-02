import { API_BASE_URL } from "../config";
import { auth } from "../config/firebase";

export interface ScoreUpdateEvent {
  type: "score_update";
  place_id: string;
  vibe_score: number;
  confidence: number;
  check_in_count: number;
  ts: string;
}

type MessageHandler = (evt: ScoreUpdateEvent) => void;

export class VenueSocket {
  private ws: WebSocket | null = null;
  private placeId: string;
  private onMessage: MessageHandler;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(placeId: string, onMessage: MessageHandler) {
    this.placeId = placeId;
    this.onMessage = onMessage;
  }

  async connect() {
    const base = API_BASE_URL.replace(/^http/, "ws");
    const user = auth.currentUser;
    const token = user ? await user.getIdToken() : "";
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
    this.ws = new WebSocket(`${base}/v1/ws${tokenParam}`);

    this.ws.onopen = () => {
      this.ws?.send(
        JSON.stringify({ type: "subscribe", place_id: this.placeId })
      );
    };

    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as ScoreUpdateEvent;
        if (data.type === "score_update") {
          this.onMessage(data);
        }
      } catch {
        // ignore malformed frames
      }
    };

    this.ws.onclose = () => {
      // Auto-reconnect after 3 s
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
