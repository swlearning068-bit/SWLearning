#!/usr/bin/env python3
"""Generate stage-based cute-dog Lottie JSON (baby/teen/adult/master × 4 states)."""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
W = H = 200
FR = 30

# 目前階段調色（由 set_stage 寫入）
BODY = EAR = EAR_INNER = SNOUT = NOSE = EYE = CHEEK = OUTLINE = SPOT = (0, 0, 0)
WHITE = (255, 255, 255)
STAGE = "baby"
EYE_BOOST = 100
HEAD_SCALE = 100

STAGES = {
    "baby": {
        "body": (255, 200, 150),
        "ear": (245, 160, 110),
        "ear_inner": (255, 220, 195),
        "snout": (255, 238, 220),
        "nose": (80, 55, 50),
        "eye": (50, 42, 42),
        "cheek": (255, 160, 150),
        "outline": (100, 70, 55),
        "spot": (250, 180, 120),
        "eye_boost": 118,
        "head_scale": 92,
    },
    "teen": {
        "body": (255, 186, 120),
        "ear": (232, 140, 80),
        "ear_inner": (255, 210, 180),
        "snout": (255, 232, 210),
        "nose": (70, 50, 45),
        "eye": (45, 40, 40),
        "cheek": (255, 150, 140),
        "outline": (90, 60, 50),
        "spot": (240, 160, 95),
        "eye_boost": 100,
        "head_scale": 100,
    },
    "adult": {
        "body": (245, 175, 115),
        "ear": (210, 125, 75),
        "ear_inner": (250, 205, 175),
        "snout": (255, 228, 205),
        "nose": (55, 40, 38),
        "eye": (35, 32, 32),
        "cheek": (240, 140, 130),
        "outline": (75, 50, 42),
        "spot": (220, 145, 90),
        "eye_boost": 96,
        "head_scale": 104,
    },
    "master": {
        "body": (235, 165, 105),
        "ear": (195, 115, 70),
        "ear_inner": (245, 198, 168),
        "snout": (255, 224, 200),
        "nose": (45, 35, 32),
        "eye": (30, 28, 28),
        "cheek": (230, 130, 120),
        "outline": (65, 45, 38),
        "spot": (205, 135, 85),
        "eye_boost": 94,
        "head_scale": 108,
    },
}


def set_stage(stage: str) -> None:
    global BODY, EAR, EAR_INNER, SNOUT, NOSE, EYE, CHEEK, OUTLINE, SPOT
    global STAGE, EYE_BOOST, HEAD_SCALE
    cfg = STAGES[stage]
    STAGE = stage
    BODY = cfg["body"]
    EAR = cfg["ear"]
    EAR_INNER = cfg["ear_inner"]
    SNOUT = cfg["snout"]
    NOSE = cfg["nose"]
    EYE = cfg["eye"]
    CHEEK = cfg["cheek"]
    OUTLINE = cfg["outline"]
    SPOT = cfg["spot"]
    EYE_BOOST = cfg["eye_boost"]
    HEAD_SCALE = cfg["head_scale"]


def color(rgb, a=1.0):
    r, g, b = rgb
    return {"a": 0, "k": [r / 255, g / 255, b / 255, a]}


def solid(rgb, a=1.0):
    return {"ty": "fl", "c": color(rgb, a), "o": {"a": 0, "k": 100}, "r": 1, "bm": 0, "nm": "Fill"}


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


def rect(sx, sy, r=12):
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
    # 套用階段縮放
    base_s = root_tr.get("animated_s")
    if base_s is None:
        s = HEAD_SCALE
        base_s = {"a": 0, "k": [s, s, 100]}
    ks = {
        "o": root_tr.get("animated_o") or {"a": 0, "k": 100},
        "r": root_tr.get("animated_r") or {"a": 0, "k": 0},
        "p": root_tr.get("animated_pos") or {"a": 0, "k": [W / 2, H / 2, 0]},
        "a": {"a": 0, "k": [0, 0, 0]},
        "s": base_s,
    }
    return {
        "ddd": 0,
        "ind": ind,
        "ty": 4,
        "nm": name,
        "sr": 1,
        "ks": ks,
        "ao": 0,
        "shapes": shapes,
        "ip": ip,
        "op": op,
        "st": 0,
        "bm": 0,
    }


