export interface Position { x: number; y: number }
export interface DragGeometry { scale: number; scrollX: number; scrollY: number; minX: number; maxX: number; minY: number; maxY: number }
export const POSITION_LIMIT = 5000;
export function readNodePosition(props: Record<string, string | number | boolean>): Position {
  const value = (key: string) => typeof props[key] === 'number' && Number.isFinite(props[key]) ? Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, props[key] as number)) : 0;
  return { x: value('offsetX'), y: value('offsetY') };
}
export function pointerPosition(start: Position, delta: Position, geometry: DragGeometry): Position {
  const scale = Number.isFinite(geometry.scale) && geometry.scale > 0 ? geometry.scale : 1;
  const clamp = (value: number, min: number, max: number) => Math.round(Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, Math.max(min, Math.min(Math.max(min, max), value)))));
  return { x: clamp(start.x + delta.x / scale + geometry.scrollX, geometry.minX, geometry.maxX), y: clamp(start.y + delta.y / scale + geometry.scrollY, geometry.minY, geometry.maxY) };
}
