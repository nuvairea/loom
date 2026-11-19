import * as dom from './dom.js';
import * as storage from './storage.js';
import { validateImage } from './validation.js';
import { optimizeImage, ImageTooLargeError } from './optimize.js';
import { createMoodboardItem, updateEmptyMessage } from './moodboard.js';
import { exportMoodboard, shareMoodboard } from './export.js';

const images = [];
let restoring = true;
let lastSavedOrder = '';

const grid = new Muuri(dom.masonry, {
  dragEnabled: true,
  layout: { fillGaps: true },
  dragStartPredicate: { distance: 10, delay: 0, handle: '.item-content' },
  dragCssProps: { touchAction: 'none' }
});

grid.on('dragStart', (item) => {
  item.getElement().style.opacity = '0.85';
});

grid.on('dragEnd', (item) => {
  item.getElement().style.opacity = '1';
  saveGridOrder();
});

grid.on('layoutEnd', saveGridOrder);

function showToast(message, duration = 2500) {
  const toast = document.createElement('div');
  toast.className = 'loom-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 50);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function currentOrder() {
  return grid.getItems().map(item => item.getElement().dataset.entryId).filter(Boolean);
}

function saveGridOrder() {
  if (restoring) return;
  const order = currentOrder();
  const key = order.join(',');
  if (!order.length || key === lastSavedOrder) return;
  lastSavedOrder = key;
  storage.updatePositions(order).catch(err => console.warn('Failed to save order:', err));
}

function showSaveError(err) {
  const full = err instanceof storage.StorageFullError;
  showModal({
    title: full ? 'Storage is full.' : 'Could not save image.',
    message: full
      ? 'Remove some images or free up browser storage, then try again.'
      : 'Your browser could not save this image. Free up browser storage and try again.',
    actions: [{ label: 'Got it', style: 'primary' }]
  });
}

function showModal({ title, message, actions }) {
  const overlay = document.createElement('div');
  overlay.className = 'loom-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'loom-modal';

  const titleEl = document.createElement('p');
  titleEl.className = 'loom-modal-title';
  titleEl.textContent = title;

  const messageEl = document.createElement('p');
  messageEl.className = 'loom-modal-message';
  messageEl.textContent = message;

  const actionsEl = document.createElement('div');
  actionsEl.className = 'loom-modal-actions';

  actions.forEach(({ label, style, onClick }) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = `loom-modal-btn ${style || ''}`;
    btn.addEventListener('click', () => {
      overlay.remove();
      onClick?.();
    });
    actionsEl.appendChild(btn);
  });

  modal.appendChild(titleEl);
  modal.appendChild(messageEl);
  modal.appendChild(actionsEl);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
}

async function addImageFromURL() {
  const url = dom.urlInput.value.trim();
  if (!url) return;

  const isValid = await validateImage(url);
  if (!isValid) {
    dom.urlInput.value = '';
    dom.urlInput.placeholder = 'Invalid image URL';
    return;
  }

  let entry;
  try {
    entry = await storage.addEntry({ type: 'url', url });
  } catch (err) {
    console.warn('Failed to save image:', err);
    showSaveError(err);
    return;
  }

  images.push(url);
  createMoodboardItem({ url, images, grid, showModal, meta: { entryId: entry.id } });

  dom.urlInput.value = '';
  dom.urlInput.placeholder = 'Image URL';
}

async function addImageFromFile(file) {
  if (!file || !file.type.startsWith('image/')) return;

  let blob;
  try {
    blob = await optimizeImage(file);
  } catch (err) {
    console.warn('Failed to process image:', err);
    showModal(err instanceof ImageTooLargeError
      ? { title: 'Image too large.', message: `${file.name} is over 20MB. Try a smaller image.`, actions: [{ label: 'Got it', style: 'primary' }] }
      : { title: 'Could not read image.', message: `${file.name} could not be processed. Try a different image.`, actions: [{ label: 'Got it', style: 'primary' }] });
    return;
  }

  let entry;
  try {
    entry = await storage.addEntry({ type: 'file', blob, name: file.name, size: blob.size });
  } catch (err) {
    console.warn('Failed to save uploaded image:', err);
    showSaveError(err);
    return;
  }

  const url = URL.createObjectURL(blob);
  images.push(url);
  createMoodboardItem({ url, images, grid, showModal, revokeOnRemove: true, meta: { entryId: entry.id } });
}

