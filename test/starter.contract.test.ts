import { existsSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractFields, injectFields } from '../src/index.ts'

// A sibling checkout of https://github.com/johannschopplich/kirby-headless-starter
// provides real Kirby-written content; skipped when absent (e.g. in CI).
const starterContent = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'kirby-headless-starter',
  'storage',
  'content',
)

describe.skipIf(!existsSync(starterContent))('kirby-headless-starter contract', () => {
  it('round-trips real Kirby content byte-for-byte when nothing is edited', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-starter-'))
    const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-starter-out-'))

    try {
      await fsp.cp(starterContent, root, { recursive: true })

      const { results } = await extractFields(root, { out })
      expect(results.length).toBeGreaterThan(0)

      const injectResults = await injectFields(root, { out })
      for (const result of injectResults)
        expect(result.hasChanged, result.target).toBe(false)

      for await (const entry of fsp.glob('**/*.txt', { cwd: starterContent })) {
        const [originalContent, roundTrippedContent] = await Promise.all([
          fsp.readFile(path.join(starterContent, entry), 'utf-8'),
          fsp.readFile(path.join(root, entry), 'utf-8'),
        ])
        expect(roundTrippedContent, entry).toBe(originalContent)
      }
    }
    finally {
      await fsp.rm(root, { recursive: true, force: true })
      await fsp.rm(out, { recursive: true, force: true })
    }
  })
})
