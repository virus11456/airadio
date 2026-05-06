// GET /api/next → upcoming queue (so PWA can show "下一首")
import * as dj from '../workers/dj.js';

export default async function nextRoutes(fastify) {
  fastify.get('/api/next', async () => {
    const snap = dj.snapshot();
    return { queue: snap.queue };
  });
}
