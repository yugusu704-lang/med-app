import type { BuilderNode, Page } from './types.ts';

export const SCROLL_AXIS_OPTIONS = ['vertical', 'horizontal'] as const;
export type ScrollAxis = typeof SCROLL_AXIS_OPTIONS[number];
export const DEFAULT_SCROLL_AXIS: ScrollAxis = 'vertical';
export const MIN_SCROLL_HEIGHT = 32;
export const MAX_SCROLL_HEIGHT = 2000;
export const DEFAULT_SCROLL_HEIGHT = 240;

export const MIN_STICKY_OFFSET = 0;
export const MAX_STICKY_OFFSET = 300;
export const DEFAULT_STICKY_OFFSET = 0;

export const FIXEDBAR_EDGE_OPTIONS = ['top', 'bottom'] as const;
export type FixedBarEdge = typeof FIXEDBAR_EDGE_OPTIONS[number];
export const DEFAULT_FIXEDBAR_EDGE: FixedBarEdge = 'bottom';

export const OVERLAY_TYPES = ['drawer', 'bottomsheet', 'modal'] as const;
export type OverlayType = typeof OVERLAY_TYPES[number];

export const DRAWER_SIDE_OPTIONS = ['left', 'right'] as const;
export type DrawerSide = typeof DRAWER_SIDE_OPTIONS[number];
export const DEFAULT_DRAWER_SIDE: DrawerSide = 'right';
export const MIN_DRAWER_SIZE = 20;
export const MAX_DRAWER_SIZE = 90;
export const DEFAULT_DRAWER_SIZE = 80;

export const MIN_BOTTOMSHEET_HEIGHT = 20;
export const MAX_BOTTOMSHEET_HEIGHT = 90;
export const DEFAULT_BOTTOMSHEET_HEIGHT = 60;

/**
 * Validates page-level and subtree behavioral constraints for AGY composable behaviors:
 * 1. fixedbar and overlays (drawer, bottomsheet, modal) must be at the page top-level (depth === 0).
 * 2. At most one top fixedbar (edge === 'top') and at most one bottom fixedbar (edge === 'bottom') per page.
 * 3. At most one fixed bottomnav (placement === 'fixed') per page, and must be at top-level.
 * 4. fixedbar cannot contain another fixedbar or sticky.
 * 5. sticky cannot be nested inside another sticky.
 * 6. Each scrolling region (page main flow, or an independent scroll container) can manage at most ONE sticky component.
 * 7. sticky offset must be a bounded finite number (0–300).
 * 8. vertical scroll containers must specify an explicit finite pixel height (32–2000).
 * 9. Overlays (drawer, bottomsheet, modal) must maintain at least one valid exit route (mask, escape, or close button).
 */
