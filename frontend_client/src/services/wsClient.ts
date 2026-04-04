import { WS_BASE_URL } from "../config/ws";
import { getAccessToken } from "./sessionService";

type WsHandler = (payload: any) => void;
type OpenHandler = () => void;

class WSClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<WsHandler>>();
  private openHandlers = new Set<OpenHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private connectPromise: Promise<void> | null = null;
  private queuedMessages: string[] = [];

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    const token = await getAccessToken();
    const url = `${WS_BASE_URL}?token=${encodeURIComponent(token ?? "")}`;

    this.manuallyClosed = false;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.onopen = () => {
        console.log("WebSocket connected");
        this.flushQueue();
        this.openHandlers.forEach((handler) => handler());
        this.connectPromise = null;
        resolve();
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const type = message?.type;
          const payload = message?.payload;

          if (!type) return;

          const listeners = this.handlers.get(type);
          listeners?.forEach((handler) => handler(payload));
        } catch (error) {
          console.error("WebSocket message parse error", error);
        }
      };

      socket.onerror = (error) => {
        console.error("WebSocket error", error);
      };

      socket.onclose = () => {
        console.log("WebSocket disconnected");
        this.socket = null;

        if (this.connectPromise) {
          this.connectPromise = null;
          reject(new Error("WebSocket closed before opening"));
        }

        if (!this.manuallyClosed) {
          this.reconnectTimer = setTimeout(() => {
            this.connect().catch((error) => {
              console.error("WebSocket reconnect failed", error);
            });
          }, 2000);
        }
      };
    });

    return this.connectPromise;
  }

  disconnect() {
    this.manuallyClosed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.connectPromise = null;
    this.socket?.close();
    this.socket = null;
  }

  send(type: string, payload: unknown) {
    const message = JSON.stringify({ type, payload });

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.queuedMessages.push(message);
      this.connect().catch((error) => {
        console.error("WebSocket connect failed while sending", error);
      });
      return;
    }

    this.socket.send(message);
  }

  subscribe(type: string, handler: WsHandler) {
    const currentHandlers = this.handlers.get(type) ?? new Set<WsHandler>();
    currentHandlers.add(handler);
    this.handlers.set(type, currentHandlers);

    return () => {
      const listeners = this.handlers.get(type);
      if (!listeners) return;

      listeners.delete(handler);

      if (listeners.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  subscribeOpen(handler: OpenHandler) {
    this.openHandlers.add(handler);

    if (this.socket?.readyState === WebSocket.OPEN) {
      handler();
    }

    return () => {
      this.openHandlers.delete(handler);
    };
  }

  private flushQueue() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.queuedMessages.length > 0) {
      const message = this.queuedMessages.shift();
      if (!message) break;
      this.socket.send(message);
    }
  }
}

export const wsClient = new WSClient();