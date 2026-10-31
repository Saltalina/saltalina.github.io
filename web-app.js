/* web-app.js — GitHub Pages / local-file build of the Union Raid Mock Planner.
   Cuts vs the Electron app: no confirmed-hits API, no auto-assign, no combat log.
   Adds: schedule↔sheet name linking, sheet auto-update, card-style parse log.
   All persistence via localStorage; no external JSON files required. */
'use strict';

const { LEVELS, BOSS_HP_MATRIX, playerKey,
        emptyAssignments, playerUsage, hitState, optimalKillIds } = Logic;

// ---------- state ----------
const state = {
  tables: [],
  detectedTables: [],
  lastSheetData: null,
  hits: [],
  assignments: emptyAssignments(),
  activeBoss: '',
  activeLvl: 'Lvl 1',
  sortMode: 'none',
  search: '',
  schedule: {},        // member(lower) -> { availability, comment }
  links: {},           // schedule member(lower) -> sheet player name
  sheetTimer: null,
};

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const fmt = (n) => Number(n).toLocaleString('en-US');
const LS = {
  get(k, d) { try { const v = localStorage.getItem('mockplan.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mockplan.' + k, JSON.stringify(v)); } catch {} },
};

let toastTimer = null;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- card-style parse log ----------
const LOG_ICONS = {
  info: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v.5M12 11v5"/></svg>',
  ok: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>',
  err: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v7M12 17.5v.5"/><circle cx="12" cy="12" r="9"/></svg>',
  add: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};
function log(msg, cls = '') {
  const el = $('#log');
  const line = document.createElement('div');
  line.className = 'log-card ' + (cls || 'log-add');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.innerHTML = `<span class="log-ic">${LOG_ICONS[cls === 'log-err' ? 'err' : cls === 'log-ok' ? 'ok' : cls === 'log-info' ? 'info' : 'add']}</span><span class="log-msg"></span><span class="log-time">${time}</span>`;
  line.querySelector('.log-msg').textContent = msg;
  el.appendChild(line);
  while (el.children.length > 200) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// ---------- icons ----------
const imgCache = new Map();
function iconEl(name) {
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  const url = (window.NAME_TO_SQUARE || {})[String(name).toLowerCase().trim()];
  const paint = (src) => {
    wrap.innerHTML = '';
    if (src) {
      const img = document.createElement('img');
      img.className = 'nikke-icon';
      img.src = src;
      img.title = name;
      img.draggable = false;
      wrap.appendChild(img);
    } else {
      const fb = document.createElement('span');
      fb.className = 'nikke-icon-fallback';
      fb.textContent = name[0] || '?';
      fb.title = name;
      wrap.appendChild(fb);
    }
  };
  if (!url) { paint(null); return wrap; }
  paint(url); // browser caches; html2canvas uses CORS (CDN sends ACAO *)
  return wrap;
}

// ---------- hit model ----------
function makeHit(boss, data) {
  const chars = [];
  for (let i = 1; i <= 5; i++) { const c = (data[`Char ${i}`] || '').trim(); if (c) chars.push(c); }
  const player = (data.Name || 'Unknown').trim();
  const dmg = parseInt(String(data.Dmg || '0').replace(/[, ]/g, ''), 10) || 0;
  const ticked = (v) => /^(true|x|✓|yes|1)$/i.test(String(v || '').trim());
  const ticks = [ticked(data.Lv1), ticked(data.Lv2), ticked(data.Lv3)];
  const id = `${boss}::${player}::${dmg}::${chars.join('|')}`;
  return { id, boss, player, chars, dmg, ticks, data };
}

// ---------- schedule + linking ----------
async function fetchSchedule() {
  const url = $('#inp-sched').value.trim();
  if (!url) return;
  try {
    const rows = SheetParser.parseCsvRows(await fetchCsvText(url));
    state.schedule = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      const member = (r[0] || '').trim();
      if (!member || /^\d+$/.test(member)) continue; // skip blank/numbered grid rows
      state.schedule[member.toLowerCase()] = { member, availability: (r[1] || '').trim(), comment: (r[2] || '').trim() };
    }
    log(`Schedule loaded: ${Object.keys(state.schedule).length} members.`, 'log-ok');
    renderLinks();
    renderCenter();
  } catch (e) {
    log('Schedule: ' + e.message, 'log-err');
  }
}

