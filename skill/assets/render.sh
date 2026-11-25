#!/bin/sh
# render.sh — 渲染一个 spec JSON 为 PNG 卡片（viz.py 与本脚本同目录）。
# 用法：sh render.sh <spec.json> [out.png] [viz.py 参数…]
#   SKILL=<本技能目录>/assets
#   sh "$SKILL/render.sh" "$SKILL/examples/bar.json" charts/bar.png
#   sh "$SKILL/render.sh" "$SKILL/examples/bar.json" charts/bar-dark.png --theme dark
# 主题：默认 auto（跟随系统外观）；也可 VIZ_THEME=dark sh render.sh …
# 注意：SPEC 与 OUT 相对当前工作目录；输出省略时写在 spec 同目录同名 .png。
set -e
SPEC=${1:?用法: sh render.sh <spec.json> [out.png] [--theme light|dark]}
shift
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

OUT=""
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  OUT=$1
  shift
fi

find_py() {
  for c in "${DSH_PYTHON:-}" "$HOME"/.dsh/dsh-runtimes/*/dependencies/python/bin/python3 python3; do
    [ -n "$c" ] || continue
    if [ -x "$c" ] && "$c" -c 'import PIL, numpy' 2>/dev/null; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

PY=$(find_py) || {
  echo "render.sh: 找不到带 Pillow + numpy 的 Python（先用 load_workspace_dependencies 取路径）" >&2
  exit 1
}

if [ -n "$OUT" ]; then
  exec "$PY" "$HERE/viz.py" "$SPEC" -o "$OUT" "$@"
else
  exec "$PY" "$HERE/viz.py" "$SPEC" "$@"
fi
