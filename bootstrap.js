/* Theorem List — a tiny Zotero plugin (bootstrapped, Zotero 7+).
 * Adds a button to the PDF reader toolbar that scans the PDF text for
 * theorem-like headers and lists them in a popup; clicking one jumps there.
 *
 * No build step: this is a plain bootstrapped plugin. Zip the folder (or
 * symlink it into Zotero's extensions dir) — see README.md.
 */

// Default environments and their stripe colors. All of this is editable in
// Settings -> Theorem List; the pref below becomes the source of truth once the
// user changes anything. The colors were solved for maximum perceptual
// separation (min CIEDE2000 ~17.7) so no two stripes read as the same color.
const DEFAULT_TYPES = [
	{ kw: "Theorem", color: "#1e6ccc" },
	{ kw: "Lemma", color: "#4ee46a" },
	{ kw: "Proposition", color: "#c7a126" },
	{ kw: "Corollary", color: "#a03b9a" },
	{ kw: "Definition", color: "#dd8024" },
	{ kw: "Remark", color: "#828997" },
	{ kw: "Claim", color: "#41bdc1" },
	{ kw: "Conjecture", color: "#553add" },
	{ kw: "Example", color: "#819f3c" },
	{ kw: "Assumption", color: "#a23a3a" },
];

// Handed out in order to keywords added without a chosen color. Solved against
// the defaults above, so an added type stays distinguishable from them.
const SPARE_COLORS = ["#d4507a", "#cbd82d", "#e44ee4", "#df4f29", "#35a77b", "#269bd6"];

const PREF_TYPES = "extensions.zotero.theoremList.types";
const FALLBACK_COLOR = "#828997";

// Derived from DEFAULT_TYPES or the pref; refreshed by loadTypes().
let KEYWORDS = DEFAULT_TYPES.map((t) => t.kw);
let TYPE_COLORS = Object.fromEntries(DEFAULT_TYPES.map((t) => [t.kw, t.color]));

// Per-book keyword/color overrides, keyed like scanCache. Deliberately memory
// only: this is a scratchpad for one document, not a setting — Settings is the
// durable place. ponytail: lost on restart by design.
const bookTypes = new Map();
let editorOpen = false; // does the panel show the per-book editor?

// The effective list for a reader: its override if it has one, else the global.
function typesFor(reader) {
	const list = bookTypes.get(reader.itemID);
	if (!list) return { list: globalTypes(), keywords: KEYWORDS, colors: TYPE_COLORS, custom: false };
	return {
		list,
		keywords: list.map((t) => t.kw),
		colors: Object.fromEntries(list.map((t) => [t.kw, t.color])),
		custom: true,
	};
}

function globalTypes() {
	return KEYWORDS.map((kw) => ({ kw, color: TYPE_COLORS[kw] || FALLBACK_COLOR }));
}

// Detection depends only on the keywords; recoloring can skip the re-scan.
const kwKey = (list) => list.map((t) => t.kw).join("\u0000");

function applyTypes(list) {
	const l = (list && list.length) ? list : DEFAULT_TYPES;
	KEYWORDS = l.map((t) => t.kw);
	TYPE_COLORS = Object.fromEntries(l.map((t) => [t.kw, t.color]));
}

// Read the pref into KEYWORDS/TYPE_COLORS. The pref is user-editable text, so
// none of it is trusted: malformed rows are dropped and an unparseable value
// falls back to the defaults rather than leaving the plugin with no keywords.
function loadTypes() {
	try {
		const raw = Zotero.Prefs.get(PREF_TYPES, true);
		if (raw) {
			applyTypes(JSON.parse(raw)
				.filter((t) => t && typeof t.kw === "string" && t.kw.trim())
				.map((t) => ({
					kw: t.kw.trim(),
					color: /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : FALLBACK_COLOR,
				})));
			return;
		}
	} catch (e) {
		Zotero.debug("Theorem List: unreadable types pref, using defaults - " + e);
	}
	applyTypes(null);
}

// A label after the keyword: "3.1", "1.2.3", "A.1", "B", roman "IV", or none.
// (Standalone letters/roman use a negative lookahead so "About"/"In" aren't labels.)
const LABEL_RE = /^[ \t]*(\d+(?:\.\d+)*|\p{Lu}(?:\.\d+)+|[IVXLC]+(?!\p{Ll})|\p{Lu}(?!\p{Ll}))?[ \t]*/u;