def scale_kf(pairs_2d):
    """pairs_2d: [(t, [sx,sy]), ...] → 3D scale keyframes with HEAD_SCALE baked in."""
    factor = HEAD_SCALE / 100
    mapped = []
    for t, xy in pairs_2d:
        mapped.append((t, [xy[0] * factor, xy[1] * factor, 100]))
    return kf(mapped)


def dog_shapes(mouth_style="smile", brow_tilt=0, eye_scale=100):
    """Lottie：陣列越前面越上層。回傳：臉部細節 → 頭 → 耳朵。"""
    eye_scale = int(eye_scale * EYE_BOOST / 100)
    back = []

    back.append(
        shape_group(
            "ear-l",
            [ellipse(42, 58), solid(EAR), stroke(OUTLINE, 2.5)],
            px=-50,
            py=-46,
            r=-26,
        )
    )
    back.append(
        shape_group(
            "ear-l-in",
            [ellipse(20, 30), solid(EAR_INNER)],
            px=-50,
            py=-42,
            r=-26,
        )
    )
    back.append(
        shape_group(
            "ear-r",
            [ellipse(42, 58), solid(EAR), stroke(OUTLINE, 2.5)],
            px=50,
            py=-46,
            r=26,
        )
    )
    back.append(
        shape_group(
            "ear-r-in",
            [ellipse(20, 30), solid(EAR_INNER)],
            px=50,
            py=-42,
            r=26,
        )
    )

    back.append(
        shape_group(
            "head",
            [ellipse(122, 112), solid(BODY), stroke(OUTLINE, 3)],
            px=0,
            py=-2,
        )
    )
    back.append(shape_group("spot", [ellipse(30, 24), solid(SPOT)], px=36, py=-26))

    back.append(
        shape_group(
            "cheek-l",
            [ellipse(18, 12), solid(CHEEK)],
            px=-42,
            py=16,
            animated_o={"a": 0, "k": 55},
        )
    )
    back.append(
        shape_group(
            "cheek-r",
            [ellipse(18, 12), solid(CHEEK)],
            px=42,
            py=16,
            animated_o={"a": 0, "k": 55},
        )
    )
    back.append(
        shape_group(
            "snout",
            [ellipse(52, 36), solid(SNOUT), stroke(OUTLINE, 2)],
            px=0,
            py=24,
        )
    )
    back.append(shape_group("nose", [ellipse(18, 14), solid(NOSE)], px=0, py=16))

    if mouth_style == "smile":
        back.append(
            shape_group("mouth", [ellipse(26, 16), solid(NOSE)], px=0, py=34, sy=50)
        )
    elif mouth_style == "open":
        back.append(
            shape_group(
                "mouth",
                [ellipse(28, 24), solid((180, 70, 70)), stroke(OUTLINE, 1.5)],
                px=0,
                py=36,
            )
        )
    elif mouth_style == "frown":
        back.append(
            shape_group(
                "mouth",
                [ellipse(22, 12), solid(NOSE)],
                px=0,
                py=38,
                sy=45,
                r=180,
            )
        )
    else:
        back.append(
            shape_group("mouth", [rect(20, 5, 4), solid(NOSE)], px=0, py=36)
        )

    back.append(
        shape_group(
            "eye-l-w",
            [ellipse(26, 28), solid(WHITE), stroke(OUTLINE, 2)],
            px=-26,
            py=-12,
            sx=eye_scale,
            sy=eye_scale,
        )
    )
    back.append(
        shape_group(
            "eye-r-w",
            [ellipse(26, 28), solid(WHITE), stroke(OUTLINE, 2)],
            px=26,
            py=-12,
            sx=eye_scale,
            sy=eye_scale,
        )
    )
    back.append(shape_group("pupil-l", [ellipse(12, 14), solid(EYE)], px=-24, py=-10))
    back.append(shape_group("pupil-r", [ellipse(12, 14), solid(EYE)], px=28, py=-10))
    back.append(shape_group("shine-l", [ellipse(5, 5), solid(WHITE)], px=-28, py=-14))
    back.append(shape_group("shine-r", [ellipse(5, 5), solid(WHITE)], px=24, py=-14))

    if brow_tilt != 0:
        back.append(
            shape_group(
                "brow-l",
                [rect(18, 5, 3), solid(OUTLINE)],
                px=-26,
                py=-32,
                r=-brow_tilt,
            )
        )
        back.append(
            shape_group(
                "brow-r",
                [rect(18, 5, 3), solid(OUTLINE)],
                px=26,
                py=-32,
                r=brow_tilt,
            )
        )

    return list(reversed(back))


