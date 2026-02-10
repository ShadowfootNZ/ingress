/**
 * Geocoding Tool for Anomaly Events
 *
 * This script manages the top-level `locations` map in anomalies-historical.json for Ingress anomaly events.
 * It geocodes location keys using OpenStreetMap's Nominatim API and supports Ingress S2 cell names.
 *
 * USAGE:
 *   node geocode.js [arguments]
 *
 * MODES (mutually exclusive, runs first match):
 *   (default)  Add missing locations (adds entries to top-level locations)
 *   refresh    Re-validate all locations entries against Nominatim
 *
 * MODIFIERS:
 *   update               Enable file writes (default is DRY-RUN preview only)
 *
 * EXAMPLES:
 *   node geocode.js                 # Preview what would be geocoded (dry-run)
 *   node geocode.js update          # Geocode missing locations and save
 *   node geocode.js refresh         # Preview re-geocode of all locations
 *   node geocode.js refresh update  # Update locations with mismatches >150m
 *
 * NOTES:
 *   - Without 'update', runs in DRY-RUN mode (no files modified)
 *   - Respects Nominatim rate limit (1 request/second)
 *   - Updates and manages the top-level "locations" map in anomalies-historical.json
 *   - Supports Ingress S2 cell names (e.g., "AF01-ALPHA-00") via local calculation
 */

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Paths
const dataPath = path.resolve('./anomaly-map/data/anomalies-historical.json');

// Parse command-line arguments
const args = new Set(process.argv.slice(2).map(a => a.toLowerCase()));
const doUpdate = args.has('update');
const doRefreshLocations = args.has('refresh');

console.log(
  `Mode: ${doUpdate ? 'UPDATE' : 'DRY-RUN'}` +
    `${doRefreshLocations ? ' + REFRESH' : ''}`
);

// ============================================================================
// Utilities
// ============================================================================

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidCoord(coord) {
  return coord &&
         typeof coord.lat === 'number' &&
         typeof coord.lng === 'number' &&
         Number.isFinite(coord.lat) &&
         Number.isFinite(coord.lng);
}

function coordDiffMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ============================================================================
// Locations Key Management
// ============================================================================

// Keys match the existing locations layout: "Country, Region, City".
// Missing parts are represented as empty strings between commas.
function makeLocationKey(city, region, country) {
  const ctry = (country ?? '').toString().trim();
  const reg = (region ?? '').toString().trim();
  const cty = (city ?? '').toString().trim();
  return `${ctry}, ${reg}, ${cty}`;
}

function splitLocationKey(key) {
  const parts = key.split(',').map(s => s.trim());
  return {
    country: parts[0] ?? '',
    region: parts[1] ?? '',
    city: parts[2] ?? ''
  };
}

// ============================================================================
// Ingress Score-Region Cell Support
// ============================================================================

const FACE_NAMES = ['AF', 'AS', 'NR', 'PA', 'AM', 'ST'];
const CODE_WORDS = [
  'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA',
  'ECHO', 'FOXTROT', 'GOLF', 'HOTEL',
  'JULIET', 'KILO', 'LIMA', 'MIKE',
  'NOVEMBER', 'PAPA', 'ROMEO', 'SIERRA'
];

const CELL_RE = new RegExp(
  `^\\s*(${FACE_NAMES.join('|')})\\s*-?\\s*(\\d{1,2})\\s*-?\\s*(${CODE_WORDS.join('|')})\\s*(?:-?\\s*(\\d{1,2}))\\s*$`,
  'i'
);

function isIngressCellName(s) {
  return typeof s === 'string' && CELL_RE.test(s.replace(/\s+/g, ''));
}

function parseIngressCellName(s) {
  const m = s.replace(/\s+/g, '').match(CELL_RE);
  if (!m) return null;
  
  const face = m[1].toUpperCase();
  const id1 = parseInt(m[2], 10);
  const word = m[3].toUpperCase();
  const id2 = parseInt(m[4], 10);
  
  if (!Number.isFinite(id1) || !Number.isFinite(id2)) return null;
  return { face, id1, word, id2 };
}

