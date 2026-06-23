import { loadMarked, saveMarked, loadQuizzes } from "../store.js";
import { navigate } from "../router.js";

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

export async function render(root) {
  let marked = await loadMarked();
  const quizzes = await loadQuizzes();

  function resolveQuestions() {
    const resolved = [];
    for (const id of marked) {
      for (const quiz of quizzes) {
        const q = (quiz.questions || []).find(q => q.id === id);
        if (q) {
          resolved.push({ ...q, quizName: quiz.name, topic: q.topic || quiz.name });
          break;
        }
      }
    }
    return resolved;
  }

  function renderList() {
    const questions = resolveQuestions();

    let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
      <div class="section-title">⭐ Markierte Fragen</div>`;

    if (questions.length === 0) {
      html += `<div class="empty">Keine markierten Fragen.</div>`;
    } else {
      html += `<div class="btn-row" style="margin-bottom:12px">
        <button class="btn btn-primary btn-sm" id="start-marked">Markierte lernen (${questions.length})</button>
      </div>`;

      for (const q of questions) {
        html += `<div class="card" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:0.7rem;background:var(--row-neutral);padding:2px 8px;border-radius:10px">${q.topic || "–"}</span>
            <span style="font-size:0.7rem;color:var(--text-light)">${q.quizName}</span>
          </div>
          <div style="font-weight:600;margin-bottom:8px;font-size:0.9rem">${esc(q.question_text || q.text || "")}</div>
          <div class="btn-row">
            <button class="btn btn-ghost btn-sm unmark-btn" data-id="${q.id}">Entfernen</button>
            <button class="btn btn-primary btn-sm ai-btn" data-id="${q.id}">KI fragen</button>
          </div>
        </div>`;
      }
    }

    root.innerHTML = html;

    root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));

    const startBtn = root.querySelector("#start-marked");
    if (startBtn) {
      startBtn.addEventListener("click", () => {
        navigate("quiz", { mode: "marked", questionIds: [...marked] });
      });
    }

    root.querySelectorAll(".unmark-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        marked = marked.filter(m => m !== id);
        await saveMarked(marked);
        renderList();
      });
    });

    root.querySelectorAll(".ai-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const q = questions.find(q => q.id === id);
        if (q) {
          const qImage = q.diagram_image_path || q.diagram_image || q.image_path || q.image || null;
          navigate("tutor", { question: { ...q, text: q.question_text || q.text, image: qImage } });
        }
      });
    });
  }

  renderList();
}
