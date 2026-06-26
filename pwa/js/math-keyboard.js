// Reusable math symbol keyboard for input fields

const ROWS = [
  // Primary row — most-used
  [
    { label: "x²", insert: "²", cls: "kb-op" },
    { label: "x³", insert: "³", cls: "kb-op" },
    { label: "√", insert: "√(", cls: "kb-op" },
    { label: "π", insert: "π", cls: "kb-op" },
    { label: "^", insert: "^", cls: "kb-op" },
    { label: "×", insert: "*", cls: "kb-op" },
    { label: "÷", insert: "/", cls: "kb-op" },
    { label: "±", insert: "±", cls: "kb-op" },
    { label: "(", insert: "(", cls: "" },
    { label: ")", insert: ")", cls: "" },
  ],
  // Extended row — less common
  [
    { label: "¼", insert: "1/4", cls: "" },
    { label: "½", insert: "1/2", cls: "" },
    { label: "¾", insert: "3/4", cls: "" },
    { label: "∞", insert: "∞", cls: "kb-op" },
    { label: "≈", insert: "≈", cls: "kb-op" },
    { label: "≠", insert: "≠", cls: "kb-op" },
    { label: "≤", insert: "≤", cls: "kb-op" },
    { label: "≥", insert: "≥", cls: "kb-op" },
    { label: "·10^", insert: "*10^", cls: "kb-fn" },
    { label: "e", insert: "e", cls: "" },
  ],
  // Functions row
  [
    { label: "sin", insert: "sin(", cls: "kb-fn" },
    { label: "cos", insert: "cos(", cls: "kb-fn" },
    { label: "tan", insert: "tan(", cls: "kb-fn" },
    { label: "ln", insert: "ln(", cls: "kb-fn" },
    { label: "log", insert: "log(", cls: "kb-fn" },
    { label: "abs", insert: "abs(", cls: "kb-fn" },
    { label: "α", insert: "α", cls: "" },
    { label: "β", insert: "β", cls: "" },
    { label: "Δ", insert: "Δ", cls: "" },
    { label: "θ", insert: "θ", cls: "" },
  ],
];

/**
 * Create a math keyboard and attach it above/below a target input.
 * @param {HTMLElement} container - Element to append the keyboard into
 * @param {HTMLInputElement|null} defaultTarget - Default input to type into
 * @returns {{ el: HTMLElement, setTarget(input): void }}
 */
export function createMathKeyboard(container, defaultTarget = null) {
  let target = defaultTarget;
  let expanded = false;

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "margin: 4px 0;";

  const toggle = document.createElement("button");
  toggle.className = "math-kb-toggle";
  toggle.textContent = "⌨ Mathe-Tastatur";
  toggle.type = "button";
  wrapper.appendChild(toggle);

  const kbDiv = document.createElement("div");
  kbDiv.style.display = "none";
  wrapper.appendChild(kbDiv);

  function renderRows() {
    kbDiv.innerHTML = "";
    const visibleRows = expanded ? ROWS : [ROWS[0]];
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
          insertAtCursor(btn.insert);
        });
        rowEl.appendChild(b);
      }
      kbDiv.appendChild(rowEl);
    }
    // Expand/collapse button
    if (ROWS.length > 1) {
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "math-kb-toggle";
      moreBtn.textContent = expanded ? "▲ Weniger" : "▼ Mehr Symbole";
      moreBtn.style.marginTop = "4px";
      moreBtn.addEventListener("click", () => { expanded = !expanded; renderRows(); });
      kbDiv.appendChild(moreBtn);
    }
  }

  let visible = false;
  toggle.addEventListener("click", () => {
    visible = !visible;
    kbDiv.style.display = visible ? "block" : "none";
    toggle.textContent = visible ? "⌨ Tastatur ausblenden" : "⌨ Mathe-Tastatur";
    if (visible && !kbDiv.children.length) renderRows();
  });

  function insertAtCursor(text) {
    if (!target) return;
    target.focus();
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    const val = target.value;
    target.value = val.slice(0, start) + text + val.slice(end);
    const pos = start + text.length;
    target.setSelectionRange(pos, pos);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  container.appendChild(wrapper);

  return {
    el: wrapper,
    setTarget(input) { target = input; },
    show() {
      if (!visible) { visible = true; kbDiv.style.display = "block"; toggle.textContent = "⌨ Tastatur ausblenden"; if (!kbDiv.children.length) renderRows(); }
    },
    hide() {
      if (visible) { visible = false; kbDiv.style.display = "none"; toggle.textContent = "⌨ Mathe-Tastatur"; }
    },
  };
}
