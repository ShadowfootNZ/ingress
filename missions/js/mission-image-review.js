// mission-image-review.js
// Discovers mission image files in the images/ folder via directory listing,
// groups them by filename prefix and row number, and renders them in a grid.
// Supports a live filter input to narrow the display by filename.

const BASE_PATH = 'images';
const FILE_RE = /^(.+?)\s+(\d+)-(\d+)\.([a-zA-Z0-9]+)$/;

async function listImageFiles() {
  const res = await fetch(`${BASE_PATH}/`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Cannot fetch ${BASE_PATH}/ (HTTP ${res.status}) — directory listing may be disabled on this server.`);
  const text = await res.text();
  const hrefs = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(text)) !== null) hrefs.push(m[1]);
  return hrefs
    .filter(h => /\.(jpe?g|png|gif|webp)$/i.test(h.split('?')[0]))
    .map(h => { try { return decodeURIComponent(h.split('?')[0].split('/').pop()); } catch { return h.split('/').pop(); } })
    .filter(Boolean);
}

function parseFilename(filename) {
  const m = FILE_RE.exec(filename);
  if (!m) return null;
  return { filename, prefix: m[1], row: Number(m[2]), num: Number(m[3]) };
}

function groupFiles(files) {
  const byPrefix = new Map();
  for (const f of files) {
    const p = parseFilename(f);
    if (!p) continue;
    if (!byPrefix.has(p.prefix)) byPrefix.set(p.prefix, new Map());
    const byRow = byPrefix.get(p.prefix);
    if (!byRow.has(p.row)) byRow.set(p.row, []);
    byRow.get(p.row).push(p);
  }
  for (const [, byRow] of byPrefix) {
    for (const [, items] of byRow) {
      items.sort((a, b) => a.num - b.num);
    }
  }
  return byPrefix;
}

function makeFigure(item) {
  const src = `${BASE_PATH}/${item.filename}`;
  const nameWithoutExt = item.filename.replace(/\.[^.]+$/, '');

  const fig = document.createElement('figure');
  fig.dataset.name = nameWithoutExt.toLowerCase();

  const a = document.createElement('a');
  a.className = 'thumb';
  a.href = src;
  a.target = '_blank';
  a.rel = 'noreferrer';

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = nameWithoutExt;
  img.src = src;
  img.onerror = () => fig.remove();

  const cap = document.createElement('figcaption');
  cap.textContent = nameWithoutExt;

  a.appendChild(img);
  fig.appendChild(a);
  fig.appendChild(cap);
  return fig;
}

function render(byPrefix) {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const multiPrefix = byPrefix.size > 1;

  for (const [prefix, byRow] of byPrefix) {
    const group = document.createElement('section');

    if (multiPrefix) {
      const h2 = document.createElement('h2');
      h2.className = 'prefix-title';
      h2.textContent = prefix;
      group.appendChild(h2);
    }

    const sortedRows = Array.from(byRow.keys()).sort((a, b) => a - b);
    for (const rowNum of sortedRows) {
      const rowSection = document.createElement('section');
      rowSection.className = 'row';

      const heading = document.createElement(multiPrefix ? 'h3' : 'h2');
      heading.className = 'row-title';
      heading.textContent = `Row ${rowNum}`;
      rowSection.appendChild(heading);

      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const item of byRow.get(rowNum)) {
        grid.appendChild(makeFigure(item));
      }
      rowSection.appendChild(grid);
      group.appendChild(rowSection);
    }

    app.appendChild(group);
  }
}

const filterInput = document.getElementById('filter');
filterInput.addEventListener('input', () => {
  const q = filterInput.value.toLowerCase().trim();
  document.querySelectorAll('#app figure').forEach(fig => {
    fig.hidden = q !== '' && !fig.dataset.name.includes(q);
  });
  document.querySelectorAll('#app section.row').forEach(row => {
    row.hidden = q !== '' && row.querySelectorAll('figure:not([hidden])').length === 0;
  });
});

(async () => {
  const app = document.getElementById('app');
  try {
    app.textContent = 'Loading…';
    const files = await listImageFiles();
    const byPrefix = groupFiles(files);
    if (byPrefix.size === 0) {
      app.textContent = 'No matching image files found in images/.';
      return;
    }
    render(byPrefix);
  } catch (err) {
    console.error(err);
    app.textContent = `Error: ${err.message}`;
  }
})();
