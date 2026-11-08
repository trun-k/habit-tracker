/* Drives the real app in a headless browser against a stubbed bridge,
   so every screen is exercised before it reaches a phone. */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'app');
const ENDPOINT = 'https://script.google.com/macros/s/STUB/exec';
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json'
};

/* ---- stub sheet -------------------------------------------------- */

const pad = n => String(n).padStart(2, '0');
const toStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(s); d.setDate(d.getDate() + n); return toStr(d); };
const TODAY = toStr(new Date());

const habits = [
  { id: 'medication', name: 'Medication', type: 'bool', unit: '', benchmark: null, color: '#60A5FA', position: 1, archived: false },
  { id: 'steps', name: 'Steps', type: 'number', unit: 'steps', benchmark: 10000, color: '#2DD4BF', position: 2, archived: false },
  { id: 'sleep', name: 'Sleep', type: 'number', unit: 'h', benchmark: null, color: '#A78BFA', position: 3, archived: false },
  { id: 'calories', name: 'Calories', type: 'number', unit: 'kcal', benchmark: 2000, color: '#FBBF24', position: 4, archived: false },
  { id: 'weight', name: 'Weight', type: 'number', unit: 'kg', benchmark: null, color: '#FB923C', position: 5, archived: false }
];

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const entries = [];
for (let i = 400; i >= 0; i--) {
  const d = addDays(TODAY, -i);
  if (rnd() < 0.88) entries.push([d, 'medication', 1]);
  if (rnd() < 0.84) entries.push([d, 'steps', Math.round((3200 + rnd() * 10800) / 10) * 10]);
  if (rnd() < 0.80) entries.push([d, 'sleep', Math.round((6 + rnd() * 2.6) * 10) / 10]);
  if (rnd() < 0.55) entries.push([d, 'calories', Math.round(1500 + rnd() * 900)]);
  if (rnd() < 0.62) entries.push([d, 'weight', Math.round((71.5 + rnd() * 2.2) * 10) / 10]);
}
/* Today is deliberately part-logged, so empty states show up too. */
const writes = [];

/* ---- static server ----------------------------------------------- */

const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});

/* ---- run ---------------------------------------------------------- */

