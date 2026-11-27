// core math. no DOM stuff in here so I can test it in node
const Core = (() => {
  const logit = p => Math.log(p / (1 - p));
  const logistic = x => 1 / (1 + Math.exp(-x));

  // odds
  // takes american (-110, +145) or decimal (1.91), returns decimal or null
  function parseOdds(s) {
    if (s == null) return null;
    s = String(s).trim().replace(/−/g, '-');
    if (!s) return null;
    const n = Number(s);
    if (!isFinite(n)) return null;
    if (/^[+-]/.test(s) || Math.abs(n) >= 100) {
      if (Math.abs(n) < 100) return null;
      return n > 0 ? 1 + n / 100 : 1 + 100 / -n;
    }
    return n > 1 ? n : null;
  }
  function toAmerican(dec) {
    if (!(dec > 1)) return '';
    const a = dec >= 2 ? (dec - 1) * 100 : -100 / (dec - 1);
    const r = Math.round(a);
    return (r > 0 ? '+' : '') + r;
  }
  const fairDecimal = p => 1 / p;

  // ev + kelly
  const ev = (p, dec) => p * dec - 1;                       // profit per 1 staked
  const kelly = (p, dec) => Math.max(0, (p * dec - 1) / (dec - 1)); // full-Kelly fraction of bankroll

  // devig
  function devigMultiplicative(decs) {
    const imp = decs.map(d => 1 / d), s = imp.reduce((a, b) => a + b, 0);
    return imp.map(x => x / s);
  }
  // power method: binary search for k so sum(imp^k) = 1. hits longshots harder than proportional
  function devigPower(decs) {
    const imp = decs.map(d => 1 / d);
    let lo = 0.5, hi = 3;
    for (let i = 0; i < 60; i++) {
      const k = (lo + hi) / 2, s = imp.reduce((a, x) => a + Math.pow(x, k), 0);
      if (s > 1) lo = k; else hi = k;
    }
    const k = (lo + hi) / 2;
    return imp.map(x => Math.pow(x, k));
  }
  const hold = decs => decs.reduce((a, d) => a + 1 / d, 0) - 1;

  // arb check on the best price for each outcome
  function arbitrage(bestDecs, total) {
    const s = bestDecs.reduce((a, d) => a + 1 / d, 0);
    return { sum: s, exists: s < 1, profitPct: 1 / s - 1,
             stakes: bestDecs.map(d => total * (1 / d) / s) };
  }

  // team ratings: win % regressed to .500 (add `prior` fake games), in log odds
  function strength(w, l, t, prior) {
    const g = w + l + t;
    return logit((w + 0.5 * t + prior / 2) / (g + prior));
  }
  const matchup = (sHome, sAway, homeEdge) => logistic(sHome - sAway + homeEdge);
  // blend market + model in log odds, wFeed = market weight
  const blend = (pFeed, pModel, wFeed) => logistic(wFeed * logit(pFeed) + (1 - wFeed) * logit(pModel));

  // tennis. point -> game -> tiebreak -> set -> match
  function gameWin(p) {
    const q = 1 - p;
    return Math.pow(p, 4) * (1 + 4 * q + 10 * q * q) + 20 * Math.pow(p * q, 3) * (p * p / (1 - 2 * p * q));
  }
  // tiebreak, A serves first. a/b = serve point win % for each player
  function tiebreakWin(a, b) {
    const memo = new Map();
    const f = (x, y) => {
      if (x >= 7 && x - y >= 2) return 1;
      if (y >= 7 && y - x >= 2) return 0;
      if (x === 6 && y === 6) { const w = a * (1 - b), l = (1 - a) * b; return w / (w + l); }
      const key = x * 16 + y;
      if (memo.has(key)) return memo.get(key);
      const n = x + y, aServes = (((n + 1) >> 1) % 2) === 0;
      const pw = aServes ? a : 1 - b;
      const v = pw * f(x + 1, y) + (1 - pw) * f(x, y + 1);
      memo.set(key, v); return v;
    };
    return f(0, 0);
  }
  // set from any game score (works live)
  function setWin(a, b, ga = 0, gb = 0, aServes = true) {
    const ha = gameWin(a), hb = gameWin(b), tb = tiebreakWin(a, b);
    const memo = new Map();
    const f = (x, y, srv) => {
      if (x >= 6 && x - y >= 2) return 1;
      if (y >= 6 && y - x >= 2) return 0;
      if (x === 7) return 1;
      if (y === 7) return 0;
      if (x === 6 && y === 6) return tb;
      const key = (x * 8 + y) * 2 + (srv ? 1 : 0);
      if (memo.has(key)) return memo.get(key);
      const pw = srv ? ha : 1 - hb;
      const v = pw * f(x + 1, y, !srv) + (1 - pw) * f(x, y + 1, !srv);
      memo.set(key, v); return v;
    };
    return f(ga, gb, aServes);
  }
  // match. st = live score {sa, sb, ga, gb, aServes} if mid-match
  function matchWin(a, b, bestOf = 3, st = {}) {
    const need = (bestOf + 1) / 2;
    const fresh = setWin(a, b, 0, 0, true);
    const cur = setWin(a, b, st.ga || 0, st.gb || 0, st.aServes !== false);
    const f = (sa, sb, first) => {
      if (sa >= need) return 1;
      if (sb >= need) return 0;
      const p = first ? cur : fresh;
      return p * f(sa + 1, sb, false) + (1 - p) * f(sa, sb + 1, false);
    };
    return { match: f(st.sa || 0, st.sb || 0, true), set: fresh, holdA: gameWin(a), holdB: gameWin(b) };
  }

  // monte carlo bankroll sim
  function rng(seed) {
    let t = seed >>> 0;
    return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  }
  // stake off what you THINK your win % is, but results use the TRUE win %
  // (that gap is the whole point of the sim)
  function simulate({ start, bets, dec, pBelieved, pTrue, kellyMult, paths = 2000, seed = 7 }) {
    const frac = Math.min(1, kellyMult * kelly(pBelieved, dec));
    const r = rng(seed), steps = 60, every = Math.max(1, Math.floor(bets / steps));
    const marks = []; for (let i = 0; i <= bets; i += every) marks.push(i);
    if (marks[marks.length - 1] !== bets) marks.push(bets);
    const cols = marks.map(() => new Float64Array(paths));
    let below = 0, halved = 0; const finals = new Float64Array(paths);
    for (let p = 0; p < paths; p++) {
      let b = start, peak = start, hit = false, m = 0;
      for (let i = 0; i <= bets; i++) {
        if (i === marks[m]) { cols[m][p] = b; m++; }
        if (i === bets) break;
        const stake = b * frac;
        b += r() < pTrue ? stake * (dec - 1) : -stake;
        if (b > peak) peak = b;
        if (b <= peak * 0.5) hit = true;
      }
      finals[p] = b; if (b < start) below++; if (hit) halved++;
    }
    const q = (arr, x) => { const s = Array.from(arr).sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(x * s.length))]; };
    const bands = [0.05, 0.25, 0.5, 0.75, 0.95].map(x => cols.map(c => q(c, x)));
    return { frac, marks, bands, median: q(finals, 0.5), p5: q(finals, 0.05), p95: q(finals, 0.95),
             pBelow: below / paths, pHalved: halved / paths };
  }

  return { logit, logistic, parseOdds, toAmerican, fairDecimal, ev, kelly, devigMultiplicative, devigPower,
           hold, arbitrage, strength, matchup, blend, gameWin, tiebreakWin, setWin, matchWin, simulate };
})();
if (typeof module !== 'undefined') module.exports = Core;
