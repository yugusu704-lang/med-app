import type { BuilderNode, ComponentType } from './types.ts';
import type { StyleTokens } from './resources.ts';
import { bestBlackOrWhite, parseRgb } from './style-resolver.ts';

export const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const DEFAULT_TRACK_HEIGHT = 8;
export const DEFAULT_CHECK_SIZE_CHECKBOX = 18;
export const DEFAULT_CHECK_SIZE_TASK = 23;
export const DEFAULT_CHECK_SIZE_HABIT = 32;
export const DEFAULT_CHECK_SHAPE_CHECKBOX = 'square' as const;
export const DEFAULT_CHECK_SHAPE_TASK = 'circle' as const;
export const DEFAULT_CHECK_SHAPE_HABIT = 'circle' as const;
export const DEFAULT_SWITCH_SIZE = 27;
export const DEFAULT_SWITCH_SHAPE = 'circle' as const;

export const COMPONENT_PROP_LABELS: Record<string, string> = {
  trackHeight: '轨道厚度',
  trackColor: '未选轨道',
  fillColor: '进度填充',
  checkShape: '勾选形状',
  checkSize: '控件尺寸',
  checkedColor: '选中背景',
  uncheckedColor: '未选背景',
  checkColor: '符号颜色',
  checkBorderColor: '边框颜色',
  pageTargets: '页面跳转',
  placement: '底栏位置',
  onColor: '开启背景',
  offColor: '关闭背景',
  thumbColor: '滑块颜色',
  switchShape: '开关形状',
  switchSize: '开关尺寸',
  shape: '形状',
  size: '尺寸',
  checked: '开启状态',
  defaultChecked: '默认开启',
  axis: '滚动方向',
  offset: '吸顶偏移',
  edge: '固定方向',
  height: '高度',
  tabsTarget: '关联选项卡',
  side: '滑出方向',
  maskClosable: '点击遮罩关闭',
  escapeClosable: 'Escape键关闭',
  showCloseButton: '显示关闭按钮',
};

export type PropValueType = 'number' | 'color' | 'enum' | 'boolean' | 'pageTargets' | 'tabsTarget';

export interface ComponentPropDef {
  name: string;
  type: PropValueType;
  min?: number;
  max?: number;
  unit?: string;
  default?: string | number | boolean;
  options?: string[];
  description: string;
}

