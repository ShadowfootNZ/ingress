import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Path to the GROUPED historical data
// (series → types → dates → events)
const dataPath = path.resolve('./anomaly-map/data/anomalies-historical.json');
const cachePath = path.resolve('./anomaly-map/data/cities-cache.json');

const args = new Set(process.argv.slice(2).map(a => String(a).toLowerCase()));
const doUpdate = args.has('update');
const doOverride = args.has('override');
const doVerify = args.has('verify') || doOverride;
const doRefresh = args.has('refresh');

console.log(
  `Mode: ${doUpdate ? 'UPDATE' : 'DRY-RUN'}${doRefresh ? ' + REFRESH' : ''}${doVerify ? ' + VERIFY' : ''}${doOverride ? ' + OVERRIDE' : ''}`
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

function prettyFromCacheKey(key) {
  // Key is stored as: country, region, city (with possible empty slot)
  const parts = String(key)
    .split(',')
    .map(s => s.trim());
  const country = parts[0] || '';
  const region = parts[1] || '';
  const city = parts[2] || '';
  return [city, region, country].filter(v => v).join(', ');
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

    const fresh = await geocodeRaw(key);
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
} else {
  updateLocations();
}