// Decide whether a reconstructed line is a theorem header, and split it.
// `bold` = is the line's leading keyword set in a bold font?
//
// Two regimes, tuned against real PDFs:
//  - bold label  → trust it; number optional (catches "Theorem.", "Theorem A.1"),
//    but reject "Theorem proving"-style section titles (keyword + lowercase word).
//  - plain label → require a number/letter AND a header-shaped continuation
//    (not a lowercase word or comma) → drops cross-refs like "Theorem 3.1 we show".
// Dotted leaders ("Theorem 3.1 ...... 45") are table-of-contents entries → drop.
function classify(text, bold, keywords = KEYWORDS) {
	if (/\.\s*\.\s*\./.test(text)) return null; // TOC leader dots
	const w = text.match(/^\p{L}+/u); // \p{L}, not [A-Za-z]: keywords may be Cyrillic etc.
	if (!w) return null;
	const type = keywords.find((k) => k.toLowerCase() === w[0].toLowerCase());
	if (!type) return null;

	const afterKw = text.slice(w[0].length);
	const lm = afterKw.match(LABEL_RE);
	const label = (lm && lm[1]) || "";
	let after = afterKw.slice(lm[0].length);

	let name = "";
	const pm = after.match(/^\(([^)]*)\)/);
	if (pm) { name = pm[0]; after = after.slice(pm[0].length); }

	const next = after.replace(/^\s+/, "").charAt(0);
	const headerLike = bold
		? (!!label || !!name || next === "" || /[.:(]/.test(next) || /\p{Lu}/u.test(next))
		: ((!!label || !!name) && next !== "" && !/[\p{Ll},;]/u.test(next));
	if (!headerLike) return null;

	const head = [type, label, name].filter(Boolean).join(" ");
	const rest = after.replace(/^[\s.:)]+/, "").trim();
	return { type, head, rest };
}

// Classic subsequence fuzzy match: every char of q appears in order in text.
function fuzzy(q, text) {
	if (!q) return true;
	let i = 0;
	for (let j = 0; j < text.length && i < q.length; j++) {
		if (text[j] === q[i]) i++;
	}
	return i === q.length;
}

let onRenderToolbar; // kept for unregister on shutdown
let prefObserver;  // Symbol from Zotero.Prefs.registerObserver
let prefPane;      // id from Zotero.PreferencePanes.register
let openPanel; // { el, btn, cleanup } of the single open popup, or null
// Attachment id → scanned items. A PDF's text never changes, so a scan stays
// valid for the session; keyed off the reader object's item rather than the
// reader itself so closing and reopening a tab doesn't re-scan.
const scanCache = new Map();
const CACHE_MAX = 20; // ~20 MB worst case

// UI state persisted across popup opens (and across documents).
let pinned = false;         // when on, panel survives jumps and outside clicks
let savedQuery = "";        // fuzzy filter text
const savedHidden = new Set(); // type names toggled off

function startup({ id, rootURI }) {
	loadTypes();
	prefObserver = Zotero.Prefs.registerObserver(PREF_TYPES, onTypesChanged, true);
	// The prefs pane reads these instead of duplicating the defaults.
	Zotero.TheoremList = { DEFAULT_TYPES, SPARE_COLORS, PREF: PREF_TYPES };
	Zotero.PreferencePanes.register({
		pluginID: id,
		src: rootURI + "prefs.xhtml",
		scripts: [rootURI + "prefs.js"],
		label: "Theorem List",
	}).then((paneID) => { prefPane = paneID; },
		(e) => Zotero.debug("Theorem List: prefs pane failed to register - " + e));

	onRenderToolbar = (event) => renderButton(event);
	Zotero.Reader.registerEventListener("renderToolbar", onRenderToolbar, id);
}

// Keywords or colors changed → every cached scan was produced by the old rules,
// so drop them all and close any panel still showing the old list.
function onTypesChanged() {
	loadTypes();
	scanCache.clear();
	closePanel();
}

function shutdown() {
	closePanel();
	scanCache.clear();
	if (prefObserver) Zotero.Prefs.unregisterObserver(prefObserver);
	prefObserver = null;
	if (prefPane) Zotero.PreferencePanes.unregister(prefPane);
	prefPane = null;
	delete Zotero.TheoremList;
	if (onRenderToolbar && Zotero.Reader.unregisterEventListener) {
		Zotero.Reader.unregisterEventListener("renderToolbar", onRenderToolbar);
	}
	onRenderToolbar = null;
}

