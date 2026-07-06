import type { ExtractOptions, ExtractReport, ExtractResult, FilterOptions, StructuredFieldMap } from './types.ts'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { DEFAULT_OUT_DIR } from './defaults.ts'
import { contentFilename, decodeFields, findFiles, isDirectory, matchesFilter, parseStructuredField } from './kirby.ts'

/**
 * Extracts every `blocks`/`layout` field from the content tree into
 * pretty-printed JSON, mirroring the source folders under `out` as field-keyed
 * maps.
 */
export async function extractFields(
  contentRoot: string,
  options: ExtractOptions = {},
): Promise<ExtractReport> {
  const { out = DEFAULT_OUT_DIR, langs, fields, templates, clean = false } = options
  const outDir = path.resolve(out)
  const results: ExtractResult[] = []
  const written = new Set<string>()

  for (const file of await findFiles(contentRoot, '.txt', { langs, templates })) {
    const content = await fsp.readFile(file.path, 'utf-8')
    const map: StructuredFieldMap = {}

    for (const raw of decodeFields(content)) {
      if (!matchesFilter(fields, raw.name))
        continue

      const field = parseStructuredField(raw)
      if (field)
        map[field.name] = field.value
    }

    const names = Object.keys(map)
    if (names.length === 0)
      continue

    const output = path.join(file.folder, contentFilename(file, '.json'))
    const outputPath = path.join(outDir, output)

    await fsp.mkdir(path.dirname(outputPath), { recursive: true })
    await fsp.writeFile(outputPath, `${JSON.stringify(map, undefined, 2)}\n`)
    written.add(output)

    results.push({
      source: path.relative(contentRoot, file.path),
      output,
      fields: names,
    })
  }

  const cleaned = clean
    ? await cleanStaleDatasets(outDir, written, { langs, fields, templates })
    : []

  return { results, cleaned }
}

/**
 * Deletes dataset files this run did not produce, but only those the current
 * filters own: language/template-matched and, when a field filter is active,
 * containing at least one matching key. Unreadable JSON is left in place –
 * deleting what cannot be understood risks destroying edits.
 */
async function cleanStaleDatasets(
  outDir: string,
  written: Set<string>,
  { langs, fields, templates }: FilterOptions,
): Promise<string[]> {
  if (!(await isDirectory(outDir)))
    return []

  const cleaned: string[] = []

  for (const file of await findFiles(outDir, '.json', { langs, templates })) {
    const dataset = path.join(file.folder, contentFilename(file, '.json'))
    if (written.has(dataset))
      continue

    if (fields) {
      let map: StructuredFieldMap
      try {
        map = JSON.parse(await fsp.readFile(file.path, 'utf-8')) as StructuredFieldMap
      }
      catch {
        continue
      }

      if (!Object.keys(map).some(name => matchesFilter(fields, name)))
        continue
    }

    await fsp.rm(file.path)
    cleaned.push(dataset)
  }

  return cleaned
}
