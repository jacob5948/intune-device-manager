import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import Icon from "@mdi/react";
import {
  mdiDevices,
  mdiChevronDown,
  mdiChevronRight,
  mdiCog,
  mdiPlus,
  mdiDelete,
  mdiSync,
  mdiRestart,
  mdiScriptTextPlay,
  mdiClose,
  mdiPlaylistPlus,
  mdiFormatListBulleted,
  mdiPlaylistRemove,
  mdiImport,
  mdiExport,
  mdiSelectAll,
  mdiSelectionOff,
  mdiPencil,
  mdiFolder,
  mdiFolderOpen,
  mdiFolderPlus,
  mdiSwapVertical,
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiCellphoneRemove,
} from "@mdi/js";
import "./App.css";
import type { DeviceInfo, RemediationScript, DeviceList, DeviceListFolder, Toast } from "./types";
import { loadSavedLists, saveLists, loadSavedFolders, saveFolders, loadSavedScripts, saveScripts } from "./hooks/useLocalStorage";
import { normalizeOs, isWindows, getOsIcon, extractOu, formatDate, matchIdentifiers } from "./utils/device";
import type { ExportScope } from "./utils/exportPayload";
import { useAppUpdate } from "./hooks/useAppUpdate";
import DeviceItem from "./components/DeviceItem";
import UpdateBanner from "./components/UpdateBanner";
import AutopilotView from "./components/AutopilotView";
import ImportModal, { type ImportPlan } from "./components/ImportModal";
import ExportModal from "./components/ExportModal";


