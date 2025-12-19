/***************************************************************
 * Ingress Anomaly History Map
 * Data sourced from: https://linktr.ee/ingressanomalystats
 * Data originally collated by Breezy: https://linktr.ee/breenzy
 ***************************************************************/
function logDebug(msg) {
  const panel = document.getElementById('debug-output');
  if (!panel) return;
  const line = document.createElement('div');
  line.textContent = msg;
  while (panel.children.length > 50) {
    panel.removeChild(panel.firstChild);
  }
  panel.appendChild(line);
}
function isUpcoming(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  return d > today;  // future = upcoming
}
function formatPlace(city, region, country) {
  // If city, region, and/or country are identical → just show one
  const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
  // Normalise null/undefined/empty and also literal "undefined"/"null" strings
  const normalize = (v) => {
    if (v === undefined || v === null) return '';
    const s = String(v).trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    if (lower === 'undefined' || lower === 'null') return '';
    return s;
  };

  // Normalise null/undefined/empty
  let cityPart = normalize(city);
  let regionPart = normalize(region);
  let countryPart = normalize(country);

  // Build ordered parts, skipping empties
  if (eq(cityPart, regionPart)) cityPart = ''; // If city and region are identical → drop city
  if (eq(cityPart, countryPart)) cityPart = ''; // If city and country are identical → drop city
  if (eq(regionPart, countryPart)) regionPart = ''; // If region and country are identical → drop region
  // Build ordered parts, skipping empties
  const parts = [cityPart, regionPart, countryPart].filter(Boolean);
  return `<strong><u>${parts.join(', ')}</u></strong>`;
}

function placeLabel(city, region, country) {
  // Pick a single label: city → region → country.
  const normalize = (v) => {
    if (v === undefined || v === null) return '';
    const s = String(v).trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    if (lower === 'undefined' || lower === 'null') return '';
    return s;
  };

  return normalize(city) || normalize(region) || normalize(country) || '';
}
async function loadAnomalies() {
  const resp = await fetch('./data/anomalies-historical.json');
  if (!resp.ok) {
    console.error('Failed to load anomalies-historical.json:', resp.status);
    return [];
  }

  const grouped = await resp.json();

  if (!Array.isArray(grouped)) {
    console.error('Unexpected anomalies-historical.json format: expected an array of series objects');
    return [];
  }

  const flat = [];

  grouped.forEach(seriesEntry => {
    if (!seriesEntry || !seriesEntry.series || !Array.isArray(seriesEntry.types)) return;
    const seriesName = seriesEntry.series;

    seriesEntry.types.forEach(typeEntry => {
      if (!typeEntry || !typeEntry.type || !Array.isArray(typeEntry.dates)) return;
      const typeName = typeEntry.type;

      typeEntry.dates.forEach(dateEntry => {
        if (!dateEntry || !dateEntry.date || !Array.isArray(dateEntry.events)) return;
        const dateStr = dateEntry.date;

        dateEntry.events.forEach(evt => {
          if (!evt) return;
          flat.push({
            series: seriesName,
            type: typeName,
            date: dateStr,
            ...evt,
          });
        });
      });
    });
  });

  return flat;
}

