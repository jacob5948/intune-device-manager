import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "upToDate"
  | "error";

export interface AppUpdate {
  status: UpdateStatus;
  currentVersion: string;
  newVersion: string | null;
  notes: string | null;
  /** 0–1 while downloading, or null when the server sends no content length */
  progress: number | null;
  error: string | null;
  checkForUpdate: (silent?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  dismiss: () => void;
}

/** Wait this long after launch before the automatic check, so it never competes
 *  with the initial device load for bandwidth or attention. */
const AUTO_CHECK_DELAY_MS = 5000;

/**
 * Talks to the Tauri updater: checks GitHub Releases for a newer signed build,
 * downloads it on request, and relaunches into it.
 *
 * A failed check is only surfaced when the user asked for it — the automatic
 * check on launch stays silent, since being offline or on a VPN that can't
 * reach GitHub is not something to interrupt anyone about.
 */
export const useAppUpdate = (): AppUpdate => {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [currentVersion, setCurrentVersion] = useState("");
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Update | null>(null);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => setCurrentVersion(""));
  }, []);

  const checkForUpdate = useCallback(async (silent = false) => {
    setError(null);
    setStatus("checking");
    try {
      const update = await check();
      if (update) {
        pending.current = update;
        setNewVersion(update.version);
        setNotes(update.body ?? null);
        setStatus("available");
      } else {
        setStatus("upToDate");
      }
    } catch (e) {
      if (silent) {
        setStatus("idle");
      } else {
        setError(String(e));
        setStatus("error");
      }
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = pending.current;
    if (!update) return;
    setStatus("downloading");
    setProgress(null);
    setError(null);
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            setProgress(total > 0 ? 0 : null);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (total > 0) setProgress(downloaded / total);
            break;
          case "Finished":
            setProgress(1);
            break;
        }
      });
      setStatus("ready");
      // On Windows the installer takes over and this process exits before the
      // relaunch lands; on macOS it is what restarts the app.
      await relaunch();
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, []);

  const dismiss = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  // Automatic check shortly after launch
  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdate(true);
    }, AUTO_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  return {
    status,
    currentVersion,
    newVersion,
    notes,
    progress,
    error,
    checkForUpdate,
    installUpdate,
    dismiss,
  };
};
