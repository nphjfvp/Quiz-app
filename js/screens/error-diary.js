import { loadErrorDiary, saveErrorDiary } from "../store.js";
import { navigate } from "../router.js";

export async function render(root) {
  const diary = await loadErrorDiary();

  const topics = [...new Set(diary.map(e => e.topic).filter(Boolean))].sort();
  let filter = "";

  function renderList() {
    const filtered = filter ? diary.filter(e => e.topic === filter) : diary;

    let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
      <div class="section-title">📕 Fehlertagebuch</div>`;

    if (topics.length > 0) {
      html += `<div style="margin-bottom:12px">
        <select id="topic-filter" style="width:100%;padding:8px 12px;border-radius:8px;border:1.5px solid var(--border);background:var(--card);color:var(--text);font-size:0.9rem">
          <option value="">Alle Themen</option>
          ${topics.map(t => `<option value="${t}" ${filter === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </div>`;
    }

    if (diary.length > 0) {
      html += `<button class="btn btn-danger btn-sm" id="clear-all" style="margin-bottom:12px">Alle löschen</button>`;
    }

    if (filtered.length === 0) {
      html += `<div class="empty">Noch keine Fehler! Weiter so! 🎉</div>`;
    } else {
      for (const entry of filtered) {
        const dateStr = entry.date ? new Date(entry.date).toLocaleDateString("de-DE") : "–";
        html += `<div class="card" style="border-left:4px solid var(--danger);margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:0.7rem;color:var(--text-light)">${dateStr}</span>
            ${entry.topic ? `<span style="font-size:0.7rem;background:var(--row-neutral);padding:2px 8px;border-radius:10px">${entry.topic}</span>` : ""}
          </div>
          <div style="font-weight:600;margin-bottom:6px;font-size:0.9rem">${entry.questionText}</div>
          <div style="font-size:0.82rem;margin-bottom:3px">
            <span style="color:var(--danger)">✗ Deine Antwort:</span> ${entry.userAnswer}
          </div>
          <div style="font-size:0.82rem">
            <span style="color:var(--success)">✓ Richtig:</span> ${entry.correctAnswer}
          </div>
          ${entry.quizName ? `<div style="font-size:0.7rem;color:var(--text-light);margin-top:6px">${entry.quizName}</div>` : ""}
          <button class="btn btn-ghost btn-sm delete-entry" data-id="${entry.id}" style="margin-top:8px">Entfernen</button>
        </div>`;
      }
    }

    root.innerHTML = html;

    root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));

    const sel = root.querySelector("#topic-filter");
    if (sel) {
      sel.addEventListener("change", () => {
        filter = sel.value;
        renderList();
      });
    }

    const clearBtn = root.querySelector("#clear-all");
    if (clearBtn) {
      clearBtn.addEventListener("click", async () => {
        if (!confirm("Alle Fehlereinträge wirklich löschen?")) return;
        diary.length = 0;
        await saveErrorDiary(diary);
        renderList();
      });
    }

    root.querySelectorAll(".delete-entry").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const idx = diary.findIndex(e => String(e.id) === id);
        if (idx !== -1) {
          diary.splice(idx, 1);
          await saveErrorDiary(diary);
          renderList();
        }
      });
    });
  }

  renderList();
}
