// Collapsible glass control panel. Ranges, steps and labels come from
// js/config.js `params`; this file only decides which ones to show and how
// to format them.

import { params, config, sanitize } from '../config.js';

/**
 * Panel rows, in display order.
 *   invert           flips the slider direction
 *   commitOnRelease  only apply when the slider is released (for expensive rebuilds)
 *   toggle           0/1 param shown as an on/off switch
 *   showIf           only show this row while that toggle is on
 *   hint             small dim note after a toggle's label
 *   divider          a thin separator line
 */
const CONTROLS = [
  { key: 'starCount',   commitOnRelease: true, format: (v) => v.toLocaleString() },
  { key: 'armCount',    format: (v) => String(v) },
  { key: 'pitchDeg',    invert: true, format: (v, p) => `${Math.round(((p.max - v) / (p.max - p.min)) * 100)}%` },
  { key: 'timeScale',   format: (v) => `${v.toFixed(1)}×` },
  { key: 'bulgeRadius', format: (v) => v.toFixed(2) },
  { key: 'colorTemp',   format: (v) => (Math.abs(v) < 0.005 ? 'neutral' : `${v > 0 ? 'warm' : 'cool'} ${Math.abs(v).toFixed(2)}`) },
  { key: 'tintStrength', format: (v) => (v > 0 ? `${Math.round(v * 100)}%` : 'off') },
  { key: 'tintHue',     showIf: 'tintStrength', format: (v) => `${v}° ${hueName(v)}` },
  { key: 'glow',        format: (v) => `${Math.round(v * 100)}%` },
  { divider: true },
  { key: 'autoOrbit',   toggle: true },
  { key: 'orbitSpeed',  showIf: 'autoOrbit', format: (v) => v.toFixed(2) },
  { key: 'blackHole',   toggle: true },
  { key: 'bhMass',      showIf: 'blackHole', format: (v) => v.toFixed(2) },
  { key: 'bhDiskBrightness', showIf: 'blackHole', format: (v) => v.toFixed(2) },
  { key: 'bhFlares',    toggle: true, showIf: 'blackHole' },
  { key: 'bhGravity',   toggle: true, showIf: 'blackHole', hint: 'collision' },
  { key: 'collision',   toggle: true },
  { key: 'companionMass', showIf: 'collision', commitOnRelease: true, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'encounterTilt', showIf: 'collision', commitOnRelease: true, format: (v) => `${v}°${v > 90 ? ' retro' : ''}` },
  { key: 'collisionRate', showIf: 'collision', format: (v) => `${v.toFixed(2)}×` },
];

const STORAGE_KEY = 'nebula.panelCollapsed';

const HUE_NAMES = [[15, 'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'], [200, 'cyan'], [260, 'blue'], [300, 'violet'], [340, 'magenta'], [360, 'red']];
const hueName = (deg) => HUE_NAMES.find(([upTo]) => deg <= upTo)[1];

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

/**
 * @param {object} opts
 * @param {(key: string) => void} opts.onChange  called after config[key] changes
 * @param {() => void} opts.onRandomize
 * @param {(preset: {name: string, values: object}) => void} [opts.onPreset]  a preset was picked
 */
