// Fastify boot. Wires routes, starts workers, serves the PWA.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';

import chatRoutes from './routes/chat.js';
import nowRoutes from './routes/now.js';
import nextRoutes from './routes/next.js';
import tasteRoutes from './routes/taste.js';
import planRoutes from './routes/plan.js';
import streamRoutes from './routes/stream.js';
import lyricsRoutes from './routes/lyrics.js';
import musicRoutes from './routes/music.js';

import { djLoop } from './workers/dj.js';
import { musicLoop } from './workers/music.js';
import { startScheduler } from './workers/scheduler.js';
import { startHeartbeat } from './workers/heartbeat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
  },
  bodyLimit: 1024 * 1024,
});

await app.register(websocket);

// PWA static at /
const pwaDir = path.join(ROOT, 'pwa');
if (fs.existsSync(pwaDir)) {
  await app.register(staticPlugin, { root: pwaDir, prefix: '/' });
}

// TTS cache served at /audio/tts/<hash>.mp3
const ttsDir = path.join(ROOT, process.env.TTS_CACHE_DIR || 'cache/tts');
fs.mkdirSync(ttsDir, { recursive: true });
await app.register(staticPlugin, {
  root: ttsDir,
  prefix: '/audio/tts/',
  decorateReply: false,
});

await app.register(chatRoutes);
await app.register(nowRoutes);
await app.register(nextRoutes);
await app.register(tasteRoutes);
await app.register(planRoutes);
await app.register(streamRoutes);
await app.register(lyricsRoutes);
await app.register(musicRoutes);

app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

const PORT = Number(process.env.PORT || 8080);
await app.listen({ port: PORT, host: '0.0.0.0' });
app.log.info(`airadio listening on :${PORT}`);

// Start background workers (fire-and-forget, errors logged inside loops)
djLoop().catch(e => app.log.error({ err: e }, 'dj loop crashed'));
musicLoop().catch(e => app.log.error({ err: e }, 'music loop crashed'));
startScheduler();
startHeartbeat();

// Graceful shutdown for PM2 / systemd
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    app.log.info(`received ${sig}, closing`);
    try { await app.close(); } finally { process.exit(0); }
  });
}
