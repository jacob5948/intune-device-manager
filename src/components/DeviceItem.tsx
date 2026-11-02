import { memo } from "react";
import Icon from "@mdi/react";
import { mdiCheckboxBlankOutline, mdiCheckboxMarked } from "@mdi/js";
import type { DeviceInfo } from "../types";
import { formatDate, getOsIcon, isStaleSync, relativeTime, STALE_SYNC_DAYS } from "../utils/device";
import { activateOnKey } from "../utils/keyboard";

interface ListTag {
  name: string;
  color?: string | null;
}

interface DeviceItemProps {
  device: DeviceInfo;
  isSelected: boolean;
  isChecked: boolean;
  listTags?: ListTag[];
  onSelect: (device: DeviceInfo) => void;
  onToggleCheck: (deviceId: string) => void;
}

/** Tags shown before the rest collapse into "+n", which keeps every row one height */
const MAX_VISIBLE_TAGS = 2;

const DeviceItem = memo<DeviceItemProps>(
  ({ device, isSelected, isChecked, listTags, onSelect, onToggleCheck }) => {
    const isMissing = device.deviceName.startsWith("[Not found]");
    const stale = !isMissing && isStaleSync(device.lastSyncDateTime);
    const className = `device-item${isSelected ? " selected" : ""}${isChecked ? " checked" : ""}${isMissing ? " missing" : ""}`;
    const visibleTags = listTags?.slice(0, MAX_VISIBLE_TAGS) ?? [];
    const hiddenTags = listTags?.slice(MAX_VISIBLE_TAGS) ?? [];

    return (
      <div
        className={className}
        role="button"
        tabIndex={0}
        aria-current={isSelected ? "true" : undefined}
        aria-label={device.deviceName}
        onClick={() => onSelect(device)}
        onKeyDown={activateOnKey(() => onSelect(device))}
      >
        <div className="device-item-content">
          <button
            className="device-icon-wrapper"
            role="checkbox"
            aria-checked={isChecked}
            aria-label={`Select ${device.deviceName}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheck(device.id);
            }}
          >
            <Icon
              path={getOsIcon(device.operatingSystem)}
              size={0.75}
              className="device-os-icon"
            />
            <Icon
              path={isChecked ? mdiCheckboxMarked : mdiCheckboxBlankOutline}
              size={0.75}
              className="device-checkbox-icon"
            />
          </button>
          <div className="device-item-text">
            <div className="device-row">
              <div className="device-name" title={device.deviceName}>{device.deviceName}</div>
              {!isMissing && (
                <div
                  className={`device-sync${stale ? " stale" : ""}`}
                  title={
                    stale
                      ? `No sync in over ${STALE_SYNC_DAYS} days. Last sync: ${formatDate(device.lastSyncDateTime)}`
                      : `Last sync: ${formatDate(device.lastSyncDateTime)}`
                  }
                >
                  {relativeTime(device.lastSyncDateTime)}
                </div>
              )}
            </div>
            {isMissing && <div className="device-sync">Device not found in Intune</div>}
            {visibleTags.length > 0 && (
              <div className="device-list-tags">
                {visibleTags.map((tag) => (
                  <span
                    key={tag.name}
                    className="device-list-tag"
                    title={tag.name}
                    // A list's own colour is unreadable on the selected row's blue
                    style={tag.color && !isSelected ? {
                      background: `${tag.color}20`,
                      color: tag.color,
                    } : undefined}
                  >{tag.name}</span>
                ))}
                {hiddenTags.length > 0 && (
                  <span
                    className="device-list-tag device-list-tag-more"
                    title={hiddenTags.map((tag) => tag.name).join(", ")}
                  >+{hiddenTags.length}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

DeviceItem.displayName = "DeviceItem";

export default DeviceItem;