export function createPanel({ onChange, onRandomize, onPreset = () => {} }) {
  const rows = [];

  const body = el('div', { className: 'panel-body', id: 'panel-body' });

  // Presets dropdown (filled by setPresets once presets/ has loaded; hidden while empty).
  const presetSelect = el('select', { id: 'ctl-preset', className: 'preset-select' });
  presetSelect.append(el('option', { value: '', textContent: 'Custom' }));
  const presetRow = el('div', { className: 'row row-preset' }, [
    el('label', { htmlFor: 'ctl-preset', className: 'row-label', textContent: 'Preset' }),
    presetSelect,
  ]);
  presetRow.hidden = true;
  let presetList = [];
  presetSelect.addEventListener('change', () => {
    const preset = presetList[Number(presetSelect.value)];
    if (preset) onPreset(preset);
    presetSelect.blur(); // keep Space/R/H/F/C working
  });
  // Any manual change means the settings no longer match the chosen preset.
  const markCustom = () => { presetSelect.value = ''; };
  body.append(presetRow, el('div', { className: 'panel-divider' }));

  const sync = () => rows.forEach((render) => render());

  for (const ctl of CONTROLS) {
    if (ctl.divider) {
      body.append(el('div', { className: 'panel-divider' }));
      continue;
    }
    if (ctl.toggle) {
      const id = `ctl-${ctl.key}`;
      const input = el('input', { type: 'checkbox', id, className: 'switch' });
      input.setAttribute('role', 'switch');
      const label = el('label', { htmlFor: id, className: 'row-label', textContent: params[ctl.key].label });
      if (ctl.hint) label.append(el('span', { className: 'row-hint', textContent: ctl.hint }));
      const row = el('div', { className: 'row row-toggle' }, [label, input]);
      rows.push(() => {
        if (ctl.showIf) row.hidden = !config[ctl.showIf];
        input.checked = !!config[ctl.key];
      });
      input.addEventListener('change', () => {
        config[ctl.key] = input.checked ? 1 : 0;
        markCustom();
        sync(); // shows/hides dependent rows
        onChange(ctl.key);
        input.blur(); // keep Space/R/H/F working
      });
      body.append(row);
      continue;
    }

    const p = params[ctl.key];
    const id = `ctl-${ctl.key}`;
    const input = el('input', { type: 'range', id, min: p.min, max: p.max, step: p.step });
    const output = el('output', { className: 'row-value' });
    output.setAttribute('for', id);
    const label = el('label', { htmlFor: id, className: 'row-label', textContent: p.label });
    const row = el('div', { className: 'row' }, [label, output, input]);

    const toSlider = (v) => (ctl.invert ? p.min + p.max - v : v);
    const fromSlider = (s) => (ctl.invert ? p.min + p.max - s : s);

    const render = () => {
      if (ctl.showIf) row.hidden = !config[ctl.showIf];
      const v = config[ctl.key];
      input.value = String(toSlider(v));
      output.value = ctl.format(v, p);
      const pct = ((Number(input.value) - p.min) / (p.max - p.min)) * 100;
      input.style.setProperty('--pct', `${pct}%`);
    };

    const apply = () => {
      config[ctl.key] = sanitize(ctl.key, fromSlider(Number(input.value)));
      markCustom();
      render();
      onChange(ctl.key);
    };
    if (ctl.commitOnRelease) {
      // Preview the number while dragging; rebuild once on release.
      input.addEventListener('input', () => {
        output.value = ctl.format(sanitize(ctl.key, fromSlider(Number(input.value))), p);
        input.style.setProperty('--pct', `${((Number(input.value) - p.min) / (p.max - p.min)) * 100}%`);
      });
      input.addEventListener('change', apply);
    } else {
      input.addEventListener('input', apply);
    }

    rows.push(render);
    body.append(row);
  }

  const randomizeBtn = el('button', {
    type: 'button',
    className: 'btn-randomize',
    title: 'Randomize (R)',
    textContent: '✦ Randomize',
  });
  randomizeBtn.addEventListener('click', () => {
    onRandomize();
    markCustom();
    randomizeBtn.blur(); // so Space doesn't re-trigger it
  });
  body.append(randomizeBtn);

  const header = el('button', {
    type: 'button',
    className: 'panel-header',
    title: 'Collapse / expand',
  }, [el('span', { className: 'panel-title', textContent: 'NEBULA' }), el('span', { className: 'chevron' })]);
  header.setAttribute('aria-controls', 'panel-body');

  const panel = el('aside', { className: 'panel glass ui' }, [header, body]);
  panel.setAttribute('aria-label', 'Galaxy controls');

  const setCollapsed = (collapsed) => {
    panel.classList.toggle('collapsed', collapsed);
    header.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  header.addEventListener('click', () => {
    setCollapsed(!panel.classList.contains('collapsed'));
    header.blur();
  });
  let startCollapsed = false;
  try { startCollapsed = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* ignore */ }
  setCollapsed(startCollapsed);

  document.body.append(panel);

  sync();

  /** Fill the dropdown; the row stays hidden if there are no presets. */
  const setPresets = (list) => {
    presetList = list;
    presetSelect.replaceChildren(el('option', { value: '', textContent: 'Custom' }),
      ...list.map((preset, i) => el('option', { value: String(i), textContent: preset.name })));
    presetRow.hidden = list.length === 0;
  };

  return { sync, setPresets, markCustom, element: panel };
}
