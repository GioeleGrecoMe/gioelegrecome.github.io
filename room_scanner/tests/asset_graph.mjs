import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory() && !name.startsWith('.')) walk(full);
    else if (st.isFile()) files.push(full);
  }
};
walk(root);
const missing = [];
const check = (owner, raw) => {
  if (!raw || /^(?:https?:|data:|blob:|#)/.test(raw)) return;
  const clean = raw.split(/[?#]/)[0];
  if (!clean || clean === '/') return;
  const base = raw.startsWith('/') ? root : path.dirname(owner);
  const target = path.resolve(base, clean.replace(/^\//, ''));
  if (!target.startsWith(root) || !fs.existsSync(target)) missing.push(`${path.relative(root, owner)} -> ${raw}`);
};
for (const file of files) {
  if (!/\.(?:html|js|webmanifest|json)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const re of [
    /(?:src|href)=["']([^"']+)["']/g,
    /(?:import\s+(?:[^"']+?\s+from\s+)?|import\s*\()["']([^"']+)["']/g,
    /new\s+(?:Worker|SharedWorker)\s*\(\s*new\s+URL\s*\(\s*["']([^"']+)["']/g,
    /new\s+(?:Worker|SharedWorker)\s*\(\s*["']([^"']+)["']/g,
    /audioWorklet\.addModule\s*\(\s*["']([^"']+)["']/g,
  ]) {
    let m;
    while ((m = re.exec(text))) check(file, m[1]);
  }
}
if (missing.length) throw new Error(`Missing static assets:\n${missing.join('\n')}`);
console.log('PASS asset_graph');
