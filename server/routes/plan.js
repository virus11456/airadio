// GET /api/plan/today → today's program plan (json text)
import { state } from '../core/state.js';

export default async function planRoutes(fastify) {
  fastify.get('/api/plan/today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const row = state.getPlan(today);
    if (!row) return { date: today, plan: null };
    let parsed;
    try { parsed = JSON.parse(row.plan); } catch { parsed = row.plan; }
    return { date: today, plan: parsed, created: row.created };
  });
}
