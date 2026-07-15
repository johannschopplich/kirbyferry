import type { ExtractOptions, ExtractReport, ExtractResult, FieldMap, FilterOptions } from './types.ts'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { DEFAULT_OUT_DIR } from './defaults.ts'
import { decodeFields, parseStructuredField } from './kirby.ts'
import { fileExists, findFiles, isDirectory } from './utils/fs.ts'
import { contentFilename, isExcluded, matchesFilter } from './utils/tree.ts'

/**
 * Extracts `blocks` and `layout` fields into JSON. With `all`, every other field
 * is extracted too – as its raw string, since YAML `structure`/`object` fields
 * are never decoded.
 */
export async function extractFields(
  contentRoot: string,
  options: ExtractOptions = {},
): Promise<ExtractReport> {
  const { out = DEFAULT_OUT_DIR, langs, fields, ignore, templates, all = false, clean = false } = options
  const outDir = path.resolve(out)
  const results: ExtractResult[] = []

  for (const file of await findFiles(contentRoot, '.txt', { langs, templates })) {
    const content = await fsp.readFile(file.path, 'utf-8')
    const fieldMap: FieldMap = {}

    for (const rawField of decodeFields(content)) {
      if (!matchesFilter(fields, rawField.name) || isExcluded(ignore, rawField.name))
        continue

      const field = parseStructuredField(rawField)
      if (field)
        fieldMap[field.name] = field.value
      else if (all)
        // A duplicate key collapses last-wins, mirroring Kirby's own decode.
        fieldMap[rawField.name] = rawField.value
    }

    const fieldNames = Object.keys(fieldMap)
    if (fieldNames.length === 0)
      continue

    const datasetPath = path.join(file.folder, contentFilename(file, '.json'))
    const outputPath = path.join(outDir, datasetPath)

    await fsp.mkdir(path.dirname(outputPath), { recursive: true })
    await fsp.writeFile(outputPath, `${JSON.stringify(fieldMap, undefined, 2)}\n`)

    results.push({
      source: path.relative(contentRoot, file.path),
      output: datasetPath,
      fields: fieldNames,
    })
  }

  const cleanedDatasets = clean
    ? await removeStaleDatasets(outDir, contentRoot, { langs, templates })
    : []

  return { results, cleanedDatasets }
}

/**
 * Removes datasets whose backing content file no longer exists – the page was
 * renamed or deleted. The language/template filter scopes which datasets are
 * considered; a dataset whose source still exists is always kept.
 */
async function removeStaleDatasets(
  outDir: string,
  contentRoot: string,
  { langs, templates }: FilterOptions,
): Promise<string[]> {
  if (!(await isDirectory(outDir)))
    return []

  const cleanedDatasets: string[] = []

  for (const file of await findFiles(outDir, '.json', { langs, templates })) {
    const sourcePath = path.join(contentRoot, file.folder, contentFilename(file, '.txt'))
    if (await fileExists(sourcePath))
      continue

    await fsp.rm(file.path)
    cleanedDatasets.push(path.join(file.folder, contentFilename(file, '.json')))
  }

  return cleanedDatasets
}
