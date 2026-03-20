/***************************************************************
 * Ingress Anomaly History Map
 * Data sourced from: https://linktr.ee/ingressanomalystats
 * Data originally collated by Breezy: https://linktr.ee/breenzy
 ***************************************************************/
function isUpcoming(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  return d > today;  // future = upcoming
}

// Normalise text fields that may be null/undefined or stringified null/undefined.
function normText(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (lower === 'undefined' || lower === 'null') return '';
  return s;
}
// Build a stable location key for lookups in grouped.locations.
// Missing/blank values are represented as the literal string 'null'.
function locKeyPart(v) {
  if (v === undefined || v === null) return 'null';
  const s = String(v).trim();
  if (!s) return 'null';
  const lower = s.toLowerCase();
  if (lower === 'undefined' || lower === 'null') return 'null';
  return s;
}

function locKey(country, region, city) {
    return [
      country ?? '',
      region ?? '',
      city ?? ''
    ].join(', ');
  }


function placeLabel(city, region, country) {
  // Pick a single label: city → region → country.
  return normText(city) || normText(region) || normText(country) || '';
}

function showDataWarning(missing) {
  if (!missing || !missing.length) return;

  // De-dupe by key + context so the list is useful.
  const seen = new Set();
  const items = [];
  for (const m of missing) {
    const id = `${m.key}__${m.series}__${m.type}__${m.date}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push(m);
  }

  const top = items.slice(0, 12);
  const more = items.length - top.length;

  // Prefer the info panel if it exists; otherwise fall back to body.
  const host = document.getElementById('info-panel') || document.body;

  const el = document.createElement('div');
  el.id = 'data-warning';
  el.style.cssText = [
    'margin: 10px 0',
    'padding: 10px 12px',
    'border: 1px solid rgba(255,255,255,0.25)',
    'border-radius: 8px',
    'background: rgba(229, 156, 10, 0.46)',
    'color: #fff',
    'font-size: 13px',
    'line-height: 1.35'
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;';

  const title = document.createElement('div');
  title.innerHTML = `<strong>Data warning:</strong> ${items.length} event(s) have no matching entry in <code>locations</code>. Those markers will be skipped.`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.title = 'Dismiss';
  closeBtn.style.cssText = [
    'cursor:pointer',
    'border:0',
    'background: transparent',
    'color:#fff',
    'font-size:18px',
    'line-height:1',
    'padding:0 4px'
  ].join(';');
  closeBtn.addEventListener('click', () => el.remove());

  header.appendChild(title);
  header.appendChild(closeBtn);
  el.appendChild(header);

  const list = document.createElement('div');
  list.style.cssText = 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; white-space: pre-wrap;';

  list.textContent = top
    .map(m => `${m.key}  ←  ${m.series} / ${m.type} / ${m.date}`)
    .join('\n');

  if (more > 0) {
    const tail = document.createElement('div');
    tail.style.cssText = 'margin-top:6px;opacity:0.9;';
    tail.textContent = `... plus ${more} more. See console for full list.`;
    el.appendChild(list);
    el.appendChild(tail);
  } else {
    el.appendChild(list);
  }

  // Avoid duplicating if reload occurs.
  const existing = document.getElementById('data-warning');
  if (existing) existing.remove();

  // Insert near the top of the panel.
  if (host === document.body) {
    el.style.cssText += ';position:fixed;top:10px;left:10px;right:10px;z-index:9999;max-width:820px;';
    document.body.appendChild(el);
  } else {
    host.insertBefore(el, host.firstChild);
  }
}
async function loadAnomalies(meta) {
  const buildParam = meta?.data_mtime ? `?build=${encodeURIComponent(meta.data_mtime)}` : '';
  const resp = await fetch(`./data/anomalies-historical.json?${buildParam}`);
  if (!resp.ok) {
    console.error('Failed to load anomalies-historical.json:', resp.status);
    return { flat: [], countries: {} };
  }

  const grouped = await resp.json();

  // New format: { organizeBy: 'series', series: { [seriesName]: { [typeName]: { [dateStr]: events[] } } } }
  if (!grouped || typeof grouped !== 'object' || typeof grouped.series !== 'object') {
    console.error('Unexpected anomalies-historical.json format: expected { series: { ... } }');
    return { flat: [], countries: {} };
  }

  if (typeof grouped.locations !== 'object' || grouped.locations === null) {
    console.error('Unexpected anomalies-historical.json format: expected top-level { locations: { ... } }');
    return { flat: [], countries: {} };
  }

  const locations = grouped.locations;

  const flat = [];
  const missingLocations = [];

  const seriesObj = grouped.series;
  for (const [seriesName, typesObj] of Object.entries(seriesObj)) {
    if (!typesObj || typeof typesObj !== 'object') continue;

    for (const [typeName, datesObj] of Object.entries(typesObj)) {
      if (!datesObj || typeof datesObj !== 'object') continue;

      for (const [dateStr, events] of Object.entries(datesObj)) {
        if (!Array.isArray(events)) continue;

        events.forEach(evt => {
          if (!evt) return;
          
          const k = locKey(evt.country, evt.region, evt.city);
          const loc = locations[k];

          // If we can't locate it, keep the row but with no lat/lng so the map can skip it.
          // (This makes missing locations obvious in the console.)
          if (!loc || loc.lat == null || loc.lng == null) {
            missingLocations.push({ key: k, series: seriesName, type: typeName, date: dateStr });
          }

          flat.push({
            series: seriesName,
            type: typeName,
            date: dateStr,
            ...evt,
            location: loc && loc.lat != null && loc.lng != null ? { lat: loc.lat, lng: loc.lng } : null,
          });
        });
      }
    }
  }
  if (missingLocations.length) {
    // Console: full detail for copy/paste while you’re fixing data.
    console.warn('Data warning: events with missing locations lookup (key  ←  series / type / date):');
    missingLocations.forEach(m => {
      console.warn(`${m.key}  ←  ${m.series} / ${m.type} / ${m.date}`);
    });

    // UI: short visible banner so you notice before committing/pushing.
    showDataWarning(missingLocations);
  }

  return { flat, countries: grouped.countries || {} };
}
async function loadBuildMeta() {
  try {
    const res = await fetch('./data/build-meta.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
(async function draw() {

  const buildFooter = document.getElementById('build-footer');
  const meta = await loadBuildMeta();
  if (buildFooter) {
    const build = meta?.commit ?? meta?.build ?? 'unknown';
    const dataUpdated = meta?.data_mtime ?? meta?.dataUpdated ?? '';
    buildFooter.innerHTML = `
      <div><span class="muted">Build:</span> ${build}${dataUpdated ? ` &nbsp; <span class="muted">Data:</span> ${dataUpdated}` : ''}</div>
    `;
  }

  document.getElementById('info-minimise').addEventListener('click', () => {
    const panel = document.getElementById('info-panel');
    if (panel.classList.contains('minimised')) {
      panel.classList.remove('minimised');
      document.getElementById('info-minimise').textContent = '−';
    } else {
      panel.classList.add('minimised');
      document.getElementById('info-minimise').textContent = '+';
    }
  });

  const { flat: anomalies, countries: countriesMeta } = await loadAnomalies(meta);
  const msPerDay = 1000 * 60 * 60 * 24;
  const nowMs = Date.now();

  // Find the oldest *historical* event (<= today)
  const historicalTimes = anomalies
    .map(a => new Date(a.date).getTime())
    .filter(t => !Number.isNaN(t) && t <= nowMs);

  // Fallback: if everything is in the future, pretend the range is 1 year
  const oldestMs = historicalTimes.length
    ? Math.min(...historicalTimes)
    : nowMs - 365 * msPerDay;

  const maxAgeDays = Math.max(1, (nowMs - oldestMs) / msPerDay); // avoid divide by 0

  if (!anomalies.length) {
    console.error('No anomalies found in anomalies-historical.json');
    const msg = document.createElement('div');
    msg.className = 'map-error';
    msg.textContent = 'No anomaly data available.';
    const mapEl = document.getElementById('map');
    mapEl.appendChild(msg);
    return;
  }

  const map = L.map('map', {
    zoomControl: false
  }).setView([20, 0], 3);
  
  L.control.zoom({
    position: 'topright'   // ← moves the zoom buttons
  }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 12,
  }).addTo(map);
  // All rendered circle markers live here, so we can fit bounds to the current selection
  // (FeatureGroup supports getBounds())
  const markerLayer = L.featureGroup().addTo(map);

  const cssVars = getComputedStyle(document.documentElement);
  const colour = {
    enl: cssVars.getPropertyValue('--enl-green').trim(),
    res: cssVars.getPropertyValue('--res-blue').trim(),
    tie: cssVars.getPropertyValue('--tie-teal').trim(),
    upcoming: cssVars.getPropertyValue('--upcoming').trim(), 
    
  };

  // Radius based on recency
  function radiusForDate(dateStr) {
    const t = new Date(dateStr).getTime();
    if (Number.isNaN(t)) return 8; // fallback radius

    // Future events → always max radius
    if (t > nowMs) return 20;

    const ageDays = (nowMs - t) / msPerDay;

    // 0 = today (youngest), 1 = oldest historical event
    let norm = ageDays / maxAgeDays;
    norm = Math.min(Math.max(norm, 0), 1); // clamp 0–1

    const minR = 4;
    const maxR = 20;

    // oldest → minR, newest → maxR
    return maxR - norm * (maxR - minR);
  }
  
  function resultColour(enl, res) {
    const total = enl + res;
  
    // tie → neutral teal
    if (total === 0 || enl === res) {
      // return  teal for ties
      return colour.tie;
    }
  
    // winner’s base colour
    const base = enl > res ? colour.enl : colour.res;
  
    // ratio describes how dominant the win was (0 = close, 1 = blowout)
    const ratio = Math.abs(enl - res) / total;
  
    // compute brightness: 0.4 = darkest, 1.0 = brightest
    // close games look darker; large margins look brighter
    const brightness = 0.4 + ratio * 0.6;
  
    return adjustBrightness(base, brightness);
  }

  function adjustBrightness(hex, factor) {
    const m = hex.match(/#(..)(..)(..)/);
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
  
    const nr = Math.min(255, Math.round(r * factor));
    const ng = Math.min(255, Math.round(g * factor));
    const nb = Math.min(255, Math.round(b * factor));
  
    return `rgb(${nr},${ng},${nb})`;
  }

  function scoreProportionBar(enlScore, resScore) {
    const enl = Number(enlScore);
    const res = Number(resScore);

    if (Number.isNaN(enl) || Number.isNaN(res)) return '';

    const total = enl + res;

    // Rare case: 0/0 -> show no bar at all
    if (total <= 0) return '<br>';

    const enlPct = (enl / total) * 100;
    const resPct = 100 - enlPct;

    // Clamp for safety
    const enlW = Math.max(0, Math.min(100, enlPct));
    const resW = Math.max(0, Math.min(100, resPct));

    const enlTitle = `ENL: ${enl.toLocaleString()} (${enlW.toFixed(1)}%)`;
    const resTitle = `RES: ${res.toLocaleString()} (${resW.toFixed(1)}%)`;

    return `
      <div class="score-bar">
        ${enlW > 0 ? `<div class="score-bar-seg enl" title="${enlTitle}" style="width:${enlW}%;"></div>` : ''}
        ${resW > 0 ? `<div class="score-bar-seg res" title="${resTitle}" style="width:${resW}%;"></div>` : ''}
      </div>
    `;
  }

  const seriesSet = new Set();
  const seriesTypeMap = {};
  const countrySet = new Set();

  anomalies.forEach(a => {
    if (!a.series || !a.type) return;
    if (!a.location || a.location.lat == null || a.location.lng == null) return;

    const key = `${a.series} (${a.type})`;
    seriesSet.add(key);
    seriesTypeMap[key] = a.type;

    const c = normText(a.country);
    if (c) countrySet.add(c);
  });

  const seriesSel = document.getElementById('series-filter');
  const countrySel = document.getElementById('country-filter');
  // Auto pan/zoom toggle (default enabled)
  const autoPanZoomEl = document.getElementById('auto-pan-zoom');
  let autoPanZoomEnabled = autoPanZoomEl ? autoPanZoomEl.checked : true;

  if (autoPanZoomEl) {
    autoPanZoomEl.addEventListener('change', () => {
      autoPanZoomEnabled = autoPanZoomEl.checked;
    });
  }

  const seriesYears = {};
  anomalies.forEach(a => {
    if (!a.series || !a.type) return;
    if (!a.location || a.location.lat == null || a.location.lng == null) return;
    const key = `${a.series} (${a.type})`;
    const ts = new Date(a.date).getTime();
    if (!seriesYears[key]) seriesYears[key] = [];
    seriesYears[key].push(ts);
  });

  /* Insert series options with year or year-range */
  let lastMostRecentYear = null;

  [...seriesSet]
    .sort((a, b) => {
      const datesA = seriesYears[a] || [];
      const datesB = seriesYears[b] || [];
      const maxA = Math.max(...datesA);
      const maxB = Math.max(...datesB);
      return maxB - maxA;
    })
    .forEach(s => {
      const years = [...new Set(seriesYears[s].map(ts =>
        new Date(ts).getFullYear()
      ))].sort((a,b) => a - b);

      let label = s;

      if (years.length === 1) {
        label = `${years[0]} ${s}`;
      } else if (years.length > 1) {
        const first = years[0];
        const last = years[years.length - 1];
        label = `${s} (${first}–${last})`;
      }

      // Use the most recent year for a visual break when the year changes
      const mostRecentYear = years.length ? years[years.length - 1] : null;
      const yearBreak =
        mostRecentYear !== null &&
        lastMostRecentYear !== null &&
        mostRecentYear !== lastMostRecentYear;

      const breakAttr = yearBreak ? ' data-year-break="true"' : '';

      const typeForSeries = seriesTypeMap[s] || '';
      seriesSel.insertAdjacentHTML(
        'beforeend',
        `<option value="${s}" data-type="${typeForSeries}"${breakAttr}>${label}</option>`
      );

      if (mostRecentYear !== null) lastMostRecentYear = mostRecentYear;
    });
  // Populate country filter (display flag if present, but keep value as the plain country name)
  if (countrySel) {
    const countries = [...countrySet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    countries.forEach(c => {
      const meta = countriesMeta && typeof countriesMeta === 'object' ? countriesMeta[c] : null;
      const flag = meta && typeof meta === 'object' && meta.flag ? String(meta.flag).trim() : '';
      const label = flag ? `${flag} ${c}` : c;
      countrySel.insertAdjacentHTML('beforeend', `<option value="${c}">${label}</option>`);
    });
  }
  // Adjust height based on the number of entries (Option B)
  const optionCount = seriesSel.options.length;
  const rowHeight = 22;                   // approx height per <option>
  const maxAllowed = window.innerHeight * 0.5;
  
  const ideal = optionCount * rowHeight;
  
  seriesSel.style.height =
    Math.min(Math.max(ideal, 70), maxAllowed) + 'px';
  const grouped = {};

  function locationKey(lat, lng, metres = 5000) {
    // 1 degrees latitude ~ 111,320 m
    const latFactor = 111320;
    const lngFactor = 111320 * Math.cos(lat * Math.PI / 180);
    
    const latKey = Math.round((lat * latFactor) / metres);
    const lngKey = Math.round((lng * lngFactor) / metres);
    return `${latKey},${lngKey}`
  }

  function renderMap() {
    markerLayer.clearLayers();
    Object.keys(grouped).forEach(k => delete grouped[k]);
    anomalies.forEach(a => {
      if (!a._visible) return;
      if (!a.location || a.location.lat == null || a.location.lng == null) return;
      const key = locationKey(a.location.lat, a.location.lng);
      grouped[key] = grouped[key] || [];
      grouped[key].push(a);
    });

    // Loop through grouped entries
    Object.entries(grouped).forEach(([key, events]) => {
      const { lat, lng } = events[0].location;
      const label = placeLabel(events[0].city, events[0].region, events[0].country);

      // Sort events by date (oldest → newest)
      events.sort((a, b) => new Date(a.date) - new Date(b.date));

      events.forEach((a, index) => {
        // For styling (fill/stroke), treat missing or negative scores as 0
        const enlRaw = a.score?.enl;
        const resRaw = a.score?.res;
        const enl = Math.max(0, Number(enlRaw ?? 0));
        const res = Math.max(0, Number(resRaw ?? 0));
        const rad = radiusForDate(a.date);
        let winnerColour = enl === res
        ? colour.tie
        : enl > res
          ? colour.enl
          : colour.res;
      
      // margin-based brightness: close = darker, blowout = bright
      // Guard against enl+res = 0 (0/0 -> NaN), which breaks stroke styling for ties.
      const total = enl + res;
      const ratio = total > 0 ? Math.abs(enl - res) / total : 0;

      // Slightly stronger outline for ties/unknowns so border stays distinct
      const strokeBrightness = total > 0 ? (0.5 + ratio * 0.5) : 0.8;  // 0.5 → 1.0, ties default to 0.8
      
      winnerColour = adjustBrightness(winnerColour, strokeBrightness);
      
      let fill = resultColour(enl, res);
      let stroke = winnerColour;
      
      // override for upcoming events
      if (isUpcoming(a.date)) {
        fill = colour.upcoming;
        stroke = colour.upcoming;
      }
      
      const options = {
        radius: rad,
        fillColor: fill,
        fillOpacity: 0.45,
        color: stroke,
        weight: 2.5,
        opacity: 0.9,
      };

        const circle = L.circleMarker([lat, lng], options);

        // Only bind popup to the newest event
        if (index === events.length - 1) {
          const { lat, lng } = events[0].location;
          const intelUrl = `https://intel.ingress.com/intel?ll=${lat},${lng}`;
          const popupContent = `
                <h3><a target='intel' rel="noopener noreferrer" href="${intelUrl}">${label}</a></h3>
            ${events
              .map(
                (evt) => `
                 <div>
                ${(() => {
                  // Colour the series label by the winner, using existing .enl-text / .res-text.
                  // For upcoming, ties, or missing scores, fall back to default styling.
                  const enl = evt.score?.enl;
                  const res = evt.score?.res;

                  let cls = '';
                  if (!isUpcoming(evt.date) && enl != null && res != null) {
                    const enlNum = Number(enl);
                    const resNum = Number(res);
                    if (!Number.isNaN(enlNum) && !Number.isNaN(resNum)) {
                      if (enlNum > resNum) cls = 'enl-text';
                      else if (resNum > enlNum) cls = 'res-text';
                    }
                  }

                  return cls
                    ? `<strong class="${cls}">${evt.series} (${evt.type})</strong><br>`
                    : `<strong>${evt.series} (${evt.type})</strong><br>`;
                })()}
                ${new Date(evt.date).toLocaleDateString()}<br>
                ${(() => {
                  const city = (evt.city ?? '').toString().trim();
                  if (!city) return '';

                  const a = city.toLowerCase();
                  const b = (label ?? '').toString().trim().toLowerCase();

                  // Only show the city if it adds information beyond the popup header label
                  if (b && a === b) return '';

                  return `<span class="evt-city">${city}</span><br>`;
                })()}
                ${
                  evt.info && evt.info.trim()
                    ? `<div class="evt-info">${evt.info.trim()}</div>`
                    : ''
                }
                ${(() => {
                  if (isUpcoming(evt.date)) {
                    const today = new Date();
                    const eventDate = new Date(evt.date);
                    const diffMs = eventDate - today;
                    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                    const dayLabel = diffDays === 1 ? 'day' : 'days';
                    const countdownUrl = '../countdown/';
                    return `<span class="upcoming-text"><a href="${countdownUrl}">In ${diffDays} ${dayLabel}</a></span><br>`;
                  }

                  // Historical event — show ENL/RES scores
                  const enlScoreRaw = evt.score?.enl;
                  const resScoreRaw = evt.score?.res;

                  // Treat 0 as valid for display. Negative values should still display,
                  // but styling elsewhere clamps them to 0.
                  const enlScore = Number(enlScoreRaw);
                  const resScore = Number(resScoreRaw);

                  const enlValid = enlScoreRaw != null && !Number.isNaN(enlScore);
                  const resValid = resScoreRaw != null && !Number.isNaN(resScore);

                  if (!enlValid || !resValid) {
                    return 'ENL: ? — RES: ?';
                  }

                  const isTie = enlScore === resScore;

                  const enlMarkup = isTie
                    ? `<span class="enl-text">ENL: ${enlScore.toLocaleString()}</span>`
                    : enlScore > resScore
                      ? `<span class="enl-text"><strong>ENL: ${enlScore.toLocaleString()}</strong></span>`
                      : `<span>ENL: ${enlScore.toLocaleString()}</span>`;

                  const resMarkup = isTie
                    ? `<span class="res-text">RES: ${resScore.toLocaleString()}</span>`
                    : resScore > enlScore
                      ? `<span class="res-text"><strong>RES: ${resScore.toLocaleString()}</strong></span>`
                      : `<span>RES: ${resScore.toLocaleString()}</span>`;

                  const bar = scoreProportionBar(enlScore, resScore);
                  return `${enlMarkup} — ${resMarkup}${bar}`;
                })()}<br>
              </div>
            `
              )
              .join('')}
          `;
          circle.bindPopup(popupContent);
        }

        circle.addTo(markerLayer);
      });

    });
  }
  function zoomToSelection() {
    const bounds = markerLayer.getBounds();
    if (!bounds || !bounds.isValid()) return;
  
    map.fitBounds(bounds.pad(0.12), {
      maxZoom: 6,
      animate: true,
    });
  }

  // Preselect the series of the most recent *historical* event
  let newest = null;
  anomalies.forEach(a => {
    if (isUpcoming(a.date)) return; // skip future events
    if (!newest || new Date(a.date) > new Date(newest.date)) {
      newest = a;
    }
  });

  if (newest && newest.series && newest.type) {
    const key = `${newest.series} (${newest.type})`;
    [...seriesSel.options].forEach(opt => {
      opt.selected = (opt.value === key);
    });
  }
  applyFilters();  // apply the new pre-selected filter immediately

  function applyFilters() {
    const selectedSeries = [...seriesSel.selectedOptions].map(opt => opt.value);
    const selectedCountries = countrySel
      ? [...countrySel.selectedOptions].map(opt => opt.value)
      : [];

    anomalies.forEach(a => {
      const key = `${a.series} (${a.type})`;
      const passSeries = selectedSeries.length === 0 || selectedSeries.includes(key);

      const c = normText(a.country);
      const passCountry = selectedCountries.length === 0 || (c && selectedCountries.includes(c));

      a._visible = passSeries && passCountry;
    });

    renderMap();
    if (autoPanZoomEnabled) zoomToSelection();
  }
  const selectAnomalyBtn = document.getElementById('select-anomaly-series');
  if (selectAnomalyBtn) {
    selectAnomalyBtn.addEventListener('click', () => {
      [...seriesSel.options].forEach(opt => {
        const t = (opt.getAttribute('data-type') || '').toLowerCase();
        opt.selected = (t === 'anomaly');
      });
      applyFilters();
    });
  }
  const resetSeriesBtn = document.getElementById('reset-anomaly-series');
  if (resetSeriesBtn && seriesSel) {
    resetSeriesBtn.addEventListener('click', () => {
      // Clear all selections so the filter is effectively "all series"
      [...seriesSel.options].forEach(opt => { opt.selected = false; });
      applyFilters();
    });
  }

  const resetCountriesBtn = document.getElementById('select-countries');
  if (resetCountriesBtn && countrySel) {
    resetCountriesBtn.addEventListener('click', () => {
      // Clear all selections so the filter is effectively "all countries"
      [...countrySel.options].forEach(opt => { opt.selected = false; });
      applyFilters();
    });
  }

  if (countrySel) {
    countrySel.addEventListener('change', applyFilters);
  }

  seriesSel.addEventListener('change', applyFilters);
})();