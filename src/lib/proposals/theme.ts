import { THEMES, type ThemeKey } from "./types";

/**
 * Proposal colours. Preset themes are fixed palettes; the "brand" theme derives a palette from the
 * agency's own colour, darkening it when needed so headings and links stay readable on white.
 */

export type Palette = { primary: string; dark: string; soft: string };

export const BRAND_THEME = "brand";
export const THEME_KEYS: [string, ...string[]] = [BRAND_THEME, ...Object.keys(THEMES)];

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColor = (s: unknown): s is string => typeof s === "string" && HEX.test(s);

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, t: number) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio against white. */
export const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

export function paletteFromColor(color: string): Palette {
  let primary = color.toLowerCase();
  // Light colours (yellow, pastel) are darkened step by step until text in that colour is readable.
  for (let i = 0; i < 20 && contrastOnWhite(primary) < 4.5; i++) primary = mix(primary, "#000000", 0.08);
  return { primary, dark: mix(primary, "#070b18", 0.78), soft: mix(color.toLowerCase(), "#ffffff", 0.9) };
}

export function resolvePalette(theme: string, brandColor: string | null | undefined): Palette {
  if (theme === BRAND_THEME && isHexColor(brandColor)) return paletteFromColor(brandColor);
  return THEMES[theme as ThemeKey] ?? THEMES.navy;
}

export function themeLabel(theme: string) {
  return theme === BRAND_THEME ? "My brand colour" : (THEMES[theme as ThemeKey]?.label ?? theme);
}
