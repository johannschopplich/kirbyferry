import type { StructuredFieldMap } from '../src/index.ts'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decodeFields,
  encodeFieldValue,
  extractFields,
  injectFields,
  isStructuredFieldValue,
  parseFilename,
  parseStructuredField,
  replaceField,
} from '../src/index.ts'

const fixturesDir = path.resolve(import.meta.dirname, 'fixtures')

/** U+2028/U+2029, the separators JS leaves raw but Kirby escapes. */
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

// The `$5 & co` text exercises `$`-sequence handling on inject.
const SAMPLE_PAGE = `Title: Demo

----

Text: [{"content":{"text":"<p>Hello $5 & co</p>"},"id":"a1","isHidden":false,"type":"text"}]

----

Footerlinks:

-
  title: Example
  url: 'https://example.com'

----

Uuid: abc123
`

async function makeWorkspace(): Promise<{ root: string, out: string }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-content-'))
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-out-'))
  await fsp.mkdir(path.join(root, 'pages', 'home'), { recursive: true })
  await fsp.writeFile(path.join(root, 'pages', 'home', 'project.en.txt'), SAMPLE_PAGE)
  await fsp.writeFile(path.join(root, 'pages', 'home', 'project.de.txt'), SAMPLE_PAGE)
  return { root, out }
}

async function removeWorkspace({ root, out }: { root: string, out: string }): Promise<void> {
  await fsp.rm(root, { recursive: true, force: true })
  await fsp.rm(out, { recursive: true, force: true })
}

describe('decodeFields', () => {
  it('splits fields on the ---- separator and first colon', () => {
    const fields = decodeFields(SAMPLE_PAGE)
    const names = fields.map(field => field.name)
    expect(names).toEqual(['Title', 'Text', 'Footerlinks', 'Uuid'])
    expect(fields[0]!.value).toBe('Demo')
  })

  it('unescapes \\---- dividers like Kirby Txt::decode', () => {
    const fields = decodeFields('Notes:\n\n\\---- not a divider\nplain\n\n----\n\nUuid: x\n')
    expect(fields.map(field => field.name)).toEqual(['Notes', 'Uuid'])
    expect(fields[0]!.value).toBe('---- not a divider\nplain')
  })
})

describe('parseStructuredField', () => {
  it('detects a blocks field by value shape', () => {
    const [, text] = decodeFields(SAMPLE_PAGE)
    const field = parseStructuredField(text!)
    expect(field?.type).toBe('blocks')
    expect(field?.value).toHaveLength(1)
  })

  it('detects a layout field by value shape', () => {
    const value = '[{"id":"l1","columns":[{"width":"1/1","blocks":[]}]}]'
    expect(parseStructuredField({ name: 'Body', value })?.type).toBe('layout')
  })

  it.each([
    { kind: 'YAML structure fields', field: decodeFields(SAMPLE_PAGE).find(field => field.name === 'Footerlinks')! },
    { kind: 'scalars', field: { name: 'Uuid', value: 'abc123' } },
    { kind: 'empty arrays', field: { name: 'Empty', value: '[]' } },
  ])('ignores $kind', ({ field }) => {
    expect(parseStructuredField(field)).toBeUndefined()
  })
})

describe('isStructuredFieldValue', () => {
  it.each([
    { kind: 'an empty array', value: [] },
    { kind: 'a blocks array', value: [{ id: 'a1', type: 'text', content: {}, isHidden: false }] },
    { kind: 'a layout array', value: [{ id: 'l1', columns: [] }] },
  ])('accepts $kind', ({ value }) => {
    expect(isStructuredFieldValue(value)).toBe(true)
  })

  it.each([
    { kind: 'a scalar', value: 'text' },
    { kind: 'a plain object', value: { id: 'a1' } },
    { kind: 'an array of non-blocks', value: [{ foo: 1 }] },
    { kind: 'a block missing its content', value: [{ id: 'a1', type: 'text' }] },
    { kind: 'a mixed blocks/layout array', value: [{ id: 'a1', type: 'text', content: {} }, { id: 'l1', columns: [] }] },
  ])('rejects $kind', ({ value }) => {
    expect(isStructuredFieldValue(value)).toBe(false)
  })
})

