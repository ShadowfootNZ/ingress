// map.js — upcoming anomaly map

import { DateTime } from "https://cdn.jsdelivr.net/npm/luxon@3.4.4/build/es6/luxon.min.js";
// Assign a stable colour to each series
const seriesColours = {};

function colourForSeries(series) {
  if (!seriesColours[series]) {
    // Auto-generate a colour from the series string (stable hashing)
    let hash = 0;
    for (let i = 0; i < series.length; i++) {
      hash = series.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = Math.abs(hash) % 360;
    seriesColours[series] = `hsl(${hue}, 80%, 55%)`;  // bright readable colours
  }
  return seriesColours[series];
}
function makeMarker(lat, lng, colour, popupHtml) {
  const icon = L.divIcon({
    className: 'event-pin',
    html: `<div style="
      width:14px;
      height:14px;
      background:${colour};
      border:1px solid #fff;
      border-radius:50%;
      box-shadow:0 0 6px ${colour};
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });

  return L.marker([lat, lng], { icon }).bindPopup(popupHtml);
}

// Load anomalies.json from the countdown folder
async function loadEvents() {
  const res = await fetch(`./anomaly-countdown.json?ts=${Date.now()}`, { cache: "no-store" });
  const data = await res.json();

  if (!Array.isArray(data)) return [];

  // Flatten series structure (same as countdown app)
  const events = data.flatMap(seriesObj =>
    seriesObj.sites.map(site => ({
      series: seriesObj.series,
      ...site
    }))
  );

  // Select the next upcoming event with coordinates
  const now = DateTime.utc();
  const withDates = events.map(evt => {
      let dateStr = evt.date;
      if (!dateStr.includes("T")) dateStr += "T00:00:00";
      const local = DateTime.fromISO(dateStr, { zone: evt.timezone || "UTC" });
      return { ...evt, utcDate: local.toUTC() };
    })
    .filter(evt =>
      evt.utcDate &&
      evt.utcDate.toMillis() >= now.toMillis() &&
      evt.location &&
      evt.location.lat !== null &&
      evt.location.lng !== null
    )
    .sort((a, b) => a.utcDate.toMillis() - b.utcDate.toMillis());

  return withDates;
}

function drawRechargeCircle(map, lat, lng, km, colour) {
  return L.circle([lat, lng], {
    radius: km * 1000,
    color: colour,
    weight: 2,
    fillOpacity: 0
  }).addTo(map);
}

async function initMap() {
  const events = await loadEvents();

  if (!events.length) {
    return;
  }
  // Build legend from loaded events
  const legendEl = document.getElementById("legend");
  if (legendEl) {
    const seriesList = [...new Set(events.map(e => e.series))];
    const itemsHtml = seriesList
      .map(series => {
        const c = colourForSeries(series);
        return `
          <div class="legend-item">
            <span class="legend-swatch" style="background:${c};"></span>
            <span class="legend-label">${series}</span>
          </div>
        `;
      })
      .join("");

    legendEl.innerHTML = `
      <h4>Series</h4>
      ${itemsHtml}
    `;
  }
  const { lat, lng } = events[0].location;

  // Create map
  const map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true
  }).setView([lat, lng], 3);

  // Dark base layer (Ingress‑like)
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 6,
    attribution: '&copy; OpenStreetMap & CartoDB'
  }).addTo(map);

  // Add markers and recharge circles for all upcoming events
  for (const evt of events) {
    const { lat, lng } = evt.location;
    const c = colourForSeries(evt.series);
    const popup = `<strong>${evt.city}, ${evt.country}</strong><br>${evt.series}<br>${evt.date}`;
    makeMarker(lat, lng, c, popup).addTo(map);
    drawRechargeCircle(map, lat, lng, 4000, c);
  }
}

// Start
initMap();