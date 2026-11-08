/**
 * Habit tracker - Google Apps Script bridge.
 *
 * Bound to the spreadsheet that stores the data. The web app is the only
 * thing that reads or writes the sheet; the phone and laptop talk to it.
 *
 * Setup:
 *   1. Project Settings > Script properties > add TOKEN = a long random string.
 *   2. Deploy > New deployment > Web app.
 *        Execute as: Me
 *        Who has access: Anyone      <- required, the token is what protects it
 *   3. Copy the /exec URL into the app's setup screen along with the token.
 */

var HABITS_SHEET = 'Habits';
var ENTRIES_SHEET = 'Entries';
var HABIT_HEADERS = ['id', 'name', 'type', 'unit', 'benchmark', 'color', 'position', 'archived'];
var ENTRY_HEADERS = ['date', 'habit_id', 'value', 'updated_at'];

/* No red and no green: colour never reads as good or bad. */
var PALETTE = [
  '#60A5FA', '#2DD4BF', '#A78BFA', '#FBBF24', '#F472B6',
  '#FB923C', '#818CF8', '#E879F9', '#D9C99A', '#94A3B8'
];

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.op) {
    return json({
      ok: true,
      service: 'habit-tracker',
      message: 'Bridge is deployed. The app talks to it over POST.'
    });
  }
  return route(p);
}

function doPost(e) {
  var p = {};
  if (e && e.postData && e.postData.contents) {
    try { p = JSON.parse(e.postData.contents); } catch (err) { p = {}; }
  }
  return route(p);
}

function route(p) {
  try {
    var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!expected) {
      return json({ ok: false, error: 'No TOKEN script property is set on this script.' });
    }
    if (String(p.token || '') !== String(expected)) {
      return json({ ok: false, error: 'Bad token.' });
    }

    switch (p.op) {
      case 'getAll':
        return json(getAll_());
      case 'setEntries':
        return json(withLock_(function () { return setEntries_(p.entries || []); }));
      case 'setEntry':
        return json(withLock_(function () {
          return setEntries_([{ date: p.date, habit_id: p.habit_id, value: p.value }]);
        }));
      case 'saveHabit':
        return json(withLock_(function () { return saveHabit_(p.habit || {}); }));
      case 'reorder':
        return json(withLock_(function () { return reorder_(p.ids || []); }));
      default:
        return json({ ok: false, error: 'Unknown op: ' + p.op });
    }
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return { ok: false, error: 'Busy, try again.' };
  }
  try {
    var out = fn() || {};
    /* Never paper over a failure the operation already reported. */
    if (out.ok === undefined) out.ok = true;
    return out;
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Sheet plumbing                                                      */
/* ------------------------------------------------------------------ */

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var headers = (name === HABITS_SHEET) ? HABIT_HEADERS : ENTRY_HEADERS;
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (name === ENTRIES_SHEET) {
      /* Keep dates as plain text so Sheets never reinterprets them. */
      sh.getRange('A:A').setNumberFormat('@');
    }
  }
  return sh;
}

/** Accepts a string or a Date and always returns YYYY-MM-DD. */
function dateStr_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v).trim();
}

function rowsOf_(sh, width) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, width).getValues();
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

function getAll_() {
  var hs = sheet_(HABITS_SHEET);
  var es = sheet_(ENTRIES_SHEET);

  var habits = rowsOf_(hs, HABIT_HEADERS.length)
    .filter(function (r) { return String(r[0] || '').length > 0; })
    .map(function (r) {
      return {
        id: String(r[0]),
        name: String(r[1] || ''),
        type: String(r[2] || 'number') === 'bool' ? 'bool' : 'number',
        unit: String(r[3] || ''),
        benchmark: (r[4] === '' || r[4] === null) ? null : Number(r[4]),
        color: String(r[5] || PALETTE[0]),
        position: Number(r[6] || 0),
        archived: r[7] === true || String(r[7]).toLowerCase() === 'true'
      };
    })
    .sort(function (a, b) { return a.position - b.position; });

  /* Entries go over the wire as compact arrays: [date, habit_id, value]. */
  var entries = [];
  var raw = rowsOf_(es, ENTRY_HEADERS.length);
  for (var i = 0; i < raw.length; i++) {
    var d = dateStr_(raw[i][0]);
    var h = String(raw[i][1] || '');
    if (!d || !h) continue;
    var v = raw[i][2];
    if (v === '' || v === null || v === undefined) continue;
    entries.push([d, h, Number(v)]);
  }

  return { ok: true, habits: habits, entries: entries, server_time: new Date().toISOString() };
}

/**
 * Upserts one value per habit per day. A null value deletes the row,
 * which is how a day goes back to blank.
 */
