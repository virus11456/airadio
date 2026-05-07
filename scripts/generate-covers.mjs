#!/usr/bin/env node
// scripts/generate-covers.mjs
// Generate per-track AI album covers via pollinations.ai (free, no auth).
// Reads user/suno-library.json and produces cache/covers/<id>.jpg.
// Idempotent: skips tracks whose cover already exists with non-zero size.
//
// Usage:
//   node scripts/generate-covers.mjs                  # default: only missing
//   node scripts/generate-covers.mjs --force          # regenerate everything
//   node scripts/generate-covers.mjs --max 5          # cap how many to generate this run
//   node scripts/generate-covers.mjs --concurrency 3  # parallel HTTP fetches

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB_PATH = path.join(ROOT, 'user', 'suno-library.json');
const COVER_DIR = path.join(ROOT, 'cache', 'covers');
const SIZE = 768;
const MODEL = process.env.COVER_MODEL || 'flux';
const TIMEOUT_MS = Number(process.env.COVER_TIMEOUT_MS || 120000);
const STYLE = process.env.COVER_STYLE
  || '1980s 1990s Japanese city pop album cover, Hiroshi Nagai inspired illustration, soft sunset palette, retro vaporwave, vintage anime palm trees, clean vector style, no text, no watermark';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const QUIET = argv.includes('--quiet');
const MAX = (() => { const i = argv.indexOf('--max'); return i >= 0 ? Number(argv[i + 1]) : Infinity; })();
const CONC = (() => { const i = argv.indexOf('--concurrency'); return i >= 0 ? Math.max(1, Number(argv[i + 1])) : 2; })();

function log(...a) { if (!QUIET) console.log('[covers]', ...a); }
function warn(...a) { console.warn('[covers]', ...a); }

function loadLibrary() {
  if (!fs.existsSync(LIB_PATH)) { warn('suno-library.json missing at', LIB_PATH); return []; }
  try { return JSON.parse(fs.readFileSync(LIB_PATH, 'utf8')); }
  catch (e) { warn('library parse error', e.message); return []; }
}

function buildPrompt(track) {
  const title = (track.title || '').trim();
  const tags = (track.tags || '').toString();
  const hints = tags.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
  const flavor = hints.length ? hints.join(', ') : 'mellow city pop';
  return `${STYLE}, mood: ${flavor}${title ? ', subtle theme: ' + title : ''}`;
}

function coverPath(id) { return path.join(COVER_DIR, `${id}.jpg`); }

function alreadyHas(id) {
  try { const s = fs.statSync(coverPath(id)); return s.isFile() && s.size > 1024; }
  catch { return false; }
}

function pollinationsUrl(prompt, seed) {
  const enc = encodeURIComponent(prompt);
  const params = new URLSearchParams({ width: String(SIZE), height: String(SIZE), nologo: 'true', seed: String(seed), model: MODEL });
  return `https://image.pollinations.ai/prompt/${enc}?${params}`;
}

function seedFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000000;
}

async function fetchCover(track) {
  const url = pollinationsUrl(buildPrompt(track), seedFromId(track.id));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) throw new Error(`tiny response ${buf.length}b`);
    return buf;
  } finally { clearTimeout(t); }
}

async function processTrack(track, idx, total) {
  if (!FORCE && alreadyHas(track.id)) return { id: track.id, status: 'skip' };
  try {
    const buf = await fetchCover(track);
    fs.writeFileSync(coverPath(track.id), buf);
    log(`(${idx}/${total}) ok ${track.id} — ${(track.title || '').slice(0, 40)} (${(buf.length/1024).toFixed(1)} KB)`);
    return { id: track.id, status: 'ok', bytes: buf.length };
  } catch (e) {
    warn(`(${idx}/${total}) fail ${track.id} — ${e.message}`);
    return { id: track.id, status: 'fail', error: e.message };
  }
}

async function runPool(items, worker, concurrency = 2) {
  const results = [];
  let i = 0;
  async function next() { while (i < items.length) { const my = i++; results[my] = await worker(items[my], my + 1, items.length); } }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
  return results;
}

async function main() {
  fs.mkdirSync(COVER_DIR, { recursive: true });
  const lib = loadLibrary();
  if (!lib.length) { log('library empty, nothing to do'); return; }
  const todo = lib.filter(t => FORCE || !alreadyHas(t.id)).slice(0, MAX);
  if (!todo.length) { log(`all ${lib.length} covers already cached, nothing to do`); return; }
  log(`generating ${todo.length} cover(s) — model=${MODEL}, conc=${CONC}, force=${FORCE}`);
  const t0 = Date.now();
  const results = await runPool(todo, processTrack, CONC);
  const ok = results.filter(r => r.status === 'ok').length;
  const fail = results.filter(r => r.status === 'fail').length;
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ok=${ok} fail=${fail}`);
  if (fail) process.exit(1);
}

main().catch(e => { warn('fatal', e); process.exit(2); });
