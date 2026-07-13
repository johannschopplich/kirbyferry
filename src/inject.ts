import type { InjectOptions, InjectResult, StructuredFieldMap } from './types.ts'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { DEFAULT_OUT_DIR } from './defaults.ts'
import { decodeFields, encodeFieldValue, isStructuredFieldValue, replaceField } from './kirby.ts'
import { findFiles } from './utils/fs.ts'
import { isJsonEqual } from './utils/json.ts'
import { contentFilename, matchesFilter } from './utils/tree.ts'

/**
 * Injects edited JSON back into the matching Kirby content files, minifying each
 * field value and replacing only that field's line so all surrounding content
 * is preserved byte-for-byte.
 */
export async function injectFields(
  contentRoot: string,
  options: InjectOptions = {},
): Promise<InjectResult[]> {
  const { out = DEFAULT_OUT_DIR, langs, fields, templates, dryRun = false } = options
  const outDir = path.resolve(out)

  // First pass: compute every replacement in memory and collect everything that
  // blocks the run. Nothing is written until the whole tree validates.
  const pendingWrites: { txtPath: string, content: string, result: InjectResult }[] = []
  const abortReasons: string[] = []
  let hasMissingTargets = false

  for (const file of await findFiles(outDir, '.json', { langs, templates })) {
    const datasetPath = path.relative(outDir, file.path)

    let fieldMap: StructuredFieldMap
    try {
      fieldMap = JSON.parse(await fsp.readFile(file.path, 'utf-8')) as StructuredFieldMap
    }
    catch (error) {
      abortReasons.push(`Invalid JSON in ${datasetPath}: ${(error as Error).message}`)
      continue
    }

    const invalidFields = Object.entries(fieldMap)
      .filter(([name, value]) => matchesFilter(fields, name) && !isStructuredFieldValue(value))
      .map(([name]) => name)

    if (invalidFields.length > 0) {
      abortReasons.push(`Not a blocks/layout value in ${datasetPath}: ${invalidFields.join(', ')}`)
      continue
    }

    const txtPath = path.join(contentRoot, file.folder, contentFilename(file, '.txt'))

    let content: string
    try {
      content = await fsp.readFile(txtPath, 'utf-8')
    }
    catch {
      abortReasons.push(`No content file to inject into: ${path.relative(contentRoot, txtPath)}`)
      hasMissingTargets = true
      continue
    }

    const originalContent = content
    const storedValues = new Map(decodeFields(originalContent).map(field => [field.name, field.value]))
    const writtenFields: string[] = []
    const skippedFields: string[] = []

    for (const [name, fieldValue] of Object.entries(fieldMap)) {
      if (!matchesFilter(fields, name))
        continue

      // A value that still equals what the file stores is left alone byte for
      // byte – legacy PHP json_encode formatting (e.g. escaped slashes) must
      // not be normalized by a no-op inject.
      const storedValue = storedValues.get(name)
      if (storedValue !== undefined && isJsonEqual(storedValue, fieldValue))
        continue

      const updatedContent = replaceField(content, name, encodeFieldValue(fieldValue))
      if (updatedContent === undefined) {
        skippedFields.push(name)
        continue
      }

      content = updatedContent
      writtenFields.push(name)
    }

    pendingWrites.push({
      txtPath,
      content,
      result: {
        target: path.relative(contentRoot, txtPath),
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

  for (const { txtPath, content, result } of pendingWrites) {
    if (result.hasChanged && !dryRun)
      await fsp.writeFile(txtPath, content)
  }

  return pendingWrites.map(item => item.result)
}
