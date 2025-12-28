/**
 * Compare Google Sheet "City List" with anomalies-historical.json
 *
 * Sheet columns (headers in row 2):
 * Type, Series, Date, City, State/Region/Province, Country, ENL, RES, Info
 *
 * Notes:
 * - 'n/a' (any case) in State/Region/Province is treated as empty
 * - ENL/RES may be blank -> null
 * - Details is series-level; we ignore it for per-event comparison (but you can add checks)
 */

import fs from 'fs';
import path from 'path';

const SPREADSHEET_ID = '1nDYjQZ4z4Oo890ibZzA2ABu2Osk7wDKV5RUbExPG8oc';
// "City List" tab gid from your original URL
const SHEET_GID = '1211130013';


const dataPath = path.resolve('./anomaly-map/data/anomalies-historical.json');
const aliasesPath = path.resolve('./anomaly-map/data/location-aliases.json');
const anomalyAliasesPath = path.resolve('./anomaly-map/data/anomaly-aliases.json');


// --- CLI args --------------------------------------------------------------
// Supported flags:
//   strict
//   show-matches
//   show-additions
//   anomaly=<series name>   (filters comparison to a single anomaly series; applied AFTER anomaly-aliases)

const argv = process.argv.slice(2);
const args = new Set(argv.map(s => String(s).toLowerCase()));

function getArgValue(name) {
  const prefix = `${name}=`;
  const hit = argv.find(a => String(a).toLowerCase().startsWith(prefix));
  if (!hit) return null;
  return hit.slice(prefix.length);
}

const strict = args.has('strict'); // if set, city/region/country must match exactly (case+accents)
const showMatches = args.has('show-matches'); // noisy
const showAdditions = args.has('show-additions');

const anomalyFilterRaw = getArgValue('anomaly');