function sheetPlayers() {
  return [...new Set(state.hits.map((h) => h.player))];
}

// schedule members whose name doesn't match any sheet player (case-insensitive)
function unmatchedScheduleMembers() {
  const sheetKeys = new Set(sheetPlayers().map(playerKey));
  return Object.values(state.schedule).filter((s) => {
    const linked = state.links[s.member.toLowerCase()];
    if (linked) return false; // linked counts as matched
    return !sheetKeys.has(playerKey(s.member));
  });
}

function renderLinks() {
  const wrap = $('#link-list');
  const empty = $('#link-empty');
  wrap.innerHTML = '';
  const unmatched = unmatchedScheduleMembers();
  // show unmatched members + any existing links
  const linked = Object.entries(state.links);
  empty.style.display = unmatched.length || linked.length ? 'none' : '';
  for (const s of unmatched) {
    wrap.appendChild(linkRow(s.member, null));
  }
  for (const [memLower, sheetName] of linked) {
    const s = state.schedule[memLower];
    if (!s) { delete state.links[memLower]; continue; }
    if (!unmatched.some((u) => u.member.toLowerCase() === memLower)) wrap.appendChild(linkRow(s.member, sheetName));
  }
}

function linkRow(member, currentSheetName) {
  const row = document.createElement('div');
  row.className = 'link-row';
  const label = document.createElement('span');
  label.className = 'link-name';
  label.textContent = member;
  label.title = 'Schedule name — link it to a sheet commander';
  row.appendChild(label);
  const arrow = document.createElement('span');
  arrow.className = 'link-arrow';
  arrow.textContent = '→';
  row.appendChild(arrow);
  const sel = document.createElement('select');
  sel.className = 'assign-select link-select';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Not linked';
  sel.appendChild(none);
  const players = sheetPlayers();
  if (currentSheetName && !players.includes(currentSheetName)) players.push(currentSheetName);
  for (const p of players) {
    const op = document.createElement('option');
    op.value = p;
    op.textContent = p;
    if (p === currentSheetName) op.selected = true;
    sel.appendChild(op);
  }
  sel.onchange = () => {
    if (sel.value) {
      state.links[member.toLowerCase()] = sel.value;
      log(`Linked schedule "${member}" → sheet "${sel.value}"`, 'log-ok');
    } else {
      delete state.links[member.toLowerCase()];
      log(`Unlinked schedule "${member}"`, 'log-info');
    }
    LS.set('links', state.links);
    renderLinks();
    renderCenter();
  };
  row.appendChild(sel);
  return row;
}

// resolve a hit's player to its schedule entry (direct or via link)
function scheduleFor(player) {
  const k = playerKey(player);
  if (state.schedule[k]) return state.schedule[k];
  const linked = Object.entries(state.links).find(([, sheetName]) => playerKey(sheetName) === k);
  return linked ? state.schedule[linked[0]] : null;
}

function schedTagEl(player) {
  const s = scheduleFor(player);
  if (!s || !s.availability) return null;
  const tag = document.createElement('span');
  const allDay = s.availability.toLowerCase().includes('all day');
  tag.className = 'sched-tag ' + (allDay ? 'allday' : 'specific');
  tag.textContent = allDay ? 'ALL DAY' : 'TIME';
  tag.title = [s.availability, s.comment].filter(Boolean).join(' — ');
  return tag;
}

