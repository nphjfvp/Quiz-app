import { navigate } from "../router.js";
import { esc, mathEsc, uid } from "../utils.js";
import { generateExercise, checkExerciseSolution } from "../ai-service.js";

export async function render(root, params = {}) {
  const topic = params.topic || "Allgemein";
  const planId = params.planId || "";
  let exercise = null;
  let result = null;
  let userSolution = "";
  let userImageBase64 = null;
  let inputMode = "text";

  function renderUI() {
    let html = `<button class="back-btn" id="ex-back">‹ Zurück</button>
      <div class="section-title">🎯 Übungsaufgabe</div>
      <p style="color:var(--text-light);font-size:0.85rem;margin:0 0 12px">Thema: ${esc(topic)}</p>`;

    if (!exercise) {
      html += `<div class="card" style="text-align:center;padding:20px">
        <p style="color:var(--text-light);margin:0 0 12px">KI-generierte Aufgabe zum Thema.</p>
        <button class="btn btn-primary" id="ex-gen-btn">🤖 Aufgabe generieren</button>
        <div id="ex-err" class="error-box" style="display:none;margin-top:8px"></div>
      </div>`;
    } else {
      html += `<div class="card" style="padding:14px">
        <div style="font-weight:600;margin-bottom:8px">📝 Aufgabe:</div>
        <div style="font-size:0.95rem;line-height:1.6;white-space:pre-wrap">${mathEsc(exercise.question)}</div>
        ${exercise.hint ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:0.8rem;color:var(--text-light)">💡 Tipp</summary><div style="margin-top:4px;font-size:0.85rem">${esc(exercise.hint)}</div></details>` : ""}
      </div>`;

      if (!result) {
        html += `<div class="card" style="padding:14px;margin-top:12px">
          <div style="display:flex;gap:4px;margin-bottom:10px">
            <button class="btn btn-sm ${inputMode === "text" ? "btn-primary" : "btn-ghost"}" id="mode-text">✏️ Text</button>
            <button class="btn btn-sm ${inputMode === "image" ? "btn-primary" : "btn-ghost"}" id="mode-image">📷 Bild</button>
            <button class="btn btn-sm ${inputMode === "keyboard" ? "btn-primary" : "btn-ghost"}" id="mode-kb">⌨ Formel</button>
          </div>`;

        if (inputMode === "text") {
          html += `<textarea id="ex-answer" class="textarea input" rows="4" placeholder="Deine Lösung hier eingeben…">${esc(userSolution)}</textarea>`;
        } else if (inputMode === "image") {
          html += `<input type="file" id="ex-image" accept="image/*" class="input" style="padding:8px">
            <small class="file-hint">Foto deines handschriftlichen Lösungswegs</small>`;
          if (userImageBase64) html += `<div style="margin-top:8px;font-size:0.8rem;color:var(--success)">✅ Bild geladen</div>`;
        } else if (inputMode === "keyboard") {
          html += `<textarea id="ex-answer-kb" class="textarea input" rows="4" placeholder="Mit Mathe-Tastatur…">${esc(userSolution)}</textarea>
            <div id="ex-kb-wrap"></div>`;
        }

        html += `<button class="btn btn-primary btn-block" id="ex-check" style="margin-top:10px">✅ Lösung prüfen</button></div>`;
      }

      if (result) {
        const isCorrect = result.isCorrect;
        html += `<div class="card" style="padding:14px;margin-top:12px;background:${isCorrect ? "var(--success-bg, #dcfce7)" : "var(--danger-bg, #fee2e2)"}">
          <div style="font-weight:700;font-size:1rem;margin-bottom:8px">${isCorrect ? "✅ Richtig!" : "❌ Fehler gefunden"}</div>
          ${result.errorStep ? `<div style="font-size:0.85rem;margin-bottom:6px"><strong>Fehler bei:</strong> ${esc(result.errorStep)}</div>` : ""}
          ${result.explanation ? `<div style="font-size:0.85rem;line-height:1.5;margin-bottom:8px">${esc(result.explanation)}</div>` : ""}
          ${result.tip ? `<div style="font-size:0.8rem;color:var(--text-light)">💡 ${esc(result.tip)}</div>` : ""}
        </div>
        <div class="card" style="padding:14px;margin-top:8px">
          <div style="font-weight:600;margin-bottom:6px">Musterlösung:</div>
          <div style="font-size:0.85rem;white-space:pre-wrap">${mathEsc(exercise.solution)}</div>
        </div>
        <button class="btn btn-ghost btn-block" id="ex-new" style="margin-top:10px">🔄 Neue Aufgabe</button>`;
      }
    }

    root.innerHTML = html;

    root.querySelector("#ex-back").addEventListener("click", () => {
      navigate("study-plans", planId ? { planId, action: "view" } : {});
    });

    root.querySelector("#ex-gen-btn")?.addEventListener("click", async () => {
      const btn = root.querySelector("#ex-gen-btn");
      const errBox = root.querySelector("#ex-err");
      btn.textContent = "⏳ Generiere…";
      btn.disabled = true;
      try { exercise = await generateExercise(topic); renderUI(); }
      catch (err) { errBox.textContent = err.message || "Fehler"; errBox.style.display = "block"; btn.textContent = "🤖 Aufgabe generieren"; btn.disabled = false; }
    });

    root.querySelector("#mode-text")?.addEventListener("click", () => {
      if (inputMode === "keyboard") userSolution = root.querySelector("#ex-answer-kb")?.value || "";
      inputMode = "text"; renderUI();
    });
    root.querySelector("#mode-image")?.addEventListener("click", () => { inputMode = "image"; renderUI(); });
    root.querySelector("#mode-kb")?.addEventListener("click", () => {
      if (inputMode === "text") userSolution = root.querySelector("#ex-answer")?.value || "";
      inputMode = "keyboard"; renderUI();
    });

    root.querySelector("#ex-image")?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { userImageBase64 = reader.result; renderUI(); };
      reader.readAsDataURL(file);
    });

    if (inputMode === "keyboard") {
      const kbWrap = root.querySelector("#ex-kb-wrap");
      if (kbWrap) {
        import("../math-keyboard.js").then(({ createMathKeyboard }) => {
          const ta = root.querySelector("#ex-answer-kb");
          createMathKeyboard(kbWrap, { target: ta }).show();
        });
      }
    }

    root.querySelector("#ex-check")?.addEventListener("click", async () => {
      if (inputMode === "text") userSolution = root.querySelector("#ex-answer")?.value || "";
      if (inputMode === "keyboard") userSolution = root.querySelector("#ex-answer-kb")?.value || "";
      if (!userSolution && !userImageBase64) return;
      const btn = root.querySelector("#ex-check");
      btn.textContent = "⏳ Prüfe…";
      btn.disabled = true;
      try { result = await checkExerciseSolution(exercise, userSolution, userImageBase64); renderUI(); }
      catch (err) { btn.textContent = "❌ Fehler"; btn.disabled = false; }
    });

    root.querySelector("#ex-new")?.addEventListener("click", () => {
      exercise = null; result = null; userSolution = ""; userImageBase64 = null; renderUI();
    });
  }

  renderUI();
}
