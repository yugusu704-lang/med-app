import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const api='http://127.0.0.1:4310';
const headers={'content-type':'application/json',origin:'http://127.0.0.1:5173'};
const saved=await (await fetch(`${api}/api/projects/quizrx-mobile-neo-v1`)).json();
function adjust(nodes){for(const node of nodes){if(node.type==='bottomnav'){
  node.props.placement='fixed';
  Object.assign(node.style,{minHeight:74,padding:'8px 12px 11px',gap:10,fontSize:12,fontWeight:800,background:'#FFFBEB',borderRadius:10});
}if(node.children)adjust(node.children);}}
saved.project.pages.forEach(page=>adjust(page.nodes));
const response=await fetch(`${api}/api/projects`,{method:'POST',headers,body:JSON.stringify({project:saved.project,baseVersion:saved.saveVersion,clientId:'codex-quizrx-design',kind:'manual',label:'四项底部导航：固定位置与手机点击尺寸',requestId:randomUUID()})});
if(!response.ok)throw Error(await response.text());
await fs.writeFile(new URL('./atelier-project.json',import.meta.url),JSON.stringify(saved.project,null,2));
await fs.writeFile(new URL('./portable/src/project.json',import.meta.url),JSON.stringify(saved.project,null,2));
await fs.writeFile(new URL('./save-receipt.json',import.meta.url),JSON.stringify(await response.json(),null,2));
const exported=await fetch(`${api}/api/export`,{method:'POST',headers,body:JSON.stringify({project:saved.project})});
if(!exported.ok)throw Error(await exported.text());
await fs.writeFile(new URL('./atelier-source.zip',import.meta.url),Buffer.from(await exported.arrayBuffer()));
console.log('Updated four-item navigation in Atelier and portable source.');
