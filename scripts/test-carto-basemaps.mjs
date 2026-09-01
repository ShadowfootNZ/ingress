import assert from 'node:assert/strict';

for (const app of ['anomaly-map', 'countdown']) {
  const { CARTO_ATTRIBUTION, cartoDarkTileUrl } = await import(`../${app}/carto-basemap.js`);
  const url = cartoDarkTileUrl('test key/+');

  assert.equal(
    url,
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=test%20key%2F%2B'
  );
  assert.match(CARTO_ATTRIBUTION, /href="https:\/\/www\.openstreetmap\.org\/copyright">OpenStreetMap contributors<\/a>/);
  assert.match(CARTO_ATTRIBUTION, /href="https:\/\/carto\.com\/attributions">CARTO<\/a>/);
  assert.throws(() => cartoDarkTileUrl('  '), /CARTO_API_KEY is missing/);
}

console.log('CARTO basemap configuration and attribution checks passed.');
