/* Habit tracker - single-user PWA over a Google Sheet.
 *
 * Rules this app is built on:
 *   one value per habit per day; logging is the win, never a pass or fail;
 *   blank means "not done" for yes/no and "no data" for numbers (a gap, not a zero);
 *   a benchmark is a reference line and a shading scale, nothing more;
 *   days run midnight to midnight, and any past day stays editable.
 */
(function () {
'use strict';

/* ------------------------------------------------------------------ */
/* Keys, constants                                                     */
/* ------------------------------------------------------------------ */

var CFG_KEY = 'ht.cfg';
var CACHE_KEY = 'ht.cache';
var OUTBOX_KEY = 'ht.outbox';

var PALETTE = [
  '#60A5FA', '#2DD4BF', '#A78BFA', '#FBBF24', '#F472B6',
  '#FB923C', '#818CF8', '#E879F9', '#D9C99A', '#94A3B8'
];

var DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var DAYNAME = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function toStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function fromStr(s) {
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function today() { return toStr(new Date()); }
function addDays(s, n) { var d = fromStr(s); d.setDate(d.getDate() + n); return toStr(d); }
function addMonths(s, n) { var d = fromStr(s); d.setDate(1); d.setMonth(d.getMonth() + n); return toStr(d); }
function monthStart(s) { var d = fromStr(s); d.setDate(1); return toStr(d); }
function daysInMonth(s) { var d = fromStr(s); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function mondayIdx(s) { return (fromStr(s).getDay() + 6) % 7; }
function monthLabel(s) { var d = fromStr(s); return MON[d.getMonth()] + ' ' + d.getFullYear(); }
function dayLabel(s) { var d = fromStr(s); return d.getDate() + ' ' + MON[d.getMonth()]; }
function longDay(s) {
  var d = fromStr(s);
  return DAYNAME[(d.getDay() + 6) % 7] + ', ' + d.getDate() + ' ' + MON[d.getMonth()];
}
function spokenDay(s) {
  var d = fromStr(s);
  return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
}

function fmtNum(v) {
  if (v == null) return '';
  var r = Math.round(v * 10) / 10;
  return r.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/* Axis ticks: a decimal on a step count is just noise. */
function axisNum(v) {
  if (Math.abs(v) >= 100) return Math.round(v).toLocaleString('en-US');
  return fmtNum(v);
}

function hexToRgb(hex) {
  var h = String(hex).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var n = parseInt(h, 16);
  if (!isFinite(n)) return '155,163,177';
  return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
}

function icon(name) {
  var p = {
    left: "<path d='M15 5l-7 7 7 7'/>",
    right: "<path d='M9 5l7 7-7 7'/>",
    close: "<path d='M6 6l12 12M18 6L6 18'/>",
    plus: "<path d='M12 5v14M5 12h14'/>",
    check: "<path d='M5 12.5l4.5 4.5L19 7.5'/>",
    cal: "<rect x='4' y='5' width='16' height='15' rx='3'/><path d='M4 10h16M9 3v4M15 3v4'/>",
    grid: "<rect x='4' y='4' width='6.5' height='6.5' rx='1.6'/><rect x='13.5' y='4' width='6.5' height='6.5' rx='1.6'/><rect x='4' y='13.5' width='6.5' height='6.5' rx='1.6'/><rect x='13.5' y='13.5' width='6.5' height='6.5' rx='1.6'/>",
    list: "<path d='M9 6h11M9 12h11M9 18h11'/><circle cx='4.5' cy='6' r='1'/><circle cx='4.5' cy='12' r='1'/><circle cx='4.5' cy='18' r='1'/>"
  }[name] || '';
  return "<svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' " +
    "stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" + p + "</svg>";
}
function tabIcon(name) {
  var p = {
    cal: "<rect x='4' y='5' width='16' height='15' rx='3'/><path d='M4 10h16M9 3v4M15 3v4'/>",
    grid: "<rect x='4' y='4' width='6.5' height='6.5' rx='1.6'/><rect x='13.5' y='4' width='6.5' height='6.5' rx='1.6'/><rect x='4' y='13.5' width='6.5' height='6.5' rx='1.6'/><rect x='13.5' y='13.5' width='6.5' height='6.5' rx='1.6'/>",
    list: "<path d='M9 6h11M9 12h11M9 18h11'/><circle cx='4.5' cy='6' r='1'/><circle cx='4.5' cy='12' r='1'/><circle cx='4.5' cy='18' r='1'/>"
  }[name];
  return "<svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' " +
    "stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>" + p + "</svg>";
}
function dragIcon() {
  return "<svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>" +
    "<circle cx='9' cy='6' r='1.8'/><circle cx='15' cy='6' r='1.8'/><circle cx='9' cy='12' r='1.8'/>" +
    "<circle cx='15' cy='12' r='1.8'/><circle cx='9' cy='18' r='1.8'/><circle cx='15' cy='18' r='1.8'/></svg>";
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

function load(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

var S = {
  cfg: load(CFG_KEY, null),
  habits: [],
  entries: {},          /* 'date|habit' -> number */
  outbox: load(OUTBOX_KEY, {}),   /* 'date|habit' -> number | null */
  date: today(),
  range: 'month',
  anchor: monthStart(today()),
  syncing: false,
  error: null,
  booted: false
};

(function restoreCache() {
  var c = load(CACHE_KEY, null);
  if (c && c.habits) {
    S.habits = c.habits;
    S.entries = c.entries || {};
  }
})();

function cache() { save(CACHE_KEY, { habits: S.habits, entries: S.entries }); }
function key(date, id) { return date + '|' + id; }

function valueOf(date, id) {
  var k = key(date, id);
  if (Object.prototype.hasOwnProperty.call(S.outbox, k)) {
    var pending = S.outbox[k];
    return pending === null ? null : pending;
  }
  var v = S.entries[k];
  return v === undefined ? null : v;
}

function activeHabits() {
  return S.habits.filter(function (h) { return !h.archived; });
}
function habitById(id) {
  for (var i = 0; i < S.habits.length; i++) if (S.habits[i].id === id) return S.habits[i];
  return null;
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

function api(op, payload) {
  if (!S.cfg || !S.cfg.endpoint) return Promise.reject(new Error('Not set up yet.'));
  var body = Object.assign({ op: op, token: S.cfg.token }, payload || {});
  return fetch(S.cfg.endpoint, {
    method: 'POST',
    /* text/plain keeps the browser from sending a preflight Apps Script cannot answer */
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow'
  }).then(function (res) {
    if (!res.ok) throw new Error('Server returned ' + res.status);
    return res.json();
  }).then(function (data) {
    if (!data || data.ok !== true) throw new Error((data && data.error) || 'Request failed.');
    return data;
  });
}

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

var flushTimer = null;

function queue(date, id, value) {
  S.outbox[key(date, id)] = value;
  save(OUTBOX_KEY, S.outbox);
  render();
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 400);
}

function flush() {
  var keys = Object.keys(S.outbox);
  if (!keys.length || S.syncing || !S.cfg) return Promise.resolve();
  if (navigator.onLine === false) return Promise.resolve();

  var batch = keys.map(function (k) {
    var parts = k.split('|');
    return { date: parts[0], habit_id: parts[1], value: S.outbox[k] };
  });

  S.syncing = true;
  S.error = null;
  render();

  return api('setEntries', { entries: batch }).then(function () {
    batch.forEach(function (item) {
      var k = key(item.date, item.habit_id);
      /* Only clear what we sent; a tap during the flight stays queued. */
      if (S.outbox[k] === item.value) delete S.outbox[k];
      if (item.value === null) delete S.entries[k];
      else S.entries[k] = item.value;
    });
    save(OUTBOX_KEY, S.outbox);
    cache();
    S.syncing = false;
    render();
  }).catch(function (err) {
    S.syncing = false;
    S.error = err.message;
    render();
  });
}

function pull() {
  if (!S.cfg) return Promise.resolve();
  S.syncing = true;
  render();
  return api('getAll', {}).then(function (data) {
    S.habits = data.habits || [];
    var map = {};
    (data.entries || []).forEach(function (row) { map[key(row[0], row[1])] = row[2]; });
    S.entries = map;
    cache();
    S.syncing = false;
    S.error = null;
    S.booted = true;
    render();
  }).catch(function (err) {
    S.syncing = false;
    S.error = err.message;
    S.booted = true;
    render();
  });
}

function sync() {
  return flush().then(pull);
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

function route() {
  var h = (location.hash || '#/today').replace(/^#/, '');
  var parts = h.split('/').filter(Boolean);
  return { name: parts[0] || 'today', arg: parts[1] ? decodeURIComponent(parts[1]) : null };
}
function go(path) {
  if (location.hash === '#' + path) render();
  else location.hash = path;
}

/* ------------------------------------------------------------------ */
/* Shared chrome                                                       */
/* ------------------------------------------------------------------ */

function tabs(current) {
  function tab(path, id, label, ic) {
    return "<a class='tab' href='#" + path + "'" +
      (current === id ? " aria-current='page'" : '') + ">" +
      tabIcon(ic) + esc(label) + "</a>";
  }
  return "<nav class='tabs' aria-label='Main'>" +
    tab('/today', 'today', 'Today', 'cal') +
    tab('/back', 'back', 'Look back', 'grid') +
    tab('/habits', 'habits', 'Habits', 'list') +
    "</nav>";
}

function statusLine() {
  if (!S.cfg) return '';
  var pending = Object.keys(S.outbox).length;
  if (S.syncing) return "<div class='status'><span class='pip'></span>Syncing…</div>";
  if (pending) {
    return "<div class='status'><span class='pip'></span>" + pending +
      (pending === 1 ? ' change' : ' changes') + " waiting to sync</div>";
  }
  if (S.error) {
    return "<div class='status'><span class='pip'></span>" + esc(S.error) +
      " <button data-act='retry' style='text-decoration:underline'>Retry</button></div>";
  }
  return "<div class='status'></div>";
}

/* ------------------------------------------------------------------ */
/* Screen: setup                                                       */
/* ------------------------------------------------------------------ */

function screenSetup() {
  var cfg = S.cfg || { endpoint: '', token: '' };
  return "<div class='app'>" +
    "<div class='head'><div><div class='kicker'>Setup</div>" +
    "<h1 class='head-title'>Connect your sheet</h1></div></div>" +
    "<div class='pad'>" +
      "<p class='field-note' style='margin:12px 0 0'>Paste the web app URL from your Apps Script deployment and the token you set. " +
      "They stay on this device.</p>" +
      "<div class='form'>" +
        "<label class='field'><span>Web app URL</span>" +
        "<input type='url' id='f-endpoint' inputmode='url' autocomplete='off' spellcheck='false' " +
        "placeholder='https://script.google.com/macros/s/…/exec' value='" + esc(cfg.endpoint) + "'></label>" +
        "<label class='field'><span>Token</span>" +
        "<input type='text' id='f-token' autocomplete='off' spellcheck='false' " +
        "placeholder='The TOKEN script property' value='" + esc(cfg.token) + "'></label>" +
        "<div id='setup-msg' class='field-note'></div>" +
        "<button class='btn-primary' data-act='save-setup'>Connect</button>" +
      "</div>" +
    "</div></div>";
}

/* ------------------------------------------------------------------ */
/* Screen: today                                                       */
/* ------------------------------------------------------------------ */

function screenToday() {
  var list = activeHabits();
  var isToday = S.date === today();
  var rows;

  if (!list.length) {
    rows = S.booted
      ? "<div class='empty'><strong>No habits yet</strong>Add your first one and it will show up here every day.</div>"
      : "<div class='empty'>Loading…</div>";
  } else {
    rows = list.map(function (h) {
      var v = valueOf(S.date, h.id);
      var logged = v != null;

      if (h.type === 'bool') {
        var fill = logged ? h.color : 'transparent';
        var ring = logged ? h.color : 'var(--dash)';
        return "<div class='row'>" +
          "<span class='dot' style='background:" + esc(h.color) + "'></span>" +
          "<a class='row-main' href='#/h/" + encodeURIComponent(h.id) + "'>" +
            "<span class='row-name'>" + esc(h.name) + "</span>" +
            "<span class='row-meta'>" + (logged ? 'Done' : 'Not done') + "</span>" +
          "</a>" +
          "<button class='tick-btn' data-act='toggle' data-id='" + esc(h.id) + "' " +
          "aria-pressed='" + (logged ? 'true' : 'false') + "' " +
          "aria-label='" + esc(h.name) + ": " + (logged ? 'done' : 'not done') + ". Tap to change.' " +
          "style='background:" + fill + ";border-color:" + ring + "'>" +
          (logged ? "<span style='color:var(--bg);display:flex'>" + icon('check') + "</span>" : '') +
          "</button></div>";
      }

      var meta = h.benchmark
        ? 'Benchmark ' + fmtNum(h.benchmark) + (h.unit ? ' ' + h.unit : '')
        : (h.unit || 'Number');
      var bar = '';
      if (h.benchmark) {
        var pct = clamp((logged ? v : 0) / h.benchmark, 0, 1) * 100;
        bar = "<span class='bar-track'><span class='bar-fill' style='width:" + pct.toFixed(1) +
          "%;background:" + esc(h.color) + "'></span></span>";
      }
      return "<div class='row'>" +
        "<span class='dot' style='background:" + esc(h.color) + "'></span>" +
        "<a class='row-main' href='#/h/" + encodeURIComponent(h.id) + "'>" +
          "<span class='row-name'>" + esc(h.name) + "</span>" +
          "<span class='row-meta'>" + esc(meta) + "</span>" + bar +
        "</a>" +
        "<button class='num-btn" + (logged ? '' : ' empty') + "' data-act='num' data-id='" + esc(h.id) + "' " +
        "aria-label='" + esc(h.name) + ": " + (logged ? fmtNum(v) + ' ' + esc(h.unit) : 'not logged') +
        ". Tap to edit.'>" +
        "<span class='num-val'>" + (logged ? esc(fmtNum(v)) : 'Add') + "</span>" +
        (logged && h.unit ? "<span class='num-unit'>" + esc(h.unit) + "</span>" : '') +
        "</button></div>";
    }).join('');

    rows += "<a class='add-row' href='#/new'>" + icon('plus') + " Add habit</a>";
  }

  return "<div class='app'>" +
    "<div class='head'>" +
      "<button class='icon-btn' data-act='day' data-n='-1' aria-label='Previous day'>" + icon('left') + "</button>" +
      "<div style='text-align:center'>" +
        "<div class='kicker'>" + (isToday ? 'Today' : 'Editing') + "</div>" +
        "<h1 class='head-title'>" + esc(longDay(S.date)) + "</h1>" +
      "</div>" +
      "<button class='icon-btn' data-act='day' data-n='1'" + (isToday ? " aria-disabled='true'" : '') +
      " aria-label='Next day'>" + icon('right') + "</button>" +
    "</div>" +
    "<div class='pad' style='padding-top:14px'><div class='rows'>" + rows + "</div>" +
    statusLine() + "</div>" +
    tabs('today') + "</div>";
}

/* ------------------------------------------------------------------ */
/* Screen: look back index                                             */
/* ------------------------------------------------------------------ */

function miniStrip(h) {
  /* Last 8 weeks, weeks as columns, as a glance at recent consistency. */
  var end = today();
  var start = addDays(end, -(mondayIdx(end) + 7 * 7));
  var n = 56;
  var vals = [];
  for (var i = 0; i < n; i++) {
    var d = addDays(start, i);
    if (d > end) { vals.push({ date: d, v: null, future: true }); continue; }
    vals.push({ date: d, v: valueOf(d, h.id), future: false });
  }
  var scale = shadeScale(h, vals);
  var cells = '';
  for (var c = 0; c < 8; c++) {
    for (var r = 0; r < 7; r++) {
      var cell = vals[c * 7 + r];
      var style = 'grid-column:' + (c + 1) + ';grid-row:' + (r + 1) + ';aspect-ratio:1;border-radius:3px;';
      style += 'background:' + (cell.future ? 'transparent' : cellColor(h, cell.v, scale));
      cells += "<div style='" + style + "'></div>";
    }
  }
  return "<div style='display:grid;grid-template-columns:repeat(8,minmax(0,1fr));" +
    "grid-template-rows:repeat(7,auto);gap:3px;width:104px;flex:none' aria-hidden='true'>" + cells + "</div>";
}

function screenBack() {
  var list = activeHabits();
  var body;
  if (!list.length) {
    body = "<div class='empty'><strong>Nothing to look back on yet</strong>Add a habit and start logging.</div>";
  } else {
    body = "<div class='rows'>" + list.map(function (h) {
      var logged = 0;
      for (var i = 0; i < 28; i++) if (valueOf(addDays(today(), -i), h.id) != null) logged++;
      return "<a class='row' href='#/h/" + encodeURIComponent(h.id) + "' style='gap:12px'>" +
        "<span class='dot' style='background:" + esc(h.color) + "'></span>" +
        "<span class='row-main'>" +
          "<span class='row-name'>" + esc(h.name) + "</span>" +
          "<span class='row-meta'>" + logged + " of the last 28 days</span>" +
        "</span>" + miniStrip(h) + "</a>";
    }).join('') + "</div>";
  }
  return "<div class='app'>" +
    "<div class='head'><div><div class='kicker'>Look back</div>" +
    "<h1 class='head-title'>Your habits</h1></div></div>" +
    "<div class='pad' style='padding-top:14px'>" + body + statusLine() + "</div>" +
    tabs('back') + "</div>";
}

/* ------------------------------------------------------------------ */
/* Shading                                                             */
/* ------------------------------------------------------------------ */

/* The scale a gradient is measured against: the benchmark when there is
   one, otherwise the habit's own low and high across the visible days. */
function shadeScale(h, cells) {
  if (h.type === 'bool') return null;
  if (h.benchmark) return { kind: 'benchmark', lo: 0, hi: h.benchmark };
  var lo = Infinity, hi = -Infinity;
  cells.forEach(function (c) {
    if (c.v == null) return;
    if (c.v < lo) lo = c.v;
    if (c.v > hi) hi = c.v;
  });
  if (!isFinite(lo)) return { kind: 'own', lo: 0, hi: 1 };
  return { kind: 'own', lo: lo, hi: hi };
}

function cellColor(h, v, scale) {
  if (v == null) return 'var(--blank)';
  if (h.type === 'bool') return h.color;
  var ratio;
  if (scale.kind === 'benchmark') ratio = clamp(v / scale.hi, 0, 1);
  else ratio = (scale.hi === scale.lo) ? 1 : clamp((v - scale.lo) / (scale.hi - scale.lo), 0, 1);
  return 'rgba(' + hexToRgb(h.color) + ',' + (0.16 + 0.84 * ratio).toFixed(2) + ')';
}

function cellLabel(h, date, v) {
  if (h.type === 'bool') return spokenDay(date) + ', ' + (v == null ? 'not done' : 'done');
  if (v == null) return spokenDay(date) + ', no entry';
  return spokenDay(date) + ', ' + fmtNum(v) + (h.unit ? ' ' + h.unit : '');
}

/* ------------------------------------------------------------------ */
/* Heatmaps                                                            */
/* ------------------------------------------------------------------ */

function cellsForRange(h) {
  var out = [], i, d;
  if (S.range === 'month') {
    var first = S.anchor;
    var total = daysInMonth(first);
    var now = today();
    for (i = 0; i < total; i++) {
      d = addDays(first, i);
      /* A day that has not happened yet is not a day you missed. */
      out.push({ date: d, v: valueOf(d, h.id), fut: d > now });
    }
  } else if (S.range === 'quarter') {
    var end = today();
    var start = addDays(end, -(mondayIdx(end) + 7 * 12));
    for (i = 0; i <= 90; i++) {
      d = addDays(start, i);
      if (d > end) break;
      out.push({ date: d, v: valueOf(d, h.id) });
    }
  } else {
    var e = today();
    var s = addDays(e, -364);
    for (i = 0; i <= 364; i++) {
      d = addDays(s, i);
      if (d > e) break;
      out.push({ date: d, v: valueOf(d, h.id) });
    }
  }
  return out;
}

function heatMonth(h, scale) {
  var first = S.anchor;
  var pad = mondayIdx(first);
  var total = daysInMonth(first);
  var weeks = Math.ceil((pad + total) / 7);
  var tmpl = "display:grid;grid-template-columns:42px repeat(7,minmax(0,1fr));gap:6px;align-items:center";
  var html = "<div style='" + tmpl + "'>";

  html += "<div></div>";
  DOW.forEach(function (d) {
    html += "<div style='font-size:11px;color:var(--quiet);text-align:center'>" + d + "</div>";
  });

  for (var w = 0; w < weeks; w++) {
    var monday = addDays(first, w * 7 - pad);
    /* A week that has not started yet would be an empty row with a label. */
    if (monday > today()) break;
    html += "<div style='font-size:11px;color:var(--quiet);white-space:nowrap'>" + esc(dayLabel(monday)) + "</div>";
    for (var i = 0; i < 7; i++) {
      var idx = w * 7 + i - pad;
      if (idx < 0 || idx >= total) { html += "<div></div>"; continue; }
      var date = addDays(first, idx);
      if (date > today()) { html += "<div style='aspect-ratio:1'></div>"; continue; }
      var v = valueOf(date, h.id);
      html += "<button class='hm-cell" + (date === today() ? ' today' : '') + "' data-act='open-day' data-d='" +
        date + "' style='aspect-ratio:1;background:" + cellColor(h, v, scale) + "' aria-label='" +
        esc(cellLabel(h, date, v)) + "'></button>";
    }
  }
  return html + "</div>";
}

function heatColumns(h, scale, cells, cols, cellRadius) {
  /* Weeks as columns, days as rows. Used for the 3-month and year-ish spans. */
  var start = cells.length ? addDays(cells[0].date, -mondayIdx(cells[0].date)) : today();
  var byKey = {};
  cells.forEach(function (c) { byKey[c.date] = c.v; });
  var last = cells.length ? cells[cells.length - 1].date : today();

  var tmpl = "display:grid;grid-template-columns:18px repeat(" + cols +
    ",minmax(0,1fr));gap:4px;align-items:center";
  var html = "<div style='" + tmpl + "'>";

  html += "<div></div>";
  for (var c = 0; c < cols; c++) {
    var colStart = addDays(start, c * 7);
    var show = fromStr(colStart).getDate() <= 7;
    html += "<div style='font-size:10px;color:var(--quiet);text-align:center;white-space:nowrap'>" +
      (show ? MON[fromStr(colStart).getMonth()] : '') + "</div>";
  }

  for (var r = 0; r < 7; r++) {
    html += "<div style='font-size:10px;color:var(--quiet)'>" + (r % 2 === 0 ? DOW[r] : '') + "</div>";
    for (var cc = 0; cc < cols; cc++) {
      var date = addDays(start, cc * 7 + r);
      if (date > last || !Object.prototype.hasOwnProperty.call(byKey, date)) {
        html += "<div style='aspect-ratio:1'></div>";
        continue;
      }
      var v = byKey[date];
      html += "<button class='hm-cell" + (date === today() ? ' today' : '') + "' data-act='open-day' data-d='" +
        date + "' style='aspect-ratio:1;border-radius:" + cellRadius + "px;background:" +
        cellColor(h, v, scale) + "' aria-label='" + esc(cellLabel(h, date, v)) + "'></button>";
    }
  }
  return html + "</div>";
}

function heatYear(h, scale) {
  /* Twelve month rows by day-of-month columns: a year on one phone screen. */
  var end = today();
  var cursor = monthStart(addMonths(end, -11));
  var tmpl = "display:grid;grid-template-columns:30px repeat(31,minmax(0,1fr));gap:2px;align-items:center";
  var html = "<div style='" + tmpl + "'>";

  html += "<div></div>";
  for (var d = 1; d <= 31; d++) {
    html += "<div style='font-size:10px;line-height:10px;color:var(--quiet);text-align:center'>" +
      (d === 1 || d % 5 === 0 ? d : '') + "</div>";
  }

  for (var m = 0; m < 12; m++) {
    var ms = addMonths(cursor, m);
    var dim = daysInMonth(ms);
    html += "<div style='font-size:10px;color:var(--quiet);white-space:nowrap'>" +
      MON[fromStr(ms).getMonth()] + "</div>";
    for (var day = 1; day <= 31; day++) {
      if (day > dim) { html += "<div style='aspect-ratio:1'></div>"; continue; }
      var date = addDays(ms, day - 1);
      if (date > end) { html += "<div style='aspect-ratio:1'></div>"; continue; }
      var v = valueOf(date, h.id);
      html += "<button class='hm-cell" + (date === today() ? ' today' : '') + "' data-act='open-day' data-d='" +
        date + "' style='aspect-ratio:1;border-radius:2px;background:" + cellColor(h, v, scale) +
        "' aria-label='" + esc(cellLabel(h, date, v)) + "'></button>";
    }
  }
  return html + "</div>";
}

function legend(h, scale) {
  if (h.type === 'bool') {
    return "<div class='legend'><div>Filled means done</div><div class='swatches'>" +
      "<span class='sw' style='background:var(--blank)'></span><span style='margin-right:8px'>Not done</span>" +
      "<span class='sw' style='background:" + esc(h.color) + "'></span><span>Done</span></div></div>";
  }
  var note = scale.kind === 'benchmark'
    ? 'Shade = value ÷ ' + fmtNum(h.benchmark)
    : (isFinite(scale.lo) ? 'Shade = own range, ' + fmtNum(scale.lo) + ' to ' + fmtNum(scale.hi) : 'Shade = own range');
  var steps = [0.3, 0.5, 0.75, 1].map(function (a) {
    return "<span class='sw' style='background:rgba(" + hexToRgb(h.color) + "," + a + ")'></span>";
  }).join('');
  return "<div class='legend'><div>" + esc(note) + "</div><div class='swatches'>" +
    "<span class='sw' style='background:var(--blank)'></span><span style='margin-right:8px'>No entry</span>" +
    "<span>less</span>" + steps + "<span>more</span></div></div>";
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

var CW = 340, CH = 150;

function barChart(h, cells) {
  var top = h.benchmark || 0;
  cells.forEach(function (c) { if (c.v != null && c.v > top) top = c.v; });
  if (top <= 0) top = 1;
  var step = Math.pow(10, Math.floor(Math.log(top) / Math.LN10));
  top = Math.ceil(top / step) * step;

  var n = cells.length;
  var gap = n > 20 ? 2 : 4;
  var bw = (CW - gap * (n - 1)) / n;
  var bars = '';
  cells.forEach(function (c, i) {
    var x = i * (bw + gap);
    if (c.v == null) {
      bars += "<rect x='" + x.toFixed(1) + "' y='" + (CH - 2) + "' width='" + bw.toFixed(1) +
        "' height='2' rx='1' fill='var(--tick)'></rect>";
      return;
    }
    var hgt = Math.max(3, (c.v / top) * CH);
    bars += "<rect x='" + x.toFixed(1) + "' y='" + (CH - hgt).toFixed(1) + "' width='" + bw.toFixed(1) +
      "' height='" + hgt.toFixed(1) + "' rx='2' fill='rgba(" + hexToRgb(h.color) + ",0.9)'></rect>";
  });

  var bench = '';
  if (h.benchmark) {
    var by = CH - (h.benchmark / top) * CH;
    bench = "<line x1='0' x2='" + CW + "' y1='" + by.toFixed(1) + "' y2='" + by.toFixed(1) +
      "' stroke='var(--quiet)' stroke-width='1.2' stroke-dasharray='5 4'></line>" +
      "<text x='" + CW + "' y='" + (by - 5).toFixed(1) + "' text-anchor='end' font-size='11' " +
      "fill='var(--quiet)'>" + esc(fmtNum(h.benchmark)) + "</text>";
  }

  var aria = 'Bar chart of ' + h.name + ' from ' + spokenDay(cells[0].date) + ' to ' +
    spokenDay(cells[cells.length - 1].date) + (h.benchmark ? ', with a reference line at ' + fmtNum(h.benchmark) : '');

  return "<svg viewBox='0 0 " + CW + ' ' + CH + "' width='100%' height='" + CH +
    "' role='img' aria-label='" + esc(aria) + "'>" + bars + bench + "</svg>" +
    "<div class='chart-legend'>" +
      "<span><span style='width:8px;height:8px;border-radius:2px;background:" + esc(h.color) + "'></span>" +
      esc(h.unit || 'value') + " per day</span>" +
      (h.benchmark ? "<span><span style='width:16px;height:0;border-top:1.2px dashed var(--quiet)'></span>Benchmark</span>" : '') +
      "<span><span style='width:10px;height:2px;background:var(--tick)'></span>No entry (a gap, not a zero)</span>" +
    "</div>";
}

function lineChart(h, cells) {
  var vals = cells.filter(function (c) { return c.v != null; }).map(function (c) { return c.v; });
  if (!vals.length) {
    return "<div class='empty' style='padding:24px 8px'>Nothing logged in this range yet.</div>";
  }
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (h.benchmark) { lo = Math.min(lo, h.benchmark); hi = Math.max(hi, h.benchmark); }
  var span = hi - lo || Math.abs(hi) * 0.1 || 1;
  lo -= span * 0.12; hi += span * 0.12;

  var n = cells.length;
  var X = function (i) { return 6 + (n === 1 ? 0 : (i / (n - 1)) * (CW - 12)); };
  var Y = function (v) { return 12 + ((hi - v) / (hi - lo)) * (CH - 34); };

  /* Over a long span, a dot and a tick per day turn into noise and bury
     the trend, so the average line carries it alone. */
  var dense = n > 120;

  var dots = '', ticks = '', trend = '', started = false;
  cells.forEach(function (c, i) {
    var x = X(i).toFixed(1);
    if (c.v == null) {
      if (!dense) ticks += 'M' + x + ' ' + (CH - 16) + 'v8';
      return;
    }
    if (!dense) dots += 'M' + x + ' ' + Y(c.v).toFixed(1) + 'h0';
    var win = [];
    for (var k = Math.max(0, i - 6); k <= i; k++) if (cells[k].v != null) win.push(cells[k].v);
    var mean = win.reduce(function (a, b) { return a + b; }, 0) / win.length;
    trend += (started ? 'L' : 'M') + x + ' ' + Y(mean).toFixed(1);
    started = true;
  });

  var bench = '';
  if (h.benchmark) {
    var by = Y(h.benchmark).toFixed(1);
    bench = "<line x1='0' x2='" + CW + "' y1='" + by + "' y2='" + by +
      "' stroke='var(--quiet)' stroke-width='1.2' stroke-dasharray='5 4'></line>";
  }

  var rgb = hexToRgb(h.color);
  var grid = [0, 0.5, 1].map(function (t) {
    var v = hi - t * (hi - lo);
    var y = Y(v).toFixed(1);
    /* The halo keeps the tick readable where the trend line runs behind it. */
    return "<line x1='0' x2='" + CW + "' y1='" + y + "' y2='" + y + "' stroke='var(--line)'></line>" +
      "<text x='0' y='" + (Number(y) - 4) + "' font-size='10' fill='var(--quiet)' " +
      "paint-order='stroke' stroke='var(--bg)' stroke-width='3' stroke-linejoin='round'>" +
      esc(axisNum(v)) + "</text>";
  }).join('');

  var aria = h.name + ' over time: a 7-day average line' +
    (dense ? '' : ', entries as dots, and ticks on days with no entry') + '.';

  var trendWidth = dense ? 2.2 : 2;
  var trendAlpha = dense ? 1 : 0.55;

  return "<svg viewBox='0 0 " + CW + ' ' + CH + "' width='100%' height='" + CH +
    "' role='img' aria-label='" + esc(aria) + "'>" + grid + bench +
    (dense ? '' : "<path d='" + ticks + "' stroke='var(--tick)' stroke-width='2' stroke-linecap='round' fill='none'></path>") +
    "<path d='" + trend + "' stroke='rgba(" + rgb + ',' + trendAlpha + ")' stroke-width='" + trendWidth +
    "' stroke-linejoin='round' stroke-linecap='round' fill='none'></path>" +
    (dense ? '' : "<path d='" + dots + "' stroke='" + esc(h.color) +
      "' stroke-width='6' stroke-linecap='round' fill='none'></path>") +
    "</svg>" +
    "<div class='chart-legend'>" +
      (dense ? '' : "<span><span style='width:8px;height:8px;border-radius:50%;background:" +
        esc(h.color) + "'></span>Entry</span>") +
      "<span><span style='width:16px;height:2px;background:rgba(" + rgb + ',' + trendAlpha +
      ")'></span>7-day average</span>" +
      (h.benchmark ? "<span><span style='width:16px;height:0;border-top:1.2px dashed var(--quiet)'></span>Benchmark</span>" : '') +
      (dense
        ? "<span>Days with no entry are skipped, not counted as zero</span>"
        : "<span><span style='width:2px;height:8px;background:var(--tick)'></span>No entry</span>") +
    "</div>";
}

/* ------------------------------------------------------------------ */
/* Screen: habit detail                                                */
/* ------------------------------------------------------------------ */

function currentRun(h) {
  var run = 0, d = today();
  /* A day still in progress should not break a run, so start at yesterday
     unless today is already logged. */
  if (valueOf(d, h.id) == null) d = addDays(d, -1);
  while (valueOf(d, h.id) != null && run < 2000) { run++; d = addDays(d, -1); }
  return run;
}

function screenDetail(id) {
  var h = habitById(id);
  if (!h) return screenToday();

  var all = cellsForRange(h);
  var cells = all.filter(function (c) { return !c.fut; });
  var scale = shadeScale(h, cells);
  var loggedDays = cells.filter(function (c) { return c.v != null; }).length;

  var sub = h.type === 'bool'
    ? 'Yes / No, once a day'
    : (h.benchmark
      ? 'Benchmark ' + fmtNum(h.benchmark) + (h.unit ? ' ' + h.unit : '') + ' a day'
      : 'No benchmark, shaded by its own range');

  var grid;
  if (S.range === 'month') grid = heatMonth(h, scale);
  else if (S.range === 'quarter') grid = heatColumns(h, scale, cells, 13, 4);
  else grid = heatYear(h, scale);

  var monthNav = S.range === 'month'
    ? "<div class='hm-nav'><div class='hm-title'>" + esc(monthLabel(S.anchor)) + "</div><div style='display:flex;margin-right:-10px'>" +
      "<button class='icon-btn' data-act='month' data-n='-1' aria-label='Previous month'>" + icon('left') + "</button>" +
      "<button class='icon-btn' data-act='month' data-n='1' aria-label='Next month'>" + icon('right') + "</button>" +
      "</div></div>"
    : "<div class='hm-nav'><div class='hm-title'>" +
      (S.range === 'quarter' ? 'Last 13 weeks' : 'Last 12 months') + "</div></div>";

  var stats;
  if (h.type === 'bool') {
    var run = currentRun(h);
    stats = statCard('Days done', loggedDays + ' of ' + cells.length) +
      statCard('Current run', run + (run === 1 ? ' day' : ' days'));
  } else {
    var sum = 0, cnt = 0;
    cells.forEach(function (c) { if (c.v != null) { sum += c.v; cnt++; } });
    stats = statCard('Days logged', loggedDays + ' of ' + cells.length) +
      statCard('Average on logged days', cnt ? fmtNum(sum / cnt) : '—');
  }

  var chart = '';
  if (h.type === 'number' && cells.length) {
    var useBars = h.benchmark && cells.length <= 40;
    chart = "<div style='padding-top:22px'><div class='section-title'>" +
      (useBars ? 'Daily values against the benchmark' : 'Entries and 7-day average') + "</div>" +
      (useBars ? barChart(h, cells) : lineChart(h, cells)) + "</div>";
  }

  return "<div class='app'>" +
    "<div class='sub-head'>" +
      "<a class='icon-btn' href='#/back' aria-label='Back'>" + icon('left') + "</a>" +
      "<div><div style='display:flex;align-items:center;gap:10px'>" +
        "<span class='dot' style='width:12px;height:12px;background:" + esc(h.color) + "'></span>" +
        "<h1>" + esc(h.name) + "</h1></div>" +
        "<div class='meta'>" + esc(sub) + "</div></div>" +
    "</div>" +
    "<div class='pad' style='padding-top:10px'>" +
      "<div class='seg'>" +
        segBtn('month', 'Month') + segBtn('quarter', '3 months') + segBtn('year', 'Year') +
      "</div>" + monthNav +
      "<div style='padding-top:10px'>" + grid + "</div>" +
      legend(h, scale) +
      "<div class='stats'>" + stats + "</div>" +
      chart +
      "<div style='padding-top:22px'><a class='btn-outline' href='#/edit/" + encodeURIComponent(h.id) +
      "'>Edit this habit</a></div>" +
      statusLine() +
    "</div>" + tabs('back') + "</div>";
}

function segBtn(value, label) {
  return "<button data-act='range' data-v='" + value + "' aria-pressed='" +
    (S.range === value ? 'true' : 'false') + "'>" + esc(label) + "</button>";
}
function statCard(label, value) {
  return "<div class='stat'><div class='stat-label'>" + esc(label) + "</div>" +
    "<div class='stat-value'>" + esc(value) + "</div></div>";
}

/* ------------------------------------------------------------------ */
/* Screen: habits list                                                 */
/* ------------------------------------------------------------------ */

function screenHabits() {
  var list = activeHabits();
  var archived = S.habits.filter(function (h) { return h.archived; });

  var rows = list.length
    ? list.map(function (h) {
      var meta = h.type === 'bool'
        ? 'Yes / No'
        : 'Number' + (h.unit ? ', ' + h.unit : '') + (h.benchmark ? ', benchmark ' + fmtNum(h.benchmark) : '');
      return "<div class='hl-row' data-id='" + esc(h.id) + "'>" +
        "<button class='icon-btn' data-handle='1' style='color:var(--quiet)' " +
        "aria-label='Reorder " + esc(h.name) + ". Use arrow keys to move it.'>" + dragIcon() + "</button>" +
        "<a class='hl-link' href='#/edit/" + encodeURIComponent(h.id) + "'>" +
          "<span class='dot' style='background:" + esc(h.color) + "'></span>" +
          "<span class='hl-main'><span class='hl-name'>" + esc(h.name) + "</span>" +
          "<span class='hl-meta'>" + esc(meta) + "</span></span>" +
          "<span style='color:var(--quiet);display:flex'>" + icon('right') + "</span>" +
        "</a></div>";
    }).join('')
    : "<div class='empty'><strong>No habits yet</strong>Start with one or two. You can always add more.</div>";

  var archivedBlock = archived.length
    ? "<div style='padding-top:26px'><div class='section-title'>Archived</div>" +
      "<div class='rows'>" + archived.map(function (h) {
        return "<a class='row' href='#/edit/" + encodeURIComponent(h.id) + "' style='opacity:0.6'>" +
          "<span class='dot' style='background:" + esc(h.color) + "'></span>" +
          "<span class='row-main'><span class='row-name'>" + esc(h.name) + "</span>" +
          "<span class='row-meta'>Hidden from Today, history kept</span></span></a>";
      }).join('') + "</div></div>"
    : '';

  return "<div class='app'>" +
    "<div class='head'><div><h1 class='head-title'>Habits</h1>" +
    "<div class='field-note' style='margin-top:6px'>Drag to reorder. The top of this list is the top of Today.</div>" +
    "</div></div>" +
    "<div class='pad' style='padding-top:18px'>" +
      "<div class='rows' id='habit-list'>" + rows + "</div>" +
      "<div style='padding-top:16px'><a class='btn-primary' href='#/new'>" + icon('plus') + " Add habit</a></div>" +
      archivedBlock +
      "<div style='padding-top:26px'><button class='btn-quiet' data-act='goto-setup'>Connection settings</button></div>" +
      statusLine() +
    "</div>" + tabs('habits') + "</div>";
}

/* ------------------------------------------------------------------ */
/* Screen: habit form                                                  */
/* ------------------------------------------------------------------ */

function screenForm(id) {
  var h = id ? habitById(id) : null;
  var editing = !!h;
  var used = {};
  S.habits.forEach(function (x) { used[x.color] = true; });
  var next = PALETTE.filter(function (c) { return !used[c]; })[0] || PALETTE[0];
  var color = editing ? h.color : next;

  var swatches = PALETTE.map(function (c) {
    var mine = editing ? (c === h.color) : (c === next);
    var taken = used[c] && !mine;
    return "<span class='pal' style='background:" + c + ";opacity:" + (taken ? '0.35' : '1') +
      (mine ? ";outline:2px solid var(--ink);outline-offset:2px" : '') + "'></span>";
  }).join('');

  var type = editing ? h.type : 'number';

  return "<div class='app'>" +
    "<div class='sub-head'>" +
      "<a class='icon-btn' href='#/habits' aria-label='Close'>" + icon('close') + "</a>" +
      "<h1>" + (editing ? 'Edit habit' : 'New habit') + "</h1>" +
    "</div>" +
    "<div class='pad'><div class='form'>" +
      "<label class='field'><span>Name</span>" +
      "<input type='text' id='f-name' placeholder='e.g. Water' value='" + esc(editing ? h.name : '') + "'></label>" +

      "<div class='field'><div class='field-label'>Type</div>" +
        "<div class='seg'>" +
          "<button data-act='type' data-v='bool' aria-pressed='" + (type === 'bool') + "'" +
          (editing ? " disabled style='opacity:0.5'" : '') + ">Yes / No</button>" +
          "<button data-act='type' data-v='number' aria-pressed='" + (type === 'number') + "'" +
          (editing ? " disabled style='opacity:0.5'" : '') + ">Number</button>" +
        "</div>" +
        "<div class='field-note'>" + (editing
          ? 'Type cannot change once a habit has history.'
          : 'Yes / No is a tap per day. Number is one daily total.') + "</div>" +
        "<input type='hidden' id='f-type' value='" + type + "'></div>" +

      "<div id='num-fields' style='display:" + (type === 'number' ? 'flex' : 'none') +
      ";flex-direction:column;gap:22px'>" +
        "<label class='field'><span>Unit</span>" +
        "<input type='text' id='f-unit' placeholder='e.g. glasses' value='" +
        esc(editing ? h.unit : '') + "'></label>" +
        "<div class='field'><label class='field-label' for='f-bench'>Benchmark " +
        "<span style='font-weight:400;color:var(--quiet)'>(optional)</span></label>" +
        "<input type='text' id='f-bench' inputmode='decimal' placeholder='e.g. 8' value='" +
        (editing && h.benchmark != null ? esc(h.benchmark) : '') + "'>" +
        "<div class='field-note'>Drawn as a reference line and used to scale the heatmap. " +
        "It never marks a day as passed or failed.</div></div>" +
      "</div>" +

      "<div class='field'><div class='field-label'>Colour</div>" +
        "<div style='display:flex;align-items:center;gap:12px'>" +
          "<span style='width:28px;height:28px;border-radius:50%;background:" + esc(color) + "'></span>" +
          "<span style='font-size:14px'>Assigned automatically</span></div>" +
        "<div class='palette' role='img' aria-label='Colour palette. Faded colours belong to other habits.'>" +
        swatches + "</div>" +
        "<div class='field-note'>Faded colours belong to your other habits.</div></div>" +

      "<div id='form-msg' class='field-note danger'></div>" +
      "<button class='btn-primary' data-act='save-habit' data-id='" + esc(editing ? h.id : '') + "'>" +
      (editing ? 'Save changes' : 'Add habit') + "</button>" +
      (editing
        ? "<button class='btn-quiet' data-act='archive' data-id='" + esc(h.id) + "'>" +
          (h.archived ? 'Restore this habit' : 'Archive this habit') + "</button>"
        : "<a class='btn-quiet' href='#/habits'>Cancel</a>") +
    "</div></div></div>";
}

/* ------------------------------------------------------------------ */
/* Number sheet                                                        */
/* ------------------------------------------------------------------ */

function openNumberSheet(h, date) {
  var v = valueOf(date, h.id);
  var ov = document.getElementById('overlay');
  ov.innerHTML = "<div class='scrim' data-act='close-sheet'>" +
    "<div class='sheet' role='dialog' aria-modal='true' aria-label='" + esc(h.name) + "'>" +
      "<h2>" + esc(h.name) + "</h2>" +
      "<div class='meta'>" + esc(longDay(date)) +
      (h.benchmark ? ' · benchmark ' + esc(fmtNum(h.benchmark)) + (h.unit ? ' ' + esc(h.unit) : '') : '') +
      "</div>" +
      "<label class='field'><span>" + esc(h.unit || 'Value') + "</span>" +
      "<input type='text' id='sheet-val' inputmode='decimal' autocomplete='off' value='" +
      (v == null ? '' : esc(String(v))) + "' placeholder='0'></label>" +
      "<button class='btn-primary' data-act='sheet-save'>Save</button>" +
      "<div class='sheet-actions'>" +
        "<button class='btn-quiet' data-act='close-sheet'>Cancel</button>" +
        (v == null ? '' : "<button class='btn-quiet danger' data-act='sheet-clear'>Clear this day</button>") +
      "</div>" +
    "</div></div>";
  ov.dataset.habit = h.id;
  ov.dataset.date = date;
  var input = document.getElementById('sheet-val');
  input.focus();
  input.select();
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); saveSheet(); }
  });
}

function closeSheet() {
  var ov = document.getElementById('overlay');
  ov.innerHTML = '';
  delete ov.dataset.habit;
  delete ov.dataset.date;
}

function saveSheet() {
  var ov = document.getElementById('overlay');
  var id = ov.dataset.habit, date = ov.dataset.date;
  var raw = (document.getElementById('sheet-val').value || '').trim();
  closeSheet();
  if (raw === '') { queue(date, id, null); return; }
  var n = Number(raw);
  if (!isFinite(n)) return;
  queue(date, id, n);
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function render() {
  var r = route();
  var el = document.getElementById('screen');
  var scroll = window.scrollY;

  if (!S.cfg && r.name !== 'setup') { el.innerHTML = screenSetup(); return; }

  var html;
  switch (r.name) {
    case 'setup': html = screenSetup(); break;
    case 'back': html = screenBack(); break;
    case 'h': html = screenDetail(r.arg); break;
    case 'habits': html = screenHabits(); break;
    case 'new': html = screenForm(null); break;
    case 'edit': html = screenForm(r.arg); break;
    default: html = screenToday();
  }
  el.innerHTML = html;
  if (r.name === 'habits') wireDrag();
  window.scrollTo(0, scroll);
}

/* ------------------------------------------------------------------ */
/* Reordering                                                          */
/* ------------------------------------------------------------------ */

var PITCH = 78; /* row height 68 + gap 10 */

function wireDrag() {
  var list = document.getElementById('habit-list');
  if (!list) return;

  list.querySelectorAll('[data-handle]').forEach(function (handle) {
    handle.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      var row = handle.closest('.hl-row');
      var ids = activeHabits().map(function (h) { return h.id; });
      var from = ids.indexOf(row.dataset.id);
      var to = clamp(from + (e.key === 'ArrowUp' ? -1 : 1), 0, ids.length - 1);
      if (to === from) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      applyOrder(ids);
      setTimeout(function () {
        var next = document.querySelector(".hl-row[data-id='" + CSS.escape(ids[to]) + "'] [data-handle]");
        if (next) next.focus();
      }, 0);
    });

    handle.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      var row = handle.closest('.hl-row');
      var rows = Array.prototype.slice.call(list.querySelectorAll('.hl-row'));
      var ids = rows.map(function (x) { return x.dataset.id; });
      var from = rows.indexOf(row);
      var at = from;
      var startY = e.clientY;

      row.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);

      function move(ev) {
        var dy = ev.clientY - startY;
        var want = clamp(from + Math.round(dy / PITCH), 0, rows.length - 1);
        row.style.transform = 'translateY(' + dy + 'px)';
        if (want !== at) {
          rows.forEach(function (other, i) {
            if (other === row) return;
            var shift = 0;
            if (want > from && i > from && i <= want) shift = -PITCH;
            if (want < from && i < from && i >= want) shift = PITCH;
            other.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
          });
          at = want;
        }
      }
      function up() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        rows.forEach(function (x) { x.style.transform = ''; });
        row.classList.remove('dragging');
        if (at !== from) {
          ids.splice(at, 0, ids.splice(from, 1)[0]);
          applyOrder(ids);
        }
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  });
}

function applyOrder(ids) {
  var rank = {};
  ids.forEach(function (id, i) { rank[id] = i + 1; });
  S.habits.forEach(function (h) { if (rank[h.id]) h.position = rank[h.id]; });
  S.habits.sort(function (a, b) { return a.position - b.position; });
  cache();
  render();
  api('reorder', { ids: ids }).catch(function (err) {
    S.error = err.message;
    render();
  });
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-act]');
  if (!t) return;
  var act = t.dataset.act;

  if (act === 'day') {
    var n = Number(t.dataset.n);
    if (n > 0 && S.date >= today()) return;
    S.date = addDays(S.date, n);
    render();

  } else if (act === 'toggle') {
    var h = habitById(t.dataset.id);
    if (!h) return;
    queue(S.date, h.id, valueOf(S.date, h.id) == null ? 1 : null);

  } else if (act === 'num') {
    var hn = habitById(t.dataset.id);
    if (hn) openNumberSheet(hn, S.date);

  } else if (act === 'open-day') {
    S.date = t.dataset.d;
    go('/today');

  } else if (act === 'range') {
    S.range = t.dataset.v;
    if (S.range === 'month') S.anchor = monthStart(today());
    render();

  } else if (act === 'month') {
    S.anchor = addMonths(S.anchor, Number(t.dataset.n));
    render();

  } else if (act === 'type') {
    document.getElementById('f-type').value = t.dataset.v;
    document.querySelectorAll("[data-act='type']").forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.v === t.dataset.v));
    });
    document.getElementById('num-fields').style.display = t.dataset.v === 'number' ? 'flex' : 'none';

  } else if (act === 'save-habit') {
    saveHabitForm(t.dataset.id);

  } else if (act === 'archive') {
    var ha = habitById(t.dataset.id);
    if (!ha) return;
    var payload = { id: ha.id, name: ha.name, unit: ha.unit, benchmark: ha.benchmark, archived: !ha.archived };
    ha.archived = !ha.archived;
    cache();
    go('/habits');
    api('saveHabit', { habit: payload })
      .then(pull)
      .catch(function (err) { S.error = err.message; render(); });

  } else if (act === 'close-sheet') {
    if (e.target.closest('.sheet') && !e.target.closest("[data-act='close-sheet']")) return;
    closeSheet();

  } else if (act === 'sheet-save') {
    saveSheet();

  } else if (act === 'sheet-clear') {
    var ov = document.getElementById('overlay');
    var id = ov.dataset.habit, date = ov.dataset.date;
    closeSheet();
    queue(date, id, null);

  } else if (act === 'save-setup') {
    saveSetup();

  } else if (act === 'goto-setup') {
    go('/setup');

  } else if (act === 'retry') {
    sync();
  }
});

