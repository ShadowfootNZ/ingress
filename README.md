# Ingress Web Apps

A collection of web apps supporting the global Ingress community, though sometimes with an Enlightened point-of-view.

## Ingress Bounty Bonus Progress

Calculate where you are with bounty bonus tokens for the current quarterly campaign.
[Check progress](https://apps.shadowfoot.com/ingress-bounty-progress/).

## Ingress Anomaly Countdown

Track upcoming and active Ingress anomalies with real-time countdowns, local times, and event details to +Gamma and 2026Q2.
[View the Countdown](https://apps.shadowfoot.com/ingress-countdown/). Please let me know of public team sites for these, for the team logo to link to.

## Ingress Anomaly Map  

An interactive global map showing the history of Ingress anomaly sites, coloured and sized by outcome and recency.  
[View the Anomaly Map](https://apps.shadowfoot.com/ingress-anomaly-map/)  
Data collated from community sources including [Ingress Anomaly Stats](https://linktr.ee/ingressanomalystats).  

## CARTO basemap configuration

The anomaly history map, countdown map, and key map viewer read the CARTO browser API key from an untracked `carto-config.js` file in each app directory. For local development, create each file with this content, replacing the example value:

```js
globalThis.CARTO_API_KEY = "your-carto-api-key";
```

The required paths are `anomaly-map/carto-config.js`, `countdown/carto-config.js`, and `key-map-viewer/carto-config.js`. These files are excluded by `.gitignore`. Serve the repository over HTTP as usual; opening ES modules directly with a `file:` URL is not supported by browsers.

For deployment, add a GitHub Actions repository secret named `CARTO_API_KEY` under **Settings → Secrets and variables → Actions**. The deployment workflow generates the same config file inside each affected app immediately before uploading it. The key is not committed, but it remains visible in browser requests as required for a client-side basemap key.

## Ingress Key Map Viewer  

[Visualise your portal keys on an interactive map](https://shadowfootnz.github.io/ingress/key-map-viewer/) by copying the **Portal Keys** section from Intel Inventory (requires Core). This works with some IITC plugins as well as base intel. The main use of this will be identifying which keys to clear out.

![Intel Inventory](img/Inventory.webp)

Portals are coloured by key count (using resonator-level colours) and automatically grouped on the map for easy inspection.
This data is entirely local, with nothing being uploaded anywhere; you'll need to share what you copied from Intel if you want to share your map.

## Mission Planning Tools

The [`missions/`](missions/) folder contains a set of local tools for planning and reviewing Ingress banner missions, events. See the [missions README](missions/README.md) for details.

---

## Feedback and Contributions

Use [GitHub Issues](https://github.com/ShadowfootNZ/ingress) or [@shadowfoot.bsky.social](https://bsky.app/profile/shadowfoot.bsky.social) to let me know.

Contributions, suggestions, and corrections are always welcome.
