// ── Image Gallery Module ────────────────────────────────────
// Extracted from app.js — Image/Video gallery management
'use strict';

let currentImages = [];

async function loadImages() {
  try {
    currentImages = await desktop.images.list() || [];
  } catch (e) {
    console.warn('[images] Laden fehlgeschlagen:', e.message);
    currentImages = [];
  }
  renderImages();
}

function renderImages() {
  // Hide the whole sidebar section (header included, same pattern as
  // updateSidebarForProvider()'s skills/agents/mcp sections) when the images
  // folder is empty — an always-visible, always-empty gallery is just noise
  // in an already crowded sidebar.
  const section = document.getElementById('imagesSection');
  if (section) section.style.display = currentImages.length ? '' : 'none';

  const container = document.getElementById('imageGallery');
  if (currentImages.length === 0) {
    container.innerHTML = `<div class="image-gallery__empty">${emptyStateHtml('🖼️', 'Keine Bilder/Videos vorhanden')}</div>`;
    return;
  }

  container.innerHTML = currentImages.map((img, i) => {
    if (img.type === 'video') {
      return `
      <div class="image-gallery__thumb image-gallery__thumb--video" data-tooltip="${escapeHtml(img.name)}" data-index="${i}">
        <div class="image-gallery__video-icon">🎬</div>
        <span class="image-gallery__video-name">${escapeHtml(img.name.length > 15 ? img.name.slice(0, 12) + '…' : img.name)}</span>
        <button class="image-gallery__thumb-extract" data-index="${i}" data-tooltip="Frames extrahieren">🖼️</button>
        <button class="image-gallery__thumb-delete" data-index="${i}" data-tooltip="Löschen">✕</button>
      </div>`;
    }
    return `
    <div class="image-gallery__thumb" data-tooltip="${escapeHtml(img.name)}" data-index="${i}">
      <img src="file:///${img.path.replace(/\\/g, '/')}" alt="${escapeHtml(img.name)}" loading="lazy" />
      <button class="image-gallery__thumb-delete" data-index="${i}" data-tooltip="Löschen">✕</button>
    </div>`;
  }).join('');

  // Event delegation
  container.querySelectorAll('.image-gallery__thumb').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('image-gallery__thumb-delete')) return;
      if (e.target.classList.contains('image-gallery__thumb-extract')) return;
      const img = currentImages[el.dataset.index];
      if (!img) return;
      if (img.type === 'video') {
        extractVideoFrames(img);
      } else {
        openLightbox(img.path, img.name);
      }
    });
  });
  container.querySelectorAll('.image-gallery__thumb-extract').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const img = currentImages[btn.dataset.index];
      if (img) extractVideoFrames(img);
    });
  });
  container.querySelectorAll('.image-gallery__thumb-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const img = currentImages[btn.dataset.index];
      if (img) deleteImage(img.path);
    });
  });
}

async function extractVideoFrames(video) {
  showNotification('🎬 Frames werden extrahiert…', 'info');
  try {
    const result = await desktop.videos.extractFrames(video.path, { interval: 1, maxFrames: 30 });
    if (!result.success) {
      showNotification(`❌ ${result.error}`, 'error');
      return;
    }
    const cached = result.cached ? ' (Cache)' : '';
    showNotification(`✅ ${result.count} Frames extrahiert${cached} (${result.duration || '?'}s Video)`, 'success');
    openFrameViewer(result.frames, video.name);
  } catch (e) {
    showNotification(`❌ Fehler: ${e.message}`, 'error');
  }
}

function openFrameViewer(frames, videoName) {
  const lb = document.getElementById('imageLightbox');
  const img = document.getElementById('lightboxImg');
  const info = document.getElementById('lightboxInfo');

  let currentFrame = 0;

  function showFrame(idx) {
    currentFrame = Math.max(0, Math.min(idx, frames.length - 1));
    img.src = 'file:///' + frames[currentFrame].replace(/\\/g, '/');
    info.textContent = `${videoName} — Frame ${currentFrame + 1}/${frames.length}`;
  }

  showFrame(0);
  lb.classList.add('image-lightbox--visible');

  function onKey(e) {
    if (!lb.classList.contains('image-lightbox--visible')) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { showFrame(currentFrame + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { showFrame(currentFrame - 1); e.preventDefault(); }
    else if (e.key === 'Home') { showFrame(0); e.preventDefault(); }
    else if (e.key === 'End') { showFrame(frames.length - 1); e.preventDefault(); }
    else if (e.key === 'Escape') {
      lb.classList.remove('image-lightbox--visible');
      document.removeEventListener('keydown', onKey);
    }
  }
  document.addEventListener('keydown', onKey);
}

function openLightbox(filePath, name) {
  const lb = document.getElementById('imageLightbox');
  const img = document.getElementById('lightboxImg');
  const info = document.getElementById('lightboxInfo');
  img.src = 'file:///' + filePath.replace(/\\/g, '/');
  info.textContent = name;
  lb.classList.add('image-lightbox--visible');
}

function closeLightbox(e) {
  if (e && e.target !== document.getElementById('imageLightbox') && !e.target.classList.contains('image-lightbox__close')) return;
  document.getElementById('imageLightbox').classList.remove('image-lightbox--visible');
}

async function deleteImage(filePath) {
  try {
    await desktop.images.delete(filePath);
  } catch (e) {
    console.warn('[images] Löschen fehlgeschlagen:', e.message);
    showNotification('Bild konnte nicht gelöscht werden', 'error');
    return;
  }
  await loadImages();
}

function openImagesFolder() {
  desktop.images.openFolder();
}
