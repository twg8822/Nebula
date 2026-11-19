// "Wallpaper" dialog: pick resolution, length, frame rate and format, then
// record a looping clip of the current galaxy and download it. The rendering
// itself lives in main.js (recordWallpaper) and js/wallpaper/.

import { findEncoderConfig, bitrateFor } from '../wallpaper/recorder.js';

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const MAX_W = 3840;
const MAX_H = 2160;

/** The monitor's native resolution (capped at 4K, keeping its shape). */
function screenSize() {
  const dpr = window.devicePixelRatio || 1;
  let w = window.screen.width * dpr;
  let h = window.screen.height * dpr;
  const fit = Math.min(1, MAX_W / w, MAX_H / h);
  w *= fit; h *= fit;
  return { w: even(w), h: even(h) };
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

function select(id, options) {
  return el('select', { id, className: 'preset-select' },
    options.map(([value, label]) => el('option', { value, textContent: label })));
}

const field = (label, control) => el('label', { className: 'wp-field' }, [el('span', { textContent: label }), control]);

/**
 * @param {object} o
 * @param {(opts: object) => Promise<Blob|null>} o.record   renders and encodes (main.js)
 * @param {() => string} o.clipName                          for the file name (preset name)
 * @param {() => boolean} o.collision                        collision mode can't loop seamlessly
 */
export function createWallpaperDialog({ record, clipName, collision }) {
  const scr = screenSize();
  const resolution = select('wp-res', [
    ['screen', `Your screen (${scr.w}×${scr.h})`],
    ['1920x1080', '1080p (1920×1080)'],
    ['2560x1440', '1440p (2560×1440)'],
    ['3840x2160', '4K (3840×2160)'],
  ]);
  const length = select('wp-len', [['20', '20 seconds'], ['30', '30 seconds'], ['60', '60 seconds']]);
  length.value = '30';
  const fps = select('wp-fps', [['30', '30 fps'], ['60', '60 fps (smoother, twice the size)']]);
  const format = select('wp-format', [['mp4', 'MP4 (Wallpaper Engine, Workshop)'], ['webm', 'WebM (local wallpapers)']]);

  const note = el('p', { className: 'wp-note' });
  const bar = el('div', { className: 'wp-bar' }, [el('div', { className: 'wp-bar-fill' })]);
  const status = el('p', { className: 'wp-status', role: 'status' });
  const recordBtn = el('button', { type: 'button', className: 'btn-randomize', textContent: '● Record' });
  const closeBtn = el('button', { type: 'button', className: 'btn-secondary', textContent: 'Close' });
  const form = el('div', { className: 'wp-form' }, [
    field('Resolution', resolution), field('Length', length), field('Frame rate', fps), field('Format', format),
  ]);

  const card = el('div', { className: 'wp-card glass', role: 'dialog' }, [
    el('h2', { className: 'wp-title', textContent: 'Wallpaper' }),
    el('p', { className: 'wp-intro', textContent:
      'Records a looping video of this galaxy, as it looks now, for Wallpaper Engine. The panel and hints aren\'t included.' }),
    form, note, bar, status,
    el('div', { className: 'wp-actions' }, [closeBtn, recordBtn]),
  ]);
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Record a wallpaper');
  const overlay = el('div', { className: 'wp-overlay', hidden: true }, [card]);
  document.body.append(overlay);

  let busy = false;
  let cancel = false;

  const options = () => {
    const [w, h] = resolution.value === 'screen' ? [scr.w, scr.h] : resolution.value.split('x').map(Number);
    return { width: w, height: h, fps: Number(fps.value), seconds: Number(length.value), format: format.value };
  };

  const setProgress = (fraction) => {
    bar.firstChild.style.width = `${(fraction * 100).toFixed(1)}%`;
  };

  /** Check what this browser can encode and explain the trade-offs. */
  async function refresh() {
    const o = options();
    const support = await Promise.all(['mp4', 'webm'].map((f) => findEncoderConfig(f, o.width, o.height, o.fps)));
    [...format.options].forEach((opt, i) => {
      opt.disabled = !support[i];
      opt.textContent = opt.textContent.replace(/ – not supported here$/, '') + (support[i] ? '' : ' – not supported here');
    });
    if (format.selectedOptions[0]?.disabled) {
      const ok = [...format.options].find((opt) => !opt.disabled);
      if (ok) format.value = ok.value;
    }
    const sizeMB = Math.round((bitrateFor(o.width, o.height, o.fps) / 8 / 1e6) * o.seconds);
    const lines = [];
    if (!support[0] && !support[1]) {
      lines.push('This browser can\'t encode video (it needs WebCodecs). Try a recent Chrome, Edge or Firefox.');
    } else {
      lines.push(`About ${Math.max(1, sizeMB)} MB. Rendering takes a few times the clip's length (longer at 4K); you can switch tabs meanwhile.`);
      if (collision()) lines.push('Collision mode plays the encounter forward, so this clip won\'t loop seamlessly.');
    }
    note.textContent = lines.join(' ');
    recordBtn.disabled = !support[0] && !support[1];
  }

  async function start() {
    const o = options();
    const encoderConfig = await findEncoderConfig(o.format, o.width, o.height, o.fps);
    if (!encoderConfig) { status.textContent = 'That format isn\'t supported in this browser.'; return; }
    busy = true;
    cancel = false;
    form.inert = true;
    recordBtn.disabled = true;
    closeBtn.textContent = 'Cancel';
    bar.hidden = false;
    setProgress(0);
    const frames = Math.round(o.seconds * o.fps);
    const t0 = performance.now();
    try {
      const blob = await record({
        ...o,
        encoderConfig,
        cancelled: () => cancel,
        onProgress(done) {
          setProgress(done / frames);
          const elapsed = (performance.now() - t0) / 1000;
          const left = Math.max(0, (elapsed / done) * (frames - done));
          status.textContent = `Rendering frame ${done} of ${frames} · about ${Math.ceil(left)} s left`;
        },
      });
      if (!blob) {
        status.textContent = 'Cancelled.';
      } else {
        const name = `nebula-${slug(clipName())}-${o.height}p${o.fps}-${o.seconds}s.${o.format}`;
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setProgress(1);
        status.textContent = `Saved ${name} (${(blob.size / 1e6).toFixed(0)} MB) to your downloads.`;
      }
    } catch (err) {
      console.error(err);
      status.textContent = `Recording failed: ${err.message}`;
    } finally {
      busy = false;
      form.inert = false;
      recordBtn.disabled = false;
      closeBtn.textContent = 'Close';
    }
  }

  const close = () => {
    if (busy) { cancel = true; return; }
    overlay.hidden = true;
  };

  recordBtn.addEventListener('click', start);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  for (const s of [resolution, fps, format, length]) s.addEventListener('change', refresh);

  return {
    open() {
      overlay.hidden = false;
      bar.hidden = true;
      status.textContent = '';
      refresh();
      recordBtn.focus();
    },
    isOpen: () => !overlay.hidden,
  };
}