function saveHabitForm(id) {
  var name = (document.getElementById('f-name').value || '').trim();
  var msg = document.getElementById('form-msg');
  if (!name) { msg.textContent = 'Give the habit a name.'; return; }

  var type = document.getElementById('f-type').value;
  var unit = type === 'number' ? (document.getElementById('f-unit').value || '').trim() : '';
  var benchRaw = type === 'number' ? (document.getElementById('f-bench').value || '').trim() : '';
  var bench = benchRaw === '' ? null : Number(benchRaw);
  if (bench !== null && (!isFinite(bench) || bench <= 0)) {
    msg.textContent = 'A benchmark has to be a number above zero, or left empty.';
    return;
  }

  var payload = { name: name, type: type, unit: unit, benchmark: bench };
  if (id) payload.id = id;

  msg.textContent = 'Saving…';
  msg.classList.remove('danger');
  api('saveHabit', { habit: payload }).then(function () {
    return pull();
  }).then(function () {
    go('/habits');
  }).catch(function (err) {
    msg.classList.add('danger');
    msg.textContent = err.message;
  });
}

function saveSetup() {
  var endpoint = (document.getElementById('f-endpoint').value || '').trim();
  var token = (document.getElementById('f-token').value || '').trim();
  var msg = document.getElementById('setup-msg');
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(endpoint)) {
    msg.className = 'field-note danger';
    msg.textContent = 'That does not look like an Apps Script web app URL. It should end in /exec.';
    return;
  }
  if (!token) {
    msg.className = 'field-note danger';
    msg.textContent = 'Enter the token you set as the TOKEN script property.';
    return;
  }
  msg.className = 'field-note';
  msg.textContent = 'Connecting…';
  var prev = S.cfg;
  S.cfg = { endpoint: endpoint, token: token };
  api('getAll', {}).then(function () {
    save(CFG_KEY, S.cfg);
    msg.textContent = 'Connected.';
    return pull();
  }).then(function () {
    go('/today');
  }).catch(function (err) {
    S.cfg = prev;
    msg.className = 'field-note danger';
    msg.textContent = err.message;
  });
}

window.addEventListener('hashchange', render);
window.addEventListener('online', sync);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') {
    S.date = S.date > today() ? today() : S.date;
    sync();
  }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

render();
if (S.cfg) sync();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* fine without it */ });
  });
}

})();
