# How we read PDF text (and why it's like this)

Reference for if PDF scanning or jump-to ever breaks. Verified against
`zotero/zotero`, `zotero/reader`, `zotero/pdf.js`, `zotero/pdf-worker` source
(checked 2026-06).

## The access path (in `extractTheorems`, bootstrap.js)

```js
reader._internalReader._primaryView._iframeWindow   // the reader iframe window
  .PDFViewerApplication.pdfDocument                 // pdf.js doc proxy
  .getPageData(cloneInto({ pageIndex: i }, win))    // -> { chars: [...] }
```

- `reader` comes from `Zotero.Reader.registerEventListener("renderToolbar", ...)`.
- `getPageData({ pageIndex })` is a **custom method in Zotero's pdf.js fork**
  (not upstream pdf.js). Returns `{ chars, overlays, viewBox, ... }`.
- This is the same chain Zotero core uses internally (`reader.js` viewer geometry).

## The `chars` shape we rely on

Each char: `c`, `rect` `[x1,y1,x2,y2]`, `bold`, `italic`, `fontName`,
`spaceAfter`, `lineBreakAfter`, `paragraphBreakAfter`, `ignorable`
(+ unused: `u`, `fontSize`, `glyphWidth`, `baseline`, `rotation`, ...).
Built in pdf.js fork `src/core/evaluator.js` + `src/core/module/structure.js`.

## Coordinates — the load-bearing fact

Char `rect`s are **PDF user-space points, bottom-left origin, no
scale/viewport**. `reader.navigate({ position: { pageIndex, rects } })` expects
the **same** space (it does the Y-flip / px conversion itself, in reader's
`pdf-view.js`). That match is *why* jump-to lands correctly. Annotations store
rects in PDF points too.

→ If you ever swap the text source, the new rects MUST be PDF points/bottom-left
or every jump lands off-target.

## Why the Xray/cloneInto dance

Privileged plugin code calling into the content iframe's pdf.js:
- `cloneInto(arg, win)` — hand a plain options object into content scope.
- `waiveXrays(result)` — read the plain JS object pdf.js returns (Xray wrappers
  hide non-native props otherwise).
Necessary and correct; mirrors Zotero core (`reader.js` wraps its own
`createReader` arg the same way).

## Alternatives we evaluated and REJECTED

- `Zotero.PDFWorker.getStructuredDocumentText(itemID)` — returns deflate-packed
  **block model** `{ buf }` (paragraphs/lines/tables), NOT per-char rects.
  Can't feed char-grouping or jump-to. **Not a drop-in.**
- `Zotero.PDFWorker.getFullText(itemID)` — plain concatenated text only, no
  rects → no jump-to. Only useful if we ever drop navigation.
- `pdfDocument.getProcessedData()` — one iframe call, `{ pages }`, same chars,
  same coordinate space. *Faster* (1 call vs N) but extracts every page eagerly
  → all chars in memory at once. We kept the per-page loop + bounded-concurrency
  pipeline instead (kills round-trip latency, keeps memory bounded). Switch to
  this only if first-open on a huge book is a real complaint.

## Stability risk

`_internalReader` / `_primaryView` / `_iframeWindow` / `getPageData` are all
private (underscore / fork-custom) APIs — can change across Zotero 7/8. Zotero
core leans on the same chain, so it shouldn't break silently without theirs
breaking too. No cleaner public API exists for char-level text + rects.

**If scanning suddenly returns nothing:** check that `getPageData` still exists
and `data.chars` still has these fields; check the `_internalReader...` path
still resolves. **If jump-to lands wrong:** the rect coordinate space changed.