dom.addBtn.addEventListener('click', addImageFromURL);

dom.urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addImageFromURL();
  }
});

function openFilePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;

  input.onchange = () => {
    Array.from(input.files).forEach(file => addImageFromFile(file));
  };

  input.click();
}

dom.uploadBtn.addEventListener('click', openFilePicker);

dom.clearBtn.addEventListener('click', () => {
  if (images.length === 0) {
    showModal({
      title: 'Nothing here yet.',
      message: 'Add some images to your weave first.',
      actions: [{ label: 'Got it', style: 'primary' }]
    });
    return;
  }

  showModal({
    title: 'Unweave everything?',
    message: 'This will remove all images from your board. This can\'t be undone.',
    actions: [
      {
        label: 'Unweave',
        style: 'danger',
        onClick: () => {
          const items = grid.getItems();
          const wrappers = Array.from(dom.masonry.querySelectorAll('.moodboard-item'));
          const blobUrls = wrappers.map(wrapper => wrapper.querySelector('img')?.src)
            .filter(src => src?.startsWith('blob:'));
          let removedCount = 0;
          let removalFinished = false;

          const finishRemoval = () => {
            if (removalFinished) return;
            removalFinished = true;

            grid.remove(items, { removeElements: true });
            wrappers.forEach(wrapper => wrapper.remove());
            blobUrls.forEach(url => URL.revokeObjectURL(url));
            images.length = 0;
            storage.clearEntries().catch(err => console.warn('clearEntries failed', err));
            updateEmptyMessage(images, openFilePicker);
          };
          if (wrappers.length === 0) {
            finishRemoval();
            return;
          }

          wrappers.forEach(wrapper => {
            wrapper.classList.add('fade-out');
            wrapper.addEventListener('transitionend', function handler(event) {
              if (event.propertyName !== 'opacity') return;
              wrapper.removeEventListener('transitionend', handler);
              removedCount += 1;
              if (removedCount === wrappers.length) finishRemoval();
            });
          });

          setTimeout(finishRemoval, 450);
        }
      },
      { label: 'Cancel', style: 'primary' }
    ]
  });
});

dom.exportBtn.addEventListener('click', () =>
  exportMoodboard(dom.masonry, showModal)
);

dom.shareBtn.addEventListener('click', () =>
  shareMoodboard(dom.masonry, showModal)
);

async function restoreState() {
  let entries = [];
  try {
    await storage.init();
    entries = await storage.loadEntries();
  } catch (err) {
    console.warn('Failed to restore state:', err);
    showToast('Storage is unavailable. Changes will not be saved.');
  }

  const positions = new Map(entries.map(entry => [entry.id, entry.position]));
  const settled = [];

  entries.forEach(entry => {
    let url = null;
    let revokeOnRemove = false;

    if (entry.type === 'url' && entry.url) {
      url = entry.url;
    } else if (entry.type === 'file' && entry.blob) {
      url = URL.createObjectURL(entry.blob);
      revokeOnRemove = true;
    }
    if (!url) return;

    images.push(url);
    settled.push(createMoodboardItem({ url, images, grid, showModal, revokeOnRemove, meta: { entryId: entry.id } }));
  });

  if (settled.length > 0) {
    showToast(`Restored ${settled.length} image${settled.length !== 1 ? 's' : ''} from your weave`);
  }
  updateEmptyMessage(images, openFilePicker);

  await Promise.all(settled);
  const rank = item => positions.get(item.getElement().dataset.entryId) ?? Infinity;
  grid.sort((a, b) => rank(a) - rank(b));
  lastSavedOrder = currentOrder().join(',');
  restoring = false;
}

restoreState();
