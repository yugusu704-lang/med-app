import type { BuilderNode, ComponentType } from './types.ts';

export interface LayoutPosition { x: number; y: number }
export interface LayoutSize { width: number; height?: number }
export interface LayoutChange { id: string; position?: LayoutPosition; size?: LayoutSize }
export type Alignment = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

export interface LayoutRect { id: string; left: number; top: number; width: number; height: number }

export function movementBounds(rects: Array<Omit<LayoutRect, 'id'> & { x: number; y: number }>, width: number, height: number) {
  return {
    minX: Math.max(...rects.map(rect => Math.max(24 - rect.left - rect.width, -5000 - rect.x))),
    maxX: Math.min(...rects.map(rect => Math.min(width - 24 - rect.left, 5000 - rect.x))),
    minY: Math.max(...rects.map(rect => Math.max(-rect.top, -5000 - rect.y))),
    maxY: Math.min(...rects.map(rect => Math.min(height - 24 - rect.top, 5000 - rect.y))),
  };
}

export function normalizeSelection(nodes: BuilderNode[], ids: string[]): string[] {
  const requested = new Set(ids);
  const result: string[] = [];
  const visit = (items: BuilderNode[], selectedAncestor = false) => {
    for (const node of items) {
      const selected = requested.has(node.id);
      if (selected && !selectedAncestor) result.push(node.id);
      visit(node.children ?? [], selectedAncestor || selected);
    }
  };
  visit(nodes);
  return result;
}

export function isNodeLocked(nodes: BuilderNode[], id: string): boolean {
  const visit = (items: BuilderNode[], inheritedLock = false): boolean => {
    for (const node of items) {
      const locked = inheritedLock || node.props.editorLocked === true;
      if (node.id === id) return locked;
      if (visit(node.children ?? [], locked)) return true;
    }
    return false;
  };
  return visit(nodes);
}

export function snapToGrid(value: number, grid = 8): number {
  if (!Number.isFinite(value) || !Number.isFinite(grid) || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function snapToGuide(value: number, candidates: number[], scale = 1, bypass = false, tolerance = 6): number {
  if (bypass || !Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return value;
  let nearest = value;
  let distance = tolerance / scale;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) continue;
    const next = Math.abs(candidate - value);
    if (next <= distance) { nearest = candidate; distance = next; }
  }
  return nearest;
}

export function alignSelection(rects: LayoutRect[], alignment: Alignment): LayoutChange[] {
  if (rects.length < 2) return [];
  const left = Math.min(...rects.map(rect => rect.left));
  const top = Math.min(...rects.map(rect => rect.top));
  const right = Math.max(...rects.map(rect => rect.left + rect.width));
  const bottom = Math.max(...rects.map(rect => rect.top + rect.height));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return rects.map(rect => {
    const x = alignment === 'left' ? left : alignment === 'right' ? right - rect.width : alignment === 'centerX' ? centerX - rect.width / 2 : rect.left;
    const y = alignment === 'top' ? top : alignment === 'bottom' ? bottom - rect.height : alignment === 'centerY' ? centerY - rect.height / 2 : rect.top;
    return { id: rect.id, position: { x, y } };
  });
}

const TWO_AXIS_TYPES = new Set<ComponentType>(['stack', 'row', 'grid', 'card', 'image', 'scroll']);

export function resizeAxes(type: ComponentType): 'none' | 'width' | 'both' | 'square' {
  if (type === 'divider') return 'none';
  if (type === 'avatar') return 'square';
  return TWO_AXIS_TYPES.has(type) ? 'both' : 'width';
}

export function constrainNodeSize(
  type: ComponentType,
  proposed: LayoutSize,
  parentContentWidth: number,
  requiredHeight = 32,
  requiredWidth = 24,
): LayoutSize | undefined {
  const axes = resizeAxes(type);
  if (axes === 'none' || !Number.isFinite(parentContentWidth) || parentContentWidth < 24 || !Number.isFinite(proposed.width)) return undefined;
  if (proposed.height !== undefined && !Number.isFinite(proposed.height)) return undefined;
  if (requiredWidth > parentContentWidth) return undefined;
  const width = Math.round(Math.max(24, requiredWidth, Math.min(parentContentWidth, proposed.width)));
  if (axes === 'square') return { width, height: width };
  if (axes === 'both' && proposed.height !== undefined) {
    const minimumHeight = Math.max(32, Number.isFinite(requiredHeight) ? requiredHeight : 32);
    if (minimumHeight > 2000) return { width };
    return { width, height: Math.round(Math.max(minimumHeight, Math.min(2000, proposed.height))) };
  }
  return { width };
}
