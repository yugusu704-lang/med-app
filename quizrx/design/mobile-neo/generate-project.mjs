import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const out = fileURLToPath(new URL('.', import.meta.url));
const api = 'http://127.0.0.1:4310';
const writeHeaders = { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' };
const { resource } = await (await fetch(`${api}/api/resources/styles/neo-brutalism`)).json();
const db = new DatabaseSync(fileURLToPath(new URL('../../../quizbank.db', import.meta.url)), { readOnly: true });
const question = db.prepare('SELECT id,stem,answer,point,discuss,extracted_year FROM questions WHERE id=10').get();
const options = db.prepare('SELECT label,content FROM options WHERE question_id=? ORDER BY label').all(question.id);
const subjects = db.prepare('SELECT s.name,count(q.id) AS count FROM subjects s JOIN questions q ON q.subject_id=s.id GROUP BY s.id ORDER BY count DESC LIMIT 8').all();
const hits = db.prepare("SELECT id,stem,type FROM questions WHERE stem LIKE '%内环境%' AND type='A1' LIMIT 3").all();
db.close();

const colors = { yellow: '#FFE600', cyan: '#4DEEEA', coral: '#FF5E7E', ink: '#000000', paper: '#FFFBEB', white: '#FFFFFF', green: '#B9F6B0' };
let seq = 0;
const node = (type, props = {}, style = {}, children, action) => ({ id: `rx-${++seq}`, type, props, style, ...(children ? { children } : {}), ...(action ? { action } : {}) });
const text = (value, size = 16, weight = 500, style = {}) => node('text', { text: value, variant: size >= 28 ? 'heading' : 'body' }, { fontSize: size, fontWeight: weight, ...style });
const eyebrow = value => node('text', { text: value, variant: 'eyebrow' }, { fontSize: 12, fontWeight: 800 });
const row = (children, style = {}) => node('row', {}, { gap: 12, alignItems: 'center', ...style }, children);
const stack = (children, gap = 12) => node('stack', {}, { gap }, children);
const card = (children, background = colors.white, style = {}) => node('card', {}, { background, padding: 18, gap: 12, borderWidth: 3, borderColor: colors.ink, borderRadius: 12, boxShadow: '4px 4px 0px #000000', ...style }, children);
const badge = (value, background = colors.cyan) => node('badge', { text: value }, { background, color: colors.ink, fontWeight: 800, fontSize: 12, padding: '5px 10px', borderRadius: 6 });
const go = target => ({ type: 'navigate', target });
const button = (label, target, background = colors.yellow, style = {}, action) => node('button', { label }, { background, color: colors.ink, fontSize: 16, fontWeight: 800, minHeight: 52, padding: '12px 14px', borderWidth: 3, borderColor: colors.ink, borderRadius: 10, boxShadow: '3px 3px 0px #000000', ...style }, undefined, action || go(target));
const title = (name, subtitle) => stack([text(name, 28, 900), ...(subtitle ? [text(subtitle, 14, 500)] : [])], 6);
const top = (label, back = false) => node('navbar', { title: label, back }, { padding: 0, minHeight: 48, fontWeight: 900 }, undefined, back ? { type: 'back' } : undefined);
const nav = () => node('bottomnav', { label: '主导航', options: '首页|刷题|科目|搜索', pageTargets: 'home|setup|subjects|search', placement: 'fixed' }, { minHeight: 74, padding: '8px 12px 11px', gap: 10, fontSize: 12, fontWeight: 800, background: colors.paper, borderWidth: 3, borderColor: colors.ink, borderRadius: 10, boxShadow: '3px 3px 0px #000000' });
const footer = children => node('fixedbar', { edge: 'bottom' }, { gap: 10, padding: '12px 0 20px' }, children);
const statCard = (value, label, background) => card([text(value, value.length > 5 ? 22 : 26, 900), text(label, 12, 600)], background, { padding: 10, gap: 2, boxShadow: '3px 3px 0px #000000' });
const headingRow = (label, detail) => row([text(label, 18, 900), ...(detail ? [text(detail, 12, 700)] : [])], { justifyContent: 'space-between' });

const pages = [];
pages.push({ id: 'home', name: '首页', nodes: [
  row([text('QUIZ / RX', 20, 900), badge('离线可用', colors.white)], { justifyContent: 'space-between', minHeight: 42 }),
  card([eyebrow('医学题库 · 随时开练'), text('把知识，\n练成直觉。', 36, 900), text('每天一小组，慢慢把难点练熟。', 14), button('开始刷题  →', 'setup', colors.ink, { color: colors.white, boxShadow: '3px 3px 0px #FFFFFF' })], colors.yellow, { gap: 12, padding: 20 }),
  node('grid', {}, { gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }, [statCard('51,281', '道题目', colors.white), statCard('34', '个科目', colors.cyan), statCard('900', '个章节', colors.coral)]),
  node('grid', {}, { gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }, [button('浏览科目', 'subjects', colors.cyan, { boxShadow: '2px 2px 0px #000000' }), button('搜索题目', 'search', colors.coral, { boxShadow: '2px 2px 0px #000000' })]),
  headingRow('先从熟悉的科目开始', '热门科目'),
  button('生理学   ·   3,976 题   →', 'setup', colors.white, { textAlign: 'left', fontSize: 15, minHeight: 58 }),
  button('内科学   ·   8,246 题   →', 'setup', colors.white, { textAlign: 'left', fontSize: 15, minHeight: 58 }),
  nav(),
] });
pages.push({ id: 'subjects', name: '科目地图', nodes: [
  top('科目地图'), title('你的知识地图', '34 个科目，从想练的那一科开始。'),
  node('search', { label: '搜索科目', placeholder: '找到你想练的科目', value: '' }, { fontSize: 16, minHeight: 52, borderWidth: 3, boxShadow: '3px 3px 0px #000000' }),
  badge('全部科目 · 按题量排列', colors.yellow),
  ...subjects.map((s, i) => card([
    row([text(s.name, 20, 900), badge(`${s.count.toLocaleString()} 题`, i % 2 ? colors.coral : colors.cyan)], { justifyContent: 'space-between' }),
    button('选择章节并开练  →', 'setup', colors.white, { minHeight: 48, fontSize: 14, boxShadow: 'none' }),
  ], colors.white, { padding: 14, gap: 10 })), nav(),
] });
pages.push({ id: 'setup', name: '开始刷题', nodes: [
  top('开始刷题', true), title('今天，练哪一科？', '科目、章节、题数，按你的节奏来。'),
  card([
    badge('01 / 选择范围', colors.cyan),
    node('select', { label: '科目', options: '生理学|内科学|病理学|系统解剖学', value: '生理学' }, { fontSize: 16 }),
    node('select', { label: '章节', options: '全部章节|第一章 绪论|第二章 细胞的基本功能|第三章 血液', value: '第一章 绪论' }, { fontSize: 16 }),
  ]),
  card([
    badge('02 / 练习设置', colors.coral),
    node('select', { label: '题数', options: '10 题|20 题|50 题', value: '20 题' }, { fontSize: 16 }),
    node('segmented', { label: '题型', options: '全部|单选|多选|案例', value: '全部' }, { minHeight: 48, fontSize: 14 }),
    node('switch', { label: '随机出题', checked: true, onColor: colors.yellow, offColor: colors.white, thumbColor: colors.ink, switchSize: 32 }, { minHeight: 48 }),
  ]),
  card([text('生理学 · 第一章 绪论', 16, 800), text('20 题 / 随机练习 / 离线作答', 13)], colors.cyan, { padding: 14, gap: 4, boxShadow: 'none' }),
  footer([button('开始这组练习  →', 'question')]),
] });

const questionNodes = selected => [
  row([button('←', 'setup', colors.white, { width: 48, padding: 8, boxShadow: 'none' }), text('生理学', 18, 900), text('01 / 20', 14, 800)], { justifyContent: 'space-between' }),
  node('progress', { label: '本轮进度', value: 5, trackHeight: 8, fillColor: colors.yellow, trackColor: colors.white }, { padding: 0 }),
  row([badge('A1 · 单选', colors.cyan), badge('2016 年真题', colors.white)], { gap: 10 }),
  title('下列关于机体内环境稳态的描述，错误的是', undefined),
  text('请选择一个答案', 13, 600),
  ...options.map(o => button(`${o.label}   ${o.content}`, `question-${o.label}`, selected === o.label ? colors.yellow : colors.white, { textAlign: 'left', fontWeight: selected === o.label ? 900 : 600, fontSize: 16, minHeight: 62, padding: '14px 16px', boxShadow: selected === o.label ? '4px 4px 0px #000000' : 'none' })),
  footer([button('提交答案', selected ? `analysis-${selected}` : undefined, colors.yellow, {}, selected ? undefined : { type: 'toast', message: '请先选择一个答案' })]),
];
pages.push({ id: 'question', name: '答题 · 未选择', nodes: questionNodes() });
for (const option of options) {
  pages.push({ id: `question-${option.label}`, name: `答题 · 已选 ${option.label}`, nodes: questionNodes(option.label) });
}
for (const option of options) {
  const correct = option.label === question.answer;
  pages.push({ id: `analysis-${option.label}`, name: correct ? '解析 · 答对' : `解析 · 选 ${option.label}`, nodes: [
    top('答案解析', true),
    card([badge(correct ? '回答正确' : '这题值得再看一遍', colors.white), text(correct ? '拿下这一题！' : '差一点，再理清它。', 28, 900), text(`你的答案 ${option.label}   /   正确答案 ${question.answer}`, 16, 800)], correct ? colors.green : colors.coral),
    card([eyebrow('题目回顾 · A1'), text(question.stem.replace(/^2016N1A\s*/, ''), 18, 800), text('正确答案 A：稳态是指细胞内液理化性质相对恒定', 16, 700)]),
    card([badge('解析', colors.cyan), text(question.discuss, 16, 500)]),
    node('accordion', { title: '查看课本出处', description: question.point, open: false }, { fontSize: 16, borderWidth: 3, boxShadow: 'none' }),
    text('第一章 绪论 · 内环境与稳态', 12, 600),
    footer([button('下一题  →', 'question')]),
  ] });
}

pages.push({ id: 'search', name: '搜索题目', nodes: [
  top('搜索题目'), title('一个关键词，\n找到一个考点。', '题干和案例子题都能查。'),
  card([
    node('input', { label: '关键词', placeholder: '输入题干、考点或关键词', name: 'keyword', required: true, value: '内环境' }, { fontSize: 16, minHeight: 52 }),
    button('搜索题目  →', 'search-results', colors.yellow, {}, { type: 'submit', target: 'search-results' }),
  ]),
  headingRow('可以从这些词开始'),
  node('grid', {}, { gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }, ['内环境', '负反馈', '细胞膜', '动作电位'].map((s, i) => button(s, 'search-results', i % 2 ? colors.coral : colors.cyan, { minHeight: 48, fontSize: 14 }))),
  card([text('不必记住完整题干。', 20, 900), text('抓住一个关键词，把相关知识连起来。', 14)], colors.white), nav(),
] });
pages.push({ id: 'search-results', name: '搜索结果', nodes: [
  top('搜索结果', true), title('关于「内环境」', '先看题干，再打开完整题目。'), badge('生理学 · 相关题目', colors.yellow),
  ...hits.map(h => card([badge(h.type + ' · 单选', colors.cyan), text(h.stem.replace(/^\d{4}N\d[A-Z]\s*/, ''), 18, 800), button('打开这道题  →', 'question', colors.white, { minHeight: 48, fontSize: 14, boxShadow: 'none' })])), nav(),
] });

const project = { version: 2, id: 'quizrx-mobile-neo-v1', name: '医学题库 · Android · 新野兽派', theme: 'nordic', design: resource.snapshot, pages };
const response = await fetch(`${api}/api/projects/${project.id}`);
const baseVersion = response.ok ? (await response.json()).saveVersion : 0;
await writeFile(`${out}atelier-project.json`, JSON.stringify(project, null, 2));
await writeFile(`${out}sample-data.json`, JSON.stringify({ question, options, subjects, hits }, null, 2));
const save = await fetch(`${api}/api/projects`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ project, clientId: 'codex-quizrx-design', baseVersion, kind: 'manual', label: 'Android 新野兽派首版设计', requestId: randomUUID() }) });
if (!save.ok) throw new Error(`Save ${save.status}: ${await save.text()}`);
await writeFile(`${out}save-receipt.json`, JSON.stringify(await save.json(), null, 2));
const saved = await fetch(`${api}/api/projects/${project.id}`);
if (!saved.ok) throw new Error('Project read-back failed');
const exportResponse = await fetch(`${api}/api/export`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ project }) });
if (!exportResponse.ok) throw new Error(`Export ${exportResponse.status}: ${await exportResponse.text()}`);
await writeFile(`${out}atelier-source.zip`, Buffer.from(await exportResponse.arrayBuffer()));
console.log(JSON.stringify({ id: project.id, name: project.name, pages: pages.length, nodes: seq, saved: true, source: `${out}atelier-source.zip` }));
