import { config, params, applyQueryOverrides, randomize, applyPreset } from './config.js';
import { loadPresets } from './ui/presets.js';
import { createPanel } from './ui/panel.js';
import { createContext } from './gl/context.js';
import { createHDRTarget } from './gl/framebuffer.js';
import { generateGalaxy } from './galaxy/generator.js';
import { angularVelocity } from './galaxy/rotation.js';
import { StarLayer } from './render/starLayer.js';
import { HAZE_FS, DUST_FS } from './shaders/stars.js';
import { BackgroundLayer, generateBackground } from './render/backgroundLayer.js';
import { CoreGlow, Compositor, projectToScreen, colorFilter } from './render/compositor.js';
import { AccretionDisk, FlareTimer, BH_HORIZON } from './render/blackHole.js';
import { CollisionSim } from './galaxy/collision.js';
import { OrbitCamera } from './camera/camera.js';

const DEG = Math.PI / 180;
const ORIGIN = [0, 0, 0];
const COMPANION_INNER = [1.0, 0.86, 0.66];
const COMPANION_OUTER = [0.95, 0.7, 0.45];
// Camera distance per unit of galaxy radius: 26 at the default radius of 10,
// and wider in collision mode so the companion and the tails fit.
const FIT_DISTANCE = 2.6;
const FIT_DISTANCE_COLLISION = 4.8;
const PHOTON_RING = [0.8, 0.68, 0.52];  // × accretion glow

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
  let fittedRadius = null;  // galaxy radius the camera distance was last fitted to

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
    } else {
      stars.setData(galaxy.stars);
      haze.setData(galaxy.haze);
      dust.setData(galaxy.dust);
    }
    fitCamera(wasColliding);
    const bg = generateBackground(config.seed, Math.floor(config.bgStarCount));
    background.setData(bg.data, bg.count);
    console.info(`[nebula] generated ${stars.count} stars${sim ? ' (collision)' : ''}, ${haze.count} haze, `
      + `${dust.count} dust in ${(performance.now() - t0).toFixed(1)} ms`);
  }

  // Frame the galaxy by its size. Only reacts when the radius or the mode
  // changes, so a manual zoom survives other slider changes.
  function fitCamera(wasColliding) {
    const R = config.galaxyRadius;
    camera.defaults.distance = FIT_DISTANCE * R;
    if (sim) {
      // Pull back so the incoming companion and the tails fit in frame.
      if (!wasColliding || R !== fittedRadius) {
        camera.goal.distance = Math.max(camera.goal.distance, FIT_DISTANCE_COLLISION * R);
      }
    } else if (wasColliding || R !== fittedRadius) {
      camera.goal.distance = camera.defaults.distance;
    }
    fittedRadius = R;
  }

  // Centre the galaxy in the space left of the panel (when it's open and
  // leaves at least half the window free).
  function panelShift() {
    const el = panel.element;
    if (document.body.classList.contains('ui-hidden') || el.classList.contains('collapsed')) return 0;
    const W = canvas.clientWidth;
    const free = el.getBoundingClientRect().left;
    return free > W * 0.5 && free < W ? free / W - 1 : 0;
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
    onPreset(preset) {
      applyPreset(preset.values);
      panel.sync();
      clearTimeout(regenTimer);
      regenerate();
      console.info(`[nebula] preset "${preset.name}"`);
    },
  });
  loadPresets().then((list) => panel.setPresets(list));

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
        if (!e.repeat) {
          randomizeGalaxy();
          panel.markCustom();
        }
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
        panel.markCustom();
        break;
    }
  });

  // --- loop ---
  let last = performance.now();
  let realTime = 0;
  let frames = 0;
  let fpsClock = 0;
  let firstFrame = true;

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
    camera.shiftGoal = panelShift();
    if (firstFrame) {
      camera.snap();  // start framed, not gliding in
      firstFrame = false;
    }
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
    // The color filter tints the galaxy's light only, so the sky stays natural.
    const tint = colorFilter(config.tintHue, config.tintStrength);
    const cores = sim ? { a: sim.H, b: sim.C, radiusB: sim.companionRadius } : null;
    haze.draw({ ...orbit, sizeScale: 1, intensity: config.hazeBrightness * config.glow, tint,
      edgeFade: config.galaxyRadius, cores });
    stars.draw({ ...orbit, sizeScale: config.starSize, tint });
    gl.blendFunc(gl.ONE, gl.ONE);
    core.draw({
      viewProj: camera.viewProj,
      pointScale,
      radius: config.bulgeRadius,
      intensity: config.coreGlow * config.glow,
      width,
      height,
      center: hostCenter,
      tint,
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
        tint,
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
        tint,
      });
    }
    dust.draw({ ...orbit, sizeScale: 1, intensity: config.dustOpacity });

    // Lensing is screen-space, centred on the projected black hole.
    let lens = null;
    if (config.blackHole) {
      const sp = projectToScreen(camera.viewProj, hostCenter, width, height);
      if (sp) {
        const thetaE = (config.bhMass * pointScale) / sp.w;
        // Photon ring: the accretion disk's hot color, scaled with its glow.
        const ring = PHOTON_RING.map((c, i) => c * config.bhDiskBrightness * tint[i]);
        lens = { x: sp.x, y: sp.y, thetaE, horizon: thetaE * BH_HORIZON, ring };
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
