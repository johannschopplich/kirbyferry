/** A raw `Key: value` field parsed from a Kirby `.txt` content file. */
export interface RawField {
  /** Field key exactly as written in the file (e.g. `Text`). */
  name: string
  /** Field value with surrounding whitespace trimmed. */
  value: string
}

/** A content file path decomposed into its template and optional language. */
export interface ParsedFilename {
  /** Template name (the filename without the language and extension). */
  template: string
  /** Language code, or `undefined` for single-language sites. */
  lang?: string
}

/** A located content or dataset file with its position in the tree. */
export interface TreeFile {
  /** Absolute path to the file. */
  path: string
  /** Directory of the file relative to its root. */
  folder: string
  /** Template name. */
  template: string
  /** Language code, or `undefined` for single-language sites. */
  lang?: string
}

/** A single block within a `blocks` field. */
export interface ContentBlock {
  id: string
  type: string
  content: Record<string, unknown>
  isHidden: boolean
}

/** A single row within a `layout` field. */
export interface LayoutRow {
  id: string
  columns: unknown[]
  attrs?: Record<string, unknown>
}

/** The detected type of a sniffed field value. */
export type FieldType = 'blocks' | 'layout'

/** A field whose value is serialized `blocks` or `layout` JSON. */
export interface StructuredField {
  /** Field key exactly as written in the `.txt` file. */
  name: string
  /** Detected field type. */
  type: FieldType
  /** Parsed field value. */
  value: ContentBlock[] | LayoutRow[]
}

/** Field-keyed map written to / read from an extracted JSON file. */
export type StructuredFieldMap = Record<string, ContentBlock[] | LayoutRow[]>

/** Selection filters shared by extract and inject. */
export interface FilterOptions {
  /** Directory holding the extracted JSON (default: `content-fields`). */
  out?: string
  /** Language codes to include (default: all detected). */
  langs?: string[]
  /** Field names to include (default: all blocks/layout fields). */
  fields?: string[]
  /** Template names to include (default: all). */
  templates?: string[]
}

export interface ExtractOptions extends FilterOptions {
  /** Remove stale dataset files within the filter scope after extracting. */
  clean?: boolean
}

export interface InjectOptions extends FilterOptions {
  /** Report changes without writing files. */
  dryRun?: boolean
}

/** Result of extracting one content file. */
export interface ExtractResult {
  /** Source `.txt` path relative to the content root. */
  source: string
  /** Written JSON path relative to the output directory. */
  output: string
  /** Names of the extracted fields. */
  fields: string[]
}

/** Outcome of one extract run. */
export interface ExtractReport {
  /** One entry per written JSON file. */
  results: ExtractResult[]
  /** Stale dataset files removed by `clean`, relative to the output directory. */
  cleanedDatasets: string[]
}

/** Result of injecting one JSON file back into its content file. */
export interface InjectResult {
  /** Target `.txt` path relative to the content root. */
  target: string
  /** Names of the fields written back. */
  fields: string[]
  /** Names present in the JSON that could not be injected. */
  skippedFields: string[]
  /** Whether the content file actually changed. */
  hasChanged: boolean
}
