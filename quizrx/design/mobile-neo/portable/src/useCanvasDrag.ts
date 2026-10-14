import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type DragEvent } from 'react';
import type { BuilderNode, ComponentType } from '../shared/types';
import { isNodeLocked, normalizeSelection, snapToGrid, snapToGuide, constrainNodeSize, resizeAxes, movementBounds, type LayoutChange, type LayoutPosition, type LayoutSize } from '../shared/layout';

interface Options {
  enabled: boolean;
  pageId: string;
  nodes: BuilderNode[];
  selectedNodeIds: string[];
  onSelect?: (id: string, additive?: boolean) => void;
  onMove?: (id: string, position: LayoutPosition) => void;
  onLayoutCommit?: (changes: LayoutChange[]) => void;
}
interface InlineState { left: string; top: string; width: string; height: string; animation: string; motionEnabled?: string }
interface Entry {
  id: string;
  element: HTMLElement;
  start: LayoutPosition;
  current: LayoutPosition;
  inline: InlineState;
  rect: { left: number; top: number; width: number; height: number };
  size?: LayoutSize;
}
interface Gesture {
  pointerId: number;
  root: HTMLDivElement;
  entries: Entry[];
  pointer: LayoutPosition;
  scroll: LayoutPosition;
  scale: number;
  mode: 'move' | 'resize';
  resizedId?: string;
  axes?: ReturnType<typeof resizeAxes>;
  startSize?: LayoutSize;
  parentContentWidth?: number;
  requiredHeight?: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  union: { left: number; top: number; right: number; bottom: number };
  currentDelta: LayoutPosition;
  moved: boolean;
  bypassSnap: boolean;
}

