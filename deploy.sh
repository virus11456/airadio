#!/usr/bin/env bash
# airadio one-shot installer for Ubuntu 22.04 / 24.04
#
# Usage on VPS (run as root):
#   curl -fsSL https://raw.githubusercontent.com/virus11456/airadio/main/deploy.sh | bash
#
# Or with explicit branch:
#   curl -fsSL https://raw.githubusercontent.com/virus11456/airadio/<branch>/deploy.sh | bash
#
# Idempotent. Safe to re-run; existing components are skipped.

set -euo pipefail

REPO_URL="${AIRADIO_REPO:-https://github.com/virus11456/airadio.git}"
BRANCH="${AIRADIO_BRANCH:-claude/review-changes-0J6Es}"
INSTALL_DIR="${AIRADIO_DIR:-/opt/airadio}"
NCM_CONTAINER="${NCM_CONTAINER:-airadio-ncm}"
NCM_PORT="${NCM_PORT:-3000}"
APP_PORT="${APP_PORT:-8080}"
TZ_DEFAULT="${TZ:-Asia/Taipei}"

# ---------- helpers ----------
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; BLU='\033[0;34m'; NC='\033[0m'
say()  { echo -e "${BLU}==>${NC} $*"; }
ok()   { echo -e "${GRN}✓${NC} $*"; }
warn() { echo -e "${YEL}!${NC} $*"; }
die()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "請用 root 執行 (sudo bash $0)"

. /etc/os-release 2>/dev/null || true
case "${ID:-}" in
  ubuntu|debian) ok "OS: ${PRETTY_NAME:-$ID}" ;;
  *) warn "未測試的 OS: ${ID:-unknown}，繼續執行但可能需要手動調整" ;;
esac

# ---------- 1. base packages ----------
say "1/8 安裝基礎套件 (curl, git, build-essential, python3)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg build-essential python3 jq >/dev/null
ok "基礎套件 OK"

# ---------- 2. node 20 ----------
say "2/8 安裝 Node.js 20"
if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v), npm $(npm -v)"

# ---------- 3. pm2 + claude cli ----------
say "3/8 安裝 PM2 與 Claude Code CLI"
npm install -g --silent pm2 >/dev/null
ok "PM2 $(pm2 -v)"
if ! command -v claude >/dev/null; then
  npm install -g --silent @anthropic-ai/claude-code >/dev/null || warn "Claude CLI 安裝失敗 (將以 fallback 模式運行)"
fi
if command -v claude >/dev/null; then ok "Claude CLI $(claude --version 2>/dev/null || echo '?')"; fi

# ---------- 4. docker (for NCM api) ----------
say "4/8 安裝 Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io >/dev/null
  systemctl enable --now docker >/dev/null
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ---------- 5. NCM api container ----------
say "5/8 啟動 NCM API container ($NCM_CONTAINER:$NCM_PORT)"
if docker ps -a --format '{{.Names}}' | grep -q "^${NCM_CONTAINER}$"; then
  if ! docker ps --format '{{.Names}}' | grep -q "^${NCM_CONTAINER}$"; then
    docker start "$NCM_CONTAINER" >/dev/null
  fi
  ok "NCM container 已存在並運行中"
else
  docker run -d --restart=unless-stopped \
    --name "$NCM_CONTAINER" \
    -p ${NCM_PORT}:3000 \
    binaryify/netease_cloud_music_api >/dev/null
  ok "NCM container 已啟動"
fi
# wait until /search responds
for i in $(seq 1 20); do
  if curl -fsS "http://localhost:${NCM_PORT}/search?keywords=test&limit=1" >/dev/null 2>&1; then
    ok "NCM API 健康"
    break
  fi
  sleep 1
  [ "$i" = 20 ] && warn "NCM API 20s 後仍未響應，繼續安裝（可稍後手動 docker logs $NCM_CONTAINER 排查）"
done

# ---------- 6. clone / update repo ----------
say "6/8 部署 airadio 到 $INSTALL_DIR (branch: $BRANCH)"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard --quiet "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
mkdir -p data cache/tts cache/music logs
ok "repo OK: $(git rev-parse --short HEAD)"

say "   npm install"
npm install --omit=dev --no-audit --no-fund --silent >/dev/null
ok "依賴 OK"