function install() {}
function uninstall() {}

// --- styles ----------------------------------------------------------------

// One stylesheet per reader document, injected on first use. Everything below
// only sets classes and a --tl-c accent; hover, keyboard selection, sticky
// headers and theming all live here so there are no per-element repaint
// handlers to keep in sync.
const CSS = `
.tl-panel{position:fixed;box-sizing:border-box;z-index:99999;background:Canvas;color:CanvasText;
 border:1px solid color-mix(in srgb,CanvasText 25%,Canvas);border-radius:8px;
 box-shadow:0 6px 24px rgba(0,0,0,.28);max-height:70vh;overflow-y:auto;overflow-x:hidden;
 font:13px system-ui,sans-serif;padding:0 0 4px;scroll-padding-top:var(--tl-top,92px)}
.tl-msg{padding:8px 10px;color:GrayText;overflow-wrap:anywhere}
.tl-controls{position:sticky;top:0;z-index:2;background:Canvas;padding:6px 8px;
 border-bottom:1px solid color-mix(in srgb,CanvasText 18%,Canvas);
 display:flex;flex-direction:column;gap:6px}
.tl-search{width:100%;box-sizing:border-box;padding:4px 7px;font:13px system-ui,sans-serif;
 border:1px solid color-mix(in srgb,CanvasText 28%,Canvas);border-radius:5px;
 background:Canvas;color:CanvasText}
.tl-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.tl-chip,.tl-btn{font:11px system-ui,sans-serif;padding:2px 8px;border-radius:10px;cursor:pointer;
 border:1px solid color-mix(in srgb,CanvasText 25%,Canvas);background:transparent;
 transition:background .12s,color .12s}
.tl-chip{color:GrayText}
.tl-btn{color:CanvasText}
.tl-chip[aria-pressed=true]{background:color-mix(in srgb,var(--tl-c) 22%,Canvas);
 border-color:color-mix(in srgb,var(--tl-c) 50%,Canvas);color:CanvasText}
.tl-btn[aria-pressed=true]{background:Highlight;border-color:Highlight;color:HighlightText}
.tl-bottom{display:flex;align-items:center;gap:6px}
.tl-count{font:11px system-ui,sans-serif;color:GrayText;margin-left:auto}
.tl-row{padding:6px 10px;cursor:pointer;overflow-wrap:anywhere;
 border-left:4px solid var(--tl-c);transition:background .12s}
.tl-row:hover{background:color-mix(in srgb,CanvasText 7%,Canvas)}
.tl-pg{font-size:11px;color:GrayText;margin-right:6px}
.tl-label{font-weight:700}
.tl-rest{font-size:11px;color:GrayText;margin-top:1px;line-height:1.3;
 white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tl-section{position:sticky;top:var(--tl-top,92px);z-index:1;padding:5px 10px;cursor:pointer;
 overflow-wrap:anywhere;border-left:3px solid color-mix(in srgb,CanvasText 45%,Canvas);
 background:color-mix(in srgb,CanvasText 8%,Canvas);transition:background .12s}
.tl-section .tl-label{font-weight:600;font-size:12px}
.tl-section[data-level="1"] .tl-label{font-weight:700;font-size:13px}
.tl-section:hover{background:color-mix(in srgb,CanvasText 18%,Canvas)}
.tl-sel{outline:2px solid Highlight;outline-offset:-2px}
.tl-editor{display:flex;flex-direction:column;gap:4px;padding:6px 0 2px;
 border-top:1px solid color-mix(in srgb,CanvasText 15%,Canvas)}
.tl-erow{display:flex;gap:4px;align-items:center}
.tl-ekw{flex:1;min-width:0;box-sizing:border-box;padding:2px 6px;font:12px system-ui,sans-serif;
 border:1px solid color-mix(in srgb,CanvasText 28%,Canvas);border-radius:4px;
 background:Canvas;color:CanvasText}
.tl-ecolor{flex:none;width:30px;height:22px;padding:0;border:none;background:none;cursor:pointer}
.tl-edel{padding:2px 6px;line-height:1.2}
.tl-eactions{display:flex;gap:4px}
@media (prefers-reduced-motion:reduce){.tl-row,.tl-section,.tl-chip,.tl-btn{transition:none}}
`;

