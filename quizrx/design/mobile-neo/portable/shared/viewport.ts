import type { BuilderNode } from './types.ts';

export interface PartitionedPageNodes {
  fixedTopBar?: BuilderNode;
  fixedBottomBar?: BuilderNode;
  dockedNav?: BuilderNode;
  mainNodes: BuilderNode[];
  overlayNodes: BuilderNode[];
  hasFixedRegions: boolean;
}

/**
 * Partitions a page's top-level nodes into docked fixed regions, overlay declarations, and main scrollable content.
 * Follows the AGY composable behavior contracts:
 * - At most one top fixedbar docked at top
 * - At most one bottom fixedbar docked at bottom, positioned above the fixed bottomnav
 * - At most one bottomnav with placement='fixed' docked at bottom
 * - Overlays (drawer, bottomsheet, modal) extracted into overlayNodes
 * - When no fixed regions are configured, returns all nodes as mainNodes with hasFixedRegions=false
 *   to preserve existing visual flow and test compatibility.
 */
export function partitionPageNodes(nodes: BuilderNode[] = []): PartitionedPageNodes {
  let fixedTopBar: BuilderNode | undefined;
  let fixedBottomBar: BuilderNode | undefined;
  let dockedNav: BuilderNode | undefined;
  const mainNodes: BuilderNode[] = [];
  const overlayNodes: BuilderNode[] = [];

  for (const node of nodes) {
    if (node.type === 'fixedbar') {
      const edge = node.props?.edge === 'top' ? 'top' : 'bottom';
      if (edge === 'top' && !fixedTopBar) {
        fixedTopBar = node;
        continue;
      }
      if (edge === 'bottom' && !fixedBottomBar) {
        fixedBottomBar = node;
        continue;
      }
    } else if (node.type === 'bottomnav' && node.props?.placement === 'fixed' && !dockedNav) {
      dockedNav = node;
      continue;
    } else if (['drawer', 'bottomsheet', 'modal'].includes(node.type)) {
      overlayNodes.push(node);
      continue;
    }
    mainNodes.push(node);
  }

  const hasFixedRegions = Boolean(fixedTopBar || fixedBottomBar || dockedNav);
  return {
    fixedTopBar,
    fixedBottomBar,
    dockedNav,
    mainNodes,
    overlayNodes,
    hasFixedRegions,
  };
}
