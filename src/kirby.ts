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

/** The inverse of `ESCAPED_DIVIDER`: a line-start `----` that must be escaped on write. */
const UNESCAPED_DIVIDER = /(?<=^|\n)----/g

/**
 * Kirby's `\R` set, matched without `/u` (`preg_match('!\R!', …)`), so on UTF-8
 * content U+0085/U+2028/U+2029 are byte sequences, not breaks. Any of these forces
 * a value onto multiple lines (`Txt::encodeResult`).
 */
const LINE_BREAK = /\r\n|[\n\r\v\f]/

/** U+2028/U+2029 line separators, escaped to keep serialized JSON on one line. */
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/** PHP `trim()`'s default charlist: space, tab, CR, LF, NUL, vertical tab. */
const KIRBY_WHITESPACE = /^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g

/**
 * Trims a value with Kirby's PHP `trim()` semantics. JS `String.trim` would also
 * strip NBSP and other Unicode spaces Kirby keeps, silently altering a value's
 * boundary whitespace.
 */
export function trimKirby(value: string): string {
  return value.replace(KIRBY_WHITESPACE, '')
}

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

    const value = trimKirby(chunk.slice(colonIndex + 1)).replace(ESCAPED_DIVIDER, '----')
    fields.push({ name, value })
  }

  return fields
}

/**
 * Sniffs a serialized `blocks` or `layout` value by shape; returns `undefined`
 * for YAML structures, scalars, and empty arrays – none safe to re-encode as JSON.
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
 * Replaces a field's value in a content file, leaving every other field untouched;
 * returns `undefined` if the field is absent. Candidates are bounded by Kirby's
 * field divider, so a look-alike `Name: [...]` line inside another field's value
 * can never be rewritten.
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
 * Rewrites a field's value with Kirby's own framing – a space for single-line
 * values, a blank line for multi-line ones (`Txt::encodeResult`) – trimming and
 * re-escaping line-start `----` exactly as `Txt::encodeValue` does. The line
 * terminator before the next divider (a bare `\r` on CRLF content, or the newline
 * run) is preserved, so surrounding bytes are never disturbed.
 */
function replaceChunkValue(chunk: string, name: string, value: string): string | undefined {
  const colonIndex = chunk.indexOf(':')
  if (colonIndex === -1 || chunk.slice(0, colonIndex).trim() !== name)
    return undefined

  // Keep the terminator (from its first line break onward) but drop horizontal
  // whitespace on the value's own line, so a hand-edited `Key: value   ` and a
  // multi-line field both normalize the way Kirby's trim-on-encode would.
  const trailingWhitespace = /\s*$/.exec(chunk.slice(colonIndex + 1))![0]
  const lineBreak = LINE_BREAK.exec(trailingWhitespace)
  const terminator = lineBreak ? trailingWhitespace.slice(lineBreak.index) : ''

  const escapedValue = trimKirby(value).replace(UNESCAPED_DIVIDER, '\\----')
  const framing = LINE_BREAK.test(escapedValue) ? '\n\n' : ' '
  return `${chunk.slice(0, colonIndex + 1)}${framing}${escapedValue}${terminator}`
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

/** True for an empty array, or one whose items are all blocks or all layout rows – never a mix. */
export function isStructuredFieldValue(value: unknown): value is ContentBlock[] | LayoutRow[] {
  return Array.isArray(value)
    && (value.length === 0 || value.every(isLayoutRow) || value.every(isContentBlock))
}

/** Whether a value can be serialized back into a content file. */
export function isWritableFieldValue(value: unknown): value is string | ContentBlock[] | LayoutRow[] {
  return typeof value === 'string' || isStructuredFieldValue(value)
}

function isLayoutRow(item: unknown): boolean {
  return isObject(item) && Array.isArray(item.columns) && !('type' in item)
}

function isContentBlock(item: unknown): boolean {
  return isObject(item) && typeof item.type === 'string' && 'content' in item && !('columns' in item)
}
