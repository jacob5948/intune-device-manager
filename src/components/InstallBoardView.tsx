import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import Icon from "@mdi/react";
import { mdiChevronDown, mdiChevronUp, mdiClose } from "@mdi/js";
import type { AppInstallStatus, DeviceInfo, DeviceList, MobileAppSummary } from "../types";
import { loadBoardNotify, loadBoardSelection, saveBoardNotify, saveBoardSelection } from "../hooks/useLocalStorage";
import { formatDate, relativeTime } from "../utils/device";
import {
  BOARD_STATE_LABELS,
  boardStateByDevice,
  buildBoard,
  describeChanges,
  diffBoardStates,
  filterBoardRows,
  sortBoardRowsBy,
  type BoardSortKey,
  type BoardState,
} from "../utils/installBoard";

const REFRESH_MS = 180_000;
// A cart is 32 laptops; lists bigger than this fill the row instead of a narrow 8-wide card
const WIDE_LIST_AFTER = 48;

/** Open the hover label leftwards on the right half of the window, wherever the square sits */
const placeTip = (e: React.SyntheticEvent<HTMLElement>) => {
  const { left, width } = e.currentTarget.getBoundingClientRect();
  e.currentTarget.dataset.tip = left + width / 2 > window.innerWidth / 2 ? "left" : "right";
};

/** An icon, not a "×" character: a glyph sits on the font's baseline and drifts off centre */
const FailedMark = () => <Icon path={mdiClose} className="board-failed-mark" />;
const STATES: BoardState[] = ["failed", "installing", "noStatus", "installed"];

interface InstallBoardViewProps {
  isActive: boolean;
  devices: DeviceInfo[];
  deviceLists: DeviceList[];
  onOpenDevice: (deviceId: string) => void;
}

const COLUMNS: { key: BoardSortKey; label: string }[] = [
  { key: "device", label: "Device" },
  { key: "serial", label: "Serial" },
  { key: "state", label: "State" },
  { key: "lastReported", label: "Last reported" },
  { key: "list", label: "List" },
  { key: "detail", label: "Detail" },
];

