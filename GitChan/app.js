/* Nikke Team Builder — fully offline, data from data.js */
"use strict";
const D = window.DATA;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const ELEMENTS = [...new Set(D.nikkes.map(n => n.element))].sort();
const WEAPONS  = [...new Set(D.nikkes.map(n => n.weapon))].sort();
const byNc = Object.fromEntries(D.nikkes.map(n => [n.nc, n]));

/* special units (data-driven ids from CharacterTable) */
const ALLSTEP_NC = 5101;        // Red Hood — burst 5 in table
const RAPI_RH_NC = 5129;        // Rapi: Red Hood — burst 3, acts as burst 1 if team has no burst 1

/* ---------- state ---------- */
const state = {
  mode: "union", season: 0, boss: 0, diff: "normal", step: 1,
  teams: [],           // array of arrays of {nc, phase}
  teamCfg: [],         // per-team {boss, diff, step} (union: each team may fight a different boss)
  used: new Set(),
  filters: { name: "", burst: new Set(), elem: new Set(), weapon: new Set(), cd: new Set(),
             rare: new Set(), cdr: false, selfcdr: false, treasure: false },
};

/* ---------- badge visibility config (localStorage) ---------- */
const BADGE_CFG_KEY = "badgeCfg";
let badgeCfg = { app: {}, wh: {} };        // label -> false hides it
try { badgeCfg = Object.assign(badgeCfg, JSON.parse(localStorage.getItem(BADGE_CFG_KEY) || "{}")); } catch {}
function saveBadgeCfg() { localStorage.setItem(BADGE_CFG_KEY, JSON.stringify(badgeCfg)); }
function tagVisible(label, ctx) { return badgeCfg[ctx][label] !== false; }
function visibleTags(ph, ctx) { return ph.tags.filter(t => tagVisible(t, ctx)); }
function allBadgeLabels() {
  const s = new Set();
  for (const nk of D.nikkes) {
    (nk.tags || []).forEach(t => s.add(t));
    if (nk.treasure) for (const p of Object.values(nk.treasure.phases)) (p.tags || []).forEach(t => s.add(t));
  }
  return [...s].sort();
}

function teamCount() { return state.mode === "union" ? 3 : 5; }
function resetTeams() {
  state.teams = Array.from({ length: teamCount() }, () => []);
  state.teamCfg = Array.from({ length: teamCount() }, () => ({ boss: 0, diff: "normal", step: 1 }));
  state.used = new Set();
}

/* effective burst steps a unit can fill within a given team */
function burstSteps(nk, team) {
  if (nk.burst === 5) return [1, 2, 3];                       // Red Hood AllStep
  if (nk.nc === RAPI_RH_NC) {
    const otherB1 = team.some(t => t.nc !== nk.nc && byNc[t.nc].burst === 1);
    return otherB1 ? [3] : [1, 3];                            // Rapi RH: B3, or B1 if no B1
  }
  return [nk.burst];
}
function unitPhase(nk, phase) {
  // returns {cd, cdEff, cdr, cdrCond, selfCdr, selfCdrCond, selfCdrPve, selfGate, partyGate, slotCdr, tags}
  const src = (nk.treasure && phase) ? nk.treasure.phases[String(phase)] : nk;
  return { cd: nk.cd, cdEff: src.cdEff, cdr: src.cdr, cdrCond: src.cdrCond,
           selfCdr: src.selfCdr, selfCdrCond: src.selfCdrCond, selfCdrPve: src.selfCdrPve,
           selfGate: src.selfGate, partyGate: src.partyGate,
           slotCdr: src.slotCdr, tags: src.tags };
}

/* ---------- conditional CDR: evaluate the gate against the actual team ---------- */
function gateSatisfied(gate, nk, team, m) {
  if (!gate) return true;
  const others = team.filter(x => x.nc !== m.nc);
  if (gate.kind === "squad")
    return others.some(x => byNc[x.nc].squad && byNc[x.nc].squad === nk.squad);
  if (gate.kind === "noBurst")
    return !others.some(x => burstSteps(byNc[x.nc], team).includes(gate.step));
  if (gate.kind === "hasBurst")
    return others.some(x => burstSteps(byNc[x.nc], team).includes(gate.step));
  return true;
}
function gateText(gate, nk) {
  if (!gate) return "";
  if (gate.kind === "squad") {
    const mates = D.nikkes.filter(x => x.squad && x.squad === nk.squad && x.nc !== nk.nc).map(x => x.name);
    return mates.length ? mates.join(" / ") : "a same-squad ally";
  }
  if (gate.kind === "noBurst") return `no other Burst ${gate.step} on the team`;
  if (gate.kind === "hasBurst") return `a Burst ${gate.step} unit on the team`;
  return "";
}
/* ult cooldown this unit ACTUALLY has in this team */
function effCdInTeam(nk, ph, team, m) {
  if (ph.selfCdrCond && ph.selfGate)
    return gateSatisfied(ph.selfGate, nk, team, m) ? ph.cdEff : ph.cd;
  return ph.cdEff;
}

