// Intent routing. Cheap regex first, fall through to claude.
const CMD_NEXT = /^(下一首|skip|next|跳過)$/i;
const CMD_PAUSE = /^(暫停|pause|停)$/i;
const CMD_RESUME = /^(繼續|resume|播放|play)$/i;
const CMD_VOLUME = /^(音量|volume)\s*(\d{1,3})$/i;
const PLAY_PREFIX = /^(放|播放|來首|來一首|play)\s+(.+)$/i;

export function route(input) {
  const t = (input || '').trim();
  if (!t) return { kind: 'noop' };

  if (CMD_NEXT.test(t)) return { kind: 'cmd', action: 'skip' };
  if (CMD_PAUSE.test(t)) return { kind: 'cmd', action: 'pause' };
  if (CMD_RESUME.test(t)) return { kind: 'cmd', action: 'resume' };

  const vol = t.match(CMD_VOLUME);
  if (vol) return { kind: 'cmd', action: 'volume', value: Math.min(100, parseInt(vol[2], 10)) };

  const play = t.match(PLAY_PREFIX);
  if (play) return { kind: 'music', query: play[2].trim() };

  return { kind: 'claude', input: t };
}
