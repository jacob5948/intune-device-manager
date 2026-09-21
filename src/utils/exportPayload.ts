import type { DeviceInfo, DeviceList } from "../types";
import { buildDeviceCsv } from "./csv";
import { buildIdentifierList, type IdentifierField } from "./device";
import { buildListFile, type ExportableList } from "./listFile";

export type ExportFormat = "csv" | "plain" | "lists";

export type ExportScope =
  | { kind: "selected" }
  | { kind: "visible" }
  | { kind: "list"; listId: string }
  | { kind: "allLists" };

export type ExportScopeKind = ExportScope["kind"];

/**
 * Which formats each scope can produce.
 *
 * A device-shaped scope can still write a saved-list file — that is "save my current
 * selection as a list I can restore later", which is worth having. The reverse is not
 * true: flattening every saved list into one device CSV would throw away the list
 * membership that was the only reason to pick that scope.
 */
export const FORMATS_FOR_SCOPE: Record<ExportScopeKind, ExportFormat[]> = {
  selected: ["csv", "plain", "lists"],
  visible: ["csv", "plain", "lists"],
  list: ["csv", "plain", "lists"],
  allLists: ["lists"],
};

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "Device details (CSV)",
  plain: "Plain list (TXT)",
  lists: "Saved lists (JSON)",
};

const MISSING_PREFIX = "missing:";

const byName = (a: DeviceInfo, b: DeviceInfo) =>
  a.deviceName.localeCompare(b.deviceName, undefined, { sensitivity: "base" });

export interface ScopeContext {
  selected: DeviceInfo[];
  /** Currently filtered view, with the [Not found] placeholders already removed */
  visible: DeviceInfo[];
  allDevices: DeviceInfo[];
  lists: DeviceList[];
}

export interface ResolvedScope {
  /** Devices this scope covers, name-sorted */
  devices: DeviceInfo[];
  lists: ExportableList[];
  /** Tokens of list entries never found in Intune — preserved in a plain list export */
  unresolvedTokens: string[];
  /** Ids referenced by a list with no loaded device behind them */
  danglingIds: string[];
  label: string;
  defaultListName: string;
}

