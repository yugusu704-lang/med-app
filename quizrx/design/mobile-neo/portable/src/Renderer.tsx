import React, { useEffect, useRef, useState } from 'react';
import type { BuilderNode, Project } from '../shared/types';
import { readNodePosition } from '../shared/position';
import { isNodeLocked, normalizeSelection, resizeAxes, type LayoutChange } from '../shared/layout';
import { readMotion, motionStyle } from '../shared/motion';
import { resolveStyle } from '../shared/style-resolver';
import { resolveNodeStyle } from '../shared/node-style';
import { styleFontCss } from '../shared/style-fonts';
import { resolveDefaultBackTarget } from '../shared/initial-demo-page';
import { resolveProgressProps, resolveCheckControl, getDefaultCheckControl, resolveSwitchControl } from '../shared/component-props';
import { partitionPageNodes } from '../shared/viewport';
import { shouldCloseSheet, shouldCloseDrawer } from '../shared/overlay-gesture';
import { useCanvasDrag } from './useCanvasDrag';
import { ExtendedNode } from './ExtendedNode';
if (typeof document !== 'undefined' && !document.querySelector('link[data-demo-runtime]')) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./runtime.css', import.meta.url).href;
  stylesheet.dataset.demoRuntime = 'true';
  document.head.append(stylesheet);
}

export interface RendererProps {
  project: Project;
  pageId: string;
  editing: boolean;
  selectedNodeId?: string;
  selectedNodeIds?: string[];
  onSelect?: (id: string, additive?: boolean) => void;
  onNavigate?: (id: string) => void;
  onBack?: () => void;
  canBack?: boolean;
  onCloseTopOverlay?: () => boolean;
  onMove?: (id: string, position: { x: number; y: number }) => void;
  onLayoutCommit?: (changes: LayoutChange[]) => void;
  motionReplay?: number;
  assetBase?: string;
  initialOverlayStack?: string[];
  initialDialog?: string;
}

type Values = Record<string, string | boolean>;
type StoredTask = { title: string; complete: boolean; pageId: string };

function nodeStyle(input: BuilderNode['style']): React.CSSProperties {
  return resolveNodeStyle(input) as React.CSSProperties;
}

