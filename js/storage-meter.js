import { imageCount } from './dom.js';

const meter = document.getElementById('storage-meter');
const fill = meter.querySelector('.fill');
const label = document.getElementById('storage-label');
const SHOW_AT = 0.7;
const WARN_AT = 0.9;
let timer;

async function refresh() {
  if (!navigator.storage?.estimate) return;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  if (!quota) return;
  const used = usage / quota;
  meter.classList.toggle('hidden', used < SHOW_AT);
  meter.classList.toggle('warn', used >= WARN_AT);
  fill.style.strokeDasharray = `${Math.min(used * 100, 100)} 100`;
  label.textContent = `${Math.round(used * 100)}% used`;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 600);
}

new MutationObserver(schedule).observe(imageCount, { childList: true, characterData: true, subtree: true });
document.addEventListener('visibilitychange', schedule);
refresh();
