import { isDeepStrictEqual } from 'node:util'

export function isObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

/** Structural equality between a stored JSON string and an already-parsed value. */
export function isJsonEqual(storedValue: string, value: unknown): boolean {
  try {
    return isDeepStrictEqual(JSON.parse(storedValue), value)
  }
  catch {
    return false
  }
}