function injectCSS(doc) {
	if (doc.getElementById("theorem-list-css")) return;
	const style = doc.createElement("style");
	style.id = "theorem-list-css";
	style.textContent = CSS;
	(doc.head || doc.documentElement).append(style);
}

// --- toolbar button --------------------------------------------------------

function renderButton(event) {
	const { reader, doc, append } = event;
	injectCSS(doc);
	const btn = doc.createElement("button");
	btn.className = "toolbar-button"; // reuse reader styling if present
	btn.title = "Theorem list";
	btn.textContent = "∴"; // ∴
	btn.style.cssText = "font-size:16px;cursor:pointer;background:none;border:none;";
	btn.addEventListener("click", () => togglePanel(reader, doc, btn));
	append(btn);
}

// What a click on `btn` should do, given whatever panel is currently open.
// Only the button that opened a panel toggles it shut; a panel belonging to
// another reader tab — or orphaned by one that was closed — is torn down and
// this button opens its own. Pure so test.js can pin the behavior down.
function clickAction(open, btn) {
	if (!open) return "open";
	return open.btn === btn ? "close" : "replace";
}

function togglePanel(reader, doc, btn) {
	// The panel lives in one reader's document, but outside-click and Escape are
	// only wired to that document — switching Zotero tabs leaves it open. So
	// always clear whatever is open before deciding whether to build a new one.
	const action = clickAction(openPanel, btn);
	closePanel();
	if (action === "close") return;
	loadPanel(reader, doc, makePanel(reader, doc, btn));
}

// Scan (or read the cache) and render into an already-open panel. Split out of
// togglePanel so editing the per-book keywords can re-run it in place.
function loadPanel(reader, doc, panel) {
	const msg = (text) => {
		panel.replaceChildren();
		const row = doc.createElement("div");
		row.className = "tl-msg";
		row.textContent = text;
		panel.append(row);
	};
	msg("Scanning…");

	extractTheorems(reader).then((items) => {
		if (!openPanel || openPanel.el !== panel) return; // closed meanwhile
		if (items === null) return msg("No PDF (or not loaded yet).");
		// Zero hits still builds the UI: the editor is the only way to undo a
		// keyword list that matched nothing.
		buildUI(doc, panel, reader, items);
	}).catch((e) => {
		Zotero.debug("Theorem List: " + ((e && e.stack) || e));
		if (openPanel && openPanel.el === panel) msg("Error: " + ((e && e.message) || String(e)));
	});
}

// Keyword/color editor for this book only. Edits land in `bookTypes`; changing
// the keywords drops that book's cached scan and re-scans, while a recolor just
// re-renders the rows.
function makeEditor(doc, panel, reader) {
	const box = doc.createElement("div");
	box.className = "tl-editor";
	const rows = doc.createElement("div");
	box.append(rows);

	const collect = () => [...rows.children]
		.map((r) => ({ kw: r.querySelector(".tl-ekw").value.trim(), color: r.querySelector(".tl-ecolor").value }))
		.filter((t) => t.kw);

	const apply = () => {
		const before = typesFor(reader).keywords.join("\u0000");
		const list = collect();
		bookTypes.set(reader.itemID, list);
		if (kwKey(list) !== before) scanCache.delete(reader.itemID); // detection changed
		loadPanel(reader, doc, panel);
	};

	const addRow = (t) => {
		const r = doc.createElement("div");
		r.className = "tl-erow";
		const kw = doc.createElement("input");
		kw.type = "text";
		kw.className = "tl-ekw";
		kw.value = t.kw;
		kw.placeholder = "Keyword";
		kw.addEventListener("keydown", (e) => e.stopPropagation()); // not reader shortcuts
		const color = doc.createElement("input");
		color.type = "color";
		color.className = "tl-ecolor";
		color.value = t.color;
		const del = doc.createElement("button");
		del.className = "tl-btn tl-edel";
		del.textContent = "✕";
		del.title = "Remove";
		// "change" (commit on blur), not "input": no re-scan per keystroke.
		kw.addEventListener("change", apply);
		color.addEventListener("change", apply);
		del.addEventListener("click", () => { r.remove(); apply(); });
		r.append(kw, color, del);
		rows.append(r);
		return r;
	};

	for (const t of typesFor(reader).list) addRow(t);

	const add = doc.createElement("button");
	add.className = "tl-btn";
	add.textContent = "+ Keyword";
	add.addEventListener("click", () => {
		const used = new Set(collect().map((t) => t.color.toLowerCase()));
		addRow({ kw: "", color: SPARE_COLORS.find((c) => !used.has(c)) || FALLBACK_COLOR })
			.querySelector(".tl-ekw").focus();
	});

	const reset = doc.createElement("button");
	reset.className = "tl-btn";
	reset.textContent = "Use global";
	reset.title = "Drop this book's list and go back to the Settings one";
	reset.addEventListener("click", () => {
		bookTypes.delete(reader.itemID);
		scanCache.delete(reader.itemID);
		loadPanel(reader, doc, panel);
	});

	const actions = doc.createElement("div");
	actions.className = "tl-eactions";
	actions.append(add, reset);
	box.append(actions);
	return box;
}

