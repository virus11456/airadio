// WS /stream — fan out internal bus events to connected PWAs.
// Events forwarded: now-playing, queue-update, dj-saying, plan-updated, cmd.
import { bus } from '../core/bus.js';

export default async function streamRoutes(fastify) {
  fastify.get('/stream', { websocket: true }, (socket /* SocketStream */) => {
    const send = (msg) => {
      try { socket.send(JSON.stringify(msg)); } catch {}
    };
    const onEvent = (msg) => send(msg);
    bus.on('event', onEvent);

    send({ type: 'hello', payload: { ts: Date.now() } });

    socket.on('close', () => bus.off('event', onEvent));
    socket.on('error', () => bus.off('event', onEvent));
  });
}
