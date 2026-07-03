// POST /api/chat — listener-facing input.
//   - Commands ("skip" / "暫停") → executed immediately.
//   - Music asks ("放點 city pop") → recorded as a hint for next refill.
//   - Anything else → recorded as a FAN LETTER (role='fan', addressed=0).
//
// The DJ worker reads unaddressed fan letters from state and may respond
// to them in its next on-air segment.
import { route } from '../core/router.js';
import { state } from '../core/state.js';
import * as dj from '../workers/dj.js';
import { publish, events } from '../core/bus.js';

export default async function chatRoutes(fastify) {
  fastify.post('/api/chat', async (req, reply) => {
    const text = (req.body?.text ?? '').toString().trim();
    if (!text) return reply.code(400).send({ error: 'text required' });
    if (text.length > 500) return reply.code(413).send({ error: 'too long' });

    const sender = (req.headers['x-client-id'] || '').toString().slice(0, 64) || null;

    state.recordMessage('user', text, sender);
    publish(events.USER_MESSAGE, { text, sender });

    const r = route(text);
    switch (r.kind) {
      case 'cmd':
        if (r.action === 'skip')   dj.skip();
        else if (r.action === 'pause')  dj.pause();
        else if (r.action === 'resume') dj.resume();
        publish(events.CMD, r);
        return { ok: true, kind: 'cmd', action: r.action };

      case 'music':
        // Music request: still a fan signal but tagged so DJ understands intent.
        state.recordMessage('fan', `[點歌] ${r.query}`, sender);
        publish(events.USER_MESSAGE, { text: `[點歌] ${r.query}`, sender, kind: 'music' });
        dj.requestLetterReply();
        return { ok: true, kind: 'music', query: r.query };

      case 'claude':
      default:
        // Free-form letter to the DJ.
        state.recordMessage('fan', text, sender);
        publish(events.USER_MESSAGE, { text, sender, kind: 'letter' });
        dj.requestLetterReply();
        return { ok: true, kind: 'letter' };
    }
  });
}
