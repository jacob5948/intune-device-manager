import { memo } from "react";
import Icon from "@mdi/react";
import { mdiCheckboxBlankOutline, mdiCheckboxMarked } from "@mdi/js";
import type { DeviceInfo } from "../types";
import { getOsIcon, relativeTime } from "../utils/device";

interface DeviceItemProps {
  device: DeviceInfo;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: (device: DeviceInfo) => void;
  onToggleCheck: (deviceId: string) => void;
}

const DeviceItem = memo<DeviceItemProps>(
  ({ device, isSelected, isChecked, onSelect, onToggleCheck }) => {
    const isMissing = device.deviceName.startsWith("[Not found]");
    const className = `device-item${isSelected ? " selected" : ""}${isChecked ? " checked" : ""}${isMissing ? " missing" : ""}`;

    return (
      <div className={className} onClick={() => onSelect(device)}>
        <div className="device-item-content">
          <div
            className="device-icon-wrapper"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheck(device.id);
            }}
          >
            <Icon
              path={getOsIcon(device.operatingSystem)}
              size={0.85}
              className="device-os-icon"
            />
            <Icon
              path={isChecked ? mdiCheckboxMarked : mdiCheckboxBlankOutline}
              size={0.85}
              className="device-checkbox-icon"
            />
          </div>
          <div className="device-item-text">
            <div className="device-name">{device.deviceName}</div>
            <div className="device-sync">
              {isMissing ? "Device not found in Intune" : relativeTime(device.lastSyncDateTime)}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

DeviceItem.displayName = "DeviceItem";

export default DeviceItem;
