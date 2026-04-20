export type RtcCallMode = "audio" | "video";
export type RtcConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "ended";

export type CameraFacing = "front" | "back";

export type RtcJoinOptions = {
  callId: string;
  mode: RtcCallMode;
  localUserId: string;
  remoteUserId: string;
  serverUrl?: string | null;
  accessToken?: string | null;
};

export type RtcEngineSnapshot = {
  joined: boolean;
  mode: RtcCallMode;
  connectionState: RtcConnectionState;
  local: {
    audioEnabled: boolean;
    videoEnabled: boolean;
    cameraFacing: CameraFacing;
  };
  remote: {
    audioEnabled: boolean;
    videoEnabled: boolean;
  };
};

export type RtcEngine = {
  getSnapshot(): RtcEngineSnapshot;
  subscribe(listener: (snapshot: RtcEngineSnapshot) => void): () => void;
  joinCall(options: RtcJoinOptions): Promise<void>;
  leaveCall(options?: { preserveIdleState?: boolean }): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  switchCamera(): Promise<void>;
  setRemoteVideoEnabled(enabled: boolean): Promise<void>;
  getRoom?(): any | null;
};