'use strict';

/* ============================================================================
   Habit Tracker 2026 — local-first PWA
   Architecture:
     - Single source of truth: `DB` (persisted to localStorage), `S` (view state).
     - Pure render: each tab renders its screen from state into #view.
     - Event delegation: three listeners are wired ONCE on #view (click/input/
       change) and dispatch by data-action / data-field / data-change. Renders
       never attach per-element handlers, so re-rendering stays cheap.
   ========================================================================== */

// ---------- Constants ----------
const LS_KEY = 'habit-tracker-2026-v1';
const OLD_LS_KEY = 'habitTracker2026';
const YEAR = 2026;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CAT_ORDER = ['Move', 'Health', 'Food', 'Avoidance', 'Home', 'Work & Soul'];
const HABIT_TYPES = [['check', 'Checkbox'], ['qty', 'Quantity / day'], ['time', 'Minutes / day'], ['counter', 'Counter (tiers)']];
const TIME_STEP = 15;
const DOT_CELL = 26;
const ACCENT = '#3E7A5B', GOOD = '#2E7D52', AMBER = '#B98A2E', RED = '#B4554A';
const BAR_MID = '#C9A961', BAR_LOW = '#C99B94';
const DEFAULT_TIER_LIMITS = '10,7,3,0';
const DEFAULT_TIERS = tiersFromLimits(DEFAULT_TIER_LIMITS.split(','));
const MILESTONE_THRESHOLDS = [50, 100, 200, 500, 1000, 3000];

// ---------- Date helpers ----------
function pad(n) { return String(n).padStart(2, '0'); }
function ymOf(y, m) { return y + '-' + pad(m); }
function daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function daysInYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365; }
function monthLabel(ym) { const [y, m] = ym.split('-').map(Number); return MONTH_NAMES[m - 1] + ' ' + y; }
function shiftYM(ym, delta) { let [y, m] = ym.split('-').map(Number); m += delta; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return ymOf(y, m); }
function nextYM(ym) { return shiftYM(ym, 1); }
function prevYM(ym) { return shiftYM(ym, -1); }
function dayOfYear(ym, day) { const [y, m] = ym.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, day) - Date.UTC(y, 0, 1)) / 86400000) + 1; }

// ---------- Habit / counter helpers ----------
function metVal(h, v) { return h.type === 'check' ? !!v : (v || 0) >= h.target; }
function habitActual(h) { return Object.values(h.days).filter(v => metVal(h, v)).length; }
function activeHabits(m) { return m.habits.filter(h => !h.archived); }
function activeTiers(c) { return c.tiers.filter(t => !t.archived); }
function tierMetDays(c, t) { return Object.values(c.days).filter(v => v <= t.max).length; }
function pctColor(p) { return p >= 80 ? GOOD : p >= 50 ? AMBER : RED; }
function pct(done, goal) { return goal ? Math.round((done / goal) * 100) : 0; }

function tiersFromLimits(limits, goal = 0) {
  const uniq = [...new Set(limits.map(Number).filter(n => Number.isFinite(n) && n >= 0))].sort((a, b) => b - a);
  return uniq.map(n => n === 0
    ? { id: 'zero', label: 'Zero', max: 0, goal }
    : { id: 'u' + n, label: 'Under ' + n, max: n - 1, goal });
}
function monthStats(ym) {
  const m = DB.months[ym];
  if (!m) return null;
  let done = 0, goal = 0;
  for (const h of activeHabits(m)) { done += habitActual(h); goal += h.goal; }
  for (const c of m.counters) for (const t of activeTiers(c)) { goal += t.goal; done += Math.min(tierMetDays(c, t), t.goal); }
  return { done, goal, rate: goal ? done / goal : 0 };
}

// ---------- Persistence + normalization ----------
// Coerce any historical shape (single hardcoded `counter`, missing arrays) into
// the current model: months hold `habits[]` and `counters[]`.
function normalizeDB(db) {
  db.pastSummaries = db.pastSummaries || {};
  db.months = db.months || {};
  for (const m of Object.values(db.months)) {
    if (!m.counters) m.counters = m.counter ? [{ id: 'smoke', name: 'Smoking', unit: 'cigarettes', ...m.counter }] : [];
    delete m.counter;
    for (const c of m.counters) { c.days = c.days || {}; c.tiers = c.tiers || []; }
    m.habits = m.habits || [];
  }
  return db;
}

