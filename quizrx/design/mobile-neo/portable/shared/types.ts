export type ComponentType = 'stack'|'row'|'grid'|'card'|'divider'|'text'|'image'|'avatar'|'badge'|'button'|'input'|'textarea'|'checkbox'|'switch'|'select'|'progress'|'stat'|'task'|'habit'|'navbar'|'tabs'|'empty'|'alert'|'accordion'|'slider'|'radio'|'rating'|'skeleton'|'segmented'|'breadcrumb'|'list'|'timeline'|'pricing'|'testimonial'|'search'|'bottomnav'|'scroll'|'sticky'|'fixedbar'|'tabpanel'|'drawer'|'bottomsheet'|'modal';
import type { StyleSnapshot } from './resources.ts';
export interface Action { type: 'navigate'|'toast'|'toggle'|'submit'|'dialog'|'scrollTo'|'back'|'openOverlay'|'closeOverlay'; target?: string; message?: string }
export interface BuilderNode { id:string; type:ComponentType; props:Record<string,string|number|boolean>; style:Record<string,string|number>; children?:BuilderNode[]; action?:Action }
export interface Page { id:string; name:string; nodes:BuilderNode[] }
export interface Project { version:1|2; id:string; name:string; theme:'nordic'|'editorial'|'dark'; pages:Page[]; design?:StyleSnapshot; fontAsset?:string }
