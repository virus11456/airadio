#!/usr/bin/env python3
# scripts/generate-covers-pixel.py
# Hand-built 8bit ANIMATED cover engine. Zero external services: reads each
# track's tags, composes a pixel scene from a kit (skies / weather / motifs),
# renders 6 frames with living details (rain falls, stars twinkle, road
# dashes travel, sun glitter shimmers, birds flap) and writes an animated
# GIF per track. Deterministic: the same track id always yields the same
# scene (seeded PRNG), so regeneration is stable.
#
# Usage:
#   python3 scripts/generate-covers-pixel.py            # only missing
#   python3 scripts/generate-covers-pixel.py --force    # regenerate all
#   python3 scripts/generate-covers-pixel.py --quiet
#
# Requires Pillow:  apt-get install -y python3-pil   (or: pip3 install pillow)

import json, os, sys, hashlib, random

try:
    from PIL import Image
except ImportError:
    print('[pixel-covers] Pillow missing — run: apt-get install -y python3-pil', file=sys.stderr)
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_PATH = os.path.join(ROOT, 'user', 'suno-library.json')
COVER_DIR = os.path.join(ROOT, 'cache', 'covers')

G = 64                 # design grid
SCALE = 7              # 64*7 = 448px output (GIF-friendly size)
FRAMES = 6
FRAME_MS = 320

FORCE = '--force' in sys.argv
QUIET = '--quiet' in sys.argv

# —— the site palette (same one as the UI / default cover) ——
SKY_TOP  = (181, 220, 236); SKY_MID  = (255, 194, 165); SKY_LOW = (255, 140, 122)
SEA_MID  = ( 74, 159, 190); SEA_DEEP = ( 30,  95, 142)
SUN      = (245, 213,  71); INK      = ( 26,  46,  58)
PAPER    = (255, 245, 225); CORAL    = (230,  83,  60)
NIGHT_TOP= ( 13,  27,  46); NIGHT_MID= ( 30,  58,  95); NIGHT_SEA = (18, 58, 92)
RAIN_TOP = ( 88, 108, 128); RAIN_MID = (120, 140, 158); RAIN_DROP = (196, 214, 228)
SNOW_TOP = (198, 216, 230); SNOW_MID = (226, 234, 240)
MOON     = (240, 238, 220); WIN      = (255, 208,  96)
SAND     = (232, 215, 180); SAKURA   = (255, 183, 197)

def log(*a):
    if not QUIET: print('[pixel-covers]', *a)

def has_any(text, keys):
    return any(k in text for k in keys)

# ---------------------------------------------------------------- scene spec
def build_spec(track):
    """All random choices happen ONCE here so every frame shares the layout."""
    tid = track['id']
    text = ((track.get('tags') or '') + ' ' + (track.get('title') or '')).lower()
    rng = random.Random(int(hashlib.md5(tid.encode()).hexdigest()[:12], 16))

    spec = {}
    spec['rain']   = has_any(text, ['rain', '雨', 'storm', 'thunder', '土砂降'])
    spec['snow']   = has_any(text, ['snow', 'winter', '雪', 'スノー', 'ゲレンデ', 'blizzard', 'ブリザード'])
    spec['night']  = has_any(text, ['night', 'midnight', '深夜', '夜', 'moon', 'mist', '霧', '星'])
    spec['sakura'] = has_any(text, ['sakura', 'cherry', '桜', 'チェリー', 'spring', 'スプリング'])

    if   has_any(text, ['phone', 'tele', '電話', 'booth', 'ブース', 'dial', 'ダイヤル', 'beep', 'signal', '回線']): spec['motif'] = 'booth'
    elif has_any(text, ['train', '駅', 'express', 'エクスプレス', '電車']):                                        spec['motif'] = 'train'
    elif has_any(text, ['driv', 'highway', 'ハイウェイ', 'road', 'ドライブ']):                                     spec['motif'] = 'road'
    elif has_any(text, ['sea', 'ocean', 'wave', 'sail', '海', 'マリン', 'aquarium', '水族']):                       spec['motif'] = 'boat'
    elif has_any(text, ['funk', 'disco', 'boogie', 'synth', 'techno', 'テクノ', 'future']):                        spec['motif'] = 'cassette'
    else:
        spec['motif'] = rng.choice(['palm', 'palm', 'boat', 'cassette', 'none'])

    spec['horizon'] = 34 + rng.randint(-3, 3)
    spec['sun_x']   = rng.randint(14, 44)
    spec['moon_x']  = rng.randint(8, 50)
    spec['motif_x'] = rng.randint(8, 44)

    # skyline silhouette
    spec['skyline'] = []
    if spec['night'] or spec['rain'] or spec['snow'] or rng.random() < 0.45:
        x = 0
        while x < G:
            w, h = rng.randint(5, 10), rng.randint(4, 12)
            wins = [(x + rng.randint(1, max(2, w - 2)),
                     spec['horizon'] - rng.randint(2, max(3, h - 1)),
                     rng.randint(0, 7)) for _ in range(rng.randint(1, 4))]
            spec['skyline'].append((x, w, h, wins))
            x += w + rng.randint(1, 4)

    spec['stars']   = [(rng.randint(1, 62), rng.randint(2, spec['horizon'] - 14), rng.randint(0, 5)) for _ in range(16)]
    spec['drops']   = [(rng.randint(0, 63), rng.randint(0, 63)) for _ in range(48)]
    spec['flakes']  = [(rng.randint(0, 63), rng.randint(0, 63), rng.randint(0, 2)) for _ in range(36)]
    spec['petals']  = [(rng.randint(0, 63), rng.randint(0, 28), rng.randint(0, 3)) for _ in range(14)]
    spec['glitter'] = [(spec['sun_x'] + rng.randint(-6, 10), spec['horizon'] + 2 + rng.randint(0, 12),
                        rng.randint(3, 7), rng.randint(0, 2)) for _ in range(5)]
    spec['waves']   = [(rng.randint(2, 56), spec['horizon'] + 3 + rng.randint(0, 14)) for _ in range(6)]
    spec['birds']   = [(rng.randint(6, 50), rng.randint(4, 14)) for _ in range(rng.randint(1, 3))]
    return spec

