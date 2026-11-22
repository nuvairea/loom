import * as dom from './dom.js';
import * as storage from './storage.js';
import { validateImage } from './validation.js';
import { optimizeImage, ImageTooLargeError } from './optimize.js';
import { createMoodboardItem, updateEmptyMessage } from './moodboard.js';
import { exportMoodboard, shareMoodboard } from './export.js';
import { initBoards, setBoardName } from './boards.js';

const images = [];
let restoring = true;
let lastSavedOrder = '';
let touchArmed = false;
let touchArmTimer = 0;
let currentBoardId = null;
let loadEpoch = 0;
const BOARD_KEY = 'loom.board.v1';

const grid = new Muuri(dom.masonry, {
  dragEnabled: true,
  layout: { fillGaps: true },
  visibleStyles: { opacity: '1' },
  hiddenStyles: { opacity: '0' },
  dragStartPredicate: (item, e) => {
    if (e.pointerType !== 'touch') {
      return Muuri.ItemDrag.defaultStartPredicate(item, e, { distance: 10, delay: 0 });
    }

    if (e.isFirst) {
      touchArmed = false;
      clearTimeout(touchArmTimer);
      touchArmTimer = setTimeout(() => { touchArmed = true; }, 250);
    }
    if (e.isFinal) {
      clearTimeout(touchArmTimer);
      touchArmed = false;
      return false;
    }

    if (e.srcEvent && e.srcEvent.cancelable === false) {
      clearTimeout(touchArmTimer);
      touchArmed = false;
      return false;
    }
    return touchArmed ? true : undefined;
  },
  dragCssProps: { touchAction: 'pan-y' }
});

grid.on('dragEnd', saveGridOrder);

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
  const boardId = currentBoardId;

  const isValid = await validateImage(url);
  if (!isValid) {
    dom.urlInput.value = '';
    dom.urlInput.placeholder = 'Invalid image URL';
    return;
  }

  let entry;
  try {
    entry = await storage.addEntry({ boardId, type: 'url', url });
  } catch (err) {
    console.warn('Failed to save image:', err);
    showSaveError(err);
    return;
  }

  if (boardId !== currentBoardId) return;

  images.push(url);
  createMoodboardItem({ url, images, grid, showModal, meta: { entryId: entry.id } });

  dom.urlInput.value = '';
  dom.urlInput.placeholder = 'Paste image URL';
}

async function addImageFromFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const boardId = currentBoardId;

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
    entry = await storage.addEntry({ boardId, type: 'file', blob, name: file.name, size: blob.size });
  } catch (err) {
    console.warn('Failed to save uploaded image:', err);
    showSaveError(err);
    return;
  }

  if (boardId !== currentBoardId) return;

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
            storage.clearEntries(currentBoardId).catch(err => console.warn('clearEntries failed', err));
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

function clearGrid() {
  const blobUrls = Array.from(dom.masonry.querySelectorAll('.moodboard-item img'))
    .map(img => img.src)
    .filter(src => src.startsWith('blob:'));

  grid.remove(grid.getItems(), { removeElements: true });
  dom.masonry.querySelectorAll('.moodboard-item').forEach(wrapper => wrapper.remove());
  blobUrls.forEach(url => URL.revokeObjectURL(url));
  images.length = 0;
  lastSavedOrder = '';
}

function rememberBoard(id) {
  try {
    localStorage.setItem(BOARD_KEY, id);
  } catch (err) {
    console.warn('Failed to remember board:', err);
  }
  history.replaceState(null, '', `#${id}`);
}

async function loadBoard(id) {
  const epoch = ++loadEpoch;
  restoring = true;
  clearGrid();
  currentBoardId = id;
  rememberBoard(id);

  let board = null;
  let entries = [];
  try {
    [board, entries] = await Promise.all([storage.getBoard(id), storage.loadEntries(id)]);
  } catch (err) {
    console.warn('Failed to load board:', err);
    showToast('Could not load this board.');
  }
  if (epoch !== loadEpoch) return;

  setBoardName(board?.title || 'My weave');

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

  updateEmptyMessage(images, openFilePicker);

  await Promise.all(settled);
  if (epoch !== loadEpoch) return;

  const rank = item => positions.get(item.getElement().dataset.entryId) ?? Infinity;
  grid.sort((a, b) => rank(a) - rank(b));
  lastSavedOrder = currentOrder().join(',');
  restoring = false;
}

async function restoreState() {
  let boardId = null;
  try {
    await storage.init();
    const boards = await storage.listBoards();
    let wanted = location.hash.slice(1);
    if (!wanted) {
      try {
        wanted = localStorage.getItem(BOARD_KEY) || '';
      } catch {
        wanted = '';
      }
    }
    boardId = (boards.find(board => board.id === wanted) || boards[0])?.id ?? null;
  } catch (err) {
    console.warn('Failed to restore state:', err);
    showToast('Storage is unavailable. Changes will not be saved.');
  }

  if (boardId) {
    await loadBoard(boardId);
  } else {
    updateEmptyMessage(images, openFilePicker);
    restoring = false;
  }
}

initBoards({
  getCurrentId: () => currentBoardId,
  switchTo: loadBoard,
  showModal,
  showToast
});

restoreState();
