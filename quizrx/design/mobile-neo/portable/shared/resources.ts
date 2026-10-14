import { validateStyleAppearance } from './style-appearance.ts';

export interface StyleTokens {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  borderColor: string;
  borderWidth: number;
  radius: number;
  shadow: string;
  fontFamily: string;
  headingFontFamily: string;
  pressOffset: number;
  pressScale: number;
}

export interface StyleSnapshot {
  id: string;
  title: string;
  sourcePath: string;
  sourceHash: string;
  parserVersion: 1 | 2;
  tokens: StyleTokens;
  appearance?: StyleAppearance;
}

export type StyleAppearance = import('./style-appearance.ts').StyleAppearance;

export interface StyleResource {
  id: string;
  title: string;
  nameZh: string;
  family: string;
  bestFor: string[];
  sourcePath: string;
  sourceHash: string;
  support: 'ready' | 'reference' | 'invalid';
  diagnostics: string[];
  snapshot?: StyleSnapshot;
  context?: string;
}

const snapshotKeysV1 = ['id', 'title', 'sourcePath', 'sourceHash', 'parserVersion', 'tokens'];
const snapshotKeysV2 = [...snapshotKeysV1, 'appearance'];
const tokenKeys: (keyof StyleTokens)[] = [
  'background', 'surface', 'text', 'muted', 'primary', 'primaryText', 'borderColor',
  'borderWidth', 'radius', 'shadow', 'fontFamily', 'headingFontFamily', 'pressOffset', 'pressScale',
];
const color = /^(?:#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+|1\.0+)\s*\))$/;
const cssValue = /^[#\w\s().,%+-]+$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validateCss(value: unknown, name: string, colorOnly = false): asserts value is string {
  if (typeof value !== 'string' || value.length > 180 || /url|expression|@|;|\\|[<>]/i.test(value) || !cssValue.test(value)) {
    throw new TypeError(`Invalid ${name}`);
  }
  if (colorOnly && !color.test(value)) throw new TypeError(`Invalid ${name}`);
}

function validateFont(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 150 || /url|expression|@|;|\\|[<>]/i.test(value) || !/^[\p{L}\p{N}\s,'"-]+$/u.test(value)) {
    throw new TypeError(`Invalid ${name}`);
  }
}

export function validateStyleSnapshot(value: unknown): StyleSnapshot {
  if (!record(value) || ![1, 2].includes(value.parserVersion as number) || !exactKeys(value, value.parserVersion === 1 ? snapshotKeysV1 : snapshotKeysV2)) throw new TypeError('Invalid style snapshot keys');
  if (typeof value.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) || value.id.length > 80) throw new TypeError('Invalid style id');
  if (typeof value.title !== 'string' || value.title.length < 1 || value.title.length > 180) throw new TypeError('Invalid style title');
  if (typeof value.sourcePath !== 'string' || !/^01-风格库\/(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*:)[^\0]+\.md$/.test(value.sourcePath) || value.sourcePath.includes('\\')) throw new TypeError('Invalid style source path');
  if (typeof value.sourceHash !== 'string' || !/^[a-f\d]{64}$/i.test(value.sourceHash)) throw new TypeError('Invalid style source hash');
  if (value.parserVersion !== 1 && value.parserVersion !== 2) throw new TypeError('Invalid parser version');
  if (!record(value.tokens) || !exactKeys(value.tokens, tokenKeys)) throw new TypeError('Invalid style token keys');
  const tokens = value.tokens;
  for (const key of ['background', 'surface', 'text', 'muted', 'primary', 'primaryText'] as const) validateCss(tokens[key], key, true);
  validateCss(tokens.borderColor, 'borderColor', true);
  validateCss(tokens.shadow, 'shadow');
  validateFont(tokens.fontFamily, 'fontFamily');
  validateFont(tokens.headingFontFamily, 'headingFontFamily');
  if (!boundedNumber(tokens.borderWidth, 0, 12)) throw new TypeError('Invalid borderWidth');
  if (!boundedNumber(tokens.radius, 0, 48)) throw new TypeError('Invalid radius');
  if (!boundedNumber(tokens.pressOffset, 0, 12)) throw new TypeError('Invalid pressOffset');
  if (!boundedNumber(tokens.pressScale, 0.8, 1)) throw new TypeError('Invalid pressScale');
  if (value.parserVersion === 2) {
    validateStyleAppearance(value.appearance);
  }
  return value as unknown as StyleSnapshot;
}

