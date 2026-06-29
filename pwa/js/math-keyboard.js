// Advanced math symbol keyboard with LaTeX support and live preview.
// Used wherever math input is needed: scaffold, socratic, math-solver, editor, formula-sheets.

const TABS = {
  basic: {
    label: "Grundlagen",
    rows: [
      [
        { label: "x²", insert: "^2", cls: "kb-op" },
        { label: "xⁿ", insert: "^{}", cls: "kb-op", cursor: -1 },
        { label: "√", insert: "\\sqrt{}", cls: "kb-op", cursor: -1 },
        { label: "∛", insert: "\\sqrt[3]{}", cls: "kb-op", cursor: -1 },
        { label: "|x|", insert: "|x|", cls: "kb-fn" },
        { label: "π", insert: "\\pi", cls: "kb-op" },
        { label: "∞", insert: "\\infty", cls: "kb-op" },
        { label: "±", insert: "\\pm", cls: "kb-op" },
        { label: "·", insert: "\\cdot", cls: "kb-op" },
        { label: "≈", insert: "\\approx", cls: "kb-op" },
      ],
      [
        { label: "≤", insert: "\\leq", cls: "kb-op" },
        { label: "≥", insert: "\\geq", cls: "kb-op" },
        { label: "≠", insert: "\\neq", cls: "kb-op" },
        { label: "∝", insert: "\\propto", cls: "kb-op" },
        { label: "⇒", insert: "\\Rightarrow", cls: "kb-op" },
        { label: "⇔", insert: "\\Leftrightarrow", cls: "kb-op" },
        { label: "×", insert: "\\times", cls: "kb-op" },
        { label: "÷", insert: "\\div", cls: "kb-op" },
        { label: "·10^", insert: "\\cdot 10^{}", cls: "kb-fn", cursor: -1 },
        { label: "e", insert: "e", cls: "" },
      ],
    ],
  },
  latex: {
    label: "LaTeX",
    rows: [
      [
        { label: "\\frac{a}{b}", insert: "\\frac{}{}", cls: "kb-ltx", cursor: -3 },
        { label: "\\sqrt[n]{x}", insert: "\\sqrt[]{}", cls: "kb-ltx", cursor: -2 },
        { label: "x^{n}", insert: "^{}", cls: "kb-ltx", cursor: -1 },
        { label: "x_{n}", insert: "_{}", cls: "kb-ltx", cursor: -1 },
        { label: "\\int", insert: "\\int_{}^{}", cls: "kb-ltx", cursor: -3 },
        { label: "\\int_a^b", insert: "\\int_{a}^{b}", cls: "kb-ltx" },
        { label: "\\sum", insert: "\\sum_{}^{}", cls: "kb-ltx", cursor: -3 },
        { label: "\\prod", insert: "\\prod_{}^{}", cls: "kb-ltx", cursor: -3 },
        { label: "\\lim", insert: "\\lim_{x \\to \\infty}", cls: "kb-ltx" },
      ],
      [
        { label: "\\sin", insert: "\\sin", cls: "kb-fn" },
        { label: "\\cos", insert: "\\cos", cls: "kb-fn" },
        { label: "\\tan", insert: "\\tan", cls: "kb-fn" },
        { label: "\\ln", insert: "\\ln", cls: "kb-fn" },
        { label: "\\log", insert: "\\log", cls: "kb-fn" },
        { label: "\\exp", insert: "\\exp", cls: "kb-fn" },
        { label: "\\partial", insert: "\\partial", cls: "kb-op" },
        { label: "\\nabla", insert: "\\nabla", cls: "kb-op" },
        { label: "\\Delta", insert: "\\Delta", cls: "kb-op" },
        { label: "\\circ", insert: "^{\\circ}", cls: "kb-op" },
      ],
      [
        { label: "\\left(…\\right)", insert: "\\left( \\right)", cls: "kb-ltx", cursor: -8 },
        { label: "\\left[…\\right]", insert: "\\left[ \\right]", cls: "kb-ltx", cursor: -8 },
        { label: "\\{…\\}", insert: "\\{ \\}", cls: "kb-ltx", cursor: -3 },
        { label: "\\overline{x}", insert: "\\overline{}", cls: "kb-ltx", cursor: -1 },
        { label: "\\underline{x}", insert: "\\underline{}", cls: "kb-ltx", cursor: -1 },
        { label: "\\hat{x}", insert: "\\hat{}", cls: "kb-ltx", cursor: -1 },
        { label: "\\vec{v}", insert: "\\vec{}", cls: "kb-ltx", cursor: -1 },
        { label: "\\dot{x}", insert: "\\dot{}", cls: "kb-ltx", cursor: -1 },
        { label: "\\ddot{x}", insert: "\\ddot{}", cls: "kb-ltx", cursor: -1 },
        { label: "\\text{…}", insert: "\\text{}", cls: "kb-ltx", cursor: -1 },
      ],
      [
        { label: "Matrix 2×2", insert: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", cls: "kb-ltx" },
        { label: "Matrix 3×3", insert: "\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}", cls: "kb-ltx" },
        { label: "\\binom{n}{k}", insert: "\\binom{}{}", cls: "kb-ltx", cursor: -3 },
        { label: "\\underbrace{…}_{…}", insert: "\\underbrace{}_{}", cls: "kb-ltx", cursor: -4 },
        { label: "\\overbrace{…}^{…}", insert: "\\overbrace{}^{}", cls: "kb-ltx", cursor: -4 },
      ],
    ],
  },
  greek: {
    label: "Griechisch",
    rows: [
      [
        { label: "α", insert: "\\alpha", cls: "" },
        { label: "β", insert: "\\beta", cls: "" },
        { label: "γ", insert: "\\gamma", cls: "" },
        { label: "δ", insert: "\\delta", cls: "" },
        { label: "ε", insert: "\\varepsilon", cls: "" },
        { label: "ζ", insert: "\\zeta", cls: "" },
        { label: "η", insert: "\\eta", cls: "" },
        { label: "θ", insert: "\\theta", cls: "" },
        { label: "λ", insert: "\\lambda", cls: "" },
        { label: "μ", insert: "\\mu", cls: "" },
      ],
      [
        { label: "ν", insert: "\\nu", cls: "" },
        { label: "ξ", insert: "\\xi", cls: "" },
        { label: "ρ", insert: "\\rho", cls: "" },
        { label: "σ", insert: "\\sigma", cls: "" },
        { label: "τ", insert: "\\tau", cls: "" },
        { label: "φ", insert: "\\varphi", cls: "" },
        { label: "ω", insert: "\\omega", cls: "" },
        { label: "Γ", insert: "\\Gamma", cls: "" },
        { label: "Δ", insert: "\\Delta", cls: "" },
        { label: "Θ", insert: "\\Theta", cls: "" },
      ],
      [
        { label: "Λ", insert: "\\Lambda", cls: "" },
        { label: "Ξ", insert: "\\Xi", cls: "" },
        { label: "Π", insert: "\\Pi", cls: "" },
        { label: "Σ", insert: "\\Sigma", cls: "" },
        { label: "Φ", insert: "\\Phi", cls: "" },
        { label: "Ψ", insert: "\\Psi", cls: "" },
        { label: "Ω", insert: "\\Omega", cls: "" },
        { label: "∅", insert: "\\emptyset", cls: "" },
        { label: "∈", insert: "\\in", cls: "kb-op" },
        { label: "∀", insert: "\\forall", cls: "kb-op" },
      ],
    ],
  },
};

/**
 * Create a math keyboard with LaTeX support and live preview.
 * @param {HTMLElement} container - Element to append the keyboard
 * @param {Object} options
 * @param {HTMLInputElement|HTMLTextAreaElement} options.target - Input field
 * @param {string} [options.previewId] - ID for a preview div (live KaTeX render)
 */
export function createMathKeyboard(container, options = {}) {
  // Backward compat: old API was createMathKeyboard(container, element)
  if (options && typeof options === "object" && options.nodeType) {
    options = { target: options };
  }
  const target = options.target || null;
  const previewId = options.previewId || null;
  let currentTarget = target;
  let visible = false;
  let activeTab = "basic";
  let expanded = false;

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "margin: 4px 0;";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "math-kb-toggle";
  toggle.textContent = "⌨ Mathe-Tastatur";
  wrapper.appendChild(toggle);

  const kbDiv = document.createElement("div");
  kbDiv.style.display = "none";
  wrapper.appendChild(kbDiv);

  // Live preview element
  let previewEl = null;
  if (previewId) {
    previewEl = document.createElement("div");
    previewEl.id = previewId;
    previewEl.style.cssText = "min-height:24px;padding:6px 8px;margin:4px 0;font-size:1.1rem;background:var(--card-glass-bg, var(--card-bg));border-radius:8px;border:1px solid var(--border);overflow-x:auto;white-space:nowrap";
  }

  function render() {
    kbDiv.innerHTML = "";

    // Preview (if any)
    if (previewEl) kbDiv.appendChild(previewEl);

    // Tab bar
    const tabBar = document.createElement("div");
    tabBar.style.cssText = "display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap";
    for (const [key, tab] of Object.entries(TABS)) {
      const tb = document.createElement("button");
      tb.type = "button";
      tb.className = "math-kb-toggle";
      tb.textContent = tab.label;
      tb.style.cssText = key === activeTab ? "background:var(--primary);color:#fff;font-size:0.75rem" : "font-size:0.75rem";
      tb.addEventListener("click", () => { activeTab = key; render(); });
      tabBar.appendChild(tb);
    }
    kbDiv.appendChild(tabBar);

    // Rows
    const rows = TABS[activeTab].rows;
    const visibleRows = expanded ? rows : [rows[0]];
    for (const row of visibleRows) {
      const rowEl = document.createElement("div");
      rowEl.className = "math-kb";
      for (const btn of row) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `math-kb-btn ${btn.cls || ""}`;
        b.textContent = btn.label;
        b.addEventListener("click", (e) => {
          e.preventDefault();
          insertAtCursor(btn.insert, btn.cursor);
        });
        rowEl.appendChild(b);
      }
      kbDiv.appendChild(rowEl);
    }

    // Expand toggle
    if (rows.length > 1) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "math-kb-toggle";
      more.textContent = expanded ? "▲ Weniger" : "▼ Mehr";
      more.style.marginTop = "4px";
      more.addEventListener("click", () => { expanded = !expanded; render(); });
      kbDiv.appendChild(more);
    }
  }

  function insertAtCursor(text, cursorOffset) {
    const t = currentTarget;
    if (!t) return;
    t.focus();
    const start = t.selectionStart ?? t.value.length;
    const end = t.selectionEnd ?? start;
    const val = t.value;
    t.value = val.slice(0, start) + text + val.slice(end);
    const pos = cursorOffset !== undefined
      ? start + text.length + cursorOffset
      : start + text.length;
    t.setSelectionRange(pos, pos);
    t.dispatchEvent(new Event("input", { bubbles: true }));
    updatePreview();
  }

  function updatePreview() {
    if (!previewEl || !currentTarget) return;
    const val = currentTarget.value || "";
    if (!val.trim()) { previewEl.innerHTML = ""; return; }
    import("../utils.js").then(({ mathEsc }) => {
      previewEl.innerHTML = mathEsc(val);
    }).catch(() => {
      previewEl.innerHTML = val;
    });
  }

  toggle.addEventListener("click", () => {
    visible = !visible;
    kbDiv.style.display = visible ? "block" : "none";
    toggle.textContent = visible ? "⌨ Tastatur ausblenden" : "⌨ Mathe-Tastatur";
    if (visible && !kbDiv.querySelector(".math-kb")) render();
  });

  container.appendChild(wrapper);

  return {
    el: wrapper,
    setTarget(input) {
      // Detach the preview listener from the previous target so repeated
      // setTarget() calls don't accumulate duplicate listeners (memory leak).
      if (currentTarget && previewEl) currentTarget.removeEventListener("input", updatePreview);
      currentTarget = input;
      if (input && previewEl) {
        input.addEventListener("input", updatePreview);
      }
    },
    show() {
      if (!visible) { visible = true; kbDiv.style.display = "block"; toggle.textContent = "⌨ Tastatur ausblenden"; render(); updatePreview(); }
    },
    hide() {
      if (visible) { visible = false; kbDiv.style.display = "none"; toggle.textContent = "⌨ Mathe-Tastatur"; }
    },
    updatePreview,
  };
}