function normText(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function normRegion(v) {
  const s = normText(v);
  if (!s) return '';
  if (s.toLowerCase() === 'n/a') return '';
  return s;
}

function normScore(v) {
  const s = normText(v);
  if (!s) return null;

  // Handle thousands separators (e.g. "11,705") from the CSV export.
  const normalised = s.replace(/,/g, '');
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

function normKeyPart(v) {
  const s = normText(v);
  if (strict) return s;
  // loose match: case-insensitive and collapse spaces
  return s.toLowerCase().replace(/\s+/g, ' ');
}

function normTypeForMatch(type) {
  const t = normText(type);
  if (!t) return '';
  const lc = t.toLowerCase();
  if (lc === 'other anomaly' || lc === 'modern anomaly') return 'Anomaly';
  return t;
}

// --- Location aliases -------------------------------------------------------
// location-aliases.json maps a sheet-provided location to the canonical location used in anomalies-historical.json.
// Keys can be:
//   "Country|City" or "Country|Region|City".
//   You may also write `null` for a missing part (e.g. "Russia|Chelyabinsk|null").
// Values can be:
//   {}  (no mapping yet / placeholder)
//   { "country": "...", "region": "...", "city": "..." }

function normAliasPart(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (s.toLowerCase() === 'null') return '';
  return s.toLowerCase().replace(/\s+/g, ' ');
}

function makeAliasKey(country, region, city) {
  const parts = [country, region, city].map(normAliasPart);
  return parts.join('|');
}

function loadLocationAliases() {
  if (!fs.existsSync(aliasesPath)) return new Map();

  const raw = JSON.parse(fs.readFileSync(aliasesPath, 'utf-8'));
  const map = new Map();

  for (const [k, v] of Object.entries(raw)) {
    // Normalise the key so matching is robust regardless of casing/spacing.
    // Accept either Country|City or Country|Region|City. Also treat literal "null" as empty.
    const parts = String(k)
      .split('|')
      .map(s => normAliasPart(s));

    let country = parts[0] ?? '';
    let region = '';
    let city = '';

    if (parts.length >= 3) {
      region = parts[1] ?? '';
      city = parts[2] ?? '';
    } else if (parts.length === 2) {
      city = parts[1] ?? '';
    } else {
      // Invalid key; still store it as-is
      map.set(parts.join('|'), v);
      continue;
    }

    const normKey = makeAliasKey(country, region, city);
    map.set(normKey, v);
  }

  return map;
}

function applyLocationAliasToRow(row, aliasMap) {
  if (!aliasMap || aliasMap.size === 0) return row;

  const city = row.city ?? '';
  const region = row.region ?? '';
  const country = row.country ?? '';

  // Try most specific first, then fall back.
  const key3 = makeAliasKey(country, region, city);
  const key2 = makeAliasKey(country, '', city); // Country|City

  const hit = aliasMap.get(key3) ?? aliasMap.get(key2);
  if (!hit || typeof hit !== 'object') return row;

  // Empty object means "known / placeholder" - no remapping.
  if (Object.keys(hit).length === 0) return row;

  // Important: allow explicit nulls from the alias mapping (so you can see what was missing in the sheet).
  // Use a property-existence check rather than ?? so `null` doesn't fall back to the original.
  const out = { ...row };
  if (Object.prototype.hasOwnProperty.call(hit, 'country')) out.country = hit.country;
  if (Object.prototype.hasOwnProperty.call(hit, 'region')) out.region = hit.region;
  if (Object.prototype.hasOwnProperty.call(hit, 'city')) out.city = hit.city;
  return out;
}

// Helper functions for reviewing location-aliases.json
function parseAliasKeyToParts(key) {
  const parts = String(key ?? '').split('|');
  const country = parts[0] ?? 'null';
  const region = parts[1] ?? 'null';
  const city = parts[2] ?? 'null';
  return {
    country: country === '' ? 'null' : country,
    region: region === '' ? 'null' : region,
    city: city === '' ? 'null' : city,
  };
}

function normAliasComparePart(v) {
  const s = String(v ?? '').trim();
  if (!s) return 'null';
  if (s.toLowerCase() === 'null') return 'null';
  return s.toLowerCase().replace(/\s+/g, ' ');
}

function makeRawSheetLocKey(country, region, city) {
  // Produce keys like the ones you keep in location-aliases.json: Country|Region|City with literal "null".
  const c = country && String(country).trim() ? String(country).trim() : 'null';
  const r = region && String(region).trim() ? String(region).trim() : 'null';
  const ct = city && String(city).trim() ? String(city).trim() : 'null';
  return `${c}|${r}|${ct}`;
}
// ---------------------------------------------------------------------------
// --- Anomaly/series aliases -------------------------------------------------
// anomalies-aliases.json maps a displayed/anomalous series name to the canonical series name used for matching.
// Example: { "Save Klue (Scotland)": "Save Klue" }

function normAliasKeyLoose(s) {
  // use the same loose normalisation style as keys (case-insensitive, collapse spaces)
  return normKeyPart(s);
}

function loadAnomalyAliases() {
  if (!fs.existsSync(anomalyAliasesPath)) return new Map();

  const raw = JSON.parse(fs.readFileSync(anomalyAliasesPath, 'utf-8'));
  const map = new Map();

  for (const [from, to] of Object.entries(raw)) {
    map.set(normAliasKeyLoose(from), normText(to));
  }

  return map;
}

function applyAnomalyAlias(series, anomalyAliasMap) {
  if (!anomalyAliasMap || anomalyAliasMap.size === 0) return series;
  const hit = anomalyAliasMap.get(normAliasKeyLoose(series));
  return hit ? hit : series;
}
// ---------------------------------------------------------------------------

// Event identity keys
// Only the no-type key is now used (ignores type; used to find missing JSON rows even if type labels differ)
function makeKeyNoType({ series, date, country, region, city }) {
  return [
    normKeyPart(series),
    normKeyPart(date),
    normKeyPart(country),
    normKeyPart(region),
    normKeyPart(city)
  ].join('|');
}

function flattenJson(anomalies) {
  const noType = new Map();   // Series|Date|Country|Region|City  (may collide if multiple types share same loc+date)

  for (const s of anomalies) {
    const series = s?.series ?? '';
    for (const t of (s?.types ?? [])) {
      const type = normTypeForMatch(t?.type ?? '');
      for (const d of (t?.dates ?? [])) {
        const date = d?.date ?? '';
        for (const e of (d?.events ?? [])) {
          const row = {
            series,
            type,
            date,
            city: e?.city ?? '',
            region: e?.region ?? '',
            country: e?.country ?? '',
            enl: e?.score?.enl ?? null,
            res: e?.score?.res ?? null
          };

          const kNoType = makeKeyNoType(row);

          // No-type map (keep an array when collisions happen)
          if (!noType.has(kNoType)) {
            noType.set(kNoType, row);
          } else {
            const existing = noType.get(kNoType);
            if (Array.isArray(existing)) {
              existing.push(row);
              noType.set(kNoType, existing);
            } else {
              noType.set(kNoType, [existing, row]);
            }
          }
        }
      }
    }
  }

  return { noType };
}

function parseCsv(text) {
  // Minimal RFC4180-ish CSV parser: handles quoted fields with commas and newlines.
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }

    if (c === '\r') {
      // ignore CR (handles CRLF)
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  // last field
  row.push(field);
  rows.push(row);
  return rows;
}

async function readSheetRows() {
  // Option B: sheet is shared publicly ("Anyone with the link") so we can fetch as CSV.
  // This avoids any need for googleapis/service accounts.
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

  if (typeof fetch !== 'function') {
    throw new Error('Global fetch() is not available. Use Node 18+ or add a fetch polyfill.');
  }

  const resp = await fetch(url, {
    headers: {
      // Some environments behave better with an explicit UA
      'User-Agent': 'anomaly-map/compareSheetToJson'
    }
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch CSV (${resp.status} ${resp.statusText}). If Google requires login, the sheet is not public.`);
  }

  const csvText = await resp.text();
  const values = parseCsv(csvText);

  // Headers are in row 2 in the sheet, so A2:J... means:
  // - row 1 of CSV is sheet row 1 (ignored)
  // - row 2 of CSV is headers
  // - data starts row 3
  if (values.length < 3) {
    throw new Error('Not enough rows returned from CSV. Expected at least 3 rows (row1, headers row2, data row3...).');
  }

  const headers = values[1].map(h => normText(h));
  const rows = values.slice(2);

  const idx = (name) => headers.findIndex(h => h === name);

  const iType = idx('Type');
  const iSeries = idx('Series');
  const iDate = idx('Date');
  const iCity = idx('City');
  const iRegion = idx('State/Region/Province');
  const iCountry = idx('Country');
  const iEnl = idx('ENL');
  const iRes = idx('RES');
  // const iDetails = idx('Details'); // Details column removed
  const iInfo = idx('Info');

  const required = [
    ['Type', iType],
    ['Series', iSeries],
    ['Date', iDate],
    ['City', iCity],
    ['State/Region/Province', iRegion],
    ['Country', iCountry],
    ['ENL', iEnl],
    ['RES', iRes]
  ];
  const missingCols = required.filter(([, i]) => i < 0).map(([n]) => n);
  if (missingCols.length) {
    throw new Error(`Missing required column(s) in headers row (row 2): ${missingCols.join(', ')}`);
  }

  const out = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];

    const series = normText(row[iSeries]);
    const type = normText(row[iType]);
    const date = normText(row[iDate]); // yyyy-mm-dd
    const city = normText(row[iCity]);
    const region = normRegion(row[iRegion]);
    const country = normText(row[iCountry]);
    const enl = normScore(row[iEnl]);
    const res = normScore(row[iRes]);

    // const details = iDetails >= 0 ? normText(row[iDetails]) : '';
    const info = iInfo >= 0 ? normText(row[iInfo]) : '';

    // Skip totally empty lines
    if (!series && !type && !date && !city && !country) continue;

    out.push({
      sheetRow: r + 3, // actual sheet row number
      series,
      type,
      date,
      city,
      region,
      country,
      enl,
      res,
      info
    });
  }

  return out;
}

function scoreComparable(v) {
  if (v == null) return null;

  // Accept numbers, numeric strings, and strings with thousands separators (e.g. "11,705").
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;

    // Remove common thousands separators.
    const normalised = s.replace(/,/g, '');
    const n = Number(normalised);
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compare(sheetRow, jsonRow) {
  const diffs = [];

  const sEnl = scoreComparable(sheetRow.enl);
  const sRes = scoreComparable(sheetRow.res);
  const jEnl = scoreComparable(jsonRow.enl);
  const jRes = scoreComparable(jsonRow.res);

  if (sEnl !== jEnl) diffs.push(`ENL sheet=${sEnl} json=${jEnl}`);
  if (sRes !== jRes) diffs.push(`RES sheet=${sRes} json=${jRes}`);

  return diffs;
}


function buildMissingEvent(sheetRow) {
  // Create a minimal event object to be inserted into anomalies-historical.json
  // NOTE: location is intentionally omitted because geocode.js owns it.
  const enl = scoreComparable(sheetRow.enl);
  const res = scoreComparable(sheetRow.res);

  const evt = {
    city: sheetRow.city || null,
    region: sheetRow.region || null,
    country: sheetRow.country,
    score: { enl, res }
  };

  // Info is optional free text
  if (sheetRow.info && sheetRow.info.trim()) {
    evt.info = sheetRow.info.trim();
  }

  return {
    insertUnder: {
      series: sheetRow.series,
      type: sheetRow.type,
      date: sheetRow.date
    },
    event: evt,
    sheetRow: sheetRow.sheetRow
  };
}



function seriesKeyForFilter(series) {
  return normKeyPart(series);
}


async function main() {
  const anomalyAliases = loadAnomalyAliases();

  const anomaliesAll = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  // `anomalies` may be filtered for comparison; never write it back to disk.
  let anomalies = anomaliesAll;

  const locationAliases = loadLocationAliases();
  let sheetRowsRaw = await readSheetRows();

  // Optional: filter everything to a single anomaly series (AFTER applying anomaly-aliases)
  let anomalyFilterKey = null;
  if (anomalyFilterRaw) {
    // Filter key is based on the canonical/aliased series value
    const aliased = applyAnomalyAlias(anomalyFilterRaw, anomalyAliases);
    anomalyFilterKey = seriesKeyForFilter(aliased);

    // Filter sheet rows by aliased series
    sheetRowsRaw = sheetRowsRaw.filter(r => {
      const s = applyAnomalyAlias(r.series, anomalyAliases);
      return seriesKeyForFilter(s) === anomalyFilterKey;
    });

    // Filter JSON series
    anomalies = anomalies.filter(s => seriesKeyForFilter(s?.series ?? '') === anomalyFilterKey);
  }

  // Build JSON indexes AFTER any filtering
  const { noType: jsonMapNoType } = flattenJson(anomalies);


  // --- Review location-aliases.json ----------------------------------------
  // 1) Report alias keys that never appear in the Google Sheet (so they will never be used)
  // 2) Report aliases that are a no-op (key location == mapped location)

  let rawAliasObj = {};
  if (fs.existsSync(aliasesPath)) {
    rawAliasObj = JSON.parse(fs.readFileSync(aliasesPath, 'utf-8'));
  }

  // Build a set of raw location keys as they appear in the sheet (Country|Region|City with literal "null" for missing)
  const sheetRawLocKeys = new Set();
  for (const r of sheetRowsRaw) {
    sheetRawLocKeys.add(makeRawSheetLocKey(r.country, r.region, r.city));
  }

  const aliasesNotInSheet = [];
  const noOpAliases = [];

  for (const [k, v] of Object.entries(rawAliasObj)) {
    const keyParts = parseAliasKeyToParts(k);
    const keyForCompare = makeRawSheetLocKey(keyParts.country, keyParts.region, keyParts.city);

    // (1) Alias key not present in sheet
    if (!sheetRawLocKeys.has(keyForCompare)) {
      aliasesNotInSheet.push(k);
    }

    // (2) No-op alias: key location equals the alias location
    // Skip placeholders like {} (these are intentionally incomplete)
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
      const keyC = normAliasComparePart(keyParts.country);
      const keyR = normAliasComparePart(keyParts.region);
      const keyCt = normAliasComparePart(keyParts.city);

      const valC = normAliasComparePart(v.country);
      const valR = normAliasComparePart(v.region);
      const valCt = normAliasComparePart(v.city);

      if (keyC === valC && keyR === valR && keyCt === valCt) {
        noOpAliases.push(k);
      }
    }
  }

  if (aliasesNotInSheet.length) {
    console.log('---');
    console.log('UNUSED LOCATION-ALIASES (keys not present in Google Sheet):');
    aliasesNotInSheet
      .sort((a, b) => a.localeCompare(b))
      .forEach(k => console.log(`- ${k}`));
  }

  if (noOpAliases.length) {
    console.log('---');
    console.log('NO-OP LOCATION-ALIASES (key location equals mapped location; fix or remove):');
    noOpAliases
      .sort((a, b) => a.localeCompare(b))
      .forEach(k => console.log(`- ${k}`));
  }
  // ------------------------------------------------------------------------

  // --- Series coverage check (sheet vs JSON) --------------------------------
  // 1) Build a list of the series from the spreadsheet, AFTER applying anomalies-aliases.json
  // 2) Build a list of all series in anomalies-historical.json
  // 3) Report series present in sheet (aliased) but absent from JSON

  const sheetSeriesCounts = new Map();      // normKey -> { name, count, examples: Set(originalName) }
  const jsonSeriesSet = new Set();          // normKey

  for (const r of sheetRowsRaw) {
    const aliasedSeries = applyAnomalyAlias(r.series, anomalyAliases);
    const k = normKeyPart(aliasedSeries);
    const entry = sheetSeriesCounts.get(k) ?? { name: aliasedSeries, count: 0, examples: new Set() };
    entry.count += 1;
    entry.examples.add(r.series);
    // Keep the display name stable (prefer the first aliased name we saw)
    sheetSeriesCounts.set(k, entry);
  }

  for (const s of anomalies) {
    const k = normKeyPart(s?.series ?? '');
    if (k) jsonSeriesSet.add(k);
  }

  const missingSeries = [];
  for (const [k, entry] of sheetSeriesCounts.entries()) {
    if (!jsonSeriesSet.has(k)) {
      missingSeries.push({
        series: entry.name,
        count: entry.count,
        sheetExamples: [...entry.examples]
      });
    }
  }

  if (missingSeries.length) {
    console.log('---');
    console.log('SERIES IN SHEET (AFTER anomalies-aliases) BUT NOT IN anomalies-historical.json:');
    missingSeries
      .sort((a, b) => a.series.localeCompare(b.series))
      .forEach(m => {
        const examples = m.sheetExamples.length > 1
          ? ` (sheet had: ${m.sheetExamples.join(' | ')})`
          : '';
        console.log(`- ${m.series} [rows: ${m.count}]${examples}`);
      });
  }
  // -------------------------------------------------------------------------

  // --- Location coverage check (sheet+location-aliases vs JSON) --------------
  // Build a list of locations from the spreadsheet AFTER applying location-aliases.json,
  // then compare to all locations present anywhere in anomalies-historical.json.
  // This helps you spot places where the sheet location (after aliasing) still doesn't exist in JSON.

  const sheetLocCounts = new Map();   // normKey -> { country, region, city, count, examples: Set(rawKey) }
  const jsonLocSet = new Set();       // normKey

  const fmtLocKey = (country, region, city) => {
    const c = country ?? 'null';
    const r = (region === '' ? '' : (region ?? 'null'));
    const ct = city ?? 'null';
    return `${c}|${r}|${ct}`;
  };

  const locNormKey = (country, region, city) => [
    normKeyPart(country),
    normKeyPart(region),
    normKeyPart(city)
  ].join('|');

  for (const rawRow of sheetRowsRaw) {
    const aliasedLoc = applyLocationAliasToRow(rawRow, locationAliases);

    const k = locNormKey(aliasedLoc.country, aliasedLoc.region, aliasedLoc.city);
    const entry = sheetLocCounts.get(k) ?? {
      country: aliasedLoc.country ?? null,
      region: (aliasedLoc.region ?? null),
      city: (aliasedLoc.city ?? null),
      count: 0,
      examples: new Set()
    };

    entry.count += 1;
    entry.examples.add(fmtLocKey(rawRow.country, rawRow.region, rawRow.city));
    sheetLocCounts.set(k, entry);
  }

  for (const s of anomalies) {
    for (const t of (s?.types ?? [])) {
      for (const d of (t?.dates ?? [])) {
        for (const e of (d?.events ?? [])) {
          const k = locNormKey(e?.country ?? '', e?.region ?? '', e?.city ?? '');
          if (k) jsonLocSet.add(k);
        }
      }
    }
  }

  const missingLocations = [];
  for (const [k, entry] of sheetLocCounts.entries()) {
    if (jsonLocSet.has(k)) continue;

    // Skip if this canonical location is already handled by location-aliases
    const aliasKey = makeAliasKey(entry.country, entry.region, entry.city);
    if (locationAliases.has(aliasKey)) continue;

    missingLocations.push({
      loc: fmtLocKey(entry.country, entry.region, entry.city),
      count: entry.count,
      sheetExamples: [...entry.examples]
    });
  }

  if (missingLocations.length) {
    console.log('---');
    console.log('LOCATIONS IN SHEET (AFTER location-aliases) BUT NOT IN anomalies-historical.json:');
    console.log('(Paste into location-aliases.json; values default to the sheet location so you only edit the bits you want to change.)');

    missingLocations
      .sort((a, b) => a.loc.localeCompare(b.loc))
      .forEach(m => {
        // Print one alias entry per distinct raw sheet location that contributed to this missing canonical location.
        // sheetExamples are stored as "Country|Region|City" with literal "null" when missing.
        for (const ex of m.sheetExamples) {
          const parts = String(ex).split('|');
          const country = parts[0] ?? 'null';
          const region = parts[1] ?? 'null';
          const city = parts[2] ?? 'null';

          const vCountry = country === 'null' ? 'null' : JSON.stringify(country);
          const vRegion = region === 'null' ? 'null' : JSON.stringify(region);
          const vCity = city === 'null' ? 'null' : JSON.stringify(city);

          // Key stays as the raw sheet location; value mirrors it by default.
          console.log(`  ${JSON.stringify(ex)}: { "city": ${vCity}, "region": ${vRegion}, "country": ${vCountry} },`);
        }
      });
  }
  // -------------------------------------------------------------------------

  // Keep both versions: raw (exactly as in the sheet) and aliased (canonicalised for matching)
  // Aliased row is used ONLY for matching; missingEvents should remain based on raw.
  const sheetRows = sheetRowsRaw.map(raw => {
    const aliasedLoc = applyLocationAliasToRow(raw, locationAliases);
    return {
      raw,
      aliased: {
        ...aliasedLoc,
        series: applyAnomalyAlias(aliasedLoc.series, anomalyAliases)
      }
    };
  });

  let missingInJson = 0;
  let additionsInJson = 0;
  let mismatches = 0;
  let matched = 0;

  // Removed scoreFixes collection and application
  const missingEvents = [];
  const matchedScoreDiffs = [];

  const seenJsonKeysNoType = new Set();

  // Track usage when multiple JSON events share the same no-type key
  // (e.g. multiple events for same city/date). Prevents matching every sheet row to the same JSON row.
  const usedJsonIndexByKey = new Map(); // keyNoType -> Set(index)

  // Compare sheet -> json
  for (const { raw, aliased } of sheetRows) {
    const rRaw = raw;     // exactly as in the sheet
    const r = aliased;    // used for matching against JSON

    const keyNoType = makeKeyNoType(r);
    const jHit = jsonMapNoType.get(keyNoType);

    if (!jHit) {
      missingInJson++;
      missingEvents.push(buildMissingEvent(rRaw));
      continue;
    }

    // Record that we matched this JSON location/date (ignoring type)
    seenJsonKeysNoType.add(keyNoType);

    // If there are multiple JSON entries for the same series/date/location, match each sheet row
    // to a different JSON candidate (consume matches). Prefer an exact score match first.
    const candidates = Array.isArray(jHit) ? jHit : [jHit];
    const wantType = normTypeForMatch(r.type);

    const used = usedJsonIndexByKey.get(keyNoType) ?? new Set();

    const sEnl = scoreComparable(r.enl);
    const sRes = scoreComparable(r.res);

    // Helper: is a candidate unused?
    const isUnused = (idx) => !used.has(idx);

    // 1) Prefer unused candidate with exact score match (most reliable)
    let pickIdx = candidates.findIndex((c, idx) => {
      if (!isUnused(idx)) return false;
      return scoreComparable(c.enl) === sEnl && scoreComparable(c.res) === sRes;
    });

    // 2) Else prefer unused candidate with matching type
    if (pickIdx < 0) {
      pickIdx = candidates.findIndex((c, idx) => {
        if (!isUnused(idx)) return false;
        return normKeyPart(c.type) === normKeyPart(wantType);
      });
    }

    // 3) Else just take the first unused candidate
    if (pickIdx < 0) {
      pickIdx = candidates.findIndex((c, idx) => isUnused(idx));
    }

    // 4) If everything is already used, fall back to the first candidate (will likely report mismatches)
    if (pickIdx < 0) pickIdx = 0;

    const j = candidates[pickIdx];
    used.add(pickIdx);
    usedJsonIndexByKey.set(keyNoType, used);

    // Warn if more sheet rows than JSON candidates for this key
    if (candidates.length === 1) {
      const usedNow = usedJsonIndexByKey.get(keyNoType);
      if (usedNow && usedNow.size > 1) {
        console.warn(`DUPLICATE-IN-SHEET: multiple sheet rows map to one JSON event for ${r.series} ${r.date} — ${[r.city, r.region, r.country].filter(Boolean).join(', ')}`);
      }
    } else {
      const usedNow = usedJsonIndexByKey.get(keyNoType);
      if (usedNow && usedNow.size > candidates.length) {
        console.warn(`DUPLICATE-IN-SHEET: more sheet rows than JSON events for ${r.series} ${r.date} — ${[r.city, r.region, r.country].filter(Boolean).join(', ')}`);
      }
    }

    const diffs = compare(r, j);
    if (diffs.length) {
      mismatches++;

      matchedScoreDiffs.push({
        sheetRow: r.sheetRow,
        series: r.series,
        type: normTypeForMatch(r.type),
        date: r.date,
        city: r.city || null,
        region: r.region || null,
        country: r.country,
        sheet: { enl: scoreComparable(r.enl), res: scoreComparable(r.res) },
        json: { enl: scoreComparable(j.enl), res: scoreComparable(j.res) },
        diffs
      });

    } else {
      matched++;
      if (showMatches) {
        console.log(
          `✅ ${r.sheetRow}: ${r.series} / ${r.type} / ${r.date} — ${r.city || '(no city)'} | ${r.region || '(no region)'} | ${r.country}`
        );
      }
    }
  }

  // Actionable report



  if (missingEvents.length) {
    console.log('---');
    console.log('MISSING EVENTS (present in sheet, absent from JSON):');
    missingEvents
      //.sort((a, b) => a.insertUnder.series.localeCompare(b.insertUnder.series) || a.insertUnder.date.localeCompare(b.insertUnder.date))
      .forEach(m => {
        const sheetEvent = [m.insertUnder.series, m.insertUnder.date]
        const loc = [m.event.country, m.event.region|| 'null', m.event.city|| 'null'].join('|');
        //console.log(m.insertUnder);
        console.log(`❓ ${m.sheetRow}: ${sheetEvent} - "${loc}": { "city": "${m.event.city||null}", "region": "${m.event.region||null}", "country": "${m.event.country}" },`);
        //console.log(m.event.score);
        //console.log(m.sheetRow);
      });

    console.log('---');
  }

  
  if (matchedScoreDiffs.length) {
    console.log('---');
    console.log('MATCHED BUT DIFFERENT SCORES:');
    matchedScoreDiffs
      .sort((a, b) => a.series.localeCompare(b.series) || a.date.localeCompare(b.date))
      .forEach(m => {
        const loc = [m.city, m.region, m.country].filter(Boolean).join(', ');
        console.log(`🔀 ${m.sheetRow}: ${m.series} ${m.type} ${m.date} — ${loc} - json ENL=${m.json.enl} RES=${m.json.res} should be { "enl": ${m.sheet.enl}, "res": ${m.sheet.res} }`
        );
      });
  }
  // Compare json -> sheet (anything not referenced by sheet rows)
  for (const [keyNoType, jHit] of jsonMapNoType.entries()) {
    if (!seenJsonKeysNoType.has(keyNoType)) {
      const rows = Array.isArray(jHit) ? jHit : [jHit];
      for (const j of rows) {
        additionsInJson++;
        if (showAdditions) {
          console.warn(
            `🆕 ${j.series} / ${j.type} / ${j.date} — ${j.city || 'null'} | ${j.region || 'null'} | ${j.country}`
          );
        }
      }
    }
  }


  console.log('---');
  if (anomalyFilterRaw) {
    console.log(`Anomaly filter:         ${anomalyFilterRaw}`);
  }
  console.log(`Sheet rows read:        ${sheetRows.length}`);
  console.log(`JSON events indexed:    ${jsonMapNoType.size}`);
  console.log(`Matched:                ${matched}`);
  console.log(`Score mismatches:       ${mismatches}`);
  console.log(`Missing in JSON:        ${missingInJson}`);
  console.log(`Aditions in JSON        ${additionsInJson}`);
  console.log(`Mode:                   ${strict ? 'STRICT' : 'LOOSE (case-insensitive)'} key matching`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});