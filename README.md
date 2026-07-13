# JsonBolt

JsonBolt is a Chrome Manifest V3 extension for inspecting JSON in a full browser tab. It is built for large payloads: paste, drag in a file, parse in a Web Worker, search, fold, expand by depth, and browse the result through a virtualized tree.

## Features

- Opens as a full extension page instead of a small popup.
- Paste-to-replace and drag-and-drop JSON/text files.
- Automatic parsing after paste or file drop without blocking the page.
- Worker-backed parser with progress messages for reading, parsing, and building.
- Streaming parse path for very large dropped files, avoiding full-file reads on the UI thread.
- Lazy tree expansion with byte/offset ranges for large values.
- Virtualized tree rendering via `react-window`.
- Search keys and values with previous/next navigation.
- Format, minify, copy, clear, expand all, collapse all, and expand to a selected depth.
- Browser/system language detection with English and Chinese UI.
- Strict JSON validation, including trailing-content errors, invalid numbers, invalid string escapes, and line/column or byte-position error output.

## Install Locally

```bash
npm install
npm run build
```

Then load the extension in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this project's `dist` directory.

Click the JsonBolt extension icon to open the viewer page. The icon opens the default JsonBolt page only; use the Page button manually when you want to read JSON-like text from the current tab.

## Development

```bash
npm run dev
npm run build
npm run preview
```

The production build writes Chrome extension assets to `dist/`.

## Project Structure

```text
public/
  manifest.json              Chrome MV3 manifest
src/
  background/                Extension service worker
  popup/                     Full-page JsonBolt entry
  sidepanel/                 Side panel entry
  worker/                    JSON parser worker and streaming scanner
  core/                      Types, i18n, formatting, search, tree helpers
  components/                React UI components
  styles/                    Shared CSS
scripts/
  split-json-array.mjs       Utility for splitting huge top-level JSON arrays
```

## Large File Notes

For normal text and medium JSON files, JsonBolt parses text in a Worker. For very large dropped files, the UI reads only a small preview and sends the original `Blob` to the Worker. The Worker uses `Blob.stream()` to scan the JSON in chunks, reports progress, builds the initial tree, and later expands child nodes from byte ranges.

This keeps the page responsive for multi-hundred-MB and GB-scale files. Extremely large files can still take time to fully validate because strict JSON validation must scan the full input.

Blob-backed dropped files retain only a small editable preview in the page. Copy still uses the complete original file, while format and minify are disabled so they never operate on truncated preview data.

## Utility: Split A Huge JSON Array

For performance testing, the repository includes a helper that splits a top-level JSON array into valid smaller JSON array files without cutting through objects:

```bash
node scripts/split-json-array.mjs /path/to/input.json 100 200 400 800 1600
```

The size arguments are in MB. Output files are written next to the input file with names such as `input-100MB.json`.