export const COMPONENT_PROP_DEFS: Partial<Record<ComponentType, ComponentPropDef[]>> = {
  progress: [
    {
      name: 'trackHeight',
      type: 'number',
      min: 2,
      max: 48,
      default: DEFAULT_TRACK_HEIGHT,
      unit: 'px',
      description: `内部进度轨道厚度（2–48px，默认 ${DEFAULT_TRACK_HEIGHT}）`,
    },
    {
      name: 'trackColor',
      type: 'color',
      description: '内部未完成轨道背景色（十六进制颜色，如 #E5E7EB）',
    },
    {
      name: 'fillColor',
      type: 'color',
      description: '内部已完成进度填充色（十六进制颜色，如 #22C55E）',
    },
  ],
  checkbox: [
    {
      name: 'checkShape',
      type: 'enum',
      options: ['square', 'circle'],
      default: DEFAULT_CHECK_SHAPE_CHECKBOX,
      description: `勾选框形状（square 或 circle，默认 ${DEFAULT_CHECK_SHAPE_CHECKBOX}）`,
    },
    {
      name: 'checkSize',
      type: 'number',
      min: 16,
      max: 40,
      default: DEFAULT_CHECK_SIZE_CHECKBOX,
      unit: 'px',
      description: `勾选框尺寸（16–40px，默认 ${DEFAULT_CHECK_SIZE_CHECKBOX}）`,
    },
    {
      name: 'checkedColor',
      type: 'color',
      description: '选中状态背景色（十六进制颜色）',
    },
    {
      name: 'uncheckedColor',
      type: 'color',
      description: '未选中状态背景色（十六进制颜色）',
    },
    {
      name: 'checkColor',
      type: 'color',
      description: '勾选符号颜色（十六进制颜色）',
    },
    {
      name: 'checkBorderColor',
      type: 'color',
      description: '勾选框边框颜色（十六进制颜色）',
    },
  ],
  task: [
    {
      name: 'checkShape',
      type: 'enum',
      options: ['square', 'circle'],
      default: DEFAULT_CHECK_SHAPE_TASK,
      description: `任务完成按钮形状（square 或 circle，默认 ${DEFAULT_CHECK_SHAPE_TASK}）`,
    },
    {
      name: 'checkSize',
      type: 'number',
      min: 16,
      max: 40,
      default: DEFAULT_CHECK_SIZE_TASK,
      unit: 'px',
      description: `任务完成按钮尺寸（16–40px，默认 ${DEFAULT_CHECK_SIZE_TASK}）`,
    },
    {
      name: 'checkedColor',
      type: 'color',
      description: '任务完成状态背景色（十六进制颜色）',
    },
    {
      name: 'uncheckedColor',
      type: 'color',
      description: '任务未完成状态背景色（十六进制颜色）',
    },
    {
      name: 'checkColor',
      type: 'color',
      description: '任务勾选符号颜色（十六进制颜色）',
    },
    {
      name: 'checkBorderColor',
      type: 'color',
      description: '任务勾选按钮边框颜色（十六进制颜色）',
    },
  ],
  habit: [
    {
      name: 'checkShape',
      type: 'enum',
      options: ['square', 'circle'],
      default: DEFAULT_CHECK_SHAPE_HABIT,
      description: `习惯完成按钮形状（square 或 circle，默认 ${DEFAULT_CHECK_SHAPE_HABIT}）`,
    },
    {
      name: 'checkSize',
      type: 'number',
      min: 16,
      max: 48,
      default: DEFAULT_CHECK_SIZE_HABIT,
      unit: 'px',
      description: `习惯完成按钮尺寸（16–48px，默认 ${DEFAULT_CHECK_SIZE_HABIT}）`,
    },
    {
      name: 'checkedColor',
      type: 'color',
      description: '习惯完成状态背景色（十六进制颜色）',
    },
    {
      name: 'uncheckedColor',
      type: 'color',
      description: '习惯未完成状态背景色（十六进制颜色）',
    },
    {
      name: 'checkColor',
      type: 'color',
      description: '习惯符号颜色（十六进制颜色）',
    },
    {
      name: 'checkBorderColor',
      type: 'color',
      description: '习惯按钮边框颜色（十六进制颜色）',
    },
  ],
  switch: [
    {
      name: 'onColor',
      type: 'color',
      description: '开关开启状态轨道背景色（十六进制颜色）',
    },
    {
      name: 'offColor',
      type: 'color',
      description: '开关关闭状态轨道背景色（十六进制颜色）',
    },
    {
      name: 'thumbColor',
      type: 'color',
      description: '开关滑块颜色（十六进制颜色）',
    },
    {
      name: 'switchShape',
      type: 'enum',
      options: ['circle', 'square'],
      default: DEFAULT_SWITCH_SHAPE,
      description: '开关外形与滑块形状（circle 圆角药丸或 square 直角矩形，默认 circle）',
    },
    {
      name: 'switchSize',
      type: 'number',
      min: 20,
      max: 40,
      default: DEFAULT_SWITCH_SIZE,
      unit: 'px',
      description: '开关高度尺寸（20–40px，默认 27）',
    },
  ],
  bottomnav: [
    {
      name: 'placement', type: 'enum', options: ['flow', 'fixed'], default: 'flow',
      description: 'flow 随内容滚动；fixed 固定在演示视口底部，内容独立滚动且不被遮挡。fixed 底栏必须放在页面顶层，每页最多一个；无需 position 样式或手动留白。',
    },
    {
      name: 'pageTargets',
      type: 'pageTargets',
      description: '底部导航各项对应跳转页面 ID 列表（以 | 分隔，数量必须与 options 一致；空项表示仅切换选中不跳转）',
    },
  ],
  scroll: [
    {
      name: 'axis',
      type: 'enum',
      options: ['vertical', 'horizontal'],
      default: 'vertical',
      description: '滚动方向（vertical 纵向或 horizontal 横向，默认 vertical）',
    },
    {
      name: 'height',
      type: 'number',
      min: 32,
      max: 2000,
      default: 240,
      unit: 'px',
      description: '纵向滚动容器高度（32–2000px，纵向滚动必须明确像素高度）',
    },
  ],
  sticky: [
    {
      name: 'offset',
      type: 'number',
      min: 0,
      max: 300,
      default: 0,
      unit: 'px',
      description: '吸顶距离最近滚动容器顶部的偏移量（0–300px，默认 0）',
    },
  ],
  fixedbar: [
    {
      name: 'edge',
      type: 'enum',
      options: ['top', 'bottom'],
      default: 'bottom',
      description: '固定吸附方向（top 顶部固定栏或 bottom 底部操作栏，默认 bottom）',
    },
  ],
  segmented: [
    {
      name: 'tabsTarget',
      type: 'tabsTarget',
      description: '关联同页的选项卡容器 ID（分段选项对应并联动标签面板）',
    },
  ],
  drawer: [
    {
      name: 'side',
      type: 'enum',
      options: ['left', 'right'],
      default: 'right',
      description: '抽屉滑出方向（left 或 right，默认 right）',
    },
    {
      name: 'size',
      type: 'number',
      min: 20,
      max: 90,
      default: 80,
      unit: '%',
      description: '抽屉宽度占视口百分比（20–90%，默认 80）',
    },
    {
      name: 'maskClosable',
      type: 'boolean',
      default: true,
      description: '点击背景遮罩是否关闭抽屉（默认开启）',
    },
    {
      name: 'escapeClosable',
      type: 'boolean',
      default: true,
      description: '按 Escape 键是否关闭抽屉（默认开启）',
    },
    {
      name: 'showCloseButton',
      type: 'boolean',
      default: true,
      description: '是否显示关闭按钮（默认显示）',
    },
  ],
  bottomsheet: [
    {
      name: 'height',
      type: 'number',
      min: 20,
      max: 90,
      default: 60,
      unit: '%',
      description: '底部动作条高度占视口百分比（20–90%，默认 60）',
    },
    {
      name: 'maskClosable',
      type: 'boolean',
      default: true,
      description: '点击背景遮罩是否关闭动作条（默认开启）',
    },
    {
      name: 'escapeClosable',
      type: 'boolean',
      default: true,
      description: '按 Escape 键是否关闭动作条（默认开启）',
    },
    {
      name: 'showCloseButton',
      type: 'boolean',
      default: true,
      description: '是否显示关闭按钮（默认显示）',
    },
  ],
  modal: [
    {
      name: 'maskClosable',
      type: 'boolean',
      default: true,
      description: '点击背景遮罩是否关闭模态框（默认开启）',
    },
    {
      name: 'escapeClosable',
      type: 'boolean',
      default: true,
      description: '按 Escape 键是否关闭模态框（默认开启）',
    },
    {
      name: 'showCloseButton',
      type: 'boolean',
      default: true,
      description: '是否显示关闭按钮（默认显示）',
    },
  ],
};

