// Readable tag colours for a list colour the user picked.
//
// A device row's list tag draws the list colour as text on a faint tint of
// itself. A light colour such as yellow fails contrast there, so the text is
// mixed toward black (light scheme) or white (dark scheme) until it reaches
// 4.5:1 against the tint on the row's hover background, its darkest state.

type Rgb = [number, number, number];

export interface TagColors {
  light: { bg: string; fg: string };
  dark: { bg: string; fg: string };
}

const TINT_ALPHA = 0.125;
const MIN_CONTRAST = 4.5;
const LIGHT_ROW: Rgb = [0xf0, 0xf0, 0xf5]; // .device-item:hover
const DARK_ROW: Rgb = [0x3a, 0x3a, 0x3c]; // .device-item:hover, dark

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  a.map((v, i) => Math.round(v + (b[i] - v) * t)) as Rgb;

function luminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const toHex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function readableOn(color: Rgb, row: Rgb, toward: Rgb): { bg: string; fg: string } {
  const bg = mix(row, color, TINT_ALPHA);
  let fg = color;
  for (let t = 0.05; contrast(fg, bg) < MIN_CONTRAST && t <= 1; t += 0.05) {
    fg = mix(color, toward, t);
  }
  return { bg: `rgba(${color.join(", ")}, ${TINT_ALPHA})`, fg: toHex(fg) };
}

const cache = new Map<string, TagColors | null>();

/** Tint and text colours for each scheme, or null when the colour isn't a hex value. */
export function tagColors(hex: string): TagColors | null {
  if (!cache.has(hex)) {
    const color = parseHex(hex);
    cache.set(hex, color && {
      light: readableOn(color, LIGHT_ROW, [0, 0, 0]),
      dark: readableOn(color, DARK_ROW, [255, 255, 255]),
    });
  }
  return cache.get(hex)!;
}
