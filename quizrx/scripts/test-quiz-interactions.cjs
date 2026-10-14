const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  const file = path.join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!file.startsWith(dist + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.addInitScript(() => {
      window.isTauri = true;
      window.testCalls = [];
      const options = 'ABCDE'.split('').map(label => ({ label, content: `选项${label}` }));
      const base = { subject: '测试', unit: '交互测试', source: 'OBE大纲', extractedYear: null, analysis: { point: '测试出处', discuss: '测试解析', links: [] }, options };
      const questions = [
        { ...base, id: 1, type: 'A1', stem: '单选题一', answer: 'A' },
        { ...base, id: 2, type: 'X', stem: '多选题二', answer: ['A', 'C'] },
        { ...base, id: 3, type: 'A2', stem: '单选题三', answer: 'B' },
        { ...base, id: 4, type: 'A3', stem: '共用题干四', subQuestions: [
          { subId: 1, stem: '小题一', answer: 'A', options },
          { subId: 2, stem: '小题二', answer: 'B', options },
        ] },
      ];
      const session = { id: 1, status: 'active', createdAt: 0, updatedAt: 0, currentPosition: 0, total: 4, correctCount: 0, bankRevision: 'test', questionIds: [1, 2, 3, 4], answers: [], drafts: [] };
      let failOnce = true;
      window.__TAURI_INTERNALS__ = { invoke: async (command, args = {}) => {
        window.testCalls.push({ command, args });
        if (command === 'get_startup_status') return { phase: 'ready', error: null };
        if (command === 'resume_quiz_session') return structuredClone(session);
        if (command === 'get_question') return questions.find(q => q.id === args.id);
        if (command === 'list_bookmarks') return [];
        if (command === 'save_quiz_draft') {
          await new Promise(resolve => setTimeout(resolve, 100));
          session.drafts = [...session.drafts.filter(d => d.position !== args.position), { position: args.position, answer: args.answer }];
          return;
        }
        if (command === 'submit_quiz_answer') {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (args.position === 2 && failOnce) { failOnce = false; throw new Error('测试保存失败'); }
          const q = questions[args.position];
          const subCorrectness = (q.subQuestions || []).map(sub => ({ subId: sub.subId, correct: args.answer.subAnswers.find(a => a.subId === sub.subId)?.selected[0] === sub.answer }));
          const correct = q.type === 'A3' ? subCorrectness.every(s => s.correct) : args.answer.selected.slice().sort().join('') === (Array.isArray(q.answer) ? q.answer.join('') : q.answer);
          session.answers = [...session.answers.filter(a => a.position !== args.position), { position: args.position, answer: args.answer, correct, subCorrectness }];
          session.drafts = session.drafts.filter(d => d.position !== args.position);
          session.correctCount = session.answers.filter(a => a.correct).length;
          return structuredClone(session);
        }
        throw new Error(`Unexpected command: ${command}`);
      } };
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/#/quiz/session?session=1&returnTo=obe`);
    const title = text => page.getByText(text, { exact: true }).waitFor();
    const countSubmits = () => page.evaluate(() => window.testCalls.filter(c => c.command === 'submit_quiz_answer').length);
    const choose = label => page.locator('.quiz-option').filter({ hasText: `选项${label}` }).tap();
    const cdp = await context.newCDPSession(page);
    const swipe = async (dx, dy = 0) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 245 }] });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195 + dx * i / 6, y: 245 + dy * i / 6 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(700);
    };
    await title('单选题一');
    assert.equal(await page.getByRole('button', { name: '确认答案', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /^(上一题|下一题)$/ }).count(), 0);
    await swipe(110); await title('单选题一'); // first boundary
    await swipe(-15, -100); await title('单选题一'); // vertical scroll
    await choose('A'); await page.getByText('回答正确，继续保持！', { exact: true }).waitFor();
    assert.equal(await countSubmits(), 1);
    await swipe(-110); await title('多选题二');
    await choose('A'); assert.equal(await countSubmits(), 1);
    await page.locator('.quiz-option[aria-pressed="true"]').waitFor();
    await swipe(110); await title('单选题一');
    await page.getByText('回答正确，继续保持！', { exact: true }).waitFor();
    await swipe(-110); await title('多选题二');
    assert.equal(await page.locator('.quiz-option[aria-pressed="true"]').count(), 1);
    await choose('C'); assert.equal(await countSubmits(), 1);
    await page.getByRole('button', { name: '确认答案', exact: true }).tap();
    await page.getByText('回答正确，继续保持！', { exact: true }).waitFor();
    assert.equal(await countSubmits(), 2);
    await swipe(-110); await title('单选题三');
    await choose('A'); await page.getByRole('alert').filter({ hasText: '测试保存失败' }).waitFor();
    await choose('A'); await page.getByText('再看一遍解析，把难点练熟。', { exact: true }).waitFor();
    await swipe(-110); await title('共用题干四');
    const choices = page.locator('.quiz-option');
    await choices.filter({ hasText: '选项A' }).first().tap();
    assert.equal(await countSubmits(), 4);
    await choices.filter({ hasText: '选项B' }).last().tap();
    await page.getByText('回答正确，继续保持！', { exact: true }).waitFor();
    assert.equal(await countSubmits(), 5);
    await swipe(-110); await title('共用题干四'); // last boundary
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    if (process.env.QUIZ_SCREENSHOT) await page.screenshot({ path: process.env.QUIZ_SCREENSHOT, fullPage: true });
    console.log('Passed: touch navigation, boundaries, vertical scrolling, auto single answers, multi confirmation, draft restore, retry and case answers.');
    await context.close();
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
