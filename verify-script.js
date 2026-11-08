/* Runs Code.gs against an in-memory fake of the Sheets API, so the row
   bookkeeping (upserts, deletes, reorder) is exercised before real data
   depends on it. */
const fs = require('fs');
const vm = require('vm');

function makeSheet(name) {
  const data = [];                    // array of rows, each an array of cells
  const api = {
    name,
    _data: data,
    getLastRow() {
      let last = 0;
      data.forEach((row, i) => {
        if (row && row.some(c => c !== '' && c !== null && c !== undefined)) last = i + 1;
      });
      return last;
    },
    setFrozenRows() { return api; },
    appendRow(row) { data[api.getLastRow()] = row.slice(); return api; },
    deleteRow(n) { data.splice(n - 1, 1); return api; },
    getDataRange() { return api.getRange(1, 1, Math.max(1, api.getLastRow()), 8); },
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') {     // 'A:A'
        return { setNumberFormat: () => {}, setValues: () => {}, setFontWeight: () => {} };
      }
      nr = nr === undefined ? 1 : nr;
      nc = nc === undefined ? 1 : nc;
      if (nr < 1) throw new Error('getRange: numRows must be at least 1, got ' + nr);
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = data[r - 1 + i] || [];
            const slice = [];
            for (let j = 0; j < nc; j++) {
              const v = row[c - 1 + j];
              slice.push(v === undefined ? '' : v);
            }
            out.push(slice);
          }
          return out;
        },
        setValues(vals) {
          if (vals.length !== nr) throw new Error('setValues: row count mismatch');
          vals.forEach((row, i) => {
            if (row.length !== nc) throw new Error('setValues: column count mismatch');
            if (!data[r - 1 + i]) data[r - 1 + i] = [];
            row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; });
          });
          return this;
        },
        setNumberFormat() { return this; },
        setFontWeight() { return this; }
      };
    }
  };
  return api;
}

function makeContext(token) {
  const sheets = {};
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => { sheets[n] = makeSheet(n); return sheets[n]; }
  };
  const ctx = {
    _sheets: sheets,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'TOKEN' ? token : null) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } })
    },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    Utilities: {
      formatDate: (d) => {
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      }
    },
    DriveApp: {}, MimeType: { CSV: 'csv' },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('Code.gs', 'utf8'), ctx);
  return ctx;
}

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

const ctx = makeContext('secret');
const post = (body) => JSON.parse(
  ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()
);
const ok = (body) => {
  const r = post(Object.assign({ token: 'secret' }, body));
  if (r.ok !== true) throw new Error('call failed: ' + JSON.stringify(r));
  return r;
};

/* --- auth --------------------------------------------------------- */
check(post({ op: 'getAll' }).ok === false, 'A request with no token should be refused');
check(post({ op: 'getAll', token: 'wrong' }).ok === false, 'A wrong token should be refused');
check(post({ op: 'nope', token: 'secret' }).ok === false, 'An unknown op should be refused');

/* --- habits ------------------------------------------------------- */
ok({ op: 'saveHabit', habit: { name: 'Medication', type: 'bool' } });
ok({ op: 'saveHabit', habit: { name: 'Steps', type: 'number', unit: 'steps', benchmark: 10000 } });
ok({ op: 'saveHabit', habit: { name: 'Weight', type: 'number', unit: 'kg' } });

let all = ok({ op: 'getAll' });
check(all.habits.length === 3, 'Expected 3 habits, got ' + all.habits.length);
check(all.habits[0].id === 'medication', 'Habit id should be slugged from the name');
check(all.habits[1].benchmark === 10000, 'Benchmark did not round-trip');
check(all.habits[2].benchmark === null, 'A habit with no benchmark should read back as null');
const colors = all.habits.map(h => h.color);
check(new Set(colors).size === 3, 'Each habit should get its own colour, got ' + colors.join(','));
check(all.habits.every(h => h.position > 0), 'Every habit needs a position');

/* a duplicate name must not collide on id */
ok({ op: 'saveHabit', habit: { name: 'Steps', type: 'number' } });
all = ok({ op: 'getAll' });
check(new Set(all.habits.map(h => h.id)).size === 4, 'Duplicate names produced a duplicate id');

/* a name-only save must not wipe the unit and benchmark it already had */
ok({ op: 'saveHabit', habit: { id: 'steps', name: 'Steps walked', unit: 'steps', benchmark: 10000 } });
all = ok({ op: 'getAll' });
const steps = all.habits.find(h => h.id === 'steps');
check(steps.name === 'Steps walked', 'Rename did not stick');
check(steps.benchmark === 10000 && steps.unit === 'steps', 'Edit dropped the unit or benchmark');
check(steps.type === 'number', 'Type must not change on edit');

/* a partial edit keeps what it does not mention, and null is what clears */
ok({ op: 'saveHabit', habit: { id: 'steps', name: 'Steps walked' } });
let s2 = ok({ op: 'getAll' }).habits.find(h => h.id === 'steps');
check(s2.benchmark === 10000 && s2.unit === 'steps', 'A partial edit wiped the unit or benchmark');
ok({ op: 'saveHabit', habit: { id: 'steps', name: 'Steps walked', unit: 'steps', benchmark: null } });
s2 = ok({ op: 'getAll' }).habits.find(h => h.id === 'steps');
check(s2.benchmark === null, 'Sending null did not clear the benchmark');
ok({ op: 'saveHabit', habit: { id: 'steps', name: 'Steps walked', unit: 'steps', benchmark: 10000 } });

