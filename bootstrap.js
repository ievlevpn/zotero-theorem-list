/* Theorem List — a tiny Zotero plugin (bootstrapped, Zotero 7+).
 * Adds a button to the PDF reader toolbar that scans the PDF text for
 * theorem-like headers and lists them in a popup; clicking one jumps there.
 *
 * No build step: this is a plain bootstrapped plugin. Zip the folder (or
 * symlink it into Zotero's extensions dir) — see README.md.
 */

// Environment keywords to list. Edit to taste (add Notation, Problem, …).
const KEYWORDS = [
	"Theorem", "Lemma", "Proposition", "Corollary",
	"Definition", "Remark", "Claim", "Conjecture", "Example", "Assumption",
];

// Pastel background per type for the optional "Color by type" mode.
const TYPE_COLORS = {
	Theorem: "#cfe8ff", Lemma: "#d8f5d0", Proposition: "#ffe6cc",
	Corollary: "#f6d3ea", Definition: "#fff4c2", Remark: "#e3e3e3",
	Claim: "#cdf0ef", Conjecture: "#e6d6ff", Example: "#cdf3df",
	Assumption: "#ffd6d6",
};
const FALLBACK_COLOR = "#eeeeee";

// A label after the keyword: "3.1", "1.2.3", "A.1", "B", roman "IV", or none.
// (Standalone letters/roman use a negative lookahead so "About"/"In" aren't labels.)
const LABEL_RE = /^[ \t]*(\d+(?:\.\d+)*|[A-Z](?:\.\d+)+|[IVXLC]+(?![a-z])|[A-Z](?![a-z]))?[ \t]*/;

