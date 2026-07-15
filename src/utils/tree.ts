import type { ParsedFilename } from '../types.ts'
import * as path from 'node:path'

/** ISO-style language code, e.g. `en` or `en-us`. */
const LANGUAGE_CODE = /^[a-z]{2}(?:-[a-z]{2,})?$/

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

export function matchesFilter(filter: string[] | undefined, value: string): boolean {
  return !filter || filter.some(item => item.toLowerCase() === value.toLowerCase())
}

export function isExcluded(ignore: string[] | undefined, value: string): boolean {
  return !!ignore && ignore.some(item => item.toLowerCase() === value.toLowerCase())
}