/* ---------- tabs ---------- */
$$(".tab").forEach(b => b.onclick = () => {
  $$(".tab").forEach(x => x.classList.toggle("active", x === b));
  $("#view-builder").classList.toggle("hidden", b.dataset.tab !== "builder");
  $("#view-monsters").classList.toggle("hidden", b.dataset.tab !== "monsters");
});

/* ---------- builder selects ---------- */
function seasonList() { return state.mode === "union" ? D.union : D.solo; }
function fillSeasons() {
  const sel = $("#sel-season");
  sel.innerHTML = seasonList().map((s, i) => `<option value="${i}">Season ${s.season}</option>`).join("");
  state.season = seasonList().length - 1;   // default: latest season
  sel.value = state.season;
  fillBosses();
}
function currentSeason() { return seasonList()[state.season]; }
function bossSteps(b, diff) { return (b && b[diff] && b[diff].length) ? b[diff] : (b ? b[diff === "hard" ? "normal" : "hard"] || [] : []); }
function fillBosses() {
  // union: each team picks its own boss/difficulty/step (3 attempts vs any bosses)
  const perTeam = state.mode === "union";
  $("#wrap-boss").classList.add("hidden");
  $("#wrap-diff").classList.add("hidden");
  $("#wrap-step").classList.add("hidden");
  $("#boss-info").classList.toggle("hidden", perTeam);
  if (!perTeam) {
    const ch = currentSeason().challenge;
    $("#boss-info").innerHTML = ch ? bossHtml(ch.name + " (Challenge)", ch.lv, ch.monsters) : "";
  }
  renderTeams();
}
function fillSteps() {
  const b = currentBoss();
  const steps = bossSteps(b, state.diff);
  state.step = Math.min(Math.max(state.step, 1), steps.length) || 1;
  $("#sel-step").innerHTML = steps.map(st => `<option value="${st.step}">Step ${st.step} (Lv ${st.lv})</option>`).join("");
  $("#sel-step").value = state.step;
}
function currentBoss() { return state.mode === "union" ? currentSeason().bosses[state.boss] : null; }
function currentStep() {
  const b = currentBoss();
  const steps = bossSteps(b, state.diff);
  return steps.find(st => st.step === state.step) || steps[steps.length - 1] || null;
}
function renderBossInfo() {
  const el = $("#boss-info");
  if (state.mode === "union") {
    const b = currentBoss(), st = currentStep();
    el.innerHTML = st ? bossHtml(b.name, st.lv, st.monsters) : bossHtml(b.name, null, []);
  } else {
    const ch = currentSeason().challenge;
    el.innerHTML = ch ? bossHtml(ch.name + " (Challenge)", ch.lv, ch.monsters) : "";
  }
}
function bossHtml(name, lv, keys) {
  const mons = (keys || []).map(k => D.monsters[k]).filter(Boolean);
  const dots = mons.map(m => `<span class="muted"><span class="elem-dot" style="background:${m.color}"></span>${m.name}</span>`).join(" ");
  return `<b style="color:var(--text)">${name}</b> <span class="muted">Lv ${lv}</span> ${dots}`;
}

$("#sel-mode").onchange = e => { state.mode = e.target.value; resetTeams(); fillSeasons(); renderGrid(); renderShareSel(); };
$("#sel-season").onchange = e => { state.season = +e.target.value; state.boss = 0;
  state.teamCfg.forEach(c => { c.boss = 0; c.step = 1; }); fillBosses(); };

