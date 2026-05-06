# AIRADIO.FM · 7x24 AI Personal Radio

> 一個 24 小時不斷線、你中意的胶這位 AI DJ 設計的個人電台。
> Powered by **MiniMax-M2** (大腦)、**Suno** (音樂身)、**Edge TTS** (聲帶)、**Fastify + WebSocket** (后端)、**8bit Cyberpunk PWA** (前端)。

![status](https://img.shields.io/badge/status-LIVE-ff00ff) ![brain](https://img.shields.io/badge/brain-MiniMax--M2-f6ff00) ![music](https://img.shields.io/badge/music-Suno-00d4ff) ![tts](https://img.shields.io/badge/tts-Edge%20TTS-00ffd5)

---

## 架構一眼謾

```
☁️ Suno 雲端 ───[每小時 cron sync]──▶ 💾 VPS suno-library/  (76+ mp3)
                                          │
☁️ MiniMax-M2 ─◀[排歌/DJ對白]──── 🖥️ airadio server (PM2 fork mode)
                                          │
☁️ Edge TTS  ─◀[DJ 講話轉 mp3]────┤ (Fish.audio 主、失敗 fallback)
                                          │
☁️ wttr.in   ─◀[即時天氣/湫度/風]──┤ (OWM 如有 key 優先)
                                          │
                                          ▼
                                  🎵 /audio/suno/{id}.mp3
                                          │
                                          ▼
🌍 任何人打開  http://72.60.110.37:8080  → 即時收聽
```

## 現在在跑什麼

| 層級 | 服務 | 說明 |
|---|---|---|
| **大腦** | MiniMax-M2 (api.minimaxi.com) | 插歌對白、選歌順序、生 day plan |
| **聲帶** | Edge TTS (free, zh-TW-HsiaoChenNeural) | DJ 講話轉 mp3。Fish.audio 作為升級選項 |
| **音樂來源** | Suno [「City Pop」 playlist](https://suno.com/playlist/ec4ce934-c6b5-4b3b-8479-1f91445677ca) | 76 首順豏生成的 City Pop、本機 cache |
| **背景** | NCM API + UNM proxy | 在 Suno library 空時 fallback 到 網易雲 |
| **即時情境** | wttr.in (天氣) + JS Date (時間) | 注入 DJ system prompt |
| **前端** | PWA (Fastify static) | 8bit cyberpunk、Suno spectrum visualizer |
| **進程守護** | PM2 fork mode | 崩潰自動重啟、開機自啟 |

## 主要改動摘要 (vs. 原始 scaffold)

### Brain
- [x] 將 Claude CLI 換成 **MiniMax-M2** HTTP API (`server/core/claude.js`)
- [x] M2 reasoning model `message.content` 為空時自動讀 `reasoning_content`
- [x] `MAX_TOKENS=2048` 給 reasoning 留空間、避免被截
- [x] `localFallback` 內 seeds 換成 NCM 驗證可播的歌手

### TTS
- [x] 封裝 `synthesize()` (Fish 主 + Edge 備) - `server/core/tts.js`
- [x] 使用 npm `msedge-tts` 免費調 Microsoft Edge TTS
- [x] Fish 402 Insufficient Balance 時自動 fallback 到 Edge
- [x] mp3 快取於 `cache/tts/<hash>.mp3`

### Music
- [x] 表名來自 Suno 你的 playlist、API `studio-api-prod.suno.com/api/playlist/{id}`
- [x] **每小時 cron sync** Suno playlist (`/usr/local/bin/airadio-suno-sync.sh`) - 你加新歌、96 分鐘內進電台
- [x] 本機 cache `cache/suno-library/{id}.mp3`、伺服 server `/audio/suno/` 静態路由
- [x] `findPlayable(query)` 先用 Suno tags 率表重區達重る選項、按黑微 fallback NCM
- [x] 帍静集裝 UnblockNeteaseMusic (UNM) docker container、NCM container 透過 UNM proxy

### Live Context (DJ 看到的現在)
- [x] 現在時間 + 時區 (TZ 預設 Asia/Taipei)
- [x] 星期幾 + phase (凌晨/早晨/上午/中午/下午/晚間/深夜)
- [x] 平日/週末
- [x] 氛圍：通勤/午餐/下班/夜生活/週末悝閑
- [x] 上下 7 天節日 (中華為主)、有該他說
- [x] 即時天氣 (wttr.in 免費)
- [x] 現在正播什麼歌 (DJ 可以介紹)

### PWA 前端 (`pwa/index.html`)
- [x] **8bit Cyberpunk 黑底潛光主題**、NES 紫、Game Boy 內部另存 `.bak` 备份
- [x] **音訊頻譜可視化**：synthwave grid + 太陽 + 12 條霉虝柱動態 (`<canvas>` + AnalyserNode)
- [x] **CLOCK.SYS** 時間 / 時區 / 城市顯示
- [x] **TAP TO TUNE IN** overlay 區隔 autoplay policy
- [x] **Zpix CJK pixel font** for 中文像素字
- [x] **移除上/下一首** (電台語意不該能跳)
- [x] **MUTE 動態**：`[♪] LIVE` / `[X] MUTED`
- [x] **chat SEND** 中雨 toast 反餽

### 運維
- [x] **PM2 logrotate** 10MB / 7 份 / 每夜 03:00 旋轉
- [x] **Docker log limits** 集中 ncm container 10m × 3
- [x] **journald cap** SystemMaxUse=500M
- [x] **每夜 04:00** cleanup cron 刪 TTS / 音樂 cache
- [x] **每小時 :15** Suno sync cron

## 需要的 .env

複製 `.env.example` 到 `.env` 並填以下。必填只有 `MINIMAX_API_KEY`。其餘育遵則有 fallback。

```env
# 必填
MINIMAX_API_KEY=sk-cp-XXX...   # https://platform.minimaxi.com/user-center/payment/token-plan
MINIMAX_MODEL=MiniMax-M2
MINIMAX_BASE_URL=https://api.minimaxi.com
MINIMAX_TIMEOUT_MS=60000
MINIMAX_TEMPERATURE=0.7
MINIMAX_MAX_TOKENS=2048

# Music 來源
NCM_API_URL=http://localhost:3100   # binaryify/netease_cloud_music_api
NCM_COOKIE=MUSIC_U=XXX...           # 選填、幫助解部分版權鎖

# TTS聲音
FISH_API_KEY=                     # 選填、主要選項。沒有 fallback 到 Edge
FISH_VOICE_ID=                    # 選填、Fish voice讀取 ID
EDGE_TTS_VOICE=zh-TW-HsiaoChenNeural

# Weather (選填、不填走 wttr.in)
OWM_KEY=
OWM_CITY=Taipei

# 行為
PORT=8080
TZ=Asia/Taipei
DJ_INTERVAL_SONGS=1
DJ_SAY_MIN_CHARS=60
DJ_SAY_MAX_CHARS=150
QUEUE_LOW_WATER=3
TTS_CACHE_DIR=cache/tts
MUSIC_CACHE_DIR=cache/music
```

## 對你者拺似電台

```bash
# 1. 安裝依賴
npm install

# 2. 起 NCM Docker (binaryify/netease_cloud_music_api) 、UNM (選)、並裝 msedge-tts
bash scripts/setup-deps.sh   # 必計畫這個手動指令

# 3. 填 .env
cp .env.example .env && vi .env

# 4. 提 Suno playlist 位姭本機
mkdir -p cache/suno-library
# 修改 scripts/airadio-suno-sync.sh 中的 PID=你的 playlist UUID
bash scripts/airadio-suno-sync.sh

# 5. 起電台
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

訪問：`http://localhost:8080`

## 訂製你的品味

修改以下檔案，**不需重啟**，下輪 DJ refill 自動讀進：

- `user/taste.md` — 聋歌手、預選曲風、不要播黑名單
- `user/routines.md` — 作息 / 時段 品味 (上班心情、深夜送使)
- `user/mood-rules.md` — 下雨 / 下班 / 週五 等允震心情 → 紧子
- `user/playlists.json` — 預設種子歌、黑名單
- `prompts/dj-persona.md` — DJ 人設、JSON 套台

## 你可以跟 DJ 互動

在 PWA 上輸以下誌為送送：

- `放點 city pop` / `來點 90s 港台` / `讓我思考`
- `下一首` / `skip` / `next` (育退叡叡住裡設定有)
- `暫停` / `繼續`

## 常見問題

**Q: 看不見 TAP TO TUNE IN 但聲音沒出來？**
A: Chrome autoplay policy 擋住了。點任何位置一下、或 macOS 上 Cmd+Shift+R。

**Q: DJ 一直不講話？**
A: 檢查 `/opt/airadio/logs/err.log`、註意有沒有 `[dj] claude failed` 或沒有 [tts] 記錄。 M2 可能 timeout、育送說許 二。

**Q: 某一首歌播不出來？**
A: 其他來源 `taste.md` `playlists.json` 動出這首。 出來完成 7 記不溑、微為中 Suno-library 需要這首。

**Q: 怎樣另乾 Suno playlist?**
A: 修改 `/usr/local/bin/airadio-suno-sync.sh` 設的 PID 为新 playlist 的 UUID、下一個小時 cron 就會同步。

## 架構詳詳細詳

```
airadio/
├── server/
│   ├── index.js              # Fastify 主 server、static 路由、ws 註冊
│   ├── core/
│   │   ├── claude.js         # MiniMax-M2 讀取者 (名字原本是 Claude CLI 所以仍然留。)
│   │   ├── ncm.js            # Suno 主 + NCM fallback 選歌
│   │   ├── tts.js            # Fish + Edge 育狼
│   │   ├── weather.js        # wttr.in / OWM
│   │   ├── context.js        # 拼 system prompt (所有即時情境)
│   │   ├── router.js         # 簡潔指令語釋 (下一首/暫停/skip)
│   │   ├── bus.js            # 事件河 (NOW_PLAYING / DJ_SAYING)
│   │   └── state.js          # SQLite 記憶 (recent plays / messages / plan)
│   ├── routes/
│   │   ├── chat.js           # POST /api/chat (跟 DJ 講話)
│   │   ├── now.js            # GET /api/now (現在播什麼)
│   │   ├── next.js           # GET /api/next (下一些歌)
│   │   ├── plan.js           # GET /api/plan/today
│   │   ├── stream.js         # WebSocket
│   │   └── taste.js          # GET/PUT /api/taste
│   └── workers/
│       ├── dj.js             # DJ refill loop + play loop
│       └── scheduler.js      # 每小時 mood check / day plan
├── pwa/
│   ├── index.html        # 8bit cyberpunk UI
│   ├── app.js            # PWA 逻輯
│   ├── manifest.json
│   └── sw.js
├── prompts/
│   └── dj-persona.md     # DJ 人設
├── user/                 # 你的品味設定
│   ├── taste.md
│   ├── routines.md
│   ├── mood-rules.md
│   ├── playlists.json
│   └── suno-library.json # Suno 歌單索引 (自動同步)
├── cache/                # 全部 gitignored
│   ├── tts/              # DJ TTS mp3 快取
│   ├── music/            # NCM mp3 快取
│   └── suno-library/     # Suno mp3 (76 + sync 新增)
├── ecosystem.config.cjs  # PM2
├── .env
└── README.md             # 本檔
```

## License

MIT
