// Gemeinsame Hilfsfunktionen für alle Screens

// HTML-escapen, um XSS bei String-Interpolation in Templates zu vermeiden
export function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

const LATEX_RE = /(\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?\$)/g;

export function renderMath(escaped) {
  if (!escaped || !escaped.includes("$")) return escaped;
  if (typeof window.katex === "undefined") return escaped;
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
