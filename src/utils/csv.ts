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
 * Drop a leading UTF-8 BOM.
 *
 * Our own CSV export writes one so Excel behaves, and `parseIdentifiers` does not
 * strip it — so without this the first identifier of a re-imported file comes back
 * as "\uFEFF7XKQ2H3" and matches nothing.
 */
export const stripBom = (value: string): string => value.replace(/^\uFEFF/, "");

const nonBlankLines = (contents: string): string[] =>
  contents.split(/\r?\n/).filter((l) => l.trim().length > 0);

/** Header cells lowercased with quotes stripped, for pattern matching only */
const normalizeHeaderCells = (cells: string[]): string[] =>
  cells.map((h, i) => (i === 0 ? stripBom(h) : h).trim().toLowerCase().replace(/['"]/g, ""));

const findHeaderColumn = (normalized: string[], patterns: RegExp[]): number =>
  normalized.findIndex((h) => patterns.some((p) => p.test(h)));

// ── Identifier sources (import) ──

/** A delimited file broken into a header and rows, ready for a column to be picked out */
export interface CsvIdentifierSource {
  /** Header cells as written, for display in a column picker */
  headers: string[];
  rows: string[][];
  /** Column whose header names a serial or a device name, or null when neither is present */
  autoColumn: number | null;
}

/**
 * Parse a multi-column delimited file so a caller can pick the identifier column.
 *
 * Returns null when there is no table to speak of — fewer than two non-blank lines,
 * or a single column — in which case the content is just a list of tokens.
 */
export const analyzeCsvIdentifiers = (contents: string): CsvIdentifierSource | null => {
  const lines = nonBlankLines(contents);
  if (lines.length < 2) return null;

  const cells = parseCsvLine(lines[0]);
  if (cells.length < 2) return null;

  const normalized = normalizeHeaderCells(cells);
  const serial = findHeaderColumn(normalized, SERIAL_HEADERS);
  const name = findHeaderColumn(normalized, NAME_HEADERS);

  return {
    headers: cells.map((h, i) =>
      (i === 0 ? stripBom(h) : h).trim().replace(/^["']|["']$/g, "")
    ),
    rows: lines.slice(1).map((line) => parseCsvLine(line).map((c) => c.trim())),
    autoColumn: serial >= 0 ? serial : name >= 0 ? name : null,
  };
};

/**
 * Best guess at which column holds identifiers when no header names one.
 *
 * Scores each column on how identifier-shaped its values are and returns the best,
 * leftmost winning ties. Callers must tell the user this was a guess — the point is
 * to give the column picker a sensible default, not to be trusted silently.
 */
export const guessIdentifierColumn = (src: CsvIdentifierSource): number => {
  const columnCount = Math.max(src.headers.length, ...src.rows.map((r) => r.length), 1);
  let best = 0;
  let bestScore = -Infinity;

  for (let col = 0; col < columnCount; col++) {
    const values = src.rows.map((r) => r[col]?.trim() ?? "").filter((v) => v.length > 0);
    if (values.length === 0) continue;

    const filled = values.length / src.rows.length;
    const distinct = new Set(values.map((v) => v.toLowerCase())).size / values.length;
    const identifierish =
      values.filter((v) => /^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/.test(v)).length / values.length;
    // A UPN column is dense and distinct but never what we want; dates and bare
    // counters are likewise plausible-looking noise.
    const penalty =
      (values.some((v) => v.includes("@")) ? 1 : 0) +
      (values.filter((v) => /^\d+$/.test(v)).length / values.length > 0.8 ? 0.5 : 0) +
      (values.filter((v) => /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v)).length /
        values.length >
      0.5
        ? 1
        : 0);

    const score = filled + distinct + identifierish * 2 - penalty * 2;
    if (score > bestScore) {
      bestScore = score;
      best = col;
    }
  }

  return best;
};

/**
 * Pull one column out as newline-separated identifiers.
 *
 * One value per row, so a device name containing a space survives — unlike the
 * whitespace tokenizing `parseIdentifiers` applies to free text by default.
 */
export const identifierColumnText = (src: CsvIdentifierSource, column: number): string =>
  src.rows
    .map((row) => row[column]?.trim() ?? "")
    .filter((v) => v.length > 0)
    .join("\n");

/**
 * Pull device identifiers out of a text or CSV file.
 *
 * When the first line looks like a CSV header containing a serial/service-tag (or
 * device-name) column, only that column is returned — so a Dell TechDirect export can
 * be used as-is. A multi-column file with no recognizable header is returned unchanged;
 * callers that can offer a column picker should use `analyzeCsvIdentifiers` directly
 * rather than token-splitting the whole table.
 */
export const extractIdentifierText = (contents: string): string => {
  const table = analyzeCsvIdentifiers(contents);
  if (table) {
    return table.autoColumn === null
      ? contents
      : identifierColumnText(table, table.autoColumn);
  }

  // Single column: drop the first line if it is a header rather than an identifier
  const lines = nonBlankLines(contents);
  if (lines.length < 2) return contents;
  const normalized = normalizeHeaderCells(parseCsvLine(lines[0]));
  const isHeader =
    findHeaderColumn(normalized, SERIAL_HEADERS) >= 0 ||
    findHeaderColumn(normalized, NAME_HEADERS) >= 0;
  return isHeader ? lines.slice(1).join("\n") : contents;
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

export interface DeviceCsvOptions {
  /** Prepend a UTF-8 BOM. On for files so Excel behaves, off for the clipboard. */
  bom?: boolean;
}

/**
 * Render devices as an RFC 4180 CSV with the given columns, in CSV_COLUMNS order.
 * A UTF-8 BOM is prepended by default so Excel picks up non-ASCII device names
 * correctly; pasted into a text field a BOM instead shows as junk, so the clipboard
 * path turns it off.
 */
export const buildDeviceCsv = (
  devices: DeviceInfo[],
  columnKeys: string[],
  options: DeviceCsvOptions = {}
): string => {
  const { bom = true } = options;
  const selected = new Set(columnKeys);
  const columns = CSV_COLUMNS.filter((c) => selected.has(c.key));
  const rows = [
    columns.map((c) => csvField(c.label)),
    ...devices.map((d) => columns.map((c) => csvField(c.value(d)))),
  ];
  return (bom ? "\uFEFF" : "") + rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
};
