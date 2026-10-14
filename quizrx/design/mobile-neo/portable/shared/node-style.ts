/** The scalar style contract shared by validation, preview and portable exports. */
export const STYLE_KEYS: string[] = ['color','background','fontSize','fontWeight','padding','margin','borderRadius','gap','textAlign','alignItems','justifyContent','minHeight','width','height','opacity','gridTemplateColumns','flexDirection','flexShrink','flexBasis','borderWidth','borderColor','borderStyle','boxShadow'];
const supported = new Set(STYLE_KEYS);

export function resolveNodeStyle(input: Record<string, string | number>): Record<string, string | number> {
  const output: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (supported.has(key) && (typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 150 && !/url\s*\(|expression\s*\(|[<>;{}]/i.test(value))) output[key] = value;
  }
  if (typeof input?.width === 'number' || typeof input?.width === 'string' && /^\d+(?:\.\d+)?px$/.test(input.width)) {
    output.flexShrink ??= 0;
    output.flexBasis ??= 'auto';
  }
  return output;
}

/** One bounded shadow, sufficient for soft or hard local style overrides. */
export function validNodeShadow(value: unknown): boolean {
  if (value === 'none') return true;
  if (typeof value !== 'string') return false;
  const match = /^(?:inset\s+)?((?:(?:-?\d+(?:\.\d+)?px|0)\s+){2,4})(#[\da-f]{3,8}|rgba?\([^()]+\))$/i.exec(value.trim());
  if (!match) return false;
  const coordinates = match[1].trim().split(/\s+/).map(Number.parseFloat);
  if (coordinates.some(n => !Number.isFinite(n) || Math.abs(n) > 100) || coordinates.length >= 3 && coordinates[2] < 0) return false;
  const color = match[2];
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) return true;
  const rgb = /^(rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+|1\.0+))?\s*\)$/i.exec(color);
  if (!rgb || (rgb[1]!.toLowerCase() === 'rgb' ? rgb[5] !== undefined : rgb[5] === undefined)) return false;
  if ([rgb[2], rgb[3], rgb[4]].some(channel => Number(channel) > 255)) return false;
  return rgb[5] === undefined || Number(rgb[5]) >= 0 && Number(rgb[5]) <= 1;
}