// Search + type filter, then the live-filtered list.
function buildUI(doc, panel, reader, items) {
	panel.replaceChildren();
	const types = [...new Set(items.map((it) => it.type))];
	const hidden = savedHidden; // shared Set → toggles persist across opens
	const eff = typesFor(reader); // per-book override, or the global list
	const colorOf = (t) => eff.colors[t] || FALLBACK_COLOR;

	const controls = doc.createElement("div");
	controls.className = "tl-controls";

	const search = doc.createElement("input");
	search.type = "search";
	search.className = "tl-search";
	search.placeholder = "Fuzzy filter…";
	search.value = savedQuery;
	search.addEventListener("input", () => { savedQuery = search.value; render(); });
	// Don't let typed keys trigger reader shortcuts; keep Escape working.
	search.addEventListener("keydown", (e) => {
		if (e.key === "Escape") return; // let it bubble so the panel closes
		e.stopPropagation(); // typed keys must not trigger reader shortcuts
		if (e.key === "ArrowDown") { e.preventDefault(); applySel(sel + 1); }
		else if (e.key === "ArrowUp") { e.preventDefault(); applySel(sel - 1); }
		else if (e.key === "Enter") { e.preventDefault(); if (shown[sel]) jumpTo(reader, shown[sel]); }
	});
	controls.append(search);

	const chipBar = doc.createElement("div");
	chipBar.className = "tl-chips";
	for (const t of types) {
		const chip = doc.createElement("button");
		chip.className = "tl-chip";
		chip.textContent = t;
		chip.style.setProperty("--tl-c", colorOf(t));
		chip.setAttribute("aria-pressed", String(!hidden.has(t)));
		chip.addEventListener("click", () => {
			hidden.has(t) ? hidden.delete(t) : hidden.add(t);
			chip.setAttribute("aria-pressed", String(!hidden.has(t)));
			render();
		});
		chipBar.append(chip);
	}
	controls.append(chipBar);

	const pin = doc.createElement("button");
	pin.className = "tl-btn";
	pin.title = "Pin: keep open on jump and outside click";
	const paintPin = () => {
		pin.textContent = pinned ? "📌 Pinned" : "📍 Pin";
		pin.setAttribute("aria-pressed", String(pinned));
	};
	paintPin();
	pin.addEventListener("click", () => { pinned = !pinned; paintPin(); });

	const copy = doc.createElement("button");
	copy.className = "tl-btn";
	copy.textContent = "📋 Copy";
	copy.title = "Copy the visible list (in order) to clipboard";
	copy.addEventListener("click", () => {
		// Bold the leading "<word> <number>" (e.g. **Theorem 1.2**, **Chapter 3**);
		// the number is the first whitespace-token that contains a digit.
		const boldHead = (word, body) => {
			const m = body.match(/^\s*(\S*\d\S*)\s*/);
			return m
				? "**" + word + " " + m[1] + "** " + body.slice(m[0].length)
				: "**" + word + "** " + body;
		};
		const text = shown.map((it) => {
			if (!it.isSection)
				return "- " + boldHead(it.type, it.head.slice(it.type.length).trim());
			return "- " + boldHead(it.level === 1 ? "Chapter" : "Section", it.head);
		}).join("\n");
		Zotero.Utilities.Internal.copyTextToClipboard(text);
		copy.textContent = "✓ Copied";
		doc.defaultView.setTimeout(() => { copy.textContent = "📋 Copy"; }, 1200);
	});

	const editor = makeEditor(doc, panel, reader);
	editor.hidden = !editorOpen;

	const types_ = doc.createElement("button");
	types_.className = "tl-btn";
	types_.textContent = "🎨 Types";
	types_.title = eff.custom
		? "Keywords for this book only (in use) — cleared when Zotero restarts"
		: "Edit keywords for this book only — not saved to Settings";
	// Pressed when a per-book list is active, so it's obvious this book differs.
	types_.setAttribute("aria-pressed", String(eff.custom));
	types_.addEventListener("click", () => {
		editorOpen = !editorOpen;
		editor.hidden = !editorOpen;
		measureControls(panel, controls); // sticky offset depends on this height
	});

	const count = doc.createElement("span");
	count.className = "tl-count";

	const bottom = doc.createElement("div");
	bottom.className = "tl-bottom";
	bottom.append(pin, copy, types_, count);
	controls.append(bottom, editor);

	panel.append(controls);
	measureControls(panel, controls);

	const list = doc.createElement("div");
	panel.append(list);

	let shown = [];   // currently visible items
	let rowEls = [];  // their row elements, parallel to shown
	let sel = -1;     // index of the keyboard-selected row

	const applySel = (i) => {
		if (rowEls[sel]) rowEls[sel].classList.remove("tl-sel");
		sel = Math.max(0, Math.min(i, rowEls.length - 1));
		const r = rowEls[sel];
		if (!r) return;
		r.classList.add("tl-sel");
		r.scrollIntoView({ block: "nearest" });
	};

	const render = () => {
		list.replaceChildren();
		const q = savedQuery.trim().toLowerCase();
		shown = items.filter((it) =>
			!hidden.has(it.type) && fuzzy(q, (it.head + " " + it.rest).toLowerCase()));
		count.textContent = `${shown.length} / ${items.length}`;
		rowEls = [];
		sel = -1;
		if (!shown.length) {
			const none = doc.createElement("div");
			none.className = "tl-msg";
			none.textContent = items.length ? "No matches." : "No theorems found.";
			list.append(none);
			return;
		}
		for (const it of shown) {
			const r = makeRow(doc, reader, it, colorOf);
			rowEls.push(r);
			list.append(r);
		}
		applySel(0);
	};

	render();
	search.focus();
}

