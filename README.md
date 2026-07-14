<div align="center">
  <img src="./.github/favicon.svg" alt="kirbyferry logo" width="120">

# kirbyferry

Round-trip Kirby `blocks` and `layout` fields to editable JSON and back.

[Installation](#installation) •
[CLI](#cli) •
[Usage](#usage) •
[API](#programmatic-api)

</div>

Kirby stores `blocks` and `layout` fields as a single line of minified JSON – impossible to read, diff, or translate by hand. kirbyferry pulls them into pretty-printed, per-file JSON, lets you edit them, and injects them back minified, touching nothing else. It detects fields by their value shape – no blueprint parsing, no Kirby runtime, no PHP – so it works on any Kirby site, plugins and custom field types included.

## When to Use

| I want to… | Run |
| --- | --- |
| Make `blocks`/`layout` JSON readable and editable | `kirbyferry extract` |
| Write my edited JSON back into content | `kirbyferry inject` |
| Translate one language, then write it back | `extract --lang de` … `inject --lang de` |
| Preview what `inject` would change | `inject --dry-run` |
| Narrow the scope to certain fields or templates | `--field`, `--template` |
| Drop extracted files whose page was renamed or deleted | `extract --clean` |

## Features

- ♻️ **True round-trip**: pretty JSON out, minified back in – every other field left byte-for-byte.
- 🔒 **Atomic & validated**: `inject` checks every dataset up front and aborts before a single write if anything is off.
- ✋ **No-op safe**: unchanged fields keep their exact original bytes – older content is never reformatted.
- 🧱 **YAML-safe**: `structure`/`object` fields are deliberately left untouched.

## Installation

```bash
npm install -D kirbyferry

# Or run once, without installing
npx kirbyferry extract
```

## CLI

```bash
# Extract every blocks/layout field into ./content-fields
npx kirbyferry extract

# Edit the JSON, then write it back
npx kirbyferry inject
```

The content root is auto-detected (`./content`, then `./storage/content`); pass a path to override it.

```text
kirbyferry extract [dir] [options]
kirbyferry inject  [dir] [options]

Options:
  -o, --out <dir>        Directory for extracted JSON (default: "content-fields")
  -l, --lang <codes>     Comma-separated language codes (default: all detected)
  -f, --field <names>    Comma-separated field names (default: all blocks/layout fields)
  -t, --template <names> Comma-separated template names (default: all)
      --clean            extract only: remove stale dataset files within the filter scope
      --dry-run          inject only: report changes without writing
```

## Usage

`extract` mirrors the content tree under `--out`. Each extracted file – a **dataset** – is a field-keyed map, so a page's `blocks` and `layout` fields stay together in one file:

```jsonc
// content-fields/3_projects/stube-umlauts/project.en.json
{
  "Text": [
    { "id": "9c34…", "type": "text", "content": { "text": "<p>…</p>" }, "isHidden": false }
  ],
  "Layout": [
    { "id": "a1b2…", "columns": [] }
  ]
}
```

Edit the JSON – translate it, restructure blocks, run it through tooling – then `inject` minifies each field and replaces only that field's line in the original `.txt`. Every other field (titles, YAML structures, UUIDs) is preserved exactly.

### Editing one language in place

A common use is editing the extracted JSON for a single language – running it through a translation tool, for example – then writing it back. This edits **existing** block content; it does not create a new Kirby language, which is a separate concern and out of scope.

```bash
npx kirbyferry extract --lang de        # pull existing German block content
# … edit content-fields/**/*.de.json …
npx kirbyferry inject --lang de         # write it back
```

> [!TIP]
> Run `inject --dry-run` first to preview which files and fields would change before touching content.

## Safety & limits

- **Two field types only.** Handles `blocks` and `layout` – the fields Kirby stores as minified JSON. `structure`/`object` are already human-readable YAML and left byte-for-byte untouched: re-encoding YAML from JavaScript cannot faithfully reproduce Kirby's PHP handlers (Spyc or Symfony), so kirbyferry never parses or rewrites them. Edit those directly in the `.txt`.
- **Shape detection.** Fields are matched by value shape (`[{ id, type, content }]` → blocks, `[{ id, columns }]` → layout). Empty fields (`[]`) are skipped – there is nothing to make readable.
- **Single-line only.** Targets Kirby's default `pretty: false` output. A field stored as multi-line JSON is reported and skipped rather than corrupted.
- **Atomic inject.** Every dataset is validated before anything is touched: unreadable JSON, a value that is no longer a blocks/layout array, or a dataset missing its target `.txt` aborts the run before a single write. Stale datasets (source page renamed or deleted) are removed by `extract --clean`.
- **No-op safe.** Only fields whose values actually changed are rewritten; an unchanged field keeps its exact bytes, so content from older Kirby versions (e.g. escaped slashes in JSON) is never reformatted.
- **Divider-bounded.** Replacement is scoped by Kirby's `----` field divider, so a line inside another field's multiline value that merely looks like a blocks field can never be rewritten.

## Programmatic API

```ts
import { extractFields, injectFields, resolveContentRoot } from 'kirbyferry'

const contentRoot = await resolveContentRoot() // auto-detect, or pass a path
const extractReport = await extractFields(contentRoot, { out: 'content-fields', langs: ['de'] })
const injectResults = await injectFields(contentRoot, { out: 'content-fields', dryRun: true })
```

Lower-level helpers are exported too: `decodeFields`, `parseStructuredField`, `isStructuredFieldValue`, `encodeFieldValue`, `replaceField`, `parseFilename`, `findFiles`.

### `extractFields`

Extracts all `blocks`/`layout` fields under the content root into JSON. Returns one `ExtractResult` per written file, plus the stale datasets removed by `clean`.

```ts
function extractFields(contentRoot: string, options?: ExtractOptions): Promise<ExtractReport>

interface FilterOptions {
  /** Directory holding the extracted JSON (default: "content-fields") */
  out?: string
  /** Language codes to include (default: all detected) */
  langs?: string[]
  /** Field names to include (default: all blocks/layout fields) */
  fields?: string[]
  /** Template names to include (default: all) */
  templates?: string[]
}

interface ExtractOptions extends FilterOptions {
  /** Remove stale dataset files within the filter scope after extracting */
  clean?: boolean
}

interface ExtractReport {
  /** One entry per written JSON file */
  results: ExtractResult[]
  /** Stale dataset files removed by `clean`, relative to the output directory */
  cleanedDatasets: string[]
}
```

### `injectFields`

Injects edited JSON back into the matching `.txt` files. Returns one `InjectResult` per dataset, listing the fields written, the fields skipped, and whether the file changed. Throws before writing anything if a dataset is invalid or missing its target – see [Safety & limits](#safety--limits).

```ts
function injectFields(contentRoot: string, options?: InjectOptions): Promise<InjectResult[]>

interface InjectOptions extends FilterOptions {
  /** Report changes without writing files */
  dryRun?: boolean
}
```

### `parseStructuredField`

The detection primitive: given a raw `Key: value` field, returns its parsed blocks/layout value or `undefined`.

```ts
function parseStructuredField(field: RawField): StructuredField | undefined
```

## License

[MIT](./LICENSE) License © 2026-PRESENT [Johann Schopplich](https://github.com/johannschopplich)
