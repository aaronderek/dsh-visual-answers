---
name: visual-answers
description: 用围栏让回复可视化：visual 围栏渲染满宽矢量数据卡片（柱状/折线/环形/指标/流程等 7 种），visual-html 围栏渲染可交互工具（计算器、调参对比、架构图）。需要图表、对比、流程、可交互小工具时使用。
whenToUse: 当答案涉及趋势、占比、排名、流程或方案对比，或用户想算一算/调一调/要一张图时。
---

# 可视化回答

**目标：读到这份技能后，直接写出围栏，任务结束。** 不要研究渲染实现、不要跑脚本验证、不要读插件源码。

## 成本规则（先看这条）

- 每次工具调用都会重发整个上下文；一次「展示可视化」的过度调研可以烧掉上百万 token。
- 正常一次可视化回答 = 0 个工具调用（读本技能本身不算）；只有字段表不够用时才读 1 个 reference。
- 禁止：`grep`/`read` 插件源码或 `~/.dsh` 目录、写 node/python 脚本生成内容、找 Chromium/Playwright、写离线 harness 验证渲染、为演示数据跑脚本。
- 围栏由页面负责渲染；写错了下一条再修，不需要本地验证。

## 选择形式（系统提示里已有常驻策略，按它执行，不再权衡）

- 结论短、数字少 → 纯文字；3–10 项精确对比 → Markdown 表格。
- 趋势、占比、排名、流程、多序列对比 → `visual`；要算、要调参、要筛选、要拖动 → `visual-html`。
- 配额：一次回复最多 2 张 `visual` + 1 个 `visual-html`。
- **演示类请求**（「展示一下你的能力」）：直接给 2 张卡 + 1 个工具，不调研、不写测试、不读额外模板。

## `visual` 速查（大多数情况看这张表就够）

| kind | data |
|---|---|
| `bar` | `labels[]` + `series[0].values[]` |
| `grouped_bar` | `labels[]` + `series[{name,values,color}]` |
| `line` | `labels[]`（≥2 点）+ `series[{name,values,color}]` |
| `hbar` | `items[{label,value,color}]` |
| `donut` | `items[{label,value,color}]`（≤6） |
| `stats` | `items[{label,value,delta,tone,note}]`（2–4 个） |
| `flow` | `steps[{label,detail,color}]`（≤4 步横排，>4 步纵排） |

通用字段：`title`、`subtitle`、`footnote`、`options.yFormat`（`number`/`percent`/`currency`/`wan`）、
`options.highlight:"max"`（bar 强调最高柱）。配色名：`blue teal coral purple green amber pink gray red`。

```visual
{"kind":"bar","title":"各环节耗时","subtitle":"示例数据","data":{"labels":["A","B"],"series":[{"values":[12,26]}]}}
```

只有表不够好用时才读 `references/visual-spec.md`（读这一份，不要同时读另一份）。

## `visual-html` 速查

自包含 HTML 片段（不写 `<html>`/`<head>`）；设计系统已注入：直接用 `--color-*`，`button`/`input` 自带样式；
信息串 `height=140–1400` 只是初始高度，内容会自适应。

```visual-html height=320
<input id="n" type="range" min="0" max="10" value="5"> <b id="o">5</b>
<script>n.addEventListener('input', () => { o.textContent = n.value })</script>
```

- 回填对话：元素加 `data-vz-prompt="…"`，或调 `vz.ask('…')`——只填输入框，用户按回车才发送；prompt 自带当前数值。
- 需要 three/d3/chart.js 时信息串加 `cdn=1`（只放行 esm.sh），并写 `try/catch` 兜底。
- 版式、图标、双主题、分层图模板 → `references/html-recipes.md`（只在写 HTML 工具时读）。

## 硬规则

- 围栏里只放内容：`visual` 只放 JSON（无注释、无尾逗号），`visual-html` 只放 HTML 片段。
- 数字必须来自会话中真实数据；演示数据必须标「示例数据」；格式统一（金额两位小数、百分比一位小数）。
- 不要把围栏源码再贴进正文；一条回复不要超过配额。
- 入场动效由插件负责，不要在工具里重复写。
- 插件未启用（围栏显示成代码块）才读 `references/fallback.md`。

## 反模式（会显著浪费 token）

- 读插件源码、查 `~/.dsh` 安装目录、对比版本、`grep client.js`
- 写 harness / 浏览器截图 / 离线执行工具 JS 来验证围栏
- 用 node/python 脚本生成演示数据或做算术（直接写 JSON）
- 同时读两份 reference、反复权衡「要不要画」
- 为「展示能力」先做一轮调研再产出
