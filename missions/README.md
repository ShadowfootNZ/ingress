# Mission Tools

A set of local tools for planning and reviewing Ingress banner missions, primarily for First Saturday events.

## Tools

### [Portal Images (Bannergress)](https://shadowfootnz.github.io/ingress/missions/portal-images-bannergress.html) — Bannergress Portal Images
Paste a Bannergress banner URL to explore its portal images mission by mission. Useful for understanding what portals are included in a published banner and for locating a specific portal within it. Displays each mission's portal images in a scrollable row, with hover preview on desktop and bulk zip download of all portal or mission images.

### [Portal Images (local)](https://shadowfootnz.github.io/ingress/missions/portal-images-local.html) — Local Portal Images
Helps a mission planner review a proposed mission set and identify any portals that don't match the theme. Reads from the local banner JSON files in `banners/` and displays portal images grouped by mission, making it easy to spot outliers before the missions are submitted.

### [Banner Map](https://shadowfootnz.github.io/ingress/missions/banner-map.html) — Banner Map
Shows the portal locations of a proposed mission set on an interactive map — the same kind of view Bannergress provides for published banners, but for local data before submission. Each mission gets a distinct colour, sequential missions are connected by a route line, and a legend identifies them. Select between available banners from the dropdown. A **Download KML** button exports the current banner as a KML file (colour-coded to match the map) for import into Google Maps or Google Earth.

### [Mission Image Review](https://shadowfootnz.github.io/ingress/missions/mission-image-review.html) — Mission Image Review
Helps mission creators review and compare proposed mission images before finalising a mission. Images are read from the `images/` folder using a naming convention that encodes the mission number and image variant (e.g. `IFS 03-2026 1-1.jpg` for the first candidate for mission 1, `IFS 03-2026 1-2.jpg` for a second candidate). The tool groups images by prefix and mission row so alternatives sit side by side, making it easy to choose between options. A live filter narrows the display by filename. Hovering over the image shows how the badge will appear as a circle.

## Data

Banner JSON files live in `banners/`. These are the structured mission data files used by the local tools above.