// Sticky section headers park under the controls, and arrow-key scrolling must
// clear them — both read --tl-top. Re-measured whenever the controls change
// height (the editor opening or closing).
function measureControls(panel, controls) {
	panel.style.setProperty("--tl-top", controls.offsetHeight + "px");
}

function makeRow(doc, reader, it, colorOf) {
	if (it.isSection) return makeSectionRow(doc, reader, it);
	const r = doc.createElement("div");
	r.className = "tl-row";
	r.style.setProperty("--tl-c", colorOf(it.type));

	const head = doc.createElement("div");
	const pg = doc.createElement("span");
	pg.className = "tl-pg";
	pg.textContent = `p.${it.pageIndex + 1}`;
	const label = doc.createElement("span");
	label.className = "tl-label";
	label.textContent = it.head;
	head.append(pg, label);
	r.append(head);

	if (it.rest) {
		const sub = doc.createElement("div");
		sub.className = "tl-rest"; // one line, ellipsised — keeps the list scannable
		sub.textContent = it.rest;
		sub.title = it.rest;
		r.append(sub);
	}

	r.addEventListener("click", () => jumpTo(reader, it));
	return r;
}

// Outline sections render as a structural row: indented by depth, a left rule,
// no accent stripe — deliberately unlike the theorem rows. They stick to the
// top of the list while scrolling so the current section is always visible.
function makeSectionRow(doc, reader, it) {
	const r = doc.createElement("div");
	r.className = "tl-section";
	r.dataset.level = it.level;
	r.style.paddingLeft = (10 + (it.level - 1) * 14) + "px";

	const pg = doc.createElement("span");
	pg.className = "tl-pg";
	pg.textContent = `p.${it.pageIndex + 1}`;
	const label = doc.createElement("span");
	label.className = "tl-label";
	label.textContent = it.head;
	r.append(pg, label);

	r.addEventListener("click", () => jumpTo(reader, it));
	return r;
}

