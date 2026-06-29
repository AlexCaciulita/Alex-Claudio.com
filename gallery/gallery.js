(function () {
  'use strict';

  const CATEGORY_LABELS = {
    engagement: 'Engagement Session',
    wedding: 'Wedding Day'
  };
  const CATEGORY_ORDER = ['engagement', 'wedding'];
  // zip.js streams each photo from the network straight into the archive (and,
  // where supported, straight to disk), so a full wedding gallery of several GB
  // never has to be held in memory at once — unlike a build-the-whole-blob zipper.
  const ZIPJS_CDN = 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.57/dist/zip.min.js';

  const statusEl = document.getElementById('galleryStatus');
  const headerEl = document.getElementById('galleryHeader');
  const titleEl = document.getElementById('galleryTitle');
  const dateEl = document.getElementById('galleryDate');
  const messageEl = document.getElementById('galleryMessage');
  const tabsEl = document.getElementById('galleryTabs');
  const sectionsEl = document.getElementById('gallerySections');
  const heroEl = document.getElementById('galleryHero');
  const heroImg = document.getElementById('galleryHeroImg');
  const heroTitleEl = document.getElementById('galleryHeroTitle');
  const heroDateEl = document.getElementById('galleryHeroDate');

  const lightboxOverlay = document.getElementById('lightboxOverlay');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');
  const lightboxDownload = document.getElementById('lightboxDownload');

  let currentList = [];
  let currentIndex = 0;
  let zipjsPromise = null;

  let galleryData = null;
  let activeCategories = [];
  const builtSections = {};

  // Load images via IntersectionObserver rather than native loading="lazy":
  // the native version is unreliable inside CSS multi-column (masonry) layouts
  // and leaves many tiles unloaded. rootMargin pre-loads just ahead of scroll.
  const lazyObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const im = entry.target;
          if (im.dataset.src) im.src = im.dataset.src;
          obs.unobserve(im);
        });
      }, { rootMargin: '800px 0px' })
    : null;

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

  // When a hero image is set, the couple's name + date are shown over the hero,
  // so the plain text header only carries the message (if any).
  function renderHero(data) {
    if (!data.hero) {
      heroEl.hidden = true;
      return false;
    }
    heroImg.src = data.hero;
    heroImg.alt = data.name ? `${data.name} — gallery hero` : 'Gallery hero image';
    heroTitleEl.textContent = data.name || '';
    heroTitleEl.hidden = !data.name;
    const dateText = formatDate(data.date);
    heroDateEl.textContent = dateText;
    heroDateEl.hidden = !dateText;
    heroEl.hidden = false;
    return true;
  }

  function renderHeader(data, heroShown) {
    const showTitle = !heroShown && !!data.name;
    const showDate = !heroShown && !!formatDate(data.date);
    const showMessage = !!data.message;
    if (!showTitle && !showDate && !showMessage) {
      headerEl.hidden = true;
      return;
    }
    titleEl.textContent = data.name || '';
    titleEl.hidden = !showTitle;
    const dateText = formatDate(data.date);
    dateEl.textContent = dateText;
    dateEl.hidden = !showDate;
    messageEl.textContent = data.message || '';
    messageEl.hidden = !showMessage;
    headerEl.hidden = false;
  }

  function buildTabs(categories) {
    tabsEl.innerHTML = '';
    if (categories.length < 2) {
      tabsEl.hidden = true;
      return;
    }
    categories.forEach((cat) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gallery-tab';
      btn.textContent = CATEGORY_LABELS[cat];
      btn.dataset.cat = cat;
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => switchTo(cat));
      tabsEl.appendChild(btn);
    });
    tabsEl.hidden = false;
  }

  // Show one category at a time. Each section's DOM (and therefore its images)
  // is built only the first time its tab is opened, so the initial page load
  // only fetches photos for the active category instead of all of them.
  function switchTo(category) {
    if (!activeCategories.includes(category)) {
      category = activeCategories[0];
    }
    Array.from(tabsEl.children).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.cat === category);
    });
    if (!builtSections[category]) {
      const section = renderSection(category, galleryData[category]);
      sectionsEl.appendChild(section);
      builtSections[category] = section;
    }
    Object.keys(builtSections).forEach((cat) => {
      builtSections[cat].hidden = cat !== category;
    });
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', `#${category}`);
    }
    window.scrollTo({ top: 0 });
  }

  // Size a grid-masonry tile to its photo's real height by spanning the right
  // number of grid rows. Skipped while the tile is hidden (height would be 0).
  function setTileSpan(tile) {
    if (!tile || tile.offsetParent === null) return;
    const img = tile.querySelector('img');
    const grid = tile.parentElement;
    if (!img || !img.complete || !img.naturalHeight || !grid) return;
    const styles = getComputedStyle(grid);
    const rowH = parseFloat(styles.gridAutoRows) || 4;
    const gap = parseFloat(styles.rowGap) || 0;
    const h = img.getBoundingClientRect().height;
    if (!h) return;
    const span = Math.max(1, Math.ceil((h + gap) / (rowH + gap)));
    tile.style.gridRowEnd = `span ${span}`;
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

    // Prefer a pre-built archive when one exists: a plain native download that
    // streams from the same-origin /cdn proxy straight to disk, so it works on
    // every device (incl. iOS Safari) regardless of gallery size. Only when no
    // archive has been built do we fall back to zipping in the browser.
    const prebuilt = galleryData.zips && galleryData.zips[category];
    if (prebuilt) {
      const dlAll = document.createElement('a');
      dlAll.className = 'gallery-download-all';
      dlAll.href = prebuilt.url;
      dlAll.setAttribute('download', `${getSlug()}-${category}.zip`);
      dlAll.textContent = 'Download all';
      meta.appendChild(dlAll);
    } else {
      const downloadAllBtn = document.createElement('button');
      downloadAllBtn.type = 'button';
      downloadAllBtn.className = 'gallery-download-all';
      downloadAllBtn.textContent = 'Download all';
      downloadAllBtn.addEventListener('click', () => downloadAll(category, photos, downloadAllBtn));
      meta.appendChild(downloadAllBtn);
    }

    head.appendChild(meta);
    section.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';
    photos.forEach((photo, idx) => {
      const tile = document.createElement('figure');
      tile.className = 'gallery-tile';

      const img = document.createElement('img');
      img.decoding = 'async';
      img.alt = photo.name;
      img.dataset.src = photo.url;
      img.addEventListener('load', () => {
        img.classList.add('is-loaded');
        setTileSpan(tile);
      });
      img.addEventListener('click', () => openLightbox(photos, idx));
      if (lazyObserver) {
        lazyObserver.observe(img);
      } else {
        img.src = photo.url;
      }
      tile.appendChild(img);

      const dl = document.createElement('a');
      dl.className = 'gallery-tile-download';
      dl.href = photo.downloadUrl || photo.url;
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
    lightboxDownload.href = photo.downloadUrl || photo.url;
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

  function loadZipJs() {
    if (zipjsPromise) return zipjsPromise;
    zipjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ZIPJS_CDN;
      s.onload = () => resolve(window.zip);
      s.onerror = () => reject(new Error('Failed to load zip.js'));
      document.head.appendChild(s);
    });
    return zipjsPromise;
  }

  // Above this total, building the archive as one in-memory Blob is unsafe on
  // browsers without the File System Access API: WebKit caps a single allocation
  // near 2GB and iOS Safari kills the tab well under 1GB — with no catchable
  // error, so the progress counter completes and then nothing downloads. Rather
  // than dead-end the customer, we steer them to a path that actually works.
  const SAFE_BLOB_LIMIT = 300 * 1024 * 1024;

  function setDownloadNote(btn, message) {
    const meta = btn.parentElement;
    if (!meta) return;
    let note = meta.querySelector('.gallery-download-note');
    if (!message) { if (note) note.remove(); return; }
    if (!note) {
      note = document.createElement('p');
      note.className = 'gallery-download-note';
      meta.appendChild(note);
    }
    note.textContent = message;
  }

  async function downloadAll(category, photos, btn) {
    const originalText = btn.textContent;
    const slug = getSlug();
    const filename = `${slug}-${category}.zip`;
    const canStreamToDisk = typeof window.showSaveFilePicker === 'function';
    const totalBytes = photos.reduce((sum, p) => sum + (p.size || 0), 0);

    // Safety net for large galleries on Safari/iOS/Firefox: don't attempt an
    // in-memory zip that will silently fail — tell the customer what does work.
    if (!canStreamToDisk && totalBytes > SAFE_BLOB_LIMIT) {
      setDownloadNote(btn, 'This browser can’t bundle a gallery this large into one file. Tap the download arrow on each photo to save it, or open this gallery in Chrome on a computer to get everything in one zip.');
      return;
    }
    setDownloadNote(btn, '');

    // Open the save-to-disk stream first, while we still hold the click's user
    // activation (showSaveFilePicker requires it). When available (Chromium
    // browsers) the zip is written straight to disk and never buffered, so
    // gallery size is irrelevant. Other browsers fall back to a disk-backed Blob.
    let writableStream = null;
    if (canStreamToDisk) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }]
        });
        writableStream = await handle.createWritable();
      } catch (err) {
        if (err && err.name === 'AbortError') return; // user cancelled the dialog
        writableStream = null; // blocked/unsupported → fall back to Blob
      }
    }

    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      const zip = await loadZipJs();

      // Store (level 0): these are JPEGs, already compressed — skipping deflate
      // saves CPU/time and avoids re-compressing for no size gain.
      let blobWriter = null;
      let zipWriter;
      if (writableStream) {
        zipWriter = new zip.ZipWriter(writableStream, { level: 0 });
      } else {
        blobWriter = new zip.BlobWriter('application/zip');
        zipWriter = new zip.ZipWriter(blobWriter, { level: 0 });
      }

      let done = 0;
      for (const photo of photos) {
        const fetchUrl = photo.downloadUrl || photo.url;
        await zipWriter.add(photo.name, new zip.HttpReader(fetchUrl));
        done++;
        btn.textContent = `Adding ${done}/${photos.length}…`;
      }

      btn.textContent = 'Finishing…';
      const blob = await zipWriter.close();

      // Blob fallback: hand the finished archive to the browser as a download.
      if (blobWriter) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      btn.textContent = 'Downloaded ✓';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2500);
    } catch (err) {
      console.error(err);
      btn.textContent = 'Download failed — try again';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 3500);
    }
  }

  function renderNotFound() {
    heroEl.hidden = true;
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
      activeCategories = CATEGORY_ORDER.filter((c) => Array.isArray(data[c]) && data[c].length > 0);
      if (!activeCategories.length) {
        renderNotFound();
        return;
      }
      galleryData = data;
      const heroShown = renderHero(data);
      renderHeader(data, heroShown);
      buildTabs(activeCategories);
      sectionsEl.innerHTML = '';
      sectionsEl.hidden = false;
      const requested = (window.location.hash || '').replace('#', '');
      switchTo(activeCategories.includes(requested) ? requested : activeCategories[0]);
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

  // Recompute masonry spans when the column count / width changes.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      document.querySelectorAll('.gallery-tile').forEach((tile) => setTileSpan(tile));
    }, 150);
  });

  loadGallery();
})();
