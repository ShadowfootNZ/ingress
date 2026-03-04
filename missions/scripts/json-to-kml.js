// json-to-kml.js
// Usage: node json-to-kml.js points.json output.kml
// Produces a KML with one Folder per mission, coloured points + connecting line.

const fs = require('fs');

const [,, inFile = 'points.json', outFile = 'output.kml'] = process.argv;

// 24 distinct, readable colours (RGB hex). Feel free to tweak!
// (roughly from Tableau/D3 palettes + a few extras)
const PALETTE = [
  '#E6194B','#3CB44B','#0082C8','#F58231','#911EB4','#46F0F0',
  '#F032E6','#D2F53C','#FABEBE','#008080','#E6BEFF','#AA6E28',
  '#800000','#FFD8B1','#000080','#808000','#F0E442','#4E79A7',
  '#59A14F','#E15759','#EDC948','#B07AA1','#76B7B2','#FF9DA7'
];

// Convert CSS #RRGGBB to KML aabbggrr (alpha + BGR)
function kmlColor(rgb, alpha='FF') {
  const m = rgb.replace('#','').match(/([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/);
  if (!m) return alpha + 'FFFFFF'; // default white
  const [_, r, g, b] = m;
  return (alpha + b + g + r).toUpperCase();
}

function esc(s='') {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

function styleBlock(idx, rgb) {
  const kmlCol = kmlColor(rgb, 'FF');       // solid
  const kmlColHalf = kmlColor(rgb, 'CC');   // semi-transparent for lines
  return `
  <Style id="m${idx}-point">
    <IconStyle>
      <color>${kmlCol}</color>
      <scale>0.3</scale> <!-- smaller point marker -->
      <Icon>
      <!-- Default Google pin. You can swap for a custom icon URL -->
      <href>https://www.gstatic.com/mapspro/images/stock/959-wht-circle-blank.png</href>
    </Icon>
    </IconStyle>
    <LabelStyle>
      <scale>0.0</scale> <!-- hide labels -->
    </LabelStyle>
  </Style>
  <Style id="m${idx}-line">
    <LineStyle>
      <color>${kmlColHalf}</color>
      <width>3</width>
    </LineStyle>
  </Style>`;
}


function pointPlacemark(p, styleUrl) {
  const lat = p?.location?.latitude;
  const lon = p?.location?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return '';
  const name = esc(p.title || 'Untitled');
  const descParts = [];
  if (p.imageUrl) descParts.push(`<img src="${esc(p.imageUrl)}" width="240"/>`);
  if (p.guid) descParts.push(`<p><b>GUID:</b> ${esc(p.guid)}</p>`);
  const desc = descParts.length ? `<description><![CDATA[${descParts.join('')}]]></description>` : '';
  return `
  <Placemark>
    <name>${name}</name>
    ${desc}
    <styleUrl>#${styleUrl}</styleUrl>
    <Point><coordinates>${lon},${lat},0</coordinates></Point>
  </Placemark>`;
}

function linePlacemark(coords, name, styleUrl) {
  if (coords.length < 2) return '';
  const path = coords.map(({lon,lat}) => `${lon},${lat},0`).join(' ');
  return `
  <Placemark>
    <name>${esc(name)}</name>
    <styleUrl>#${styleUrl}</styleUrl>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>${path}</coordinates>
    </LineString>
  </Placemark>`;
}

function buildKml(data) {
  const docName = esc(data.missionSetName || 'Mission Set');
  const docDesc = esc(data.missionSetDescription || '');
  const missions = Array.isArray(data.missions) ? data.missions : [];

  // Build shared <Style> blocks (one pair per mission index, cycling colours)
  let styles = '';
  for (let i = 0; i < missions.length; i++) {
    styles += styleBlock(i, PALETTE[i % PALETTE.length]);
  }

  // Build a SINGLE Folder containing placemarks for all missions
  let allPlacemarks = '';
  missions.forEach((m, i) => {
    const stylePointId = `m${i}-point`;
    const styleLineId = `m${i}-line`;

    const title = m.missionTitle || `Mission ${String(i+1).padStart(2,'0')}`;
    const portals = Array.isArray(m.portals) ? m.portals : [];

    // Points
    allPlacemarks += portals.map(p => pointPlacemark(p, stylePointId)).join('\n');

    // Path (connect points in mission order)
    const coords = portals.map(p => {
      const lat = p?.location?.latitude;
      const lon = p?.location?.longitude;
      return (typeof lat === 'number' && typeof lon === 'number') ? {lat,lon} : null;
    }).filter(Boolean);

    allPlacemarks += linePlacemark(coords, `${title} — Route`, styleLineId);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${docName}</name>
    <description>${docDesc}</description>
    ${styles}
    <Folder>
      <name>All Missions</name>
      ${allPlacemarks}
    </Folder>
  </Document>
</kml>`;
}

try {
  const raw = fs.readFileSync(inFile, 'utf8');
  const json = JSON.parse(raw);
  const kml = buildKml(json);
  fs.writeFileSync(outFile, kml, 'utf8');
  console.log(`✅ Wrote ${outFile}`);
} catch (e) {
  console.error('❌ Failed:', e.message);
  process.exit(1);
}