---
name: preset
description: Design a NEBULA galaxy preset from a vibe description and save it to presets/<kebab-name>.json (all js/config.js keys), keep presets/index.json in sync, and make sure the control panel's Presets dropdown exists. Use when the user types /preset <description> or asks for a new galaxy preset.
argument-hint: <description of the galaxy's vibe>
---

# /preset: design a galaxy preset

The user's description is in `$ARGUMENTS`. If it's empty, ask for one before doing anything.

## 1. Read the source of truth

Read `js/config.js` (`params`). Every preset key, range and step comes from there. The schema below is a snapshot; if config.js has changed (new keys, new ranges), config.js wins, and you should update the schema in this file to match.

## 2. Design the preset

Start from the current defaults, then change what the vibe calls for. Get the defaults with:

```bash
python3 .claude/skills/preset/validate.py --defaults
```

How the knobs read on screen:

| Vibe | Knobs |
|---|---|
| Any strong color (blood red, emerald, violet, toxic green…) | Color filter: `tintStrength` 0.3–0.7 with `tintHue` in degrees (0 red, 30 orange, 55 yellow, 120 green, 180 cyan, 230 blue, 280 violet, 320 magenta). Leave it at 0 (off) unless a color is the point; `colorTemp` alone only reaches amber/ice blue |
| Cool / icy / blue | `colorTemp` −0.3…−0.8, higher `youngFraction` (0.45–0.7), `hazeBrightness` up |
| Warm / golden / ancient | `colorTemp` +0.3…+0.8, `youngFraction` 0.1–0.25, bigger `bulgeRadius`/`bulgeFraction`, fewer `knotRate` |
| Tightly wound / elegant | `pitchDeg` 8–13 (small = tight), `armSpread` 0.2–0.28 |
| Loose / wild / open | `pitchDeg` 22–32, `armSpread` 0.4–0.7 |
| Busy / grand design | `armCount` 2 = classic grand design, 3–4 = busy, 5–6 = flocculent |
| Calm / slow | `timeScale` 0.5–1.5, `orbitSpeed` 0.02–0.04, `twinkle` low |
| Energetic / fast | `timeScale` 3–5, `orbitSpeed` 0.08–0.15 |
| Dramatic core | `bulgeRadius` 2–3, `coreGlow` 0.8–1.5 |
| Dreamy / soft / nebulous | `glow` 1.1–1.6, `hazeBrightness` 1.3–2, `dustOpacity` 0.5–0.8 |
| Dusty / moody / dark | `dustFraction` 0.2–0.35, `dustOpacity` 1.3–2, `exposure` 0.9–1.1 |
| Star-forming / pink knots | `knotRate` 0.008–0.02, `youngFraction` up |
| Sparse / lonely | `starCount` 40k–70k, `bgStarCount` 1000–2500, `haloFraction` low |
| Black hole, void, monster | `blackHole` 1; `bhMass` 0.8–1.5 to make it big; `bhFlares` 1 if "violent" or "feeding" |
| Collision, chaos, merger | `collision` 1; `companionMass` 0.3–0.6; `encounterTilt` < 90 for long tails, > 90 retrograde (weaker tails); `bhGravity` 1 only together with `blackHole` 1 and `collision` 1 |
| Cinematic / showcase | `autoOrbit` 1; `tiltDeg` 8–20 |
| Still / contemplative | `autoOrbit` 0 |

Rules:
- Every value must sit inside [min, max] and on the step grid (`min + k·step`). Integers stay integers.
- `tintStrength` 0 means no filter (`tintHue` is then ignored; keep it 0). Combine with `colorTemp` in the same direction for richer color, e.g. red: `colorTemp` 0.8–1 + `tintHue` 0–10 at 0.5–0.65 (see `presets/dying-red-giant.json`).
- Switches (`autoOrbit`, `blackHole`, `bhFlares`, `bhGravity`, `collision`) are exactly 0 or 1.
- Keep `starCount` at or below 150000 unless the user asks for more; collision mode simulates about 1.6× that many particles on the CPU. Keep dynamics internals (`v0`, `rc`, `windingRate`, `corotation`, `armLock`, `galaxyRadius`) at their defaults unless the vibe clearly needs them; `armLock` below 1 makes arms wind into rings.
- Pick a fresh `seed` (any integer 0–999999) so the preset gets its own galaxy.
- The user prefers soft, puffy galaxies. Don't push contrast, sharpness or star size to extremes unless asked.
- The camera's viewing angle isn't a config key, so presets can't set it. Only `autoOrbit`, `orbitSpeed` and `tiltDeg` are camera settings.

## 3. Save it

- Name: 1–3 evocative words from the description, kebab-case (`neon-whirlpool`). If `presets/<name>.json` already exists, ask before overwriting, or pick another name.
- Write `presets/<name>.json`: one flat object with **every** key from config.js, in config.js order, numbers only, 2-space indent. No comments and no extra keys (the file name is the display name: `neon-whirlpool` shows as "Neon Whirlpool").
- Add `"<name>.json"` to `presets/index.json` (a JSON array of file names, sorted). This is what the dropdown reads on static hosts.

## 4. Validate (must pass)

```bash
python3 .claude/skills/preset/validate.py presets/<name>.json
```

It checks the file against the live config.js and checks that index.json matches the files on disk. Fix every FAIL before reporting. `--all` checks every preset.

## 5. Make sure the dropdown exists