/* ---------- teams ---------- */
function renderTeams() {
  while (state.teams.length < teamCount()) { state.teams.push([]); state.teamCfg.push({ boss: 0, diff: "normal", step: 1 }); }
  state.teams.length = teamCount(); state.teamCfg.length = teamCount();
  const wrap = $("#teams");
  wrap.innerHTML = "";
  state.teams.forEach((team, ti) => {
    const cfg = state.teamCfg[ti];
    const div = document.createElement("div");
    div.className = "team"; div.dataset.team = ti;
    let head = `<h3>Team ${ti + 1}<span class="muted">${team.length}/5</span></h3>`;
    if (state.mode === "union") {
      const s = currentSeason();
      cfg.boss = Math.min(cfg.boss, s.bosses.length - 1);
      const steps = bossSteps(s.bosses[cfg.boss], cfg.diff);
      cfg.step = Math.min(Math.max(cfg.step, 1), steps.length) || 1;
      const st = steps.find(x => x.step === cfg.step) || steps[0];
      head = `<div class="team-head"><span class="team-title">Team ${ti + 1} <span class="muted">${team.length}/5</span></span>
        <select class="t-sel t-sel-boss">${s.bosses.map((b, i) => `<option value="${i}"${i === cfg.boss ? " selected" : ""}>Boss ${b.order} — ${b.name}</option>`).join("")}</select>
        <select class="t-sel t-sel-diff"><option value="normal"${cfg.diff === "normal" ? " selected" : ""}>Normal</option><option value="hard"${cfg.diff === "hard" ? " selected" : ""}>Hard</option></select>
        <select class="t-sel t-sel-step">${steps.map(x => `<option value="${x.step}"${x.step === cfg.step ? " selected" : ""}>Step ${x.step} (Lv ${x.lv})</option>`).join("")}</select>
        <span class="muted team-boss-info">${st ? bossHtml(s.bosses[cfg.boss].name, st.lv, st.monsters) : ""}</span></div>`;
    }
    div.innerHTML = head + `<div class="team-slots"></div>`;
    if (state.mode === "union") {
      div.querySelector(".t-sel-boss").onchange = e => { cfg.boss = +e.target.value; cfg.step = 1; renderTeams(); };
      div.querySelector(".t-sel-diff").onchange = e => { cfg.diff = e.target.value; cfg.step = 1; renderTeams(); };
      div.querySelector(".t-sel-step").onchange = e => { cfg.step = +e.target.value; renderTeams(); };
    }
    const slots = div.querySelector(".team-slots");
    if (!team.length) slots.innerHTML = `<div class="team-empty">drag Nikkes here</div>`;
    team.forEach((m, si) => {
      const nk = byNc[m.nc];
      const ph = unitPhase(nk, m.phase);
      const row = document.createElement("div");
      row.className = "team-slot"; row.draggable = true;
      const team = state.teams[ti];
      const cd = effCdInTeam(nk, ph, team, m);
      const cdNote = ph.selfCdrCond ? (gateSatisfied(ph.selfGate, nk, team, m) ? " ✓" : " ✗") : "";
      row.innerHTML = `${nk.icon ? `<img src="${nk.icon}">` : ""}
        <div class="ts-name">${nk.name}${m.phase ? ` <span style="color:var(--warn)">P${m.phase}</span>` : ""}</div>
        <div class="ts-sub">B${nk.burst === 5 ? "★" : nk.burst} | ${nk.weapon} | ${cd}s${cdNote}</div>
        <div class="ts-tags">${visibleTags(ph, "app").slice(0, 3).map(t => `<span class="tag${t.startsWith("CDR") ? " cdr" : t.startsWith("Self CDR") ? " selfcdr" : ""}">${t}</span>`).join("")}</div>
        <span class="ts-x" title="remove">✕</span>`;
      row.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/x-move", JSON.stringify({ from: ti, idx: si }));
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", clearDropMarks);
      row.addEventListener("dragover", e => {
        if (!e.dataTransfer.types.includes("text/x-move")) return;
        e.preventDefault(); e.stopPropagation();
        const before = isBeforeInRow(e, row);
        row.classList.toggle("drop-before", before);
        row.classList.toggle("drop-after", !before);
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
      row.addEventListener("drop", e => {
        const mv = e.dataTransfer.getData("text/x-move");
        if (!mv) return;                 // grid-copy drops fall through to the team handler
        e.preventDefault(); e.stopPropagation();
        row.classList.remove("drop-before", "drop-after");
        const { from, idx } = JSON.parse(mv);
        if (from === ti && idx === si) { renderAll(); return; }   // dropped on self
        const before = isBeforeInRow(e, row);
        let to = si + (before ? 0 : 1);
        const member = state.teams[from].splice(idx, 1)[0];
        if (from === ti && idx < to) to -= 1;
        state.teams[ti].splice(to, 0, member);
        renderAll();
      });
      row.querySelector(".ts-x").onclick = () => removeMember(ti, si);
      attachTooltip(row, nk, m.phase, { team, m });
      slots.appendChild(row);
    });
    div.addEventListener("dragover", e => { e.preventDefault(); div.classList.add("drag-over"); });
    div.addEventListener("dragleave", ev => { if (!div.contains(ev.relatedTarget)) div.classList.remove("drag-over"); });
    div.addEventListener("drop", e => {
      if (e.target.closest(".team-slot")) return;   // slot handler already handled it
      e.preventDefault(); div.classList.remove("drag-over");
      const mv = e.dataTransfer.getData("text/x-move");
      if (mv) {
        // dropped on team padding (not a slot): cross-team append, same-team move to end
        const { from, idx } = JSON.parse(mv);
        const member = state.teams[from].splice(idx, 1)[0];
        state.teams[ti].push(member);
      } else {
        const add = JSON.parse(e.dataTransfer.getData("text/plain") || "null");
        if (add && state.teams[ti].length < 5 && !state.used.has(add.nc)) {
          state.teams[ti].push(add); state.used.add(add.nc);
        }
      }
      renderAll();
    });
    wrap.appendChild(div);
  });
  renderWarnings();
}
function isBeforeInRow(e, row) {
  const r = row.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2;
}
function clearDropMarks() {
  $$(".team-slot").forEach(s => s.classList.remove("drop-before", "drop-after"));
  $$(".team").forEach(t => t.classList.remove("drag-over"));
}
function removeMember(ti, si) {
  const m = state.teams[ti].splice(si, 1)[0];
  if (m && !state.teams.some(t => t.some(x => x.nc === m.nc))) state.used.delete(m.nc);
  renderAll();
}

/* ---------- warnings ---------- */
function teamWarnings(team) {
  const out = [];
  if (!team.length) return out;
  const units = team.map(m => ({ nk: byNc[m.nc], m, ph: unitPhase(byNc[m.nc], m.phase) }));
  for (const u of units) u.cd = effCdInTeam(u.nk, u.ph, team, u.m);
  for (let step = 1; step <= 3; step++) {
    const fillers = units.filter(u => burstSteps(u.nk, team).includes(step));
    if (!fillers.length) { out.push({ lvl: "bad", t: `No Burst ${step} unit` }); continue; }
    if (fillers.length === 1 && fillers[0].cd >= 40)
      out.push({ lvl: "warn", t: `Only Burst ${step} unit is ${fillers[0].cd}s (${fillers[0].nk.name})` });
    if (step === 2 && fillers.length && fillers.every(u => u.cd >= 40))
      out.push({ lvl: "warn", t: `All Burst 2 units are 40s+ — slow rotation` });
  }
  // conditional CDR: evaluate each unit's gate against THIS team
  for (const u of units) {
    if (u.ph.selfCdrCond && u.ph.selfGate) {
      const req = gateText(u.ph.selfGate, u.nk);
      if (gateSatisfied(u.ph.selfGate, u.nk, team, u.m))
        out.push({ lvl: "good", t: `${u.nk.name}: Self CDR active (${u.ph.cd}s → ${u.ph.cdEff}s)` });
      else
        out.push({ lvl: "warn", t: `${u.nk.name} Self CDR NOT active — needs ${req}; she is a ${u.ph.cd}s burst without it` });
    }
    if (u.ph.cdrCond && u.ph.partyGate) {
      const req = gateText(u.ph.partyGate, u.nk);
      if (gateSatisfied(u.ph.partyGate, u.nk, team, u.m))
        out.push({ lvl: "good", t: `${u.nk.name}: party CDR active` });
      else
        out.push({ lvl: "warn", t: `${u.nk.name} party CDR NOT active — requires ${req}` });
    }
  }
  if (!units.some(u => u.ph.cdr || u.ph.selfCdr)) out.push({ lvl: "warn", t: "No CDR unit (burst cooldown reduction)" });
  const b3 = units.filter(u => burstSteps(u.nk, team).includes(3));
  if (b3.length === 1 && b3[0].cd === 60)
    out.push({ lvl: "warn", t: `Single Burst 3 unit on 60s cooldown (${b3[0].nk.name})` });
  if (!out.length) out.push({ lvl: "good", t: "Team OK" });
  return out;
}
function renderWarnings() {
  const wrap = $("#warnings");
  wrap.innerHTML = "";
  state.teams.forEach((team, ti) => {
    if (!team.length) return;
    for (const w of teamWarnings(team)) {
      const d = document.createElement("div");
      d.className = "warn " + (w.lvl === "bad" ? "bad" : w.lvl === "good" ? "good" : "");
      d.textContent = `Team ${ti + 1}: ${w.t}`;
      wrap.appendChild(d);
    }
  });
}

/* ---------- grid ---------- */
function variants(nk) {
  if (!nk.treasure) return [{ nc: nk.nc, phase: null, label: "" }];
  return [{ nc: nk.nc, phase: null, label: "" },
          { nc: nk.nc, phase: 1, label: "P1" },
          { nc: nk.nc, phase: 2, label: "P2" },
          { nc: nk.nc, phase: 3, label: "P3" }];
}
function matches(nk, v) {
  const f = state.filters;
  if (f.name && !nk.name.toLowerCase().includes(f.name)) return false;
  if (f.burst.size && !f.burst.has(String(nk.burst))) return false;
  if (f.elem.size && !f.elem.has(nk.element)) return false;
  if (f.weapon.size && !f.weapon.has(nk.weapon)) return false;
  if (f.rare.size && !f.rare.has(nk.rare)) return false;
  if (f.treasure && !nk.treasure) return false;
  const ph = unitPhase(nk, v && v.phase);   // per-variant attributes
  if (f.cd.size) {
    const key = ph.cdEff === 20 ? "20" : ph.cdEff === 40 ? "40" : "other";
    if (!f.cd.has(key)) return false;
  }
  if (f.cdr && !ph.cdr) return false;
  if (f.selfcdr && !ph.selfCdr) return false;
  return true;
}
function renderGrid() {
  const grid = $("#grid");
  grid.innerHTML = "";
  let count = 0;
  for (const nk of D.nikkes) {
    for (const v of variants(nk)) {
      if (!matches(nk, v)) continue;
      count++;
      const ph = unitPhase(nk, v.phase);
      const card = document.createElement("div");
      card.className = "card" + (state.used.has(nk.nc) ? " used" : "");
      card.draggable = !state.used.has(nk.nc);
      const bLabel = nk.burst === 5 ? "★" : nk.burst;
      card.innerHTML = `<span class="bstep b${nk.burst}">B${bLabel}</span>
        ${v.label ? `<span class="phase-badge">${v.label}</span>` : ""}
        ${nk.icon ? `<img src="${nk.icon}" loading="lazy">` : ""}
        <div class="c-name">${nk.name}</div>
        <div class="c-sub">${nk.weapon} · ${ph.cdEff}s · <span style="color:${nk.color}">${nk.element}</span></div>
        <div class="c-tags">${nk.treasure ? '<span class="tag treasure">TREASURE</span>' : ""}
          ${ph.tags.slice(0, 3).map(t => `<span class="tag${t.startsWith("CDR") ? " cdr" : t.startsWith("Self CDR") ? " selfcdr" : ""}">${t}</span>`).join("")}</div>`;
      card.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/plain", JSON.stringify(v));
        e.dataTransfer.effectAllowed = "copy";
      });
      attachTooltip(card, nk, v.phase);
      grid.appendChild(card);
    }
  }
  $("#grid-count").textContent = `${count} cards`;
}
/* drag a team member onto the grid to remove it */
$("#grid").addEventListener("dragover", e => { if (e.dataTransfer.types.includes("text/x-move")) e.preventDefault(); });
$("#grid").addEventListener("drop", e => {
  const mv = e.dataTransfer.getData("text/x-move");
  if (!mv) return;
  e.preventDefault();
  const { from, idx } = JSON.parse(mv);
  removeMember(from, idx);
});

