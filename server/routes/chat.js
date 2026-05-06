// POST /api/chat — user message → route → react.
// Simple commands return immediately; claude-bound chats are persisted and
// will influence the next refill cycle via the messages table.
import { route } from '../core/router.js';
import { state } from '../core/state.js';
import * as dj from '../workers/dj.js';
import { publish, events } from '../core/bus.js';

export default async function chatRoutes(fastify) {
  fastify.post('/api/chat', async (req, reply) => {
    const text = (req.body?.text ?? '').toString();
    if (!text) return reply.code(400).send({ error: 'text required' });

    state.recordMessage('user', text);
    publish(events.USER_MESSAGE, { text });

    const r = route(text);
    switch (r.kind) {
      case 'cmd':
        if (r.action === 'skip') dj.skip();
        else if (r.action === 'pause') dj.pause();
        else if (r.action === 'resume') dj.resume();
        publish(events.CMD, r);
        return { ok: true, kind: 'cmd', action: r.action };

      case 'music':
        // Inject as next-refill hint; DJ loop picks it up at next refill cycle.
        dj.setNextHint(`用戶想聽：${r.query}`);
        return { ok: true, kind: 'music', query: r.query };

      case 'claude':
      default:
        dj.setNextHint(`用戶說：${r.input}`);
        return { ok: true, kind: 'claude', input: r.input };
    }
  });
}
