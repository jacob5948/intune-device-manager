import type { DeviceInfo } from "../types";
import { normalizeOs, extractOu, formatDate, relativeTime } from "./device";

/** Split a single CSV line into fields, honouring quoted fields and "" escapes */
export const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
};

const SERIAL_HEADERS = [/serial/, /service\s*tag/, /asset\s*tag/];
const NAME_HEADERS = [/device\s*name/, /computer\s*name/, /host\s*name/, /^name$/];

/**
 * Pull device identifiers out of a text or CSV file.
 *
 * When the first line looks like a CSV header containing a serial/service-tag (or
 * device-name) column, only that column is returned — so a Dell TechDirect export can be
 * used as-is. Otherwise the whole file is returned for token-splitting.
 */
export const extractIdentifierText = (contents: string): string => {
  const lines = contents.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return contents;

  const header = parseCsvLine(lines[0]).map((h) =>
    h.trim().toLowerCase().replace(/['"]/g, "")
  );

  const findCol = (patterns: RegExp[]) =>
    header.findIndex((h) => patterns.some((p) => p.test(h)));

  if (header.length < 2) {
    // Single column: drop the first line if it is a header rather than an identifier
    const isHeader = findCol(SERIAL_HEADERS) >= 0 || findCol(NAME_HEADERS) >= 0;
    return isHeader ? lines.slice(1).join("\n") : contents;
  }

  const col = (() => {
    const serial = findCol(SERIAL_HEADERS);
    return serial >= 0 ? serial : findCol(NAME_HEADERS);
  })();
  if (col < 0) return contents;

  return lines
    .slice(1)
    .map((line) => parseCsvLine(line)[col]?.trim() ?? "")
    .filter((v) => v.length > 0)
    .join("\n");
};

// ── CSV export ──

/** One selectable column in the device CSV export */
export interface CsvColumn {
  key: string;
  label: string;
  value: (device: DeviceInfo) => string;
}

/**
 * Every column offered by the export dialog, in the order they are written.
 * `key` is persisted in localStorage, so renaming one drops it from saved selections.
 */
export const CSV_COLUMNS: CsvColumn[] = [
  { key: "deviceName", label: "Device Name", value: (d) => d.deviceName },
  { key: "userPrincipalName", label: "User", value: (d) => d.userPrincipalName ?? "" },
  { key: "serialNumber", label: "Serial Number", value: (d) => d.serialNumber ?? "" },
  { key: "operatingSystem", label: "Operating System", value: (d) => d.operatingSystem ?? "" },
  { key: "osCategory", label: "OS Category", value: (d) => normalizeOs(d.operatingSystem) },
  { key: "osVersion", label: "OS Version", value: (d) => d.osVersion ?? "" },
  { key: "complianceState", label: "Compliance State", value: (d) => d.complianceState ?? "" },
  { key: "managementState", label: "Management State", value: (d) => d.managementState ?? "" },
  { key: "lastSyncDateTime", label: "Last Sync", value: (d) => (d.lastSyncDateTime ? formatDate(d.lastSyncDateTime) : "") },
  { key: "lastSyncRelative", label: "Last Sync (relative)", value: (d) => relativeTime(d.lastSyncDateTime) },
  { key: "ou", label: "OU Group", value: (d) => extractOu(d.deviceName) },
  { key: "id", label: "Intune Device ID", value: (d) => d.id },
];

/** Columns pre-ticked the first time the export dialog is opened */
export const DEFAULT_CSV_COLUMN_KEYS = [
  "deviceName",
  "userPrincipalName",
  "serialNumber",
  "operatingSystem",
  "osVersion",
  "complianceState",
  "lastSyncDateTime",
];

/** Quote a field when it contains a delimiter, quote, newline, or padding whitespace */
const csvField = (value: string): string =>
  /[",\r\n]/.test(value) || value !== value.trim()
    ? `"${value.replace(/"/g, '""')}"`
    : value;

/**
 * Render devices as an RFC 4180 CSV with the given columns, in CSV_COLUMNS order.
 * A UTF-8 BOM is prepended so Excel picks up non-ASCII device names correctly.
 */
export const buildDeviceCsv = (devices: DeviceInfo[], columnKeys: string[]): string => {
  const selected = new Set(columnKeys);
  const columns = CSV_COLUMNS.filter((c) => selected.has(c.key));
  const rows = [
    columns.map((c) => csvField(c.label)),
    ...devices.map((d) => columns.map((c) => csvField(c.value(d)))),
  ];
  return "\uFEFF" + rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
};
