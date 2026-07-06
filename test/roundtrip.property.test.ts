import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeFields, encodeFieldValue, parseStructuredField, replaceField } from '../src/index.ts'

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

/** Assembles a content file the way Kirby's Txt handler would store it. */
function pageWith(encodedValue: string): string {
  return `Title: Demo\n\n----\n\nText: ${encodedValue}\n\n----\n\nUuid: fuzz\n`
}

describe('round-trip properties', () => {
  it('extraction recovers exactly what Kirby-encoded content stores', () => {
    fc.assert(fc.property(blocksArbitrary, (blocks) => {
      const page = pageWith(encodeFieldValue(blocks))
      const raw = decodeFields(page).find(field => field.name === 'Text')!
      const parsed = parseStructuredField(raw)
      expect(parsed?.type).toBe('blocks')
      expect(parsed?.value).toEqual(blocks)
    }))
  })

  it('re-injecting an unedited value is byte-identical', () => {
    fc.assert(fc.property(blocksArbitrary, (blocks) => {
      const page = pageWith(encodeFieldValue(blocks))
      const raw = decodeFields(page).find(field => field.name === 'Text')!
      const parsed = parseStructuredField(raw)!
      expect(replaceField(page, 'Text', encodeFieldValue(parsed.value))).toBe(page)
    }))
  })

  it('an edited value survives inject and re-extract with surroundings untouched', () => {
    fc.assert(fc.property(blocksArbitrary, blocksArbitrary, (blocks, edited) => {
      const page = pageWith(encodeFieldValue(blocks))
      const next = replaceField(page, 'Text', encodeFieldValue(edited))!
      const raw = decodeFields(next).find(field => field.name === 'Text')!
      expect(parseStructuredField(raw)?.value).toEqual(edited)
      expect(next.startsWith('Title: Demo\n\n----\n\nText: ')).toBe(true)
      expect(next.endsWith('\n\n----\n\nUuid: fuzz\n')).toBe(true)
    }))
  })
})
