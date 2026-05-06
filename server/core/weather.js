// Weather injection for the env fragment.
// Primary: wttr.in (free, no key, returns localised description).
// Upgrade: OpenWeatherMap when OWM_KEY is set.
let cache = { ts: 0, summary: '未知' };
const TTL_MS = 30 * 60 * 1000;
const DEFAULT_CITY = process.env.OWM_CITY || 'Taipei';

async function fetchWttr() {
  const fmt = encodeURIComponent('%C +%t +%h +%w');
  const url = `https://wttr.in/${encodeURIComponent(DEFAULT_CITY)}?format=${fmt}&lang=zh-tw`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`wttr ${res.status}`);
  const text = (await res.text()).trim();
  return `${DEFAULT_CITY} ${text}`;
}

async function fetchOwm() {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(DEFAULT_CITY)}&units=metric&lang=zh_tw&appid=${process.env.OWM_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`OWM ${res.status}`);
  const j = await res.json();
  const desc = j.weather?.[0]?.description ?? '未知';
  const temp = j.main?.temp;
  return `${DEFAULT_CITY} ${desc}${typeof temp === 'number' ? ` ${Math.round(temp)}°C` : ''}`;
}

export async function getWeather() {
  if (Date.now() - cache.ts < TTL_MS) return cache.summary;
  try {
    const summary = process.env.OWM_KEY ? await fetchOwm() : await fetchWttr();
    cache = { ts: Date.now(), summary };
    return summary;
  } catch (e) {
    console.warn('[weather] failed:', e.message);
    return cache.summary || '未知';
  }
}
