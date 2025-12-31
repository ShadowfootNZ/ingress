/**
 * map.js - Interactive map of upcoming Ingress anomalies
 * Shows L16 recharge range (4000km) for each event location
 */

import { DateTime } from "https://cdn.jsdelivr.net/npm/luxon@3.4.4/build/es6/luxon.min.js";

// Configuration
const CONFIG = {
  RECHARGE_RANGE_KM: 4000, // L16 portal recharge range
  MAP_ZOOM: 3,
  MAX_MAP_ZOOM: 6,
  CACHE_VERSION: '1.0.0'
};

// Cache for series colors
const seriesColours = {};

/**
 * Generates a stable color for a given series name
 * Uses string hashing to ensure same series always gets same color
 * Avoids blue (190-230°) and green (110-170°) to prevent confusion with factions
 */
function colourForSeries(series) {
  if (!seriesColours[series]) {
    // Generate stable hash from series string
    let hash = 0;
    for (let i = 0; i < series.length; i++) {
      hash = series.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Map to hue ranges that exclude blue and green
    // Available ranges: Red/Orange/Yellow (0-110°), Cyan/Teal (170-190°), Purple/Magenta (230-360°)
    // Total available: 110° + 20° + 130° = 260°
    const availableRange = 260;
    const hueOffset = Math.abs(hash) % availableRange;
    
    let hue;
    if (hueOffset < 110) {
      // Red to yellow range (0-110°) - warm colors
      hue = hueOffset;
    } else if (hueOffset < 130) {
      // Cyan/teal range (170-190°) - between green and blue
      hue = 170 + (hueOffset - 110);
    } else {
      // Purple to magenta range (230-360°) - cool colors
      hue = 230 + (hueOffset - 130);
    }
    
    seriesColours[series] = `hsl(${hue}, 80%, 55%)`;
  }
  return seriesColours[series];
}

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
 * Escapes HTML to prevent XSS in popup content
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Normalizes date string to include time component
 */
function normalizeDateString(dateStr) {
  const trimmed = dateStr.trim();
  return trimmed.includes("T") ? trimmed : `${trimmed}T00:00:00`;
}

/**
 * Loads and filters upcoming anomaly events
 * Returns only events with valid coordinates that are in the future
 */
async function loadEvents() {
  try {
    const res = await fetch(`./anomaly-countdown.json?v=${CONFIG.CACHE_VERSION}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();

    if (!Array.isArray(data)) {
      console.error('Invalid data format');
      return [];
    }

    // Flatten series structure
    const events = data.flatMap(seriesObj => {
      if (!Array.isArray(seriesObj.sites)) {
        console.warn(`Invalid sites for series ${seriesObj.series}`);
        return [];
      }
      return seriesObj.sites.map(site => ({
        series: seriesObj.series,
        ...site
      }));
    });

    // Filter to upcoming events with coordinates
    const now = DateTime.utc();
    const upcomingWithCoords = events
      .map(evt => {
        const dateStr = normalizeDateString(evt.date);
        const local = DateTime.fromISO(dateStr, { zone: evt.timezone || "UTC" });
        
        if (!local.isValid) {
          console.warn(`Invalid date for ${evt.city}:`, evt.date);
          return null;
        }
        
        return { ...evt, utcDate: local.toUTC() };
      })
      .filter(evt => 
        evt !== null &&
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
      const color = colourForSeries(series);
      const escapedSeries = escapeHtml(series);
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
  }).setView([lat, lng], CONFIG.MAP_ZOOM);

  // Dark base layer
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: CONFIG.MAX_MAP_ZOOM,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(map);

  // Add markers and recharge circles for all upcoming events
  events.forEach(evt => {
    const { lat, lng } = evt.location;
    const color = colourForSeries(evt.series);
    const popupHtml = createPopupHtml(evt);
    
    makeMarker(lat, lng, color, popupHtml).addTo(map);
    drawRechargeCircle(map, lat, lng, CONFIG.RECHARGE_RANGE_KM, color);
  });
  
  console.log(`Mapped ${events.length} upcoming anomalies`);
}

// Initialize map when DOM is ready
initMap();