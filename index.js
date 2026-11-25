/**
 * Host half of visual-answers.
 *
 * It does two things:
 * 1. Registers one compact, always-on presentation policy in the system prompt, so
 *    the agent decides on its own when a visual form helps. The renderer choice
 *    stays implicit in the fence language (`visual` for charts, `visual-html` for
 *    tools), so no second routing model or extra API key is needed.
 * 2. Registers the bundled `visual-answers` skill (SKILL.md, references, assets)
 *    through the `skills` registry, so installing this package also gives the agent
 *    the authoring guidance the fences rely on.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Prompt registry is required; the skill registry is optional. */
export const inject = ['systemPrompt']

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = join(PACKAGE_DIR, 'skill')

/** Routing policy; the deciding layer, not the how-to. */
const PRESENTATION_POLICY = [
  'Presentation policy for answers — choose the lightest form that clarifies the result before writing:',
  '- Plain text is the default for explanations, conclusions, short answers, code, formulas, and instructions.',
  '- Use a Markdown table for comparisons of about 3 to 10 items, or when exact values matter.',
  '- Use a `visual` fenced block (JSON chart spec; details in the visual-answers skill) for trends of three or more points, composition or share, rankings, flows, and multi-series comparisons where a chart reads better than rows of numbers.',
  '- Use a `visual-html` fenced block (self-contained HTML; details in the visual-answers skill) when the user wants to compute, adjust parameters, filter, drag, or step through a model, or when a designed layered or architecture diagram is the clearest answer.',
  '- Never invent data or precision to look visual; label illustrative values as sample data in the title or footnote.',
  '- Per answer, use at most two `visual` cards and one `visual-html` tool. Skip any visual that does not make the answer easier to understand.',
].join(' ')

/**
 * Split a bundled SKILL.md into its frontmatter fields and body.
 * @param {string} raw - the file contents.
 * @returns {{ meta: Record<string, string>, content: string }} parsed parts.
 */
function parseSkill(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(raw)
  if (match === null) return { meta: {}, content: raw }
  const meta = {}
  for (const line of match[1].split(/\r?\n/u)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (key !== '') meta[key] = value
  }
  return { meta, content: match[2] }
}

/**
 * Register the policy and the bundled skill; both dispose with this plugin.
 * @param ctx - context carrying the prompt and skill registries.
 */
export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'visual-answers:presentation-policy',
    order: ctx.systemPrompt.getSectionOrder('FILE_REFERENCE'),
    text: PRESENTATION_POLICY,
  })

  ctx.inject(['skills'], (skillsCtx) => {
    let raw
    try {
      raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
    } catch {
      return
    }
    const { meta, content } = parseSkill(raw)
    const body = content.replace(/^\s+/u, '')
    ctx.effect(() =>
      skillsCtx.skills.register({
        name: meta.name ?? 'visual-answers',
        description: meta.description ?? 'Authoring guidance for the visual answer fences.',
        ...(meta.whenToUse === undefined ? {} : { whenToUse: meta.whenToUse }),
        /** Required by the registry; this skill ships inside the plugin package. */
        source: 'bundled',
        content: body,
        resourceBase: { kind: 'directory', path: SKILL_DIR },
      }),
    )
  })
}