function makePanel(reader, doc, btn) {
	injectCSS(doc);
	const panel = doc.createElement("div");
	panel.className = "tl-panel";
	const rect = btn.getBoundingClientRect();
	const vw = (doc.defaultView && doc.defaultView.innerWidth) || 800;
	const W = 360;
	const left = Math.max(8, Math.min(rect.left, vw - W - 8)); // keep on screen
	panel.style.top = `${rect.bottom + 4}px`;
	panel.style.left = `${left}px`;
	panel.style.width = `${W}px`;
	doc.body.append(panel);

	const onDown = (e) => {
		if (pinned) return; // pinned → stay open even when clicking the PDF
		if (!panel.contains(e.target) && e.target !== btn) closePanel();
	};
	const onKey = (e) => {
		if (e.key === "Escape") closePanel();
	};

	// The PDF lives in a nested iframe, so clicks/keys there don't reach the
	// reader doc — listen on both so outside-click and Escape always work.
	const docs = [doc];
	const innerDoc = reader?._internalReader?._primaryView?._iframeWindow?.document;
	if (innerDoc && innerDoc !== doc) docs.push(innerDoc);
	for (const d of docs) {
		d.addEventListener("pointerdown", onDown, true);
		d.addEventListener("keydown", onKey, true);
	}

	openPanel = {
		el: panel,
		btn,
		cleanup: () => {
			for (const d of docs) {
				d.removeEventListener("pointerdown", onDown, true);
				d.removeEventListener("keydown", onKey, true);
			}
		},
	};
	return panel;
}

function closePanel() {
	if (!openPanel) return;
	// Null the state first: if the owning document was already torn down,
	// cleanup() can throw, and leaving openPanel set would wedge every button
	// into swallowing its next click.
	const panel = openPanel;
	openPanel = null;
	try {
		panel.cleanup();
		panel.el.remove();
	} catch (e) {
		Zotero.debug("Theorem List: stale panel cleanup - " + e);
	}
}

function jumpTo(reader, it) {
	// Outline sections may resolve to a page with no anchor rect → page-only nav.
	reader.navigate(it.rects && it.rects.length
		? { position: { pageIndex: it.pageIndex, rects: it.rects } }
		: { pageIndex: it.pageIndex });
	if (!pinned) closePanel();
}

// --- PDF scanning ----------------------------------------------------------

async function extractTheorems(reader) {
	// No itemID (unexpected reader shape) → skip the cache rather than let every
	// such reader collide on one undefined key and serve each other's results.
	const cacheKey = reader.itemID;
	if (cacheKey != null && scanCache.has(cacheKey)) return scanCache.get(cacheKey);
	const win = reader?._internalReader?._primaryView?._iframeWindow;
	const pdf = win?.PDFViewerApplication?.pdfDocument;
	if (!pdf) return null; // not a PDF, or reader not ready
	const { keywords } = typesFor(reader); // per-book override, or the global list

	const Cu = Components.utils;
	const N = pdf.numPages;

	// Zotero's pdf.js fork: structured text per page, not getTextContent().
	// The arg must be built in the reader's window or it can't be cloned to the
	// pdf.js worker; waive Xrays to read the returned char objects.
	const scanPage = async (i) => {
		const data = Cu.waiveXrays(await pdf.getPageData(Cu.cloneInto({ pageIndex: i }, win)));
		const chars = data && data.chars;
		const items = [];
		if (chars && chars.length) {
			for (const line of charsToLines(chars)) {
				const hit = classify(line.text, line.bold, keywords);
				if (hit) items.push({ type: hit.type, head: hit.head, rest: hit.rest.slice(0, 200), pageIndex: i, rects: [line.rect] });
			}
		}
		return items;
	};

	// Pipeline page requests: the worker is single-threaded, but keeping a few
	// in flight hides the per-page round-trip + structured-clone latency that an
	// await-per-page loop spends idle. Bounded so huge PDFs don't buffer every
	// page's char array at once.
	// ponytail: fixed window, not unbounded Promise.all — caps memory on books.
	const CONCURRENCY = 8;
	const perPage = new Array(N);
	let next = 0;
	const worker = async () => {
		while (next < N) {
			const i = next++;
			perPage[i] = await scanPage(i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, N) }, worker));

	const out = [];
	for (const items of perPage) if (items) out.push(...items);

	// Sections come from the PDF's own outline (bookmarks) — far more reliable
	// than guessing headings from the page text. Interleave by page; show a
	// section heading before the theorems sitting on the same page.
	out.push(...await extractOutline(pdf, Cu));
	// Within a page, order top-to-bottom so a theorem above a heading stays above
	// it. Bottom-left origin → larger top-y is higher. Whole-page section dests
	// have no rect (topY=∞) → sort to page top, falling back to section-first.
	const topY = it => (it.rects && it.rects.length) ? it.rects[0][3] : Infinity;
	out.sort((a, b) => a.pageIndex - b.pageIndex || topY(b) - topY(a) || (b.isSection ? 1 : 0) - (a.isSection ? 1 : 0));

	if (cacheKey != null) {
		scanCache.set(cacheKey, out);
		// Map iterates in insertion order → evict the oldest scan.
		// ponytail: FIFO, not LRU; worst case is one needless re-scan.
		if (scanCache.size > CACHE_MAX) scanCache.delete(scanCache.keys().next().value);
	}
	return out;
}

