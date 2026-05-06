// Weather injection for the env fragment.
// Soft-degrades to "未知" if OWM_KEY missing or call fails.
let cache = { ts: 0, summary: '未知' };
const TTL_MS = 30 * 60 * 1000;
const DEFAULT_CITY = process.env.OWM_CITY || 'Taipei';

export async function getWeather() {
  if (!process.env.OWM_KEY) return '未知（未設定 OWM_KEY）';
  if (Date.now() - cache.ts < TTL_MS) return cache.summary;

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(DEFAULT_CITY)}&units=metric&lang=zh_tw&appid=${process.env.OWM_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`OWM ${res.status}`);
    const j = await res.json();
    const desc = j.weather?.[0]?.description ?? '未知';
    const temp = j.main?.temp;
    cache = {
      ts: Date.now(),
      summary: `${DEFAULT_CITY} ${desc}${typeof temp === 'number' ? ` ${Math.round(temp)}°C` : ''}`,
    };
    return cache.summary;
  } catch (e) {
    console.warn('[weather] failed:', e.message);
    return cache.summary || '未知';
  }
}
