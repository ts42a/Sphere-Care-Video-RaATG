import { useEffect, useState } from "react";
import { miniCallService, type MiniCallState } from "../services/miniCallService";

export function useMiniCall() {
  const [state, setState] = useState<MiniCallState>(miniCallService.getState());

  useEffect(() => {
    const unsubscribe = miniCallService.subscribe(setState);
    return () => {
      unsubscribe();
    };
  }, []);

  return state;
}