# ---------------------------------------------------------------- rendering
def render_frame(spec, f):
    img = Image.new('RGB', (G, G))
    px = img.load()
    def rect(x0, y0, x1, y1, c):
        for y in range(max(0, y0), min(G, y1)):
            for x in range(max(0, x0), min(G, x1)):
                px[x, y] = c

    hz = spec['horizon']

    # —— sky + water ——
    if spec['rain']:
        rect(0, 0, G, hz - 8, RAIN_TOP); rect(0, hz - 8, G, hz, RAIN_MID)
        rect(0, hz, G, hz + 12, SEA_MID); rect(0, hz + 12, G, G, SEA_DEEP)
    elif spec['snow']:
        rect(0, 0, G, hz - 8, SNOW_TOP); rect(0, hz - 8, G, hz, SNOW_MID)
        rect(0, hz, G, hz + 12, SEA_MID); rect(0, hz + 12, G, G, SEA_DEEP)
    elif spec['night']:
        rect(0, 0, G, hz - 6, NIGHT_TOP); rect(0, hz - 6, G, hz, NIGHT_MID)
        rect(0, hz, G, hz + 10, SEA_DEEP); rect(0, hz + 10, G, G, NIGHT_SEA)
        mx = spec['moon_x']
        for dy, (a, b) in enumerate([(2, 8), (1, 9), (0, 10), (0, 10), (1, 9), (2, 8)]):
            rect(mx + a, 6 + dy, mx + b, 7 + dy, MOON)
        for sx, sy, ph in spec['stars']:                    # twinkle
            if (f + ph) % 6 < 4: px[sx, sy] = PAPER
    else:
        s1, s2 = hz - 20, hz - 10
        rect(0, 0, G, s1, SKY_TOP); rect(0, s1, G, s2, SKY_MID); rect(0, s2, G, hz, SKY_LOW)
        rect(0, hz, G, hz + 11, SEA_MID); rect(0, hz + 11, G, G, SEA_DEEP)
        sx = spec['sun_x']
        for dy, (a, b) in enumerate([(3, 11), (1, 13), (0, 14), (0, 14), (0, 14), (1, 13), (3, 11)]):
            rect(sx + a, hz - 14 + dy, sx + b, hz - 13 + dy, SUN)
        for gx, gy, gw, ph in spec['glitter']:              # shimmer
            if (f + ph) % 3 != 0: rect(gx + (f % 2), gy, gx + gw + (f % 2), gy + 1, SUN)

    # —— wave dashes drift sideways ——
    if spec['motif'] != 'road':
        for wx, wy in spec['waves']:
            rect((wx + f) % 58, wy, (wx + f) % 58 + 4, wy + 1,
                 PAPER if not spec['night'] else NIGHT_MID)

    # —— skyline + flickering windows ——
    for x, w, h, wins in spec['skyline']:
        rect(x, hz - h, x + w, hz, INK)
        if spec['night'] or spec['rain']:
            for wx, wy, ph in wins:
                if (f + ph) % 8 != 0: px[min(wx, 63), wy] = WIN

    # —— weather particles ——
    if spec['rain']:
        for rx, ry in spec['drops']:
            y = (ry + f * 3) % 60
            rect(rx, y, rx + 1, y + 3, RAIN_DROP)
    if spec['snow']:
        for sx0, sy0, ph in spec['flakes']:
            y = (sy0 + f * 2) % 60
            x = (sx0 + ((f + ph) % 3) - 1) % 63
            px[x, y] = PAPER
    if spec['sakura'] and not spec['rain']:
        for px0, py0, ph in spec['petals']:
            y = (py0 + f) % 30
            x = (px0 + ((f + ph) % 4) - 1) % 63
            px[x, y] = SAKURA

    # —— birds flap (day scenes) ——
    if not (spec['night'] or spec['rain']):
        up = (f % 4) < 2
        for bx, by in spec['birds']:
            if up:
                rect(bx, by + 1, bx + 2, by + 2, INK); rect(bx + 2, by, bx + 4, by + 1, INK); rect(bx + 4, by + 1, bx + 6, by + 2, INK)
            else:
                rect(bx, by, bx + 2, by + 1, INK); rect(bx + 2, by + 1, bx + 4, by + 2, INK); rect(bx + 4, by, bx + 6, by + 1, INK)

    # —— foreground ground strip + motif (anchored, never floating) ——
    motif = spec['motif']
    mx = spec['motif_x']
    if motif in ('booth', 'palm', 'cassette', 'train'):
        rect(0, 58, G, 60, PAPER); rect(0, 60, G, G, SAND)   # boardwalk

    if motif == 'booth':
        rect(mx, 32, mx + 12, 58, INK)
        rect(mx - 1, 30, mx + 13, 33, CORAL)
        glass = WIN if spec['night'] else PAPER
        rect(mx + 2, 36, mx + 10, 52, glass)
        rect(mx + 5, 36, mx + 7, 52, INK)
        rect(mx + 2, 44, mx + 10, 45, INK)
    elif motif == 'train':
        ty = 50
        off = (f * 2) % 6                                    # carriage glides
        rect(0, ty, G, ty + 8, INK)
        for wx in range(4 - off, G, 6):
            rect(wx, ty + 2, wx + 3, ty + 5, WIN)
        rect(0, ty + 8, G, ty + 9, PAPER)
    elif motif == 'road':
        rect(0, 46, G, 47, INK)
        for i, y in enumerate(range(46, 64, 3)):
            w = i * 3
            rect(24 - w // 2, y, 26 - w // 2, y + 2, PAPER)
            rect(38 + w // 2, y, 40 + w // 2, y + 2, PAPER)
        for y in range(46 + (f % 3), 64, 3):                 # centre dashes travel
            rect(31, y, 33, y + 2, SUN)
    elif motif == 'boat':
        bx = mx
        bob = 1 if (f % 4) < 2 else 0                        # gentle bobbing
        by = hz + 4 + bob
        rect(bx, by, bx + 12, by + 3, INK)
        rect(bx + 1, by + 3, bx + 11, by + 4, INK)
        rect(bx + 5, by - 8, bx + 6, by, INK)
        rect(bx + 6, by - 8, bx + 11, by - 4, PAPER)
    elif motif == 'cassette':
        cx, cy = mx, 40
        rect(cx, cy, cx + 20, cy + 14, INK)
        rect(cx + 1, cy + 1, cx + 19, cy + 13, PAPER)
        rect(cx + 1, cy + 1, cx + 19, cy + 4, CORAL)
        spin = f % 2
        rect(cx + 4 + spin, cy + 7, cx + 7 + spin, cy + 10, INK)
        rect(cx + 13 - spin, cy + 7, cx + 16 - spin, cy + 10, INK)
    elif motif == 'palm':
        tx = mx
        for x, y in [(0, 52), (0, 48), (-1, 44), (-1, 40), (-2, 36), (-2, 32)]:
            rect(tx + x, y, tx + x + 3, y + 4, INK)
        sway = 1 if (f % 4) < 2 else 0                       # fronds sway
        for fr in [[(-3, 30), (-7, 27), (-11, 26)], [(0, 28), (1, 24), (2, 21)],
                   [(3, 30), (7, 28), (11, 28)], [(2, 29), (6, 26), (9, 23)],
                   [(-2, 29), (-5, 25), (-7, 22)]]:
            for x, y in fr:
                rect(tx + x + sway, y, tx + x + 4 + sway, y + 2, INK)

    return img.resize((G * SCALE, G * SCALE), Image.NEAREST)

def generate(track):
    frames = None
    spec = build_spec(track)
    frames = [render_frame(spec, f) for f in range(FRAMES)]
    out = os.path.join(COVER_DIR, track['id'] + '.gif')
    # Full-frame disposal + one shared palette: some renderers mis-composite
    # delta frames, full frames are bulletproof (files stay ~10-20KB anyway).
    base = frames[0].convert('P', palette=Image.ADAPTIVE, colors=64)
    rest = [fr.convert('RGB').quantize(palette=base) for fr in frames[1:]]
    base.save(out, save_all=True, append_images=rest,
              duration=FRAME_MS, loop=0, disposal=2)
    return out

def main():
    os.makedirs(COVER_DIR, exist_ok=True)
    try:
        lib = json.load(open(LIB_PATH))
    except Exception as e:
        print('[pixel-covers] cannot read library:', e, file=sys.stderr); sys.exit(1)

    todo = []
    for t in lib:
        gif = os.path.join(COVER_DIR, t['id'] + '.gif')
        if FORCE or not (os.path.isfile(gif) and os.path.getsize(gif) > 512):
            todo.append(t)
    log(f'{len(todo)}/{len(lib)} cover(s) to draw (force={FORCE})')
    ok = fail = 0
    for t in todo:
        try:
            generate(t); ok += 1
        except Exception as e:
            fail += 1
            print(f"[pixel-covers] fail {t.get('id')}: {e}", file=sys.stderr)
    log(f'done — ok={ok} fail={fail}')

if __name__ == '__main__':
    main()