// ---------- CSV fetch (CORS) ----------
async function fetchCsvText(url) {
  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error('Invalid Google Sheets link.');
  const gidM = url.match(/[#&]gid=([0-9]+)/);
  const gid = gidM ? gidM[1] : '0';
  const exportUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
  let res;
  try { res = await fetch(exportUrl); }
  catch (e) {
    if (location.protocol === 'file:')
      throw new Error('Browsers block sheet fetches from file:// pages. Use "Paste CSV manually…" below, or serve the folder (python -m http.server) / deploy to GitHub Pages.');
    throw new Error('Fetch blocked (network/CORS). Make sure the sheet is "Anyone with the link can view".');
  }
  if (!res.ok) throw new Error(`Sheet returned HTTP ${res.status}. Sharing must be "Anyone with the link can view".`);
  return res.text();
}

// ---------- sheet loading ----------
async function fetchData(auto = false) {
  const driveUrl = $('#inp-drive').value.trim();
  LS.set('driveUrl', driveUrl);
  LS.set('hookUrl', $('#inp-hook').value.trim());
  LS.set('schedUrl', $('#inp-sched').value.trim());
  if (!driveUrl) { if (!auto) toast('Please provide a Google Sheets URL', 'err'); return; }

  const btn = $('#btn-load');
  btn.disabled = true;
  if (!auto) log('Fetching data…', 'log-info');
  if ($('#inp-sched').value.trim()) fetchSchedule();
  try {
    const { tables, data } = await fetchSheet(driveUrl);
    state.detectedTables = tables;
    state.lastSheetData = data;
    if (auto) log(`Auto-update: sheet re-fetched (${Object.values(data).reduce((s, r) => s + r.length, 0)} rows).`, 'log-info');

    const configured = state.tables.filter((t) => t in data);
    if (configured.length === 5) {
      if (!auto) log('Using configured boss tables.', 'log-info');
      processData(data);
    } else {
      if (!auto) {
        log('Saved tables do not match this sheet. Confirm the 5 boss tables…', 'log-err');
        toast('Confirm the 5 boss tables', 'err');
        processData(data);
        openTablesModal({ prefill: tables.length === 5 ? tables : null });
      } else {
        log('Auto-update skipped: boss tables not configured yet.', 'log-err');
      }
    }
    renderLinks();
  } catch (e) {
    log('Error: ' + e.message, 'log-err');
    if (!auto) toast('Fetch failed', 'err');
  } finally {
    btn.disabled = false;
  }
}

async function fetchSheet(url) {
  return SheetParser.parseSheetCsv(await fetchCsvText(url));
}

function processData(data, opts = {}) {
  const activeData = {};
  for (const t of state.tables) activeData[t] = data[t] || [];

  let newCount = 0;
  const seen = new Set();
  const hits = [];
  for (const [boss, rows] of Object.entries(activeData)) {
    for (const r of rows) {
      const h = makeHit(boss, r);
      seen.add(h.id);
      hits.push(h);
    }
  }
  if (!opts.keepLog) {
    for (const h of hits) {
      if (!state.knownHashes) state.knownHashes = new Set();
      if (!state.knownHashes.has(h.id)) {
        state.knownHashes.add(h.id);
        newCount++;
        log(`${h.boss} · ${h.player} · ${fmt(h.dmg)}`);
      }
    }
  }
  state.hits = hits;

  for (const l of LEVELS) for (const t of state.tables) {
    state.assignments[l][t] = (state.assignments[l][t] || []).filter((h) => seen.has(h.id));
  }
  if (!state.tables.includes(state.activeBoss)) state.activeBoss = state.tables[0] || '';

  if (!opts.keepLog) {
    if (newCount === 0) log('No new hits detected.', 'log-info');
    else log(`Added ${newCount} new hits.`, 'log-ok');
  }
  renderBossTabs();
  renderCenter();
  renderRight();
}

// ---------- assignment ----------
function setAssignment(hitId, lvl) {
  let hit = null;
  for (const h of state.hits) if (h.id === hitId) { hit = h; break; }
  if (!hit) return;
  for (const l of LEVELS) for (const b of Object.keys(state.assignments[l])) {
    state.assignments[l][b] = (state.assignments[l][b] || []).filter((h) => h.id !== hitId);
  }
  if (lvl) (state.assignments[lvl][hit.boss] ||= []).push(hit);
  renderCenter();
  renderRight();
}

// ---------- auto assign (driven by Lv1/Lv2/Lv3 checkboxes in the sheet) ----------
function autoAssignFromTicks() {
  const assignments = emptyAssignments();
  const usage = {}; // playerKey -> {count, nikkes:Set}
  const assignedIds = new Set();
  const tickedHits = state.hits.filter((h) => h.ticks.some(Boolean));
  if (!tickedHits.length) {
    log('Auto Assign: no hits have Lv1/Lv2/Lv3 ticked in the sheet.', 'log-err');
    return;
  }
  const eligible = (h) => {
    if (assignedIds.has(h.id)) return false;
    const u = usage[playerKey(h.player)];
    if (u && (u.count >= Logic.MAX_HITS_PER_PLAYER || h.chars.some((c) => u.nikkes.has(c)))) return false;
    return true;
  };
  const assign = (lvl, boss, h) => {
    (assignments[lvl][boss] ||= []).push(h);
    assignedIds.add(h.id);
    const u = (usage[playerKey(h.player)] ||= { count: 0, nikkes: new Set() });
    u.count += 1;
    for (const c of h.chars) u.nikkes.add(c);
  };

  let skipped = 0;
  for (let li = 0; li < 3; li++) {
    const lvl = LEVELS[li];
    for (let bi = 0; bi < state.tables.length; bi++) {
      const boss = state.tables[bi];
      const maxHp = BOSS_HP_MATRIX[lvl][bi];
      let remaining = maxHp;
      while (remaining > 0) {
        const valid = state.hits.filter((h) => h.boss === boss && h.ticks[li] && h.dmg > 0 && eligible(h));
        if (!valid.length) break;
        const kills = valid.filter((h) => h.dmg >= remaining);
        const chosen = kills.length
          ? kills.reduce((a, b) => (b.dmg < a.dmg ? b : a))   // least-overkill kill
          : valid.reduce((a, b) => (b.dmg > a.dmg ? b : a));  // biggest chunk
        assign(lvl, boss, chosen);
        remaining -= chosen.dmg;
      }
    }
    // ticks are explicit choices: warn if a level isn't fully cleared, but still
    // process the next level's ticks (do not gate).
    const cleared = Logic.levelCleared(assignments, lvl, state.tables);
    log(`${lvl}: ${cleared ? 'ALL BOSSES CLEARED ✓' : 'NOT fully cleared ✗'}`, cleared ? 'log-ok' : 'log-err');
  }
  skipped = tickedHits.filter((h) => !assignedIds.has(h.id)).length;
  state.assignments = assignments;
  const perLvl = LEVELS.slice(0, 3).map((l) => {
    const n = Object.values(assignments[l]).reduce((s, arr) => s + (arr ? arr.length : 0), 0);
    return `${l}: ${n}`;
  }).join(', ');
  log(`Auto Assign: ${assignedIds.size} hits placed from sheet ticks (${perLvl})` + (skipped ? ` — ${skipped} ticked hits skipped by the 3-hit / one-team rules` : '') + '.', 'log-ok');
  renderCenter();
  renderRight();
}

// ---------- center pane ----------
function renderBossTabs() {
  const wrap = $('#boss-tabs');
  wrap.innerHTML = '';
  for (const boss of state.tables) {
    const b = document.createElement('button');
    b.className = 'seg-btn' + (boss === state.activeBoss ? ' active' : '');
    b.textContent = boss;
    b.onclick = () => { state.activeBoss = boss; renderBossTabs(); renderCenter(); };
    wrap.appendChild(b);
  }
}

function renderSortGroup() {
  document.querySelectorAll('#sort-group .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.sort === state.sortMode);
  });
}

function renderCenter() {
  const list = $('#hit-list');
  const empty = $('#center-empty');
  const hasData = state.hits.length > 0;
  empty.classList.toggle('show', !hasData);
  list.style.display = hasData ? 'flex' : 'none';
  if (!hasData) { list.innerHTML = ''; return; }

  const used = playerUsage(state.assignments);
  const optimalIds = optimalKillIds(state.assignments, state.hits, state.tables);
  const terms = state.search.toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);

  let hits = state.hits.filter((h) => h.boss === state.activeBoss);
  if (terms.length) {
    hits = hits.filter((h) => {
      const hay = (h.player + ' ' + h.chars.join(' ')).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  if (state.sortMode === 'desc') hits = [...hits].sort((a, b) => b.dmg - a.dmg);
  else if (state.sortMode === 'asc') hits = [...hits].sort((a, b) => a.dmg - b.dmg);

  list.innerHTML = '';
  for (const h of hits) {
    const st = hitState(state.assignments, h, used);
    const row = document.createElement('div');
    row.className = 'hit-row' +
      (st.kind === 'assigned' ? ' assigned' : '') +
      (st.kind === 'conflicted' ? ' conflicted' : '') +
      (st.kind === 'free' && optimalIds.has(h.id) ? ' optimal' : '');

    const name = document.createElement('div');
    name.className = 'hit-name';
    name.textContent = h.player;
    name.title = h.player;
    if (st.kind === 'free' && optimalIds.has(h.id)) {
      const badge = document.createElement('span');
      badge.className = 'opt-badge';
      badge.textContent = 'OPTIMAL';
      badge.title = 'Best-fit kill: clears this boss with the least overkill';
      name.appendChild(badge);
    }
    row.appendChild(name);

    const icons = document.createElement('div');
    icons.className = 'nikke-icons';
    for (const c of h.chars) icons.appendChild(iconEl(c));
    row.appendChild(icons);

    const tag = schedTagEl(h.player);
    if (tag) row.appendChild(tag);

    const dmg = document.createElement('div');
    dmg.className = 'hit-dmg';
    dmg.textContent = fmt(h.dmg);
    row.appendChild(dmg);

    const sel = document.createElement('select');
    sel.className = 'assign-select' + (st.kind === 'assigned' ? ' assigned' : '');
    for (const o of ['Unassigned', ...LEVELS]) {
      const op = document.createElement('option');
      op.value = o === 'Unassigned' ? '' : o;
      op.textContent = o;
      if ((st.kind === 'assigned' && st.lvl === o) || (st.kind !== 'assigned' && o === 'Unassigned')) op.selected = true;
      sel.appendChild(op);
    }
    sel.disabled = st.kind === 'conflicted';
    sel.title = st.kind === 'conflicted' ? `Blocked: commander ${st.reason}` : '';
    sel.onchange = () => setAssignment(h.id, sel.value || null);
    row.appendChild(sel);

    list.appendChild(row);
  }
}

// ---------- right pane ----------
function renderLvlTabs() {
  const wrap = $('#lvl-tabs');
  wrap.innerHTML = '';
  for (const lvl of LEVELS) {
    const b = document.createElement('button');
    b.className = 'seg-btn' + (lvl === state.activeLvl ? ' active' : '');
    b.textContent = lvl;
    b.onclick = () => { state.activeLvl = lvl; renderLvlTabs(); renderRight(); };
    wrap.appendChild(b);
  }
}

function bossCardEl(boss, hits, lvl) {
  const bi = state.tables.indexOf(boss);
  const maxHp = bi >= 0 ? BOSS_HP_MATRIX[lvl][bi] : 0;
  const total = hits.reduce((s, h) => s + h.dmg, 0);

  const card = document.createElement('div');
  card.className = 'boss-card';
  card.dataset.boss = boss;

  const head = document.createElement('div');
  head.className = 'boss-card-head';
  head.innerHTML = `<div class="boss-card-title">${boss}</div><div class="boss-card-lvl">${lvl.toUpperCase()}</div>`;
  card.appendChild(head);

  const prog = document.createElement('div');
  prog.className = 'boss-progress';
  const pct = maxHp === 0 ? 100 : Math.min(100, Math.round((total / maxHp) * 100));
  const fillCls = maxHp === 0 ? 'full' : total > maxHp ? 'over' : total >= maxHp ? 'full' : '';
  let metaRight;
  if (maxHp === 0) metaRight = `<span class="pct" style="color:var(--cyan)">ENDLESS</span>`;
  else if (total > maxHp) metaRight = `<span class="overkill">Overkill ${fmt(total - maxHp)}</span>`;
  else if (total < maxHp) metaRight = `<span class="hp-remaining">HP Lack ${fmt(maxHp - total)}</span>`;
  else metaRight = `<span class="pct">100%</span>`;
  prog.innerHTML = `
    <div class="progress-track"><div class="progress-fill ${fillCls}" style="width:${pct}%"></div></div>
    <div class="progress-meta">
      <span>${fmt(total)}${maxHp ? ' / ' + fmt(maxHp) : ''}</span>
      ${metaRight}
    </div>`;
  card.appendChild(prog);

  const hitsWrap = document.createElement('div');
  hitsWrap.className = 'boss-card-hits';
  for (const h of hits) {
    const r = document.createElement('div');
    r.className = 'boss-hit-row';
    const n = document.createElement('div');
    n.className = 'hit-name'; n.textContent = h.player; n.title = h.player;
    r.appendChild(n);
    const icons = document.createElement('div');
    icons.className = 'nikke-icons';
    for (const c of h.chars) icons.appendChild(iconEl(c));
    r.appendChild(icons);
    const d = document.createElement('div');
    d.className = 'hit-dmg'; d.textContent = fmt(h.dmg);
    r.appendChild(d);
    hitsWrap.appendChild(r);
  }
  card.appendChild(hitsWrap);

  const foot = document.createElement('div');
  foot.className = 'boss-card-foot';
  const send = document.createElement('button');
  send.className = 'mac-btn mac-btn-small send-btn';
  send.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21 23 12 2 3v7l15 2-15 2v7z"/></svg> Send to Discord`;
  send.onclick = () => sendCardToDiscord(card, `${boss}_${lvl.replace(' ', '')}`);
  foot.appendChild(send);
  card.appendChild(foot);

  return card;
}

function renderRight() {
  const list = $('#assigned-list');
  const empty = $('#assigned-empty');
  const lvlData = state.assignments[state.activeLvl] || {};
  const bosses = state.tables.filter((b) => (lvlData[b] || []).length);

  empty.classList.toggle('show', bosses.length === 0);
  list.style.display = bosses.length ? 'flex' : 'none';
  list.innerHTML = '';
  for (const boss of bosses) list.appendChild(bossCardEl(boss, lvlData[boss], state.activeLvl));
}

// ---------- Discord export ----------
async function elementToPng(el) {
  el.classList.add('export-mode');
  try {
    const canvas = await html2canvas(el, {
      backgroundColor: '#131419',
      scale: 2,
      useCORS: true,
      logging: false,
    });
    return canvas.toDataURL('image/png').split(',')[1];
  } finally {
    el.classList.remove('export-mode');
  }
}

async function sendCardToDiscord(el, filename) {
  const hook = $('#inp-hook').value.trim();
  if (!hook) { toast('Discord Webhook URL not set', 'err'); return; }
  toast('Rendering card…');
  try {
    const png = await elementToPng(el);
    const bin = atob(png);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: 'image/png' }), `${filename}.png`);
    const res = await fetch(hook, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Discord HTTP ' + res.status);
    toast('Sent to Discord ✓', 'ok');
    log(`Sent ${filename}.png to Discord.`, 'log-ok');
  } catch (e) {
    toast('Discord error: ' + e.message, 'err');
    log('Discord: ' + e.message, 'log-err');
  }
}

async function sendLevelToDiscord() {
  const list = $('#assigned-list');
  if (!list.children.length) { toast('Nothing assigned on this level', 'err'); return; }
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-99999px;top:0;width:460px;display:flex;flex-direction:column;gap:12px;padding:16px;background:#131419;';
  for (const child of list.children) wrap.appendChild(child.cloneNode(true));
  document.body.appendChild(wrap);
  try {
    await sendCardToDiscord(wrap, `MockPlan_${state.activeLvl.replace(' ', '')}`);
  } finally {
    wrap.remove();
  }
}

// ---------- Boss Tables modal ----------
function openTablesModal(opts = {}) {
  const modal = $('#tables-modal');
  const rows = $('#tables-rows');
  rows.innerHTML = '';
  const inputs = [];
  const current = opts.prefill || state.tables;
  for (let i = 0; i < 5; i++) {
    const r = document.createElement('div');
    r.className = 'modal-row';
    const num = document.createElement('div');
    num.className = 'row-num';
    num.textContent = i + 1;
    const inp = document.createElement('input');
    inp.className = 'mac-input';
    inp.type = 'text';
    inp.value = current[i] || '';
    inp.placeholder = `Table ${i + 1} name`;
    inp.spellcheck = false;
    inputs.push(inp);
    r.appendChild(num); r.appendChild(inp);
    rows.appendChild(r);
  }

  const det = $('#tables-detected');
  const sheetTables = state.detectedTables;
  if (sheetTables.length) {
    det.hidden = false;
    det.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'det-title';
    t.textContent = `Detected in current sheet (${sheetTables.length}):`;
    det.appendChild(t);
    const l = document.createElement('div');
    l.textContent = sheetTables.join('  •  ');
    det.appendChild(l);
    if (sheetTables.length === 5) {
      const use = document.createElement('button');
      use.className = 'mac-btn mac-btn-small use-btn';
      use.textContent = 'Use detected tables';
      use.onclick = () => sheetTables.forEach((n, i) => { if (inputs[i]) inputs[i].value = n; });
      det.appendChild(use);
    }
  } else {
    det.hidden = true;
  }

  modal.hidden = false;
  inputs[0].focus();

  $('#tables-cancel').onclick = () => { modal.hidden = true; };
  $('#tables-save').onclick = async () => {
    const names = inputs.map((i) => i.value.trim());
    if (names.some((n) => !n)) { toast('All 5 table names are required', 'err'); return; }
    if (new Set(names).size !== names.length) { toast('Table names must be unique', 'err'); return; }
    LS.set('tables', names);
    state.tables = names;
    modal.hidden = true;
    log('Boss tables saved: ' + names.join(', '), 'log-ok');
    applyTablesToCurrentData();
  };
}

function applyTablesToCurrentData() {
  if (!state.lastSheetData) { renderBossTabs(); return; }
  const missing = state.tables.filter((t) => !(t in state.lastSheetData));
  if (missing.length) {
    log(`Configured table(s) not found in the current sheet: ${missing.join(', ')}`, 'log-err');
    toast('Some tables are not in this sheet', 'err');
  }
  processData(state.lastSheetData, { keepLog: true });
}

// ---------- search autocomplete ----------
function setupSearch() {
  const input = $('#hit-search');
  const box = $('#search-suggest');
  let selIdx = -1, items = [];

  const close = () => { box.hidden = true; selIdx = -1; items = []; };

  input.addEventListener('input', () => {
    state.search = input.value;
    renderCenter();

    const parts = input.value.split(',');
    const last = parts.pop().trim();
    if (!last) { close(); return; }
    const pool = [...new Set([...Object.keys(window.NAME_TO_SQUARE || {}), ...state.hits.map((h) => h.player)])];
    items = pool.filter((n) => n.toLowerCase().includes(last.toLowerCase())).slice(0, 8);
    if (!items.length) { close(); return; }
    box.innerHTML = '';
    items.forEach((n, i) => {
      const d = document.createElement('div');
      d.className = 'suggest-item' + (i === selIdx ? ' sel' : '');
      d.textContent = n;
      d.onmousedown = (e) => {
        e.preventDefault();
        parts.push(n);
        input.value = parts.join(', ') + ', ';
        state.search = input.value;
        renderCenter();
        close();
        input.focus();
      };
      box.appendChild(d);
    });
    box.hidden = false;
  });

  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selIdx = (selIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...box.children].forEach((c, i) => c.classList.toggle('sel', i === selIdx));
    } else if (e.key === 'Enter' && selIdx >= 0) {
      e.preventDefault();
      box.children[selIdx].dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
    } else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', close);
}

