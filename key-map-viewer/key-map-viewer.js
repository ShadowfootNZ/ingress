let map = null;
let markers = [];
let lastParsedKeys = [];

const STORAGE_KEY = 'ingressKeyData';

function showStatus(message) {
  const el = document.getElementById('status');
  if (!el) return;

  const textEl = el.querySelector('.status-text');
  if (textEl) {
    textEl.textContent = message;
  } else {
    // Fallback if the markup is still the old single-div version
    el.textContent = message;
  }

  el.style.display = 'flex';
}

function hideStatus() {
  const el = document.getElementById('status');
  if (!el) return;

  el.style.display = 'none';

  const textEl = el.querySelector('.status-text');
  if (textEl) {
    textEl.textContent = '';
  } else {
    // Fallback
    el.textContent = '';
  }
}

function saveKeyDataToStorage(text) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // Ignore storage failures (private browsing, quota, etc.)
  }
}

function loadKeyDataFromStorage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearKeyDataFromStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

function startup() {
  const saved = loadKeyDataFromStorage();
  if (saved && saved.trim()) {
    const ta = document.getElementById('keyData');
    if (ta) ta.value = saved;

    // Build the map from saved data BEFORE initialising the map separately,
    // so there’s no “jump” from the default view.
    loadKeys({ restoring: true, skipSave: true });
    showStatus('Restored previous session from local storage. No data is stored on a server.');
  } else {
    initMap();
  }

  // Intel Inventory often copies as rich text (HTML) where the portal names are links,
  // but the plain-text paste drops the hrefs. Convert HTML -> markdown links on paste.
  const ta = document.getElementById('keyData');
  if (ta) {
    ta.addEventListener('paste', (e) => {
      const html = e.clipboardData?.getData?.('text/html');
      if (!html) return;

      // If the plain text already has markdown links, leave it alone.
      const plain = e.clipboardData?.getData?.('text/plain') || '';
      if (/\[[^\]]+\]\(https?:\/\/intel\.ingress\.com\/intel\?/i.test(plain)) return;

      let converted = '';

      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Preferred: Intel copies as a table with rows [Portal, Count, Capsule]
        const rows = Array.from(doc.querySelectorAll('tr'));
        const items = [];

        for (const tr of rows) {
          const tds = Array.from(tr.querySelectorAll('td'));
          if (tds.length < 2) continue;

          const a = tds[0].querySelector('a[href*="intel.ingress.com/intel"]');
          if (!a) continue;

          const name = (a.textContent || '').trim();
          const url = (a.getAttribute('href') || '').trim();
          if (!name || !url) continue;

          const countText = (tds[1]?.textContent || '').trim();
          const capsuleText = (tds[2]?.textContent || '').trim();

          const count = (/x\d+/i.exec(countText)?.[0] || 'x1');
          const capsule = capsuleText ? capsuleText : 'None';

          items.push({ name, url, count, capsule });
        }

        if (items.length) {
          converted += 'Portal Keys\nCount\nCapsule\n\n';
          for (const it of items) {
            converted += `[${it.name}](${it.url})\n${it.count}\n${it.capsule}\n\n`;
          }
        } else {
          // Fallback: Intel sometimes provides links only in HTML, while count/capsule are only in plain text.
          // Build items from the plain-text structure, then attach URLs from the HTML anchors.
          const plainLines = plain
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);

          const plainItems = [];
          let inSection = false;

          for (let i = 0; i < plainLines.length; i++) {
            const line = plainLines[i];

            if (line === 'Portal Keys') {
              inSection = true;
              continue;
            }
            if (!inSection) continue;

            if (line === 'Count' || line === 'Capsule' || line === '* * *' || line === 'Items') {
              continue;
            }

            // Portal name line
            const name = line;

            // Next non-empty line might be xN
            const countLine = plainLines[i + 1] || '';
            let count = 'x1';
            if (/^x\d+$/i.test(countLine)) {
              count = countLine;
              i++;
            }

            // Next non-empty line might be capsule name (or None)
            const capsuleLine = plainLines[i + 1] || '';
            let capsule = 'None';
            if (capsuleLine && !capsuleLine.startsWith('[') && !/^x\d+$/i.test(capsuleLine)) {
              capsule = capsuleLine;
              i++;
            }

            plainItems.push({ name, count, capsule, url: '' });
          }

          // Pull anchors from HTML in document order
          const anchors = Array.from(
            doc.querySelectorAll('a[href*="intel.ingress.com/intel"]')
          ).map((a) => ({
            name: (a.textContent || '').trim(),
            url: (a.getAttribute('href') || '').trim(),
          })).filter((a) => a.name && a.url);

          // Attach URLs by exact name match first, then by sequence
          const used = new Set();
          for (const item of plainItems) {
            const idx = anchors.findIndex((a, j) => !used.has(j) && a.name === item.name);
            if (idx >= 0) {
              item.url = anchors[idx].url;
              used.add(idx);
            }
          }

          let seq = 0;
          for (const item of plainItems) {
            if (item.url) continue;
            while (seq < anchors.length && used.has(seq)) seq++;
            if (seq < anchors.length) {
              item.url = anchors[seq].url;
              used.add(seq);
              seq++;
            }
          }

          if (plainItems.length) {
            converted += 'Portal Keys\nCount\nCapsule\n\n';
            for (const it of plainItems) {
              if (it.url) {
                converted += `[${it.name}](${it.url})\n${it.count}\n${it.capsule}\n\n`;
              } else {
                // If we couldn't find a URL, keep the record anyway (it just won't map)
                converted += `${it.name}\n${it.count}\n${it.capsule}\n\n`;
              }
            }
          }
        }
      } catch {
        return; // let default paste happen
      }

      if (!converted) return;

      e.preventDefault();

      // Insert at cursor position in the textarea
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);

      ta.value = before + converted + after;

      const newPos = (before + converted).length;
      ta.selectionStart = ta.selectionEnd = newPos;
    });
  }
}

