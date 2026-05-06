// Internal event bus. Workers publish events, WS subscribers forward them.
// Decouples the music/dj loops from the transport.
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(64);

// Convenience wrappers — keeps event names in one place.
export const events = {
  NOW_PLAYING: 'now-playing',
  QUEUE_UPDATE: 'queue-update',
  DJ_SAYING: 'dj-saying',
  PLAN_UPDATED: 'plan-updated',
  USER_MESSAGE: 'user-message',
  CMD: 'cmd',
};

export function publish(type, payload = {}) {
  bus.emit('event', { type, payload, ts: Date.now() });
  bus.emit(type, payload);
}

export default bus;
