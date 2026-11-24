const THRESHOLD = 0.8;

// Material 3 Expressive wavy linear indicator numbers
const AMPLITUDE = 3;
const WAVELENGTH = 40;
const STROKE = 4;
const GAP = 4;
const DOT = 4;
const DOT_OFFSET = 2;
const HEIGHT = 12;
const STEP = 2;
const SPEED = 24; // px per second the wave travels

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let meter = null;
let track = null;
let svg = null;
let active = null;
let rest = null;
let dot = null;
let width = 0;
let progress = 0;
let frame = 0;

function setup() {
  if (meter) return true;

  meter = document.getElementById('storage-meter');
  if (!meter) return false;

  track = meter.querySelector('.meter-track');
  svg = meter.querySelector('.meter-svg');
  active = meter.querySelector('.meter-active');
  rest = meter.querySelector('.meter-rest');
  dot = meter.querySelector('.meter-dot');

  svg.setAttribute('height', HEIGHT);

  // redraw whenever the track changes size (resize, rotate, becoming visible)
  new ResizeObserver(entries => {
    width = entries[0].contentRect.width;
    draw(performance.now());
  }).observe(track);

  return true;
}

function draw(now) {
  if (!width) return;

  const radius = STROKE / 2;
  const mid = HEIGHT / 2;
  const phase = reduceMotion.matches ? 0 : (now / 1000) * SPEED;

  svg.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);

  const waveStart = radius;
  const waveEnd = radius + (width - STROKE) * progress;

  const yAt = x => mid + AMPLITUDE * Math.sin(((x - phase) / WAVELENGTH) * Math.PI * 2);

  let d = '';
  for (let x = waveStart; x < waveEnd; x += STEP) {
    d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${yAt(x).toFixed(2)}`;
  }
  d += `${d ? 'L' : 'M'}${waveEnd.toFixed(1)} ${yAt(waveEnd).toFixed(2)}`;
  active.setAttribute('d', d);

  // flat track starts after the gap and stops short of the end dot
  const dotX = width - DOT / 2;
  const trackStart = waveEnd + GAP + STROKE;
  const trackEnd = dotX - DOT / 2 - DOT_OFFSET - radius;

  rest.setAttribute('d', trackEnd - trackStart >= 1 ? `M${trackStart.toFixed(1)} ${mid}H${trackEnd.toFixed(1)}` : '');

  dot.setAttribute('cx', dotX);
  dot.setAttribute('cy', mid);
  dot.setAttribute('r', DOT / 2);
  dot.style.display = trackStart <= dotX - DOT / 2 ? '' : 'none';
}

function loop(now) {
  draw(now);
  frame = requestAnimationFrame(loop);
}

function sync(visible) {
  cancelAnimationFrame(frame);
  frame = 0;
  if (!visible) return;

  if (reduceMotion.matches) draw(0);
  else frame = requestAnimationFrame(loop);
}

export async function refreshStorageMeter() {
  if (!setup() || !navigator.storage || !navigator.storage.estimate) return;

  // ?meter forces the meter on at 92% so you can judge the design
  const forced = new URLSearchParams(location.search).has('meter');

  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (!quota && !forced) return;

    const ratio = Math.min(1, forced ? 0.92 : usage / quota);
    const pct = Math.round(ratio * 100);
    const visible = ratio >= THRESHOLD;

    progress = ratio;
    meter.classList.toggle('hidden', !visible);
    meter.setAttribute('aria-valuenow', String(pct));
    meter.querySelector('.meter-label').textContent = `${pct}% used`;

    sync(visible);
  } catch {
    // estimate() can throw in some private modes, meter just stays hidden
  }
}
