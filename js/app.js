const MODEL = { nfl:{ prior:11, home:0.18 }, nba:{ prior:12, home:0.22 } };
const LEAGUES = [["nfl","NFL"],["nba","NBA"],["wnba","WNBA"],["nhl","NHL"],["epl","Premier League"],["ncaaw","Women’s college hoops"],["tennis","Tennis"],["ufc","UFC"],["mine","My events"]];
const ts = t => Date.parse(t.length === 17 ? t.replace("Z", ":00Z") : t);

// ---- state ----
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'edge-desk-v1';
let S = { bank:1000, kelly:0.25, max:3, cap:15, feed:70, league:'nfl', prices:{}, ov:{}, custom:[], log:[], lab:null };
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) S = Object.assign(S, s); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
const pct = (p, d = 1) => (p * 100).toFixed(d) + '%';
const money = v => (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
const signed = (p, d = 1) => (p >= 0 ? '+' : '−') + Math.abs(p * 100).toFixed(d) + '%';

let started = {};
function events() {
  const all = DATA.events.map(r => ({ id:[r[0], r[1], r[3] || r[2], r[5] || r[4]].join("|"), lg:r[0], t:r[1], names:[r[2], r[4]], ab:[r[3], r[5]],
    feed: r[6] != null ? [r[6], r[7], r[8]].filter(x => x != null).map(x => x / 100) : null,
    neutral: /^neutral/.test(r[9] || ""), site: (r[9] || "").split(":")[1] || "", px: r[10] || null, cons: r[11] || null }));
  const base = all.filter(e => ts(e.t) > Date.now()); started = {}; all.forEach(e => { if (ts(e.t) <= Date.now()) started[e.lg] = (started[e.lg] || 0) + 1; });
  return base.concat(S.custom.map(c => ({ id:c.id, lg:'mine', t:null, names:[c.a, c.b], ab:['', ''], feed:null, neutral:true, custom:true })));
}
// use the price I typed if there is one, otherwise the stored fanduel price
function priceOf(e, i) {
  const raw = ((S.prices[e.id] || [])[i] || "").trim();
  if (raw) return { raw, dec: Core.parseOdds(raw), typed: true };
  const b = e.px && e.px[i]; return b ? { raw: b, dec: Core.parseOdds(b), typed: false } : { raw: "", dec: null, typed: false };
}
const BOOK = (DATA.prices && DATA.prices.book) || "Book";
// only call it value if fair % beats break-even by 2+ pts (anything less is noise)
const MARGIN = 0.02, isValue = (p, dec) => p - 1 / dec >= MARGIN, floorPrice = p => p > MARGIN + 0.01 ? Core.toAmerican(1 / (p - MARGIN)) : '—';
function stakeFor(p, dec) {
  const f = Math.min(S.max / 100, S.kelly * Core.kelly(p, dec));
  return Math.max(0, Math.min(f * S.bank, S.cap));
}
// returns [away, home] or [away, home, draw], null if we have nothing
function fair(e) {
  const three = e.feed && e.feed.length === 3;
  const ov = num(S.ov[e.id], NaN);
  if (!three && ov > 0 && ov < 100) return { p:[ov / 100, 1 - ov / 100], src:'Your number' };
  const R = MODEL[e.lg], T = (DATA.rec[e.lg] || {}); let model = null;
  if (R && T[e.ab[0]] && T[e.ab[1]]) {
    const s = k => { const r = T[k]; return Core.strength(r[0], r[1], r[2] || 0, R.prior); };
    model = Core.matchup(s(e.ab[1]), s(e.ab[0]), e.neutral ? 0 : R.home);
  }
  if (three) { const t = e.feed.reduce((a, b) => a + b, 0); return { p:e.feed.map(x => x / t), src:'Market' }; }
  // market % for home = average of feed prob + devigged book prices
  const sig = []; if (e.feed) sig.push(e.feed[1] / (e.feed[0] + e.feed[1]));
  [e.px, e.cons].forEach(pr => { if (pr) { const ds = pr.map(Core.parseOdds); if (ds.every(Boolean)) sig.push(Core.devigMultiplicative(ds)[1]); } });
  const market = sig.length ? sig.reduce((a, b) => a + b, 0) / sig.length : null;
  if (market != null && model != null) { const h = Core.blend(market, model, S.feed / 100); return { p:[1 - h, h], src:'Market + model', model, feedH:market, n:sig.length }; }
  if (market != null) return { p:[1 - market, market], src:'Market', n:sig.length };
  if (model != null) return { p:[1 - model, model], src:'Model only', model };
  return null;
}

// ---- slate ----
function renderLeagues() {
  const evs = events(), has = l => l === "mine" || evs.some(e => e.lg === l);
  if (!has(S.league)) S.league = (LEAGUES.find(l => l[0] !== "mine" && has(l[0])) || ["mine"])[0];
  $('#leagues').innerHTML = LEAGUES.filter(l => has(l[0])).map(l => `<button type="button" data-lg="${l[0]}" aria-pressed="${S.league === l[0]}">${l[1]}<span class="ct">${evs.filter(e => e.lg === l[0]).length}</span></button>`).join('');
  const mine = evs.filter(e => e.lg === S.league), c = { both:0, feed:0, model:0, none:0 };
  mine.forEach(e => { const saved = S.ov[e.id]; delete S.ov[e.id]; const f = fair(e); if (saved != null) S.ov[e.id] = saved;
    c[!f ? "none" : f.src === "Market + model" ? "both" : f.src === "Market" ? "feed" : "model"]++; });
  const parts = [[c.both, "priced from the market and the record model"], [c.feed, "priced from the market alone"], [c.model, "on the record model alone, so rougher"], [c.none, "with no feed number, so they need your own"]].filter(p => p[0]).map(p => p[0] + " " + p[1]);
  $('#lgnote').textContent = S.league === "mine" ? "Events you add below. Tennis, golf matchups, anything with a price."
    : mine.length + " upcoming: " + parts.join(", ") + "." + (started[S.league] ? " " + started[S.league] + " already started and were dropped." : "");
}
function recText(e, i) {
  const r = (DATA.rec[e.lg] || {})[e.ab[i]];
  const where = e.neutral ? '' : (i ? 'home' : 'away');
  return [r ? r[0] + '–' + r[1] + (r[2] ? '–' + r[2] : '') : '', where].filter(Boolean).join(' · ');
}
function renderSlate() {
  renderLeagues();
  const list = events().filter(e => e.lg === S.league);
  $('#events').innerHTML = list.length ? list.map(e => {
    const three = e.feed && e.feed.length === 3;
    const labels = three ? [e.names[0], e.names[1], 'Draw'] : e.names;
    const when = e.t ? new Date(ts(e.t)).toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : 'Your event';
    return `<article class="ev" data-id="${e.id}">
      <header><span class="when">${esc(when)}</span><span class="tag" data-src></span>${e.site ? `<span class="muted">Neutral site: ${esc(e.site)}. No home edge applied.</span>` : ''}
        ${three ? '' : `<label class="mine" for="ov-${e.id}">Your own % for ${esc(e.names[0])}<input id="ov-${e.id}" class="ov" inputmode="decimal" value="${esc(S.ov[e.id] || '')}" placeholder="—"></label>`}
        ${e.custom ? `<button type="button" class="ghost" data-del="${e.id}">Remove</button>` : ''}</header>
      ${labels.map((n, i) => `<div class="side" data-i="${i}">
        <div class="nm">${esc(n)}<small>${i < 2 ? esc(recText(e, i)) : ''}</small></div>
        <div class="bar" aria-hidden="true"><i></i></div>
        <div class="fair" data-fair></div>
        <input id="px-${e.id}-${i}" class="px" aria-label="Book price for ${esc(n)}" placeholder="${e.px && e.px[i] ? esc(BOOK + ' ' + e.px[i]) : 'price'}" value="${esc((S.prices[e.id] || [])[i] || '')}">
        <div class="out" data-out></div></div>`).join('')}
      <footer data-foot></footer></article>`;
  }).join('') : '<div class="panel muted">Nothing here yet. Add an event below.</div>';
  $$('#events .ev').forEach(updateCard); renderPicks();
}
function updateCard(card) {
  const e = events().find(x => x.id === card.dataset.id); if (!e) return;
  const f = fair(e), tag = card.querySelector('[data-src]');
  tag.textContent = f ? f.src : 'No reference'; tag.className = 'tag' + (f ? '' : ' none');
  const decs = [];
  card.querySelectorAll('.side').forEach((row, i) => {
    const pr = priceOf(e, i), dec = pr.dec; decs[i] = dec;
    const fe = row.querySelector('[data-fair]'), out = row.querySelector('[data-out]'), bar = row.querySelector('.bar i');
    if (!f) { fe.innerHTML = '<span class="muted">needs your %</span>'; bar.style.width = '0'; out.innerHTML = ''; return; }
    const p = f.p[i];
    bar.style.width = (p * 100).toFixed(1) + '%';
    fe.innerHTML = `<b>${(p * 100).toFixed(1)}</b>fair ${Core.toAmerican(1 / p)}`;
    if (!dec) { out.innerHTML = row.querySelector('.px').value.trim() ? '<span class="pill warn">Price not recognised</span>' : `<span class="muted">Take ${floorPrice(p)} or better</span>`; return; }
    const edge = Core.ev(p, dec), st = stakeFor(p, dec), at = pr.typed ? '' : `<span class="muted">${esc(BOOK)} ${esc(pr.raw)}</span>`;
    out.innerHTML = at + (isValue(p, dec)
      ? `<span class="pill good">Value ${signed(edge)}</span><b>Bet ${money(Math.max(1, Math.round(st)))} on ${esc(i === 2 ? 'the draw' : e.names[i])}</b><button type="button" class="ghost" data-log="${i}">Log bet</button>`
      : edge >= 0 ? `<span class="pill warn">Thin ${signed(edge)}</span><span class="muted">inside the noise</span>`
      : `<span class="pill bad">Pass ${signed(edge)}</span>`);
  });
  const bits = [];
  if (f && f.model != null && f.feedH != null) bits.push(`${esc(e.names[1])}: market ${pct(f.feedH)}, model ${pct(f.model)}${Math.abs(f.feedH - f.model) > 0.1 ? ' - a wide gap, so check injuries and lineups before trusting the model' : ''}`);
  else if (f && f.src === 'Model only') bits.push(`No feed number. Record model only, so treat the fair price as rough`);
  if (decs.every(Boolean) && decs.length) { const nv = Core.devigMultiplicative(decs); bits.push(`This book: hold ${pct(Core.hold(decs))}, no-vig line ${nv.map(x => pct(x)).join(' / ')}`); }
  card.querySelector('[data-foot]').innerHTML = bits.join(' · ') || (f ? 'Enter a price on either side.' : 'Enter your own win chance above, or both prices to see this book’s no-vig line.');
}
$('#leagues').addEventListener('click', ev => { const b = ev.target.closest('button[data-lg]'); if (!b) return; S.league = b.dataset.lg; save(); renderSlate(); });
$('#events').addEventListener('input', ev => {
  const card = ev.target.closest('.ev'); if (!card) return; const id = card.dataset.id;
  if (ev.target.classList.contains('ov')) S.ov[id] = ev.target.value;
  if (ev.target.classList.contains('px')) S.prices[id] = [...card.querySelectorAll('.px')].map(x => x.value);
  save(); updateCard(card); renderPicks();
});
$('#events').addEventListener('click', ev => {
  const del = ev.target.closest('[data-del]');
  if (del) { S.custom = S.custom.filter(c => c.id !== del.dataset.del); save(); renderSlate(); return; }
  const b = ev.target.closest('[data-log]'); if (!b) return;
  const card = b.closest('.ev'), e = events().find(x => x.id === card.dataset.id), i = +b.dataset.log, f = fair(e);
  const pr = priceOf(e, i), raw = pr.raw, dec = pr.dec;
  const label = i === 2 ? `Draw, ${e.names[0]} v ${e.names[1]}` : `${e.names[i]} to beat ${e.names[1 - i]}`;
  S.log.unshift({ d:new Date().toISOString().slice(0, 10), pick:label, odds:raw, stake:Math.round(stakeFor(f.p[i], dec) * 100) / 100, close:'', res:'open' });
  save(); b.textContent = 'Logged'; b.disabled = true; renderLog();
});
$('#addev').addEventListener('submit', ev => {
  ev.preventDefault(); const a = $('#ae-a').value.trim(), b = $('#ae-b').value.trim(); if (!a || !b) return;
  const id = 'c' + Date.now(); S.custom.push({ id, a, b }); if ($('#ae-p').value.trim()) S.ov[id] = $('#ae-p').value.trim();
  S.league = 'mine'; save(); ev.target.reset(); renderSlate();
});

// ---- top picks ----
function picks() {
  const out = [];
  events().forEach(e => {
    const f = fair(e); if (!f) return; let best = null;
    f.p.forEach((p, i) => {
      const pr = priceOf(e, i), dec = pr.dec, typed = pr.typed;
      if (!dec) return; const edge = Core.ev(p, dec);
      // skip sketchy ones: model-only, big longshots, or model/market way apart
      if (!typed && (f.src === 'Model only' || p < 0.2 || (f.model != null && f.feedH != null && Math.abs(f.feedH - f.model) > 0.1))) return;
      const gap = p - 1 / dec;
      if (!best || gap > best.gap) best = { e, i, p, dec, edge, gap, typed, f, raw: pr.raw };
    });
    if (best) out.push(best);
  });
  return out.sort((a, b) => b.gap - a.gap).slice(0, 3);
}
function renderPicks() {
  const P = picks(), lg = k => (LEAGUES.find(l => l[0] === k) || [0, k])[1];
  $('#picks').innerHTML = P.length ? P.map((k, n) => {
    const e = k.e, name = k.i === 2 ? "Draw" : e.names[k.i], vs = k.i === 2 ? e.names[0] + " v " + e.names[1] : "to beat " + e.names[1 - k.i];
    const bet = isValue(k.p, k.dec), amt = bet ? Math.max(1, Math.round(stakeFor(k.p, k.dec))) : 0, floor = floorPrice(k.p);
    const when = e.t ? new Date(ts(e.t)).toLocaleString([], { weekday:"short", hour:"numeric", minute:"2-digit" }) : "";
    const wide = k.f.model != null && k.f.feedH != null && Math.abs(k.f.feedH - k.f.model) > 0.1;
    return `<div class="pk"><div class="top"><div><div class="rk">NO. ${n + 1} · ${esc(lg(e.lg))}${when ? " · " + esc(when) : ""}</div><div class="who">${bet ? "Bet $" + amt + " on " + esc(k.i === 2 ? "the draw" : name) : "Skip " + esc(k.i === 2 ? "the draw" : name)}</div><div class="small muted">${esc(vs)}</div></div><div class="amt${bet ? "" : " no"}">${bet ? "$" + amt : "No bet"}</div></div>
      <div class="px2">${bet ? "at " + esc(k.raw) + " or better · skip below " + floor : esc(k.typed ? "Your price" : BOOK) + " has " + esc(k.raw) + " · needs " + floor + " to be a bet"}</div>
      <div class="meta"><span class="pill ${bet ? "good" : k.edge >= 0 ? "warn" : "bad"}">${(k.gap >= 0 ? "+" : "−") + (Math.floor(Math.abs(k.gap) * 1000) / 10).toFixed(1)} pts vs break-even</span><span class="tag">${k.typed ? "Your price" : esc(BOOK) + " price"}</span><span class="small muted">fair ${pct(k.p)} · ${esc(k.f.src)}</span></div>
      ${wide ? '<div class="small" style="color:var(--warn)">The record model and the market are far apart here. Check injuries and lineups first.</div>' : ""}</div>`;
  }).join("") : '<div class="panel muted" style="background:var(--sunk)">No prices are stored for the upcoming games yet. Type your book’s prices on the cards below and this list fills in.</div>';
  const nb = P.filter(k => isValue(k.p, k.dec)).length;
  $('#pk-note').textContent = !P.length ? "" : (nb ? "" : "Nothing clears the 2-point bar at these prices, so the right amount today is $0. These are the three closest. ")
    + (nb ? "Amounts follow your Kelly multiple and bankroll, capped at your max bet of " + money(S.cap) + ". " : "")
    + BOOK + " prices were stored at the last refresh and move all day, so check the live price before you bet. Longshots under 20% and games where the record model and the market sit more than 10 points apart are left out.";
}

// ---- settings ----
[['#s-bank','bank',1,1e9],['#s-kelly','kelly',0,1],['#s-max','max',0,100],['#s-cap','cap',0,1e9],['#s-feed','feed',0,100]].forEach(([sel, k, lo, hi]) => {
  const el = $(sel); el.value = S[k];
  el.addEventListener('input', () => { const v = num(el.value, NaN); if (!(v >= lo && v <= hi)) return; S[k] = v; save(); $$('#events .ev').forEach(updateCard); renderPicks(); renderTennis(); renderLab(); });
});

// ---- odds lab ----
const LABDEF = { books:['Book A','Book B','Book C','Book D'], outs:['Favorite','Underdog',''], px:[['-150','-142','-158','-135'],['+130','+122','+138','+128'],['','','','']], example:true };
if (!S.lab) S.lab = JSON.parse(JSON.stringify(LABDEF));
function renderLabTable() {
  const L = S.lab;
  $('#labtbl').innerHTML = `<thead><tr><th>Outcome</th>${L.books.map((b, j) => `<th><input id="lb-${j}" data-book="${j}" value="${esc(b)}" aria-label="Book ${j + 1} name" style="font-family:var(--body)"></th>`).join('')}</tr></thead>
   <tbody>${L.outs.map((o, i) => `<tr><td><input id="lo-${i}" data-out="${i}" value="${esc(o)}" placeholder="${i === 2 ? 'third outcome (optional)' : 'outcome'}" aria-label="Outcome ${i + 1} name" style="font-family:var(--body);min-width:130px"></td>${L.books.map((b, j) => `<td><input id="lp-${i}-${j}" data-px="${i},${j}" value="${esc(L.px[i][j])}" aria-label="Price, outcome ${i + 1}, book ${j + 1}" placeholder="—"></td>`).join('')}</tr>`).join('')}</tbody>`;
}
function renderLab() {
  const L = S.lab; $('#labex').style.display = L.example ? '' : 'none';
  const rows = L.px.map((r, i) => i).filter(i => L.px[i].some(v => Core.parseOdds(v)));
  const dec = (i, j) => Core.parseOdds(L.px[i][j]);
  const method = $('#lab-method').value === 'mult' ? Core.devigMultiplicative : Core.devigPower;
  if (rows.length < 2) { $('#labout').innerHTML = '<div class="panel muted">Enter prices for at least two outcomes from one book.</div>'; return; }
  const full = L.books.map((b, j) => j).filter(j => rows.every(i => dec(i, j)));
  const novig = full.map(j => method(rows.map(i => dec(i, j))));
  const cons = rows.map((_, k) => novig.reduce((a, v) => a + v[k], 0) / (novig.length || 1));
  const best = rows.map(i => { let bj = -1, bd = 0; L.books.forEach((b, j) => { const d = dec(i, j); if (d && d > bd) { bd = d; bj = j; } }); return { d:bd, j:bj }; });
  const total = num($('#lab-total').value, 100), arb = best.every(b => b.d) ? Core.arbitrage(best.map(b => b.d), total) : null;
  let html = '';
  if (full.length) {
    html += `<div class="panel tblwrap"><h3>Consensus and best price</h3><table style="margin-top:8px"><thead><tr><th>Outcome</th><th>No-vig chance</th><th>Fair price</th><th>Best price</th><th>At</th><th>Edge at best</th><th>Stake</th></tr></thead><tbody>
      ${rows.map((i, k) => { const p = cons[k], b = best[k], e = Core.ev(p, b.d);
        return `<tr><td class="txt">${esc(L.outs[i] || 'Outcome ' + (i + 1))}</td><td>${pct(p)}</td><td>${Core.toAmerican(1 / p)}</td><td>${Core.toAmerican(b.d)}</td><td class="txt">${esc(L.books[b.j])}</td>
          <td><span class="pill ${isValue(p, b.d) ? 'good' : e >= 0 ? 'warn' : 'bad'}">${signed(e)}</span></td><td>${isValue(p, b.d) ? money(stakeFor(p, b.d)) : '—'}</td></tr>`; }).join('')}
      </tbody></table><p class="small muted" style="margin-top:8px">Consensus is the average no-vig line of the ${full.length} book${full.length > 1 ? 's' : ''} with a full set of prices. It is only as sharp as the books you feed it: weight it toward low-margin books.</p></div>`;
    html += `<div class="panel tblwrap"><h3>Each book’s margin</h3><table style="margin-top:8px"><thead><tr><th>Book</th><th>Hold</th>${rows.map(i => `<th>${esc(L.outs[i] || 'Outcome ' + (i + 1))} no-vig</th>`).join('')}</tr></thead><tbody>
      ${full.map((j, n) => `<tr><td class="txt">${esc(L.books[j])}</td><td>${pct(Core.hold(rows.map(i => dec(i, j))), 2)}</td>${novig[n].map(p => `<td>${pct(p)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  if (arb) html += arb.exists
    ? `<div class="verdict good"><b>Arbitrage found: ${signed(arb.profitPct, 2)} locked in.</b> Split ${money(total)} as ${rows.map((i, k) => `${money(arb.stakes[k])} on ${esc(L.outs[i] || 'outcome ' + (i + 1))} at ${esc(L.books[best[k].j])}`).join(', ')}. Every result returns ${money(total * (1 + arb.profitPct))}. Check the prices are still live and the markets settle on the same rules before placing either leg.</div>`
    : `<div class="verdict"><b>No arbitrage.</b> The best prices still add up to ${pct(arb.sum, 2)} implied, ${pct(arb.sum - 1, 2)} above break-even.</div>`;
  $('#labout').innerHTML = html;
}
$('#labtbl').addEventListener('input', ev => {
  const t = ev.target, L = S.lab;
  if (t.dataset.book) L.books[+t.dataset.book] = t.value;
  if (t.dataset.out) L.outs[+t.dataset.out] = t.value;
  if (t.dataset.px) { const [i, j] = t.dataset.px.split(',').map(Number); L.px[i][j] = t.value; L.example = false; }
  save(); renderLab();
});
$('#lab-method').addEventListener('change', renderLab); $('#lab-total').addEventListener('input', renderLab);
$('#lab-clear').addEventListener('click', () => { S.lab.px = S.lab.px.map(r => r.map(() => '')); S.lab.example = false; save(); renderLabTable(); renderLab(); });

// ---- tennis ----
function renderTennis() {
  const g = id => $('#' + id).value, a = num(g('tn-pa'), NaN) / 100, b = num(g('tn-pb'), NaN) / 100, bo = +g('tn-bo');
  const need = (bo + 1) / 2, sa = Math.round(num(g('tn-sa'), 0)), sb = Math.round(num(g('tn-sb'), 0)), ga = Math.round(num(g('tn-ga'), 0)), gb = Math.round(num(g('tn-gb'), 0));
  const A = g('tn-a') || 'Player A', B = g('tn-b') || 'Player B';
  let err = '';
  if (!(a > 0.3 && a < 0.95 && b > 0.3 && b < 0.95)) err = 'Serve points won should be between 30 and 95 for each player.';
  else if (sa < 0 || sb < 0 || sa >= need || sb >= need) err = `Sets must be below ${need} each while the match is live.`;
  else if (ga < 0 || gb < 0 || ga > 6 || gb > 6 || (ga === 6 && gb < 5) || (gb === 6 && ga < 5)) err = 'Games this set must be a live score, from 0–0 up to 6–6.';
  if (err) { $('#tnout').innerHTML = `<div class="panel neg" style="grid-column:1/-1">${err}</div>`; $('#tnbet').innerHTML = ''; return; }
  const r = Core.matchWin(a, b, bo, { sa, sb, ga, gb, aServes: g('tn-srv') === 'a' }), p = r.match;
  const tile = (l, v, s) => `<div class="tile"><span>${esc(l)}</span><b>${v}</b><div class="small muted">${s}</div></div>`;
  $('#tnout').innerHTML = tile(A + ' wins match', pct(p), 'fair ' + Core.toAmerican(1 / p)) + tile(B + ' wins match', pct(1 - p), 'fair ' + Core.toAmerican(1 / (1 - p)))
    + tile(A + ' holds serve', pct(r.holdA), 'per service game') + tile(B + ' holds serve', pct(r.holdB), 'per service game') + tile(A + ' wins a fresh set', pct(r.set), 'from 0–0');
  $('#tnbet').innerHTML = [[A, p, g('tn-oa')], [B, 1 - p, g('tn-ob')]].map(([n, q, raw]) => {
    const d = Core.parseOdds(raw); if (!d) return '';
    const e = Core.ev(q, d);
    return `<div class="verdict ${isValue(q, d) ? 'good' : ''}"><b>${esc(n)} at ${esc(raw)}:</b> edge ${signed(e)}. ${isValue(q, d) ? 'Stake ' + money(stakeFor(q, d)) + ' at your settings.' : e >= 0 ? 'Too thin to act on.' : 'Pass.'}</div>`;
  }).join('');
}
$('#tn-form').addEventListener('input', renderTennis);

// ---- bankroll ----
let lastSim = null;
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function renderBank() {
  const start = num($('#bk-start').value, 1000), n = Math.min(5000, Math.max(10, Math.round(num($('#bk-n').value, 500))));
  const dec = Core.parseOdds($('#bk-odds').value), pb = num($('#bk-bel').value, NaN) / 100, pt = num($('#bk-true').value, NaN) / 100, k = num($('#bk-k').value, NaN);
  const V = $('#bkverdict');
  if (!dec || !(pb > 0 && pb < 1 && pt > 0 && pt < 1) || !(k >= 0 && k <= 2) || !(start > 0)) { V.className = 'verdict'; V.textContent = 'Check the inputs: a price like -110, win rates between 0 and 100, Kelly multiple between 0 and 2.'; return; }
  const be = 1 / dec, sim = Core.simulate({ start, bets:n, dec, pBelieved:pb, pTrue:pt, kellyMult:k });
  lastSim = { sim, start, n };
  if (sim.frac === 0) { V.className = 'verdict'; V.innerHTML = `<b>No bet.</b> At this price you need to win ${pct(be)} to break even, and you believe ${pct(pb)}. Kelly stakes nothing.`; }
  else { V.className = 'verdict' + (sim.median > start ? ' good' : '');
    V.innerHTML = `<b>You stake ${pct(sim.frac, 2)} of bankroll per bet. The median run ends at ${money(sim.median)}${sim.median > start ? '' : ', below where it started'}.</b> Break-even at this price is ${pct(be)}; your true edge is ${signed(Core.ev(pt, dec))} per dollar staked. ${pt < pb ? 'You are staking as if the edge were ' + signed(Core.ev(pb, dec)) + '.' : ''}`; }
  const tile = (l, v, s, c = '') => `<div class="tile"><span>${l}</span><b class="${c}">${v}</b><div class="small muted">${s}</div></div>`;
  $('#bktiles').innerHTML = tile('Median finish', money(sim.median), 'half of runs end above this', sim.median >= start ? 'pos' : 'neg')
    + tile('Bad run (5th pct)', money(sim.p5), '1 run in 20 ends below this') + tile('Good run (95th pct)', money(sim.p95), '1 run in 20 ends above this')
    + tile('Finish in the red', pct(sim.pBelow, 0), 'share of runs below the start', sim.pBelow > 0.5 ? 'neg' : '') + tile('Bankroll halved', pct(sim.pHalved, 0), 'share of runs with a 50% drawdown');
  $('#bktitle').textContent = `Bankroll over ${n.toLocaleString()} bets`;
  drawBank();
}
function drawBank() {
  if (!lastSim) return; const { sim, start, n } = lastSim, c = $('#bkchart'), dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight; if (!W) return; c.width = W * dpr; c.height = H * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, W, H);
  const m = { l:58, r:64, t:12, b:30 }, ink = css('--ink'), muted = css('--muted'), line = css('--line'), acc = css('--accent');
  const ymax = Math.max(start * 1.1, ...sim.bands[4]) * 1.04, X = i => m.l + (W - m.l - m.r) * sim.marks[i] / n, Y = v => H - m.b - (H - m.t - m.b) * v / ymax;
  x.font = '12px ' + css('--mono'); x.textBaseline = 'middle';
  const step = (() => { const raw = ymax / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 5, 10].map(f => f * p).find(s => s >= raw); })();
  for (let v = 0; v <= ymax; v += step) { x.strokeStyle = line; x.lineWidth = 1; x.beginPath(); x.moveTo(m.l, Y(v)); x.lineTo(W - m.r, Y(v)); x.stroke(); x.fillStyle = muted; x.textAlign = 'right'; x.fillText('$' + v.toLocaleString(), m.l - 8, Y(v)); }
  x.textAlign = 'center'; x.textBaseline = 'top'; [0, .25, .5, .75, 1].forEach(f => x.fillText(Math.round(n * f).toLocaleString() + (f === 1 ? ' bets' : ''), m.l + (W - m.l - m.r) * f, H - m.b + 8));
  const band = (lo, hi, alpha) => { x.globalAlpha = alpha; x.fillStyle = acc; x.beginPath(); sim.marks.forEach((_, i) => x[i ? 'lineTo' : 'moveTo'](X(i), Y(sim.bands[hi][i])));
    for (let i = sim.marks.length - 1; i >= 0; i--) x.lineTo(X(i), Y(sim.bands[lo][i])); x.closePath(); x.fill(); x.globalAlpha = 1; };
  band(0, 4, 0.14); band(1, 3, 0.24);
  x.setLineDash([4, 4]); x.strokeStyle = muted; x.beginPath(); x.moveTo(m.l, Y(start)); x.lineTo(W - m.r, Y(start)); x.stroke(); x.setLineDash([]);
  x.strokeStyle = acc; x.lineWidth = 2.5; x.lineJoin = 'round'; x.beginPath(); sim.marks.forEach((_, i) => x[i ? 'lineTo' : 'moveTo'](X(i), Y(sim.bands[2][i]))); x.stroke();
  const L = sim.marks.length - 1; x.fillStyle = acc; x.beginPath(); x.arc(X(L), Y(sim.bands[2][L]), 4, 0, 7); x.fill();
  x.textAlign = 'left'; x.textBaseline = 'middle';
  const labs = [['95th', sim.bands[4][L], muted], ['median', sim.bands[2][L], ink], ['5th', sim.bands[0][L], muted]]; let prev = -99;
  labs.forEach(([t, v, col]) => { let y = Y(v); if (y - prev < 14) y = prev + 14; prev = y; x.fillStyle = col; x.fillText(t, W - m.r + 8, y); });
}
$('#v-bankroll').addEventListener('input', renderBank);
window.addEventListener('resize', drawBank);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawBank);
new MutationObserver(drawBank).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });

// ---- bet log ----
function pl(b) { const d = Core.parseOdds(b.odds), s = num(b.stake, 0); return b.res === 'win' ? s * (d - 1) : b.res === 'loss' ? -s : 0; }
function renderLog() {
  const settled = S.log.filter(b => b.res === 'win' || b.res === 'loss' || b.res === 'push'), staked = settled.reduce((a, b) => a + num(b.stake, 0), 0), profit = settled.reduce((a, b) => a + pl(b), 0);
  const clvs = S.log.map(b => { const d = Core.parseOdds(b.odds), c = Core.parseOdds(b.close); return d && c ? d / c - 1 : null; }).filter(v => v != null);
  const clv = clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null;
  const w = settled.filter(b => b.res === 'win').length, l = settled.filter(b => b.res === 'loss').length;
  const tile = (t, v, s, c = '') => `<div class="tile"><span>${t}</span><b class="${c}">${v}</b><div class="small muted">${s}</div></div>`;
  $('#lgtiles').innerHTML = tile('Profit', settled.length ? money(profit) : '—', `${settled.length} settled, ${S.log.length - settled.length} open`, profit > 0 ? 'pos' : profit < 0 ? 'neg' : '')
    + tile('Return on stakes', staked ? signed(profit / staked) : '—', staked ? money(staked) + ' staked' : 'no settled bets yet', profit > 0 ? 'pos' : profit < 0 ? 'neg' : '')
    + tile('Record', settled.length ? `${w}–${l}` : '—', 'wins–losses')
    + tile('Closing line value', clv == null ? '—' : signed(clv, 2), clv == null ? 'add closing prices to see it' : `average over ${clvs.length} bet${clvs.length > 1 ? 's' : ''}`, clv > 0 ? 'pos' : clv < 0 ? 'neg' : '');
  $('#logtbl').innerHTML = S.log.length ? `<thead><tr><th>Date</th><th>Pick</th><th>Price</th><th>Stake</th><th>Closing price</th><th>Beat close</th><th>Result</th><th>Profit</th><th></th></tr></thead><tbody>
    ${S.log.map((b, i) => { const d = Core.parseOdds(b.odds), c = Core.parseOdds(b.close), v = d && c ? d / c - 1 : null, p = pl(b);
      return `<tr><td>${esc(b.d)}</td><td class="txt">${esc(b.pick)}</td><td>${esc(b.odds)}</td><td>${money(num(b.stake, 0))}</td>
        <td><input id="lc-${i}" data-close="${i}" value="${esc(b.close)}" placeholder="—" aria-label="Closing price"></td><td class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v == null ? '—' : signed(v, 2)}</td>
        <td><select id="lr-${i}" data-res="${i}" aria-label="Result" style="font-family:var(--body)">${['open', 'win', 'loss', 'push'].map(r => `<option${b.res === r ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
        <td class="${p > 0 ? 'pos' : p < 0 ? 'neg' : ''}">${b.res === 'open' ? '—' : money(p)}</td><td><button type="button" class="ghost" data-rm="${i}" aria-label="Delete bet">Delete</button></td></tr>`; }).join('')}</tbody>`
    : '<tbody><tr><td class="txt muted">No bets yet. Add one above, or press Log bet on a value price in the slate.</td></tr></tbody>';
}
$('#logform').addEventListener('submit', ev => {
  ev.preventDefault(); const odds = $('#lf-odds').value.trim(), stake = num($('#lf-stake').value, NaN);
  if (!Core.parseOdds(odds)) { $('#logerr').textContent = 'Price not recognised. Use -110, +145 or 1.91.'; return; }
  if (!(stake > 0)) { $('#logerr').textContent = 'Stake must be a positive amount.'; return; }
  $('#logerr').textContent = ''; S.log.unshift({ d:new Date().toISOString().slice(0, 10), pick:$('#lf-pick').value.trim(), odds, stake, close:'', res:'open' }); save(); ev.target.reset(); renderLog();
});
$('#logtbl').addEventListener('change', ev => { const t = ev.target;
  if (t.dataset.close != null) S.log[+t.dataset.close].close = t.value.trim();
  if (t.dataset.res != null) S.log[+t.dataset.res].res = t.value;
  save(); renderLog(); });
$('#logtbl').addEventListener('click', ev => { const b = ev.target.closest('[data-rm]'); if (!b) return; S.log.splice(+b.dataset.rm, 1); save(); renderLog(); });
$('#logcopy').addEventListener('click', async () => {
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const csv = ['date,pick,price,stake,closing_price,result,profit'].concat(S.log.map(b => [b.d, q(b.pick), b.odds, b.stake, b.close, b.res, b.res === 'open' ? '' : pl(b).toFixed(2)].join(','))).join('\n');
  try { await navigator.clipboard.writeText(csv); $('#logmsg').textContent = `Copied ${S.log.length} bet${S.log.length === 1 ? '' : 's'}.`; }
  catch (e) { $('#logmsg').textContent = 'Copy was blocked by the browser.'; }
});

// ---- routing ----
const VIEWS = ['slate', 'odds-lab', 'tennis', 'bankroll', 'bet-log'];
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'slate';
  VIEWS.forEach(n => $('#v-' + n).classList.toggle('on', n === v));
  $$('nav.tabs a').forEach(a => a.getAttribute('href') === '#' + v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  if (v === 'bankroll') drawBank();
}
window.addEventListener('hashchange', route);
{ const p = ts(DATA.pulled), old = Date.now() - p > 36 * 3600e3;
  $('#pulled').textContent = "Data pulled " + new Date(p).toLocaleString([], { weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }) + "." + (old ? " That is more than a day old, so prices and records may have moved." : ""); }
if (DATA.prices) $('#pxsrc').textContent = "Stored " + BOOK + " prices: " + ["nfl","nba","wnba","nhl","epl","ncaaw","tennis","ufc"].filter(k => DATA.prices[k]).map(k => (LEAGUES.find(l => l[0] === k) || [0, k])[1] + " from " + DATA.prices[k]).join("; ") + ".";
setInterval(() => { if (!document.activeElement || !document.activeElement.closest("#events")) renderSlate(); }, 5 * 60e3);
$('#bk-start').value = S.bank;
renderSlate(); renderLabTable(); renderLab(); renderTennis(); renderBank(); renderLog(); route();
