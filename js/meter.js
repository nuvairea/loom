const THRESHOLD = 0.8;

export async function refreshStorageMeter() {
  const meter = document.getElementById('storage-meter');
  if (!meter || !navigator.storage || !navigator.storage.estimate) return;

  // ?meter forces the meter on at 92% so you can judge the design
  const forced = new URLSearchParams(location.search).has('meter');

  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (!quota && !forced) return;

    const ratio = forced ? 0.92 : usage / quota;
    const pct = Math.min(100, Math.round(ratio * 100));

    meter.classList.toggle('hidden', ratio < THRESHOLD);
    meter.style.setProperty('--pct', `${pct}%`);
    meter.setAttribute('aria-valuenow', String(pct));
    meter.querySelector('.meter-label').textContent = `${pct}% used`;
  } catch {
    // estimate() can throw in some private modes, meter just stays hidden
  }
}
