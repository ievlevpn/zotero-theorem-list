/* Theorem List — a tiny Zotero 7 plugin.
 * Adds a button to the PDF reader toolbar that scans the PDF text for
 * theorem-like headers and lists them in a popup; clicking one jumps there.
 *
 * No build step: this is a plain bootstrapped plugin. Zip the folder (or
 * symlink it into Zotero's extensions dir) — see README.md.
 */

// Keywords that start a theorem-like environment. Edit to taste.
// ponytail: line must start with one of these followed by a number or "(" —
// cuts mid-sentence cross-refs ("...by Theorem 3.1...") that don't begin a line.
const KEYWORDS = [
	"Theorem", "Lemma", "Proposition", "Corollary",
	"Definition", "Remark", "Claim", "Conjecture", "Example", "Assumption",
];
const HEADER_RE = new RegExp("^(" + KEYWORDS.join("|") + ")\\s*(\\d|\\()", "i");

// Pastel background per type for the optional "Color by type" mode.
const TYPE_COLORS = {
	Theorem: "#cfe8ff", Lemma: "#d8f5d0", Proposition: "#ffe6cc",
	Corollary: "#f6d3ea", Definition: "#fff4c2", Remark: "#e3e3e3",
	Claim: "#cdf0ef", Conjecture: "#e6d6ff", Example: "#cdf3df",
	Assumption: "#ffd6d6",
};
const FALLBACK_COLOR = "#eeeeee";

// Split a matched line into type, a clean header ("Theorem 3.1 (Name)") and
// the remaining statement text (shown dimmed for context).
const HEAD_SPLIT_RE = new RegExp(
	"^(" + KEYWORDS.join("|") + ")\\s*(\\d[\\d.]*)?\\s*(\\([^)]*\\))?\\s*(.*)$", "i");

function splitHeader(text) {
	const m = text.match(HEAD_SPLIT_RE);
	if (!m) return { type: "", head: text, rest: "" };
	const type = KEYWORDS.find((k) => k.toLowerCase() === m[1].toLowerCase()) || m[1];
	const num = (m[2] || "").replace(/\.+$/, ""); // drop trailing "." of "3.1."
	const head = [type, num, m[3]].filter(Boolean).join(" ");
	const rest = (m[4] || "").replace(/^[.:)\s]+/, "").trim();
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
	controls.style.cssText = "position:sticky;top:0;background:Canvas;padding:6px 8px;border-bottom:1px solid GrayText;display:flex;flex-direction:column;gap:6px;";

	const search = doc.createElement("input");
	search.type = "search";
	search.placeholder = "Fuzzy filter…";
	search.style.cssText = "width:100%;box-sizing:border-box;padding:3px 6px;font:13px sans-serif;";
	search.addEventListener("input", () => { query = search.value; render(); });
	// Don't let typed keys trigger reader shortcuts; keep Escape working.
	search.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); });
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
	controls.append(colorLabel);

	panel.append(controls);

	const list = doc.createElement("div");
	panel.append(list);

	const render = () => {
		list.replaceChildren();
		const q = query.trim().toLowerCase();
		const shown = items.filter((it) =>
			!hidden.has(it.type) && fuzzy(q, (it.head + " " + it.rest).toLowerCase()));
		if (!shown.length) {
			const none = doc.createElement("div");
			none.textContent = "No matches.";
			none.style.cssText = "padding:6px 10px;color:GrayText;";
			list.append(none);
			return;
		}
		for (const it of shown) list.append(makeRow(doc, reader, it));
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
	head.textContent = `p.${it.pageIndex + 1}  ${it.head}`;
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
	r.addEventListener("click", () => {
		reader.navigate({ position: { pageIndex: it.pageIndex, rects: it.rects } });
		closePanel();
	});
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
			if (HEADER_RE.test(line.text)) {
				const { type, head, rest } = splitHeader(line.text);
				out.push({ type, head, rest: rest.slice(0, 200), pageIndex: i, rects: [line.rect] });
			}
		}
	}
	reader.__theorems = out;
	return out;
}

// Reconstruct visual lines from Zotero's per-char structured text.
// char: { c, rect:[x1,y1,x2,y2], spaceAfter, lineBreakAfter, paragraphBreakAfter, ignorable }
function charsToLines(chars) {
	const lines = [];
	let buf = "";
	let rect = null;
	const flush = () => {
		const text = buf.replace(/\s+/g, " ").trim();
		if (text && rect) lines.push({ text, rect });
		buf = "";
		rect = null;
	};
	for (const ch of chars) {
		if (ch.ignorable) continue;
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
if (typeof module !== "undefined") module.exports = { charsToLines, splitHeader, fuzzy, HEADER_RE };
