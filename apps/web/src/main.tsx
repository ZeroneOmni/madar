import {
  applyAppearancePreferences,
  decodeAppearance,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
} from "./appearancePreferences";
import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";

import { isElectron } from "./env";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { AppRoot } from "./AppRoot";
import { initializeAppSession } from "./routers/access";
import { clearChunkReloadGuard, reloadOnceForChunkLoadError } from "./lib/chunkReloadGuard";

if (isElectron) {
  syncDocumentElectronPlatformClasses(navigator.platform);
  syncDocumentWindowControlsOverlayClass();
}

try {
  applyAppearancePreferences(
    document.documentElement,
    decodeAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)),
  );
} catch {
  applyAppearancePreferences(document.documentElement, DEFAULT_APPEARANCE);
}

let chunkLoadFailed = false;
let reloadScheduled = false;
window.addEventListener("vite:preloadError", (event) => {
  chunkLoadFailed = true;
  if (reloadOnceForChunkLoadError()) {
    reloadScheduled = true;
    event.preventDefault();
  }
});

export const startup = Promise.resolve()
  .then(initializeAppSession)
  .then(() => {
    if (reloadScheduled) return;
    if (!chunkLoadFailed) clearChunkReloadGuard();
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <AppRoot />
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    if (reloadScheduled) return;
    throw error;
  });
