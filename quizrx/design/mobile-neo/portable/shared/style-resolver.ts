import type { StyleSnapshot } from './resources.ts';
import { appearanceCss } from './style-appearance.ts';

export type RGB = [number, number, number];

export function parseRgb(value: unknown): RGB | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();

  // 1. Hex parsing (#RGB, #RRGGBB, #RGBA where A=f, #RRGGBBAA where AA=ff)
  const hexMatch = s.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    if (hex.length === 4 && hex[3].toLowerCase() !== 'f') return undefined;
    if (hex.length === 8 && hex.slice(6, 8).toLowerCase() !== 'ff') return undefined;
    const expanded = hex.length <= 4 ? [...hex.slice(0, 3)].map((part) => part + part).join('') : hex.slice(0, 6);
    return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16)) as RGB;
  }

  // 2. rgb(r, g, b) / rgba(r, g, b, 1) parsing
  const rgbMatch = s.match(/^(rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+|1\.0+))?\s*\)$/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[2]!, 10);
    const g = parseInt(rgbMatch[3]!, 10);
    const b = parseInt(rgbMatch[4]!, 10);
    if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) return undefined;
    const isRgba = rgbMatch[1]!.toLowerCase() === 'rgba';
    if (isRgba !== (rgbMatch[5] !== undefined)) return undefined;
    if (rgbMatch[5] !== undefined && Number(rgbMatch[5]) !== 1) return undefined;
    return [r, g, b];
  }
  return undefined;
}

