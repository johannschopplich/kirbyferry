import type { FieldMap } from '../src/index.ts'
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
  isWritableFieldValue,
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

  it('trims values like PHP trim, keeping a boundary NBSP that JS String.trim drops', () => {
    // ASCII space/tab/newline are stripped, but NBSP is not in PHP trim's charlist,
    // so Kirby keeps it – common in French typography and machine translation.
    const nbsp = String.fromCharCode(0xA0)
    const fields = decodeFields(`Author: \t${nbsp}Jane${nbsp} \n\n----\n\nUuid: x\n`)
    expect(fields[0]!.value).toBe(`${nbsp}Jane${nbsp}`)
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

describe('isWritableFieldValue', () => {
  it.each([
    { kind: 'a raw string', value: 'a plain value' },
    { kind: 'an empty string', value: '' },
    { kind: 'a blocks array', value: [{ id: 'a1', type: 'text', content: {}, isHidden: false }] },
    { kind: 'a layout array', value: [{ id: 'l1', columns: [] }] },
  ])('accepts $kind', ({ value }) => {
    expect(isWritableFieldValue(value)).toBe(true)
  })

  it.each([
    { kind: 'a number', value: 3 },
    { kind: 'a boolean', value: true },
    { kind: 'null', value: null },
    { kind: 'a plain object', value: { id: 'a1' } },
  ])('rejects $kind', ({ value }) => {
    expect(isWritableFieldValue(value)).toBe(false)
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

  it('returns undefined for an absent field', () => {
    expect(replaceField(SAMPLE_PAGE, 'Missing', '[]')).toBeUndefined()
  })

  it('rewrites a multi-line field, reframing it to a single line', () => {
    const next = replaceField(SAMPLE_PAGE, 'Footerlinks', '[]')
    expect(next).toContain('Footerlinks: []')
    expect(next).toContain('Uuid: abc123')
    // The old YAML body is gone, and the field divider framing is intact.
    expect(next).not.toContain('title: Example')
    expect(next).toContain('Footerlinks: []\n\n----\n\nUuid: abc123')
  })

  it('rewrites a value with multi-line content using blank-line framing', () => {
    const next = replaceField(SAMPLE_PAGE, 'Title', 'Line one\nLine two')!
    expect(next).toContain('Title:\n\nLine one\nLine two')
    expect(decodeFields(next).find(field => field.name === 'Title')!.value).toBe('Line one\nLine two')
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

  it('escapes a line-start ---- in a raw value and round-trips it without minting a field', () => {
    const seed = 'Notes: seed\n\n----\n\nUuid: x\n'
    const written = replaceField(seed, 'Notes', 'before\n----\nafter')!

    // The divider inside the value is escaped on disk, like Kirby's Txt::encodeValue.
    expect(written).toContain('\\----')
    const fields = decodeFields(written)
    expect(fields.map(field => field.name)).toEqual(['Notes', 'Uuid'])
    expect(fields.find(field => field.name === 'Notes')!.value).toBe('before\n----\nafter')
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
    ) as FieldMap
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

    it('keeps a live page dataset, whatever flags produced it', async () => {
      // Regression: an `--all` dataset for a page with no blocks/layout must
      // survive a later plain `extract --clean`. Staleness is decided by whether
      // the source `.txt` still exists, never by what the current run wrote, so a
      // forgotten `--all` can't silently delete un-injected edits.
      const { root, out } = workspace
      await fsp.mkdir(path.join(root, 'pages', 'about'), { recursive: true })
      await fsp.writeFile(path.join(root, 'pages', 'about', 'default.en.txt'), 'Title: About\n')

      await extractFields(root, { out, all: true })
      const scalarDataset = path.join(out, 'pages', 'about', 'default.en.json')
      await expect(fsp.access(scalarDataset)).resolves.toBeUndefined()

      const { cleanedDatasets } = await extractFields(root, { out, clean: true })
      expect(cleanedDatasets).toEqual([])
      await expect(fsp.access(scalarDataset)).resolves.toBeUndefined()
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
    const dataset = JSON.parse(await fsp.readFile(jsonPath, 'utf-8')) as FieldMap
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
    const dataset = JSON.parse(await fsp.readFile(jsonPath, 'utf-8')) as FieldMap
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

  it('aborts without writing when a dataset holds invalid JSON', async () => {
    const { root, out } = workspace
    await extractFields(root, { out })

    // Stage a valid edit alongside the broken dataset to prove atomicity.
    const dePath = path.join(out, 'pages', 'home', 'project.de.json')
    const dataset = JSON.parse(await fsp.readFile(dePath, 'utf-8')) as FieldMap
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
    const dataset = JSON.parse(await fsp.readFile(dePath, 'utf-8')) as FieldMap
    ;(dataset.Text![0] as unknown as { content: { text: string } }).content.text = '<p>Edited</p>'
    await fsp.writeFile(dePath, JSON.stringify(dataset))
    await fsp.writeFile(
      path.join(out, 'pages', 'home', 'project.en.json'),
      JSON.stringify({ Text: [{ foo: 1 }] }),
    )

    await expect(injectFields(root, { out })).rejects.toThrow(/unsupported value in .*project\.en\.json.*Text/i)
    const deContent = await fsp.readFile(path.join(root, 'pages', 'home', 'project.de.txt'), 'utf-8')
    expect(deContent).not.toContain('<p>Edited</p>')
  })

  it('aborts without writing when a dataset has no content file', async () => {
    const { root, out } = workspace
    await extractFields(root, { out })

    // Stage a real edit that a successful run would write back...
    const jsonPath = path.join(out, 'pages', 'home', 'project.en.json')
    const dataset = JSON.parse(await fsp.readFile(jsonPath, 'utf-8')) as FieldMap
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
    const dataset = JSON.parse(await fsp.readFile(jsonPath, 'utf-8')) as FieldMap
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

describe('whole tree (all fields)', () => {
  let workspace: { root: string, out: string }
  let fixture: string
  const pagePath = path.join('pages', 'example', 'page.txt')
  const datasetPath = path.join('pages', 'example', 'page.json')

  beforeEach(async () => {
    fixture = await fsp.readFile(path.join(fixturesDir, 'page.txt'), 'utf-8')
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-content-'))
    const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirbyferry-out-'))
    await fsp.mkdir(path.dirname(path.join(root, pagePath)), { recursive: true })
    await fsp.writeFile(path.join(root, pagePath), fixture)
    workspace = { root, out }
  })

  afterEach(() => removeWorkspace(workspace))

  async function readDataset(out: string): Promise<FieldMap> {
    return JSON.parse(await fsp.readFile(path.join(out, datasetPath), 'utf-8')) as FieldMap
  }

  it('extracts every field – blocks/layout as arrays, the rest as raw strings', async () => {
    const { root, out } = workspace
    const { results } = await extractFields(root, { out, all: true })

    expect(results[0]!.fields).toEqual(['Title', 'Text', 'Body', 'Links', 'Meta', 'Empty', 'Uuid'])

    const dataset = await readDataset(out)
    expect(Array.isArray(dataset.Text)).toBe(true)
    expect(Array.isArray(dataset.Body)).toBe(true)
    expect(dataset.Title).toBe('Lorem Ipsum')
    expect(dataset.Uuid).toBe('loremipsum000001')
    // YAML is kept verbatim, never decoded.
    expect(typeof dataset.Links).toBe('string')
    expect(dataset.Links).toContain('label: Lorem')
    // An empty array is a raw string, not a decoded (and skipped) blocks value.
    expect(dataset.Empty).toBe('[]')
  })

  it('re-injects the whole tree byte-for-byte when nothing is edited', async () => {
    const { root, out } = workspace
    await extractFields(root, { out, all: true })
    const results = await injectFields(root, { out })

    expect(results[0]!.hasChanged).toBe(false)
    expect(await fsp.readFile(path.join(root, pagePath), 'utf-8')).toBe(fixture)
  })

  it('rewrites a scalar field, leaving every other field untouched', async () => {
    const { root, out } = workspace
    await extractFields(root, { out, all: true })

    const dataset = await readDataset(out)
    dataset.Title = 'Edited Title'
    await fsp.writeFile(path.join(out, datasetPath), JSON.stringify(dataset))

    const results = await injectFields(root, { out })
    expect(results[0]!.fields).toEqual(['Title'])

    const content = await fsp.readFile(path.join(root, pagePath), 'utf-8')
    expect(content).toMatch(/^Title: Edited Title$/m)
    expect(content).toContain('Uuid: loremipsum000001')
    expect(content).toContain('label: Lorem')
    expect(content).toMatch(/^Text: \[\{.*\}\]$/m)
  })

  it('rewrites a YAML field verbatim without re-encoding, leaving neighbours untouched', async () => {
    const { root, out } = workspace
    await extractFields(root, { out, all: true })

    const dataset = await readDataset(out)
    dataset.Links = (dataset.Links as string).replace('Lorem', 'Edited')
    await fsp.writeFile(path.join(out, datasetPath), JSON.stringify(dataset))

    const results = await injectFields(root, { out })
    expect(results[0]!.fields).toEqual(['Links'])

    const content = await fsp.readFile(path.join(root, pagePath), 'utf-8')
    // The edited YAML is spliced back with multi-line framing.
    expect(content).toContain('Links:\n\n-\n  label: Edited')
    // The object field and the blocks field are untouched.
    expect(content).toContain('description: Dolor sit amet consectetur.')
    expect(content).toContain('Consectetur Adipiscing')
  })

  it('aborts without writing when a value is a number', async () => {
    const { root, out } = workspace
    await extractFields(root, { out, all: true })
    await fsp.writeFile(path.join(out, datasetPath), JSON.stringify({ Uuid: 5 }))

    await expect(injectFields(root, { out })).rejects.toThrow(/unsupported value/i)
    expect(await fsp.readFile(path.join(root, pagePath), 'utf-8')).toBe(fixture)
  })

  it('aborts without writing when the content file has a duplicate field', async () => {
    const { root, out } = workspace
    const dupPath = path.join('pages', 'dup', 'page.txt')
    await fsp.mkdir(path.dirname(path.join(root, dupPath)), { recursive: true })
    await fsp.writeFile(path.join(root, dupPath), 'Title: One\n\n----\n\nTitle: Two\n\n----\n\nUuid: d\n')

    await extractFields(root, { out, all: true })

    const dupDataset = path.join(out, 'pages', 'dup', 'page.json')
    await fsp.writeFile(dupDataset, JSON.stringify({ Title: 'Edited' }))

    await expect(injectFields(root, { out })).rejects.toThrow(/duplicate field/i)
  })

  it('injects normally when the duplicated field is not the one being edited', async () => {
    const { root, out } = workspace
    const dupPath = path.join('pages', 'dup2', 'page.txt')
    await fsp.mkdir(path.dirname(path.join(root, dupPath)), { recursive: true })
    await fsp.writeFile(path.join(root, dupPath), 'Title: One\n\n----\n\nTitle: Two\n\n----\n\nUuid: keep\n')

    await extractFields(root, { out, all: true })

    // Editing only Uuid leaves the ambiguous Title alone, so the abort must not fire.
    const dupDataset = path.join(out, 'pages', 'dup2', 'page.json')
    await fsp.writeFile(dupDataset, JSON.stringify({ Uuid: 'edited' }))

    const results = await injectFields(root, { out })
    expect(results.find(result => result.target.includes('dup2'))?.fields).toEqual(['Uuid'])

    const content = await fsp.readFile(path.join(root, dupPath), 'utf-8')
    expect(content).toContain('Uuid: edited')
    expect(content).toContain('Title: One')
    expect(content).toContain('Title: Two')
  })

  it('aborts on a duplicate that only collides under Kirby key normalization', async () => {
    const { root, out } = workspace
    const dupPath = path.join('pages', 'slug', 'page.txt')
    await fsp.mkdir(path.dirname(path.join(root, dupPath)), { recursive: true })
    // Hero-image and Hero_image are one last-wins field to Kirby, two lines on disk.
    await fsp.writeFile(path.join(root, dupPath), 'Hero-image: a\n\n----\n\nHero_image: b\n\n----\n\nUuid: s\n')

    await extractFields(root, { out, all: true })

    const dupDataset = path.join(out, 'pages', 'slug', 'page.json')
    await fsp.writeFile(dupDataset, JSON.stringify({ 'Hero-image': 'edited' }))

    await expect(injectFields(root, { out })).rejects.toThrow(/duplicate field/i)
  })

  it('skips ignored fields on extract and on inject', async () => {
    const { root, out } = workspace
    const { results } = await extractFields(root, { out, all: true, ignore: ['uuid', 'empty'] })
    expect(results[0]!.fields).toEqual(['Title', 'Text', 'Body', 'Links', 'Meta'])

    // Re-extract everything, then edit both Title and Uuid, but ignore Uuid on inject.
    await extractFields(root, { out, all: true })
    const dataset = await readDataset(out)
    dataset.Title = 'Edited Title'
    dataset.Uuid = 'edited-uuid'
    await fsp.writeFile(path.join(out, datasetPath), JSON.stringify(dataset))

    const injectResults = await injectFields(root, { out, ignore: ['uuid'] })
    expect(injectResults[0]!.fields).toEqual(['Title'])

    const content = await fsp.readFile(path.join(root, pagePath), 'utf-8')
    expect(content).toContain('Title: Edited Title')
    expect(content).toContain('Uuid: loremipsum000001')
    expect(content).not.toContain('edited-uuid')
  })
})
