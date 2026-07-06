import type { InjectOptions, InjectResult, StructuredFieldMap } from './types.ts'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { DEFAULT_OUT_DIR } from './defaults.ts'
import { contentFilename, decodeFields, encodeFieldValue, findFiles, isStructuredFieldValue, matchesFilter, replaceField } from './kirby.ts'

/**
 * Injects edited JSON back into the matching Kirby `.txt` files, minifying each
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
  const pending: { txtPath: string, content: string, result: InjectResult }[] = []
  const problems: string[] = []
  let hasMissingTargets = false

  for (const file of await findFiles(outDir, '.json', { langs, templates })) {
    const dataset = path.relative(outDir, file.path)

    let map: StructuredFieldMap
    try {
      map = JSON.parse(await fsp.readFile(file.path, 'utf-8')) as StructuredFieldMap
    }
    catch (error) {
      problems.push(`Invalid JSON in ${dataset}: ${(error as Error).message}`)
      continue
    }

    const invalidFields = Object.entries(map)
      .filter(([name, value]) => matchesFilter(fields, name) && !isStructuredFieldValue(value))
      .map(([name]) => name)

    if (invalidFields.length > 0) {
      problems.push(`Not a blocks/layout value in ${dataset}: ${invalidFields.join(', ')}`)
      continue
    }

    const txtPath = path.join(contentRoot, file.folder, contentFilename(file, '.txt'))

    let content: string
    try {
      content = await fsp.readFile(txtPath, 'utf-8')
    }
    catch {
      problems.push(`No content file to inject into: ${path.relative(contentRoot, txtPath)}`)
      hasMissingTargets = true
      continue
    }

    const original = content
    const storedValues = new Map(decodeFields(original).map(field => [field.name, field.value]))
    const writtenFields: string[] = []
    const skippedFields: string[] = []

    for (const [name, fieldValue] of Object.entries(map)) {
      if (!matchesFilter(fields, name))
        continue

      // A value that still equals what the file stores is left alone byte for
      // byte – legacy PHP json_encode formatting (e.g. escaped slashes) must
      // not be normalized by a no-op inject.
      const stored = storedValues.get(name)
      if (stored !== undefined && isJsonEqual(stored, fieldValue))
        continue

      const next = replaceField(content, name, encodeFieldValue(fieldValue))
      if (next === undefined) {
        skippedFields.push(name)
        continue
      }

      content = next
      writtenFields.push(name)
    }

    pending.push({
      txtPath,
      content,
      result: {
        target: path.relative(contentRoot, txtPath),
        fields: writtenFields,
        skipped: skippedFields,
        changed: content !== original,
      },
    })
  }

  // Fail fast and atomically: an invalid dataset means an edit went wrong, and
  // a dataset without a content file means the output tree is out of sync with
  // the content tree – either way, write nothing at all.
  if (problems.length > 0) {
    const hint = hasMissingTargets
      ? '\nRe-run extract with --clean to drop stale datasets.'
      : ''
    throw new Error(
      `Nothing was injected:\n${problems.map(problem => `  ${problem}`).join('\n')}${hint}`,
    )
  }

  // Every dataset validates and every target exists, so the writes can be
  // applied as a unit.
  for (const { txtPath, content, result } of pending) {
    if (result.changed && !dryRun)
      await fsp.writeFile(txtPath, content)
  }

  return pending.map(item => item.result)
}

function isJsonEqual(storedValue: string, value: unknown): boolean {
  try {
    return isDeepStrictEqual(JSON.parse(storedValue), value)
  }
  catch {
    return false
  }
}
