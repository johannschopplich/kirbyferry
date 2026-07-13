import type { StructuredFieldMap } from '../src/index.ts'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractFields, injectFields } from '../src/index.ts'

const contentFixture = path.resolve(import.meta.dirname, 'fixtures', 'content')

const articlePath = path.join('2_blog', '1_lorem-ipsum-dolor', 'article.en.txt')
const translationPath = path.join('2_blog', '1_lorem-ipsum-dolor', 'article.de.txt')

describe('content tree round-trip', () => {
  let root: string
  let out: string

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-content-'))
    out = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-out-'))
    await fsp.cp(contentFixture, root, { recursive: true })
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
    await fsp.rm(out, { recursive: true, force: true })
  })

  async function expectFileUnchanged(relativePath: string): Promise<void> {
    const [original, current] = await Promise.all([
      fsp.readFile(path.join(contentFixture, relativePath), 'utf-8'),
      fsp.readFile(path.join(root, relativePath), 'utf-8'),
    ])
    expect(current, relativePath).toBe(original)
  }

  it('re-injects every blocks and layout field byte-for-byte when nothing is edited', async () => {
    const { results } = await extractFields(root, { out })
    expect(results.length).toBeGreaterThan(0)

    const injectResults = await injectFields(root, { out })
    for (const result of injectResults)
      expect(result.hasChanged, result.target).toBe(false)

    for await (const entry of fsp.glob('**/*.txt', { cwd: contentFixture }))
      await expectFileUnchanged(entry)
  })

  it('extracts only blocks and layout fields, ignoring YAML structures, scalars, and non-block files', async () => {
    const { results } = await extractFields(root, { out })
    const fieldsBySource = new Map(results.map(result => [result.source, result.fields]))

    expect(fieldsBySource.get('site.en.txt')).toEqual(['Intro'])
    expect(fieldsBySource.get(path.join('1_home', 'home.en.txt'))).toEqual(['Body'])
    expect(fieldsBySource.get(articlePath)).toEqual(['Text'])
    // The image sidecar holds no blocks, so it produces no dataset at all.
    expect(fieldsBySource.has(path.join('2_blog', '1_lorem-ipsum-dolor', 'lorem.png.en.txt'))).toBe(false)
  })

  it('rewrites one language, leaving the other translation byte-for-byte', async () => {
    await extractFields(root, { out })

    const datasetPath = path.join(out, '2_blog', '1_lorem-ipsum-dolor', 'article.en.json')
    const dataset = JSON.parse(await fsp.readFile(datasetPath, 'utf-8')) as StructuredFieldMap
    ;(dataset.Text![0] as unknown as { content: { text: string } }).content.text = 'Edited Chapter'
    await fsp.writeFile(datasetPath, JSON.stringify(dataset, undefined, 2))

    const injectResults = await injectFields(root, { out, langs: ['en'] })
    const articleResult = injectResults.find(result => result.target === articlePath)
    expect(articleResult?.hasChanged).toBe(true)

    const rewrittenArticle = await fsp.readFile(path.join(root, articlePath), 'utf-8')
    expect(rewrittenArticle).toContain('Edited Chapter')
    // Still a single minified line.
    expect(rewrittenArticle).toMatch(/^Text: \[\{.*\}\]$/m)

    await expectFileUnchanged(translationPath)
  })
})
