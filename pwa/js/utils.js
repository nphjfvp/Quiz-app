// Gemeinsame Hilfsfunktionen für alle Screens

// HTML-escapen, um XSS bei String-Interpolation in Templates zu vermeiden
// (Text-Kontext – escaped &, <, >; KEINE Anführungszeichen, daher für
// Attribut-Werte escAttr nutzen).
export function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

// Attribut-sicher escapen (z. B. für value="...", src="...", data-*="...").
// esc() allein reicht hier nicht, da innerHTML keine Anführungszeichen escaped.
export function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LATEX_RE = /(\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?\$)/g;

// Detects bare LaTeX commands the AI sometimes emits without $ delimiters.
const BARE_LATEX_RE = /\\(?:frac|sqrt|sum|prod|int|lim|cdot|times|leq|geq|neq|approx|pm|infty|partial|alpha|beta|gamma|delta|theta|lambda|mu|sigma|pi|omega|Delta|Sigma|Omega|left|right|text|mathrm|mathbf|vec|hat|bar|overline)\b|[A-Za-z0-9)\]}]\s*[\^_]\s*[A-Za-z0-9{(]/;

// Wrap bare LaTeX tokens in $...$ so KaTeX picks them up. Token-based so prose
// stays intact. The input here is already HTML-escaped (& -> &amp; etc.), so we
// only touch backslash/caret/underscore patterns which escaping leaves alone.
function autowrapBareLatex(escaped) {
  if (escaped.includes("$") || !BARE_LATEX_RE.test(escaped)) return escaped;
  return escaped.split(" ").map(tok => (tok && BARE_LATEX_RE.test(tok)) ? `$${tok}$` : tok).join(" ");
}

export function renderMath(escaped) {
  if (!escaped) return escaped;
  if (typeof window.katex === "undefined") return escaped;
  escaped = autowrapBareLatex(escaped);
  if (!escaped.includes("$")) return escaped;
  return escaped.replace(LATEX_RE, (m) => {
    const display = m.startsWith("$$");
    const tex = display ? m.slice(2, -2) : m.slice(1, -1);
    try {
      return window.katex.renderToString(tex, { displayMode: display, throwOnError: false });
    } catch { return m; }
  });
}

export function mathEsc(s) {
  return renderMath(esc(s));
}
