#!/usr/bin/env python3
"""Build every form of the Code UI brand mark from one geometry.

Run from mobile/:  python3 scripts/build-brand-assets.py
Needs rsvg-convert on PATH (brew install librsvg). Python stdlib only.

Re-running on the SAME machine is byte-identical (no tIME chunk, all geometry is
constants). Across machines it is not: the raster is whatever the local librsvg
and cairo emit. Generated 2026-09-17 with rsvg-convert 2.62.3 / cairo 1.18.4. A
different version churns all five PNGs without failing a test, because the tests
assert colours and sizes rather than bytes, so expect diff noise and check that
is all it is.

The mark: a red rounded tile with two chevrons (a `<` and a `>`) knotted into
an S and cut out of it. The supplied art is assets/brand/mark-source.webp,
2048x1536 with a white background; the tile inside it is 742x705 px, which is
below the 1024 px an app icon needs. Because the shape is flat geometry, it was
reconstructed as a vector instead of upscaled: the outline was traced from the
raster, each straight edge least-squares fitted to its boundary pixels (max
residual 0.8 px) and each corner fitted to a circle (r = 181, residual < 1 px),
and the result rendered back at source scale differs from the raster mask on
0.6% of its pixels, all of it anti-aliasing along the edge (2026-09-17).

The art is NOT symmetric and this reproduces it as drawn: the left lobe has a
round top (one semicircle) while the right lobe's bottom is flat with a sharp
corner where the diagonal exits, and the two arms of each chevron sit at
slightly different angles (52 deg and 50 deg from horizontal).

Outputs, all overwritten:
  assets/brand/mark.svg          vector master: the tile, viewBox 0 0 741 704
  src/components/app-logo-path.ts the same path for the in-app <AppLogo/>
  assets/icon.png                1024 opaque: red full-bleed, white knot. The
                                 OS mask (iOS squircle, Android legacy) supplies
                                 the corners; a tile carrying its own would show
                                 double corners.
  assets/adaptive-icon.png       1024 foreground: the knot alone in white, the
                                 tile mapped onto the 72dp visible box so the
                                 launcher's mask becomes the tile. app.json's
                                 adaptiveIcon.backgroundColor is the red.
  assets/notification-icon.png   96 white silhouette on transparent, the knot
                                 in an 80 px live area. Android draws small
                                 icons as an alpha mask, so any colour here
                                 becomes a white blob.
  assets/splash-icon.png         1024 tile with transparent corners and knot,
                                 so either splash background shows through.
  assets/favicon.png             48, same as the splash.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

MOBILE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RED = "#F11924"  # the art's dominant colour, sampled (241, 25, 36)
WHITE = "#FFFFFF"

# ---- geometry, in tile units: 741 wide, 704 tall, corner radius 181 ---------
W, H, R = 741.0, 704.0, 181.0
CL, CR, CT, CB = R, W - R, R, H - R  # circle centres of the four corners

# Each cut edge as (a point on it, dx/dy). Letters follow the outline clockwise
# from the left lobe's top: B/C are the `<` outer edges, D its end cut, E/F its
# inner edges; K/L the `>` outer edges, M its end cut, N/O its inner edges.
LINES = {
    "B": ((198.88, 205.50), -0.7768),
    "C": ((179.01, 462.00), 0.8470),
    "D": ((301.12, 537.50), -0.8216),
    "E": ((264.88, 426.50), 0.8667),
    "F": ((313.37, 205.00), -0.7761),
    "K": ((519.76, 528.00), -0.7729),
    "L": ((563.23, 242.00), 0.8473),
    "M": ((441.40, 167.00), -0.7822),
    "N": ((477.80, 278.00), 0.8666),
    "O": ((426.55, 500.00), -0.7770),
}

Point = tuple[float, float]


def x_at(name: str, y: float) -> float:
    (px, py), slope = LINES[name]
    return px + slope * (y - py)


def isect(a: str, b: str) -> Point:
    (pa, sa), (pb, sb) = LINES[a], LINES[b]
    y = (pb[0] - pa[0] - sb * pb[1] + sa * pa[1]) / (sa - sb)
    return (x_at(a, y), y)


def line_circle(name: str, cx: float, cy: float, r: float, pick) -> Point:
    (px, py), s = LINES[name]
    a = s * s + 1
    b = 2 * (s * (px - cx) + (py - cy))
    c = (px - cx) ** 2 + (py - cy) ** 2 - r * r
    disc = (b * b - 4 * a * c) ** 0.5
    y = pick(py + (-b + disc) / (2 * a), py + (-b - disc) / (2 * a))
    return (x_at(name, y), y)


TIP1, D1, D2, V1 = isect("B", "C"), isect("C", "D"), isect("D", "E"), isect("E", "F")
P1 = line_circle("B", CL, CT, R, min)  # where the `<` outer edge meets the left dome
P2 = line_circle("F", CR, CT, R, min)  # where the `<` inner edge meets the right dome
TIP2, M1, M2, V2 = isect("K", "L"), isect("L", "M"), isect("M", "N"), isect("N", "O")
P3 = (x_at("K", H), H)  # the `>` outer edge exits through the flat bottom: sharp corner
P4 = line_circle("O", CL, CB, R, max)  # where the `>` inner edge meets the bottom-left dome


def pt(p: Point) -> str:
    return f"{p[0]:.2f} {p[1]:.2f}"


def arc(to: Point) -> str:
    return f"A {R:.0f} {R:.0f} 0 0 1 {pt(to)}"


def mark_path() -> str:
    """The red tile as one closed outline; the knot is concavity, not holes."""
    return " ".join(
        [
            f"M {CL:.0f} 0",
            arc(P1),
            f"L {pt(TIP1)} L {pt(D1)} L {pt(D2)} L {pt(V1)} L {pt(P2)}",
            arc((W, CT)),
            f"L {W:.0f} {CB:.0f}",
            arc((CR, H)),
            f"L {pt(P3)} L {pt(TIP2)} L {pt(M1)} L {pt(M2)} L {pt(V2)} L {pt(P4)}",
            arc((0, CB)),
            f"L 0 {CT:.0f}",
            arc((CL, 0)),
            "Z",
        ]
    )


def knot_polygons(extend: float) -> list[list[Point]]:
    """The two white bands. `extend` runs their open ends that far past the
    tile's top and bottom edges (0 = cut flush, as the tile shows them)."""
    top, bottom = -extend, H + extend
    chevron_left = [(x_at("B", top), top), TIP1, D1, D2, V1, (x_at("F", top), top)]
    chevron_right = [(x_at("K", bottom), bottom), TIP2, M1, M2, V2, (x_at("O", bottom), bottom)]
    return [chevron_left, chevron_right]