function pointToHilbertQuadList(face, x, y, order) {
  const hilbertMap = {
    a: [[0, 'd'], [1, 'a'], [3, 'b'], [2, 'a']],
    b: [[2, 'b'], [1, 'b'], [3, 'a'], [0, 'c']],
    c: [[2, 'c'], [3, 'd'], [1, 'c'], [0, 'b']],
    d: [[0, 'a'], [3, 'c'], [1, 'd'], [2, 'd']]
  };

  let currentSquare = (face & 1) ? 'd' : 'a';
  const positions = [];

  for (let i = order - 1; i >= 0; i--) {
    const mask = 1 << i;
    const quad_x = (x & mask) ? 1 : 0;
    const quad_y = (y & mask) ? 1 : 0;
    const t = hilbertMap[currentSquare][quad_x * 2 + quad_y];
    positions.push(t[0]);
    currentSquare = t[1];
  }

  return positions;
}

function faceUVToXYZ(face, u, v) {
  switch (face) {
    case 0: return [ 1, u, v];
    case 1: return [-u, 1, v];
    case 2: return [-u,-v, 1];
    case 3: return [-1,-v,-u];
    case 4: return [ v,-1,-u];
    case 5: return [ v, u,-1];
    default: throw new Error('Invalid face');
  }
}

function xyzToLatLng(x, y, z) {
  const r2d = 180.0 / Math.PI;
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lng = Math.atan2(y, x);
  return { lat: lat * r2d, lng: lng * r2d };
}

function stToUVSingle(st) {
  if (st >= 0.5) {
    return (1 / 3.0) * (4 * st * st - 1);
  } else {
    return (1 / 3.0) * (1 - (4 * (1 - st) * (1 - st)));
  }
}

function stToUV(s, t) {
  return [stToUVSingle(s), stToUVSingle(t)];
}

function ijToST(i, j, level, offsets) {
  const maxSize = 1 << level;
  return [
    (i + offsets[0]) / maxSize,
    (j + offsets[1]) / maxSize
  ];
}

function s2CellCenterLatLng(face, i, j, level) {
  const [s, t] = ijToST(i, j, level, [0.5, 0.5]);
  const [u, v] = stToUV(s, t);
  const [x, y, z] = faceUVToXYZ(face, u, v);
  return xyzToLatLng(x, y, z);
}

function cellNameToLatLng(cellName) {
  const p = parseIngressCellName(cellName);
  if (!p) return null;

  const faceId = FACE_NAMES.indexOf(p.face);
  if (faceId < 0) return null;

  let regionI4 = p.id1 - 1;
  let regionJ4 = CODE_WORDS.indexOf(p.word);
  const subNum = p.id2;

  if (regionI4 < 0 || regionI4 > 15 || regionJ4 < 0 || regionJ4 > 15 || subNum < 0 || subNum > 15) {
    return null;
  }

  if (faceId & 1) {
    [regionI4, regionJ4] = [regionJ4, regionI4];
  }

  const iBase = regionI4 << 2;
  const jBase = regionJ4 << 2;

  let targetI = null;
  let targetJ = null;

  for (let di = 0; di < 4; di++) {
    for (let dj = 0; dj < 4; dj++) {
      const ti = iBase + di;
      const tj = jBase + dj;
      const quads = pointToHilbertQuadList(faceId, ti, tj, 6);
      const n = quads[4] * 4 + quads[5];
      if (n === subNum) {
        targetI = ti;
        targetJ = tj;
        break;
      }
    }
    if (targetI !== null) break;
  }

  if (targetI === null) return null;

  const ll = s2CellCenterLatLng(faceId, targetI, targetJ, 6);
  return ll;
}
function sortedLocations(locationsObj) {
  const sorted = {};
  const keys = Object.keys(locationsObj).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    sorted[key] = locationsObj[key];
  }
  return sorted;
}
// ============================================================================
// Geocoding
// ============================================================================