export function validateComponentProps(node: BuilderNode, pageIds: Set<string>): void {
  if (['drawer', 'bottomsheet', 'modal'].includes(node.type)) {
    const mask = node.props?.maskClosable !== false;
    const escape = node.props?.escapeClosable !== false;
    const closeBtn = node.props?.showCloseButton !== false;
    if (!mask && !escape && !closeBtn) {
      throw new Error(`弹层必须保留至少一种关闭途径（遮罩、Escape键或关闭按钮）：${node.id}`);
    }
  }

  if (node.type === 'scroll') {
    const axis = node.props?.axis;
    const effectiveAxis = axis === 'horizontal' ? 'horizontal' : 'vertical';
    if (effectiveAxis === 'vertical') {
      const height = node.props?.height;
      if (typeof height !== 'number' || !Number.isFinite(height) || height < 32 || height > 2000) {
        throw new Error(`纵向滚动容器必须指定明确像素高度（32–2000）：${node.id}`);
      }
    }
  }

  const defs = COMPONENT_PROP_DEFS[node.type];
  if (!defs) return;

  for (const def of defs) {
    let value = node.props?.[def.name];
    if (value === undefined && node.type === 'switch') {
      if (def.name === 'switchShape' && node.props?.shape !== undefined) value = node.props.shape;
      if (def.name === 'switchSize' && node.props?.size !== undefined) value = node.props.size;
    }
    if (value === undefined) continue;

    if (def.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) {
        throw new Error(`${def.name} 超出范围（${def.min}–${def.max}）：${node.id} = ${value}`);
      }
    } else if (def.type === 'color') {
      if (typeof value !== 'string' || !HEX_COLOR_REGEX.test(value)) {
        throw new Error(`${def.name} 必须是有效的十六进制颜色（如 #RGB 或 #RRGGBB）：${node.id} = ${JSON.stringify(value)}`);
      }
    } else if (def.type === 'enum') {
      if (typeof value !== 'string' || !def.options?.includes(value)) {
        throw new Error(`${def.name} 取值无效（可用 ${def.options?.join(' / ')}）：${node.id} = ${JSON.stringify(value)}`);
      }
    } else if (def.type === 'pageTargets') {
      if (typeof value !== 'string') {
        throw new Error(`pageTargets 必须是字符串：${node.id}`);
      }
      const rawOptions = typeof node.props?.options === 'string' ? node.props.options : '';
      const optionItems = rawOptions.split(/[|,\n]/).map(item => item.trim()).filter(Boolean);
      const targets = value.split('|').map(t => t.trim());
      if (targets.length !== optionItems.length) {
        throw new Error(`pageTargets 数量（${targets.length}）必须与 options 数量（${optionItems.length}）一致：${node.id}`);
      }
      for (const target of targets) {
        if (target && !pageIds.has(target)) {
          throw new Error('跳转目标页面不存在');
        }
      }
    }
  }
}