def polygon(points: list[Point], fill: str) -> str:
    return f'<polygon fill="{fill}" points="{" ".join(f"{x:.2f},{y:.2f}" for x, y in points)}"/>'


def knot_svg_body(extend: float, fill: str) -> str:
    return "".join(polygon(p, fill) for p in knot_polygons(extend))


def svg(view_box: str, body: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}">{body}</svg>'


# ---- outputs ---------------------------------------------------------------
def render(svg_text: str, out_rel: str, size: int) -> None:
    out = os.path.join(MOBILE, out_rel)
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as tmp:
        tmp.write(svg_text)
    try:
        subprocess.run(
            ["rsvg-convert", "-w", str(size), "-h", str(size), "-o", out, tmp.name],
            check=True,
        )
    finally:
        os.unlink(tmp.name)
    print(f"  {out_rel}  {size}x{size}")


def write(rel: str, text: str) -> None:
    with open(os.path.join(MOBILE, rel), "w") as handle:
        handle.write(text)
    print(f"  {rel}")


def main() -> int:
    if shutil.which("rsvg-convert") is None:
        print("rsvg-convert not found: brew install librsvg", file=sys.stderr)
        return 1
    path = mark_path()
    tile = f'<path fill="{RED}" d="{path}"/>'
    # A square viewBox around the 741x704 tile, tile centred vertically.
    square = f"0 {-(W - H) / 2:.2f} {W:.0f} {W:.0f}"

    print("vector")
    write("assets/brand/mark.svg", svg(f"0 0 {W:.0f} {H:.0f}", tile) + "\n")
    write(
        "src/components/app-logo-path.ts",
        "// Generated by scripts/build-brand-assets.py from the fitted brand-mark\n"
        "// geometry. Do not edit; re-run the script. app-logo-assets.test.ts pins\n"
        "// this path to assets/brand/mark.svg so the in-app mark and the launcher\n"
        "// icon stay one shape.\n"
        f"export const APP_LOGO_VIEWBOX_WIDTH = {W:.0f}\n"
        f"export const APP_LOGO_VIEWBOX_HEIGHT = {H:.0f}\n"
        f"export const APP_LOGO_PATH =\n  '{path}'\n",
    )

    print("raster")
    # App icon: opaque. Red everywhere, the knot's open ends run off the canvas.
    full_bleed = f'<rect x="0" y="{-(W - H) / 2:.2f}" width="{W:.0f}" height="{W:.0f}" fill="{RED}"/>'
    render(svg(square, full_bleed + knot_svg_body(200, WHITE)), "assets/icon.png", 1024)

    # Adaptive foreground: the 108dp canvas shows its inner 72dp through the
    # launcher's mask, so the tile's width is mapped onto that 72dp box and the
    # knot's open ends are extended clear off the canvas.
    units = W * 108 / 72
    adaptive_box = f"{-(units - W) / 2:.2f} {-(units - H) / 2:.2f} {units:.2f} {units:.2f}"
    render(svg(adaptive_box, knot_svg_body(400, WHITE)), "assets/adaptive-icon.png", 1024)

    # Notification: 24dp asset, glyph in the inner 20dp (80 of 96 px), ends cut
    # flush with the tile so the silhouette is finite.
    live = 80 / 96
    knot_h = H
    units = knot_h / live
    cx, cy = (TIP1[0] + TIP2[0]) / 2, H / 2
    notif_box = f"{cx - units / 2:.2f} {cy - units / 2:.2f} {units:.2f} {units:.2f}"
    render(svg(notif_box, knot_svg_body(0, WHITE)), "assets/notification-icon.png", 96)

    # Splash and favicon: the tile as drawn, corners and knot transparent.
    render(svg(square, tile), "assets/splash-icon.png", 1024)
    render(svg(square, tile), "assets/favicon.png", 48)
    return 0


if __name__ == "__main__":
    sys.exit(main())
