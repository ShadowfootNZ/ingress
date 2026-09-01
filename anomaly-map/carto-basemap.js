export const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function cartoDarkTileUrl(apiKey = globalThis.CARTO_API_KEY) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) {
    throw new Error('CARTO_API_KEY is missing. Create carto-config.js; see README.md.');
  }
  return `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`;
}
