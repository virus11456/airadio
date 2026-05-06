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
`);

const stmts = {
  insertMessage: db.prepare('INSERT INTO messages (role, content, ts) VALUES (?, ?, ?)'),
  recentMessages: db.prepare('SELECT role, content, ts FROM messages ORDER BY ts DESC LIMIT ?'),
  insertPlay: db.prepare('INSERT INTO plays (song_id, title, artist, src, duration, ts) VALUES (?, ?, ?, ?, ?, ?)'),
  recentPlays: db.prepare('SELECT song_id, title, artist, duration, ts FROM plays ORDER BY ts DESC LIMIT ?'),
  upsertPlan: db.prepare('INSERT INTO plan (date, plan, created) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET plan=excluded.plan, created=excluded.created'),
  getPlan: db.prepare('SELECT plan, created FROM plan WHERE date = ?'),
  upsertPref: db.prepare('INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
  getPref: db.prepare('SELECT value FROM prefs WHERE key = ?'),
  upsertHeartbeat: db.prepare('INSERT INTO heartbeat (worker, ts) VALUES (?, ?) ON CONFLICT(worker) DO UPDATE SET ts=excluded.ts'),
  getHeartbeats: db.prepare('SELECT worker, ts FROM heartbeat'),
};

export const state = {
  recordMessage(role, content) {
    stmts.insertMessage.run(role, content, Date.now());
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
};

export default state;
