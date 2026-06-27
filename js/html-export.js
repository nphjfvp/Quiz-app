// HTML / JSON export for quizzes — PWA
// Mirrors src/html_export.py (Desktop version).

async function imageToDataUrl(url) {
  if (!url) return "";
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

function escHtml(s) {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderChoices(q) {
  if (!q.options?.length) return "";
  const correctIdx = new Set();
  q.options.forEach((o, i) => { if (o.is_correct) correctIdx.add(i); });
  const multi = correctIdx.size > 1;
  return `<div class="choices">${q.options.map((o, i) => {
    const key = String.fromCharCode(65 + i);
    const cls = correctIdx.has(i) ? "correct" : "";
    const mark = multi ? (correctIdx.has(i) ? "☑" : "☐") : (correctIdx.has(i) ? "●" : "○");
    return `<div class="choice ${cls}"><span class="choice-mark">${mark}</span> <span class="choice-key">${key}.</span> ${escHtml(o.text)}</div>`;
  }).join("")}</div>`;
}

function renderAnswer(q) {
  const parts = [];
  if (q.options?.length) {
    const correct = q.options.filter(o => o.is_correct).map(o => o.text).join("; ");
    parts.push(correct);
  } else if (q.correct_text || q.correct_answer) {
    parts.push(q.correct_text || q.correct_answer);
  } else if (q.blanks?.length) {
    parts.push(q.blanks.join(", "));
  }
  if (!parts.length) return "";
  return `<div class="answer-row"><strong>Richtige Antwort:</strong> ${escHtml(parts.join(" | "))}</div>`;
}

function renderExplanation(q) {
  if (!q.explanation) return "";
  return `<div class="explanation"><strong>Erklärung:</strong> ${escHtml(q.explanation)}</div>`;
}

export async function quizToHtml(quiz) {
  const questions = quiz.questions || [];
  const name = escHtml(quiz.name || "Quiz");

  const imageCache = new Map();
  for (const q of questions) {
    for (const key of ["image", "image_path", "diagram_image", "diagram_image_path"]) {
      const src = q[key];
      if (src && !imageCache.has(src)) {
        imageCache.set(src, await imageToDataUrl(src));
      }
    }
  }

  const questionCards = questions.map((q, i) => {
    let imgHtml = "";
    const imgSrc = q.image || q.image_path;
    if (imgSrc) {
      const dataUrl = imageCache.get(imgSrc) || imgSrc;
      imgHtml = `<div class="quiz-img-wrap"><img src="${escapeAttr(dataUrl)}" alt="Fragebild"></div>`;
    }
    const typeLabel = {
      single_choice: "Single Choice", multiple_choice: "Multiple Choice",
      free_text: "Freitext", fill_blank: "Lückentext",
      drag_drop: "Drag & Drop", drag_category: "Kategorie-Zuordnung",
      math_formula: "Mathe-Formel", diagram_label: "Diagramm beschriften",
      mark_image: "Bild markieren",
    }[q.question_type] || q.question_type || "Frage";

    return `<div class="q-card" id="q${i}">
      <div class="q-header">
        <span class="q-num">Frage ${i + 1}/${questions.length}</span>
        <span class="q-type">${escHtml(typeLabel)}</span>
      </div>
      ${q.topic ? `<div class="q-topic">${escHtml(q.topic)}</div>` : ""}
      <div class="q-text">${escHtml(q.question_text || q.text || "")}</div>
      ${imgHtml}
      ${renderChoices(q)}
      ${renderAnswer(q)}
      ${renderExplanation(q)}
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"><\/script>
<style>
  :root { color-scheme: light dark; --bg: #f8fafc; --card-bg: #fff; --text: #1e293b; --text-light: #64748b; --primary: #6366f1; --success: #22c55e; --danger: #ef4444; --radius: 12px; --shadow: 0 1px 3px rgba(0,0,0,.08); }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f172a; --card-bg: #1e293b; --text: #e2e8f0; --text-light: #94a3b8; --shadow: 0 1px 3px rgba(0,0,0,.3); } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); max-width: 800px; margin: 0 auto; padding: 16px; line-height: 1.6; }
  h1 { text-align: center; margin: 16px 0 24px; color: var(--primary); }
  .q-card { background: var(--card-bg); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; box-shadow: var(--shadow); }
  .q-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .q-num { font-weight: 600; color: var(--primary); }
  .q-type { font-size: .8rem; color: var(--text-light); }
  .q-topic { font-size: .85rem; color: var(--text-light); margin-bottom: 6px; }
  .q-text { font-size: 1.05rem; margin-bottom: 10px; }
  .quiz-img-wrap { text-align: center; margin: 10px 0; }
  .quiz-img-wrap img { max-width: 100%; max-height: 400px; border-radius: 8px; }
  .choices { margin: 8px 0; }
  .choice { padding: 6px 10px; margin: 4px 0; border-radius: 6px; border: 1px solid #e2e8f0; }
  .choice.correct { background: #22c55e15; border-color: var(--success); }
  .choice-mark { margin-right: 4px; }
  .choice-key { font-weight: 600; margin-right: 4px; }
  .answer-row { margin: 8px 0; padding: 8px 12px; background: #22c55e10; border-radius: 6px; border-left: 3px solid var(--success); }
  .explanation { margin: 8px 0; font-size: .9rem; color: var(--text-light); }
  @media print { body { background: #fff; } .q-card { break-inside: avoid; box-shadow: none; border: 1px solid #ddd; } }
</style>
</head>
<body>
<h1>${name}</h1>
<div class="q-count" style="text-align:center;color:var(--text-light);margin-bottom:16px">${questions.length} Fragen</div>
${questionCards}
<script>
  try { renderMathInElement(document.body, { delimiters: [{left: "$$", right: "$$", display: true}, {left: "$", right: "$", display: false}] }); } catch(e) {}
<\/script>
</body>
</html>`;
}

export async function downloadQuiz(quiz, format = "json") {
  if (format === "html") {
    const html = await quizToHtml(quiz);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (quiz.name || "quiz").replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, "_") + ".html";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } else {
    const json = JSON.stringify(quiz, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (quiz.name || "quiz").replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, "_") + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