def stage_accessories():
    """各進化階段辨識配件（放在最上層）。"""
    acc = []
    if STAGE == "baby":
        # 幼年期不加頭頂配件，靠大眼睛與配色辨識
        pass
    elif STAGE == "teen":
        # 小圍巾
        acc.append(
            shape_group(
                "scarf",
                [ellipse(70, 18), solid((56, 132, 220)), stroke(OUTLINE, 1.5)],
                px=0,
                py=52,
            )
        )
    elif STAGE == "adult":
        # 眼鏡
        acc.append(
            shape_group(
                "glass-l",
                [ellipse(30, 28), solid(WHITE, 0.15), stroke((40, 40, 40), 3)],
                px=-26,
                py=-12,
            )
        )
        acc.append(
            shape_group(
                "glass-r",
                [ellipse(30, 28), solid(WHITE, 0.15), stroke((40, 40, 40), 3)],
                px=26,
                py=-12,
            )
        )
        acc.append(
            shape_group("bridge", [rect(14, 3, 2), solid((40, 40, 40))], px=0, py=-12)
        )
        # 領帶尖
        acc.append(
            shape_group(
                "tie",
                [ellipse(14, 22), solid((40, 80, 160)), stroke(OUTLINE, 1)],
                px=0,
                py=58,
            )
        )
    else:  # master
        acc.append(
            shape_group(
                "glass-l",
                [ellipse(30, 28), solid(WHITE, 0.12), stroke((30, 30, 30), 3)],
                px=-26,
                py=-12,
            )
        )
        acc.append(
            shape_group(
                "glass-r",
                [ellipse(30, 28), solid(WHITE, 0.12), stroke((30, 30, 30), 3)],
                px=26,
                py=-12,
            )
        )
        acc.append(
            shape_group("bridge", [rect(14, 3, 2), solid((30, 30, 30))], px=0, py=-12)
        )
        # 星星徽章
        acc.append(
            shape_group(
                "badge",
                [ellipse(18, 18), solid((255, 200, 60)), stroke((180, 130, 20), 2)],
                px=48,
                py=40,
            )
        )
        acc.append(
            shape_group("badge-core", [ellipse(8, 8), solid((255, 240, 160))], px=48, py=40)
        )
        # 小禮帽
        acc.append(
            shape_group(
                "hat-brim",
                [ellipse(56, 12), solid((45, 45, 55)), stroke(OUTLINE, 1.5)],
                px=0,
                py=-62,
            )
        )
        acc.append(
            shape_group(
                "hat-top",
                [rect(34, 22, 6), solid((45, 45, 55)), stroke(OUTLINE, 1.5)],
                px=0,
                py=-74,
            )
        )
        acc.append(
            shape_group(
                "hat-band",
                [rect(34, 6, 2), solid((200, 160, 50))],
                px=0,
                py=-66,
            )
        )
    return acc


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
    bob = kf(
        [
            (0, [W / 2, H / 2 + 4, 0]),
            (45, [W / 2, H / 2 - 6, 0]),
            (90, [W / 2, H / 2 + 4, 0]),
        ]
    )
    breath = scale_kf([(0, [100, 100]), (45, [102, 98]), (90, [100, 100])])
    shapes = dog_shapes("smile")
    blink_o = kf([(0, 0), (50, 0), (53, 100), (56, 0), (90, 0)])
    lids = [
        shape_group(
            "lid-l",
            [ellipse(28, 16), solid(BODY)],
            px=-26,
            py=-12,
            animated_o=blink_o,
        ),
        shape_group(
            "lid-r",
            [ellipse(28, 16), solid(BODY)],
            px=26,
            py=-12,
            animated_o=blink_o,
        ),
    ]
    shapes = stage_accessories() + lids + shapes
    return make_doc(
        f"mascot-{STAGE}-idle",
        op,
        [layer("dog", shapes, op=op, animated_pos=bob, animated_s=breath)],
    )


