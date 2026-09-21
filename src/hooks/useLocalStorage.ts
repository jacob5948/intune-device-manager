import type { RemediationScript, DeviceList, DeviceListFolder } from "../types";
import { CSV_COLUMNS, DEFAULT_CSV_COLUMN_KEYS } from "../utils/csv";
import type { IdentifierField } from "../utils/device";
import type { ExportFormat } from "../utils/exportPayload";

const SCRIPTS_KEY = "remediationScripts";
const LISTS_KEY = "deviceLists";
const FOLDERS_KEY = "deviceListFolders";
const CSV_COLUMNS_KEY = "csvExportColumns";
const IDENTIFIER_FIELD_KEY = "exportIdentifierField";
const EXPORT_FORMAT_KEY = "exportFormat";

export const loadSavedLists = (): DeviceList[] => {
  try {
    const raw = localStorage.getItem(LISTS_KEY);
    if (!raw) return [];
    const parsed: DeviceList[] = JSON.parse(raw);
    // Migrate old lists that don't have an order field, and normalize
    const migrated = parsed.map((l, i) => ({
      ...l,
      order: l.order ?? i,
      folderId: l.folderId ?? null,
    }));
    // Normalize orders per folder to ensure no duplicates
    const byFolder = new Map<string | null, DeviceList[]>();
    for (const l of migrated) {
      const key = l.folderId ?? null;
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(l);
    }
    const result: DeviceList[] = [];
    for (const [, lists] of byFolder) {
      lists.sort((a, b) => a.order - b.order);
      lists.forEach((l, i) => result.push({ ...l, order: i }));
    }
    return result;
  } catch {
    return [];
  }
};

export const saveLists = (lists: DeviceList[]) => {
  localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
};

export const loadSavedFolders = (): DeviceListFolder[] => {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const saveFolders = (folders: DeviceListFolder[]) => {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
};

export const loadSavedScripts = (): RemediationScript[] => {
  try {
    const raw = localStorage.getItem(SCRIPTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const saveScripts = (scripts: RemediationScript[]) => {
  localStorage.setItem(SCRIPTS_KEY, JSON.stringify(scripts));
};

/** Columns last used for a CSV export, falling back to the defaults */
export const loadCsvColumns = (): string[] => {
  try {
    const raw = localStorage.getItem(CSV_COLUMNS_KEY);
    if (!raw) return DEFAULT_CSV_COLUMN_KEYS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CSV_COLUMN_KEYS;
    // Drop keys from older versions so a stale entry cannot leave the dialog empty
    const known = new Set(CSV_COLUMNS.map((c) => c.key));
    const valid = parsed.filter((k): k is string => typeof k === "string" && known.has(k));
    return valid.length > 0 ? valid : DEFAULT_CSV_COLUMN_KEYS;
  } catch {
    return DEFAULT_CSV_COLUMN_KEYS;
  }
};

export const saveCsvColumns = (keys: string[]) => {
  localStorage.setItem(CSV_COLUMNS_KEY, JSON.stringify(keys));
};

/** Which field the last plain-list export used */
export const loadIdentifierField = (): IdentifierField => {
  const raw = localStorage.getItem(IDENTIFIER_FIELD_KEY);
  return raw === "serialNumber" || raw === "deviceName" ? raw : "serialNumber";
};

export const saveIdentifierField = (field: IdentifierField) => {
  localStorage.setItem(IDENTIFIER_FIELD_KEY, field);
};

/** Format the export dialog last used, so the common case is one click */
export const loadExportFormat = (): ExportFormat => {
  const raw = localStorage.getItem(EXPORT_FORMAT_KEY);
  return raw === "csv" || raw === "plain" || raw === "lists" ? raw : "csv";
};

export const saveExportFormat = (format: ExportFormat) => {
  localStorage.setItem(EXPORT_FORMAT_KEY, format);
};