(async function draw() {
  async function loadBuildMeta() {
    try {
      const res = await fetch('./data/build-meta.json', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
  
  const buildFooter = document.getElementById('build-footer');
  const meta = await loadBuildMeta();
  if (buildFooter && meta) {
    // Adjust these field names to match your build-meta.json
    const build = meta.build ?? meta.commit ?? 'unknown';
    const dataUpdated = meta.dataMtime ?? meta.dataUpdated ?? '';
    buildFooter.innerHTML = `
      <div><span class="muted">Build:</span> ${build}</div>
      ${dataUpdated ? `<div><span class="muted">Data:</span> ${dataUpdated}</div>` : ''}
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

  // Debug toggle logic
  const debugToggle = document.getElementById('debug-toggle');
  const debugOutput = document.getElementById('debug-output');
  if (debugToggle && debugOutput) {
    debugToggle.addEventListener('click', () => {
      if (debugOutput.style.display === 'none') {
        debugOutput.style.display = 'block';
        debugToggle.textContent = 'Hide loaded details';
      } else {
        debugOutput.style.display = 'none';
        debugToggle.textContent = 'Show loaded details';
      }
    });
  }

  let placedCount = 0;

  const anomalies = await loadAnomalies();
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
      // return a very desaturated / greyish teal for ties
      return 'rgba(105, 188, 160, 1)';  // muted, low‑saturation teal-grey
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
  function adjustStrokeBrightness(hex, factor) {
    const m = hex.match(/#(..)(..)(..)/);
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
  
    const nr = Math.min(255, Math.round(r * factor));
    const ng = Math.min(255, Math.round(g * factor));
    const nb = Math.min(255, Math.round(b * factor));
  
    return `rgb(${nr},${ng},${nb})`;
  }

  const seriesSet = new Set();
  const seriesTypeMap = {};
  const countrySet = new Set();
  const norm = (v) => {
    if (v == null) return '';
    const s = String(v).trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    if (lower === 'undefined' || lower === 'null' || lower === 'n/a') return '';
    return s;
  };

  anomalies.forEach(a => {
    if (!a.series || !a.type) return;
    if (!a.location || a.location.lat == null || a.location.lng == null) return;

    const key = `${a.series} (${a.type})`;
    seriesSet.add(key);
    seriesTypeMap[key] = a.type;

    const c = norm(a.country);
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

    const typeForSeries = seriesTypeMap[s] || '';
    seriesSel.insertAdjacentHTML(
      'beforeend',
      `<option value="${s}" data-type="${typeForSeries}">${label}</option>`
    );
  });
  // Populate country filter
  if (countrySel) {
    const countries = [...countrySet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    countries.forEach(c => {
      countrySel.insertAdjacentHTML('beforeend', `<option value="${c}">${c}</option>`);
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
    // 1 degreet latitude ~ 111,320 m
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
      if (!a.location?.lat || !a.location?.lng) return;
      const key = locationKey(a.location.lat, a.location.lng);
      grouped[key] = grouped[key] || [];
      grouped[key].push(a);
    });
    placedCount = 0;

    // Loop through grouped entries
    Object.entries(grouped).forEach(([key, events]) => {
      const { lat, lng } = events[0].location;
      const label = placeLabel(events[0].city, events[0].region, events[0].country);

      // Sort events by date (oldest → newest)
      events.sort((a, b) => new Date(a.date) - new Date(b.date));

      events.forEach((a, index) => {
        const enl = parseInt(a.score?.enl ?? 0);
        const res = parseInt(a.score?.res ?? 0);
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
      
      winnerColour = adjustStrokeBrightness(winnerColour, strokeBrightness);
      
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
        weight: 2,
      };

        const circle = L.circleMarker([lat, lng], options);

        // Only bind popup to the newest event
        if (index === events.length - 1) {
          const popupContent = `<strong><u>${label}</u></strong><br>
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
                ${(() => {
                  if (isUpcoming(evt.date)) {
                    const today = new Date();
                    const eventDate = new Date(evt.date);
                    const diffMs = eventDate - today;
                    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                    const countdownUrl = '../countdown/';
                    return `<span class="upcoming-text"><a href="${countdownUrl}">In ${diffDays} days</a></span>`;
                  }
                
                  // Historical event — show ENL/RES scores
                  const enlScoreRaw = evt.score?.enl;
                  const resScoreRaw = evt.score?.res;

                  // Treat 0 as valid. Only show ? when missing or not a number.
                  const enlScore = Number(enlScoreRaw);
                  const resScore = Number(resScoreRaw);

                  if (enlScoreRaw == null || resScoreRaw == null || Number.isNaN(enlScore) || Number.isNaN(resScore)) {
                    return 'ENL: ? — RES: ?';
                  }
                  const isTie = enlScore === resScore;
                
                  const enlMarkup = isTie
                  ? `<span class="enl-text">ENL: ${enlScore}</span>`
                  : enlScore > resScore
                    ? `<span class="enl-text"><strong>ENL: ${enlScore}</strong></span>`
                    : `<span>ENL: ${enlScore}</span>`;
                
                const resMarkup = isTie
                  ? `<span class="res-text">RES: ${resScore}</span>`
                  : resScore > enlScore
                    ? `<span class="res-text"><strong>RES: ${resScore}</strong></span>`
                    : `<span>RES: ${resScore}</span>`;
                
                  return `${enlMarkup} — ${resMarkup}`;
                })()}<br>
                ${
                  evt.info && evt.info.trim()
                    ? `<div class="evt-info">${evt.info.trim()}</div>`
                    : ''
                }
                <br>
              </div>
            `
              )
              .join('')}
          `;
          circle.bindPopup(popupContent);
        }

        circle.addTo(markerLayer);
        placedCount++;
      });

      logDebug(`Grouped: ${label}`);
    });

    logDebug(`Mapped: ${placedCount}`);
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

      const c = norm(a.country);
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