# Edge Desk

Demo: https://benjaminpsmith2010-byte.github.io/Edge-Desk/

I started this because I wanted to know whether you can actually beat sportsbook lines with a model. (Short answer: it's really hard.) It turned into a tool that turns betting prices into probabilities, compares them to a simple ratings model, and keeps score on how my forecasts do.

It's plain HTML/CSS/JS with no frameworks or build step. Open `index.html` and it runs.

## What's in it

**Slate.** Upcoming NFL, NBA, NHL, Premier League, women's college hoops, and UFC. For each game I take the market's view (the data feed's win probability, plus the FanDuel price with the vig removed) and blend it with my own record-based model in log-odds. You can set how much weight the market gets.

**The model.** Each team's win % gets pulled toward .500 by adding fake average games (11 for the NFL, 12 for the NBA), so a 3-0 team doesn't come out rated like a 100% team. That gets turned into a strength in log-odds, compared head to head (log5), plus a home edge. It knows nothing about injuries, so when it disagrees a lot with the market, the market is usually right.

**Odds lab.** Paste in prices from a few books. It removes each book's margin (proportional, or the power method, which hits longshots harder), averages them into a consensus line, finds the best price for each side, and checks for arbitrage.

**Tennis.** The part I'm proudest of. If you know the % of points each player wins on serve, you can work out the probability of holding a game, then a tiebreak, a set, and the match (best of 3 or 5). It works from any live score too. `js/core.js` has the recursion.

**Bankroll sim.** A Monte Carlo of 2,000 seasons. You bet as if your win rate is what you *believe*, but results are drawn from what it *really* is. If you set believed = 55% and true = 53% at -110, you can watch how being a little overconfident wrecks things.

**Bet log.** Track picks and closing prices. Closing line value (did you beat the price the game closed at?) is a better early sign of an edge than profit, since profit takes forever to stop being luck.

## Files

```
index.html      layout
css/style.css   styles
js/core.js      all the math (odds, devig, ratings, tennis, monte carlo)
js/data.js      slate snapshot
js/app.js       UI
test/           node test/core.test.js
```

## Notes

The data is a snapshot, so the slate goes stale. I'm not betting real money with this. Books keep a margin on everything and most people lose, which is kind of what the bankroll tab shows.

Ben Smith, Georgetown Prep '28. I also co-built [Waypoint](https://waypointinternational.vercel.app).
