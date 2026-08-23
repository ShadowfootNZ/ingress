# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A collection of static web apps for the Ingress community, deployed to GitHub Pages at `shadowfootnz.github.io/ingress/`. There is no build step, no bundler, no linter, and no test suite — all code is plain HTML/CSS/JS served as-is.

Sub-apps:
- `countdown/` — real-time anomaly event countdown with animated faction cards
- `anomaly-map/` — historical anomaly map (Leaflet) with series/country filters
- `key-map-viewer/` — paste Intel Inventory text to plot portal keys on a map
- `orion-progress/` — Orion token/tier calculator (self-contained single HTML file)
- `beta-progress/` — beta medal progress tracker
- `missions/` — local tools for First Saturday banner planning and review

## Running locally

Because `countdown/` uses ES modules and `fetch()`, a local HTTP server is required (file:// won't work):

```sh
npx serve .           # serves all sub-apps from repo root
# or
python3 -m http.server 8000
```

Analytics in `analytics.js` silently skips localhost, so it's safe to develop locally without instrumentation noise.

## Pre-commit hook

`.git/hooks/pre-commit` auto-regenerates `anomaly-map/data/build-meta.json` (with `build`, `commit`, `data_mtime` fields) and stages it on every commit made with a client that runs local git hooks. This file should never be edited manually.

Because some git clients (e.g. Working Copy on iOS) don't run local hooks, the deploy workflow (`.github/workflows/deploy.yml`) regenerates `anomaly-map/data/build-meta.json` itself before deploying — using `git log` against `anomalies-historical.json` for `data_mtime` rather than trusting the committed file — so production is correct regardless of which client made the commit.

## Key data files

**`countdown/anomaly-countdown.json`** — upcoming anomaly events. Top-level array of series objects:
```json
[
  {
    "series": "Orion",
    "series-results": "url",
    "series-details": "url",
    "series-logos": ["Orion_bronze.png", ...],
    "anomaly-badges": ["Orion.png"],
    "sites": [
      {
        "date": "2026-06-20T14:00:00",  // local time in the named timezone
        "city": "Geneva",
        "country": "Switzerland",
        "timezone": "Europe/Zurich",    // IANA timezone name
        "url-enl": "https://...",
        "url-res": "https://...",
        "winner": "enlightened",        // optional; set after the event
        "location": { "lat": 46.2044, "lng": 6.1432 }
      }
    ]
  }
]
```
Omit `"winner"` for future events. The `"date"` is interpreted in the event's local timezone via Luxon.

**`anomaly-map/data/anomalies-historical.json`** — historical map data with a nested structure:
```json
{
  "series": {
    "SeriesName": {
      "TypeName": {
        "2015-06-06": [
          { "city": "...", "region": "...", "country": "...", "score": { "enl": 0, "res": 0 } }
        ]
      }
    }
  },
  "locations": {
    "Country, Region, City": { "lat": 0.0, "lng": 0.0 }
  },
  "countries": {
    "Country": { "iso2": "XX", "flag": "🏳" }
  }
}
```
Every event entry requires a matching `locations` key (`"Country, Region, City"` — empty parts remain empty strings). Missing keys cause a visible data-warning banner on the map. Run `node anomaly-map/scripts/formatAnomaliesHistorical.js` after editing this file to normalise formatting (collapses `score`, `locations`, and `countries` entries to single lines).

## Shared module: `countdown/shared-utils.js`

Used by both `countdown/countdown.js` and `countdown/map.js`. Exports as an ES module and also exposes `window.AnomalyUtils` for non-module scripts. Key exports:
- `loadAnomalyData(includeTest)` — fetches and flattens `anomaly-countdown.json`, attaches a Luxon `utcDate` to each site
- `filterUpcomingAnomalies(anomalies)` — removes series whose latest event is older than `CONFIG.SERIES_CUTOFF_MONTHS`
- `CONFIG` — tunable constants (`EVENT_DURATION_HOURS`, `POST_EVENT_DISPLAY_HOURS`, etc.)
- `getSeriesColor(series)` — stable deterministic colour per series, avoiding faction blue/green hues

Luxon is loaded from CDN via `<script>` tag before the module; `shared-utils.js` reads it from `window.luxon`.

## Countdown border-state system

Each anomaly card gets exactly one CSS class controlling its animated border:

| Class | Meaning |
|---|---|
| `border-active` | Event is happening right now — blue/green tug-of-war background plus a `LIVE` badge |
| `border-res` / `border-enl` | Completed; faction winner known |
| `border-prep-both` | Both faction team links present |
| `border-prep-res` / `border-prep-enl` | Only one faction link present |
| `border-default` | No team links (neutral/missing) |

`applyBorderClass()` in `countdown.js` assigns the class and applies a random negative `animation-delay` so cards don't pulse in sync. In addition, cards within `CONFIG.IMMINENT_WINDOW_HOURS` (24h) of start get an `imminent` modifier class alongside their prep/default class, which swaps in an accelerated, brighter version of the same pulse and throbs the countdown text. A 30s interval re-renders when any card crosses a state boundary (prep → imminent → active), so open pages promote without a reload. `?test=true&test-offset=<hours>` shifts the injected test event to preview these states.

## Anomaly map scripts (Node.js)

All run from the repo root:

```sh
# Geocode missing location keys (dry run by default):
node anomaly-map/scripts/geocode.js
node anomaly-map/scripts/geocode.js update          # write changes

# Re-validate existing locations against Nominatim:
node anomaly-map/scripts/geocode.js refresh
node anomaly-map/scripts/geocode.js refresh update

# Format anomalies-historical.json (normalise score/location/country lines):
node anomaly-map/scripts/formatAnomaliesHistorical.js

# Compare Google Sheet "City List" against anomalies-historical.json:
node anomaly-map/scripts/compareSheetToJson.js
node anomaly-map/scripts/compareSheetToJson.js strict show-matches anomaly=Orion
```

## Banner scraper (Python)

```sh
cd banner-scraper
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 bannergress.py
```

## Analytics

`analytics.js` at repo root is a drop-in tracker for each page. Include it just before `</body>`. It derives `app_id` from the URL path automatically and is a no-op on localhost.

## Missions tools

Tools in `missions/` are intended for local use only — they read from `missions/banners/*.json` (structured mission data) and `missions/images/` (candidate mission images). The naming convention for images is `<prefix> <mission>-<variant>.jpg` (e.g. `IFS 03-2026 1-2.jpg` = prefix "IFS 03-2026", mission 1, variant 2).
