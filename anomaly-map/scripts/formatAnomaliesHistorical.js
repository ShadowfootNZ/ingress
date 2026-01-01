#!/usr/bin/env node
/**
 * Format anomalies-historical.json for readability:
 * 1) locations entries as single line:
 *    "United States, Texas, Galveston": { "lat": 29.387..., "lng": -94.99... },
 * 2) countries entries as single line:
 *    "Canada": { "iso2": "CA", "flag": "🇨🇦" },
 * 3) score objects as single line:
 *    "score": { "enl": 0, "res": 0 }
 *
 * Usage:
 *   node scripts/formatAnomaliesHistorical.js
 *
 * Adjust the input/output path below if yours differs.
 */

import fs from 'node:fs';
import path from 'node:path';

const INPUT = path.resolve('./anomaly-map/data/anomalies-historical.json');
const OUTPUT = INPUT; // overwrite in place

function ensureNumber(n) {
  // Keep as number if it already is; if string that looks like a number, convert.
  if (typeof n === 'number') return n;
  if (typeof n === 'string') {
    const cleaned = n.replace(/,/g, '').trim();
    const num = Number(cleaned);
    if (Number.isFinite(num)) return num;
  }
  return n;
}

function normaliseScoreObjects(obj) {
  // Optional: make sure scores are numeric (helps prevent "11,705" type strings)
  // and keep nulls as-is.
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    obj.forEach(normaliseScoreObjects);
    return;
  }

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'score' && v && typeof v === 'object' && !Array.isArray(v)) {
      if ('enl' in v) v.enl = v.enl === null ? null : ensureNumber(v.enl);
      if ('res' in v) v.res = v.res === null ? null : ensureNumber(v.res);
    } else {
      normaliseScoreObjects(v);
    }
  }
}

function collapseLocationsBlock(text) {
  // Turns:
  // "Some Key": {
  //   "lat": 1,
  //   "lng": 2
  // },
  // into:
  // "Some Key": { "lat": 1, "lng": 2 },
  //
  // Only within the top-level "locations" object.
  return text.replace(
    /^(\s*)"locations"\s*:\s*\{\n([\s\S]*?)^\1\}\s*,?\n/m,
    (m, indent0, body) => {
      const collapsed = body.replace(
        /^(\s*)"([^"]+)"\s*:\s*\{\s*\n\1\s{2}"lat"\s*:\s*([^,\n]+)\s*,\s*\n\1\s{2}"lng"\s*:\s*([^\n]+)\s*\n\1\}\s*(,?)\s*$/gm,
        (_m2, indent, key, lat, lng, comma) =>
          `${indent}"${key}": { "lat": ${lat.trim()}, "lng": ${lng.trim()} }${comma}`
      );
      // Rebuild the whole block with the same outer indentation.
      return `${indent0}"locations": {\n${collapsed}${indent0}}\n` + (m.endsWith('},\n') ? ',\n' : '\n');
    }
  );
}

function collapseCountriesBlock(text) {
  // Turns:
  // "countries": {
  //   "Canada": {
  //     "iso2": "CA",
  //     "flag": "🇨🇦"
  //   },
  // ...
  // into single-line entries for each country.
  return text.replace(
    /^(\s*)"countries"\s*:\s*\{\n([\s\S]*?)^\1\}\s*,?\n/m,
    (m, indent0, body) => {
      const collapsed = body.replace(
        /^(\s*)"([^"]+)"\s*:\s*\{\s*\n\1\s{2}"iso2"\s*:\s*"([^"]*)"\s*,\s*\n\1\s{2}"flag"\s*:\s*"([^"]*)"\s*\n\1\}\s*(,?)\s*$/gm,
        (_m2, indent, key, iso2, flag, comma) =>
          `${indent}"${key}": { "iso2": "${iso2}", "flag": "${flag}" }${comma}`
      );
      return `${indent0}"countries": {\n${collapsed}${indent0}}\n` + (m.endsWith('},\n') ? ',\n' : '\n');
    }
  );
}

function collapseScoreObjectsEverywhere(text) {
  // Turns:
  // "score": {
  //   "enl": 0,
  //   "res": 0
  // }
  // into:
  // "score": { "enl": 0, "res": 0 }
  //
  // Works regardless of indentation depth.
  return text.replace(
    /^(\s*)"score"\s*:\s*\{\s*\n\1\s{2}"enl"\s*:\s*([^,\n]+)\s*,\s*\n\1\s{2}"res"\s*:\s*([^\n]+)\s*\n\1\}/gm,
    (_m, indent, enl, res) => `${indent}"score": { "enl": ${enl.trim()}, "res": ${res.trim()} }`
  );
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`File not found: ${INPUT}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT, 'utf8');
  const data = JSON.parse(raw);

  // Optional: keep score values consistent (numbers stay numbers).
  // This does NOT add data; it just prevents numeric strings hanging around.
  normaliseScoreObjects(data);

  // Base pretty print first
  let out = JSON.stringify(data, null, 2) + '\n';

  // Then targeted collapsing passes
  out = collapseLocationsBlock(out);
  out = collapseCountriesBlock(out);
  out = collapseScoreObjectsEverywhere(out);

  fs.writeFileSync(OUTPUT, out, 'utf8');
  console.log(`Formatted: ${OUTPUT}`);
}

main();