describe('encodeFieldValue', () => {
  it('escapes U+2028/U+2029 so the value stays on a single line', () => {
    const encodedValue = encodeFieldValue([{ content: { text: `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c` } }])
    expect(encodedValue).toContain('\\u2028')
    expect(encodedValue).toContain('\\u2029')
    expect(encodedValue).not.toContain(LINE_SEPARATOR)
    expect(encodedValue).not.toContain(PARAGRAPH_SEPARATOR)
  })

  it('leaves slashes raw, matching Kirby json_encode', () => {
    expect(encodeFieldValue({ url: 'https://example.com/a' })).toBe('{"url":"https://example.com/a"}')
  })
})

describe('parseFilename', () => {
  it.each([
    { filename: 'project.en.txt', expected: { template: 'project', lang: 'en' } },
    { filename: 'project.en-us.json', expected: { template: 'project', lang: 'en-us' } },
    { filename: 'default.txt', expected: { template: 'default' } },
  ])('parses $filename', ({ filename, expected }) => {
    expect(parseFilename(filename)).toEqual(expected)
  })
})

describe('replaceField', () => {
  it('replaces only the targeted single-line field', () => {
    const next = replaceField(SAMPLE_PAGE, 'Text', '[]')
    expect(next).toContain('Text: []')
    expect(next).toContain('Title: Demo')
    expect(next).toContain('Footerlinks:')
  })

  it('does not interpret $ sequences in the replacement value', () => {
    const value = '[{"x":"$& $1 $$"}]'
    const next = replaceField(SAMPLE_PAGE, 'Text', value)
    expect(next).toContain(`Text: ${value}`)
  })

  it('matches a field with trailing whitespace after the closing bracket', () => {
    expect(replaceField('Text: [1,2]   \n', 'Text', '[9]')).toBe('Text: [9]\n')
  })

  it('preserves CRLF line endings instead of leaving the file mixed', () => {
    const crlf = 'Title: Hi\r\n----\r\nText: [{"a":1}]\r\n----\r\nUuid: x\r\n'
    expect(replaceField(crlf, 'Text', '[{"a":2}]'))
      .toBe('Title: Hi\r\n----\r\nText: [{"a":2}]\r\n----\r\nUuid: x\r\n')
  })

  it('returns undefined for absent or multi-line fields', () => {
    expect(replaceField(SAMPLE_PAGE, 'Missing', '[]')).toBeUndefined()
    expect(replaceField(SAMPLE_PAGE, 'Footerlinks', '[]')).toBeUndefined()
  })

  it('never rewrites a look-alike line inside another field, even one appearing first', () => {
    const content = 'Description:\n\nProse before.\nText: [1, 2]\nProse after.\n\n----\n\nText: [{"a":1}]\n'
    const next = replaceField(content, 'Text', '[9]')
    expect(next).toBe('Description:\n\nProse before.\nText: [1, 2]\nProse after.\n\n----\n\nText: [9]\n')
  })

  it('returns undefined when only a look-alike line exists, not the field itself', () => {
    const content = 'Description:\n\nText: [1, 2]\nProse after.\n'
    expect(replaceField(content, 'Text', '[9]')).toBeUndefined()
  })
})

