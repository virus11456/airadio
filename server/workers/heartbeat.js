// Heartbeat watchdog. Each worker beats periodically; this worker checks
// for stale beats and logs a loud warning. Process-level restart is left
// to PM2 (single-process model — if any loop deadlocks, exit hard).
import { state } from '../core/state.js';

const STALE_MS = Number(process.env.HEARTBEAT_STALE_MS || 90_000);
const CHECK_INTERVAL = 30_000;

export function startHeartbeat() {
  console.log('[heartbeat] started');
  setInterval(() => {
    state.beat('heartbeat');
    const beats = state.heartbeats();
    const now = Date.now();
    const stale = beats.filter(b => b.worker !== 'heartbeat' && now - b.ts > STALE_MS);
    if (stale.length) {
      console.error('[heartbeat] STALE workers:', stale.map(s => `${s.worker}(${Math.round((now - s.ts) / 1000)}s)`).join(', '));
      // Hard exit lets PM2 / systemd restart us. Comment out if you want
      // to keep running with a degraded loop.
      if (process.env.HEARTBEAT_HARD_EXIT === '1') {
        console.error('[heartbeat] HARD EXIT for restart');
        process.exit(2);
      }
    }
  }, CHECK_INTERVAL);
}
