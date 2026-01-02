let map = null;
let markers = [];

const STORAGE_KEY = 'ingressKeyData';

function showStatus(message) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
}

function hideStatus() {
  const el = document.getElementById('status');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
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

function updateStats(keys) {
  const totalKeys = keys.reduce((sum, key) => sum + key.count, 0);
  const inCapsules = keys
    .filter((key) => key.capsule !== 'None')
    .reduce((sum, key) => sum + key.count, 0);
  const uniqueCapsules = new Set(
    keys.map((key) => key.capsule).filter((c) => c !== 'None')
  ).size;

  document.getElementById('totalPortals').textContent = keys.length;
  document.getElementById('totalKeys').textContent = totalKeys;
  document.getElementById('inCapsules').textContent = inCapsules;
  document.getElementById('uniqueCapsules').textContent = uniqueCapsules;
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

    if (keys.length === 0) {
      errorEl.textContent =
        'No valid keys found. Please check your data format.';
      errorEl.style.display = 'block';
      return;
    }

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

    updateStats(keys);
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

    console.log(
      `Loaded ${keys.length} portals with ${totalKeys(keys)} total keys`
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

window.addEventListener('load', startup);