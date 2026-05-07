// SQLite persistence. Synchronous (better-sqlite3) — fine for our throughput.
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.STATE_DB_PATH
  || path.resolve(__dirname, '../../data/state.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    ts INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id TEXT,
    title TEXT,
    artist TEXT,
    src TEXT,
    duration INTEGER,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS plays_ts_idx ON plays(ts DESC);

  CREATE TABLE IF NOT EXISTS plan (
    date TEXT PRIMARY KEY,
    plan TEXT,
    created INTEGER
  );

  CREATE TABLE IF NOT EXISTS prefs (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS heartbeat (
    worker TEXT PRIMARY KEY,
    ts INTEGER NOT NULL
  );

  -- One row per (track, kind). Anonymous-listener feedback is keyed
  -- by client_id (set by the PWA via localStorage). Keeping it simple:
  -- a thumbs-up overrides a thumbs-down for the same client + track,
  -- so we just upsert.
  CREATE TABLE IF NOT EXISTS feedback (
    client_id TEXT NOT NULL,
    track_id  TEXT NOT NULL,
    kind      TEXT NOT NULL CHECK (kind IN ('like','dislike')),
    title     TEXT,
    artist    TEXT,
    ts        INTEGER NOT NULL,
    PRIMARY KEY (client_id, track_id)
  );
  CREATE INDEX IF NOT EXISTS feedback_track_idx ON feedback(track_id);
  CREATE INDEX IF NOT EXISTS feedback_kind_idx  ON feedback(kind, ts DESC);
`);

// Migrate older DBs: add addressed/sender columns to messages if missing.
{
  const cols = db.pragma('table_info(messages)');
  const have = new Set(cols.map(c => c.name));
  if (!have.has('addressed'))   db.exec("ALTER TABLE messages ADD COLUMN addressed INTEGER NOT NULL DEFAULT 0");
  if (!have.has('sender'))      db.exec("ALTER TABLE messages ADD COLUMN sender    TEXT");
}

const stmts = {
  insertMessage: db.prepare('INSERT INTO messages (role, content, ts, sender) VALUES (?, ?, ?, ?)'),
  recentMessages: db.prepare('SELECT role, content, ts FROM messages ORDER BY ts DESC LIMIT ?'),
  insertPlay: db.prepare('INSERT INTO plays (song_id, title, artist, src, duration, ts) VALUES (?, ?, ?, ?, ?, ?)'),
  recentPlays: db.prepare('SELECT song_id, title, artist, duration, ts FROM plays ORDER BY ts DESC LIMIT ?'),
  upsertPlan: db.prepare('INSERT INTO plan (date, plan, created) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET plan=excluded.plan, created=excluded.created'),
  getPlan: db.prepare('SELECT plan, created FROM plan WHERE date = ?'),
  upsertPref: db.prepare('INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
  getPref: db.prepare('SELECT value FROM prefs WHERE key = ?'),
  upsertHeartbeat: db.prepare('INSERT INTO heartbeat (worker, ts) VALUES (?, ?) ON CONFLICT(worker) DO UPDATE SET ts=excluded.ts'),
  getHeartbeats: db.prepare('SELECT worker, ts FROM heartbeat'),

  // Feedback
  upsertFeedback: db.prepare(`
    INSERT INTO feedback (client_id, track_id, kind, title, artist, ts)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id, track_id) DO UPDATE SET
      kind = excluded.kind, title = excluded.title, artist = excluded.artist, ts = excluded.ts
  `),
  deleteFeedback: db.prepare('DELETE FROM feedback WHERE client_id = ? AND track_id = ?'),
  getFeedbackForTrack: db.prepare(`
    SELECT
      SUM(CASE WHEN kind='like' THEN 1 ELSE 0 END)    AS likes,
      SUM(CASE WHEN kind='dislike' THEN 1 ELSE 0 END) AS dislikes
    FROM feedback WHERE track_id = ?
  `),
  getMyFeedback: db.prepare('SELECT kind FROM feedback WHERE client_id = ? AND track_id = ?'),
  topLiked: db.prepare(`
    SELECT track_id, title, artist, COUNT(*) AS n, MAX(ts) AS latest
    FROM feedback WHERE kind = 'like'
    GROUP BY track_id, title, artist
    ORDER BY latest DESC
    LIMIT ?
  `),
  topDisliked: db.prepare(`
    SELECT track_id, title, artist, COUNT(*) AS n, MAX(ts) AS latest
    FROM feedback WHERE kind = 'dislike'
    GROUP BY track_id, title, artist
    ORDER BY latest DESC
    LIMIT ?
  `),
  recentFeedback: db.prepare(`
    SELECT client_id, track_id, kind, title, artist, ts
    FROM feedback
    ORDER BY ts DESC
    LIMIT ?
  `),
  unaddressedFan: db.prepare(`
    SELECT id, content, sender, ts FROM messages
    WHERE role = 'fan' AND addressed = 0
    ORDER BY ts ASC
    LIMIT ?
  `),
  recentFan: db.prepare(`
    SELECT id, content, sender, addressed, ts FROM messages
    WHERE role = 'fan'
    ORDER BY ts DESC
    LIMIT ?
  `),
  markAddressedById: db.prepare(`UPDATE messages SET addressed = 1 WHERE id = ?`),
  markAddressedOlderThan: db.prepare(`UPDATE messages SET addressed = 1 WHERE role = 'fan' AND ts < ? AND addressed = 0`),
};

export const state = {
  recordMessage(role, content, sender = null) {
    stmts.insertMessage.run(role, content, Date.now(), sender);
  },
  recentMessages(limit = 20) {
    return stmts.recentMessages.all(limit).reverse();
  },
  recordPlay({ songId, title, artist, src, duration }) {
    stmts.insertPlay.run(songId ?? null, title ?? null, artist ?? null, src ?? null, duration ?? null, Date.now());
  },
  recentPlays(limit = 10) {
    return stmts.recentPlays.all(limit);
  },
  setPlan(dateStr, planText) {
    stmts.upsertPlan.run(dateStr, planText, Date.now());
  },
  getPlan(dateStr) {
    return stmts.getPlan.get(dateStr) ?? null;
  },
  setPref(key, value) {
    stmts.upsertPref.run(key, JSON.stringify(value));
  },
  getPref(key, fallback = null) {
    const row = stmts.getPref.get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  },
  beat(worker) {
    stmts.upsertHeartbeat.run(worker, Date.now());
  },
  heartbeats() {
    return stmts.getHeartbeats.all();
  },

  // ---------- Feedback ----------
  recordFeedback({ clientId, trackId, kind, title, artist }) {
    if (!clientId || !trackId) throw new Error('clientId + trackId required');
    if (!['like', 'dislike'].includes(kind)) throw new Error('kind must be like|dislike');
    stmts.upsertFeedback.run(clientId, trackId, kind, title || null, artist || null, Date.now());
  },
  clearFeedback({ clientId, trackId }) {
    stmts.deleteFeedback.run(clientId, trackId);
  },
  feedbackForTrack(trackId) {
    const row = stmts.getFeedbackForTrack.get(trackId) || {};
    return { likes: row.likes || 0, dislikes: row.dislikes || 0 };
  },
  myFeedback({ clientId, trackId }) {
    if (!clientId) return null;
    const row = stmts.getMyFeedback.get(clientId, trackId);
    return row?.kind || null;
  },
  topLiked(limit = 10) {
    return stmts.topLiked.all(limit);
  },
  topDisliked(limit = 10) {
    return stmts.topDisliked.all(limit);
  },
  recentFeedback(limit = 20) {
    return stmts.recentFeedback.all(limit);
  },

  // ---------- Listener fan-mail ----------
  unaddressedFanMessages(limit = 5) {
    return stmts.unaddressedFan.all(limit);
  },
  recentFanMessages(limit = 20) {
    return stmts.recentFan.all(limit);
  },
  markFanAddressed(ids) {
    if (!Array.isArray(ids) || !ids.length) return 0;
    let n = 0;
    for (const id of ids) {
      const v = Number(id);
      if (!Number.isFinite(v)) continue;
      const r = stmts.markAddressedById.run(v);
      n += r.changes || 0;
    }
    return n;
  },
  expireOldFanMessages(olderThanMs = 30 * 60 * 1000) {
    const cutoff = Date.now() - olderThanMs;
    const r = stmts.markAddressedOlderThan.run(cutoff);
    return r.changes || 0;
  },
};

export default state;