// ---------- Migration from the pre-redesign app format ----------
const OLD_HABIT_MAP = {
  'hike': ['Hike', 'Move'], 'bike': ['Bike', 'Move'], 'walk': ['Walk', 'Move'], 'swim': ['Swim', 'Move'], 'ski': ['Ski', 'Move'],
  'soccer': ['Soccer', 'Move'], 'soccer 💪': ['Soccer', 'Move'],
  'cgc': ['CGC / Gym', 'Move'], 'cgc 🏃': ['CGC / Gym', 'Move'], 'cgc/gym': ['CGC / Gym', 'Move'],
  'workout/ activity': ['Workout / Activity', 'Move'],
  'go for a walk/run': ['Go for a Walk / Run', 'Move'], 'go for a walk/run/hike': ['Go for a Walk / Run', 'Move'],
  'eat meds morning': ['Meds — morning', 'Health'], 'eat meds evening': ['Meds — evening', 'Health'],
  'brush teeth morning': ['Brush teeth — AM', 'Health'], 'brush teeth morning 🪥': ['Brush teeth — AM', 'Health'],
  'brush teeth evening': ['Brush teeth — PM', 'Health'], 'brush teeth evening 🪥': ['Brush teeth — PM', 'Health'],
  'wake up < 8:30 am': ['Wake up before 8:30', 'Health'], 'wake up 8:30 am 🕑': ['Wake up before 8:30', 'Health'],
  'wake up < 7:00 am': ['Wake up before 7:00', 'Health'],
  'drink electrolyte': ['Drink electrolyte', 'Health'],
  'drink water- morning': ['Water — morning', 'Health'], 'drink water- evening': ['Water — evening', 'Health'],
  'drink 1 bottle of water': ['Drink 1 bottle of water', 'Health'],
  'cook food': ['Cook food', 'Food'],
  'no uber eats': ['No Uber Eats', 'Avoidance'], 'no chocolate': ['No chocolate', 'Avoidance'],
  'no sugar': ['No sugar', 'Avoidance'], 'no junk food': ['No junk food', 'Avoidance'],
  'clean room': ['Clean room', 'Home'], 'change towel': ['Change towel', 'Home'], 'change sheets': ['Change sheets', 'Home'],
  'li post': ['LinkedIn post', 'Work & Soul'], 'li post 📖': ['LinkedIn post', 'Work & Soul'],
  'offer prayers': ['Offer prayers', 'Work & Soul']
};
function mapOldHabit(name) {
  const key = name.trim().toLowerCase();
  if (OLD_HABIT_MAP[key]) return { name: OLD_HABIT_MAP[key][0], cat: OLD_HABIT_MAP[key][1], type: 'check' };
  let m = key.match(/^(\d+)\s+pushups$/); if (m) return { name: 'Pushups', cat: 'Move', type: 'qty', target: +m[1] };
  m = key.match(/^(\d+)\s+crunches$/); if (m) return { name: 'Crunches', cat: 'Move', type: 'qty', target: +m[1] };
  if (key.includes('hvn')) return { name: 'Work on HVN', cat: 'Work & Soul', type: 'time', target: 60 };
  if (key === 'fill habit tracker' || key === 'next month prefill') return null;
  return { name: name.trim(), cat: 'Work & Soul', type: 'check' };
}
function oldSmokeTier(name) {
  const n = name.trim().toLowerCase();
  const m = n.match(/^smoke\s*<\s*(\d+)/);
  if (m) return { max: +m[1] - 1, label: 'Under ' + m[1] };
  if (n.startsWith('no smoke')) return { max: 0, label: 'Zero' };
  return null;
}
function slug(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function migrateOld(old) {
  const out = { pastSummaries: {}, months: {} };
  for (const mk of Object.keys(old.months).sort()) {
    const m = old.months[mk];
    if (mk < ymOf(YEAR, 7)) { // months before the first full-detail month collapse to summaries
      out.pastSummaries[mk] = {
        done: m.habits.reduce((s, h) => s + Object.keys(h.checks).length, 0),
        goal: m.habits.reduce((s, h) => s + h.goal, 0)
      };
      continue;
    }
    const habits = [], tiers = DEFAULT_TIERS.map(t => ({ ...t })), days = {};
    for (const h of m.habits) {
      const tier = oldSmokeTier(h.name);
      if (tier) {
        let hit = tiers.find(x => x.max === tier.max);
        if (!hit) { hit = { id: 'u' + (tier.max + 1), label: tier.label, max: tier.max, goal: 0 }; tiers.push(hit); tiers.sort((a, b) => b.max - a.max); }
        hit.goal = h.goal;
        for (const dk of Object.keys(h.checks)) days[dk] = days[dk] == null ? tier.max : Math.min(days[dk], tier.max);
        continue;
      }
      const mapped = mapOldHabit(h.name);
      if (!mapped) continue;
      const hDays = {};
      for (const dk of Object.keys(h.checks)) hDays[dk] = mapped.type === 'check' ? 1 : mapped.target;
      habits.push({ id: slug(mapped.name), name: mapped.name, cat: mapped.cat, type: mapped.type, goal: h.goal, days: hDays, ...(mapped.target ? { target: mapped.target } : {}) });
    }
    Object.assign(days, m.smokeCounts || {});
    out.months[mk] = { quote: m.quote || '', notes: m.notes || '', habits, counters: [{ id: 'smoke', name: 'Smoking', unit: 'cigarettes', days, tiers }] };
  }
  return out;
}

let DB = null;
function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) {} }
function save() { saveLocal(); scheduleCloudPush(); }
async function loadDB() {
  try { DB = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {}
  if (!DB) {
    let old = null;
    try { old = JSON.parse(localStorage.getItem(OLD_LS_KEY)); } catch (e) {}
    if (old && old.months) DB = migrateOld(old);
  }
  if (!DB) DB = { pastSummaries: {}, months: {} };  // fresh install starts empty
  DB = normalizeDB(DB);
  save();
}

// ---------- View state ----------
const now = new Date();
const TODAY_YM = ymOf(now.getFullYear(), now.getMonth() + 1);
const TODAY_D = now.getDate();
function isToday(ym, day) { return ym === TODAY_YM && day === TODAY_D; }
function blankForm() { return { name: '', cat: 'Move', type: 'check', target: 10, goal: 5, unit: '', limits: DEFAULT_TIER_LIMITS }; }

const S = {
  tab: 'log',
  ym: TODAY_YM, day: TODAY_D,   // Daily Log cursor
  gridYM: null,                 // Monthly Log cursor
  planYM: null, draft: null, planMsg: '',
  form: blankForm()
};

// ---------- Rendering ----------
const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const RENDERERS = { log: renderLog, grid: renderGrid, plan: renderPlan, year: renderYear };

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function attr(obj) { return Object.entries(obj).filter(([, v]) => v != null).map(([k, v]) => `${k}="${esc(v)}"`).join(' '); }

function render(keepScroll = false) {
  for (const btn of tabbar.children) btn.classList.toggle('active', btn.dataset.tab === S.tab);
  const scroll = view.scrollTop;
  (RENDERERS[S.tab] || renderLog)();
  view.scrollTop = keepScroll ? scroll : 0;
}

// ---------- DAILY LOG ----------
function tapHabit(ym, id, day) {
  const h = DB.months[ym].habits.find(x => x.id === id);
  if (!h) return;
  const v = h.days[day];
  if (h.type === 'check') { if (v) delete h.days[day]; else h.days[day] = 1; return save(); }
  const cur = v || 0;
  if (cur >= h.target) delete h.days[day];
  else h.days[day] = Math.min(h.target, cur + (h.type === 'time' ? TIME_STEP : 1));
  save();
}

function renderLog() {
  const { ym, day } = S;
  const m = DB.months[ym];
  const [y, mm] = ym.split('-').map(Number);
  const dateLabel = new Date(y, mm - 1, day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const head = `<div class="nav-row">
      <button class="nav-btn" data-action="day-prev">‹</button>
      <div style="text-align:center;">
        <div class="nav-title">${esc(dateLabel)}</div>
        <div class="nav-sub">Day ${dayOfYear(ym, day)} of ${daysInYear(y)}</div>
      </div>
      <button class="nav-btn" data-action="day-next" style="opacity:${isToday(ym, day) ? '0.35' : '1'}">›</button>
    </div>`;

  if (!m) {
    view.innerHTML = `<div class="screen">${head}<div class="empty-wrap">
      <div class="empty-title">Nothing set up for ${esc(monthLabel(ym))} yet</div>
      <div class="empty-sub">Add your habits and monthly goals to start logging.</div>
      <button class="cta" data-action="goto-plan" style="margin-top:18px;">Set up ${esc(monthLabel(ym))} →</button>
    </div></div>`;
    return;
  }

  const active = activeHabits(m);
  const doneCount = active.filter(h => metVal(h, h.days[day])).length;

  const groups = CAT_ORDER.map(cat => {
    const chips = active.filter(h => h.cat === cat);
    if (!chips.length) return '';
    return `<div class="group"><div class="section-label">${esc(cat)}</div><div class="chips">` +
      chips.map(h => {
        const v = h.days[day];
        const label = h.type === 'qty' ? `${h.name} · ${v || 0}/${h.target}`
          : h.type === 'time' ? `${h.name} · ${v || 0}m` : h.name;
        return `<button class="chip ${metVal(h, v) ? 'done' : ''}" data-action="chip-tap" data-hid="${esc(h.id)}">
          <span>${esc(label)}</span><span class="tally">${habitActual(h)}/${h.goal}</span></button>`;
      }).join('') + `</div></div>`;
  }).join('');

  const counters = m.counters.map(c => {
    const cv = c.days[day], has = cv != null;
    const tiers = activeTiers(c).map(t => {
      const met = has && cv <= t.max;
      const tally = t.goal ? `${tierMetDays(c, t)}/${t.goal}d` : `${tierMetDays(c, t)}d`;
      return `<div class="tier-chip ${met ? 'met' : ''}">${met ? '✓' : '·'} ${esc(t.label)} <span>${tally}</span></div>`;
    }).join('');
    return `<div class="smoke-card">
      <div class="section-label">${esc(c.name)}</div>
      <div class="smoke-stepper">
        <button data-action="counter-dec" data-cid="${esc(c.id)}">−</button>
        <div class="smoke-num"><div class="n">${has ? cv : '–'}</div><div class="u">${esc(c.unit || 'times')}</div></div>
        <button data-action="counter-inc" data-cid="${esc(c.id)}">+</button>
      </div>
      <div class="tier-row">${tiers}</div>
      <div class="smoke-hint">no entry yet shows “–” · tap − to log a zero day</div>
    </div>`;
  }).join('');

  view.innerHTML = `<div class="screen">${head}
    ${m.quote ? `<div class="quote-serif">“${esc(m.quote)}”</div>` : ''}
    <div class="day-progress">
      <div class="track"><div class="fill" style="width:${pct(doneCount, active.length)}%"></div></div>
      <div class="count">${doneCount} of ${active.length}</div>
    </div>${groups}${counters}</div>`;
}

// ---------- MONTHLY LOG ----------
function monthKeysSorted() { return Object.keys(DB.months).sort(); }

function trendPoints(active, gN) {
  const counts = Array.from({ length: gN }, (_, i) => active.filter(h => metVal(h, h.days[i + 1])).length);
  const maxC = Math.max(1, ...counts);
  const span = 300 / Math.max(1, gN - 1);
  return counts.map((c, i) => `${(5 + i * span).toFixed(1)},${(55 - (c / maxC) * 46).toFixed(1)}`).join(' ');
}

function renderGrid() {
  const keys = monthKeysSorted();
  if (!keys.length) {
    view.innerHTML = `<div class="screen-grid">
      <div class="nav-row pad-x"><span></span>
        <div style="font-size:17px; font-weight:700; color:var(--ink);">Monthly Log</div><span></span></div>
      <div class="empty-wrap">
        <div class="empty-sub" style="font-size:15px;">No months set up yet.</div>
        <button class="cta" data-action="goto-plan" style="margin-top:14px;">Set up in Goals →</button>
      </div></div>`;
    return;
  }
  if (!S.gridYM || !DB.months[S.gridYM]) S.gridYM = DB.months[TODAY_YM] ? TODAY_YM : keys[keys.length - 1];
  const gym = S.gridYM, gm = DB.months[gym], gi = keys.indexOf(gym), gN = daysInMonth(gym);

  const head = `<div class="nav-row pad-x">
      <button class="nav-btn" data-action="grid-prev" style="opacity:${gi > 0 ? '1' : '0.35'}">‹</button>
      <div style="font-size:17px; font-weight:700; color:var(--ink);">${esc(monthLabel(gym))}</div>
      <button class="nav-btn" data-action="grid-next" style="opacity:${gi < keys.length - 1 ? '1' : '0.35'}">›</button>
    </div>`;

  if (!gm) {
    view.innerHTML = `<div class="screen-grid">${head}<div class="empty-wrap">
      <div class="empty-sub" style="font-size:15px;">No habits set up for ${esc(monthLabel(gym))}.</div>
      <button class="cta" data-action="goto-plan" style="margin-top:14px;">Set up in Goals →</button>
    </div></div>`;
    return;
  }

  const active = activeHabits(gm);
  const stats = monthStats(gym);
  const statPct = Math.round(stats.rate * 100);

  const dayHeads = Array.from({ length: gN }, (_, i) =>
    `<div class="day-head ${isToday(gym, i + 1) ? 'today' : ''}" style="width:${DOT_CELL}px">${i + 1}</div>`).join('');

  const rows = [];
  for (const h of active) {
    const act = habitActual(h), p = pct(act, h.goal);
    const dots = Array.from({ length: gN }, (_, i) => {
      const met = metVal(h, h.days[i + 1]), ring = isToday(gym, i + 1);
      return `<div class="dot-cell" style="width:${DOT_CELL}px" data-action="dot-tap" data-hid="${esc(h.id)}" data-day="${i + 1}">
        <div class="dot ${met ? 'met' : ring ? 'today-ring' : ''}"></div></div>`;
    }).join('');
    rows.push(`<div class="grid-row"><div class="grid-name"><div class="nm">${esc(h.name)}</div>
      <div class="sb" style="color:${pctColor(p)}">${act}/${h.goal} · ${p}%</div></div>${dots}</div>`);
  }
  for (const c of gm.counters) for (const t of activeTiers(c)) {
    const act = tierMetDays(c, t), p = pct(act, t.goal);
    const sub = t.goal ? `${act}/${t.goal} · ${p}%` : `${act} days · no goal set`;
    const dots = Array.from({ length: gN }, (_, i) => {
      const v = c.days[i + 1], met = v != null && v <= t.max;
      return `<div class="dot-cell" style="width:${DOT_CELL}px"><div class="dot ${met ? 'met' : ''}"></div></div>`;
    }).join('');
    rows.push(`<div class="grid-row"><div class="grid-name"><div class="nm">${esc(c.name + ' · ' + t.label)}</div>
      <div class="sb" style="color:${t.goal ? pctColor(p) : 'var(--faint)'}">${esc(sub)}</div></div>${dots}</div>`);
  }

  view.innerHTML = `<div class="screen-grid">${head}
    <div class="pad-x"><input class="quote-input" data-change="grid-quote" placeholder="Quote for this month…" value="${esc(gm.quote || '')}"></div>
    <div class="stat-tiles">
      <div class="stat-tile"><div class="v">${stats.done}</div><div class="l">done</div></div>
      <div class="stat-tile"><div class="v">${Math.max(0, stats.goal - stats.done)}</div><div class="l">remaining</div></div>
      <div class="stat-tile"><div class="v" style="color:${pctColor(statPct)}">${statPct}%</div><div class="l">of goal</div></div>
    </div>
    <div class="chart-card"><div class="section-label">Daily completions</div>
      <svg viewBox="0 0 310 60" style="width:100%; height:60px; display:block;">
        <polyline points="${trendPoints(active, gN)}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
      </svg></div>
    <div class="grid-scroll"><div class="grid-inner">
      <div class="grid-row grid-head"><div class="grid-name"></div>${dayHeads}</div>${rows.join('')}
    </div></div>
    <div class="pad-x"><textarea class="notes-input" data-change="grid-notes" placeholder="Notes for this month — focus areas, hardest habit, what to fix…">${esc(gm.notes || '')}</textarea></div>
  </div>`;
}

// ---------- GOALS ----------
function planMonthList() {
  const keys = monthKeysSorted();
  const set = new Set(keys);
  set.add(TODAY_YM);                                        // always allow planning the current month
  set.add(nextYM(keys.length ? keys[keys.length - 1] : TODAY_YM)); // and the month after the latest
  return [...set].sort();
}
// Resolve which month the Goals tab is editing, derived purely from state so
// both the renderer and the delegated handlers agree without shared closures.
function resolvePlan() {
  const keys = monthKeysSorted();
  const list = planMonthList();
  const latestYM = keys.length ? keys[keys.length - 1] : TODAY_YM;
  let planYM = S.planYM || latestYM;
  if (!list.includes(planYM)) planYM = latestYM;
  return { list, latestYM, planYM, pi: list.indexOf(planYM), isUnplanned: !DB.months[planYM] };
}
function ensureDraft(planYM, latestYM) {
  if (!S.draft || S.draft.forYM !== planYM) S.draft = buildDraft(planYM, latestYM !== planYM && DB.months[latestYM] ? latestYM : null);
  return S.draft;
}
function buildDraft(forYM, sourceYM) {
  const src = sourceYM ? DB.months[sourceYM] : null;
  return {
    forYM,
    rows: src ? activeHabits(src).map(h => ({ id: h.id, name: h.name, cat: h.cat, type: h.type, target: h.target, goal: h.goal, keep: true, result: `${habitActual(h)} of ${h.goal} last month` })) : [],
    counters: (src ? src.counters : []).map(c => ({
      id: c.id, name: c.name, unit: c.unit,
      tiers: c.tiers.map(t => ({ id: t.id, label: t.label, max: t.max, goal: t.goal, archived: t.archived, result: t.goal ? `${tierMetDays(c, t)} of ${t.goal} days last month` : 'no goal set yet' }))
    })),
    added: [], quote: src ? src.quote || '' : '', notes: ''
  };
}

function habitRow(r) {
  const catSelect = r.cat == null ? '' : `<select class="cat-select" data-change="habit-cat" data-id="${esc(r.id)}">${CAT_ORDER.map(c => `<option value="${esc(c)}" ${r.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  return `<div class="plan-card ${r.keep ? '' : 'dropped'}">
      <div class="info">
        <input class="nm-input" data-change="habit-name" data-id="${esc(r.id)}" value="${esc(r.name)}" ${r.keep ? '' : 'disabled'}>
        <div class="rs">${esc(r.result)}</div>
        ${r.keep ? catSelect : ''}
      </div>
      ${r.keep ? `<div class="stepper-sm">
        <button data-action="goal-dec" data-id="${esc(r.id)}">−</button>
        <div class="val">${r.goal}</div>
        <button data-action="goal-inc" data-id="${esc(r.id)}">+</button></div>` : ''}
      <button class="toggle-btn ${r.keep ? 'drop' : 'restore'}" data-action="habit-toggle" data-id="${esc(r.id)}">${r.keep ? 'Drop' : 'Restore'}</button>
    </div>`;
}
function tierSection(c) {
  return `<div class="section-label plan-section-label">${esc(c.name)} tiers</div>
    <div style="display:flex; flex-direction:column; gap:8px;">` +
    c.tiers.map(t => {
      const keep = !t.archived;
      return `<div class="plan-card ${keep ? '' : 'dropped'}">
        <div class="info"><div class="nm">${esc(t.label)}</div><div class="rs">${esc(keep ? (t.result || '') : 'not tracked')}</div></div>
        ${keep ? `<div class="stepper-sm">
          <button data-action="tier-dec" data-cid="${esc(c.id)}" data-id="${esc(t.id)}">−</button>
          <div class="val">${t.goal}</div>
          <button data-action="tier-inc" data-cid="${esc(c.id)}" data-id="${esc(t.id)}">+</button></div>
        <div class="days-lbl">days</div>` : ''}
        <button class="toggle-btn ${keep ? 'drop' : 'restore'}" data-action="tier-toggle" data-cid="${esc(c.id)}" data-id="${esc(t.id)}">${keep ? 'Drop' : 'Restore'}</button>
      </div>`;
    }).join('') + `</div>`;
}
function addForm(headline) {
  const f = S.form, counter = f.type === 'counter';
  const typeOpts = HABIT_TYPES.map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('');
  const detail = counter
    ? `<input type="text" data-field="form-unit" placeholder="Unit (e.g. cups)" value="${esc(f.unit)}">
       <div style="display:flex; gap:8px; align-items:center;">
         <input type="text" data-field="form-limits" style="width:110px;" value="${esc(f.limits)}">
         <span class="hint">tier limits — “under” each number, 0 = zero days</span></div>
       <div style="display:flex; gap:8px; align-items:center;">
         <span class="hint">goal</span>
         <input type="number" data-field="form-goal" style="width:64px;" value="${f.goal}">
         <span class="hint">days you want to hit each tier — tune per tier below</span></div>`
    : `<div style="display:flex; gap:8px; align-items:center;">
         ${f.type !== 'check' ? `<input type="number" data-field="form-target" style="width:90px;" value="${f.target}">
         <span class="hint">${f.type === 'time' ? 'min / day' : 'per day'}</span>` : ''}
         <div style="flex:1;"></div>
         <span class="hint">goal</span>
         <input type="number" data-field="form-goal" style="width:64px;" value="${f.goal}">
         <span class="hint">days</span></div>`;
  return `<div class="section-label plan-section-label">Add a habit</div>
    <div class="add-card">
      <input type="text" data-field="form-name" placeholder="${counter ? 'Counter name (e.g. Coffee)' : 'Habit name'}" value="${esc(f.name)}">
      <div style="display:flex; gap:8px;">
        ${counter ? '' : `<select data-change="form-cat" style="flex:1;">${CAT_ORDER.map(c => `<option value="${esc(c)}" ${f.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`}
        <select data-change="form-type" style="flex:1;">${typeOpts}</select>
      </div>
      ${detail}
      <button class="add-btn" data-action="add-item">+ Add to ${esc(headline)}</button>
    </div>`;
}

function renderPlan() {
  const { list, latestYM, planYM, pi, isUnplanned } = resolvePlan();
  S.planYM = planYM;

  let rows, counters, quote, notes;
  if (isUnplanned) {
    const draft = ensureDraft(planYM, latestYM);
    rows = draft.rows.concat(draft.added).map(r => ({ id: r.id, name: r.name, cat: r.cat, result: r.result || 'new habit', goal: r.goal, keep: r.keep }));
    counters = draft.counters; quote = draft.quote; notes = draft.notes;
  } else {
    const pm = DB.months[planYM];
    rows = pm.habits.map(h => ({ id: h.id, name: h.name, cat: h.cat, result: `${habitActual(h)} of ${h.goal} this month`, goal: h.goal, keep: !h.archived }));
    counters = pm.counters.map(c => ({ id: c.id, name: c.name, tiers: c.tiers.map(t => ({ id: t.id, label: t.label, goal: t.goal, archived: t.archived, result: t.goal ? `${tierMetDays(c, t)} of ${t.goal} days this month` : 'no goal set yet' })) }));
    quote = pm.quote || ''; notes = pm.notes || '';
  }

  const headline = (isUnplanned ? 'Plan ' : 'Goals — ') + monthLabel(planYM);
  const subline = isUnplanned
    ? 'New month — carried forward from ' + (latestYM !== planYM && DB.months[latestYM] ? monthLabel(latestYM) : 'scratch')
    : 'Adjust goals for a month already in progress';

  view.innerHTML = `<div class="screen">
    <div class="nav-row">
      <button class="nav-btn sm" data-action="plan-prev" style="opacity:${pi > 0 ? '1' : '0.35'}">‹</button>
      <div style="text-align:center;">
        <div style="font-size:18px; font-weight:700; color:var(--ink);">${esc(headline)}</div>
        <div style="font-size:12px; color:var(--sub); margin-top:2px;">${esc(subline)}</div>
      </div>
      <button class="nav-btn sm" data-action="plan-next" style="opacity:${pi < list.length - 1 ? '1' : '0.35'}">›</button>
    </div>
    <div class="plan-list">${rows.map(habitRow).join('')}</div>
    ${counters.map(tierSection).join('')}
    ${addForm(headline)}
    <input class="plan-quote-input" data-change="plan-quote" placeholder="Quote for this month…" value="${esc(quote)}">
    <textarea class="plan-notes-input" data-change="plan-notes" placeholder="Focus notes…">${esc(notes)}</textarea>
    ${isUnplanned
      ? `<button class="create-btn" data-action="plan-create">Create ${esc(monthLabel(planYM))} →</button>`
      : `<div class="autosave-hint">Changes to ${esc(monthLabel(planYM))} save automatically</div>`}
    ${S.planMsg ? `<div class="plan-msg">${esc(S.planMsg)}</div>` : ''}
  </div>`;
}

// ---------- JOURNEY ----------
function renderYear() {
  const yearRows = [];
  let totalDone = 0, totalGoal = 0, best = { name: '—', rate: 0 };
  for (let i = 1; i <= 12; i++) {
    const k = ymOf(YEAR, i);
    if (k > TODAY_YM) continue;
    const src = DB.months[k] ? monthStats(k) : DB.pastSummaries[k];
    if (!src) continue;
    const rate = src.goal ? src.done / src.goal : 0;
    totalDone += src.done; totalGoal += src.goal;
    if (rate > best.rate && src.done > 0) best = { name: MONTH_NAMES[i - 1], rate };
    const p = Math.round(rate * 100);
    yearRows.push({ name: MONTH_NAMES[i - 1].slice(0, 3), doneGoal: `${src.done}/${src.goal}`, rate: p + '%', rateColor: pctColor(p), barW: Math.min(100, p), barColor: p >= 80 ? ACCENT : p >= 50 ? BAR_MID : BAR_LOW });
  }
  const doyToday = dayOfYear(TODAY_YM, TODAY_D);
  const overall = totalGoal ? Math.round((totalDone / totalGoal) * 100) : 0;
  const milestones = MILESTONE_THRESHOLDS.map(n => ({ label: `🏆 ${n} habits completed`, ok: totalDone >= n }));
  milestones.push({ label: '🌟 80% overall rate', ok: totalGoal > 0 && totalDone / totalGoal >= 0.8 });
  milestones.push({ label: '💯 Perfect month (100%)', ok: best.rate >= 1 });

  const body = yearRows.length ? `
    <div class="metric-grid">
      <div class="metric-card"><div class="v">${totalDone}</div><div class="l">habits completed</div></div>
      <div class="metric-card"><div class="v">${totalGoal ? overall + '%' : '—'}</div><div class="l">overall rate</div></div>
      <div class="metric-card"><div class="v sm">${esc(best.name)}${best.rate ? ' · ' + Math.round(best.rate * 100) + '%' : ''}</div><div class="l">best month</div></div>
      <div class="metric-card"><div class="v">${doyToday ? (totalDone / doyToday).toFixed(1) : '0.0'}</div><div class="l">avg tasks / day</div></div>
    </div>
    <div class="section-label plan-section-label">Months</div>
    <div class="list-card">${yearRows.map(y => `<div class="month-row">
        <div class="mn">${esc(y.name)}</div>
        <div class="bar"><i style="width:${y.barW}%; background:${y.barColor};"></i></div>
        <div class="dg">${esc(y.doneGoal)}</div>
        <div class="rt" style="color:${y.rateColor}">${esc(y.rate)}</div>
      </div>`).join('')}</div>
    <div class="section-label plan-section-label">Milestones</div>
    <div class="list-card">${milestones.map(x => `<div class="mile-row">
        <div class="lb">${x.label}</div>
        <div class="st" style="color:${x.ok ? GOOD : 'var(--sub)'}">${x.ok ? '✓ Achieved' : 'In progress'}</div>
      </div>`).join('')}</div>`
    : `<div style="text-align:center; padding:50px 10px;">
        <div class="empty-sub" style="font-size:15px;">Your journey starts once you log your first habit. Milestones and month-over-month stats will build up here.</div>
      </div>`;

  view.innerHTML = `<div class="screen">
    <div style="font-size:20px; font-weight:700; color:var(--ink);">${YEAR}</div>
    <div style="font-size:13px; color:var(--sub); margin-top:2px;">Day ${doyToday} of ${daysInYear(YEAR)}</div>
    <div class="account-card" id="account"></div>
    ${body}
    <div class="backup-row">
      <button data-action="backup">Back up data</button>
      <button data-action="restore">Restore</button>
      <input type="file" accept="application/json" data-role="restore-input" data-change="restore-file" style="display:none;">
    </div>
    <div class="danger-row">
      <button data-action="delete-all" class="danger-btn">Delete all data</button>
    </div>
  </div>`;
  updateAccountUI();
}

// ---------- Actions (delegated) ----------
// Edit a habit in whichever month the Goals tab is on — the draft (unplanned)
// or the saved month. `apply` mutates the habit; changes to a saved month persist.
function editPlanHabit(id, apply) {
  const { planYM, isUnplanned } = resolvePlan();
  const habit = isUnplanned
    ? S.draft.rows.concat(S.draft.added).find(x => x.id === id)
    : DB.months[planYM].habits.find(x => x.id === id);
  if (!habit) return;
  apply(habit);
  if (!isUnplanned) save();
}
function bumpGoal(id, delta) { editPlanHabit(id, h => { h.goal = Math.max(1, h.goal + delta); }); }
function toggleHabit(id) {
  const { planYM, isUnplanned } = resolvePlan();
  if (isUnplanned) {
    const r = S.draft.rows.concat(S.draft.added).find(x => x.id === id);
    if (r) r.keep = !r.keep;
  } else {
    const h = DB.months[planYM].habits.find(x => x.id === id);
    if (h) { h.archived = !h.archived; save(); }
  }
}
// Mirrors editPlanHabit but for a tier nested inside a counter.
function editPlanTier(cid, id, apply) {
  const { planYM, isUnplanned } = resolvePlan();
  const list = isUnplanned ? S.draft.counters : DB.months[planYM].counters;
  const tier = list.find(c => c.id === cid)?.tiers.find(x => x.id === id);
  if (!tier) return;
  apply(tier);
  if (!isUnplanned) save();
}
function bumpTier(cid, id, delta) { editPlanTier(cid, id, t => { t.goal = Math.max(0, t.goal + delta); }); }
function toggleTier(cid, id) { editPlanTier(cid, id, t => { t.archived = !t.archived; }); }
function addItem() {
  const f = S.form;
  if (!f.name.trim()) return;
  const { planYM, isUnplanned } = resolvePlan();
  if (f.type === 'counter') {
    const tiers = tiersFromLimits(f.limits.split(/[,\s]+/), Math.max(0, f.goal));
    if (!tiers.length) return;
    const counter = { id: 'c' + Date.now(), name: f.name.trim(), unit: f.unit.trim() || 'times', tiers };
    if (isUnplanned) S.draft.counters.push({ ...counter, tiers: tiers.map(t => ({ ...t, result: 'new counter' })) });
    else { DB.months[planYM].counters.push({ ...counter, days: {} }); save(); }
  } else {
    const habit = { id: 'h' + Date.now(), name: f.name.trim(), cat: f.cat, type: f.type, goal: f.goal, ...(f.type !== 'check' ? { target: f.target } : {}) };
    if (isUnplanned) S.draft.added.push({ ...habit, keep: true, result: 'new habit' });
    else { DB.months[planYM].habits.push({ ...habit, days: {} }); save(); }
  }
  S.form = blankForm();
}
function createPlan() {
  const draft = S.draft;
  if (!draft) return;
  DB.months[draft.forYM] = {
    quote: draft.quote || '', notes: draft.notes || '',
    habits: draft.rows.concat(draft.added).filter(r => r.keep).map(r => ({ id: r.id, name: r.name, cat: r.cat, type: r.type || 'check', goal: r.goal, days: {}, ...(r.target ? { target: r.target } : {}) })),
    counters: draft.counters.map(c => ({ id: c.id, name: c.name, unit: c.unit, days: {}, tiers: c.tiers.map(t => ({ id: t.id, label: t.label, max: t.max, goal: t.goal, ...(t.archived ? { archived: true } : {}) })) }))
  };
  save();
  S.planMsg = monthLabel(draft.forYM) + ' created ✓ — it now appears in Daily Log and Monthly Log';
  S.draft = null;
}
async function backup() {
  const json = JSON.stringify(DB, null, 2);
  const filename = `habit-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  // On iOS the file download anchor is unreliable inside a home-screen app, and
  // localStorage is wiped when the app is cleared. Prefer the native share sheet
  // so the backup can be saved to Files / iCloud Drive, where it persists.
  try {
    const file = new File([json], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Habit Tracker backup' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user dismissed the share sheet
  }
  const a = document.createElement('a'); // desktop fallback
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = filename;
  a.click();
}
function restoreFrom(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (parsed && parsed.months) { DB = normalizeDB(parsed); save(); S.draft = null; render(); }
    } catch (e) {}
  };
  reader.readAsText(file);
}
// Two-step confirmation (details, then type-to-confirm) — this destroys real
// history with no undo, so it should be much harder to trigger than a mis-tap.
async function deleteAllData() {
  const monthCount = Object.keys(DB.months).length;
  const totalChecks = Object.values(DB.months).reduce((sum, m) => {
    const habitDays = m.habits.reduce((a, h) => a + Object.keys(h.days).length, 0);
    const counterDays = m.counters.reduce((a, c) => a + Object.keys(c.days).length, 0);
    return sum + habitDays + counterDays;
  }, 0);
  if (!monthCount) { alert('There is no data to delete.'); return; }
  const cloudNote = AUTH.user ? ' This also erases your cloud copy — it cannot be recovered from another device afterward.' : '';
  const ok = confirm(
    `Delete ALL habit data?\n\n` +
    `This permanently removes ${monthCount} month${monthCount === 1 ? '' : 's'} of history ` +
    `(${totalChecks} logged day${totalChecks === 1 ? '' : 's'} across every habit and counter), ` +
    `every goal, quote, and note.${cloudNote}\n\n` +
    `This cannot be undone. Use "Back up data" first if you're not sure.`
  );
  if (!ok) return;
  const typed = prompt('Type DELETE to confirm permanent deletion:');
  if (typed !== 'DELETE') { alert('Deletion cancelled — text did not match.'); return; }

  DB = { pastSummaries: {}, months: {} };
  saveLocal();
  S.ym = TODAY_YM; S.day = TODAY_D;
  S.gridYM = null; S.planYM = null; S.draft = null; S.planMsg = '';
  S.form = blankForm();
  if (AUTH.token) await cloudPush();
  render();
}

// Click actions. `keep` = re-render preserving scroll position (in-place edits);
// omitted = re-render from the top (navigation between contexts).
const CLICKS = {
  'day-prev': { keep: false, run: () => { if (S.day > 1) S.day--; else { const p = prevYM(S.ym); if (DB.months[p]) { S.ym = p; S.day = daysInMonth(p); } } } },
  'day-next': { keep: false, run: () => { if (isToday(S.ym, S.day)) return; if (S.day < daysInMonth(S.ym)) S.day++; else { const n = nextYM(S.ym); if (DB.months[n]) { S.ym = n; S.day = 1; } } } },
  'chip-tap': { keep: true, run: el => tapHabit(S.ym, el.dataset.hid, S.day) },
  'counter-inc': { keep: true, run: el => { const c = DB.months[S.ym].counters.find(x => x.id === el.dataset.cid); if (c) { c.days[S.day] = (c.days[S.day] ?? 0) + 1; save(); } } },
  'counter-dec': { keep: true, run: el => { const c = DB.months[S.ym].counters.find(x => x.id === el.dataset.cid); if (c) { c.days[S.day] = Math.max(0, (c.days[S.day] ?? 1) - 1); save(); } } },
  'grid-prev': { keep: false, run: () => { const k = monthKeysSorted(), i = k.indexOf(S.gridYM); if (i > 0) S.gridYM = k[i - 1]; } },
  'grid-next': { keep: false, run: () => { const k = monthKeysSorted(), i = k.indexOf(S.gridYM); if (i < k.length - 1) S.gridYM = k[i + 1]; } },
  'dot-tap': { keep: true, run: el => tapHabit(S.gridYM, el.dataset.hid, Number(el.dataset.day)) },
  'plan-prev': { keep: false, run: () => { const { list, pi } = resolvePlan(); if (pi > 0) { S.planYM = list[pi - 1]; S.draft = null; S.planMsg = ''; } } },
  'plan-next': { keep: false, run: () => { const { list, pi } = resolvePlan(); if (pi < list.length - 1) { S.planYM = list[pi + 1]; S.draft = null; S.planMsg = ''; } } },
  'goal-inc': { keep: true, run: el => bumpGoal(el.dataset.id, 1) },
  'goal-dec': { keep: true, run: el => bumpGoal(el.dataset.id, -1) },
  'habit-toggle': { keep: true, run: el => toggleHabit(el.dataset.id) },
  'tier-inc': { keep: true, run: el => bumpTier(el.dataset.cid, el.dataset.id, 1) },
  'tier-dec': { keep: true, run: el => bumpTier(el.dataset.cid, el.dataset.id, -1) },
  'tier-toggle': { keep: true, run: el => toggleTier(el.dataset.cid, el.dataset.id) },
  'add-item': { keep: true, run: addItem },
  'plan-create': { keep: false, run: createPlan },
  'goto-plan': { keep: false, run: () => { S.tab = 'plan'; } },
  'backup': { keep: true, run: backup, skipRender: true },
  'restore': { keep: true, run: () => view.querySelector('[data-role="restore-input"]').click(), skipRender: true },
  'delete-all': { keep: true, run: deleteAllData, skipRender: true },
  'sync-now': { keep: true, run: () => cloudPush(), skipRender: true },
  'signout': { keep: false, run: signOutAndClearLocal, skipRender: true }
};

// Live field edits (text/number in the add form) — keep S.form current so the
// Add button never has to read the DOM.
const FIELDS = {
  'form-name': v => { S.form.name = v; },
  'form-unit': v => { S.form.unit = v; },
  'form-limits': v => { S.form.limits = v; },
  'form-target': v => { S.form.target = Math.max(1, Number(v) || 1); },
  'form-goal': v => { S.form.goal = Math.max(1, Number(v) || 1); }
};

// Commit-on-change edits (selects, blurred inputs, file picker).
const CHANGES = {
  'form-cat': v => { S.form.cat = v; },
  'form-type': (v, el, done) => { S.form.type = v; done.render = true; },
  'habit-cat': (v, el) => editPlanHabit(el.dataset.id, h => { h.cat = v; }),
  'habit-name': (v, el) => { const n = v.trim(); if (n) editPlanHabit(el.dataset.id, h => { h.name = n; }); },
  'grid-quote': v => { DB.months[S.gridYM].quote = v; save(); },
  'grid-notes': v => { DB.months[S.gridYM].notes = v; save(); },
  'plan-quote': v => { const { planYM, isUnplanned } = resolvePlan(); if (isUnplanned) S.draft.quote = v; else { DB.months[planYM].quote = v; save(); } },
  'plan-notes': v => { const { planYM, isUnplanned } = resolvePlan(); if (isUnplanned) S.draft.notes = v; else { DB.months[planYM].notes = v; save(); } },
  'restore-file': (v, el) => { if (el.files && el.files[0]) restoreFrom(el.files[0]); }
};

// ---------- Wiring (once) ----------
tabbar.addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  S.tab = btn.dataset.tab;
  S.planMsg = '';
  render();
});
view.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = CLICKS[el.dataset.action];
  if (!action) return;
  action.run(el, e);
  if (!action.skipRender) render(action.keep);
});
view.addEventListener('input', e => {
  const el = e.target.closest('[data-field]');
  if (el && FIELDS[el.dataset.field]) FIELDS[el.dataset.field](el.value, el);
});
view.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el || !CHANGES[el.dataset.change]) return;
  const done = { render: false };
  CHANGES[el.dataset.change](el.value, el, done);
  if (done.render) render(true);
});

