import { useMemo, useState } from "react";
import Icon from "@mdi/react";
import { mdiContentCopy } from "@mdi/js";
import { save } from "@tauri-apps/plugin-dialog";
import { copyText } from "../utils/clipboard";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { downloadDir, join } from "@tauri-apps/api/path";
import type { Toast } from "../types";
import { CSV_COLUMNS } from "../utils/csv";
import type { IdentifierField } from "../utils/device";
import {
  buildExportPayload,
  resolveExportScope,
  FORMATS_FOR_SCOPE,
  FORMAT_LABELS,
  type ExportFormat,
  type ExportScope,
  type ScopeContext,
} from "../utils/exportPayload";
import {
  loadCsvColumns,
  saveCsvColumns,
  loadExportFormat,
  saveExportFormat,
  loadIdentifierField,
  saveIdentifierField,
} from "../hooks/useLocalStorage";

interface ExportModalProps {
  initialScope: ExportScope;
  ctx: ScopeContext;
  /** List to offer as a scope — the right-clicked list, or the active one */
  listScopeId: string | null;
  onClose: () => void;
  showToast: (message: string, type: Toast["type"]) => void;
}

const FORMAT_ORDER: ExportFormat[] = ["csv", "plain", "lists"];

/**
 * One dialog for every export: pick what to export, pick the format, and send it to a
 * file or the clipboard. Preview, Copy and Save all read the same `ExportPayload`, so
 * what the dialog promises cannot drift from what gets written.
 */
