import { getAccessToken } from "./sessionService";

type WsEventPayload = Record<string, any>;
type WsListener = (payload: WsEventPayload) => void;

class WSClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private listeners = new Map<string, Set<WsListener>>();

  private connected = false;
  private manualClose = false;
  private reconnectAttempts = 0;
  private lastConnectHadToken = false;
  private latestToken: string | null = null;

  private readonly maxReconnectDelayMs = 10000;
  private readonly baseReconnectDelayMs = 1200;

  private getBaseUrl() {
    const raw = process.env.EXPO_PUBLIC_WS_BASE_URL?.trim();

    if (!raw) {
      console.warn("WS base URL is missing. Set EXPO_PUBLIC_WS_BASE_URL in frontend_client/.env");
      return "";
    }

    if (raw.startsWith("ws://") || raw.startsWith("wss://")) {
      return raw.replace(/\/+$/, "");
    }

    if (raw.startsWith("http://")) {
      return `ws://${raw.slice("http://".length).replace(/\/+$/, "")}`;
    }

    if (raw.startsWith("https://")) {
      return `wss://${raw.slice("https://".length).replace(/\/+$/, "")}`;
    }

    return `ws://${raw.replace(/\/+$/, "")}`;
  }

  private buildUrl(token: string) {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return "";

    const encodedToken = encodeURIComponent(token);
    return `${baseUrl}/ws?token=${encodedToken}`;
  }

  isConnected() {
    return this.connected && this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(force = false): Promise<void> {
    const token = await getAccessToken();

    if (!token) {
      this.lastConnectHadToken = false;
      this.latestToken = null;
      this.clearReconnectTimer();
      this.safeCloseSocket();
      return;
    }

    this.lastConnectHadToken = true;
    this.latestToken = token;

    if (this.isConnected() && !force) {
      return;
    }

    if (this.connectPromise && !force) {
      return this.connectPromise;
    }

    this.manualClose = false;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const url = this.buildUrl(token);

      if (!url) {
        this.connectPromise = null;
        reject(new Error("WebSocket URL is not configured"));
        return;
      }

      if (force) {
        this.safeCloseSocket();
      }

      let opened = false;
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.onopen = () => {
        opened = true;
        this.connected = true;
        this.reconnectAttempts = 0;
        this.clearReconnectTimer();
        console.log("WS connected:", url);
        this.connectPromise = null;
        resolve();
      };

      socket.onmessage = (event) => {
        try {
          const raw = typeof event.data === "string" ? event.data : "";
          if (!raw) return;

          console.log("WS raw message:", raw);

          const payload = JSON.parse(raw) as WsEventPayload;
          const eventType =
            typeof payload?.type === "string" && payload.type.length > 0
              ? payload.type
              : "message";

          this.emit(eventType, payload);
          this.emit("*", payload);
        } catch (error) {
          console.warn("Failed to parse WS message", error);
        }
      };

      socket.onerror = (event) => {
        console.warn("WebSocket error", event);
      };

      socket.onclose = (event) => {
        this.connected = false;

        if (this.socket === socket) {
          this.socket = null;
        }

        console.log("WS closed:", event.code, event.reason || "(no reason)");

        const connectError = !opened
          ? new Error("WebSocket closed before opening")
          : null;

        if (this.connectPromise) {
          const pending = this.connectPromise;
          this.connectPromise = null;
          if (connectError) {
            reject(connectError);
          } else {
            resolve();
          }
          void pending;
        }

        if (this.manualClose) {
          return;
        }

        if (!this.lastConnectHadToken) {
          return;
        }

        this.scheduleReconnect();
      };
    });

    return this.connectPromise;
  }

  disconnect() {
    this.manualClose = true;
    this.lastConnectHadToken = false;
    this.latestToken = null;
    this.clearReconnectTimer();
    this.safeCloseSocket();
    this.connected = false;
    this.connectPromise = null;
  }

  async reconnectNow() {
    this.clearReconnectTimer();
    return this.connect(true);
  }

  subscribe(eventType: string, listener: WsListener) {
    const key = eventType || "*";
    const set = this.listeners.get(key) ?? new Set<WsListener>();
    set.add(listener);
    this.listeners.set(key, set);

    return () => {
      const current = this.listeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  async send(payload: WsEventPayload) {
    if (!this.isConnected()) {
      await this.connect();
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }

    this.socket.send(JSON.stringify(payload));
  }

  private emit(eventType: string, payload: WsEventPayload) {
    const listeners = this.listeners.get(eventType);
    if (!listeners || listeners.size === 0) return;

    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`WS listener failed for ${eventType}`, error);
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts += 1;

    const delay = Math.min(
      this.baseReconnectDelayMs * Math.max(1, this.reconnectAttempts),
      this.maxReconnectDelayMs
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        const token = await getAccessToken();
        if (!token) {
          this.lastConnectHadToken = false;
          return;
        }

        await this.connect(true);
      } catch (error) {
        console.warn("WebSocket reconnect failed", error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private safeCloseSocket() {
    try {
      this.socket?.close();
    } catch {}
    this.socket = null;
  }
}

export const wsClient = new WSClient();