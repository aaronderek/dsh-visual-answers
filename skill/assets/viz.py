#!/usr/bin/env python3
"""viz.py — zero-install 可视化卡片渲染器（PNG，纯 Pillow + numpy）。

设计语言复用 CopilotKit/OpenIntelligentUI 的 design system（MIT）：
配色 ramp、卡片/圆角/表单风格、`--color-*` 语义色。见同目录 tokens.css。

用法（viz.py 与本文件同目录；SPEC/OUT 相对当前工作目录）：
    python3 <skill-dir>/assets/viz.py spec.json -o charts/demo.png
    from viz import render; render(spec, "charts/demo.png")

spec JSON:
{
  "kind": "bar" | "grouped_bar" | "line" | "donut" | "hbar" | "stats" | "flow",
  "title": "标题", "subtitle": "副标题", "footnote": "来源/说明",
  "width": 1200,
  "height": 0,                      # 0 = 自动
  "data": {...},                    # 见各 kind
  "options": {"valueLabels": true, "yFormat": "number|percent|currency|wan"}
}
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ── 设计 token（OpenIntelligentUI design system, MIT） ─────────────────
# 两套主题共用同一结构；dark 取 OIUI 的 prefers-color-scheme: dark 变量值。
THEMES: dict[str, dict[str, Any]] = {
    "light": {
        "text": "#1a1a1a",
        "text2": "#73726c",
        "text3": "#9c9a92",
        "card": "#ffffff",
        "paper": "#f7f6f3",
        "border": "#e8e6de",
        "grid": "#efeee9",
        "baseline": "#dcd9d1",
        "mix": "#ffffff",
        "ramps": {
            "blue": ("#185FA5", "#E6F1FB"),
            "green": ("#3B6D11", "#EAF3DE"),
            "amber": ("#854F0B", "#FAEEDA"),
            "red": ("#A32D2D", "#FCEBEB"),
            "purple": ("#534AB7", "#EEEDFE"),
            "teal": ("#0F6E56", "#E1F5EE"),
            "coral": ("#993C1D", "#FAECE7"),
            "pink": ("#993556", "#FBEAF0"),
            "gray": ("#5F5E5A", "#F1EFE8"),
        },
    },
    "dark": {
        "text": "#e8e6de",
        "text2": "#9c9a92",
        "text3": "#7d7b75",
        "card": "#1f1f1d",
        "paper": "#131311",
        "border": "#34342f",
        "grid": "#2c2c29",
        "baseline": "#3f3f3a",
        "mix": "#1f1f1d",
        "ramps": {
            "blue": ("#85B7EB", "#0C447C"),
            "green": ("#97C459", "#27500A"),
            "amber": ("#EF9F27", "#633806"),
            "red": ("#F09595", "#791F1F"),
            "purple": ("#AFA9EC", "#3C3489"),
            "teal": ("#5DCAA5", "#085041"),
            "coral": ("#F0997B", "#712B13"),
            "pink": ("#ED93B1", "#72243E"),
            "gray": ("#B4B2A9", "#444441"),
        },
    },
}

TEXT = "#1a1a1a"
TEXT2 = "#73726c"
TEXT3 = "#9c9a92"
CARD = "#ffffff"
PAPER = "#f7f6f3"
BORDER = "#e8e6de"
GRID = "#efeee9"
BASELINE = "#dcd9d1"
MIX = "#ffffff"
RAMPS: dict[str, tuple[str, str]] = THEMES["light"]["ramps"]
CURRENT_THEME = "light"

CYCLE = ["blue", "teal", "coral", "purple", "green", "amber", "pink", "gray"]

S = 3  # 超采样倍数：按 3 倍作画再 LANCZOS 缩小，得到抗锯齿边缘


# ── 主题 ─────────────────────────────────────────────────────────────
def set_theme(name: str) -> str:
    """切换当前主题并返回生效值（light/dark）。"""
    global TEXT, TEXT2, TEXT3, CARD, PAPER, BORDER, GRID, BASELINE, MIX, RAMPS, CURRENT_THEME
    theme = THEMES.get(name) or THEMES["light"]
    TEXT = theme["text"]
    TEXT2 = theme["text2"]
    TEXT3 = theme["text3"]
    CARD = theme["card"]
    PAPER = theme["paper"]
    BORDER = theme["border"]
    GRID = theme["grid"]
    BASELINE = theme["baseline"]
    MIX = theme["mix"]
    RAMPS = theme["ramps"]
    CURRENT_THEME = name if name in THEMES else "light"
    return CURRENT_THEME


def _os_dark() -> bool | None:
    """读 macOS 外观；非 macOS 或读取失败返回 None。"""
    try:
        import subprocess
        out = subprocess.run(
            ["defaults", "read", "-g", "AppleInterfaceStyle"],
            capture_output=True, text=True, timeout=3,
        )
        if out.returncode == 0:
            return "dark" in out.stdout.strip().lower()
    except Exception:
        pass
    return None


def resolve_theme(name: str | None = None) -> str:
    """theme 优先级：显式值 > VIZ_THEME 环境变量 > macOS 外观 > light。"""
    for value in (name, os.environ.get("VIZ_THEME")):
        if value in THEMES:
            return value
    detected = _os_dark()
    return "dark" if detected else "light"


# ── 字体 ─────────────────────────────────────────────────────────────
_FONT_CANDIDATES: list[tuple[str, int]] = [
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),  # W3
    ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 0),
    ("/System/Library/Fonts/Helvetica.ttc", 0),
]
_BOLD_CANDIDATES: list[tuple[str, int]] = [
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 2),  # W6
    ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 0),
    ("/System/Library/Fonts/Helvetica.ttc", 2),
]
_font_cache: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """按设计像素字号取字体（内部乘超采样倍数）。"""
    key = (size, bold)
    if key in _font_cache:
        return _font_cache[key]
    for path, idx in (_BOLD_CANDIDATES if bold else _FONT_CANDIDATES):
        try:
            f = ImageFont.truetype(path, size * S, index=idx)
            _font_cache[key] = f
            return f
        except OSError:
            continue
    f = ImageFont.load_default(size * S)  # 最后兜底
    _font_cache[key] = f
    return f


# ── 基础工具 ─────────────────────────────────────────────────────────
def _rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _mix(a: str, b: str, t: float) -> tuple[int, int, int]:
    ra, rb = _rgb(a), _rgb(b)
    return tuple(round(x + (y - x) * t) for x, y in zip(ra, rb))  # type: ignore[return-value]


def _sc(v: float) -> int:
    return round(v * S)


def text_w(draw: ImageDraw.ImageDraw, s: str, size: int, bold: bool = False) -> float:
    return draw.textlength(s, font=font(size, bold)) / S


def wrap(draw: ImageDraw.ImageDraw, s: str, size: int, max_w: float, bold: bool = False) -> list[str]:
    """按宽度折行，兼顾 CJK（逐字可断）与拉丁单词。"""
    lines: list[str] = []
    cur = ""
    for ch in s:
        trial = cur + ch
        if text_w(draw, trial, size, bold) > max_w and cur:
            lines.append(cur.rstrip())
            cur = "" if ch == " " else ch
        else:
            cur = trial
    if cur:
        lines.append(cur.rstrip())
    return lines or [""]


def draw_text(draw, xy, s, size, color, bold=False, anchor="la"):
    """在 (x,y) 画一行文字，坐标是设计像素。"""
    draw.text((_sc(xy[0]), _sc(xy[1])), s, font=font(size, bold), fill=color, anchor=anchor)


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(
        (_sc(x0), _sc(y0), _sc(x1), _sc(y1)),
        radius=_sc(radius), fill=fill, outline=outline, width=_sc(width) if width else 0,
    )


def vgradient(w: float, h: float, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    """竖直渐变（RGB），尺寸为设计像素。"""
    pw, ph = max(1, int(round(w * S))), max(1, int(round(h * S)))
    top = _rgb(top) if isinstance(top, str) else top
    bottom = _rgb(bottom) if isinstance(bottom, str) else bottom
    col = np.linspace(0, 1, ph)[:, None, None]
    arr = (np.array(top)[None, None, :] * (1 - col) + np.array(bottom)[None, None, :] * col).astype(np.uint8)
    return Image.fromarray(np.repeat(arr, pw, axis=1))


def paste_masked(canvas: Image.Image, patch: Image.Image, box, radius: float):
    """把 patch 贴进圆角区域。"""
    x0, y0, x1, y1 = (_sc(v) for v in box)
    mask = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, x1 - x0, y1 - y0), radius=_sc(radius), fill=255)
    canvas.paste(patch.resize((x1 - x0, y1 - y0), Image.LANCZOS), (x0, y0), mask)


# ── 数值格式 ─────────────────────────────────────────────────────────
def fmt(v: float, kind: str = "number") -> str:
    if kind == "percent":
        return f"{v:.1f}%" if abs(v - round(v)) > 1e-9 else f"{v:.0f}%"
    if kind == "currency":
        return f"¥{v:,.0f}" if abs(v) >= 100 else f"¥{v:,.2f}"
    if kind == "wan":
        return f"{v / 10000:.1f}万"
    if abs(v - round(v)) < 1e-9:
        return f"{v:,.0f}"
    return f"{v:,.1f}"


def nice_max(v: float) -> float:
    if v <= 0:
        return 1.0
    mag = 10 ** math.floor(math.log10(v))
    n = v / mag
    for m in (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if n <= m + 1e-9:
            return m * mag
    return 10 * mag


# ── 卡片骨架 ─────────────────────────────────────────────────────────
def draw_legend(d, card: "Card", items: list[tuple[str, str]], gap: float = 26):
    """右上角图例：items 为 (名称, 颜色)，从右往左排。"""
    y = card.pad + 6
    x = card.x1
    for name, color in reversed(items):
        w = text_w(d, name, 13)
        x -= w
        draw_text(d, (x, y), name, 13, TEXT2)
        x -= 16
        d.ellipse([(_sc(x), _sc(y + 5)), (_sc(x + 10), _sc(y + 15))], fill=color)
        x -= gap


class Card:
    """一张可视化卡片：标题 + 副标题 + 绘图区 + 脚注。"""

    def __init__(self, spec: dict[str, Any], plot_h: int):
        self.spec = spec
        self.W = int(spec.get("width") or 1200)
        self.pad = 44
        self.plot_h = plot_h
        self.header_h = 34 + (26 if spec.get("subtitle") else 0)
        self.foot_h = 34 if spec.get("footnote") else 0
        body_h = self.header_h + 18 + plot_h + (self.foot_h + 18 if self.foot_h else 0)
        self.H = int(spec.get("height") or (self.pad * 2 + body_h))
        self.img = Image.new("RGB", (self.W * S, self.H * S), PAPER)
        self.d = ImageDraw.Draw(self.img)
        # 卡面
        rounded(self.d, (14, 14, self.W - 14, self.H - 14), 20, fill=CARD, outline=BORDER, width=1)

    # 版面坐标
    @property
    def x0(self) -> float:
        return self.pad

    @property
    def x1(self) -> float:
        return self.W - self.pad

    def header(self):
        spec = self.spec
        y = self.pad
        title = spec.get("title")
        if title:
            draw_text(self.d, (self.x0, y), str(title), 26, TEXT, bold=True)
            y += 36
        if spec.get("subtitle"):
            draw_text(self.d, (self.x0, y), str(spec["subtitle"]), 15, TEXT2)
            y += 24
        return self.pad + self.header_h + 18  # 绘图区顶部

    def footer(self):
        spec = self.spec
        if not spec.get("footnote"):
            return
        y = self.H - 14 - 34
        self.d.line([(_sc(self.x0), _sc(y - 12)), (_sc(self.x1), _sc(y - 12))], fill=GRID, width=max(1, _sc(0.5)))
        draw_text(self.d, (self.x0, y + 4), str(spec["footnote"]), 13, TEXT3)

    def save(self, out: Path):
        self.footer()
        final = self.img.resize((self.W, self.H), Image.LANCZOS)
        out.parent.mkdir(parents=True, exist_ok=True)
        final.save(out, "PNG", optimize=True)
        return out


# ── 各图形 ───────────────────────────────────────────────────────────
def render_bar(spec, card: Card):
    data = spec.get("data") or {}
    labels = [str(x) for x in data.get("labels") or []]
    series = data.get("series") or [{"name": "", "values": []}]
    values = [float(v) for v in series[0].get("values") or []]
    if not labels or not values:
        raise ValueError("bar 需要 data.labels 与 data.series[0].values")
    fmt_kind = (spec.get("options") or {}).get("yFormat", "number")
    show_vals = (spec.get("options") or {}).get("valueLabels", True)

    top = card.header()
    plot_top, plot_bottom = top + 16, top + card.plot_h
    axis_w = 56
    left, right = card.x0 + axis_w, card.x1
    ymax = nice_max(max(values) * 1.08)
    d = card.d

    # 网格与 y 轴刻度
    for i in range(5):
        y = plot_bottom - (plot_bottom - plot_top) * i / 4
        d.line([(_sc(left), _sc(y)), (_sc(right), _sc(y))], fill=GRID, width=max(1, _sc(0.4)))
        draw_text(d, (left - 12, y), fmt(ymax * i / 4, fmt_kind), 12, TEXT3, anchor="rm")

    slot = (right - left) / len(labels)
    bw = min(slot * 0.52, 64)
    vmax = max(values)
    for i, (lab, v) in enumerate(zip(labels, values)):
        cx = left + slot * (i + 0.5)
        h = (plot_bottom - plot_top) * (v / ymax)
        x0, x1 = cx - bw / 2, cx + bw / 2
        y0 = plot_bottom - h
        # 数值条：最大者实色，其余淡染
        if v == vmax:
            patch = vgradient(bw, max(2, h), _rgb(RAMPS["blue"][0]), _mix(RAMPS["blue"][0], MIX, 0.28))
        else:
            patch = vgradient(bw, max(2, h), _mix(RAMPS["blue"][1], RAMPS["blue"][0], 0.45), RAMPS["blue"][1])
        paste_masked(card.img, patch, (x0, y0, x1, plot_bottom), min(7, bw / 3))
        if show_vals and len(labels) <= 12:
            draw_text(d, (cx, y0 - 10), fmt(v, fmt_kind), 13, TEXT, bold=True, anchor="mb")
        wrap_lab = wrap(d, lab, 13, slot * 0.92)
        for j, ln in enumerate(wrap_lab[:2]):
            draw_text(d, (cx, plot_bottom + 12 + j * 17), ln, 13, TEXT2, anchor="ma")


def render_grouped_bar(spec, card: Card):
    data = spec.get("data") or {}
    labels = [str(x) for x in data.get("labels") or []]
    ser = data.get("series") or []
    if not labels or not ser:
        raise ValueError("grouped_bar 需要 labels 与 series")
    fmt_kind = (spec.get("options") or {}).get("yFormat", "number")
    top = card.header()
    plot_top, plot_bottom = top + 16, top + card.plot_h
    axis_w = 56
    left, right = card.x0 + axis_w, card.x1
    ymax = nice_max(max(max(float(v) for v in s.get("values") or [0]) for s in ser) * 1.08)
    d = card.d

    for i in range(5):
        y = plot_bottom - (plot_bottom - plot_top) * i / 4
        d.line([(_sc(left), _sc(y)), (_sc(right), _sc(y))], fill=GRID, width=max(1, _sc(0.4)))
        draw_text(d, (left - 12, y), fmt(ymax * i / 4, fmt_kind), 12, TEXT3, anchor="rm")

    slot = (right - left) / len(labels)
    n = len(ser)
    bw = min(slot * 0.72 / n, 34)
    for i, lab in enumerate(labels):
        cx = left + slot * (i + 0.5)
        for j, s in enumerate(ser):
            v = float((s.get("values") or [0])[i]) if i < len(s.get("values") or []) else 0.0
            color = RAMPS[s.get("color") or CYCLE[j % len(CYCLE)]][0]
            h = (plot_bottom - plot_top) * (v / ymax)
            x0 = cx - (n * bw) / 2 + j * bw
            x1 = x0 + bw - 4
            y0 = plot_bottom - h
            patch = vgradient(max(2, int(x1 - x0)), max(2, h), _rgb(color), _mix(color, MIX, 0.45))
            paste_masked(card.img, patch, (x0, y0, x1, plot_bottom), min(6, bw / 3))
        wrap_lab = wrap(d, lab, 13, slot * 0.92)
        for k, ln in enumerate(wrap_lab[:2]):
            draw_text(d, (cx, plot_bottom + 12 + k * 17), ln, 13, TEXT2, anchor="ma")

    draw_legend(d, card, [
        (str(s.get("name") or f"系列{j + 1}"), RAMPS[s.get("color") or CYCLE[j % len(CYCLE)]][0])
        for j, s in enumerate(ser)
    ])


def _catmull(pts: list[tuple[float, float]], samples: int = 24) -> list[tuple[float, float]]:
    if len(pts) < 3:
        return pts
    p = [pts[0]] + pts + [pts[-1]]
    out: list[tuple[float, float]] = []
    for i in range(len(p) - 3):
        p0, p1, p2, p3 = p[i], p[i + 1], p[i + 2], p[i + 3]
        for k in range(samples):
            t = k / samples
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    out.append(pts[-1])
    return out


def render_line(spec, card: Card):
    data = spec.get("data") or {}
    labels = [str(x) for x in data.get("labels") or []]
    ser = data.get("series") or []
    if not labels or not ser:
        raise ValueError("line 需要 labels 与 series")
    opts = spec.get("options") or {}
    fmt_kind = opts.get("yFormat", "number")
    multi = len(ser) > 1
    top = card.header()
    plot_top, plot_bottom = top + 20, top + card.plot_h
    axis_w = 56
    left, right = card.x0 + axis_w, card.x1
    allv = [float(v) for s in ser for v in (s.get("values") or [])]
    ymax = nice_max(max(allv) * 1.1)
    d = card.d

    for i in range(5):
        y = plot_bottom - (plot_bottom - plot_top) * i / 4
        d.line([(_sc(left), _sc(y)), (_sc(right), _sc(y))], fill=GRID, width=max(1, _sc(0.4)))
        draw_text(d, (left - 12, y), fmt(ymax * i / 4, fmt_kind), 12, TEXT3, anchor="rm")
    d.line([(_sc(left), _sc(plot_bottom)), (_sc(right), _sc(plot_bottom))], fill=BASELINE, width=max(1, _sc(0.8)))

    step = (right - left) / max(1, len(labels) - 1)
    geom: list[tuple[str, str, list[tuple[float, float]]]] = []

    # 第一遍：单序列才画面积
    if not multi:
        s0 = ser[0]
        color = RAMPS[s0.get("color") or "blue"][0]
        vals = [float(v) for v in (s0.get("values") or [])]
        pts = [(left + step * i, plot_bottom - (plot_bottom - plot_top) * (v / ymax)) for i, v in enumerate(vals)]
        smooth = _catmull(pts)
        if len(pts) > 1:
            area = Image.new("RGBA", card.img.size, (0, 0, 0, 0))
            ad = ImageDraw.Draw(area)
            poly = [(_sc(x), _sc(y)) for x, y in smooth] + [(_sc(pts[-1][0]), _sc(plot_bottom)), (_sc(pts[0][0]), _sc(plot_bottom))]
            ad.polygon(poly, fill=_rgb(color) + (52,))
            card.img.paste(area, (0, 0), area)

    # 第二遍：线条 + 点
    last_labels: list[tuple[float, float, str, str]] = []
    for j, s0 in enumerate(ser):
        vals = [float(v) for v in (s0.get("values") or [])]
        color = RAMPS[s0.get("color") or CYCLE[j % len(CYCLE)]][0]
        pts = [(left + step * i, plot_bottom - (plot_bottom - plot_top) * (v / ymax)) for i, v in enumerate(vals)]
        smooth = _catmull(pts)
        if len(pts) > 1:
            d.line([(_sc(x), _sc(y)) for x, y in smooth], fill=color, width=max(2, _sc(2.4)), joint="curve")
        for (x, y) in pts:
            r = 5
            d.ellipse([(_sc(x - r), _sc(y - r)), (_sc(x + r), _sc(y + r))], fill=CARD, outline=color, width=max(2, _sc(2.4)))
        geom.append((s0.get("color") or CYCLE[j % len(CYCLE)], color, pts))
        if vals and (multi or len(vals) <= 10):
            last_labels.append((pts[-1][0], pts[-1][1], fmt(vals[-1], fmt_kind), color))

    # 末点数值（多序列时只标最后一个点，做简单避让）
    if multi:
        last_labels.sort(key=lambda t: t[1])
        placed: list[float] = []
        for x, y, val, color in last_labels:
            ly = y - 14
            while any(abs(ly - q) < 18 for q in placed):
                ly -= 18
            placed.append(ly)
            draw_text(d, (x, ly), val, 13, color, bold=True, anchor="mb")
    else:
        for x, y, val, color in last_labels:
            for i, (px, py) in enumerate(geom[0][2]):
                pass
        s0 = ser[0]
        color = RAMPS[s0.get("color") or "blue"][0]
        for (x, y) in geom[0][2]:
            draw_text(d, (x, y - 14), fmt(float((s0.get("values") or [0])[geom[0][2].index((x, y))]), fmt_kind), 12, color, bold=True, anchor="mb")

    for i, lab in enumerate(labels):
        draw_text(d, (left + step * i, plot_bottom + 12), lab, 13, TEXT2, anchor="ma")

    if multi:
        draw_legend(d, card, [
            (str(s0.get("name") or f"系列{j + 1}"), RAMPS[s0.get("color") or CYCLE[j % len(CYCLE)]][0])
            for j, s0 in enumerate(ser)
        ])


def render_hbar(spec, card: Card):
    data = spec.get("data") or {}
    items = data.get("items") or [{"label": "", "value": 0}]
    fmt_kind = (spec.get("options") or {}).get("yFormat", "number")
    top = card.header()
    d = card.d
    n = len(items)
    row_h = min(46, card.plot_h / max(1, n))
    label_w = min(220, max(text_w(d, str(it.get("label", "")), 14) for it in items) + 16)
    left = card.x0 + label_w
    right = card.x1 - 86
    vmax = max(float(it.get("value", 0)) for it in items) or 1
    for i, it in enumerate(items):
        y = top + row_h * i + row_h / 2
        val = float(it.get("value", 0))
        color = RAMPS[it.get("color") or CYCLE[i % len(CYCLE)]][0]
        draw_text(d, (card.x0, y), str(it.get("label", "")), 14, TEXT, anchor="lm")
        bw = (right - left) * (val / vmax)
        patch = vgradient(max(2, int(bw)), 20, _rgb(color), _mix(color, MIX, 0.4))
        paste_masked(card.img, patch, (left, y - 10, left + bw, y + 10), 6)
        draw_text(d, (right + 12, y), fmt(val, fmt_kind), 14, TEXT, bold=True, anchor="lm")


def render_donut(spec, card: Card):
    data = spec.get("data") or {}
    items = data.get("items") or []
    if not items:
        raise ValueError("donut 需要 data.items")
    top = card.header()
    d = card.d
    total = sum(float(it.get("value", 0)) for it in items) or 1
    area_h = card.plot_h
    r = area_h * 0.44
    ring = r * 0.34
    legend_w = 360.0
    group_w = 2 * r + 56 + legend_w
    start_x = card.x0 + (card.x1 - card.x0 - group_w) / 2
    cx = start_x + r
    cy = top + area_h / 2
    start = -90.0
    for i, it in enumerate(items):
        val = float(it.get("value", 0))
        color = RAMPS[it.get("color") or CYCLE[i % len(CYCLE)]][0]
        sweep = 360 * val / total
        if sweep <= 0:
            continue
        gap = min(2.0, sweep * 0.15)
        d.arc(
            [(_sc(cx - r), _sc(cy - r)), (_sc(cx + r), _sc(cy + r))],
            start=start + gap, end=start + sweep - gap,
            fill=color, width=_sc(ring),
        )
        start += sweep
    # 中心文字
    center_label = (spec.get("options") or {}).get("centerLabel", "合计")
    center_value = (spec.get("options") or {}).get("centerValue") or fmt(total, "number")
    draw_text(d, (cx, cy - 10), str(center_value), 34, TEXT, bold=True, anchor="mm")
    draw_text(d, (cx, cy + 26), str(center_label), 14, TEXT2, anchor="mm")

    # 图例
    lx = start_x + 2 * r + 56
    ly = top + area_h / 2 - (len(items) * 34) / 2 + 4
    for i, it in enumerate(items):
        color = RAMPS[it.get("color") or CYCLE[i % len(CYCLE)]][0]
        val = float(it.get("value", 0))
        d.rounded_rectangle([(_sc(lx), _sc(ly + 4)), (_sc(lx + 12), _sc(ly + 16))], radius=_sc(3), fill=color)
        draw_text(d, (lx + 22, ly), str(it.get("label", "")), 14, TEXT)
        pct = f"{val / total * 100:.1f}%"
        draw_text(d, (lx + legend_w, ly), pct, 14, TEXT2, bold=True, anchor="ra")
        ly += 34


def render_stats(spec, card: Card):
    data = spec.get("data") or {}
    items = data.get("items") or []
    if not items:
        raise ValueError("stats 需要 data.items")
    top = card.header()
    d = card.d
    n = len(items)
    gap = 18
    w = (card.x1 - card.x0 - gap * (n - 1)) / n
    h = min(150, card.plot_h)
    for i, it in enumerate(items):
        x0 = card.x0 + i * (w + gap)
        rounded(d, (x0, top, x0 + w, top + h), 14, fill=PAPER, outline=BORDER, width=1)
        draw_text(d, (x0 + 20, top + 20), str(it.get("label", "")), 14, TEXT2)
        draw_text(d, (x0 + 20, top + 48), str(it.get("value", "")), 32, TEXT, bold=True)
        delta = it.get("delta")
        if delta is not None:
            tone = it.get("tone") or ("good" if str(delta).startswith("+") else "bad" if str(delta).startswith("-") else "flat")
            color = {"good": RAMPS["green"][0], "bad": RAMPS["red"][0], "flat": TEXT2}[tone]
            arrow = "▲" if tone == "good" else "▼" if tone == "bad" else "•"
            draw_text(d, (x0 + 20, top + 96), f"{arrow} {delta}", 14, color, bold=True)
        if it.get("note"):
            draw_text(d, (x0 + 20, top + 122), str(it["note"]), 12, TEXT3)


def render_flow(spec, card: Card):
    data = spec.get("data") or {}
    steps = data.get("steps") or []
    if not steps:
        raise ValueError("flow 需要 data.steps")
    top = card.header()
    d = card.d
    direction = (spec.get("options") or {}).get("direction", "horizontal")
    n = len(steps)

    if direction == "horizontal" and n <= 4:
        gap = 46
        w = (card.x1 - card.x0 - gap * (n - 1)) / n
        h = card.plot_h
        for i, st in enumerate(steps):
            x0 = card.x0 + i * (w + gap)
            ramp = RAMPS[st.get("color") or CYCLE[i % len(CYCLE)]]
            rounded(d, (x0, top, x0 + w, top + h), 16, fill=ramp[1], outline=ramp[0], width=1)
            # 序号徽标
            d.ellipse([(_sc(x0 + 18), _sc(top + 18)), (_sc(x0 + 44), _sc(top + 44))], fill=ramp[0])
            draw_text(d, (x0 + 31, top + 31), str(i + 1), 16, MIX, bold=True, anchor="mm")
            lines = wrap(d, str(st.get("label", "")), 18, w - 44)
            y = top + 64
            for ln in lines[:2]:
                draw_text(d, (x0 + 18, y), ln, 18, TEXT, bold=True)
                y += 26
            if st.get("detail"):
                for ln in wrap(d, str(st["detail"]), 13, w - 36)[:3]:
                    draw_text(d, (x0 + 18, y + 6), ln, 13, TEXT2)
                    y += 19
            # 箭头
            if i < n - 1:
                ax0, ay = x0 + w + 8, top + h / 2
                ax1 = x0 + w + gap - 8
                d.line([(_sc(ax0), _sc(ay)), (_sc(ax1 - 12), _sc(ay))], fill=TEXT3, width=_sc(2))
                d.polygon(
                    [(_sc(ax1 - 12), _sc(ay - 6)), (_sc(ax1), _sc(ay)), (_sc(ax1 - 12), _sc(ay + 6))],
                    fill=TEXT3,
                )
    else:  # 纵向
        row_h = card.plot_h / max(1, n)
        for i, st in enumerate(steps):
            y = top + row_h * i + row_h / 2
            ramp = RAMPS[st.get("color") or CYCLE[i % len(CYCLE)]]
            d.ellipse([(_sc(card.x0), _sc(y - 15)), (_sc(card.x0 + 30), _sc(y + 15))], fill=ramp[0])
            draw_text(d, (card.x0 + 15, y), str(i + 1), 14, MIX, bold=True, anchor="mm")
            if i < n - 1:
                d.line([(_sc(card.x0 + 15), _sc(y + 18)), (_sc(card.x0 + 15), _sc(y + row_h - 18))], fill=BORDER, width=_sc(2))
            draw_text(d, (card.x0 + 48, y - 10), str(st.get("label", "")), 17, TEXT, bold=True)
            if st.get("detail"):
                draw_text(d, (card.x0 + 48, y + 12), str(st["detail"]), 13, TEXT2)


RENDERERS = {
    "bar": (render_bar, 330),
    "grouped_bar": (render_grouped_bar, 360),
    "line": (render_line, 340),
    "hbar": (render_hbar, 300),
    "donut": (render_donut, 300),
    "stats": (render_stats, 150),
    "flow": (render_flow, 185),
}


def render(spec: dict[str, Any], out: str | Path, theme: str | None = None) -> Path:
    """渲染 spec 为 PNG。theme 缺省时按 spec.theme → VIZ_THEME → 系统外观解析。"""
    set_theme(resolve_theme(theme if theme is not None else spec.get("theme")))
    kind = spec.get("kind", "bar")
    if kind not in RENDERERS:
        raise ValueError(f"未知 kind: {kind}，可选 {sorted(RENDERERS)}")
    fn, plot_h = RENDERERS[kind]
    card = Card(spec, int(spec.get("plotHeight") or plot_h))
    fn(spec, card)
    return card.save(Path(out))


def main(argv: Sequence[str]) -> int:
    import argparse

    if len(argv) < 2:
        print(__doc__)
        return 2
    ap = argparse.ArgumentParser(prog="viz.py", description="把 spec JSON 渲染成 PNG 卡片")
    ap.add_argument("spec", help="spec JSON 路径")
    ap.add_argument("-o", "--out", help="输出 PNG 路径（默认与 spec 同目录）")
    ap.add_argument("--theme", choices=["auto", "light", "dark"], default=None,
                    help="配色主题：auto 按系统外观判断（默认），或强制 light/dark")
    a = ap.parse_args(argv[1:])
    spec_path = Path(a.spec)
    out = Path(a.out) if a.out else spec_path.with_suffix(".png")
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    theme = a.theme or spec.get("theme")
    path = render(spec, out, theme)
    print(f"{path}  ({CURRENT_THEME})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