describe('extractFields', () => {
  let workspace: { root: string, out: string }

  beforeEach(async () => {
    workspace = await makeWorkspace()
  })

  afterEach(() => removeWorkspace(workspace))

  it('extracts blocks fields into a mirrored field-keyed JSON tree', async () => {
    const { root, out } = workspace
    const { results, cleanedDatasets } = await extractFields(root, { out })

    expect(results).toHaveLength(2)
    expect(results[0]!.fields).toEqual(['Text'])
    expect(cleanedDatasets).toEqual([])

    const dataset = JSON.parse(
      await fsp.readFile(path.join(out, 'pages', 'home', 'project.en.json'), 'utf-8'),
    ) as StructuredFieldMap
    expect(Object.keys(dataset)).toEqual(['Text'])
    expect(dataset.Text).toHaveLength(1)
  })

  it('restricts extraction to the requested language', async () => {
    const { root, out } = workspace
    const { results } = await extractFields(root, { out, langs: ['en'] })
    expect(results).toHaveLength(1)
    expect(results[0]!.source).toContain('project.en.txt')
  })

  it('matches the field filter case-insensitively', async () => {
    const { root, out } = workspace
    const { results } = await extractFields(root, { out, fields: ['text'] })
    expect(results).toHaveLength(2)
    expect(results[0]!.fields).toEqual(['Text'])
  })

  describe('clean', () => {
    it('removes datasets whose source page vanished and reports them', async () => {
      const { root, out } = workspace
      await extractFields(root, { out })
      await fsp.rm(path.join(root, 'pages', 'home'), { recursive: true })

      const { results, cleanedDatasets } = await extractFields(root, { out, clean: true })
      expect(results).toEqual([])
      expect(cleanedDatasets.sort()).toEqual([
        path.join('pages', 'home', 'project.de.json'),
        path.join('pages', 'home', 'project.en.json'),
      ])
      await expect(fsp.access(path.join(out, 'pages', 'home', 'project.en.json'))).rejects.toThrow()
    })

    it('keeps datasets outside the language scope', async () => {
      const { root, out } = workspace
      await extractFields(root, { out })
      await fsp.rm(path.join(root, 'pages', 'home', 'project.de.txt'))

      const { cleanedDatasets } = await extractFields(root, { out, langs: ['de'], clean: true })
      expect(cleanedDatasets).toEqual([path.join('pages', 'home', 'project.de.json')])
      await expect(fsp.access(path.join(out, 'pages', 'home', 'project.en.json'))).resolves.toBeUndefined()
    })

    it('keeps datasets outside the field scope', async () => {
      const { root, out } = workspace
      await extractFields(root, { out })
      await fsp.rm(path.join(root, 'pages', 'home'), { recursive: true })

      const bodyScoped = await extractFields(root, { out, fields: ['Body'], clean: true })
      expect(bodyScoped.cleanedDatasets).toEqual([])

      const textScoped = await extractFields(root, { out, fields: ['text'], clean: true })
      expect(textScoped.cleanedDatasets).toHaveLength(2)
    })
  })
})

