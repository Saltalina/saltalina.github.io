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
  head.innerHTML =
    '<th>Member</th><th>usn</th><th>Profile</th>' +
    '<th class="num">' + prevN + ' Sync</th><th class="num">' + curN + ' Sync</th><th class="num">Growth</th>' +
    '<th class="num">' + prevN + ' DMG</th><th class="num">' + curN + ' DMG</th><th class="num">Change</th><th>Notes</th>';

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
    // skip raw notes that merely repeat a flag pill (e.g. "Didnt Attempt")
    if (m.notes && !flags.includes(normNote(m.notes))) {
      parts.push('<span class="note-text">' + esc(m.notes) + '</span>');
    }
    return parts.join(' ');
  };

  const tbody = $('#memberBody');
  const LABELS = ['usn', 'Profile', prevN + ' Sync', curN + ' Sync', 'Growth',
                  prevN + ' DMG', curN + ' DMG', 'Change', 'Notes'];
  for (const m of D.members) {
    const tr = el('tr');

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

    tr.appendChild(mk('num', m.prevFlag === 'new' ? '<span class="muted">—</span>' : String(m.prevLv), 2));
    tr.appendChild(mk('num', String(m.curLv), 3));
    tr.appendChild(mk('num ' + (m.prevFlag === 'new' ? 'muted' : m.growth > 0 ? 'delta-up' : m.growth < 0 ? 'delta-down' : 'muted'),
      m.prevFlag === 'new' ? '—' : (m.growth > 0 ? '+' : '') + m.growth, 4));

    const tdP = mk('num dmg-cell',
      (m.prevFlag ? '<span class="muted">—</span>' : fmtDmg(m.prevDmg)), 5);
    tdP.dataset.season = 'prev';
    tdP.dataset.nick = m.nick;
    tr.appendChild(tdP);

    const tdC = mk('num dmg-cell',
      (m.curFlag === 'noattempt' ? '<span class="muted">—</span>' : fmtDmg(m.curDmg)), 6);
    tdC.dataset.season = 'cur';
    tdC.dataset.nick = m.nick;
    tr.appendChild(tdC);

    tr.appendChild(mk('num ' + (m.dmgChg > 0 ? 'delta-up' : m.dmgChg < 0 ? 'delta-down' : 'muted'),
      (m.dmgChg > 0 ? '+' : '') + fmtDmg(m.dmgChg), 7));

    tr.appendChild(mk('notes-cell', notesHtml(m), 8));
    tbody.appendChild(tr);
  }

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
})();
