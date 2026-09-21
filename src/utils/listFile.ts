import type { DeviceInfo } from "../types";
import { matchIdentifiers } from "./device";

/**
 * Read and write the saved-device-list file format.
 *
 * The top level stays a bare array and every device keeps its legacy `name` key, so a
 * file written here still imports into older builds of the app. The format version sits
 * on each list instead of in an envelope for the same reason — installs update on a
 * stagger, so both directions have to keep working for a while.
 */
export const LIST_FILE_VERSION = 2;

/** Placeholder a v1 export wrote when the device was not loaded at export time */
const LEGACY_UNKNOWN_NAME = "unknown";

export interface ListFileDevice {
  id?: string | null;
  /** Legacy label field — written for old builds, never read by v2 resolution */
  name?: string | null;
  deviceName?: string | null;
  serialNumber?: string | null;
}

export interface ListFileList {
  /** Absent on v1 files, which is exactly how they are recognised */
  version?: number;
  name: string;
  color?: string | null;
  exportedAt?: string;
  devices: ListFileDevice[];
}

/** The subset of a DeviceList this format carries */
export interface ExportableList {
  name: string;
  color?: string | null;
  deviceIds: string[];
}

const MISSING_PREFIX = "missing:";

// ── Writing ──

/**
 * Serialize lists to JSON. `exportedAt` is injected rather than read from the clock so
 * the function stays pure and its output testable.
 */
export const buildListFile = (
  lists: ExportableList[],
  devices: DeviceInfo[],
  exportedAt: string
): string => {
  const byId = new Map(devices.map((d) => [d.id, d]));

  const payload: ListFileList[] = lists.map((list) => ({
    version: LIST_FILE_VERSION,
    name: list.name,
    ...(list.color ? { color: list.color } : {}),
    exportedAt,
    devices: list.deviceIds.map((id): ListFileDevice => {
      // An entry that never matched Intune keeps its original token and gets no id,
      // so a partially-unmatched list survives the round trip instead of losing its gaps
      if (id.startsWith(MISSING_PREFIX)) {
        const token = id.substring(MISSING_PREFIX.length);
        return { name: token, deviceName: token };
      }

      const device = byId.get(id);
      // Referenced but not currently loaded: the id is all we know, and keeping it
      // verbatim is what lets it resolve again later
      if (!device) return { id };

      return {
        id: device.id,
        name: device.deviceName,
        deviceName: device.deviceName,
        ...(device.serialNumber ? { serialNumber: device.serialNumber } : {}),
      };
    }),
  }));

  return JSON.stringify(payload, null, 2);
};

// ── Reading ──

export interface ParsedListFile {
  lists: ListFileList[];
  /** True when no list declared a version — resolution then has to stay id-first */
  legacy: boolean;
}

const isListShaped = (value: unknown): value is ListFileList => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === "string" && Array.isArray(candidate.devices);
};

/**
 * Recognise a saved-list file in any shape this app has ever written, plus the
 * `{ version, lists }` envelope in case one ever ships. Returns null when the value is
 * not a list file at all, so a caller can say so instead of guessing.
 */
export const parseListFile = (raw: unknown): ParsedListFile | null => {
  const candidates: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { lists?: unknown }).lists)
      ? ((raw as { lists: unknown[] }).lists)
      : [raw];

  if (candidates.length === 0 || !candidates.every(isListShaped)) return null;

  const lists = candidates as ListFileList[];
  const legacy = !lists.some(
    (l) => typeof l.version === "number" && l.version >= LIST_FILE_VERSION
  );
  return { lists, legacy };
};

export interface ResolvedListDevices {
  /** Real Intune ids, retained raw ids, and `missing:` sentinels, in file order */
  deviceIds: string[];
  /** Tokens that resolved to nothing at all, for the import review panel */
  unresolved: string[];
}

/**
 * Turn file entries into device ids against the currently loaded devices.
 *
 * v2 files resolve by device name then serial number, falling back to the stored id —
 * so a list survives a device being re-enrolled, renamed, or opened against another
 * tenant. v1 files deliberately stay **id-first**: they always wrote a `name`, often the
 * literal "Unknown", so matching on it first would silently change how existing files
 * import. The consequence is that a v1 file's dead ids stay dead; re-export it once to
 * get the newer behaviour.
 */
export const resolveListDevices = (
  entries: ListFileDevice[],
  devices: DeviceInfo[],
  options: { preferId: boolean }
): ResolvedListDevices => {
  const { preferId } = options;
  const loadedIds = new Set(devices.map((d) => d.id));

  const deviceIds: string[] = [];
  const seen = new Set<string>();
  const unresolved: string[] = [];

  const add = (ids: string[]) => {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      deviceIds.push(id);
    }
  };

  for (const entry of entries) {
    const name = entry.deviceName?.trim() || entry.name?.trim() || "";
    const serial = entry.serialNumber?.trim() || "";
    const id = entry.id?.trim() || "";

    // A v1 export wrote "Unknown" as a placeholder; it is a label, not an identifier
    const tokens = [name, serial].filter(
      (t) => t.length > 0 && (!preferId || t.toLowerCase() !== LEGACY_UNKNOWN_NAME)
    );

    const byMatch = (): string[] | null => {
      if (tokens.length === 0) return null;
      const { matchedIds } = matchIdentifiers(devices, tokens);
      return matchedIds.length > 0 ? matchedIds : null;
    };
    const byLoadedId = (): string[] | null => (id && loadedIds.has(id) ? [id] : null);
    // Keep an unrecognised id verbatim — it renders as a [Not found] row and resolves
    // by itself once the device shows up, with no sentinel needed
    const byRawId = (): string[] | null => (id ? [id] : null);

    const order = preferId
      ? [byLoadedId, byRawId, byMatch]
      : [byMatch, byLoadedId, byRawId];

    let resolved: string[] | null = null;
    for (const step of order) {
      resolved = step();
      if (resolved) break;
    }

    if (resolved) {
      add(resolved);
      continue;
    }

    // Derive the sentinel from `tokens`, not from the raw fields, so a v1 entry whose
    // only label is the "Unknown" placeholder is dropped rather than turned into a
    // device that never existed
    const token = tokens[0] ?? "";
    if (token) {
      add([`${MISSING_PREFIX}${token}`]);
      unresolved.push(token);
    }
  }

  return { deviceIds, unresolved };
};