describe('injectFields', () => {
  let workspace: { root: string, out: string }

  beforeEach(async () => {
    workspace = await makeWorkspace()
  })

  afterEach(() => removeWorkspace(workspace))

  it('round-trips edited JSON back into content, minified, preserving other fields', async () => {
    const { root, out } = workspace
    await extractFields(root, { out })

    const jsonPath = path.join(out, 'pages', 'home', 'project.en.json')
    const dataset = JSON.parse(await fsp.readFile(jsonPath, 'utf-8')) as StructuredFieldMap
    ;(dataset.Text![0] as unknown as { content: { text: string } }).content.text = '<p>Edited</p>'
    await fsp.writeFile(jsonPath, JSON.stringify(dataset, undefined, 2))

    const results = await injectFields(root, { out, langs: ['en'] })
    expect(results[0]!.hasChanged).toBe(true)
    expect(results[0]!.fields).toEqual(['Text'])

    const updatedContent = await fsp.readFile(path.join(root, 'pages', 'home', 'project.en.txt'), 'utf-8')
    expect(updatedContent).toContain('<p>Edited</p>')
    expect(updatedContent).toContain('Title: Demo')
    expect(updatedContent).toContain('Footerlinks:')
    // Still a single minified line.
    expect(updatedContent).toMatch(/^Text: \[\{.*\}\]$/m)
  })

  it('reports the change but leaves the file unwritten in dry-run mode', async () => {
    const { root, out } = workspace
    await extractFields(root, { out })

    const jsonPath = path.join(out, 'pages', 'home', 'project.en.json')
    const dataset = JSON.parse(await fsp.readFile(jsonPath, 'utf-8')) as StructuredFieldMap
    ;(dataset.Text![0] as unknown as { content: { text: string } }).content.text = '<p>Edited</p>'
    await fsp.writeFile(jsonPath, JSON.stringify(dataset, undefined, 2))

    const results = await injectFields(root, { out, langs: ['en'], dryRun: true })
    expect(results[0]!.hasChanged).toBe(true)

    const untouchedContent = await fsp.readFile(path.join(root, 'pages', 'home', 'project.en.txt'), 'utf-8')
    expect(untouchedContent).not.toContain('<p>Edited</p>')
  })

  it('skips a dataset key whose case does not match the field in the file', async () => {
    const { root, out } = workspace
    const jsonPath = path.join(out, 'pages', 'home', 'project.en.json')
    await fsp.mkdir(path.dirname(jsonPath), { recursive: true })
    await fsp.writeFile(jsonPath, JSON.stringify({
      text: [{ id: 'a1', type: 'text', content: { text: '<p>Edited</p>' }, isHidden: false }],
    }))

    const results = await injectFields(root, { out, langs: ['en'] })
    expect(results[0]!.skippedFields).toEqual(['text'])
    expect(results[0]!.hasChanged).toBe(false)
  })

  it('injects an empty array to clear a field', async () => {
    const { root, out } = workspace
    await extractFields(root, { out })

    const jsonPath = path.join(out, 'pages', 'home', 'project.en.json')
    await fsp.writeFile(jsonPath, JSON.stringify({ Text: [] }))

    const results = await injectFields(root, { out, langs: ['en'] })
    expect(results[0]!.hasChanged).toBe(true)

    const updatedContent = await fsp.readFile(path.join(root, 'pages', 'home', 'project.en.txt'), 'utf-8')
    expect(updatedContent).toMatch(/^Text: \[\]$/m)
  })

  it('leaves legacy escaped-slash JSON untouched when values are unedited', async () => {
    const { root, out } = workspace
    // PHP json_encode without JSON_UNESCAPED_SLASHES, as written by older Kirby.
    const legacyPage = 'Text: [{"content":{"url":"https:\\/\\/example.com\\/a"},"id":"a1","isHidden":false,"type":"text"}]\n'
    const legacyPath = path.join(root, 'pages', 'home', 'legacy.en.txt')
    await fsp.writeFile(legacyPath, legacyPage)

    await extractFields(root, { out })
    const results = await injectFields(root, { out, templates: ['legacy'] })

    expect(results[0]!.hasChanged).toBe(false)
    expect(results[0]!.fields).toEqual([])
    expect(await fsp.readFile(legacyPath, 'utf-8')).toBe(legacyPage)
  })

  it('aborts without writing when a dataset holds invalid JSON', async () => {
    const { root, out } = workspace
    await extractFields(root, { out })

    // Stage a valid edit alongside the broken dataset to prove atomicity.
    const dePath = path.join(out, 'pages', 'home', 'project.de.json')
    const dataset = JSON.parse(await fsp.readFile(dePath, 'utf-8')) as StructuredFieldMap
    ;(dataset.Text![0] as unknown as { content: { text: string } }).content.text = '<p>Edited</p>'
    await fsp.writeFile(dePath, JSON.stringify(dataset))
    await fsp.writeFile(path.join(out, 'pages', 'home', 'project.en.json'), 'not json')

    await expect(injectFields(root, { out })).rejects.toThrow(/invalid json in .*project\.en\.json/i)
    const deContent = await fsp.readFile(path.join(root, 'pages', 'home', 'project.de.txt'), 'utf-8')
    expect(deContent).not.toContain('<p>Edited</p>')
  })

  it('aborts without writing when an edited value is no longer blocks or layout', async () => {
    const { root, out } = workspace
    await extractFields(root, { out })

    const dePath = path.join(out, 'pages', 'home', 'project.de.json')
    const dataset = JSON.parse(await fsp.readFile(dePath, 'utf-8')) as StructuredFieldMap
    ;(dataset.Text![0] as unknown as { content: { text: string } }).content.text = '<p>Edited</p>'
    await fsp.writeFile(dePath, JSON.stringify(dataset))
    await fsp.writeFile(
      path.join(out, 'pages', 'home', 'project.en.json'),
      JSON.stringify({ Text: [{ foo: 1 }] }),
    )

    await expect(injectFields(root, { out })).rejects.toThrow(/not a blocks\/layout value in .*project\.en\.json.*Text/i)
    const deContent = await fsp.readFile(path.join(root, 'pages', 'home', 'project.de.txt'), 'utf-8')
    expect(deContent).not.toContain('<p>Edited</p>')
  })

  it('aborts without writing when a dataset has no content file', async () => {
    const { root, out } = workspace
    await extractFields(root, { out })

    // Stage a real edit that a successful run would write back...
    const jsonPath = path.join(out, 'pages', 'home', 'project.en.json')
    const dataset = JSON.parse(await fsp.readFile(jsonPath, 'utf-8')) as StructuredFieldMap
    ;(dataset.Text![0] as unknown as { content: { text: string } }).content.text = '<p>Edited</p>'
    await fsp.writeFile(jsonPath, JSON.stringify(dataset, undefined, 2))

    // ...alongside a stale dataset whose content file does not exist.
    await fsp.mkdir(path.join(out, 'pages', 'ghost'), { recursive: true })
    await fsp.writeFile(path.join(out, 'pages', 'ghost', 'project.en.json'), JSON.stringify({ Text: [] }))

    const txtPath = path.join(root, 'pages', 'home', 'project.en.txt')
    const before = await fsp.readFile(txtPath, 'utf-8')

    await expect(injectFields(root, { out, langs: ['en'] })).rejects.toThrow(/no content file/i)
    // Atomic: the valid page is left untouched despite its pending edit.
    expect(await fsp.readFile(txtPath, 'utf-8')).toBe(before)
  })
})

