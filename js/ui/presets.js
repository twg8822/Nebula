// Loads galaxy presets from presets/*.json (made by the /preset skill).
//
// presets/index.json lists the files and works on any static host. If it is
// missing, fall back to the directory listing that `python3 -m http.server`
// serves, so a freshly dropped-in preset still shows up.

const DIR = 'presets/';

/** "neon-whirlpool.json" -> "Neon Whirlpool" */
function displayName(file) {
  return file.replace(/\.json$/, '').split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function listFiles() {
  try {
    const res = await fetch(`${DIR}index.json`, { cache: 'no-cache' });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) return list.filter((f) => typeof f === 'string' && f.endsWith('.json'));
    }
  } catch { /* fall through to the listing */ }
  try {
    const res = await fetch(DIR, { cache: 'no-cache' });
    if (!res.ok) return [];
    const html = await res.text();
    const files = [...html.matchAll(/href="([^"?#/]+\.json)"/g)].map((m) => decodeURIComponent(m[1]));
    return files.filter((f) => f !== 'index.json');
  } catch {
    return [];
  }
}

/** Resolves to [{ name, file, values }], sorted by name. Bad files are skipped with a warning. */
export async function loadPresets() {
  const files = [...new Set(await listFiles())];
  const presets = await Promise.all(files.map(async (file) => {
    try {
      const res = await fetch(DIR + encodeURIComponent(file), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const values = await res.json();
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('not an object');
      return { name: displayName(file), file, values };
    } catch (err) {
      console.warn(`[nebula] skipping preset ${file}: ${err.message}`);
      return null;
    }
  }));
  return presets.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}
