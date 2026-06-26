# World Cup Predictor Leaderboard

This project creates a polished, client-side leaderboard for your FIFA World Cup predictor pool.

## What it does
- Stores every player's frozen DeFiRate picks in [data/predictions.json](data/predictions.json).
- Calculates scores locally from [data/results.json](data/results.json) and [data/scoring-rules.json](data/scoring-rules.json).
- Supports search, sorting, top-three highlights, and per-player scoring breakdowns.
- Works well for GitHub Pages because it is fully static.

## How to update scores
1. Edit [data/results.json](data/results.json).
2. Add finalized group placements by team code, for example `"D": ["TEAM1", "TEAM2", "TEAM3"]`.
3. Add finalized third-place advancers in `thirdAdvancers`. You can use either group letters or team codes.
4. Add finalized knockout winners by match code in `matches`, for example `"M73": "MEX"`.
5. Refresh the page locally or push the changes to GitHub Pages.

The page does not use DeFiRate's `score` or `picks_correct` values for ranking. Those values are kept only as a reference in the frozen predictions file.

## Refresh player picks from DeFiRate
The predictions are already synced, but you can regenerate them from the public pool link:

```bash
npm run sync:defirate
```

That command fetches the pool roster and each public bracket's picks from DeFiRate's public REST API, then rewrites [data/predictions.json](data/predictions.json).

## Preview locally
Run a local server from the repo root:

```bash
npm run serve
```

Then open http://localhost:8000.

## Deploy to GitHub Pages
- Push this folder to a GitHub repository.
- Open the repository settings and enable GitHub Pages.
- Select the GitHub Actions deployment method.
