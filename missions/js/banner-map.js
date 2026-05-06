// map.js
// Drives the Leaflet map in banner-map.html. Discovers banner JSON files in ./banners/,
// converts them to GeoJSON portal features, renders colour-coded markers (one colour
// per mission), draws sequential mission path polylines, and maintains a colour legend.
let data = null;
let currentBannerJson = null;

const map = L.map('map').setView([-41.2924,174.7787], 14);

// CartoDB Dark Matter tiles (dark basemap)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

// Layer for mission path lines (cleared/rebuilt per banner load)
const missionLinesLayer = L.layerGroup().addTo(map);

// Mission colour palette (cycled if missions > palette length)
const MISSION_COLOURS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
  '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff',
  '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1',
  '#000075', '#808080'
];

let currentMissionCount = 0;
let legendControl = null;

function colourForMission(missionNumber) {
  const idx = (Number(missionNumber) - 1);
  if (!Number.isFinite(idx) || idx < 0) return '#ffffff';
  return MISSION_COLOURS[idx % MISSION_COLOURS.length];
}

function ensureLegend() {
  if (legendControl) return legendControl;
  legendControl = L.control({ position: 'topright' });
  legendControl.onAdd = function () {
    const div = L.DomUtil.create('div', 'mission-legend');
    div.style.background = 'rgba(17,17,17,0.85)';
    div.style.color = '#eee';
    div.style.padding = '8px 10px';
    div.style.border = '1px solid rgba(255,255,255,0.15)';
    div.style.borderRadius = '8px';
    div.style.fontFamily = 'system-ui';
    div.style.fontSize = '12px';
    div.style.lineHeight = '1.25';
    div.style.maxHeight = '50vh';
    div.style.overflow = 'auto';
    div.innerHTML = '<div style="font-weight:700; margin-bottom:6px;">Missions</div><div id="legendBody">(none)</div>';
    // Prevent map drag/scroll when interacting with legend
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };
  legendControl.addTo(map);
  return legendControl;
}

function updateLegend(missionCount, missionTitles) {
  currentMissionCount = Number(missionCount) || 0;
  const titles = Array.isArray(missionTitles) ? missionTitles : [];
  ensureLegend();
  const body = document.getElementById('legendBody');
  if (!body) return;

  if (!currentMissionCount) {
    body.textContent = '(none)';
    return;
  }

  const rows = [];
  for (let i = 1; i <= currentMissionCount; i++) {
    const c = colourForMission(i);
    rows.push(
      `<div style="display:flex; align-items:center; gap:8px; margin:2px 0;">` +
      `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${c}; border:1px solid rgba(255,255,255,0.35);"></span>` +
      `<span>${escapeHtml((titles[i - 1] || `Mission ${i}`))}</span>` +
      `</div>`
    );
  }
  body.innerHTML = rows.join('');
}

// style for markers
function pointToLayer(feature, latlng) {
  const props = feature && feature.properties ? feature.properties : {};
  const missions = Array.isArray(props.missions) ? props.missions : [];
  const firstMission = missions.length ? missions[0] : null;
  const colour = firstMission ? colourForMission(firstMission) : '#ffffff';

  // If a portal appears in multiple missions, make it slightly larger with a stronger outline
  const multi = missions.length > 1;

  return L.circleMarker(latlng, {
    radius: multi ? 7 : 5,
    weight: multi ? 2 : 1,
    color: '#ffffff',
    opacity: 0.9,
    fillColor: colour,
    fillOpacity: 0.9
  });
}

function onEachFeature(feature, layer) {
  const props = feature.properties || {};
  const title = props.title || 'Portal';
  const missionPairs = Array.isArray(props.missionPairs) ? props.missionPairs : [];

  const imageUrl = props.imageUrl ? String(props.imageUrl) : '';

  let html = '<strong>' + escapeHtml(title) + '</strong>';

  // Optional portal image
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
    html +=
      '<div style="margin-top:6px;">' +
      '<img ' +
        'src="' + escapeHtml(imageUrl) + '" ' +
        'alt="' + escapeHtml(title) + '" ' +
        'loading="lazy" ' +
        'referrerpolicy="no-referrer" ' +
        'style="display:block; max-width:240px; width:100%; height:auto; border-radius:8px; border:1px solid rgba(255,255,255,0.15);"' +
      '>' +
      '</div>';
  }

  if (missionPairs.length) {
    const lines = missionPairs
      .filter(mp => mp && mp.n)
      .map(mp => {
        const c = colourForMission(mp.n);
        const t = mp.title || `Mission ${mp.n}`;
        return (
          '<div style="display:flex; align-items:center; gap:6px; margin-top:4px;">' +
          `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${c}; border:1px solid rgba(255,255,255,0.35);"></span>` +
          '<span style="font-size:12px;">' + escapeHtml(t) + '</span>' +
          '</div>'
        );
      });

    html += lines.join('');
  }

  layer.bindPopup(html);
}