function textProp(node: BuilderNode, ...keys: string[]): string {
  for (const key of keys) {
    const value = node.props?.[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return '';
}

function boolProp(node: BuilderNode, ...keys: string[]): boolean {
  return keys.some((key) => node.props?.[key] === true);
}

function childrenOf(node: BuilderNode): BuilderNode[] { return Array.isArray(node.children) ? node.children : []; }

function containsNode(root: BuilderNode, targetId: string): boolean {
  if (root.id === targetId) return true;
  return Boolean(root.children?.some((child) => containsNode(child, targetId)));
}

function initialValue(node: BuilderNode): string {
  return textProp(node, 'value', 'defaultValue');
}

export function resolveAssetSrc(src: string): string {
  const match = /^asset:([a-f\d]{64}\.[a-z\d]{1,12})$/i.exec(src);
  return match ? `/api/assets/${match[1]}` : src;
}

export function requiredFieldError(
  nodes: BuilderNode[],
  values: Values,
  pageId: string,
  activeTabsMap: Record<string, number> = {},
): string | undefined {
  const fields: BuilderNode[] = [];
  const visit = (items: BuilderNode[]) => items.forEach((node) => {
    if (node.type === 'input' || node.type === 'textarea') fields.push(node);
    if (node.type === 'tabs' && Array.isArray(node.children) && node.children.length > 0) {
      const activeIndex = activeTabsMap[`${pageId}/${node.id}`] ?? 0;
      const activeChild = node.children[activeIndex] || node.children[0];
      if (activeChild) visit([activeChild]);
      return;
    }
    visit(childrenOf(node));
  });
  visit(nodes);
  const missing = fields.find((field) => boolProp(field, 'required') && !String(values[`${pageId}/${field.id}`] ?? initialValue(field)).trim());
  return missing ? textProp(missing, 'label', 'placeholder') : undefined;
}

function isFocusableVisible(el: HTMLElement | null): boolean {
  if (!el || typeof document === 'undefined') return false;
  if (!document.body.contains(el)) return false;
  if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0 && !el.getClientRects().length) return false;
  return true;
}

export function Renderer({ project, pageId, editing, selectedNodeId, selectedNodeIds, onSelect, onNavigate, onBack, canBack, onCloseTopOverlay, onMove, onLayoutCommit, motionReplay = 0, assetBase = '/api/assets/', initialOverlayStack, initialDialog }: RendererProps) {
  const page = project.pages.find((item) => item.id === pageId);
  const { fixedTopBar, fixedBottomBar, dockedNav, mainNodes, overlayNodes, hasFixedRegions } = partitionPageNodes(page?.nodes ?? []);
  const [values, setValues] = useState<Values>({});
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [activeTabs, setActiveTabs] = useState<Record<string, number>>({});
  const [tasks, setTasks] = useState<StoredTask[]>([]);
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState(initialDialog ?? '');
  const [overlayStack, setOverlayStack] = useState<string[]>(initialOverlayStack ?? []);
  const [sheetDrag, setSheetDrag] = useState<{ id: string; deltaY: number; isDragging: boolean }>({ id: '', deltaY: 0, isDragging: false });
  const [drawerDrag, setDrawerDrag] = useState<{ id: string; deltaX: number; isDragging: boolean }>({ id: '', deltaX: 0, isDragging: false });
  const sheetDragStartRef = useRef<{ startY: number; startTime: number; pointerId: number } | null>(null);
  const drawerDragStartRef = useRef<{ startX: number; startTime: number; pointerId: number } | null>(null);
  const triggerElementsRef = useRef<Map<string, HTMLElement | null>>(new Map());
  const prevStackRef = useRef<string[]>([]);
  const topOverlayRef = useRef<HTMLElement | null>(null);
  const currentPageIdRef = useRef(pageId);

  useEffect(() => {
    currentPageIdRef.current = pageId;
    setOverlayStack(initialOverlayStack ?? []);
    setDialog(initialDialog ?? '');
    triggerElementsRef.current.clear();
    prevStackRef.current = [];
  }, [pageId, editing]);

  const selection = normalizeSelection(page?.nodes ?? [], selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []));
  const drag = useCanvasDrag({ enabled: editing && Boolean(onMove || onLayoutCommit), pageId, nodes: page?.nodes ?? [], selectedNodeIds: selection, onSelect, onMove, onLayoutCommit });
  const lastReplay = useRef(motionReplay);
  const [replay, setReplay] = useState<{ id: string; token: number; active: boolean }>();
  useEffect(() => {
    if (motionReplay === lastReplay.current) return;
    lastReplay.current = motionReplay;
    if (selectedNodeId) setReplay({ id: selectedNodeId, token: motionReplay, active: true });
  }, [motionReplay, selectedNodeId]);

  const showToast = (message: string) => {
    setToast(message || '已完成');
    window.setTimeout(() => setToast(''), 2600);
  };

  const updateValue = (key: string, value: string | boolean) => setValues((current) => ({ ...current, [key]: value }));

  const openOverlay = (targetId?: string) => {
    if (!targetId) return;
    if (overlayStack.includes(targetId)) return;
    if (overlayStack.length >= 2) {
      showToast('最多同时打开两层弹层');
      return;
    }
    const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null;
    triggerElementsRef.current.set(targetId, activeEl);
    setOverlayStack((curr) => [...curr, targetId]);
  };

  const openDialog = (message: string) => {
    if (overlayStack.includes('__builtin_dialog__')) {
      setDialog(message);
      return;
    }
    if (overlayStack.length >= 2) {
      showToast('最多同时打开两层弹层');
      return;
    }
    const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null;
    triggerElementsRef.current.set('__builtin_dialog__', activeEl);
    setDialog(message);
    setOverlayStack((curr) => [...curr, '__builtin_dialog__']);
  };

  const closeDialog = () => {
    setDialog('');
    closeOverlay('__builtin_dialog__');
  };

  const closeOverlay = (targetId?: string) => {
    setOverlayStack((curr) => {
      if (!curr.length) return curr;
      const next = targetId ? curr.filter((id) => id !== targetId) : curr.slice(0, -1);
      if (!next.includes('__builtin_dialog__')) setDialog('');
      return next;
    });
  };

  useEffect(() => {
    if (editing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (overlayStack.length > 0) {
          const topId = overlayStack[overlayStack.length - 1];
          if (topId === '__builtin_dialog__') {
            e.preventDefault();
            closeDialog();
            return;
          }
          const topNode = page?.nodes.find((n) => n.id === topId);
          if (topNode && topNode.props.escapeClosable !== false) {
            e.preventDefault();
            closeOverlay(topId);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editing, overlayStack, page]);

  useEffect(() => {
    if (editing) return;
    if (currentPageIdRef.current !== pageId) return;

    const prevStack = prevStackRef.current;
    prevStackRef.current = overlayStack;

    // Check if any overlay closed
    const closedIds = prevStack.filter((id) => !overlayStack.includes(id));
    if (closedIds.length > 0) {
      const topClosedId = closedIds[closedIds.length - 1];
      const triggerEl = triggerElementsRef.current.get(topClosedId) ?? null;
      triggerElementsRef.current.delete(topClosedId);

      if (overlayStack.length > 0) {
        // A lower layer is now topmost, or a lower layer was closed while current remains topmost.
        // Focus MUST only restore to current top overlay or a valid visible trigger inside that top overlay.
        const container = topOverlayRef.current;
        if (container) {
          if (triggerEl && container.contains(triggerEl) && isFocusableVisible(triggerEl)) {
            triggerEl.focus();
          } else {
            const closeBtn = container.querySelector<HTMLElement>('.demo-overlay-close, .demo-dialog-close');
            if (closeBtn && isFocusableVisible(closeBtn)) {
              closeBtn.focus();
            } else {
              container.focus();
            }
          }
        }
      } else {
        // All overlay layers have closed: restore focus to initial trigger element if connected and visible
        if (isFocusableVisible(triggerEl)) {
          triggerEl!.focus();
        } else {
          // Viewport root fallback
          const root = drag.rootRef.current || (typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.demo-root') : null);
          root?.focus();
        }
        triggerElementsRef.current.clear();
      }
      return;
    }

    // Overlay was opened
    if (overlayStack.length > 0) {
      const timer = setTimeout(() => {
        const container = topOverlayRef.current;
        if (!container) return;
        const closeBtn = container.querySelector<HTMLElement>('.demo-overlay-close, .demo-dialog-close');
        if (closeBtn && isFocusableVisible(closeBtn)) {
          closeBtn.focus();
        } else {
          const focusable = Array.from(
            container.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          ).filter(isFocusableVisible);
          if (focusable.length > 0) {
            focusable[0].focus();
          } else {
            container.focus();
          }
        }
      }, 16);
      return () => clearTimeout(timer);
    }
  }, [overlayStack, editing, pageId]);

  const handleOverlayKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (editing || e.key !== 'Tab') return;
    const container = topOverlayRef.current;
    if (!container) return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(isFocusableVisible);

    if (!focusable.length) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || !container.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !container.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const handleSheetPointerDown = (sheetNode: BuilderNode, e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    sheetDragStartRef.current = { startY: e.clientY, startTime: performance.now(), pointerId: e.pointerId };
    setSheetDrag({ id: sheetNode.id, deltaY: 0, isDragging: true });
  };
  const handleSheetPointerMove = (sheetNode: BuilderNode, e: React.PointerEvent<HTMLDivElement>) => {
    if (editing || !sheetDragStartRef.current || sheetDragStartRef.current.pointerId !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - sheetDragStartRef.current.startY);
    setSheetDrag({ id: sheetNode.id, deltaY: dy, isDragging: true });
  };
  const handleSheetPointerUp = (sheetNode: BuilderNode, e: React.PointerEvent<HTMLDivElement>) => {
    if (!sheetDragStartRef.current || sheetDragStartRef.current.pointerId !== e.pointerId) return;
    const dt = performance.now() - sheetDragStartRef.current.startTime;
    const dy = Math.max(0, e.clientY - sheetDragStartRef.current.startY);
    const vy = dt > 0 ? dy / dt : 0;
    const sheetEl = e.currentTarget.closest<HTMLElement>('.demo-bottomsheet');
    const height = sheetEl ? sheetEl.offsetHeight : 300;
    sheetDragStartRef.current = null;
    setSheetDrag({ id: '', deltaY: 0, isDragging: false });
    if (shouldCloseSheet({ height, deltaY: dy, velocityY: vy })) {
      closeOverlay(sheetNode.id);
    }
  };
  const handleSheetPointerCancel = () => {
    sheetDragStartRef.current = null;
    setSheetDrag({ id: '', deltaY: 0, isDragging: false });
  };

  const handleDrawerPointerDown = (drawerNode: BuilderNode, e: React.PointerEvent<HTMLElement>) => {
    if (editing) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    drawerDragStartRef.current = { startX: e.clientX, startTime: performance.now(), pointerId: e.pointerId };
    setDrawerDrag({ id: drawerNode.id, deltaX: 0, isDragging: true });
  };
  const handleDrawerPointerMove = (drawerNode: BuilderNode, e: React.PointerEvent<HTMLElement>) => {
    if (editing || !drawerDragStartRef.current || drawerDragStartRef.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - drawerDragStartRef.current.startX;
    setDrawerDrag({ id: drawerNode.id, deltaX: dx, isDragging: true });
  };
  const handleDrawerPointerUp = (drawerNode: BuilderNode, e: React.PointerEvent<HTMLElement>) => {
    if (!drawerDragStartRef.current || drawerDragStartRef.current.pointerId !== e.pointerId) return;
    const dt = performance.now() - drawerDragStartRef.current.startTime;
    const dx = e.clientX - drawerDragStartRef.current.startX;
    const vx = dt > 0 ? dx / dt : 0;
    const drawerEl = e.currentTarget.closest<HTMLElement>('.demo-drawer');
    const width = drawerEl ? drawerEl.offsetWidth : 300;
    const side = (drawerNode.props.side === 'left' ? 'left' : 'right') as 'left' | 'right';
    drawerDragStartRef.current = null;
    setDrawerDrag({ id: '', deltaX: 0, isDragging: false });
    if (shouldCloseDrawer({ width, deltaX: dx, velocityX: vx, side })) {
      closeOverlay(drawerNode.id);
    }
  };
  const handleDrawerPointerCancel = () => {
    drawerDragStartRef.current = null;
    setDrawerDrag({ id: '', deltaX: 0, isDragging: false });
  };

  const taskFilter = (() => {
    if (!page || editing) return '';
    const stack = [...page.nodes];
    while (stack.length) {
      const node = stack.shift()!;
      if (node.type === 'tabs' && childrenOf(node).length === 0) {
        const options = textProp(node, 'items', 'options').split(/[|,]/).map((item) => item.trim()).filter(Boolean);
        return (options[activeTabs[`${pageId}/${node.id}`] ?? 0] || '').toLowerCase();
      }
      stack.push(...childrenOf(node));
    }
    return '';
  })();

  const submit = (target?: string, message?: string, sourceNode?: BuilderNode) => {
    const sourceOverlay = sourceNode ? overlayNodes.find(o => containsNode(o, sourceNode.id)) : undefined;
    const nodesToCheck = sourceOverlay ? [...mainNodes, sourceOverlay] : mainNodes;
    const error = requiredFieldError(nodesToCheck, values, pageId, activeTabs);
    if (error !== undefined) {
      showToast(error ? `请填写${error}` : '请完成必填项');
      return;
    }
    const fields: BuilderNode[] = [];
    const visit = (nodes: BuilderNode[]) => nodes.forEach((node) => {
      if (node.type === 'input' || node.type === 'textarea') fields.push(node);
      if (node.type === 'tabs' && Array.isArray(node.children) && node.children.length > 0) {
        const activeIndex = activeTabs[`${pageId}/${node.id}`] ?? 0;
        const activeChild = node.children[activeIndex] || node.children[0];
        if (activeChild) visit([activeChild]);
        return;
      }
      visit(childrenOf(node));
    });
    visit(nodesToCheck);
    const titleField = fields.find((field) => /task|title|name/i.test(textProp(field, 'name', 'label', 'placeholder')));
    const title = String((titleField && values[`${pageId}/${titleField.id}`]) || (titleField && initialValue(titleField)) || '').trim();
    if (title) {
      setTasks((current) => [{ title, complete: false, pageId: target || pageId }, ...current]);
      if (titleField) updateValue(`${pageId}/${titleField.id}`, '');
      showToast(message || '已添加任务');
    } else showToast(message || '已保存');
    if (target) onNavigate?.(target);
  };

  const runAction = (node: BuilderNode) => {
    const action = node.action;
    if (!action) { showToast(textProp(node, 'message') || '已完成'); return; }
    switch (action.type) {
      case 'navigate': onNavigate?.(action.target || ''); break;
      case 'toast': showToast(action.message || textProp(node, 'label', 'text') || '已完成'); break;
      case 'dialog': openDialog(action.message || textProp(node, 'title', 'label', 'text') || '详情'); break;
      case 'openOverlay': openOverlay(action.target); break;
      case 'closeOverlay': closeOverlay(action.target); break;
      case 'submit': submit(action.target, action.message, node); break;
      case 'toggle': setCompleted((current) => ({ ...current, [`${pageId}/${node.id}`]: !current[`${pageId}/${node.id}`] })); break;
      case 'scrollTo': {
        const targetId = action.target?.trim();
        if (!targetId || typeof document === 'undefined') break;
        const root = drag.rootRef.current || document.querySelector<HTMLElement>('.demo-root');
        if (!root) break;
        const targetEl = root.querySelector<HTMLElement>(`[data-node-id="${targetId}"]`);
        if (!targetEl) break;
        if (targetEl.offsetParent === null && targetEl.offsetWidth === 0 && targetEl.offsetHeight === 0) {
          // Hidden in inactive tabpanel or overlay
          break;
        }
        let container: HTMLElement | null = targetEl.parentElement;
        while (container && container !== root) {
          if (container.dataset.scrollAxis === 'vertical' || container.classList.contains('demo-scroll-content') || container.scrollHeight > container.clientHeight) {
            break;
          }
          container = container.parentElement;
        }
        if (!container) container = root.querySelector<HTMLElement>('.demo-scroll-content') || (root as HTMLElement);

        const stickyEl = container.querySelector<HTMLElement>(':scope > .demo-sticky, :scope .demo-sticky');
        const stickyOffset = stickyEl ? (parseFloat(stickyEl.dataset.stickyOffset || '0') || 0) : 0;
        const stickyOcclusion = stickyEl ? stickyEl.offsetHeight + stickyOffset : 0;

        const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';

        const containerRect = container.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const relativeTop = targetRect.top - containerRect.top + container.scrollTop;
        const targetScrollTop = Math.max(0, relativeTop - stickyOcclusion - 12);

        container.scrollTo({ top: targetScrollTop, behavior });
        break;
      }
      case 'back': {
        if (overlayStack.length > 0) {
          closeOverlay();
          break;
        }
        if (onCloseTopOverlay?.()) break;
        if (onBack) {
          onBack();
        } else {
          const initialId = project.pages[0]?.id;
          if (initialId && pageId !== initialId) {
            onNavigate?.(initialId);
          }
        }
        break;
      }
    }
  };

  const renderNode = (node: BuilderNode, path: string, parentNode?: BuilderNode): React.ReactNode => {
    const key = `${pageId}/${node.id}`;
    const selected = selection.includes(node.id);
    const locked = isNodeLocked(page?.nodes ?? [], node.id);
    const childNodes = childrenOf(node);
    const label = textProp(node, 'label', 'title', 'text', 'name');
    const content = (className = '') => <span className={className}>{label || textProp(node, 'value', 'caption')}</span>;
    const kids = () => childNodes.map((child, index) => <React.Fragment key={`${pageId}/${child.id}`}>{renderNode(child, `${path}/${index}`, node)}</React.Fragment>);
    const handleClick = (event: React.MouseEvent) => {
      if (editing) {
        event.preventDefault(); event.stopPropagation();
        if (!event.detail || !drag.consumePointerSelection(node.id)) onSelect?.(node.id, event.shiftKey);
      }
    };
    const position = readNodePosition(node.props);
    const motion = readMotion(node.props);
    const isReplaying = editing && replay?.id === node.id && replay.active && selected;
    const nodeKey = editing && replay?.id === node.id ? `${key}/replay-${replay.token}` : key;
    const variant = textProp(node, 'variant') || (node.type === 'button' ? 'primary' : '');
    const common = {
      className: `demo-node demo-${node.type}${variant ? ` variant-${variant}` : ''}${editing ? ' is-editing' : ''}${selected ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`,
      style: { ...nodeStyle(node.style), ...motionStyle(motion), ...(isReplaying ? { '--motion-iterations': '1' } : {}), position: 'relative' as const, left: position.x, top: position.y },
      onClick: (event: React.MouseEvent) => { handleClick(event); if (!editing && node.action && !['button', 'tabs', 'switch', 'task', 'habit', 'navbar', 'bottomnav'].includes(node.type)) runAction(node); },
      'data-node-id': node.id,
      'data-offset-x': position.x,
      'data-offset-y': position.y,
      'data-node-type': node.type,
      'data-resize-axes': locked ? 'none' : resizeAxes(node.type),
      'data-authored-width': typeof node.style.width === 'number' ? 'true' : undefined,
      'data-authored-height': typeof node.style.height === 'number' ? 'true' : undefined,
      'data-animation': motion.preset,
      'data-motion-trigger': isReplaying ? 'enter' : motion.trigger,
      'data-motion-enabled': !editing || isReplaying ? 'true' : 'false',
      onAnimationEnd: () => { if (isReplaying) setReplay(value => value ? { ...value, active: false } : value); },
    };
    const act = (event: React.MouseEvent) => { event.stopPropagation(); if (!editing) runAction(node); };
    const stored = values[`${pageId}/${node.id}`];
    const check = typeof stored === 'boolean' ? stored : boolProp(node, 'checked', 'defaultChecked');
    const completeKey = `${pageId}/${node.id}`;
    const isComplete = completed[completeKey] ?? boolProp(node, 'complete', 'completed', 'checked');

    switch (node.type) {
      case 'stack': return <div key={nodeKey} {...common}>{kids()}</div>;
      case 'row': return <div key={nodeKey} {...common}>{kids()}</div>;
      case 'grid': return <div key={nodeKey} {...common}>{kids()}</div>;
      case 'card': return <section key={nodeKey} {...common}>{label && <h3 className="demo-card-title">{label}</h3>}{kids()}</section>;
      case 'divider': return <hr key={nodeKey} {...common} aria-label={label || 'Divider'} />;
      case 'text': {
        const size = textProp(node, 'variant', 'size').toLowerCase();
        const Tag = size === 'title' || size === 'h1' || size === 'heading' ? 'h1' : size === 'subheading' || size === 'h2' ? 'h2' : size === 'caption' || size === 'eyebrow' ? 'small' : 'p';
        return <Tag key={nodeKey} {...common} className={`${common.className}${['heading','subheading','body','eyebrow','muted','caption','title'].includes(size) ? ` demo-text-${size}` : ''}`}>{label || '文字'}</Tag>;
      }
      case 'image': {
        const src = resolveAssetSrc(textProp(node, 'src', 'url'));
        const altText = textProp(node, 'alt', 'label') || '图片预览';
        if (src) {
          return <img key={nodeKey} {...common} src={src} alt={altText} />;
        }
        const cleanAlt = altText.trim();
        const parentLabel = (parentNode ? (textProp(parentNode, 'label', 'title', 'text', 'name') || '') : '').trim();
        const isParentDuplicate = Boolean(
          cleanAlt && parentLabel && (
            cleanAlt === parentLabel ||
            parentLabel.includes(cleanAlt) ||
            cleanAlt.includes(parentLabel)
          )
        );
        const siblingMatches = Boolean(
          cleanAlt && parentNode?.children?.some((sibling) => {
            if (sibling.id === node.id) return false;
            const siblingText = (textProp(sibling, 'text', 'label', 'title', 'name', 'value') || '').trim();
            return Boolean(
              siblingText && (
                siblingText === cleanAlt ||
                siblingText.includes(cleanAlt) ||
                cleanAlt.includes(siblingText)
              )
            );
          })
        );
        const isRedundant = isParentDuplicate || siblingMatches;
        const isGeneric = !cleanAlt || cleanAlt === '图片' || cleanAlt === '图片预览' || cleanAlt === '图片占位';

        return (
          <div key={nodeKey} {...common} role="img" aria-label={altText}>
            <svg
              className="demo-image-icon"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            {!isRedundant && !isGeneric && <span className="demo-image-text">{cleanAlt}</span>}
          </div>
        );
      }
      case 'avatar': {
        const src = resolveAssetSrc(textProp(node, 'src', 'url'));
        return <span key={nodeKey} {...common} aria-label={label || 'Avatar'}>{src ? <img src={src} alt="" /> : (label || '?').trim().slice(0, 2).toUpperCase()}</span>;
      }
      case 'badge': return <span key={nodeKey} {...common}>{label || '标签'}</span>;
      case 'button': {
        const isBackAction = node.action?.type === 'back';
        const isBackDisabled = !editing && isBackAction && canBack === false;
        return (
          <button
            key={nodeKey}
            {...common}
            type="button"
            disabled={isBackDisabled}
            aria-pressed={node.action?.type === 'toggle' ? isComplete : undefined}
            onClick={(event) => {
              handleClick(event);
              if (!editing && !isBackDisabled) act(event);
            }}
          >
            {content()}
            {!label && (isBackAction ? '返回' : '按钮')}
          </button>
        );
      }
      case 'input': return <label key={nodeKey} {...common}><span>{textProp(node, 'label') || textProp(node, 'placeholder') || '单行输入'}</span><input type={textProp(node, 'inputType', 'type') || 'text'} placeholder={textProp(node, 'placeholder')} value={String(stored ?? initialValue(node))} required={boolProp(node, 'required')} onChange={(event) => { if (!editing) updateValue(`${pageId}/${node.id}`, event.target.value); }} onClick={(event) => { if (editing) handleClick(event as unknown as React.MouseEvent); }} /></label>;
      case 'textarea': return <label key={nodeKey} {...common}><span>{textProp(node, 'label') || textProp(node, 'placeholder') || '备注'}</span><textarea placeholder={textProp(node, 'placeholder')} value={String(stored ?? initialValue(node))} required={boolProp(node, 'required')} rows={Number(node.props?.rows) || 3} onChange={(event) => { if (!editing) updateValue(`${pageId}/${node.id}`, event.target.value); }} onClick={(event) => { if (editing) handleClick(event as unknown as React.MouseEvent); }} /></label>;
      case 'checkbox': {
        const checkControl = resolveCheckControl(node.props, check, getDefaultCheckControl('checkbox'));
        return <label key={nodeKey} {...common}><input type="checkbox" className="demo-checkbox-native" checked={check} onChange={(event) => { if (!editing) updateValue(`${pageId}/${node.id}`, event.target.checked); }} /><span className={`demo-checkbox-indicator${check ? ' checked' : ''}`} aria-hidden="true" style={checkControl.style}>{check ? '✓' : ''}</span><span>{label || '复选框'}</span></label>;
      }
      case 'switch': {
        const switchControl = resolveSwitchControl(node.props, check);
        return (
          <label key={nodeKey} {...common}>
            <span>{label || '开关'}</span>
            <button
              type="button"
              className={`demo-switch-control${check ? ' on' : ''}`}
              role="switch"
              aria-checked={check}
              style={switchControl.controlStyle}
              onClick={(event) => {
                event.stopPropagation();
                handleClick(event);
                if (!editing) updateValue(`${pageId}/${node.id}`, !check);
              }}
            >
              <i style={switchControl.thumbStyle} />
            </button>
          </label>
        );
      }
      case 'select': {
        const options = textProp(node, 'options').split(/[|,]/).map((option) => option.trim()).filter(Boolean);
        return <label key={nodeKey} {...common}><span>{textProp(node, 'label') || '选择一项'}</span><select value={String(stored ?? textProp(node, 'value') ?? options[0] ?? '')} onChange={(event) => { if (!editing) updateValue(`${pageId}/${node.id}`, event.target.value); }}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
      }
      case 'progress': {
        const value = Math.min(100, Math.max(0, Number(node.props?.value) || 0));
        const progressProps = resolveProgressProps(node.props);
        return <div key={nodeKey} {...common}><div className="demo-progress-label"><span>{label || '进度'}</span><strong>{value}%</strong></div><div className="demo-progress-track" style={progressProps.trackStyle}><i style={{ width: `${value}%`, ...progressProps.fillStyle }} /></div></div>;
      }
      case 'stat': return <div key={nodeKey} {...common}><span>{label || '数据'}</span><strong>{textProp(node, 'value', 'amount') || '0'}</strong>{textProp(node, 'caption', 'change') && <small>{textProp(node, 'caption', 'change')}</small>}</div>;
      case 'task': {
        const title = label || '一件重要的小事';
        if ((taskFilter.includes('完成') && !taskFilter.includes('进行') && !isComplete) || ((taskFilter.includes('进行') || taskFilter.includes('active') || taskFilter.includes('progress')) && isComplete)) return null;
        const checkControl = resolveCheckControl(node.props, isComplete, getDefaultCheckControl('task'));
        return <article key={nodeKey} {...common} onClick={(event) => { handleClick(event); if (!editing && node.action) runAction(node); }}><button type="button" className={`demo-task-check${isComplete ? ' checked' : ''}`} aria-label={isComplete ? '标记为未完成' : '标记为已完成'} style={checkControl.style} onClick={(event) => { event.stopPropagation(); handleClick(event); if (!editing) setCompleted((current) => ({ ...current, [completeKey]: !isComplete })); }}>{isComplete ? '✓' : ''}</button><div className={`demo-task-copy${isComplete ? ' complete' : ''}`}><strong>{title}</strong><span>{textProp(node, 'subtitle', 'description', 'time') || '今天 · 个人'}</span></div>{textProp(node, 'tag', 'category') && <span className="demo-task-tag">{textProp(node, 'tag', 'category')}</span>}</article>;
      }
      case 'habit': {
        const days = textProp(node, 'days', 'streak') || '3';
        const habitCheck = resolveCheckControl(node.props, isComplete, getDefaultCheckControl('habit'));
        return (
          <article key={nodeKey} {...common}>
            <div className="demo-habit-icon">✦</div>
            <div className="demo-task-copy">
              <strong>{label || '每日习惯'}</strong>
              <span>{textProp(node, 'subtitle', 'description') || `已连续坚持 ${days} 天`}</span>
            </div>
            <button
              className={`demo-habit-check${isComplete ? ' checked' : ''}`}
              type="button"
              aria-label="标记习惯完成"
              style={habitCheck.style}
              onClick={(event) => {
                event.stopPropagation();
                handleClick(event);
                if (!editing) setCompleted((current) => ({ ...current, [completeKey]: !isComplete }));
              }}
            >
              {isComplete ? '✓' : '+'}
            </button>
          </article>
        );
      }
      case 'navbar': {
        const title = textProp(node, 'title', 'brand', 'label') || '页面标题';
        const hasNavigateAction = node.action?.type === 'navigate';
        const hasBackAction = node.action?.type === 'back';
        const defaultBackTarget = !node.action ? resolveDefaultBackTarget(project, pageId) : undefined;
        const canGoBack = Boolean(hasNavigateAction || (hasBackAction ? canBack !== false : (canBack || defaultBackTarget)));
        const backLabel = hasNavigateAction ? '跳转' : !node.action ? '返回首页' : '返回上一页';

        return (
          <nav key={nodeKey} {...common} aria-label={title}>
            {childNodes.length ? kids() : (
              <>
                <span className="demo-navbar-leading">
                  {boolProp(node, 'back') ? (
                    <button
                      type="button"
                      aria-label={backLabel}
                      disabled={!editing && !canGoBack}
                      onClick={(event) => {
                        handleClick(event);
                        if (editing) return;
                        if (overlayStack.length > 0) {
                          closeOverlay();
                        } else if (onCloseTopOverlay?.()) {
                          // handled by prop
                        } else if (hasNavigateAction) {
                          runAction(node);
                        } else if (hasBackAction) {
                          runAction(node);
                        } else if (onBack && canBack) {
                          onBack();
                        } else if (defaultBackTarget) {
                          onNavigate?.(defaultBackTarget);
                        }
                      }}
                    >
                      ‹
                    </button>
                  ) : null}
                </span>
                <strong className="demo-navbar-title">{title}</strong>
                <span className="demo-navbar-trailing" />
              </>
            )}
          </nav>
        );
      }
      case 'tabs': {
        const hasChildren = childNodes.length > 0;
        const panelLabels = hasChildren
          ? childNodes.map((child) => textProp(child, 'label', 'title', 'text') || child.id)
          : textProp(node, 'items', 'options').split(/[|,]/).filter(Boolean).map((item) => item.trim());

        let active = activeTabs[completeKey] ?? 0;
        if (hasChildren) {
          if (selectedNodeId) {
            const matchingIndex = childNodes.findIndex((child) => containsNode(child, selectedNodeId));
            if (matchingIndex !== -1) {
              active = matchingIndex;
            }
          }
          if (active >= childNodes.length) active = 0;
        }

        return (
          <div key={nodeKey} {...common}>
            <div className="demo-tablist" role="tablist" aria-label={label || '分类'}>
              {panelLabels.map((item, index) => (
                <button
                  key={`${item}-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={active === index}
                  className={active === index ? 'active' : ''}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleClick(event);
                    setActiveTabs((current) => ({ ...current, [completeKey]: index }));
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            {hasChildren && (
              <div className="demo-tab-panel">
                {renderNode(childNodes[active] || childNodes[0], `${path}/tab${active}`, node)}
              </div>
            )}
          </div>
        );
      }
      case 'tabpanel': {
        return (
          <div
            key={nodeKey}
            {...common}
            className={`${common.className} demo-tabpanel`}
            role="tabpanel"
            aria-label={label || '标签面板'}
          >
            {kids()}
          </div>
        );
      }
      case 'empty': return <div key={nodeKey} {...common}><div className="demo-empty-icon">✦</div><strong>{label || '留一点空间给新的计划'}</strong><span>{textProp(node, 'description', 'subtitle') || '创建你的第一个目标，慢慢向前。'}</span>{kids()}</div>;
      case 'scroll': {
        const axis = node.props.axis === 'horizontal' ? 'horizontal' : 'vertical';
        const rawHeight = node.props.height;
        const resolvedHeight = typeof rawHeight === 'number' && Number.isFinite(rawHeight)
          ? rawHeight
          : (typeof node.style.height === 'number' ? node.style.height : 240);
        const scrollStyle: React.CSSProperties = axis === 'vertical'
          ? { ...common.style, height: `${resolvedHeight}px` }
          : { ...common.style };
        return (
          <div
            key={nodeKey}
            {...common}
            style={scrollStyle}
            data-scroll-axis={axis}
            tabIndex={0}
            aria-label={label || (axis === 'horizontal' ? '横向滚动区域' : '纵向滚动区域')}
          >
            {kids()}
          </div>
        );
      }
      case 'sticky': {
        const rawOffset = typeof node.props.offset === 'number' && Number.isFinite(node.props.offset)
          ? node.props.offset
          : 0;
        const offset = Math.max(0, Math.min(300, rawOffset));
        return (
          <div
            key={nodeKey}
            {...common}
            style={{ ...common.style, position: 'sticky', top: offset, zIndex: 5 }}
            data-sticky-offset={offset}
          >
            {kids()}
          </div>
        );
      }
      case 'fixedbar': {
        const edge = node.props.edge === 'top' ? 'top' : 'bottom';
        return (
          <div
            key={nodeKey}
            {...common}
            data-fixedbar-edge={edge}
            role="toolbar"
            aria-label={label || (edge === 'top' ? '顶部操作栏' : '底部操作栏')}
          >
            {kids()}
          </div>
        );
      }
      case 'drawer': {
        const side = (node.props.side === 'left' ? 'left' : 'right') as 'left' | 'right';
        const size = typeof node.props.size === 'number' ? node.props.size : 80;
        const title = textProp(node, 'title', 'label') || '侧边抽屉';
        const showCloseButton = node.props.showCloseButton !== false;
        const maskClosable = node.props.maskClosable !== false;

        const isSelectedOrHasSelectedDescendant = Boolean(
          editing && (selectedNodeId === node.id || (selectedNodeId && containsNode(node, selectedNodeId)))
        );
        const isOpen = !editing ? overlayStack.includes(node.id) : isSelectedOrHasSelectedDescendant;

        if (!isOpen) {
          return <div key={nodeKey} {...common} style={{ ...common.style, display: 'none' }} data-overlay-state="closed">{kids()}</div>;
        }

        const isTopmost = !editing && overlayStack[overlayStack.length - 1] === node.id;
        const isLower = !editing && !isTopmost && overlayStack.includes(node.id);
        const stackIndex = overlayStack.indexOf(node.id);
        const overlayZIndex = stackIndex >= 0 ? 100 + stackIndex * 10 : undefined;
        const isCurrentDragging = drawerDrag.isDragging && drawerDrag.id === node.id;

        return (
          <div
            key={nodeKey}
            className={`demo-overlay-backdrop demo-drawer-backdrop${isTopmost ? ' is-topmost' : ''}${isLower ? ' is-lower' : ''}${editing ? ' is-editing' : ''}`}
            style={{ zIndex: overlayZIndex }}
            aria-hidden={isLower ? 'true' : undefined}
            inert={isLower ? true : undefined}
            onClick={(e) => {
              if (e.target === e.currentTarget && !editing && maskClosable && isTopmost) {
                closeOverlay(node.id);
              }
            }}
          >
            <section
              {...common}
              ref={isTopmost ? (el) => { topOverlayRef.current = el; } : undefined}
              role="dialog"
              aria-modal={isTopmost ? 'true' : undefined}
              aria-label={title}
              tabIndex={-1}
              onKeyDown={isTopmost ? handleOverlayKeyDown : undefined}
              className={`${common.className} demo-drawer drawer-${side}${isCurrentDragging ? ' is-dragging' : ''}`}
              style={{
                ...common.style,
                '--drawer-size': size,
                '--drawer-drag-x': isCurrentDragging ? `${drawerDrag.deltaX}px` : '0px',
              } as React.CSSProperties}
              onClick={(e) => {
                handleClick(e);
                e.stopPropagation();
              }}
            >
              <header
                className="demo-drawer-header"
                onPointerDown={(e) => handleDrawerPointerDown(node, e)}
                onPointerMove={(e) => handleDrawerPointerMove(node, e)}
                onPointerUp={(e) => handleDrawerPointerUp(node, e)}
                onPointerCancel={handleDrawerPointerCancel}
              >
                <strong className="demo-overlay-title">{title}</strong>
                {showCloseButton && (
                  <button
                    type="button"
                    className="demo-overlay-close"
                    aria-label="关闭"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!editing) closeOverlay(node.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </header>
              <div className="demo-overlay-body" tabIndex={0}>
                {kids()}
              </div>
            </section>
          </div>
        );
      }
      case 'bottomsheet': {
        const height = typeof node.props.height === 'number' ? node.props.height : 60;
        const title = textProp(node, 'title', 'label') || '底部动作条';
        const showCloseButton = node.props.showCloseButton !== false;
        const maskClosable = node.props.maskClosable !== false;

        const isSelectedOrHasSelectedDescendant = Boolean(
          editing && (selectedNodeId === node.id || (selectedNodeId && containsNode(node, selectedNodeId)))
        );
        const isOpen = !editing ? overlayStack.includes(node.id) : isSelectedOrHasSelectedDescendant;

        if (!isOpen) {
          return <div key={nodeKey} {...common} style={{ ...common.style, display: 'none' }} data-overlay-state="closed">{kids()}</div>;
        }

        const isTopmost = !editing && overlayStack[overlayStack.length - 1] === node.id;
        const isLower = !editing && !isTopmost && overlayStack.includes(node.id);
        const stackIndex = overlayStack.indexOf(node.id);
        const overlayZIndex = stackIndex >= 0 ? 100 + stackIndex * 10 : undefined;
        const isCurrentDragging = sheetDrag.isDragging && sheetDrag.id === node.id;

        return (
          <div
            key={nodeKey}
            className={`demo-overlay-backdrop demo-bottomsheet-backdrop${isTopmost ? ' is-topmost' : ''}${isLower ? ' is-lower' : ''}${editing ? ' is-editing' : ''}`}
            style={{ zIndex: overlayZIndex }}
            aria-hidden={isLower ? 'true' : undefined}
            inert={isLower ? true : undefined}
            onClick={(e) => {
              if (e.target === e.currentTarget && !editing && maskClosable && isTopmost) {
                closeOverlay(node.id);
              }
            }}
          >
            <section
              {...common}
              ref={isTopmost ? (el) => { topOverlayRef.current = el; } : undefined}
              role="dialog"
              aria-modal={isTopmost ? 'true' : undefined}
              aria-label={title}
              tabIndex={-1}
              onKeyDown={isTopmost ? handleOverlayKeyDown : undefined}
              className={`${common.className} demo-bottomsheet${isCurrentDragging ? ' is-dragging' : ''}`}
              style={{
                ...common.style,
                '--sheet-height': height,
                '--sheet-drag-y': isCurrentDragging ? `${sheetDrag.deltaY}px` : '0px',
              } as React.CSSProperties}
              onClick={(e) => {
                handleClick(e);
                e.stopPropagation();
              }}
            >
              <div
                className="demo-sheet-handle"
                aria-hidden="true"
                onPointerDown={(e) => handleSheetPointerDown(node, e)}
                onPointerMove={(e) => handleSheetPointerMove(node, e)}
                onPointerUp={(e) => handleSheetPointerUp(node, e)}
                onPointerCancel={handleSheetPointerCancel}
              />
              <header className="demo-sheet-header">
                <strong className="demo-overlay-title">{title}</strong>
                {showCloseButton && (
                  <button
                    type="button"
                    className="demo-overlay-close"
                    aria-label="关闭"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!editing) closeOverlay(node.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </header>
              <div className="demo-overlay-body" tabIndex={0}>
                {kids()}
              </div>
            </section>
          </div>
        );
      }
      case 'modal': {
        const title = textProp(node, 'title', 'label') || '模态对话框';
        const showCloseButton = node.props.showCloseButton !== false;
        const maskClosable = node.props.maskClosable !== false;

        const isSelectedOrHasSelectedDescendant = Boolean(
          editing && (selectedNodeId === node.id || (selectedNodeId && containsNode(node, selectedNodeId)))
        );
        const isOpen = !editing ? overlayStack.includes(node.id) : isSelectedOrHasSelectedDescendant;

        if (!isOpen) {
          return <div key={nodeKey} {...common} style={{ ...common.style, display: 'none' }} data-overlay-state="closed">{kids()}</div>;
        }

        const isTopmost = !editing && overlayStack[overlayStack.length - 1] === node.id;
        const isLower = !editing && !isTopmost && overlayStack.includes(node.id);
        const stackIndex = overlayStack.indexOf(node.id);
        const overlayZIndex = stackIndex >= 0 ? 100 + stackIndex * 10 : undefined;

        return (
          <div
            key={nodeKey}
            className={`demo-overlay-backdrop demo-modal-backdrop${isTopmost ? ' is-topmost' : ''}${isLower ? ' is-lower' : ''}${editing ? ' is-editing' : ''}`}
            style={{ zIndex: overlayZIndex }}
            aria-hidden={isLower ? 'true' : undefined}
            inert={isLower ? true : undefined}
            onClick={(e) => {
              if (e.target === e.currentTarget && !editing && maskClosable && isTopmost) {
                closeOverlay(node.id);
              }
            }}
          >
            <section
              {...common}
              ref={isTopmost ? (el) => { topOverlayRef.current = el; } : undefined}
              role="dialog"
              aria-modal={isTopmost ? 'true' : undefined}
              aria-label={title}
              tabIndex={-1}
              onKeyDown={isTopmost ? handleOverlayKeyDown : undefined}
              className={`${common.className} demo-modal`}
              onClick={(e) => {
                handleClick(e);
                e.stopPropagation();
              }}
            >
              <header className="demo-modal-header">
                <strong className="demo-overlay-title">{title}</strong>
                {showCloseButton && (
                  <button
                    type="button"
                    className="demo-overlay-close"
                    aria-label="关闭"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!editing) closeOverlay(node.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </header>
              <div className="demo-overlay-body" tabIndex={0}>
                {kids()}
              </div>
            </section>
          </div>
        );
      }
      default:
        return (
          <ExtendedNode
            key={nodeKey}
            node={node}
            editing={editing}
            common={common}
            pageId={pageId}
            onNavigate={onNavigate}
            activeTabs={activeTabs}
            onTabChange={(tabsId, index) => setActiveTabs(curr => ({ ...curr, [`${pageId}/${tabsId}`]: index }))}
            pageNodes={page?.nodes}
            onAction={() => { if (!editing) runAction(node); }}
          />
        );
    }
  };

  const style = resolveStyle(project.design);
  const fontMatch = typeof project.fontAsset === 'string' ? /^([a-f\d]{64})\.(woff2?|ttf|otf)$/i.exec(project.fontAsset) : null;
  const safeAssetBase = /^(?:\/api\/assets\/|\.\/assets\/)$/.test(assetBase) ? assetBase : '/api/assets/';
  if (fontMatch) {
    const family = `AtelierFont-${fontMatch[1]}`;
    style['--demo-font'] = `"${family}", ${String(style['--demo-font'] ?? 'sans-serif')}`;
    style['--demo-heading-font'] = `"${family}", ${String(style['--demo-heading-font'] ?? 'sans-serif')}`;
  }
  const fontFormat = fontMatch?.[2]?.toLowerCase() === 'woff2' ? 'woff2' : fontMatch?.[2]?.toLowerCase() === 'woff' ? 'woff' : fontMatch?.[2]?.toLowerCase() === 'ttf' ? 'truetype' : 'opentype';
  const fontFace = fontMatch ? `@font-face{font-family:"AtelierFont-${fontMatch[1]}";src:url("${safeAssetBase}${project.fontAsset}") format("${fontFormat}");font-display:swap}` : undefined;
  const styleFonts = styleFontCss(project.design, safeAssetBase);
  const fontStyles = [styleFonts, fontFace].filter(Boolean).join('\n');
  const styleId = project.design?.id;
  const appearance = project.design?.parserVersion === 2 ? project.design.appearance : undefined;
  const appearanceAttributes = {
    'data-style-pattern': appearance?.pattern,
    'data-style-geometry': appearance?.geometry,
    'data-style-motion': appearance?.motion,
  };
  if (!page) return <div className={`demo-root theme-${project.theme}`} data-style={styleId} {...appearanceAttributes} data-font-asset={fontMatch ? 'true' : undefined} style={styleId || fontMatch ? style : undefined}>{fontStyles && <style data-demo-font>{fontStyles}</style>}<div className="demo-missing">此页面暂不可用。</div></div>;
  const content = <>
    {editing && !page.nodes.length && <div className="demo-editor-empty"><span>＋</span><strong>从一个组件开始</strong><p>在左侧组件库中选择内容，添加后拖动调整位置。</p></div>}
    {mainNodes.map((node) => <React.Fragment key={`${page.id}/${node.id}`}>{renderNode(node, String(page.nodes.indexOf(node)))}</React.Fragment>)}
    {tasks.some((task) => task.pageId === pageId) && <section className="demo-created-tasks" aria-live="polite"><h3>新建任务</h3>{tasks.filter((task) => task.pageId === pageId).map((task, index) => <article key={`${task.title}-${index}`} className="demo-task"><button type="button" className={`demo-task-check${task.complete ? ' checked' : ''}`} onClick={() => setTasks((current) => current.map((item) => item === task ? { ...item, complete: !item.complete } : item))}>{task.complete ? '✓' : ''}</button><div className={`demo-task-copy${task.complete ? ' complete' : ''}`}><strong>{task.title}</strong><span>刚刚 · 个人</span></div></article>)}</section>}
  </>;
  const isBackgroundInert = !editing && overlayStack.length > 0;
  return <div ref={drag.rootRef} tabIndex={-1} {...drag.handlers} className={`demo-root theme-${project.theme}${dockedNav ? ' has-fixed-bottomnav' : ''}${hasFixedRegions ? ' has-fixed-regions' : ''}${fixedTopBar ? ' has-fixed-top' : ''}${editing ? ' is-editing' : ''}${drag.draggingId ? ' is-dragging' : ''}${overlayStack.length > 0 ? ' has-open-overlay' : ''}${overlayNodes.length > 0 && !hasFixedRegions ? ' has-overlay-host' : ''}`} data-page-id={page.id} data-style={styleId} {...appearanceAttributes} data-font-asset={fontMatch ? 'true' : undefined} style={styleId || fontMatch ? style : undefined}>
    {fontStyles && <style data-demo-font>{fontStyles}</style>}
    {hasFixedRegions ? (
      <>
        {fixedTopBar && (
          <header className="demo-fixedbar-dock demo-fixedbar-top-dock" inert={isBackgroundInert ? true : undefined}>
            {renderNode(fixedTopBar, String(page.nodes.indexOf(fixedTopBar)))}
          </header>
        )}
        <div className="demo-scroll-content" key={page.id} tabIndex={0} aria-label="页面内容" inert={isBackgroundInert ? true : undefined}>
          {content}
        </div>
        {fixedBottomBar && (
          <aside className="demo-fixedbar-dock demo-fixedbar-bottom-dock" inert={isBackgroundInert ? true : undefined}>
            {renderNode(fixedBottomBar, String(page.nodes.indexOf(fixedBottomBar)))}
          </aside>
        )}
        {dockedNav && (
          <div className="demo-bottomnav-dock" inert={isBackgroundInert ? true : undefined}>
            {renderNode(dockedNav, String(page.nodes.indexOf(dockedNav)))}
          </div>
        )}
      </>
    ) : (
      <main className="demo-main-flow" inert={isBackgroundInert ? true : undefined}>
        {content}
      </main>
    )}
    {toast && <div className="demo-toast" role="status">{toast}</div>}
    {(overlayNodes.length > 0 || overlayStack.length > 0 || Boolean(dialog)) && (
      <div className="demo-overlay-host" aria-live="polite">
        {editing ? (
          overlayNodes.map((node) => (
            <React.Fragment key={`${page.id}/${node.id}`}>
              {renderNode(node, `overlay/${node.id}`)}
            </React.Fragment>
          ))
        ) : (
          <>
            {overlayNodes
              .filter((n) => !overlayStack.includes(n.id))
              .map((node) => (
                <React.Fragment key={`${page.id}/${node.id}`}>
                  {renderNode(node, `overlay/${node.id}`)}
                </React.Fragment>
              ))}
            {overlayStack.map((id, stackIndex) => {
              if (id === '__builtin_dialog__') {
                if (!dialog) return null;
                const isTopmost = overlayStack[overlayStack.length - 1] === '__builtin_dialog__';
                return (
                  <div
                    key="__builtin_dialog__"
                    className={`demo-overlay-backdrop demo-dialog-backdrop${isTopmost ? ' is-topmost' : ' is-lower'}${editing ? ' is-editing' : ''}`}
                    style={{ zIndex: 100 + stackIndex * 10 }}
                    aria-hidden={!isTopmost ? 'true' : undefined}
                    inert={!isTopmost ? true : undefined}
                    onClick={() => {
                      if (!editing && isTopmost) closeDialog();
                    }}
                  >
                    <section
                      ref={isTopmost ? (el) => { topOverlayRef.current = el; } : undefined}
                      className="demo-dialog"
                      role="dialog"
                      aria-modal={isTopmost ? 'true' : undefined}
                      aria-label={dialog}
                      tabIndex={-1}
                      onKeyDown={isTopmost ? handleOverlayKeyDown : undefined}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button className="demo-dialog-close" type="button" aria-label="关闭" onClick={() => closeDialog()}>×</button>
                      <div className="demo-dialog-icon">✦</div>
                      <h2>{dialog}</h2>
                      <p>停下来想一想，安排好今天最重要的事。</p>
                      <button type="button" className="demo-dialog-ok" onClick={() => closeDialog()}>知道了</button>
                    </section>
                  </div>
                );
              }
              const node = overlayNodes.find((n) => n.id === id);
              if (!node) return null;
              return (
                <React.Fragment key={`${page.id}/${node.id}`}>
                  {renderNode(node, `overlay/${node.id}`)}
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>
    )}
  </div>;
}

export default Renderer;
