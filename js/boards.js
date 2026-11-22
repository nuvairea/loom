import * as dom from './dom.js';
import * as storage from './storage.js';

const NEW_BOARD_TITLE = 'Untitled board';
const MOBILE_QUERY = '(max-width: 600px)';

let ctx = null;
let panel = null;
let scrim = null;
let menu = null;
let menuScrim = null;
let previewUrls = [];
let renaming = false;
let renameCancelled = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name, className) {
  const node = el('span', `material-symbols-outlined${className ? ' ' + className : ''}`, name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function imageLabel(count) {
  return `${count} image${count === 1 ? '' : 's'}`;
}

export function initBoards(options) {
  ctx = options;

  dom.boardSwitch.addEventListener('click', () => (panel ? closePanel() : openPanel()));

  dom.boardTitle.addEventListener('input', fitTitle);
  dom.boardTitle.addEventListener('keydown', e => {
    if (e.key === 'Enter') dom.boardTitle.blur();
    if (e.key === 'Escape') {
      renameCancelled = true;
      dom.boardTitle.blur();
    }
  });
  dom.boardTitle.addEventListener('blur', commitRename);

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (menu) closeMenu();
    else if (panel) closePanel();
  });
}

export function setBoardName(name) {
  dom.boardName.textContent = name;
}

function fitTitle() {
  dom.boardTitle.size = Math.max(8, dom.boardTitle.value.length + 1);
}

// inline rename: the title chip turns into an input

export function startRename() {
  if (renaming) return;
  renaming = true;
  renameCancelled = false;
  dom.boardSwitch.classList.add('hidden');
  dom.boardTitle.classList.remove('hidden');
  dom.boardTitle.value = dom.boardName.textContent;
  fitTitle();
  dom.boardTitle.focus();
  dom.boardTitle.select();
}

async function commitRename() {
  if (!renaming) return;
  renaming = false;

  const name = dom.boardTitle.value.trim();
  dom.boardTitle.classList.add('hidden');
  dom.boardSwitch.classList.remove('hidden');
  if (renameCancelled || !name || name === dom.boardName.textContent) return;

  dom.boardName.textContent = name;
  try {
    await storage.renameBoard(ctx.getCurrentId(), name);
  } catch (err) {
    console.warn('Failed to rename board:', err);
    ctx.showToast('Could not rename board.');
  }
}

// switcher: dropdown on desktop, bottom sheet on phones 

function revokePreviews() {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = [];
}

function previewSource(entry) {
  if (entry.type === 'url') return entry.url;
  if (entry.blob) {
    const url = URL.createObjectURL(entry.blob);
    previewUrls.push(url);
    return url;
  }
  return null;
}