// ---------- sheet auto-update ----------
function restartSheetTimer() {
  if (state.sheetTimer) { clearInterval(state.sheetTimer); state.sheetTimer = null; }
  const mins = $('#sel-auto').value;
  LS.set('autoMin', mins);
  if (mins !== 'off') {
    state.sheetTimer = setInterval(() => fetchData(true), parseInt(mins, 10) * 60 * 1000);
    log(`Sheet auto-update on: every ${mins} min.`, 'log-info');
  }
}

// ---------- paste CSV fallback ----------
function setupPasteModal() {
  const modal = $('#paste-modal');
  const area = $('#paste-area');
  let kind = 'sheet';
  document.querySelectorAll('#paste-tabs .seg-btn').forEach((b) => {
    b.onclick = () => {
      kind = b.dataset.kind;
      document.querySelectorAll('#paste-tabs .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
  $('#btn-paste').onclick = () => { area.value = ''; modal.hidden = false; area.focus(); };
  $('#paste-cancel').onclick = () => { modal.hidden = true; };
  $('#paste-ok').onclick = () => {
    const text = area.value.trim();
    if (!text) { toast('Nothing pasted', 'err'); return; }
    modal.hidden = true;
    try {
      if (kind === 'sheet') {
        const { tables, data } = SheetParser.parseSheetCsv(text);
        state.detectedTables = tables;
        state.lastSheetData = data;
        log(`Parsed pasted CSV: ${tables.length} tables detected.`, 'log-ok');
        const configured = state.tables.filter((t) => t in data);
        if (configured.length === 5) processData(data);
        else { processData(data); openTablesModal({ prefill: tables.length === 5 ? tables : null }); }
        renderLinks();
      } else {
        const rows = SheetParser.parseCsvRows(text);
        state.schedule = {};
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r.length) continue;
          const member = (r[0] || '').trim();
          if (!member || /^\d+$/.test(member)) continue;
          state.schedule[member.toLowerCase()] = { member, availability: (r[1] || '').trim(), comment: (r[2] || '').trim() };
        }
        log(`Schedule loaded from paste: ${Object.keys(state.schedule).length} members.`, 'log-ok');
        renderLinks();
        renderCenter();
      }
    } catch (e) {
      log('Paste parse error: ' + e.message, 'log-err');
      toast('Could not parse that CSV', 'err');
    }
  };
}

// ---------- boot ----------
function boot() {
  $('#inp-drive').value = LS.get('driveUrl', '');
  $('#inp-hook').value = LS.get('hookUrl', '');
  $('#inp-sched').value = LS.get('schedUrl', '');
  $('#sel-auto').value = LS.get('autoMin', 'off');
  state.tables = LS.get('tables', []);
  state.links = LS.get('links', {});
  state.activeBoss = state.tables[0] || '';

  $('#btn-load').onclick = () => fetchData(false);
  $('#btn-tables').onclick = () => openTablesModal();
  $('#btn-auto').onclick = autoAssignFromTicks;
  $('#btn-clear').onclick = () => {
    state.assignments = emptyAssignments();
    for (const l of LEVELS) for (const t of state.tables) state.assignments[l][t] = [];
    renderCenter(); renderRight();
    log('All assignments cleared.', 'log-info');
  };
  $('#btn-send-level').onclick = sendLevelToDiscord;
  $('#sel-auto').onchange = restartSheetTimer;

  $('#inp-sched').addEventListener('change', () => {
    LS.set('schedUrl', $('#inp-sched').value.trim());
    if ($('#inp-sched').value.trim()) fetchSchedule();
    else { state.schedule = {}; renderLinks(); renderCenter(); }
  });
  $('#inp-hook').addEventListener('change', () => LS.set('hookUrl', $('#inp-hook').value.trim()));

  document.querySelectorAll('#sort-group .seg-btn').forEach((b) => {
    b.onclick = () => { state.sortMode = b.dataset.sort; renderSortGroup(); renderCenter(); };
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#tables-modal').hidden) $('#tables-modal').hidden = true;
  });

  setupSearch();
  setupPasteModal();
  if (location.protocol === 'file:')
    log('Running from file:// — browsers block Google Sheet fetches. Use "Paste CSV manually…", or run a local server / GitHub Pages for auto-fetch.', 'log-info');
  renderBossTabs();
  renderLvlTabs();
  renderSortGroup();
  renderCenter();
  renderRight();
  renderLinks();
  restartSheetTimer();
  if ($('#inp-sched').value.trim()) fetchSchedule();
  log('Ready. Load your Google Sheet to begin.', 'log-info');
}

boot();