// Decide whether a reconstructed line is a theorem header, and split it.
// `bold` = is the line's leading keyword set in a bold font?
//
// Two regimes, tuned against real PDFs:
//  - bold label  → trust it; number optional (catches "Theorem.", "Theorem A.1"),
//    but reject "Theorem proving"-style section titles (keyword + lowercase word).
//  - plain label → require a number/letter AND a header-shaped continuation
//    (not a lowercase word or comma) → drops cross-refs like "Theorem 3.1 we show".
// Dotted leaders ("Theorem 3.1 ...... 45") are table-of-contents entries → drop.
function classify(text, bold) {
	if (/\.\s*\.\s*\./.test(text)) return null; // TOC leader dots
	const w = text.match(/^[A-Za-z]+/);
	if (!w) return null;
	const type = KEYWORDS.find((k) => k.toLowerCase() === w[0].toLowerCase());
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
		? (!!label || !!name || next === "" || /[.:(]/.test(next) || /[A-Z]/.test(next))
		: ((!!label || !!name) && next !== "" && !/[a-z,;]/.test(next));
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
let openPanel; // { el, cleanup } of the single open popup, or null
let colorOn = false; // "Color by type" toggle, persisted across opens

function startup({ id }) {
	onRenderToolbar = (event) => renderButton(event);
	Zotero.Reader.registerEventListener("renderToolbar", onRenderToolbar, id);
}

function shutdown() {
	closePanel();
	if (onRenderToolbar && Zotero.Reader.unregisterEventListener) {
		Zotero.Reader.unregisterEventListener("renderToolbar", onRenderToolbar);
	}
	onRenderToolbar = null;
}

function install() {}
function uninstall() {}

// --- toolbar button --------------------------------------------------------

function renderButton(event) {
	const { reader, doc, append } = event;
	const btn = doc.createElement("button");
	btn.className = "toolbar-button"; // reuse reader styling if present
	btn.title = "Theorem list";
	btn.textContent = "∴"; // ∴
	btn.style.cssText = "font-size:16px;cursor:pointer;background:none;border:none;";
	btn.addEventListener("click", () => togglePanel(reader, doc, btn));
	append(btn);
}

function togglePanel(reader, doc, btn) {
	if (openPanel) {
		closePanel();
		return;
	}
	const panel = makePanel(reader, doc, btn);
	const msg = (text) => {
		panel.replaceChildren();
		const row = doc.createElement("div");
		row.textContent = text;
		row.style.cssText = "padding:6px 10px;color:GrayText;white-space:normal;overflow-wrap:anywhere;";
		panel.append(row);
	};
	msg("Scanning…");

	extractTheorems(reader).then((items) => {
		if (!openPanel || openPanel.el !== panel) return; // closed meanwhile
		if (items === null) return msg("No PDF (or not loaded yet).");
		if (items.length === 0) return msg("No theorems found.");
		buildUI(doc, panel, reader, items);
	}).catch((e) => {
		Zotero.debug("Theorem List: " + ((e && e.stack) || e));
		if (openPanel && openPanel.el === panel) msg("Error: " + ((e && e.message) || String(e)));
	});
}

// Search + type filter + color toggle, then the live-filtered list.
function buildUI(doc, panel, reader, items) {
	panel.replaceChildren();
	const types = [...new Set(items.map((it) => it.type))];
	const hidden = new Set();
	let query = "";

	const controls = doc.createElement("div");
	controls.style.cssText = "position:sticky;top:0;z-index:1;background:Canvas;padding:6px 8px;border-bottom:1px solid GrayText;display:flex;flex-direction:column;gap:6px;";

	const search = doc.createElement("input");
	search.type = "search";
	search.placeholder = "Fuzzy filter…";
	search.style.cssText = "width:100%;box-sizing:border-box;padding:3px 6px;font:13px sans-serif;";
	search.addEventListener("input", () => { query = search.value; render(); });
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
	chipBar.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;align-items:center;";
	for (const t of types) {
		const chip = doc.createElement("button");
		chip.textContent = t;
		const base = "font:11px sans-serif;padding:2px 8px;border-radius:10px;cursor:pointer;border:1px solid GrayText;";
		const paint = () => {
			const on = !hidden.has(t);
			chip.style.cssText = base + `background:${on ? (TYPE_COLORS[t] || FALLBACK_COLOR) : "transparent"};color:${on ? "#222" : "GrayText"};opacity:${on ? "1" : ".55"};`;
		};
		paint();
		chip.addEventListener("click", () => {
			hidden.has(t) ? hidden.delete(t) : hidden.add(t);
			paint();
			render();
		});
		chipBar.append(chip);
	}
	controls.append(chipBar);

	const colorLabel = doc.createElement("label");
	colorLabel.style.cssText = "font:11px sans-serif;display:flex;align-items:center;gap:5px;cursor:pointer;color:CanvasText;";
	const colorCb = doc.createElement("input");
	colorCb.type = "checkbox";
	colorCb.checked = colorOn;
	colorCb.addEventListener("change", () => { colorOn = colorCb.checked; render(); });
	colorLabel.append(colorCb, doc.createTextNode("Color by type"));

	const count = doc.createElement("span");
	count.style.cssText = "font:11px sans-serif;color:GrayText;";

	const bottom = doc.createElement("div");
	bottom.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
	bottom.append(colorLabel, count);
	controls.append(bottom);

	panel.append(controls);

	const list = doc.createElement("div");
	panel.append(list);

	let shown = [];   // currently visible items
	let rowEls = [];  // their row elements, parallel to shown
	let sel = -1;     // index of the keyboard-selected row

	const applySel = (i) => {
		if (rowEls[sel]) rowEls[sel].style.outline = "";
		sel = Math.max(0, Math.min(i, rowEls.length - 1));
		const r = rowEls[sel];
		if (!r) return;
		r.style.outline = "2px solid Highlight";
		r.style.outlineOffset = "-2px";
		r.scrollIntoView({ block: "nearest" });
	};

	const render = () => {
		list.replaceChildren();
		const q = query.trim().toLowerCase();
		shown = items.filter((it) =>
			!hidden.has(it.type) && fuzzy(q, (it.head + " " + it.rest).toLowerCase()));
		count.textContent = `${shown.length} / ${items.length}`;
		rowEls = [];
		sel = -1;
		if (!shown.length) {
			const none = doc.createElement("div");
			none.textContent = "No matches.";
			none.style.cssText = "padding:6px 10px;color:GrayText;";
			list.append(none);
			return;
		}
		for (const it of shown) {
			const r = makeRow(doc, reader, it);
			rowEls.push(r);
			list.append(r);
		}
		applySel(0);
	};

	render();
	search.focus();
}

function makeRow(doc, reader, it) {
	const pastel = TYPE_COLORS[it.type] || FALLBACK_COLOR;
	const r = doc.createElement("div");
	let base = "padding:6px 10px;cursor:pointer;overflow-wrap:anywhere;";
	if (colorOn) base += `background:${pastel};color:#222;border-left:4px solid rgba(0,0,0,.18);`;
	r.style.cssText = base;

	const head = doc.createElement("div");
	const pg = doc.createElement("span");
	pg.textContent = `p.${it.pageIndex + 1}  `;
	pg.style.cssText = "font-size:11px;opacity:.7;"; // inherits color so hover stays readable
	const label = doc.createElement("span");
	label.textContent = it.head;
	label.style.fontWeight = "700";
	head.append(pg, label);
	r.append(head);

	let sub = null;
	if (it.rest) {
		sub = doc.createElement("div");
		sub.textContent = it.rest;
		sub.style.cssText = `font-size:11px;color:${colorOn ? "#555" : "GrayText"};margin-top:1px;line-height:1.3;`;
		r.append(sub);
	}

	r.addEventListener("mouseenter", () => {
		r.style.background = "Highlight"; r.style.color = "HighlightText";
		if (sub) sub.style.color = "HighlightText";
	});
	r.addEventListener("mouseleave", () => {
		r.style.background = colorOn ? pastel : ""; r.style.color = colorOn ? "#222" : "";
		if (sub) sub.style.color = colorOn ? "#555" : "GrayText";
	});
	r.addEventListener("click", () => jumpTo(reader, it));
	return r;
}

function makePanel(reader, doc, btn) {
	const panel = doc.createElement("div");
	const rect = btn.getBoundingClientRect();
	const vw = (doc.defaultView && doc.defaultView.innerWidth) || 800;
	const W = 360;
	const left = Math.max(8, Math.min(rect.left, vw - W - 8)); // keep on screen
	panel.style.cssText = [
		"position:fixed",
		`top:${rect.bottom + 4}px`,
		`left:${left}px`,
		`width:${W}px`,
		"box-sizing:border-box",
		"z-index:99999",
		"background:Canvas",
		"color:CanvasText",
		"border:1px solid GrayText",
		"border-radius:6px",
		"box-shadow:0 2px 10px rgba(0,0,0,.25)",
		"max-height:70vh",
		"overflow-y:auto",
		"overflow-x:hidden",
		"font:13px sans-serif",
		"padding:0 0 4px",
	].join(";");
	doc.body.append(panel);

	const onDown = (e) => {
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
	openPanel.cleanup();
	openPanel.el.remove();
	openPanel = null;
}

function jumpTo(reader, it) {
	reader.navigate({ position: { pageIndex: it.pageIndex, rects: it.rects } });
	closePanel();
}

// --- PDF scanning ----------------------------------------------------------

async function extractTheorems(reader) {
	if (reader.__theorems) return reader.__theorems; // cache: PDF text never changes
	const win = reader?._internalReader?._primaryView?._iframeWindow;
	const pdf = win?.PDFViewerApplication?.pdfDocument;
	if (!pdf) return null; // not a PDF, or reader not ready

	const Cu = Components.utils;
	const out = [];
	for (let i = 0; i < pdf.numPages; i++) {
		// Zotero's pdf.js fork: structured text per page, not getTextContent().
		// The arg must be built in the reader's window or it can't be cloned to
		// the pdf.js worker; waive Xrays to read the returned char objects.
		const data = Cu.waiveXrays(await pdf.getPageData(Cu.cloneInto({ pageIndex: i }, win)));
		const chars = data && data.chars;
		if (!chars || !chars.length) continue;
		for (const line of charsToLines(chars)) {
			const hit = classify(line.text, line.bold);
			if (hit) {
				out.push({ type: hit.type, head: hit.head, rest: hit.rest.slice(0, 200), pageIndex: i, rects: [line.rect] });
			}
		}
	}
	reader.__theorems = out;
	return out;
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
if (typeof module !== "undefined") module.exports = { charsToLines, classify, fuzzy };
