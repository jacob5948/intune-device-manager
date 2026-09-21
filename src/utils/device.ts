import type { DeviceInfo } from "../types";
import {
  mdiMicrosoftWindows,
  mdiApple,
  mdiAndroid,
  mdiLinux,
  mdiLaptop,
} from "@mdi/js";

/** Normalize OS string from Graph API into a consistent category */
export const normalizeOs = (os: string | null): string => {
  if (!os) return "Other";
  const lower = os.toLowerCase();
  if (lower.includes("windows")) return "Windows";
  if (lower.includes("macos") || lower.includes("mac os")) return "macOS";
  if (lower.includes("ios") || lower.includes("iphone") || lower.includes("ipad")) return "iOS";
  if (lower.includes("android")) return "Android";
  if (lower.includes("linux")) return "Linux";
  return "Other";
};

/** Check if a device is Windows */
export const isWindows = (device: DeviceInfo) => normalizeOs(device.operatingSystem) === "Windows";

/** Get the MDI icon path for a device's OS */
export const getOsIcon = (os: string | null): string => {
  const normalized = normalizeOs(os);
  switch (normalized) {
    case "Windows": return mdiMicrosoftWindows;
    case "macOS":
    case "iOS": return mdiApple;
    case "Android": return mdiAndroid;
    case "Linux": return mdiLinux;
    default: return mdiLaptop;
  }
};

/** Extract OU group from device name (format: "OU-SOMETHING") */
export const extractOu = (deviceName: string): string => {
  const dashIdx = deviceName.indexOf("-");
  if (dashIdx > 0 && dashIdx < deviceName.length - 1) {
    return deviceName.substring(0, dashIdx).toUpperCase();
  }
  return "Other";
};

/** Format a date string for display */
export const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleString();
};

/** Format relative time since a date (e.g., "5m ago", "2h ago") */
export const relativeTime = (dateStr: string | null): string => {
  if (!dateStr) return "Never";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "Just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
};

/** Which device field a plain identifier list is built from */
export type IdentifierField = "deviceName" | "serialNumber";

export interface ParseIdentifiersOptions {
  /**
   * Split on line breaks only (then on , and ; within a line that has them),
   * so a device name containing a space survives. Used for CSV columns and file
   * input, where each row is already one identifier.
   */
  perLine?: boolean;
}

/**
 * Split pasted or file text into device identifiers (names or serial numbers).
 *
 * By default accepts newline-, comma-, semicolon- and whitespace-separated input, so an
 * Excel column paste and a comma-separated line both work — at the cost of never being
 * able to read a name with a space in it. `perLine` trades that away for structured
 * input. De-duplicates case-insensitively, keeping the first-seen casing.
 */
export const parseIdentifiers = (
  text: string,
  options: ParseIdentifiersOptions = {}
): string[] => {
  const { perLine = false } = options;
  // A BOM survives trimming and would corrupt the first token of our own exports
  const body = text.replace(/^\uFEFF/, "");
  const candidates = perLine
    ? body.split(/\r?\n/).flatMap((line) => (/[,;]/.test(line) ? line.split(/[,;]/) : [line]))
    : body.split(/[\s,;]+/);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of candidates) {
    const token = raw.trim().replace(/^["']|["']$/g, "").trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(token);
  }
  return result;
};

export interface IdentifierListResult {
  /** One identifier per line, CRLF terminated and with no BOM; empty when nothing qualified */
  text: string;
  written: number;
  /** Devices with nothing in the chosen field, and so nothing to write */
  skipped: number;
}

/**
 * Render devices as a bare identifier list — the re-importable counterpart to the
 * detail CSV, and the inverse of `parseIdentifiers`.
 *
 * `extraTokens` carries the raw tokens of list entries that were never found in Intune,
 * so exporting and re-importing a partially-unmatched list preserves it intact rather
 * than quietly dropping the gaps.
 *
 * Deliberately no BOM: `parseIdentifiers` would fold it into the first identifier.
 */
export const buildIdentifierList = (
  devices: DeviceInfo[],
  field: IdentifierField,
  extraTokens: string[] = []
): IdentifierListResult => {
  const seen = new Set<string>();
  const values: string[] = [];
  let skipped = 0;

  const push = (value: string): boolean => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    values.push(value);
    return true;
  };

  for (const device of devices) {
    const value = (field === "deviceName" ? device.deviceName : device.serialNumber)?.trim() ?? "";
    if (!value) {
      skipped++;
      continue;
    }
    push(value);
  }

  for (const token of extraTokens) {
    const value = token.trim();
    if (value) push(value);
  }

  return {
    text: values.length > 0 ? values.join("\r\n") + "\r\n" : "",
    written: values.length,
    skipped,
  };
};

/**
 * Match identifiers against devices by device name first, then serial number.
 * A serial can map to more than one managed device (re-enrolled hardware), so every
 * hit is kept; ids are de-duplicated across the whole batch.
 */
export const matchIdentifiers = (
  devices: DeviceInfo[],
  tokens: string[]
): { matchedIds: string[]; unmatched: string[] } => {
  const byName = new Map<string, DeviceInfo[]>();
  const bySerial = new Map<string, DeviceInfo[]>();
  const push = (map: Map<string, DeviceInfo[]>, key: string | null, device: DeviceInfo) => {
    if (!key) return;
    const k = key.trim().toLowerCase();
    if (!k) return;
    const existing = map.get(k);
    if (existing) existing.push(device);
    else map.set(k, [device]);
  };
  for (const device of devices) {
    push(byName, device.deviceName, device);
    push(bySerial, device.serialNumber, device);
  }

  const matchedIds: string[] = [];
  const seenIds = new Set<string>();
  const unmatched: string[] = [];

  for (const token of tokens) {
    const key = token.toLowerCase();
    const hits = byName.get(key) ?? bySerial.get(key);
    if (!hits) {
      unmatched.push(token);
      continue;
    }
    for (const device of hits) {
      if (seenIds.has(device.id)) continue;
      seenIds.add(device.id);
      matchedIds.push(device.id);
    }
  }

  return { matchedIds, unmatched };
};
