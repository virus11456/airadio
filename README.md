# AIRADIO.FM · 7×24 AI Personal Radio

> 一個 24 小時不斷線、為你個人化排歌的 AI 電台。
> Powered by **MiniMax-M2** (大腦)、**Suno** (音樂)、**Edge TTS** (聲音)、**Pollinations.ai** (封面)、**Fastify + WebSocket** (後端)、**Hiroshi Nagai 風 8bit PWA** (前端)。

![status](https://img.shields.io/badge/status-LIVE-ff00ff)
![brain](https://img.shields.io/badge/brain-MiniMax--M2-f6ff00)
![music](https://img.shields.io/badge/music-Suno-00d4ff)
![tts](https://img.shields.io/badge/tts-Edge%20TTS-00ffd5)
![covers](https://img.shields.io/badge/covers-Pollinations-ff8c7a)

---

## 架構一眼看完

```
☁️ Suno 雲端 ────[每小時 cron sync]────▶ 💾 VPS suno-library/   (mp3, 多 playlist)
☁️ Pollinations ─[每首歌一張封面 lazy gen]▶ 💾 VPS covers/        (jpg)
☁️ MiniMax-M2 ──◀[排歌 + 唸聽眾來信]── 🖥️ airadio server (PM2 fork)
☁️ Edge TTS ────◀[DJ 講話轉 mp3]──────┤ (Fish.audio 主、失敗 fallback Edge)
☁️ wttr.in ─────◀[即時天氣 / 風 / 濕度]┤ (OpenWeather 有 key 優先)
                                        │  + SQLite (likes / dislikes / 來信)
                                        ▼
              🎵 /audio/suno/{id}.mp3      📮 /api/chat   (聽眾來信)
              🖼️ /covers/{id}.jpg         💖 /api/reaction (Heart Rain)
              🔌 /api/feedback (👍/👎)    📬 /api/mail/recent
                                        │
                                        ▼
                  🌍 任何人打開 http://72.60.110.37:8080  → 即時收聽
                  ⏱  進去就接到歌的中段，不會從頭開始（live offset）
                  💖 點封面任一處 → 你按的 emoji 全頻道聽眾即時看到
                  📮 寄信給老 C → 下段廣播他可能會點名你的留言來回應
```

## 現在在跑什麼

| 層級 | 服務 | 說明 |
|---|---|---|
| **大腦** | MiniMax-M2 (api.minimaxi.com) | 排歌 / DJ 對白 / day plan，吃聽眾 like/dislike 訊號偏選 |
| **聲帶** | Edge TTS (`zh-TW-HsiaoChenNeural`) | DJ 中文台灣女聲；Fish.audio 有 key 時主用 |
| **音樂主源** | Suno playlists（支援多份） | 你建的 playlist 雲端歌曲、本機 mp3 cache |
| **音樂備援** | NCM API + UNM proxy | Suno library 空時 fallback 網易雲 + 替代源 |
| **封面** | Pollinations.ai (Flux) | 每首歌一張 Hiroshi Nagai 風封面，本機 cache |
| **即時情境** | wttr.in + JS Date + SQLite | 注入 system prompt（時段 / 天氣 / 節日 / 最近播） |
| **聽眾偏好** | 👍 / 👎 + SQLite `feedback` 表 | 寫進 prompt：DJ 之後優先 / 避開該風格 |
| **Heart Rain** | `/api/reaction` + WS broadcast | 點封面飄 emoji 粒子，所有聽眾即時看到，不寫 DB |
| **聽眾來信** | `/api/chat` → `messages.role='fan'` | DJ 每段挑 1-2 封來唸（`replied_to:[id]` 自動標記已回） |
| **直播位置** | server-side `startedAt` | 任何人開頁就接到歌的中段（不會重來） |
| **前端** | PWA + Service Worker | Hiroshi Nagai 海灘 + 8bit 像素字 + 落日均衡器 |
| **進程守護** | PM2 fork mode | 崩潰自動重啟、開機自啟、log rotate |

## 主要改動摘要 (vs. 原始 scaffold)

### Brain · LLM
- [x] Claude CLI 換成 **MiniMax-M2** HTTP API (`server/core/claude.js`)
- [x] M2 reasoning model `message.content` 為空時自動讀 `reasoning_content`
- [x] `MAX_TOKENS=2048` 給 reasoning 留空間、避免被截
- [x] 把實際時間 / 天氣注入 USER message 開頭（system prompt 會被 M2 忽略時的 hard fallback）
- [x] DJ 最近講過的 5 句注入 prompt + 程式硬擋重複（避免一直講同一段）
- [x] 修掉 pre-existing `recentDjSays is not defined` bug（之前每次 DJ planning 都 throw）

### TTS
- [x] 封裝 `synthesize()` (Fish 主 + Edge 備) — `server/core/tts.js`
- [x] npm `msedge-tts` 免費調 Microsoft Edge TTS
- [x] Fish 402 Insufficient Balance 時自動 fallback 到 Edge
- [x] mp3 hash cache 在 `cache/tts/<hash>.mp3`

### Music
- [x] **多 playlist**：`SUNO_PLAYLIST_IDS` 接 comma-separated UUID 列表，cron 每小時逐一同步
- [x] 本機 cache `cache/suno-library/{id}.mp3`、伺服 `/audio/suno/` 靜態路由
- [x] `findPlayable(query)` 先用 Suno tags 模糊匹配、找不到才 fallback NCM
- [x] 每首 track 帶 `playlist_id` tag，方便之後做時段 / 心情切換
- [x] `scripts/airadio-suno-sync.sh` 統一進 repo（取代 `/usr/local/bin/...`），sync 完自動觸發封面生成
- [x] `SUNO_PRUNE=1` 預設清掉 playlist 內已移除的歌

### AI 封面圖
- [x] `scripts/generate-covers.mjs` 用 **Pollinations.ai**（免費、無需 key）
- [x] Prompt 模板：Hiroshi Nagai City Pop 1990 風 + 每首歌的 tags 個性化
- [x] Seed 從 track id 算出，重跑同一首歌會出同一張圖（idempotent）
- [x] HTTP 429 / 5xx 指數退避（4s → 60s）最多重試 5 次
- [x] `/covers/{id}.jpg` 靜態路由、`Cache-Control: immutable`、永久快取
- [x] PWA 自動 fade-in 在落日均衡器之上（覆蓋上 70%、底部留 30% 給 bars 透出）
- [x] 跑在 cron 之後，新歌進來下個整點就有封面

### Feedback (Like / Dislike)
- [x] SQLite `feedback` 表：`(client_id, track_id, kind)` upsert，撤銷 = 反向 toggle
- [x] PWA 用 localStorage 存匿名 `client_id`（手機 / 多人共用一台沒問題）
- [x] API：
  - `POST   /api/feedback`        body: `{trackId, kind, title, artist}`
  - `DELETE /api/feedback/:trackId`
  - `GET    /api/feedback/:trackId`  → `{likes, dislikes, mine}`
  - `GET    /api/feedback/summary`   → DJ 用，列出 top liked / disliked
- [x] DJ context 自動注入：`## 聽眾按讚 / 倒讚` 兩個 section 給 M2 偏選 / 避開
- [x] 真實 lock-screen Media Session metadata 用 AI 封面（手機鎖屏會顯示）

### Live Tune-in（電台靈魂）
- [x] Server 在每首歌 `play()` 時記下 `startedAt = Date.now()`
- [x] `/api/now` 回 `{title, startedAt, serverNow, ...}`
- [x] PWA 在 `loadedmetadata` 時 `audio.currentTime = (serverNow - startedAt - drift) / 1000`
- [x] 結果：你關分頁、開新分頁，會接到歌的「現在這一秒」，不會從頭播
- [x] 歌只剩 < 2 秒時不 seek（避免 race），DJ TTS 段不 seek（每句都要聽完）

### Heart Rain（即時聽眾反應）
- [x] PWA 中央封面變成 _可點區_：點任意處飄 💖 / 🔥 / 🌊 / 😴 / 🌙 / ☀️ / 🎵
- [x] `POST /api/reaction { emoji, x, y }` → 後端 `publish('reaction', payload)` → 所有 WS 客戶端收到 → `spawnHeart(payload)`
- [x] 不寫 DB（純氛圍），但伺服器留 8 秒 ring buffer 給晚加入的聽眾，可以從 `/api/reaction/recent` 拉
- [x] 250ms 防 spam cooldown、最多 80 顆同時飄
- [x] 用 normalised 0..1 座標，不同 viewport 大小都對齊

### Claudio 像素 DJ × 真錄音室
中間那塊是 Claudio 本人坐在自己的錄音室裡 — 冷色暗牆 + 吸音棉 + 觀察窗 + 監聽喇叭 + 暖光打她身上的對比。

| 元素 | 表現 | 行為 |
|---|---|---|
| 🟦 **錄音室牆面** | 深 navy/teal 漸層 + 鑽石吸音棉 pattern (CSS gradients) + 邊緣 vignette | 靜態，永遠在那 |
| 💡 **暖光聚光** | 50% 78% 位置 radial 暖光 | 把 Claudio 的暖膚色從冷牆襯出來 |
| 👧 **Claudio** | SVG 像素半身、黑 bob 頭、大眼睛+虹膜+睫毛+高光、粉腮紅、小微笑 | 5.2s 眨眼；DJ 講話時嘴一張一合 (0.5s steps)；音樂播放時頭上下微抖 (0.7s)；mute 停 |
| 🎧 **耳機** | 黑色 over-ear + 紅 LED | 永遠戴著 |
| 🎤 **麥克風 + Pop filter** | mesh head 麥 + 前面一片暗 mesh 圓盤 | DJ 講話時 ON AIR 招牌閃紅 |
| 🔴 **ON AIR 招牌** | 紅底像素字（左上）| DJ 講話時亮起 + 閃爍 |
| 🪟 **控制室觀察窗** | 暗 teal 玻璃 + 後面 mixing board 剪影（knob 排 + fader strips）+ 暖光漏出 + 三色 LED 表頭 | 靜態 |
| 🔊 **監聽喇叭** ×2 | 黑箱體 + 圓 woofer + dust cap + 綠色待機 LED | 靜態，左右各一 |
| 🖼️ **AI cover 相框** | 紅圈邊框（右側牆）| 顯示當前播放封面，DJ 段保留最後一張 |
| 📌 **聽眾便條紙** | 3 張黃色 sticky note + 紅 OK 戳 | Claudio 正在唸的那張放大 + 發黃光 |
| 💬 **語言泡泡** | 紙質對話框（Claudio 頭頂）+ 4 行截斷 | DJ 講話時冒出，顯示她剛剛說的那段 |

實作：
- `.booth` 元素，CSS class `.on-air` / `.dawn|.day|.dusk|.night` toggle
- `.claudio` SVG 用 `shape-rendering: crispEdges`、整個角色一個 SVG 內含 multiple state 群組（眼睛開/閉、嘴開/合）用 CSS opacity animation 切換
- `setStage(item)`：toggle `.talking` / `.bobbing` / `.on-air`，更新 bubble，呼叫 `refreshPinLetters(item.repliedTo)`
- 便條紙輪詢 `/api/mail/recent` 25 秒一次
- 時段每 5 分鐘 re-evaluate（跨 dawn → day 邊界自動切色）
- Heart Rain canvas、reaction bar、tap hint 仍在最上層獨立運作

### 聽眾來信 + DJ 回信（Claudio 真的會點名你）
- [x] PWA 輸入框語意：「寄信給老 C」（不再是 chat）
- [x] `POST /api/chat`（帶 `X-Client-Id`）非命令文字 → 寫進 `messages` 表 `role='fan'`、`addressed=0`
- [x] 30 分鐘自動 expire（`state.expireOldFanMessages`）防止舊信永遠塞在 prompt
- [x] `context.js` 把待回信件帶 `[#id]` marker 注入 system prompt
- [x] DJ persona（Claudio aka 老 C）內建規則：每段挑 1-2 封來唸 + JSON 加 `replied_to:[42, 43]`
- [x] `dj.js` 收到 plan 後：① 讀 `replied_to`；② 用 regex 抓 say 裡的 `#42` 標記；③ `state.markFanAddressed(ids)`
- [x] PWA `📮 LISTENER MAIL` 區塊每 25 秒 poll，顯示最近 6 封 + ✓ replied / · pending 狀態
- [x] `prompts/dj-persona.md` 重寫成電台主持人人設（不只是排歌助理）

### Live Context (DJ 看到的現在)
- [x] 現在時間 + 時區 (TZ 預設 Asia/Taipei)
- [x] 星期幾 + phase（凌晨 / 早晨 / 上午 / 中午 / 下午 / 晚間 / 深夜）
- [x] 平日 / 週末 + 氛圍（通勤 / 午餐 / 下班 / 夜生活 / 週末閒）
- [x] 上下 7 天節日（中華為主）
- [x] 即時天氣（wttr.in 免費，OWM 有 key 優先）
- [x] 現在正播什麼歌（DJ 可以介紹）
- [x] 聽眾按讚 / 倒讚 top list

### PWA 前端 (`pwa/index.html` + `pwa/app.js`)
- [x] **Hiroshi Nagai City Pop 1990** 配色：天空藍 → 桃粉 → 珊瑚紅 → 海深藍漸層
- [x] **8bit 像素字**：英 / 數 用 Press Start 2P、中 / 日 用 Zpix、漢字保留 DotGothic16 fallback
- [x] **落日均衡器**：太陽 + 海面 + 椰子樹剪影 + 12 條 audio-reactive bars (`<canvas>` + AnalyserNode)
- [x] **AI 封面**：fade-in over 均衡器，下緣 mask 讓 bars 透出
- [x] **Like / Dislike**：▲ LIKE / ▼ NOPE 像素按鈕，optimistic UI + toast feedback
- [x] **CLOCK.SYS** LCD 風時鐘（時間 / 時區 / 城市自動偵測）
- [x] **DJ.MSG** 引號式雜誌訪談對話框
- [x] **TAP TO TUNE IN** overlay（autoplay policy 擋住時用）
- [x] **Media Session API** + iOS PWA meta tags（鎖屏可控、可加到主畫面）
- [x] **移除上 / 下一首**（電台不該能跳）、保留 MUTE toggle
- [x] **Film grain SVG noise** overlay
- [x] **chat SEND** 中 toast 反饋

### 運維
- [x] **PM2 logrotate** 10MB / 7 份 / 每夜 03:00 旋轉
- [x] **Docker log limits** ncm container 10m × 3
- [x] **journald cap** SystemMaxUse=500M
- [x] **每夜 04:00** cleanup cron 清 TTS / music cache
- [x] **每小時 :15** Suno sync cron（多 playlist + 自動補封面）

---

## 需要的 .env

複製 `.env.example` → `.env`，必填只有 `MINIMAX_API_KEY`。其他都有 fallback。

```env
# ---- 大腦（必填）----
MINIMAX_API_KEY=sk-cp-XXX...
MINIMAX_MODEL=MiniMax-M2
MINIMAX_BASE_URL=https://api.minimaxi.com
MINIMAX_TIMEOUT_MS=60000
MINIMAX_TEMPERATURE=0.7
MINIMAX_MAX_TOKENS=2048

# ---- 音樂來源 ----
# Comma- 或空白分隔，cron 每小時逐一同步進同一個 library
SUNO_PLAYLIST_IDS=ec4ce934-c6b5-4b3b-8479-1f91445677ca

NCM_API_URL=http://localhost:3100   # binaryify/netease_cloud_music_api
NCM_COOKIE=                         # 選填，登入帳號 cookie 解版權鎖

# ---- TTS ----
FISH_API_KEY=                       # 選填，主要選項；沒填 fallback Edge
FISH_VOICE_ID=
EDGE_TTS_VOICE=zh-TW-HsiaoChenNeural

# ---- 天氣（選填） ----
OWM_KEY=
OWM_CITY=Taipei

# ---- 封面 ----
COVER_MODEL=flux                    # pollinations 用的模型
COVER_STYLE=                        # 留空走預設「Hiroshi Nagai City Pop」風

# ---- 行為 ----
PORT=8080
TZ=Asia/Taipei
DJ_INTERVAL_SONGS=1
DJ_SAY_MIN_CHARS=40
DJ_SAY_MAX_CHARS=70
QUEUE_LOW_WATER=3
TTS_CACHE_DIR=cache/tts
MUSIC_CACHE_DIR=cache/music

# 選填整合
LARK_WEBHOOK=
```

---

## 自架你的電台（5 步）

```bash
# 1. 安裝依賴
npm install

# 2. 起 NCM Docker（binaryify/netease_cloud_music_api）+ UNM（選）+ msedge-tts
#    可以照 docs/setup-deps.sh 操作（手動跑 docker / npm 指令）

# 3. 填 .env
cp .env.example .env && vi .env

# 4. 同步你的 Suno playlist + 自動產封面
mkdir -p cache/suno-library cache/covers
bash scripts/airadio-suno-sync.sh        # 撈 mp3 + 跑 generate-covers
# 或單獨跑
node scripts/generate-covers.mjs

# 5. 起電台
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup

# 6. 排 cron（每小時 :15 sync 新歌 + 補封面）
( crontab -l 2>/dev/null | grep -v 'airadio-suno-sync.sh'; \
  echo '15 * * * * /opt/airadio/scripts/airadio-suno-sync.sh >> /var/log/airadio-suno-sync.log 2>&1' \
) | crontab -
```

訪問：`http://localhost:8080`

---

## API 摘要

| Method | Path | 用途 |
|---|---|---|
| GET  | `/api/now`  | 現在播什麼 + `startedAt` / `serverNow`（live offset 用） |
| GET  | `/api/next` | 下幾首佇列 |
| POST | `/api/chat` | 跟 DJ 講話（命令或自由文字） |
| GET  | `/api/plan/today` | 今日節目單 |
| GET  | `/api/taste` / PUT | 讀 / 寫 user/*.md（前端 Profile 已移除，但 API 留著） |
| **POST**   | **`/api/feedback`** | `{trackId, kind:'like'\|'dislike', title, artist}` + `X-Client-Id` |
| **DELETE** | **`/api/feedback/:trackId`** | 撤銷 |
| **GET**    | **`/api/feedback/:trackId`** | `{likes, dislikes, mine}` |
| **GET**    | **`/api/feedback/summary`** | top liked / disliked，DJ 用 |
| **POST**   | **`/api/reaction`** | `{emoji, x, y}` + `X-Client-Id`，廣播到所有 WS 聽眾 |
| **GET**    | **`/api/reaction/recent`** | 最近 8 秒 reactions（晚加入的 PWA 用） |
| **GET**    | **`/api/mail/recent?limit=6`** | 最近聽眾來信（PWA 顯示 ✓ replied / · pending） |
| WS   | `/stream` | 即時推播 `now-playing` / `queue-update` / `dj-saying` / `reaction` / `user-message` |
| GET  | `/audio/suno/:id.mp3` | Suno 本機 mp3 |
| GET  | `/audio/tts/:hash.mp3` | DJ TTS mp3 |
| **GET**  | **`/covers/:id.jpg`** | AI 封面（immutable cache） |

---

## 訂製你的品味

修改以下檔案，**不需重啟**，下輪 DJ refill 自動讀進：

- `user/taste.md` — 喜歡 / 不喜歡的歌手、曲風、黑名單
- `user/routines.md` — 作息 / 時段心情（上班、深夜）
- `user/mood-rules.md` — 下雨 / 下班 / 週五等心情 → 風格規則
- `user/playlists.json` — 預設種子歌、黑名單
- `prompts/dj-persona.md` — DJ 人設、JSON 套版
- 直接按 PWA 上的 ▲ LIKE / ▼ NOPE — 寫進 SQLite，DJ 之後會偏 / 避

## 跟 DJ 互動

PWA 輸入框打：

- `放點 city pop` / `來點 90s 港台` / `讓我思考`
- `下一首` / `skip` / `next`
- `暫停` / `繼續`

或者直接按 ▲/▼ 按鈕——比文字描述更精準。

---

## 常見問題

**Q: 看不見頁面但聲音沒出來？**
A: 瀏覽器 autoplay policy 擋住了，會跳出 `> TAP TO TUNE IN` 的全螢幕黑底，點任何位置一下就開播。

**Q: DJ 一直 STANDBY、不講話？**
A: 看 `/opt/airadio/logs/err.log`：
- 有 `[dj] claude failed`：M2 timeout 或 quota 問題，看 `MINIMAX_API_KEY` 是否還有額度。
- 有 `[tts] Edge TTS fallback`：Fish 餘額用完了，但 Edge 仍然會發聲（正常）。
- 有 `STALE workers: dj`：DJ loop hang 住，PM2 會自動重啟。

**Q: 封面圖長很久才出現？**
A: Pollinations.ai 對單一 IP 限流很重（HTTP 429），第一輪會慢慢長。指數退避已內建，cron 每整點會補。想要快可換 Replicate / OpenAI（改 `scripts/generate-covers.mjs` 的 endpoint）。

**Q: 怎樣加新 playlist？**
A: `.env` 改成
```
SUNO_PLAYLIST_IDS=原本的-uuid,新-uuid,又一個-uuid
```
下個整點 cron 自動撈、自動產封面、納入 DJ 選歌池。

**Q: 想自己開瀏覽器但不要從頭播？**
A: 已經是這樣了。Server 知道每首歌「現在播到第幾秒」，你開分頁的瞬間 PWA 會 seek 到對應位置（差 < 0.2 秒，跟收音機一樣）。

**Q: 我按 LIKE / NOPE，DJ 真的會聽嗎？**
A: 會。下個 DJ refill cycle（30–60 秒）的 system prompt 會看到 `## 聽眾按讚` / `## 聽眾倒讚` 列表，M2 會優先排相似 / 避開類似的。

**Q: 我寄信給老 C，他會回嗎？**
A: 會。每封信進去後 30 分鐘內，DJ 在某段廣播會挑 1-2 封來點名（"#42 號聽眾說加班..."）+ 配一首對應的歌。被回過的會在 PWA 變成 ✓，未回的維持 · pending；30 分鐘沒回的自動 expire（避免老信永遠占位）。

**Q: Heart Rain 會被存起來嗎？**
A: 不會。是純現場氛圍（你不會想知道誰在五月按了 💖）。只有 8 秒 ring buffer 給晚加入的客戶端對齊。

---

## 檔案樹

```
airadio/
├── server/
│   ├── index.js              # Fastify 主 server、static 路由、ws 註冊
│   ├── core/
│   │   ├── claude.js         # MiniMax-M2 client（檔名歷史包袱）
│   │   ├── ncm.js            # Suno 主 + NCM fallback（出 cover/playlistId）
│   │   ├── tts.js            # Fish + Edge TTS
│   │   ├── weather.js        # wttr.in / OWM
│   │   ├── context.js        # 拼 system + user prompt（注入時間/天氣/feedback）
│   │   ├── router.js         # 簡單指令解析
│   │   ├── bus.js            # 事件 bus
│   │   └── state.js          # SQLite (messages / plays / plan / prefs / feedback)
│   ├── routes/
│   │   ├── chat.js
│   │   ├── now.js            # 帶 startedAt / serverNow
│   │   ├── next.js
│   │   ├── plan.js
│   │   ├── stream.js         # WS
│   │   ├── taste.js
│   │   ├── feedback.js       # ★ NEW: like / dislike API
│   │   ├── reactions.js      # ★ NEW: Heart Rain broadcast
│   │   └── mail.js           # ★ NEW: 聽眾來信公開檢視
│   └── workers/
│       ├── dj.js             # DJ refill + play loop（startedAt 在這寫）
│       ├── music.js
│       ├── scheduler.js      # hourly mood / day plan
│       └── heartbeat.js
├── pwa/
│   ├── index.html            # Hiroshi Nagai 8bit UI
│   ├── app.js                # like/dislike + cover + live offset
│   ├── manifest.json
│   └── sw.js
├── prompts/
│   └── dj-persona.md
├── user/
│   ├── taste.md
│   ├── routines.md
│   ├── mood-rules.md
│   ├── playlists.json
│   └── suno-library.json     # 自動同步（多 playlist 合併）
├── scripts/                  # ★ NEW
│   ├── airadio-suno-sync.sh  # 多 playlist 同步 + 補封面 + prune
│   └── generate-covers.mjs   # Pollinations.ai AI 封面，retry/backoff
├── cache/                    # gitignored
│   ├── tts/
│   ├── music/
│   ├── suno-library/         # mp3
│   └── covers/               # jpg ★ NEW
├── data/
│   └── state.db              # SQLite (gitignored)
├── ecosystem.config.cjs
├── package.json
├── .env.example
└── README.md
```

---

## License

MIT