export function rgbToHex([r, g, b]: RGB): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function luminance(value: RGB): number {
  const [r, g, b] = value.map((channel) => {
    const linear = channel / 255;
    return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(foreground: string, background: string): number | undefined {
  const fg = parseRgb(foreground);
  const bg = parseRgb(background);
  if (!fg || !bg) return undefined;
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function bestBlackOrWhite(background: string): '#000000' | '#FFFFFF' {
  const bg = parseRgb(background);
  if (!bg) return '#000000';
  const crBlack = contrastRatio('#000000', background);
  const crWhite = contrastRatio('#FFFFFF', background);
  if (crBlack === undefined || crWhite === undefined) return '#000000';
  return crBlack >= crWhite ? '#000000' : '#FFFFFF';
}

function blend(fg: RGB, bg: RGB, alpha: number): RGB {
  return fg.map((channel, index) => channel * alpha + bg[index]! * (1 - alpha)) as RGB;
}

/** Known points on the authored backdrop plus translucent surfaces composited over them. */
function knownTextBackgrounds(snapshot: StyleSnapshot): string[] | undefined {
  const { tokens } = snapshot;
  const base = parseRgb(tokens.background);
  const surface = parseRgb(tokens.surface);
  if (!base || !surface) return undefined;
  const stops = snapshot.parserVersion === 2 && snapshot.appearance && snapshot.appearance.background.type !== 'solid'
    ? snapshot.appearance.background.stops.map(stop => parseRgb(stop.color))
    : [];
  if (stops.some(stop => !stop)) return undefined;
  const backgrounds = [base, ...(stops as RGB[])];
  const opacity = snapshot.parserVersion === 2 && snapshot.appearance ? snapshot.appearance.surfaceOpacity : 1;
  return [...backgrounds, ...backgrounds.map(bg => blend(surface, bg, opacity)), surface].map(rgbToHex);
}

function ensureAgainstKnownBackgrounds(color: string, backgrounds: string[] | undefined, fallbackColor: string): string {
  if (!backgrounds?.length || !parseRgb(color)) return color;
  let candidate = color;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const background of backgrounds) {
      if ((contrastRatio(candidate, background) ?? 0) < 4.5) {
        candidate = ensureContrast(candidate, background, 4.5, fallbackColor);
        changed = true;
      }
    }
    if (!changed) return candidate;
  }
  return backgrounds.every(background => (contrastRatio(candidate, background) ?? 0) >= 4.5) ? candidate : fallbackColor;
}

/**
 * Ensures color has at least targetRatio contrast against background.
 * If contrast is already >= targetRatio, color is returned unchanged (preserving style fidelity).
 * Otherwise, color is shifted towards white or black (preserving original hue) until targetRatio is met.
 */
export function ensureContrast(
  color: string,
  background: string,
  targetRatio: number,
  fallback?: string
): string {
  const fg = parseRgb(color);
  const bg = parseRgb(background);
  if (!fg || !bg) return fallback ?? color;
  const currentRatio = contrastRatio(color, background);
  if (currentRatio !== undefined && currentRatio >= targetRatio) return color;

  const whiteContrast = contrastRatio('#ffffff', background) ?? 1;
  const blackContrast = contrastRatio('#000000', background) ?? 1;

  let targetChannel: number;
  if (whiteContrast >= targetRatio && blackContrast < targetRatio) {
    targetChannel = 255;
  } else if (blackContrast >= targetRatio && whiteContrast < targetRatio) {
    targetChannel = 0;
  } else if (whiteContrast < targetRatio && blackContrast < targetRatio) {
    targetChannel = whiteContrast >= blackContrast ? 255 : 0;
  } else {
    const fgLum = luminance(fg);
    const bgLum = luminance(bg);
    targetChannel = fgLum >= bgLum ? 255 : 0;
  }
  const targetRgb: RGB = [targetChannel, targetChannel, targetChannel];

  let low = 0;
  let high = 1;
  let bestHex = rgbToHex(targetRgb);

  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    const candidateRgb: RGB = [
      fg[0] + (targetRgb[0] - fg[0]) * mid,
      fg[1] + (targetRgb[1] - fg[1]) * mid,
      fg[2] + (targetRgb[2] - fg[2]) * mid,
    ];
    const candidateHex = rgbToHex(candidateRgb);
    const cr = contrastRatio(candidateHex, background);
    if (cr !== undefined && cr >= targetRatio) {
      bestHex = candidateHex;
      high = mid;
    } else {
      low = mid;
    }
  }

  return bestHex;
}

/** Turns a saved, validated style snapshot into the CSS variables used by the demo renderer. */
export function resolveStyle(snapshot?: StyleSnapshot): Record<string, string | number> {
  if (!snapshot) return {};
  const { tokens } = snapshot;

  const surface = tokens.surface;
  const bg = tokens.background;
  const primary = tokens.primary;
  const border = tokens.borderColor;
  const text = tokens.text;
  const muted = tokens.muted;

  const parsedSurface = parseRgb(surface);
  const parsedBg = parseRgb(bg);
  const parsedPrimary = parseRgb(primary);

  // 1. Soft container background: subtle distinction from surface when surface and bg are identical
  const isIdenticalSurfaceBg = parsedSurface && parsedBg && (contrastRatio(surface, bg) ?? 99) < 1.05;
  const soft = isIdenticalSurfaceBg
    ? ensureContrast(surface, surface, 1.15, `color-mix(in srgb, ${tokens.surface} 68%, ${tokens.background})`)
    : `color-mix(in srgb, ${tokens.surface} 68%, ${tokens.background})`;

  // Derive display variables across known root and translucent surface backgrounds; saved tokens stay untouched.
  const textBackgrounds = knownTextBackgrounds(snapshot);
  const textFallback = parsedBg ? bestBlackOrWhite(bg) : bestBlackOrWhite(surface);
  const derivedText = ensureAgainstKnownBackgrounds(text, textBackgrounds, textFallback);
  const derivedMuted = ensureAgainstKnownBackgrounds(muted, textBackgrounds, textFallback);

  // 3. Progress track: must have non-text contrast >= 3.0 against primary fill
  let progressTrack = soft;
  if (parsedPrimary && parsedSurface) {
    const trackBase = parseRgb(soft) ? soft : surface;
    const crTrack = contrastRatio(trackBase, primary);
    if (crTrack !== undefined && crTrack < 3.0) {
      const primaryLum = luminance(parsedPrimary);
      const targetChannel = primaryLum < 0.4 ? 255 : 0;
      progressTrack = ensureContrast(trackBase, primary, 3.0, targetChannel === 255 ? '#ffffff' : '#000000');
    }
  }

  // 4. Control border (unselected checkbox / radio / task / habit): contrast >= 3.0 against surface
  const controlBorder = ensureContrast(border, surface, 3.0, bestBlackOrWhite(surface));

  // 5. Star visuals: selected star vs unselected star must not collapse to the same appearance
  const starFilled = ensureContrast(primary, surface, 3.0, bestBlackOrWhite(surface));
  let starUnselected = ensureContrast(border, surface, 3.0, controlBorder);
  const starDist = contrastRatio(starFilled, starUnselected);
  if (starDist !== undefined && starDist < 1.3) {
    starUnselected = ensureContrast(border, starFilled, 1.8, controlBorder);
  }

  // 6. Placeholder: text contrast >= 4.5 (WCAG AA) against surface
  const placeholder = derivedMuted;

  // 7. Focus ring: contrast >= 3.0 against surface
  const focusRing = ensureContrast(primary, surface, 3.0, bestBlackOrWhite(surface));

  // 8. Switch off track vs switch on track: distinguishable from each other and against surface
  let switchOff = parsedSurface && luminance(parsedSurface) < 0.2
    ? ensureContrast('#2d333b', surface, 1.8, '#30363d')
    : '#cbd1cb';
  const switchDist = contrastRatio(primary, switchOff);
  if (switchDist !== undefined && switchDist < 1.4) {
    switchOff = ensureContrast(switchOff, primary, 1.8, bestBlackOrWhite(surface));
  }

  return {
    '--demo-bg': tokens.background,
    '--demo-surface': tokens.surface,
    '--demo-soft': soft,
    '--demo-text': derivedText,
    '--demo-muted': derivedMuted,
    '--demo-placeholder': placeholder,
    '--demo-accent': tokens.primary,
    '--demo-accent-text': tokens.primaryText,
    '--demo-accent-soft': `color-mix(in srgb, ${tokens.primary} 16%, ${tokens.surface})`,
    '--demo-border': tokens.borderColor,
    '--demo-border-width': `${tokens.borderWidth}px`,
    '--demo-control-border': controlBorder,
    '--demo-star-filled': starFilled,
    '--demo-star-unselected': starUnselected,
    '--demo-progress-track': progressTrack,
    '--demo-focus-ring': focusRing,
    '--demo-switch-off': switchOff,
    '--demo-switch-thumb-on': bestBlackOrWhite(primary),
    '--demo-switch-thumb-off': bestBlackOrWhite(switchOff),
    '--demo-radius': `${tokens.radius}px`,
    '--demo-shadow': tokens.shadow,
    '--demo-font': tokens.fontFamily,
    '--demo-heading-font': tokens.headingFontFamily,
    '--demo-press-offset': `${tokens.pressOffset}px`,
    '--demo-press-scale': tokens.pressScale,
    ...(snapshot.parserVersion === 2 && snapshot.appearance ? appearanceCss(snapshot.appearance) : {}),
  };
}
