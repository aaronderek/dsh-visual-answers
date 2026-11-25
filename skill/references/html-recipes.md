> **按需阅读**：只在确实要写 `visual-html` 工具时读这一份；读完即可直接写围栏，不要跑脚本或读插件源码验证。

# `visual-html` 围栏配方

围栏体是**自包含 HTML 片段**（内联 CSS/JS，无 `<html>`/`<head>`），插件把它放进
`sandbox="allow-scripts"` 的 iframe：高度自适应、主题注入、无同源、默认无网络。

## 何时用

- 用户要「算一算 / 调一调 / 试一试」：计算器、单位换算、参数敏感性、加权评分器。
- 需要状态：切换视图、筛选、拖动节点、逐步展开。
- 设计感图示：分层/架构图、卡片式对比、时间线（`visual` 的 SVG 做不出这种质感）。

静态数据图仍用 `visual`，别用 HTML 重画。

## 骨架

设计系统已注入：`--color-*` 语义色、`button`/`input`/`range` 已带样式，`body` 自带 16px padding。
不要从零重画控件，也不要用外部字体/图标。

```html
<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px">
  <label style="display:grid;gap:6px;font-size:13px;color:var(--color-text-secondary)">单价
    <input id="price" type="number" min="0" step="0.1" value="2"></label>
  <label style="display:grid;gap:6px;font-size:13px;color:var(--color-text-secondary)">用量
    <input id="qty" type="number" min="0" step="10" value="200"></label>
</div>
<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px">
  <div style="padding:12px 14px;border:1px solid var(--color-border-tertiary);border-radius:12px;background:var(--color-background-secondary)">
    <div style="font-size:12px;color:var(--color-text-secondary)">每月成本</div>
    <div id="out" style="font-size:22px;font-weight:600;margin-top:2px">¥0.72</div>
  </div>
</div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id) }
  function refresh() {
    var total = (Number($('price').value) || 0) * (Number($('qty').value) || 0)
    $('out').textContent = '¥' + total.toFixed(2)
  }
  ;['price', 'qty'].forEach(function (id) { $(id).addEventListener('input', refresh) })
  refresh()
})()
</script>
```

## 版式参考

- 控件 + 结果：`grid` 两列（标签与 input），结果用 2–3 个指标卡。
- 指标卡：`background: var(--color-background-secondary)` + 1px 边框 + 12px 圆角。
- 双列对比：`display:grid;grid-template-columns:1fr 1fr;gap:14px`。
- 分层/架构图：模板见技能自带 `assets/artifacts/layered-diagram.html`——外层边框卡、每层圆角块、
  SVG 箭头、内联 SVG 图标；强调层用强调色描边 + 淡色底。
- 窄屏：`@media (max-width: 560px)` 把多列收成单列。

## 图标

内联 SVG，16–24px、`stroke="currentColor"`、`fill="none"`、线宽 1.7 左右。
不要用 emoji、外链图标、字体图标。

## 双主题

颜色一律走变量；需要自定义色时开一个作用域并写两套：

```html
<style>
.panel { --p-accent: #6C5CE7; --p-soft: rgba(108,92,231,.08); --p-sub: var(--color-text-secondary); }
html[data-vz-theme="dark"] .panel { --p-accent: #AFA9EC; --p-soft: rgba(175,169,236,.09); }
.panel { border: 1px solid var(--color-border-tertiary); border-radius: 14px; }
</style>
```

普通文字/表面/边框直接用 `--color-text-*`、`--color-background-*`、`--color-border-*`。

## CDN（可选）

默认无网络。需要 three / gsap / d3 / chart.js 时在信息串加 `cdn=1`：

````
```visual-html cdn=1 height=380
<script type="module">
try {
  const d3 = await import('d3')   // 裸包名经内置 importmap 解析到 esm.sh
  // ...
} catch (error) {
  document.body.innerHTML = '<p style="color:var(--color-text-secondary)">CDN 加载失败：' + error.message + '</p>'
}
</script>
```
````

- 只放行 `https://esm.sh`；图片仍限 `data:` / `https:`；其余网络（fetch/XHR）被 CSP 禁止。
- 模块脚本支持 top-level await；一定写 `try/catch` 兜底，避免 CDN 不可用时白屏。
- 不需要库就不要加 `cdn=1`。

## 回填对话

工具可以把当前场景交给对话（只填入输入框，用户按回车才发送）：

```html
<button data-vz-prompt="按当前参数再给三个降本方案">继续问</button>
<script>
  document.querySelector('#ask').addEventListener('click', function () {
    vz.ask('按每天 ' + calls + ' 次、每次 ' + tokens + ' tokens 估算，请给三个降本方案并排序。')
  })
</script>
```

- `data-vz-prompt` 的文本会原样提交；需要拼当前数值时用 `vz.ask()`。
- 宿主校验来源与 1–4000 字长度；成功后显示「已填入输入框」提示。
- prompt 必须自包含（带上用户选的参数），不要只说「继续」。

## 尺寸、流式与限制

- 信息串 `height=140–1400` 只是初始高度，内容变化后自动上报修正。
- 流式生成期间宿主会实时推送片段做预览（脚本在 settle 后才执行）；最终文档重跑脚本。
- 单个体积上限 200KB；超限/空内容回退成代码块。
- 沙箱无同源、无 cookie/localStorage、无 fetch；状态只放内存变量。
- 数学要正确：金额两位小数、百分比一位、处理空值/除零，标注单位与假设。
