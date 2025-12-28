import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Path to the GROUPED historical data
// (series → types → dates → events)
const dataPath = path.resolve('./anomaly-map/data/anomalies-historical.json');
const cachePath = path.resolve('./anomaly-map/data/cities-cache.json');

const args = new Set(process.argv.slice(2).map(a => String(a).toLowerCase()));
const doUpdate = args.has('update'); // Apply changes
const doOverride = args.has('override'); // force update events
const doVerify = args.has('verify') || doOverride; // compare anomalies-historical coords vs cities-cache
const doRefresh = args.has('refresh'); // Refresh existing cities-cache entries
const doUnusedCache = args.has('audit-cache'); // Report unused cities-cache entries
const doMissingCache = args.has('missing-cache'); // Report missing cities-cache entries

console.log(
  `Mode: ${doUpdate ? 'UPDATE' : 'DRY-RUN'}` +
    `${doRefresh ? ' + REFRESH' : ''}` +
    `${doUnusedCache ? ' + UNUSED-CACHE' : ''}` +
    `${doMissingCache ? ' + MISSING-CACHE' : ''}` +
    `${doVerify ? ' + VERIFY' : ''}` +
    `${doOverride ? ' + OVERRIDE' : ''}`
);
if (doRefresh && (doVerify || doOverride)) {
  console.warn('Note: refresh mode ignores verify/override flags and only validates the cache.');
}

// Load or initialize cache
let cache = {};
if (fs.existsSync(cachePath)) {
  cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
}

async function geocodeRaw(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data && data.length) {
    const { lat, lon } = data[0];
    return { lat: parseFloat(lat), lon: parseFloat(lon) };
  }
  return null;
}

// --- Ingress score-region (S2 level 6) cell support -------------------------
// Cell codes look like: AF01-ALPHA-00, NR02-JULIET-12, etc.
// These correspond to S2 cells used for regional scoreboards.

const FACE_NAMES = ['AF', 'AS', 'NR', 'PA', 'AM', 'ST'];
const CODE_WORDS = [
  'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA',
  'ECHO', 'FOXTROT', 'GOLF', 'HOTEL',
  'JULIET', 'KILO', 'LIMA', 'MIKE',
  'NOVEMBER', 'PAPA', 'ROMEO', 'SIERRA'
];

// Accept common formatting variations: optional dashes, leading zeros optional
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

// Face-aware Hilbert mapping (ported from the reference implementation).
// We need this because Hilbert orientation differs by face parity.
function pointToHilbertQuadList(face, x, y, order) {
  const hilbertMap = {
    a: [[0, 'd'], [1, 'a'], [3, 'b'], [2, 'a']],
    b: [[2, 'b'], [1, 'b'], [3, 'a'], [0, 'c']],
    c: [[2, 'c'], [3, 'd'], [1, 'c'], [0, 'b']],
    d: [[0, 'a'], [3, 'c'], [1, 'd'], [2, 'd']]
  };

  // IMPORTANT: initial square depends on face parity.
  // This is the piece that makes some codes (e.g. ...-06 vs ...-12) swap if ignored.
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
// Hilbert d2xy + rot (from the plugin; n=4 for the last component 00..15)
function rot(n, x, y, rx, ry) {
  if (ry === 0) {
    if (rx === 1) {
      x = n - 1 - x;
      y = n - 1 - y;
    }
    return [y, x];
  }
  return [x, y];
}

function d2xy(n, d) {
  let rx, ry;
  let t = d;
  let x = 0;
  let y = 0;
  for (let s = 1; s < n; s *= 2) {
    rx = 1 & (t / 2);
    ry = 1 & (t ^ rx);
    [x, y] = rot(s, x, y, rx, ry);
    x += s * rx;
    y += s * ry;
    t /= 4;
  }
  return [x, y];
}

// Minimal S2 conversions (ported from IITC plugin)
const d2r = Math.PI / 180.0;
const r2d = 180.0 / Math.PI;

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
  // center uses offsets [0.5, 0.5]
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

  let regionI4 = p.id1 - 1; // 1..16 -> 0..15
  let regionJ4 = CODE_WORDS.indexOf(p.word); // 0..15
  const subNum = p.id2; // 0..15

  if (regionI4 < 0 || regionI4 > 15 || regionJ4 < 0 || regionJ4 > 15 || subNum < 0 || subNum > 15) {
    return null;
  }

  // Naming has an I/J swap on odd faces
  if (faceId & 1) {
    [regionI4, regionJ4] = [regionJ4, regionI4];
  }

  const iBase = regionI4 << 2;
  const jBase = regionJ4 << 2;

  // Find the specific (i,j) within the 4x4 group whose Hilbert-derived number matches subNum.
  // This avoids relying on a simplified d2xy mapping which can be face-orientation sensitive.
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
  return ll; // {lat,lng}
}
// ---------------------------------------------------------------------------

