# CLAUDE.md

Notes for Claude Code about this project. Claude reads this file at the start of every session.

## Project overview
**NEBULA**: a browser-based generative galaxy simulator. It draws tens of thousands of stars in logarithmic spiral arms with differential rotation, additive HDR glow, a bright core, and a twinkling background. Planned additions: a control panel, presets, a black hole, galaxy collisions, and a cinematic camera.

## Tech stack
- Vanilla JavaScript ES modules, WebGL2, plain HTML/CSS.
- **No frameworks, no build step, no npm dependencies.** Keep it that way.

## Common commands
- Run: `python3 -m http.server 8000`, then open http://localhost:8000. ES modules don't load over `file://`.
- Stress test: `http://localhost:8000/?starCount=100000`. Any numeric key from `js/config.js` works as a query param.
- In the browser console: `nebula.config.<key> = …; nebula.regenerate()`
- Keys: `Space` pauses, `R` randomizes, `H` hides or shows all UI, `F` toggles the FPS HUD. Mouse: drag to orbit, wheel to zoom, double-click to reset.
- Test / lint: none yet.

## Project structure
- `index.html`, `css/style.css`: full-screen canvas and HUD.
- `js/main.js`: bootstrap, resize/DPR, render loop, and pass order (background → stars → core glow into HDR, then tone-map).
- `js/config.js`: every tunable parameter, with min/max/step, `label`, `kind` (`regen` = rebuild buffers, `uniform` = live), and an optional `random` range that `randomize()` draws from. To make a param randomizable, give it a `random` range here.
- `js/ui/panel.js`: glass control panel. Its `CONTROLS` list picks which params to show and how to format them; ranges and labels come from `config.js`. `regen` changes trigger a debounced regenerate in `main.js`.
- Anything with class `.ui` is hidden by `H` (via `body.ui-hidden`).
- `js/galaxy/generator.js`: builds per-star orbital elements (r, θ0, height, size, rgb, brightness) for the arm, bulge, and field populations.
- `js/galaxy/rotation.js`: rotation curve Ω(r) = v0/√(r²+rc²). **It must match** `js/shaders/stars.js`.
- `js/shaders/*.js`: GLSL as exported template strings, so nothing needs fetching.
- `js/render/`: `StarLayer`, `BackgroundLayer`, `CoreGlow` and `Compositor` (tone map).
- `js/gl/`: context, program compile/link helpers, and the HDR (RGBA16F) framebuffer.
- `js/camera/camera.js`: orbit camera. The disk lies in the XZ plane, with Y up.

## Conventions
- Default git branch is `main`.
- Keep commits small and focused, with clear messages.
- Only commit or push when asked.

## Notes & decisions
- Motion is analytic on the GPU in v1: θ = θ0 + ω·t, where ω = mix(Ω(r), Ωp, lock). The CPU only uploads `uTime`.
- **Winding problem:** pure differential rotation winds the inner arms into concentric rings within minutes. Arm tracers (young stars, knots, dust, arm haze) therefore have `lock = 1` and ride the spiral pattern speed Ωp, which is Ω at `corotation × galaxyRadius`. Old arm stars use 0.8; bulge, field and halo use 0. Setting `armLock = 0` restores free winding.
- Collisions (a later phase) will switch to restricted N-body on the CPU: stars are test particles, and galaxy cores are Plummer masses. The analytic orbits supply the initial velocities.
- Arms are generated *trailing* (θ decreases with r), which matches the direction differential rotation winds them.
- Draw order into the HDR buffer: background → haze → stars → core glow (all additive) → dust (absorbing: `blendFunc(ZERO, ONE_MINUS_SRC_COLOR)`). Then a hue-preserving ACES tone map keeps the core yellow-orange instead of clipping to white. Bloom and lensing will go in `Compositor`.
- Stars, haze and dust all use the same orbital-element layout and vertex shader (`StarLayer` with a different fragment shader and blend mode), so dust lanes and glow stay locked to the arms as they wind.
- The full phased plan is in `~/.claude/plans/pasted-content-id-c1e1-i-want-replicated-simon.md`.
