/* Union Overview renderer. Reads window.UNION_DATA (from data.js). */
'use strict';
(function () {
  const D = window.UNION_DATA;
  if (!D) { document.body.innerHTML = '<p style="padding:30px">No data.js found.</p>'; return; }
  const IMG = (i) => (i == null ? null : D.images[i]);
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n) => (n == null ? '—' : n.toLocaleString());
  const fmtDmg = (n) => {
    if (n == null) return '—';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    return n.toLocaleString();
  };
  const TIER_NAMES = ['Challenger', 'Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze'];
  const tierName = (t) => (t >= 0 && t <= 5) ? TIER_NAMES[t] : 'Unranked';
  const tierCls = (t) => 'tier-' + (t >= 0 && t <= 5 ? t : 6);
  const isTouch = window.matchMedia('(hover: none)').matches;

  const U = D.union;
  const curN = 'UR' + (D.seasons.cur % 100);
  const prevN = 'UR' + (D.seasons.prev % 100);

  document.title = U.name + ' — Union Overview';
  $('#serverTag').textContent = U.server + ' · gsn ' + U.gsn;

  // ---------- union card ----------
  function avatarHtml(iconIdx, prism, size) {
    const src = IMG(iconIdx);
    const cls = 'member-avatar' + (prism ? ' prism' : '');
    if (!src) return '<div class="' + cls + '"></div>';
    return '<div class="' + cls + '"><img src="' + src + '" alt="" loading="lazy"></div>';
  }

  (function renderCard() {
    const card = $('#unionCard');
    const em = el('div', 'union-emblem');
    const emSrc = IMG(U.emblem);
    if (emSrc) em.innerHTML = '<img src="' + emSrc + '" alt="emblem">';
    else em.textContent = '?';
    card.appendChild(em);

    const main = el('div', 'union-main');
    const title = el('div', 'union-title');
    title.appendChild(el('span', 'union-name', esc(U.name)));
    title.appendChild(el('span', 'tier-badge ' + tierCls(U.tier), tierName(U.tier)));
    main.appendChild(title);

    const sub = el('div', 'union-sub');
    sub.innerHTML =
      '<span>Members <b>' + U.memberCount + '/' + U.memberMax + '</b></span>' +
      '<span>GSN <b>' + esc(U.gsn) + '</b></span>' +
      '<span>Snapshot <b>' + esc((U.snapshot || '').replace('Snapshot-', '').replace('_', ' ')) + '</b></span>';
    main.appendChild(sub);

    const off = el('div', 'officers');
    const officerChip = (o, role, cls) => {
      if (!o) return '';
      return '<div class="officer">' + avatarHtml(o.icon, o.prism) +
        '<span>' + esc(o.nick) + '</span><span class="role ' + cls + '">' + role + '</span></div>';
    };
    off.innerHTML = officerChip(U.leader, 'Leader', 'leader') +
      (U.subs || []).map((s) => officerChip(s, 'Sub Leader', 'sub')).join('');
    main.appendChild(off);
    card.appendChild(main);
  })();

  // ---------- member table ----------
  $('#memberCount').textContent = D.members.length;
  const head = $('#headRow');
  // key: sort accessor; type: 's' string | 'n' number
  const COLS = [
    { label: 'Member', key: 'nick', type: 's' },
    { label: 'usn', key: 'usn', type: 'n' },
    { label: 'Profile', key: null },
    { label: prevN + ' Sync', key: 'prevLv', type: 'n', cls: 'num' },
    { label: curN + ' Sync', key: 'curLv', type: 'n', cls: 'num' },
    { label: 'Growth', key: 'growth', type: 'n', cls: 'num' },
    { label: prevN + ' DMG', key: 'prevDmg', type: 'n', cls: 'num' },
    { label: curN + ' DMG', key: 'curDmg', type: 'n', cls: 'num' },
    { label: 'Change', key: 'dmgChg', type: 'n', cls: 'num' },
    { label: 'Notes', key: 'notesText', type: 's' },
  ];
  let sortKey = null, sortDir = 1, sortType = 's';
  function renderHead() {
    head.innerHTML = COLS.map((c, i) => {
      const arrow = c.key == null ? '' :
        (sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : '');
      const cls = (c.cls ? c.cls + ' ' : '') + (c.key != null ? 'sortable' : '');
      const attrs = c.key != null ? ' data-col="' + i + '"' : '';
      return '<th class="' + cls + '"' + attrs + '>' + esc(c.label) +
        (arrow ? '<span class="sort-arrow">' + arrow + '</span>' : '') + '</th>';
    }).join('');
  }
  head.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-col]');
    if (!th) return;
    const c = COLS[+th.dataset.col];
    if (sortKey === c.key) sortDir = -sortDir;
    else { sortKey = c.key; sortType = c.type; sortDir = 1; }
    renderHead();
    renderRows();
  });

  const flagHtml = (f) => {
    if (f === 'noattempt') return '<span class="cell-flag solid">Didn\'t Attempt</span>';
    if (f === 'new') return '<span class="cell-flag solid newflag">New Member</span>';
    return '';
  };
  const ELEMENT_COLORS = {
    'Z.E.U.S.': 'el-purple', 'D.M.T.R.': 'el-yellow', 'A.N.M.I.': 'el-green',
    'P.S.I.D.': 'el-lightblue', 'H.S.T.A.': 'el-red',
  };
  const elementCls = (boss) => {
    for (const tok in ELEMENT_COLORS) if (boss.includes(tok)) return ELEMENT_COLORS[tok];
    return 'el-purple';
  };
  const finalHitHtml = (f) =>
    '<span class="cell-flag fh hollow ' + elementCls(f.b) + '" title="Final hit">⚔ ' +
    esc(f.b) + (f.l != null ? ' Lv ' + f.l : '') + '</span>';
  const normNote = (s) => (s || '').toLowerCase().replace(/['']/g, '').replace(/\s+/g, ' ').trim();
  const notesHtml = (m) => {
    const parts = [];
    const flags = [];
    if (m.prevFlag === 'new') { parts.push(flagHtml('new')); flags.push('new member'); }
    if (m.curFlag === 'noattempt' || m.prevFlag === 'noattempt') { parts.push(flagHtml('noattempt')); flags.push('didnt attempt'); }
    for (const f of (m.finalHits || [])) parts.push(finalHitHtml(f));
    if (m.left) parts.push('<span class="left-flag" title="Not in the latest snapshot (last seen ' + esc(m.left) + ')">✖ Left union</span>');
    if (m.renamedFrom) parts.push('<span class="renamed" title="Nickname in raid data">✎ was ' + esc(m.renamedFrom) + '</span>');
    if (m.joined) parts.push('<span class="joined-note" title="Joined this union">📅 ' + esc(m.joined) + '</span>');
    if (m.fromUnion) parts.push('<span class="from-union" title="Previous union">← from ' + esc(m.fromUnion) + '</span>');
    // skip raw notes that merely repeat a flag pill (e.g. "Didnt Attempt")
    if (m.notes && !flags.includes(normNote(m.notes))) {
      parts.push('<span class="note-text">' + esc(m.notes) + '</span>');
    }
    return parts.join(' ');
  };

  const tbody = $('#memberBody');
  const LABELS = ['usn', 'Profile', prevN + ' Sync', curN + ' Sync', 'Growth',
                  prevN + ' DMG', curN + ' DMG', 'Change', 'Notes'];
  // plain-text notes for sorting (flags + notes combined)
  for (const m of D.members) {
    const bits = [];
    if (m.prevFlag === 'new') bits.push('new member');
    if (m.curFlag === 'noattempt' || m.prevFlag === 'noattempt') bits.push("didn't attempt");
    for (const f of (m.finalHits || [])) bits.push(f.b);
    if (m.joined) bits.push(m.joined);
    if (m.fromUnion) bits.push(m.fromUnion);
    if (m.notes) bits.push(m.notes);
    m.notesText = bits.join(' ').toLowerCase();
  }
  function sortedMembers() {
    if (!sortKey) return D.members;
    const arr = D.members.slice();
    arr.sort((a, b) => {
      let r;
      if (sortType === 'n') r = (a[sortKey] || 0) - (b[sortKey] || 0);
      else r = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), undefined, { sensitivity: 'base' });
      return r !== 0 ? r * sortDir : String(a.nick || '').localeCompare(String(b.nick || ''), undefined, { sensitivity: 'base' });
    });
    return arr;
  }
  function renderRows() {
    tbody.innerHTML = '';
    for (const m of sortedMembers()) {
    const tr = el('tr', m.left ? 'member-left' : '');

    // member cell
    let role = '';
    if (m.type === 2) role = ' <span class="role-badge role-leader">Leader</span>';
    else if (m.type === 1) role = ' <span class="role-badge role-sub">Sub</span>';
    const tdM = el('td', 'cell-member');
    tdM.innerHTML = '<div class="member-cell">' + avatarHtml(m.icon, m.prism) +
      '<div><div class="member-name">' + esc(m.nick) + role + '</div>' +
      '<div class="member-usn">usn ' + esc(m.usn) + '</div></div></div>';
    tr.appendChild(tdM);

    const mk = (cls, html, labelIdx) => {
      const td = el('td', cls, html);
      if (labelIdx != null) td.dataset.label = LABELS[labelIdx];
      return td;
    };
    tr.appendChild(mk('muted', esc(m.usn), 0));
    tr.appendChild(mk('', m.url
      ? '<a class="bl-link" href="' + esc(m.url) + '" target="_blank" rel="noopener">blablalink ↗</a>' : '—', 1));

    tr.appendChild(mk('num', m.noPrev ? '<span class="muted">—</span>' : String(m.prevLv), 2));
    tr.appendChild(mk('num', String(m.curLv), 3));
    tr.appendChild(mk('num ' + (m.growth > 0 ? 'delta-up' : m.growth < 0 ? 'delta-down' : 'muted'),
      (m.growth > 0 ? '+' : '') + m.growth, 4));

    const tdP = mk('num dmg-cell',
      (m.prevDmg == null ? '<span class="muted">—</span>' : fmtDmg(m.prevDmg)), 5);
    tdP.dataset.season = 'prev';
    tdP.dataset.nick = m.nick;
    tr.appendChild(tdP);

    const tdC = mk('num dmg-cell',
      (m.curFlag === 'noattempt' ? '<span class="muted">—</span>' : fmtDmg(m.curDmg)), 6);
    tdC.dataset.season = 'cur';
    tdC.dataset.nick = m.nick;
    tr.appendChild(tdC);

    tr.appendChild(mk('num ' + (m.dmgChg == null ? 'muted' : m.dmgChg > 0 ? 'delta-up' : m.dmgChg < 0 ? 'delta-down' : 'muted'),
      m.dmgChg == null ? '—' : (m.dmgChg > 0 ? '+' : '') + fmtDmg(m.dmgChg), 7));

    tr.appendChild(mk('notes-cell', notesHtml(m), 8));
    tbody.appendChild(tr);
    }
  }
  renderHead();
  renderRows();

  $('#footnote').textContent =
    'Damage totals count difficulty 2 runs only. ' + prevN + ' = season ' + D.seasons.prev +
    ', ' + curN + ' = season ' + D.seasons.cur + '. ' +
    (isTouch ? 'Tap a damage cell for the combat log.' : 'Hover a damage cell for the combat log.');

  // ---------- tooltip / combat log ----------
  const tip = $('#tooltip');
  let tipOpen = false;

  function runHtml(run) {
    const sq = (run.q || []).map((s) => {
      const img = s.i != null ? '<img src="' + IMG(s.i) + '" alt="">' : '';
      return '<div class="tt-nikke" title="' + esc(s.n) + '">' + img +
        '<span class="tt-combat">⚔ ' + fmtNum(s.c) + '</span></div>';
    }).join('');
    const dmgCls = run.f ? 'dmg final' : 'dmg';
    return '<div class="tt-run">' +
      '<div class="tt-boss"><b>' + esc(run.b) + (run.l != null ? ' Lv ' + run.l : '') + '</b> · day ' + esc(run.d) + ' · step ' + esc(run.s) +
      ' · sync ' + esc(run.lv) + '</div>' +
      '<div class="tt-head"><span>' + (run.f ? '<span class="tt-final-tag">final hit</span>' : '') +
      '</span><span class="' + dmgCls + '">' + fmtDmg(run.m) + '</span></div>' +
      '<div class="tt-squad">' + sq + '</div></div>';
  }

  function memberRuns(m, which) {
    return (which === 'prev' ? m.prevRuns : m.curRuns) || [];
  }

  function showTip(cell, x, y) {
    const nick = cell.dataset.nick;
    const which = cell.dataset.season;
    const m = D.members.find((mm) => mm.nick === nick);
    if (!m) return;
    const runs = memberRuns(m, which);
    const seasonLabel = which === 'prev' ? prevN : curN;
    if (!runs.length) {
      tip.innerHTML = '<b>' + esc(nick) + '</b> · ' + seasonLabel +
        '<div class="muted" style="margin-top:4px">No difficulty 2 participation records.</div>';
    } else {
      tip.innerHTML = '<b>' + esc(nick) + '</b> · ' + seasonLabel +
        ' · total ' + fmtDmg(which === 'prev' ? m.prevDmg : m.curDmg) +
        '<div style="margin-top:6px">' + runs.map((r) => runHtml(r)).join('') + '</div>';
    }
    tip.classList.remove('hidden');
    tipOpen = true;
    positionTip(x, y);
  }

  function positionTip(x, y) {
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (left < 8) left = 8;
    if (top + r.height > window.innerHeight - 8) top = window.innerHeight - r.height - 8;
    if (top < 8) top = 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function hideTip() { tip.classList.add('hidden'); tipOpen = false; }

  // click works on every device (tap on mobile); hover adds desktop convenience
  document.addEventListener('click', (e) => {
    const cell = e.target.closest('.dmg-cell');
    if (cell) { e.preventDefault(); showTip(cell, e.clientX, e.clientY); }
    else if (tipOpen && !e.target.closest('.tooltip')) hideTip();
  });
  if (!isTouch) {
    tbody.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.dmg-cell');
      if (cell) showTip(cell, e.clientX, e.clientY);
    });
    tbody.addEventListener('mousemove', (e) => {
      if (tipOpen && !e.target.closest('.dmg-cell')) hideTip();
      else if (tipOpen && !e.target.closest('.tooltip')) positionTip(e.clientX, e.clientY);
    });
    tbody.addEventListener('mouseout', (e) => {
      if (e.target.closest('.dmg-cell') && !e.relatedTarget?.closest?.('.dmg-cell')) hideTip();
    });
  }
  window.addEventListener('scroll', () => { if (tipOpen) hideTip(); }, { passive: true });

  // =================== COMBAT LOG TAB ===================
  const LOG = D.log || [];
  const bossEl = (b) => {
    if (b.includes('A.N.M.I.')) return 'anmi';
    if (b.includes('H.S.T.A.')) return 'hsta';
    if (b.includes('P.S.I.D.')) return 'psid';
    if (b.includes('Z.E.U.S.')) return 'zeus';
    if (b.includes('D.M.T.R.')) return 'dmt';
    return 'other';
  };
  const BOSS_COLORS = {
    anmi: '#3ecf8e', hsta: '#ff5d73', psid: '#7fd4ff', zeus: '#b8a6ff', dmt: '#aab4c4', other: '#8b95ab',
  };
  const bossColor = (b) => BOSS_COLORS[bossEl(b)] || BOSS_COLORS.other;

  // tab switching
  const tabOv = $('#tabOverview'), tabLog = $('#tabLog');
  const viewOv = $('#viewOverview'), viewLog = $('#viewLog');
  tabOv.addEventListener('click', () => {
    tabOv.classList.add('active'); tabLog.classList.remove('active');
    viewOv.hidden = false; viewLog.hidden = true;
  });
  tabLog.addEventListener('click', () => {
    tabLog.classList.add('active'); tabOv.classList.remove('active');
    viewLog.hidden = false; viewOv.hidden = true;
  });

  // ---- filters (multi-select) ----
  const uniq = (fn) => [...new Set(LOG.flatMap(fn))].sort();
  const FILTERS = [
    { id: 'boss', label: 'Boss', opts: uniq((r) => [r.boss]) },
    { id: 'lvl', label: 'Level', opts: uniq((r) => [String(r.lvl)]) },
    { id: 'nikke', label: 'Nikke', opts: uniq((r) => r.q.map((s) => s.n)) },
    { id: 'user', label: 'User', opts: uniq((r) => [r.nick]) },
  ];
  const sel = { boss: new Set(), lvl: new Set(), nikke: new Set(), user: new Set() };
  $('#filterBar').innerHTML = FILTERS.map((f) =>
    '<details class="msel" data-f="' + f.id + '"><summary>' + esc(f.label) +
    ' <span class="msel-n"></span></summary><div class="msel-list">' +
    f.opts.map((o) => '<label><input type="checkbox" value="' + esc(o) + '"> ' + esc(o) + '</label>').join('') +
    '</div></details>').join('') +
    '<button class="clear-f" id="clearFilters">Clear filters</button>';
  $('#filterBar').addEventListener('change', (e) => {
    const d = e.target.closest('.msel');
    if (!d) return;
    const set = sel[d.dataset.f];
    if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
    d.querySelector('.msel-n').textContent = set.size ? '(' + set.size + ')' : '';
    renderLog();
  });
  $('#clearFilters').addEventListener('click', () => {
    for (const k in sel) sel[k].clear();
    document.querySelectorAll('.msel input').forEach((i) => { i.checked = false; });
    document.querySelectorAll('.msel-n').forEach((n) => { n.textContent = ''; });
    renderLog();
  });
  function filtered() {
    return LOG.filter((r) =>
      (!sel.boss.size || sel.boss.has(r.boss)) &&
      (!sel.lvl.size || sel.lvl.has(String(r.lvl))) &&
      (!sel.nikke.size || r.q.some((s) => sel.nikke.has(s.n))) &&
      (!sel.user.size || sel.user.has(r.nick)));
  }

  // ---- log table ----
  const LOG_COLS = ['User', 'usn', 'Synchro', 'Boss', 'Lvl', 'Squad Combat', 'Squad', 'Damage', 'Final', ''];
  const LOG_LABELS = ['usn', 'Synchro', 'Boss', 'Lvl', 'Squad Combat', 'Squad', 'Damage', 'Final'];
  const logHeadHtml = LOG_COLS.map((c, i) =>
    '<th' + (i === 7 ? ' class="num"' : '') + '>' + esc(c) + '</th>').join('');
  $('#logHead').innerHTML = logHeadHtml;
  document.querySelectorAll('.logHeadClone').forEach((tr) => { tr.innerHTML = logHeadHtml; });

  function squadHtml(r) {
    return '<div class="tt-squad">' + r.q.map((s) => {
      const img = s.i != null ? '<img src="' + IMG(s.i) + '" alt="">' : '';
      const niche = (r.niche || []).includes(s.n) ? ' niche-unit' : '';
      return '<div class="tt-nikke' + niche + '" title="' + esc(s.n) + '">' + img +
        '<span class="tt-combat">⚔ ' + fmtNum(s.c) + '</span></div>';
    }).join('') + '</div>';
  }
  function logRowHtml(r, idx) {
    const av = r.icon != null ? '<img src="' + IMG(r.icon) + '" alt="">' : '';
    const devTag = r.dev != null
      ? ' <span class="dev-tag ' + (r.dev > 0 ? 'delta-up' : 'delta-down') + '">' +
        (r.dev > 0 ? '+' : '') + Math.round(r.dev * 100) + '%</span>' : '';
    return '<tr class="boss-' + bossEl(r.boss) + '" data-idx="' + idx + '">' +
      '<td data-label="User"><div class="member-cell"><div class="member-avatar">' + av + '</div>' +
        '<span class="member-name">' + esc(r.nick) + '</span></div></td>' +
      '<td class="muted" data-label="usn">' + esc(r.usn) + '</td>' +
      '<td class="num" data-label="Synchro">' + esc(r.lv) + '</td>' +
      '<td data-label="Boss">' + esc(r.boss) + '</td>' +
      '<td class="num" data-label="Lvl">' + esc(r.lvl) + '</td>' +
      '<td class="num" data-label="Squad Combat">' + fmtNum(r.sc) + '</td>' +
      '<td data-label="Squad">' + squadHtml(r) + '</td>' +
      '<td class="num" data-label="Damage">' + fmtDmg(r.dmg) + devTag + '</td>' +
      '<td data-label="Final">' + (r.final ? '<span class="final-yes">✔</span>' : '') + '</td>' +
      '<td><button class="send-btn" title="Send hit card to Discord webhook">⤴</button></td>' +
      '</tr>';
  }
  function renderLog() {
    const rows = filtered();
    $('#logCount').textContent = rows.length + ' / ' + LOG.length + ' hits';
    $('#logBody').innerHTML = rows.map((r) => logRowHtml(r, LOG.indexOf(r))).join('');
  }
  renderLog();

  // callout tables
  const nicheRows = LOG.filter((r) => r.niche && r.niche.length);
  const devRows = LOG.filter((r) => r.dev != null);
  $('#nicheCount').textContent = nicheRows.length + ' hits';
  $('#devCount').textContent = devRows.length + ' hits';
  $('#nicheBody').innerHTML = nicheRows.map((r) => logRowHtml(r, LOG.indexOf(r))).join('');
  $('#devBody').innerHTML = devRows.map((r) => logRowHtml(r, LOG.indexOf(r))).join('');

  // ---- Discord webhook ----
  const hookInput = $('#webhookUrl');
  hookInput.value = localStorage.getItem('unionWebhook') || '';
  hookInput.addEventListener('change', () => localStorage.setItem('unionWebhook', hookInput.value.trim()));
  const toast = (msg, ok) => {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
    setTimeout(() => t.classList.add('hidden'), 3500);
  };
  const loadImage = (src) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
  });

  async function renderHitCard(r) {
    const W = 900, H = 420, S = 2;
    const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
    const c = cv.getContext('2d'); c.scale(S, S);
    const color = bossColor(r.boss);
    // background
    c.fillStyle = '#0b0e14'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#151a26'; c.fillRect(10, 10, W - 20, H - 20);
    c.strokeStyle = color; c.lineWidth = 3; c.strokeRect(10, 10, W - 20, H - 20);
    c.fillStyle = color + '22'; c.fillRect(10, 10, W - 20, 74);
    const font = (px, w) => (w ? w + ' ' : '') + px + 'px "Segoe UI", system-ui, sans-serif';
    // header: user icon + nick + usn + sync
    if (r.icon != null) {
      try {
        const im = await loadImage(IMG(r.icon));
        c.save(); c.beginPath(); c.arc(62, 47, 28, 0, Math.PI * 2); c.clip();
        c.drawImage(im, 34, 19, 56, 56); c.restore();
        c.strokeStyle = color; c.lineWidth = 2;
        c.beginPath(); c.arc(62, 47, 28, 0, Math.PI * 2); c.stroke();
      } catch (_) {}
    }
    c.fillStyle = '#e6eaf2'; c.font = font(26, '700');
    c.fillText(r.nick, 104, 42);
    c.fillStyle = '#8b95ab'; c.font = font(15);
    c.fillText('usn ' + r.usn + '  ·  Synchro ' + r.lv, 104, 66);
    if (r.final) {
      c.fillStyle = color; c.font = font(15, '800');
      const tw = c.measureText('FINAL HIT').width;
      c.fillText('FINAL HIT', W - 30 - tw, 52);
    }
    // boss line
    c.fillStyle = color; c.font = font(22, '700');
    c.fillText(r.boss + (r.lvl != null ? '  Lv ' + r.lvl : ''), 30, 122);
    // damage
    c.fillStyle = r.final ? '#ff5d73' : '#e6eaf2'; c.font = font(40, '800');
    c.fillText(fmtDmg(r.dmg), 30, 178);
    c.fillStyle = '#8b95ab'; c.font = font(14);
    c.fillText('Squad combat ' + fmtNum(r.sc), 30, 204);
    // squad icons
    const box = 118, gap = 16, x0 = 30, y0 = 226;
    for (let i = 0; i < r.q.length && i < 5; i++) {
      const s = r.q[i], x = x0 + i * (box + gap);
      c.fillStyle = '#1a2030'; c.fillRect(x, y0, box, box);
      c.strokeStyle = (r.niche || []).includes(s.n) ? color : '#232b3d';
      c.lineWidth = (r.niche || []).includes(s.n) ? 2 : 1;
      c.strokeRect(x, y0, box, box);
      if (s.i != null) {
        try { const im = await loadImage(IMG(s.i)); c.drawImage(im, x + 2, y0 + 2, box - 4, box - 4); } catch (_) {}
      }
      c.fillStyle = '#e6eaf2'; c.font = font(14, '700');
      const cw = c.measureText('⚔ ' + fmtNum(s.c)).width;
      c.fillText('⚔ ' + fmtNum(s.c), x + (box - cw) / 2, y0 + box + 22);
      c.fillStyle = '#8b95ab'; c.font = font(11);
      const nw = Math.min(c.measureText(s.n).width, box);
      c.fillText(s.n.slice(0, 18), x + (box - nw) / 2, y0 + box + 40);
    }
    // footer
    c.fillStyle = '#8b95ab'; c.font = font(13);
    c.fillText(U.name + ' · ' + U.server + ' gsn ' + U.gsn + ' · ' + curN + ' difficulty 2', 30, H - 26);
    return cv;
  }

  async function sendHit(r) {
    const url = hookInput.value.trim();
    if (!/^https:\/\/discord\.com\/api\/webhooks\//.test(url)) {
      toast('Set a valid Discord webhook URL first', false); return;
    }
    toast('Rendering card…', true);
    try {
      const cv = await renderHitCard(r);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
      const fd = new FormData();
      fd.append('payload_json', JSON.stringify({
        content: null,
        embeds: [{
          title: r.nick + ' — ' + r.boss + (r.lvl != null ? ' Lv ' + r.lvl : ''),
          description: (r.final ? '**FINAL HIT** · ' : '') +
            'Damage **' + fmtDmg(r.dmg) + '** · Synchro ' + r.lv + ' · Squad combat ' + fmtNum(r.sc),
          color: parseInt(bossColor(r.boss).slice(1), 16),
        }],
      }));
      fd.append('files[0]', blob, 'hit.png');
      const resp = await fetch(url, { method: 'POST', body: fd });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      toast('Hit card sent ✔', true);
    } catch (err) {
      toast('Send failed: ' + err.message, false);
    }
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.send-btn');
    if (!btn) return;
    const tr = btn.closest('tr');
    const r = LOG[+tr.dataset.idx];
    if (r) sendHit(r);
  });
})();
