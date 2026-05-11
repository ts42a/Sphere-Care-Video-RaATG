import {
  AudioSession,
  registerGlobals,
} from "@livekit/react-native";

import {
  Room,
  RoomEvent,
  Track,
} from "livekit-client";

let globalsRegistered = false;

type LiveKitRuntime = {
  AudioSession?: {
    startAudioSession?: () => Promise<void>;
    stopAudioSession?: () => Promise<void>;
    configureAudio?: (options: unknown) => Promise<void>;
  };
  registerGlobals?: () => void;
  Room?: new (...args: any[]) => any;
  RoomEvent?: Record<string, any>;
  Track?: {
    Source?: { Camera?: string; Microphone?: string };
  };
};

export function ensureLiveKitRuntime(): LiveKitRuntime {
  return {
    AudioSession,
    registerGlobals,
    Room,
    RoomEvent,
    Track,
  };
}

export function registerLiveKitGlobalsOnce() {
  if (globalsRegistered) return true;

  try {
    registerGlobals();
    globalsRegistered = true;
    return true;
  } catch (error) {
    console.warn("LiveKit globals were not registered", error);
    return false;
  }
}