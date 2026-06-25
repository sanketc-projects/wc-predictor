# World Cup Predictor Leaderboard

This project creates a polished, client-side leaderboard for your FIFA World Cup predictor pool.

## What it does
- Renders a fast, attractive leaderboard from a local JSON file.
- Supports search, sorting, and a top-three highlight.
- Works well for GitHub Pages because it is fully static.

## How to update the leaderboard
1. Edit [data/leaderboard.json](data/leaderboard.json).
2. Update each entry with the latest score, correct picks, and rank.
3. Refresh the page locally or push the changes to GitHub Pages.

## Preview locally
Run a local server from the repo root:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages
- Push this folder to a GitHub repository.
- Open the repository settings and enable GitHub Pages.
- Select the GitHub Actions deployment method.
