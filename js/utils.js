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

// Eindeutige ID (UUID mit Fallback für alte Browser / unsichere Kontexte).
export function uid() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// Farbreihe für Diagram-Label- / Drag-Drop-Chips; geteilt zwischen quiz.js
// und editor.js.
export const CHIP_COLORS = ["#ef4444","#f59e0b","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f97316"];

// Zählt die Fragen eines Quizzes pro Leitner-Box (1-5).
export function getBoxCounts(quiz, progress) {
  const counts = {};
  for (const q of (quiz.questions || [])) {
    const b = progress[q.id]?.box ?? 1;
    counts[b] = (counts[b] || 0) + 1;
  }
  return counts;
}

// Lädt pdf.js einmalig via CDN und konfiguriert den Worker. Geteilt zwischen
// ai-generate, deep-learn und scaffold (vorher 3 identische Kopien).
export async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      const lib = window.pdfjsLib;
      if (lib) {
        lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(lib);
      } else reject(new Error("pdf.js konnte nicht geladen werden"));
    };
    script.onerror = () => reject(new Error("pdf.js konnte nicht geladen werden. Prüfe deine Internetverbindung."));
    document.head.appendChild(script);
  });
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

// LaTeX toggle – set by app.js on boot from settings.latexEnabled (default true).
let _latexEnabled = true;
export function setLatexEnabled(v) { _latexEnabled = !!v; }
export function isLatexEnabled() { return _latexEnabled; }

export function renderMath(escaped) {
  if (!_latexEnabled) return escaped;
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

// Extract text from a PDF file using pdf.js. Shared between ai-generate,
// formula-sheets, and study-plans.
export async function getPdfText(file) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(" ");
    pages.push({ pageNum: i, text });
  }
  return pages;
}

// Fuzzy-match a source_quote in the original text. Tries exact match,
// whitespace-normalized match, then longest common substring (≥60% overlap).
export function matchSourceQuote(originalText, sourceQuote) {
  if (!originalText || !sourceQuote) return null;

  // 1. Exact match
  const idx = originalText.indexOf(sourceQuote);
  if (idx >= 0) return { start: idx, end: idx + sourceQuote.length };

  // 2. Whitespace-normalized match
  const normText = originalText.replace(/\s+/g, " ");
  const normQuote = sourceQuote.replace(/\s+/g, " ");
  const normIdx = normText.indexOf(normQuote);
  if (normIdx >= 0) {
    // Map back to original offsets (approximate)
    let origPos = 0, normPos = 0;
    while (normPos < normIdx) {
      if (/\s/.test(originalText[origPos])) {
        while (/\s/.test(originalText[origPos])) origPos++;
        normPos++;
      } else {
        origPos++;
        normPos++;
      }
    }
    return { start: origPos, end: origPos + sourceQuote.length };
  }

  // 3. Longest common substring (minimum 60% of quote length)
  const minLen = Math.floor(sourceQuote.length * 0.6);
  let best = null;
  for (let i = 0; i < sourceQuote.length - minLen + 1; i++) {
    for (let j = i + minLen; j <= sourceQuote.length; j++) {
      const sub = sourceQuote.slice(i, j);
      const pos = originalText.indexOf(sub);
      if (pos >= 0 && (!best || sub.length > best.end - best.start)) {
        best = { start: pos, end: pos + sub.length };
      }
    }
  }
  return best;
}

// Highlight source passages in original text based on formulas' source_quote fields.
// Returns HTML string with <mark> tags. Formulas without a match are skipped.
export function highlightSource(originalText, formulas) {
  if (!originalText || !formulas?.length) return esc(originalText);

  // Find matches for all formulas with source_quote
  const matches = [];
  for (const f of formulas) {
    if (!f.source_quote) continue;
    const match = matchSourceQuote(originalText, f.source_quote);
    if (match) matches.push({ ...match, formulaId: f.name || f.formula, name: f.name });
  }

  if (!matches.length) return esc(originalText);

  // Sort by position, merge overlapping
  matches.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const m of matches) {
    const last = merged[merged.length - 1];
    if (last && m.start <= last.end) {
      last.end = Math.max(last.end, m.end);
      last.formulaId += ", " + m.formulaId;
    } else {
      merged.push({ ...m });
    }
  }

  // Build highlighted HTML
  let html = "", pos = 0;
  for (const m of merged) {
    html += esc(originalText.slice(pos, m.start));
    html += `<mark class="source-highlight" data-formula-id="${escAttr(m.formulaId)}" data-formula-name="${escAttr(m.name || "")}">`;
    html += esc(originalText.slice(m.start, m.end));
    html += `</mark>`;
    pos = m.end;
  }
  html += esc(originalText.slice(pos));
  return html;
}
