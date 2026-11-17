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
  used: new Set(),
  filters: { name: "", burst: new Set(), elem: new Set(), weapon: new Set(), cdr: false, treasure: false },
};

function teamCount() { return state.mode === "union" ? 3 : 5; }
function resetTeams() {
  state.teams = Array.from({ length: teamCount() }, () => []);
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
  // returns {cd, cdr, cdrCond, tags} for the selected treasure phase
  if (nk.treasure && phase) {
    const p = nk.treasure.phases[String(phase)];
    return { cd: nk.cd, cdr: p.cdr, cdrCond: p.cdrCond, tags: p.tags };
  }
  return { cd: nk.cd, cdr: nk.cdr, cdrCond: nk.cdrCond, tags: nk.tags };
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
  const s = currentSeason();
  const wrapBoss = $("#wrap-boss"), wrapDiff = $("#wrap-diff"), wrapStep = $("#wrap-step");
  if (state.mode === "union") {
    wrapBoss.classList.remove("hidden"); wrapDiff.classList.remove("hidden"); wrapStep.classList.remove("hidden");
    $("#sel-boss").innerHTML = s.bosses.map((b, i) => `<option value="${i}">Boss ${b.order} — ${b.name}</option>`).join("");
    state.boss = Math.min(state.boss, s.bosses.length - 1);
    $("#sel-boss").value = state.boss;
    fillSteps();
  } else {
    wrapBoss.classList.add("hidden"); wrapDiff.classList.add("hidden"); wrapStep.classList.add("hidden");
  }
  renderBossInfo(); renderTeams();
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
$("#sel-season").onchange = e => { state.season = +e.target.value; state.boss = 0; fillBosses(); };
$("#sel-boss").onchange = e => { state.boss = +e.target.value; fillSteps(); renderBossInfo(); };
$("#sel-diff").onchange = e => { state.diff = e.target.value; fillSteps(); renderBossInfo(); };
$("#sel-step").onchange = e => { state.step = +e.target.value; renderBossInfo(); };

/* ---------- teams ---------- */
function renderTeams() {
  while (state.teams.length < teamCount()) state.teams.push([]);
  state.teams.length = teamCount();
  const wrap = $("#teams");
  wrap.innerHTML = "";
  state.teams.forEach((team, ti) => {
    const div = document.createElement("div");
    div.className = "team"; div.dataset.team = ti;
    div.innerHTML = `<h3>Team ${ti + 1}<span class="muted">${team.length}/${5}</span></h3><div class="team-slots"></div>`;
    const slots = div.querySelector(".team-slots");
    if (!team.length) slots.innerHTML = `<div class="team-empty">drag Nikkes here</div>`;
    team.forEach((m, si) => {
      const nk = byNc[m.nc];
      const ph = unitPhase(nk, m.phase);
      const row = document.createElement("div");
      row.className = "team-slot"; row.draggable = true;
      row.innerHTML = `${nk.icon ? `<img src="${nk.icon}">` : ""}
        <div class="ts-name">${nk.name}${m.phase ? ` <span style="color:var(--warn)">P${m.phase}</span>` : ""}</div>
        <div class="ts-sub">B${nk.burst === 5 ? "★" : nk.burst} | ${nk.weapon} | ${ph.cd}s</div>
        <div class="ts-tags">${ph.cdr ? `<span class="tag cdr">CDR${ph.cdrCond ? "*" : ""}</span>` : ""}
          ${ph.tags.filter(t => t !== "CDR").slice(0, 2).map(t => `<span class="tag">${t}</span>`).join("")}</div>
        <span class="ts-x" title="remove">✕</span>`;
      row.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/x-move", JSON.stringify({ from: ti, idx: si }));
        e.dataTransfer.effectAllowed = "move";
      });
      row.querySelector(".ts-x").onclick = () => removeMember(ti, si);
      attachTooltip(row, nk, m.phase);
      slots.appendChild(row);
    });
    div.addEventListener("dragover", e => { e.preventDefault(); div.classList.add("drag-over"); });
    div.addEventListener("dragleave", () => div.classList.remove("drag-over"));
    div.addEventListener("drop", e => {
      e.preventDefault(); div.classList.remove("drag-over");
      const mv = e.dataTransfer.getData("text/x-move");
      if (mv) {
        const { from, idx } = JSON.parse(mv);
        const member = state.teams[from].splice(idx, 1)[0];
        if (from !== ti) state.teams[ti].push(member);
        else state.teams[ti].splice(Math.min(idx, state.teams[ti].length), 0, member);
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
function removeMember(ti, si) {
  const m = state.teams[ti].splice(si, 1)[0];
  if (m && !state.teams.some(t => t.some(x => x.nc === m.nc))) state.used.delete(m.nc);
  renderAll();
}

/* ---------- warnings ---------- */
function teamWarnings(team) {
  const out = [];
  if (!team.length) return out;
  const units = team.map(m => ({ nk: byNc[m.nc], ph: unitPhase(byNc[m.nc], m.phase) }));
  for (let step = 1; step <= 3; step++) {
    const fillers = units.filter(u => burstSteps(u.nk, team).includes(step));
    if (!fillers.length) { out.push({ lvl: "bad", t: `No Burst ${step} unit` }); continue; }
    if (fillers.length === 1 && fillers[0].ph.cd >= 40)
      out.push({ lvl: "warn", t: `Only Burst ${step} unit is ${fillers[0].ph.cd}s (${fillers[0].nk.name})` });
    const b2 = step === 2 ? fillers : null;
    if (b2 && b2.length && b2.every(u => u.ph.cd >= 40))
      out.push({ lvl: "warn", t: `All Burst 2 units are 40s+ — slow rotation` });
  }
  if (!units.some(u => u.ph.cdr)) out.push({ lvl: "warn", t: "No CDR unit (burst cooldown reduction)" });
  else if (!units.some(u => u.ph.cdr && !u.ph.cdrCond)) {
    const names = units.filter(u => u.ph.cdr).map(u => u.nk.name).join(", ");
    out.push({ lvl: "warn", t: `CDR is conditional (${names}) — only procs with the right squad burst-step mix` });
  }
  const b3 = units.filter(u => burstSteps(u.nk, team).includes(3));
  if (b3.length === 1 && b3[0].ph.cd === 60)
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
function matches(nk) {
  const f = state.filters;
  if (f.name && !nk.name.toLowerCase().includes(f.name)) return false;
  if (f.burst.size && !f.burst.has(String(nk.burst))) return false;
  if (f.elem.size && !f.elem.has(nk.element)) return false;
  if (f.weapon.size && !f.weapon.has(nk.weapon)) return false;
  if (f.cdr && !nk.cdr) return false;
  if (f.treasure && !nk.treasure) return false;
  return true;
}
function renderGrid() {
  const grid = $("#grid");
  grid.innerHTML = "";
  let count = 0;
  for (const nk of D.nikkes) {
    if (!matches(nk)) continue;
    count++;
    for (const v of variants(nk)) {
      const ph = unitPhase(nk, v.phase);
      const card = document.createElement("div");
      card.className = "card" + (state.used.has(nk.nc) ? " used" : "");
      card.draggable = !state.used.has(nk.nc);
      const bLabel = nk.burst === 5 ? "★" : nk.burst;
      card.innerHTML = `<span class="bstep b${nk.burst}">B${bLabel}</span>
        ${v.label ? `<span class="phase-badge">${v.label}</span>` : ""}
        ${nk.icon ? `<img src="${nk.icon}" loading="lazy">` : ""}
        <div class="c-name">${nk.name}</div>
        <div class="c-sub">${nk.weapon} · ${ph.cd}s · <span style="color:${nk.color}">${nk.element}</span></div>
        <div class="c-tags">${ph.cdr ? `<span class="tag cdr">CDR${ph.cdrCond ? "*" : ""}</span>` : ""}
          ${nk.treasure ? '<span class="tag treasure">TREASURE</span>' : ""}
          ${ph.tags.filter(t => t !== "CDR").slice(0, 2).map(t => `<span class="tag">${t}</span>`).join("")}</div>`;
      card.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/plain", JSON.stringify(v));
        e.dataTransfer.effectAllowed = "copy";
      });
      attachTooltip(card, nk, v.phase);
      grid.appendChild(card);
    }
  }
  $("#grid-count").textContent = `${count} Nikkes`;
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
function attachTooltip(el, nk, phase) {
  el.addEventListener("mouseenter", e => { showTip(nk, phase, e); });
  el.addEventListener("mousemove", e => posTip(e));
  el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
}
function showTip(nk, phase, e) {
  let skills, replaced = [];
  if (nk.treasure && phase) {
    const p = nk.treasure.phases[String(phase)];
    skills = p.skills; replaced = p.replaced;
  } else skills = nk.skills.base;
  const ph = unitPhase(nk, phase);
  const names = ["Skill 1", "Skill 2", "Ultimate"];
  tip.innerHTML = `<h4>${nk.name}${nk.treasure ? ` — ${nk.treasure.name}${phase ? " P" + phase : " (no treasure)"}` : ""}</h4>
    <div class="t-sub">${nk.rare} ${nk.cls} · ${nk.element} · ${nk.weapon} · Burst ${nk.burst === 5 ? "AllStep" : nk.burst} · Ult ${ph.cd}s${ph.cdr ? ` · CDR${ph.cdrCond ? "* (conditional: squad burst-step composition)" : ""}` : ""}</div>
    ${skills.map((s, i) => s ? `<div class="t-skill"><b>${names[i]}: ${s.n}${replaced.includes(names[i]) ? '<span class="t-new">REPLACED BY TREASURE</span>' : ""}</b><p>${s.d || "—"}</p></div>` : "").join("")}`;
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
$("#f-cdr").onclick = e => { state.filters.cdr = !state.filters.cdr; e.target.classList.toggle("on", state.filters.cdr); renderGrid(); };
$("#f-treasure").onclick = e => { state.filters.treasure = !state.filters.treasure; e.target.classList.toggle("on", state.filters.treasure); renderGrid(); };
$("#btn-clear").onclick = () => { resetTeams(); renderAll(); };

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

/* render selected teams to a canvas image */
async function renderTeamsCanvas(teamIdxs) {
  const W = 1000, rowH = 118, headH = 70;
  const H = headH + teamIdxs.length * rowH + 20;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#0b0e14"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#5b8cff"; ctx.font = "bold 30px 'Segoe UI'";
  const s = currentSeason();
  const boss = state.mode === "union" ? currentBoss().name + " — Step " + state.step : (currentSeason().challenge?.name || "") + " (Challenge)";
  ctx.fillText(`${state.mode === "union" ? "Union Raid" : "Solo Raid"} — Season ${s.season} — ${boss}`, 24, 44);
  let y = headH;
  for (const ti of teamIdxs) {
    ctx.fillStyle = "#151a26";
    ctx.beginPath(); ctx.roundRect(20, y, W - 40, rowH - 14, 12); ctx.fill();
    ctx.fillStyle = "#8a94a8"; ctx.font = "bold 15px 'Segoe UI'";
    ctx.fillText(`TEAM ${ti + 1}`, 34, y + 22);
    let x = 34;
    for (const m of state.teams[ti]) {
      const nk = byNc[m.nc];
      const ph = unitPhase(nk, m.phase);
      if (nk.icon) {
        const img = await loadImg(nk.icon);
        ctx.save(); ctx.beginPath(); ctx.roundRect(x, y + 30, 64, 64, 8); ctx.clip();
        ctx.drawImage(img, x, y + 30, 64, 64); ctx.restore();
      }
      ctx.fillStyle = "#e6eaf2"; ctx.font = "bold 13px 'Segoe UI'";
      const nm = nk.name.length > 16 ? nk.name.slice(0, 15) + "…" : nk.name;
      ctx.fillText(nm + (m.phase ? ` P${m.phase}` : ""), x, y + 108);
      ctx.fillStyle = "#8a94a8"; ctx.font = "11px 'Segoe UI'";
      ctx.fillText(`B${nk.burst === 5 ? "★" : nk.burst} ${nk.weapon} ${ph.cd}s${ph.cdr ? " CDR" : ""}`, x + 2, y + 122 - 2);
      x += 185;
    }
    y += rowH;
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
    const boss = state.mode === "union" ? currentBoss().name + " — Step " + state.step : (currentSeason().challenge?.name || "") + " (Challenge)";
    const fd = new FormData();
    fd.append("file", blob, "teams.png");
    fd.append("payload_json", JSON.stringify({
      content: `**${state.mode === "union" ? "Union Raid" : "Solo Raid"}** — Season ${s.season} — ${boss}`,
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
