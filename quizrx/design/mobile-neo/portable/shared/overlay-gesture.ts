export interface SheetDragState {
  height: number;
  deltaY: number;
  velocityY: number;
}

/**
 * Determines whether a bottomsheet should close based on drag displacement and velocity.
 * Rules:
 * - Displacement >= 25% of sheet height closes
 * - OR velocity >= 0.5px/ms with displacement >= 12px closes
 * - Otherwise bounces back (false)
 */
export function shouldCloseSheet(state: SheetDragState): boolean {
  const { height, deltaY, velocityY } = state;
  if (height <= 0) return false;
  // Dragging downwards closes sheet
  if (deltaY < 0) return false;
  return deltaY >= height * 0.25 || (velocityY >= 0.5 && deltaY >= 12);
}

export interface DrawerDragState {
  width: number;
  deltaX: number;
  velocityX: number;
  side: 'left' | 'right';
}

/**
 * Determines whether a drawer should close based on drag displacement, velocity, and docked side.
 * Rules:
 * - For right-docked drawer: dragging rightwards (deltaX > 0) towards screen edge closes
 *   when displacement >= 25% width OR velocity >= 0.5px/ms with displacement >= 12px.
 * - For left-docked drawer: dragging leftwards (deltaX < 0) towards screen edge closes
 *   when displacement >= 25% width OR velocity >= 0.5px/ms with displacement >= 12px.
 * - Otherwise bounces back (false)
 */
export function shouldCloseDrawer(state: DrawerDragState): boolean {
  const { width, deltaX, velocityX, side } = state;
  if (width <= 0) return false;
  if (side === 'right') {
    if (deltaX <= 0) return false;
    return deltaX >= width * 0.25 || (velocityX >= 0.5 && deltaX >= 12);
  } else {
    if (deltaX >= 0) return false;
    const absDeltaX = Math.abs(deltaX);
    const absVelocityX = Math.abs(velocityX);
    return absDeltaX >= width * 0.25 || (absVelocityX >= 0.5 && absDeltaX >= 12);
  }
}
