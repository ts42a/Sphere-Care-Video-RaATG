import type {
  RtcEngine,
  RtcEngineSnapshot,
  RtcJoinOptions,
} from "./rtcEngine";

type Listener = (snapshot: RtcEngineSnapshot) => void;

class ProviderRtcEngine implements RtcEngine {
  private listeners = new Set<Listener>();

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

  private setSnapshot(next: Partial<RtcEngineSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...next,
      local: {
        ...this.snapshot.local,
        ...(next.local ?? {}),
      },
      remote: {
        ...this.snapshot.remote,
        ...(next.remote ?? {}),
      },
    };
    this.emit();
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
    this.setSnapshot({
      mode: options.mode,
      connectionState: "connecting",
      local: {
        videoEnabled: options.mode === "video",
      },
      remote: {
        videoEnabled: options.mode === "video",
      },
    });

    /**
    * TODO:
    * 1. Create a provider room/channel
    * 2. Obtain or use the provider token
    * 3. Join the call
    * 4. Subscribe to remote user audio/video
    * 5. Update joined/connectionState upon success
    */

    throw new Error("providerRtcEngine is not implemented yet");
  }

  async leaveCall() {
    /**
    * TODO:
    * 1. Leave the provider room/channel
    * 2. Clear local tracks
    * 3. Clear remote subscriptions
    */
    this.setSnapshot({
      joined: false,
      connectionState: "ended",
    });
  }

  async setMuted(muted: boolean) {
    /**
     * TODO:
     * Control the provider's local audio track enable/disable
     */
    this.setSnapshot({
      local: {
        audioEnabled: !muted,
      },
    });
  }

  async setCameraEnabled(enabled: boolean) {
    /**
     * TODO:
     * Control the provider's local video track enable/disable
     */
    this.setSnapshot({
      local: {
        videoEnabled: enabled,
      },
    });
  }

  async switchCamera() {
    /**
     * TODO:
     * Call the provider to switch between front and back cameras.
     */
    this.setSnapshot({
      local: {
        cameraFacing:
          this.snapshot.local.cameraFacing === "front" ? "back" : "front",
      },
    });
  }

  async setRemoteVideoEnabled(enabled: boolean) {
    /**
    * This is typically not a capability that can be set directly locally.
    * The official version should be updated via provider remote user event.
    * This feature is reserved for future development and testing.
     */
    this.setSnapshot({
      remote: {
        videoEnabled: enabled,
      },
    });
  }
}

export const providerRtcEngine = new ProviderRtcEngine();