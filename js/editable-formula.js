// Render a LaTeX formula with editable <input> fields embedded directly at
// {{varname}} markers — like a fillable Word formula.
//
// Strategy: replace {{var}} with \boxed{\phantom{XXXX}} placeholders (which
// keep formula structure intact), render with KaTeX, then walk the rendered
// DOM in document order and replace each .fbox/.boxpad placeholder with an
// <input> element styled to match the formula font.

export function renderEditableFormula(latex, vars, opts = {}) {
  const showSymbolPlaceholder = opts.showSymbolPlaceholder !== false;

  const wrap = document.createElement("div");
  wrap.className = "editable-formula";

  if (typeof window.katex === "undefined") {
    wrap.textContent = latex;
    return { el: wrap, inputs: new Map() };
  }

  // Collect variable names in source order; replace markers with boxed placeholders
  const RE = /\{\{(\w+)(?::([^}]+))?\}\}/g;
  const names = [];
  const inlineUnits = [];
  const boxedLatex = latex.replace(RE, (_, name, unit) => {
    names.push(name);
    inlineUnits.push(unit || null);
    // \phantom{XXXX} ≈ width of 4 chars, matching a 2.6em wide input
    return `\\boxed{\\phantom{XXXX}}`;
  });

  if (names.length === 0) {
    // No placeholders — render plainly
    try {
      window.katex.render(latex, wrap, { displayMode: true, throwOnError: false });
    } catch {
      wrap.textContent = latex;
    }
    return { el: wrap, inputs: new Map() };
  }

  // Render with placeholders
  try {
    window.katex.render(boxedLatex, wrap, {
      displayMode: true,
      throwOnError: false,
      strict: "ignore",
    });
  } catch {
    wrap.textContent = latex;
    return { el: wrap, inputs: new Map() };
  }

  // Find all boxed placeholders. KaTeX uses different class names depending
  // on output mode; check several.
  const selectors = [".fbox", ".boxpad", ".mord.boxpad", ".enclosing"];
  let boxes = [];
  for (const sel of selectors) {
    boxes = Array.from(wrap.querySelectorAll(sel));
    if (boxes.length >= names.length) break;
  }
  // Fallback: any element whose computed border looks like a box (heuristic).
  if (boxes.length < names.length) {
    boxes = Array.from(wrap.querySelectorAll("*")).filter(el => {
      const cs = el.className && typeof el.className === "string" ? el.className : "";
      return cs.includes("fbox") || cs.includes("boxpad");
    });
  }

  // Temporarily attach to DOM so we can measure positions, then sort boxes by
  // visual reading order (top→bottom, then left→right) — KaTeX's DOM order
  // for vlists (\frac, \sum etc.) does NOT match visual order.
  const offscreen = document.createElement("div");
  offscreen.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden";
  offscreen.appendChild(wrap);
  document.body.appendChild(offscreen);
  try {
    boxes.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      if (Math.abs(ra.top - rb.top) > 4) return ra.top - rb.top;
      return ra.left - rb.left;
    });
  } finally {
    offscreen.removeChild(wrap);
    document.body.removeChild(offscreen);
  }

  const inputMap = new Map();
  for (let i = 0; i < names.length && i < boxes.length; i++) {
    const sym = names[i];
    const v = vars.find(x => x.symbol === sym) || { symbol: sym, unit: inlineUnits[i] };
    const unit = v.unit || inlineUnits[i];

    const target = boxes[i];

    const holder = document.createElement("span");
    holder.className = "formula-blank-wrap";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "formula-blank-input";
    input.dataset.sym = sym;
    input.placeholder = showSymbolPlaceholder ? sym : "?";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.inputMode = "decimal";
    holder.appendChild(input);

    if (unit) {
      const u = document.createElement("span");
      u.className = "formula-blank-unit";
      u.textContent = unit;
      holder.appendChild(u);
    }

    target.replaceWith(holder);
    inputMap.set(sym, input);
  }

  return { el: wrap, inputs: inputMap };
}