def build_success():
    op = 45
    jump = kf(
        [
            (0, [W / 2, H / 2 + 10, 0]),
            (10, [W / 2, H / 2 - 28, 0]),
            (20, [W / 2, H / 2 + 6, 0]),
            (28, [W / 2, H / 2 - 14, 0]),
            (36, [W / 2, H / 2 + 2, 0]),
            (45, [W / 2, H / 2, 0]),
        ]
    )
    spin = kf([(0, -8), (12, 10), (24, -6), (36, 4), (45, 0)])
    pop = scale_kf([(0, [90, 90]), (12, [112, 112]), (24, [96, 96]), (45, [100, 100])])
    shapes = dog_shapes("open", eye_scale=110)
    spark_o = kf([(0, 0), (8, 100), (30, 100), (45, 0)])
    sparks = [
        shape_group(
            "spark1",
            [ellipse(8, 8), solid((255, 214, 90))],
            px=-70,
            py=-60,
            animated_o=spark_o,
            animated_s=kf([(0, [40, 40]), (15, [120, 120]), (45, [60, 60])]),
        ),
        shape_group(
            "spark2",
            [ellipse(8, 8), solid((255, 214, 90))],
            px=72,
            py=-50,
            animated_o=spark_o,
            animated_s=kf([(0, [50, 50]), (18, [130, 130]), (45, [50, 50])]),
        ),
    ]
    shapes = sparks + stage_accessories() + shapes
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
    sway = kf([(0, -6), (20, 6), (40, -4), (55, 5), (75, -6)])
    bob = kf(
        [
            (0, [W / 2, H / 2, 0]),
            (37, [W / 2, H / 2 - 5, 0]),
            (75, [W / 2, H / 2, 0]),
        ]
    )
    shapes = dog_shapes("flat", brow_tilt=18)
    dots = []
    for i, (x, y, delay) in enumerate(
        [(-62, -70, 0), (-74, -88, 12), (-86, -108, 24)]
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
    shapes = dots + stage_accessories() + shapes
    return make_doc(
        f"mascot-{STAGE}-thinking",
        op,
        [layer("dog", shapes, op=op, animated_pos=bob, animated_r=sway)],
    )


def build_error():
    op = 36
    shake = kf(
        [
            (0, [W / 2, H / 2, 0]),
            (4, [W / 2 - 10, H / 2, 0]),
            (8, [W / 2 + 10, H / 2, 0]),
            (12, [W / 2 - 8, H / 2, 0]),
            (16, [W / 2 + 8, H / 2, 0]),
            (22, [W / 2 - 4, H / 2, 0]),
            (28, [W / 2 + 3, H / 2, 0]),
            (36, [W / 2, H / 2, 0]),
        ]
    )
    tilt = kf([(0, 0), (6, -10), (12, 10), (18, -8), (24, 6), (36, 0)])
    shrink = scale_kf([(0, [100, 100]), (10, [94, 94]), (36, [100, 100])])
    shapes = dog_shapes("frown", brow_tilt=-16, eye_scale=90)
    sweat = kf([(0, 0), (8, 100), (28, 100), (36, 0)])
    sweat_drop = shape_group(
        "sweat",
        [ellipse(8, 12), solid((120, 190, 255))],
        px=58,
        py=-20,
        animated_o=sweat,
        animated_pos=kf([(0, [58, -20]), (20, [62, -5]), (36, [64, 5])]),
    )
    shapes = [sweat_drop] + stage_accessories() + shapes
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

    # 相容舊路徑：無前綴 = baby
    set_stage("baby")
    for state, builder in builders.items():
        doc = builder()
        # 改名為舊格式
        doc["nm"] = f"mascot-{state}"
        path = OUT / f"mascot-{state}.json"
        path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        print(f"wrote legacy mascot-{state}.json")

    for p in list(OUT.glob("_probe_*.json")) + list(OUT.glob("_p2_*.json")):
        p.unlink()
    print("done")


if __name__ == "__main__":
    main()
