declare module "@livekit/react-native" {
  export const AudioSession: {
    startAudioSession?: () => Promise<void>;
    stopAudioSession?: () => Promise<void>;
    configureAudio?: (options: unknown) => Promise<void>;
  };
  export const registerGlobals: () => void;
}

declare module "livekit-client" {
  export class Room {
    constructor(options?: unknown);
    connect(url: string, token: string, options?: unknown): Promise<void>;
    disconnect(): Promise<void>;
    on(event: any, callback: (...args: any[]) => void): void;
    off(event: any, callback: (...args: any[]) => void): void;
    remoteParticipants: Map<any, any>;
    localParticipant: any;
  }
  export const RoomEvent: Record<string, any>;
  export const Track: {
    Source: {
      Camera: string;
      Microphone: string;
    };
  };
}