const ExportModal = ({ initialScope, ctx, listScopeId, onClose, showToast }: ExportModalProps) => {
  const [scope, setScope] = useState<ExportScope>(initialScope);
  const [format, setFormat] = useState<ExportFormat>(() => {
    const allowed = FORMATS_FOR_SCOPE[initialScope.kind];
    const remembered = loadExportFormat();
    return allowed.includes(remembered) ? remembered : allowed[0];
  });
  const [columns, setColumns] = useState<string[]>(loadCsvColumns);
  const [field, setField] = useState<IdentifierField>(loadIdentifierField);
  const [listName, setListName] = useState("");
  const [busy, setBusy] = useState(false);

  // Stable for the life of the dialog, so the suggested filename never shifts underfoot
  const stamp = useMemo(() => new Date().toISOString(), []);

  const resolved = useMemo(() => resolveExportScope(scope, ctx), [scope, ctx]);
  const allowedFormats = FORMATS_FOR_SCOPE[scope.kind];

  const payload = useMemo(
    () =>
      buildExportPayload({
        format,
        scope: resolved,
        columns,
        identifierField: field,
        listName:
          scope.kind === "selected" || scope.kind === "visible"
            ? listName.trim() || resolved.defaultListName
            : "",
        stamp,
      }),
    [format, scope.kind, resolved, columns, field, listName, stamp]
  );

  const scopeOptions = useMemo(() => {
    const options: Array<{ scope: ExportScope; label: string; disabled: boolean }> = [
      {
        scope: { kind: "selected" },
        label: `Selected (${ctx.selected.length})`,
        disabled: ctx.selected.length === 0,
      },
    ];
    const list = listScopeId ? ctx.lists.find((l) => l.id === listScopeId) : null;
    if (list) {
      options.push({
        scope: { kind: "list", listId: list.id },
        label: `List "${list.name}"`,
        disabled: list.deviceIds.length === 0,
      });
    }
    options.push({
      scope: { kind: "visible" },
      label: `All visible (${ctx.visible.length})`,
      disabled: ctx.visible.length === 0,
    });
    if (ctx.lists.length > 0) {
      options.push({
        scope: { kind: "allLists" },
        label: `All saved lists (${ctx.lists.length})`,
        disabled: false,
      });
    }
    return options;
  }, [ctx, listScopeId]);

  /** Changing scope can invalidate the format — snap it rather than leaving a dead combo */
  const changeScope = (next: ExportScope) => {
    setScope(next);
    const allowed = FORMATS_FOR_SCOPE[next.kind];
    if (!allowed.includes(format)) setFormat(allowed[0]);
  };

  const isScopeActive = (option: ExportScope) =>
    option.kind === scope.kind &&
    (option.kind !== "list" || scope.kind !== "list" || option.listId === scope.listId);

  const toggleColumn = (key: string) =>
    setColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const blocked =
    payload.itemCount === 0 || (format === "csv" && columns.length === 0);

  const persist = () => {
    saveExportFormat(format);
    if (format === "csv") saveCsvColumns(columns);
    if (format === "plain") saveIdentifierField(field);
  };

  /** What the payload contains, so Copy and Save describe it the same way */
  const subject = () => {
    const n = payload.itemCount;
    const plural = n === 1 ? "" : "s";
    if (format === "lists") return `${n} list${plural}`;
    if (format === "plain") return `${n} identifier${plural}`;
    return `${n} device${plural}`;
  };

  const saveToFile = async () => {
    if (blocked) return;
    setBusy(true);
    try {
      // Default into Downloads: the app may only write to Documents, Downloads and
      // Desktop, so starting anywhere else invites a save the OS will refuse
      let defaultPath = payload.fileName;
      try {
        defaultPath = await join(await downloadDir(), payload.fileName);
      } catch {
        // Fall back to a bare filename and let the dialog choose the directory
      }

      const filePath = await save({
        title: "Export",
        defaultPath,
        filters: [payload.filter],
      });
      if (!filePath) return;

      await writeTextFile(filePath, payload.text);
      persist();
      showToast(`Exported ${subject()}`, "success");
      onClose();
    } catch (e) {
      showToast(
        `Export failed: ${e}. Saving is limited to Documents, Downloads and Desktop — or use Copy instead.`,
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  const copyToClipboard = async () => {
    if (blocked) return;
    setBusy(true);
    try {
      await copyText(payload.clipboardText);
      persist();
      showToast(`Copied ${subject()} to the clipboard`, "success");
    } catch (e) {
      showToast(`Could not copy: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const sample = resolved.devices[0] ?? null;
  const plainPreview = payload.text.split("\r\n").filter(Boolean).slice(0, 3);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal export-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Export</h3>

        <div className="io-field">
          <span className="io-field-label">What</span>
          <div className="io-radio-row">
            {scopeOptions.map((option) => (
              <label
                key={option.scope.kind === "list" ? `list:${option.scope.listId}` : option.scope.kind}
                className={`io-radio${option.disabled ? " disabled" : ""}`}
              >
                <input
                  type="radio"
                  checked={isScopeActive(option.scope)}
                  disabled={option.disabled}
                  onChange={() => changeScope(option.scope)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <div className="io-field">
          <span className="io-field-label">As</span>
          <div className="io-radio-row">
            {FORMAT_ORDER.map((option) => {
              const disabled = !allowedFormats.includes(option);
              return (
                <label key={option} className={`io-radio${disabled ? " disabled" : ""}`}>
                  <input
                    type="radio"
                    checked={format === option}
                    disabled={disabled}
                    onChange={() => setFormat(option)}
                  />
                  {FORMAT_LABELS[option]}
                </label>
              );
            })}
          </div>
        </div>

        <div className="export-picker">
          {format === "csv" && (
            <>
              <div className="csv-export-toolbar">
                <button className="btn-link" onClick={() => setColumns(CSV_COLUMNS.map((c) => c.key))}>
                  Select all
                </button>
                <button className="btn-link" onClick={() => setColumns([])}>
                  Clear
                </button>
                <span className="csv-export-counts">
                  {columns.length} of {CSV_COLUMNS.length} columns
                </span>
              </div>
              <div className="csv-export-columns">
                {CSV_COLUMNS.map((col) => (
                  <label key={col.key} className="csv-export-column">
                    <input
                      type="checkbox"
                      checked={columns.includes(col.key)}
                      onChange={() => toggleColumn(col.key)}
                    />
                    <span className="csv-export-column-label">{col.label}</span>
                    <span className="csv-export-column-sample">
                      {sample ? col.value(sample) : ""}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          {format === "plain" && (
            <>
              <div className="io-radio-row">
                <label className="io-radio">
                  <input
                    type="radio"
                    checked={field === "deviceName"}
                    onChange={() => setField("deviceName")}
                  />
                  Device name
                </label>
                <label className="io-radio">
                  <input
                    type="radio"
                    checked={field === "serialNumber"}
                    onChange={() => setField("serialNumber")}
                  />
                  Serial number
                </label>
              </div>
              <div className="export-preview">
                {plainPreview.length === 0 ? (
                  <span className="export-preview-empty">Nothing to export</span>
                ) : (
                  <>
                    {plainPreview.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                    {payload.itemCount > plainPreview.length && (
                      <div className="export-preview-more">
                        … {payload.itemCount - plainPreview.length} more
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {format === "lists" && (
            <>
              {scope.kind === "selected" || scope.kind === "visible" ? (
                <label className="io-inline-field">
                  List name
                  <input
                    className="io-text-input"
                    type="text"
                    value={listName}
                    onChange={(e) => setListName(e.target.value)}
                    placeholder={resolved.defaultListName}
                  />
                </label>
              ) : (
                <p className="export-static">
                  {resolved.lists.length === 1
                    ? `Writes "${resolved.lists[0].name}" exactly as saved.`
                    : `Writes all ${resolved.lists.length} saved lists exactly as saved.`}
                </p>
              )}
            </>
          )}
        </div>

        {payload.note && <p className="export-note">{payload.note}</p>}

        <div className="modal-actions">
          <button
            className="btn-secondary export-copy"
            onClick={copyToClipboard}
            disabled={blocked || busy}
          >
            <Icon path={mdiContentCopy} size={0.6} />
            Copy
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={saveToFile} disabled={blocked || busy}>
            Save…
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
