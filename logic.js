/* logic.js — pure auto-assign / conflict logic (shared by renderer and unit tests)
   UMD-style: window.Logic in Electron, module.exports in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const TARGET_TABLES = ['Mace', 'Fingers', 'Crystal Chamber', 'Rebuild Vulcan R', 'Kraken'];
  const LEVELS = ['Lvl 1', 'Lvl 2', 'Lvl 3', 'Lvl 4'];
  const BOSS_HP_MATRIX = {
    'Lvl 1': [99856279200, 99856279200, 150841813600, 99856279200, 150841813600],
    'Lvl 2': [149784418800, 149784418800, 226262720400, 149784418800, 226262720400],
    'Lvl 3': [292445295750, 292445295750, 349230901500, 292445295750, 349230901500],
    'Lvl 4': [0, 0, 0, 0, 0], // 0 = Endless
  };
  const MAX_HITS_PER_PLAYER = 3;

  // Commander nicknames differ in case between sources (sheet "An", API "AN").
  // Compare players by this normalized key. Nikke names are compared exactly —
  // skin variants (Rapi: Red Hood vs Red Hood) are DIFFERENT units.
  function playerKey(name) {
    return String(name || '').toLowerCase().trim();
  }

  function emptyAssignments() {
    return { 'Lvl 1': {}, 'Lvl 2': {}, 'Lvl 3': {}, 'Lvl 4': {} };
  }

  function levelCleared(assignments, lvl, tables) {
    tables = tables || TARGET_TABLES;
    if (lvl === 'Lvl 4') return true; // endless: nothing to clear
    return tables.every((boss, bi) => {
      const maxHp = BOSS_HP_MATRIX[lvl][bi];
      const dmg = (assignments[lvl][boss] || []).reduce((s, h) => s + h.dmg, 0);
      return dmg >= maxHp;
    });
  }

  /* hits: [{id, boss, player, chars:[], dmg}]
     tables: ordered list of 5 boss/table names (index maps to BOSS_HP_MATRIX column)
     locked: optional confirmed hits already assigned (excluded from the pool;
             their damage counts toward clears and their usage blocks the commander)
     Returns { assignments, log: [{msg, cls}] } */
  function autoAssign(hits, tables, locked) {
    tables = tables || TARGET_TABLES;
    locked = locked || [];
    const assignments = emptyAssignments();
    const usage = {}; // playerKey -> {count, nikkes:Set}
    for (const h of hits) { const k = playerKey(h.player); if (!usage[k]) usage[k] = { count: 0, nikkes: new Set() }; }
    const assignedIds = new Set();
    const log = [];

    // seed with locked/confirmed hits
    for (const h of locked) {
      const k = playerKey(h.player);
      if (!usage[k]) usage[k] = { count: 0, nikkes: new Set() };
      (assignments[h.lvl][h.boss] ||= []).push(h);
      assignedIds.add(h.id);
      usage[k].count += 1;
      for (const c of h.chars) usage[k].nikkes.add(c);
    }

    const eligible = (h) => {
      if (assignedIds.has(h.id)) return false;
      const u = usage[playerKey(h.player)];
      if (u.count >= MAX_HITS_PER_PLAYER) return false;          // rule 1: max 3 hits per commander
      for (const c of h.chars) if (u.nikkes.has(c)) return false; // rule 2: each nikke on 1 team only
      return true;
    };

    const assign = (lvl, boss, h) => {
      (assignments[lvl][boss] ||= []).push(h);
      assignedIds.add(h.id);
      const u = usage[playerKey(h.player)];
      u.count += 1;
      for (const c of h.chars) u.nikkes.add(c);
    };

    let prevCleared = true;
    for (const lvl of LEVELS) {
      // rule 3 gate: all bosses of previous levels must be 100% cleared
      if (!prevCleared) {
        log.push({ msg: `[!] ${lvl} skipped — previous level not fully cleared.`, cls: 'err' });
        break;
      }

      for (let bi = 0; bi < tables.length; bi++) {
        const boss = tables[bi];
        const maxHp = BOSS_HP_MATRIX[lvl][bi];
        let remaining = maxHp; // 0 => endless

        while (true) {
          const valid = hits.filter((h) => h.boss === boss && h.dmg > 0 && eligible(h));
          if (!valid.length) break;

          let chosen;
          if (maxHp === 0) {
            chosen = valid.reduce((a, b) => (b.dmg > a.dmg ? b : a)); // endless: biggest hits
          } else if (remaining <= 0) {
            break; // rule 4: boss cleared — stop, no overkill padding
          } else {
            const kills = valid.filter((h) => h.dmg >= remaining);
            if (kills.length) chosen = kills.reduce((a, b) => (b.dmg < a.dmg ? b : a)); // least-overkill kill
            else chosen = valid.reduce((a, b) => (b.dmg > a.dmg ? b : a));              // biggest chunk
          }

          assign(lvl, boss, chosen);
          remaining -= chosen.dmg;
          if (maxHp !== 0 && remaining <= 0) break; // boss cleared
        }
      }

      prevCleared = levelCleared(assignments, lvl, tables);
      log.push({
        msg: lvl === 'Lvl 4'
          ? `[*] Lvl 4: endless (no clear gate)`
          : `[*] Lvl ${lvl.slice(4)}: ${prevCleared ? 'ALL BOSSES CLEARED ✓' : 'NOT fully cleared ✗'}`,
        cls: prevCleared ? 'ok' : 'err',
      });
    }

    return { assignments, log };
  }

  function playerUsage(assignments) {
    const used = {};
    for (const l of LEVELS) for (const b of Object.keys(assignments[l] || {})) for (const h of (assignments[l][b] || [])) {
      const k = playerKey(h.player);
      (used[k] ||= { count: 0, nikkes: new Set() });
      used[k].count += 1;
      for (const c of h.chars) used[k].nikkes.add(c);
    }
    return used;
  }

  function hitState(assignments, hit, used) {
    const assignedLvl = LEVELS.find((l) => (assignments[l][hit.boss] || []).some((h) => h.id === hit.id));
    if (assignedLvl) return { kind: 'assigned', lvl: assignedLvl };
    const u = used[playerKey(hit.player)];
    if (u) {
      if (u.count >= MAX_HITS_PER_PLAYER) return { kind: 'conflicted', reason: 'hit cap' };
      if (hit.chars.some((c) => u.nikkes.has(c))) return { kind: 'conflicted', reason: 'nikke used' };
    }
    return { kind: 'free' };
  }

  function optimalKillIds(assignments, hits, tables) {
    tables = tables || TARGET_TABLES;
    const used = playerUsage(assignments);
    const ids = new Set();
    for (let bi = 0; bi < tables.length; bi++) {
      const boss = tables[bi];
      let activeLvl = null, remaining = 0;
      for (const lvl of ['Lvl 1', 'Lvl 2', 'Lvl 3']) {
        const maxHp = BOSS_HP_MATRIX[lvl][bi];
        const dmg = (assignments[lvl][boss] || []).reduce((s, h) => s + h.dmg, 0);
        if (dmg < maxHp) { activeLvl = lvl; remaining = maxHp - dmg; break; }
      }
      if (!activeLvl) continue;
      const candidates = hits.filter((h) => {
        if (h.boss !== boss) return false;
        return hitState(assignments, h, used).kind === 'free' && h.dmg >= remaining && h.dmg > 0;
      });
      if (candidates.length) ids.add(candidates.reduce((a, b) => (b.dmg < a.dmg ? b : a)).id);
    }
    return ids;
  }

  return { TARGET_TABLES, LEVELS, BOSS_HP_MATRIX, MAX_HITS_PER_PLAYER, playerKey, emptyAssignments, levelCleared, autoAssign, playerUsage, hitState, optimalKillIds };
});
