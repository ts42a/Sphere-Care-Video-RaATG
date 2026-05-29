import React, { useEffect, useRef } from "react";
import { View } from "react-native";

type AslVisionCameraCaptureProps = {
  active: boolean;
  facing?: "front" | "back";
  onFrame?: (imageB64: string) => void | Promise<void>;
  onError?: (message: string, error?: unknown) => void;
};

export default function AslVisionCameraCapture({
  active,
  facing = "front",
  onFrame,
  onError,
}: AslVisionCameraCaptureProps) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      try {
        /*
          Placeholder frame capture.

          This component keeps the ASL camera pipeline type-safe.
          Later, if you connect a real camera or vision model, replace
          the mockBase64Image value with the real captured frame base64.
        */
        const mockBase64Image = "";

        if (onFrame) {
          void onFrame(mockBase64Image);
        }
      } catch (error) {
        if (onError) {
          onError("ASL camera capture failed", error);
        }
      }
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active, facing, onFrame, onError]);

  return <View style={{ display: "none" }} />;
}