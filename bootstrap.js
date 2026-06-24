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
	"Definition", "Remark", "Claim", "Conjecture", "Example",
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
			r.style.cssText = "padding:5px 10px;cursor:pointer;white-space:nowrap;";
			r.addEventListener("mouseenter", () => { r.style.background = "Highlight"; r.style.color = "HighlightText"; });
			r.addEventListener("mouseleave", () => { r.style.background = ""; r.style.color = ""; });
			r.addEventListener("click", () => {
				reader.navigate({ position: { pageIndex: it.pageIndex, rects: it.rects } });
				closePanel();
			});
			panel.append(r);
		}
	}).catch((e) => {
		Zotero.debug("Theorem List: " + e);
		row.textContent = "Error scanning PDF.";
	});
}

function makePanel(doc, btn) {
	const panel = doc.createElement("div");
	const rect = btn.getBoundingClientRect();
	panel.style.cssText = [
		"position:fixed",
		`top:${rect.bottom + 4}px`,
		`left:${rect.left}px`,
		"z-index:99999",
		"background:Canvas",
		"color:CanvasText",
		"border:1px solid GrayText",
		"border-radius:6px",
		"box-shadow:0 2px 10px rgba(0,0,0,.25)",
		"max-height:70vh",
		"overflow:auto",
		"min-width:240px",
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
	const app = reader?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication;
	const pdf = app?.pdfDocument;
	if (!pdf) return null; // not a PDF, or reader not ready

	const out = [];
	for (let i = 1; i <= pdf.numPages; i++) {
		const page = await pdf.getPage(i);
		const tc = await page.getTextContent();
		for (const line of groupLines(tc.items)) {
			if (HEADER_RE.test(line.text)) {
				out.push({
					label: line.text.slice(0, 90),
					pageIndex: i - 1,
					rects: [line.rect],
				});
			}
		}
	}
	reader.__theorems = out;
	return out;
}

// Group pdf.js text items into visual lines by baseline y, left-to-right.
function groupLines(items) {
	const placed = items
		.filter((it) => it.str !== undefined)
		.map((it) => ({
			str: it.str,
			x: it.transform[4],
			y: it.transform[5],
			w: it.width || 0,
			h: it.height || 0,
		}))
		.sort((a, b) => (b.y - a.y) || (a.x - b.x));

	const lines = [];
	let cur = null;
	for (const it of placed) {
		if (cur && Math.abs(it.y - cur.y) <= 2) {
			cur.items.push(it);
		} else {
			cur = { y: it.y, items: [it] };
			lines.push(cur);
		}
	}
	return lines.map((l) => {
		const text = l.items.map((it) => it.str).join("").replace(/\s+/g, " ").trim();
		const minX = Math.min(...l.items.map((it) => it.x));
		const maxX = Math.max(...l.items.map((it) => it.x + it.w));
		const minY = Math.min(...l.items.map((it) => it.y));
		const maxY = Math.max(...l.items.map((it) => it.y + it.h));
		return { text, rect: [minX, minY, maxX, maxY] };
	});
}

// node-only: lets test.js import the pure helpers; no-op inside Zotero.
if (typeof module !== "undefined") module.exports = { groupLines, HEADER_RE };