export function describeComponentProps(): string {
  const lines: string[] = ['组件内部视觉与导航属性（通过 props 直接修改内部部件，避免仅修改外层尺寸）：'];
  for (const [type, props] of Object.entries(COMPONENT_PROP_DEFS)) {
    const propDescs = props.map(p => {
      let detail = `${p.name}: `;
      if (p.type === 'number') detail += `数字（${p.min}–${p.max}${p.unit ? p.unit : ''}，默认 ${p.default}）`;
      else if (p.type === 'enum') detail += `${p.options?.map(o => `"${o}"`).join('|')}（默认 "${p.default}"）`;
      else if (p.type === 'color') detail += `十六进制颜色（如 #RGB 或 #RRGGBB）`;
      else if (p.type === 'pageTargets') detail += `管道符 | 分隔的页面 id 列表（数量与 options 一致，空项表示仅选中不跳转）`;
      else detail += p.type;
      if (p.description) detail += ` · ${p.description}`;
      return detail;
    });
    lines.push(`- ${type}：\n  ${propDescs.join('；\n  ')}`);
  }
  return lines.join('\n');
}

export interface ResolvedProgressProps {
  trackHeight: number;
  trackColor?: string;
  fillColor?: string;
  trackStyle: Record<string, string | number>;
  fillStyle: Record<string, string | number>;
}

