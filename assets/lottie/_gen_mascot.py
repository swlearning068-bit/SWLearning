#!/usr/bin/env python3
"""Generate cohesive cute-dog Lottie JSON for idle/success/thinking/error."""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
W = H = 200
FR = 30


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


def transform(px=0, py=0, sx=100, sy=100, r=0, opacity=100, animated_pos=None, animated_r=None, animated_s=None, animated_o=None):
    t = {
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
    return t


def kf(times_values, out_len=None):
    """Build multi-keyframe animated property. times_values: [(t, value), ...]"""
    keys = []
    n = len(times_values)
    for i, (t, v) in enumerate(times_values):
        item = {"t": t, "s": v if isinstance(v, list) else [v]}
        if i < n - 1:
            item["e"] = (
                times_values[i + 1][1]
                if isinstance(times_values[i + 1][1], list)
                else [times_values[i + 1][1]]
            )
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
    ks = {
        "o": root_tr.get("animated_o") or {"a": 0, "k": 100},
        "r": root_tr.get("animated_r") or {"a": 0, "k": 0},
        "p": root_tr.get("animated_pos")
        or {"a": 0, "k": [W / 2, H / 2, 0]},
        "a": {"a": 0, "k": [0, 0, 0]},
        "s": root_tr.get("animated_s") or {"a": 0, "k": [100, 100, 100]},
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


# Palette — warm coral dog (not purple / not cream-terracotta cliché overload)
BODY = (255, 186, 120)
EAR = (232, 140, 80)
EAR_INNER = (255, 210, 180)
SNOUT = (255, 232, 210)
NOSE = (70, 50, 45)
EYE = (45, 40, 40)
CHEEK = (255, 150, 140)
OUTLINE = (90, 60, 50)
WHITE = (255, 255, 255)
SPOT = (240, 160, 95)


def dog_shapes(mouth_style="smile", brow_tilt=0, eye_scale=100):
    """Build dog face groups.

    Lottie / After Effects：shapes 陣列「越前面越上層」。
    因此回傳順序為：臉部細節 → 頭 → 耳朵（耳朵在最底層）。
    """
    back = []  # 先收集「由後到前」，最後再 reverse

    # —— 最底：耳朵 ——
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

    # —— 頭與斑點 ——
    back.append(
        shape_group(
            "head",
            [ellipse(122, 112), solid(BODY), stroke(OUTLINE, 3)],
            px=0,
            py=-2,
        )
    )
    back.append(shape_group("spot", [ellipse(30, 24), solid(SPOT)], px=36, py=-26))

    # —— 臉：臉頰、口鼻、眼睛（越後面越上層，reverse 後會在最前） ——
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
            shape_group(
                "mouth",
                [ellipse(26, 16), solid(NOSE)],
                px=0,
                py=34,
                sy=50,
            )
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
            shape_group(
                "mouth",
                [rect(20, 5, 4), solid(NOSE)],
                px=0,
                py=36,
            )
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
    back.append(
        shape_group("pupil-l", [ellipse(12, 14), solid(EYE)], px=-24, py=-10)
    )
    back.append(
        shape_group("pupil-r", [ellipse(12, 14), solid(EYE)], px=28, py=-10)
    )
    back.append(
        shape_group("shine-l", [ellipse(5, 5), solid(WHITE)], px=-28, py=-14)
    )
    back.append(
        shape_group("shine-r", [ellipse(5, 5), solid(WHITE)], px=24, py=-14)
    )

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

    # reverse：臉在陣列前端（最上層），耳朵在後端（最下層）
    return list(reversed(back))


def make_doc(name, op, shapes_or_layers, use_layers=False):
    if use_layers:
        layers = shapes_or_layers
    else:
        layers = [layer("dog", shapes_or_layers, op=op)]
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
    """Gentle bob + occasional blink."""
    op = 90
    # Root bob
    bob = kf(
        [
            (0, [W / 2, H / 2 + 4, 0]),
            (45, [W / 2, H / 2 - 6, 0]),
            (90, [W / 2, H / 2 + 4, 0]),
        ]
    )
    # Soft scale breathe
    breath = kf(
        [
            (0, [100, 100, 100]),
            (45, [102, 98, 100]),
            (90, [100, 100, 100]),
        ]
    )

    shapes = dog_shapes("smile")
    # 眨眼眼皮必須在陣列最前面（最上層）
    blink_o = kf(
        [
            (0, 0),
            (50, 0),
            (53, 100),
            (56, 0),
            (90, 0),
        ]
    )
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
    shapes = lids + shapes

    return make_doc(
        "mascot-idle",
        op,
        [layer("dog", shapes, op=op, animated_pos=bob, animated_s=breath)],
        use_layers=True,
    )


def build_success():
    """Jump + spin ears feel via rotation + open happy mouth."""
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
    spin = kf(
        [
            (0, -8),
            (12, 10),
            (24, -6),
            (36, 4),
            (45, 0),
        ]
    )
    pop = kf(
        [
            (0, [90, 90, 100]),
            (12, [112, 112, 100]),
            (24, [96, 96, 100]),
            (45, [100, 100, 100]),
        ]
    )
    shapes = dog_shapes("open", eye_scale=110)
    # 星星在最上層
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
    shapes = sparks + shapes
    return make_doc(
        "mascot-success",
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
        use_layers=True,
    )


def build_thinking():
    """Sway + raised brows + thought dots."""
    op = 75
    sway = kf(
        [
            (0, -6),
            (20, 6),
            (40, -4),
            (55, 5),
            (75, -6),
        ]
    )
    bob = kf(
        [
            (0, [W / 2, H / 2, 0]),
            (37, [W / 2, H / 2 - 5, 0]),
            (75, [W / 2, H / 2, 0]),
        ]
    )
    shapes = dog_shapes("flat", brow_tilt=18)

    # 思考氣泡在最上層
    dots = []
    for i, (x, y, delay) in enumerate([(-62, -70, 0), (-74, -88, 12), (-86, -108, 24)]):
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
    shapes = dots + shapes

    return make_doc(
        "mascot-thinking",
        op,
        [layer("dog", shapes, op=op, animated_pos=bob, animated_r=sway)],
        use_layers=True,
    )


def build_error():
    """Shake + frown."""
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
    tilt = kf(
        [
            (0, 0),
            (6, -10),
            (12, 10),
            (18, -8),
            (24, 6),
            (36, 0),
        ]
    )
    shrink = kf(
        [
            (0, [100, 100, 100]),
            (10, [94, 94, 100]),
            (36, [100, 100, 100]),
        ]
    )
    shapes = dog_shapes("frown", brow_tilt=-16, eye_scale=90)
    # 汗珠在最上層
    sweat = kf([(0, 0), (8, 100), (28, 100), (36, 0)])
    sweat_drop = shape_group(
        "sweat",
        [ellipse(8, 12), solid((120, 190, 255))],
        px=58,
        py=-20,
        animated_o=sweat,
        animated_pos=kf(
            [
                (0, [58, -20]),
                (20, [62, -5]),
                (36, [64, 5]),
            ]
        ),
    )
    shapes = [sweat_drop] + shapes
    return make_doc(
        "mascot-error",
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
        use_layers=True,
    )


def main():
    files = {
        "mascot-idle.json": build_idle(),
        "mascot-success.json": build_success(),
        "mascot-thinking.json": build_thinking(),
        "mascot-error.json": build_error(),
    }
    for name, doc in files.items():
        path = OUT / name
        path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {path.name} ({path.stat().st_size} bytes)")

    # cleanup probes
    for p in OUT.glob("_probe_*.json"):
        p.unlink()
    for p in OUT.glob("_p2_*.json"):
        p.unlink()
    print("cleaned probe files")


if __name__ == "__main__":
    main()
