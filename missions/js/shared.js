// shared.js
// Utilities shared between local-portal-images.js and bannergress-portal-images.js.

export function safeFilename(name) {
  return (name || 'image')
    .toString()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function guessExtensionFromUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    const m = u.pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return 'jpg';
}

export function buildDownloadList(data) {
  const items = [];
  data.missions.forEach((m, mi) => {
    const portals = (m.portals || []).filter(p => p && p.imageUrl);
    portals.forEach((p, pi) => {
      const badge = `${mi + 1}-${pi + 1}`;
      const ext = guessExtensionFromUrl(p.imageUrl);
      items.push({ filename: `${badge} ${safeFilename(p.title || 'Untitled')}.${ext}`, url: p.imageUrl });
    });
  });
  return items;
}

export function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  const objUrl = URL.createObjectURL(blob);
  a.href = objUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(objUrl); a.remove(); }, 1000);
}

export function attachHoverPreview(fig, imageUrl, title) {
  let hoverTimer = null;
  let previewEl = null;

  const positionPreview = (evt, el) => {
    const pad = 16;
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    const rect = el.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - pad) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  };

  const showPreview = (evt) => {
    if (previewEl) return;
    previewEl = document.createElement('div');
    previewEl.className = 'preview';
    const big = document.createElement('img');
    big.src = imageUrl;
    big.alt = title;
    previewEl.appendChild(big);
    document.body.appendChild(previewEl);
    positionPreview(evt, previewEl);
  };

  const hidePreview = () => {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    if (previewEl) { previewEl.remove(); previewEl = null; }
  };

  fig.addEventListener('mouseenter', (evt) => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      hoverTimer = setTimeout(() => showPreview(evt), 550);
    }
  });
  fig.addEventListener('mousemove', (evt) => { if (previewEl) positionPreview(evt, previewEl); });
  fig.addEventListener('mouseleave', hidePreview);
  fig.addEventListener('click', hidePreview);
}
