// map.js — upcoming anomaly map

import { DateTime } from "https://cdn.jsdelivr.net/npm/luxon@3.4.4/build/es6/luxon.min.js";

// Load anomalies.json from the countdown folder
async function loadEvents() {
  const res = await fetch(`./anomalies.json?ts=${Date.now()}`, { cache: "no-store" });
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

function drawRechargeCircle(map, lat, lng, km) {
  // Leaflet's built‑in distance circle automatically handles Mercator distortion.
  return L.circle([lat, lng], {
    radius: km * 1000,     // metres
    color: "#ff4444",
    weight: 2,
    fillOpacity: 0
  }).addTo(map);
}

async function initMap() {
  const events = await loadEvents();

  if (!events.length) {
    return;
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
    L.marker([lat, lng])
      .addTo(map)
      .bindPopup(`<strong>${evt.city}, ${evt.country}</strong><br>${evt.series}<br>${evt.date}`);
    drawRechargeCircle(map, lat, lng, 4000);
  }
}

// Start
initMap();