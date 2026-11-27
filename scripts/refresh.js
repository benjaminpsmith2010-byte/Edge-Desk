// pulls the next few days of games from ESPN's public scoreboard and rewrites js/data.js
// run: node scripts/refresh.js   (github actions runs it every morning, see .github/workflows)
// no api key needed. if a league fails it just gets skipped, and if everything fails
// the old data.js is left alone so the site never goes blank.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'js', 'data.js');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';

// [my key, espn path, days ahead to pull, grab espn's win % from the game summary?]
const LEAGUES = [
  ['nfl', 'football/nfl', 7, true],
  ['nba', 'basketball/nba', 2, true],
  ['wnba', 'basketball/wnba', 3, true],
  ['nhl', 'hockey/nhl', 2, false],
  ['epl', 'soccer/eng.1', 7, false],
  ['ncaaw', 'basketball/womens-college-basketball', 1, true],
  ['ufc', 'mma/ufc', 10, false],
];
// tennis isn't here on purpose: espn's tennis feed is shaped totally differently and
// the tennis tab prices matches from serve %, so you type those in yourself

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const stamp = d => d.toISOString().slice(0, 16) + 'Z'; // "2026-11-27T12:30Z", same format app.js expects

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'edge-desk (student project)' } });
      if (r.ok) return await r.json();
      console.log('  ' + r.status + ' ' + url);
    } catch (e) { console.log('  ' + e.message + ' ' + url); }
    await new Promise(res => setTimeout(res, 1500));
  }
  return null;
}

// espn has changed its odds format a couple times so check every spot it might be
function american(v) {
  if (v == null) return null;
  if (typeof v === 'object') v = v.american ?? v.odds ?? v.value;
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (s === 'EVEN' || s === 'EV') return '+100';
  const n = parseFloat(s);
  if (!isFinite(n) || Math.abs(n) < 100) return null;
  return (n > 0 ? '+' : '') + Math.round(n);
}
function moneyline(o, side) {
  if (!o) return null;
  const m = o.moneyline && o.moneyline[side];
  const t = o[side + 'TeamOdds'] || (side === 'draw' ? o.drawOdds : null);
  return american(m && m.close && m.close.odds) || american(m && m.open && m.open.odds)
    || american(t && t.moneyLine) || american(t && t.current && t.current.moneyLine) || null;
}

function record(c) {
  const rs = c.records || [];
  const r = rs.find(x => x.type === 'total' || x.name === 'overall' || x.name === 'All Splits') || rs[0];
  if (!r || !r.summary) return null;
  const parts = r.summary.split('-').map(Number);
  return parts.every(isFinite) ? parts : null;
}

async function predictor(espnPath, id) {
  const s = await get(BASE + espnPath + '/summary?event=' + id);
  const p = s && s.predictor;
  if (!p) return null;
  const h = parseFloat(p.homeTeam && (p.homeTeam.gameProjection ?? p.homeTeam.teamChanceLoss));
  const a = parseFloat(p.awayTeam && p.awayTeam.gameProjection);
  if (isFinite(h) && isFinite(a) && h + a > 90) return [a, h];
  if (isFinite(h)) return [+(100 - h).toFixed(1), h];
  return null;
}

