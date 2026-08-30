/* Preferences pane for Theorem List. Registered from bootstrap.js; runs in the
 * Zotero settings window. The keyword/color table is stored as one JSON string
 * in a single pref, which bootstrap.js observes and reloads on change.
 */
{
	const { DEFAULT_TYPES, SPARE_COLORS, PREF } = Zotero.TheoremList;
	const XHTML = "http://www.w3.org/1999/xhtml";
	const rowsEl = document.getElementById("tl-rows");
	// The settings window is XHTML, but build elements namespaced anyway so a
	// XUL-document host can't turn these into unstyled XUL boxes.
	const h = (tag) => document.createElementNS(XHTML, tag);

	const readPref = () => {
		try {
			const list = JSON.parse(Zotero.Prefs.get(PREF, true) || "null");
			return (Array.isArray(list) && list.length) ? list : null;
		} catch (e) {
			return null; // unreadable → show defaults; saving overwrites it
		}
	};

	// First spare not already on screen, so adding rows never repeats a color.
	const nextColor = () => {
		const used = new Set([...rowsEl.querySelectorAll(".tl-color")].map((i) => i.value.toLowerCase()));
		return SPARE_COLORS.find((c) => !used.has(c)) || SPARE_COLORS[0];
	};

	const save = () => {
		const list = [...rowsEl.children]
			.map((tr) => ({
				kw: tr.querySelector(".tl-kw").value.trim(),
				color: tr.querySelector(".tl-color").value,
			}))
			.filter((t) => t.kw); // a blank keyword is a row in progress, not an entry
		Zotero.Prefs.set(PREF, JSON.stringify(list), true);
	};

	function addRow(t) {
		const tr = h("tr");
		const kw = h("input");
		kw.type = "text";
		kw.className = "tl-kw";
		kw.value = t.kw;
		kw.placeholder = "Keyword";
		const color = h("input");
		color.type = "color";
		color.className = "tl-color";
		color.value = t.color;
		const del = h("button");
		del.type = "button";
		del.className = "tl-del";
		del.textContent = "✕";
		del.title = "Remove";

		// "change", not "input": committing on blur avoids rewriting the pref —
		// and dropping every cached scan — on each keystroke.
		kw.addEventListener("change", save);
		color.addEventListener("change", save);
		del.addEventListener("click", () => { tr.remove(); save(); });

		for (const el of [kw, color, del]) {
			const td = h("td");
			td.append(el);
			tr.append(td);
		}
		rowsEl.append(tr);
		return tr;
	}

	const render = (list) => {
		rowsEl.replaceChildren();
		for (const t of list) addRow(t);
	};

	render(readPref() || DEFAULT_TYPES);

	document.getElementById("tl-add").addEventListener("click", () => {
		addRow({ kw: "", color: nextColor() }).querySelector(".tl-kw").focus();
	});
	document.getElementById("tl-reset").addEventListener("click", () => {
		Zotero.Prefs.clear(PREF, true);
		render(DEFAULT_TYPES);
	});
}
