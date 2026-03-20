/** Device info from MS Graph managedDevices endpoint */
export interface DeviceInfo {
  id: string;
  deviceName: string;
  userPrincipalName: string | null;
  operatingSystem: string | null;
  osVersion: string | null;
  complianceState: string | null;
  lastSyncDateTime: string | null;
  managementState: string | null;
}

/** Locally-configured remediation script */
export interface RemediationScript {
  id: string;
  displayName: string;
}

/** Folder for organizing device lists */
export interface DeviceListFolder {
  id: string;
  name: string;
  order: number;
}

/** Custom device list saved in localStorage */
export interface DeviceList {
  id: string;
  name: string;
  deviceIds: string[];
  folderId?: string | null;
  order: number;
}

/** Toast notification */
export interface Toast {
  message: string;
  type: "success" | "error" | "info";
  progress?: { current: number; total: number };
}

/** OS tab categories */
export const OS_TABS = ["All", "Windows", "macOS", "iOS", "Android", "Linux"] as const;
export type OsTab = (typeof OS_TABS)[number];
