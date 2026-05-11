/**
 * src/hooks/useAudioChunks.ts
 *
 * Records microphone in 2-second chunks and sends each chunk
 * via wsClient.send() as an audio_chunk message.
 *
 * Backend: ws.py → _handle_audio_chunk → Whisper → call.caption broadcast
 *
 * Usage:
 *   useAudioChunks(callId, { enabled: transcribing });
 *
 * Requires: expo install expo-av expo-file-system
 */

import { useCallback, useEffect, useRef } from "react";
import { wsClient } from "../services/wsClient";

const CHUNK_INTERVAL_MS = 2000;
const SAMPLE_RATE = 16000;

interface UseAudioChunksOptions {
  enabled: boolean;
  language?: string;
}

export function useAudioChunks(
  callId: string | number | undefined,
  options: UseAudioChunksOptions
) {
  const { enabled, language } = options;
  const recordingRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);

  const sendChunk = useCallback(
    async (recording: any) => {
      if (!callId) return;

      try {
        const uri: string | null = recording.getURI();
        if (!uri) return;

        const { default: FileSystem } = await import("expo-file-system");
        const b64: string = await FileSystem.readAsStringAsync(uri, {
          encoding: (FileSystem as any).EncodingType.Base64,
        });

        if (!b64) return;

        await wsClient.send({
          type: "audio_chunk",
          payload: {
            call_id: String(callId),
            audio_b64: b64,
            language: language ?? null,
          },
        });
      } catch (err) {
        console.warn("[useAudioChunks] sendChunk error:", err);
      }
    },
    [callId, language]
  );

  const stopCurrentRecording = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    try {
      await rec.stopAndUnloadAsync();
      await sendChunk(rec);
    } catch (_) {}
  }, [sendChunk]);

  const startChunkLoop = useCallback(async () => {
    if (!activeRef.current || !callId) return;

    let Audio: any;
    try {
      ({ Audio } = await import("expo-av"));
    } catch {
      console.warn("[useAudioChunks] expo-av not available");
      return;
    }

    const { status } = await Audio.requestPermissionsAsync();
    if (status !== "granted") {
      console.warn("[useAudioChunks] Mic permission denied");
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const startNewRecording = async () => {
      if (!activeRef.current) return;

      try {
        // Flush previous chunk
        const prev = recordingRef.current;
        if (prev) {
          recordingRef.current = null;
          try {
            await prev.stopAndUnloadAsync();
            await sendChunk(prev);
          } catch (_) {}
        }

        if (!activeRef.current) return;

        const { recording } = await Audio.Recording.createAsync(
          {
            android: {
              extension: ".webm",
              outputFormat: Audio.AndroidOutputFormat.WEBM,
              audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
              sampleRate: SAMPLE_RATE,
              numberOfChannels: 1,
              bitRate: 32000,
            },
            ios: {
              extension: ".m4a",
              outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
              audioQuality: Audio.IOSAudioQuality.LOW,
              sampleRate: SAMPLE_RATE,
              numberOfChannels: 1,
              bitRate: 32000,
              linearPCMBitDepth: 16,
              linearPCMIsBigEndian: false,
              linearPCMIsFloat: false,
            },
            web: {
              mimeType: "audio/webm;codecs=opus",
              bitsPerSecond: 32000,
            },
          },
          undefined,
          false
        );
        recordingRef.current = recording;
      } catch (err) {
        console.warn("[useAudioChunks] Recording error:", err);
      }
    };

    await startNewRecording();
    intervalRef.current = setInterval(startNewRecording, CHUNK_INTERVAL_MS);
  }, [callId, sendChunk]);

  useEffect(() => {
    if (enabled && callId) {
      activeRef.current = true;
      startChunkLoop();
    } else {
      activeRef.current = false;
      stopCurrentRecording();
    }

    return () => {
      activeRef.current = false;
      stopCurrentRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, callId]);
}