async function pull([key, espnPath, days, wantPred], now, rec, books) {
  // one request per day (espn 400s on date ranges for some leagues)
  const seen = new Set(), list = [];
  for (let d = 0; d <= days; d++) {
    const data = await get(BASE + espnPath + '/scoreboard?dates=' + ymd(new Date(now.getTime() + d * 864e5)));
    for (const ev of (data && data.events) || []) if (!seen.has(ev.id)) { seen.add(ev.id); list.push(ev); }
  }
  if (!list.length) { console.log(key + ': nothing back, skipped'); return []; }
  const rows = [];
  for (const ev of list) {
    // ufc puts every bout in one event, everything else is one game per event
    const comps = key === 'ufc' ? (ev.competitions || []) : (ev.competitions || []).slice(0, 1);
    for (const comp of comps) {
      const t = new Date(comp.date || ev.date);
      if (!(t > now)) continue; // already started
      const cs = comp.competitors || [];
      if (cs.length !== 2) continue;
      const home = cs.find(c => c.homeAway === 'home') || cs[1];
      const away = cs.find(c => c !== home);
      const nm = c => c.team ? c.team.displayName : (c.athlete && c.athlete.displayName) || '';
      const ab = c => (c.team && c.team.abbreviation) || '';
      if (!nm(home) || !nm(away)) continue;

      if (key === 'nfl' || key === 'nba') {
        rec[key] = rec[key] || {};
        [home, away].forEach(c => { const r = record(c); if (r && ab(c)) rec[key][ab(c)] = r.slice(0, key === 'nfl' ? 3 : 2); });
      }

      const odds = (comp.odds || [])[0];
      if (process.env.DEBUG && !rows.length) console.log('  odds sample: ' + JSON.stringify(odds || null).slice(0, 600));
      const px = [moneyline(odds, 'away'), moneyline(odds, 'home')];
      const draw = key === 'epl' ? moneyline(odds, 'draw') : null;
      if (odds && odds.provider && odds.provider.name && px.every(Boolean)) books[key] = odds.provider.name;

      // win % feed. soccer: no-vig 3-way from the odds (away, home, draw)
      let feed = null;
      if (key === 'epl' && px.every(Boolean) && draw) {
        const dec = [...px, draw].map(o => { const n = +o; return n > 0 ? 1 + n / 100 : 1 + 100 / -n; });
        const inv = dec.map(d => 1 / d), tot = inv.reduce((x, y) => x + y, 0);
        feed = inv.map(v => +(100 * v / tot).toFixed(1));
      } else if (wantPred) {
        feed = await predictor(espnPath, ev.id);
      }

      const neutral = key === 'ufc' ? 'neutral' : comp.neutralSite ? 'neutral:' + ((comp.venue && comp.venue.address && comp.venue.address.city) || '') : null;
      const row = [key, stamp(t), nm(away), ab(away), nm(home), ab(home)];
      const extra = [feed ? feed[0] : null, feed ? feed[1] : null, feed && feed[2] != null ? feed[2] : null, neutral, px.every(Boolean) ? px : null];
      while (extra.length && extra[extra.length - 1] == null) extra.pop(); // keep rows short like before
      rows.push(row.concat(extra));
    }
  }
  console.log(key + ': ' + rows.length + ' upcoming');
  return rows;
}

(async () => {
  const now = new Date();
  const rec = {}, books = {};
  let events = [];
  for (const lg of LEAGUES) events = events.concat(await pull(lg, now, rec, books));

  // if most leagues failed, keep yesterday's slate instead of posting a half-empty one
  const got = new Set(events.map(e => e[0])).size;
  if (got < 3) { console.log('only ' + got + ' leagues came back, leaving data.js alone'); process.exitCode = 1; return; }
  events.sort((a, b) => a[0] === b[0] ? a[1].localeCompare(b[1]) : 0);

  // which sportsbook espn showed for each league (usually not fanduel, so the app labels it)
  const names = [...new Set(Object.values(books))];
  const prices = { book: names.length === 1 ? names[0] : 'Sportsbook' };
  for (const [k, b] of Object.entries(books)) prices[k] = b + ' moneyline via ESPN, pulled ' + now.toUTCString().slice(5, 22) + ' UTC';

  const DATA = { pulled: stamp(now), rec, events, prices };
  const out = '// slate pulled automatically by scripts/refresh.js (' + stamp(now) + ')\nconst DATA = ' + JSON.stringify(DATA) + ';\n';
  fs.writeFileSync(OUT, out);
  console.log('wrote ' + events.length + ' games to js/data.js');
})();
