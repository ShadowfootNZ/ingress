// local-portal-images.js
// Browses portal images for missions stored in local banner JSON files (banners/).
// Auto-discovers available JSON files, displays each mission's portal images in
// scrollable rows with hover previews, and supports bulk zip download.

import { safeFilename, buildDownloadList, downloadBlob, attachHoverPreview } from './shared.js';

(async () => {
  const status = document.getElementById('status');
  const container = document.getElementById('missions');
  const select = document.getElementById('fileSelect');
  const downloadBtn = document.getElementById('downloadAll');

  let currentJsonPath = null;
  let currentData = null;

  const BANNERS_DIR = 'banners';

  const normaliseToJsonPath = (value) => {
    let v = (value || '').trim();
    if (!v) return null;
    v = v.replace(/\\/g, '/');
    if (v.startsWith('./')) v = v.slice(2);
    const idx = v.toLowerCase().lastIndexOf(`/${BANNERS_DIR.toLowerCase()}/`);
    if (idx !== -1) v = v.slice(idx + 1);
    if (v.startsWith('/')) v = v.slice(1);
    if (!v.toLowerCase().startsWith(BANNERS_DIR.toLowerCase() + '/')) v = `${BANNERS_DIR}/${v}`;
    if (!v.toLowerCase().endsWith('.json')) v = `${v}.json`;
    return v;
  };

  const loadJsonListFromDirectoryListing = async () => {
    const res = await fetch(`${BANNERS_DIR}/`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const hrefs = [];
    const re = /href\s*=\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(text)) !== null) hrefs.push(m[1]);

    const jsonLinks = hrefs
      .map(h => {
        const clean = h.split('?')[0].split('#')[0];
        if (!clean || clean === '../' || clean === './' || clean === '/') return null;
        if (!clean.toLowerCase().endsWith('.json')) return null;
        return normaliseToJsonPath(clean);
      })
      .filter(Boolean);

    const seen = new Set();
    const unique = [];
    for (const p of jsonLinks) {
      if (seen.has(p)) continue;
      seen.add(p);
      unique.push(p);
    }
    return unique;
  };

  const labelFromPath = (path) => {
    const p = (path || '').toString().replace(/\\/g, '/');
    const baseRaw = p.split('/').filter(Boolean).pop() || '';
    let base = baseRaw;
    try { base = decodeURIComponent(baseRaw); } catch (_) { base = baseRaw; }
    return base.replace(/\.json$/i, '');
  };

  const renderSelect = (paths, selectedPath) => {
    select.innerHTML = '';
    if (!paths.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No JSON files found';
      select.appendChild(opt);
      select.disabled = true;
      downloadBtn.disabled = true;
      return;
    }
    select.disabled = false;
    downloadBtn.disabled = false;
    paths.forEach((path) => {
      const opt = document.createElement('option');
      opt.value = path;
      opt.textContent = labelFromPath(path);
      if (path === selectedPath) opt.selected = true;
      select.appendChild(opt);
    });
  };

  const clearMissions = () => { container.innerHTML = ''; };

  const renderMissions = (data) => {
    let total = 0;
    const frag = document.createDocumentFragment();

    data.missions.forEach((m, mi) => {
      const portals = (m.portals || []).filter(p => p && p.imageUrl);
      if (!portals.length) return;

      const row = document.createElement('div');
      row.className = 'mission-row';
      row.setAttribute('role', 'listitem');

      const header = document.createElement('div');
      header.className = 'mission-header';
      header.textContent = `Mission ${mi + 1}`;
      row.appendChild(header);

      const tilesDiv = document.createElement('div');
      tilesDiv.className = 'tiles';
      tilesDiv.setAttribute('role', 'list');
      row.appendChild(tilesDiv);

      portals.forEach((p, pi) => {
        total++;
        const title = p.title || 'Untitled';

        const fig = document.createElement('figure');
        fig.className = 'tile';

        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.textContent = `${mi + 1}-${pi + 1}`;

        const a = document.createElement('a');
        a.className = 'thumb-link';
        a.href = p.imageUrl;
        a.target = '_blank';
        a.rel = 'noopener';

        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = p.imageUrl;
        img.alt = title;
        img.loading = 'lazy';

        a.appendChild(img);
        fig.appendChild(a);
        fig.appendChild(badge);

        attachHoverPreview(fig, p.imageUrl, title);

        const cap = document.createElement('figcaption');
        const desc = (p.description || '').trim();
        cap.innerHTML = desc
          ? `<strong>${title}</strong><br>${desc}`
          : `<strong>${title}</strong>`;
        fig.appendChild(cap);

        tilesDiv.appendChild(fig);
      });

      frag.appendChild(row);
    });

    status.textContent = total === 0
      ? 'No images found.'
      : `Loaded ${total} images across ${data.missions.length} missions. Scroll down; each row scrolls sideways.`;

    container.appendChild(frag);
  };

  const loadAndRender = async (jsonPath) => {
    status.style.color = '';
    status.textContent = 'Loading…';
    clearMissions();
    const res = await fetch(jsonPath, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.missions)) throw new Error('Missing missions[]');
    currentJsonPath = jsonPath;
    currentData = data;
    renderMissions(data);
  };

  try {
    let paths = [];
    try {
      paths = await loadJsonListFromDirectoryListing();
    } catch (err) {
      console.error('Could not discover banner JSON files from directory listing.', err);
    }

    if (!paths.length) {
      renderSelect([], null);
      throw new Error('No JSON files found in banners/.');
    }

    const defaultPath = paths[0];
    renderSelect(paths, defaultPath);
    await loadAndRender(defaultPath);

    select.addEventListener('change', async () => {
      try {
        const nextPath = normaliseToJsonPath(select.value);
        if (!nextPath) throw new Error('No file selected.');
        await loadAndRender(nextPath);
      } catch (err) {
        console.error(err);
        status.textContent = `Error loading images: ${err.message}`;
        status.style.color = 'tomato';
      }
    });

    downloadBtn.addEventListener('click', async () => {
      try {
        if (!window.JSZip) throw new Error('JSZip library not loaded (are you offline?).');
        if (!currentData) throw new Error('Nothing loaded yet.');

        const list = buildDownloadList(currentData);
        if (!list.length) throw new Error('No images found to download.');

        downloadBtn.disabled = true;
        status.style.color = '';

        const zip = new window.JSZip();
        const zipBase = labelFromPath(currentJsonPath || 'images');
        let ok = 0, fail = 0;

        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          status.textContent = `Downloading ${i + 1}/${list.length}… (${ok} ok, ${fail} failed)`;
          try {
            const res = await fetch(item.url, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            zip.file(item.filename, await res.blob());
            ok++;
          } catch (e) {
            console.warn('Failed to fetch', item.url, e);
            fail++;
          }
        }

        status.textContent = `Building zip… (${ok} ok, ${fail} failed)`;
        downloadBlob(`${safeFilename(zipBase)}.zip`, await zip.generateAsync({ type: 'blob' }));
        status.textContent = `Downloaded zip. (${ok} ok, ${fail} failed)`;
      } catch (err) {
        console.error(err);
        status.textContent = `Download failed: ${err.message}`;
        status.style.color = 'tomato';
      } finally {
        downloadBtn.disabled = false;
      }
    });

  } catch (err) {
    console.error(err);
    status.textContent = `Error loading images: ${err.message}`;
    status.style.color = 'tomato';
  }
})();
