#!/usr/bin/env bash
# scripts/airadio-suno-sync.sh
# Sync one or more Suno playlists into cache/suno-library/ and merge metadata
# into user/suno-library.json. Designed to run hourly via cron.
#
# Reads SUNO_PLAYLIST_IDS from /opt/airadio/.env (comma- or space-separated).
# Falls back to a single hardcoded ID if not set, so old setups keep working.
#
# After sync, regenerates AI covers for any newly-added tracks.

set -euo pipefail

ROOT="${AIRADIO_ROOT:-/opt/airadio}"
ENV_FILE="${ROOT}/.env"
LIB_DIR="${ROOT}/cache/suno-library"
LIB_JSON="${ROOT}/user/suno-library.json"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Load .env (best-effort; ignore failures so cron stays alive).
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE" 2>/dev/null || true; set +a
fi

# Default to the original single playlist if nothing configured.
PLAYLIST_IDS_RAW="${SUNO_PLAYLIST_IDS:-${SUNO_PLAYLIST_ID:-ec4ce934-c6b5-4b3b-8479-1f91445677ca}}"

# Split on commas / whitespace.
IFS=', \t\n' read -r -a PLAYLISTS <<< "$PLAYLIST_IDS_RAW"

mkdir -p "$LIB_DIR"
echo "[suno-sync] started $(date -Is) — ${#PLAYLISTS[@]} playlist(s)"

# Aggregate metadata across all playlists into one JSON array.
ALL_JSON="$TMP_DIR/all.json"
echo '[]' > "$ALL_JSON"

for PID in "${PLAYLISTS[@]}"; do
  [[ -z "$PID" ]] && continue
  echo "[suno-sync] playlist=$PID"
  PAGE_FILES=()
  PAGE=0
  while :; do
    OFFSET=$(( PAGE * 50 ))
    PAGE_JSON="$TMP_DIR/${PID}-p${PAGE}.json"
    URL="https://studio-api-prod.suno.com/api/playlist/${PID}/?page=${PAGE}"
    HTTP=$(curl -fsSL --max-time 30 -o "$PAGE_JSON" -w '%{http_code}' "$URL" || echo "000")
    if [[ "$HTTP" != "200" ]]; then
      echo "[suno-sync]   page=$PAGE http=$HTTP — stopping"
      break
    fi
    COUNT=$(node -e "const d=JSON.parse(require('fs').readFileSync('$PAGE_JSON','utf8'));console.log((d.playlist_clips||d.clips||[]).length)" 2>/dev/null || echo 0)
    echo "[suno-sync]   page=$PAGE clips=$COUNT"
    [[ "$COUNT" == "0" ]] && break
    PAGE_FILES+=("$PAGE_JSON")
    PAGE=$(( PAGE + 1 ))
    [[ $PAGE -gt 20 ]] && break  # safety cap
  done

  # Merge this playlist's pages into ALL_JSON, tagged with playlist_id.
  if [[ ${#PAGE_FILES[@]} -gt 0 ]]; then
    node - "$ALL_JSON" "$PID" "${PAGE_FILES[@]}" <<'NODEEOF'
const fs = require('fs');
const [, , allPath, pid, ...pages] = process.argv;
const all = JSON.parse(fs.readFileSync(allPath, 'utf8'));
const seen = new Set(all.map(t => t.id));
for (const p of pages) {
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const clips = data.playlist_clips || data.clips || [];
  for (const c of clips) {
    const clip = c.clip || c;
    if (!clip || !clip.id || seen.has(clip.id)) continue;
    seen.add(clip.id);
    all.push({
      id: clip.id,
      title: clip.title || 'Untitled',
      tags: (clip.metadata && clip.metadata.tags) || clip.tags || '',
      duration: clip.metadata && clip.metadata.duration || clip.duration || 0,
      audio_url: clip.audio_url || `https://cdn1.suno.ai/${clip.id}.mp3`,
      playlist_id: pid,
    });
  }
}
fs.writeFileSync(allPath, JSON.stringify(all, null, 2));
NODEEOF
  fi
done

# Now download any missing mp3s.
TOTAL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ALL_JSON','utf8')).length)")
echo "[suno-sync] total tracks across playlists: $TOTAL"

DOWNLOADED=0
node -e "console.log(JSON.parse(require('fs').readFileSync('$ALL_JSON','utf8')).map(t=>t.id+'\t'+t.audio_url).join('\n'))" \
  | while IFS=$'\t' read -r ID URL; do
      [[ -z "$ID" ]] && continue
      OUT="$LIB_DIR/${ID}.mp3"
      if [[ -s "$OUT" ]]; then continue; fi
      if curl -fsSL --max-time 60 -o "$OUT" "$URL"; then
        echo "[suno-sync]   + downloaded $ID"
      else
        rm -f "$OUT"
        echo "[suno-sync]   ! failed $ID"
      fi
    done

# Replace user/suno-library.json atomically.
mv "$ALL_JSON" "$LIB_JSON.tmp"
mv "$LIB_JSON.tmp" "$LIB_JSON"

# Optional: prune local mp3s that are no longer in any synced playlist.
if [[ "${SUNO_PRUNE:-1}" == "1" ]]; then
  KEEP="$TMP_DIR/keep.txt"
  node -e "JSON.parse(require('fs').readFileSync('$LIB_JSON','utf8')).forEach(t=>console.log(t.id))" > "$KEEP"
  while IFS= read -r f; do
    BASE="$(basename "$f" .mp3)"
    if ! grep -qx "$BASE" "$KEEP"; then
      rm -f "$f"
      echo "[suno-sync]   - pruned $BASE"
    fi
  done < <(find "$LIB_DIR" -maxdepth 1 -name '*.mp3')
fi

# Generate covers for any new tracks.
if [[ -f "${ROOT}/scripts/generate-covers-pixel.py" ]] && command -v python3 >/dev/null; then
  echo "[suno-sync] drawing pixel covers for new tracks"
  python3 "${ROOT}/scripts/generate-covers-pixel.py" --quiet || echo "[suno-sync] pixel covers hit issues (non-fatal)"
elif [[ -f "${ROOT}/scripts/generate-covers.mjs" ]]; then
  echo "[suno-sync] generating missing covers…"
  node "${ROOT}/scripts/generate-covers.mjs" --quiet || echo "[suno-sync] cover generation hit issues (non-fatal)"
fi

echo "[suno-sync] done $(date -Is) — library has $(ls -1 "$LIB_DIR" | wc -l) mp3s"