function initMap() {
  if (!map) {
    map = L.map('map').setView([0, 0], 3);

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
          '&copy; <a href="https://carto.com/attributions">CARTO</a>',
      }
    ).addTo(map);
  }
}

function parseKeyData(text) {
  const lines = text.trim().split('\n');
  const keys = [];

  let currentKey = null;
  let inKeysSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;

    if (line === 'Portal Keys') {
      inKeysSection = true;
      continue;
    }

    if (
      line === 'Count' ||
      line === 'Capsule' ||
      line === '* * *' ||
      line === 'Items'
    ) {
      continue;
    }

    if (!inKeysSection) continue;

    const portalMatch = line.match(
      /\[(.+?)\]\(https:\/\/intel\.ingress\.com\/intel\?.*?pll=([^,]+),([^)]+)\)/
    );

    if (portalMatch) {
      if (currentKey) keys.push(currentKey);

      currentKey = {
        name: portalMatch[1],
        lat: parseFloat(portalMatch[2]),
        lng: parseFloat(portalMatch[3]),
        count: 1,
        capsule: 'None',
      };
    } else if (line.startsWith('x')) {
      const countMatch = line.match(/x(\d+)/);
      if (countMatch && currentKey) {
        currentKey.count = parseInt(countMatch[1], 10);
      }
    } else if (currentKey && !line.startsWith('[')) {
      currentKey.capsule = line;
    }
  }

  if (currentKey) keys.push(currentKey);

  return keys;
}