function InstallBoardView({ isActive, devices, deviceLists, onOpenDevice }: InstallBoardViewProps) {
  const [apps, setApps] = useState<MobileAppSummary[] | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [appSearch, setAppSearch] = useState("");
  const [choosingApp, setChoosingApp] = useState(false);
  const [appId, setAppId] = useState<string | null>(() => loadBoardSelection().appId);
  const [listIds, setListIds] = useState<string[]>(() => loadBoardSelection().listIds);
  const [statuses, setStatuses] = useState<AppInstallStatus[]>([]);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<BoardState | null>(null);
  // Failures first until a header is clicked
  const [sort, setSort] = useState<{ key: BoardSortKey; direction: "asc" | "desc" }>({ key: "state", direction: "asc" });
  const [notify, setNotify] = useState(loadBoardNotify);
  const previousStates = useRef<ReturnType<typeof boardStateByDevice> | null>(null);
  const requestSeq = useRef(0);
  const inFlightApp = useRef<string | null>(null);

  const loadApps = useCallback(async () => {
    setAppsError(null);
    try {
      setApps(await invoke<MobileAppSummary[]>("get_mobile_apps"));
    } catch (e) {
      setAppsError(String(e));
    }
  }, []);

  useEffect(() => {
    if (isActive && apps === null && appsError === null) loadApps();
  }, [isActive, apps, appsError, loadApps]);

  // Remembered app was removed from Intune. Only a successful load can say so.
  useEffect(() => {
    if (apps && appId && !apps.some((a) => a.id === appId)) setAppId(null);
  }, [apps, appId]);

  useEffect(() => {
    saveBoardSelection({ appId, listIds });
  }, [appId, listIds]);

  const refresh = useCallback(async (id: string) => {
    if (inFlightApp.current === id) return;
    inFlightApp.current = id;
    const seq = ++requestSeq.current;
    setRefreshing(true);
    try {
      const rows = await invoke<AppInstallStatus[]>("get_app_install_statuses", { appId: id });
      if (seq !== requestSeq.current) return;
      setStatuses(rows);
      setLastChecked(new Date());
      setRefreshError(null);
    } catch (e) {
      // Keep the last rows on screen: a failed check says nothing about the devices.
      if (seq === requestSeq.current) setRefreshError(String(e));
    } finally {
      if (seq === requestSeq.current) {
        inFlightApp.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  const chooseApp = (id: string | null) => {
    previousStates.current = null;
    requestSeq.current++;
    inFlightApp.current = null;
    setRefreshing(false);
    setStatuses([]);
    setLastChecked(null);
    setRefreshError(null);
    setStateFilter(null);
    setAppId(id);
    setChoosingApp(false);
    setAppSearch("");
  };

  useEffect(() => {
    if (!isActive || !appId) return;
    refresh(appId);
    const timer = window.setInterval(() => refresh(appId), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isActive, appId, refresh]);

  const chosenLists = useMemo(
    () => deviceLists.filter((l) => listIds.includes(l.id)),
    [deviceLists, listIds],
  );
  const board = useMemo(
    () => buildBoard(chosenLists, devices, statuses),
    [chosenLists, devices, statuses],
  );
  useEffect(() => {
    saveBoardNotify(notify);
    if (!notify || !isActive) return;
    // Ask while the user is looking at the board, not on the first change
    isPermissionGranted()
      .then((granted) => {
        if (!granted) return requestPermission();
      })
      .catch(() => {});
  }, [notify, isActive]);

  // Compare each new board with the last one. Nothing is compared until the
  // first report for this app has arrived, so opening the board or switching
  // app never announces every device at once.
  useEffect(() => {
    if (!lastChecked) {
      previousStates.current = null;
      return;
    }
    const current = boardStateByDevice(board);
    const before = previousStates.current;
    previousStates.current = current;
    if (!before || !notify) return;
    const message = describeChanges(diffBoardStates(before, current));
    if (!message) return;
    isPermissionGranted()
      .then((granted) => granted && sendNotification(message))
      .catch(() => {});
  }, [board, lastChecked, notify]);

  const activeListFilter = board.some((l) => l.id === listFilter) ? listFilter : null;
  const rows = useMemo(
    () => sortBoardRowsBy(filterBoardRows(board, { listId: activeListFilter, state: stateFilter }), sort.key, sort.direction),
    [board, activeListFilter, stateFilter, sort],
  );
  const stateTotals = useMemo(() => {
    const totals: Record<BoardState, number> = { noStatus: 0, installing: 0, installed: 0, failed: 0 };
    for (const list of board) for (const s of STATES) totals[s] += list.counts[s];
    return totals;
  }, [board]);

  const app = apps?.find((a) => a.id === appId) ?? null;
  const matchingApps = useMemo(() => {
    const q = appSearch.trim().toLowerCase();
    return (apps ?? [])
      .filter((a) => !q || a.displayName.toLowerCase().includes(q) || a.publisher?.toLowerCase().includes(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [apps, appSearch]);

  // Same column flips direction; a new column starts newest-first for times, A–Z otherwise
  const sortBy = (key: BoardSortKey) =>
    setSort((cur) =>
      cur.key === key
        ? { key, direction: cur.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "lastReported" ? "desc" : "asc" },
    );

  const toggleList = (id: string) =>
    setListIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const picking = !appId || choosingApp;

  return (
    <main className="install-board">
      <section className="board-setup">
        <div className="board-setup-row">
          <span className="board-setup-label">App</span>
          {appsError ? (
            <div className="board-error" role="alert">
              <span>{appsError}</span>
              <button className="btn-secondary btn-small" onClick={loadApps}>Try again</button>
            </div>
          ) : !picking ? (
            <div className="board-chosen-app">
              <strong>{app?.displayName ?? "Loading…"}</strong>
              {app?.publisher && <span className="board-muted">{app.publisher}</span>}
              <button className="btn-secondary btn-small" onClick={() => setChoosingApp(true)}>Change</button>
            </div>
          ) : (
            <div className="board-app-picker">
              <input
                type="text"
                placeholder={apps ? "Search apps…" : "Loading apps…"}
                aria-label="Search apps"
                value={appSearch}
                disabled={!apps}
                onChange={(e) => setAppSearch(e.target.value)}
              />
              {apps && (
                <ul className="board-app-results">
                  {matchingApps.map((a) => (
                    <li key={a.id}>
                      <button onClick={() => chooseApp(a.id)}>
                        <span>{a.displayName}</span>
                        {a.publisher && <span className="board-muted">{a.publisher}</span>}
                      </button>
                    </li>
                  ))}
                  {matchingApps.length === 0 && <li className="board-muted board-no-match">No matching apps</li>}
                </ul>
              )}
              {choosingApp && (
                <button className="btn-secondary btn-small" onClick={() => setChoosingApp(false)}>Cancel</button>
              )}
            </div>
          )}
        </div>
        <div className="board-setup-row">
          <span className="board-setup-label">Lists</span>
          {deviceLists.length === 0 ? (
            <span className="board-muted">No device lists yet. Create one on the Devices tab.</span>
          ) : (
            <div className="board-list-choices">
              {deviceLists.map((l) => (
                <label key={l.id} className="board-list-choice">
                  <input type="checkbox" checked={listIds.includes(l.id)} onChange={() => toggleList(l.id)} />
                  {l.color && <span className="list-color-dot" style={{ background: l.color }} />}
                  {l.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </section>

      {!appId || chosenLists.length === 0 ? (
        <div className="empty-state">
          {!appId ? "Choose an app to see its install status." : "Choose one or more lists to watch."}
        </div>
      ) : (
        <>
          <div className="board-status-bar">
            <div className="board-legend">
              {STATES.map((s) => (
                <button
                  key={s}
                  className="board-legend-item"
                  aria-pressed={stateFilter === s}
                  onClick={() => setStateFilter(stateFilter === s ? null : s)}
                >
                  <span className={`board-square board-${s}`} aria-hidden="true">{s === "failed" && <FailedMark />}</span>
                  {BOARD_STATE_LABELS[s]} ({stateTotals[s]})
                </button>
              ))}
            </div>
            <div className="board-refresh">
              <label className="board-notify">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                Notify on changes
              </label>
              <span className="board-muted">
                {lastChecked ? `Last checked ${lastChecked.toLocaleTimeString()}` : "Not checked yet"}
              </span>
              <button
                className="btn-secondary btn-small"
                onClick={() => refresh(appId)}
                disabled={refreshing}
              >
                {refreshing ? <><span className="spinner" />Checking…</> : "Refresh"}
              </button>
            </div>
          </div>

          {refreshError && <div className="board-error" role="alert">{refreshError}</div>}

          <div className="board-lists">
            {board.map((list) => (
              <div key={list.id} className={`board-list${list.rows.length > WIDE_LIST_AFTER ? " board-list-wide" : ""}`}>
                <button
                  className="board-list-header"
                  aria-pressed={activeListFilter === list.id}
                  onClick={() => setListFilter(activeListFilter === list.id ? null : list.id)}
                >
                  {list.color && <span className="list-color-dot" style={{ background: list.color }} />}
                  <strong>{list.name}</strong>
                  <span className="board-muted">{list.counts.installed} / {list.total} installed</span>
                </button>
                <div className="board-squares">
                  {list.rows.filter((r) => !r.notFound).map((r) => {
                    const info = `${r.deviceName}${r.serialNumber ? `, ${r.serialNumber}` : ""}: ${BOARD_STATE_LABELS[r.state]}, ${r.lastReported ? `reported ${formatDate(r.lastReported)}` : "no report yet"}`;
                    return (
                      <button
                        key={r.key}
                        className={`board-square board-${r.state}`}
                        aria-label={`${info}. Open device`}
                        onClick={() => r.deviceId && onOpenDevice(r.deviceId)}
                        onMouseEnter={placeTip}
                        onFocus={placeTip}
                      >
                        {r.state === "failed" && <FailedMark />}
                        <span className="board-tip" aria-hidden="true">
                          <strong>{r.deviceName}</strong>
                          {BOARD_STATE_LABELS[r.state]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <table className="board-table">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    aria-sort={sort.key === c.key ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <button className="board-sort" onClick={() => sortBy(c.key)}>
                      {c.label}
                      <Icon
                        path={sort.key === c.key && sort.direction === "desc" ? mdiChevronDown : mdiChevronUp}
                        className={`board-sort-icon${sort.key === c.key ? " active" : ""}`}
                      />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.notFound || !r.deviceId ? (
                      `[Not found] ${r.deviceName}`
                    ) : (
                      <button className="board-device-link" onClick={() => onOpenDevice(r.deviceId!)}>
                        {r.deviceName}
                      </button>
                    )}
                  </td>
                  <td>{r.serialNumber ?? ""}</td>
                  <td>
                    {!r.notFound && (
                      <span className="board-state">
                        <span className={`board-square board-small board-${r.state}`} aria-hidden="true">{r.state === "failed" && <FailedMark />}</span>
                        {BOARD_STATE_LABELS[r.state]}
                      </span>
                    )}
                  </td>
                  <td title={r.lastReported ? formatDate(r.lastReported) : undefined}>
                    {r.lastReported ? relativeTime(r.lastReported) : ""}
                  </td>
                  <td>{r.listName}</td>
                  <td className="board-muted">{[r.errorCode, r.detail].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="board-muted">No devices match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

export default InstallBoardView;