export function validateBehaviorConstraints(page: Page): void {
  function fail(message: string): never {
    throw new Error(message);
  }

  let topFixedBarCount = 0;
  let bottomFixedBarCount = 0;
  let fixedBottomNavCount = 0;

  // 1. Page-level fixedbar & bottomnav checks
  for (const node of page.nodes) {
    if (node.type === 'fixedbar') {
      const edge = node.props?.edge === 'top' ? 'top' : 'bottom';
      if (edge === 'top') topFixedBarCount++;
      else bottomFixedBarCount++;
    } else if (node.type === 'bottomnav' && node.props?.placement === 'fixed') {
      fixedBottomNavCount++;
    }
  }

  if (topFixedBarCount > 1) {
    fail(`每页最多一个顶部固定栏：${page.id}`);
  }
  if (bottomFixedBarCount > 1) {
    fail(`每页最多一个底部固定栏：${page.id}`);
  }
  if (fixedBottomNavCount > 1) {
    fail(`每页最多一个固定底栏：${page.id}`);
  }

  // 2. Recursive subtree validation
  const validateSubtree = (
    nodes: BuilderNode[],
    depth: number,
    ancestors: BuilderNode[],
    currentScrollRegionId: string,
    regionStickyCounts: Map<string, number>,
  ) => {
    for (const node of nodes) {
      if (node.type === 'fixedbar') {
        if (depth !== 0) {
          fail(`固定栏必须放在页面顶层：${node.id}`);
        }
        if (node.props?.edge !== undefined && !FIXEDBAR_EDGE_OPTIONS.includes(node.props.edge as FixedBarEdge)) {
          fail(`fixedbar edge 取值无效（可用 top / bottom）：${node.id}`);
        }
      }

      if (['drawer', 'bottomsheet', 'modal'].includes(node.type)) {
        if (depth !== 0) {
          fail(`弹层必须放在页面顶层：${node.id}`);
        }
        if (node.type === 'drawer') {
          const side = node.props?.side;
          if (side !== undefined && !DRAWER_SIDE_OPTIONS.includes(side as DrawerSide)) {
            fail(`drawer side 取值无效（可用 left / right）：${node.id}`);
          }
          const size = node.props?.size;
          if (size !== undefined && (typeof size !== 'number' || !Number.isFinite(size) || size < MIN_DRAWER_SIZE || size > MAX_DRAWER_SIZE)) {
            fail(`drawer size 超出范围（${MIN_DRAWER_SIZE}–${MAX_DRAWER_SIZE}）：${node.id} = ${size}`);
          }
        } else if (node.type === 'bottomsheet') {
          const height = node.props?.height;
          if (height !== undefined && (typeof height !== 'number' || !Number.isFinite(height) || height < MIN_BOTTOMSHEET_HEIGHT || height > MAX_BOTTOMSHEET_HEIGHT)) {
            fail(`bottomsheet height 超出范围（${MIN_BOTTOMSHEET_HEIGHT}–${MAX_BOTTOMSHEET_HEIGHT}）：${node.id} = ${height}`);
          }
        }
        const mask = node.props?.maskClosable !== false;
        const escape = node.props?.escapeClosable !== false;
        const closeBtn = node.props?.showCloseButton !== false;
        if (!mask && !escape && !closeBtn) {
          fail(`弹层必须保留至少一种关闭途径（遮罩、Escape键或关闭按钮）：${node.id}`);
        }
      }

      if (node.type === 'bottomnav' && node.props?.placement === 'fixed' && depth !== 0) {
        fail(`固定底栏必须放在页面顶层：${node.id}`);
      }

      const inFixedBar = ancestors.some(a => a.type === 'fixedbar');
      const inSticky = ancestors.some(a => a.type === 'sticky');
      const inHorizontalScroll = ancestors.some(a => a.type === 'scroll' && a.props?.axis === 'horizontal');

      if (node.type === 'sticky') {
        if (inFixedBar) {
          fail(`固定栏内不可包含吸顶组件：${node.id}`);
        }
        if (inSticky) {
          fail(`吸顶组件不可嵌套在另一个吸顶组件中：${node.id}`);
        }
        if (inHorizontalScroll) {
          fail(`吸顶组件不可放在横向滚动容器内部：${node.id}`);
        }

        const rawOffset = node.props?.offset;
        if (rawOffset !== undefined) {
          if (typeof rawOffset !== 'number' || !Number.isFinite(rawOffset) || rawOffset < MIN_STICKY_OFFSET || rawOffset > MAX_STICKY_OFFSET) {
            fail(`offset 超出范围（${MIN_STICKY_OFFSET}–${MAX_STICKY_OFFSET}）：${node.id} = ${rawOffset}`);
          }
        }

        const currentCount = regionStickyCounts.get(currentScrollRegionId) ?? 0;
        if (currentCount >= 1) {
          fail(`每个滚动区域最多一个吸顶组件：${currentScrollRegionId}`);
        }
        regionStickyCounts.set(currentScrollRegionId, currentCount + 1);
      }

      if (node.type === 'tabpanel') {
        if (ancestors.some(a => a.type === 'tabpanel')) {
          fail(`tabpanel 不可嵌套在另一个 tabpanel 中：${node.id}`);
        }
        if (ancestors.some(a => a.type === 'fixedbar')) {
          fail(`固定栏内不可包含 tabpanel：${node.id}`);
        }
      }

      if (node.type === 'tabs' && node.children && node.children.length > 0) {
        for (const child of node.children) {
          if (child.type !== 'tabpanel') {
            fail(`tabs 的子组件必须全部为 tabpanel：${node.id}`);
          }
        }
      }

      let nextScrollRegionId = currentScrollRegionId;
      if (node.type === 'scroll') {
        const axis = node.props?.axis;
        if (axis !== undefined && !SCROLL_AXIS_OPTIONS.includes(axis as ScrollAxis)) {
          fail(`scroll axis 取值无效（可用 vertical / horizontal）：${node.id}`);
        }
        const effectiveAxis = axis === 'horizontal' ? 'horizontal' : 'vertical';
        const heightVal = node.props?.height;

        if (effectiveAxis === 'vertical') {
          if (typeof heightVal !== 'number' || !Number.isFinite(heightVal) || heightVal < MIN_SCROLL_HEIGHT || heightVal > MAX_SCROLL_HEIGHT) {
            fail(`纵向滚动容器必须指定明确像素高度（${MIN_SCROLL_HEIGHT}–${MAX_SCROLL_HEIGHT}）：${node.id} = ${heightVal}`);
          }
        } else if (heightVal !== undefined) {
          if (typeof heightVal !== 'number' || !Number.isFinite(heightVal) || heightVal < MIN_SCROLL_HEIGHT || heightVal > MAX_SCROLL_HEIGHT) {
            fail(`scroll height 超出范围（${MIN_SCROLL_HEIGHT}–${MAX_SCROLL_HEIGHT}）：${node.id} = ${heightVal}`);
          }
        }

        // Entering an independent scroll container establishes a new scroll region
        nextScrollRegionId = `scroll-${node.id}`;
      }

      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          if (['fixedbar', 'drawer', 'bottomsheet', 'modal'].includes(child.type)) {
            fail(`顶层组件禁止作为子节点嵌套：${child.id}`);
          }
        }
        validateSubtree(
          node.children,
          depth + 1,
          [...ancestors, node],
          nextScrollRegionId,
          regionStickyCounts,
        );
      }
    }
  };

  const regionStickyCounts = new Map<string, number>();
  validateSubtree(page.nodes, 0, [], `page-${page.id}`, regionStickyCounts);

  // 3. Page node map and cross-reference validation (tabsTarget, scrollTo, openOverlay, closeOverlay)
  const nodeMap = new Map<string, { node: BuilderNode; ancestors: BuilderNode[] }>();
  const collectNodes = (nodes: BuilderNode[], ancestors: BuilderNode[]) => {
    for (const node of nodes) {
      nodeMap.set(node.id, { node, ancestors });
      if (node.children) collectNodes(node.children, [...ancestors, node]);
    }
  };
  collectNodes(page.nodes, []);

  for (const [id, { node }] of nodeMap.entries()) {
    // Validate segmented tabsTarget
    if (node.type === 'segmented' && typeof node.props?.tabsTarget === 'string' && node.props.tabsTarget.trim()) {
      const targetId = node.props.tabsTarget.trim();
      const targetEntry = nodeMap.get(targetId);
      if (!targetEntry) {
        fail(`segmented tabsTarget 未在同页找到目标 tabs：${targetId}`);
      }
      if (targetEntry.node.type !== 'tabs') {
        fail(`segmented tabsTarget 目标节点不是 tabs：${targetId}`);
      }
      const tabpanels = (targetEntry.node.children || []).filter(c => c.type === 'tabpanel');
      if (tabpanels.length === 0) {
        fail(`segmented tabsTarget 目标 tabs 必须包含 tabpanel 子面板：${targetId}`);
      }
      if (typeof node.props.options === 'string' && node.props.options.trim()) {
        const segOptions = node.props.options.split(/[|,\n]/).map(s => s.trim()).filter(Boolean);
        const panelLabels = tabpanels.map(p => typeof p.props?.label === 'string' ? p.props.label.trim() : '').filter(Boolean);
        if (segOptions.length !== panelLabels.length || !segOptions.every((opt, i) => opt === panelLabels[i])) {
          fail(`segmented 选项 (${segOptions.join(',')}) 与目标 tabs 子面板标签 (${panelLabels.join(',')}) 不对应`);
        }
      }
    }

    // Validate scrollTo action
    if (node.action?.type === 'scrollTo') {
      const targetId = node.action.target?.trim();
      if (!targetId) {
        fail(`scrollTo 动作必须指定目标节点：${id}`);
      }
      const targetEntry = nodeMap.get(targetId);
      if (!targetEntry) {
        fail(`scrollTo 目标节点未在同页找到：${targetId}`);
      }
      if (targetEntry.node.type === 'tabpanel') {
        fail(`禁止直接滚动到标签面板容器：${targetId}`);
      }
      const inOverlay = ['drawer', 'modal', 'bottomsheet'].includes(targetEntry.node.type) ||
                        targetEntry.ancestors.some(a => ['drawer', 'modal', 'bottomsheet'].includes(a.type));
      if (inOverlay) {
        fail(`禁止滚动到弹层节点：${targetId}`);
      }
    }

    // Validate openOverlay action
    if (node.action?.type === 'openOverlay') {
      const targetId = node.action.target?.trim();
      if (!targetId) {
        fail(`openOverlay 动作必须指定目标弹层：${id}`);
      }
      const targetEntry = nodeMap.get(targetId);
      if (!targetEntry) {
        fail(`openOverlay 目标弹层未在同页找到：${targetId}`);
      }
      if (!['drawer', 'modal', 'bottomsheet'].includes(targetEntry.node.type)) {
        fail(`openOverlay 目标节点不是有效弹层：${targetId}`);
      }
    }

    // Validate closeOverlay action
    if (node.action?.type === 'closeOverlay') {
      const targetId = node.action.target?.trim();
      if (targetId) {
        const targetEntry = nodeMap.get(targetId);
        if (!targetEntry) {
          fail(`closeOverlay 目标弹层未在同页找到：${targetId}`);
        }
        if (!['drawer', 'modal', 'bottomsheet'].includes(targetEntry.node.type)) {
          fail(`closeOverlay 目标节点不是有效弹层：${targetId}`);
        }
      }
    }
  }
}

/**
 * Cleans up references to a deleted node from actions (scrollTo, openOverlay, closeOverlay) and component props (tabsTarget).
 */
export function clearNodeReferences(nodes: BuilderNode[], deletedNodeId: string): BuilderNode[] {
  return nodes.map(node => {
    let nextNode = { ...node };
    if (nextNode.action && ['scrollTo', 'openOverlay', 'closeOverlay'].includes(nextNode.action.type) && nextNode.action.target === deletedNodeId) {
      nextNode = { ...nextNode, action: undefined };
    }
    if (typeof nextNode.props?.tabsTarget === 'string' && nextNode.props.tabsTarget === deletedNodeId) {
      const nextProps = { ...nextNode.props };
      delete nextProps.tabsTarget;
      nextNode = { ...nextNode, props: nextProps };
    }
    if (nextNode.children && nextNode.children.length > 0) {
      nextNode.children = clearNodeReferences(nextNode.children, deletedNodeId);
    }
    return nextNode;
  });
}

