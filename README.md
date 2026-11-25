# dsh-visual-answers

Inline SVG answer cards and sandboxed interactive tools for DeepSeek Harness
chat. Two Markdown fence languages, both rendered by a bundled DSH plugin:

- **`visual`** — a JSON chart spec rendered as a full-width inline SVG card:
  `bar`, `grouped_bar`, `line`, `hbar`, `donut`, `stats`, `flow`. Light/dark
  theme tokens, staggered entrance animation, live streaming preview.
- **`visual-html`** — a self-contained HTML/CSS/JS tool rendered in a sandboxed
  iframe: adaptive height, injected design tokens, theme hot-switch, optional
  `cdn=1` for `three` / `gsap` / `d3` / `chart.js` from esm.sh, and a validated
  `data-vz-prompt` / `vz.ask()` bridge that fills the composer draft.

The plugin's Host half also registers a short presentation policy, so the agent
decides on its own whether plain text, a Markdown table, a chart card, or an
interactive tool fits the answer. The package bundles the `visual-answers` skill
(`skill/SKILL.md`, references, and offline assets) and registers it through the
DSH skills registry, so installing the plugin also teaches the agent how to write
the fences.

## Requirements

- DeepSeek Harness **0.2.2-rc.3** or newer (`engines.dsh`); verified on **0.2.2-rc.5**.
- Web or Desktop (the renderer is a `web` client module).

## Install

**Plugins UI** — open **Plugins** → **Add plugin**, paste the install spec:

```
@tigermaxxin/dsh-visual-answers@1.1.0
```

**Agent tool** — ask DSH to run:

```
plugin_manager install_bundle target=@tigermaxxin/dsh-visual-answers@1.1.0
```

**Local checkout** — pass the absolute package directory, or a packed tarball
path (`/path/to/tigermaxxin-dsh-visual-answers-1.0.0.tgz`).

Enabling is automatic after install; restart DSH if the profile was not hot
reloaded.

## Usage

````
```visual
{"kind":"bar","title":"Latency by stage","subtitle":"sample data","data":{"labels":["A","B"],"series":[{"values":[12,26]}]}}
```
````

````
```visual-html height=320
<input id="n" type="range" min="0" max="10" value="5"> <b id="o">5</b>
<script>n.addEventListener('input', () => { o.textContent = n.value })</script>
```
````

Invalid JSON, an empty body, a render error, or a body over 200 KB falls back to
a normal code block. Unknown fence languages stay untouched.

## Security

DSH plugins run in the Harness process, not in a sandbox: installing one is
equivalent to running its Host code with your user account. The browser half
runs inside the app page. Install only packages you trust, and publish yours
with a scoped npm package, 2FA, and provenance (`npm publish --provenance`)
where possible.

## License

MIT. The design tokens are adapted from
[CopilotKit/OpenIntelligentUI](https://github.com/CopilotKit/OpenIntelligentUI)
(MIT); see `THIRD_PARTY_NOTICES.md`.
