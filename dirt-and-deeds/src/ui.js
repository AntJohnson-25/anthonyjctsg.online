// DOM front end: HUD, the phone, the conversation panel, cards. Reads the game state, never changes rules itself:
// every button calls back into main.js through UI.act.
import * as G from "./game.js";
import { T, SITUATIONS, SIGN_TEXT, TEMPERS, TOWN, WEEKDAYS, money, clock } from "./data.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const UI = { s: null, P: null, act: {}, tab: "home", lead: null, deal: null, padMode: false };

// ---------------------------------------------------------------- HUD
export function hud(s) {
  const wd = WEEKDAYS[(s.day - 1) % 7];
  $("h-clock").innerHTML = "Day <b>" + s.day + "</b> &middot; " + wd + " &middot; " + clock(s.min);
  $("h-money").innerHTML = money(s.cash) + "<small>Net worth " + money(G.worth(s)) + "</small>";
  const days = s.rentDue - s.day;
  const rent = $("h-rent"); rent.textContent = "Rent " + money(T.rent) + " in " + days + (days === 1 ? " day" : " days"); rent.classList.toggle("warn", days <= 3 && s.cash < T.rent + 150);
  $("h-daybar").style.width = Math.max(0, Math.min(100, (s.min - T.dayStart) / (T.dayEnd - T.dayStart) * 100)) + "%";
  const b = $("h-badge"); b.hidden = !s.unread; b.textContent = s.unread;
}
export function hudKeys(pad, driving) {
  $("h-keys").innerHTML = pad
    ? (driving ? "<b>RT</b> gas &nbsp; <b>LT</b> brake &nbsp; <b>L-stick</b> steer &nbsp; <b>A</b> note house &nbsp; <b>B</b> get out &nbsp; <b>Y</b> phone" : "<b>L-stick</b> walk &nbsp; <b>R-stick</b> look &nbsp; <b>A</b> use &nbsp; <b>Y</b> phone")
    : (driving ? "<b>WASD</b> drive &nbsp; <b>Space</b> brake &nbsp; <b>E</b> note house &nbsp; <b>F</b> get out &nbsp; <b>Tab</b> phone" : "<b>WASD</b> move &nbsp; <b>Shift</b> run &nbsp; <b>E</b> use &nbsp; <b>Tab</b> phone &nbsp; <b>Esc</b> pause");
}
export function gps(txt) { const g = $("h-gps"); g.hidden = !txt; if (txt) g.innerHTML = txt; }
export function prompt(html, sub) { const p = $("prompt"); if (!html) { p.hidden = true; return; } p.hidden = false; p.innerHTML = html + (sub ? "<small>" + sub + "</small>" : ""); }
let toastT = 0;
export function toast(text, tone = "", ms = 3400) { const t = $("toast"); t.hidden = false; t.className = tone; t.textContent = text; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

// ---------------------------------------------------------------- house label (projected into the screen by main.js)
export function houseLabel(p, L, s, visible) {
  const el = $("houselabel");
  if (!p) { el.hidden = true; return el; }
  el.hidden = false;
  const signs = p.signs.filter((k) => SIGN_TEXT[k]).map((k) => SIGN_TEXT[k]);
  const sold = s.sold[p.id];
  let st = "";
  if (sold) st = sold === "rival" ? "SOLD to another investor" : "SOLD";
  else if (L) st = { noted: "On your list", talked: "Talked to owner", locked: "LOCKED lead", sent: "With your mentor", contract: "UNDER CONTRACT", cold: "Owner shut you out", dead: "Dead lead", paid: "Closed" }[L.status] || "";
  el.innerHTML = "<b>" + esc(p.addr) + "</b>" + (visible && signs.length ? '<span class="sg">' + esc(signs.slice(0, 3).join(" · ")) + "</span>" : "") + (st ? '<span class="st">' + st + "</span>" : "");
  return el;
}

// ---------------------------------------------------------------- cards
export function card(title, html, buttons) {
  $("card-body").innerHTML = (title ? "<h2>" + esc(title) + "</h2>" : "") + html;
  const bt = $("card-btns"); bt.innerHTML = "";
  for (const b of buttons || [{ label: "OK", primary: true }]) {
    const e = document.createElement("button"); e.textContent = b.label; if (b.primary) e.className = "primary";
    e.onclick = () => { closeCard(); if (b.fn) b.fn(); };
    bt.appendChild(e);
  }
  $("card").hidden = false;
}
export function closeCard() { $("card").hidden = true; }
export const cardOpen = () => !$("card").hidden;

// ---------------------------------------------------------------- the phone
const TABS = [["home", "Home"], ["leads", "Leads"], ["deals", "Deals"], ["buyers", "Buyers"], ["msgs", "Messages"], ["market", "Market"], ["career", "Career"]];
export function phoneOpen() { return !$("phone").hidden; }
export function openPhone(tab) {
  if (tab) { UI.tab = tab; if (tab !== "leads") UI.lead = null; if (tab !== "deals") UI.deal = null; }
  $("phone").hidden = false; renderPhone();
}
export function closePhone() { $("phone").hidden = true; }
export function renderPhone() {
  const s = UI.s; if (!s || $("phone").hidden) return;
  $("ph-clock").textContent = clock(s.min) + " · Day " + s.day;
  const tabs = $("ph-tabs"); tabs.innerHTML = "";
  for (const [id, name] of TABS) {
    if ((id === "deals" || id === "buyers") && s.tier < 2) continue;
    const b = document.createElement("button"); b.textContent = name; if (UI.tab === id) b.className = "on";
    if (id === "msgs" && s.unread) b.innerHTML = name + '<span class="dot">' + s.unread + "</span>";
    b.onclick = () => { UI.tab = id; UI.lead = null; UI.deal = null; if (id === "msgs") { s.unread = 0; } renderPhone(); hud(s); };
    tabs.appendChild(b);
  }
  const page = $("ph-page"); page.innerHTML = "";
  const f = { home: pHome, leads: pLeads, deals: pDeals, buyers: pBuyers, msgs: pMsgs, market: pMarket, career: pCareer }[UI.tab];
  f(page, s);
  wire(page);
}
function wire(root) { root.querySelectorAll("[data-a]").forEach((e) => { e.onclick = (ev) => { ev.stopPropagation(); const [fn, arg, arg2] = e.dataset.a.split("|"); const f = UI.act[fn]; if (f) f(arg, arg2); }; }); }
const btn = (label, a, cls = "", dis = false) => '<button class="' + cls + '" data-a="' + a + '"' + (dis ? " disabled" : "") + ">" + label + "</button>";

function pHome(el, s) {
  const days = s.rentDue - s.day;
  el.innerHTML = '<div class="stat"><div><small>Cash</small><b>' + money(s.cash) + "</b></div><div><small>Net worth</small><b>" + money(G.worth(s)) + "</b></div>" +
    "<div><small>Rent due</small><b>" + money(T.rent) + '</b> <small style="display:inline">in ' + days + "d</small></div><div><small>Rep</small><b>" + Math.round(s.rep) + "</b></div></div>" +
    "<h3>Today</h3><p class=\"note\">Drive or walk the streets and read the houses. <b>E</b> notes one. Knock a door, or find a phone number and call. Everything you learn is saved on the lead.</p>" +
    '<div class="stat"><div><small>Leads on file</small><b>' + Object.values(s.leads).filter((l) => !["dead", "paid"].includes(l.status)).length + "</b></div><div><small>Fees earned</small><b>" + money(s.earned) + "</b></div>" +
    "<div><small>Closed through mentor</small><b>" + s.closed + "</b></div><div><small>Assigned yourself</small><b>" + s.assigned + "</b></div></div>" +
    "<h3>Market</h3><p class=\"note\">" + esc(s.mktNote) + ". Values are " + (s.mkt >= 1 ? "+" : "") + ((s.mkt - 1) * 100).toFixed(1) + "% from where you started.</p>";
  const next = nextTier(s);
  if (next) el.innerHTML += "<h3>" + esc(next.title) + "</h3>" + next.bars.map((b) => '<div class="note">' + esc(b.label) + '</div><div class="bar2"><i style="width:' + Math.min(100, b.pct) + '%"></i></div>').join("");
}
export function nextTier(s) {
  if (s.tier === 1) return { title: "Next: Tier 2, Assignment", bars: [
    { label: "Fees closed through the mentor: " + s.closed + " / " + T.tier2.closed, pct: s.closed / T.tier2.closed * 100 },
    { label: "Reputation: " + Math.round(s.rep) + " / " + T.tier2.rep, pct: s.rep / T.tier2.rep * 100 }] };
  if (s.tier === 2) return { title: "Next: Tier 3, Capital", bars: [
    { label: "Net worth: " + money(G.worth(s)) + " / " + money(T.tier3.worth), pct: G.worth(s) / T.tier3.worth * 100 },
    { label: "Contracts assigned: " + s.assigned + " / " + T.tier3.assigned, pct: s.assigned / T.tier3.assigned * 100 }] };
  return null;
}

const ORDER = { locked: 0, contract: 1, talked: 2, noted: 3, sent: 4, cold: 5, dead: 6, paid: 7 };
function pLeads(el, s) {
  if (UI.lead != null) return leadDetail(el, s, UI.lead);
  const ls = Object.values(s.leads).sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (b.day - a.day));
  if (!ls.length) { el.innerHTML = '<p class="note">No leads yet. Drive or walk the streets. When a house looks like trouble (overgrown yard, boards, tarps, notices), press <b>E</b> to note it.</p>'; return; }
  el.innerHTML = ls.map((L) => {
    const p = UI.P[L.pid], sg = p.signs.filter((k) => SIGN_TEXT[k]).slice(0, 2).map((k) => SIGN_TEXT[k]).join(", ");
    const sold = s.sold[L.pid];
    return '<div class="row" data-a="lead|' + L.pid + '"><div class="t"><b>' + esc(p.addr) + '</b><span class="pill ' + L.status + '">' + (sold && L.status === "dead" ? "sold" : L.status) + "</span></div>" +
      '<div class="s">' + (p.district === "flats" ? "The Flats" : "Willow Crest") + (sg ? " · " + esc(sg) : "") + (L.info.situation ? " · " + esc(SITUATIONS[p.situation].label) : "") + (L.info.ask != null ? " · asking " + money(L.info.ask) : "") + "</div></div>";
  }).join("");
  wire(el);
}
function leadDetail(el, s, pid) {
  const L = s.leads[pid], p = UI.P[pid];
  if (!L) { UI.lead = null; return pLeads(el, s); }
  const dm = G.dealMath(s, p), I = L.info, sold = s.sold[pid];
  const signs = p.signs.filter((k) => SIGN_TEXT[k]).map((k) => SIGN_TEXT[k]);
  let verdict = "";
  if (I.ask == null) verdict = '<div class="dim">Find out what they want first.</div>';
  else verdict = '<div class="tot ' + (dm.spread >= 1500 ? "ok" : "no") + '"><span>Room for a deal</span><span>' + (dm.spread >= 0 ? "+" : "") + money(dm.spread) + "</span></div>";
  const status = L.status;
  el.innerHTML = '<button class="back" data-a="lead|">&larr; All leads</button>' +
    "<h3 style=\"margin-top:4px\">" + esc(p.addr) + ' <span class="pill ' + status + '">' + status + "</span></h3>" +
    '<div class="note">' + (p.district === "flats" ? "The Flats" : "Willow Crest") + " · " + p.beds + " bd / " + p.baths + " ba · " + p.sqft.toLocaleString() + " sqft · built " + p.year + "<br>Owner on record: <b>" + esc(p.owner.name) + "</b>" + (p.absentee ? " (mailing address elsewhere)" : "") +
    "<br>You noticed: " + (signs.length ? esc(signs.join(", ")) : "nothing unusual") + "</div>" +
    (I.situation ? '<div class="msg"><small>What you learned</small>' + esc(SITUATIONS[p.situation].label) + (I.timeline ? " · " + esc(SITUATIONS[p.situation].time) : "") + (I.motiveFeel ? " · they seem " + (I.motiveFeel === "high" ? "very eager" : I.motiveFeel === "mid" ? "open" : "not eager") : "") + "</div>" : "") +
    '<h4>Your numbers</h4><div class="math">' +
    "<div><span>Fixed-up value (ARV)" + (dm.exactArv ? "" : " ~") + "</span><span>" + money(dm.arv) + "</span></div>" +
    "<div><span>Repairs " + (dm.repairsKnown ? (I.walked ? "(walked)" : "(guess)") : "(unknown, est.)") + "</span><span>-" + money(dm.repairs) + "</span></div>" +
    "<div><span>Investor margin &amp; costs (30% of ARV + " + money(T.mpdFee) + ")</span><span>-" + money(Math.round(dm.arv * (1 - T.mpd) + T.mpdFee)) + "</span></div>" +
    '<div class="tot"><span>Most a buyer can pay</span><span>' + money(dm.mao) + "</span></div>" +
    "<div><span>Seller's number</span><span>" + (I.ask != null ? money(I.ask) : "???") + "</span></div>" + verdict + "</div>" +
    (L.lockedPrice != null && status === "locked" ? '<div class="msg money"><small>Locked</small>Seller agreed to ' + money(L.lockedPrice) + ". Expires in " + Math.max(0, T.lockDays - (s.day - L.lockedDay)) + " days.</div>" : "");
  const call = G.canCall(L, p), traced = L.phone;
  let b = "";
  if (!sold && !["dead", "sent", "paid", "contract"].includes(status)) {
    b += btn("Set GPS", "gps|" + pid);
    b += btn(call ? "Call owner" : "No number", "call|" + pid, "primary", !call);
    if (!call) b += btn((s.hero === "cole" ? "Skip trace (free)" : "Skip trace " + money(T.skipTrace)), "trace|" + pid);
    if (status === "locked") b += btn("Send to mentor", "send|" + pid, "primary");
    if (L.cooldown > s.day) b += '<span class="note">The owner will talk again around day ' + L.cooldown + ".</span>";
    b += btn("Drop lead", "drop|" + pid);
  } else if (status === "sent") b += '<span class="note">Your mentor is working it. You will hear back in a few days.</span>';
  else if (status === "contract") b += '<span class="note">Under contract. See the Deals tab.</span>' + btn("Set GPS", "gps|" + pid);
  el.innerHTML += '<div class="btns">' + b + "</div>";
  wire(el);
}
UI.act.lead = (pid) => { UI.lead = pid === "" || pid == null ? null : +pid; renderPhone(); };