function positionPanel() {
  if (window.matchMedia(MOBILE_QUERY).matches) {
    panel.style.left = '';
    panel.style.top = '';
    return;
  }
  const rect = dom.boardSwitch.getBoundingClientRect();
  panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 352))}px`;
  panel.style.top = `${rect.bottom + 8}px`;
}

async function openPanel() {
  if (panel) return;

  scrim = el('div', 'board-scrim');
  scrim.addEventListener('click', closePanel);

  panel = el('div', 'board-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Your boards');
  panel.tabIndex = -1;

  document.body.append(scrim, panel);
  dom.boardSwitch.setAttribute('aria-expanded', 'true');
  positionPanel();
  panel.focus({ preventScroll: true });

  try {
    await refreshList();
  } catch (err) {
    console.warn('Failed to load boards:', err);
    closePanel();
    ctx.showToast('Boards are unavailable.');
  }
}

function closePanel() {
  closeMenu();
  panel?.remove();
  scrim?.remove();
  panel = null;
  scrim = null;
  revokePreviews();
  dom.boardSwitch.setAttribute('aria-expanded', 'false');
}

async function refreshList() {
  const boards = await storage.listBoards();
  const previews = await Promise.all(boards.map(board => storage.loadPreviews(board.id, 4)));
  if (!panel) return;

  revokePreviews();

  const list = el('div', 'board-list');
  boards.forEach((board, i) => list.appendChild(buildRow(board, previews[i])));

  const newBtn = el('button', 'pill board-new');
  newBtn.type = 'button';
  newBtn.append(icon('add'), document.createTextNode('New board'));
  newBtn.addEventListener('click', createBoard);

  panel.replaceChildren(
    el('div', 'board-handle'),
    el('div', 'board-panel-title', 'Your boards'),
    list,
    newBtn
  );
}

function buildRow(board, previewEntries) {
  const active = board.id === ctx.getCurrentId();

  const row = el('div', `board-row${active ? ' active' : ''}`);
  row.tabIndex = 0;
  row.setAttribute('role', 'button');

  const mosaic = el('div', 'board-mos');
  for (let i = 0; i < 4; i++) {
    const cell = document.createElement('i');
    const src = previewEntries[i] ? previewSource(previewEntries[i]) : null;
    if (src) cell.style.backgroundImage = `url(${JSON.stringify(src)})`;
    mosaic.appendChild(cell);
  }

  const info = el('div', 'board-info');
  info.append(
    el('div', 'board-name', board.title),
    el('div', 'board-meta', imageLabel(board.count) + (active ? ' \u00b7 open now' : ''))
  );

  const more = el('button', 'board-more');
  more.type = 'button';
  more.setAttribute('aria-label', 'Board options');
  more.appendChild(icon('more_vert'));
  more.addEventListener('click', e => {
    e.stopPropagation();
    openMenu(board, more);
  });

  row.append(mosaic, info);
  if (active) row.appendChild(icon('check', 'board-check'));
  row.appendChild(more);

  const choose = () => chooseBoard(board);
  row.addEventListener('click', choose);
  row.addEventListener('keydown', e => {
    if (e.target !== row) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose();
    }
  });

  return row;
}

async function chooseBoard(board) {
  closePanel();
  if (board.id !== ctx.getCurrentId()) await ctx.switchTo(board.id);
}

// board actions

async function createBoard() {
  closePanel();
  let board;
  try {
    board = await storage.createBoard(NEW_BOARD_TITLE);
  } catch (err) {
    console.warn('Failed to create board:', err);
    ctx.showToast('Could not create board.');
    return;
  }
  await ctx.switchTo(board.id);
  ctx.showToast('New board created');
  startRename();
}

function openMenu(board, anchor) {
  closeMenu();

  menuScrim = el('div', 'board-menu-scrim');
  menuScrim.addEventListener('click', closeMenu);

  menu = el('div', 'board-menu');
  menu.setAttribute('role', 'menu');

  const items = [
    { label: 'Rename', glyph: 'edit', run: () => renameBoard(board) },
    { label: 'Duplicate', glyph: 'content_copy', run: () => duplicateBoard(board) },
    { label: 'Delete board', glyph: 'delete', danger: true, run: () => confirmDelete(board) }
  ];

  items.forEach(({ label, glyph, danger, run }) => {
    const btn = el('button', danger ? 'danger' : '');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.append(icon(glyph), document.createTextNode(label));
    btn.addEventListener('click', () => {
      closeMenu();
      run();
    });
    menu.appendChild(btn);
  });

  document.body.append(menuScrim, menu);

  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
}

function closeMenu() {
  menu?.remove();
  menuScrim?.remove();
  menu = null;
  menuScrim = null;
}

async function renameBoard(board) {
  closePanel();
  if (board.id !== ctx.getCurrentId()) await ctx.switchTo(board.id);
  startRename();
}

async function duplicateBoard(board) {
  try {
    await storage.duplicateBoard(board.id);
    ctx.showToast('Board duplicated');
    await refreshList();
  } catch (err) {
    console.warn('Failed to duplicate board:', err);
    ctx.showToast(err instanceof storage.StorageFullError ? 'Not enough storage to duplicate.' : 'Could not duplicate board.');
  }
}

function confirmDelete(board) {
  ctx.showModal({
    title: `Delete "${board.title}"?`,
    message: `This removes the board and its ${imageLabel(board.count)}. This can't be undone.`,
    actions: [
      { label: 'Delete', style: 'danger', onClick: () => deleteBoard(board) },
      { label: 'Cancel', style: 'primary' }
    ]
  });
}

async function deleteBoard(board) {
  const wasCurrent = board.id === ctx.getCurrentId();
  try {
    await storage.deleteBoard(board.id);
  } catch (err) {
    console.warn('Failed to delete board:', err);
    ctx.showToast('Could not delete board.');
    return;
  }

  if (!wasCurrent) {
    ctx.showToast('Board deleted');
    if (panel) await refreshList().catch(() => { });
    return;
  }

  closePanel();
  try {
    const rest = await storage.listBoards();
    const next = rest[0] || await storage.createBoard(NEW_BOARD_TITLE);
    await ctx.switchTo(next.id);
    ctx.showToast('Board deleted');
  } catch (err) {
    console.warn('Failed to open next board:', err);
    ctx.showToast('Board deleted. Reload to continue.');
  }
}
