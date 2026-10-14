export const motionPresets = [
  { id: 'none', label: '无动效', group: 'none' },
  { id: 'fade-in', label: '柔和淡入', group: 'fade' },
  { id: 'fade-up', label: '向上浮现', group: 'fade' },
  { id: 'fade-down', label: '向下浮现', group: 'fade' },
  { id: 'slide-left', label: '从左滑入', group: 'slide' },
  { id: 'slide-right', label: '从右滑入', group: 'slide' },
  { id: 'zoom-in', label: '轻盈放大', group: 'scale' },
  { id: 'zoom-out', label: '收拢出现', group: 'scale' },
  { id: 'pop', label: '弹性出现', group: 'scale' },
  { id: 'bounce', label: '轻轻弹跳', group: 'attention' },
  { id: 'pulse', label: '呼吸节奏', group: 'attention' },
  { id: 'shake', label: '轻微摇动', group: 'attention' },
  { id: 'swing', label: '左右摆动', group: 'attention' },
  { id: 'flip-x', label: '纵向翻入', group: 'flip' },
  { id: 'flip-y', label: '横向翻入', group: 'flip' },
  { id: 'rotate-in', label: '旋转出现', group: 'flip' },
  { id: 'blur-in', label: '由虚到实', group: 'fade' },
] as const;

type Props = Record<string, string | number | boolean>;
export interface MotionConfig { preset: string; duration: number; delay: number; trigger: 'enter' | 'hover'; loop: boolean }
const presets = new Set<string>(motionPresets.map(item => item.id));
const bounded = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function readMotion(props: Props): MotionConfig {
  return {
    preset: typeof props.animation === 'string' && presets.has(props.animation) ? props.animation : 'none',
    duration: bounded(props.animationDuration, 100, 3000, 600),
    delay: bounded(props.animationDelay, 0, 3000, 0),
    trigger: props.animationTrigger === 'hover' ? 'hover' : 'enter',
    loop: props.animationLoop === true,
  };
}

export function validateMotion(props: Props): void {
  if (props.animation !== undefined && (typeof props.animation !== 'string' || !presets.has(props.animation))) throw new Error('请选择受支持的动效');
  for (const [key, min, max] of [['animationDuration', 100, 3000], ['animationDelay', 0, 3000]] as const) {
    const value = props[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) throw new Error('动效时间超出范围');
  }
  if (props.animationTrigger !== undefined && !['enter', 'hover'].includes(String(props.animationTrigger))) throw new Error('动效触发方式无效');
  if (props.animationLoop !== undefined && typeof props.animationLoop !== 'boolean') throw new Error('动效循环设置无效');
}

export function motionStyle(config: MotionConfig): Record<string, string> {
  return { '--motion-duration': `${config.duration}ms`, '--motion-delay': `${config.delay}ms`, '--motion-iterations': config.loop ? 'infinite' : '1' };
}
