import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Icon from "@mdi/react";
import { mdiClose } from "@mdi/js";
import type { DeviceAppState, DeviceInfo } from "../types";
import { formatDate, relativeTime } from "../utils/device";
import { BOARD_STATE_LABELS, intentLabel, normalizeInstallState, sortDeviceApps } from "../utils/installBoard";

interface DeviceAppsProps {
  device: DeviceInfo;
}

/** Reopening a device inside this window shows the last result without asking Intune again */
const FRESH_MS = 10 * 60_000;

// For this session only: kept in memory, cleared on sign-out
const cache = new Map<string, { apps: DeviceAppState[]; fetchedAt: number }>();

export const clearDeviceAppsCache = () => cache.clear();

/**
 * The open device's assigned apps and what Intune reports for each. Read-only, like the
 * App installs tab, and loaded only when a device is opened or Refresh is pressed.
 */
function DeviceApps({ device }: DeviceAppsProps) {
  const [apps, setApps] = useState<DeviceAppState[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const rows = await invoke<DeviceAppState[]>("get_device_app_states", {
        deviceId: device.id,
        deviceName: device.deviceName,
        upn: device.userPrincipalName || null,
      });
      const sorted = sortDeviceApps(rows);
      const now = Date.now();
      // A partly refused result is shown but not kept as fresh, so the next open tries again
      if (sorted.some((a) => a.reportError)) cache.set(device.id, { apps: sorted, fetchedAt: 0 });
      else cache.set(device.id, { apps: sorted, fetchedAt: now });
      if (seq === requestSeq.current) {
        setApps(sorted);
        setFetchedAt(now);
      }
    } catch (e) {
      if (seq === requestSeq.current) setError(String(e));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [device.id, device.deviceName, device.userPrincipalName]);

  // Show what is cached straight away; ask Intune only when there is nothing or it is stale.
  // A device with nothing cached starts empty, so the last device's apps never show under its name.
  useEffect(() => {
    const cached = cache.get(device.id);
    setApps(cached?.apps ?? null);
    setFetchedAt(cached?.fetchedAt || null); // 0 marks a partly refused result
    setError(null);
    if (!cached || Date.now() - cached.fetchedAt > FRESH_MS) load();
    else requestSeq.current++; // drop any reply still coming for the previous device
  }, [device.id, load]);

  return (
    <section className="device-apps" aria-label="Apps">
      <div className="device-apps-header">
        <h3>Apps</h3>
        {fetchedAt && (
          <span className="board-muted device-apps-checked" title={new Date(fetchedAt).toLocaleString()}>
            Checked {relativeTime(new Date(fetchedAt).toISOString()).replace(/^Just now$/, "just now")}
          </span>
        )}
        <button className="btn-secondary btn-small" onClick={load} disabled={loading}>
          {loading ? <><span className="spinner" />Checking…</> : "Refresh"}
        </button>
      </div>
      {error && <div className="board-error" role="alert">{error}</div>}
      {apps === null ? (
        !error && <p className="board-muted">Loading apps…</p>
      ) : apps.length === 0 ? (
        <p className="board-muted">No apps are assigned to this device.</p>
      ) : (
        <table className="board-table device-apps-table">
          <thead>
            <tr>
              <th>App</th>
              <th>State</th>
              <th>Last reported</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => {
              const state = normalizeInstallState(a.installState);
              const intent = intentLabel(a.intent);
              return (
                <tr key={a.appId}>
                  <td>
                    {a.appName}
                    {(a.appVersion || intent) && (
                      <span className="board-muted device-apps-sub">
                        {[a.appVersion, intent].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="board-state">
                      <span className={`board-square board-small board-${state}`} aria-hidden="true">
                        {state === "failed" && <Icon path={mdiClose} className="board-failed-mark" />}
                      </span>
                      {/* "Not applicable" is grey like no report, but says why */}
                      {state === "noStatus" && a.installState ? a.installState : BOARD_STATE_LABELS[state]}
                    </span>
                  </td>
                  <td title={a.lastReported ? formatDate(a.lastReported) : undefined}>
                    {a.lastReported ? relativeTime(a.lastReported) : ""}
                  </td>
                  <td className="board-muted">
                    {a.reportError
                      ? `Couldn't check: ${a.reportError}`
                      : [a.errorCode, a.stateDetail].filter(Boolean).join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default DeviceApps;