The panel's Presets dropdown auto-loads everything in `presets/`. Check that these are all still there (they were added with this skill):
- `js/ui/presets.js`: `loadPresets()` reads `presets/index.json` and falls back to the `python3 -m http.server` directory listing.
- `js/config.js`: `applyPreset(values)` resets every key to its default, then applies the preset with `sanitize()`.
- `js/ui/panel.js`: a "Preset" `<select>` row at the top of the panel, `setPresets(list)`, `markCustom()`; `createPanel` takes `onPreset`.
- `js/main.js`: `onPreset` calls `applyPreset`, `panel.sync()` and `regenerate()`; `loadPresets().then(panel.setPresets)`.
- `css/style.css`: `.preset-select`.

If any piece is missing, rebuild it to match that description. The dropdown shows "Custom" whenever the settings don't match a preset (after any manual change, Randomize, or `C`).

## 6. Report

Tell the user the preset's name and file, a few lines on which knobs carry the vibe (with the panel's own wording: "Arm tightness 70%", "cool 0.45"), and how to see it: hard-refresh http://localhost:8000 (Ctrl+Shift+R) and pick it from the Preset dropdown. If you can, load it in the browser yourself and check it before reporting. Don't commit unless asked.

## Preset schema

JSON Schema (draft 2020-12), generated from `js/config.js`. It doesn't encode step alignment; the validator does.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "NEBULA preset",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "seed", "starCount", "armCount", "pitchDeg", "galaxyRadius", "diskScale", "armSpread",
    "diskThickness", "bulgeFraction", "fieldFraction", "haloFraction", "bulgeRadius",
    "bgStarCount", "youngFraction", "knotRate", "dustFraction", "v0", "rc", "windingRate",
    "timeScale", "corotation", "armLock", "exposure", "starSize", "coreGlow", "hazeBrightness",
    "glow", "colorTemp", "tintStrength", "tintHue", "dustOpacity", "bgBrightness", "twinkle",
    "autoOrbit", "orbitSpeed", "tiltDeg", "blackHole", "bhMass", "bhDiskBrightness", "bhDoppler",
    "bhFlares", "bhGravity", "collision", "companionMass", "encounterTilt", "pericenter",
    "collisionRate"
  ],
  "properties": {
    "seed": { "type": "integer", "minimum": 0, "maximum": 999999 },
    "starCount": { "type": "integer", "minimum": 5000, "maximum": 200000 },
    "armCount": { "type": "integer", "minimum": 1, "maximum": 6 },
    "pitchDeg": { "type": "number", "minimum": 6, "maximum": 35 },
    "galaxyRadius": { "type": "number", "minimum": 4, "maximum": 20 },
    "diskScale": { "type": "number", "minimum": 1, "maximum": 10 },
    "armSpread": { "type": "number", "minimum": 0.05, "maximum": 1.2 },
    "diskThickness": { "type": "number", "minimum": 0, "maximum": 1 },
    "bulgeFraction": { "type": "number", "minimum": 0, "maximum": 0.6 },
    "fieldFraction": { "type": "number", "minimum": 0, "maximum": 0.5 },
    "haloFraction": { "type": "number", "minimum": 0, "maximum": 0.3 },
    "bulgeRadius": { "type": "number", "minimum": 0.6, "maximum": 3.5 },
    "bgStarCount": { "type": "integer", "minimum": 0, "maximum": 20000 },
    "youngFraction": { "type": "number", "minimum": 0, "maximum": 1 },
    "knotRate": { "type": "number", "minimum": 0, "maximum": 0.03 },
    "dustFraction": { "type": "number", "minimum": 0, "maximum": 0.5 },
    "v0": { "type": "number", "minimum": 0, "maximum": 3 },
    "rc": { "type": "number", "minimum": 0.1, "maximum": 5 },
    "windingRate": { "type": "number", "minimum": 0, "maximum": 1 },
    "timeScale": { "type": "number", "minimum": 0, "maximum": 6 },
    "corotation": { "type": "number", "minimum": 0.1, "maximum": 1.5 },
    "armLock": { "type": "number", "minimum": 0, "maximum": 1 },
    "exposure": { "type": "number", "minimum": 0.1, "maximum": 5 },
    "starSize": { "type": "number", "minimum": 0.2, "maximum": 4 },
    "coreGlow": { "type": "number", "minimum": 0, "maximum": 4 },
    "hazeBrightness": { "type": "number", "minimum": 0, "maximum": 4 },
    "glow": { "type": "number", "minimum": 0, "maximum": 2.5 },
    "colorTemp": { "type": "number", "minimum": -1, "maximum": 1 },
    "tintStrength": { "type": "number", "minimum": 0, "maximum": 1 },
    "tintHue": { "type": "integer", "minimum": 0, "maximum": 360 },
    "dustOpacity": { "type": "number", "minimum": 0, "maximum": 4 },
    "bgBrightness": { "type": "number", "minimum": 0, "maximum": 3 },
    "twinkle": { "type": "number", "minimum": 0, "maximum": 1 },
    "autoOrbit": { "enum": [0, 1] },
    "orbitSpeed": { "type": "number", "minimum": 0, "maximum": 0.3 },
    "tiltDeg": { "type": "integer", "minimum": 0, "maximum": 30 },
    "blackHole": { "enum": [0, 1] },
    "bhMass": { "type": "number", "minimum": 0.1, "maximum": 2 },
    "bhDiskBrightness": { "type": "number", "minimum": 0, "maximum": 8 },
    "bhDoppler": { "type": "number", "minimum": 0, "maximum": 0.9 },
    "bhFlares": { "enum": [0, 1] },
    "bhGravity": { "enum": [0, 1] },
    "collision": { "enum": [0, 1] },
    "companionMass": { "type": "number", "minimum": 0.05, "maximum": 1 },
    "encounterTilt": { "type": "integer", "minimum": 0, "maximum": 180 },
    "pericenter": { "type": "number", "minimum": 0.5, "maximum": 3 },
    "collisionRate": { "type": "number", "minimum": 0, "maximum": 3 }
  }
}
```
