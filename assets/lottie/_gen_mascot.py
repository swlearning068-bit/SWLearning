#!/usr/bin/env python3
"""Phase 13.6：全身多形態狗狗 Lottie（baby/rookie/pro/master × 4 states）。"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
W, H = 240, 340
FR = 30
# 頭部相對畫布中心的垂直偏移（須與軀幹重疊，避免頭身分離）
# 頭橢圓高約 102 → 下緣 ≈ HY+51；軀幹上緣 ≈ torso_y-44
HY = -38

BODY = EAR = EAR_INNER = SNOUT = NOSE = EYE = CHEEK = OUTLINE = SPOT = (0, 0, 0)
WHITE = (255, 255, 255)
STAGE = "baby"
EYE_BOOST = 100
HEAD_SCALE = 100

STAGES = {
    "baby": {
        "body": (255, 205, 155),
        "ear": (250, 165, 115),
        "ear_inner": (255, 225, 200),
        "snout": (255, 240, 225),
        "nose": (85, 55, 50),
        "eye": (50, 42, 42),
        "cheek": (255, 165, 155),
        "outline": (100, 70, 55),
        "spot": (250, 185, 125),
        "eye_boost": 122,
        "head_scale": 92,
    },
    "rookie": {
        "body": (255, 186, 120),
        "ear": (232, 140, 80),
        "ear_inner": (255, 210, 180),
        "snout": (255, 232, 210),
        "nose": (70, 50, 45),
        "eye": (45, 40, 40),
        "cheek": (255, 150, 140),
        "outline": (90, 60, 50),
        "spot": (240, 160, 95),
        "eye_boost": 104,
        "head_scale": 100,
    },
    "pro": {
        "body": (240, 170, 115),
        "ear": (205, 120, 75),
        "ear_inner": (248, 200, 170),
        "snout": (255, 228, 205),
        "nose": (55, 40, 38),
        "eye": (35, 32, 32),
        "cheek": (235, 135, 125),
        "outline": (75, 50, 42),
        "spot": (215, 140, 90),
        "eye_boost": 96,
        "head_scale": 102,
    },
    "master": {
        "body": (230, 160, 105),
        "ear": (190, 110, 70),
        "ear_inner": (242, 195, 165),
        "snout": (255, 224, 200),
        "nose": (45, 35, 32),
        "eye": (28, 26, 26),
        "cheek": (225, 125, 115),
        "outline": (60, 42, 36),
        "spot": (200, 130, 85),
        "eye_boost": 94,
        "head_scale": 104,
    },
}


def set_stage(stage: str) -> None:
    global BODY, EAR, EAR_INNER, SNOUT, NOSE, EYE, CHEEK, OUTLINE, SPOT
    global STAGE, EYE_BOOST, HEAD_SCALE
    cfg = STAGES[stage]
    STAGE = stage
    BODY, EAR, EAR_INNER = cfg["body"], cfg["ear"], cfg["ear_inner"]
    SNOUT, NOSE, EYE = cfg["snout"], cfg["nose"], cfg["eye"]
    CHEEK, OUTLINE, SPOT = cfg["cheek"], cfg["outline"], cfg["spot"]
    EYE_BOOST, HEAD_SCALE = cfg["eye_boost"], cfg["head_scale"]


def color(rgb, a=1.0):
    r, g, b = rgb
    return {"a": 0, "k": [r / 255, g / 255, b / 255, a]}


def solid(rgb, a=1.0):
    return {
        "ty": "fl",
        "c": color(rgb, a),
        "o": {"a": 0, "k": 100},
        "r": 1,
        "bm": 0,
        "nm": "Fill",
    }


def stroke(rgb, width=3):
    return {
        "ty": "st",
        "c": color(rgb),
        "o": {"a": 0, "k": 100},
        "w": {"a": 0, "k": width},
        "lc": 2,
        "lj": 2,
        "bm": 0,
        "nm": "Stroke",
    }


def ellipse(sx, sy):
    return {
        "ty": "el",
        "p": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [sx, sy]},
        "nm": "Ellipse",
        "d": 1,
    }


def rect(sx, sy, r=8):
    return {
        "ty": "rc",
        "p": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [sx, sy]},
        "r": {"a": 0, "k": r},
        "nm": "Rect",
        "d": 1,
    }


def transform(
    px=0,
    py=0,
    sx=100,
    sy=100,
    r=0,
    opacity=100,
    animated_pos=None,
    animated_r=None,
    animated_s=None,
    animated_o=None,
):
    return {
        "ty": "tr",
        "p": animated_pos or {"a": 0, "k": [px, py]},
        "a": {"a": 0, "k": [0, 0]},
        "s": animated_s or {"a": 0, "k": [sx, sy]},
        "r": animated_r or {"a": 0, "k": r},
        "o": animated_o or {"a": 0, "k": opacity},
        "sk": {"a": 0, "k": 0},
        "sa": {"a": 0, "k": 0},
        "nm": "Transform",
    }


def kf(times_values):
    keys = []
    n = len(times_values)
    for i, (t, v) in enumerate(times_values):
        item = {"t": t, "s": v if isinstance(v, list) else [v]}
        if i < n - 1:
            nxt = times_values[i + 1][1]
            item["e"] = nxt if isinstance(nxt, list) else [nxt]
            item["i"] = {"x": [0.667], "y": [1]}
            item["o"] = {"x": [0.333], "y": [0]}
        keys.append(item)
    return {"a": 1, "k": keys}


def shape_group(name, items, px=0, py=0, sx=100, sy=100, r=0, **anim):
    return {
        "ty": "gr",
        "nm": name,
        "it": items
        + [
            transform(
                px,
                py,
                sx,
                sy,
                r,
                animated_pos=anim.get("animated_pos"),
                animated_r=anim.get("animated_r"),
                animated_s=anim.get("animated_s"),
                animated_o=anim.get("animated_o"),
            )
        ],
        "np": len(items) + 1,
        "cix": 2,
        "bm": 0,
        "ix": 1,
        "mn": "ADBE Vector Group",
        "hd": False,
    }


def layer(name, shapes, ip=0, op=90, ind=1, **root_tr):
    base_s = root_tr.get("animated_s")
    if base_s is None:
        s = HEAD_SCALE
        base_s = {"a": 0, "k": [s, s, 100]}
    return {
        "ddd": 0,
        "ind": ind,
        "ty": 4,
        "nm": name,
        "sr": 1,
        "ks": {
            "o": root_tr.get("animated_o") or {"a": 0, "k": 100},
            "r": root_tr.get("animated_r") or {"a": 0, "k": 0},
            "p": root_tr.get("animated_pos") or {"a": 0, "k": [W / 2, H / 2 + 10, 0]},
            "a": {"a": 0, "k": [0, 0, 0]},
            "s": base_s,
        },
        "ao": 0,
        "shapes": shapes,
        "ip": ip,
        "op": op,
        "st": 0,
        "bm": 0,
    }


def scale_kf(pairs_2d):
    factor = HEAD_SCALE / 100
    return kf([(t, [xy[0] * factor, xy[1] * factor, 100]) for t, xy in pairs_2d])


def dog_head(mouth_style="smile", brow_tilt=0, eye_scale=100):
    """頭部（座標已含 HY）。回傳順序：越前面越上層。"""
    eye_scale = int(eye_scale * EYE_BOOST / 100)
    y = HY
    back = [
        shape_group(
            "ear-l",
            [ellipse(40, 54), solid(EAR), stroke(OUTLINE, 2.5)],
            px=-48,
            py=y - 44,
            r=-26,
        ),
        shape_group(
            "ear-l-in",
            [ellipse(18, 28), solid(EAR_INNER)],
            px=-48,
            py=y - 40,
            r=-26,
        ),
        shape_group(
            "ear-r",
            [ellipse(40, 54), solid(EAR), stroke(OUTLINE, 2.5)],
            px=48,
            py=y - 44,
            r=26,
        ),
        shape_group(
            "ear-r-in",
            [ellipse(18, 28), solid(EAR_INNER)],
            px=48,
            py=y - 40,
            r=26,
        ),
        shape_group(
            "head",
            [ellipse(112, 102), solid(BODY), stroke(OUTLINE, 3)],
            px=0,
            py=y,
        ),
        shape_group("spot", [ellipse(28, 22), solid(SPOT)], px=34, py=y - 24),
        shape_group(
            "cheek-l",
            [ellipse(16, 11), solid(CHEEK)],
            px=-40,
            py=y + 16,
            animated_o={"a": 0, "k": 55},
        ),
        shape_group(
            "cheek-r",
            [ellipse(16, 11), solid(CHEEK)],
            px=40,
            py=y + 16,
            animated_o={"a": 0, "k": 55},
        ),
        shape_group(
            "snout",
            [ellipse(48, 34), solid(SNOUT), stroke(OUTLINE, 2)],
            px=0,
            py=y + 24,
        ),
        shape_group("nose", [ellipse(16, 12), solid(NOSE)], px=0, py=y + 16),
    ]

    if mouth_style == "smile":
        back.append(
            shape_group("mouth", [ellipse(24, 14), solid(NOSE)], px=0, py=y + 34, sy=50)
        )
    elif mouth_style == "open":
        back.append(
            shape_group(
                "mouth",
                [ellipse(26, 22), solid((180, 70, 70)), stroke(OUTLINE, 1.5)],
                px=0,
                py=y + 36,
            )
        )
    elif mouth_style == "frown":
        back.append(
            shape_group(
                "mouth",
                [ellipse(20, 12), solid(NOSE)],
                px=0,
                py=y + 38,
                sy=45,
                r=180,
            )
        )
    else:
        back.append(
            shape_group("mouth", [rect(18, 5, 4), solid(NOSE)], px=0, py=y + 36)
        )

    back += [
        shape_group(
            "eye-l-w",
            [ellipse(24, 26), solid(WHITE), stroke(OUTLINE, 2)],
            px=-24,
            py=y - 10,
            sx=eye_scale,
            sy=eye_scale,
        ),
        shape_group(
            "eye-r-w",
            [ellipse(24, 26), solid(WHITE), stroke(OUTLINE, 2)],
            px=24,
            py=y - 10,
            sx=eye_scale,
            sy=eye_scale,
        ),
        shape_group("pupil-l", [ellipse(11, 13), solid(EYE)], px=-22, py=y - 8),
        shape_group("pupil-r", [ellipse(11, 13), solid(EYE)], px=26, py=y - 8),
        shape_group("shine-l", [ellipse(5, 5), solid(WHITE)], px=-26, py=y - 12),
        shape_group("shine-r", [ellipse(5, 5), solid(WHITE)], px=22, py=y - 12),
    ]

    if brow_tilt:
        back += [
            shape_group(
                "brow-l",
                [rect(16, 5, 3), solid(OUTLINE)],
                px=-24,
                py=y - 30,
                r=-brow_tilt,
            ),
            shape_group(
                "brow-r",
                [rect(16, 5, 3), solid(OUTLINE)],
                px=24,
                py=y - 30,
                r=brow_tilt,
            ),
        ]

    return list(reversed(back))


def body_shapes():
    """身體：回傳順序越前面越上層（手臂前層在前）。

    軀幹中心約 y=46，上緣約 2，與頭部下緣（HY+51≈13）重疊銜接。
    """
    back = []
    # 尾巴
    back.append(
        shape_group(
            "tail",
            [ellipse(28, 46), solid(EAR), stroke(OUTLINE, 2)],
            px=-58,
            py=58,
            r=-40,
        )
    )
    # 後腳
    back.append(
        shape_group(
            "leg-l",
            [ellipse(28, 48), solid(BODY), stroke(OUTLINE, 2.5)],
            px=-28,
            py=108,
        )
    )
    back.append(
        shape_group(
            "leg-r",
            [ellipse(28, 48), solid(BODY), stroke(OUTLINE, 2.5)],
            px=28,
            py=108,
        )
    )
    back.append(
        shape_group(
            "foot-l",
            [ellipse(34, 18), solid(EAR), stroke(OUTLINE, 2)],
            px=-30,
            py=132,
        )
    )
    back.append(
        shape_group(
            "foot-r",
            [ellipse(34, 18), solid(EAR), stroke(OUTLINE, 2)],
            px=30,
            py=132,
        )
    )
    # 軀幹（上移與頭頸銜接）
    back.append(
        shape_group(
            "torso",
            [ellipse(92, 88), solid(BODY), stroke(OUTLINE, 3)],
            px=0,
            py=46,
        )
    )
    back.append(
        shape_group(
            "belly",
            [ellipse(58, 48), solid(SNOUT)],
            px=0,
            py=54,
        )
    )
    # 後手臂（左側）
    back.append(
        shape_group(
            "arm-l",
            [ellipse(26, 44), solid(BODY), stroke(OUTLINE, 2.5)],
            px=-58,
            py=42,
            r=25,
        )
    )
    back.append(
        shape_group(
            "paw-l",
            [ellipse(22, 18), solid(EAR), stroke(OUTLINE, 2)],
            px=-70,
            py=62,
        )
    )
    # 前手臂（右側，可拿道具）
    back.append(
        shape_group(
            "arm-r",
            [ellipse(26, 44), solid(BODY), stroke(OUTLINE, 2.5)],
            px=58,
            py=42,
            r=-25,
        )
    )
    back.append(
        shape_group(
            "paw-r",
            [ellipse(22, 18), solid(EAR), stroke(OUTLINE, 2)],
            px=70,
            py=62,
        )
    )
    return list(reversed(back))


def form_props():
    """招牌道具（最上層）。"""
    y = HY
    props = []

    if STAGE == "baby":
        props += [
            shape_group(
                "bottle-body",
                [rect(26, 46, 10), solid((255, 255, 255)), stroke(OUTLINE, 2)],
                px=78,
                py=40,
                r=18,
            ),
            shape_group(
                "bottle-milk",
                [rect(20, 26, 6), solid((255, 230, 180))],
                px=78,
                py=46,
                r=18,
            ),
            shape_group(
                "bottle-ring",
                [ellipse(28, 10), solid((120, 190, 255)), stroke(OUTLINE, 1.5)],
                px=78,
                py=20,
            ),
            shape_group(
                "bottle-nipple",
                [ellipse(13, 15), solid((255, 180, 190)), stroke(OUTLINE, 1.5)],
                px=78,
                py=8,
            ),
            shape_group(
                "bib",
                [ellipse(64, 26), solid((255, 240, 245)), stroke((240, 160, 180), 2)],
                px=0,
                py=16,
            ),
            shape_group(
                "bib-dot",
                [ellipse(9, 9), solid((255, 140, 160))],
                px=0,
                py=16,
            ),
        ]
    elif STAGE == "rookie":
        props += [
            shape_group(
                "headband",
                [rect(96, 13, 6), solid((220, 50, 50)), stroke(OUTLINE, 1.5)],
                px=0,
                py=y - 46,
            ),
            shape_group(
                "headband-tail",
                [rect(16, 26, 4), solid((220, 50, 50))],
                px=50,
                py=y - 38,
                r=25,
            ),
            shape_group(
                "lanyard",
                [rect(6, 46, 3), solid((40, 90, 180))],
                px=0,
                py=28,
            ),
            shape_group(
                "badge-card",
                [rect(34, 42, 4), solid((255, 255, 255)), stroke((40, 90, 180), 2.5)],
                px=0,
                py=66,
            ),
            shape_group(
                "badge-photo",
                [ellipse(15, 15), solid((255, 200, 150)), stroke(OUTLINE, 1)],
                px=0,
                py=58,
            ),
            shape_group(
                "badge-bar",
                [rect(22, 6, 2), solid((40, 90, 180))],
                px=0,
                py=76,
            ),
        ]
    elif STAGE == "pro":
        props += [
            shape_group(
                "glass-l",
                [ellipse(30, 28), solid(WHITE, 0.18), stroke((35, 35, 40), 3.5)],
                px=-24,
                py=y - 10,
            ),
            shape_group(
                "glass-r",
                [ellipse(30, 28), solid(WHITE, 0.18), stroke((35, 35, 40), 3.5)],
                px=24,
                py=y - 10,
            ),
            shape_group(
                "bridge",
                [rect(14, 3.5, 2), solid((35, 35, 40))],
                px=0,
                py=y - 10,
            ),
            shape_group(
                "notebook",
                [rect(38, 50, 4), solid((70, 140, 110)), stroke(OUTLINE, 2)],
                px=-72,
                py=48,
                r=-12,
            ),
            shape_group(
                "notebook-page",
                [rect(28, 38, 2), solid((250, 250, 245))],
                px=-72,
                py=48,
                r=-12,
            ),
            shape_group(
                "notebook-line1",
                [rect(20, 2, 1), solid((180, 180, 180))],
                px=-72,
                py=40,
                r=-12,
            ),
            shape_group(
                "notebook-line2",
                [rect(20, 2, 1), solid((180, 180, 180))],
                px=-72,
                py=48,
                r=-12,
            ),
            shape_group(
                "pen",
                [rect(5, 34, 2), solid((40, 40, 50))],
                px=-56,
                py=34,
                r=-25,
            ),
        ]
    else:
        props += [
            shape_group(
                "glass-l",
                [ellipse(28, 26), solid(WHITE, 0.12), stroke((25, 25, 30), 3)],
                px=-24,
                py=y - 10,
            ),
            shape_group(
                "glass-r",
                [ellipse(28, 26), solid(WHITE, 0.12), stroke((25, 25, 30), 3)],
                px=24,
                py=y - 10,
            ),
            shape_group(
                "bridge",
                [rect(14, 3, 2), solid((25, 25, 30))],
                px=0,
                py=y - 10,
            ),
            shape_group(
                "star-badge",
                [ellipse(20, 20), solid((255, 205, 60)), stroke((180, 130, 20), 2.5)],
                px=42,
                py=38,
            ),
            shape_group(
                "star-core",
                [ellipse(9, 9), solid((255, 245, 180))],
                px=42,
                py=38,
            ),
        ]
    return props


def cape_back():
    """披風放最下層。"""
    if STAGE != "master":
        return []
    cape = [
        shape_group(
            "cape-l",
            [ellipse(52, 90), solid((90, 50, 160)), stroke((60, 30, 110), 2)],
            px=-50,
            py=58,
            r=18,
        ),
        shape_group(
            "cape-r",
            [ellipse(52, 90), solid((90, 50, 160)), stroke((60, 30, 110), 2)],
            px=50,
            py=58,
            r=-18,
        ),
        shape_group(
            "cape-collar",
            [ellipse(74, 18), solid((120, 70, 190)), stroke((60, 30, 110), 2)],
            px=0,
            py=16,
        ),
    ]
    return cape


def assemble(mouth_style="smile", brow_tilt=0, eye_scale=100, extra_top=None):
    """完整角色：props + head + body + cape(底)。"""
    head = dog_head(mouth_style, brow_tilt, eye_scale)
    body = body_shapes()
    props = form_props()
    top = list(extra_top or [])
    # 第一＝最上層
    return top + props + head + body + cape_back()


def make_doc(name, op, layers):
    return {
        "v": "5.7.4",
        "fr": FR,
        "ip": 0,
        "op": op,
        "w": W,
        "h": H,
        "nm": name,
        "ddd": 0,
        "assets": [],
        "layers": layers,
        "markers": [],
    }


def build_idle():
    op = 90
    # 全身待機：輕微上下（CSS 也會呼吸；這裡保留眨眼）
    bob = kf(
        [
            (0, [W / 2, H / 2 + 10, 0]),
            (45, [W / 2, H / 2 + 4, 0]),
            (90, [W / 2, H / 2 + 10, 0]),
        ]
    )
    breath = scale_kf([(0, [100, 100]), (45, [101, 99]), (90, [100, 100])])
    blink_o = kf([(0, 0), (50, 0), (53, 100), (56, 0), (90, 0)])
    lids = [
        shape_group(
            "lid-l",
            [ellipse(26, 14), solid(BODY)],
            px=-24,
            py=HY - 10,
            animated_o=blink_o,
        ),
        shape_group(
            "lid-r",
            [ellipse(26, 14), solid(BODY)],
            px=24,
            py=HY - 10,
            animated_o=blink_o,
        ),
    ]
    shapes = assemble("smile", extra_top=lids)
    return make_doc(
        f"mascot-{STAGE}-idle",
        op,
        [layer("dog", shapes, op=op, animated_pos=bob, animated_s=breath)],
    )


def build_success():
    op = 45
    jump = kf(
        [
            (0, [W / 2, H / 2 + 16, 0]),
            (10, [W / 2, H / 2 - 20, 0]),
            (20, [W / 2, H / 2 + 10, 0]),
            (28, [W / 2, H / 2 - 8, 0]),
            (36, [W / 2, H / 2 + 8, 0]),
            (45, [W / 2, H / 2 + 10, 0]),
        ]
    )
    spin = kf([(0, -6), (12, 8), (24, -4), (36, 3), (45, 0)])
    pop = scale_kf([(0, [92, 92]), (12, [110, 110]), (24, [98, 98]), (45, [100, 100])])
    spark_o = kf([(0, 0), (8, 100), (30, 100), (45, 0)])
    sparks = [
        shape_group(
            "spark1",
            [ellipse(8, 8), solid((255, 214, 90))],
            px=-80,
            py=HY - 40,
            animated_o=spark_o,
            animated_s=kf([(0, [40, 40]), (15, [120, 120]), (45, [60, 60])]),
        ),
        shape_group(
            "spark2",
            [ellipse(8, 8), solid((255, 214, 90))],
            px=82,
            py=HY - 30,
            animated_o=spark_o,
            animated_s=kf([(0, [50, 50]), (18, [130, 130]), (45, [50, 50])]),
        ),
    ]
    shapes = assemble("open", eye_scale=110, extra_top=sparks)
    return make_doc(
        f"mascot-{STAGE}-success",
        op,
        [
            layer(
                "dog",
                shapes,
                op=op,
                animated_pos=jump,
                animated_r=spin,
                animated_s=pop,
            )
        ],
    )


def build_thinking():
    op = 75
    sway = kf([(0, -5), (20, 5), (40, -3), (55, 4), (75, -5)])
    bob = kf(
        [
            (0, [W / 2, H / 2 + 10, 0]),
            (37, [W / 2, H / 2 + 4, 0]),
            (75, [W / 2, H / 2 + 10, 0]),
        ]
    )
    dots = []
    for i, (x, y, delay) in enumerate(
        [(-70, HY - 50, 0), (-82, HY - 68, 12), (-94, HY - 88, 24)]
    ):
        size = 10 + i * 5
        o_anim = kf(
            [
                (0, 0),
                (delay, 0),
                (delay + 8, 100),
                (delay + 40, 100),
                (delay + 50, 0),
                (75, 0),
            ]
        )
        dots.append(
            shape_group(
                f"dot{i}",
                [ellipse(size, size), solid(WHITE), stroke(OUTLINE, 1.5)],
                px=x,
                py=y,
                animated_o=o_anim,
            )
        )
    shapes = assemble("flat", brow_tilt=18, extra_top=dots)
    return make_doc(
        f"mascot-{STAGE}-thinking",
        op,
        [layer("dog", shapes, op=op, animated_pos=bob, animated_r=sway)],
    )


def build_error():
    op = 36
    shake = kf(
        [
            (0, [W / 2, H / 2 + 10, 0]),
            (4, [W / 2 - 10, H / 2 + 10, 0]),
            (8, [W / 2 + 10, H / 2 + 10, 0]),
            (12, [W / 2 - 8, H / 2 + 10, 0]),
            (16, [W / 2 + 8, H / 2 + 10, 0]),
            (22, [W / 2 - 4, H / 2 + 10, 0]),
            (28, [W / 2 + 3, H / 2 + 10, 0]),
            (36, [W / 2, H / 2 + 10, 0]),
        ]
    )
    tilt = kf([(0, 0), (6, -8), (12, 8), (18, -6), (24, 4), (36, 0)])
    shrink = scale_kf([(0, [100, 100]), (10, [94, 94]), (36, [100, 100])])
    sweat = kf([(0, 0), (8, 100), (28, 100), (36, 0)])
    sweat_drop = shape_group(
        "sweat",
        [ellipse(8, 12), solid((120, 190, 255))],
        px=56,
        py=HY - 20,
        animated_o=sweat,
        animated_pos=kf([(0, [56, HY - 20]), (20, [60, HY - 5]), (36, [62, HY + 8])]),
    )
    shapes = assemble("frown", brow_tilt=-16, eye_scale=90, extra_top=[sweat_drop])
    return make_doc(
        f"mascot-{STAGE}-error",
        op,
        [
            layer(
                "dog",
                shapes,
                op=op,
                animated_pos=shake,
                animated_r=tilt,
                animated_s=shrink,
            )
        ],
    )


def main():
    builders = {
        "idle": build_idle,
        "success": build_success,
        "thinking": build_thinking,
        "error": build_error,
    }
    for stage in STAGES:
        set_stage(stage)
        for state, builder in builders.items():
            doc = builder()
            name = f"mascot-{stage}-{state}.json"
            path = OUT / name
            path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
            print(f"wrote {name} ({path.stat().st_size} bytes)")

    set_stage("baby")
    for state, builder in builders.items():
        doc = builder()
        doc["nm"] = f"mascot-{state}"
        (OUT / f"mascot-{state}.json").write_text(
            json.dumps(doc, separators=(",", ":")), encoding="utf-8"
        )
    print("done")


if __name__ == "__main__":
    main()