function prettyFromCacheKey(key) {
  // Key is stored as: country, region, city (with possible empty slot)
  const parts = String(key)
    .split(',')
    .map(s => s.trim());
  const country = parts[0] || '';
  const region = parts[1] || '';
  const city = parts[2] || '';
  return [country, region, city].filter(v => v).join(', ');
}

function normalizeCacheKey(key) {
  // Normalise any key shape to a 3-part canonical form: "country, region, city"
  // This allows comparing legacy 2-part keys like "Uruguay, Montevideo".
  const parts = String(key)
    .split(',')
    .map(s => s.trim());

  const country = parts[0] || '';
  const region = parts.length >= 2 ? (parts[1] || '') : '';
  const city = parts.length >= 3 ? parts.slice(2).join(', ').trim() : '';

  return `${country}, ${region}, ${city}`;
}

function splitCacheKey(key) {
  const parts = String(key)
    .split(',')
    .map(s => s.trim());

  const country = parts[0] || '';
  const region = parts.length >= 2 ? (parts[1] || '') : '';
  const city = parts.length >= 3 ? parts.slice(2).join(', ').trim() : '';

  return { country, region, city };
}

function makeEventCacheKey(city, region, country) {
  const ctry = country ? String(country).trim() : '';
  const reg = region ? String(region).trim() : '';
  const cty = city ? String(city).trim() : '';
  return `${ctry}, ${reg}, ${cty}`;
}
async function reportUnusedCacheEntries() {
  // Read-only audit: no geocoding and no writes.
  const anomalies = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const used = new Set();

  for (const series of anomalies) {
    if (!series || !Array.isArray(series.types)) continue;
    for (const typeEntry of series.types) {
      if (!typeEntry || !Array.isArray(typeEntry.dates)) continue;
      for (const dateEntry of typeEntry.dates) {
        if (!dateEntry || !Array.isArray(dateEntry.events)) continue;
        for (const evt of dateEntry.events) {
          const city = evt.city;
          const region = evt.region;
          const country = evt.country;

          // Require country, and at least one of city or region
          if (!country || (!city && !region)) continue;

          used.add(makeEventCacheKey(city, region, country));
        }
      }
    }
  }

  const unused = [];
  const cacheKeys = Object.keys(cache);

  for (const rawKey of cacheKeys) {
    const norm = normalizeCacheKey(rawKey);
    if (!used.has(norm)) {
      unused.push({ rawKey, pretty: prettyFromCacheKey(rawKey) });
    }
  }

  unused.sort((a, b) => a.pretty.localeCompare(b.pretty));

  console.log('Cache audit complete.');
  console.log(`Cache entries total: ${cacheKeys.length}`);
  console.log(`Cache entries used:  ${used.size}`);
  console.log(`Cache entries unused:${unused.length}`);

  const cap = 500;
  const show = unused.slice(0, cap);
  for (const u of show) {
    console.log(`UNUSED: ${u.pretty}`);
  }
  if (unused.length > cap) {
    console.log(`... plus ${unused.length - cap} more`);
  }
}

