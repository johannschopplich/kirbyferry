import type {
  ContentBlock,
  LayoutRow,
  RawField,
  StructuredField,
} from './types.ts'
import { isObject } from './utils/json.ts'

/** Mirrors Kirby's own `Txt` field divider. */
const FIELD_SEPARATOR = /\n----\s*/g

/** A `\----`-escaped divider at line start, as written by Kirby's `Txt::encodeValue`. */
const ESCAPED_DIVIDER = /(?<=^|\n)\\----/g

/** U+2028/U+2029 line separators, escaped to keep field values on one line. */
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/**
 * Splits Kirby content-file text into its raw `Key: value` fields, unescaping
 * `\----` dividers like Kirby's `Txt::decode`; values are otherwise returned
 * verbatim so callers decide how to interpret them.
 */
export function decodeFields(content: string): RawField[] {
  const fields: RawField[] = []

  for (const chunk of content.split(FIELD_SEPARATOR)) {
    const colonIndex = chunk.indexOf(':')
    if (colonIndex === -1)
      continue

    const name = chunk.slice(0, colonIndex).trim()
    if (!name)
      continue

    const value = chunk.slice(colonIndex + 1).trim().replace(ESCAPED_DIVIDER, '----')
    fields.push({ name, value })
  }

  return fields
}

/**
 * Sniffs a serialized `blocks` or `layout` value by shape; returns `undefined`
 * for YAML structures, scalars, and empty arrays – anything inject must not touch.
 */
export function parseStructuredField(field: RawField): StructuredField | undefined {
  if (!field.value.startsWith('['))
    return undefined

  let parsedValue: unknown
  try {
    parsedValue = JSON.parse(field.value)
  }
  catch {
    return undefined
  }

  if (!Array.isArray(parsedValue) || parsedValue.length === 0)
    return undefined

  if (parsedValue.every(isLayoutRow))
    return { name: field.name, type: 'layout', value: parsedValue as LayoutRow[] }

  if (parsedValue.every(isContentBlock))
    return { name: field.name, type: 'blocks', value: parsedValue as ContentBlock[] }

  return undefined
}

/**
 * Replaces a single-line field value within a content file, leaving every other
 * field untouched; returns `undefined` if the field is absent or stored across
 * multiple lines. Candidates are bounded by Kirby's field divider, so a
 * look-alike `Name: [...]` line inside another field's multiline value can
 * never be rewritten.
 */
export function replaceField(content: string, name: string, value: string): string | undefined {
  if (!name)
    return undefined

  let chunkStart = 0

  for (const separator of content.matchAll(FIELD_SEPARATOR)) {
    const rewrittenChunk = replaceChunkValue(content.slice(chunkStart, separator.index), name, value)
    if (rewrittenChunk !== undefined)
      return content.slice(0, chunkStart) + rewrittenChunk + content.slice(separator.index)

    chunkStart = separator.index + separator[0].length
  }

  const rewrittenChunk = replaceChunkValue(content.slice(chunkStart), name, value)
  return rewrittenChunk === undefined ? undefined : content.slice(0, chunkStart) + rewrittenChunk
}

/**
 * Rewrites one field chunk if it belongs to `name` and holds a single-line
 * bracketed value; the line terminator – a bare `\r` on CRLF content, or the
 * whitespace between the value and the next divider – survives so surrounding
 * bytes stay put.
 */
function replaceChunkValue(chunk: string, name: string, value: string): string | undefined {
  const colonIndex = chunk.indexOf(':')
  if (colonIndex === -1 || chunk.slice(0, colonIndex).trim() !== name)
    return undefined

  // Drop stray horizontal whitespace after the closing bracket so a hand-edited
  // line is still matched and normalized, but keep the line ending: a trailing
  // `\r` (CRLF divider) or `\n…` must be re-emitted, or rewriting one field would
  // flip it to LF and leave the file with mixed endings.
  const valueMatch = /^[^\S\n]*\[.*\][^\S\r\n]*(\r?\n\s*|\r)?$/.exec(chunk.slice(colonIndex + 1))
  if (!valueMatch)
    return undefined

  return `${chunk.slice(0, colonIndex + 1)} ${value}${valueMatch[1] ?? ''}`
}

/**
 * Serializes a value like Kirby's `json_encode` with
 * `JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE`, but escapes the
 * U+2028/U+2029 line separators; JS `JSON.stringify` emits those two raw,
 * which would split the value across lines and break the single-line round-trip.
 */
export function encodeFieldValue(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll(LINE_SEPARATOR, '\\u2028')
    .replaceAll(PARAGRAPH_SEPARATOR, '\\u2029')
}

/**
 * Accepts what inject may safely write back: an empty array (clears the field)
 * or a homogeneous blocks/layout array.
 */
export function isStructuredFieldValue(value: unknown): value is ContentBlock[] | LayoutRow[] {
  return Array.isArray(value)
    && (value.length === 0 || value.every(isLayoutRow) || value.every(isContentBlock))
}

function isLayoutRow(item: unknown): boolean {
  return isObject(item) && Array.isArray(item.columns) && !('type' in item)
}

function isContentBlock(item: unknown): boolean {
  return isObject(item) && typeof item.type === 'string' && 'content' in item && !('columns' in item)
}
