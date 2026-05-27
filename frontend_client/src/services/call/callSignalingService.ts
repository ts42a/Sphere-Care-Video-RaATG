import { wsClient } from "../wsClient";
import type {
  CameraFacing,
  RtcCallMode,
  RtcConnectionState,
} from "../rtc/rtcEngine";

type JoinCallPayload = {
  callId: string;
  mode: RtcCallMode;
  localUserId: string;
  remoteUserId: string;
};

type LeaveCallPayload = {
  callId: string;
  localUserId: string;
};

type LocalMediaPayload = {
  callId: string;
  localUserId: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  cameraFacing: CameraFacing;
};

type TranscriptItem = {
  id: number;
  speaker: string;
  role: "doctor" | "patient" | "ai";
  content: string;
  created_at: string;
};

type SubscribeHandlers = {
  onJoined?: () => void;
  onConnectionState?: (state: RtcConnectionState) => void;
  onRemoteMediaUpdated?: (payload: {
    audioEnabled: boolean;
    videoEnabled: boolean;
  }) => void;
  onTranscriptUpdated?: (item: TranscriptItem) => void;
  onTranscribingUpdated?: (transcribing: boolean) => void;
  onEnded?: () => void;
};

function eventPayload(message: any) {
  return message?.payload && typeof message.payload === "object"
    ? message.payload
    : message;
}

function sameCall(message: any, callId: string) {
  const payload = eventPayload(message);
  return String(payload?.call_id ?? payload?.callId ?? "") === String(callId);
}

function normalizeConnectionState(value: unknown): RtcConnectionState {
  if (
    value === "idle" ||
    value === "connecting" ||
    value === "connected" ||
    value === "reconnecting" ||
    value === "disconnected" ||
    value === "ended"
  ) {
    return value;
  }

  return "connected";
}

export const callSignalingService = {
  async ensureConnected() {
    await wsClient.connect();
  },

  async joinCall(payload: JoinCallPayload) {
    await wsClient.connect();

    wsClient.send("call_join", {
      call_id: payload.callId,
      mode: payload.mode,
      local_user_id: payload.localUserId,
      remote_user_id: payload.remoteUserId,
    });
  },

  async leaveCall(payload: LeaveCallPayload) {
    await wsClient.connect();

    wsClient.send("call_leave", {
      call_id: payload.callId,
      local_user_id: payload.localUserId,
    });
  },

  async updateLocalMedia(payload: LocalMediaPayload) {
    await wsClient.connect();

    wsClient.send("call_local_media_updated", {
      call_id: payload.callId,
      local_user_id: payload.localUserId,
      audio_enabled: payload.audioEnabled,
      video_enabled: payload.videoEnabled,
      camera_facing: payload.cameraFacing,
    });
  },

  subscribe(callId: string, handlers: SubscribeHandlers) {
    const cleanups = [
      wsClient.subscribe("call_joined", (message: any) => {
        const payload = eventPayload(message);
        if (!sameCall(payload, callId)) return;
        handlers.onJoined?.();
      }),

      wsClient.subscribe("call_connection_state", (message: any) => {
        const payload = eventPayload(message);
        if (!sameCall(payload, callId)) return;
        handlers.onConnectionState?.(
          normalizeConnectionState(payload?.state)
        );
      }),

      wsClient.subscribe("call_remote_media_updated", (message: any) => {
        const payload = eventPayload(message);
        if (!sameCall(payload, callId)) return;

        handlers.onRemoteMediaUpdated?.({
          audioEnabled: payload?.audio_enabled ?? true,
          videoEnabled: payload?.video_enabled ?? true,
        });
      }),

      wsClient.subscribe("call_transcript_updated", (message: any) => {
        const payload = eventPayload(message);
        if (!sameCall(payload, callId)) return;
        if (!payload?.item) return;
        handlers.onTranscriptUpdated?.(payload.item);
      }),

      wsClient.subscribe("call_transcribing_updated", (message: any) => {
        const payload = eventPayload(message);
        if (!sameCall(payload, callId)) return;
        handlers.onTranscribingUpdated?.(payload?.transcribing ?? true);
      }),

      wsClient.subscribe("call_ended", (message: any) => {
        const payload = eventPayload(message);
        if (!sameCall(payload, callId)) return;
        handlers.onEnded?.();
      }),
    ];

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  },
};