describe('round-trip fidelity', () => {
  let workspace: { root: string, out: string }
  let fixture: string
  const pagePath = path.join('pages', 'example', 'page.txt')

  beforeEach(async () => {
    fixture = await fsp.readFile(path.join(fixturesDir, 'page.txt'), 'utf-8')
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-content-'))
    const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-out-'))
    await fsp.mkdir(path.dirname(path.join(root, pagePath)), { recursive: true })
    await fsp.writeFile(path.join(root, pagePath), fixture)
    workspace = { root, out }
  })

  afterEach(() => removeWorkspace(workspace))

  it('re-injects blocks and layout byte-for-byte when nothing is edited', async () => {
    const { root, out } = workspace
    await extractFields(root, { out })
    const results = await injectFields(root, { out })

    expect(results[0]!.hasChanged).toBe(false)
    expect(await fsp.readFile(path.join(root, pagePath), 'utf-8')).toBe(fixture)
  })

  it('extracts only blocks and layout, leaving YAML structure, object, and scalar fields untouched', async () => {
    const { root, out } = workspace
    const { results } = await extractFields(root, { out })

    expect(results[0]!.fields).toEqual(['Text', 'Body'])
    expect(await fsp.readFile(path.join(root, pagePath), 'utf-8')).toBe(fixture)
  })
})

describe('hostile fixture (corpus-derived edge cases)', () => {
  let workspace: { root: string, out: string }
  let fixture: string
  const pagePath = path.join('pages', 'hostile', 'default.txt')

  beforeEach(async () => {
    fixture = await fsp.readFile(path.join(fixturesDir, 'hostile.txt'), 'utf-8')
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-content-'))
    const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-out-'))
    await fsp.mkdir(path.dirname(path.join(root, pagePath)), { recursive: true })
    await fsp.writeFile(path.join(root, pagePath), fixture)
    workspace = { root, out }
  })

  afterEach(() => removeWorkspace(workspace))

  it('extracts only the real blocks/layout fields, ignoring look-alikes and nested JSON-in-YAML', async () => {
    const { root, out } = workspace
    const { results } = await extractFields(root, { out })
    expect(results[0]!.fields).toEqual(['Text', 'Body'])
  })

  it('edits the real field while every trap survives untouched', async () => {
    const { root, out } = workspace
    await extractFields(root, { out })

    const jsonPath = path.join(out, 'pages', 'hostile', 'default.json')
    const dataset = JSON.parse(await fsp.readFile(jsonPath, 'utf-8')) as StructuredFieldMap
    ;(dataset.Text![0] as unknown as { content: { text: string } }).content.text = '<p>Edited</p>'
    await fsp.writeFile(jsonPath, JSON.stringify(dataset))

    const results = await injectFields(root, { out })
    // Body is unedited, so only Text is rewritten.
    expect(results[0]!.fields).toEqual(['Text'])

    const updatedContent = await fsp.readFile(path.join(root, pagePath), 'utf-8')
    expect(updatedContent).toContain('<p>Edited</p>')
    // The look-alike line inside the Description field is not the Text field.
    expect(updatedContent).toContain('Prose before the trap.\nText: [1, 2]\nMore prose after.')
    // Nested JSON-in-YAML, indented empty arrays, and escaped dividers stay put.
    expect(updatedContent).toContain(`description: '[{"content"`)
    expect(updatedContent).toContain('  file: []')
    expect(updatedContent).toContain('\\---- not a divider')
    expect(updatedContent).toContain('Title: Wantalon: Curated Art Tours')
  })
})