function pDeals(el, s) {
  if (UI.deal != null) return dealDetail(el, s, UI.deal);
  if (!s.contracts.length) { el.innerHTML = '<p class="note">No contracts. When a seller is at their lowest number and trusts you, <b>Write it up</b> in the conversation puts the house under contract. Then sell that contract to a cash buyer before the deadline.</p>'; return; }
  el.innerHTML = s.contracts.map((c, i) => {
    const p = UI.P[c.pid], left = c.expires - s.day;
    return '<div class="row" data-a="deal|' + i + '"><div class="t"><b>' + esc(p.addr) + '</b><span class="pill ' + (c.close ? "locked" : "contract") + '">' + (c.close ? "closing d" + c.close : left + " days left") + "</span></div>" +
      '<div class="s">Contract ' + money(c.price) + " · earnest " + money(c.em) + (c.close ? " · assigned " + money(c.sale) : c.offer ? " · offer on table" : " · needs a buyer") + "</div></div>";
  }).join("");
  wire(el);
}
UI.act.deal = (i) => { UI.deal = i === "" || i == null ? null : +i; renderPhone(); };
function dealDetail(el, s, i) {
  const c = s.contracts[i];
  if (!c) { UI.deal = null; return pDeals(el, s); }
  const p = UI.P[c.pid], dm = G.dealMath(s, p);
  let h = '<button class="back" data-a="deal|">&larr; Contracts</button><h3 style="margin-top:4px">' + esc(p.addr) + "</h3>" +
    '<div class="math"><div><span>You contracted it at</span><span>' + money(c.price) + "</span></div><div><span>Earnest money at risk</span><span>" + money(c.em) + "</span></div>" +
    "<div><span>Days left</span><span>" + (c.expires - s.day) + "</span></div><div><span>Your ARV estimate</span><span>~" + money(dm.arv) + "</span></div><div><span>Repairs (your read)</span><span>" + money(dm.repairs) + "</span></div></div>";
  if (c.close) h += '<div class="msg money"><small>Assigned</small>Selling the contract at ' + money(c.sale) + ". Closing about day " + c.close + ". Your fee after costs: " + money(c.sale - c.price - T.closeCosts) + ".</div>";
  else if (c.offer) {
    const b = s.buyers.find((x) => x.id === c.offer.buyer);
    h += '<div class="msg tip"><small>Offer from ' + esc(b.name) + "</small>" + money(c.offer.price) + " cash for the contract. Your fee would be " + money(c.offer.price - c.price - T.closeCosts) + ".</div>" +
      '<div class="btns">' + btn("Accept " + money(c.offer.price), "accept|" + i, "primary") + btn(c.offer.countered ? "Already countered" : "Counter +10%", "counter|" + i, "", c.offer.countered) + btn("Pass", "decline|" + i) + "</div>";
  } else {
    h += "<h4>Pitch it to a buyer (40 minutes each)</h4>" + s.buyers.map((b) => '<div class="row" data-a="pitch|' + i + '|' + b.id + '"><div class="t"><b>' + esc(b.name) + '</b><span class="pill ' + (c.pitched[b.id] ? "dead" : "locked") + '">' + (c.pitched[b.id] ? "seen it" : "pitch") + '</span></div><div class="s">' + esc(b.biz) + " · " + esc(b.bio) + "</div></div>").join("");
  }
  el.innerHTML = h; wire(el);
}
function pBuyers(el, s) {
  el.innerHTML = '<p class="note">Cash buyers who want discounted houses. They know repair costs, so you can not fool them. Close deals and your list grows.</p>' +
    s.buyers.map((b) => '<div class="row" style="cursor:default"><div class="t"><b>' + esc(b.name) + '</b><span class="pill locked">' + b.deals + " deal" + (b.deals === 1 ? "" : "s") + "</span></div><div class=\"s\">" + esc(b.biz) + " · " + esc(b.bio) + " · prefers " + (b.pref === "any" ? "anywhere" : b.pref === "flats" ? "the Flats" : "Willow Crest") + "</div></div>").join("");
}
function pMsgs(el, s) {
  s.unread = 0;
  el.innerHTML = s.inbox.length ? s.inbox.map((m) => '<div class="msg ' + (m.kind || "") + '"><small>' + esc(m.from) + " · day " + m.day + "</small>" + esc(m.text) + "</div>").join("") : '<p class="note">Nothing yet.</p>';
}
function pMarket(el, s) {
  const fl = G.compPpsf(s, "flats"), he = G.compPpsf(s, "heights");
  const sold = Object.entries(s.sold).slice(-8).reverse();
  el.innerHTML = '<h3 style="margin-top:6px">Recent comps</h3><div class="stat"><div><small>The Flats</small><b>$' + fl + '</b><small>per sqft, fixed up</small></div><div><small>Willow Crest</small><b>$' + he + '</b><small>per sqft, fixed up</small></div></div>' +
    '<p class="note">Fixed-up value is about price per sqft times the house size. Comps are noisy and move week to week. A buyer will not pay more than <b>70% of that, minus the repairs, minus costs</b>. Get repairs wrong and you overpay.</p>' +
    "<h3>Market mood</h3><p class=\"note\">" + esc(s.mktNote) + "</p><h3>Recently sold</h3>" +
    (sold.length ? sold.map(([pid, how]) => '<div class="msg"><small>' + (how === "rival" ? "another investor" : how === "closed" ? "your mentor's buyer" : "your buyer") + "</small>" + esc(UI.P[pid].addr) + "</div>").join("") : '<p class="note">Nothing sold yet.</p>');
}
function pCareer(el, s) {
  const tiers = [["Tier 1 · Bird dog", "Find motivated sellers. Hand locked leads to your mentor for a finder's fee.", 1], ["Tier 2 · Assignment", "Put houses under contract yourself and sell the contract to a cash buyer. Bigger fees; a missed deadline costs you.", 2],
    ["Tier 3 · Capital", "Flips, rentals, creative finance, raw land. (Coming in the next build.)", 3]];
  el.innerHTML = tiers.map(([t, d, n]) => '<div class="row" style="cursor:default;opacity:' + (s.tier >= n ? 1 : 0.55) + '"><div class="t"><b>' + t + '</b><span class="pill ' + (s.tier >= n ? "locked" : "dead") + '">' + (s.tier > n ? "done" : s.tier === n ? "you are here" : "locked") + '</span></div><div class="s">' + d + "</div></div>").join("");
  const nx = nextTier(s);
  if (nx) el.innerHTML += "<h3>" + esc(nx.title) + "</h3>" + nx.bars.map((b) => '<div class="note">' + esc(b.label) + '</div><div class="bar2"><i style="width:' + Math.min(100, b.pct) + '%"></i></div>').join("");
  el.innerHTML += "<h3>Win condition</h3><p class=\"note\">Reach " + money(T.winWorth) + " in net worth. The long game (passive income beating your bills) opens at Tier 3.</p>";
}

