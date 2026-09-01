import { CARTO_ATTRIBUTION, cartoDarkTileUrl } from './carto-basemap.js';

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
      if (/\[[^\]]+\]\(https?:\/\/intel\.ingress\.com\/[^)]*pll=/i.test(plain)) return;

      let converted = '';

      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Collect portal rows from HTML tables. This supports:
        // - Intel Inventory table (Portal link in col 1, count in col 2, capsule in col 3)
        // - IITC inventory table (count in col 1, portal link in col 2, capsules in last col)
        // - IITC split format (2-col tables under headings like "Keys" and "Key Capsule: XXXXXXXX (100)")
        const items = [];
        let capsuleContext = 'None';

        const normaliseCount = (s) => {
          const t = String(s || '').trim();
          const m1 = t.match(/^x(\d+)$/i);
          if (m1) return `x${m1[1]}`;
          const m2 = t.match(/^(\d+)$/);
          if (m2) return `x${m2[1]}`;
          return 'x1';
        };

        const normaliseCapsule = (s) => {
          const t = String(s || '').trim();
          if (!t) return null;
          const m = t.match(/\b([0-9A-F]{8})\b/i);
          return m ? m[1].toUpperCase() : null;
        };

        // Track capsule context by scanning text nodes for headings.
        // This is intentionally permissive because IITC exports vary by browser/markdown renderer.
        const headingEls = Array.from(
          doc.querySelectorAll('strong, b, h1, h2, h3, h4, h5, h6, p, div, span')
        );
        for (const el of headingEls) {
          const txt = (el.textContent || '').trim();
          if (!txt) continue;

          if (/^Keys$/i.test(txt) || /^\*\*Keys\*\*$/i.test(txt)) {
            capsuleContext = 'None';
          } else {
            const m = txt.match(/Key Capsule:\s*([0-9A-F]{8})/i);
            if (m) capsuleContext = m[1].toUpperCase();
          }
        }

        // Walk table rows in document order. We’ll use the *current* capsuleContext for 2-col tables.
        const rows = Array.from(doc.querySelectorAll('tr'));
        for (const tr of rows) {
          const tds = Array.from(tr.querySelectorAll('td'));
          if (tds.length < 2) continue;

          // Any intel link (IITC uses /?pll=..., Intel uses /intel?...pll=..., sometimes /mission/...?...pll=...)
          const link = tr.querySelector('a[href*="intel.ingress.com"]');
          if (!link) continue;

          const name = (link.textContent || '').trim();
          const url = (link.getAttribute('href') || '').trim();
          if (!name || !url) continue;

          // Determine layout by which column contains the link.
          const linkTdIndex = tds.findIndex((td) => td.contains(link));
          if (linkTdIndex < 0) continue;

          let count = 'x1';
          let capsule = 'None';

          if (linkTdIndex === 0) {
            // Intel Inventory: [Portal(link)] | xN | Capsule
            count = normaliseCount(tds[1]?.textContent);
            const cap = normaliseCapsule(tds[2]?.textContent);
            capsule = cap || (tds[2]?.textContent || '').trim() || 'None';
          } else if (linkTdIndex === 1) {
            // IITC: Count | [Portal(link)] | Distance? | Capsules?
            count = normaliseCount(tds[0]?.textContent);

            // If there's a capsules column, it’s usually the last TD.
            const lastTdText = (tds[tds.length - 1]?.textContent || '').trim();
            const cap = normaliseCapsule(lastTdText);
            if (cap) {
              capsule = cap;
            } else if (tds.length === 2) {
              // Split-format 2-col rows: use current capsule context
              capsule = capsuleContext || 'None';
            } else {
              capsule = 'None';
            }
          } else {
            // Unrecognised layout: still keep the portal, but default count/capsule.
            count = 'x1';
            capsule = capsuleContext || 'None';
          }

          items.push({ name, url, count, capsule });
        }

        if (items.length) {
          converted += 'Portal Keys\nCount\nCapsule\n\n';
          for (const it of items) {
            converted += `[${it.name}](${it.url})\n${it.count}\n${it.capsule || 'None'}\n\n`;
          }
        } else {
          // Fallback: sometimes the clipboard HTML doesn't include table rows,
          // but it *does* include anchors with URLs, while count/capsule are only in text/plain.
          const plainLines = plain
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);

          // Parse plain text into items: Name -> Count -> Capsule (or None)
          const plainItems = [];
          let inSection = false;
          let capsuleContext = undefined;

          for (let i = 0; i < plainLines.length; i++) {
            const line = plainLines[i];

            if (line === 'Portal Keys' || line === 'Keys') {
              inSection = true;
              continue;
            }
            if (!inSection) continue;

            if (
              line === 'Count' ||
              line === 'Capsule' ||
              line === 'Capsules' ||
              line === 'Portal' ||
              line === 'Distance' ||
              line === '* * *' ||
              line === 'Items' ||
              line === '✏️'
            ) {
              continue;
            }

            // Capsule section headings like "Key Capsule: 2E7ADD79 (100)"
            const capHeading = line.match(/Key Capsule:\s*([0-9A-F]{8})/i);
            if (capHeading) {
              capsuleContext = capHeading[1].toUpperCase();
              continue;
            }

            // Skip markdown table separators / headers
            if (/^\|/.test(line) && /-+/.test(line)) continue;

            const name = line;

            // Next line might be xN or N
            let count = 'x1';
            const next1 = plainLines[i + 1] || '';
            const mCount1 = next1.match(/^x(\d+)$/i);
            const mCount2 = next1.match(/^(\d+)$/);
            if (mCount1) {
              count = `x${mCount1[1]}`;
              i++;
            } else if (mCount2) {
              count = `x${mCount2[1]}`;
              i++;
            }

            // Next line might be capsule name/id or None
            let capsule = 'None';
            const next2 = plainLines[i + 1] || '';
            if (next2 && !/^\[/.test(next2) && !/^x\d+$/i.test(next2) && !/^\d+$/.test(next2)) {
              capsule = next2;
              i++;
            } else if (capsuleContext && capsuleContext !== 'None') {
              // For split-format exports, apply the current capsule context.
              capsule = capsuleContext;
            }

            plainItems.push({ name, count, capsule, url: '' });
          }

          // Pull anchors from HTML (in document order)
          const anchors = Array.from(
            doc.querySelectorAll('a[href*="intel.ingress.com"]')
          )
            .map((a) => ({
              name: (a.textContent || '').trim(),
              url: (a.getAttribute('href') || '').trim(),
            }))
            .filter((a) => a.name && a.url && /pll=/.test(a.url));

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
                converted += `[${it.name}](${it.url})\n${it.count}\n${it.capsule || 'None'}\n\n`;
              } else {
                // Keep record even if URL missing (it just won't map)
                converted += `${it.name}\n${it.count}\n${it.capsule || 'None'}\n\n`;
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
      cartoDarkTileUrl(),
      {
        maxZoom: 19,
        attribution: CARTO_ATTRIBUTION,
      }
    ).addTo(map);
  }
}

