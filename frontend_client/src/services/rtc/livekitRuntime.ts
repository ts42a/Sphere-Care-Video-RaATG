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

function tryRequire(moduleName: string): any | null {
  try {
    // eslint-disable-next-line no-eval
    const req = eval("require");
    return req(moduleName);
  } catch {
    return null;
  }
}

export function ensureLiveKitRuntime(): LiveKitRuntime {
  const reactNativeModule = tryRequire("@livekit/react-native");
  const clientModule = tryRequire("livekit-client");

  if (!reactNativeModule || !clientModule) {
    throw new Error(
      "LiveKit native packages are not installed yet. Run npm install, then create an Expo development build before testing calls."
    );
  }

  return {
    AudioSession: reactNativeModule.AudioSession,
    registerGlobals: reactNativeModule.registerGlobals,
    Room: clientModule.Room,
    RoomEvent: clientModule.RoomEvent,
    Track: clientModule.Track,
  };
}

export function registerLiveKitGlobalsOnce() {
  if (globalsRegistered) return true;

  try {
    const runtime = ensureLiveKitRuntime();
    runtime.registerGlobals?.();
    globalsRegistered = true;
    return true;
  } catch (error) {
    console.warn("LiveKit globals were not registered", error);
    return false;
  }
}