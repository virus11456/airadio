// GET /api/lyrics/:songId → fetch lyrics from NCM (server-side, no CORS).
import * as ncm from '../core/ncm.js';

export default async function lyricsRoutes(fastify) {
  fastify.get('/api/lyrics/:songId', async (req, reply) => {
    const { songId } = req.params;
    if (!songId) return reply.code(400).send({ error: 'songId required' });
    try {
      const lyric = await ncm.lyric(songId);
      return { songId, lyric };
    } catch (e) {
      reply.code(502).send({ error: e.message });
    }
  });
}
