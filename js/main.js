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
import { AccretionDisk, FlareTimer, BH_HORIZON } from './render/blackHole.js';
import { CollisionSim } from './galaxy/collision.js';
import { OrbitCamera } from './camera/camera.js';

const DEG = Math.PI / 180;
const ORIGIN = [0, 0, 0];
const COMPANION_INNER = [1.0, 0.86, 0.66];
const COMPANION_OUTER = [0.95, 0.7, 0.45];

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
  const flares = new FlareTimer();
  let seenCaptures = 0;
  const camera = new OrbitCamera(canvas);

  let dpr = 1;
  let sim = null;        // CollisionSim while collision mode is on
  let simTime = 0;

  function regenerate() {
    const t0 = performance.now();
    const galaxy = generateGalaxy(config);
    const wasColliding = !!sim;
    sim = null;
    seenCaptures = 0;
    if (config.collision) {
      // Start from the host's current analytic pose so nothing jumps.
      sim = new CollisionSim(config, galaxy, simTime * config.windingRate);
      for (const [layer, name] of [[stars, 'stars'], [haze, 'haze'], [dust, 'dust']]) {
        layer.setData(sim.layers[name], sim.positions(name));
      }
      // Pull back so the incoming companion and the tails fit in frame.
      if (!wasColliding) camera.goal.distance = Math.max(camera.goal.distance, 48);
    } else {
      stars.setData(galaxy.stars);
      haze.setData(galaxy.haze);
      dust.setData(galaxy.dust);
      if (wasColliding) camera.goal.distance = camera.defaults.distance;
    }
    const bg = generateBackground(config.seed, Math.floor(config.bgStarCount));
    background.setData(bg.data, bg.count);
    console.info(`[nebula] generated ${stars.count} stars${sim ? ' (collision)' : ''}, ${haze.count} haze, `
      + `${dust.count} dust in ${(performance.now() - t0).toFixed(1)} ms`);
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
      // Black hole gravity is part of the collision physics: restart it.
      else if (config.collision && (key === 'bhGravity' || (key === 'blackHole' && config.bhGravity))) {
        scheduleRegenerate();
      }
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
  let realTime = 0;
  let frames = 0;
  let fpsClock = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    realTime += dt;
    if (!paused) simTime += dt * config.timeScale;

    // Collision physics: CPU N-body, positions streamed to the GPU. Its clock
    // is the Collision speed alone, independent of the Rotation speed slider.
    if (sim && !paused) {
      sim.step(dt * config.collisionRate, config);
      stars.setPositions(sim.positions('stars'));
      haze.setPositions(sim.positions('haze'));
      dust.setPositions(sim.positions('dust'));
    }
    const hostCenter = sim ? sim.H : ORIGIN;

    // Tidal disruptions: random flares, plus a real one whenever the collision
    // sim reports a star swallowed by the black hole (bhGravity).
    if (config.blackHole && config.bhFlares) {
      if (!paused) flares.update(dt);
      if (sim && sim.captures > seenCaptures) flares.trigger(sim.lastCapturePhi);
    } else {
      flares.stop();
    }
    if (sim) seenCaptures = sim.captures;

    resize();
    const width = canvas.width;
    const height = canvas.height;
    const tg = sim ? sim.focus() : ORIGIN;
    camera.targetGoal[0] = tg[0];
    camera.targetGoal[1] = tg[1];
    camera.targetGoal[2] = tg[2];
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
    if (sim) {
      core.draw({
        viewProj: camera.viewProj,
        pointScale,
        radius: sim.companionBulge,
        intensity: config.coreGlow * config.glow * 0.7,
        width,
        height,
        center: sim.C,
        colorInner: COMPANION_INNER,
        colorOuter: COMPANION_OUTER,
      });
    }
    if (config.blackHole) {
      accretion.draw({
        viewProj: camera.viewProj,
        center: hostCenter,
        eye: camera.eye,
        mass: config.bhMass,
        brightness: config.bhDiskBrightness,
        doppler: config.bhDoppler,
        time: simTime,
        flareAge: flares.age,
        flarePhi: flares.phi,
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
          + `${sim ? ' · collision' : ''}${paused ? ' · paused' : ''}${floatRenderable ? '' : ' · 8-bit'}`;
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
  window.nebula = { config, regenerate, randomize: randomizeGalaxy, camera, flares, get sim() { return sim; } };
}

try {
  start();
} catch (err) {
  showError(err);
}
