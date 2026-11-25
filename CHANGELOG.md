# Changelog

## 1.1.2 — 2026-11-25

- Verified against DeepSeek Harness **0.2.2-rc.5** (Cordis 4.1): fence slot contract,
  `dsh.client` manifest, theme tokens, dark-mode attribute, skill registry, and the
  prompt-section order are unchanged; both fences stay active.
- Docs: state the verified DSH version; name the exact settings label for the
  interactive HTML preview (「显示代码工作视图」).
- Skill content no longer starts with a blank line.
- No behavior changes.

## 1.1.1 — 2026-11-17

- Fix: the bundled skill registration now includes the required `source` field, so
  `skill("visual-answers")` loads instead of failing with
  `loaded skill "visual-answers" source must be a string`.
- No other changes.

## 1.1.0 — 2026-11-17

- Ships the `visual-answers` skill inside the package (`skill/SKILL.md`,
  `skill/references/*`, `skill/assets/*`) and registers it through the DSH `skills`
  registry, so installing the plugin also gives the agent the authoring guidance.
- The skill remains optional at runtime: profiles without a skill registry still get
  the fences and the presentation policy.
- No client-side changes; `visual` and `visual-html` behavior is unchanged from 1.0.1.

## 1.0.1 — 2026-11-17

- Republished under the explicit npm staged-publishing flow (`npm stage publish`).
- No functional changes from 1.0.0; the 1.0.0 staging record was orphaned by npm and can
  never be published, so the first public version is 1.0.1.

## 1.0.0 — 2026-11-17

- `visual` fence: JSON chart spec rendered as a full-width inline SVG card
  (bar, grouped_bar, line, hbar, donut, stats, flow), light/dark theme tokens,
  staggered entrance animation, streaming preview.
- `visual-html` fence: self-contained HTML tool in a sandboxed iframe with
  adaptive height, injected design tokens, theme hot-switch, `cdn=1` opt-in for
  esm.sh libraries, and a validated `data-vz-prompt` / `vz.ask` bridge that
  fills the composer draft.
- Host half registers a compact presentation policy so the agent decides on its
  own whether plain text, a table, a chart card, or an interactive tool fits.
- Compatibility: requires DSH 0.2.2-rc.3 or newer (`engines.dsh`).