function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tenantId, setTenantId] = useState(localStorage.getItem("tenantId") || "");
  const [clientId, setClientId] = useState(localStorage.getItem("clientId") || "");
  const [clientSecret, setClientSecret] = useState("");
  const [saveSecret, setSaveSecret] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<DeviceInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("All");
  const [loading, setLoading] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showRemediation, setShowRemediation] = useState(false);
  const [scripts, setScripts] = useState<RemediationScript[]>(loadSavedScripts);
  const [selectedScript, setSelectedScript] = useState<RemediationScript | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [checkedDevices, setCheckedDevices] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState<{ targets: DeviceInfo[]; input: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope | null>(null);
  /** List offered as an export scope — the right-clicked one, else the active one */
  const [exportListId, setExportListId] = useState<string | null>(null);
  const [newScriptId, setNewScriptId] = useState("");
  const [newScriptName, setNewScriptName] = useState("");
  const [deviceLists, setDeviceLists] = useState<DeviceList[]>(loadSavedLists);
  const [activeList, setActiveList] = useState<string | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [listContextMenu, setListContextMenu] = useState<{ listId: string; x: number; y: number } | null>(null);
  const [renamingList, setRenamingList] = useState<{ id: string; name: string } | null>(null);
  const [listFolders, setListFolders] = useState<DeviceListFolder[]>(loadSavedFolders);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<{ id: string; name: string } | null>(null);
  const [checkedLists, setCheckedLists] = useState<Set<string>>(new Set());
  const [reorderMode, setReorderMode] = useState(false);
  const [activeView, setActiveView] = useState<"devices" | "autopilot">("devices");

  const update = useAppUpdate();

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: Toast["type"], progress?: { current: number; total: number }) => {
    if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null; }
    setToast({ message, type, progress });
    // "info" toasts persist until replaced by success/error
    if (type !== "info") {
      toastTimer.current = setTimeout(() => setToast(null), 4000);
    }
  }, []);

  const updateProgress = useCallback((label: string, current: number, total: number) => {
    setToast({ message: `${label} (${current}/${total})`, type: "info", progress: { current, total } });
  }, []);

  // Load saved secret from keychain on mount
  useEffect(() => {
    const loadSecret = async () => {
      try {
        const savedClientId = localStorage.getItem("clientId");
        if (savedClientId) {
          const secret = await invoke<string | null>("load_secret", { account: savedClientId });
          if (secret) {
            setClientSecret(secret);
            setSaveSecret(true);
          }
        }
      } catch {
        // Keychain not available or no entry, ignore
      }
    };
    loadSecret();
  }, []);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<DeviceInfo[]>("get_devices");
      setDevices(result);
    } catch (e) {
      showToast(`Failed to load devices: ${e}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // Re-evaluate "missing:" entries in device lists when devices are refreshed
  useEffect(() => {
    if (devices.length === 0) return;
    const hasMissing = deviceLists.some((l) => l.deviceIds.some((id) => id.startsWith("missing:")));
    if (!hasMissing) return;

    let changed = false;

    const updated = deviceLists.map((list) => {
      // flatMap, not map: a serial can belong to several managed devices after a
      // re-enrolment, and matchIdentifiers returns every one of them
      const seen = new Set<string>();
      const newIds = list.deviceIds.flatMap((id) => {
        if (!id.startsWith("missing:")) return [id];
        const token = id.substring(8);
        // Matches on device name first, then serial — the name-only lookup this
        // replaced meant a serial-imported entry could never heal
        const { matchedIds } = matchIdentifiers(devices, [token]);
        if (matchedIds.length === 0) return [id];
        changed = true;
        return matchedIds;
      });
      return { ...list, deviceIds: newIds.filter((id) => !seen.has(id) && seen.add(id)) };
    });

    if (changed) {
      setDeviceLists(updated);
      saveLists(updated);
    }
  }, [devices]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = async () => {
    if (!tenantId || !clientId || !clientSecret) {
      showToast("Please fill in all fields", "error");
      return;
    }

    localStorage.setItem("tenantId", tenantId);
    localStorage.setItem("clientId", clientId);

    // Save or delete secret from keychain
    if (saveSecret) {
      try {
        await invoke("save_secret", { account: clientId, secret: clientSecret });
      } catch (e) {
        console.warn("Failed to save secret to keychain:", e);
      }
    } else {
      try {
        await invoke("delete_secret", { account: clientId });
      } catch {
        // ignore
      }
    }

    setLoggingIn(true);
    try {
      await invoke("login", {
        tenantId,
        clientId,
        clientSecret,
      });
      setIsAuthenticated(true);
      showToast("Authenticated successfully", "success");
      loadDevices();
    } catch (e) {
      showToast(`Authentication failed: ${e}`, "error");
    } finally {
      setLoggingIn(false);
    }
  };

  const handleSelectDevice = useCallback((device: DeviceInfo) => {
    setSelectedDevice(device);
    // Fetch updated device info in the background
    invoke<DeviceInfo>("get_device", { deviceId: device.id })
      .then((updated) => {
        // Update the device in the devices list
        setDevices((prev) =>
          prev.map((d) => (d.id === updated.id ? updated : d))
        );
        // Update selectedDevice only if this device is still selected
        setSelectedDevice((prev) =>
          prev?.id === updated.id ? updated : prev
        );
      })
      .catch(() => {
        // Silently ignore — stale data is still shown
      });
  }, []);

  const handleSync = async (device: DeviceInfo) => {
    showToast(`Syncing ${device.deviceName}...`, "info");
    try {
      await invoke("sync_device", { deviceId: device.id });
      showToast(`Sync initiated for ${device.deviceName}`, "success");
    } catch (e) {
      showToast(`Sync failed: ${e}`, "error");
    }
  };

  const handleRestart = async (device: DeviceInfo) => {
    if (!(await confirm(`Are you sure you want to restart ${device.deviceName}?`))) return;
    showToast(`Restarting ${device.deviceName}...`, "info");
    try {
      await invoke("restart_device", { deviceId: device.id });
      showToast(`Restart initiated for ${device.deviceName}`, "success");
    } catch (e) {
      showToast(`Restart failed: ${e}`, "error");
    }
  };

  // ── Wipe (factory reset) ──
  const wipePhrase = (count: number) =>
    `I really want to wipe ${count} device${count === 1 ? "" : "s"}`;

  const promptWipe = (targets: DeviceInfo[]) => {
    if (targets.length === 0) return;
    setWipeConfirm({ targets, input: "" });
  };

  const executeWipe = async () => {
    if (!wipeConfirm) return;
    const targets = wipeConfirm.targets;
    if (wipeConfirm.input !== wipePhrase(targets.length)) return;
    setWipeConfirm(null);
    if (!(await confirmLargeBatch(targets.length, "wipe"))) return;

    if (targets.length === 1) {
      showToast(`Wiping ${targets[0].deviceName}...`, "info");
      try {
        await invoke("wipe_device", { deviceId: targets[0].id });
        showToast(`Wipe initiated for ${targets[0].deviceName}`, "success");
      } catch (e) {
        showToast(`Wipe failed: ${e}`, "error");
      }
      return;
    }

    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
      updateProgress("Wiping", i + 1, targets.length);
      try {
        await invoke("wipe_device", { deviceId: targets[i].id });
        ok++;
      } catch {
        fail++;
      }
    }
    showToast(`Wipe: ${ok} succeeded, ${fail} failed`, ok > 0 ? "success" : "error");
    clearChecked();
  };

  const openRemediationModal = () => {
    if (scripts.length === 0) {
      showToast("No remediation scripts configured. Add them in Settings.", "info");
      setShowSettings(true);
      return;
    }
    setShowRemediation(true);
  };

  const addScript = () => {
    const id = newScriptId.trim();
    const name = newScriptName.trim();
    if (!id || !name) {
      showToast("Both Script ID and Name are required", "error");
      return;
    }
    if (scripts.some((s) => s.id === id)) {
      showToast("A script with that ID already exists", "error");
      return;
    }
    const updated = [...scripts, { id, displayName: name }];
    setScripts(updated);
    saveScripts(updated);
    setNewScriptId("");
    setNewScriptName("");
    showToast(`Added "${name}"`, "success");
  };

  const removeScript = (id: string) => {
    const updated = scripts.filter((s) => s.id !== id);
    setScripts(updated);
    saveScripts(updated);
  };

  const createList = (addChecked = false) => {
    const name = newListName.trim();
    if (!name) { showToast("List name is required", "error"); return; }
    const deviceIds = addChecked ? [...checkedDevices] : [];
    const maxOrder = deviceLists.filter((l) => !l.folderId).reduce((m, l) => Math.max(m, l.order ?? 0), -1);
    const newList: DeviceList = { id: crypto.randomUUID(), name, deviceIds, folderId: null, order: maxOrder + 1 };
    const updated = [...deviceLists, newList];
    setDeviceLists(updated);
    saveLists(updated);
    setNewListName("");
    setShowNewList(false);
    if (addChecked && deviceIds.length > 0) {
      showToast(`Created list "${name}" with ${deviceIds.length} device(s)`, "success");
      clearChecked();
    } else {
      showToast(`Created list "${name}"`, "success");
    }
  };

  const deleteList = async (listId: string) => {
    const list = deviceLists.find((l) => l.id === listId);
    if (!(await confirm(`Delete list "${list?.name}"?`))) return;
    const updated = deviceLists.filter((l) => l.id !== listId);
    setDeviceLists(updated);
    saveLists(updated);
    if (activeList === listId) setActiveList(null);
  };

  const renameList = (id: string, newName: string) => {
    const name = newName.trim();
    if (!name) return;
    const updated = deviceLists.map((l) => l.id === id ? { ...l, name } : l);
    setDeviceLists(updated);
    saveLists(updated);
    setRenamingList(null);
    showToast(`Renamed to "${name}"`, "success");
  };

  const addCheckedToList = (listId: string) => {
    const updated = deviceLists.map((l) => {
      if (l.id !== listId) return l;
      const merged = new Set([...l.deviceIds, ...checkedDevices]);
      return { ...l, deviceIds: [...merged] };
    });
    setDeviceLists(updated);
    saveLists(updated);
    const list = updated.find((l) => l.id === listId);
    showToast(`Added ${checkedDevices.size} device(s) to "${list?.name}"`, "success");
    clearChecked();
  };

  const removeDevicesFromList = (listId: string, deviceIds: Set<string>) => {
    const updated = deviceLists.map((l) => {
      if (l.id !== listId) return l;
      return { ...l, deviceIds: l.deviceIds.filter((id) => !deviceIds.has(id)) };
    });
    setDeviceLists(updated);
    saveLists(updated);
  };

  // ── Import / export ──

  /** Apply what the import dialog resolved. All list mutation lives here, not in the modal. */
  const commitImport = (plan: ImportPlan, matched: number, unresolved: string[]) => {
    const baseOrder =
      deviceLists.filter((l) => !l.folderId).reduce((m, l) => Math.max(m, l.order ?? 0), -1) + 1;

    let updated: DeviceList[];
    let label: string;

    if (plan.kind === "restoreLists") {
      const restored: DeviceList[] = plan.lists.map((l, i) => ({
        id: crypto.randomUUID(),
        name: l.name,
        deviceIds: l.deviceIds,
        folderId: null,
        order: baseOrder + i,
        color: l.color ?? null,
      }));
      updated = [...deviceLists, ...restored];
      label = `${restored.length} list${restored.length === 1 ? "" : "s"}`;
    } else if (plan.kind === "existingList") {
      const target = deviceLists.find((l) => l.id === plan.listId);
      if (!target) {
        showToast("That list no longer exists", "error");
        return;
      }
      label = `"${target.name}"`;
      updated = deviceLists.map((l) =>
        l.id === target.id
          ? { ...l, deviceIds: [...new Set([...l.deviceIds, ...plan.deviceIds])] }
          : l
      );
    } else {
      label = `"${plan.name}"`;
      updated = [
        ...deviceLists,
        {
          id: crypto.randomUUID(),
          name: plan.name,
          deviceIds: plan.deviceIds,
          folderId: null,
          order: baseOrder,
        },
      ];
    }

    setDeviceLists(updated);
    saveLists(updated);

    const msg =
      unresolved.length > 0
        ? `${label}: ${matched} matched, ${unresolved.length} not found`
        : `${label}: ${matched} device${matched === 1 ? "" : "s"} imported`;
    showToast(msg, unresolved.length > 0 ? "info" : "success");
  };

  const openExport = (scope: ExportScope, listId: string | null) => {
    setExportListId(listId);
    setExportScope(scope);
  };

  // ── Folder management ──

  const createFolder = () => {
    const name = newFolderName.trim();
    if (!name) { showToast("Folder name is required", "error"); return; }
    const maxOrder = listFolders.reduce((m, f) => Math.max(m, f.order), -1);
    const folder: DeviceListFolder = { id: crypto.randomUUID(), name, order: maxOrder + 1 };
    const updated = [...listFolders, folder];
    setListFolders(updated);
    saveFolders(updated);
    setNewFolderName("");
    setShowNewFolder(false);
    setExpandedFolders((prev) => new Set([...prev, folder.id]));
    showToast(`Created folder "${name}"`, "success");
  };

  const renameFolder = (id: string, newName: string) => {
    const name = newName.trim();
    if (!name) return;
    const updated = listFolders.map((f) => f.id === id ? { ...f, name } : f);
    setListFolders(updated);
    saveFolders(updated);
    setRenamingFolder(null);
    showToast(`Renamed folder to "${name}"`, "success");
  };

  const deleteFolder = async (folderId: string) => {
    const folder = listFolders.find((f) => f.id === folderId);
    if (!(await confirm(`Delete folder "${folder?.name}"? Lists inside will be moved to the root.`))) return;
    // Move lists out of folder
    const updatedLists = deviceLists.map((l) => l.folderId === folderId ? { ...l, folderId: null } : l);
    setDeviceLists(updatedLists);
    saveLists(updatedLists);
    const updatedFolders = listFolders.filter((f) => f.id !== folderId);
    setListFolders(updatedFolders);
    saveFolders(updatedFolders);
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // ── List reordering ──

  const moveList = (listId: string, direction: "up" | "down") => {
    const list = deviceLists.find((l) => l.id === listId);
    if (!list) return;
    const folderId = list.folderId;
    // Get siblings sorted, then normalize their orders first to avoid duplicates
    const siblings = deviceLists
      .filter((l) => (folderId ? l.folderId === folderId : !l.folderId))
      .sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex((l) => l.id === listId);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;

    // Normalize orders first, then swap
    siblings.forEach((l, i) => { l.order = i; });
    const tmp = siblings[idx].order;
    siblings[idx].order = siblings[swapIdx].order;
    siblings[swapIdx].order = tmp;

    // Build the order map and apply
    const orderMap = new Map(siblings.map((l) => [l.id, l.order]));
    const updated = deviceLists.map((l) =>
      orderMap.has(l.id) ? { ...l, order: orderMap.get(l.id)! } : l
    );
    setDeviceLists(updated);
    saveLists(updated);
  };

  const moveFolder = (folderId: string, direction: "up" | "down") => {
    const sorted = [...listFolders].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((f) => f.id === folderId);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    // Normalize then swap
    sorted.forEach((f, i) => { f.order = i; });
    const tmp = sorted[idx].order;
    sorted[idx].order = sorted[swapIdx].order;
    sorted[swapIdx].order = tmp;

    const orderMap = new Map(sorted.map((f) => [f.id, f.order]));
    const updated = listFolders.map((f) =>
      orderMap.has(f.id) ? { ...f, order: orderMap.get(f.id)! } : f
    );
    setListFolders(updated);
    saveFolders(updated);
  };

  // ── List selection for bulk actions ──

  const toggleListChecked = (listId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckedLists((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  };

  /** Previous count, so a deviceLists change is not mistaken for deselecting every list */
  const prevCheckedListCount = useRef(0);

  // When lists are checked/unchecked, sync device selection to match
  useEffect(() => {
    const previous = prevCheckedListCount.current;
    prevCheckedListCount.current = checkedLists.size;

    if (checkedLists.size === 0) {
      // Only clear when list selection was genuinely given up. deviceLists is a
      // dependency, so without this guard every list mutation — create, rename,
      // recolour, reorder, import — silently wiped the device selection.
      if (previous > 0) setCheckedDevices(new Set());
      return;
    }
    const allIds = new Set<string>();
    for (const listId of checkedLists) {
      const list = deviceLists.find((l) => l.id === listId);
      if (list) list.deviceIds.forEach((id) => allIds.add(id));
    }
    setCheckedDevices(allIds);
  }, [checkedLists, deviceLists]);

  // Computed: sorted folders and lists for rendering
  const sortedFolders = useMemo(
    () => [...listFolders].sort((a, b) => a.order - b.order),
    [listFolders]
  );

  const rootLists = useMemo(
    () => deviceLists.filter((l) => !l.folderId).sort((a, b) => a.order - b.order),
    [deviceLists]
  );

  const listsInFolder = useCallback(
    (folderId: string) => deviceLists.filter((l) => l.folderId === folderId).sort((a, b) => a.order - b.order),
    [deviceLists]
  );

  const getListWindowsDevices = (listId: string): DeviceInfo[] => {
    const list = deviceLists.find((l) => l.id === listId);
    if (!list) return [];
    const idSet = new Set(list.deviceIds);
    return devices.filter((d) => idSet.has(d.id) && isWindows(d));
  };

  const handleListSync = async (listId: string) => {
    const targets = getListWindowsDevices(listId);
    const list = deviceLists.find((l) => l.id === listId);
    if (targets.length === 0) { showToast("No Windows devices in this list", "error"); return; }
    if (!(await confirm(`Sync ${targets.length} Windows device(s) in "${list?.name}"?`))) return;
    if (!(await confirmLargeBatch(targets.length, "sync"))) return;
    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
      updateProgress("Syncing", i + 1, targets.length);
      try {
        await invoke("sync_device", { deviceId: targets[i].id });
        ok++;
      } catch { fail++; }
    }
    showToast(`Sync: ${ok} succeeded, ${fail} failed`, ok > 0 ? "success" : "error");
  };

  const handleListRestart = async (listId: string) => {
    const targets = getListWindowsDevices(listId);
    const list = deviceLists.find((l) => l.id === listId);
    if (targets.length === 0) { showToast("No Windows devices in this list", "error"); return; }
    if (!(await confirm(`Restart ${targets.length} Windows device(s) in "${list?.name}"? This cannot be undone.`))) return;
    if (!(await confirmLargeBatch(targets.length, "restart"))) return;
    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
      updateProgress("Restarting", i + 1, targets.length);
      try {
        await invoke("restart_device", { deviceId: targets[i].id });
        ok++;
      } catch { fail++; }
    }
    showToast(`Restart: ${ok} succeeded, ${fail} failed`, ok > 0 ? "success" : "error");
  };

  const handleListWipe = (listId: string) => {
    const targets = getListWindowsDevices(listId);
    if (targets.length === 0) { showToast("No Windows devices in this list", "error"); return; }
    promptWipe(targets);
  };

  const handleListRemediation = (listId: string) => {
    const targets = getListWindowsDevices(listId);
    if (targets.length === 0) { showToast("No Windows devices in this list", "error"); return; }
    // Select all windows devices in the list, then open remediation
    setCheckedDevices(new Set(targets.map((d) => d.id)));
    openRemediationModal();
  };

  const handleRunRemediation = async () => {
    if (!selectedScript) return;

    setShowRemediation(false);
    setSelectedScript(null);

    // Bulk mode: checked devices
    if (checkedWindowsDevices.length > 0) {
      if (!(await confirmLargeBatch(checkedWindowsDevices.length, "run remediation on"))) return;
      let ok = 0, fail = 0;
      const label = `Remediation "${selectedScript.displayName}"`;
      for (let i = 0; i < checkedWindowsDevices.length; i++) {
        updateProgress(label, i + 1, checkedWindowsDevices.length);
        try {
          await invoke("run_remediation", {
            scriptId: selectedScript.id,
            deviceId: checkedWindowsDevices[i].id,
          });
          ok++;
        } catch {
          fail++;
        }
      }
      showToast(
        `"${selectedScript.displayName}": ${ok} succeeded, ${fail} failed`,
        ok > 0 ? "success" : "error"
      );
      clearChecked();
    } else if (selectedDevice) {
      showToast(`Running "${selectedScript.displayName}" on ${selectedDevice.deviceName}...`, "info");
      try {
        await invoke("run_remediation", {
          scriptId: selectedScript.id,
          deviceId: selectedDevice.id,
        });
        showToast(
          `Remediation "${selectedScript.displayName}" triggered on ${selectedDevice.deviceName}`,
          "success"
        );
      } catch (e) {
        showToast(`Remediation failed: ${e}`, "error");
      }
    }
  };

  const handleLogout = async () => {
    try { await invoke("logout"); } catch { /* ignore */ }
    setIsAuthenticated(false);
    setDevices([]);
    setSelectedDevice(null);
    if (!saveSecret) setClientSecret("");
    setCheckedDevices(new Set());
  };

  const toggleChecked = useCallback((deviceId: string) => {
    setCheckedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }, []);

  const clearChecked = () => setCheckedDevices(new Set());

  const selectAllVisible = () => {
    // sortedDevices is computed from filteredDevices, so it respects all current filters
    setCheckedDevices((prev) => {
      const next = new Set(prev);
      for (const d of sortedDevices) {
        if (!d.deviceName.startsWith("[Not found]")) next.add(d.id);
      }
      return next;
    });
  };

  const deselectAllVisible = () => {
    const visibleIds = new Set(sortedDevices.map((d) => d.id));
    setCheckedDevices((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.delete(id);
      return next;
    });
  };

  const checkedList = useMemo(
    () => devices.filter((d) => checkedDevices.has(d.id)),
    [devices, checkedDevices]
  );


  const checkedWindowsDevices = useMemo(
    () => checkedList.filter((d) => isWindows(d)),
    [checkedList]
  );

  const LARGE_BATCH_THRESHOLD = 100;

  const confirmLargeBatch = async (count: number, action: string): Promise<boolean> => {
    if (count > LARGE_BATCH_THRESHOLD) {
      const secondConfirm = await confirm(
        `You are about to ${action} ${count} devices. This is a large operation. Are you absolutely sure?`
      );
      return secondConfirm;
    }
    return true;
  };

  const handleBulkSync = async () => {
    const targets = checkedWindowsDevices;
    if (targets.length === 0) return;
    if (!(await confirm(`Sync ${targets.length} Windows device(s)?`))) return;
    if (!(await confirmLargeBatch(targets.length, "sync"))) return;
    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
      updateProgress("Syncing", i + 1, targets.length);
      try {
        await invoke("sync_device", { deviceId: targets[i].id });
        ok++;
      } catch {
        fail++;
      }
    }
    showToast(`Sync: ${ok} succeeded, ${fail} failed`, ok > 0 ? "success" : "error");
    clearChecked();
  };

  const handleBulkRestart = async () => {
    const targets = checkedWindowsDevices;
    if (targets.length === 0) return;
    if (!(await confirm(`Restart ${targets.length} Windows device(s)? This cannot be undone.`))) return;
    if (!(await confirmLargeBatch(targets.length, "restart"))) return;
    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
      updateProgress("Restarting", i + 1, targets.length);
      try {
        await invoke("restart_device", { deviceId: targets[i].id });
        ok++;
      } catch {
        fail++;
      }
    }
    showToast(`Restart: ${ok} succeeded, ${fail} failed`, ok > 0 ? "success" : "error");
    clearChecked();
  };

  const handleBulkWipe = () => {
    promptWipe(checkedWindowsDevices);
  };

  const handleBulkRemediation = () => {
    if (checkedWindowsDevices.length === 0) return;
    openRemediationModal();
  };

  const OS_TABS = ["All", "Windows", "macOS", "iOS", "Android", "Linux"] as const;

  const tabIconPath = (tab: string): string => {
    if (tab === "All") return mdiDevices;
    return getOsIcon(tab);
  };

  const tabCounts = useMemo(() => devices.reduce<Record<string, number>>((acc, d) => {
    const os = normalizeOs(d.operatingSystem);
    acc[os] = (acc[os] || 0) + 1;
    acc["All"] = (acc["All"] || 0) + 1;
    return acc;
  }, {}), [devices]);

  const activeListObj = useMemo(
    () => activeList ? deviceLists.find((l) => l.id === activeList) : null,
    [activeList, deviceLists]
  );

  // Compute filtered counts per list (based on active OS tab)
  const listFilteredCounts = useMemo(() => {
    const counts: Record<string, { total: number; filtered: number; missing: number }> = {};
    const deviceIdSet = new Set(devices.map((d) => d.id));
    for (const list of deviceLists) {
      const idSet = new Set(list.deviceIds);
      const listDevices = devices.filter((d) => idSet.has(d.id));
      const missing = list.deviceIds.filter((id) => !deviceIdSet.has(id)).length;
      const filtered = activeTab === "All"
        ? listDevices.length
        : listDevices.filter((d) => normalizeOs(d.operatingSystem) === activeTab).length;
      counts[list.id] = { total: list.deviceIds.length, filtered, missing };
    }
    return counts;
  }, [deviceLists, devices, activeTab]);

  // Map device ID -> list tags (name + color) the device belongs to
  const deviceListMemberships = useMemo(() => {
    const map: Record<string, { name: string; color?: string | null }[]> = {};
    for (const list of deviceLists) {
      for (const deviceId of list.deviceIds) {
        if (!map[deviceId]) map[deviceId] = [];
        map[deviceId].push({ name: list.name, color: list.color });
      }
    }
    return map;
  }, [deviceLists]);

  const filteredDevices = useMemo(() => {
    let result = devices;

    // Filter by list if active
    if (activeListObj) {
      const idSet = new Set(activeListObj.deviceIds);
      const found = result.filter((d) => idSet.has(d.id));

      // Create placeholders for devices in the list but not found in Intune
      const foundIds = new Set(found.map((d) => d.id));
      const missing: DeviceInfo[] = activeListObj.deviceIds
        .filter((id) => !foundIds.has(id))
        .map((id) => ({
          id,
          deviceName: id.startsWith("missing:")
            ? `[Not found] ${id.substring(8)}`
            : `[Not found] ${id.substring(0, 8)}...`,
          userPrincipalName: null,
          serialNumber: null,
          operatingSystem: null,
          osVersion: null,
          complianceState: null,
          lastSyncDateTime: null,
          managementState: null,
        }));

      result = [...found, ...missing];
    }

    // Filter by OS tab
    if (activeTab !== "All") {
      result = result.filter((d) => normalizeOs(d.operatingSystem) === activeTab);
    }

    // Filter by search (supports comma-separated terms)
    if (searchQuery) {
      const terms = searchQuery
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);
      if (terms.length > 0) {
        result = result.filter((d) => {
          const name = d.deviceName.toLowerCase();
          const user = (d.userPrincipalName || "").toLowerCase();
          const serial = (d.serialNumber || "").toLowerCase();
          return terms.some((q) => name.includes(q) || user.includes(q) || serial.includes(q));
        });
      }
    }

    return result;
  }, [devices, activeTab, searchQuery, activeListObj]);

  const sortedDevices = useMemo(() => {
    return [...filteredDevices].sort((a, b) =>
      a.deviceName.localeCompare(b.deviceName, undefined, { sensitivity: "base" })
    );
  }, [filteredDevices]);

  /** Everything the export dialog needs to resolve a scope. The visible set drops the
   *  [Not found] placeholders, which carry no real device data. */
  const exportContext = useMemo(
    () => ({
      selected: checkedList,
      visible: sortedDevices.filter((d) => !d.deviceName.startsWith("[Not found]")),
      allDevices: devices,
      lists: deviceLists,
    }),
    [checkedList, sortedDevices, devices, deviceLists]
  );

  const groupedDevices = useMemo(() => {
    const groups = new Map<string, DeviceInfo[]>();
    for (const device of sortedDevices) {
      const ou = extractOu(device.deviceName);
      if (!groups.has(ou)) groups.set(ou, []);
      groups.get(ou)!.push(device);
    }
    // Sort groups alphabetically, but put "Other" last
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [sortedDevices]);

  const toggleGroup = (ou: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(ou)) next.delete(ou);
      else next.add(ou);
      return next;
    });
  };


  const complianceBadge = (state: string | null) => {
    const s = (state || "unknown").toLowerCase();
    if (s === "compliant") return <span className="badge compliant">Compliant</span>;
    if (s === "noncompliant") return <span className="badge noncompliant">Non-compliant</span>;
    return <span className="badge unknown">{state || "Unknown"}</span>;
  };

  // Render a single list item (used in both folder and root contexts)
  const renderListItem = (list: DeviceList) => {
    const counts = listFilteredCounts[list.id] || { total: 0, filtered: 0, missing: 0 };
    const showFiltered = activeTab !== "All" && counts.filtered !== counts.total;
    const isListChecked = checkedLists.has(list.id);
    return (
      <div
        key={list.id}
        className={`list-item${activeList === list.id ? " active" : ""}${isListChecked ? " list-checked" : ""}`}
        onClick={() => setActiveList(list.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setListContextMenu({ listId: list.id, x: e.clientX, y: e.clientY });
        }}
      >
        <div
          className="list-item-checkbox"
          onClick={(e) => toggleListChecked(list.id, e)}
          title={isListChecked ? "Deselect list for bulk actions" : "Select list for bulk actions"}
        >
          <Icon
            path={isListChecked ? mdiCheckboxMarked : mdiCheckboxBlankOutline}
            size={0.7}
          />
        </div>
        {list.color && (
          <span className="list-color-dot" style={{ background: list.color }} />
        )}
        <Icon path={mdiFormatListBulleted} size={0.6} className="list-item-icon" />
        {renamingList?.id === list.id ? (
          <input
            className="list-rename-input"
            value={renamingList.name}
            onChange={(e) => setRenamingList({ ...renamingList, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") renameList(list.id, renamingList.name);
              if (e.key === "Escape") setRenamingList(null);
            }}
            onBlur={() => renameList(list.id, renamingList.name)}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="list-item-name">{list.name}</span>
        )}
        <span className="list-item-count">
          {showFiltered ? `${counts.filtered}/${counts.total}` : counts.total}
          {counts.missing > 0 && (
            <span className="list-item-missing" title={`${counts.missing} device(s) not found in Intune`}>
              ⚠ {counts.missing}
            </span>
          )}
        </span>
        {reorderMode && (
          <div className="list-item-reorder">
            <button
              className="reorder-btn"
              onClick={(e) => { e.stopPropagation(); moveList(list.id, "up"); }}
              title="Move up"
            >
              <Icon path={mdiChevronRight} size={0.5} style={{ transform: "rotate(-90deg)" }} />
            </button>
            <button
              className="reorder-btn"
              onClick={(e) => { e.stopPropagation(); moveList(list.id, "down"); }}
              title="Move down"
            >
              <Icon path={mdiChevronRight} size={0.5} style={{ transform: "rotate(90deg)" }} />
            </button>
          </div>
        )}
        {!reorderMode && (
          <button
            className="list-item-delete"
            onClick={(e) => { e.stopPropagation(); deleteList(list.id); }}
            title="Delete list"
          >
            <Icon path={mdiClose} size={0.5} />
          </button>
        )}
      </div>
    );
  };

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="app">
        <div className="header">
          <h1>Intune Device Manager</h1>
        </div>
        <div className="login-screen">
          <h2>Sign In</h2>
          <p>
            Enter your Azure AD app registration credentials to connect to
            Microsoft Graph.
          </p>
          <div className="login-form">
            <input
              type="text"
              placeholder="Tenant ID"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            />
            <input
              type="text"
              placeholder="Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
            <input
              type="password"
              placeholder="Client Secret"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
            <label className="save-secret-label">
              <input
                type="checkbox"
                checked={saveSecret}
                onChange={(e) => setSaveSecret(e.target.checked)}
              />
              Save secret in keychain
            </label>
            <button
              className="btn-primary"
              onClick={handleLogin}
              disabled={loggingIn}
            >
              {loggingIn ? (
                <><span className="spinner" />Authenticating...</>
              ) : (
                "Sign In"
              )}
            </button>
          </div>
        </div>
        {toast && (
          <div className={`toast ${toast.type}`}>
            <span>{toast.message}</span>
            {toast.progress && (
              <div className="toast-progress">
                <div
                  className="toast-progress-bar"
                  style={{ width: `${(toast.progress.current / toast.progress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Loading screen (initial device load)
  if (loading && devices.length === 0) {
    return (
      <div className="app">
        <div className="header">
          <h1>Intune Device Manager</h1>
        </div>
        <div className="loading-screen">
          <span className="spinner dark large" />
          <p>Loading devices...</p>
        </div>
      </div>
    );
  }

  // Main app
  return (
    <div className="app">
      <UpdateBanner update={update} />
      <div className="header">
        <h1>Intune Device Manager</h1>
        <div className="header-actions">
          <div className="view-switcher">
            <button
              className={`view-switch-btn${activeView === "devices" ? " active" : ""}`}
              onClick={() => setActiveView("devices")}
            >
              <Icon path={mdiDevices} size={0.6} />
              Devices
            </button>
            <button
              className={`view-switch-btn${activeView === "autopilot" ? " active" : ""}`}
              onClick={() => setActiveView("autopilot")}
            >
              <Icon path={mdiSync} size={0.6} />
              Autopilot
            </button>
          </div>
          {activeView === "devices" && (
            <button
              className="btn-secondary btn-small"
              onClick={() => loadDevices()}
              disabled={loading}
            >
              {loading ? <><span className="spinner" />Refreshing...</> : "Refresh"}
            </button>
          )}
          <button
            className="btn-secondary btn-small btn-icon"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <Icon path={mdiCog} size={0.65} />
          </button>
          <button className="btn-secondary btn-small" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </div>

      {activeView === "devices" && (
      <div className="tab-bar">
        {OS_TABS.map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => { setActiveTab(tab); setSelectedDevice(null); }}
          >
            <Icon path={tabIconPath(tab)} size={0.6} />
            {tab}
            {(tabCounts[tab] ?? 0) > 0 && (
              <span className="tab-count">{tabCounts[tab]}</span>
            )}
          </button>
        ))}
      </div>
      )}

      <div style={{ display: activeView === "autopilot" ? "contents" : "none" }}>
        <AutopilotView showToast={showToast} updateProgress={updateProgress} isActive={activeView === "autopilot"} devices={devices} onNavigateToDevice={(deviceId: string) => {
          const device = devices.find(d => d.id === deviceId);
          if (device) {
            setActiveView("devices");
            setActiveTab("All");
            setActiveList(null);
            handleSelectDevice(device);
          }
        }} />
      </div>

      {activeView === "devices" && checkedDevices.size > 0 && (
        <div className="bulk-bar">
          <div className="bulk-left">
            <button className="bulk-close" onClick={clearChecked} title="Clear selection">
              <Icon path={mdiClose} size={0.6} />
            </button>
            <span className="bulk-info">
              {checkedDevices.size} selected
              {checkedWindowsDevices.length < checkedDevices.size && (
                <span className="bulk-note">
                  {" "}({checkedWindowsDevices.length} Windows)
                </span>
              )}
            </span>
          </div>
          <div className="bulk-actions-group">
            <button
              className="bulk-btn"
              onClick={handleBulkSync}
              disabled={checkedWindowsDevices.length === 0}
            >
              <Icon path={mdiSync} size={0.65} />
              <span>Sync</span>
            </button>
            <div className="bulk-divider" />
            <button
              className="bulk-btn"
              onClick={handleBulkRestart}
              disabled={checkedWindowsDevices.length === 0}
            >
              <Icon path={mdiRestart} size={0.65} />
              <span>Restart</span>
            </button>
            <div className="bulk-divider" />
            <button
              className="bulk-btn"
              onClick={handleBulkRemediation}
              disabled={checkedWindowsDevices.length === 0}
            >
              <Icon path={mdiScriptTextPlay} size={0.65} />
              <span>Run remediation</span>
            </button>
            <div className="bulk-divider" />
            <button
              className="bulk-btn"
              onClick={() => openExport({ kind: "selected" }, activeList)}
              disabled={checkedList.length === 0}
            >
              <Icon path={mdiExport} size={0.65} />
              <span>Export…</span>
            </button>
            <div className="bulk-divider" />
            <button
              className="bulk-btn bulk-btn-danger"
              onClick={handleBulkWipe}
              disabled={checkedWindowsDevices.length === 0}
            >
              <Icon path={mdiCellphoneRemove} size={0.65} />
              <span>Wipe</span>
            </button>
            <div className="bulk-divider" />
            {activeListObj ? (
              <button
                className="bulk-btn"
                onClick={() => {
                  removeDevicesFromList(activeListObj.id, checkedDevices);
                  showToast(`Removed ${checkedDevices.size} device(s) from "${activeListObj.name}"`, "success");
                  clearChecked();
                }}
              >
                <Icon path={mdiPlaylistRemove} size={0.65} />
                <span>Remove from list</span>
              </button>
            ) : (
              <div className="bulk-list-dropdown">
                <button
                  className="bulk-btn"
                  onClick={() => setShowNewList(!showNewList)}
                >
                  <Icon path={mdiPlaylistPlus} size={0.65} />
                  <span>Add to list</span>
                </button>
                {showNewList && (
                  <div className="bulk-list-menu">
                    {deviceLists.map((list) => (
                      <button
                        key={list.id}
                        className="bulk-list-menu-item"
                        onClick={() => { addCheckedToList(list.id); setShowNewList(false); }}
                      >
                        {list.name}
                      </button>
                    ))}
                    <div className="bulk-list-menu-new">
                      <input
                        type="text"
                        placeholder="New list name..."
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { createList(true); } }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button className="btn-primary btn-small" onClick={() => createList(true)}>
                        <Icon path={mdiPlus} size={0.6} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeView === "devices" && (
      <div className="main-content">
        <div className="sidebar">
          {/* Custom lists */}
          <div className="lists-section">
            <div className="lists-header">
              <span className="lists-title">Lists</span>
              <div className="lists-header-actions">
                {deviceLists.length > 1 && (
                  <button
                    className={`lists-header-btn${reorderMode ? " active" : ""}`}
                    onClick={() => setReorderMode(!reorderMode)}
                    title={reorderMode ? "Done reordering" : "Reorder lists"}
                  >
                    <Icon path={mdiSwapVertical} size={0.55} />
                  </button>
                )}
                <button
                  className="lists-header-btn"
                  onClick={() => setShowNewFolder(true)}
                  title="New folder"
                >
                  <Icon path={mdiFolderPlus} size={0.55} />
                </button>
                <button
                  className="lists-header-btn"
                  onClick={() => setImportOpen(true)}
                  title="Import devices by name, serial number, or file"
                >
                  <Icon path={mdiImport} size={0.55} />
                </button>
                <button
                  className="lists-header-btn"
                  onClick={() =>
                    openExport(
                      deviceLists.length > 0
                        ? { kind: "allLists" }
                        : checkedList.length > 0
                          ? { kind: "selected" }
                          : { kind: "visible" },
                      activeList
                    )
                  }
                  title="Export devices or lists"
                >
                  <Icon path={mdiExport} size={0.55} />
                </button>
                {checkedLists.size > 0 && (
                  <button
                    className="lists-header-btn"
                    onClick={() => setCheckedLists(new Set())}
                    title="Clear list selection"
                  >
                    <Icon path={mdiClose} size={0.55} />
                  </button>
                )}
              </div>
            </div>

            {showNewFolder && (
              <div className="folder-new-form">
                <input
                  type="text"
                  placeholder="Folder name..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createFolder();
                    if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
                  }}
                  autoFocus
                />
                <button className="btn-primary btn-small btn-icon" onClick={createFolder}>
                  <Icon path={mdiPlus} size={0.5} />
                </button>
              </div>
            )}

            {deviceLists.length > 0 && (
              <button
                className={`list-item ${activeList === null ? "active" : ""}`}
                onClick={() => { setActiveList(null); setCheckedLists(new Set()); }}
              >
                <Icon path={mdiDevices} size={0.6} />
                All Devices
              </button>
            )}

            {/* Folders */}
            {sortedFolders.map((folder) => {
              const folderLists = listsInFolder(folder.id);
              const isExpanded = expandedFolders.has(folder.id);
              return (
                <div key={folder.id} className="list-folder">
                  <div
                    className="list-folder-header"
                    onClick={() => toggleFolder(folder.id)}
                  >
                    <Icon path={isExpanded ? mdiChevronDown : mdiChevronRight} size={0.55} className="folder-chevron" />
                    <Icon path={isExpanded ? mdiFolderOpen : mdiFolder} size={0.55} className="folder-icon" />
                    {renamingFolder?.id === folder.id ? (
                      <input
                        className="list-rename-input"
                        value={renamingFolder.name}
                        onChange={(e) => setRenamingFolder({ ...renamingFolder, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameFolder(folder.id, renamingFolder.name);
                          if (e.key === "Escape") setRenamingFolder(null);
                        }}
                        onBlur={() => renameFolder(folder.id, renamingFolder.name)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span className="folder-name">{folder.name}</span>
                    )}
                    <span className="folder-count">{folderLists.length}</span>
                    <div className="folder-actions">
                      {reorderMode && (
                        <>
                          <button
                            className="folder-action-btn"
                            onClick={(e) => { e.stopPropagation(); moveFolder(folder.id, "up"); }}
                            title="Move folder up"
                          >
                            <Icon path={mdiChevronRight} size={0.45} style={{ transform: "rotate(-90deg)" }} />
                          </button>
                          <button
                            className="folder-action-btn"
                            onClick={(e) => { e.stopPropagation(); moveFolder(folder.id, "down"); }}
                            title="Move folder down"
                          >
                            <Icon path={mdiChevronRight} size={0.45} style={{ transform: "rotate(90deg)" }} />
                          </button>
                        </>
                      )}
                      <button
                        className="folder-action-btn"
                        onClick={(e) => { e.stopPropagation(); setRenamingFolder({ id: folder.id, name: folder.name }); }}
                        title="Rename folder"
                      >
                        <Icon path={mdiPencil} size={0.45} />
                      </button>
                      <button
                        className="folder-action-btn"
                        onClick={(e) => { e.stopPropagation(); deleteFolder(folder.id); }}
                        title="Delete folder"
                      >
                        <Icon path={mdiDelete} size={0.45} />
                      </button>
                    </div>
                  </div>
                  {isExpanded && folderLists.map((list) => renderListItem(list))}
                  {isExpanded && folderLists.length === 0 && (
                    <div className="folder-empty">Use right-click → "Move to folder" to add lists</div>
                  )}
                </div>
              );
            })}

            {/* Root-level lists (no folder) */}
            {rootLists.map((list) => renderListItem(list))}
          </div>

          <div className="search-box">
            <input
              type="text"
              placeholder="Search devices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="search-actions">
              {(() => {
                const allVisibleChecked = sortedDevices.length > 0 &&
                  sortedDevices.filter((d) => !d.deviceName.startsWith("[Not found]"))
                    .every((d) => checkedDevices.has(d.id));
                return (
                  <button
                    className="search-action-btn"
                    onClick={allVisibleChecked ? deselectAllVisible : selectAllVisible}
                    title={allVisibleChecked ? "Deselect all" : "Select all"}
                    disabled={sortedDevices.length === 0}
                  >
                    <Icon path={allVisibleChecked ? mdiSelectionOff : mdiSelectAll} size={0.6} />
                    <span>{allVisibleChecked ? "Deselect all" : "Select all"}</span>
                  </button>
                );
              })()}
              <span className="search-count">{sortedDevices.length} devices</span>
            </div>
          </div>
          <div className="device-list">
            {groupedDevices.map(([ou, ouDevices]) => (
              <div key={ou} className="device-group">
                <div
                  className="device-group-header"
                  onClick={() => toggleGroup(ou)}
                >
                  <Icon
                    path={expandedGroups.has(ou) ? mdiChevronDown : mdiChevronRight}
                    size={0.65}
                    className="group-chevron"
                  />
                  <span className="group-name">{ou}</span>
                  <span className="group-count">{ouDevices.length}</span>
                </div>
                {expandedGroups.has(ou) &&
                  ouDevices.map((device) => (
                    <DeviceItem
                      key={device.id}
                      device={device}
                      isSelected={selectedDevice?.id === device.id}
                      isChecked={checkedDevices.has(device.id)}
                      listTags={deviceListMemberships[device.id]}
                      onSelect={handleSelectDevice}
                      onToggleCheck={toggleChecked}
                    />
                  ))}
              </div>
            ))}
            {filteredDevices.length === 0 && !loading && (
              <div className="empty-state">
                {devices.length === 0 ? "No devices loaded" : "No matches"}
              </div>
            )}
          </div>
        </div>

        <div className="detail-panel">
          {selectedDevice ? (
            <div className="device-detail">
              {/* Intune-style action toolbar */}
              {isWindows(selectedDevice) ? (
                <div className="action-toolbar">
                  <button
                    className="toolbar-btn"
                    onClick={() => handleSync(selectedDevice)}
                  >
                    <Icon path={mdiSync} size={0.65} />
                    <span>Sync</span>
                  </button>
                  <div className="toolbar-divider" />
                  <button
                    className="toolbar-btn"
                    onClick={() => handleRestart(selectedDevice)}
                  >
                    <Icon path={mdiRestart} size={0.65} />
                    <span>Restart</span>
                  </button>
                  <div className="toolbar-divider" />
                  <button
                    className="toolbar-btn"
                    onClick={openRemediationModal}
                  >
                    <Icon path={mdiScriptTextPlay} size={0.65} />
                    <span>Run remediation</span>
                  </button>
                  <div className="toolbar-divider" />
                  <button
                    className="toolbar-btn toolbar-btn-danger"
                    onClick={() => promptWipe([selectedDevice])}
                  >
                    <Icon path={mdiCellphoneRemove} size={0.65} />
                    <span>Wipe</span>
                  </button>
                </div>
              ) : (
                <div className="action-toolbar action-toolbar-disabled">
                  <span className="actions-unavailable">
                    Actions are only available for Windows devices
                  </span>
                </div>
              )}

              <div className="device-detail-body">
                <h2 className="device-detail-title">
                  <Icon
                    path={getOsIcon(selectedDevice.operatingSystem)}
                    size={1}
                    className="device-detail-icon"
                  />
                  {selectedDevice.deviceName}
                </h2>

                <div className="detail-grid">
                  <span className="detail-label">User</span>
                  <span className="detail-value">
                    {selectedDevice.userPrincipalName || "N/A"}
                  </span>
                  <span className="detail-label">Serial</span>
                  <span className="detail-value">
                    {selectedDevice.serialNumber || "N/A"}
                  </span>
                  <span className="detail-label">OS</span>
                  <span className="detail-value">
                    {selectedDevice.operatingSystem} {selectedDevice.osVersion}
                  </span>
                  <span className="detail-label">Compliance</span>
                  <span className="detail-value">
                    {complianceBadge(selectedDevice.complianceState)}
                  </span>
                  <span className="detail-label">Last Sync</span>
                  <span className="detail-value">
                    {formatDate(selectedDevice.lastSyncDateTime)}
                  </span>
                  <span className="detail-label">Management</span>
                  <span className="detail-value">
                    {selectedDevice.managementState || "N/A"}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="no-selection">Select a device to view details</div>
          )}
        </div>
      </div>
      )}

      {importOpen && (
        <ImportModal
          devices={devices}
          lists={deviceLists}
          onCommit={commitImport}
          onClose={() => setImportOpen(false)}
          showToast={showToast}
        />
      )}

      {exportScope && (
        <ExportModal
          initialScope={exportScope}
          ctx={exportContext}
          listScopeId={exportListId}
          onClose={() => setExportScope(null)}
          showToast={showToast}
        />
      )}


      {/* Typed confirmation modal for wipe */}
      {wipeConfirm && (
        <div className="modal-overlay" onClick={() => setWipeConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm Wipe</h3>
            <p className="destructive-confirm-text">
              You are about to wipe <strong>{wipeConfirm.targets.length}</strong> device
              {wipeConfirm.targets.length === 1 ? "" : "s"}. This factory resets the device
              {wipeConfirm.targets.length === 1 ? "" : "s"}, erasing all data, and cannot be undone.
            </p>
            <div className="wipe-target-list">
              {wipeConfirm.targets.slice(0, 10).map((d) => (
                <div key={d.id} className="wipe-target">{d.deviceName}</div>
              ))}
              {wipeConfirm.targets.length > 10 && (
                <div className="wipe-target">
                  …and {wipeConfirm.targets.length - 10} more
                </div>
              )}
            </div>
            <p className="destructive-confirm-text">
              Type <strong className="destructive-confirm-phrase">{wipePhrase(wipeConfirm.targets.length)}</strong> to confirm:
            </p>
            <input
              className="destructive-confirm-input"
              type="text"
              value={wipeConfirm.input}
              onChange={(e) => setWipeConfirm({ ...wipeConfirm, input: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && wipeConfirm.input === wipePhrase(wipeConfirm.targets.length))
                  executeWipe();
                if (e.key === "Escape") setWipeConfirm(null);
              }}
              placeholder={wipePhrase(wipeConfirm.targets.length)}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setWipeConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn-danger"
                disabled={wipeConfirm.input !== wipePhrase(wipeConfirm.targets.length)}
                onClick={executeWipe}
              >
                Wipe {wipeConfirm.targets.length} device{wipeConfirm.targets.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remediation modal */}
      {showRemediation && (
        <div className="modal-overlay" onClick={() => setShowRemediation(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Run Remediation Script</h3>
            <div className="modal-list">
              {scripts.map((script) => (
                <div
                  key={script.id}
                  className={`script-item ${selectedScript?.id === script.id ? "selected" : ""}`}
                  onClick={() => setSelectedScript(script)}
                >
                  <div className="script-name">{script.displayName}</div>
                  <div className="script-desc">{script.id}</div>
                </div>
              ))}
              {scripts.length === 0 && (
                <div className="empty-state">
                  No remediation scripts found
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowRemediation(false);
                  setSelectedScript(null);
                }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={!selectedScript}
                onClick={handleRunRemediation}
              >
                Run Script
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Settings</h3>

            <div className="settings-section">
              <h4>Remediation Scripts</h4>
              <p className="settings-hint">
                Add scripts manually by their ID and a friendly name.
                Enter the full script policy ID (e.g. &quot;abc123-..._1&quot;).
                The format is scriptId_assignmentFilterId — typically the script GUID followed by &quot;_1&quot; for the default assignment.
                Find script IDs in the Intune portal under Devices &gt; Remediations.
              </p>

              <div className="script-add-form">
                <input
                  type="text"
                  placeholder="Policy ID (e.g. guid_1)"
                  value={newScriptId}
                  onChange={(e) => setNewScriptId(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Display Name"
                  value={newScriptName}
                  onChange={(e) => setNewScriptName(e.target.value)}
                />
                <button
                  className="btn-primary btn-small btn-icon"
                  onClick={addScript}
                  title="Add Script"
                >
                  <Icon path={mdiPlus} size={0.7} />
                </button>
              </div>

              <div className="saved-scripts-list">
                {scripts.map((s) => (
                  <div key={s.id} className="saved-script-item">
                    <div className="saved-script-info">
                      <div className="saved-script-name">{s.displayName}</div>
                      <div className="saved-script-id">{s.id}</div>
                    </div>
                    <button
                      className="btn-icon btn-delete"
                      onClick={() => removeScript(s.id)}
                      title="Remove"
                    >
                      <Icon path={mdiDelete} size={0.65} />
                    </button>
                  </div>
                ))}
                {scripts.length === 0 && (
                  <div className="settings-empty">No scripts configured yet.</div>
                )}
              </div>
            </div>

            <div className="settings-section">
              <h4>Updates</h4>
              <p className="settings-hint">
                Updates are downloaded from GitHub Releases and verified before they are
                installed. The app also checks once shortly after it starts.
              </p>
              <div className="settings-update-row">
                <span className="settings-version">
                  Version {update.currentVersion || "—"}
                </span>
                <button
                  className="btn-secondary btn-small"
                  onClick={() => update.checkForUpdate()}
                  disabled={update.status === "checking" || update.status === "downloading"}
                >
                  {update.status === "checking" ? (
                    <><span className="spinner" />Checking...</>
                  ) : (
                    "Check for updates"
                  )}
                </button>
              </div>
              {update.status === "upToDate" && (
                <div className="settings-update-status">You are on the latest version.</div>
              )}
              {update.status === "available" && (
                <div className="settings-update-status">
                  Version {update.newVersion} is available — see the banner at the top.
                </div>
              )}
              {update.status === "error" && (
                <div className="settings-update-status settings-update-error">
                  Could not check for updates: {update.error}
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn-primary" onClick={() => setShowSettings(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List context menu */}
      {listContextMenu && (
        <div
          className="context-menu-overlay"
          onClick={() => setListContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setListContextMenu(null); }}
        >
          <div
            className="context-menu"
            style={{ top: listContextMenu.y, left: listContextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="context-menu-item"
              onClick={() => { handleListSync(listContextMenu.listId); setListContextMenu(null); }}
            >
              <Icon path={mdiSync} size={0.6} />
              Sync all Windows devices
            </button>
            <button
              className="context-menu-item"
              onClick={() => { handleListRestart(listContextMenu.listId); setListContextMenu(null); }}
            >
              <Icon path={mdiRestart} size={0.6} />
              Restart all Windows devices
            </button>
            <button
              className="context-menu-item"
              onClick={() => { handleListRemediation(listContextMenu.listId); setListContextMenu(null); }}
            >
              <Icon path={mdiScriptTextPlay} size={0.6} />
              Run remediation
            </button>
            <button
              className="context-menu-item context-menu-danger"
              onClick={() => { handleListWipe(listContextMenu.listId); setListContextMenu(null); }}
            >
              <Icon path={mdiCellphoneRemove} size={0.6} />
              Wipe all Windows devices
            </button>
            <div className="context-menu-separator" />
            <button
              className="context-menu-item"
              onClick={() => {
                const list = deviceLists.find((l) => l.id === listContextMenu.listId);
                if (list) setRenamingList({ id: list.id, name: list.name });
                setListContextMenu(null);
              }}
            >
              <Icon path={mdiPencil} size={0.6} />
              Rename
            </button>
            <button
              className="context-menu-item"
              onClick={() => {
                openExport({ kind: "list", listId: listContextMenu.listId }, listContextMenu.listId);
                setListContextMenu(null);
              }}
            >
              <Icon path={mdiExport} size={0.6} />
              Export…
            </button>
            <div className="context-menu-separator" />
            <div className="context-menu-label">Color</div>
            <div className="context-menu-colors">
              {["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#007aff", "#5856d6", "#af52de", "#ff2d55"].map((color) => {
                const currentList = deviceLists.find((l) => l.id === listContextMenu.listId);
                return (
                  <button
                    key={color}
                    className={`color-swatch${currentList?.color === color ? " active" : ""}`}
                    style={{ background: color }}
                    onClick={() => {
                      const updated = deviceLists.map((l) =>
                        l.id === listContextMenu.listId ? { ...l, color } : l
                      );
                      setDeviceLists(updated);
                      saveLists(updated);
                      setListContextMenu(null);
                    }}
                  />
                );
              })}
              {(() => {
                const currentList = deviceLists.find((l) => l.id === listContextMenu.listId);
                return currentList?.color ? (
                  <button
                    className="color-swatch color-swatch-clear"
                    title="Remove color"
                    onClick={() => {
                      const updated = deviceLists.map((l) =>
                        l.id === listContextMenu.listId ? { ...l, color: null } : l
                      );
                      setDeviceLists(updated);
                      saveLists(updated);
                      setListContextMenu(null);
                    }}
                  >
                    <Icon path={mdiClose} size={0.4} />
                  </button>
                ) : null;
              })()}
            </div>
            {listFolders.length > 0 && (
              <>
                <div className="context-menu-separator" />
                <div className="context-menu-label">Move to folder</div>
                {(() => {
                  const currentList = deviceLists.find((l) => l.id === listContextMenu.listId);
                  return (
                    <>
                      {currentList?.folderId && (
                        <button
                          className="context-menu-item"
                          onClick={() => {
                            const updated = deviceLists.map((l) =>
                              l.id === listContextMenu.listId ? { ...l, folderId: null } : l
                            );
                            setDeviceLists(updated);
                            saveLists(updated);
                            setListContextMenu(null);
                          }}
                        >
                          <Icon path={mdiClose} size={0.6} />
                          No folder (root)
                        </button>
                      )}
                      {listFolders
                        .filter((f) => f.id !== currentList?.folderId)
                        .map((folder) => (
                          <button
                            key={folder.id}
                            className="context-menu-item"
                            onClick={() => {
                              const updated = deviceLists.map((l) =>
                                l.id === listContextMenu.listId ? { ...l, folderId: folder.id } : l
                              );
                              setDeviceLists(updated);
                              saveLists(updated);
                              setListContextMenu(null);
                              setExpandedFolders((prev) => new Set([...prev, folder.id]));
                            }}
                          >
                            <Icon path={mdiFolder} size={0.6} />
                            {folder.name}
                          </button>
                        ))}
                    </>
                  );
                })()}
              </>
            )}
            <div className="context-menu-separator" />
            <button
              className="context-menu-item context-menu-danger"
              onClick={() => { deleteList(listContextMenu.listId); setListContextMenu(null); }}
            >
              <Icon path={mdiDelete} size={0.6} />
              Delete list
            </button>
          </div>
        </div>
      )}

      {toast && (
          <div className={`toast ${toast.type}`}>
            <span>{toast.message}</span>
            {toast.progress && (
              <div className="toast-progress">
                <div
                  className="toast-progress-bar"
                  style={{ width: `${(toast.progress.current / toast.progress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}
    </div>
  );
}

export default App;
