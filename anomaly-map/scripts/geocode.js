import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Path to the GROUPED historical data
// (series → types → dates → events)
const dataPath = path.resolve('./anomaly-map/data/anomalies-historical.json');
const cachePath = path.resolve('./anomaly-map/data/cities-cache.json');

// Load grouped anomalies
const anomalies = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// Load or initialize cache
let cache = {};
if (fs.existsSync(cachePath)) {
  cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
}

// Nominatim geocoding function
async function geocode(city, region, country) {
  // Build the best possible query string
  let query = '';
  if (city && region) query = `${city}, ${region}, ${country}`;
  else if (city) query = `${city}, ${country}`;
  else if (region) query = `${region}, ${country}`;
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
    console.warn(`No results for ${key}`);

    return null;
  }
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

// Main loop for grouped structure
async function updateLocations() {
  let totalEvents = 0;
  let alreadyHadCoords = 0;
  let missingCityCountry = 0;
  let geocoded = 0;
  let noResult = 0;

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

          // If we already have usable coordinates, leave them alone
          if (
            evt.location &&
            evt.location.lat !== null &&
            evt.location.lat !== undefined &&
            evt.location.lng !== null &&
            evt.location.lng !== undefined
          ) {
            alreadyHadCoords++;
            continue;
          }

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

          const coords = await geocode(city, region, country);
          if (coords) {
            evt.location = { lat: coords.lat, lng: coords.lon };
            geocoded++;
            // console.log(`Geocoded: ${city}, ${country}`);
          } else {
            noResult++;
          }
        }
      }
    }
  }

  // Save updated data and cache
  let out = JSON.stringify(anomalies, null, 2);
  out = compactLocationAndScore(out);
  fs.writeFileSync(dataPath, out);

  const cacheOut = formatCitiesCache(cache);
  fs.writeFileSync(cachePath, cacheOut);

  console.log('Geocoding complete.');
  console.log(`Total events seen:       ${totalEvents}`);
  console.log(`Already had coordinates: ${alreadyHadCoords}`);
  console.log(`Missing city/country:    ${missingCityCountry}`);
  console.log(`Successfully geocoded:   ${geocoded}`);
  console.log(`No geocode result:       ${noResult}`);
}

updateLocations();