/**
 * Unified internal navigation history management for AGY Demo pages.
 * Does not rely on host browser window.history, deduplicates consecutive clicks to the same page,
 * and falls back cleanly to the initial demo page.
 */

export function createNavigationHistory(initialPageId?: string): string[] {
  return initialPageId ? [initialPageId] : [];
}

export function pushPageHistory(stack: string[], nextPageId: string): string[] {
  if (!nextPageId) return stack;
  const current = stack[stack.length - 1];
  if (current === nextPageId) {
    // 连点重复同页不得产生假历史
    return stack;
  }
  return [...stack, nextPageId];
}

export function popPageHistory(
  stack: string[],
  initialPageId?: string,
): { nextStack: string[]; targetPageId?: string; canBack: boolean } {
  if (stack.length <= 1) {
    return {
      nextStack: stack.length === 1 ? stack : (initialPageId ? [initialPageId] : []),
      targetPageId: initialPageId,
      canBack: false,
    };
  }
  const nextStack = stack.slice(0, -1);
  const targetPageId = nextStack[nextStack.length - 1] || initialPageId;
  return {
    nextStack,
    targetPageId,
    canBack: nextStack.length > 1,
  };
}