async function reportMissingCacheEntries() {
  // Read-only audit: no geocoding and no writes unless `update` is provided.
  const anomalies = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Normalise existing cache keys for membership testing
  const cacheKeys = Object.keys(cache);
  const cacheNorm = new Set(cacheKeys.map(k => normalizeCacheKey(k)));

  // Map prettyLocation -> { lat, lon, count }
  const missing = new Map();

  const add = (pretty, lat, lon) => {
    if (!missing.has(pretty)) {
      missing.set(pretty, { lat, lon, count: 1 });
    } else {
      missing.get(pretty).count++;
    }
  };

  for (const series of anomalies) {
    if (!series || !Array.isArray(series.types)) continue;
    for (const typeEntry of series.types) {
      if (!typeEntry || !Array.isArray(typeEntry.dates)) continue;
      for (const dateEntry of typeEntry.dates) {
        if (!dateEntry || !Array.isArray(dateEntry.events)) continue;
        for (const evt of dateEntry.events) {
          const city = evt.city;
          const region = evt.region;
          const country = evt.country;

          // Same eligibility rule as geocoding: require country, and at least one of city/region
          if (!country || (!city && !region)) continue;

          const normKey = makeEventCacheKey(city, region, country);

          if (!cacheNorm.has(normKey)) {
            if (evt.location &&
                typeof evt.location.lat === 'number' &&
                typeof evt.location.lng === 'number') {
              const pretty = prettyFromCacheKey(normKey);
              add(pretty, evt.location.lat, evt.location.lng);
            }
          }
        }
      }
    }
  }

  const entries = [...missing.entries()]
    .map(([pretty, v]) => ({ pretty, lat: v.lat, lon: v.lon, count: v.count }))
    .sort((a, b) => b.count - a.count || a.pretty.localeCompare(b.pretty));

  console.log('Missing-cache audit complete.');
  console.log(`Cache entries total: ${cacheKeys.length}`);
  console.log(`Missing location keys: ${entries.length}`);

  const cap = 200;
  const show = entries.slice(0, cap);
  for (const e of show) {
    console.log(`"${e.pretty}": { "lat": ${e.lat}, "lon": ${e.lon} }`);
  }
  if (entries.length > cap) {
    console.log(`... plus ${entries.length - cap} more`);
  }

  // Option C: export report (only if update is supplied)
  const reportPath = path.resolve('./anomaly-map/data/missing-cache-report.json');
  if (doUpdate) {
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

// Nominatim geocoding function
async function geocode(city, region, country) {
  // Build the best possible query string
  let query = '';
  // Cache and query are keyed as: Country, Region, City
  if (country && region && city) query = `${country}, ${region}, ${city}`;
  else if (country && city) query = `${country}, , ${city}`; // empty region slot keeps keys consistent
  else if (country && region) query = `${country}, ${region}, `;
  else return null;

  const key = query;
  if (cache[key]) return cache[key];

  // Fast-path: if city is an Ingress score-region cell name, compute coordinates locally
  if (city && isIngressCellName(city)) {
    const ll = cellNameToLatLng(city);
    if (ll) {
      const coords = { lat: ll.lat, lon: ll.lng };
      cache[key] = coords;
      return coords;
    }
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.length) {
    const { lat, lon } = data[0];
    const coords = { lat: parseFloat(lat), lon: parseFloat(lon) };
    cache[key] = coords;
    return coords;
  } else {
    // Log in human-friendly order (city, region, country) without altering the cache key
    const pretty = [city, region, country]
      .filter(v => v && String(v).trim())
      .join(', ');
    console.warn(`No results for ${pretty}`);

    return null;
  }
}

function coordDiffMeters(a, b) {
  // Haversine distance, metres
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

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function hasCoords(evt) {
  return (
    evt.location &&
    evt.location.lat !== null &&
    evt.location.lat !== undefined &&
    evt.location.lng !== null &&
    evt.location.lng !== undefined &&
    isFiniteNumber(evt.location.lat) &&
    isFiniteNumber(evt.location.lng)
  );
}

// Post-process the pretty-printed JSON so certain nested objects stay on one line
// (makes manual reviews and diffs far easier).
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

// Post-process cities-cache.json so each entry stays on one line and keys are sorted.
function formatCitiesCache(cacheObj) {
  // Sort keys for stable diffs
  const sorted = Object.fromEntries(
    Object.entries(cacheObj).sort(([a], [b]) => a.localeCompare(b))
  );

  let txt = JSON.stringify(sorted, null, 2);

  // Turn each value object into a single line: { "lat": x, "lon": y }
  txt = txt.replace(
    /(:\s*)\{\s*\n\s*"lat"\s*:\s*([^,\n]+)\s*,\s*\n\s*"lon"\s*:\s*([^\n]+)\s*\n\s*\}/g,
    '$1{ "lat": $2, "lon": $3 }'
  );

  return txt;
}

async function refreshCache() {
  let total = 0;
  let refreshed = 0;
  let noResult = 0;
  let mismatches = 0;
  let updated = 0;

  const keys = Object.keys(cache).sort((a, b) => a.localeCompare(b));
  console.log(`Refreshing cache entries: ${keys.length}`);

  for (const key of keys) {
    total++;
    const existing = cache[key];
    if (!existing || typeof existing.lat !== 'number' || typeof existing.lon !== 'number') {
      console.warn(`Skipping invalid cache entry: ${key}`);
      continue;
    }

    // If this cache entry is an Ingress score-region cell name, recompute locally.
    // Nominatim will generally return no results for these.
    let fresh = null;
    const { city } = splitCacheKey(key);
    if (city && isIngressCellName(city)) {
      const ll = cellNameToLatLng(city);
      if (ll) {
        fresh = { lat: ll.lat, lon: ll.lng };
      }
    } else {
      fresh = await geocodeRaw(key);
    }

    if (!fresh) {
      noResult++;
      console.warn(`No results for ${key}`);
      continue;
    }

    refreshed++;
    const a = { lat: existing.lat, lng: existing.lon };
    const b = { lat: fresh.lat, lng: fresh.lon };
    const d = coordDiffMeters(a, b);

    // Ignore tiny rounding differences
    if (d > 150) {
      mismatches++;
      console.warn(
        `CACHE mismatch: ${key} (${Math.round(d)}m)`
      );
      console.warn(a.lat,",",a.lng)
      console.warn(b.lat,",",b.lng)

      if (doUpdate) {
        cache[key] = { lat: fresh.lat, lon: fresh.lon };
        updated++;
      }
    }
  }

  if (doUpdate) {
    const cacheOut = formatCitiesCache(cache);
    fs.writeFileSync(cachePath, cacheOut);
  }

  console.log('Cache refresh complete.');
  console.log(`Mode:                 ${doUpdate ? 'UPDATE' : 'DRY-RUN'} + REFRESH`);
  console.log(`Total cache entries:    ${total}`);
  console.log(`Geocode succeeded:      ${refreshed}`);
  console.log(`No geocode result:      ${noResult}`);
  console.log(`Discrepancies (>150m):  ${mismatches}`);
  console.log(`Cache entries updated:  ${updated}`);
  if (!doUpdate) {
    console.log('Dry-run: no files were written. Add the `update` argument to persist cache changes.');
  }
}

// Main loop for grouped structure
async function updateLocations() {
  // Load grouped anomalies only when needed
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

  for (const series of anomalies) {
    if (!series || !Array.isArray(series.types)) continue;
    console.info({ series: series.series });

    for (const typeEntry of series.types) {
      if (!typeEntry || !Array.isArray(typeEntry.dates)) continue;
      // console.info({ type: typeEntry.type });

      for (const dateEntry of typeEntry.dates) {
        if (!dateEntry || !Array.isArray(dateEntry.events)) continue;

        for (const evt of dateEntry.events) {
          totalEvents++;

          const alreadyHasCoords = hasCoords(evt);
          if (alreadyHasCoords) alreadyHadCoords++;

          const city = evt.city;
          const region = evt.region;
          const country = evt.country;

          // Require country, and at least one of city or region
          if (!country || (!city && !region)) {
            missingCityCountry++;
            console.warn(
              `Missing details: ${typeEntry.type} ${dateEntry.date}: '${city}', '${region}', '${country}'`
            );
            continue;
          }

          // Decide whether we should geocode this event
          const shouldReGeocode = (!alreadyHasCoords) || doOverride;

          if (!shouldReGeocode) {
            // Verify mode: compare existing coords to expected coords (from cache or live geocode)
            if (doVerify) {
              const expected = await geocode(city, region, country);
              if (expected) {
                verified++;
                const existing = { lat: evt.location.lat, lng: evt.location.lng };
                const exp = { lat: expected.lat, lng: expected.lon };
                const d = coordDiffMeters(existing, exp);
                // Use a small threshold to ignore tiny rounding differences
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

          // We are missing coords, or override is requested
          const coords = await geocode(city, region, country);
          if (coords) {
            const newLoc = { lat: coords.lat, lng: coords.lon };

            if (alreadyHasCoords) {
              // Override path (or re-check) — track potential change
              const existing = { lat: evt.location.lat, lng: evt.location.lng };
              const d = coordDiffMeters(existing, newLoc);
              // Even if it's close, override may still be desired; we report the delta.
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

          // Skip the old coords-writing logic below (we handled it above)
          continue;
        }
      }
    }
  }

  // Save updated data and cache (only in update mode)
  if (doUpdate) {
    let out = JSON.stringify(anomalies, null, 2);
    out = compactLocationAndScore(out);
    fs.writeFileSync(dataPath, out);

    const cacheOut = formatCitiesCache(cache);
    fs.writeFileSync(cachePath, cacheOut);
  }

  console.log('Geocoding complete.');
  console.log(`Mode:                 ${doUpdate ? 'UPDATE' : 'DRY-RUN'}${doVerify ? ' + VERIFY' : ''}${doOverride ? ' + OVERRIDE' : ''}`);
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

if (doRefresh) {
  refreshCache();
} else if (doUnusedCache) {
  reportUnusedCacheEntries();
} else if (doMissingCache) {
  reportMissingCacheEntries();
} else {
  updateLocations();
}