function setEntries_(items) {
  if (!items.length) return { written: [] };

  var sh = sheet_(ENTRIES_SHEET);
  var last = sh.getLastRow();
  var index = {};
  if (last > 1) {
    var keys = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < keys.length; i++) {
      var k = dateStr_(keys[i][0]) + '|' + String(keys[i][1] || '');
      if (k !== '|') index[k] = i + 2;
    }
  }

  var now = new Date().toISOString();
  var deletes = [];
  var appends = [];
  var written = [];

  for (var j = 0; j < items.length; j++) {
    var it = items[j] || {};
    var d = dateStr_(it.date);
    var h = String(it.habit_id || '');
    if (!d || !h) continue;
    var key = d + '|' + h;
    var row = index[key];
    var blank = (it.value === null || it.value === undefined || it.value === '');

    if (blank) {
      if (row) { deletes.push(row); delete index[key]; }
      written.push([d, h, null]);
    } else {
      var v = Number(it.value);
      if (!isFinite(v)) continue;
      if (row) {
        sh.getRange(row, 3, 1, 2).setValues([[v, now]]);
      } else {
        appends.push([d, h, v, now]);
      }
      written.push([d, h, v]);
    }
  }

  /* Deletes last, highest row first, so earlier row numbers stay valid. */
  deletes.sort(function (a, b) { return b - a; });
  for (var x = 0; x < deletes.length; x++) sh.deleteRow(deletes[x]);

  if (appends.length) {
    sh.getRange(sh.getLastRow() + 1, 1, appends.length, 4).setValues(appends);
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).setNumberFormat('@');
  }

  return { written: written };
}

function saveHabit_(h) {
  var sh = sheet_(HABITS_SHEET);
  var rows = rowsOf_(sh, HABIT_HEADERS.length);
  var name = String(h.name || '').trim();
  if (!name) return { ok: false, error: 'A habit needs a name.' };

  var id = String(h.id || '').trim();
  var rowNum = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === id && id) { rowNum = i + 2; break; }
  }

  if (!rowNum) {
    /* New habit: stable id, next free colour, end of the list. */
    var base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'habit';
    var taken = {};
    var used = {};
    var maxPos = 0;
    for (var j = 0; j < rows.length; j++) {
      taken[String(rows[j][0])] = true;
      used[String(rows[j][5] || '')] = true;
      maxPos = Math.max(maxPos, Number(rows[j][6] || 0));
    }
    id = base;
    var n = 2;
    while (taken[id]) { id = base + '-' + n; n++; }

    var color = '';
    for (var c = 0; c < PALETTE.length; c++) {
      if (!used[PALETTE[c]]) { color = PALETTE[c]; break; }
    }
    if (!color) color = PALETTE[rows.length % PALETTE.length];

    var row = [
      id,
      name,
      h.type === 'bool' ? 'bool' : 'number',
      String(h.unit || ''),
      (h.benchmark === null || h.benchmark === undefined || h.benchmark === '') ? '' : Number(h.benchmark),
      color,
      maxPos + 1,
      false
    ];
    sh.appendRow(row);
    return { habit: habitFromRow_(row) };
  }

  /* Existing habit: type never changes, so history keeps its meaning.
     A field left out is kept; sending null for it is what clears it. */
  var cur = rows[rowNum - 2];
  var benchmark;
  if (h.benchmark === undefined) benchmark = (cur[4] === '' || cur[4] === null) ? '' : Number(cur[4]);
  else if (h.benchmark === null || h.benchmark === '') benchmark = '';
  else benchmark = Number(h.benchmark);

  var updated = [
    id,
    name,
    String(cur[2] || 'number'),
    (h.unit === undefined) ? String(cur[3] || '') : String(h.unit || ''),
    benchmark,
    String(h.color || cur[5] || PALETTE[0]),
    Number(cur[6] || 0),
    (h.archived === undefined) ? (cur[7] === true) : (h.archived === true)
  ];
  sh.getRange(rowNum, 1, 1, HABIT_HEADERS.length).setValues([updated]);
  return { habit: habitFromRow_(updated) };
}

function habitFromRow_(r) {
  return {
    id: String(r[0]),
    name: String(r[1] || ''),
    type: String(r[2] || 'number') === 'bool' ? 'bool' : 'number',
    unit: String(r[3] || ''),
    benchmark: (r[4] === '' || r[4] === null) ? null : Number(r[4]),
    color: String(r[5] || PALETTE[0]),
    position: Number(r[6] || 0),
    archived: r[7] === true
  };
}

function reorder_(ids) {
  var sh = sheet_(HABITS_SHEET);
  var rows = rowsOf_(sh, HABIT_HEADERS.length);
  if (!rows.length) return { positions: 0 };

  var want = {};
  for (var i = 0; i < ids.length; i++) want[String(ids[i])] = i + 1;

  var out = [];
  for (var j = 0; j < rows.length; j++) {
    var id = String(rows[j][0]);
    out.push([want[id] === undefined ? Number(rows[j][6] || 0) : want[id]]);
  }
  sh.getRange(2, 7, out.length, 1).setValues(out);
  return { positions: ids.length };
}

/* ------------------------------------------------------------------ */
/* Weekly CSV backup - optional, see the README                        */
/* ------------------------------------------------------------------ */

function backupToDrive() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var folderName = 'Habit tracker backups';
  var folders = DriveApp.getFoldersByName(folderName);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

  [HABITS_SHEET, ENTRIES_SHEET].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var values = sh.getDataRange().getValues();
    var csv = values.map(function (row) {
      return row.map(function (cell) {
        var s = (cell === null || cell === undefined) ? '' : String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
    folder.createFile(name.toLowerCase() + '-' + stamp + '.csv', csv, MimeType.CSV);
  });
}
