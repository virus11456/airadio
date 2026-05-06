// GET /audio/music/:songId — server-side proxy for NCM mp3 streams.
// Avoids browser CORS issues with NCM CDN and re-resolves expiring tokens.
import { Readable } from 'node:stream';
import * as ncm from '../core/ncm.js';

export default async function musicRoutes(fastify) {
  fastify.get('/audio/music/:songId', async (req, reply) => {
    const { songId } = req.params;
    if (!songId) return reply.code(400).send({ error: 'songId required' });

    let resolved;
    try {
      resolved = await ncm.songUrl(songId);
    } catch (e) {
      return reply.code(502).send({ error: `resolve failed: ${e.message}` });
    }
    if (!resolved?.url) return reply.code(404).send({ error: 'no playable url' });

    // Forward Range header so browser seek works.
    const range = req.headers.range;
    const headers = {};
    if (range) headers.Range = range;

    let upstream;
    try {
      upstream = await fetch(resolved.url, { headers });
    } catch (e) {
      return reply.code(502).send({ error: `upstream fetch failed: ${e.message}` });
    }
    if (!upstream.ok && upstream.status !== 206) {
      return reply.code(upstream.status).send({ error: `upstream ${upstream.status}` });
    }

    // Pass through useful headers for streaming.
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      const v = upstream.headers.get(h);
      if (v) reply.header(h, v);
    }
    if (!upstream.headers.get('content-type')) reply.header('content-type', 'audio/mpeg');
    reply.code(upstream.status === 206 ? 206 : 200);
    // upstream.body is a web ReadableStream; Fastify needs a Node Readable.
    return reply.send(Readable.fromWeb(upstream.body));
  });
}
