// Self-check: node test.js  (exits non-zero on failure)
const assert = require("assert");
const { charsToLines, HEADER_RE } = require("./bootstrap.js");

let x = 0;
// Build chars for a word; last char gets the break flag.
const word = (s, brk) => [...s].map((c, i) => ({
	c,
	rect: [x + i, 100, x + i + 1, 110],
	spaceAfter: false,
	lineBreakAfter: brk === "line" && i === s.length - 1,
	paragraphBreakAfter: brk === "para" && i === s.length - 1,
	ignorable: false,
}));
// space between words
const sp = () => { const a = [{ c: " ", rect: [x, 100, x + 1, 110], spaceAfter: true, ignorable: false }]; return a; };

const chars = [].concat(
	word("Theorem"), sp(), word("3.1.", "line"),
	word("Let"), sp(), word("x", "para"),
	word("by"), sp(), word("Theorem"), sp(), word("3.1", "line"), // mid-sentence ref
	word("Lemma"), sp(), word("2", "line"),
);

const lines = charsToLines(chars);
const matched = lines.filter((l) => HEADER_RE.test(l.text)).map((l) => l.text);

assert.deepStrictEqual(matched, ["Theorem 3.1.", "Lemma 2"], "matched: " + JSON.stringify(matched));
const thm = lines.find((l) => l.text.startsWith("Theorem"));
assert.ok(thm.rect.length === 4 && thm.rect[2] > thm.rect[0], "rect: " + JSON.stringify(thm.rect));

console.log("ok");