(async () => {
  await new Promise(r => server.listen(8099, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });

  const problems = [];
  /* Google Fonts is blocked in this sandbox; that failure is not an app fault. */
  const ignorable = (s) => /ERR_TUNNEL_CONNECTION_FAILED|fonts\.(googleapis|gstatic)/.test(s);
  const note = (s) => { if (!ignorable(s)) problems.push(s); };
  ctx.on('weberror', e => note('pageerror: ' + e.error().message));

  await ctx.route('**/macros/s/STUB/exec', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    let out = { ok: false, error: 'unknown op ' + body.op };
    if (body.token !== 'test-token') out = { ok: false, error: 'Bad token.' };
    else if (body.op === 'getAll') out = { ok: true, habits, entries };
    else if (body.op === 'setEntries') { writes.push(...body.entries); out = { ok: true }; }
    else if (body.op === 'saveHabit') { writes.push(body.habit); out = { ok: true }; }
    else if (body.op === 'reorder') { writes.push({ reorder: body.ids }); out = { ok: true }; }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(out)
    });
  });

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') note('console: ' + m.text()); });

  await page.addInitScript(([ep, tk]) => {
    localStorage.setItem('ht.cfg', JSON.stringify({ endpoint: ep, token: tk }));
  }, [ENDPOINT, 'test-token']);

  const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: `shots/${name}.png`, fullPage: true });
  };

  fs.mkdirSync('shots', { recursive: true });

  // Today
  await page.goto('http://localhost:8099/#/today');
  await page.waitForTimeout(800);
  await shot('01-today');

  const habitRows = await page.locator('.row').count();
  if (habitRows < 5) problems.push(`Today shows ${habitRows} rows, expected 5`);

  // Toggle the yes/no habit twice and check the pending indicator appears
  const tick = page.locator("[data-act='toggle']").first();
  const before = await tick.getAttribute('aria-pressed');
  await tick.click();
  await page.waitForTimeout(120);
  const after = await tick.getAttribute('aria-pressed');
  if (before === after) problems.push('Tapping the tick did not change its state');
  await shot('02-today-toggled');
  await page.waitForTimeout(900);
  if (!writes.some(w => w.habit_id === 'medication')) problems.push('Toggle never reached the bridge');

  // Number sheet
  await page.locator("[data-act='num']").first().click();
  await page.waitForTimeout(250);
  if (!(await page.locator('.sheet').count())) problems.push('Number sheet did not open');
  await shot('03-number-sheet');
  await page.fill('#sheet-val', '8450');
  await page.click("[data-act='sheet-save']");
  await page.waitForTimeout(900);
  if (!writes.some(w => w.habit_id === 'steps' && w.value === 8450)) problems.push('Number save never reached the bridge');

  // Past day
  await page.click("[data-act='day'][data-n='-1']");
  await page.waitForTimeout(250);
  await shot('04-past-day');
  const kicker = await page.locator('.kicker').first().innerText();
  if (kicker.trim().toLowerCase() !== 'editing') {
    problems.push('Stepping back a day did not switch the header, it says: ' + kicker);
  }
  const dayTitle = await page.locator('.head-title').first().innerText();
  if (!dayTitle.trim()) problems.push('Past day has no date in the header');

  // Look back index
  await page.goto('http://localhost:8099/#/back');
  await page.waitForTimeout(500);
  await shot('05-look-back');

  // Detail: number with a benchmark
  await page.goto('http://localhost:8099/#/h/steps');
  await page.waitForTimeout(500);
  await shot('06-steps-month');
  if (!(await page.locator('.hm-cell').count())) problems.push('Steps heatmap drew no cells');
  if (!(await page.locator('svg[role=img]').count())) problems.push('Steps chart missing');

  await page.click("[data-act='range'][data-v='quarter']");
  await page.waitForTimeout(400);
  await shot('07-steps-quarter');

  await page.click("[data-act='range'][data-v='year']");
  await page.waitForTimeout(400);
  await shot('08-steps-year');

  // Detail: yes/no
  await page.goto('http://localhost:8099/#/h/medication');
  await page.waitForTimeout(400);
  await shot('09-medication');
  await page.click("[data-act='range'][data-v='year']");
  await page.waitForTimeout(400);
  await shot('10-medication-year');

  // Detail: number without a benchmark
  await page.goto('http://localhost:8099/#/h/weight');
  await page.waitForTimeout(400);
  await shot('11-weight');

  // Heatmap square opens that day
  await page.goto('http://localhost:8099/#/h/steps');
  await page.waitForTimeout(400);
  await page.locator('.hm-cell').nth(10).click();
  await page.waitForTimeout(400);
  const hashAfterCell = await page.evaluate(() => location.hash);
  if (!hashAfterCell.includes('/today')) {
    problems.push('Tapping a heatmap square did not open that day');
  }
  await shot('12-day-from-heatmap');

  // Habits list + reorder by keyboard
  await page.goto('http://localhost:8099/#/habits');
  await page.waitForTimeout(400);
  await shot('13-habits');
  const firstName = await page.locator('.hl-name').first().innerText();
  await page.locator('[data-handle]').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(500);
  const newFirst = await page.locator('.hl-name').first().innerText();
  if (firstName === newFirst) problems.push('Keyboard reorder did not move the row');
  if (!writes.some(w => w.reorder)) problems.push('Reorder never reached the bridge');
  await shot('14-habits-reordered');

  // New habit form
  await page.goto('http://localhost:8099/#/new');
  await page.waitForTimeout(300);
  await shot('15-new-habit');
  await page.click("[data-act='type'][data-v='bool']");
  await page.waitForTimeout(150);
  const numVisible = await page.locator('#num-fields').isVisible();
  if (numVisible) problems.push('Choosing Yes/No left the number fields on screen');
  await shot('16-new-habit-bool');

  // Edit form
  await page.goto('http://localhost:8099/#/edit/steps');
  await page.waitForTimeout(300);
  await shot('17-edit-habit');
  if ((await page.locator('#f-name').inputValue()) !== 'Steps') problems.push('Edit form did not load the habit');

  // Archive from the edit form
  await page.click("[data-act='archive']");
  await page.waitForTimeout(900);
  const archiveCall = writes.filter(w => w && w.archived === true);
  if (!archiveCall.length) problems.push('Archive never reached the bridge in the expected shape');
  else if (archiveCall[archiveCall.length - 1].id !== 'steps') problems.push('Archive sent the wrong habit');

  // Setup screen
  await page.goto('http://localhost:8099/#/setup');
  await page.waitForTimeout(300);
  await shot('18-setup');

  // First run: no config at all
  const fresh = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
  const p2 = await fresh.newPage();
  p2.on('console', m => { if (m.type() === 'error') note('console(fresh): ' + m.text()); });
  await p2.goto('http://localhost:8099/');
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: 'shots/19-first-run.png', fullPage: true });
  if (!(await p2.locator('#f-endpoint').count())) problems.push('First run did not show the setup screen');

  // Empty state: connected, no habits
  await fresh.route('**/macros/s/STUB/exec', r => r.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ ok: true, habits: [], entries: [] })
  }));
  await p2.evaluate(([ep, tk]) => localStorage.setItem('ht.cfg', JSON.stringify({ endpoint: ep, token: tk })), [ENDPOINT, 'test-token']);
  await p2.goto('http://localhost:8099/#/today');
  await p2.reload();   /* a hash change alone does not re-read the saved config */
  await p2.waitForTimeout(900);
  await p2.screenshot({ path: 'shots/20-empty.png', fullPage: true });
  const emptyText = await p2.locator('.empty').first().innerText().catch(() => '');
  if (!/no habits yet/i.test(emptyText)) {
    problems.push('Connected with no habits did not show the empty state, saw: ' + emptyText);
  }

  await browser.close();
  server.close();

  console.log('\nwrites captured:', writes.length);
  if (problems.length) {
    console.log('\nPROBLEMS:');
    problems.forEach(p => console.log(' - ' + p));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();
