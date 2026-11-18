# CLAUDE.md

Notes for Claude Code about this project. Claude reads this file at the start of every session.

## Project overview
**NEBULA**: a browser-based generative galaxy simulator. It draws tens of thousands of stars in logarithmic spiral arms with differential rotation, additive HDR glow, a bright core, and a twinkling background, plus a glass control panel with Randomize. Toggleable extras: a supermassive black hole (accretion disk + lensing), galaxy collision mode (CPU N-body), and a cinematic auto-orbit camera. Planned additions: presets and bloom.

## Tech stack
- Vanilla JavaScript ES modules, WebGL2, plain HTML/CSS.
- **No frameworks, no build step, no npm dependencies.** Keep it that way.

## Common commands
- Run: `python3 -m http.server 8000`, then open http://localhost:8000. ES modules don't load over `file://`.
- Stress test: `http://localhost:8000/?starCount=100000`. Any numeric key from `js/config.js` works as a query param.
- In the browser console: `nebula.config.<key> = …; nebula.regenerate()`
- Keys: `Space` pauses, `R` randomizes, `H` hides or shows all UI, `F` toggles the FPS HUD, `C` toggles the cinematic camera. Mouse: drag to orbit (with inertia), wheel to zoom, double-click to glide back to the default view.
- Console: `nebula.sim` is the live `CollisionSim` while collision mode is on (e.g. `for (let i=0;i<600;i++) nebula.sim.step(0.05, nebula.config)` to skip ahead).
- Test / lint: none yet.

## Project structure
- `README.md`: the public description on GitHub (features, controls, how it works, roadmap). Update its Features and Roadmap sections when a phase ships.
- `docs/preview.gif`: the animated preview at the top of the README, with the HUD and panel visible on purpose. To re-record it: Ubuntu's screen recorder gives a `.webm`, and ffmpeg isn't installed, so extract frames with `gst-launch-1.0` (720 px wide, 12 fps) and assemble the GIF with Pillow using one shared palette. Keep it under ~10 MB (about 10 s), and keep the raw `.webm` out of git.
- `index.html`, `css/style.css`: full-screen canvas and HUD.
- `js/main.js`: bootstrap, resize/DPR, render loop, and pass order (background → stars → core glow into HDR, then tone-map).
- `js/config.js`: every tunable parameter, with min/max/step, `label`, `kind` (`regen` = rebuild buffers, `uniform` = live), and an optional `random` range that `randomize()` draws from. To make a param randomizable, give it a `random` range here.
- `js/ui/panel.js`: glass control panel. Its `CONTROLS` list picks which params to show and how to format them; ranges and labels come from `config.js`. `regen` changes trigger a debounced regenerate in `main.js`. Row options: `toggle` (0/1 param as a switch), `showIf` (only visible while that toggle is on), `divider`. Feature toggles are 0/1 numbers in `config.js` with no `random` range, so Randomize never flips them and `?blackHole=1` works as a URL param.
- Anything with class `.ui` is hidden by `H` (via `body.ui-hidden`).
- `js/galaxy/generator.js`: builds per-star orbital elements (r, θ0, height, size, rgb, brightness) for the arm, bulge, and field populations.
- `js/galaxy/rotation.js`: rotation curve Ω(r) = v0/√(r²+rc²). **It must match** `js/shaders/stars.js`.
- `js/galaxy/collision.js`: `CollisionSim`. Restricted N-body for collision mode (see Notes).
- `js/render/blackHole.js`: `AccretionDisk` mesh; the lensing itself is the `LENSING` variant of `js/shaders/composite.js`, compiled as a second program in `Compositor`.
- `js/shaders/*.js`: GLSL as exported template strings, so nothing needs fetching.
- `js/render/`: `StarLayer`, `BackgroundLayer`, `CoreGlow` and `Compositor` (tone map).
- `js/gl/`: context, program compile/link helpers, and the HDR (RGBA16F) framebuffer.
- `js/camera/camera.js`: orbit camera. The disk lies in the XZ plane, with Y up. Input writes `camera.goal`; shown values ease toward it with dt. Cinematic offsets (tilt sway, zoom breathing) are scaled by a 0..1 blend and get baked into the goal when the user takes over, so nothing jumps. `camera.targetGoal` is where it looks (the collision focus, else the origin). It runs on real time, so it keeps moving while paused.

## Conventions
- Default git branch is `main`. The remote is `origin` → https://github.com/Trent5174/nebula (HTTPS through `gh`).
- Keep commits small and focused, with clear messages.
- Only commit or push when asked.

## Notes & decisions
- Motion is analytic on the GPU in v1: θ = θ0 + ω·t, where ω = mix(Ω(r), Ωp, lock). The CPU only uploads `uTime`.
- **Winding problem:** pure differential rotation winds the inner arms into concentric rings within minutes. Arm tracers (young stars, knots, dust, arm haze) therefore have `lock = 1` and ride the spiral pattern speed Ωp, which is Ω at `corotation × galaxyRadius`. Old arm stars use 0.8; bulge, field and halo use 0. Setting `armLock = 0` restores free winding.
- Collision mode switches to restricted N-body on the CPU. All stars, haze and dust (both galaxies) are test particles in two moving potentials: the host is a log halo Φ=½v0²ln(d²+rc²), which reproduces the analytic rotation curve exactly so the disk is in equilibrium, and the companion is a Plummer sphere with M = q·v0²·R. The cores attract each other, with mild dynamical friction near the host. Leapfrog KDK, substeps ≤0.05, about 2.5 ms/frame at 79k particles. The core orbit is set at pericenter and integrated backward `LEAD_TIME`, so the first pass always comes about 40 sim units after the switch. Host particles start at their current analytic angle, so the switch is seamless. `StarLayer` then uses `STAR_VS_POS` (positions from a DYNAMIC buffer at attrib 3). Arm-locked tracers wind freely in this mode; that's expected.
- Black hole extras (both 0/1 switches nested under Black hole, off by default; with them off the code paths are skipped):
  - `bhFlares`: a tidal disruption flare drawn in the accretion disk shader (head spirals inward trailing a stream, and the disk brightens; 3.5 s). `FlareTimer` in `js/render/blackHole.js` fires one every 10–25 s at random, with a 4 s cooldown. It runs on unpaused real time. Console: `nebula.flares.trigger(phi)`.
- Black hole lensing is screen-space in the tone-map pass, so it bends everything near the hole, including foreground stars. Its size is artistic: θE = `bhMass` in world units, the horizon is 0.5θE and the disk spans 1.2–3.5θE. With it off, the original composite program runs unchanged, so the default look is pixel-identical.
- Browser caching: `python3 -m http.server` lets Chrome cache modules. Hard-reload (Ctrl+Shift+R) after edits.
- When testing through Claude in Chrome, the automated window can be throttled to 1 fps (rAF gaps of exactly 1000 ms). That's the browser, not the app; benchmark the physics directly instead.
- Arms are generated *trailing* (θ decreases with r), which matches the direction differential rotation winds them.
- Draw order into the HDR buffer: background → haze → stars → core glow(s) → accretion disk (all additive) → dust (absorbing: `blendFunc(ZERO, ONE_MINUS_SRC_COLOR)`). Then a hue-preserving ACES tone map keeps the core yellow-orange instead of clipping to white. Lensing lives in `Compositor`; bloom will too (put it after lensing).
- Stars, haze and dust all use the same orbital-element layout and vertex shader (`StarLayer` with a different fragment shader and blend mode), so dust lanes and glow stay locked to the arms as they wind.
- The full phased plan is in `~/.claude/plans/pasted-content-id-c1e1-i-want-replicated-simon.md`.
