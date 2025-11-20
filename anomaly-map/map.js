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

async function loadAnomalies() {
  const resp = await fetch('./data/anomalies.json');
  if (!resp.ok) {
    console.error('Failed to load anomalies.json:', resp.status);
    return [];
  }
  return resp.json();
}

(async function draw() {
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

  if (!anomalies.length) {
    console.error('No anomalies found in anomalies.json');
    const msg = document.createElement('div');
    msg.className = 'map-error';
    msg.textContent = 'No anomaly data available.';
    const mapEl = document.getElementById('map');
    mapEl.appendChild(msg);
    return;
  }

  const map = L.map('map').setView([20, 0], 3);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 12,
  }).addTo(map);

  const cssVars = getComputedStyle(document.documentElement);
  const colour = {
    enl: cssVars.getPropertyValue('--enl-green').trim(),
    res: cssVars.getPropertyValue('--res-blue').trim(),
    tie: cssVars.getPropertyValue('--tie-teal').trim(),
  };

  // Radius based on recency
  function radiusForDate(dateStr) {
    const event = new Date(dateStr).getTime();
    const now = Date.now();
    const diff = (now - event) / (1000 * 60 * 60 * 24); // days ago
  
    if (diff < 365) return 20;    // last year
    if (diff < 730) return 16;    // 1-2 years
    if (diff < 1460) return 11;   // 2-4 years
    if (diff < 2920) return 8;    // 4-8 years
    if (diff < 4380) return 6;    // 8-12 years
    return 4;                     // older than 12 years
  }
  
  function mixColours(c1, c2, t) {
    const parse = (c) => {
      const m = c.match(/#(..)(..)(..)/);
      return {
        r: parseInt(m[1], 16),
        g: parseInt(m[2], 16),
        b: parseInt(m[3], 16),
      };
    };
  
    const a = parse(c1);
    const b = parse(c2);
  
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const b2 = Math.round(a.b + (b.b - a.b) * t);
  
    return `rgb(${r},${g},${b2})`;
  }
  function resultColour(enl, res) {
    const total = enl + res;
  
    // tie → neutral teal
    if (total === 0 || enl === res) {
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

  anomalies.forEach(a => {
    if (a.series) seriesSet.add(a.series);
  });

  const seriesSel = document.getElementById('series-filter');
  /* Build a map: series → list of years */
  const seriesYears = {};
  anomalies.forEach(a => {
    if (!a.series) return;
    const ts = new Date(a.date).getTime();
    if (!seriesYears[a.series]) seriesYears[a.series] = [];
    seriesYears[a.series].push(ts);
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
      label = `${s} (${years[0]})`;
    } else if (years.length > 1) {
      const first = years[0];
      const last = years[years.length - 1];
      label = `${s} (${first}–${last})`;
    }

    seriesSel.insertAdjacentHTML(
      'beforeend',
      `<option value="${s}">${label}</option>`
    );
  });

  const grouped = {};

  function renderMap() {
    Object.keys(grouped).forEach(k => delete grouped[k]);
    anomalies.forEach(a => {
      if (!a._visible) return;
      if (!a.location?.lat || !a.location?.lng) return;
      const key = `${a.city}, ${a.country}`;
      grouped[key] = grouped[key] || [];
      grouped[key].push(a);
    });
    // Clear existing layers
    map.eachLayer(l => {
      if (l instanceof L.CircleMarker) map.removeLayer(l);
    });
    placedCount = 0;

    // Loop through grouped entries
    Object.entries(grouped).forEach(([key, events]) => {
      const [city, country] = key.split(', ');
      const { lat, lng } = events[0].location;

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
      const ratio = Math.abs(enl - res) / (enl + res);
      const strokeBrightness = 0.5 + ratio * 0.5;  // 0.5 → 1.0
      
      winnerColour = adjustStrokeBrightness(winnerColour, strokeBrightness);
      
      const options = {
        radius: rad,
        fillColor: resultColour(enl, res),
        fillOpacity: 0.5,
        color: winnerColour, // outline color
        weight: 2,
      };

        const circle = L.circleMarker([lat, lng], options);

        // Only bind popup to the newest event
        if (index === events.length - 1) {
          const popupContent = `
            <strong>${city}, ${country}</strong><br>
            ${events
              .map(
                (evt) => `
              <div>
                <strong>${evt.series}</strong><br>
                ${new Date(evt.date).toLocaleDateString()}<br>
                ${
                  (() => {
                    const enlScore = evt.score?.enl ?? '-';
                    const resScore = evt.score?.res ?? '-';
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
                  })()
                }<br><br>
              </div>
            `
              )
              .join('')}
          `;
          circle.bindPopup(popupContent);
        }

        circle.addTo(map);
        placedCount++;
      });

      logDebug(`Grouped: ${city}, ${country}`);
    });

    logDebug(`Mapped: ${placedCount}`);
  }

  // Preselect the series of the most recent event
  let newest = null;

  anomalies.forEach(a => {
    const d = new Date(a.date);
    if (!newest || d > new Date(newest.date)) {
      newest = a;
    }
  });

  if (newest && newest.series) {
    [...seriesSel.options].forEach(opt => {
      opt.selected = (opt.value === newest.series);
    });
  }
  applyFilters();  // apply the new pre-selected filter immediately

  function applyFilters() {
    const selectedSeries = [...seriesSel.selectedOptions].map(opt => opt.value);

    anomalies.forEach(a => {
      a._visible = selectedSeries.length === 0 || selectedSeries.includes(a.series);
    });

    renderMap();
  }

  seriesSel.addEventListener('change', applyFilters);
})();