let gj = L.geoJSON({ type: 'FeatureCollection', features: [] }, { pointToLayer, onEachFeature }).addTo(map);

function fitToLayer(layer) {
  try {
    const b = layer.getBounds();
    if (b && b.isValid && b.isValid()) map.fitBounds(b.pad(0.1));
  } catch (e) {
    // ignore
  }
}
const statusEl = document.getElementById('status');
const bannerSelect = document.getElementById('bannerSelect');
const missionSetEl = document.querySelector('header strong');
const downloadKmlBtn = document.getElementById('downloadKmlBtn');

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

// Decode a filename for display (spaces instead of %20, etc.)
function displayNameFromFile(fileName) {
  const base = String(fileName).split('/').pop();
  const noExt = base.replace(/\.json$/i, '');
  try {
    return decodeURIComponent(noExt);
  } catch {
    return noExt;
  }
}

// Attempt to list JSON files in ./banners by parsing the directory listing HTML.
async function listBannerFiles() {
  const res = await fetch('./banners/', { cache: 'no-store' });
  if (!res.ok) throw new Error('Cannot fetch ./banners/');
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = Array.from(doc.querySelectorAll('a'))
    .map(a => a.getAttribute('href'))
    .filter(Boolean)
    .filter(h => h.toLowerCase().endsWith('.json'))
    .filter(h => !h.startsWith('../'))
    // strip query/hash
    .map(h => h.split('#')[0].split('?')[0]);

  // De-dupe and normalise
  const uniq = Array.from(new Set(links))
    .map(h => h.replace(/^\.\//, ''))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  return uniq;
}

function populateBannerSelect(files) {
  bannerSelect.innerHTML = '';
  for (const f of files) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = displayNameFromFile(f);
    bannerSelect.appendChild(opt);
  }
}

function bannerUrlFromHref(href) {
  const raw = String(href || '').trim();
  const cleaned = raw
    .split('#')[0]
    .split('?')[0]
    .replace(/^\.\//, '');

  // If the directory listing returns absolute paths or includes folders, trust it as a relative/absolute URL.
  if (cleaned.includes('/')) {
    return new URL(cleaned, location.href).toString();
  }

  // Otherwise treat it as a file within ./banners/
  return new URL('./banners/' + cleaned, location.href).toString();
}

function isBannerFormatV2(obj) {
  return !!(
    obj &&
    Array.isArray(obj.missions) &&
    obj.missions.length >= 0 &&
    // optional but common in your format
    ('missionSetName' in obj || 'fileFormatVersion' in obj)
  );
}

function rebuildMissionLinesFromBannerJson(bannerJson) {
  // Clear previous lines
  try { missionLinesLayer.clearLayers(); } catch (e) {}

  const missions = (bannerJson && Array.isArray(bannerJson.missions)) ? bannerJson.missions : [];

  for (let mi = 0; mi < missions.length; mi++) {
    const mission = missions[mi] || {};
    const missionType = String(mission.missionType || '').toLowerCase();
    if (missionType !== 'sequential') continue;

    const portals = Array.isArray(mission.portals) ? mission.portals : [];
    const latlngs = [];

    for (const p of portals) {
      if (!p || !p.location) continue;
      const lat = Number(p.location.latitude);
      const lon = Number(p.location.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      latlngs.push([lat, lon]);
    }

    // Need at least 2 points to draw a line
    if (latlngs.length < 2) continue;

    const colour = colourForMission(mi + 1);
    const title = mission.missionTitle ? String(mission.missionTitle) : `Mission ${mi + 1}`;

    const line = L.polyline(latlngs, {
      color: colour,
      weight: 3,
      opacity: 0.85
    });

    line.bindPopup('<strong>' + escapeHtml(title) + '</strong><br><small>Sequential path</small>');
    missionLinesLayer.addLayer(line);
  }

  // Keep lines underneath markers
  try {
    missionLinesLayer.eachLayer(l => {
      if (l && l.bringToBack) l.bringToBack();
    });
  } catch (e) {}
}

// Converts banner format (fileFormatVersion 2) into a GeoJSON FeatureCollection of unique portals.
// Dedupes portals by guid when present; otherwise by title+lat+lon.
function bannerToGeoJson(obj) {
  const portalMap = new Map();

  const missions = Array.isArray(obj.missions) ? obj.missions : [];

  for (let mi = 0; mi < missions.length; mi++) {
    const mission = missions[mi] || {};
    const missionNumber = mi + 1;
    const missionTitle = mission.missionTitle || `Mission ${missionNumber}`;
    const portals = Array.isArray(mission.portals) ? mission.portals : [];

    for (const p of portals) {
      if (!p || !p.location) continue;
      const lat = Number(p.location.latitude);
      const lon = Number(p.location.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const guid = p.guid ? String(p.guid) : '';
      const title = p.title ? String(p.title) : 'Portal';
      const key = guid || `${title}@@${lat.toFixed(6)},${lon.toFixed(6)}`;

      if (!portalMap.has(key)) {
        portalMap.set(key, {
          guid: guid || null,
          title,
          lat,
          lon,
          imageUrl: (p && p.imageUrl) ? String(p.imageUrl) : null,
          missions: [],
          missionTitles: [],
          missionPairs: []
        });
      }

      const rec = portalMap.get(key);
      // Keep the first non-empty title we see
      if (!rec.title && title) rec.title = title;
      if (!rec.imageUrl && p && p.imageUrl) rec.imageUrl = String(p.imageUrl);

      // Track which missions this portal appears in
      if (!rec.missions.includes(missionNumber)) rec.missions.push(missionNumber);
      if (!rec.missionTitles.includes(missionTitle)) rec.missionTitles.push(missionTitle);
      if (!rec.missionPairs.some(mp => mp && mp.n === missionNumber)) {
        rec.missionPairs.push({ n: missionNumber, title: missionTitle });
      }
    }
  }

  const features = Array.from(portalMap.values()).map(rec => ({
    type: 'Feature',
    properties: {
      title: rec.title,
      guid: rec.guid,
      imageUrl: rec.imageUrl,
      missions: rec.missions.slice().sort((a, b) => a - b),
      missionTitles: rec.missionTitles,
      missionPairs: Array.isArray(rec.missionPairs)
        ? rec.missionPairs.slice().sort((a, b) => (a.n || 0) - (b.n || 0))
        : []
    },
    geometry: {
      type: 'Point',
      coordinates: [rec.lon, rec.lat]
    }
  }));

  return { type: 'FeatureCollection', features };
}

function replaceGeoJsonLayer(geojson, label, extraMeta) {
  data = geojson;
  if (gj) {
    try { map.removeLayer(gj); } catch (e) {}
  }
  gj = L.geoJSON(data, { pointToLayer, onEachFeature }).addTo(map);
  // Fit to bounds; if bounds are invalid (e.g. 1 point edge-case), centre on the first feature
  try {
    const b = gj.getBounds();
    if (b && b.isValid && b.isValid()) {
      map.fitBounds(b.pad(0.1));
    } else if (data && Array.isArray(data.features) && data.features[0]) {
      const c = data.features[0].geometry && data.features[0].geometry.coordinates;
      if (c && c.length === 2) map.setView([c[1], c[0]], 16);
    }
  } catch (e) {
    // ignore
  }

  const count = (data && data.features && data.features.length) ? data.features.length : 0;
  const bits = [];
  if (label) bits.push(label);
  if (extraMeta && extraMeta.missionSetName) bits.push(extraMeta.missionSetName);
  if (extraMeta && Number.isFinite(extraMeta.missionCount)) bits.push(`${extraMeta.missionCount} missions`);

  const suffix = bits.length ? ' — ' + bits.join(' — ') : '';
  setStatus(`Loaded ${count} points${suffix}`);

  // Update header mission set name
  if (missionSetEl) {
    if (extraMeta && extraMeta.missionSetName) {
      missionSetEl.textContent = extraMeta.missionSetName;
      document.title = extraMeta.missionSetName;
    } else {
      missionSetEl.textContent = 'Mission Set';
    }
  }

  // Update mission colour legend
  if (extraMeta && Number.isFinite(extraMeta.missionCount)) {
    updateLegend(extraMeta.missionCount, extraMeta.missionTitles);
  } else {
    updateLegend(0, []);
  }
}

async function loadBannerByFileName(fileNameOrHref) {
  const display = displayNameFromFile(fileNameOrHref);
  setStatus(`Loading ${display}…`);
  // Reset lines for this load
  try { missionLinesLayer.clearLayers(); } catch (e) {}

  const url = bannerUrlFromHref(fileNameOrHref);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${url}`);

  const json = await res.json();
  if (!isBannerFormatV2(json)) {
    throw new Error('JSON is not a banner file (expected an object with a missions array).');
  }

  const extraMeta = {
    missionSetName: json && json.missionSetName ? String(json.missionSetName) : null,
    missionCount: Array.isArray(json.missions) ? json.missions.length : null,
    missionTitles: Array.isArray(json.missions)
      ? json.missions.map((m, idx) => (m && m.missionTitle) ? String(m.missionTitle) : `Mission ${idx + 1}`)
      : []
  };

  currentBannerJson = json;
  if (downloadKmlBtn) downloadKmlBtn.disabled = false;

  const geo = bannerToGeoJson(json);
  replaceGeoJsonLayer(geo, display, extraMeta);
  // Draw sequential mission paths (per-mission setting)
  rebuildMissionLinesFromBannerJson(json);
}

// KML export — mirrors json-to-kml.js but runs client-side using the same
// MISSION_COLOURS palette so exported colours match the map display.

function kmlColor(rgb, alpha = 'FF') {
  const m = rgb.replace('#', '').match(/([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/);
  if (!m) return alpha + 'FFFFFF';
  const [, r, g, b] = m;
  return (alpha + b + g + r).toUpperCase();
}

function kmlStyleBlock(idx, rgb) {
  const solid = kmlColor(rgb, 'FF');
  const semi  = kmlColor(rgb, 'CC');
  return `
  <Style id="m${idx}-point">
    <IconStyle>
      <color>${solid}</color><scale>0.3</scale>
      <Icon><href>https://www.gstatic.com/mapspro/images/stock/959-wht-circle-blank.png</href></Icon>
    </IconStyle>
    <LabelStyle><scale>0.0</scale></LabelStyle>
  </Style>
  <Style id="m${idx}-line">
    <LineStyle><color>${semi}</color><width>3</width></LineStyle>
  </Style>`;
}

function kmlPointPlacemark(p, styleId) {
  const lat = p?.location?.latitude;
  const lon = p?.location?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return '';
  const name = escapeHtml(p.title || 'Untitled');
  const descParts = [];
  if (p.imageUrl) descParts.push(`<img src="${escapeHtml(p.imageUrl)}" width="240"/>`);
  if (p.guid)     descParts.push(`<p><b>GUID:</b> ${escapeHtml(p.guid)}</p>`);
  const desc = descParts.length ? `<description><![CDATA[${descParts.join('')}]]></description>` : '';
  return `
  <Placemark>
    <name>${name}</name>${desc}
    <styleUrl>#${styleId}</styleUrl>
    <Point><coordinates>${lon},${lat},0</coordinates></Point>
  </Placemark>`;
}

function kmlLinePlacemark(coords, name, styleId) {
  if (coords.length < 2) return '';
  const path = coords.map(({ lon, lat }) => `${lon},${lat},0`).join(' ');
  return `
  <Placemark>
    <name>${escapeHtml(name)}</name>
    <styleUrl>#${styleId}</styleUrl>
    <LineString><tessellate>1</tessellate><coordinates>${path}</coordinates></LineString>
  </Placemark>`;
}

function buildKml(json) {
  const docName = escapeHtml(json.missionSetName || 'Mission Set');
  const docDesc = escapeHtml(json.missionSetDescription || '');
  const missions = Array.isArray(json.missions) ? json.missions : [];

  let styles = '';
  missions.forEach((_, i) => { styles += kmlStyleBlock(i, MISSION_COLOURS[i % MISSION_COLOURS.length]); });

  let placemarks = '';
  missions.forEach((m, i) => {
    const portals = Array.isArray(m.portals) ? m.portals : [];
    const title = m.missionTitle || `Mission ${String(i + 1).padStart(2, '0')}`;
    placemarks += portals.map(p => kmlPointPlacemark(p, `m${i}-point`)).join('');
    const coords = portals
      .map(p => {
        const lat = p?.location?.latitude, lon = p?.location?.longitude;
        return (typeof lat === 'number' && typeof lon === 'number') ? { lat, lon } : null;
      })
      .filter(Boolean);
    placemarks += kmlLinePlacemark(coords, `${title} — Route`, `m${i}-line`);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${docName}</name><description>${docDesc}</description>
    ${styles}
    <Folder><name>All Missions</name>${placemarks}</Folder>
  </Document>
</kml>`;
}

if (downloadKmlBtn) {
  downloadKmlBtn.addEventListener('click', () => {
    if (!currentBannerJson) return;
    const kml = buildKml(currentBannerJson);
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(currentBannerJson.missionSetName || 'banner').replace(/[^\w\- ]/g, '_')}.kml`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// Initialise: build dropdown from ./banners and load the first JSON.
(async () => {
  try {
    const files = await listBannerFiles();
    if (!files.length) {
      setStatus('No JSON files found in ./banners');
      return;
    }
    populateBannerSelect(files);
    await loadBannerByFileName(files[0]);

    if (bannerSelect) {
      bannerSelect.addEventListener('change', async () => {
        try {
          await loadBannerByFileName(bannerSelect.value);
        } catch (e) {
          console.error(e);
          setStatus(String(e && e.message ? e.message : e));
        }
      });
    }
  } catch (e) {
    console.error(e);
    // Directory listing may not be available (depends on server). Offer file picker fallback.
    setStatus('Could not load banner data. Check the console and confirm the JSON files are reachable under ./banners/.');
  }
})();

// simple escape for popup
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
