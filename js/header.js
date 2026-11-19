import { boardTitle } from './dom.js';

const KEY = 'loom.title.v1';
const DEFAULT_TITLE = 'My weave';

function fit() {
  boardTitle.size = Math.max(8, boardTitle.value.length + 1);
}

function save() {
  try {
    localStorage.setItem(KEY, boardTitle.value.trim());
  } catch (err) {
    console.warn('Failed to save board title:', err);
  }
}

let saved = null;
try {
  saved = localStorage.getItem(KEY);
} catch (err) {
  console.warn('Failed to read board title:', err);
}

boardTitle.value = saved || DEFAULT_TITLE;
fit();

boardTitle.addEventListener('input', () => {
  fit();
  save();
});

boardTitle.addEventListener('keydown', e => {
  if (e.key === 'Enter') boardTitle.blur();
});

boardTitle.addEventListener('blur', () => {
  if (!boardTitle.value.trim()) {
    boardTitle.value = DEFAULT_TITLE;
    fit();
  }
  save();
});
