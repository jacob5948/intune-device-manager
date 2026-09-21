import { useMemo, useState } from "react";
import Icon from "@mdi/react";
import { mdiFileUploadOutline, mdiAlertOutline } from "@mdi/js";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { DeviceInfo, DeviceList, Toast } from "../types";
import { matchIdentifiers } from "../utils/device";
import { resolveListDevices } from "../utils/listFile";
import { sniffImportText, fileBaseName } from "../utils/importSource";
import { copyText } from "../utils/clipboard";

/** What the modal hands back to App, which owns all list mutation */
export type ImportPlan =
  | { kind: "newList"; name: string; deviceIds: string[] }
  | { kind: "existingList"; listId: string; deviceIds: string[] }
  | {
      kind: "restoreLists";
      lists: Array<{ name: string; color?: string | null; deviceIds: string[] }>;
    };

type ImportDest =
  | { kind: "restore" }
  | { kind: "new"; name: string }
  | { kind: "existing"; listId: string };

interface ImportModalProps {
  devices: DeviceInfo[];
  lists: DeviceList[];
  onCommit: (plan: ImportPlan, matched: number, unresolved: string[]) => void;
  onClose: () => void;
  showToast: (message: string, type: Toast["type"]) => void;
}

const MISSING_PREFIX = "missing:";

/**
 * One dialog for every import: paste identifiers or open a file, see what matches before
 * committing, and choose where the result lands.
 *
 * What the input *is* — a saved-list export, a column of service tags, a list of device
 * names — is decided by reading it, not by its file extension.
 */