function parseKeyData(text) {
  const keys = [];
  if (!text) return keys;

  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  function extractLatLngFromUrl(url) {
    if (!url) return null;
    const m = url.match(/[\?&]pll=([-0-9.]+),([-0-9.]+)/i);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }

  function extractCapsuleId(s) {
    if (!s) return null;
    const m = String(s).match(/\b([0-9A-F]{8})\b/i);
    return m ? m[1].toUpperCase() : null;
  }

  // --- Mode 1: original "Portal Keys / Count / Capsule" list (line-based) ---
  let currentKey = null;
  let inKeysSection = false;

  // --- Mode 2/3: IITC table formats (stateful) ---
  let currentCapsuleContext = 'None'; // used for split format headings

  // A slightly more flexible portal markdown matcher:
  // - any intel.ingress.com path
  // - any query string order
  // - must include pll=lat,lng
  const portalMdRe =
    /\[(.+?)\]\((https?:\/\/intel\.ingress\.com\/[^)]*?pll=([-0-9.]+),([-0-9.]+)[^)]*)\)/i;

  // IITC "table row" matcher for: | 3 | [Name](url) | ... |
  const tableRowRe =
    /^\|\s*([0-9]+)\s*\|\s*\[(.+?)\]\((https?:\/\/intel\.ingress\.com\/[^)]+)\)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/i;

  // IITC "2-col row" matcher for split lists: | 3 | [Name](url) |
  const table2ColRowRe =
    /^\|\s*([0-9]+)\s*\|\s*\[(.+?)\]\((https?:\/\/intel\.ingress\.com\/[^)]+)\)\s*\|\s*$/i;

  // Table header separators like | --- | or | ----- |
  const tableSepRe = /^\|\s*-{2,}.*\|\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    // --- Detect split-format capsule heading ---
    // Examples:
    // **Key Capsule: 2E7ADD79 (100)**
    // Key Capsule: 2E7ADD79 (100)
    const capsuleHeadingMatch = line.match(/Key Capsule:\s*([^*]+?)(?:\s*\(|\*\*|$)/i);
    if (capsuleHeadingMatch) {
      const id = extractCapsuleId(capsuleHeadingMatch[1]);
      currentCapsuleContext = id || capsuleHeadingMatch[1].trim() || 'None';
      // Don’t treat this as an item line.
      continue;
    }

    // Split-format inventory heading
    if (/^\*\*Keys\*\*$/i.test(line) || /^Keys$/i.test(line)) {
      currentCapsuleContext = 'None';
      continue;
    }

    // Ignore obvious non-data lines in IITC exports
    if (
      /^Portal Keys$/i.test(line) ||
      /^Count$/i.test(line) ||
      /^Capsule$/i.test(line) ||
      /^Capsules$/i.test(line) ||
      /^Portal$/i.test(line) ||
      /^Distance$/i.test(line) ||
      line === '* * *' ||
      line === 'Items' ||
      line === '✏️' ||
      tableSepRe.test(line)
    ) {
      continue;
    }

    // --- Mode 2: IITC inventory table with Capsules column ---
    // Example:
    // | 3 | [Barrenjoey Lighthouse](https://intel.ingress.com/?pll=...) | 2230 km | 2E7ADD79 (3) |
    const tableMatch = line.match(tableRowRe);
    if (tableMatch) {
      const count = parseInt(tableMatch[1], 10);
      const name = tableMatch[2].trim();
      const url = tableMatch[3].trim();
      const capsulesCell = (tableMatch[5] || '').trim();

      const coords = extractLatLngFromUrl(url);
      if (!coords) continue;

      const capsuleId = extractCapsuleId(capsulesCell);
      const capsule = capsuleId ? capsuleId : 'None';

      keys.push({
        name,
        lat: coords.lat,
        lng: coords.lng,
        count: Number.isFinite(count) ? count : 1,
        capsule,
      });
      // This line belongs to a table format; do not feed the original mode parser.
      continue;
    }

    // --- Mode 3: IITC split-format 2-column tables ---
    // Example:
    // | 3 | [Barrenjoey Lighthouse](https://intel.ingress.com/mission/... ?pll=...) |
    const table2Match = line.match(table2ColRowRe);
    if (table2Match) {
      const count = parseInt(table2Match[1], 10);
      const name = table2Match[2].trim();
      const url = table2Match[3].trim();

      const coords = extractLatLngFromUrl(url);
      if (!coords) continue;

      keys.push({
        name,
        lat: coords.lat,
        lng: coords.lng,
        count: Number.isFinite(count) ? count : 1,
        capsule: currentCapsuleContext || 'None',
      });
      continue;
    }

    // --- Mode 1: existing line-based format ---
    // Start-of-section marker
    if (line === 'Portal Keys') {
      inKeysSection = true;
      continue;
    }

    if (!inKeysSection) {
      // Still allow the old format even if the "Portal Keys" line was omitted,
      // by reacting to a markdown portal line.
      const portalImplicit = line.match(portalMdRe);
      if (!portalImplicit) continue;
      inKeysSection = true;
      // fall through to portal handling below (by not continuing)
    }

    const portalMatch = line.match(portalMdRe);
    if (portalMatch) {
      if (currentKey) keys.push(currentKey);

      currentKey = {
        name: portalMatch[1],
        lat: parseFloat(portalMatch[3]),
        lng: parseFloat(portalMatch[4]),
        count: 1,
        capsule: 'None',
      };
      continue;
    }

    // Count line like x3
    if (line.startsWith('x')) {
      const countMatch = line.match(/x(\d+)/i);
      if (countMatch && currentKey) {
        currentKey.count = parseInt(countMatch[1], 10);
      }
      continue;
    }

    // Capsule line (anything non-empty that isn't a markdown link)
    if (currentKey && !line.startsWith('[')) {
      currentKey.capsule = line;
      continue;
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

function getSelectedLocation() {
  const el = document.getElementById('locationFilter');
  if (!el) return 'all';
  return el.value || 'all';
}

function applyFilter(keys) {
  const mode = getSelectedLocation();

  if (mode === 'inventory') {
    return keys.filter((k) => k.capsule === 'None');
  }

  if (mode === 'capsules') {
    return keys.filter((k) => k.capsule !== 'None');
  }

  // Specific capsule selected (value is capsule id)
  if (mode !== 'all') {
    return keys.filter((k) => k.capsule === mode);
  }

  return keys;
}

function updateLocationDropdown(keys) {
  const el = document.getElementById('locationFilter');
  if (!el) return;

  const capsules = Array.from(
    new Set(
      (keys || [])
        .map((k) => (k.capsule || '').trim())
        .filter((c) => c && c !== 'None')
    )
  ).sort((a, b) => a.localeCompare(b));

  const current = el.value || 'all';

  el.innerHTML = '';

  const optAll = document.createElement('option');
  optAll.value = 'all';
  optAll.textContent = 'All';
  el.appendChild(optAll);

  const optInv = document.createElement('option');
  optInv.value = 'inventory';
  optInv.textContent = 'Inventory only';
  el.appendChild(optInv);

  const optCaps = document.createElement('option');
  optCaps.value = 'capsules';
  optCaps.textContent = 'All capsules';
  el.appendChild(optCaps);

  if (capsules.length) {
    const sep = document.createElement('option');
    sep.value = '__sep__';
    sep.textContent = '──────────';
    sep.disabled = true;
    el.appendChild(sep);

    for (const c of capsules) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      el.appendChild(opt);
    }
  }

  el.disabled = false;

  const stillValid =
    current === 'all' ||
    current === 'inventory' ||
    current === 'capsules' ||
    capsules.includes(current);

  el.value = stillValid ? current : 'all';
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
  const mode = getSelectedLocation();
  const inCapsulesItem = document
    .getElementById('inCapsules')
    ?.closest('.stat-item');
  
  if (inCapsulesItem) {
    inCapsulesItem.style.display = mode === 'all' ? 'flex' : 'none';
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
    updateLocationDropdown(lastParsedKeys);

    if (keys.length === 0) {
      errorEl.textContent =
        'No valid keys found. Please check your data format.';
      errorEl.style.display = 'block';
      return;
    }

    const filteredKeys = applyFilter(keys);

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

    const mode = getSelectedLocation();
    const filteredKeys2 = applyFilter(lastParsedKeys);
    
    console.log(
      `Loaded ${filteredKeys2.length} portals with ${totalKeys(filteredKeys2)} total keys (${mode})`
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
  const locationEl = document.getElementById('locationFilter');
  if (locationEl) {
    locationEl.value = 'all';
    locationEl.disabled = true;
    locationEl.innerHTML =
      '<option value="all" selected>All</option><option value="inventory">Inventory only</option><option value="capsules">All capsules</option>';
  }
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

document.getElementById('loadBtn')?.addEventListener('click', () => loadKeys());
document.getElementById('clearBtn')?.addEventListener('click', clearMap);

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t && t.id === 'locationFilter') {
    // Prevent selecting the visual separator option.
    if (t.value === '__sep__') {
      t.value = 'all';
      return;
    }

    if (lastParsedKeys && lastParsedKeys.length) {
      const filteredKeys = applyFilter(lastParsedKeys);
      renderKeys(filteredKeys);
      updateStats(filteredKeys);
    }
  }
});

window.addEventListener('load', startup);
