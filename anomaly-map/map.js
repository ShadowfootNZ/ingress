/**
 * Ingress Anomaly History Map
 * Data sourced from: https://linktr.ee/ingressanomalystats
 * Data originally collated by Breezy: https://linktr.ee/breenzy
 */
async function loadAnomalies() {
  const resp = await fetch('./data/anomalies.json');
  if (!resp.ok) {
    console.error('Failed to load anomalies.json:', resp.status);
    return [];
  }
  return resp.json();
}

(async function draw() {
  // Debug panel
  const debugPanel = document.createElement('div');
  debugPanel.id = 'debug-panel';
  debugPanel.innerHTML = `
    <span id="debug-close">×</span>
    <strong>Debug Panel</strong>
    <ul id="debug-list"></ul>
    <div id="count"></div>
  `;
  document.body.appendChild(debugPanel);

  document.getElementById('debug-close').addEventListener('click', () => {
    debugPanel.remove();
  });

  const debugList = document.getElementById('debug-list');
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

  const map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 12,
  }).addTo(map);

  // Colours
  const colour = {
    enl: '#28f428',
    res: '#00c4ff',
    tie: '#14DC94',
  };

  // Radius based on recency
  function radiusForDate(dateStr) {
    const event = new Date(dateStr).getTime();
    const now = Date.now();
    const diff = (now - event) / (1000 * 60 * 60 * 24); // days ago

    if (diff < 365) return 18;
    if (diff < 730) return 14;
    if (diff < 1095) return 10;
    return 6;
  }

  // Colour for win/loss
  function resultColour(enl, res) {
    if (enl === res) return colour.tie;
    const scale = Math.min(Math.abs(enl - res) / 300, 1);
    return enl > res
      ? `rgba(40,244,40,${0.3 + 0.7 * scale})`
      : `rgba(0,196,255,${0.3 + 0.7 * scale})`;
  }

  // Group anomalies by location
  const grouped = anomalies.reduce((acc, a) => {
    if (!a.location?.lat || !a.location?.lng) return acc;
    const key = `${a.city}, ${a.country}`;
    acc[key] = acc[key] || [];
    acc[key].push(a);
    return acc;
  }, {});

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

      const options = {
        radius: rad,
        fillColor: resultColour(enl, res),
        fillOpacity: 0.7,
        color: resultColour(enl, res),
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
              ${evt.date}<br>
              ${
                (() => {
                  const enlScore = evt.score?.enl ?? '-';
                  const resScore = evt.score?.res ?? '-';
                  const isTie = enlScore === resScore;
                  
                  const enlMarkup = isTie
                    ? `<strong>ENL: ${enlScore}</strong>`
                    : enlScore > resScore
                      ? `<strong>ENL: ${enlScore}</strong>`
                      : `ENL: ${enlScore}`;
                  
                  const resMarkup = isTie
                    ? `<strong>RES: ${resScore}</strong>`
                    : resScore > enlScore
                      ? `<strong>RES: ${resScore}</strong>`
                      : `RES: ${resScore}`;
                  
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

    debugList.insertAdjacentHTML(
      'beforeend',
      `<li>Processed: ${city}, ${country} — ${events.length} events</li>`
    );
  });

  document.getElementById('count').textContent = `Mapped anomalies: ${placedCount}`;
})();