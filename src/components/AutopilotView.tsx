import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import Icon from "@mdi/react";
import {
  mdiDelete,
  mdiImport,
  mdiTag,
  mdiChevronDown,
  mdiChevronRight,
  mdiClose,
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiSelectAll,
  mdiSelectionOff,
  mdiLaptop,
} from "@mdi/js";
import type { AutopilotDevice, AutopilotImportEntry, AutopilotImportResult, Toast } from "../types";
import { formatDate } from "../utils/device";

interface AutopilotViewProps {
  showToast: (message: string, type: Toast["type"], progress?: { current: number; total: number }) => void;
  updateProgress: (label: string, current: number, total: number) => void;
  isActive: boolean;
}

function AutopilotView({ showToast, updateProgress, isActive }: AutopilotViewProps) {
  const [autopilotDevices, setAutopilotDevices] = useState<AutopilotDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<AutopilotDevice | null>(null);
  const [checkedDevices, setCheckedDevices] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editingGroupTag, setEditingGroupTag] = useState<{ id: string; value: string } | null>(null);
  const [bulkGroupTag, setBulkGroupTag] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const wasActive = useRef(false);

  const loadAutopilotDevices = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<AutopilotDevice[]>("get_autopilot_devices");
      setAutopilotDevices(result);
      setLoaded(true);
    } catch (e) {
      showToast(`Failed to load Autopilot devices: ${e}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const refreshInBackground = useCallback(async () => {
    try {
      const result = await invoke<AutopilotDevice[]>("get_autopilot_devices");
      setAutopilotDevices(result);
    } catch {
      // Silent fail for background refresh
    }
  }, []);

  // Load on first render
  if (!loaded && !loading) {
    loadAutopilotDevices();
  }

  // Background refresh when tab becomes active again
  useEffect(() => {
    if (isActive && !wasActive.current && loaded) {
      refreshInBackground();
    }
    wasActive.current = isActive;
  }, [isActive, loaded, refreshInBackground]);

  const filteredDevices = useMemo(() => {
    if (!searchQuery) return autopilotDevices;
    const terms = searchQuery
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    if (terms.length === 0) return autopilotDevices;
    return autopilotDevices.filter((d) => {
      const serial = (d.serialNumber || "").toLowerCase();
      const model = (d.model || "").toLowerCase();
      const manufacturer = (d.manufacturer || "").toLowerCase();
      const tag = (d.groupTag || "").toLowerCase();
      const user = (d.userPrincipalName || d.addressableUserName || "").toLowerCase();
      const display = (d.displayName || "").toLowerCase();
      return terms.some(
        (q) =>
          serial.includes(q) ||
          model.includes(q) ||
          manufacturer.includes(q) ||
          tag.includes(q) ||
          user.includes(q) ||
          display.includes(q)
      );
    });
  }, [autopilotDevices, searchQuery]);

  const sortedDevices = useMemo(
    () =>
      [...filteredDevices].sort((a, b) =>
        (a.serialNumber || "").localeCompare(b.serialNumber || "", undefined, { sensitivity: "base" })
      ),
    [filteredDevices]
  );

  // Group by group tag
  const groupedDevices = useMemo(() => {
    const groups = new Map<string, AutopilotDevice[]>();
    for (const device of sortedDevices) {
      const tag = device.groupTag || "(No Group Tag)";
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(device);
    }
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      if (a === "(No Group Tag)") return 1;
      if (b === "(No Group Tag)") return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [sortedDevices]);

  const toggleGroup = (tag: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
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
    setCheckedDevices(new Set(sortedDevices.map((d) => d.id)));
  };

  const handleDeleteDevice = async (device: AutopilotDevice) => {
    if (!(await confirm(`Delete Autopilot device "${device.serialNumber || device.id}"? This cannot be undone.`)))
      return;
    showToast(`Deleting ${device.serialNumber || device.id}...`, "info");
    try {
      await invoke("delete_autopilot_device", { deviceId: device.id });
      setAutopilotDevices((prev) => prev.filter((d) => d.id !== device.id));
      if (selectedDevice?.id === device.id) setSelectedDevice(null);
      showToast(`Deleted ${device.serialNumber || device.id}`, "success");
    } catch (e) {
      showToast(`Delete failed: ${e}`, "error");
    }
  };

  const handleBulkDelete = async () => {
    const count = checkedDevices.size;
    if (count === 0) return;
    if (!(await confirm(`Delete ${count} Autopilot device(s)? This cannot be undone.`))) return;
    if (count > 100) {
      if (!(await confirm(`You are about to delete ${count} devices. This is a large operation. Are you absolutely sure?`)))
        return;
    }
    let ok = 0,
      fail = 0;
    const ids = [...checkedDevices];
    for (let i = 0; i < ids.length; i++) {
      updateProgress("Deleting", i + 1, ids.length);
      try {
        await invoke("delete_autopilot_device", { deviceId: ids[i] });
        ok++;
      } catch {
        fail++;
      }
    }
    setAutopilotDevices((prev) => prev.filter((d) => !checkedDevices.has(d.id)));
    if (selectedDevice && checkedDevices.has(selectedDevice.id)) setSelectedDevice(null);
    clearChecked();
    showToast(`Delete: ${ok} succeeded, ${fail} failed`, ok > 0 ? "success" : "error");
  };

  const handleUpdateGroupTag = async (deviceId: string, groupTag: string) => {
    showToast("Updating group tag...", "info");
    try {
      await invoke("update_autopilot_group_tag", { deviceId, groupTag });
      setAutopilotDevices((prev) =>
        prev.map((d) => (d.id === deviceId ? { ...d, groupTag: groupTag || null } : d))
      );
      if (selectedDevice?.id === deviceId) {
        setSelectedDevice((prev) => (prev ? { ...prev, groupTag: groupTag || null } : null));
      }
      setEditingGroupTag(null);
      showToast("Group tag updated", "success");
    } catch (e) {
      showToast(`Update failed: ${e}`, "error");
    }
  };

  const handleBulkGroupTag = async (groupTag: string) => {
    const count = checkedDevices.size;
    if (count === 0) return;
    if (!(await confirm(`Set group tag to "${groupTag}" on ${count} device(s)?`))) return;
    if (count > 100) {
      if (!(await confirm(`You are about to update ${count} devices. Are you absolutely sure?`)))
        return;
    }
    setBulkGroupTag(null);
    let ok = 0,
      fail = 0;
    const ids = [...checkedDevices];
    for (let i = 0; i < ids.length; i++) {
      updateProgress("Updating group tag", i + 1, ids.length);
      try {
        await invoke("update_autopilot_group_tag", { deviceId: ids[i], groupTag });
        ok++;
      } catch {
        fail++;
      }
    }
    setAutopilotDevices((prev) =>
      prev.map((d) => (checkedDevices.has(d.id) ? { ...d, groupTag: groupTag || null } : d))
    );
    clearChecked();
    showToast(`Group tag: ${ok} succeeded, ${fail} failed`, ok > 0 ? "success" : "error");
  };

  const handleImportCsv = async () => {
    try {
      const filePath = await open({
        title: "Import Autopilot Devices (CSV)",
        filters: [{ name: "CSV", extensions: ["csv"] }],
        multiple: false,
      });
      if (!filePath) return;

      const contents = await readTextFile(filePath as string);
      const lines = contents.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        showToast("CSV file must have a header row and at least one device", "error");
        return;
      }

      // Parse header to find column indices
      const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
      const serialIdx = header.findIndex(
        (h) => h.includes("serial") && h.includes("number")
      );
      const hashIdx = header.findIndex(
        (h) => h.includes("hardware") && h.includes("hash")
      );
      const productIdx = header.findIndex(
        (h) => h.includes("product") && h.includes("id")
      );
      const groupTagIdx = header.findIndex((h) => h.includes("group") && h.includes("tag"));
      const userIdx = header.findIndex(
        (h) => h.includes("assigned") && h.includes("user")
      );

      if (hashIdx === -1) {
        showToast("CSV must have a 'Hardware Hash' column", "error");
        return;
      }

      const entries: AutopilotImportEntry[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const hash = cols[hashIdx]?.trim();
        if (!hash) continue;

        entries.push({
          hardwareIdentifier: hash,
          serialNumber: serialIdx >= 0 ? cols[serialIdx]?.trim() || null : null,
          productKey: productIdx >= 0 ? cols[productIdx]?.trim() || null : null,
          groupTag: groupTagIdx >= 0 ? cols[groupTagIdx]?.trim() || null : null,
          assignedUserPrincipalName: userIdx >= 0 ? cols[userIdx]?.trim() || null : null,
        });
      }

      if (entries.length === 0) {
        showToast("No valid entries found in CSV", "error");
        return;
      }

      if (!(await confirm(`Import ${entries.length} device(s) into Autopilot?`))) return;

      showToast(`Importing ${entries.length} device(s)...`, "info");

      const results = await invoke<AutopilotImportResult[]>("import_autopilot_devices", {
        entries,
      });

      const succeeded = results.filter(
        (r) => r.state?.deviceImportStatus !== "error"
      ).length;
      const failed = results.length - succeeded;

      showToast(
        `Import: ${succeeded} succeeded, ${failed} failed`,
        succeeded > 0 ? "success" : "error"
      );

      // Reload the device list
      loadAutopilotDevices();
    } catch (e) {
      showToast(`Import failed: ${e}`, "error");
    }
  };

  // Simple CSV line parser that handles quoted fields
  const parseCsvLine = (line: string): string[] => {
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

  const enrollmentBadge = (state: string | null) => {
    const s = (state || "unknown").toLowerCase();
    if (s === "enrolled") return <span className="badge compliant">Enrolled</span>;
    if (s === "notcontacted") return <span className="badge unknown">Not Contacted</span>;
    return <span className="badge unknown">{state || "Unknown"}</span>;
  };

  // Initial loading screen
  if (loading && autopilotDevices.length === 0) {
    return (
      <div className="autopilot-loading">
        <span className="spinner dark large" />
        <p>Loading Autopilot devices...</p>
      </div>
    );
  }

  return (
    <>
      {/* Bulk action bar */}
      {checkedDevices.size > 0 && (
        <div className="bulk-bar">
          <div className="bulk-left">
            <button className="bulk-close" onClick={clearChecked} title="Clear selection">
              <Icon path={mdiClose} size={0.6} />
            </button>
            <span className="bulk-info">{checkedDevices.size} selected</span>
          </div>
          <div className="bulk-actions-group">
            <button className="bulk-btn" onClick={handleBulkDelete}>
              <Icon path={mdiDelete} size={0.65} />
              <span>Delete</span>
            </button>
            <div className="bulk-divider" />
            <div className="bulk-list-dropdown">
              <button
                className="bulk-btn"
                onClick={() => setBulkGroupTag(bulkGroupTag !== null ? null : "")}
              >
                <Icon path={mdiTag} size={0.65} />
                <span>Set group tag</span>
              </button>
              {bulkGroupTag !== null && (
                <div className="bulk-list-menu">
                  <div className="bulk-list-menu-new">
                    <input
                      type="text"
                      placeholder="Group tag..."
                      value={bulkGroupTag}
                      onChange={(e) => setBulkGroupTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleBulkGroupTag(bulkGroupTag);
                        if (e.key === "Escape") setBulkGroupTag(null);
                      }}
                      autoFocus
                    />
                    <button
                      className="btn-primary btn-small"
                      onClick={() => handleBulkGroupTag(bulkGroupTag)}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="main-content">
        {/* Sidebar with autopilot device list */}
        <div className="sidebar">
          <div className="autopilot-sidebar-header">
            <button
              className="btn-secondary btn-small"
              onClick={handleImportCsv}
              title="Import devices from CSV"
            >
              <Icon path={mdiImport} size={0.6} />
              Import CSV
            </button>
          </div>

          <div className="search-box">
            <input
              type="text"
              placeholder="Search Autopilot devices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="search-actions">
              <button
                className="search-action-btn"
                onClick={
                  checkedDevices.size === sortedDevices.length && sortedDevices.length > 0
                    ? clearChecked
                    : selectAllVisible
                }
                title={
                  checkedDevices.size === sortedDevices.length && sortedDevices.length > 0
                    ? "Deselect all"
                    : "Select all"
                }
                disabled={sortedDevices.length === 0}
              >
                <Icon
                  path={checkedDevices.size === sortedDevices.length && sortedDevices.length > 0 ? mdiSelectionOff : mdiSelectAll}
                  size={0.6}
                />
                <span>
                  {checkedDevices.size === sortedDevices.length && sortedDevices.length > 0
                    ? "Deselect all"
                    : "Select all"}
                </span>
              </button>
              <span className="search-count">{sortedDevices.length} devices</span>
            </div>
          </div>

          <div className="device-list">
            {groupedDevices.map(([tag, tagDevices]) => (
              <div key={tag} className="device-group">
                <div className="device-group-header" onClick={() => toggleGroup(tag)}>
                  <Icon
                    path={expandedGroups.has(tag) ? mdiChevronDown : mdiChevronRight}
                    size={0.65}
                    className="group-chevron"
                  />
                  <Icon path={mdiTag} size={0.55} className="group-tag-icon" />
                  <span className="group-name">{tag}</span>
                  <span className="group-count">{tagDevices.length}</span>
                </div>
                {expandedGroups.has(tag) &&
                  tagDevices.map((device) => {
                    const isSelected = selectedDevice?.id === device.id;
                    const isChecked = checkedDevices.has(device.id);
                    return (
                      <div
                        key={device.id}
                        className={`device-item${isSelected ? " selected" : ""}${isChecked ? " checked" : ""}`}
                        onClick={() => setSelectedDevice(device)}
                      >
                        <div className="device-item-content">
                          <div
                            className="device-icon-wrapper"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleChecked(device.id);
                            }}
                          >
                            <Icon path={mdiLaptop} size={0.85} className="device-os-icon" />
                            <Icon
                              path={isChecked ? mdiCheckboxMarked : mdiCheckboxBlankOutline}
                              size={0.85}
                              className="device-checkbox-icon"
                            />
                          </div>
                          <div className="device-item-text">
                            <div className="device-name">
                              {device.serialNumber || device.id.substring(0, 8) + "..."}
                            </div>
                            <div className="device-sync">
                              {device.model
                                ? `${device.manufacturer || ""} ${device.model}`.trim()
                                : "Unknown model"}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}
            {sortedDevices.length === 0 && !loading && (
              <div className="empty-state">
                {autopilotDevices.length === 0 ? "No Autopilot devices loaded" : "No matches"}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="detail-panel">
          {selectedDevice ? (
            <div className="device-detail">
              <div className="action-toolbar">
                <button
                  className="toolbar-btn"
                  onClick={() =>
                    setEditingGroupTag({
                      id: selectedDevice.id,
                      value: selectedDevice.groupTag || "",
                    })
                  }
                >
                  <Icon path={mdiTag} size={0.65} />
                  <span>Set group tag</span>
                </button>
                <div className="toolbar-divider" />
                <button
                  className="toolbar-btn toolbar-btn-danger"
                  onClick={() => handleDeleteDevice(selectedDevice)}
                >
                  <Icon path={mdiDelete} size={0.65} />
                  <span>Delete</span>
                </button>
              </div>

              <div className="device-detail-body">
                <h2 className="device-detail-title">
                  <Icon path={mdiLaptop} size={1} className="device-detail-icon" />
                  {selectedDevice.serialNumber || "Autopilot Device"}
                </h2>

                <div className="detail-grid">
                  <span className="detail-label">Serial Number</span>
                  <span className="detail-value">{selectedDevice.serialNumber || "N/A"}</span>

                  <span className="detail-label">Manufacturer</span>
                  <span className="detail-value">{selectedDevice.manufacturer || "N/A"}</span>

                  <span className="detail-label">Model</span>
                  <span className="detail-value">{selectedDevice.model || "N/A"}</span>

                  <span className="detail-label">Group Tag</span>
                  <span className="detail-value">
                    {editingGroupTag?.id === selectedDevice.id ? (
                      <span className="group-tag-edit">
                        <input
                          type="text"
                          value={editingGroupTag.value}
                          onChange={(e) =>
                            setEditingGroupTag({ ...editingGroupTag, value: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              handleUpdateGroupTag(editingGroupTag.id, editingGroupTag.value);
                            if (e.key === "Escape") setEditingGroupTag(null);
                          }}
                          autoFocus
                          placeholder="Enter group tag..."
                        />
                        <button
                          className="btn-primary btn-small"
                          onClick={() =>
                            handleUpdateGroupTag(editingGroupTag.id, editingGroupTag.value)
                          }
                        >
                          Save
                        </button>
                        <button
                          className="btn-secondary btn-small"
                          onClick={() => setEditingGroupTag(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span
                        className="group-tag-display"
                        onClick={() =>
                          setEditingGroupTag({
                            id: selectedDevice.id,
                            value: selectedDevice.groupTag || "",
                          })
                        }
                        title="Click to edit"
                      >
                        {selectedDevice.groupTag || "(none)"}
                      </span>
                    )}
                  </span>

                  <span className="detail-label">Enrollment</span>
                  <span className="detail-value">
                    {enrollmentBadge(selectedDevice.enrollmentState)}
                  </span>

                  <span className="detail-label">User</span>
                  <span className="detail-value">
                    {selectedDevice.userPrincipalName ||
                      selectedDevice.addressableUserName ||
                      "N/A"}
                  </span>

                  <span className="detail-label">Last Contacted</span>
                  <span className="detail-value">
                    {formatDate(selectedDevice.lastContactedDateTime)}
                  </span>

                  <span className="detail-label">Azure AD Device ID</span>
                  <span className="detail-value">
                    {selectedDevice.azureActiveDirectoryDeviceId ||
                      selectedDevice.azureAdDeviceId ||
                      "N/A"}
                  </span>

                  <span className="detail-label">Managed Device ID</span>
                  <span className="detail-value">{selectedDevice.managedDeviceId || "N/A"}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="no-selection">Select an Autopilot device to view details</div>
          )}
        </div>
      </div>

      {/* Group tag edit modal - for inline editing */}
      {editingGroupTag && !selectedDevice && (
        <div className="modal-overlay" onClick={() => setEditingGroupTag(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Set Group Tag</h3>
            <div className="modal-list">
              <input
                type="text"
                value={editingGroupTag.value}
                onChange={(e) => setEditingGroupTag({ ...editingGroupTag, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    handleUpdateGroupTag(editingGroupTag.id, editingGroupTag.value);
                }}
                placeholder="Enter group tag..."
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setEditingGroupTag(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => handleUpdateGroupTag(editingGroupTag.id, editingGroupTag.value)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AutopilotView;