/* ---------- tooltip ---------- */
const tip = $("#tooltip");
function attachTooltip(el, nk, phase, teamCtx) {
  el.addEventListener("mouseenter", e => { showTip(nk, phase, e, teamCtx); });
  el.addEventListener("mousemove", e => posTip(e));
  el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
}
function showTip(nk, phase, e, teamCtx) {
  let skills, replaced = [];
  if (nk.treasure && phase) {
    const p = nk.treasure.phases[String(phase)];
    skills = p.skills; replaced = p.replaced;
  } else skills = nk.skills.base;
  const ph = unitPhase(nk, phase);
  const names = ["Skill 1", "Skill 2", "Ultimate"];
  let cdLine;
  if (ph.selfCdrCond && ph.selfGate && teamCtx) {
    const ok = gateSatisfied(ph.selfGate, nk, teamCtx.team, teamCtx.m);
    cdLine = ok ? `Ult <b style="color:var(--good)">${ph.cdEff}s</b> (Self CDR active, ${ph.cd}s base)`
                : `Ult <b style="color:var(--bad)">${ph.cd}s</b> — Self CDR needs ${gateText(ph.selfGate, nk)}`;
  } else cdLine = `Ult ${ph.cdEff !== ph.cd ? `${ph.cdEff}s (${ph.cd}s base)` : ph.cd + "s"}`;
  tip.innerHTML = `<h4>${nk.name}${nk.treasure ? ` — ${nk.treasure.name}${phase ? " P" + phase : " (no treasure)"}` : ""}</h4>
    <div class="t-sub">${nk.rare} ${nk.cls} · ${nk.element} · ${nk.weapon} · Burst ${nk.burst === 5 ? "AllStep" : nk.burst} · ${cdLine}${ph.selfCdr && !ph.selfCdrCond ? ` · Self CDR${ph.selfCdrPve ? " (PvE: procs vs Raptures / monster content)" : ""}` : ""}${ph.cdr ? ` · CDR${ph.cdrCond ? `* (${gateSatisfied(ph.partyGate, nk, teamCtx?.team || [], teamCtx?.m || {nc:-1}) ? "active" : "needs " + gateText(ph.partyGate, nk)})` : ""}` : ""}</div>
    ${skills.map((s, i) => s ? `<div class="t-skill"><b>${names[i]}: ${s.n}${replaced.includes(names[i]) ? '<span class="t-new">REPLACED BY TREASURE</span>' : ""}${ph.slotCdr && ph.slotCdr[i] === 1 ? '<span class="t-cdr">CDR</span>' : ""}${ph.slotCdr && ph.slotCdr[i] === 2 ? '<span class="t-cdr">SELF CDR</span>' : ""}</b><p>${s.d || "—"}</p></div>` : "").join("")}`;
  tip.classList.remove("hidden");
  posTip(e);
}
function posTip(e) {
  const pad = 14, r = tip.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = Math.max(8, e.clientY - r.height - pad);
  tip.style.left = x + "px"; tip.style.top = y + "px";
}