// ---------------------------------------------------------------- conversation
export const talkOpen = () => !$("talk").hidden;
export function openTalk(c, p) {
  UI.c = c; UI.cp = p; $("talk").hidden = false; $("tk-log").innerHTML = "";
  $("tk-name").textContent = p.owner.name;
  renderTalk();
}
export function closeTalk() { $("talk").hidden = true; UI.c = null; }
export function talkLines(lines) {
  const log = $("tk-log");
  for (const ln of lines) { const d = document.createElement("div"); d.className = ln.who; d.textContent = ln.text; log.appendChild(d); }
  log.scrollTop = log.scrollHeight;
}
export function renderTalk() {
  const c = UI.c, p = UI.cp, s = UI.s; if (!c) return;
  const tm = TEMPERS[p.temper];
  $("tk-sub").textContent = (c.mode === "door" ? "at the door · " : "on the phone · ") + p.addr + (c.trust >= 25 ? " · " + tm.tag : "");
  $("m-trust").style.width = c.trust + "%"; $("m-tension").style.width = c.tension + "%";
  const k = c.known, chips = [];
  if (k.situation) chips.push('<span class="chipn"><b>Situation</b> ' + esc(SITUATIONS[p.situation].label) + "</span>");
  if (k.timeline) chips.push('<span class="chipn"><b>Timeline</b> ' + esc(SITUATIONS[p.situation].time) + "</span>");
  if (k.askRevealed) chips.push('<span class="chipn"><b>Their number</b> ' + money(c.askNow) + (k.bottom ? " (bottom)" : "") + "</span>");
  if (k.repairs != null) chips.push('<span class="chipn"><b>Repairs</b> ~' + money(k.repairs) + (k.repairsExact ? " exact" : k.walked ? "" : " (guess)") + "</span>");
  $("tk-notes").innerHTML = chips.join("");
  const dm = G.dealMath(s, p), sp = k.askRevealed ? dm.mao - c.askNow : null;
  $("tk-math").innerHTML = "Your read: ARV ~<b>" + money(dm.arv) + "</b> · repairs " + (dm.repairsKnown ? "<b>" + money(dm.repairs) + "</b>" : "unknown (est. " + money(dm.repairs) + ")") + " · a buyer can pay up to <b>" + money(dm.mao) + "</b>" +
    (sp != null ? ' · <span class="' + (sp >= 1500 ? "ok" : "no") + '">at their number: ' + (sp >= 0 ? "+" : "") + money(sp) + " of room</span>" : "");
  const acts = G.talkActions(s, c, p), box = $("tk-opts"); box.innerHTML = "";
  acts.forEach((a, i) => {
    const b = document.createElement("button"); b.disabled = !a.ok; b.innerHTML = '<span class="n">' + (i + 1) + "</span>" + esc(a.label) + "<small>" + esc(!a.ok && a.why ? a.why : a.sub) + "</small>";
    b.onclick = () => UI.act.talk(a.id);
    box.appendChild(b);
  });
  UI.talkActs = acts;
}
export function talkKey(n) { const a = UI.talkActs && UI.talkActs[n - 1]; if (a && a.ok) UI.act.talk(a.id); }
