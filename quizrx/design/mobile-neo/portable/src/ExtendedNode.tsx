import React, { useEffect, useState } from 'react';
import type { BuilderNode } from '../shared/types';
import { resolveBottomnavActiveIndex } from '../shared/component-props.ts';

function findNodeInList(nodes: BuilderNode[], id: string): BuilderNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNodeInList(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

export interface ExtendedNodeProps {
  node: BuilderNode;
  editing: boolean;
  common: React.HTMLAttributes<HTMLElement> & { 'data-node-id'?: string };
  onAction?: () => void;
  pageId?: string;
  onNavigate?: (target: string) => void;
  activeTabs?: Record<string, number>;
  onTabChange?: (tabsId: string, index: number) => void;
  pageNodes?: BuilderNode[];
}
const text = (node: BuilderNode, key: string, fallback = '') => node.props[key] === undefined ? fallback : String(node.props[key]);
const items = (value: string) => value.split(/[|,\n]/).map(item => item.trim()).filter(Boolean).slice(0, 50);
const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function ExtendedNode({ node, editing, common, onAction, pageId, onNavigate, activeTabs, onTabChange, pageNodes }: ExtendedNodeProps) {
  const [value, setValue] = useState<string | number>();
  const [open, setOpen] = useState(Boolean(node.props.open));
  const [dismissed, setDismissed] = useState(false);
  const [localNavOption, setLocalNavOption] = useState<string | undefined>();
  const [prevPageId, setPrevPageId] = useState(pageId);
  if (pageId !== prevPageId) {
    setPrevPageId(pageId);
    setLocalNavOption(undefined);
  }
  useEffect(() => { setValue(undefined); setLocalNavOption(undefined); setOpen(Boolean(node.props.open)); setDismissed(false); }, [node.type, node.props.value, node.props.open, node.props.title]);
  const label = text(node, 'label', text(node, 'title'));
  const options = items(text(node, 'options'));
  const chosen = String(value ?? node.props.value ?? options[0] ?? '');
  const click = (event: React.MouseEvent, action: () => void) => {
    event.stopPropagation();
    if (editing) event.preventDefault();
    else action();
  };
  switch (node.type) {
    case 'alert': return <aside {...common} role="status">{!dismissed || editing ? <><span className="demo-alert-mark" aria-hidden="true">✓</span><div><strong>{text(node, 'title')}</strong><p>{text(node, 'description')}</p></div>{node.props.dismissible === true && <button type="button" aria-label="关闭提示横幅" onClick={event => click(event, () => setDismissed(true))}>×</button>}</> : <span className="demo-dismissed">提示已关闭</span>}</aside>;
    case 'accordion': return <details {...common} open={editing ? Boolean(node.props.open) : open} onToggle={event => { if (!editing) setOpen(event.currentTarget.open); }}><summary onClick={event => { if (editing) event.preventDefault(); }}>{text(node, 'title')}<span aria-hidden="true">＋</span></summary><p>{text(node, 'description')}</p></details>;
    case 'slider': {
      const min = Math.max(-10000, Math.min(10000, number(node.props.min, 0)));
      const max = Math.max(min + 1, Math.min(10001, number(node.props.max, 100)));
      const step = Math.max(.01, Math.min(max - min, number(node.props.step, 1)));
      const current = Math.max(min, Math.min(max, number(value ?? node.props.value, min)));
      return <section {...common}><div className="demo-field-heading"><span>{label}</span><output>{current} {text(node, 'unit')}</output></div><input type="range" aria-label={label || '滑块'} min={min} max={max} step={step} value={current} disabled={editing} onChange={event => setValue(Number(event.target.value))} /><div className="demo-slider-extents"><span>{min}</span><span>{max}</span></div></section>;
    }
    case 'radio': return <fieldset {...common}><legend>{label}</legend>{options.map((option, index) => <label className="demo-radio-option" key={`${index}/${option}`}><input type="radio" name={`radio-${node.id}`} value={option} checked={chosen === option} disabled={editing} onChange={() => setValue(option)} /><span>{option}</span></label>)}</fieldset>;
    case 'rating': {
      const max = Math.max(1, Math.min(10, Math.floor(number(node.props.max, 5))));
      const current = Math.max(0, Math.min(max, number(value ?? node.props.value, 0)));
      return <section {...common}><span className="demo-field-heading">{label}</span><div className="demo-stars" role="group" aria-label={label || '评分'}>{Array.from({ length: max }, (_, index) => <button type="button" key={index} aria-label={`${index + 1} 星`} aria-pressed={current === index + 1} className={index < current ? 'filled' : ''} onClick={event => click(event, () => setValue(index + 1))}>★</button>)}</div><small>{current} / {max}</small></section>;
    }
    case 'skeleton': return <section {...common} role="status" aria-label={label || '内容正在加载'} aria-busy="true"><div className="demo-skeleton-head"><i /><span /></div>{Array.from({ length: Math.max(1, Math.min(8, Math.floor(number(node.props.rows, 3)))) }, (_, index) => <div className="demo-skeleton-line" key={index} style={{ width: index % 2 ? '75%' : '100%' }} />)}</section>;
    case 'segmented': {
      const tabsTargetId = typeof node.props.tabsTarget === 'string' ? node.props.tabsTarget.trim() : undefined;
      const targetTabs = tabsTargetId && pageNodes ? findNodeInList(pageNodes, tabsTargetId) : undefined;
      const panelOptions = targetTabs && Array.isArray(targetTabs.children) && targetTabs.children.length > 0
        ? targetTabs.children.map((child: BuilderNode) => text(child, 'label', text(child, 'title', child.id)))
        : undefined;
      const effectiveOptions: string[] = (panelOptions && panelOptions.length > 0) ? panelOptions : options;
      const targetActiveIndex = tabsTargetId && activeTabs && pageId ? (activeTabs[`${pageId}/${tabsTargetId}`] ?? 0) : undefined;
      const activeOption = targetActiveIndex !== undefined && effectiveOptions[targetActiveIndex] !== undefined
        ? effectiveOptions[targetActiveIndex]
        : chosen;

      return (
        <section {...common}>
          <span className="demo-field-heading">{label}</span>
          <div className="demo-segment-options" role="group" aria-label={label || '分段选择'}>
            {effectiveOptions.map((option: string, index: number) => {
              const isSelected = activeOption === option || (targetActiveIndex !== undefined ? targetActiveIndex === index : chosen === option);
              return (
                <button
                  type="button"
                  key={`${index}/${option}`}
                  aria-pressed={isSelected}
                  className={isSelected ? 'active' : ''}
                  onClick={event => click(event, () => {
                    setValue(option);
                    if (tabsTargetId && onTabChange) {
                      onTabChange(tabsTargetId, index);
                    }
                  })}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </section>
      );
    }
    case 'breadcrumb': {
      const trail = items(text(node, 'items'));
      return <nav {...common} aria-label={label || '当前位置'}><ol>{trail.map((item, index) => <li key={index}>{index > 0 && <span aria-hidden="true">›</span>}{index === trail.length - 1 ? <strong aria-current="page">{item}</strong> : <button type="button" onClick={event => click(event, () => onAction?.())}>{item}</button>}</li>)}</ol></nav>;
    }
    case 'list': return <section {...common}><h3>{text(node, 'title')}</h3><ul>{items(text(node, 'items')).map((item, index) => <li key={index}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span>{item}</span></li>)}</ul></section>;
    case 'timeline': return <section {...common}><h3>{text(node, 'title')}</h3><ol>{items(text(node, 'items')).map((item, index) => <li key={index}><i aria-hidden="true" /><div>{item}</div></li>)}</ol></section>;
    case 'pricing': return <section {...common}><span className="demo-pricing-kicker">{text(node, 'caption', '给自己的长期计划')}</span><h3>{text(node, 'title')}</h3><p>{text(node, 'description')}</p><div className="demo-price"><strong>{text(node, 'price')}</strong><span>{text(node, 'period')}</span></div><ul>{items(text(node, 'features')).map((feature, index) => <li key={index}><span aria-hidden="true">✓</span>{feature}</li>)}</ul><button type="button" className="demo-button" onClick={event => click(event, () => onAction?.())}>{label || '选择方案'}</button></section>;
    case 'testimonial': return <figure {...common}><span className="demo-quote-mark" aria-hidden="true">“</span><blockquote>{text(node, 'quote')}</blockquote><figcaption><span className="demo-avatar">{text(node, 'author').slice(0, 1)}</span><div><strong>{text(node, 'author')}</strong><small>{text(node, 'role')}</small></div></figcaption></figure>;
    case 'search': return <label {...common}><span className="demo-search-mark" aria-hidden="true">⌕</span><input type="search" aria-label={label || '搜索'} placeholder={text(node, 'placeholder')} value={String(value ?? node.props.value ?? '')} readOnly={editing} onChange={event => setValue(event.target.value)} /><button type="button" aria-label="清空搜索" disabled={!String(value ?? node.props.value ?? '')} onClick={event => click(event, () => setValue(''))}>×</button></label>;
    case 'bottomnav': {
      const hasTargets = typeof node.props.pageTargets === 'string';
      const targets = hasTargets
        ? String(node.props.pageTargets).split('|').map(t => t.trim())
        : [];
      const activeIndex = resolveBottomnavActiveIndex({
        options,
        pageTargets: hasTargets ? String(node.props.pageTargets) : undefined,
        pageId,
        localSelection: localNavOption,
        valueProp: node.props.value !== undefined ? String(node.props.value) : undefined,
      });

      return (
        <nav {...common} aria-label={label || '主导航'}>
          {options.map((option, index) => {
            const isActive = index === activeIndex;
            const target = targets[index];
            return (
              <button
                key={`${index}/${option}`}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                className={isActive ? 'active' : ''}
                onClick={event => click(event, () => {
                  setValue(option);
                  setLocalNavOption(option);
                  if (hasTargets) {
                    if (target) onNavigate?.(target);
                  } else if (node.action) {
                    onAction?.();
                  }
                })}
              >
                <span aria-hidden="true">{['◷', '▤', '◉', '◇'][index % 4]}</span>
                <strong>{option}</strong>
              </button>
            );
          })}
        </nav>
      );
    }
    default: return <div {...common}>暂不支持此组件</div>;
  }
}
