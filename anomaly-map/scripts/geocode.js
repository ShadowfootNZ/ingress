import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const dataPath = path.resolve('./anomaly-map/data/anomalies.json');
const cachePath = path.resolve('./anomaly-map/data/cities-cache.json');

// Load anomalies
const anomalies = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// Load or initialize cache
let cache = {};
if (fs.existsSync(cachePath)) {
  cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
}

// Nominatim geocoding function
async function geocode(city, country) {
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

// Main loop
async function updateLocations() {
  for (const anomaly of anomalies) {
    if (!anomaly.city || !anomaly.country) {
      console.warn(`Skipping incomplete entry:`, anomaly);
      continue;
    }

    const coords = await geocode(anomaly.city, anomaly.country);
    if (coords) {
      anomaly.location = { lat: coords.lat, lng: coords.lon };
      console.log(`Geocoded: ${anomaly.city}, ${anomaly.country}`);
    }
  }

  // Save updated data and cache
  fs.writeFileSync(dataPath, JSON.stringify(anomalies, null, 2));
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  console.log("Geocoding complete.");
}

updateLocations();