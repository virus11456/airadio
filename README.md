# 7x24 AI Radio · Probe Scripts

施工前的兩支探針。確認環境再寫業務代碼，避免兩層 JSON 剝殼踩坑、NCM 版權空 url 卡關。

## 1. probe-claude.js

確認 `claude -p --output-format json` 在當前環境吐什麼。

```bash
node probe-claude.js
node probe-claude.js "自訂 prompt"
```

期望：
- exit code 0
- 外層 stdout 是合法 JSON
- 內層（`result` / `content` / `text` / `output` / `response` 之一）也是合法 JSON
- 契約欄位齊全 `{ say, play, reason, segue }`

退出碼：

| code | 含義 |
|---|---|
| 0 | 全部通過 |
| 1 | 外層 JSON 解析失敗 |
| 2 | 內層 JSON 解析失敗（或欄位缺失） |
| 3 | claude CLI 找不到 / spawn 失敗 |
| 4 | claude 進程非零退出 |
| 5 | 超時或未捕獲錯誤 |

常見問題與解法：

| 現象 | 原因 | 解法 |
|---|---|---|
| `spawn claude ENOENT` | claude CLI 不在 PATH | `which claude`，或設絕對路徑 |
| 外層不是 JSON | `--output-format json` 你的版本不支援 | 改 `--output-format stream-json` 或拿掉 |
| 內層多了 markdown ```` ```json ```` 包覆 | 模型沒嚴格照 prompt | 探針已自動偵測並印出剝殼後內容；之後 `core/claude.js` 加剝殼 |
| 卡住 30 秒以上 | proxy 慢 / `ANTHROPIC_BASE_URL` 沒設好 | 檢查環境變數 |

## 2. probe-ncm.js

先把 NCM API 起來：

```bash
docker run -d -p 3000:3000 --name ncm binaryify/netease_cloud_music_api
docker logs ncm   # 看到 server running 就 OK
```

然後跑探針：

```bash
node probe-ncm.js
NCM_API_URL=http://localhost:3000 node probe-ncm.js "山下達郎"
```

期望：
- `/search` 拿到 `songId`
- `/song/url` 的 `data[0].url` 不是空字串

退出碼：

| code | 含義 |
|---|---|
| 0 | search + song_url 都拿到了 |
| 1 | `/search` 失敗或無結果 |
| 2 | `/song/url` 失敗或回空 url |
| 3 | 連線失敗（容器沒起） |

常見問題：

| 現象 | 原因 | 解法 |
|---|---|---|
| `fetch failed` / `ECONNREFUSED` | 容器沒起 / port 錯 | `docker ps`，`curl localhost:3000` |
| `data[0].url` 為空 | 版權保護 / 需要登入 | 先 `/login/cellphone` 拿 cookie，或挑沒版權保護的歌測 |
| `/recommend/songs` 401 | 沒登入 | 預期內，登入後就有 |

## 跑完之後

把 **probe-claude.js 的完整 stdout** 和 **probe-ncm.js 的 search + song_url 結果** 貼回對話，
Claude 才能根據實際格式寫對 `server/core/claude.js` 與 `server/core/ncm.js`。
