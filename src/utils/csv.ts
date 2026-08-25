/** Split a single CSV line into fields, honouring quoted fields and "" escapes */
export const parseCsvLine = (line: string): string[] => {
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

const SERIAL_HEADERS = [/serial/, /service\s*tag/, /asset\s*tag/];
const NAME_HEADERS = [/device\s*name/, /computer\s*name/, /host\s*name/, /^name$/];

/**
 * Pull device identifiers out of a text or CSV file.
 *
 * When the first line looks like a CSV header containing a serial/service-tag (or
 * device-name) column, only that column is returned — so a Dell TechDirect export can be
 * used as-is. Otherwise the whole file is returned for token-splitting.
 */
export const extractIdentifierText = (contents: string): string => {
  const lines = contents.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return contents;

  const header = parseCsvLine(lines[0]).map((h) =>
    h.trim().toLowerCase().replace(/['"]/g, "")
  );

  const findCol = (patterns: RegExp[]) =>
    header.findIndex((h) => patterns.some((p) => p.test(h)));

  if (header.length < 2) {
    // Single column: drop the first line if it is a header rather than an identifier
    const isHeader = findCol(SERIAL_HEADERS) >= 0 || findCol(NAME_HEADERS) >= 0;
    return isHeader ? lines.slice(1).join("\n") : contents;
  }

  const col = (() => {
    const serial = findCol(SERIAL_HEADERS);
    return serial >= 0 ? serial : findCol(NAME_HEADERS);
  })();
  if (col < 0) return contents;

  return lines
    .slice(1)
    .map((line) => parseCsvLine(line)[col]?.trim() ?? "")
    .filter((v) => v.length > 0)
    .join("\n");
};
