import type { FieldMap, InjectOptions, InjectResult } from './types.ts'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { DEFAULT_OUT_DIR } from './defaults.ts'
import { decodeFields, encodeFieldValue, isWritableFieldValue, replaceField, trimKirby } from './kirby.ts'
import { findFiles } from './utils/fs.ts'
import { contentFilename, isExcluded, matchesFilter } from './utils/tree.ts'

/**
 * Rewrites only the lines of fields that actually changed, so everything else in
 * each content file survives byte-for-byte. One invalid or orphaned dataset
 * aborts the whole run before anything is written.
 */
export async function injectFields(
  contentRoot: string,
  options: InjectOptions = {},
): Promise<InjectResult[]> {
  const { out = DEFAULT_OUT_DIR, langs, fields, ignore, templates, dryRun = false } = options
  const outDir = path.resolve(out)

  const isInScope = (name: string): boolean => matchesFilter(fields, name) && !isExcluded(ignore, name)

  // First pass: compute every replacement in memory and collect everything that
  // blocks the run. Nothing is written until the whole tree validates.
  const pendingWrites: { contentFilePath: string, content: string, result: InjectResult }[] = []
  const abortReasons: string[] = []
  let hasMissingTargets = false

  for (const file of await findFiles(outDir, '.json', { langs, templates })) {
    const datasetPath = path.relative(outDir, file.path)

    let fieldMap: FieldMap
    try {
      fieldMap = JSON.parse(await fsp.readFile(file.path, 'utf-8')) as FieldMap
    }
    catch (error) {
      abortReasons.push(`Invalid JSON in ${datasetPath}: ${(error as Error).message}`)
      continue
    }

    const invalidFields = Object.entries(fieldMap)
      .filter(([name, value]) => isInScope(name) && !isWritableFieldValue(value))
      .map(([name]) => name)

    if (invalidFields.length > 0) {
      abortReasons.push(
        `Unsupported value in ${datasetPath} (write a string, or a blocks/layout array): ${invalidFields.join(', ')}`,
      )
      continue
    }

    const contentFilePath = path.join(contentRoot, file.folder, contentFilename(file, '.txt'))

    let content: string
    try {
      content = await fsp.readFile(contentFilePath, 'utf-8')
    }
    catch {
      abortReasons.push(`No content file to inject into: ${path.relative(contentRoot, contentFilePath)}`)
      hasMissingTargets = true
      continue
    }

    // Kirby decodes duplicate keys last-wins but `replaceField` rewrites the first
    // match, so a field appearing twice can't be edited unambiguously – abort.
    const originalContent = content
    const storedFields = decodeFields(originalContent)
    const duplicateFields = findDuplicateNames(storedFields.map(field => field.name))
      .filter(name => isInScope(name) && name in fieldMap)

    if (duplicateFields.length > 0) {
      abortReasons.push(
        `Duplicate field(s) in ${path.relative(contentRoot, contentFilePath)}: ${duplicateFields.join(', ')}`,
      )
      continue
    }

    const storedValues = new Map(storedFields.map(field => [field.name, field.value]))
    const writtenFields: string[] = []
    const skippedFields: string[] = []

    for (const [name, fieldValue] of Object.entries(fieldMap)) {
      if (!isInScope(name))
        continue

      const encodedValue = typeof fieldValue === 'string' ? fieldValue : encodeFieldValue(fieldValue)

      if (storedValues.get(name) === trimKirby(encodedValue))
        continue

      const updatedContent = replaceField(content, name, encodedValue)
      if (updatedContent === undefined) {
        skippedFields.push(name)
        continue
      }

      content = updatedContent
      writtenFields.push(name)
    }

    pendingWrites.push({
      contentFilePath,
      content,
      result: {
        target: path.relative(contentRoot, contentFilePath),
        fields: writtenFields,
        skippedFields,
        hasChanged: content !== originalContent,
      },
    })
  }

  // Fail fast and atomically: an invalid dataset means an edit went wrong, and
  // a dataset without a content file means the output tree is out of sync with
  // the content tree – either way, write nothing at all.
  if (abortReasons.length > 0) {
    const hint = hasMissingTargets
      ? '\nRe-run extract with --clean to drop stale datasets.'
      : ''
    throw new Error(
      `Nothing was injected:\n${abortReasons.map(reason => `  ${reason}`).join('\n')}${hint}`,
    )
  }

  for (const { contentFilePath, content, result } of pendingWrites) {
    if (result.hasChanged && !dryRun)
      await fsp.writeFile(contentFilePath, content)
  }

  return pendingWrites.map(item => item.result)
}

/** Field names that collide under Kirby's own key normalization. */
function findDuplicateNames(names: string[]): string[] {
  const counts = new Map<string, number>()
  for (const name of names)
    counts.set(kirbyKey(name), (counts.get(kirbyKey(name)) ?? 0) + 1)

  const duplicates = new Set<string>()
  for (const name of names) {
    if (counts.get(kirbyKey(name))! > 1)
      duplicates.add(name)
  }

  return [...duplicates]
}

/** How Kirby keys a field: lower-cased, with `-` and spaces folded to `_` (`Txt::decode`). */
function kirbyKey(name: string): string {
  return name.toLowerCase().replace(/[- ]/g, '_')
}
