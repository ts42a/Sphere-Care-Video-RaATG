import { callSignalingService } from "../call/callSignalingService";
import type {
  RtcEngine,
  RtcEngineSnapshot,
  RtcJoinOptions,
} from "./rtcEngine";

type Listener = (snapshot: RtcEngineSnapshot) => void;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockRtcEngine implements RtcEngine {
  private listeners = new Set<Listener>();
  private currentCallId: string | null = null;
  private localUserId: string | null = null;
  private remoteUserId: string | null = null;
  private unsubscribeSignal: (() => void) | null = null;
  private connectFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  private snapshot: RtcEngineSnapshot = {
    joined: false,
    mode: "audio",
    connectionState: "idle",
    local: {
      audioEnabled: true,
      videoEnabled: true,
      cameraFacing: "front",
    },
    remote: {
      audioEnabled: true,
      videoEnabled: true,
    },
  };

  private emit() {
    const next = this.getSnapshot();
    this.listeners.forEach((listener) => listener(next));
  }

  private cleanupSignalSubscription() {
    if (this.unsubscribeSignal) {
      this.unsubscribeSignal();
      this.unsubscribeSignal = null;
    }

    if (this.connectFallbackTimer) {
      clearTimeout(this.connectFallbackTimer);
      this.connectFallbackTimer = null;
    }
  }

  private async pushLocalMediaState() {
    if (!this.currentCallId || !this.localUserId) return;

    try {
      await callSignalingService.updateLocalMedia({
        callId: this.currentCallId,
        localUserId: this.localUserId,
        audioEnabled: this.snapshot.local.audioEnabled,
        videoEnabled: this.snapshot.local.videoEnabled,
        cameraFacing: this.snapshot.local.cameraFacing,
      });
    } catch (error) {
      console.error("Failed to push local media state", error);
    }
  }

  getSnapshot(): RtcEngineSnapshot {
    return {
      joined: this.snapshot.joined,
      mode: this.snapshot.mode,
      connectionState: this.snapshot.connectionState,
      local: { ...this.snapshot.local },
      remote: { ...this.snapshot.remote },
    };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());

    return () => {
      this.listeners.delete(listener);
    };
  }

  async joinCall(options: RtcJoinOptions) {
    const isSameCall =
      this.currentCallId === options.callId &&
      this.localUserId === options.localUserId &&
      this.remoteUserId === options.remoteUserId;

    this.currentCallId = options.callId;
    this.localUserId = options.localUserId;
    this.remoteUserId = options.remoteUserId;

    if (isSameCall && this.snapshot.joined) {
      this.snapshot = {
        ...this.snapshot,
        mode: options.mode,
        connectionState: "connected",
        local: {
          ...this.snapshot.local,
          videoEnabled: options.mode === "video" ? this.snapshot.local.videoEnabled : false,
        },
        remote: {
          ...this.snapshot.remote,
          videoEnabled: options.mode === "video" ? this.snapshot.remote.videoEnabled : false,
        },
      };
      this.emit();
      return;
    }

    this.cleanupSignalSubscription();

    this.snapshot = {
      ...this.snapshot,
      joined: false,
      mode: options.mode,
      connectionState: "connecting",
      local: {
        ...this.snapshot.local,
        audioEnabled: true,
        videoEnabled: options.mode === "video",
      },
      remote: {
        ...this.snapshot.remote,
        audioEnabled: true,
        videoEnabled: options.mode === "video",
      },
    };
    this.emit();

    try {
      await callSignalingService.ensureConnected();

      this.unsubscribeSignal = callSignalingService.subscribe(options.callId, {
        onJoined: () => {
          this.snapshot = {
            ...this.snapshot,
            joined: true,
            connectionState: "connected",
          };
          this.emit();
        },

        onConnectionState: (state) => {
          this.snapshot = {
            ...this.snapshot,
            joined: state === "connected" ? true : this.snapshot.joined,
            connectionState: state,
          };
          this.emit();
        },

        onRemoteMediaUpdated: ({ audioEnabled, videoEnabled }) => {
          this.snapshot = {
            ...this.snapshot,
            remote: {
              ...this.snapshot.remote,
              audioEnabled,
              videoEnabled: this.snapshot.mode === "video" ? videoEnabled : false,
            },
          };
          this.emit();
        },

        onEnded: () => {
          this.snapshot = {
            ...this.snapshot,
            joined: false,
            connectionState: "ended",
          };
          this.emit();
        },
      });

      await callSignalingService.joinCall({
        callId: options.callId,
        mode: options.mode,
        localUserId: options.localUserId,
        remoteUserId: options.remoteUserId,
      });

      this.connectFallbackTimer = setTimeout(() => {
        if (this.snapshot.connectionState === "connecting") {
          this.snapshot = {
            ...this.snapshot,
            joined: true,
            connectionState: "connected",
          };
          this.emit();
        }
      }, 700);
    } catch (error) {
      console.error("RTC join signaling failed", error);

      await wait(400);

      this.snapshot = {
        ...this.snapshot,
        joined: true,
        connectionState: "connected",
      };
      this.emit();
    }
  }

  async leaveCall() {
    try {
      if (this.currentCallId && this.localUserId) {
        await callSignalingService.leaveCall({
          callId: this.currentCallId,
          localUserId: this.localUserId,
        });
      }
    } catch (error) {
      console.error("RTC leave signaling failed", error);
    }

    this.cleanupSignalSubscription();

    this.snapshot = {
      ...this.snapshot,
      joined: false,
      connectionState: "ended",
    };
    this.emit();
  }

  async setMuted(muted: boolean) {
    this.snapshot = {
      ...this.snapshot,
      local: {
        ...this.snapshot.local,
        audioEnabled: !muted,
      },
    };
    this.emit();

    await this.pushLocalMediaState();
  }

  async setCameraEnabled(enabled: boolean) {
    this.snapshot = {
      ...this.snapshot,
      local: {
        ...this.snapshot.local,
        videoEnabled: enabled,
      },
    };
    this.emit();

    await this.pushLocalMediaState();
  }

  async switchCamera() {
    this.snapshot = {
      ...this.snapshot,
      local: {
        ...this.snapshot.local,
        cameraFacing:
          this.snapshot.local.cameraFacing === "front" ? "back" : "front",
      },
    };
    this.emit();

    await this.pushLocalMediaState();
  }

  async setRemoteVideoEnabled(enabled: boolean) {
    this.snapshot = {
      ...this.snapshot,
      remote: {
        ...this.snapshot.remote,
        videoEnabled: enabled,
      },
    };
    this.emit();
  }
}

export const mockRtcEngine = new MockRtcEngine();