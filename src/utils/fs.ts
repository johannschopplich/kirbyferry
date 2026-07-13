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

/** Recursively collects matching files, each with its parsed template and language. */
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

/** Returns an existing directory, or throws – never a path that doesn't exist. */
export async function resolveContentRoot(
  contentDir?: string,
  cwd: string = process.cwd(),
): Promise<string> {
  if (contentDir) {
    const resolvedPath = path.resolve(cwd, contentDir)
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
