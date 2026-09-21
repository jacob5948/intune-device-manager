import Icon from "@mdi/react";
import { mdiClose, mdiDownload } from "@mdi/js";
import type { AppUpdate } from "../hooks/useAppUpdate";

/**
 * Strip above the device list when a newer build is waiting. Only rendered for
 * the states worth interrupting for — a silent failed check stays invisible.
 */
const UpdateBanner = ({ update }: { update: AppUpdate }) => {
  const { status, newVersion, progress, installUpdate, dismiss } = update;

  if (status !== "available" && status !== "downloading" && status !== "ready") {
    return null;
  }

  const percent = progress === null ? null : Math.round(progress * 100);

  return (
    <div className="update-banner">
      <div className="update-banner-text">
        <Icon path={mdiDownload} size={0.7} />
        {status === "available" && (
          <span>
            Version <strong>{newVersion}</strong> is available.
          </span>
        )}
        {status === "downloading" && (
          <span>
            Downloading {newVersion}
            {percent !== null ? ` — ${percent}%` : "…"}
          </span>
        )}
        {status === "ready" && <span>Update installed — restarting…</span>}
      </div>

      {status === "downloading" && percent !== null && (
        <div className="update-banner-progress">
          <div className="update-banner-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      )}

      {status === "available" && (
        <div className="update-banner-actions">
          <button className="btn-primary btn-small" onClick={installUpdate}>
            Install and restart
          </button>
          <button className="update-banner-close" onClick={dismiss} title="Not now">
            <Icon path={mdiClose} size={0.6} />
          </button>
        </div>
      )}
    </div>
  );
};

export default UpdateBanner;
