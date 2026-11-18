import { config, params, applyQueryOverrides, randomize } from './config.js';
import { createPanel } from './ui/panel.js';
import { createContext } from './gl/context.js';
import { createHDRTarget } from './gl/framebuffer.js';
import { generateGalaxy } from './galaxy/generator.js';
import { angularVelocity } from './galaxy/rotation.js';
import { StarLayer } from './render/starLayer.js';
import { HAZE_FS, DUST_FS } from './shaders/stars.js';
import { BackgroundLayer, generateBackground } from './render/backgroundLayer.js';
import { CoreGlow, Compositor, projectToScreen } from './render/compositor.js';
import { AccretionDisk, BH_HORIZON } from './render/blackHole.js';
import { OrbitCamera } from './camera/camera.js';

const DEG = Math.PI / 180;
const ORIGIN = [0, 0, 0];

const canvas = document.getElementById('nebula');
const hud = document.getElementById('hud');

function showError(err) {
  console.error(err);
  const el = document.getElementById('error');
  el.textContent = `NEBULA couldn't start: ${err.message}`;
  el.hidden = false;
}

function start() {
  applyQueryOverrides();

  const { gl, floatRenderable } = createContext(canvas);
  const hdr = createHDRTarget(gl, floatRenderable);
  const stars = new StarLayer(gl);
  const haze = new StarLayer(gl, { fs: HAZE_FS, label: 'haze', maxSize: 512, nearFade: 6 });
  const dust = new StarLayer(gl, { fs: DUST_FS, label: 'dust', blend: 'absorb', maxSize: 512, nearFade: 6 });
  const background = new BackgroundLayer(gl);
  const core = new CoreGlow(gl);
  const compositor = new Compositor(gl);
  const accretion = new AccretionDisk(gl);
  const camera = new OrbitCamera(canvas);

  let dpr = 1;

  function regenerate() {
    const t0 = performance.now();
    const galaxy = generateGalaxy(config);
    stars.setData(galaxy.stars);
    haze.setData(galaxy.haze);
    dust.setData(galaxy.dust);
    const bg = generateBackground(config.seed, Math.floor(config.bgStarCount));
    background.setData(bg.data, bg.count);
    console.info(`[nebula] generated ${galaxy.stars.count} stars, ${galaxy.haze.count} haze, `
      + `${galaxy.dust.count} dust in ${(performance.now() - t0).toFixed(1)} ms`);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    hdr.resize(w, h);
  }

  // Regeneration is debounced so dragging a 'regen' slider stays smooth.
  let regenTimer = 0;
  function scheduleRegenerate() {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(regenerate, 120);
  }

  // --- UI ---
  const panel = createPanel({
    onChange(key) {
      if (params[key].kind === 'regen') scheduleRegenerate();
      // 'uniform' params are read straight from config next frame.
    },
    onRandomize: randomizeGalaxy,
  });

  function randomizeGalaxy() {
    randomize();
    panel.sync();
    clearTimeout(regenTimer);
    regenerate();
  }

  // --- input ---
  let paused = false;
  const pauseLabel = document.getElementById('legend-pause');
  window.addEventListener('keydown', (e) => {
    // Let text fields keep their keys; sliders don't use Space/R/H/F.
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type !== 'range') return;
    if (t instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        paused = !paused;
        pauseLabel.textContent = paused ? 'resume' : 'pause';
        break;
      case 'KeyR':
        if (!e.repeat) randomizeGalaxy();
        break;
      case 'KeyH':
        document.body.classList.toggle('ui-hidden');
        break;
      case 'KeyF':
        hud.hidden = !hud.hidden;
        break;
      case 'KeyC':
        config.autoOrbit = config.autoOrbit ? 0 : 1;
        panel.sync();
        break;
    }
  });

  // --- loop ---
  let last = performance.now();
  let simTime = 0;
  let realTime = 0;
  let frames = 0;
  let fpsClock = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    realTime += dt;
    if (!paused) simTime += dt * config.timeScale;

    const hostCenter = ORIGIN;

    resize();
    const width = canvas.width;
    const height = canvas.height;
    camera.update(width / height, dt, {
      auto: !!config.autoOrbit,
      orbitSpeed: config.orbitSpeed,
      tilt: config.tiltDeg * DEG,
    });
    const pointScale = camera.pointScale(height);

    // HDR accumulation pass: light is added (background, haze, stars, core),
    // then dust multiplies it down. Galaxy layers share orbital params.
    hdr.bind();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    background.draw({
      viewProjRot: camera.viewProjRot,
      time: realTime,
      twinkle: config.twinkle,
      brightness: config.bgBrightness,
      dpr,
    });
    const orbit = {
      viewProj: camera.viewProj,
      time: simTime * config.windingRate,
      v0: config.v0,
      rc: config.rc,
      patternSpeed: angularVelocity(config.corotation * config.galaxyRadius, config.v0, config.rc),
      armLock: config.armLock,
      pointScale,
    };
    haze.draw({ ...orbit, sizeScale: 1, intensity: config.hazeBrightness * config.glow });
    stars.draw({ ...orbit, sizeScale: config.starSize });
    gl.blendFunc(gl.ONE, gl.ONE);
    core.draw({
      viewProj: camera.viewProj,
      pointScale,
      radius: config.bulgeRadius,
      intensity: config.coreGlow * config.glow,
      width,
      height,
      center: hostCenter,
    });
    if (config.blackHole) {
      accretion.draw({
        viewProj: camera.viewProj,
        center: hostCenter,
        eye: camera.eye,
        mass: config.bhMass,
        brightness: config.bhDiskBrightness,
        doppler: config.bhDoppler,
        time: simTime,
      });
    }
    dust.draw({ ...orbit, sizeScale: 1, intensity: config.dustOpacity });

    // Lensing is screen-space, centred on the projected black hole.
    let lens = null;
    if (config.blackHole) {
      const sp = projectToScreen(camera.viewProj, hostCenter, width, height);
      if (sp) {
        const thetaE = (config.bhMass * pointScale) / sp.w;
        lens = { x: sp.x, y: sp.y, thetaE, horizon: thetaE * BH_HORIZON };
      }
    }
    compositor.draw(hdr.texture, {
      exposure: config.exposure,
      temperature: config.colorTemp,
      width,
      height,
      lens,
    });

    // HUD
    frames++;
    fpsClock += dt;
    if (fpsClock >= 0.5) {
      if (!hud.hidden) {
        hud.textContent = `${Math.round(frames / fpsClock)} fps · ${stars.count.toLocaleString()} stars`
          + `${paused ? ' · paused' : ''}${floatRenderable ? '' : ' · 8-bit'}`;
      }
      frames = 0;
      fpsClock = 0;
    }

    requestAnimationFrame(frame);
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showError(new Error('WebGL context lost. Reload the page.'));
  });

  regenerate();
  requestAnimationFrame(frame);

  // Console hooks for params not on the panel:
  //   nebula.config.dustOpacity = 1.5            (uniform: live)
  //   nebula.config.knotRate = 0.01; nebula.regenerate()   (regen)
  window.nebula = { config, regenerate, randomize: randomizeGalaxy, camera };
}

try {
  start();
} catch (err) {
  showError(err);
}
