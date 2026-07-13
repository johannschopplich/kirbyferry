import type { TreeFile } from '../types.ts'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { CONTENT_ROOT_CANDIDATES } from '../defaults.ts'
import { matchesFilter, parseFilename } from './tree.ts'

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isDirectory()
  }
  catch {
    return false
  }
}

/**
 * Walks `root` for files with the given extension, decomposing each name into
 * template and language and keeping only those that pass the optional filters.
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

/**
 * Resolves the content root: `explicit` when given, otherwise the first
 * conventional candidate that exists. Throws when neither resolves.
 */
export async function resolveContentRoot(
  explicit?: string,
  cwd: string = process.cwd(),
): Promise<string> {
  if (explicit) {
    const resolvedPath = path.resolve(cwd, explicit)
    if (!(await isDirectory(resolvedPath)))
      throw new Error(`Not a directory: ${resolvedPath}`)
    return resolvedPath
  }

  for (const candidate of CONTENT_ROOT_CANDIDATES) {
    const resolvedPath = path.resolve(cwd, candidate)
    if (await isDirectory(resolvedPath))
      return resolvedPath
  }

  throw new Error(
    `No Kirby content directory found (tried ${CONTENT_ROOT_CANDIDATES.join(', ')})`,
  )
}
