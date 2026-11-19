# Changelog

All the notable things that have happened to NEBULA, from the first stars onward.

## 2026-11-19: Polish & Showtime 🎬
- **Art-review glow-up:** better framing, a color tint that affects only the galaxy (the sky keeps its natural color), softer gas edges, and some retuned presets.
- **Moved house:** the project now lives at `twg8822/Nebula`.
- **Lights, camera, GIFs:** the README now shows off Neon Whirlpool and Glacier Lace.
- **Test fix:** tests now run on Node 22 (always pass the glob).

## 2026-11-18: The Big Bang 💥
- **Cinematic camera:** smooth easing, inertia and a slow auto-orbit.
- **Supermassive black hole:** gravitational lensing, an accretion disk, and tidal disruption flares that were deliberately kept subtle.
- **Galaxy collisions:** restricted N-body physics. Two galaxies fly past each other, throw off tidal tails, and eventually merge. With black hole gravity on, stars that fall too close get swallowed.
- **Collision speed** now has its own control, separate from rotation speed.
- **Color filter:** tint the galaxy any hue. At zero it has no effect at all, guaranteed.
- **Presets:** a dropdown and a `/preset` skill, plus Dying Red Giant, Dying Ancient Giant, Neon Whirlpool, Devourer's Waltz, Glacier Lace and Abyssal Bloom.
- **New defaults:** retuned galaxy settings, and the viewing angle was lowered twice, ending at 20°.
- **Science, but tested:** the pure math moved into `src/math.js`, with unit tests that run automatically after every edit to `src/`.

## 2026-11-17: Let There Be Light ✨
- **NEBULA v1:** a WebGL2 generative galaxy with tens of thousands of stars in spiral arms, HDR glow and a glass control panel.
- **Star-count slider** now rebuilds when you release it, instead of on every frame while dragging.
- **README** with an animated preview.
- Housekeeping: `main` is the default branch, and the docs were updated to match.
