/**
 * Visual answers — Client half.
 *
 * Registers one `conversation.chat.markdown.fence` layer keyed `visual`, so a
 * fenced block whose language is `visual` renders as an inline SVG card at the
 * conversation's full width. Streamed fences keep the plain code block until
 * the JSON settles; a parse or render failure falls back to the same code
 * block, which the Harness keeps as this layer's `children`.
 *
 * The SVG is drawn in a 1000-unit viewBox and scaled by CSS, so it stays sharp
 * at any device pixel ratio. Theme follows the host: text, surfaces, and
 * borders use `--dsw-alias-*` tokens, and the series palette swaps on
 * `body[data-ds-dark-theme]`.
 */
window.__ModuleLoader__.load({
  id: '@tigermaxxin/dsh-visual-answers',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /* ── 常量与工具 ─────────────────────────────────────────────── */
    const W = 1000
    const M = 30
    const NAMES = { blue: 1, teal: 2, coral: 3, purple: 4, green: 5, amber: 6, pink: 7, gray: 8, red: 9 }
    const CYCLE = [1, 2, 3, 4, 5, 6, 7, 8, 9]

    const esc = (value) =>
      String(value).replace(/[&<>"']/gu, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])

    const num = (value) => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }

    const fmt = (value, kind) => {
      const v = num(value)
      if (kind === 'percent') return `${Math.abs(v - Math.round(v)) < 1e-9 ? v.toFixed(0) : v.toFixed(1)}%`
      if (kind === 'currency') return `¥${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)}`
      if (kind === 'wan') return `${(v / 10000).toFixed(1)}万`
      return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1)
    }

    const niceMax = (value) => {
      if (!(value > 0)) return 1
      const magnitude = 10 ** Math.floor(Math.log10(value))
      const scaled = value / magnitude
      for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
        if (scaled <= m + 1e-9) return m * magnitude
      }
      return 10 * magnitude
    }

    /* ── 文本测量：用 canvas 量真实宽度，避免按字符数截断把 visual-html 拆成两行 ── */
    let measureCtx = null
    const measureCache = new Map()

    const fontFamily = () => {
      try {
        const family = getComputedStyle(document.body).fontFamily
        return family === '' ? 'system-ui' : family
      } catch {
        return 'system-ui'
      }
    }

    const measure = (value, size) => {
      const source = String(value ?? '')
      const key = `${size}|${source}`
      const cached = measureCache.get(key)
      if (cached !== undefined) return cached
      let width = 0
      try {
        if (measureCtx === null) measureCtx = document.createElement('canvas').getContext('2d')
        if (measureCtx !== null) {
          measureCtx.font = `${size}px ${fontFamily()}`
          width = measureCtx.measureText(source).width
        }
      } catch {
        width = 0
      }
      if (!(width > 0)) {
        // 无 canvas 时退化为字符估算：CJK 按 1 个字号，拉丁按 0.55 个字号
        width = [...source].reduce((sum, ch) => sum + size * (/[\u3000-\u9fff\uff00-\uffef]/u.test(ch) ? 1 : 0.55), 0)
      }
      if (measureCache.size > 4000) measureCache.clear()
      measureCache.set(key, width)
      return width
    }

    /** 切分成可断行单元：拉丁词整体、CJK 逐字、空白单独。 */
    const tokenize = (source) => source.match(/[≥≤<>±=~≈]?[A-Za-z0-9][A-Za-z0-9@._+\-/]*|\s+|./gu) ?? []

    /** 按真实宽度折行（超长单词才按字符硬断），最多 `lines` 行，多余加省略号。 */
    const wrap = (value, size, width, lines = 2) => {
      const source = String(value ?? '')
      if (source === '') return ['']
      const units = tokenize(source)
      const out = []
      let current = ''
      let index = 0
      while (index < units.length && out.length < lines) {
        const unit = units[index]
        const trial = current + unit
        if (current.trim() !== '' && measure(trial, size) > width) {
          out.push(current.trimEnd())
          current = unit.trimStart()
          if (current === '') current = ''
        } else if (current === '' && measure(unit, size) > width) {
          // 单个超长词：按字符硬断
          let piece = ''
          for (const ch of [...unit]) {
            if (piece !== '' && measure(piece + ch, size) > width) {
              out.push(piece)
              piece = ch
            } else {
              piece += ch
            }
          }
          current = piece
        } else {
          current = trial
        }
        index += 1
      }
      if (current !== '' && out.length < lines) out.push(current.trimEnd())
      if (index < units.length && out.length === lines) {
        // 还有剩余内容：给最后一行加省略号
        let last = out[lines - 1]
        while (last !== '' && measure(`${last}…`, size) > width) last = last.slice(0, -1)
        out[lines - 1] = `${last}…`
      }
      return out
    }

    /** 单行截断并加省略号。 */
    const clip = (value, size, width) => {
      const source = String(value ?? '')
      if (measure(source, size) <= width) return source
      let text = source
      while (text !== '' && measure(`${text}…`, size) > width) text = text.slice(0, -1)
      return `${text}…`
    }

    const varOf = (name, index) => `var(--vz-${NAMES[name] ?? CYCLE[index % CYCLE.length]})`
    const softOf = (name, index) => `var(--vz-${NAMES[name] ?? CYCLE[index % CYCLE.length]}-soft)`

    const text = (x, y, content, size, color, extra = '') =>
      `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${extra}>${esc(content)}</text>`

    const gridLines = (x0, x1, yTop, yBottom, ymax, kind) => {
      let markup = ''
      for (let i = 0; i <= 4; i += 1) {
        const y = yBottom - ((yBottom - yTop) * i) / 4
        markup += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="var(--vz-grid)" stroke-width="1"/>`
        markup += text(x0 - 10, y + 4, fmt((ymax * i) / 4, kind), 11, 'var(--vz-text3)', ' text-anchor="end"')
      }
      return markup
    }

    const legend = (items) => {
      let x = W - M
      let markup = ''
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i]
        const label = String(item.label ?? '')
        const width = label.length * 12 + 18
        x -= width
        markup += `<circle cx="${x + 5}" cy="${M + 5}" r="5" fill="${item.color}"/>`
        markup += text(x + 16, M + 9, label, 12, 'var(--vz-text2)')
        x -= 18
      }
      return markup
    }

    /* ── 各图形（返回 viewBox 内 SVG 片段） ─────────────────────── */

    const barBody = (spec) => {
      const series = spec.data?.series?.[0] ?? { values: [] }
      const labels = spec.data?.labels ?? []
      const values = (series.values ?? []).map(num)
      if (labels.length === 0 || values.length === 0) return null
      const kind = spec.options?.yFormat ?? 'number'
      const x0 = M + 54
      const x1 = W - M
      const yTop = M + 74
      const yBottom = yTop + 210
      const ymax = niceMax(Math.max(...values) * 1.08) || 1
      const slot = (x1 - x0) / labels.length
      const bw = Math.min(slot * 0.5, 58)
      const vmax = Math.max(...values)
      let body = gridLines(x0, x1, yTop, yBottom, ymax, kind)
      body += `<line x1="${x0}" y1="${yBottom}" x2="${x1}" y2="${yBottom}" stroke="var(--vz-baseline)" stroke-width="1"/>`
      labels.forEach((label, i) => {
        const value = values[i] ?? 0
        const cx = x0 + slot * (i + 0.5)
        const bh = ((yBottom - yTop) * value) / ymax
        const isMax = value === vmax
        const dimmed = spec.options?.highlight === 'max' && !isMax
        body += `<rect x="${cx - bw / 2}" y="${yBottom - bh}" width="${bw}" height="${bh}" rx="${Math.min(8, bw / 2)}" fill="${varOf(series.color, i)}"${dimmed ? ' fill-opacity="0.4"' : ''}/>`
        if (labels.length <= 12) body += text(cx, yBottom - bh - 10, fmt(value, kind), 13, 'var(--vz-text)', ' text-anchor="middle" font-weight="600"')
        body += text(cx, yBottom + 24, clip(label, 12, slot), 12, 'var(--vz-text2)', ' text-anchor="middle"')
      })
      return { body, height: yBottom + 52 }
    }

    const groupedBarBody = (spec) => {
      const series = spec.data?.series ?? []
      const labels = spec.data?.labels ?? []
      if (series.length === 0 || labels.length === 0) return null
      const kind = spec.options?.yFormat ?? 'number'
      const x0 = M + 54
      const x1 = W - M
      const yTop = M + 96
      const yBottom = yTop + 196
      const all = series.flatMap((s) => (s.values ?? []).map(num))
      const ymax = niceMax(Math.max(...all) * 1.08) || 1
      const slot = (x1 - x0) / labels.length
      const bw = Math.min((slot * 0.68) / series.length, 34)
      let body = gridLines(x0, x1, yTop, yBottom, ymax, kind)
      body += `<line x1="${x0}" y1="${yBottom}" x2="${x1}" y2="${yBottom}" stroke="var(--vz-baseline)" stroke-width="1"/>`
      labels.forEach((label, i) => {
        const cx = x0 + slot * (i + 0.5)
        series.forEach((item, j) => {
          const value = num((item.values ?? [])[i])
          const bh = ((yBottom - yTop) * value) / ymax
          const bx = cx - (series.length * bw) / 2 + j * bw
          body += `<rect x="${bx}" y="${yBottom - bh}" width="${bw - 3}" height="${bh}" rx="4" fill="${varOf(item.color, j)}"/>`
        })
        body += text(cx, yBottom + 24, clip(label, 12, slot), 12, 'var(--vz-text2)', ' text-anchor="middle"')
      })
      body += legend(series.map((item, j) => ({ label: item.name ?? `系列${j + 1}`, color: varOf(item.color, j) })))
      return { body, height: yBottom + 52 }
    }

    const lineBody = (spec) => {
      const series = spec.data?.series ?? []
      const labels = spec.data?.labels ?? []
      if (series.length === 0 || labels.length < 2) return null
      const kind = spec.options?.yFormat ?? 'number'
      const x0 = M + 54
      const x1 = W - M
      const yTop = M + 96
      const yBottom = yTop + 200
      const all = series.flatMap((s) => (s.values ?? []).map(num))
      const ymax = niceMax(Math.max(...all) * 1.1) || 1
      const step = (x1 - x0) / (labels.length - 1)
      const pointsOf = (values) =>
        values.map((value, i) => [x0 + step * i, yBottom - ((yBottom - yTop) * value) / ymax])

      /** Catmull-Rom 转三次贝塞尔路径。 */
      const smoothPath = (points) => {
        if (points.length < 3) return `M${points.map((p) => p.join(' ')).join(' L')}`
        let d = `M${points[0][0]} ${points[0][1]}`
        for (let i = 0; i < points.length - 1; i += 1) {
          const p0 = points[i - 1] ?? points[i]
          const p1 = points[i]
          const p2 = points[i + 1]
          const p3 = points[i + 2] ?? p2
          const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
          const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
          d += ` C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`
        }
        return d
      }

      let body = gridLines(x0, x1, yTop, yBottom, ymax, kind)
      body += `<line x1="${x0}" y1="${yBottom}" x2="${x1}" y2="${yBottom}" stroke="var(--vz-baseline)" stroke-width="1"/>`

      if (series.length === 1) {
        const points = pointsOf((series[0].values ?? []).map(num))
        const color = varOf(series[0].color, 0)
        body += `<path d="${smoothPath(points)} L${points.at(-1)[0]} ${yBottom} L${points[0][0]} ${yBottom} Z" fill="${color}" fill-opacity="0.12" stroke="none"/>`
      }
      series.forEach((item, j) => {
        const values = (item.values ?? []).map(num)
        const points = pointsOf(values)
        const color = varOf(item.color, j)
        body += `<path d="${smoothPath(points)}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`
        for (const [px, py] of points) {
          body += `<circle cx="${px}" cy="${py}" r="4.5" fill="var(--vz-card)" stroke="${color}" stroke-width="2.2"/>`
        }
        if (j === 0) {
          const last = points.at(-1)
          body += text(last[0], last[1] - 14, fmt(values.at(-1), kind), 12, color, ' text-anchor="end" font-weight="600"')
        }
      })
      labels.forEach((label, i) => {
        body += text(x0 + step * i, yBottom + 24, clip(label, 12, step * 1.6), 12, 'var(--vz-text2)', ' text-anchor="middle"')
      })
      if (series.length > 1) body += legend(series.map((item, j) => ({ label: item.name ?? `系列${j + 1}`, color: varOf(item.color, j) })))
      return { body, height: yBottom + 52 }
    }

    const hbarBody = (spec) => {
      const items = spec.data?.items ?? []
      if (items.length === 0) return null
      const kind = spec.options?.yFormat ?? 'number'
      const x0 = M + 190
      const x1 = W - M - 74
      const rowH = Math.min(40, 240 / items.length)
      const vmax = Math.max(...items.map((item) => num(item.value))) || 1
      let body = ''
      items.forEach((item, i) => {
        const y = M + 78 + rowH * i + rowH / 2
        const value = num(item.value)
        const bw = Math.max(3, (x1 - x0) * (value / vmax))
        const color = varOf(item.color, i)
        body += text(M, y + 4, clip(item.label, 13, 176), 13, 'var(--vz-text)')
        body += `<rect x="${x0}" y="${y - 9}" width="${bw}" height="18" rx="5" fill="${color}" fill-opacity="0.85"/>`
        body += text(x1 + 12, y + 4, fmt(value, kind), 13, 'var(--vz-text)', ' font-weight="600"')
      })
      return { body, height: M + 78 + rowH * items.length + 26 }
    }

    const donutBody = (spec) => {
      const items = spec.data?.items ?? []
      if (items.length === 0) return null
      const total = items.reduce((sum, item) => sum + num(item.value), 0) || 1
      const cx = 250
      const cy = 190
      const r = 108
      const ring = 34
      const polar = (radius, angle) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
      let body = ''
      let angle = -Math.PI / 2
      items.forEach((item, i) => {
        const sweep = (Math.PI * 2 * num(item.value)) / total
        const gap = Math.min(0.03, sweep * 0.12)
        if (sweep > 0.001) {
          const start = angle + gap
          const end = angle + sweep - gap
          const outer = [polar(r, start), polar(r, end)]
          const inner = [polar(r - ring, end), polar(r - ring, start)]
          const large = end - start > Math.PI ? 1 : 0
          body += `<path d="M${outer[0][0]} ${outer[0][1]} A${r} ${r} 0 ${large} 1 ${outer[1][0]} ${outer[1][1]} L${inner[0][0]} ${inner[0][1]} A${r - ring} ${r - ring} 0 ${large} 0 ${inner[1][0]} ${inner[1][1]} Z" fill="${varOf(item.color, i)}"/>`
        }
        angle += sweep
      })
      const centerValue = spec.options?.centerValue ?? fmt(total, 'number')
      const centerLabel = spec.options?.centerLabel ?? '合计'
      body += text(cx, cy + 4, String(centerValue), 30, 'var(--vz-text)', ' text-anchor="middle" font-weight="700"')
      body += text(cx, cy + 30, String(centerLabel), 13, 'var(--vz-text2)', ' text-anchor="middle"')
      const lx = 430
      const top = cy - (items.length * 40) / 2
      items.forEach((item, i) => {
        const y = top + i * 40
        const pct = ((num(item.value) / total) * 100).toFixed(1)
        body += `<rect x="${lx}" y="${y - 8}" width="11" height="11" rx="3" fill="${varOf(item.color, i)}"/>`
        body += text(lx + 20, y + 2, clip(item.label, 14, 220), 14, 'var(--vz-text)')
        body += text(W - M, y + 2, `${pct}%`, 14, 'var(--vz-text2)', ' text-anchor="end" font-weight="600"')
      })
      return { body, height: 300 }
    }

    const statsBody = (spec) => {
      const items = spec.data?.items ?? []
      if (items.length === 0) return null
      const gap = 16
      const width = (W - M * 2 - gap * (items.length - 1)) / items.length
      const top = M + 76
      const height = 128
      let body = ''
      items.forEach((item, i) => {
        const x = M + i * (width + gap)
        body += `<rect x="${x}" y="${top}" width="${width}" height="${height}" rx="12" fill="var(--vz-paper)" stroke="var(--vz-border)"/>`
        body += text(x + 18, top + 28, clip(item.label, 13, width - 36), 13, 'var(--vz-text2)')
        body += text(x + 18, top + 64, clip(item.value, 26, width - 36), 26, 'var(--vz-text)', ' font-weight="700"')
        const delta = item.delta == null ? '' : String(item.delta)
        const tone = item.tone ?? (delta.startsWith('+') ? 'good' : delta.startsWith('-') ? 'bad' : 'flat')
        if (delta) {
          const color = tone === 'good' ? 'var(--vz-5)' : tone === 'bad' ? 'var(--vz-9)' : 'var(--vz-text2)'
          const arrow = tone === 'good' ? '▲' : tone === 'bad' ? '▼' : '•'
          body += text(x + 18, top + 92, `${arrow} ${delta}`, 13, color, ' font-weight="600"')
        }
        if (item.note) body += text(x + 18, top + 112, clip(item.note, 12, width - 36), 12, 'var(--vz-text3)')
      })
      return { body, height: top + height + 28 }
    }

    const flowBody = (spec) => {
      const steps = spec.data?.steps ?? []
      if (steps.length === 0) return null
      const top = M + 76

      if (steps.length > 4) {
        // 纵排：左侧序号 + 标题/说明，按真实宽度截断
        const rowH = 62
        let body = ''
        steps.forEach((step, i) => {
          const y = top + i * rowH
          body += `<circle cx="${M + 15}" cy="${y + 15}" r="15" fill="${varOf(step.color, i)}"/>`
          body += text(M + 15, y + 20, String(i + 1), 14, 'var(--vz-card)', ' text-anchor="middle" font-weight="700"')
          if (i < steps.length - 1) body += `<line x1="${M + 15}" y1="${y + 33}" x2="${M + 15}" y2="${y + rowH + 1}" stroke="var(--vz-border)" stroke-width="2"/>`
          body += text(M + 46, y + 12, clip(step.label, 16, 540), 16, 'var(--vz-text)', ' font-weight="600"')
          if (step.detail) body += text(M + 46, y + 36, clip(step.detail, 12, 760), 12, 'var(--vz-text2)')
        })
        return { body, height: top + rowH * steps.length + 18 }
      }

      // 横排：先按真实宽度折行，再按最长内容算统一的盒子高度
      const gap = 46
      const width = (W - M * 2 - gap * (steps.length - 1)) / steps.length
      const inner = width - 36
      const titleLines = steps.map((step) => wrap(step.label, 16, inner, 2))
      const detailLines = steps.map((step) => (step.detail ? wrap(step.detail, 12.5, inner, 4) : []))
      const titleRows = Math.max(...titleLines.map((lines) => lines.length))
      const detailRows = Math.max(...detailLines.map((lines) => lines.length))
      const contentTop = 66
      const height = Math.max(150, contentTop + titleRows * 23 + (detailRows > 0 ? 8 + detailRows * 19 : 0) + 20)

      let body = ''
      steps.forEach((step, i) => {
        const x = M + i * (width + gap)
        const color = varOf(step.color, i)
        body += `<rect x="${x}" y="${top}" width="${width}" height="${height}" rx="14" fill="${softOf(step.color, i)}" stroke="${color}" stroke-opacity="0.55"/>`
        body += `<circle cx="${x + 28}" cy="${top + 26}" r="13" fill="${color}"/>`
        body += text(x + 28, top + 31, String(i + 1), 13, 'var(--vz-card)', ' text-anchor="middle" font-weight="700"')
        titleLines[i].forEach((line, lineIndex) => {
          body += text(x + 18, top + contentTop + 2 + lineIndex * 23, line, 16, 'var(--vz-text)', ' font-weight="600"')
        })
        if (detailLines[i].length > 0) {
          const detailTop = top + contentTop + titleRows * 23 + 8
          detailLines[i].forEach((line, lineIndex) => {
            body += text(x + 18, detailTop + lineIndex * 19, line, 12.5, 'var(--vz-text2)')
          })
        }
        if (i < steps.length - 1) {
          const ay = top + height / 2
          const start = x + width + 10
          const end = x + width + gap - 10
          body += `<line x1="${start}" y1="${ay}" x2="${end - 7}" y2="${ay}" stroke="var(--vz-text3)" stroke-width="2"/>`
          body += `<path d="M${end - 9} ${ay - 5} L${end} ${ay} L${end - 9} ${ay + 5} Z" fill="var(--vz-text3)"/>`
        }
      })
      return { body, height: top + height + 20 }
    }

    const BUILDERS = {
      bar: barBody,
      grouped_bar: groupedBarBody,
      line: lineBody,
      hbar: hbarBody,
      donut: donutBody,
      stats: statsBody,
      flow: flowBody,
    }

    /**
     * Presentation attributes do not reliably accept `var()`. Rewrite every
     * `fill`/`stroke` that holds a custom property into one inline style so the
     * theme tokens resolve in the browser.
     */
    const inlineVars = (markup) =>
      markup.replace(/<([a-z]+)((?:\s+[a-zA-Z0-9_.-]+="[^"]*")*)\s*(\/?)>/gu, (match, tag, attrs, selfClose) => {
        if (!attrs.includes('var(--')) return match
        const declarations = []
        const rest = attrs.replace(/\s+(fill|stroke)="(var\(--[^"]+\))"/gu, (_, property, value) => {
          declarations.push(`${property}:${value}`)
          return ''
        })
        if (declarations.length === 0) return match
        return `<${tag}${rest} style="${declarations.join(';')}"${selfClose === '/' ? '/>' : '>'}`
      })

    /** 把 SVG 顶层元素包进带延迟的 `<g>`，让卡片出现时逐元素浮现（OIUI 的 stagger）。 */
    const stagger = (markup) => {
      const open = markup.indexOf('>')
      const close = markup.lastIndexOf('</svg>')
      if (open < 0 || close <= open) return markup
      const head = markup.slice(0, open + 1)
      const body = markup.slice(open + 1, close)
      const tail = markup.slice(close)
      const tokens = []
      let i = 0
      while (i < body.length) {
        const lt = body.indexOf('<', i)
        if (lt < 0) break
        const match = /^<([a-zA-Z]+)/u.exec(body.slice(lt, lt + 24))
        if (match === null) break
        const name = match[1]
        const gt = body.indexOf('>', lt)
        if (gt < 0) break
        if (body[gt - 1] === '/') {
          tokens.push(body.slice(lt, gt + 1))
          i = gt + 1
          continue
        }
        const closeTag = `</${name}>`
        const end = body.indexOf(closeTag, gt)
        if (end < 0) break
        tokens.push(body.slice(lt, end + closeTag.length))
        i = end + closeTag.length
      }
      if (tokens.length < 2) return markup
      const wrapped = tokens
        .map((token, index) => `<g class="vz-in" style="animation-delay:${Math.min(420, index * 32)}ms">${token}</g>`)
        .join('')
      return head + wrapped + tail
    }

    /* ── 卡片骨架 ───────────────────────────────────────────────── */
    const svgFor = (spec) => {
      const build = BUILDERS[spec.kind]
      if (!build) return null
      const built = build(spec)
      if (!built) return null
      const height = Math.max(160, Math.min(720, built.height + (spec.footnote ? 30 : 0)))
      const title = spec.title == null ? '' : String(spec.title)
      const subtitle = spec.subtitle == null ? '' : String(spec.subtitle)
      const footnote = spec.footnote == null ? '' : String(spec.footnote)
      const header = title
        ? `${text(M, M + 22, clip(title, 22, W - M * 2 - 160), 22, 'var(--vz-text)', ' font-weight="600"')}${
            subtitle ? text(M, M + 48, clip(subtitle, 13, W - M * 2 - 160), 13, 'var(--vz-text2)') : ''
          }`
        : ''
      const footer = footnote
        ? `<line x1="${M}" y1="${height - 34}" x2="${W - M}" y2="${height - 34}" stroke="var(--vz-grid)" stroke-width="1"/>` +
          text(M, height - 16, clip(footnote, 12, W - M * 2), 12, 'var(--vz-text3)')
        : ''
      return stagger(
        inlineVars(
          `<svg class="vzf-svg" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(title || '可视化卡片')}" preserveAspectRatio="xMidYMin meet">` +
        `<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="14" fill="var(--vz-card)" stroke="var(--vz-border)"/>` +
        header +
        built.body +
        footer +
        `</svg>`,
        ),
      )
    }

    /* ── HTML 围栏（沙箱 iframe，用于可交互小工具） ──────────────── */
    const HTML_LANG = 'visual-html'
    const HTML_MAX_BYTES = 200000
    const DEFAULT_HEIGHT = 420
    const MIN_HEIGHT = 140
    const MAX_HEIGHT = 1400

    const CSP_BASE =
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; " +
      "script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"
    /** `cdn=1` 时放开 esm.sh（脚本/连接）与 https 图片；默认只允许 data: 图片，任何网络都不通。 */
    const CSP_CDN =
      "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; " +
      "script-src 'unsafe-inline' https://esm.sh; connect-src https://esm.sh; font-src data:; form-action 'none'; base-uri 'none'"
    const IMPORTMAP =
      '<script type="importmap">{"imports":{"three":"https://esm.sh/three","three/":"https://esm.sh/three/","gsap":"https://esm.sh/gsap","gsap/":"https://esm.sh/gsap/","d3":"https://esm.sh/d3","d3/":"https://esm.sh/d3/","chart.js":"https://esm.sh/chart.js","chart.js/":"https://esm.sh/chart.js/"}}</script>'

    /** 生成器可用的最小设计系统：与 visual/tokens.css 同源的语义色 + 基础控件样式。 */
    const HTML_TOKENS = `
*{box-sizing:border-box}
:root{--color-background-primary:#fff;--color-background-secondary:#f7f6f3;--color-background-tertiary:#efeee9;--color-background-info:#E6F1FB;--color-background-danger:#FCEBEB;--color-background-success:#EAF3DE;--color-background-warning:#FAEEDA;--color-text-primary:#1a1a1a;--color-text-secondary:#73726c;--color-text-tertiary:#9c9a92;--color-text-info:#185FA5;--color-text-danger:#A32D2D;--color-text-success:#3B6D11;--color-text-warning:#854F0B;--color-border-tertiary:rgba(0,0,0,.15);--color-border-secondary:rgba(0,0,0,.3);--color-border-primary:rgba(0,0,0,.4);--font-sans:system-ui,-apple-system,"PingFang SC","Segoe UI",Roboto,sans-serif;--radius-md:8px;--radius-lg:12px}
html[data-vz-theme="dark"]{--color-background-primary:#1f1f1d;--color-background-secondary:#131311;--color-background-tertiary:#131311;--color-background-info:#0C447C;--color-background-danger:#501313;--color-background-success:#173404;--color-background-warning:#412402;--color-text-primary:#e8e6de;--color-text-secondary:#9c9a92;--color-text-tertiary:#7d7b75;--color-text-info:#85B7EB;--color-text-danger:#F09595;--color-text-success:#97C459;--color-text-warning:#EF9F27;--color-border-tertiary:rgba(255,255,255,.15);--color-border-secondary:rgba(255,255,255,.3);--color-border-primary:rgba(255,255,255,.4)}
html{color-scheme:light}html[data-vz-theme="dark"]{color-scheme:dark}
body{margin:0;padding:16px;font-family:var(--font-sans);color:var(--color-text-primary);background:transparent;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
button{font:inherit;font-size:14px;padding:6px 16px;border:.5px solid var(--color-border-secondary);border-radius:var(--radius-md);background:transparent;color:var(--color-text-primary);cursor:pointer}
button:hover{background:var(--color-background-secondary)}
input,select,textarea{font:inherit;font-size:14px;padding:6px 12px;height:36px;border:.5px solid var(--color-border-tertiary);border-radius:var(--radius-md);background:var(--color-background-primary);color:var(--color-text-primary)}
input[type=range]{-webkit-appearance:none;appearance:none;height:4px;padding:0;border:0;background:var(--color-border-tertiary);border-radius:2px}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:var(--color-background-primary);border:.5px solid var(--color-border-secondary);cursor:pointer}
input[type=checkbox],input[type=radio]{width:16px;height:16px;accent-color:var(--color-text-info)}
a{color:var(--color-text-info)}
`

    const HEIGHT_SCRIPT = `<script>(function(){function report(){try{var b=document.body;if(!b)return;var h=Math.ceil(Math.max(b.scrollHeight||0,b.getBoundingClientRect().height||0));if(h>0){parent.postMessage({type:"visual-answers:height",height:h},"*")}}catch(e){}}window.addEventListener("load",report);if(window.ResizeObserver){try{new ResizeObserver(report).observe(document.body)}catch(e){}}setTimeout(report,60);setTimeout(report,400)})()</script>`
    const BRIDGE_SCRIPT = `<script>(function(){function ask(text){try{if(typeof text!=="string")return;var t=text.trim();if(!t||t.length>4000)return;parent.postMessage({type:"visual-answers:prompt",text:t},"*")}catch(e){}}window.vz={ask:ask};document.addEventListener("click",function(event){var el=event.target&&event.target.closest?event.target.closest("[data-vz-prompt]"):null;if(!el)return;var text=el.getAttribute("data-vz-prompt");if(text===null||text==="")text=el.textContent;ask(text||"")});window.addEventListener("message",function(event){var data=event.data;if(!data||typeof data!=="object")return;if(data.type==="visual-answers:theme"){document.documentElement.setAttribute("data-vz-theme",data.theme==="dark"?"dark":"light")}})})()</script>`

    /** 流式预览壳：只接受宿主推来的 chunk 并替换内容，不执行生成代码里的脚本。 */
    const PREVIEW_SCRIPT = `<script>(function(){var root=document.getElementById("vz-root");var first=true;function report(){try{if(!root)return;var h=Math.ceil(Math.max(root.scrollHeight||0,root.getBoundingClientRect().height||0))+32;if(h>0)parent.postMessage({type:"visual-answers:height",height:h},"*")}catch(e){}}function enter(){var nodes=root.children;for(var i=0;i<nodes.length;i++){nodes[i].classList.add("vz-fade");nodes[i].style.animationDelay=Math.min(360,i*45)+"ms"}}function pulse(){try{root.style.transition="opacity 120ms ease-out";root.style.opacity="0.72";requestAnimationFrame(function(){root.style.opacity="1"})}catch(e){}}window.addEventListener("message",function(event){var data=event.data;if(!data||typeof data!=="object")return;if(data.type==="visual-answers:chunk"){try{root.innerHTML=data.html}catch(e){}if(first){enter();first=false}else{pulse()}setTimeout(report,30)}else if(data.type==="visual-answers:theme"){document.documentElement.setAttribute("data-vz-theme",data.theme==="dark"?"dark":"light")}});if(window.ResizeObserver){try{new ResizeObserver(report).observe(root)}catch(e){}}setTimeout(report,50)})()</script>`

    const readCdn = (meta) => String(meta ?? '').split(/\s+/u).some((token) => token === 'cdn' || token === 'cdn=1' || token === 'cdn=esm' || token === 'cdn=yes')

    const buildHtmlDoc = (body, dark, allowCdn) => {
      const theme = dark ? 'dark' : 'light'
      const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${allowCdn ? CSP_CDN : CSP_BASE}">${allowCdn ? IMPORTMAP : ''}<style>${HTML_TOKENS}</style>${BRIDGE_SCRIPT}`
      const isDocument = /<html[\s>]/iu.test(body) || /<!doctype/iu.test(body)
      if (!isDocument) {
        return `<!doctype html><html data-vz-theme="${theme}"><head>${head}</head><body>${body}${HEIGHT_SCRIPT}</body></html>`
      }
      let doc = body.replace(/<html([^>]*)>/iu, (match, attrs) => `<html${attrs} data-vz-theme="${theme}">`)
      doc = /<head([^>]*)>/iu.test(doc) ? doc.replace(/<head([^>]*)>/iu, (match, attrs) => `<head${attrs}>${head}`) : head + doc
      doc = /<\/body>/iu.test(doc) ? doc.replace(/<\/body>/iu, `${HEIGHT_SCRIPT}</body>`) : doc + HEIGHT_SCRIPT
      return doc
    }

    const buildPreviewDoc = (dark, allowCdn) => {
      const theme = dark ? 'dark' : 'light'
      return `<!doctype html><html data-vz-theme="${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${allowCdn ? CSP_CDN : CSP_BASE}">${allowCdn ? IMPORTMAP : ''}<style>${HTML_TOKENS}</style><style>@keyframes vzfIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.vz-fade{animation:vzfIn 320ms cubic-bezier(.2,.7,.3,1) both}@media (prefers-reduced-motion:reduce){.vz-fade{animation:none!important}}</style></head><body><div id="vz-root"></div>${PREVIEW_SCRIPT}</body></html>`
    }

    const readHeight = (meta) => {
      const match = /(?:^|\s)height=(\d{2,4})/u.exec(String(meta ?? ''))
      const value = match ? Number(match[1]) : DEFAULT_HEIGHT
      return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Number.isFinite(value) ? value : DEFAULT_HEIGHT))
    }

    /** 跟随宿主的亮/暗主题（body[data-ds-dark-theme]）。 */
    const useDarkTheme = () => {
      const read = () => typeof document !== 'undefined' && document.body !== null && document.body.hasAttribute('data-ds-dark-theme')
      const [dark, setDark] = React.useState(read)
      React.useEffect(() => {
        if (typeof MutationObserver === 'undefined' || document.body === null) return undefined
        const observer = new MutationObserver(() => setDark(read()))
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        setDark(read())
        return () => observer.disconnect()
      }, [])
      return dark
    }

    /** 流式生成的 HTML 预览：宿主持续推送当前片段，最终 settle 后换成完整 iframe。 */
    function HtmlStreamPreview({ code, dark, height, allowCdn }) {
      const frameRef = React.useRef(null)
      const codeRef = React.useRef(code)
      const lastPost = React.useRef(0)
      const [frameHeight, setFrameHeight] = React.useState(height)
      const previewDoc = React.useMemo(() => buildPreviewDoc(dark, allowCdn), [])
      codeRef.current = code

      const post = (message) => {
        const frame = frameRef.current
        if (frame === null || frame.contentWindow === null) return
        frame.contentWindow.postMessage(message, '*')
      }
      const theme = () => post({ type: 'visual-answers:theme', theme: dark ? 'dark' : 'light' })
      const chunk = (force) => {
        const now = Date.now()
        if (!force && now - lastPost.current < 140) return
        lastPost.current = now
        post({ type: 'visual-answers:chunk', html: codeRef.current })
      }

      React.useEffect(() => { chunk(false) }, [code])
      React.useEffect(() => { theme() }, [dark])
      React.useEffect(() => {
        const onMessage = (event) => {
          const frame = frameRef.current
          if (frame === null || event.source !== frame.contentWindow) return
          const data = event.data
          if (data === null || typeof data !== 'object' || data.type !== 'visual-answers:height') return
          const next = Number(data.height)
          if (!Number.isFinite(next)) return
          setFrameHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(next))))
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [])

      return h(
        'div',
        { className: 'vzf-frame vzf-html vzf-live vzf-enter' },
        h('iframe', {
          ref: frameRef,
          className: 'vzf-iframe',
          sandbox: 'allow-scripts',
          title: '生成中的交互式可视化',
          srcDoc: previewDoc,
          onLoad: () => { theme(); chunk(true) },
          style: { height: `${frameHeight}px` },
        }),
      )
    }

    function HtmlCard({ html, height, dark, inputActions }) {
      const frameRef = React.useRef(null)
      const noticeTimer = React.useRef(null)
      const [frameHeight, setFrameHeight] = React.useState(height)
      const [notice, setNotice] = React.useState('')

      const postTheme = () => {
        const frame = frameRef.current
        if (frame === null || frame.contentWindow === null) return
        frame.contentWindow.postMessage({ type: 'visual-answers:theme', theme: dark ? 'dark' : 'light' }, '*')
      }

      const flash = (message) => {
        setNotice(message)
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => setNotice(''), 3200)
      }

      React.useEffect(() => {
        const onMessage = (event) => {
          const frame = frameRef.current
          if (frame === null || event.source !== frame.contentWindow) return
          const data = event.data
          if (data === null || typeof data !== 'object') return
          if (data.type === 'visual-answers:height') {
            const next = Number(data.height)
            if (!Number.isFinite(next)) return
            setFrameHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(next))))
            return
          }
          if (data.type !== 'visual-answers:prompt') return
          const text = typeof data.text === 'string' ? data.text.trim() : ''
          if (text === '' || text.length > 4000) return
          try {
            if (inputActions !== undefined && typeof inputActions.setDraft === 'function') {
              inputActions.setDraft(text)
              flash('已填入输入框，按回车发送')
            } else {
              flash('当前无法回填输入框')
            }
          } catch {
            flash('当前无法回填输入框')
          }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [inputActions])

      React.useEffect(() => () => {
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
      }, [])

      React.useEffect(() => { postTheme() }, [dark])

      return h(
        'div',
        { className: 'vzf-frame vzf-html vzf-enter' },
        h('iframe', {
          ref: frameRef,
          className: 'vzf-iframe',
          sandbox: 'allow-scripts',
          title: '交互式可视化',
          srcDoc: html,
          onLoad: postTheme,
          style: { height: `${frameHeight}px` },
        }),
        notice === '' ? null : h('div', { className: 'vzf-notice' }, notice),
      )
    }

    /* ── 围栏层组件 ─────────────────────────────────────────────── */
    /** 流式占位：JSON 还没成形时显示，而不是把源码甩给用户。 */
    function StreamPlaceholder() {
      return h(
        'div',
        { className: 'vzf-frame vzf-stream' },
        h('span', { className: 'vzf-stream-dot' }),
        h('span', null, '正在生成可视化…'),
      )
    }

    function VisualFenceLayer({ code, streaming, children }) {
      const placeholder = () => (streaming ? h(StreamPlaceholder) : children)
      if (typeof code !== 'string' || code.length > 120000) return placeholder()
      const trimmed = code.trim()
      if (trimmed === '' || !(trimmed.startsWith('{') || trimmed.startsWith('['))) return placeholder()
      let spec = null
      try {
        spec = JSON.parse(trimmed)
      } catch {
        return placeholder()
      }
      if (spec === null || typeof spec !== 'object' || typeof spec.kind !== 'string') return placeholder()
      let markup = null
      try {
        markup = svgFor(spec)
      } catch {
        markup = null
      }
      if (markup === null) return placeholder()
      // 允许在一份 fence 里用 title 之外的字段忽略类型：仅渲染已知 kind
      return h('div', { className: 'vzf-frame vzf-enter', dangerouslySetInnerHTML: { __html: markup } })
    }

    function HtmlFenceLayer({ code, streaming, meta, children, inputActions }) {
      const dark = useDarkTheme()
      const allowCdn = readCdn(meta)
      const height = readHeight(meta)
      // 主题不进依赖：切换时只发消息，避免重建导致工具状态丢失。
      const html = React.useMemo(
        () =>
          streaming || typeof code !== 'string' || code.trim() === '' || code.length > HTML_MAX_BYTES
            ? null
            : buildHtmlDoc(code, dark, allowCdn),
        [code, streaming, allowCdn],
      )
      if (streaming) {
        if (typeof code !== 'string' || code.trim() === '' || code.length > HTML_MAX_BYTES) return h(StreamPlaceholder)
        return h(HtmlStreamPreview, { code, dark, height, allowCdn })
      }
      if (html === null) return children
      return h(HtmlCard, { html, height, dark, inputActions })
    }

    /* ── 样式（宿主 token + 深浅两套序列色） ────────────────────── */
    const CSS = `
.vzf-frame {
  --vz-text: var(--dsw-alias-label-primary, #1a1a1a);
  --vz-text2: var(--dsw-alias-label-secondary, #73726c);
  --vz-text3: var(--dsw-alias-label-tertiary, #9c9a92);
  --vz-card: var(--dsw-alias-bg-layer-1, #ffffff);
  --vz-paper: var(--dsw-alias-bg-base, #f7f6f3);
  --vz-border: var(--dsw-alias-border-l1, #e8e6de);
  --vz-grid: var(--dsw-alias-border-l1, #efeee9);
  --vz-baseline: var(--dsw-alias-border-l2, #dcd9d1);
  --vz-1: #185FA5; --vz-1-soft: #E6F1FB;
  --vz-2: #0F6E56; --vz-2-soft: #E1F5EE;
  --vz-3: #993C1D; --vz-3-soft: #FAECE7;
  --vz-4: #534AB7; --vz-4-soft: #EEEDFE;
  --vz-5: #3B6D11; --vz-5-soft: #EAF3DE;
  --vz-6: #854F0B; --vz-6-soft: #FAEEDA;
  --vz-7: #993556; --vz-7-soft: #FBEAF0;
  --vz-8: #5F5E5A; --vz-8-soft: #F1EFE8;
  --vz-9: #A32D2D; --vz-9-soft: #FCEBEB;
}
body[data-ds-dark-theme] .vzf-frame {
  --vz-card: var(--dsw-alias-bg-layer-1, #1f1f1d);
  --vz-paper: var(--dsw-alias-bg-base, #131311);
  --vz-border: var(--dsw-alias-border-l1, #34342f);
  --vz-grid: var(--dsw-alias-border-l1, #2c2c29);
  --vz-baseline: var(--dsw-alias-border-l2, #3f3f3a);
  --vz-1: #85B7EB; --vz-1-soft: #0C447C;
  --vz-2: #5DCAA5; --vz-2-soft: #085041;
  --vz-3: #F0997B; --vz-3-soft: #712B13;
  --vz-4: #AFA9EC; --vz-4-soft: #3C3489;
  --vz-5: #97C459; --vz-5-soft: #27500A;
  --vz-6: #EF9F27; --vz-6-soft: #633806;
  --vz-7: #ED93B1; --vz-7-soft: #72243E;
  --vz-8: #B4B2A9; --vz-8-soft: #444441;
  --vz-9: #F09595; --vz-9-soft: #791F1F;
}
.vzf-frame { display: block; width: 100%; }
.vzf-frame .vzf-svg { display: block; width: 100%; height: auto; }
.vzf-frame .vzf-svg text { font-family: inherit; }
.vzf-html { border: 1px solid var(--vz-border); border-radius: 12px; background: var(--vz-card); overflow: hidden; }
.vzf-html .vzf-iframe { display: block; width: 100%; border: 0; background: transparent; }
.vzf-html .vzf-notice { padding: 7px 14px 9px; font-size: 12px; color: var(--vz-text2); border-top: 1px solid var(--vz-grid); }
.vzf-stream { display: flex; align-items: center; gap: 9px; padding: 15px 17px; border: 1px solid var(--vz-border); border-radius: 12px; background: var(--vz-card); font-size: 13px; color: var(--vz-text2); }
.vzf-enter { animation: vzfEnter 340ms cubic-bezier(.2, .7, .3, 1) both; }
.vzf-svg .vz-in { animation: vzfIn 360ms cubic-bezier(.2, .7, .3, 1) both; }
@keyframes vzfEnter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes vzfIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .vzf-enter, .vzf-svg .vz-in { animation: none !important; } }
.vzf-stream-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vz-text3); animation: vzf-pulse 1.2s ease-in-out infinite; }
.vzf-live { position: relative; }
@keyframes vzf-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .vzf-stream-dot { animation: none; } }
`

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@tigermaxxin/dsh-visual-answers'
          tag.dataset.pluginCss = '@tigermaxxin/dsh-visual-answers/fence'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'visual-answers: fence stylesheet')

        ctx.slots.inject('conversation.chat.markdown.fence', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.markdown.fence',
              key: 'visual',
              id: '@tigermaxxin/dsh-visual-answers/fence/visual',
            },
            VisualFenceLayer,
          ),
        )

        ctx.slots.inject('conversation.chat.markdown.fence', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.markdown.fence',
              key: HTML_LANG,
              id: '@tigermaxxin/dsh-visual-answers/fence/html',
            },
            HtmlFenceLayer,
          ),
        )
      },
    }
  },
})
