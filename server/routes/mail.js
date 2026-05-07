// Public read-only view of recent listener letters so the PWA can show
// the live "fan mail" ticker. Sender ids are sliced down to 6 chars so
// they look like a handle, not a tracking cookie.
import { state } from '../core/state.js';

export default async function mailRoutes(fastify) {
  fastify.get('/api/mail/recent', async (req) => {
    const limit = Math.max(1, Math.min(20, Number(req.query?.limit || 6)));
    const rows = state.recentFanMessages?.(limit) || [];
    return {
      letters: rows.map(r => ({
        id: r.id,
        sender: (r.sender || 'anon').slice(0, 6),
        content: r.content || '',
        addressed: !!r.addressed,
        ts: r.ts,
      })),
    };
  });
}