/* ---------- filters ---------- */
$("#f-name").oninput = e => { state.filters.name = e.target.value.trim().toLowerCase(); renderGrid(); };
function bindChips(sel, set) {
  $$(sel + " .chip").forEach(c => c.onclick = () => {
    const v = c.dataset.v;
    set.has(v) ? set.delete(v) : set.add(v);
    c.classList.toggle("on");
    renderGrid();
  });
}
$("#f-elem").innerHTML = ELEMENTS.map(e => `<button class="chip" data-v="${e}">${e}</button>`).join("");
$("#f-weapon").innerHTML = WEAPONS.map(w => `<button class="chip" data-v="${w}">${w}</button>`).join("");
bindChips("#f-burst", state.filters.burst);
bindChips("#f-elem", state.filters.elem);
bindChips("#f-weapon", state.filters.weapon);
bindChips("#f-cd", state.filters.cd);
bindChips("#f-rare", state.filters.rare);
$("#f-cdr").onclick = e => { state.filters.cdr = !state.filters.cdr; e.target.classList.toggle("on", state.filters.cdr); renderGrid(); };
$("#f-selfcdr").onclick = e => { state.filters.selfcdr = !state.filters.selfcdr; e.target.classList.toggle("on", state.filters.selfcdr); renderGrid(); };
$("#f-treasure").onclick = e => { state.filters.treasure = !state.filters.treasure; e.target.classList.toggle("on", state.filters.treasure); renderGrid(); };
$("#btn-clear").onclick = () => { resetTeams(); renderAll(); };

