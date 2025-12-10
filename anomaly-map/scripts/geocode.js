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
async function geocode(city, state, country) {
  const key = `${city},${country}`;
  if (cache[key]) return cache[key];

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(key)}`;
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
          const state = evt.state;
          const country = evt.country;

          if (!city || !country) {
            missingCityCountry++;
            console.warn(
              `Missing details: ${typeEntry.type} ${dateEntry.date}: '${city}', '${state}', '${country}'`
              // { date: dateEntry.date, city, state, country }
            );
            continue;
          }

          const coords = await geocode(city, state, country);
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
  fs.writeFileSync(dataPath, JSON.stringify(anomalies, null, 2));
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  console.log('Geocoding complete.');
  console.log(`Total events seen:       ${totalEvents}`);
  console.log(`Already had coordinates: ${alreadyHadCoords}`);
  console.log(`Missing city/country:    ${missingCityCountry}`);
  console.log(`Successfully geocoded:   ${geocoded}`);
  console.log(`No geocode result:       ${noResult}`);
}

updateLocations();