// ---------- Cloud sync: Google Sign-In + Netlify DB ----------
// The app works fully offline from localStorage. When a user signs in with
// Google, their state is loaded from / saved to Netlify DB (one row per Google
// account), so it persists and follows them across devices. Last write wins.
const CLIENT_ID = window.GOOGLE_CLIENT_ID || '';
const AUTH_KEY = 'habit-tracker-auth-v1';
const AUTH = { token: null, user: null, sync: 'idle', syncError: '' };
let cloudPushTimer = null;
let tokenRefreshTimer = null;
let authExpiredFallbackTimer = null;
// Google ID tokens expire hourly. `nextCredentialMode` tells the single GIS
// callback what to do with the credential it's about to receive: 'pull' loads
// the account's cloud data (genuine sign-in), 'refresh' just renews the token
// so the next save can go through — it must never touch local data, or a
// background token renewal would silently discard whatever the user just typed.
let nextCredentialMode = 'pull';
const TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000; // well under the ~60min token lifetime

function decodeJwt(t) {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return null; }
}
// The session must survive page refreshes: keep the token + user in
// localStorage and restore them on boot. Without this, every reload threw the
// in-memory session away and gambled on Google One Tap silently re-signing in,
// which browsers frequently suppress (cooldowns, Safari/ITP) — showing the
// user a spurious "signed out" screen.
function persistAuth() {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify({ token: AUTH.token, user: AUTH.user })); } catch (e) {}
}
function clearPersistedAuth() {
  try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
}
function tokenValid(token) {
  const p = token && decodeJwt(token);
  return !!(p && p.exp && p.exp * 1000 > Date.now() + 60000); // 60s safety margin
}
function restoreSession() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) {}
  if (!stored || !stored.user) return;
  AUTH.user = stored.user;
  if (tokenValid(stored.token)) {
    AUTH.token = stored.token;
    AUTH.sync = 'synced';
    startTokenRefreshTimer();
    cloudPull(); // refresh from cloud in the background (e.g. edits from another device)
  } else {
    // Token expired while the app was closed: show "Reconnecting…" and wait —
    // initGoogle() will silently request a fresh token once the Google script
    // is up (mode 'pull', so the fresh sign-in loads the cloud copy rather
    // than pushing possibly-stale local data). Never touches local data.
    AUTH.sync = 'error';
    AUTH.syncError = 'Reconnecting…';
    nextCredentialMode = 'pull';
  }
}
// If a reconnect attempt goes unanswered (no Google session, dismissed prompt),
// drop to the signed-out card after a grace period — without clearing data.
function armAuthFallback() {
  const staleUser = AUTH.user;
  clearTimeout(authExpiredFallbackTimer);
  authExpiredFallbackTimer = setTimeout(() => {
    if (AUTH.user === staleUser && !AUTH.token) {
      AUTH.user = null;
      stopTokenRefreshTimer();
      clearPersistedAuth();
      setSync('idle');
    }
  }, 8000);
}
function setSync(state, err) {
  AUTH.sync = state;
  AUTH.syncError = err || '';
  updateAccountUI();
}
function scheduleCloudPush() {
  if (!AUTH.token) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(cloudPush, 800);
}
async function cloudPush() {
  if (!AUTH.token) return;
  setSync('saving');
  try {
    const r = await fetch('/api/state', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + AUTH.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(DB)
    });
    if (r.status === 401) return handleAuthExpired();
    if (!r.ok) { setSync('error', 'HTTP ' + r.status + ' ' + (await r.text()).slice(0, 140)); return; }
    setSync('synced');
  } catch (e) { setSync('error', 'offline'); }
}
async function cloudPull() {
  if (!AUTH.token) return;
  setSync('saving');
  try {
    const r = await fetch('/api/state', { headers: { Authorization: 'Bearer ' + AUTH.token } });
    if (r.status === 401) return handleAuthExpired();
    if (!r.ok) { setSync('error', 'HTTP ' + r.status + ' ' + (await r.text()).slice(0, 140)); return; }
    const cloud = await r.json();
    if (cloud && cloud.months) { DB = normalizeDB(cloud); saveLocal(); setSync('synced'); }
    else { await cloudPush(); }  // first sign-in on this account — seed the cloud from local data
  } catch (e) { setSync('error', 'offline'); }
}
async function onGoogleCredential(resp) {
  const payload = decodeJwt(resp.credential);
  if (!payload) return;
  const mode = nextCredentialMode;
  nextCredentialMode = 'pull'; // default back for the next unrelated sign-in
  clearTimeout(authExpiredFallbackTimer);
  AUTH.token = resp.credential;
  AUTH.user = { email: payload.email, name: payload.name };
  persistAuth();
  startTokenRefreshTimer();
  if (mode === 'pull') {
    await cloudPull();
  } else {
    // Background token renewal — data is untouched; just let any save that
    // was waiting on a valid token go through now.
    setSync('synced');
    scheduleCloudPush();
  }
  render();
}
// Ask Google for a fresh ID token without any visible re-sign-in step, as long
// as the browser still has an active Google session for this user.
function refreshTokenSilently(mode) {
  if (!(window.google && window.google.accounts && window.google.accounts.id) || !CLIENT_ID) return false;
  nextCredentialMode = mode;
  google.accounts.id.prompt();
  return true;
}
function startTokenRefreshTimer() {
  clearInterval(tokenRefreshTimer);
  tokenRefreshTimer = setInterval(() => refreshTokenSilently('refresh'), TOKEN_REFRESH_INTERVAL_MS);
}
function stopTokenRefreshTimer() {
  clearInterval(tokenRefreshTimer);
  tokenRefreshTimer = null;
}
// A 401 means the token expired mid-session — NOT that the user asked to sign
// out. Local data must survive this untouched: try a silent refresh and retry
// the sync; only fall back to showing "signed out" if that truly fails, and
// even then nothing local is cleared (that only happens on the explicit
// Sign Out button, see signOutAndClearLocal).
function handleAuthExpired(mode = 'refresh') {
  const staleUser = AUTH.user;
  setSync('error', 'Session expired — reconnecting…');
  const attempted = refreshTokenSilently(mode);
  clearTimeout(authExpiredFallbackTimer);
  authExpiredFallbackTimer = setTimeout(() => {
    if (AUTH.user === staleUser && AUTH.sync === 'error') {
      AUTH.token = null; AUTH.user = null;
      stopTokenRefreshTimer();
      clearPersistedAuth();
      setSync('idle');
    }
  }, attempted ? 8000 : 0);
}
// The explicit "Sign out" button: flush any pending edits to the cloud first
// (so nothing typed just before signing out is lost), then clear local data —
// this device is about to be handed to (or was shared with) someone else.
async function signOutAndClearLocal() {
  if (AUTH.token) { clearTimeout(cloudPushTimer); await cloudPush(); }
  AUTH.token = null;
  AUTH.user = null;
  AUTH.sync = 'idle';
  AUTH.syncError = '';
  clearPersistedAuth();
  stopTokenRefreshTimer();
  if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect();
  DB = { pastSummaries: {}, months: {} };
  saveLocal();
  S.ym = TODAY_YM; S.day = TODAY_D;
  S.gridYM = null; S.planYM = null; S.draft = null; S.planMsg = '';
  S.form = blankForm();
  render();
}
function initGoogle() {
  if (!(window.google && window.google.accounts && window.google.accounts.id) || !CLIENT_ID) return;
  google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onGoogleCredential, auto_select: true });
  // Only nudge Google when we actually need a token: a restored session that
  // expired while the app was closed. A valid restored session needs nothing,
  // and a signed-out user gets the explicit button instead of a popup.
  if (AUTH.user && !AUTH.token) {
    google.accounts.id.prompt();
    armAuthFallback();
  }
  updateAccountUI();
}
window.__gisOnLoad = initGoogle;

