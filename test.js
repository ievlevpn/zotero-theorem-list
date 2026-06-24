// Self-check: node test.js  (exits non-zero on failure)
const assert = require("assert");
const { groupLines, HEADER_RE } = require("./bootstrap.js");

// pdf.js-style item: transform[4]=x, transform[5]=y baseline.
const item = (str, x, y, w = str.length * 5, h = 10) => ({
	str, width: w, height: h, transform: [1, 0, 0, 1, x, y],
});

// "Theorem 3.1" split across items on the same line (y=700), plus a body line below.
const items = [
	item("Theo", 50, 700), item("rem ", 75, 700), item("3.1.", 95, 700),
	item("Let x be", 50, 685),
	item("by Theorem 3.1 we get", 50, 670), // mid-sentence ref, must NOT match
	item("Lemma 2 (Key)", 50, 640),
];

const lines = groupLines(items);
const matched = lines.filter((l) => HEADER_RE.test(l.text)).map((l) => l.text);

assert.deepStrictEqual(matched, ["Theorem 3.1.", "Lemma 2 (Key)"], "matched: " + JSON.stringify(matched));
// rect spans the joined "Theorem 3.1." line
const thm = lines.find((l) => l.text.startsWith("Theorem"));
assert.ok(thm.rect[0] === 50 && thm.rect[2] > 95, "rect: " + JSON.stringify(thm.rect));

console.log("ok");
