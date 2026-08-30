/* Preferences pane for Theorem List. Registered from bootstrap.js; runs in the
 * Zotero settings window.
 *
 * Zotero loads pane scripts BEFORE inserting the pane markup (see
 * Zotero_Preferences._loadPane), so nothing here can touch the DOM at load
 * time — getElementById would return null and take the whole script down.
 * Everything is deferred until the markup actually appears.
 */
{
	const XHTML = "http://www.w3.org/1999/xhtml";

	function init(rowsEl) {
		const { DEFAULT_TYPES, SPARE_COLORS, PREF } = Zotero.TheoremList;
		const h = (tag) => document.createElementNS(XHTML, tag);

		const readPref = () => {
			try {
				const list = JSON.parse(Zotero.Prefs.get(PREF, true) || "null");
				return (Array.isArray(list) && list.length) ? list : null;
			} catch (e) {
				return null; // unset or unreadable → show defaults; saving overwrites
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
				.filter((t) => t.kw); // blank keyword = a row in progress, not an entry
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

			// "change" (commit on blur), not "input": avoids rewriting the pref —
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

	const start = () => {
		const rowsEl = document.getElementById("tl-rows");
		if (!rowsEl) return false;
		try {
			init(rowsEl);
		} catch (e) {
			Zotero.debug("Theorem List: prefs pane failed - " + ((e && e.stack) || e));
		}
		return true;
	};

	// The markup is appended right after this script runs, but don't rely on the
	// exact timing — watch for it, and disconnect as soon as it lands.
	if (!start()) {
		const obs = new MutationObserver(() => {
			if (start()) obs.disconnect();
		});
		obs.observe(document, { childList: true, subtree: true });
	}
}
