> **按需阅读**：只在围栏显示成代码块（插件未启用）时读这一份。

# 插件不可用时的回退

`visual` / `visual-html` 围栏显示成代码块，说明插件 `@tigermaxxin/dsh-visual-answers` 未安装或被禁用。
先让用户确认 Plugins 里的「可视化回答」是否启用、页面是否已刷新；确认不可用时走下面两条路线。

## 路线 A：PNG 卡片（内联图片）

技能自带的 `assets/` 提供同一套 JSON spec 的离线渲染器（Pillow，无外部依赖）。

```bash
sh assets/render.sh assets/examples/bar.json charts/bar.png
```

- spec 格式与 `visual` 围栏一致（`kind`/`title`/`data`/`options`），可直接复用同一份 JSON；
  渲染器额外支持 `options.valueLabels`、显式 `width`/`height`/`plotHeight` 与 `--theme light|dark`。
- 回复里内联：`![一句话说明](<charts/bar.png>)`。
- **必须 `read_image` 自检**排版与可读性。
- 硬限制：聊天内 Markdown 图片被宿主编排为 **640×360 CSS 缩略图**（点击可放大），
  所以只适合快速预览；宽图会把字号压得很小。

## 路线 B：HTML 文件（右侧栏预览）

- 从 `assets/artifacts/bill-split.html`（交互工具）或 `assets/artifacts/layered-diagram.html`
  （分层/架构图）复制修改，保持自包含（内联 CSS/JS、无外链；主题用 `--color-*` 变量）。
- 回复里给链接：`[试试：账单分摊](<assets/artifacts/bill-split.html>)`，点开在右侧栏沙箱预览。
- 交互版是否可拖拽取决于设置里的「显示代码工作视图」（HTML 交互预览）开关。

## 选择

| 需求 | 路线 |
|---|---|
| 快速看趋势/对比 | A：PNG（并且正文补一句结论） |
| 交互、可调参数、宽幅架构图 | B：HTML 文件 |
| 只是排版信息 | 直接用原生 Markdown 表格，不画图 |

两条路线都不需要安装插件，也不改 profile；插件恢复后优先用围栏（满宽、矢量、主题跟随）。
