// Loads galaxy presets from presets/*.json (made by the /preset skill).
//
// presets/index.json lists the files and works on any static host. If it is
// missing, fall back to the directory listing that `python3 -m http.server`
// serves, so a freshly dropped-in preset still shows up.
//
// index.json entries are file names, or {"file": ..., "name": ...} when the
// display name needs something a file name can't hold (an apostrophe).

const DIR = 'presets/';

/** "neon-whirlpool.json" -> "Neon Whirlpool" */
function displayName(file) {
  return file.replace(/\.json$/, '').split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const isJson = (f) => typeof f === 'string' && f.endsWith('.json');

/** Resolves to [{ file, name? }]. */
async function listFiles() {
  try {
    const res = await fetch(`${DIR}index.json`, { cache: 'no-cache' });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        return list
          .map((x) => (typeof x === 'string' ? { file: x } : x))
          .filter((x) => x && isJson(x.file))
          .map((x) => ({ file: x.file, name: typeof x.name === 'string' && x.name.trim() ? x.name : undefined }));
      }
    }
  } catch { /* fall through to the listing */ }
  try {
    const res = await fetch(DIR, { cache: 'no-cache' });
    if (!res.ok) return [];
    const html = await res.text();
    const files = [...html.matchAll(/href="([^"?#/]+\.json)"/g)].map((m) => decodeURIComponent(m[1]));
    return files.filter((f) => f !== 'index.json').map((file) => ({ file }));
  } catch {
    return [];
  }
}

/** Resolves to [{ name, file, values }], sorted by name. Bad files are skipped with a warning. */
export async function loadPresets() {
  const entries = [...new Map((await listFiles()).map((e) => [e.file, e])).values()];
  const presets = await Promise.all(entries.map(async ({ file, name }) => {
    try {
      const res = await fetch(DIR + encodeURIComponent(file), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const values = await res.json();
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('not an object');
      return { name: name || displayName(file), file, values };
    } catch (err) {
      console.warn(`[nebula] skipping preset ${file}: ${err.message}`);
      return null;
    }
  }));
  return presets.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}
