# Union Raid Mock Planner — Web Build

Single-page, dependency-free build of the planner for **GitHub Pages** or local use.
No server code, no external JSON files — all data lives in `webdata.js` and your browser's localStorage.

Cut from the Electron app: Confirmed Hits (API), Auto Assign Teams, Combat Log.
Added: schedule ↔ sheet **name linking**, sheet **auto-update**, card-style **parse log**, and a
**Paste CSV** fallback for when the browser blocks fetches.

## Files

| File | Source |
|---|---|
| `index.html` | hand-maintained UI shell |
| `web-app.js` | hand-maintained renderer |
| `src/web-extra.css` | hand-maintained web-only styles |
| `web.css` | **generated** = `electron-app/styles.css` + `src/web-extra.css` |
| `webdata.js` | **generated** = `{ nikke name → base64 square icon }` from `asset_map.json` (~1.5 MB, all 203 squares embedded) |
| `logic.js`, `sheet-parser.js`, `html2canvas.min.js` | **copied** from `electron-app/` |

## Regenerating (new characters / assets / logic changes)

From the HP3 folder:

```
python build_web.py
```

Run this whenever `asset_map.json` / `character_map.json` change (new Nikkes, skins) or after
changing `logic.js` / `sheet-parser.js` / `styles.css` in the Electron app. `index.html`,
`web-app.js` and `src/web-extra.css` are never overwritten.

## Deploy to GitHub Pages

Push the `web-app/` folder to a repo (as the root, or under `docs/`) and enable Pages.
That's it — no build step on GitHub's side.

## Run locally

**Option A — local server (full features, auto-fetch works):**
```
cd web-app
python -m http.server 8080
# open http://127.0.0.1:8080
```

**Option B — double-click `index.html` (file://):**
The app runs, but browsers block Google Sheets fetches from `file://` pages.
Use **Paste CSV manually…** (File → Export as CSV in Google Sheets, paste, Parse) for both
the raid sheet and the schedule sheet. Everything else (assigning, cards, Discord export) works.

## Usage notes

- The Google Sheet must be shared as **"Anyone with the link can view"** for auto-fetch.
- First **Load** asks you to confirm the 5 boss tables (auto-detected from the sheet);
  they're saved in the browser and reused silently afterwards. **Boss Tables…** re-opens the dialog
  when next raid renames the tables.
- **Name Linking**: any schedule member whose name doesn't match a sheet commander (case-insensitive)
  appears in the left pane with a dropdown to link them. Linked members get schedule tags on their hits.
- **Auto Update Sheet**: Off / 5 / 10 / 30 minutes; re-fetches the sheet and schedule, logs new hits.
- **Discord export** posts straight to your webhook from the browser (Discord allows CORS).
  Send buttons are excluded from the exported image.
- All 203 square Nikke icons are **embedded as base64** in `webdata.js` — the page makes zero
  CDN requests and works fully offline for icons (verified: 0 network image requests, export
  canvas untainted). `build_web.py` downloads any missing icons once into `cache/` (shared with
  the Electron app), so rebuilds are instant.
