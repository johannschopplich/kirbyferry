import type { ArgsDef } from 'citty'
import type { ExtractReport, InjectResult } from './types.ts'
import * as path from 'node:path'
import process from 'node:process'
import * as ansis from 'ansis'
import { defineCommand, runMain } from 'citty'
import packageJson from '../package.json' with { type: 'json' }
import { CONTENT_ROOT_CANDIDATES, DEFAULT_OUT_DIR } from './defaults.ts'
import { extractFields } from './extract.ts'
import { injectFields } from './inject.ts'
import * as log from './log.ts'
import { resolveContentRoot } from './utils/fs.ts'

const sharedArgs = {
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
      default: false,
    },
    clean: {
      type: 'boolean',
      description: 'Remove stale dataset files within the filter scope',
      default: false,
    },
  },
  async run({ args }) {
    const contentRoot = await resolveRoot(args.dir)
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
      default: false,
    },
  },
  async run({ args }) {
    const contentRoot = await resolveRoot(args.dir)
    let results: InjectResult[]
    try {
      results = await injectFields(contentRoot, {
        out: args.out,
        langs: parseList(args.lang),
        fields: parseList(args.field),
        ignore: parseList(args.ignore),
        templates: parseList(args.template),
        dryRun: args['dry-run'],
      })
    }
    catch (error) {
      log.error((error as Error).message)
      process.exit(1)
    }
    reportInject(results, args['dry-run'])
  },
})

const main = defineCommand({
  meta: {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
  },
  subCommands: { extract, inject },
})

async function resolveRoot(contentDir: string | undefined): Promise<string> {
  try {
    return await resolveContentRoot(contentDir)
  }
  catch (error) {
    log.error((error as Error).message)
    process.exit(1)
  }
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value)
    return undefined

  const items = value.split(',').map(part => part.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

function header(): void {
  log.info(`${ansis.bold(packageJson.name)} ${ansis.dim(`v${packageJson.version}`)}`)
  console.log()
}

function printTree(rows: [string, string][]): void {
  const width = Math.max(...rows.map(([label]) => label.length))

  for (const [i, [label, detail]] of rows.entries()) {
    const branch = i === rows.length - 1 ? '└─' : '├─'
    const padding = ' '.repeat(width - label.length + 2)
    console.log(`  ${ansis.dim(branch)} ${ansis.cyan(label)}${padding}${detail}`)
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
    printTree(results.map(result => [result.output, result.fields.join(ansis.dim(', '))]))
    console.log()
  }

  for (const datasetPath of cleanedDatasets)
    log.warn(`Removed stale dataset: ${datasetPath}`)

  const total = results.reduce((sum, result) => sum + result.fields.length, 0)
  const target = path.relative(process.cwd(), path.resolve(out))
  log.success(`Extracted ${ansis.bold(String(total))} field(s) to ${ansis.cyan(target)}`)
}

function reportInject(results: InjectResult[], dryRun: boolean): void {
  header()

  const changedFiles = results.filter(result => result.hasChanged)
  const skippedFields = results.flatMap(result =>
    result.skippedFields.map(name => `${result.target} ${ansis.dim('→')} ${name}`),
  )

  if (changedFiles.length === 0 && skippedFields.length === 0) {
    log.info('Nothing to inject.')
    return
  }

  if (changedFiles.length > 0) {
    printTree(changedFiles.map(result => [result.target, result.fields.join(ansis.dim(', '))]))
    console.log()
  }

  for (const item of skippedFields)
    log.warn(`Skipped (no such field in the content file): ${item}`)

  const total = changedFiles.reduce((sum, result) => sum + result.fields.length, 0)
  const verb = dryRun ? 'Would inject' : 'Injected'
  log.success(
    `${verb} ${ansis.bold(String(total))} field(s) into ${ansis.bold(String(changedFiles.length))} file(s)`,
  )
}

runMain(main)