const readPosition = (element: HTMLElement): LayoutPosition => ({ x: Number(element.dataset.offsetX) || 0, y: Number(element.dataset.offsetY) || 0 });
const inlineState = (element: HTMLElement): InlineState => ({ left: element.style.left, top: element.style.top, width: element.style.width, height: element.style.height, animation: element.style.animation, motionEnabled: element.dataset.motionEnabled });
const restoreInline = (element: HTMLElement, saved: InlineState) => {
  element.style.left = saved.left; element.style.top = saved.top; element.style.width = saved.width; element.style.height = saved.height; element.style.animation = saved.animation;
  if (saved.motionEnabled !== undefined) element.dataset.motionEnabled = saved.motionEnabled;
  else delete element.dataset.motionEnabled;
  element.classList.remove('is-dragging', 'is-resizing');
};
const rectInRoot = (element: HTMLElement, rootRect: DOMRect, root: HTMLDivElement, scale: number) => {
  const rect = element.getBoundingClientRect();
  return { left: (rect.left - rootRect.left) / scale + root.scrollLeft, top: (rect.top - rootRect.top) / scale + root.scrollTop, width: rect.width / scale, height: rect.height / scale };
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const cssPixels = (value: string) => Number.parseFloat(value) || 0;
function contentWidth(element: HTMLElement | null, fallback: number): number {
  if (!element) return fallback;
  const style = getComputedStyle(element);
  return Math.max(0, element.clientWidth - cssPixels(style.paddingLeft) - cssPixels(style.paddingRight));
}

export function measureNodeMinimums(element: HTMLElement, type: ComponentType, scale: number) {
  if (!['stack','row','grid','card'].includes(type)) return { height: 32, width: 24 };
  const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
  const lowerEdge = Math.max(cssPixels(style.paddingTop) + cssPixels(style.borderTopWidth), ...Array.from(element.children).map(child => (child.getBoundingClientRect().bottom - rect.top) / scale));
  return { height: Math.ceil(lowerEdge + cssPixels(style.paddingBottom) + cssPixels(style.borderBottomWidth)), width: Math.ceil(element.scrollWidth + cssPixels(style.borderLeftWidth) + cssPixels(style.borderRightWidth)) };
}

function resizeMode(element: HTMLElement, event: PointerEvent<HTMLDivElement>, scale: number): boolean {
  const axes = element.dataset.resizeAxes;
  if (!axes || axes === 'none') return false;
  const rect = element.getBoundingClientRect();
  const edge = 12 * scale;
  const nearRight = event.clientX >= rect.right - edge;
  if (!nearRight) return false;
  if (axes === 'both' || axes === 'square') return event.clientY >= rect.bottom - edge;
  return Math.abs(event.clientY - (rect.top + rect.height / 2)) <= 8 * scale;
}

function guideDeltas(axis: 'x' | 'y', moving: Gesture['union'], targets: HTMLElement[], rootRect: DOMRect, root: HTMLDivElement, scale: number): Array<{ delta: number; line: number }> {
  const candidates: Array<{ delta: number; line: number }> = [];
  for (const target of targets) {
    if (target.classList.contains('is-dragging') || target.classList.contains('is-resizing')) continue;
    const rect = rectInRoot(target, rootRect, root, scale);
    const start = axis === 'x' ? rect.left : rect.top;
    const extent = axis === 'x' ? rect.width : rect.height;
    const movingStart = axis === 'x' ? moving.left : moving.top;
    const movingExtent = axis === 'x' ? moving.right - moving.left : moving.bottom - moving.top;
    for (const targetLine of [start, start + extent / 2, start + extent]) {
      for (const movingLine of [movingStart, movingStart + movingExtent / 2, movingStart + movingExtent]) candidates.push({ delta: targetLine - movingLine, line: movingLine });
    }
  }
  return candidates;
}

export function useCanvasDrag(options: Options) {
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const latest = useRef(options);
  latest.current = options;
  const suppressClick = useRef<{ id: string; time: number } | undefined>(undefined);
  const pointerSelection = useRef<{ id: string; time: number } | undefined>(undefined);
  const [draggingId, setDraggingId] = useState<string>();

  const finish = (commit: boolean) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = undefined;
    delete current.root.dataset.snapX;
    delete current.root.dataset.snapY;
    current.root.style.removeProperty('--canvas-guide-x');
    current.root.style.removeProperty('--canvas-guide-y');
    for (const entry of current.entries) restoreInline(entry.element, entry.inline);
    if (current.root.hasPointerCapture(current.pointerId)) current.root.releasePointerCapture(current.pointerId);
    setDraggingId(undefined);
    if (current.moved && current.resizedId) suppressClick.current = { id: current.resizedId, time: Date.now() };
    else if (current.moved) suppressClick.current = { id: current.entries[0]!.id, time: Date.now() };
    if (!commit || !current.moved) return;
    if (current.mode === 'resize') {
      const entry = current.entries[0];
      if (entry?.size && (entry.size.width !== current.startSize?.width || entry.size.height !== current.startSize?.height)) latest.current.onLayoutCommit?.([{ id: entry.id, size: entry.size }]);
      return;
    }
    const changes = current.entries.filter(entry => entry.current.x !== entry.start.x || entry.current.y !== entry.start.y).map(entry => ({ id: entry.id, position: entry.current }));
    if (!changes.length) return;
    if (latest.current.onLayoutCommit) latest.current.onLayoutCommit(changes);
    else for (const change of changes) if (change.position) latest.current.onMove?.(change.id, change.position);
  };

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); finish(false); } };
    const cancel = () => finish(false);
    const visibility = () => { if (document.visibilityState === 'hidden') cancel(); };
    const root = rootRef.current;
    const wheel = (event: WheelEvent) => { if (gesture.current?.moved) event.preventDefault(); };
    let dimensions = root ? `${root.clientWidth}:${root.clientHeight}` : '';
    const observer = root ? new ResizeObserver(() => {
      const next = `${root.clientWidth}:${root.clientHeight}`;
      if (dimensions && next !== dimensions) cancel();
      dimensions = next;
    }) : undefined;
    if (root && observer) observer.observe(root);
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', cancel);
    window.addEventListener('pagehide', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('atelier-cancel-gesture', cancel);
    document.addEventListener('visibilitychange', visibility);
    root?.addEventListener('wheel', wheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel); window.removeEventListener('pagehide', cancel); window.removeEventListener('resize', cancel);
      window.removeEventListener('atelier-cancel-gesture', cancel); document.removeEventListener('visibilitychange', visibility);
      root?.removeEventListener('wheel', wheel); observer?.disconnect(); finish(false);
    };
  }, [options.enabled, options.pageId]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!latest.current.enabled || gesture.current || !event.isPrimary || event.button !== 0) return;
    const root = rootRef.current;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-node-id]') : null;
    if (!root || !target || !root.contains(target)) return;
    const id = target.dataset.nodeId!;
    const selectedBefore = target.classList.contains('is-selected');
    latest.current.onSelect?.(id, event.shiftKey);
    pointerSelection.current = { id, time: Date.now() };
    if (isNodeLocked(latest.current.nodes, id)) return;
    if (event.pointerType === 'touch' && !selectedBefore && !event.shiftKey) return;
    const rootRect = root.getBoundingClientRect();
    const measuredScale = rootRect.width / root.offsetWidth;
    const scale = Number.isFinite(measuredScale) && measuredScale > 0 ? measuredScale : 1;
    const mode = selectedBefore && resizeMode(target, event, scale) ? 'resize' : 'move';
    const selectedIds = event.shiftKey ? [...latest.current.selectedNodeIds, id] : selectedBefore ? latest.current.selectedNodeIds : [id];
    const ids = mode === 'resize' ? [id] : normalizeSelection(latest.current.nodes, selectedIds).filter(selectedId => !isNodeLocked(latest.current.nodes, selectedId));
    const elements = ids.map(selectedId => Array.from(root.querySelectorAll<HTMLElement>('[data-node-id]')).find(element => element.dataset.nodeId === selectedId)).filter((element): element is HTMLElement => Boolean(element));
    if (!elements.length) return;
    const saved = elements.map(element => ({ element, inline: inlineState(element) }));
    for (const element of elements) {
      element.dataset.motionEnabled = 'false';
      element.style.animation = 'none';
    }
    const entries = saved.map(({ element, inline }) => ({ id: element.dataset.nodeId!, element, start: readPosition(element), current: readPosition(element), inline, rect: rectInRoot(element, rootRect, root, scale) }));
    for (const entry of entries) {
      // Removing the image cap must not change its size before pointer movement.
      if (mode === 'resize' && entry.element.dataset.nodeType === 'image') entry.element.style.height = `${entry.rect.height}px`;
      entry.element.classList.add(mode === 'resize' ? 'is-resizing' : 'is-dragging');
    }
    const union = {
      left: Math.min(...entries.map(entry => entry.rect.left)), top: Math.min(...entries.map(entry => entry.rect.top)),
      right: Math.max(...entries.map(entry => entry.rect.left + entry.rect.width)), bottom: Math.max(...entries.map(entry => entry.rect.top + entry.rect.height)),
    };
    const canvasWidth = root.clientWidth;
    const canvasHeight = Math.max(root.scrollHeight, root.clientHeight);
    const bounds = movementBounds(entries.map(entry => ({ ...entry.rect, x: entry.start.x, y: entry.start.y })), canvasWidth, canvasHeight);
    const type = (target.dataset.nodeType || 'text') as ComponentType;
    const axes = mode === 'resize' ? resizeAxes(type) : undefined;
    const parent = target.parentElement;
    const startRect = entries[0]!.rect;
    gesture.current = {
      pointerId: event.pointerId, root, entries, pointer: { x: event.clientX, y: event.clientY }, scale, mode,
      scroll: { x: root.scrollLeft, y: root.scrollTop },
      ...(mode === 'resize' ? { resizedId: id, axes, startSize: { width: startRect.width, height: startRect.height }, parentContentWidth: contentWidth(parent, canvasWidth) } : {}),
      bounds, union, currentDelta: { x: 0, y: 0 }, moved: false, bypassSnap: event.altKey,
    };
    event.preventDefault();
    root.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const raw = { x: (event.clientX - current.pointer.x) / current.scale + current.root.scrollLeft - current.scroll.x, y: (event.clientY - current.pointer.y) / current.scale + current.root.scrollTop - current.scroll.y };
    if (!current.moved && Math.hypot(raw.x, raw.y) < 4) return;
    event.preventDefault();
    if (!current.moved) { current.moved = true; setDraggingId(current.resizedId || current.entries[0]?.id); }
    current.bypassSnap = event.altKey;
    if (current.mode === 'resize') {
      const target = current.entries[0];
      if (!target || !current.startSize) return;
      const width = current.startSize.width + raw.x;
      const height = current.axes === 'both' ? current.startSize.height! + raw.y : current.startSize.height;
      const type = target.element.dataset.nodeType as ComponentType;
      const availableWidth = current.parentContentWidth ?? current.root.clientWidth;
      target.element.style.width = `${Math.max(24, Math.min(availableWidth, width))}px`;
      const minimums = measureNodeMinimums(target.element, type, current.scale);
      const size = constrainNodeSize(type, { width, ...(height !== undefined ? { height } : {}) }, availableWidth, minimums.height, minimums.width);
      if (!size) target.element.style.width = target.inline.width;
      if (!size) return;
      target.size = size;
      target.element.style.width = `${size.width}px`;
      if (size.height !== undefined) target.element.style.height = `${size.height}px`;
      return;
    }
    const rootRect = current.root.getBoundingClientRect();
    const targets = Array.from(current.root.querySelectorAll<HTMLElement>('[data-node-id]'));
    let dx = current.bypassSnap ? raw.x : snapToGrid(current.union.left + raw.x) - current.union.left;
    let dy = current.bypassSnap ? raw.y : snapToGrid(current.union.top + raw.y) - current.union.top;
    let guideX: number | undefined;
    let guideY: number | undefined;
    if (!current.bypassSnap) {
      const xGuides = guideDeltas('x', current.union, targets, rootRect, current.root, current.scale);
      const yGuides = guideDeltas('y', current.union, targets, rootRect, current.root, current.scale);
      dx = snapToGuide(dx, xGuides.map(guide => guide.delta), current.scale);
      dy = snapToGuide(dy, yGuides.map(guide => guide.delta), current.scale);
      const matchX = xGuides.find(guide => Math.abs(guide.delta - dx) < 0.01);
      const matchY = yGuides.find(guide => Math.abs(guide.delta - dy) < 0.01);
      if (matchX) guideX = matchX.line + dx;
      if (matchY) guideY = matchY.line + dy;
    }
    const snappedDx = dx;
    const snappedDy = dy;
    dx = clamp(dx, current.bounds.minX, current.bounds.maxX);
    dy = clamp(dy, current.bounds.minY, current.bounds.maxY);
    if (dx !== snappedDx) guideX = undefined;
    if (dy !== snappedDy) guideY = undefined;
    if (guideX !== undefined) { current.root.dataset.snapX = 'true'; current.root.style.setProperty('--canvas-guide-x', `${guideX}px`); }
    else { delete current.root.dataset.snapX; current.root.style.removeProperty('--canvas-guide-x'); }
    if (guideY !== undefined) { current.root.dataset.snapY = 'true'; current.root.style.setProperty('--canvas-guide-y', `${guideY}px`); }
    else { delete current.root.dataset.snapY; current.root.style.removeProperty('--canvas-guide-y'); }
    current.currentDelta = { x: dx, y: dy };
    for (const entry of current.entries) {
      entry.current = { x: Math.round(entry.start.x + dx), y: Math.round(entry.start.y + dy) };
      entry.element.style.left = `${entry.current.x}px`;
      entry.element.style.top = `${entry.current.y}px`;
    }
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const suppressed = suppressClick.current;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-node-id]') : null;
    if (!suppressed) return;
    suppressClick.current = undefined;
    if (Date.now() - suppressed.time < 500 && (!target || target.dataset.nodeId === suppressed.id)) {
      pointerSelection.current = undefined;
      event.preventDefault(); event.stopPropagation();
    }
  };
  const consumePointerSelection = (id: string) => {
    const previous = pointerSelection.current;
    if (!previous) return false;
    pointerSelection.current = undefined;
    return previous.id === id && Date.now() - previous.time < 500;
  };
  return { rootRef, draggingId, cancel: () => finish(false), consumePointerSelection, handlers: {
    onPointerDown, onPointerMove,
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => { if (gesture.current?.pointerId === event.pointerId) finish(true); },
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => { if (gesture.current?.pointerId === event.pointerId) finish(false); },
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => { if (gesture.current?.pointerId === event.pointerId) finish(false); },
    onClickCapture,
    onDragStart: (event: DragEvent) => { if (latest.current.enabled) event.preventDefault(); },
  } };
}
