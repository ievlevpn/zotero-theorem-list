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

let onRenderToolbar; // kept for unregister on shutdown
let openPanel; // { el, onDown, doc } of the single open popup, or null

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
	const panel = makePanel(doc, btn);
	const row = doc.createElement("div");
	row.textContent = "Scanning…";
	row.style.cssText = "padding:6px 10px;color:GrayText;";
	panel.append(row);

	extractTheorems(reader).then((items) => {
		if (!openPanel || openPanel.el !== panel) return; // closed meanwhile
		panel.replaceChildren();
		if (items === null) {
			row.textContent = "No PDF (or not loaded yet).";
			panel.append(row);
			return;
		}
		if (items.length === 0) {
			row.textContent = "No theorems found.";
			panel.append(row);
			return;
		}
		for (const it of items) {
			const r = doc.createElement("div");
			r.textContent = `p.${it.pageIndex + 1} ${it.label}`;
			r.style.cssText = "padding:5px 10px;cursor:pointer;overflow-wrap:anywhere;";
			r.addEventListener("mouseenter", () => { r.style.background = "Highlight"; r.style.color = "HighlightText"; });
			r.addEventListener("mouseleave", () => { r.style.background = ""; r.style.color = ""; });
			r.addEventListener("click", () => {
				reader.navigate({ position: { pageIndex: it.pageIndex, rects: it.rects } });
				closePanel();
			});
			panel.append(r);
		}
	}).catch((e) => {
		Zotero.debug("Theorem List: " + ((e && e.stack) || e));
		if (!openPanel || openPanel.el !== panel) return;
		panel.replaceChildren();
		row.textContent = "Error: " + ((e && e.message) || String(e));
		row.style.cssText = "padding:6px 10px;color:CanvasText;white-space:normal;overflow-wrap:anywhere;";
		panel.append(row);
	});
}

function makePanel(doc, btn) {
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
		"padding:4px 0",
	].join(";");
	doc.body.append(panel);

	const onDown = (e) => {
		if (!panel.contains(e.target) && e.target !== btn) closePanel();
	};
	doc.addEventListener("pointerdown", onDown, true);
	openPanel = { el: panel, onDown, doc };
	return panel;
}

function closePanel() {
	if (!openPanel) return;
	openPanel.doc.removeEventListener("pointerdown", openPanel.onDown, true);
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
				out.push({ label: line.text.slice(0, 90), pageIndex: i, rects: [line.rect] });
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
if (typeof module !== "undefined") module.exports = { charsToLines, HEADER_RE };
