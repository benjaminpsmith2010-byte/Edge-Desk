// quick sanity checks for the math. run with: node test/core.test.js
const assert = require('assert');
const C = require('../js/core.js');

const close = (a, b, eps = 1e-3) => assert(Math.abs(a - b) < eps, `${a} != ${b}`);

// odds conversion
close(C.parseOdds('-110'), 1.909);
close(C.parseOdds('+150'), 2.5);
close(C.parseOdds('1.91'), 1.91);
assert.strictEqual(C.parseOdds('abc'), null);
assert.strictEqual(C.toAmerican(2.5), '+150');

// devig should always add to 1
for (const f of [C.devigMultiplicative, C.devigPower]) {
  const p = f([1.67, 2.3]);
  close(p[0] + p[1], 1);
}

// two equal teams on a neutral field = 50/50
close(C.matchup(0, 0, 0), 0.5);

// tennis: equal servers should be a coin flip, better server should be favored
close(C.matchWin(0.62, 0.62, 3).match, 0.5);
assert(C.matchWin(0.66, 0.6, 3).match > 0.5);
// up 5-0 in the third set... should be close to a lock
assert(C.matchWin(0.62, 0.62, 3, { sa: 1, sb: 1, ga: 5, gb: 0 }).match > 0.95);

// kelly bets nothing with no edge
assert.strictEqual(C.kelly(0.5, 1.9), 0);

console.log('all tests passed');
