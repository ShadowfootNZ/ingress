// bannergress-portal-images.js
// Fetches banner data from the Bannergress API given a banner URL, then renders
// each mission's portal images in scrollable rows with hover previews. Also supports
// bulk download of all portal images as a zip file.

import { safeFilename, guessExtensionFromUrl, buildDownloadList, downloadBlob, attachHoverPreview } from './shared.js';

(async () => {
  const status = document.getElementById('status');
  const container = document.getElementById('missions');
  const input = document.getElementById('jsonUrl');
  const loadBtn = document.getElementById('loadBtn');
  const downloadPortalsBtn = document.getElementById('downloadPortals');
  const downloadMissionsBtn = document.getElementById('downloadMissions');

  let currentBannerUrl = null;
  let currentData = null;

  downloadPortalsBtn.disabled = true;
  downloadMissionsBtn.disabled = true;

  const clearMissions = () => { container.innerHTML = ''; };

  const renderMissions = (data) => {
    let total = 0;
    let imageCount = 0;
    const frag = document.createDocumentFragment();

    data.missions.forEach((m, mi) => {
      const portals = m.portals || [];
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

      if (m.missionImage) {
        const mFig = document.createElement('figure');
        mFig.className = 'tile mission-tile';
        const mBadge = document.createElement('div');
        mBadge.className = 'badge';
        mBadge.textContent = `M${mi + 1}`;
        mFig.appendChild(mBadge);
        const mA = document.createElement('a');
        mA.className = 'thumb-link';
        mA.href = m.missionImage;
        mA.target = '_blank';
        mA.rel = 'noopener';
        const mImg = document.createElement('img');
        mImg.className = 'thumb';
        mImg.src = m.missionImage;
        mImg.alt = m.missionTitle || `Mission ${mi + 1}`;
        mImg.loading = 'lazy';
        mA.appendChild(mImg);
        mFig.appendChild(mA);
        attachHoverPreview(mFig, m.missionImage, m.missionTitle || `Mission ${mi + 1}`);
        const mCap = document.createElement('figcaption');
        mCap.innerHTML = `<strong>${m.missionTitle || `Mission ${mi + 1}`}</strong>`;
        mFig.appendChild(mCap);
        tilesDiv.appendChild(mFig);
      }

      portals.forEach((p, pi) => {
        total++;
        const hasImage = Boolean(p && p.imageUrl);
        if (hasImage) imageCount++;

        const fig = document.createElement('figure');
        fig.className = 'tile';

        const badge = document.createElement('div');
        badge.className = 'badge';
        const title = p.title || 'Untitled';
        badge.textContent = `${mi + 1}-${pi + 1}`;
        fig.appendChild(badge);

        if (hasImage) {
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

          attachHoverPreview(fig, p.imageUrl, title);
        } else {
          const missing = document.createElement('div');
          missing.className = 'thumb thumb-missing';
          missing.textContent = 'No image available';
          fig.appendChild(missing);
        }

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

    if (total === 0) {
      status.textContent = 'No mission portals found.';
    } else if (imageCount === total) {
      status.textContent = `Loaded ${imageCount} images across ${data.missions.length} missions. Scroll down; each row scrolls sideways.`;
    } else {
      status.textContent = `Loaded ${imageCount}/${total} portal images across ${data.missions.length} missions; ${total - imageCount} portals have no image.`;
    }

    container.appendChild(frag);
  };

  const extractBannerId = (url) => {
    const clean = url.split('?')[0].split('#')[0].replace(/\/$/, '');
    if (clean.includes('/banner/')) return clean.split('/banner/').pop().split('/')[0];
    return clean.split('/').pop();
  };

  const loadAndRender = async (url) => {
    status.style.color = '';
    status.textContent = 'Loading…';
    clearMissions();

    const bannerId = extractBannerId(url);
    const apiUrl = `https://api.bannergress.com/bnrs/${bannerId}`;
    const res = await fetch(apiUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bData = await res.json();

    const data = {
      missions: Object.values(bData.missions).map(m => ({
        missionTitle: m.title,
        missionImage: m.picture || '',
        portals: m.steps.filter(s => s.poi).map(s => ({
          title: s.poi.title,
          imageUrl: s.poi.picture || '',
          location: { latitude: s.poi.latitude, longitude: s.poi.longitude }
        }))
      }))
    };

    currentBannerUrl = url;
    currentData = data;
    downloadPortalsBtn.disabled = false;
    downloadMissionsBtn.disabled = !data.missions.some(m => m.missionImage);
    renderMissions(data);
  };

  const buildMissionDownloadList = (data) => {
    const items = [];
    data.missions.forEach((m, mi) => {
      if (!m.missionImage) return;
      const ext = guessExtensionFromUrl(m.missionImage);
      items.push({
        filename: `M${mi + 1} ${safeFilename(m.missionTitle || `Mission ${mi + 1}`)}.${ext}`,
        url: m.missionImage
      });
    });
    return items;
  };

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBtn.click(); });

  loadBtn.addEventListener('click', async () => {
    try {
      const url = input.value.trim();
      if (!url) throw new Error('Please enter a Bannergress URL.');
      await loadAndRender(url);
    } catch (err) {
      console.error(err);
      status.textContent = `Error loading images: ${err.message}`;
      status.style.color = 'tomato';
    }
  });

  const runZipDownload = async (btn, list, zipName) => {
    btn.disabled = true;
    status.style.color = '';
    const zip = new window.JSZip();
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
    downloadBlob(`${safeFilename(zipName)}.zip`, await zip.generateAsync({ type: 'blob' }));
    status.textContent = `Downloaded zip. (${ok} ok, ${fail} failed)`;
  };

  downloadPortalsBtn.addEventListener('click', async () => {
    try {
      if (!window.JSZip) throw new Error('JSZip library not loaded (are you offline?).');
      if (!currentData) throw new Error('Nothing loaded yet.');
      const list = buildDownloadList(currentData);
      if (!list.length) throw new Error('No portal images found to download.');
      await runZipDownload(downloadPortalsBtn, list, `${extractBannerId(currentBannerUrl || 'portals')}-portals`);
    } catch (err) {
      console.error(err);
      status.textContent = `Download failed: ${err.message}`;
      status.style.color = 'tomato';
    } finally {
      downloadPortalsBtn.disabled = !currentData;
    }
  });

  downloadMissionsBtn.addEventListener('click', async () => {
    try {
      if (!window.JSZip) throw new Error('JSZip library not loaded (are you offline?).');
      if (!currentData) throw new Error('Nothing loaded yet.');
      const list = buildMissionDownloadList(currentData);
      if (!list.length) throw new Error('No mission images found to download.');
      await runZipDownload(downloadMissionsBtn, list, `${extractBannerId(currentBannerUrl || 'missions')}-missions`);
    } catch (err) {
      console.error(err);
      status.textContent = `Download failed: ${err.message}`;
      status.style.color = 'tomato';
    } finally {
      downloadMissionsBtn.disabled = !currentData?.missions.some(m => m.missionImage);
    }
  });
})();
