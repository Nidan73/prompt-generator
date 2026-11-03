"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ParsedApiError } from "@/lib/home-errors";

export const COOLDOWN_MESSAGE = "Cooling down this IP before the next request.";

// Countdown after a rate-limited response, plus the shared way to surface API errors.
export function useCooldown(setError: Dispatch<SetStateAction<string>>) {
  const [cooldownTimer, setCooldownTimer] = useState(0);

  // One timeout per tick, so reaching zero is a plain effect step and the
  // matching message can be cleared without a side effect inside an updater.
  useEffect(() => {
    if (cooldownTimer <= 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCooldownTimer(cooldownTimer - 1);
      if (cooldownTimer === 1) {
        // Only the cooldown notice goes away, any other error stays visible.
        setError((current) => (current === COOLDOWN_MESSAGE ? "" : current));
      }
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [cooldownTimer, setError]);

  function reportApiError({ message, retryAfter }: ParsedApiError, fallback: string) {
    if (typeof retryAfter === "number") {
      setCooldownTimer(Math.max(1, Math.ceil(retryAfter)));
      setError(COOLDOWN_MESSAGE);
      return;
    }

    setError(message ?? fallback);
  }

  return { cooldownTimer, isCoolingDown: cooldownTimer > 0, reportApiError };
}
