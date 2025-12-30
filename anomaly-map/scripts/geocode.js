/**
 * Geocoding Tool for Anomaly Events
 * 
 * This script manages geographic coordinates for Ingress anomaly events. It geocodes
 * location data using OpenStreetMap's Nominatim API and maintains a persistent cache
 * to minimize API calls. Supports special handling for Ingress score-region S2 cells.
 * 
 * USAGE:
 *   node geocode.js [arguments]
 * 
 * MODES (mutually exclusive, runs first match):
 *   (default)        Main geocoding - adds coordinates to events missing them
 *   refresh-cache      Re-validate all cache entries against Nominatim
 *   audit-cache      Report unused cache entries (read-only)
 *   missing-cache    Report events with coordinates not in cache
 * 
 * MODIFIERS (combine with any mode):
 *   update           Enable file writes (default is DRY-RUN preview only)
 *   verify           Compare existing coordinates against cache/Nominatim
 *   override         Force re-geocode ALL events (even those with coordinates)
 * 
 * EXAMPLES:
 *   node geocode.js                      # Preview what would be geocoded
 *   node geocode.js update               # Geocode missing coordinates and save
 *   node geocode.js verify               # Check existing coordinates for problems
 *   node geocode.js verify update        # Fix coordinate mismatches
 *   node geocode.js refresh-cache update # Re-validate entire cache
 *   node geocode.js audit-cache          # Find unused cache entries
 *   node geocode.js missing-cache        # Find events missing from cache
 *   node geocode.js update override      # Force re-geocode everything (slow!)
 * 
 * NOTES:
 *   - Without 'update', runs in DRY-RUN mode (no files modified)
 *   - Respects Nominatim rate limit (1 request/second)
 *   - Cache keys format: "Country, Region, City"
 *   - Supports Ingress S2 cell names (e.g., "AF01-ALPHA-00") via local calculation
 *   - Reports coordinate mismatches >150m during verification
 */

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Paths
const dataPath = path.resolve('./anomaly-map/data/anomalies-historical.json');
const cachePath = path.resolve('./anomaly-map/data/cities-cache.json');

// Parse command-line arguments
const args = new Set(process.argv.slice(2).map(a => a.toLowerCase()));
const doUpdate = args.has('update');
const doOverride = args.has('override');
const doVerify = args.has('verify') || doOverride;
const doRefreshCache = args.has('refresh-cache') 
const doUnusedCache = args.has('audit-cache');
const doMissingCache = args.has('missing-cache');

console.log(
  `Mode: ${doUpdate ? 'UPDATE' : 'DRY-RUN'}` +
    `${doRefreshCache ? ' + REFRESH-CACHE' : ''}` +
    `${doUnusedCache ? ' + UNUSED-CACHE' : ''}` +
    `${doMissingCache ? ' + MISSING-CACHE' : ''}` +
    `${doVerify ? ' + VERIFY' : ''}` +
    `${doOverride ? ' + OVERRIDE' : ''}`
);

if (doRefreshCache && (doVerify || doOverride)) {
  console.warn('Note: refreshCache mode ignores verify/override flags and only validates the cache.');
}

// Load cache
let cache = {};
if (fs.existsSync(cachePath)) {
  cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
}

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
// Cache Key Management
// ============================================================================

function makeEventCacheKey(city, region, country) {
  const ctry = (country ?? '').toString().trim();
  const reg = (region ?? '').toString().trim();
  const cty = (city ?? '').toString().trim();
  return `${ctry}, ${reg}, ${cty}`;
}