// Read the PDF outline and flatten it to section items. Returns [] if the PDF
// has no outline or anything goes wrong (sections are a bonus, never fatal).
async function extractOutline(pdf, Cu) {
	let outline;
	try { outline = Cu.waiveXrays(await pdf.getOutline()); } catch (e) { return []; }
	if (!outline || !outline.length) return [];

	const out = [];
	const walk = async (nodes, level) => {
		for (const node of nodes) {
			const loc = await destToLocation(pdf, Cu, node.dest);
			if (loc) out.push({ type: "Section", isSection: true, level, head: (node.title || "").trim() || "(untitled)", rest: "", pageIndex: loc.pageIndex, rects: loc.rects });
			if (node.items && node.items.length) await walk(node.items, level + 1);
		}
	};
	await walk(outline, 1);
	return out;
}

// Resolve a pdf.js outline dest → { pageIndex, rects } in the bottom-left PDF
// point space reader.navigate expects. dest is either an explicit
// [ref, {name}, ...coords] array or a named-destination string to look up.
async function destToLocation(pdf, Cu, dest) {
	try {
		let explicit = dest;
		if (typeof dest === "string") explicit = Cu.waiveXrays(await pdf.getDestination(dest));
		if (!Array.isArray(explicit) || !explicit[0]) return null;
		const pageIndex = await pdf.getPageIndex(explicit[0]); // 0-based
		const name = explicit[1] && explicit[1].name;
		const top = name === "XYZ" ? explicit[3]
			: (name === "FitH" || name === "FitBH") ? explicit[2]
			: name === "FitR" ? explicit[5] : null; // Fit/FitB/FitV → whole page
		const left = (name === "XYZ" && typeof explicit[2] === "number") ? explicit[2] : 0;
		const rects = typeof top === "number" ? [[left, top - 1, left + 1, top]] : [];
		return { pageIndex, rects };
	} catch (e) { return null; }
}

function isBold(ch) {
	return !!ch.bold || /bold|black|semibold|heavy/i.test(ch.fontName || "");
}

// Reconstruct visual lines from Zotero's per-char structured text; record
// whether each line's leading (keyword) char is bold.
// char: { c, rect:[x1,y1,x2,y2], bold, italic, fontName, spaceAfter, lineBreakAfter, paragraphBreakAfter, ignorable }
function charsToLines(chars) {
	const lines = [];
	let buf = "";
	let rect = null;
	let bold = false;
	let gotFirst = false;
	const flush = () => {
		const text = buf.replace(/\s+/g, " ").trim();
		if (text && rect) lines.push({ text, rect, bold });
		buf = "";
		rect = null;
		bold = false;
		gotFirst = false;
	};
	for (const ch of chars) {
		if (ch.ignorable) continue;
		if (!gotFirst && ch.c && ch.c.trim()) { bold = isBold(ch); gotFirst = true; }
		buf += ch.c;
		if (ch.rect) {
			if (!rect) rect = ch.rect.slice();
			else {
				rect[0] = Math.min(rect[0], ch.rect[0]);
				rect[1] = Math.min(rect[1], ch.rect[1]);
				rect[2] = Math.max(rect[2], ch.rect[2]);
				rect[3] = Math.max(rect[3], ch.rect[3]);
			}
		}
		if (ch.spaceAfter) buf += " ";
		if (ch.lineBreakAfter || ch.paragraphBreakAfter) flush();
	}
	flush();
	return lines;
}

// node-only: lets test.js import the pure helpers; no-op inside Zotero.
if (typeof module !== "undefined") module.exports = { charsToLines, classify, fuzzy, applyTypes, clickAction };