/** Resolve a scope against the current app state. Pure — all inputs come from `ctx`. */
export const resolveExportScope = (scope: ExportScope, ctx: ScopeContext): ResolvedScope => {
  const emptyList = (name: string, devices: DeviceInfo[]): ExportableList[] => [
    { name, color: null, deviceIds: devices.map((d) => d.id) },
  ];

  if (scope.kind === "selected" || scope.kind === "visible") {
    const devices = [...(scope.kind === "selected" ? ctx.selected : ctx.visible)].sort(byName);
    const defaultListName = scope.kind === "selected" ? "Selected devices" : "Visible devices";
    return {
      devices,
      lists: emptyList(defaultListName, devices),
      unresolvedTokens: [],
      danglingIds: [],
      label: `${scope.kind === "selected" ? "Selected" : "All visible"} (${devices.length})`,
      defaultListName,
    };
  }

  if (scope.kind === "list") {
    const list = ctx.lists.find((l) => l.id === scope.listId);
    if (!list) {
      return {
        devices: [], lists: [], unresolvedTokens: [], danglingIds: [],
        label: "List (unavailable)", defaultListName: "List",
      };
    }
    const byId = new Map(ctx.allDevices.map((d) => [d.id, d]));
    const devices: DeviceInfo[] = [];
    const unresolvedTokens: string[] = [];
    const danglingIds: string[] = [];
    for (const id of list.deviceIds) {
      if (id.startsWith(MISSING_PREFIX)) {
        unresolvedTokens.push(id.substring(MISSING_PREFIX.length));
        continue;
      }
      const device = byId.get(id);
      if (device) devices.push(device);
      else danglingIds.push(id);
    }
    devices.sort(byName);
    return {
      devices,
      lists: [{ name: list.name, color: list.color ?? null, deviceIds: list.deviceIds }],
      unresolvedTokens,
      danglingIds,
      label: `List "${list.name}" (${devices.length})`,
      defaultListName: list.name,
    };
  }

  // allLists
  const byId = new Map(ctx.allDevices.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const devices: DeviceInfo[] = [];
  const unresolvedTokens: string[] = [];
  const danglingIds: string[] = [];
  for (const list of ctx.lists) {
    for (const id of list.deviceIds) {
      if (id.startsWith(MISSING_PREFIX)) {
        unresolvedTokens.push(id.substring(MISSING_PREFIX.length));
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      const device = byId.get(id);
      if (device) devices.push(device);
      else danglingIds.push(id);
    }
  }
  devices.sort(byName);
  return {
    devices,
    lists: ctx.lists.map((l) => ({ name: l.name, color: l.color ?? null, deviceIds: l.deviceIds })),
    unresolvedTokens,
    danglingIds,
    label: `All saved lists (${ctx.lists.length})`,
    defaultListName: "Device lists",
  };
};

export interface ExportPayload {
  /** What goes to disk — a detail CSV keeps its BOM so Excel behaves */
  text: string;
  /** What goes to the clipboard — never BOM-prefixed */
  clipboardText: string;
  fileName: string;
  filter: { name: string; extensions: string[] };
  /** Rows, lines, or lists, depending on the format */
  itemCount: number;
  /** Anything the user should know before hitting Save */
  note: string | null;
}

const sanitize = (name: string): string =>
  name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "export";

export interface ExportPayloadInput {
  format: ExportFormat;
  scope: ResolvedScope;
  columns: string[];
  identifierField: IdentifierField;
  /** Name for the list invented when a device-shaped scope is exported as JSON.
   *  Empty for a real saved list, which keeps its own name. */
  listName: string;
  /** ISO timestamp, injected so this stays pure and testable */
  stamp: string;
}

/**
 * Turn a resolved scope plus a format into the exact bytes to write, the filename to
 * suggest, and the caveat to show. The modal's preview, its Copy button and its Save
 * button all read one of these, so what is previewed cannot drift from what is written.
 */
export const buildExportPayload = (input: ExportPayloadInput): ExportPayload => {
  const { format, scope, columns, identifierField, listName, stamp } = input;
  const date = stamp.slice(0, 10);
  const slug = sanitize(scope.defaultListName);

  const omitted = scope.unresolvedTokens.length + scope.danglingIds.length;
  const omittedNote =
    omitted > 0
      ? `${omitted} entr${omitted === 1 ? "y" : "ies"} in this list ${
          omitted === 1 ? "is" : "are"
        } not in Intune and ${omitted === 1 ? "is" : "are"} omitted`
      : null;

  if (format === "csv") {
    const text = buildDeviceCsv(scope.devices, columns, { bom: true });
    return {
      text,
      clipboardText: buildDeviceCsv(scope.devices, columns, { bom: false }),
      fileName: `${slug}-${date}.csv`,
      filter: { name: "CSV", extensions: ["csv"] },
      itemCount: scope.devices.length,
      note: omittedNote,
    };
  }

  if (format === "plain") {
    // Unmatched list entries go out verbatim, so exporting and re-importing a partly
    // unmatched list preserves it rather than quietly shrinking it
    const result = buildIdentifierList(scope.devices, identifierField, scope.unresolvedTokens);
    const notes: string[] = [];
    if (result.skipped > 0) {
      notes.push(
        `${result.skipped} device${result.skipped === 1 ? "" : "s"} ${
          result.skipped === 1 ? "has" : "have"
        } no ${identifierField === "serialNumber" ? "serial number" : "name"} and ${
          result.skipped === 1 ? "is" : "are"
        } skipped`
      );
    }
    if (scope.danglingIds.length > 0) {
      notes.push(
        `${scope.danglingIds.length} entr${
          scope.danglingIds.length === 1 ? "y" : "ies"
        } not in Intune omitted`
      );
    }
    const suffix = identifierField === "serialNumber" ? "serials" : "names";
    return {
      text: result.text,
      clipboardText: result.text,
      fileName: `${slug}-${suffix}-${date}.txt`,
      filter: { name: "Text", extensions: ["txt"] },
      itemCount: result.written,
      note: notes.length > 0 ? notes.join(" · ") : null,
    };
  }

  // Saved lists (JSON). A name is only supplied for a device-shaped scope, where the
  // list is one this dialog is inventing; a real saved list keeps the name it has.
  const lists: ExportableList[] =
    listName.trim() && scope.lists.length === 1
      ? [{ ...scope.lists[0], name: listName.trim() }]
      : scope.lists;
  const text = buildListFile(lists, scope.devices, stamp);
  const totalDevices = lists.reduce((n, l) => n + l.deviceIds.length, 0);
  const fileName =
    lists.length === 1 ? `${sanitize(lists[0].name)}.json` : "intune-device-lists.json";
  return {
    text,
    clipboardText: text,
    fileName,
    filter: { name: "JSON", extensions: ["json"] },
    itemCount: lists.length,
    note:
      totalDevices > 0
        ? `${lists.length} list${lists.length === 1 ? "" : "s"} · ${totalDevices} device${
            totalDevices === 1 ? "" : "s"
          } — re-imported by name and serial`
        : null,
  };
};