export function resolveProgressProps(props?: Record<string, unknown>): ResolvedProgressProps {
  const rawHeight = props?.trackHeight;
  const trackHeight = typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight >= 2 && rawHeight <= 48
    ? rawHeight
    : DEFAULT_TRACK_HEIGHT;
  const trackColor = typeof props?.trackColor === 'string' && HEX_COLOR_REGEX.test(props.trackColor)
    ? props.trackColor
    : undefined;
  const fillColor = typeof props?.fillColor === 'string' && HEX_COLOR_REGEX.test(props.fillColor)
    ? props.fillColor
    : undefined;

  const trackStyle: Record<string, string | number> = {
    height: `${trackHeight}px`,
    '--track-height': `${trackHeight}px`,
  };
  if (trackColor) {
    trackStyle.backgroundColor = trackColor;
    trackStyle['--track-color'] = trackColor;
  }

  const fillStyle: Record<string, string | number> = {
    height: '100%',
  };
  if (fillColor) {
    fillStyle.backgroundColor = fillColor;
    fillStyle['--fill-color'] = fillColor;
  }

  return { trackHeight, trackColor, fillColor, trackStyle, fillStyle };
}

export interface CheckControlDefaults {
  shape: 'square' | 'circle';
  size: number;
}

export function getDefaultCheckControl(type: ComponentType): CheckControlDefaults {
  if (type === 'task') {
    return { shape: DEFAULT_CHECK_SHAPE_TASK, size: DEFAULT_CHECK_SIZE_TASK };
  }
  if (type === 'habit') {
    return { shape: DEFAULT_CHECK_SHAPE_HABIT, size: DEFAULT_CHECK_SIZE_HABIT };
  }
  return { shape: DEFAULT_CHECK_SHAPE_CHECKBOX, size: DEFAULT_CHECK_SIZE_CHECKBOX };
}

export interface ResolvedCheckControl {
  shape: 'square' | 'circle';
  size: number;
  checkedColor?: string;
  uncheckedColor?: string;
  checkColor?: string;
  checkBorderColor?: string;
  style: Record<string, string | number>;
}

export function resolveCheckControl(
  props: Record<string, unknown> | undefined,
  isChecked: boolean,
  defaults: CheckControlDefaults
): ResolvedCheckControl {
  const rawShape = props?.checkShape;
  const shape: 'square' | 'circle' = (rawShape === 'square' || rawShape === 'circle') ? rawShape : defaults.shape;

  const rawSize = props?.checkSize;
  const size = typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize >= 16 && rawSize <= 48
    ? rawSize
    : defaults.size;

  const checkedColor = typeof props?.checkedColor === 'string' && HEX_COLOR_REGEX.test(props.checkedColor)
    ? props.checkedColor
    : undefined;
  const uncheckedColor = typeof props?.uncheckedColor === 'string' && HEX_COLOR_REGEX.test(props.uncheckedColor)
    ? props.uncheckedColor
    : undefined;
  const checkColor = typeof props?.checkColor === 'string' && HEX_COLOR_REGEX.test(props.checkColor)
    ? props.checkColor
    : undefined;
  const checkBorderColor = typeof props?.checkBorderColor === 'string' && HEX_COLOR_REGEX.test(props.checkBorderColor)
    ? props.checkBorderColor
    : undefined;

  const style: Record<string, string | number> = {
    width: `${size}px`,
    height: `${size}px`,
    flex: `0 0 ${size}px`,
    '--check-size': `${size}px`,
  };

  if (rawShape !== undefined) {
    style.borderRadius = shape === 'circle' ? '50%' : '4px';
    style['--check-radius'] = shape === 'circle' ? '50%' : '4px';
  }

  if (isChecked) {
    if (checkedColor) {
      style.backgroundColor = checkedColor;
      style['--check-bg'] = checkedColor;
    }
    if (checkColor) {
      style.color = checkColor;
      style['--check-color'] = checkColor;
    }
    if (checkBorderColor) {
      style.borderColor = checkBorderColor;
      style['--check-border-color'] = checkBorderColor;
    } else if (checkedColor) {
      style.borderColor = checkedColor;
      style['--check-border-color'] = checkedColor;
    }
  } else {
    if (uncheckedColor) {
      style.backgroundColor = uncheckedColor;
      style['--check-bg'] = uncheckedColor;
    }
    if (checkBorderColor) {
      style.borderColor = checkBorderColor;
      style['--check-border-color'] = checkBorderColor;
    }
    if (checkColor) {
      style.color = checkColor;
      style['--check-color'] = checkColor;
    }
  }

  return { shape, size, checkedColor, uncheckedColor, checkColor, checkBorderColor, style };
}