/* ---------- badge visibility UI ---------- */
$("#badges-btn").onclick = () => { renderBadgeCfg(); $("#badge-modal").classList.remove("hidden"); };
$("#badge-close").onclick = () => $("#badge-modal").classList.add("hidden");
$("#badge-all").onclick = () => { badgeCfg = { app: {}, wh: {} }; saveBadgeCfg(); renderBadgeCfg(); renderTeams(); renderGrid(); };
function renderBadgeCfg() {
  const list = $("#badge-cfg-list");
  list.innerHTML = "";
  for (const label of allBadgeLabels()) {
    const row = document.createElement("div");
    row.className = "badge-cfg-row";
    row.innerHTML = `<span class="tag${label.startsWith("CDR") ? " cdr" : label.startsWith("Self CDR") ? " selfcdr" : ""}">${label}</span>
      <span><input type="checkbox" data-ctx="app"${tagVisible(label, "app") ? " checked" : ""}></span>
      <span><input type="checkbox" data-ctx="wh"${tagVisible(label, "wh") ? " checked" : ""}></span>`;
    row.querySelectorAll("input").forEach(cb => cb.onchange = () => {
      const ctx = cb.dataset.ctx;
      if (cb.checked) delete badgeCfg[ctx][label]; else badgeCfg[ctx][label] = false;
      saveBadgeCfg(); renderTeams(); renderGrid();
    });
    list.appendChild(row);
  }
}

/* ---------- Discord webhook ---------- */
$("#webhook-btn").onclick = () => { $("#wh-url").value = localStorage.getItem("whUrl") || ""; $("#wh-modal").classList.remove("hidden"); };
$("#wh-close").onclick = () => $("#wh-modal").classList.add("hidden");
$("#wh-save").onclick = () => { localStorage.setItem("whUrl", $("#wh-url").value.trim()); toast("Webhook saved"); $("#wh-modal").classList.add("hidden"); };
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); setTimeout(() => t.classList.add("hidden"), 2500); }

function renderShareSel() {
  const sel = $("#sel-share-team");
  sel.innerHTML = `<option value="-1">All teams</option>` +
    state.teams.map((_, i) => `<option value="${i}">Team ${i + 1}</option>`).join("");
}

