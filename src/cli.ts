import type { ArgsDef, CommandDef } from 'utilful/cli'
import type { ExtractReport, InjectResult } from './types.ts'
import * as path from 'node:path'
import process from 'node:process'
import { styleText } from 'node:util'
import { commonArgs, defineCommand, log } from 'utilful/cli'
import packageJson from '../package.json' with { type: 'json' }
import { CONTENT_ROOT_CANDIDATES, DEFAULT_OUT_DIR } from './defaults.ts'
import { extractFields } from './extract.ts'
import { injectFields } from './inject.ts'
import { resolveContentRoot } from './utils/fs.ts'

function color(style: Parameters<typeof styleText>[0], text: string): string {
  return styleText(style, text, { stream: process.stderr })
}

const sharedArgs = {
  ...commonArgs,
  dir: {
    type: 'positional',
    description: `Kirby content root (default: auto-detect ${CONTENT_ROOT_CANDIDATES.map(dir => `./${dir}`).join(' or ')})`,
    required: false,
  },
  out: {
    type: 'string',
    alias: 'o',
    description: `Directory for extracted JSON (default: "${DEFAULT_OUT_DIR}")`,
    default: DEFAULT_OUT_DIR,
  },
  lang: {
    type: 'string',
    alias: 'l',
    description: 'Comma-separated language codes (default: all detected)',
  },
  field: {
    type: 'string',
    alias: 'f',
    description: 'Comma-separated field names to include (default: all)',
  },
  ignore: {
    type: 'string',
    alias: 'i',
    description: 'Comma-separated field names to skip (e.g. uuid,sort)',
  },
  template: {
    type: 'string',
    alias: 't',
    description: 'Comma-separated template names (default: all)',
  },
} satisfies ArgsDef

const extract = defineCommand({
  meta: {
    name: 'extract',
    description: 'Extract blocks/layout fields (or, with --all, the whole tree) into editable JSON',
  },
  args: {
    ...sharedArgs,
    all: {
      type: 'boolean',
      alias: 'a',
      description: 'Extract every field, not just blocks/layout (raw strings for the rest)',
    },
    clean: {
      type: 'boolean',
      description: 'Remove stale dataset files within the filter scope',
    },
  },
  async run({ args }) {
    const contentRoot = await resolveContentRoot(args.dir)
    const report = await extractFields(contentRoot, {
      out: args.out,
      langs: parseList(args.lang),
      fields: parseList(args.field),
      ignore: parseList(args.ignore),
      templates: parseList(args.template),
      all: args.all,
      clean: args.clean,
    })
    reportExtract(report, args.out, args.all)
  },
})

const inject = defineCommand({
  meta: {
    name: 'inject',
    description: 'Inject edited JSON back into Kirby content files',
  },
  args: {
    ...sharedArgs,
    'dry-run': {
      type: 'boolean',
      description: 'Report changes without writing',
    },
  },
  async run({ args }) {
    const contentRoot = await resolveContentRoot(args.dir)
    const results = await injectFields(contentRoot, {
      out: args.out,
      langs: parseList(args.lang),
      fields: parseList(args.field),
      ignore: parseList(args.ignore),
      templates: parseList(args.template),
      dryRun: args['dry-run'],
    })
    reportInject(results, args['dry-run'])
  },
})

export const mainCommand: CommandDef = defineCommand({
  meta: {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
  },
  subCommands: {
    extract,
    inject,
  },
})

function parseList(value: string | undefined): string[] | undefined {
  if (!value)
    return undefined

  const items = value.split(',').map(part => part.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

function header(): void {
  log.info(`${color('bold', packageJson.name)} ${color('dim', `v${packageJson.version}`)}`)
  log.blankLine()
}

function printTree(rows: [string, string][]): void {
  const width = Math.max(...rows.map(([label]) => label.length))

  for (const [i, [label, detail]] of rows.entries()) {
    const branch = i === rows.length - 1 ? '└─' : '├─'
    const padding = ' '.repeat(width - label.length + 2)
    process.stderr.write(`  ${color('dim', branch)} ${color('cyan', label)}${padding}${detail}\n`)
  }
}

function reportExtract(report: ExtractReport, out: string, all: boolean): void {
  header()
  const { results, cleanedDatasets } = report

  if (results.length === 0 && cleanedDatasets.length === 0) {
    log.info(all ? 'No fields found.' : 'No blocks or layout fields found.')
    return
  }

  if (results.length > 0) {
    printTree(results.map(result => [result.output, result.fields.join(color('dim', ', '))]))
    log.blankLine()
  }

  for (const datasetPath of cleanedDatasets)
    log.warn(`Removed stale dataset: ${datasetPath}`)

  const total = results.reduce((sum, result) => sum + result.fields.length, 0)
  const target = path.relative(process.cwd(), path.resolve(out))
  log.success(`Extracted ${color('bold', String(total))} field(s) to ${color('cyan', target)}`)
}

function reportInject(results: InjectResult[], dryRun: boolean): void {
  header()

  const changedFiles = results.filter(result => result.hasChanged)
  const skippedFields = results.flatMap(result =>
    result.skippedFields.map(name => `${result.target} ${color('dim', '→')} ${name}`),
  )

  if (changedFiles.length === 0 && skippedFields.length === 0) {
    log.info('Nothing to inject.')
    return
  }

  if (changedFiles.length > 0) {
    printTree(changedFiles.map(result => [result.target, result.fields.join(color('dim', ', '))]))
    log.blankLine()
  }

  for (const item of skippedFields)
    log.warn(`Skipped (no such field in the content file): ${item}`)

  const total = changedFiles.reduce((sum, result) => sum + result.fields.length, 0)
  const verb = dryRun ? 'Would inject' : 'Injected'
  log.success(
    `${verb} ${color('bold', String(total))} field(s) into ${color('bold', String(changedFiles.length))} file(s)`,
  )
}
