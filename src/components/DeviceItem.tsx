import { memo, type CSSProperties } from "react";
import Icon from "@mdi/react";
import { mdiCheckboxBlankOutline, mdiCheckboxMarked } from "@mdi/js";
import type { DeviceInfo } from "../types";
import { formatDate, getOsIcon, isStaleSync, relativeTime, STALE_SYNC_DAYS } from "../utils/device";
import { activateOnKey } from "../utils/keyboard";
import { tagColors } from "../utils/tagColor";

interface ListTag {
  name: string;
  color?: string | null;
}

interface DeviceItemProps {
  device: DeviceInfo;
  isSelected: boolean;
  isChecked: boolean;
  listTags?: ListTag[];
  /** `toggle` is true for the checkbox itself; modifier keys come from the event */
  onClick: (device: DeviceInfo, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, toggle: boolean) => void;
}

/** Tags shown before the rest collapse into "+n", which keeps every row one height */
const MAX_VISIBLE_TAGS = 2;

const DeviceItem = memo<DeviceItemProps>(
  ({ device, isSelected, isChecked, listTags, onClick }) => {
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
        // Shift-click would otherwise also select the row's text
        onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
        onClick={(e) => onClick(device, e, false)}
        onKeyDown={(e) => activateOnKey(() => onClick(device, e, false))(e)}
      >
        <div className="device-item-content">
          <button
            className="device-icon-wrapper"
            role="checkbox"
            aria-checked={isChecked}
            aria-label={`Select ${device.deviceName}`}
            onClick={(e) => {
              e.stopPropagation();
              onClick(device, e, true);
            }}
          >
            <Icon
              path={getOsIcon(device.operatingSystem)}
              size={0.75}
              className="device-os-icon"
            />
            <Icon
              path={isChecked ? mdiCheckboxMarked : mdiCheckboxBlankOutline}
              size={0.9}
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
                {visibleTags.map((tag) => {
                  // A list's own colour is unreadable on the selected row's blue
                  const colors = tag.color && !isSelected ? tagColors(tag.color) : null;
                  return (
                    <span
                      key={tag.name}
                      className={`device-list-tag${colors ? " colored" : ""}`}
                      title={tag.name}
                      style={colors ? {
                        "--tag-bg-light": colors.light.bg,
                        "--tag-fg-light": colors.light.fg,
                        "--tag-bg-dark": colors.dark.bg,
                        "--tag-fg-dark": colors.dark.fg,
                      } as CSSProperties : undefined}
                    >{tag.name}</span>
                  );
                })}
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