async function geocode(city, region, country, verbose = false) {
  // Fast-path for Ingress cells (city field)
  if (city && isIngressCellName(city)) {
    const ll = cellNameToLatLng(city);
    if (ll) return { lat: ll.lat, lng: ll.lng };
  }

  // Build query string in natural order: City, Region, Country
  // Filter out empty/null/undefined values
  const queryParts = [city, region, country]
    .map(s => s ? s.toString().trim() : '')
    .filter(s => s.length > 0);
  
  if (queryParts.length === 0) return null;
  
  const query = queryParts.join(', ');

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    
    if (verbose) {
      console.log(`\n  → Query: "${query}"`);
      console.log(`  → URL: ${url}`);
    }
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Ingress-Anomaly-Geocoder/1.0', // Nominatim requires User-Agent
        //'Accept-Language': 'en' // Prefer English results
      }
    });

    if (!res.ok) {
      console.warn(`  → HTTP ${res.status} ${res.statusText}`);
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (verbose) {
      console.log(`  → Results: ${data.length} found`);
      if (data.length > 0) {
        console.log(`  → Top result: ${data[0].display_name}`);
        console.log(`  → Coordinates: lat=${data[0].lat}, lng=${data[0].lon}`);
      }
    }

    if (data.length) {
      const coords = { 
        lat: parseFloat(data[0].lat), 
        lng: parseFloat(data[0].lon),  // Changed from lng to lon!
        display_name: data[0].display_name
      };
      
      if (verbose) {
        console.log(`  → Parsed coords: lat=${coords.lat}, lng=${coords.lng}`);
        console.log(`  → Valid: ${isValidCoord(coords)}`);
      }
      
      await sleep(1000); // Nominatim rate limit: 1 req/sec
      return coords;
    }

    //console.warn(`  → No results for "${query}"`);
    return null;
  } catch (err) {
    console.warn(`  → Geocoding failed for "${query}": ${err.message}`);
    return null;
  }
}

// ============================================================================
// Data Iteration
// ============================================================================

function* iterateEvents(grouped) {
  const seriesObj = grouped?.series;
  if (!seriesObj || typeof seriesObj !== 'object') return;

  for (const [seriesName, typesObj] of Object.entries(seriesObj)) {
    if (!typesObj || typeof typesObj !== 'object') continue;

    for (const [typeName, datesObj] of Object.entries(typesObj)) {
      if (!datesObj || typeof datesObj !== 'object') continue;

      for (const [dateStr, events] of Object.entries(datesObj)) {
        if (!Array.isArray(events)) continue;

        for (const evt of events) {
          yield { evt, seriesName, typeName, dateStr };
        }
      }
    }
  }
}

// ============================================================================
// Locations Management
// ============================================================================

async function addMissingLocations() {
  const anomalies = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  if (!anomalies || typeof anomalies !== 'object' || typeof anomalies.series !== 'object') {
    throw new Error('Unexpected anomalies-historical.json format: missing top-level "series"');
  }
  if (!anomalies.locations || typeof anomalies.locations !== 'object') {
    anomalies.locations = {};
  }

  const locations = anomalies.locations;
  const needed = new Map(); // key -> { city, region, country, count }

  for (const { evt } of iterateEvents(anomalies)) {
    const { city, region, country } = evt;
    if (!country || (!city && !region)) continue;

    const key = makeLocationKey(city, region, country);
    if (!key || key === ', , ') continue;

    if (!locations[key]) {
      const cur = needed.get(key);
      if (cur) cur.count++;
      else needed.set(key, { city: city ?? '', region: region ?? '', country: country ?? '', count: 1 });
    }
  }

  const keys = [...needed.keys()].sort((a, b) => a.localeCompare(b));

  console.log(`Missing location keys: ${keys.length}`);
  if (!keys.length) {
    console.log('Nothing to do.');
    return;
  }

  let added = 0;
  let noResult = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const rowNum = `[${i + 1}/${keys.length}]`;
    const info = needed.get(key);

    console.log(`${rowNum} Geocoding: ${key} (seen ${info.count}x)`);

    const coords = await geocode(info.city, info.region, info.country, true);
    if (coords && isValidCoord(coords)) {
      if (doUpdate) {
        locations[key] = { lat: coords.lat, lng: coords.lng };
      }
      added++;
      if (coords.display_name) {
        console.log(`${rowNum} ✅ ${key} ⬅️  ${coords.display_name}`);
      } else {
        console.log(`${rowNum} ✅ ${key}`);
      }
    } else {
      noResult++;
      console.warn(`${rowNum} ❌ ${key}`);
    }
  }

  if (doUpdate) {
    anomalies.locations = sortedLocations(anomalies.locations);
    fs.writeFileSync(dataPath, JSON.stringify(anomalies, null, 2));
    console.log(`Wrote: ${dataPath}`);
  } else {
    console.log('Dry-run: no files were written. Add `update` to persist changes.');
  }

  console.log('\n' + '='.repeat(70));
  console.log('Add-missing-locations complete.');
  console.log(`Mode:                 ${doUpdate ? 'UPDATE' : 'DRY-RUN'}`);
  console.log(`Missing keys found:   ${keys.length}`);
  console.log(`Geocode succeeded:    ${added}`);
  console.log(`No geocode result:    ${noResult}`);
}

