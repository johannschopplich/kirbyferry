<div align="center">
  <img src="./.github/favicon.svg" alt="kirbyferry logo" width="120">

# kirbyferry

Round-trip Kirby `blocks` and `layout` fields – or the whole content tree – to editable JSON and back.

[When to Use](#when-to-use) •
[Installation](#installation) •
[CLI](#cli) •
[Usage](#usage) •
[Safety](#safety--limits) •
[API](#programmatic-api)

</div>

Kirby stores `blocks` and `layout` fields as a single line of minified JSON – impossible to read, diff, or translate by hand. kirbyferry pulls them into pretty-printed, per-file JSON, lets you edit them, and injects them back minified, touching nothing else. It detects fields by their value shape – no blueprint parsing, no Kirby runtime, no PHP – so it works on any Kirby site, plugins and custom field types included.

## When to Use

| I want to… | Run |
| --- | --- |
| Make `blocks`/`layout` JSON readable and editable | `extract` |
| Dump the whole content tree, not just blocks/layout | `extract --all` |
| Write my edited JSON back into content | `inject` |
| Translate one language, then write it back | `extract --lang de` … `inject --lang de` |
| Preview what `inject` would change | `inject --dry-run` |
| Narrow the scope to certain fields or templates | `--field`, `--template` |
| Skip risky fields like `uuid`/`sort` | `--ignore uuid,sort` |
| Drop extracted files whose page was renamed or deleted | `extract --clean` |

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

`extract` mirrors the content tree under `--out`. Each extracted file – a **dataset** – is keyed by field name, so a page's `blocks` and `layout` fields stay together in one file:

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

Edit the JSON – translate it, restructure blocks, run it through tooling – then `inject` minifies each field and replaces only that field's line in the original `.txt`. Every other field (titles, YAML structures, UUIDs) is preserved exactly. `inject` replaces only fields the content file already has, so a field you add to the JSON is skipped.

### Edit One Language in Place

`--lang` limits both commands to the files of the given languages, for example to run German through a translation tool:

```bash
npx kirbyferry extract --lang de        # pull existing German block content
# … edit content-fields/**/*.de.json …
npx kirbyferry inject --lang de         # write it back
```

Run `inject --dry-run` to preview which files and fields would change.

### Extract the Whole Content Tree

By default `extract` only pulls `blocks`/`layout`. Pass `--all` to dump **every** field – text, YAML `structure`/`object`, dates – into one JSON per content file:

```jsonc
// content-fields/3_projects/stube-umlauts/project.en.json
{
  "Title": "Stübe Umlauts",
  "Text": [{ "id": "9c34…", "type": "text", "content": { "text": "<p>…</p>" }, "isHidden": false }],
  "Links": "-\n  label: Home\n  url: 'https://example.com'",
  "Uuid": "abc123"
}
```

`blocks`/`layout` are decoded to JSON; every other value stays a raw string, YAML included. Edit any value and `inject` writes it back – blocks/layout minified, raw strings spliced in verbatim.

> [!WARNING]
> `--all` makes structural fields like `uuid` and `sort` editable. Rewriting a `uuid` silently breaks every `page://`/`file://` reference pointing at it, and translating a `sort` corrupts ordering. When bulk-editing – especially machine translation – exclude them:
>
> ```bash
> kirbyferry extract --all --ignore uuid,sort
> ```

## Safety & Limits

**`blocks`/`layout` round-trip exactly.** Detected by shape, decoded to real JSON, written back in Kirby's default single-line form. Content stored pretty-printed, e.g. by a field with `pretty: true`, is collapsed to a single line on inject – edited or not.

**Every other field is preserved, not parsed.** With `--all`, it is written back verbatim as its raw string. An untouched field is always safe; one you *edit* is not validated, so broken YAML only surfaces when Kirby reads it.

`inject` is all-or-nothing: it checks every dataset and its content file first and writes nothing if any check fails. `extract` overwrites its datasets, edits not yet injected included.

> [!WARNING]
> `--clean` deletes `.json` files under `--out` that have no content file, whether `extract` wrote them or not – give `--out` a directory of its own.

## Programmatic API

```ts
import { extractFields, injectFields, resolveContentRoot } from 'kirbyferry'

const contentRoot = await resolveContentRoot() // auto-detect, or pass a path
const extractReport = await extractFields(contentRoot, { out: 'content-fields', langs: ['de'] })
const injectResults = await injectFields(contentRoot, { out: 'content-fields', dryRun: true })
```

### `resolveContentRoot`

Returns the absolute path of the content root: `contentDir` resolved against `cwd`, or the first of `content` and `storage/content` that exists there. Throws when it finds no content root. `cwd` defaults to the working directory.

```ts
function resolveContentRoot(contentDir?: string, cwd?: string): Promise<string>
```

### `extractFields`

Extracts `blocks`/`layout` fields under the content root into JSON – or, with `all`, every field (non-structured ones as raw strings). Returns one `ExtractResult` per written file, plus the stale datasets removed by `clean`.

```ts
function extractFields(contentRoot: string, options?: ExtractOptions): Promise<ExtractReport>
```

The options are the CLI options with the same defaults: `out`, the arrays `langs`, `fields`, `ignore`, and `templates`, and the booleans `all` and `clean`. `ignore` wins over `fields`. The report holds the written files in `results` and the removed datasets in `cleanedDatasets`, relative to the output directory.

### `injectFields`

Injects edited JSON back into the matching `.txt` files. Returns one `InjectResult` per dataset, listing the fields written, the fields skipped, and whether the file changed. Throws before writing anything if a dataset is invalid or missing its target – see [Safety & Limits](#safety--limits).

```ts
function injectFields(contentRoot: string, options?: InjectOptions): Promise<InjectResult[]>
```

The options are those of `extractFields` without `all` and `clean`, plus `dryRun` to report changes without writing files.

## License

[MIT](./LICENSE) License © 2026-PRESENT [Johann Schopplich](https://github.com/johannschopplich)
