// Like / Dislike endpoints. Anonymous: each PWA generates a stable
// `client_id` in localStorage and sends it with every request.
//
//   POST   /api/feedback           { trackId, kind, title?, artist? }      (header X-Client-Id required)
//   DELETE /api/feedback/:trackId  (header X-Client-Id required)
//   GET    /api/feedback/:trackId  (X-Client-Id optional; returns counts + my)
//   GET    /api/feedback/summary   { likes:[…], dislikes:[…] }   (DJ-facing)

import { state } from '../core/state.js';
import { publish, events } from '../core/bus.js';

function getClientId(req) {
  const h = req.headers['x-client-id'];
  if (!h || typeof h !== 'string') return null;
  // Defensive cap; the PWA generates ~24-char ids.
  return h.slice(0, 64);
}

export default async function feedbackRoutes(fastify) {
  fastify.post('/api/feedback', async (req, reply) => {
    const clientId = getClientId(req);
    if (!clientId) return reply.code(400).send({ error: 'X-Client-Id header required' });
    const { trackId, kind, title, artist } = req.body || {};
    if (!trackId)  return reply.code(400).send({ error: 'trackId required' });
    if (!['like', 'dislike'].includes(kind)) return reply.code(400).send({ error: "kind must be 'like' or 'dislike'" });

    state.recordFeedback({ clientId, trackId, kind, title, artist });
    publish(events.USER_MESSAGE ?? 'user-message', { feedback: { trackId, kind, title, artist } });

    const counts = state.feedbackForTrack(trackId);
    return { ok: true, kind, ...counts };
  });

  fastify.delete('/api/feedback/:trackId', async (req, reply) => {
    const clientId = getClientId(req);
    if (!clientId) return reply.code(400).send({ error: 'X-Client-Id header required' });
    const { trackId } = req.params;
    state.clearFeedback({ clientId, trackId });
    return { ok: true, ...state.feedbackForTrack(trackId) };
  });

  fastify.get('/api/feedback/summary', async () => {
    return {
      likes:    state.topLiked(20),
      dislikes: state.topDisliked(20),
      recent:   state.recentFeedback(30),
    };
  });

  fastify.get('/api/feedback/:trackId', async (req) => {
    const clientId = getClientId(req);
    const { trackId } = req.params;
    const counts = state.feedbackForTrack(trackId);
    return { ...counts, mine: clientId ? state.myFeedback({ clientId, trackId }) : null };
  });
}