export interface ResolvedSwitchControl {
  isOn: boolean;
  shape: 'circle' | 'square';
  size: number;
  width: number;
  onColor?: string;
  offColor?: string;
  thumbColor?: string;
  controlStyle: Record<string, string | number>;
  thumbStyle: Record<string, string | number>;
}

export function resolveSwitchControl(
  props: Record<string, unknown> | undefined,
  isOn: boolean
): ResolvedSwitchControl {
  const onColor = typeof props?.onColor === 'string' && HEX_COLOR_REGEX.test(props.onColor)
    ? props.onColor
    : undefined;
  const offColor = typeof props?.offColor === 'string' && HEX_COLOR_REGEX.test(props.offColor)
    ? props.offColor
    : undefined;
  const thumbColor = typeof props?.thumbColor === 'string' && HEX_COLOR_REGEX.test(props.thumbColor)
    ? props.thumbColor
    : undefined;

  const rawShape = props?.switchShape ?? props?.shape;
  const shape: 'circle' | 'square' = (rawShape === 'circle' || rawShape === 'square')
    ? rawShape
    : DEFAULT_SWITCH_SHAPE;

  const rawSize = props?.switchSize ?? props?.size;
  const size = typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize >= 20 && rawSize <= 40
    ? rawSize
    : DEFAULT_SWITCH_SIZE;

  const width = Math.round(size * 1.667);
  const padding = 3;
  const thumbSize = size - padding * 2;
  const travel = width - size;

  const controlStyle: Record<string, string | number> = {
    '--switch-width': `${width}px`,
    '--switch-height': `${size}px`,
    '--switch-padding': `${padding}px`,
    '--switch-travel': `${travel}px`,
    '--switch-thumb-size': `${thumbSize}px`,
  };

  if (size !== DEFAULT_SWITCH_SIZE) {
    controlStyle.width = `${width}px`;
    controlStyle.height = `${size}px`;
    controlStyle.padding = `${padding}px`;
  }

  if (rawShape !== undefined) {
    const radius = shape === 'square' ? '4px' : '99px';
    const thumbRadius = shape === 'square' ? '2px' : '50%';
    controlStyle.borderRadius = radius;
    controlStyle['--switch-radius'] = radius;
    controlStyle['--switch-thumb-radius'] = thumbRadius;
  }

  if (onColor) {
    controlStyle['--switch-on-color'] = onColor;
  }
  if (offColor) {
    controlStyle['--switch-off-color'] = offColor;
  }
  if (isOn) {
    if (onColor) {
      controlStyle.backgroundColor = onColor;
    }
  } else {
    if (offColor) {
      controlStyle.backgroundColor = offColor;
    }
  }

  const thumbStyle: Record<string, string | number> = {};
  if (thumbColor) {
    thumbStyle.backgroundColor = thumbColor;
    thumbStyle['--switch-thumb-color'] = thumbColor;
  } else {
    const activeTrack = isOn ? onColor : offColor;
    if (parseRgb(activeTrack)) thumbStyle['--switch-thumb-color'] = bestBlackOrWhite(activeTrack!);
  }
  if (rawShape !== undefined) {
    thumbStyle.borderRadius = shape === 'square' ? '2px' : '50%';
  }
  if (size !== DEFAULT_SWITCH_SIZE) {
    thumbStyle.width = `${thumbSize}px`;
    thumbStyle.height = `${thumbSize}px`;
  }

  return { isOn, shape, size, width, onColor, offColor, thumbColor, controlStyle, thumbStyle };
}

export interface ResolveBottomnavParams {
  options: string[];
  pageTargets?: string | string[];
  pageId?: string;
  localSelection?: string | null;
  selectedOption?: string | null;
  valueProp?: string;
}

