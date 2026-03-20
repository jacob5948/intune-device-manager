import type { RemediationScript, DeviceList, DeviceListFolder } from "../types";

const SCRIPTS_KEY = "remediationScripts";
const LISTS_KEY = "deviceLists";
const FOLDERS_KEY = "deviceListFolders";

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
