import type {
  ContentBlock,
  LayoutRow,
  ParsedFilename,
  RawField,
  StructuredField,
  TreeFile,
} from './types.ts'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { CONTENT_ROOT_CANDIDATES } from './defaults.ts'

/** Mirrors Kirby's own `Txt` field divider. */
const FIELD_SEPARATOR = /\n----\s*/g

/** A `\----`-escaped divider at line start, as written by Kirby's `Txt::encodeValue`. */
const ESCAPED_DIVIDER = /(?<=^|\n)\\----/g

/** ISO-style language code, e.g. `en` or `en-us`. */
const LANGUAGE_CODE = /^[a-z]{2}(?:-[a-z]{2,})?$/

/** U+2028/U+2029 line separators, escaped to keep field values on one line. */
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/**
 * Splits Kirby `.txt` content into its raw `Key: value` fields, unescaping
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
 * Detects a serialized `blocks` or `layout` field by its value shape; ignores
 * YAML structures, scalars, and empty arrays.
 */
export function parseStructuredField(field: RawField): StructuredField | undefined {
  if (!field.value.startsWith('['))
    return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(field.value)
  }
  catch {
    return undefined
  }

  if (!Array.isArray(parsed) || parsed.length === 0)
    return undefined

  if (parsed.every(isLayoutRow))
    return { name: field.name, type: 'layout', value: parsed as LayoutRow[] }

  if (parsed.every(isContentBlock))
    return { name: field.name, type: 'blocks', value: parsed as ContentBlock[] }

  return undefined
}

/**
 * Replaces a single-line field value within `.txt` content, leaving every other
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
 * bracketed value; whitespace between the value and the next divider survives
 * so surrounding bytes stay put.
 */
function replaceChunkValue(chunk: string, name: string, value: string): string | undefined {
  const colonIndex = chunk.indexOf(':')
  if (colonIndex === -1 || chunk.slice(0, colonIndex).trim() !== name)
    return undefined

  // Tolerate trailing horizontal whitespace after the closing bracket so a
  // hand-edited line is still matched (and normalized) rather than skipped.
  const valueMatch = /^[^\S\n]*\[.*\][^\S\n]*(\n\s*)?$/.exec(chunk.slice(colonIndex + 1))
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

export function parseFilename(filename: string): ParsedFilename {
  const extension = path.extname(filename)
  const baseName = extension ? filename.slice(0, -extension.length) : filename
  const dotIndex = baseName.lastIndexOf('.')

  if (dotIndex !== -1) {
    const candidate = baseName.slice(dotIndex + 1)
    if (LANGUAGE_CODE.test(candidate))
      return { template: baseName.slice(0, dotIndex), lang: candidate }
  }

  return { template: baseName }
}

export function contentFilename(file: ParsedFilename, extension: string): string {
  return file.lang ? `${file.template}.${file.lang}${extension}` : `${file.template}${extension}`
}

/**
 * Recursively finds files with the given extension under `root`, each
 * decomposed into template and language and filtered by the optional lists.
 */
export async function findFiles(
  root: string,
  extension: string,
  filter: { langs?: string[], templates?: string[] } = {},
): Promise<TreeFile[]> {
  const { langs, templates } = filter
  const files: TreeFile[] = []

  for await (const entry of fsp.glob(`**/*${extension}`, { cwd: root, withFileTypes: true })) {
    if (!entry.isFile())
      continue

    const { template, lang } = parseFilename(entry.name)

    if (!matchesFilter(templates, template))
      continue
    if (langs && (!lang || !matchesFilter(langs, lang)))
      continue

    files.push({
      path: path.join(entry.parentPath, entry.name),
      folder: path.relative(root, entry.parentPath),
      template,
      lang,
    })
  }

  return files
}

/** Case-insensitive membership test for the field, language, and template filters. */
export function matchesFilter(filter: string[] | undefined, value: string): boolean {
  return !filter || filter.some(item => item.toLowerCase() === value.toLowerCase())
}

/**
 * Resolves the Kirby content root, using `explicit` when given, otherwise the
 * first conventional location that exists; throws if none do.
 */
export async function resolveContentRoot(
  explicit?: string,
  cwd: string = process.cwd(),
): Promise<string> {
  if (explicit) {
    const resolved = path.resolve(cwd, explicit)
    if (!(await isDirectory(resolved)))
      throw new Error(`Not a directory: ${resolved}`)
    return resolved
  }

  for (const candidate of CONTENT_ROOT_CANDIDATES) {
    const resolved = path.resolve(cwd, candidate)
    if (await isDirectory(resolved))
      return resolved
  }

  throw new Error(
    `No Kirby content directory found (tried ${CONTENT_ROOT_CANDIDATES.join(', ')})`,
  )
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isDirectory()
  }
  catch {
    return false
  }
}
