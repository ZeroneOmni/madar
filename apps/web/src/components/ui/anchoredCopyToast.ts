import { translate } from "../../locale";
import { readLocale } from "../../useLocale";
import type { RefObject } from "react";
import { anchoredToastManager } from "./toast";

export const ANCHORED_COPY_TOAST_TIMEOUT_MS = 1000;

export function showAnchoredCopySuccessToast(ref: RefObject<HTMLButtonElement | null>) {
  if (!ref.current) return;
  anchoredToastManager.add({
    data: {
      tooltipStyle: true,
    },
    positionerProps: {
      anchor: ref.current,
    },
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
    title: translate(readLocale(), "Copied!"),
  });
}

export function showAnchoredCopyErrorToast(
  ref: RefObject<HTMLButtonElement | null>,
  _error: Error,
) {
  if (!ref.current) return;
  anchoredToastManager.add({
    data: {
      tooltipStyle: true,
    },
    positionerProps: {
      anchor: ref.current,
    },
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
    title: translate(readLocale(), "Failed to copy"),
  });
}