const ImportModal = ({ devices, lists, onCommit, onClose, showToast }: ImportModalProps) => {
  const [text, setText] = useState("");
  /** Full file contents, kept so changing the CSV column can re-extract from it */
  const [rawFile, setRawFile] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [columnIndex, setColumnIndex] = useState<number | null>(null);
  const [perLine, setPerLine] = useState(false);
  const [dest, setDest] = useState<ImportDest>({ kind: "new", name: "" });
  const [reviewed, setReviewed] = useState<string[] | null>(null);

  const source = useMemo(
    () =>
      sniffImportText(rawFile ?? text, {
        columnIndex,
        // Every row of a file is already one identifier; only free text is ambiguous
        perLine: rawFile !== null || perLine,
      }),
    [rawFile, text, columnIndex, perLine]
  );

  const resolution = useMemo(() => {
    if (source.kind === "lists") {
      const resolvedLists = source.lists.map((list) => {
        const { deviceIds, unresolved } = resolveListDevices(list.devices, devices, {
          // A v1 file always wrote a name, often the literal "Unknown", so matching on
          // it first would silently change how existing files import
          preferId: source.legacyListFile,
        });
        return { name: list.name, color: list.color ?? null, deviceIds, unresolved };
      });
      const deviceIds = resolvedLists.flatMap((l) => l.deviceIds);
      return {
        kind: "lists" as const,
        lists: resolvedLists,
        total: deviceIds.length,
        matched: deviceIds.filter((id) => !id.startsWith(MISSING_PREFIX)).length,
        unresolved: resolvedLists.flatMap((l) => l.unresolved),
      };
    }

    const { matchedIds, unmatched } = matchIdentifiers(devices, source.identifiers);
    return {
      kind: "identifiers" as const,
      lists: [],
      total: source.identifiers.length,
      matched: matchedIds.length,
      unresolved: unmatched,
      deviceIds: [...matchedIds, ...unmatched.map((t) => `${MISSING_PREFIX}${t}`)],
    };
  }, [source, devices]);

  const clearFile = () => {
    setRawFile(null);
    setFileLabel(null);
    setColumnIndex(null);
  };

  const openFile = async () => {
    try {
      const filePath = await open({
        title: "Open a device list",
        filters: [
          { name: "Device lists", extensions: ["txt", "csv", "json"] },
          { name: "All files", extensions: ["*"] },
        ],
        multiple: false,
      });
      if (!filePath) return;

      const contents = await readTextFile(filePath as string);
      const base = fileBaseName(filePath as string);
      const sniffed = sniffImportText(contents, { perLine: true });

      if (sniffed.kind === "unknown") {
        showToast(sniffed.message ?? "That file could not be read as a device list", "error");
        return;
      }

      setRawFile(contents);
      setFileLabel((filePath as string).split(/[/\\]/).pop() ?? base);
      setColumnIndex(null);
      setText(sniffed.text);
      setReviewed(null);

      if (sniffed.kind === "lists") {
        setDest(
          sniffed.lists.length > 1
            ? { kind: "restore" }
            : { kind: "new", name: sniffed.lists[0]?.name ?? base }
        );
      } else {
        setDest((prev) =>
          prev.kind === "new" && prev.name.trim().length === 0 ? { kind: "new", name: base } : prev
        );
      }
    } catch (e) {
      showToast(`Could not read file: ${e}`, "error");
    }
  };

  const changeColumn = (index: number) => {
    setColumnIndex(index);
    setReviewed(null);
    if (rawFile) setText(sniffImportText(rawFile, { columnIndex: index, perLine: true }).text);
  };

  const editText = (value: string) => {
    // Hand-editing takes over from the loaded file, so the chip and column no longer apply
    clearFile();
    setText(value);
    setReviewed(null);
  };

  const runImport = () => {
    if (resolution.total === 0) return;

    let plan: ImportPlan;
    if (resolution.kind === "lists" && dest.kind === "restore") {
      plan = {
        kind: "restoreLists",
        lists: resolution.lists.map(({ name, color, deviceIds }) => ({ name, color, deviceIds })),
      };
    } else {
      const deviceIds =
        resolution.kind === "lists"
          ? resolution.lists.flatMap((l) => l.deviceIds)
          : resolution.deviceIds;

      if (dest.kind === "existing") {
        plan = { kind: "existingList", listId: dest.listId, deviceIds };
      } else {
        const name = (dest.kind === "new" ? dest.name : "").trim();
        if (!name) {
          showToast("List name is required", "error");
          return;
        }
        plan = { kind: "newList", name, deviceIds };
      }
    }

    onCommit(plan, resolution.matched, resolution.unresolved);

    // Stay open when something did not match, so the tags can be reviewed and copied
    if (resolution.unresolved.length > 0) setReviewed(resolution.unresolved);
    else onClose();
  };

  const copyUnresolved = async () => {
    if (!reviewed) return;
    try {
      await copyText(reviewed.join("\n"));
      showToast("Copied to clipboard", "success");
    } catch {
      showToast("Could not copy to clipboard", "error");
    }
  };

  const showListSummary = source.kind === "lists";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import Devices</h3>
        <p className="io-hint">
          Paste device names or serial numbers — one per line, or separated by commas. Or
          open a .txt, .csv or .json file; what it contains is worked out by reading it,
          not from its name.
        </p>

        {showListSummary ? (
          <div className="import-summary">
            <div className="import-summary-head">
              {fileLabel ?? "Saved device lists"}
              {source.legacyListFile && <span className="import-summary-tag">older format</span>}
            </div>
            {resolution.lists.map((list) => (
              <div key={list.name} className="import-summary-row">
                <span>{list.name}</span>
                <span className="import-summary-count">
                  {list.deviceIds.length} device{list.deviceIds.length === 1 ? "" : "s"}
                  {list.unresolved.length > 0 && ` · ${list.unresolved.length} not found`}
                </span>
              </div>
            ))}
            <button className="btn-link" onClick={() => { clearFile(); setText(""); }}>
              Paste text instead
            </button>
          </div>
        ) : (
          <textarea
            className="io-textarea"
            value={text}
            onChange={(e) => editText(e.target.value)}
            placeholder={"7XKQ2H3\n9PLM4K2\nOU-LAB-01"}
            spellCheck={false}
            autoFocus
          />
        )}

        {source.table && (
          <div className={`import-chip${source.columnAutoDetected ? "" : " import-chip-warn"}`}>
            {!source.columnAutoDetected && <Icon path={mdiAlertOutline} size={0.6} />}
            <span>
              {source.columnAutoDetected
                ? "Reading column"
                : "No identifier column named in the header — using"}
            </span>
            <select
              className="io-select import-column-select"
              value={source.columnIndex ?? 0}
              onChange={(e) => changeColumn(Number(e.target.value))}
            >
              {source.table.headers.map((header, i) => (
                <option key={i} value={i}>
                  {header || `Column ${i + 1}`}
                  {source.table?.rows[0]?.[i] ? ` — ${source.table.rows[0][i]}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {source.kind === "unknown" && <p className="import-error">{source.message}</p>}

        <div className="io-status">
          <button className="btn-link" onClick={openFile}>
            <Icon path={mdiFileUploadOutline} size={0.6} />
            Open file…
          </button>
          {!showListSummary && (
            <label className="io-radio io-checkbox">
              <input
                type="checkbox"
                checked={perLine || rawFile !== null}
                disabled={rawFile !== null}
                onChange={(e) => setPerLine(e.target.checked)}
              />
              One per line
            </label>
          )}
          <span className="io-counts">
            {resolution.total} entered · <strong>{resolution.matched}</strong> matched ·{" "}
            {resolution.unresolved.length} not found
          </span>
        </div>

        <div className="io-field">
          <span className="io-field-label">Add to</span>
          <div className="io-radio-row">
            {showListSummary && resolution.lists.length > 1 && (
              <label className="io-radio">
                <input
                  type="radio"
                  checked={dest.kind === "restore"}
                  onChange={() => setDest({ kind: "restore" })}
                />
                Restore {resolution.lists.length} lists
              </label>
            )}
            <label className="io-radio">
              <input
                type="radio"
                checked={dest.kind === "new"}
                onChange={() => setDest({ kind: "new", name: "" })}
              />
              New list
            </label>
            {dest.kind === "new" && (
              <input
                className="io-text-input"
                type="text"
                value={dest.name}
                onChange={(e) => setDest({ kind: "new", name: e.target.value })}
                placeholder="List name"
              />
            )}
            {lists.length > 0 && (
              <>
                <label className="io-radio">
                  <input
                    type="radio"
                    checked={dest.kind === "existing"}
                    onChange={() => setDest({ kind: "existing", listId: lists[0].id })}
                  />
                  Add to existing
                </label>
                {dest.kind === "existing" && (
                  <select
                    className="io-select"
                    value={dest.listId}
                    onChange={(e) => setDest({ kind: "existing", listId: e.target.value })}
                  >
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
          </div>
        </div>

        {reviewed && reviewed.length > 0 && (
          <div className="io-unmatched">
            <div className="io-unmatched-head">
              <span>Not found in Intune ({reviewed.length})</span>
              <button className="btn-link" onClick={copyUnresolved}>
                Copy
              </button>
            </div>
            <div className="io-unmatched-list">
              {reviewed.map((tag) => (
                <div key={tag} className="io-unmatched-item">
                  {tag}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            {reviewed ? "Close" : "Cancel"}
          </button>
          <button
            className="btn-primary"
            disabled={resolution.total === 0 || reviewed !== null}
            onClick={runImport}
          >
            Import {resolution.total || ""}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportModal;
