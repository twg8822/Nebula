#!/usr/bin/env python3
"""Validate NEBULA preset files against the live parameter table in js/config.js.

Usage (from the repo root):
  python3 .claude/skills/preset/validate.py presets/some-name.json [...]
  python3 .claude/skills/preset/validate.py --all        # every preset + index.json
  python3 .claude/skills/preset/validate.py --defaults   # print current defaults as a preset

Checks: every config key present, no unknown keys, numbers only, within
[min, max], on the step grid, 0/1 switches are exactly 0 or 1, and
presets/index.json lists exactly the preset files on disk (sorted; an entry may be
{"file": ..., "name": ...} to set a display name).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONFIG = ROOT / 'js' / 'config.js'
PRESETS = ROOT / 'presets'
NUM = r'(-?\d+(?:\.\d+)?(?:e-?\d+)?)'
ROW = re.compile(rf'^\s+(\w+):\s*\{{\s*value:\s*{NUM},\s*min:\s*{NUM},\s*max:\s*{NUM},\s*step:\s*{NUM}', re.M)


def load_params():
    params = {}
    for key, value, lo, hi, step in ROW.findall(CONFIG.read_text()):
        params[key] = {'value': float(value), 'min': float(lo), 'max': float(hi), 'step': float(step)}
    if not params:
        sys.exit(f'could not parse any params from {CONFIG}')
    return params


def clean(x):
    return int(x) if float(x).is_integer() else x


def check(path, params):
    errors = []
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        return [f'cannot read JSON: {e}']
    if not isinstance(data, dict):
        return ['top level must be an object']
    for key in data:
        if key not in params:
            errors.append(f'unknown key "{key}"')
    for key, p in params.items():
        if key not in data:
            errors.append(f'missing key "{key}"')
            continue
        v = data[key]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            errors.append(f'{key}: must be a number, got {v!r}')
            continue
        if not p['min'] <= v <= p['max']:
            errors.append(f'{key}: {v} outside [{clean(p["min"])}, {clean(p["max"])}]')
        steps = (v - p['min']) / p['step']
        if abs(steps - round(steps)) > 1e-6:
            errors.append(f'{key}: {v} is off the step grid (step {clean(p["step"])} from {clean(p["min"])})')
    name = Path(path).stem
    if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', name):
        errors.append(f'file name "{name}" is not kebab-case')
    return errors


def check_index():
    index = PRESETS / 'index.json'
    on_disk = sorted(p.name for p in PRESETS.glob('*.json') if p.name != 'index.json')
    if not index.exists():
        return [f'{index.relative_to(ROOT)} is missing']
    try:
        listed = json.loads(index.read_text())
    except json.JSONDecodeError as e:
        return [f'index.json: {e}']
    # Entries are file names, or {"file": ..., "name": ...} to give a display
    # name the file name can't spell (e.g. an apostrophe).
    def entry_file(x):
        if isinstance(x, str):
            return x
        if isinstance(x, dict) and isinstance(x.get('file'), str) and isinstance(x.get('name'), str) \
                and set(x) == {'file', 'name'} and x['name'].strip():
            return x['file']
        return None
    if not isinstance(listed, list) or any(entry_file(x) is None for x in listed):
        return ['index.json must be a JSON array of file names or {"file", "name"} objects']
    listed = [entry_file(x) for x in listed]
    if listed != sorted(listed):
        return ['index.json must be sorted by file name']
    errors = [f'index.json lists "{x}" but the file is missing' for x in listed if x not in on_disk]
    errors += [f'index.json is missing "{x}"' for x in on_disk if x not in listed]
    return errors


def main(argv):
    params = load_params()
    if argv == ['--defaults']:
        print(json.dumps({k: clean(p['value']) for k, p in params.items()}, indent=2))
        return 0
    files = sorted(str(p) for p in PRESETS.glob('*.json') if p.name != 'index.json') if argv == ['--all'] else argv
    if not files:
        print(__doc__)
        return 2
    failed = False
    for f in files:
        errs = check(f, params)
        failed |= bool(errs)
        print(f'{"FAIL" if errs else "ok  "} {f}')
        for e in errs:
            print(f'       - {e}')
    if argv == ['--all'] or PRESETS.joinpath('index.json').exists():
        errs = check_index()
        failed |= bool(errs)
        print(f'{"FAIL" if errs else "ok  "} presets/index.json')
        for e in errs:
            print(f'       - {e}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