async function refreshLocations() {
  const anomalies = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  if (!anomalies || typeof anomalies !== 'object' || typeof anomalies.locations !== 'object') {
    throw new Error('Unexpected anomalies-historical.json format: missing top-level "locations"');
  }

  const locations = anomalies.locations;
  const keys = Object.keys(locations).sort((a, b) => a.localeCompare(b));

  console.log(`Refreshing location entries: ${keys.length}`);

  let total = 0;
  let refreshed = 0;
  let noResult = 0;
  let mismatches = 0;
  let updated = 0;

  for (const key of keys) {
    total++;
    const rowNum = `[${total}/${keys.length}]`;

    const existing = locations[key];
    if (!isValidCoord(existing)) {
      console.warn(`${rowNum} ⚠️ Skipping invalid location entry: ${key}`);
      continue;
    }

    const { city, region, country } = splitLocationKey(key);

    // Compute/fetch a fresh value
    const fresh = await geocode(city, region, country, total <= 2); // Verbose for first 2 only

    if (!fresh || !isValidCoord(fresh)) {
      noResult++;
      console.warn(`${rowNum} ❌ ${key}`);
      continue;
    }

    refreshed++;
    const a = { lat: existing.lat, lng: existing.lng };
    const b = { lat: fresh.lat, lng: fresh.lng };
    const d = coordDiffMeters(a, b);

    if (d > 1) {
      if (d > 150) {
        mismatches++;
        console.warn(`${rowNum} ⚠️ mismatch: ${key} (${Math.round(d)}m) ⬅️  ${fresh.display_name} https://www.google.com/maps/dir/${existing.lat},${existing.lng}/${fresh.lat},${fresh.lng} { "lat": ${fresh.lat}, "lng": ${fresh.lng} },`);

        if (doUpdate) {
          locations[key] = { lat: fresh.lat, lng: fresh.lng };
          updated++;
        }
      } else {
        console.log(`${rowNum} 🟡 ${key} → ${Math.round(d)}m ⬅️  ${fresh.display_name} https://www.google.com/maps/dir/${existing.lat},${existing.lng}/${fresh.lat},${fresh.lng} { "lat": ${fresh.lat}, "lng": ${fresh.lng} },`);
      }
    } else {
      if (fresh.display_name) {
        console.log(`${rowNum} ✅ ${key} ⬅️  ${fresh.display_name}`);
      } else {
        console.log(`${rowNum} ✅ ${key}`);
      }
    }
  }

  if (doUpdate) {
    anomalies.locations = sortedLocations(anomalies.locations);
    fs.writeFileSync(dataPath, JSON.stringify(anomalies, null, 2));
    console.log(`\nWrote: ${dataPath}`);
  } else {
    console.log('\nDry-run: no files were written. Add `update` to persist changes.');
  }

  console.log('\n' + '='.repeat(70));
  console.log('Refresh complete.');
  console.log(`Mode:                  ${doUpdate ? 'UPDATE' : 'DRY-RUN'} + REFRESH`);
  console.log(`Total location entries:${total}`);
  console.log(`Geocode succeeded:     ${refreshed}`);
  console.log(`No geocode result:     ${noResult}`);
  console.log(`Discrepancies (>150m): ${mismatches}`);
  console.log(`Location entries updated: ${updated}`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

if (doRefreshLocations) {
  refreshLocations();
} else {
  addMissingLocations();
}