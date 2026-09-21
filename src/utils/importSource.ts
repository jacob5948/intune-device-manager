import {
  analyzeCsvIdentifiers,
  extractIdentifierText,
  guessIdentifierColumn,
  identifierColumnText,
  stripBom,
  type CsvIdentifierSource,
} from "./csv";
import { parseIdentifiers } from "./device";
import { parseListFile, type ListFileList } from "./listFile";

export type ImportKind = "identifiers" | "lists" | "empty" | "unknown";

export interface ImportSource {
  kind: ImportKind;
  /** Identifier text as it should appear in the textarea */
  text: string;
  identifiers: string[];
  lists: ListFileList[];
  legacyListFile: boolean;
  /** Set when the input parsed as a multi-column table, so a column can be re-picked */
  table: CsvIdentifierSource | null;
  columnIndex: number | null;
  /** False when the column was guessed rather than named by a header — say so in the UI */
  columnAutoDetected: boolean;
  /** Why the input could not be used, when `kind` is "unknown" */
  message: string | null;
}

const EMPTY: Omit<ImportSource, "kind" | "text" | "message"> = {
  identifiers: [],
  lists: [],
  legacyListFile: false,
  table: null,
  columnIndex: null,
  columnAutoDetected: true,
};

export interface SniffOptions {
  /** Override the identifier column of a multi-column file */
  columnIndex?: number | null;
  /** Treat free text as one identifier per line, so names with spaces survive */
  perLine?: boolean;
}

/**
 * Work out what a blob of pasted or file text actually *is*, by content rather than by
 * filename — a saved-list export, a list of identifiers, or something unusable.
 *
 * Replaces the old `filePath.split(".").pop()` dispatch, which parsed a saved list named
 * `.txt` as identifiers and threw on a serial list named `.json`.
 */
export const sniffImportText = (
  contents: string,
  options: SniffOptions = {}
): ImportSource => {
  const { columnIndex = null, perLine = false } = options;
  const body = stripBom(contents).replace(/\r\n/g, "\n");

  if (body.trim().length === 0) {
    return { kind: "empty", text: "", message: null, ...EMPTY };
  }

  // ── JSON: a saved-list export, or a plain array of identifiers ──
  const head = body.trimStart();
  if (head.startsWith("{") || head.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return {
        kind: "unknown",
        text: "",
        message: "That looks like JSON but could not be parsed.",
        ...EMPTY,
      };
    }

    const listFile = parseListFile(parsed);
    if (listFile) {
      return {
        kind: "lists",
        text: "",
        message: null,
        ...EMPTY,
        lists: listFile.lists,
        legacyListFile: listFile.legacy,
      };
    }

    // A hand-rolled ["TAG1","TAG2"] is a reasonable thing to paste
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      const text = (parsed as string[]).join("\n");
      return {
        kind: "identifiers",
        text,
        message: null,
        ...EMPTY,
        identifiers: parseIdentifiers(text, { perLine: true }),
      };
    }

    return {
      kind: "unknown",
      text: "",
      message: "That JSON file is not a device list export.",
      ...EMPTY,
    };
  }

  // ── Multi-column table: pull identifiers out of one column ──
  const table = analyzeCsvIdentifiers(body);
  if (table) {
    const detected = table.autoColumn;
    const column = columnIndex ?? detected ?? guessIdentifierColumn(table);
    const text = identifierColumnText(table, column);
    return {
      kind: "identifiers",
      text,
      message: null,
      ...EMPTY,
      // Each row is already one identifier, so never whitespace-split these
      identifiers: parseIdentifiers(text, { perLine: true }),
      table,
      columnIndex: column,
      columnAutoDetected: detected !== null,
    };
  }

  // ── Plain token list, or a single column with a header ──
  const text = extractIdentifierText(body);
  return {
    kind: "identifiers",
    text,
    message: null,
    ...EMPTY,
    identifiers: parseIdentifiers(text, { perLine }),
  };
};

/** File name without its directory or extension. Splits on both separators, unlike the
 *  old `.split("/")`, which produced a full Windows path as a list name. */
export const fileBaseName = (path: string): string => {
  const base = path.split(/[/\\]/).pop() ?? "";
  return base.replace(/\.[^.]+$/, "");
};