function updateAccountUI() {
  const el = document.getElementById('account');
  if (!el) return;
  if (AUTH.user) {
    const status = AUTH.sync === 'saving' ? 'Saving…'
      : AUTH.sync === 'error' ? 'Sync error: ' + AUTH.syncError
      : AUTH.sync === 'synced' ? 'Synced to cloud ✓'
      : 'Signed in';
    const color = AUTH.sync === 'error' ? 'var(--red)' : 'var(--faint)';
    el.innerHTML = `<div class="acct">
      <div style="min-width:0;"><div class="acct-name">${esc(AUTH.user.name || AUTH.user.email)}</div>
        <div class="acct-sub" style="color:${color}; word-break:break-word;">${esc(status)}</div></div>
      <div style="display:flex; gap:6px; flex:none;">
        <button class="acct-btn" data-action="sync-now">Sync now</button>
        <button class="acct-btn" data-action="signout">Sign out</button>
      </div></div>`;
  } else {
    el.innerHTML = `<div class="acct-out">
      <div class="acct-sub">Sign in with Google to save your data and sync across devices.</div>
      <div id="gbtn"></div></div>`;
    if (window.google && window.google.accounts && CLIENT_ID) {
      google.accounts.id.renderButton(document.getElementById('gbtn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
    }
  }
}

// ---------- Boot ----------
loadDB().then(() => {
  if (!DB.months[S.ym]) {
    const keys = monthKeysSorted();
    if (keys.length) { S.ym = keys[keys.length - 1]; S.day = daysInMonth(S.ym); }
  }
  restoreSession();  // stay signed in across refreshes
  render();
  initGoogle();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