function createMarker(key) {
  const size = key.count > 1 ? 12 : 10;

  const level = Math.min(Math.max(key.count, 1), 8); // 1..8 (cap at 8+)
  const levelClass = `lvl-${level}`;

  const icon = L.divIcon({
    className: 'custom-marker',
    html: `<div class="key-marker ${levelClass}" style="width: ${size}px; height: ${size}px;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });

  const popup = `
    <div class="popup-title"><a href="https://intel.ingress.com/intel?z=15&pll=${key.lat},${key.lng}"
    target="_blank" rel="noopener noreferrer">${escapeHtml(key.name)}</a></div>
    <div class="popup-info">
      <strong>Keys:</strong> <span class="key-count lvl-${level}">${key.count}</span><br>
      <strong>Capsule:</strong> ${escapeHtml(key.capsule)}<br>
    </div>
  `;

  return L.marker([key.lat, key.lng], { icon }).bindPopup(popup);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getSelectedFilter() {
  const el = document.querySelector('input[name="keyFilter"]:checked');
  return el ? el.value : 'all';
}

function applyFilter(keys, filter) {
  if (filter === 'capsules') {
    return keys.filter((k) => k.capsule !== 'None');
  }
  if (filter === 'inventory') {
    return keys.filter((k) => k.capsule === 'None');
  }
  return keys; // all
}

function renderKeys(keys) {
  markers.forEach((marker) => marker.remove());
  markers = [];

  initMap();

  keys.forEach((key) => {
    if (!isNaN(key.lat) && !isNaN(key.lng)) {
      const marker = createMarker(key);
      marker.addTo(map);
      markers.push(marker);
    }
  });

  if (markers.length > 0) {
    const group = L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.1));
  }
}

function updateStats(keys) {
  const totalKeys = keys.reduce((sum, key) => sum + key.count, 0);
  const inCapsules = keys
    .filter((key) => key.capsule !== 'None')
    .reduce((sum, key) => sum + key.count, 0);
  const uniquePortals = new Set(keys.map((key) => key.name)).size;
  const filter = getSelectedFilter();
  const inCapsulesItem = document
    .getElementById('inCapsules')
    ?.closest('.stat-item');
  
  if (inCapsulesItem) {
    inCapsulesItem.style.display = filter === 'all' ? 'flex' : 'none';
  }
  document.getElementById('totalKeys').textContent = totalKeys;
  document.getElementById('uniquePortals').textContent = uniquePortals;
  document.getElementById('inCapsules').textContent = inCapsules;
  document.getElementById('stats').style.display = 'flex';
}

function loadKeys(options = {}) {
  const input = document.getElementById('keyData').value;
  const errorEl = document.getElementById('error');

  errorEl.style.display = 'none';

  if (!input.trim()) {
    errorEl.textContent = 'Please paste your key data first';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const keys = parseKeyData(input);
    lastParsedKeys = keys;

    if (keys.length === 0) {
      errorEl.textContent =
        'No valid keys found. Please check your data format.';
      errorEl.style.display = 'block';
      return;
    }

    const filter = getSelectedFilter();
    const filteredKeys = applyFilter(keys, filter);

    renderKeys(filteredKeys);
    updateStats(filteredKeys);
    document.getElementById('clearBtn').disabled = false;
    const ta = document.getElementById('keyData');
    if (ta) ta.classList.add('compact');

    document.body.classList.add('loaded');

    if (!options.skipSave) {
      saveKeyDataToStorage(input);
    }

    // If the user is loading fresh data (not restoring), hide any prior status.
    if (!options.restoring) {
      hideStatus();
    }

    const filter2 = getSelectedFilter();
    const filteredKeys2 = applyFilter(lastParsedKeys, filter2);

    console.log(
      `Loaded ${filteredKeys2.length} portals with ${totalKeys(filteredKeys2)} total keys (${filter2})`
    );
  } catch (err) {
    console.error('Error parsing keys:', err);
    errorEl.textContent = `Error parsing data: ${err.message}`;
    errorEl.style.display = 'block';
  }
}

function clearMap() {
  markers.forEach((marker) => marker.remove());
  markers = [];

  document.getElementById('keyData').value = '';
  lastParsedKeys = [];
  const allRadio = document.querySelector('input[name="keyFilter"][value="all"]');
  if (allRadio) allRadio.checked = true;
  const ta = document.getElementById('keyData');
  if (ta) ta.classList.remove('compact');

  document.body.classList.remove('loaded');

  clearKeyDataFromStorage();
  hideStatus();
  document.getElementById('stats').style.display = 'none';
  document.getElementById('clearBtn').disabled = true;

  if (map) {
    map.setView([0, 0], 3);
  }
}

function totalKeys(keys) {
  return keys.reduce((sum, key) => sum + key.count, 0);
}

document.addEventListener('click', (e) => {
  const btn = e.target?.closest?.('.status-close');
  if (btn) hideStatus();
});

document.addEventListener('change', (e) => {
  const radio = e.target;
  if (radio && radio.matches && radio.matches('input[name="keyFilter"]')) {
    // If keys have been loaded already, re-render from cached parse.
    if (lastParsedKeys && lastParsedKeys.length) {
      const filter = getSelectedFilter();
      const filteredKeys = applyFilter(lastParsedKeys, filter);
      renderKeys(filteredKeys);
      updateStats(filteredKeys);
    }
  }
});
window.addEventListener('load', startup);