function splitCacheKey(key) {
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

// ============================================================================
// Geocoding
// ============================================================================

async function geocode(city, region, country) {
  const key = makeEventCacheKey(city, region, country);
  if (!key || key === ', , ') return null;

  if (cache[key]) return cache[key];

  // Fast-path for Ingress cells
  if (city && isIngressCellName(city)) {
    const ll = cellNameToLatLng(city);
    if (ll) {
      const coords = { lat: ll.lat, lng: ll.lng };
      cache[key] = coords;
      return coords;
    }
  }

  // Geocode via Nominatim
  const pretty = [city, region, country].filter(Boolean).join(', ');
  
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();

    if (data.length) {
      const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lng) };
      cache[key] = coords;
      await sleep(1000); // Nominatim rate limit: 1 req/sec
      return coords;
    }
    
    console.warn(`No results for ${pretty}`);
    return null;
  } catch (err) {
    console.warn(`Geocoding failed for ${pretty}: ${err.message}`);
    return null;
  }
}

// ============================================================================
// Data Iteration
// ============================================================================

function* iterateEvents(anomalies) {
  for (const series of anomalies) {
    if (!series?.types) continue;
    for (const typeEntry of series.types) {
      if (!typeEntry?.dates) continue;
      for (const dateEntry of typeEntry.dates) {
        if (!dateEntry?.events) continue;
        for (const evt of dateEntry.events) {
          yield { evt, series, typeEntry, dateEntry };
        }
      }
    }
  }
}

// ============================================================================
// Formatting
// ============================================================================

function compactLocationAndScore(jsonText) {
  // location: { lat, lng }
  jsonText = jsonText.replace(
    /"location"\s*:\s*\{\s*\n\s*"lat"\s*:\s*([^,\n]+)\s*,\s*\n\s*"lng"\s*:\s*([^\n]+)\s*\n\s*\}(\s*,?)/g,
    '"location": { "lat": $1, "lng": $2 }$3'
  );

  // score: { enl, res }
  jsonText = jsonText.replace(
    /"score"\s*:\s*\{\s*\n\s*"enl"\s*:\s*([^,\n]+)\s*,\s*\n\s*"res"\s*:\s*([^\n]+)\s*\n\s*\}(\s*,?)/g,
    '"score": { "enl": $1, "res": $2 }$3'
  );

  return jsonText;
}

function formatCitiesCache(cacheObj) {
  const sorted = Object.fromEntries(
    Object.entries(cacheObj).sort(([a], [b]) => a.localeCompare(b))
  );

  let txt = JSON.stringify(sorted, null, 2);

  txt = txt.replace(
    /(:\s*)\{\s*\n\s*"lat"\s*:\s*([^,\n]+)\s*,\s*\n\s*"lng"\s*:\s*([^\n]+)\s*\n\s*\}/g,
    '$1{ "lat": $2, "lng": $3 }'
  );

  return txt;
}

// ============================================================================
// Report Functions
// ============================================================================

async function reportUnusedCacheEntries() {
  const anomalies = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const used = new Set();

  for (const { evt } of iterateEvents(anomalies)) {
    const { city, region, country } = evt;
    if (!country || (!city && !region)) continue;
    used.add(makeEventCacheKey(city, region, country));
  }

  const cacheKeys = Object.keys(cache);
  const unused = cacheKeys
    .filter(key => !used.has(key))
    .sort();

  console.log('Cache audit complete.');
  console.log(`Cache entries total:  ${cacheKeys.length}`);
  console.log(`Cache entries used:   ${used.size}`);
  console.log(`Cache entries unused: ${unused.length}`);

  const cap = 500;
  unused.slice(0, cap).forEach(key => console.log(`UNUSED: ${key}`));
  
  if (unused.length > cap) {
    console.log(`... plus ${unused.length - cap} more`);
  }
}

