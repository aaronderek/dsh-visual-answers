> **按需阅读**：只有 SKILL.md 的速查表不够用时才读这一份；读完即可直接写 `visual` 围栏，不要再查渲染实现。

# `visual` 围栏规格

围栏体是一个 JSON 对象。`kind` 决定图形；`title`/`subtitle`/`footnote` 是卡片文字；
`options` 控制格式。渲染器会把内容画成 1000 单位 viewBox 的 SVG，宽 100%、主题跟随、入场错峰。

## 通用字段

| 字段 | 说明 |
|---|---|
| `kind` | 必填：`bar` `grouped_bar` `line` `hbar` `donut` `stats` `flow` |
| `title` / `subtitle` / `footnote` | 标题 / 副标题 / 脚注（来源、单位、示例声明） |
| `data` | 图形数据，见下表 |
| `options.yFormat` | `number`（默认）/ `percent` / `currency`（¥）/ `wan`（万） |
| `options.highlight` | 仅 `bar`：设为 `"max"` 时最高柱实色、其余淡化 |
| `options.centerValue` / `options.centerLabel` | 仅 `donut`：中心大字与小字 |

配色名（`color` 字段）：`blue` `teal` `coral` `purple` `green` `amber` `pink` `gray` `red`。
默认按序列/条目轮换。

## 各 kind 的 data

### bar — 单序列对比、排名

```json
{"kind":"bar","title":"耗时","data":{"labels":["澄清","检索","实现"],"series":[{"name":"耗时","values":[12,26,41]}]}}
```

- `labels[]` 与 `series[0].values[]` 等长；最多 12 个标签时显示数值标签，过长标签自动截断。

### grouped_bar — 2–3 序列对比

```json
{"kind":"grouped_bar","title":"两方案对比","data":{"labels":["A","B","C"],"series":[{"name":"方案一","values":[12,20,18],"color":"blue"},{"name":"方案二","values":[8,14,24],"color":"teal"}]}}
```

- 每个 series 可带 `color`；右上角自动图例。

### line — 趋势、前后变化

```json
{"kind":"line","title":"趋势","data":{"labels":["Q1","Q2","Q3","Q4"],"series":[{"name":"纯文字","values":[42,44,45,43],"color":"gray"},{"name":"可视化","values":[48,60,72,86],"color":"blue"}]}}
```

- 至少 2 个点；单序列有面积填充，多序列只有折线 + 末点数值。

### hbar — 长标签排名

```json
{"kind":"hbar","title":"排名","data":{"items":[{"label":"北京","value":88},{"label":"上海","value":72},{"label":"深圳","value":65}]}}
```

### donut — 构成占比（≤6 项）

```json
{"kind":"donut","title":"构成","data":{"items":[{"label":"结论","value":34,"color":"gray"},{"label":"表格","value":22,"color":"blue"},{"label":"图表","value":26,"color":"teal"}]},"options":{"centerLabel":"构成"}}
```

### stats — 关键数字卡片（2–4 个）

```json
{"kind":"stats","title":"概览","data":{"items":[{"label":"宽度","value":"100%","delta":"满宽","tone":"good","note":"占满对话列"},{"label":"主题","value":"实时","tone":"flat","note":"亮/暗切换"}]}}
```

- `delta` 前缀 `+`/`-` 决定颜色，也可用 `tone` 覆盖：`good` / `bad` / `flat`。

### flow — 流程、判断路径

```json
{"kind":"flow","title":"路径","data":{"steps":[{"label":"看懂问题","detail":"对比还是趋势"},{"label":"选表达","detail":"表格 / 图表 / 工具"},{"label":"写围栏"}]}}
```

- ≤4 步横排，>4 步自动纵排；`detail` 自动折行（横排最多 3 行）。

## 使用约束

- 只放 JSON：不能有注释、尾逗号；JSON 非法会一直显示代码块。
- 数值用数字类型（`12`、`12.5`），不要带单位字符串；单位写进 `footnote` 或 `subtitle`。
- `percent` 数据本身写 0–100 的数值（如 `12.5`），渲染成 `12.5%`。
- 单张卡片内容太多时改用表格或拆成两张卡。
