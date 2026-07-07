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
  const writtenDatasets = new Set<string>()

  for (const file of await findFiles(contentRoot, '.txt', { langs, templates })) {
    const content = await fsp.readFile(file.path, 'utf-8')
    const fieldMap: StructuredFieldMap = {}

    for (const rawField of decodeFields(content)) {
      if (!matchesFilter(fields, rawField.name))
        continue

      const field = parseStructuredField(rawField)
      if (field)
        fieldMap[field.name] = field.value
    }

    const fieldNames = Object.keys(fieldMap)
    if (fieldNames.length === 0)
      continue

    const datasetPath = path.join(file.folder, contentFilename(file, '.json'))
    const outputPath = path.join(outDir, datasetPath)

    await fsp.mkdir(path.dirname(outputPath), { recursive: true })
    await fsp.writeFile(outputPath, `${JSON.stringify(fieldMap, undefined, 2)}\n`)
    writtenDatasets.add(datasetPath)

    results.push({
      source: path.relative(contentRoot, file.path),
      output: datasetPath,
      fields: fieldNames,
    })
  }

  const cleaned = clean
    ? await cleanStaleDatasets(outDir, writtenDatasets, { langs, fields, templates })
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
  writtenDatasets: Set<string>,
  { langs, fields, templates }: FilterOptions,
): Promise<string[]> {
  if (!(await isDirectory(outDir)))
    return []

  const cleaned: string[] = []

  for (const file of await findFiles(outDir, '.json', { langs, templates })) {
    const datasetPath = path.join(file.folder, contentFilename(file, '.json'))
    if (writtenDatasets.has(datasetPath))
      continue

    if (fields) {
      let fieldMap: StructuredFieldMap
      try {
        fieldMap = JSON.parse(await fsp.readFile(file.path, 'utf-8')) as StructuredFieldMap
      }
      catch {
        continue
      }

      if (!Object.keys(fieldMap).some(name => matchesFilter(fields, name)))
        continue
    }

    await fsp.rm(file.path)
    cleaned.push(datasetPath)
  }

  return cleaned
}