async function reportMissingCacheEntries() {
  const anomalies = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const cacheKeySet = new Set(Object.keys(cache));
  const missing = new Map();

  for (const { evt } of iterateEvents(anomalies)) {
    const { city, region, country, location } = evt;
    
    if (!country || (!city && !region)) continue;

    const key = makeEventCacheKey(city, region, country);
    
    if (!cacheKeySet.has(key) && location?.lat && location?.lng) {
      if (!missing.has(key)) {
        missing.set(key, { lat: location.lat, lng: location.lng, count: 1 });
      } else {
        missing.get(key).count++;
      }
    }
  }

  const entries = [...missing.entries()]
    .map(([key, v]) => ({ key, lat: v.lat, lng: v.lng, count: v.count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  console.log('Missing-cache audit complete.');
  console.log(`Cache entries total:   ${Object.keys(cache).length}`);
  console.log(`Missing location keys: ${entries.length}`);

  const cap = 200;
  entries.slice(0, cap).forEach(e => {
    console.log(`"${e.key}": { "lat": ${e.lat}, "lng": ${e.lng} }`);
  });
  
  if (entries.length > cap) {
    console.log(`... plus ${entries.length - cap} more`);
  }

  if (doUpdate) {
    const reportPath = path.resolve('./anomaly-map/data/missing-cache-report.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), locations: entries },
        null,
        2
      )
    );
    console.log(`Wrote: ${reportPath}`);
  } else {
    console.log('Dry-run: no files were written. Add `update` to write missing-cache-report.json');
  }
}

async function refreshCache() {
  let total = 0;
  let refreshed = 0;
  let noResult = 0;
  let mismatches = 0;
  let updated = 0;

  const keys = Object.keys(cache).sort();
  console.log(`Refreshing cache entries: ${keys.length}\n`);

  for (const key of keys) {
    total++;
    const rowNum = `[${total}/${keys.length}]`;
    
    const existing = cache[key];
    
    if (!isValidCoord(existing)) {
      console.warn(`${rowNum} ⚠️  Skipping invalid cache entry: ${key}`);
      continue;
    }

    // Check if this is an Ingress cell
    const { city } = splitCacheKey(key);
    let fresh = null;
    
    if (city && isIngressCellName(city)) {
      const ll = cellNameToLatLng(city);
      if (ll) {
        fresh = { lat: ll.lat, lng: ll.lng };
      }
    } else {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(key)}`;
        const res = await fetch(url);
        
        if (res.ok) {
          const data = await res.json();
          if (data.length) {
            fresh = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lng) };
          }
        }
        
        await sleep(1000); // Nominatim rate limit: 1 req/sec
      } catch (err) {
        console.warn(`${rowNum} ❌ Refresh failed for ${key}: ${err.message}`);
      }
    }

    if (!fresh) {
      noResult++;
      console.warn(`${rowNum} ❌ No results for ${key}`);
      continue;
    }

    refreshed++;
    const a = { lat: existing.lat, lng: existing.lng };
    const b = { lat: fresh.lat, lng: fresh.lng };
    const d = coordDiffMeters(a, b);

    if (d > 1) {
      if (d > 150) {
        mismatches++;
        console.warn(`${rowNum} ⚠️  CACHE mismatch: ${key} (${Math.round(d)}m)`);
        
        if (doUpdate) {
          cache[key] = { lat: fresh.lat, lng: fresh.lng };
          updated++;
        }
      } else {
        console.log(`${rowNum} 🟡 ${key} → ${Math.round(d)}m difference`);
      }
    } else {
      console.log(`${rowNum} ✅ ${key}`);
    }
  }

  if (doUpdate) {
    const cacheOut = formatCitiesCache(cache);
    fs.writeFileSync(cachePath, cacheOut);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Cache refresh complete.');
  console.log(`Mode:                  ${doUpdate ? 'UPDATE' : 'DRY-RUN'} + REFRESH-CACHE`);
  console.log(`Total cache entries:   ${total}`);
  console.log(`Geocode succeeded:     ${refreshed}`);
  console.log(`No geocode result:     ${noResult}`);
  console.log(`Discrepancies (>150m): ${mismatches}`);
  console.log(`Cache entries updated: ${updated}`);
  
  if (!doUpdate) {
    console.log('\nDry-run: no files were written. Add the `update` argument to persist cache changes.');
  }
}

async function updateLocations() {
  const anomalies = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  let totalEvents = 0;
  let alreadyHadCoords = 0;
  let missingCityCountry = 0;
  let geocoded = 0;
  let noResult = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let verified = 0;
  let verifyMismatches = 0;

  for (const { evt, series, typeEntry, dateEntry } of iterateEvents(anomalies)) {
    totalEvents++;

    const hasCoords = isValidCoord(evt.location);
    if (hasCoords) alreadyHadCoords++;

    const { city, region, country } = evt;

    if (!country || (!city && !region)) {
      missingCityCountry++;
      console.warn(
        `Missing details: ${typeEntry.type} ${dateEntry.date}: '${city}', '${region}', '${country}'`
      );
      continue;
    }

    const shouldReGeocode = !hasCoords || doOverride;

    if (!shouldReGeocode) {
      if (doVerify) {
        const expected = await geocode(city, region, country);
        if (expected) {
          verified++;
          const existing = { lat: evt.location.lat, lng: evt.location.lng };
          const exp = { lat: expected.lat, lng: expected.lng };
          const d = coordDiffMeters(existing, exp);
          
          if (d > 150) {
            verifyMismatches++;
            console.warn(
              `VERIFY mismatch (${Math.round(d)}m): ${series.series} / ${typeEntry.type} / ${dateEntry.date} — ${city || region}, ${country} ` +
              `(have ${existing.lat},${existing.lng} expected ${exp.lat},${exp.lng})`
            );
          }
        }
      }
      continue;
    }

    const coords = await geocode(city, region, country);
    
    if (coords) {
      const newLoc = { lat: coords.lat, lng: coords.lng };

      if (hasCoords) {
        const existing = { lat: evt.location.lat, lng: evt.location.lng };
        const d = coordDiffMeters(existing, newLoc);
        
        if (d > 1) {
          wouldUpdate++;
          console.log(
            `${doUpdate ? 'Updating' : 'Would update'} (${Math.round(d)}m): ${series.series} / ${typeEntry.type} / ${dateEntry.date} — ${city || region}, ${country}`
          );
        }
      } else {
        wouldUpdate++;
        console.log(
          `${doUpdate ? 'Setting' : 'Would set'}: ${series.series} / ${typeEntry.type} / ${dateEntry.date} — ${city || region}, ${country}`
        );
      }

      if (doUpdate) {
        evt.location = newLoc;
        updated++;
      }

      geocoded++;
    } else {
      noResult++;
    }
  }

  if (doUpdate) {
    let out = JSON.stringify(anomalies, null, 2);
    out = compactLocationAndScore(out);
    fs.writeFileSync(dataPath, out);

    const cacheOut = formatCitiesCache(cache);
    fs.writeFileSync(cachePath, cacheOut);
  }

  console.log('Geocoding complete.');
  console.log(`Mode:                    ${doUpdate ? 'UPDATE' : 'DRY-RUN'}${doVerify ? ' + VERIFY' : ''}${doOverride ? ' + OVERRIDE' : ''}`);
  console.log(`Total events seen:       ${totalEvents}`);
  console.log(`Already had coordinates: ${alreadyHadCoords}`);
  console.log(`Missing details:         ${missingCityCountry}`);
  console.log(`Geocode calls succeeded: ${geocoded}`);
  console.log(`No geocode result:       ${noResult}`);
  console.log(`Would update/set:        ${wouldUpdate}`);
  console.log(`Actually updated:        ${updated}`);
  console.log(`Verified existing:       ${verified}`);
  console.log(`Verify mismatches:       ${verifyMismatches}`);
  
  if (!doUpdate) {
    console.log('Dry-run: no files were written. Add the `update` argument to persist changes.');
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

if (doRefreshCache) {
  refreshCache();
} else if (doUnusedCache) {
  reportUnusedCacheEntries();
} else if (doMissingCache) {
  reportMissingCacheEntries();
} else {
  updateLocations();
}