/* a bad habit must report the failure, not a false success */
check(post({ op: 'saveHabit', token: 'secret', habit: { name: '  ' } }).ok === false,
  'A nameless habit should be refused, not silently accepted');

/* --- entries ------------------------------------------------------ */
ok({ op: 'setEntries', entries: [
  { date: '2026-11-01', habit_id: 'steps', value: 8000 },
  { date: '2026-11-02', habit_id: 'steps', value: 9000 },
  { date: '2026-11-03', habit_id: 'steps', value: 10500 },
  { date: '2026-11-01', habit_id: 'medication', value: 1 },
  { date: '2026-11-02', habit_id: 'weight', value: 72.4 }
] });
all = ok({ op: 'getAll' });
check(all.entries.length === 5, 'Expected 5 entries, got ' + all.entries.length);

/* correcting a day overwrites, never duplicates */
ok({ op: 'setEntry', date: '2026-11-02', habit_id: 'steps', value: 9500 });
all = ok({ op: 'getAll' });
check(all.entries.length === 5, 'A correction added a row instead of overwriting');
check(all.entries.find(e => e[0] === '2026-11-02' && e[1] === 'steps')[2] === 9500,
  'The corrected value did not stick');

/* clearing a day removes the row, and leaves the others alone */
ok({ op: 'setEntry', date: '2026-11-02', habit_id: 'steps', value: null });
all = ok({ op: 'getAll' });
check(all.entries.length === 4, 'Clearing a day did not delete its row');
check(!all.entries.some(e => e[0] === '2026-11-02' && e[1] === 'steps'), 'The cleared row is still there');
check(all.entries.find(e => e[0] === '2026-11-02' && e[1] === 'weight')[2] === 72.4,
  'Deleting one row corrupted another');
check(all.entries.find(e => e[0] === '2026-11-03' && e[1] === 'steps')[2] === 10500,
  'Deleting a row shifted a later value');

/* several deletes and writes in one batch, the risky case for row numbers */
ok({ op: 'setEntries', entries: [
  { date: '2026-11-04', habit_id: 'steps', value: 7000 },
  { date: '2026-11-05', habit_id: 'steps', value: 7500 },
  { date: '2026-11-06', habit_id: 'steps', value: 8200 }
] });
ok({ op: 'setEntries', entries: [
  { date: '2026-11-01', habit_id: 'steps', value: null },
  { date: '2026-11-04', habit_id: 'steps', value: null },
  { date: '2026-11-05', habit_id: 'steps', value: 7777 },
  { date: '2026-11-07', habit_id: 'steps', value: 9100 }
] });
all = ok({ op: 'getAll' });
const stepRows = all.entries.filter(e => e[1] === 'steps').sort((a, b) => a[0] < b[0] ? -1 : 1);
const expect = [['2026-11-03', 10500], ['2026-11-05', 7777], ['2026-11-06', 8200], ['2026-11-07', 9100]];
check(stepRows.length === expect.length,
  'Mixed batch left ' + stepRows.length + ' step rows, expected ' + expect.length);
expect.forEach((want, i) => {
  if (!stepRows[i] || stepRows[i][0] !== want[0] || stepRows[i][2] !== want[1]) {
    problems.push('Mixed batch row ' + i + ' is ' + JSON.stringify(stepRows[i]) + ', expected ' + JSON.stringify(want));
  }
});
check(all.entries.some(e => e[1] === 'medication' && e[0] === '2026-11-01'),
  'A batch of step deletes removed another habit\'s row');

/* a zero is a real logged value, not a blank */
ok({ op: 'setEntry', date: '2026-11-08', habit_id: 'steps', value: 0 });
all = ok({ op: 'getAll' });
check(all.entries.some(e => e[0] === '2026-11-08' && e[1] === 'steps' && e[2] === 0),
  'A logged zero was dropped');

/* --- reorder and archive ------------------------------------------ */
ok({ op: 'reorder', ids: ['weight', 'steps', 'medication'] });
all = ok({ op: 'getAll' });
check(all.habits[0].id === 'weight' && all.habits[1].id === 'steps',
  'Reorder did not take: ' + all.habits.map(h => h.id).join(','));

ok({ op: 'saveHabit', habit: { id: 'weight', name: 'Weight', unit: 'kg', archived: true } });
all = ok({ op: 'getAll' });
check(all.habits.find(h => h.id === 'weight').archived === true, 'Archive did not stick');
check(all.entries.length > 0, 'Archiving a habit should keep its history');

ok({ op: 'saveHabit', habit: { id: 'weight', name: 'Weight', unit: 'kg', archived: false } });
check(ok({ op: 'getAll' }).habits.find(h => h.id === 'weight').archived === false, 'Restore did not stick');

/* --- report -------------------------------------------------------- */
if (problems.length) {
  console.log('PROBLEMS:');
  problems.forEach(p => console.log(' - ' + p));
  process.exit(1);
}
console.log('Apps Script logic: all checks passed.');
