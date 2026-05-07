// Live "Heart Rain" — listeners click the cover, every other listener sees it.
//
//   POST /api/reaction { emoji?, x?, y? }
//
// We don't persist (this is ephemeral live atmosphere, not a feedback signal).
// The publish() call broadcasts via the same event bus that powers the WS
// stream, so all connected PWAs get a `reaction` event in real time.
import { publish } from '../core/bus.js';

const ALLOWED = ['💖', '🔥', '😍', '😴', '🌊', '☀️', '🌙', '🎵'];
let recent = []; // ring buffer for late-joiners (last 8 seconds)

export default async function reactionRoutes(fastify) {
  fastify.post('/api/reaction', async (req, reply) => {
    const { emoji, x, y } = req.body || {};
    const safeEmoji = ALLOWED.includes(emoji) ? emoji : '💖';
    const sender = (req.headers['x-client-id'] || '').toString().slice(0, 64) || 'anon';
    const payload = {
      emoji: safeEmoji,
      // Normalised 0..1 coordinates so layouts of different sizes still align.
      x: Math.max(0, Math.min(1, Number(x) || Math.random())),
      y: Math.max(0, Math.min(1, Number(y) || 0.6 + Math.random() * 0.3)),
      sender,
      ts: Date.now(),
    };
    publish('reaction', payload);

    recent.push(payload);
    const cutoff = Date.now() - 8000;
    recent = recent.filter(r => r.ts >= cutoff);

    return { ok: true };
  });

  // Optional: late-joiners can pull the last few seconds of reactions.
  fastify.get('/api/reaction/recent', async () => ({ recent }));
}
