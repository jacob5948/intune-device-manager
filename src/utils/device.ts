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
