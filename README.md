# Theorem List (Zotero 7 plugin)

Adds a `∴` button to the PDF reader's top toolbar. Click it to get a popup
listing every line that starts a theorem-like environment
(Theorem / Lemma / Proposition / Corollary / Definition / Remark / Claim /
Conjecture / Example / Assumption). Click an entry — or select with ↑/↓ and
press Enter — to jump to it in the PDF.

It scans the PDF's own text layer — no content extraction, no network, just a
regex over the lines pdf.js already gives the reader.

![Theorem List popup](screenshot.png)

The popup also has a fuzzy filter, per-type filter chips, and an optional
pastel "Color by type" mode.

## Install (dev)

```sh
# Build the installable .xpi (just a zip of these files):
cd zotero-theorem-list
zip -r theorem-list.xpi manifest.json bootstrap.js
```

Then in Zotero: **Tools → Plugins → gear icon → Install Plugin From File…**
and pick `theorem-list.xpi`. Open any PDF and look for `∴` in the reader toolbar.

For live development, point Zotero at the folder instead of zipping: create a
file named `theorem-list@local` (the id from `manifest.json`) inside your Zotero
profile's `extensions/` directory whose contents are the absolute path to this
folder, then restart Zotero.

## Tweak it

- Edit `KEYWORDS` in `bootstrap.js` to change which environments are listed.
- `node test.js` runs the self-check for the line-grouping + matching logic.

## Caveats

- Detection is heuristic: a header must start a line with a keyword followed by
  a number or `(`. Unnumbered headers (`Theorem.`) won't match; a keyword
  wrapped mid-line into the start of a new line could false-positive.
- Uses the reader's internal `_internalReader._primaryView` to reach pdf.js,
  which is not a documented API — may need a touch-up across major Zotero updates.
- PDF-only (no EPUB/snapshot).
