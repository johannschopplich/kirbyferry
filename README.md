# kirbyferry

Kirby stores `blocks` and `layout` fields as a single line of minified JSON inside `.txt` content files – impossible to read, diff, or translate by hand. kirbyferry pulls those fields out into pretty-printed, per-page JSON, lets you edit them, and injects them back minified, touching nothing else in the file.

It detects these fields by their value shape – no blueprint parsing, no Kirby runtime, no PHP – so it works on any Kirby site, plugins and custom field types included.

## Installation

```bash
pnpm add -D kirbyferry

# Or run directly
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

`extract` mirrors the content tree under `--out`. Each file is a field-keyed map, so a page with multiple block fields keeps them together:

```jsonc
// content-fields/3_projects/stube-umlauts/project.en.json
{
  "Text": [
    { "id": "9c34…", "type": "text", "content": { "text": "<p>…</p>" }, "isHidden": false }
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

### Scope and limits

- Handles the two field types Kirby stores as minified JSON: `blocks` and `layout`. `structure`/`object` fields are already human-readable YAML and are deliberately left byte-for-byte untouched – re-encoding YAML from JavaScript cannot reproduce Kirby's PHP handlers (Spyc or Symfony) faithfully, so kirbyferry never parses or rewrites them. Edit those fields directly in the `.txt`.
- Fields are detected by value shape (`[{ id, type, content }]` → blocks, `[{ id, columns }]` → layout). Empty fields (`[]`) are skipped – there is nothing to make readable.
- Targets single-line fields (Kirby's default `pretty: false`). A field stored as multi-line JSON is reported and skipped rather than corrupted.
- `inject` validates every dataset before touching anything and is atomic: unreadable JSON, a value that is no longer a blocks/layout array, or a dataset without its target `.txt` aborts the run before a single write. Stale datasets (their source page was renamed or deleted) are removed by `extract --clean`.
- `inject` rewrites only fields whose values actually changed. A field that still equals its stored value keeps its exact bytes – content written by older Kirby versions (e.g. with escaped slashes in JSON) is not reformatted by a no-op run.
- Replacement is bounded by Kirby's `----` field divider, so a line inside some other field's multiline value that merely looks like a blocks field can never be rewritten.

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

Injects edited JSON back into the matching `.txt` files. Returns one `InjectResult` per dataset file, listing the fields written, the fields skipped, and whether the file changed. Throws before writing anything if a dataset is unreadable, holds a value that is not a blocks/layout array, or lacks its target content file.

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
