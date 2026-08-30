// Self-check: node test.js  (exits non-zero on failure)
const assert = require("assert");
const { charsToLines, classify, fuzzy, applyTypes, clickAction, CSS } = require("./bootstrap.js");

// --- classify: bold regime (number optional, reject section-title shape) ---
assert.deepStrictEqual(classify("Theorem.", true), { type: "Theorem", head: "Theorem", rest: "" });
assert.deepStrictEqual(classify("Theorem 3.1. Let x be", true), { type: "Theorem", head: "Theorem 3.1", rest: "Let x be" });
assert.deepStrictEqual(classify("Theorem A.1 Foo", true), { type: "Theorem", head: "Theorem A.1", rest: "Foo" });
assert.deepStrictEqual(classify("Lemma B (Key). The map", true), { type: "Lemma", head: "Lemma B (Key)", rest: "The map" });
assert.deepStrictEqual(classify("Theorem IV. Stmt", true), { type: "Theorem", head: "Theorem IV", rest: "Stmt" });
assert.strictEqual(classify("Theorem proving methods", true), null);   // bold section title, no label
assert.strictEqual(classify("Theorems of the trade", true), null);      // plural keyword

// --- classify: plain regime (need label + header shape; kills cross-refs) ---
assert.deepStrictEqual(classify("Theorem 3.1. Let x be", false), { type: "Theorem", head: "Theorem 3.1", rest: "Let x be" });
assert.deepStrictEqual(classify("Remark 3.1. Note", false), { type: "Remark", head: "Remark 3.1", rest: "Note" }); // italic remark
assert.deepStrictEqual(classify("Definition 2 (Foo bar). T", false), { type: "Definition", head: "Definition 2 (Foo bar)", rest: "T" });
assert.strictEqual(classify("Theorem 3.1 we conclude", false), null);   // cross-ref: lowercase word
assert.strictEqual(classify("Theorem 3.1, see above", false), null);    // cross-ref: comma
assert.strictEqual(classify("Theorem.", false), null);                  // unnumbered, not bold → skip
assert.strictEqual(classify("by Theorem 3.1 we have", false), null);    // doesn't start with keyword

// --- classify: TOC leaders and casing ---
assert.strictEqual(classify("Theorem 3.1 . . . . . 45", false), null);  // dotted leader → TOC
assert.strictEqual(classify("lemma 7. foo", false).type, "Lemma");       // canonical-case the type
assert.deepStrictEqual(classify("THEOREM 3.1 STATEMENT", true), { type: "Theorem", head: "Theorem 3.1", rest: "STATEMENT" });

// --- charsToLines: bold tracking + a full bold-header vs cross-ref scan ---
let x = 0;
const word = (s, o = {}) => [...s].map((c, i) => ({
	c,
	rect: [x + i, 100, x + i + 1, 110],
	bold: !!o.bold,
	italic: !!o.italic,
	fontName: o.bold ? "Times-Bold" : "Times-Roman",
	spaceAfter: false,
	lineBreakAfter: o.brk === "line" && i === s.length - 1,
	paragraphBreakAfter: o.brk === "para" && i === s.length - 1,
	ignorable: false,
}));
const sp = () => [{ c: " ", rect: [x, 100, x + 1, 110], spaceAfter: true, ignorable: false }];

const chars = [].concat(
	word("Theorem", { bold: true }), sp(), word("3.1.", { bold: true, brk: "line" }),
	word("Let", {}), sp(), word("x", { brk: "para" }),
	word("by", {}), sp(), word("Theorem", {}), sp(), word("3.1", {}), sp(), word("we", { brk: "line" }),
);
const lines = charsToLines(chars);
assert.strictEqual(lines[0].bold, true, "header line should be bold");
assert.strictEqual(lines[1].bold, false, "body line should not be bold");

const hits = lines.map((l) => classify(l.text, l.bold)).filter(Boolean);
assert.deepStrictEqual(hits.map((h) => h.head), ["Theorem 3.1"], "hits: " + JSON.stringify(hits));

// --- classify: non-Latin keywords added via Settings -> Theorem List ---
applyTypes([{ kw: "Лемма", color: "#4ee46a" }, { kw: "Утверждение", color: "#1e6ccc" }]);
assert.deepStrictEqual(classify("Лемма 1.2. Пусть x", true),
	{ type: "Лемма", head: "Лемма 1.2", rest: "Пусть x" });
assert.deepStrictEqual(classify("Утверждение 3 (Ключевое). Для", false),
	{ type: "Утверждение", head: "Утверждение 3 (Ключевое)", rest: "Для" });
assert.strictEqual(classify("лемма 7. текст", false).type, "Лемма");   // case-folds in Cyrillic too
assert.strictEqual(classify("Лемма 1.2 мы получаем", false), null);    // cross-ref: lowercase Cyrillic
assert.strictEqual(classify("Лемма 1.2, см. выше", false), null);      // cross-ref: comma
assert.strictEqual(classify("Theorem 3.1. Let x", true), null);        // not in the configured list
applyTypes(null); // back to defaults for anything after this
assert.strictEqual(classify("Theorem 3.1. Let x", true).type, "Theorem");

// --- clickAction: one click always opens, even with a panel open elsewhere ---
const btnA = { id: "a" }, btnB = { id: "b" };
assert.strictEqual(clickAction(null, btnA), "open");
assert.strictEqual(clickAction({ btn: btnA }, btnA), "close");        // same button toggles shut
assert.strictEqual(clickAction({ btn: btnB }, btnA), "replace");      // another tab's panel
assert.strictEqual(clickAction({ btn: null }, btnA), "replace");      // orphaned by a closed tab
// Regression: "replace" must not be "close" — that swallowed the click and was
// the "sometimes the button does nothing" bug.
assert.notStrictEqual(clickAction({ btn: btnB }, btnA), "close");

// --- CSS: elements toggled via .hidden need an explicit [hidden] rule ---
// Regression: `.tl-editor{display:flex}` is an author rule and outranks the UA
// `[hidden]{display:none}`, so setting .hidden did nothing and the editor was
// permanently on screen.
assert.ok(/\.tl-editor\[hidden\]\s*\{[^}]*display:\s*none/.test(CSS),
	".tl-editor is toggled with .hidden, so it needs its own [hidden] display:none rule");

// --- fuzzy: subsequence (caller lowercases) ---
assert.ok(fuzzy("", "anything"));
assert.ok(fuzzy("thm", "theorem main"));
assert.ok(fuzzy("morse", "smooth morse case"));
assert.ok(!fuzzy("xyz", "theorem"));

console.log("ok");
