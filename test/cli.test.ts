import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli, useTemporaryDirectories } from './utils.ts'

const PAGE = `Title: Home

----

Text: [{"content":{"text":"<p>Hello</p>"},"id":"a1","isHidden":false,"type":"text"}]

----

Uuid: home
`

const createDirectory = useTemporaryDirectories()

describe('kirbyferry CLI', () => {
  describe('extract', () => {
    it('extracts only structured fields into a mirrored dataset', async () => {
      const directory = createDirectory({ 'content/1_home/home.en.txt': PAGE })

      const { stderr, exitCode } = await runCli(['extract', 'content', '--out', 'fields'], { cwd: directory })

      const dataset = JSON.parse(
        await fsp.readFile(path.join(directory, 'fields', '1_home', 'home.en.json'), 'utf-8'),
      ) as Record<string, unknown>

      expect(exitCode).toBe(0)
      expect(stderr).toContain('Extracted')
      // Only `Text` is structured – `Title` and `Uuid` need `--all`.
      expect(Object.keys(dataset)).toEqual(['Text'])
    })

    it('writes into content-fields without --out', async () => {
      const directory = createDirectory({ 'content/1_home/home.en.txt': PAGE })

      const { exitCode } = await runCli(['extract', 'content'], { cwd: directory })

      expect(exitCode).toBe(0)
      await expect(fsp.access(path.join(directory, 'content-fields', '1_home', 'home.en.json'))).resolves.toBeUndefined()
    })
  })

  describe('inject', () => {
    it('writes an edited dataset back into the content file', async () => {
      const directory = createDirectory({
        'content/1_home/home.en.txt': PAGE,
        'fields/1_home/home.en.json': JSON.stringify({
          Text: [{ content: { text: '<p>Goodbye</p>' }, id: 'a1', isHidden: false, type: 'text' }],
        }),
      })

      const { stderr, exitCode } = await runCli(['inject', 'content', '--out', 'fields'], { cwd: directory })

      const content = await fsp.readFile(path.join(directory, 'content', '1_home', 'home.en.txt'), 'utf-8')

      expect(exitCode).toBe(0)
      expect(stderr).toContain('Injected')
      expect(content).toContain('<p>Goodbye</p>')
      // Untouched fields survive the rewrite.
      expect(content).toContain('Title: Home')
      expect(content).toContain('Uuid: home')
    })
  })
})
