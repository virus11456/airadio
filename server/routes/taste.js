// GET /api/taste → read user corpus
// PUT /api/taste → write user corpus (Profile view edits)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DIR = path.resolve(__dirname, '../../user');

const FILES = {
  taste: 'taste.md',
  routines: 'routines.md',
  mood: 'mood-rules.md',
  playlists: 'playlists.json',
};

function readFile(name) {
  try { return fs.readFileSync(path.join(USER_DIR, name), 'utf8'); }
  catch { return ''; }
}

export default async function tasteRoutes(fastify) {
  fastify.get('/api/taste', async () => {
    return Object.fromEntries(
      Object.entries(FILES).map(([k, f]) => [k, readFile(f)])
    );
  });

  fastify.put('/api/taste', async (req, reply) => {
    const body = req.body || {};
    const updated = [];
    for (const [k, content] of Object.entries(body)) {
      if (!FILES[k]) continue;
      if (typeof content !== 'string') continue;
      fs.writeFileSync(path.join(USER_DIR, FILES[k]), content, 'utf8');
      updated.push(k);
    }
    return { ok: true, updated };
  });
}
