import { ensureLiveKitRuntime, registerLiveKitGlobalsOnce } from "./livekitRuntime";
import type {
  CameraFacing,
  RtcEngine,
  RtcEngineSnapshot,
  RtcJoinOptions,
} from "./rtcEngine";

type Listener = (snapshot: RtcEngineSnapshot) => void;

type SnapshotPatch = Partial<Omit<RtcEngineSnapshot, "local" | "remote">> & {
  local?: Partial<RtcEngineSnapshot["local"]>;
  remote?: Partial<RtcEngineSnapshot["remote"]>;
};

class ProviderRtcEngine implements RtcEngine {
  private listeners = new Set<Listener>();
  private room: any | null = null;
  private roomEventEntries: Array<[any, (...args: any[]) => void]> = [];
  private currentOptions: RtcJoinOptions | null = null;

  private snapshot: RtcEngineSnapshot = {
    joined: false,
    mode: "audio",
    connectionState: "idle",
    local: {
      audioEnabled: true,
      videoEnabled: false,
      cameraFacing: "front",
    },
    remote: {
      audioEnabled: true,
      videoEnabled: false,
    },
  };

  private emit() {
    const next = this.getSnapshot();
    this.listeners.forEach((listener) => listener(next));
  }

  private setSnapshot(next: SnapshotPatch) {
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

  private clearRoomListeners() {
    if (!this.room?.off) {
      this.roomEventEntries = [];
      return;
    }

    this.roomEventEntries.forEach(([eventName, handler]) => {
      try {
        this.room.off(eventName, handler);
      } catch {}
    });
    this.roomEventEntries = [];
  }

  private bindRoomEvent(eventName: any, handler: (...args: any[]) => void) {
    if (!this.room?.on) return;
    this.room.on(eventName, handler);
    this.roomEventEntries.push([eventName, handler]);
  }

  private resolveRoomEvent(name: string) {
    try {
      const runtime = ensureLiveKitRuntime();
      const roomEvent = runtime.RoomEvent;
      if (roomEvent && name in roomEvent) {
        return roomEvent[name];
      }
    } catch {}
    return name.charAt(0).toLowerCase() + name.slice(1);
  }

  private updateRemoteSnapshotFromRoom() {
    if (!this.room) {
      this.setSnapshot({
        remote: {
          audioEnabled: true,
          videoEnabled: this.snapshot.mode === "video",
        },
      });
      return;
    }

    const iterator = this.room.remoteParticipants?.values?.();
    const firstRemote = iterator ? iterator.next()?.value : null;

    this.setSnapshot({
      remote: {
        audioEnabled: firstRemote?.isMicrophoneEnabled ?? true,
        videoEnabled:
          this.snapshot.mode === "video"
            ? (firstRemote?.isCameraEnabled ?? false)
            : false,
      },
    });
  }

  private async configureLocalTracksForMode(mode: RtcJoinOptions["mode"]) {
    if (!this.room?.localParticipant) return;

    await this.room.localParticipant.setMicrophoneEnabled(true);
    await this.room.localParticipant.setCameraEnabled(mode === "video");

    this.setSnapshot({
      local: {
        audioEnabled: true,
        videoEnabled: mode === "video",
      },
    });
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

  getRoom() {
    return this.room;
  }

  async joinCall(options: RtcJoinOptions) {
    registerLiveKitGlobalsOnce();

    if (!options.serverUrl || !options.accessToken) {
      throw new Error("LiveKit join payload is missing. Check LIVEKIT_URL and token minting on the backend.");
    }

    const isSameCall =
      this.currentOptions?.callId === options.callId &&
      this.currentOptions?.localUserId === options.localUserId &&
      this.currentOptions?.remoteUserId === options.remoteUserId &&
      this.room;

    this.currentOptions = options;

    if (isSameCall && this.snapshot.joined) {
      this.setSnapshot({ mode: options.mode });
      await this.configureLocalTracksForMode(options.mode);
      this.updateRemoteSnapshotFromRoom();
      return;
    }

    await this.leaveCall({ preserveIdleState: true });

    const runtime = ensureLiveKitRuntime();
    const Room = runtime.Room;
    const AudioSession = runtime.AudioSession;

    if (!Room) {
      throw new Error("LiveKit Room is unavailable in the current build.");
    }

    this.room = new Room({ adaptiveStream: true, dynacast: true });

    this.setSnapshot({
      mode: options.mode,
      joined: false,
      connectionState: "connecting",
      local: {
        audioEnabled: true,
        videoEnabled: options.mode === "video",
      },
      remote: {
        audioEnabled: true,
        videoEnabled: false,
      },
    });

    this.bindRoomEvent(this.resolveRoomEvent("Connected"), async () => {
      this.setSnapshot({ joined: true, connectionState: "connected" });
      await this.configureLocalTracksForMode(options.mode);
      this.updateRemoteSnapshotFromRoom();
    });

    this.bindRoomEvent(this.resolveRoomEvent("ConnectionStateChanged"), (state: string) => {
      const normalized =
        state === "connected" || state === "connecting" || state === "reconnecting" || state === "disconnected"
          ? state
          : "connected";
      this.setSnapshot({
        joined: normalized === "connected" ? true : this.snapshot.joined,
        connectionState: normalized,
      });
    });

    this.bindRoomEvent(this.resolveRoomEvent("ParticipantConnected"), () => {
      this.updateRemoteSnapshotFromRoom();
    });

    this.bindRoomEvent(this.resolveRoomEvent("ParticipantDisconnected"), () => {
      this.updateRemoteSnapshotFromRoom();
    });

    this.bindRoomEvent(this.resolveRoomEvent("TrackSubscribed"), () => {
      this.updateRemoteSnapshotFromRoom();
    });

    this.bindRoomEvent(this.resolveRoomEvent("TrackUnsubscribed"), () => {
      this.updateRemoteSnapshotFromRoom();
    });

    this.bindRoomEvent(this.resolveRoomEvent("TrackMuted"), () => {
      this.updateRemoteSnapshotFromRoom();
    });

    this.bindRoomEvent(this.resolveRoomEvent("TrackUnmuted"), () => {
      this.updateRemoteSnapshotFromRoom();
    });

    this.bindRoomEvent(this.resolveRoomEvent("Reconnecting"), () => {
      this.setSnapshot({ connectionState: "reconnecting" });
    });

    this.bindRoomEvent(this.resolveRoomEvent("Reconnected"), () => {
      this.setSnapshot({ joined: true, connectionState: "connected" });
      this.updateRemoteSnapshotFromRoom();
    });

    this.bindRoomEvent(this.resolveRoomEvent("Disconnected"), () => {
      this.setSnapshot({ joined: false, connectionState: "ended" });
    });

    try {
      await AudioSession?.startAudioSession?.();
      await this.room.connect(options.serverUrl, options.accessToken, { autoSubscribe: true });
      await this.configureLocalTracksForMode(options.mode);
      this.updateRemoteSnapshotFromRoom();
      this.setSnapshot({ joined: true, connectionState: "connected" });
    } catch (error) {
      console.error("LiveKit join failed", error);
      this.setSnapshot({ joined: false, connectionState: "disconnected" });
      throw error instanceof Error ? error : new Error("Unable to join LiveKit room");
    }
  }

  async leaveCall(options?: { preserveIdleState?: boolean }) {
    const runtime = (() => {
      try {
        return ensureLiveKitRuntime();
      } catch {
        return null;
      }
    })();

    this.clearRoomListeners();

    try {
      await this.room?.disconnect?.();
    } catch (error) {
      console.warn("LiveKit disconnect failed", error);
    }

    this.room = null;
    this.currentOptions = null;

    try {
      await runtime?.AudioSession?.stopAudioSession?.();
    } catch (error) {
      console.warn("LiveKit audio session stop failed", error);
    }

    this.setSnapshot({
      joined: false,
      connectionState: options?.preserveIdleState ? "idle" : "ended",
      local: {
        audioEnabled: true,
        videoEnabled: false,
        cameraFacing: "front",
      },
      remote: {
        audioEnabled: true,
        videoEnabled: false,
      },
    });
  }

  async setMuted(muted: boolean) {
    await this.room?.localParticipant?.setMicrophoneEnabled?.(!muted);
    this.setSnapshot({
      local: {
        audioEnabled: !muted,
      },
    });
  }

  async setCameraEnabled(enabled: boolean) {
    await this.room?.localParticipant?.setCameraEnabled?.(enabled);
    this.setSnapshot({
      local: {
        videoEnabled: enabled,
      },
    });
  }

  async switchCamera() {
    const nextFacing: CameraFacing = this.snapshot.local.cameraFacing === "front" ? "back" : "front";

    try {
      const runtime = ensureLiveKitRuntime();
      const cameraSource = runtime.Track?.Source?.Camera;
      const publication = cameraSource
        ? this.room?.localParticipant?.getTrackPublication?.(cameraSource)
        : null;
      const track = publication?.videoTrack ?? publication?.track;
      await track?.restartTrack?.({
        facingMode: nextFacing === "front" ? "user" : "environment",
      });
    } catch (error) {
      console.warn("LiveKit switchCamera fallback applied", error);
    }

    this.setSnapshot({
      local: {
        cameraFacing: nextFacing,
      },
    });
  }

  async setRemoteVideoEnabled(enabled: boolean) {
    this.setSnapshot({
      remote: {
        videoEnabled: enabled,
      },
    });
  }
}

export const providerRtcEngine = new ProviderRtcEngine();