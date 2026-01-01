/**
 * map.js - Interactive map of upcoming Ingress anomalies
 * Shows L16 recharge range (4000km) for each event location
 * Refactored to use shared utilities
 */

import {
  DateTime,
  CONFIG,
  escapeHtml,
  loadAnomalyData,
  getSeriesColor
} from './shared-utils.js';

/**
 * Creates a custom marker with specified color
 */
function makeMarker(lat, lng, colour, popupHtml) {
  const icon = L.divIcon({
    className: 'event-pin',
    html: `<div style="
      width: 14px;
      height: 14px;
      background: ${colour};
      border: 1px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 6px ${colour};
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });

  return L.marker([lat, lng], { icon }).bindPopup(popupHtml);
}

/**
 * Draws a circle representing portal recharge range
 */
function drawRechargeCircle(map, lat, lng, radiusKm, colour) {
  return L.circle([lat, lng], {
    radius: radiusKm * 1000, // Convert km to meters
    color: colour,
    weight: 2,
    fillOpacity: 0
  }).addTo(map);
}

/**
 * Loads and filters upcoming anomaly events with coordinates
 * Returns only events that have valid location data and are in the future
 */
async function loadEvents() {
  try {
    // Load all anomaly data using shared utility
    const anomalies = await loadAnomalyData(false);

    // Filter to upcoming events with coordinates
    const now = DateTime.utc();
    const upcomingWithCoords = anomalies
      .filter(evt => 
        evt.utcDate &&
        evt.utcDate.toMillis() >= now.toMillis() &&
        evt.location &&
        typeof evt.location.lat === 'number' &&
        typeof evt.location.lng === 'number'
      )
      .sort((a, b) => a.utcDate.toMillis() - b.utcDate.toMillis());

    return upcomingWithCoords;
    
  } catch (err) {
    console.error('Error loading events:', err);
    return [];
  }
}

/**
 * Builds and displays the map legend
 */
function buildLegend(events) {
  const legendEl = document.getElementById("legend");
  if (!legendEl) return;

  const seriesList = [...new Set(events.map(e => e.series))];
  
  if (!seriesList.length) {
    legendEl.innerHTML = '<p>No upcoming events</p>';
    return;
  }

  const itemsHtml = seriesList
    .map(series => {
      const color = getSeriesColor(series); // Use shared utility
      const escapedSeries = escapeHtml(series); // Use shared utility
      return `
        <div class="legend-item">
          <span class="legend-swatch" style="background: ${color};"></span>
          <span class="legend-label">${escapedSeries}</span>
        </div>
      `;
    })
    .join("");

  legendEl.innerHTML = `
    <h4>Series</h4>
    ${itemsHtml}
  `;
}

/**
 * Creates popup HTML for an event marker
 */
function createPopupHtml(evt) {
  const city = escapeHtml(evt.city);
  const country = escapeHtml(evt.country);
  const series = escapeHtml(evt.series);
  const date = escapeHtml(evt.date);
  
  return `
    <strong>${city}, ${country}</strong><br>
    ${series}<br>
    ${date}
  `;
}

/**
 * Initializes the Leaflet map and adds all event markers
 */
async function initMap() {
  const events = await loadEvents();

  if (!events.length) {
    console.warn('No upcoming events with coordinates found');
    const mapEl = document.getElementById('map');
    if (mapEl) {
      mapEl.innerHTML = '<p style="padding: 2em; text-align: center;">No upcoming anomalies with coordinates available.</p>';
    }
    return;
  }

  // Build legend from loaded events
  buildLegend(events);

  // Center on first (soonest) event
  const { lat, lng } = events[0].location;

  // Create map with dark Ingress-like theme
  const map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true
  }).setView([lat, lng], CONFIG.MAP_ZOOM || 3);

  // Dark base layer
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: CONFIG.MAX_MAP_ZOOM || 6,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(map);

  // Add markers and recharge circles for all upcoming events
  events.forEach(evt => {
    const { lat, lng } = evt.location;
    const color = getSeriesColor(evt.series); // Use shared utility
    const popupHtml = createPopupHtml(evt);
    
    makeMarker(lat, lng, color, popupHtml).addTo(map);
    drawRechargeCircle(map, lat, lng, CONFIG.RECHARGE_RANGE_KM, color);
  });
  
  console.log(`Mapped ${events.length} upcoming anomalies`);
}

// Initialize map when DOM is ready
initMap();