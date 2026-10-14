export type StyleAppearance = {
  background: { type: 'solid' } | { type: 'linear-gradient'; angle: number; stops: { color: string; position: number }[] } | { type: 'radial-gradient'; center: { x: number; y: number }; stops: { color: string; position: number }[] };
  surfaceOpacity: number;
  blur: number;
  saturation: number;
  shadows: { inset: boolean; x: number; y: number; blur: number; spread: number; color: string; opacity: number }[];
  pattern: 'none' | 'dots' | 'grid' | 'stripes' | 'crosshatch' | 'pixel-grid' | 'halftone' | 'organic';
  geometry: 'standard' | 'square' | 'soft' | 'pill' | 'cut-corner' | 'pixel' | 'organic' | 'asymmetric';
  typography: { scale: number; lineHeight: number; letterSpacing: number };
  motion: 'none' | 'subtle' | 'playful' | 'mechanical' | 'ambient';
};

type RecordValue = Record<string, unknown>;
const solidColor = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const exact = (v: RecordValue, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every((key) => keys.includes(key));
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const object = (v: unknown): v is RecordValue => Boolean(v && typeof v === 'object' && !Array.isArray(v));

function fail(field: string): never { throw new TypeError(`Invalid appearance ${field}`); }

/** Validate the deliberately small appearance language persisted in parser v2 snapshots. */
export function validateStyleAppearance(value: unknown): asserts value is StyleAppearance {
  if (!object(value) || !exact(value, ['background', 'surfaceOpacity', 'blur', 'saturation', 'shadows', 'pattern', 'geometry', 'typography', 'motion'])) fail('keys');
  const bg = value.background;
  if (!object(bg)) fail('background');
  if (bg.type === 'solid') {
    if (!exact(bg, ['type'])) fail('background');
  } else if (bg.type === 'linear-gradient') {
    if (!exact(bg, ['type', 'angle', 'stops']) || !finite(bg.angle, 0, 360) || !Array.isArray(bg.stops) || bg.stops.length < 2 || bg.stops.length > 5) fail('gradient');
    let previous = -1;
    for (const stop of bg.stops) {
      if (!object(stop) || !exact(stop, ['color', 'position']) || typeof stop.color !== 'string' || !solidColor.test(stop.color) || !finite(stop.position, 0, 100) || stop.position < previous) fail('gradient stop');
      previous = stop.position;
    }
  } else if (bg.type === 'radial-gradient') {
    if (!exact(bg, ['type', 'center', 'stops']) || !object(bg.center) || !exact(bg.center, ['x', 'y']) || !finite(bg.center.x, 0, 100) || !finite(bg.center.y, 0, 100) || !Array.isArray(bg.stops) || bg.stops.length < 2 || bg.stops.length > 5) fail('radial gradient');
    let previous = -1;
    for (const stop of bg.stops) {
      if (!object(stop) || !exact(stop, ['color', 'position']) || typeof stop.color !== 'string' || !solidColor.test(stop.color) || !finite(stop.position, 0, 100) || stop.position < previous) fail('radial gradient stop');
      previous = stop.position;
    }
  } else fail('background type');
  if (!finite(value.surfaceOpacity, 0.1, 1)) fail('surface opacity');
  if (!finite(value.blur, 0, 40)) fail('blur');
  if (!finite(value.saturation, 50, 220)) fail('saturation');
  if (!Array.isArray(value.shadows) || value.shadows.length > 4) fail('shadows');
  for (const shadow of value.shadows) {
    if (!object(shadow) || !exact(shadow, ['inset', 'x', 'y', 'blur', 'spread', 'color', 'opacity']) || typeof shadow.inset !== 'boolean' || !finite(shadow.x, -32, 32) || !finite(shadow.y, -32, 32) || !finite(shadow.blur, 0, 64) || !finite(shadow.spread, -16, 24) || typeof shadow.color !== 'string' || !solidColor.test(shadow.color) || !finite(shadow.opacity, 0, 1)) fail('shadow');
  }
  if (!['none', 'dots', 'grid', 'stripes', 'crosshatch', 'pixel-grid', 'halftone', 'organic'].includes(String(value.pattern))) fail('pattern');
  if (!['standard', 'square', 'soft', 'pill', 'cut-corner', 'pixel', 'organic', 'asymmetric'].includes(String(value.geometry))) fail('geometry');
  if (!object(value.typography) || !exact(value.typography, ['scale', 'lineHeight', 'letterSpacing']) || !finite(value.typography.scale, 0.75, 1.5) || !finite(value.typography.lineHeight, 1, 2.2) || !finite(value.typography.letterSpacing, -2, 6)) fail('typography');
  if (!['none', 'subtle', 'playful', 'mechanical', 'ambient'].includes(String(value.motion))) fail('motion');
}

function cssBackground(background: Exclude<StyleAppearance['background'], { type: 'solid' }>): string {
  const stops = background.stops.map(({ color, position }) => `${color} ${position}%`).join(', ');
  return background.type === 'linear-gradient'
    ? `linear-gradient(${background.angle}deg, ${stops})`
    : `radial-gradient(circle at ${background.center.x}% ${background.center.y}%, ${stops})`;
}

function shadowColorCss(color: string, opacity: number): string {
  const raw = color.slice(1);
  const expanded = raw.length <= 4 ? [...raw].map((part) => part + part).join('') : raw;
  const hasAlpha = expanded.length === 8;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
  const sourceAlpha = hasAlpha ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
  const alpha = Number((sourceAlpha * opacity).toFixed(4));
  return `rgb(${channels.join(' ')} / ${alpha})`;
}

export function appearanceCss(appearance: StyleAppearance): Record<string, string | number> {
  const background = appearance.background.type !== 'solid' ? cssBackground(appearance.background) : '';
  const shadows = appearance.shadows.map((shadow) => `${shadow.inset ? 'inset ' : ''}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${shadowColorCss(shadow.color, shadow.opacity)}`).join(', ');
  return {
    ...(background ? { '--demo-background-image': background } : {}),
    '--demo-surface-opacity': appearance.surfaceOpacity,
    '--demo-blur': `${appearance.blur}px`,
    '--demo-saturation': `${appearance.saturation}%`,
    '--demo-shadows': shadows || 'none',
    ...(shadows ? { '--demo-shadow': shadows } : {}),
    '--demo-pattern': appearance.pattern,
    '--demo-geometry': appearance.geometry,
    '--demo-type-scale': appearance.typography.scale,
    '--demo-line-height': appearance.typography.lineHeight,
    '--demo-letter-spacing': `${appearance.typography.letterSpacing}px`,
    '--demo-motion': appearance.motion,
    '--demo-pattern-image': patternImage(appearance.pattern),
    ...(appearance.geometry === 'square' || appearance.geometry === 'pixel' ? { '--demo-radius': '0px' }
      : appearance.geometry === 'pill' ? { '--demo-radius': '999px' }
        : appearance.geometry === 'soft' ? { '--demo-radius': '20px' } : {}),
  };
}

function patternImage(pattern: StyleAppearance['pattern']): string {
  switch (pattern) {
    case 'dots': return 'radial-gradient(currentColor 1px, transparent 1.5px)';
    case 'grid': return 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)';
    case 'stripes': return 'repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 8px)';
    case 'crosshatch': return 'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 9px), repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px 9px)';
    case 'pixel-grid': return 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)';
    case 'halftone': return 'radial-gradient(currentColor 1px, transparent 1.6px)';
    case 'organic': return 'radial-gradient(ellipse at 15% 25%, currentColor 0 1%, transparent 35%)';
    default: return 'none';
  }
}
