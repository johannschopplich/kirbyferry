import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeFields, encodeFieldValue, parseStructuredField, replaceField } from '../src/index.ts'
import { trimKirby } from '../src/kirby.ts'

const hostileString = fc.oneof(
  fc.string(),
  fc.constantFrom(
    '----',
    '\\----',
    '\u2028line\u2029separators',
    '$& $1 $$ $<key>',
    'brackets ][ inside',
    'a\nmulti\nline\nvalue',
    'café ☕ – emoji & diacritics',
    '<p>html &amp; "quotes" \'single\'</p>',
    'Text: [1, 2]',
  ),
)

const contentValue = fc.oneof(hostileString, fc.integer(), fc.boolean(), fc.constant(null))

const blockArbitrary = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('text', 'heading', 'image', 'gallery'),
  content: fc.dictionary(
    fc.string({ minLength: 1 }).filter(key => key !== '__proto__'),
    contentValue,
    { maxKeys: 4 },
  ),
  isHidden: fc.boolean(),
})

const blocksArbitrary = fc.array(blockArbitrary, { minLength: 1, maxLength: 5 })

/**
 * Raw (non-JSON) field values, minus a literal `\----`: that sequence is lossy in
 * Kirby's own format (decode always unescapes it, encode never re-escapes it), so
 * it is out of scope for a byte-faithful round-trip.
 */
const rawFieldValue = fc.oneof(
  fc.string(),
  fc.constantFrom(
    '----',
    '----\nsecond line',
    '\u2028line\u2029separators',
    '$& $1 $$ $<key>',
    'brackets ][ inside',
    'a\nmulti\nline\nvalue',
    'café ☕ – emoji & diacritics',
    '<p>html &amp; "quotes" \'single\'</p>',
    'Text: [1, 2]',
    'trailing spaces   ',
  ),
).filter(value => !value.includes('\\----'))

/** A seed page whose `Text` field can be overwritten with an arbitrary value. */
const RAW_SEED = 'Title: Demo\n\n----\n\nText: seed\n\n----\n\nUuid: fuzz\n'

/** Assembles a content file the way Kirby's Txt handler would store it. */
function pageWith(encodedValue: string): string {
  return `Title: Demo\n\n----\n\nText: ${encodedValue}\n\n----\n\nUuid: fuzz\n`
}

describe('round-trip properties', () => {
  it('decoding recovers the exact blocks that were encoded', () => {
    fc.assert(fc.property(blocksArbitrary, (blocks) => {
      const page = pageWith(encodeFieldValue(blocks))
      const rawField = decodeFields(page).find(field => field.name === 'Text')!
      const parsedField = parseStructuredField(rawField)
      expect(parsedField?.type).toBe('blocks')
      expect(parsedField?.value).toEqual(blocks)
    }))
  })

  it('re-injecting an unedited value is byte-identical', () => {
    fc.assert(fc.property(blocksArbitrary, (blocks) => {
      const page = pageWith(encodeFieldValue(blocks))
      const rawField = decodeFields(page).find(field => field.name === 'Text')!
      const parsedField = parseStructuredField(rawField)!
      expect(replaceField(page, 'Text', encodeFieldValue(parsedField.value))).toBe(page)
    }))
  })

  it('applies an edit while leaving surrounding fields untouched', () => {
    fc.assert(fc.property(blocksArbitrary, blocksArbitrary, (blocks, editedBlocks) => {
      const page = pageWith(encodeFieldValue(blocks))
      const next = replaceField(page, 'Text', encodeFieldValue(editedBlocks))!
      const rawField = decodeFields(next).find(field => field.name === 'Text')!
      expect(parseStructuredField(rawField)?.value).toEqual(editedBlocks)
      expect(next.startsWith('Title: Demo\n\n----\n\nText: ')).toBe(true)
      expect(next.endsWith('\n\n----\n\nUuid: fuzz\n')).toBe(true)
    }))
  })
})

describe('raw string round-trip properties', () => {
  it('recovers an arbitrary raw value (trimmed like Kirby) without minting a field', () => {
    fc.assert(fc.property(rawFieldValue, (raw) => {
      const written = replaceField(RAW_SEED, 'Text', raw)!
      const fields = decodeFields(written)
      expect(fields.map(field => field.name)).toEqual(['Title', 'Text', 'Uuid'])
      expect(fields.find(field => field.name === 'Text')!.value).toBe(trimKirby(raw))
    }))
  })

  it('re-writing a raw value with its decoded form is byte-identical', () => {
    fc.assert(fc.property(rawFieldValue, (raw) => {
      const page = replaceField(RAW_SEED, 'Text', raw)!
      const stored = decodeFields(page).find(field => field.name === 'Text')!.value
      expect(replaceField(page, 'Text', stored)).toBe(page)
    }))
  })
})
