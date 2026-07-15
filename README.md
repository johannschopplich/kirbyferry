<div align="center">
  <img src="./.github/favicon.svg" alt="kirbyferry logo" width="120">

# kirbyferry

Round-trip Kirby `blocks` and `layout` fields – or the whole content tree – to editable JSON and back.

[Installation](#installation) •
[CLI](#cli) •
[Usage](#usage) •
[API](#programmatic-api)

</div>

Kirby stores `blocks` and `layout` fields as a single line of minified JSON – impossible to read, diff, or translate by hand. kirbyferry pulls them into pretty-printed, per-file JSON, lets you edit them, and injects them back minified, touching nothing else. It detects fields by their value shape – no blueprint parsing, no Kirby runtime, no PHP – so it works on any Kirby site, plugins and custom field types included.

Need more than blocks and layout? `extract --all` dumps **every** field. `blocks`/`layout` come out as decoded JSON; everything else – text, `structure`/`object` YAML, dates – comes out as its raw string, written back verbatim. kirbyferry never re-encodes YAML (it can't match Kirby's PHP byte-for-byte), so an untouched field is always preserved exactly.

## When to Use

| I want to… | Run |
| --- | --- |
| Make `blocks`/`layout` JSON readable and editable | `kirbyferry extract` |
| Dump the whole content tree, not just blocks/layout | `extract --all` |
| Write my edited JSON back into content | `kirbyferry inject` |
| Translate one language, then write it back | `extract --lang de` … `inject --lang de` |
| Preview what `inject` would change | `inject --dry-run` |
| Narrow the scope to certain fields or templates | `--field`, `--template` |
| Skip risky fields like `uuid`/`sort` | `--ignore uuid,sort` |
| Drop extracted files whose page was renamed or deleted | `extract --clean` |

## Features

- ♻️ **True round-trip**: pretty JSON out, minified back in – every other field left byte-for-byte.
- 🌳 **Whole tree, opt-in**: `--all` dumps every field into one JSON per page; blocks/layout decoded, everything else kept as a raw string.
- 🔒 **Atomic & validated**: `inject` checks every dataset up front and aborts before a single write if any dataset is malformed.
- ✋ **No-op safe**: an untouched raw field keeps its exact original bytes – blocks/layout always come back as Kirby's canonical JSON.
- 🧱 **YAML-safe**: `structure`/`object` fields are never decoded or re-encoded – dumped verbatim, written back verbatim.

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
  -f, --field <names>    Comma-separated field names to include (default: all)
  -i, --ignore <names>   Comma-separated field names to skip (e.g. uuid,sort)
  -t, --template <names> Comma-separated template names (default: all)
  -a, --all              extract only: extract every field, not just blocks/layout
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

### The whole content tree

By default `extract` only pulls `blocks`/`layout`. Pass `--all` to dump **every** field – text, YAML `structure`/`object`, dates, everything – into one JSON per page:

```jsonc
// content-fields/3_projects/stube-umlauts/project.en.json
{
  "Title": "Stübe Umlauts",
  "Text": [{ "id": "9c34…", "type": "text", "content": { "text": "<p>…</p>" }, "isHidden": false }],
  "Links": "-\n  label: Home\n  url: 'https://example.com'",
  "Uuid": "abc123"
}
```

`blocks`/`layout` are decoded to JSON; every other value stays a raw string, YAML included. Edit any of them and `inject` writes it back – blocks/layout minified, raw strings spliced in verbatim.

> [!WARNING]
> `--all` makes structural fields like `uuid` and `sort` editable. Rewriting a `uuid` silently breaks every `page://`/`file://` reference pointing at it, and translating a `sort` corrupts ordering. When bulk-editing – especially machine translation – exclude them:
>
> ```bash
> kirbyferry extract --all --ignore uuid,sort
> ```

## Safety & limits

kirbyferry draws a firm line between two guarantees.

**The hard guarantee – `blocks`/`layout`.** These are matched by value shape (`[{ id, type, content }]` → blocks, `[{ id, columns }]` → layout), decoded to real JSON, and re-encoded exactly as Kirby's `json_encode` would (`JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE`, single line). What you edit is validated and re-encoded single-line, so it round-trips byte-for-byte against Kirby's default storage. Blocks and layout are always normalized to that canonical form on inject, so a field an older Kirby or a plugin stored pretty-printed or with escaped slashes is rewritten to match – whether you edited it or not.

**The soft guarantee – everything else (`--all`).** Every other field is dumped and written back as a **raw string**; kirbyferry never parses or re-encodes it. That is deliberate for `structure`/`object`: re-encoding YAML from JavaScript cannot reproduce Kirby's PHP handlers (Spyc or Symfony) byte-for-byte. An untouched field keeps its exact bytes, but a raw string you *do* edit is spliced back as-is and not validated – broken YAML surfaces at Kirby runtime, not at inject time. Hand-edited YAML may also be re-normalized on Kirby's next Panel save.

Both rest on the same machinery:

- **No-op safe.** Only fields whose values actually changed are rewritten. For a raw string or YAML field that means byte-identical, so untouched older content is never reformatted; for `blocks`/`layout` it means identical to Kirby's canonical JSON, so legacy escaped-slash or pretty-printed storage is normalized on the next inject.
- **Atomic inject.** Every dataset is validated before anything is touched: unreadable JSON, a value that is neither a string nor a blocks/layout array, a duplicate field in the target, or a missing `.txt` aborts the run before a single write. Stale datasets (source page renamed or deleted) are removed by `extract --clean`.
- **Divider-bounded.** Replacement is scoped by Kirby's `----` field divider, and a line-start `----` inside a value is escaped `\----` on write – so a line inside another field's value that merely looks like a field can never be rewritten or split.
- **Trim to match Kirby.** Raw values are trimmed exactly as Kirby's `Txt` encoder trims, so the extracted JSON and the `.txt` never drift over surrounding whitespace.

## Programmatic API

```ts
import { extractFields, injectFields, resolveContentRoot } from 'kirbyferry'

const contentRoot = await resolveContentRoot() // auto-detect, or pass a path
const extractReport = await extractFields(contentRoot, { out: 'content-fields', langs: ['de'] })
const injectResults = await injectFields(contentRoot, { out: 'content-fields', dryRun: true })
```

### `extractFields`

Extracts `blocks`/`layout` fields under the content root into JSON – or, with `all`, every field (non-structured ones as raw strings). Returns one `ExtractResult` per written file, plus the stale datasets removed by `clean`.

```ts
function extractFields(contentRoot: string, options?: ExtractOptions): Promise<ExtractReport>

interface FilterOptions {
  /** Directory holding the extracted JSON (default: "content-fields") */
  out?: string
  /** Language codes to include (default: all detected) */
  langs?: string[]
  /** Field names to include (default: all) */
  fields?: string[]
  /** Field names to skip, even when otherwise in scope (e.g. uuid, sort) */
  ignore?: string[]
  /** Template names to include (default: all) */
  templates?: string[]
}

interface ExtractOptions extends FilterOptions {
  /** Extract every field, not just blocks/layout (raw strings for the rest) */
  all?: boolean
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

## License

[MIT](./LICENSE) License © 2026-PRESENT [Johann Schopplich](https://github.com/johannschopplich)
