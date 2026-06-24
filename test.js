// Self-check: node test.js  (exits non-zero on failure)
const assert = require("assert");
const { charsToLines, splitHeader, HEADER_RE } = require("./bootstrap.js");

let x = 0;
const word = (s, brk) => [...s].map((c, i) => ({
	c,
	rect: [x + i, 100, x + i + 1, 110],
	spaceAfter: false,
	lineBreakAfter: brk === "line" && i === s.length - 1,
	paragraphBreakAfter: brk === "para" && i === s.length - 1,
	ignorable: false,
}));
const sp = () => [{ c: " ", rect: [x, 100, x + 1, 110], spaceAfter: true, ignorable: false }];

const chars = [].concat(
	word("Theorem"), sp(), word("3.1.", "line"),
	word("Let"), sp(), word("x", "para"),
	word("by"), sp(), word("Theorem"), sp(), word("3.1", "line"), // mid-sentence ref
	word("Lemma"), sp(), word("2", "line"),
);

const lines = charsToLines(chars);
const matched = lines.filter((l) => HEADER_RE.test(l.text)).map((l) => l.text);
assert.deepStrictEqual(matched, ["Theorem 3.1.", "Lemma 2"], "matched: " + JSON.stringify(matched));

// splitHeader: clean head + dimmed body, trailing-dot stripped, paren name kept
assert.deepStrictEqual(splitHeader("Theorem 3.1. Let x be"), { head: "Theorem 3.1", rest: "Let x be" });
assert.deepStrictEqual(splitHeader("Lemma 2 (Key). The map"), { head: "Lemma 2 (Key)", rest: "The map" });
assert.deepStrictEqual(splitHeader("Definition 2.3 (Foo bar). T"), { head: "Definition 2.3 (Foo bar)", rest: "T" });
assert.deepStrictEqual(splitHeader("Theorem 3.1"), { head: "Theorem 3.1", rest: "" });
assert.deepStrictEqual(splitHeader("Remark (Main). Note"), { head: "Remark (Main)", rest: "Note" });

console.log("ok");
