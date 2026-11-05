import type { AppInstallStatus, DeviceInfo, DeviceList } from "../types";

export type BoardState = "noStatus" | "installing" | "installed" | "failed";

export const BOARD_STATE_LABELS: Record<BoardState, string> = {
  noStatus: "No status yet",
  installing: "Installing",
  installed: "Installed",
  failed: "Failed",
};

export interface BoardRow {
  key: string;
  listId: string;
  listName: string;
  deviceId: string | null;
  deviceName: string;
  serialNumber: string | null;
  state: BoardState;
  detail: string | null;
  errorCode: string | null;
  lastReported: string | null;
  notFound: boolean;
}

export interface BoardList {
  id: string;
  name: string;
  color: string | null;
  rows: BoardRow[];
  counts: Record<BoardState, number>;
  total: number;
}

const MISSING_PREFIX = "missing:";

const STATE_ORDER: Record<BoardState, number> = {
  failed: 0,
  installing: 1,
  noStatus: 2,
  installed: 3,
};

/** Anything unrecognised stays grey: an unknown value is not a reported failure. */
export const normalizeInstallState = (raw: string | null | undefined): BoardState => {
  switch ((raw ?? "").toLowerCase().replace(/\s+/g, "")) {
    case "installed":
      return "installed";
    case "failed":
    case "uninstallfailed":
      return "failed";
    case "pendinginstall":
    case "installpending":
    case "installing":
      return "installing";
    default:
      return "noStatus";
  }
};