/* render selected teams to a canvas image — mirrors the in-app card design */
const FONT = "'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif";
function pill(ctx, text, x, y, fg, bg, border) {
  ctx.font = `800 11px ${FONT}`;
  const w = ctx.measureText(text).width + 12, h = 18;
  ctx.fillStyle = bg; ctx.strokeStyle = border; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = fg; ctx.textAlign = "center";
  ctx.fillText(text, x + w / 2, y + 13);
  ctx.textAlign = "left";
  return w;
}
async function renderTeamsCanvas(teamIdxs) {
  const S = 2;                                  // supersample for crisp text
  const W = 1080, headH = 84, cardW = 190, cardH = 176, gap = 12, pad = 18;
  const teamH = 40 + cardH + pad;
  const H = headH + teamIdxs.length * (teamH + 12) + 16;
  const cv = document.createElement("canvas");
  cv.width = W * S; cv.height = H * S;
  const ctx = cv.getContext("2d");
  ctx.scale(S, S);
  // background like the app
  const grad = ctx.createRadialGradient(W * 0.8, -100, 50, W * 0.8, -100, 900);
  grad.addColorStop(0, "#1a2340"); grad.addColorStop(1, "#0b0e14");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  const s = currentSeason();
  ctx.fillStyle = "#5b8cff"; ctx.font = `bold 26px ${FONT}`;
  ctx.fillText("◈ Nikke Team Builder", 24, 40);
  ctx.fillStyle = "#8a94a8"; ctx.font = `600 15px ${FONT}`;
  ctx.fillText(`${state.mode === "union" ? "Union Raid" : "Solo Raid"}  ·  Season ${s.season}` +
    (state.mode === "solo" ? `  ·  ${s.challenge?.name || ""} (Challenge)` : ""), 24, 66);

  let y = headH;
  for (const ti of teamIdxs) {
    // team panel
    ctx.fillStyle = "#151a26"; ctx.strokeStyle = "#232b3d"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(20, y, W - 40, teamH, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#8a94a8"; ctx.font = `800 13px ${FONT}`;
    const cfg = state.teamCfg[ti] || { boss: 0, diff: "normal", step: 1 };
    let teamLabel = `TEAM ${ti + 1}`;
    if (state.mode === "union") {
      const b = s.bosses[cfg.boss];
      const steps = bossSteps(b, cfg.diff);
      const st = steps.find(x => x.step === cfg.step) || steps[0];
      teamLabel = `TEAM ${ti + 1} — ${b.name} · ${cfg.diff === "hard" ? "Hard" : "Normal"} · Step ${st ? st.step : cfg.step} (Lv ${st ? st.lv : "?"})`;
    }
    ctx.fillText(teamLabel, 20 + pad, y + 26);
    const warns = teamWarnings(state.teams[ti]).filter(w => w.lvl !== "good");
    ctx.font = `700 11px ${FONT}`;
    let wx = 20 + pad + ctx.measureText(teamLabel).width + 24;
    for (const w of warns.slice(0, 2)) {
      ctx.font = `700 11px ${FONT}`;
      const tw = ctx.measureText(w.t).width + 14;
      if (wx + tw < W - 40 - pad) {
        const c = w.lvl === "bad" ? ["#ff5d73", "#ff5d7312", "#ff5d7344"] : ["#e8b84b", "#e8b84b12", "#e8b84b44"];
        wx += pill(ctx, "⚠ " + w.t, wx, y + 12, c[0], c[1], c[2]) + 6;
      }
    }
    // member cards
    let x = 20 + pad;
    const cy = y + 40;
    for (const m of state.teams[ti]) {
      const nk = byNc[m.nc];
      const ph = unitPhase(nk, m.phase);
      const cdNow = effCdInTeam(nk, ph, state.teams[ti], m);
      ctx.fillStyle = "#1a2030"; ctx.strokeStyle = "#232b3d";
      ctx.beginPath(); ctx.roundRect(x, cy, cardW, cardH, 10); ctx.fill(); ctx.stroke();
      // icon
      const ix = x + (cardW - 96) / 2;
      if (nk.icon) {
        const img = await loadImg(nk.icon);
        if (img) { ctx.save(); ctx.beginPath(); ctx.roundRect(ix, cy + 8, 96, 96, 8); ctx.clip();
          ctx.drawImage(img, ix, cy + 8, 96, 96); ctx.restore(); }
      }
      // burst badge
      ctx.fillStyle = "#0b0e14cc"; ctx.strokeStyle = "#232b3d";
      ctx.beginPath(); ctx.roundRect(x + 6, cy + 6, 30, 20, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = nk.burst === 5 ? "#9a6bff" : "#e6eaf2"; ctx.font = `900 12px ${FONT}`;
      ctx.fillText("B" + (nk.burst === 5 ? "★" : nk.burst), x + 12, cy + 20);
      // name
      ctx.fillStyle = "#e6eaf2"; ctx.font = `700 13px ${FONT}`; ctx.textAlign = "center";
      let nm = nk.name + (m.phase ? ` P${m.phase}` : "");
      while (ctx.measureText(nm).width > cardW - 12 && nm.length > 4) nm = nm.slice(0, -2) + "…";
      ctx.fillText(nm, x + cardW / 2, cy + 122);
      // sub line with element color
      ctx.font = `600 11px ${FONT}`;
      const sub = `${nk.weapon} · ${cdNow !== ph.cd ? cdNow + "s" : ph.cd + "s"} · `;
      const subW = ctx.measureText(sub).width, elW = ctx.measureText(nk.element).width;
      const sx = x + (cardW - (subW + elW)) / 2;
      ctx.textAlign = "left";
      ctx.fillStyle = "#8a94a8"; ctx.fillText(sub, sx, cy + 140);
      ctx.fillStyle = nk.color; ctx.fillText(nk.element, sx + subW, cy + 140);
      // tags row
      let tx = x + 8;
      const tags = [];
      if (nk.treasure && tagVisible("TREASURE", "wh")) tags.push(["TREASURE", "#e8b84b", "#e8b84b22", "#e8b84b33"]);
      for (const t of visibleTags(ph, "wh").slice(0, 3)) {
        const c = t.startsWith("CDR") ? ["#3ecf8e", "#3ecf8e22", "#3ecf8e33"]
                : t.startsWith("Self CDR") ? ["#4fc3f7", "#4fc3f722", "#4fc3f733"]
                : ["#5b8cff", "#5b8cff22", "#5b8cff33"];
        tags.push([t, ...c]);
      }
      for (const [label, fg, bg, bd] of tags) {
        const used = pill(ctx, label, tx, cy + 150, fg, bg, bd);
        tx += used + 4;
        if (tx > x + cardW - 20) break;
      }
      ctx.textAlign = "left";
      x += cardW + gap;
    }
    y += teamH + 12;
  }
  return cv;
}
function loadImg(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

$("#btn-share").onclick = async () => {
  const url = localStorage.getItem("whUrl");
  if (!url) { $("#wh-modal").classList.remove("hidden"); return; }
  const sel = +$("#sel-share-team").value;
  const idxs = sel === -1 ? state.teams.map((_, i) => i).filter(i => state.teams[i].length) : [sel];
  if (!idxs.length || idxs.every(i => !state.teams[i].length)) { toast("No teams to share"); return; }
  try {
    const cv = await renderTeamsCanvas(idxs);
    const blob = await new Promise(res => cv.toBlob(res, "image/png"));
    const s = currentSeason();
    const fd = new FormData();
    fd.append("file", blob, "teams.png");
    fd.append("payload_json", JSON.stringify({
      content: `**${state.mode === "union" ? "Union Raid" : "Solo Raid"}** — Season ${s.season}`,
    }));
    const r = await fetch(url, { method: "POST", body: fd });
    toast(r.ok ? "Shared to Discord ✓" : `Discord error ${r.status}`);
  } catch (err) { toast("Failed: " + err.message); }
};

/* ---------- monster list ---------- */
const mstate = { mode: "union", season: 0, boss: 0, step: 1 };
function mSeasonList() { return mstate.mode === "union" ? D.union : D.solo; }
function mFillSeasons() {
  $("#m-sel-season").innerHTML = mSeasonList().map((s, i) => `<option value="${i}">Season ${s.season}</option>`).join("");
  mstate.season = mSeasonList().length - 1;   // default: latest season
  $("#m-sel-season").value = mstate.season;
  mFillBosses();
}
function mFillBosses() {
  const s = mSeasonList()[mstate.season];
  let opts = [];
  $("#m-wrap-diff").classList.toggle("hidden", mstate.mode !== "union");
  $("#m-wrap-step").classList.toggle("hidden", mstate.mode !== "union");
  if (mstate.mode === "union")
    s.bosses.forEach((b, i) => opts.push([i, `Boss ${b.order} — ${b.name}`]));
  else {
    s.levels.forEach((l, i) => opts.push([i, `Level ${l.order} — ${l.name} (Lv ${l.lv})`]));
    if (s.challenge) opts.push([99, `Challenge — ${s.challenge.name} (Lv ${s.challenge.lv})`]);
  }
  $("#m-sel-boss").innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  mstate.boss = 0; $("#m-sel-boss").value = opts[0]?.[0] ?? 0;
  mFillSteps();
}
function mFillSteps() {
  if (mstate.mode !== "union") return;
  const b = mSeasonList()[mstate.season].bosses[mstate.boss];
  const steps = bossSteps(b, state.diff);
  mstate.step = Math.min(Math.max(mstate.step, 1), steps.length) || 1;
  $("#m-sel-step").innerHTML = steps.map(st => `<option value="${st.step}">Step ${st.step} (Lv ${st.lv})</option>`).join("");
  $("#m-sel-step").value = mstate.step;
}
$("#m-sel-mode").onchange = e => {
  mstate.mode = e.target.value; mstate.season = 0;
  mFillSeasons();
};
$("#m-sel-diff").onchange = e => { state.diff = e.target.value; mFillSteps(); mRender(); };
$("#m-sel-step").onchange = e => { mstate.step = +e.target.value; mRender(); };
$("#m-sel-season").onchange = e => { mstate.season = +e.target.value; mFillBosses(); };
$("#m-sel-boss").onchange = e => { mstate.boss = +e.target.value; mFillSteps(); mRender(); };

function mKeys() {
  const s = mSeasonList()[mstate.season];
  if (mstate.mode === "union") {
    const b = s.bosses[mstate.boss];
    const steps = bossSteps(b, state.diff);
    const st = steps.find(x => x.step === mstate.step) || steps[steps.length - 1] || null;
    return { name: b.name, lv: st ? st.lv : null, keys: st ? st.monsters : [] };
  }
  const item = mstate.boss === 99 ? s.challenge : s.levels[mstate.boss];
  return { name: item.name + (mstate.boss === 99 ? " (Challenge)" : ""), lv: item.lv, keys: item.monsters };
}
function mRender() {
  const wrap = $("#monster-detail");
  const { name, lv, keys } = mKeys();
  const mons = (keys || []).map(k => D.monsters[k]).filter(Boolean);
  wrap.innerHTML = `<h3 class="sec">${name} — Lv ${lv}</h3>` + (mons.length ? "" : `<p class="muted">No monster data for this wave.</p>`);
  for (const m of mons) {
    const stats = Object.entries(m.statsByLv || {}).map(([l, v]) =>
      `<div class="mon-stat"><span>Lv ${l}</span><b>${fmt(v.hp)} HP</b><span>ATK ${fmt(v.atk)} · DEF ${fmt(v.def)}</span></div>`).join("");
    const div = document.createElement("div");
    div.className = "mon-card";
    div.innerHTML = `
      <div class="mon-head"><h2><span class="elem-dot" style="background:${m.color}"></span>${m.name}</h2>
        <span class="muted">${m.element} · Grade ${m.grade} · Resist E ${m.resist.energy}% / M ${m.resist.metal}% / B ${m.resist.bio}%</span></div>
      ${m.desc ? `<p class="mon-desc" style="margin-top:8px">${m.desc}</p>` : ""}
      <div class="mon-stats">${stats}</div>
      <div class="mon-cols">
        <div><h3 class="sec">Skills</h3><div class="mon-list">
          ${m.skills.map(s => `<div class="mon-skill"><b>${s.n || "Skill"}${s.w ? ` <span class="muted">(${s.w})</span>` : ""}</b><p>${s.d || "—"}</p></div>`).join("") || '<p class="muted">—</p>'}
        </div></div>
        <div><h3 class="sec">Parts</h3><div class="mon-list">
          ${m.parts.map(p => `<div class="mon-skill"><b>${p.n}</b><p>HP ${p.hp}% · DEF ${p.def}%${p.breakable ? " · <span style=\"color:var(--warn)\">breakable</span>" : ""}</p></div>`).join("") || '<p class="muted">Single body</p>'}
        </div></div>
      </div>`;
    wrap.appendChild(div);
  }
}
function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

/* ---------- boot ---------- */
function renderAll() { renderTeams(); renderGrid(); }
resetTeams();
fillSeasons();
renderGrid();
renderShareSel();
mFillSeasons();