export function resolveBottomnavActiveIndex(params: ResolveBottomnavParams): number {
  const { options, pageTargets, pageId, localSelection, selectedOption, valueProp } = params;

  const targets: string[] = Array.isArray(pageTargets)
    ? pageTargets
    : typeof pageTargets === 'string'
      ? pageTargets.split('|').map(t => t.trim())
      : [];
  const hasTargets = targets.length > 0 && targets.length === options.length;

  // 1. An explicit local click visibly selects that item until a real page change occurs
  const activeLocal = localSelection !== undefined && localSelection !== null
    ? localSelection
    : (selectedOption !== undefined && selectedOption !== null ? selectedOption : undefined);

  if (activeLocal !== undefined) {
    const optIdx = options.indexOf(activeLocal);
    if (optIdx >= 0) return optIdx;
  }

  // 2. Otherwise, if pageTargets is configured and the target matches pageId, highlight that target
  if (hasTargets && pageId) {
    const targetIdx = targets.indexOf(pageId);
    if (targetIdx >= 0 && targets[targetIdx] !== '') {
      return targetIdx;
    }
    return -1;
  }

  // 3. Fallback: legacy valueProp
  if (valueProp !== undefined) {
    const valIdx = options.indexOf(valueProp);
    if (valIdx >= 0) return valIdx;
  }

  // 4. Default fallback: first option if available, otherwise -1
  return options.length > 0 ? 0 : -1;
}

export function reconcilePageTargets(
  oldOptionsStr: string | undefined,
  newOptionsStr: string,
  oldPageTargetsStr: string | undefined
): string | undefined {
  if (typeof oldPageTargetsStr !== 'string') return undefined;

  const oldLabels = typeof oldOptionsStr === 'string'
    ? oldOptionsStr.split(/[|,\n]/).map(s => s.trim()).filter(Boolean)
    : [];
  const oldTargets = oldPageTargetsStr.split('|').map(s => s.trim());

  const labelToTarget = new Map<string, string>();
  for (let i = 0; i < oldLabels.length; i++) {
    labelToTarget.set(oldLabels[i], oldTargets[i] ?? '');
  }

  const newLabels = newOptionsStr.split(/[|,\n]/).map(s => s.trim()).filter(Boolean);
  if (newLabels.length === 0) return undefined;

  return newLabels.map(label => labelToTarget.get(label) ?? '').join('|');
}

export function normalizeHexToRgb(hex: string | undefined, fallback = '#888888'): string {
  if (!hex || typeof hex !== 'string') return fallback;
  const clean = hex.trim();
  if (!HEX_COLOR_REGEX.test(clean)) return fallback;
  const h = clean.slice(1);
  if (h.length === 3 || h.length === 4) {
    const r = h[0] + h[0];
    const g = h[1] + h[1];
    const b = h[2] + h[2];
    return `#${r}${g}${b}`.toLowerCase();
  }
  if (h.length === 6 || h.length === 8) {
    return `#${h.slice(0, 6)}`.toLowerCase();
  }
  return fallback;
}

export function getInheritedColor(propName: string, designTokens?: Partial<StyleTokens> | Record<string, unknown>): string {
  const primary = typeof designTokens?.primary === 'string' ? designTokens.primary : '#3b82f6';
  const primaryText = typeof designTokens?.primaryText === 'string' ? designTokens.primaryText : '#ffffff';
  const borderColor = typeof designTokens?.borderColor === 'string' ? designTokens.borderColor : '#bdc9be';
  const surface = typeof designTokens?.surface === 'string' ? designTokens.surface : '#ffffff';

  switch (propName) {
    case 'trackColor': return typeof designTokens?.borderColor === 'string' ? borderColor : '#e5e7eb';
    case 'fillColor': return primary;
    case 'checkedColor': return primary;
    case 'uncheckedColor': return surface;
    case 'checkColor': return primaryText;
    case 'checkBorderColor': return borderColor;
    case 'onColor': return primary;
    case 'offColor': return typeof designTokens?.borderColor === 'string' ? borderColor : '#cbd1cb';
    case 'thumbColor': return primaryText;
    default: return '#888888';
  }
}

