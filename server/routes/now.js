// GET /api/now → current playing item (from dj worker memory).
import * as dj from '../workers/dj.js';

export default async function nowRoutes(fastify) {
  fastify.get('/api/now', async () => {
    const snap = dj.snapshot();
    return { current: snap.current, paused: snap.paused };
  });
}