const reportedAt = (s: AppInstallStatus): number => {
  const t = s.lastReported ? Date.parse(s.lastReported) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

const newer = (a: AppInstallStatus | undefined, b: AppInstallStatus): AppInstallStatus =>
  a && reportedAt(a) >= reportedAt(b) ? a : b;

export const buildBoard = (
  lists: DeviceList[],
  devices: DeviceInfo[],
  statuses: AppInstallStatus[],
): BoardList[] => {
  const devicesById = new Map(devices.map((d) => [d.id, d]));
  const devicesByName = new Map<string, DeviceInfo[]>();
  for (const d of devices) {
    const key = d.deviceName.toLowerCase();
    devicesByName.set(key, [...(devicesByName.get(key) ?? []), d]);
  }

  const statusByDevice = new Map<string, AppInstallStatus>();
  for (const s of statuses) {
    let id = s.deviceId?.toLowerCase();
    if (!id && s.deviceName) {
      const named = devicesByName.get(s.deviceName.toLowerCase());
      if (named?.length === 1) id = named[0].id.toLowerCase();
    }
    if (id) statusByDevice.set(id, newer(statusByDevice.get(id), s));
  }

  return lists.map((list) => {
    const counts: Record<BoardState, number> = { noStatus: 0, installing: 0, installed: 0, failed: 0 };
    const rows: BoardRow[] = [...new Set(list.deviceIds)].map((id) => {
      const key = `${list.id}:${id}`;
      const device = devicesById.get(id);
      if (!device) {
        return {
          key,
          listId: list.id,
          listName: list.name,
          deviceId: null,
          deviceName: id.startsWith(MISSING_PREFIX) ? id.substring(8) : id,
          serialNumber: null,
          state: "noStatus",
          detail: null,
          errorCode: null,
          lastReported: null,
          notFound: true,
        };
      }
      const status = statusByDevice.get(id.toLowerCase());
      const state = normalizeInstallState(status?.installState);
      counts[state] += 1;
      return {
        key,
        listId: list.id,
        listName: list.name,
        deviceId: id,
        deviceName: device.deviceName,
        serialNumber: device.serialNumber,
        state,
        detail: status?.stateDetail ?? null,
        errorCode: status?.errorCode ?? null,
        lastReported: status?.lastReported ?? null,
        notFound: false,
      };
    });
    return {
      id: list.id,
      name: list.name,
      color: list.color ?? null,
      rows,
      counts,
      total: rows.filter((r) => !r.notFound).length,
    };
  });
};

/** Failures first, then natural name order; not-found rows go last. */
export const sortBoardRows = (rows: BoardRow[]): BoardRow[] =>
  [...rows].sort(
    (a, b) =>
      Number(a.notFound) - Number(b.notFound) ||
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      a.deviceName.localeCompare(b.deviceName, undefined, { numeric: true }),
  );

export const filterBoardRows = (
  board: BoardList[],
  filter: { listId: string | null; state: BoardState | null },
): BoardRow[] =>
  board
    .filter((l) => filter.listId === null || l.id === filter.listId)
    .flatMap((l) => l.rows)
    .filter((r) => filter.state === null || (!r.notFound && r.state === filter.state));

export interface BoardChange {
  deviceId: string;
  name: string;
  from: BoardState;
  to: BoardState;
}

/** One entry per real device, however many chosen lists it sits in */
export const boardStateByDevice = (board: BoardList[]): Map<string, { name: string; state: BoardState }> => {
  const states = new Map<string, { name: string; state: BoardState }>();
  for (const row of board.flatMap((l) => l.rows)) {
    if (!row.notFound && row.deviceId) states.set(row.deviceId, { name: row.deviceName, state: row.state });
  }
  return states;
};

/** Devices missing from `before` (a list just ticked) are not changes */
export const diffBoardStates = (
  before: Map<string, { name: string; state: BoardState }>,
  after: Map<string, { name: string; state: BoardState }>,
): BoardChange[] =>
  [...after.entries()]
    .flatMap(([deviceId, now]) => {
      const was = before.get(deviceId);
      return was && was.state !== now.state ? [{ deviceId, name: now.name, from: was.state, to: now.state }] : [];
    })
    .sort(
      (a, b) =>
        STATE_ORDER[a.to] - STATE_ORDER[b.to] ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );

const CHANGE_WORDS: Record<BoardState, string> = {
  failed: "failed",
  installing: "installing",
  installed: "installed",
  noStatus: "back to no status",
};
const NAMES_SHOWN = 5;

/** Text for one notification per refresh, however many devices moved */
export const describeChanges = (changes: BoardChange[]): { title: string; body: string } | null => {
  if (changes.length === 0) return null;
  if (changes.length === 1) {
    const [c] = changes;
    return { title: `${c.name} is ${BOARD_STATE_LABELS[c.to]}`, body: `Was ${BOARD_STATE_LABELS[c.from]}` };
  }
  const counts = (Object.keys(STATE_ORDER) as BoardState[])
    .sort((a, b) => STATE_ORDER[a] - STATE_ORDER[b])
    .flatMap((s) => {
      const n = changes.filter((c) => c.to === s).length;
      return n ? [`${n} ${CHANGE_WORDS[s]}`] : [];
    });
  const shown = changes.slice(0, NAMES_SHOWN).map((c) => c.name).join(", ");
  const more = changes.length > NAMES_SHOWN ? ` and ${changes.length - NAMES_SHOWN} more` : "";
  return { title: `${changes.length} devices changed`, body: `${counts.join(", ")}\n${shown}${more}` };
};

export type BoardSortKey = "device" | "serial" | "state" | "lastReported" | "list" | "detail";

const byName = (a: BoardRow, b: BoardRow) => a.deviceName.localeCompare(b.deviceName, undefined, { numeric: true });

const sortValue = (row: BoardRow, key: BoardSortKey): string | number | null => {
  switch (key) {
    case "device": return row.deviceName;
    case "serial": return row.serialNumber || null;
    case "state": return STATE_ORDER[row.state];
    case "lastReported": {
      const t = row.lastReported ? Date.parse(row.lastReported) : NaN;
      return Number.isNaN(t) ? null : t;
    }
    case "list": return row.listName;
    case "detail": return [row.errorCode, row.detail].filter(Boolean).join(" · ") || null;
  }
};

/** Column sort for the table. Blanks and not-found rows stay at the bottom in both directions; ties go by name. */
export const sortBoardRowsBy = (rows: BoardRow[], key: BoardSortKey, direction: "asc" | "desc"): BoardRow[] => {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.notFound !== b.notFound) return Number(a.notFound) - Number(b.notFound);
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null || vb === null) return va === vb ? byName(a, b) : va === null ? 1 : -1;
    const cmp = typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb), undefined, { numeric: true });
    return sign * cmp || byName(a, b);
  });
};
