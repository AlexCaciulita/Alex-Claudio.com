(function () {
  'use strict';

  const CATEGORY_LABELS = {
    engagement: 'Engagement Session',
    wedding: 'Wedding Day'
  };
  const CATEGORY_ORDER = ['engagement', 'wedding'];
  const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

  const statusEl = document.getElementById('galleryStatus');
  const headerEl = document.getElementById('galleryHeader');
  const titleEl = document.getElementById('galleryTitle');
  const dateEl = document.getElementById('galleryDate');
  const messageEl = document.getElementById('galleryMessage');
  const tabsEl = document.getElementById('galleryTabs');
  const sectionsEl = document.getElementById('gallerySections');

  const lightboxOverlay = document.getElementById('lightboxOverlay');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');
  const lightboxDownload = document.getElementById('lightboxDownload');

  let currentList = [];
  let currentIndex = 0;
  let jszipPromise = null;

  function showStatus(html) {
    statusEl.innerHTML = html;
    statusEl.hidden = false;
  }

  function hideStatus() {
    statusEl.hidden = true;
  }

  function getSlug() {
    const params = new URLSearchParams(window.location.search);
    return params.get('c') || '';
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function renderHeader(data) {
    const hasAny = data.name || data.date || data.message;
    if (!hasAny) {
      headerEl.hidden = true;
      return;
    }
    titleEl.textContent = data.name || '';
    titleEl.hidden = !data.name;
    const dateText = formatDate(data.date);
    dateEl.textContent = dateText;
    dateEl.hidden = !dateText;
    messageEl.textContent = data.message || '';
    messageEl.hidden = !data.message;
    headerEl.hidden = false;
  }

  function buildTabs(activeCategories) {
    tabsEl.innerHTML = '';
    if (activeCategories.length < 2) {
      tabsEl.hidden = true;
      return;
    }
    activeCategories.forEach((cat, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gallery-tab' + (idx === 0 ? ' active' : '');
      btn.textContent = CATEGORY_LABELS[cat];
      btn.dataset.target = `section-${cat}`;
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      tabsEl.appendChild(btn);
    });
    tabsEl.hidden = false;
  }

  function renderSection(category, photos) {
    const section = document.createElement('section');
    section.className = 'gallery-section';
    section.id = `section-${category}`;

    const head = document.createElement('div');
    head.className = 'gallery-section-head';

    const heading = document.createElement('h2');
    heading.className = 'gallery-section-title';
    heading.textContent = CATEGORY_LABELS[category];
    head.appendChild(heading);

    const meta = document.createElement('div');
    meta.className = 'gallery-section-meta';

    const count = document.createElement('span');
    count.className = 'gallery-count';
    count.textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'}`;
    meta.appendChild(count);

    const downloadAllBtn = document.createElement('button');
    downloadAllBtn.type = 'button';
    downloadAllBtn.className = 'gallery-download-all';
    downloadAllBtn.textContent = 'Download all';
    downloadAllBtn.addEventListener('click', () => downloadAll(category, photos, downloadAllBtn));
    meta.appendChild(downloadAllBtn);

    head.appendChild(meta);
    section.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';
    photos.forEach((photo, idx) => {
      const tile = document.createElement('figure');
      tile.className = 'gallery-tile';

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = photo.url;
      img.alt = photo.name;
      img.addEventListener('click', () => openLightbox(photos, idx));
      tile.appendChild(img);

      const dl = document.createElement('a');
      dl.className = 'gallery-tile-download';
      dl.href = photo.url;
      dl.download = photo.name;
      dl.setAttribute('aria-label', `Download ${photo.name}`);
      dl.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      tile.appendChild(dl);

      grid.appendChild(tile);
    });
    section.appendChild(grid);

    return section;
  }

  function openLightbox(list, index) {
    currentList = list;
    currentIndex = index;
    updateLightboxImage();
    lightboxOverlay.classList.remove('hidden');
    document.body.classList.add('lightbox-open');
  }

  function closeLightbox() {
    lightboxOverlay.classList.add('hidden');
    document.body.classList.remove('lightbox-open');
  }

  function updateLightboxImage() {
    if (!currentList.length) return;
    const photo = currentList[currentIndex];
    lightboxImage.src = photo.url;
    lightboxImage.alt = photo.name;
    lightboxDownload.href = photo.url;
    lightboxDownload.setAttribute('download', photo.name);
  }

  function showPrev() {
    if (!currentList.length) return;
    currentIndex = (currentIndex - 1 + currentList.length) % currentList.length;
    updateLightboxImage();
  }

  function showNext() {
    if (!currentList.length) return;
    currentIndex = (currentIndex + 1) % currentList.length;
    updateLightboxImage();
  }

  function loadJSZip() {
    if (jszipPromise) return jszipPromise;
    jszipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSZIP_CDN;
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => reject(new Error('Failed to load JSZip'));
      document.head.appendChild(s);
    });
    return jszipPromise;
  }

  async function downloadAll(category, photos, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      let done = 0;
      for (const photo of photos) {
        const res = await fetch(photo.url, { mode: 'cors' });
        if (!res.ok) throw new Error(`Failed: ${photo.name}`);
        const blob = await res.blob();
        zip.file(photo.name, blob);
        done++;
        btn.textContent = `Downloading ${done}/${photos.length}…`;
      }
      btn.textContent = 'Zipping…';
      const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        btn.textContent = `Zipping ${Math.round(meta.percent)}%`;
      });
      const slug = getSlug();
      const filename = `${slug}-${category}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      btn.textContent = 'Downloaded ✓';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2500);
    } catch (err) {
      console.error(err);
      btn.textContent = 'Download failed — try again';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 3500);
    }
  }

  function renderNotFound() {
    headerEl.hidden = true;
    tabsEl.hidden = true;
    sectionsEl.hidden = true;
    showStatus(`
      <h1 class="gallery-status-title">Gallery not found</h1>
      <p>This link may be incorrect or expired. Please double-check the link your photographer sent you, or get in touch.</p>
      <p><a class="gallery-status-link" href="/">Return home</a></p>
    `);
  }

  function renderError() {
    showStatus(`
      <h1 class="gallery-status-title">Something went wrong</h1>
      <p>We couldn't load your gallery right now. Please try refreshing in a moment.</p>
    `);
  }

  async function loadGallery() {
    const slug = getSlug();
    if (!slug) {
      renderNotFound();
      return;
    }
    try {
      const res = await fetch(`/.netlify/functions/list-gallery?c=${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        renderNotFound();
        return;
      }
      if (!res.ok) {
        renderError();
        return;
      }
      const data = await res.json();
      const activeCategories = CATEGORY_ORDER.filter((c) => Array.isArray(data[c]) && data[c].length > 0);
      if (!activeCategories.length) {
        renderNotFound();
        return;
      }
      renderHeader(data);
      buildTabs(activeCategories);
      sectionsEl.innerHTML = '';
      activeCategories.forEach((cat) => {
        sectionsEl.appendChild(renderSection(cat, data[cat]));
      });
      sectionsEl.hidden = false;
      hideStatus();
    } catch (err) {
      console.error(err);
      renderError();
    }
  }

  lightboxOverlay.addEventListener('click', (e) => {
    if (e.target === lightboxOverlay) closeLightbox();
  });
  lightboxClose.addEventListener('click', closeLightbox);
  lightboxPrev.addEventListener('click', showPrev);
  lightboxNext.addEventListener('click', showNext);
  document.addEventListener('keydown', (e) => {
    if (lightboxOverlay.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') showPrev();
    if (e.key === 'ArrowRight') showNext();
  });

  loadGallery();
})();