# ---------- 7. .env (interactive if missing) ----------
say "7/8 設定 .env"
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo
  echo "======================================================================"
  echo "  請填入以下 API 金鑰（直接 Enter 跳過 = 該功能停用）"
  echo "  之後可隨時編輯 $ENV_FILE 後 'pm2 restart airadio'"
  echo "======================================================================"
  read -rp "ANTHROPIC_API_KEY (Claude，必填才能讓 AI 選歌): " ANTHROPIC_API_KEY
  read -rp "ANTHROPIC_BASE_URL (走代理才需要，否則 Enter 跳過): " ANTHROPIC_BASE_URL
  read -rp "FISH_API_KEY (Fish Audio TTS，沒填則 DJ 只有文字): " FISH_API_KEY
  read -rp "FISH_VOICE_ID (Fish 聲線 ID，可空): " FISH_VOICE_ID
  read -rp "OWM_KEY (OpenWeatherMap，可空): " OWM_KEY
  echo

  cat > "$ENV_FILE" <<EOF
# Generated by deploy.sh on $(date -Iseconds)
NCM_API_URL=http://localhost:${NCM_PORT}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}
FISH_API_KEY=${FISH_API_KEY}
FISH_VOICE_ID=${FISH_VOICE_ID}
OWM_KEY=${OWM_KEY}
PORT=${APP_PORT}
TZ=${TZ_DEFAULT}

# Behavior
DJ_INTERVAL_SONGS=3
DJ_SAY_MIN_CHARS=30
DJ_SAY_MAX_CHARS=80
QUEUE_LOW_WATER=3
TTS_CACHE_DIR=cache/tts
MUSIC_CACHE_DIR=cache/music
EOF
  chmod 600 "$ENV_FILE"
  ok ".env 已建立"
else
  ok ".env 已存在，保留現有設定"
fi

# Export for probes + pm2
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# ---------- 8. probes + pm2 ----------
say "8/8 跑探針並啟動服務"

# probe NCM (must succeed for music to work)
if node probe-ncm.js >/tmp/probe-ncm.log 2>&1; then
  ok "probe-ncm: 通過"
else
  warn "probe-ncm 失敗（音樂可能不可用）。詳細：tail /tmp/probe-ncm.log"
fi

# probe Claude (best effort; fallback mode works without it)
if [ -n "${ANTHROPIC_API_KEY:-}" ] && command -v claude >/dev/null; then
  if timeout 60 node probe-claude.js >/tmp/probe-claude.log 2>&1; then
    ok "probe-claude: 通過"
  else
    warn "probe-claude 失敗 (將以 localFallback 維持運行)。詳細：tail /tmp/probe-claude.log"
  fi
else
  warn "略過 probe-claude (沒有 ANTHROPIC_API_KEY 或沒有 claude CLI；將跑 fallback 模式)"
fi

# (re)start with pm2
pm2 delete airadio >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --update-env >/dev/null
pm2 save >/dev/null

# pm2 startup on boot (idempotent)
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
systemctl enable pm2-root >/dev/null 2>&1 || true

# ---------- summary ----------
sleep 2
PUB_IP="$(curl -fsS https://ipv4.icanhazip.com 2>/dev/null || echo "<your-vps-ip>")"
echo
echo "======================================================================"
ok  "airadio 部署完成"
echo "======================================================================"
echo "  PWA URL    : http://${PUB_IP}:${APP_PORT}/"
echo "  健康檢查   : http://${PUB_IP}:${APP_PORT}/api/health"
echo "  Logs       : pm2 logs airadio"
echo "  Restart    : pm2 restart airadio"
echo "  改 .env 後 : pm2 restart airadio --update-env"
echo "  NCM 容器   : docker logs ${NCM_CONTAINER}"
echo "======================================================================"
echo
echo "下一步："
echo "  1. 在瀏覽器打開上面的 PWA URL，點 Tap to Start"
echo "  2. 第一首應該在 5-15 秒內開始播放（DJ 開場 + 音樂）"
echo "  3. 如果 ANTHROPIC_API_KEY 沒填，會走 localFallback 種子歌單"
echo "  4. 想開 Hostinger 防火牆 ${APP_PORT} port，去 hpanel → 防火牆"
echo
