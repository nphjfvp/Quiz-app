import { loadSettings, saveSettings } from "../store.js";
import { navigate } from "../router.js";

const STUDY_PRESETS = {
  mint: {
    label: "🔬 MINT (Mathe, Info, Naturwiss., Technik)",
    desc: "Formeln, Diagramme, präzise Toleranzen",
    presets: { preferredTypes: ["math_formula","diagram_label","single_choice","fill_blank"], mathTolerance: 0.001, fsrsRetention: 0.95, aiDetailLevel: "precise" },
  },
  social: {
    label: "📖 Sozial-/Geisteswissenschaften",
    desc: "Texte, Argumentationen, Freitext-Antworten",
    presets: { preferredTypes: ["free_text","single_choice","multiple_choice","fill_blank"], mathTolerance: 0.01, fsrsRetention: 0.85, aiDetailLevel: "comprehensive" },
  },
  medical: {
    label: "🩺 Medizin & Gesundheit",
    desc: "Bildmarkierung, Anatomie, Merkfähigkeit",
    presets: { preferredTypes: ["mark_image","diagram_label","single_choice","multiple_choice"], mathTolerance: 0.01, fsrsRetention: 0.90, aiDetailLevel: "detailed" },
  },
  languages: {
    label: "🌍 Sprachen",
    desc: "Vokabeln, Lückentexte, Hörverstehen",
    presets: { preferredTypes: ["fill_blank","free_text","single_choice","multiple_choice"], mathTolerance: 0.01, fsrsRetention: 0.85, aiDetailLevel: "simple" },
  },
  general: {
    label: "🎓 Allgemein / Anderes",
    desc: "Ausgewogene Mischung für alle Fächer",
    presets: { preferredTypes: ["single_choice","multiple_choice","free_text","fill_blank"], mathTolerance: 0.005, fsrsRetention: 0.90, aiDetailLevel: "balanced" },
  },
};

export async function render(root) {
  let step = 0, selectedField = null;

  function renderStep() {
    let html = "";
    if (step === 0) {
      html = `<div class="section-title">👋 Willkommen beim Lerntrainer!</div>
        <div class="card" style="text-align:center;padding:24px 16px">
          <p style="font-size:1rem;line-height:1.7;margin:0 0 20px">
            Dein Lernbegleiter mit <strong>KI</strong>, <strong>Spaced Repetition (FSRS)</strong> und <strong>9 Fragetypen</strong>.<br>Richte dein Profil ein.
          </p>
          <div style="font-size:0.95rem;font-weight:600;margin-bottom:12px">Was studierst du?</div>
          <div style="display:flex;flex-direction:column;gap:8px;max-width:420px;margin:0 auto">
            ${Object.entries(STUDY_PRESETS).map(([key, p]) => `
              <button class="card study-option" data-field="${key}" style="padding:12px 16px;text-align:left;border:2px solid transparent;background:var(--card-glass-bg,var(--card-bg));cursor:pointer">
                <div style="font-weight:600;font-size:0.9rem">${p.label}</div>
                <div style="font-size:0.75rem;color:var(--text-light)">${p.desc}</div>
              </button>`).join("")}
          </div>
          <button class="btn btn-ghost btn-sm" id="skip-onboarding" style="margin-top:16px">Überspringen ›</button>
        </div>`;
    } else if (step === 1) {
      html = `<div class="section-title">🚀 Diese Features erwarten dich</div>
        <div class="card" style="text-align:center;padding:16px">
          ${[
            ["🤖","KI-Quiz-Generator","Aus Text, Bild oder PDF automatisch Quiz erstellen"],
            ["🧠","Spaced Repetition (FSRS-4.5)","Optimales Wiederholen — lerne genau dann, wenn du es brauchst"],
            ["🎮","Lernspiele & Shop","6 Mini-Games, Avatar, Haus & Münzen beim Lernen verdienen"],
            ["📊","Statistiken & Prognosen","Heatmap, Lernprognose, Achievements"],
          ].map(([icon,title,desc]) => `
            <div class="card feat-card" style="padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;text-align:left">
              <div style="font-size:1.5rem">${icon}</div>
              <div><strong>${title}</strong><div style="font-size:0.75rem;color:var(--text-light)">${desc}</div></div>
            </div>`).join("")}
          <button class="btn btn-primary btn-lg" id="continue-btn" style="margin-top:12px">Weiter ›</button>
        </div>`;
    } else if (step === 2) {
      html = `<div class="section-title">🎯 Erstes Quiz erstellen</div>
        <div class="card" style="text-align:center;padding:16px">
          <p style="font-size:0.9rem;color:var(--text-light);margin:0 0 16px">Am schnellsten mit dem KI-Generator.<br>Text einfügen, Bild hochladen oder PDF nutzen.</p>
          <button class="btn btn-primary btn-lg btn-block" id="start-ai" style="margin-bottom:8px">🤖 Quiz mit KI generieren</button>
          <button class="btn btn-ghost btn-block" id="start-editor" style="margin-bottom:8px">✏️ Leeres Quiz erstellen</button>
          <button class="btn btn-ghost btn-sm" id="start-done">Fertig – zur Startseite</button>
        </div>`;
    }
    root.innerHTML = html;

    if (step === 0) {
      root.querySelectorAll(".study-option").forEach(btn => {
        btn.addEventListener("click", () => {
          root.querySelectorAll(".study-option").forEach(b => b.style.borderColor = "transparent");
          btn.style.borderColor = "var(--primary)";
          selectedField = btn.dataset.field;
        });
      });
      root.querySelector("#skip-onboarding")?.addEventListener("click", () => finish(null));
    }
    if (step === 1) {
      root.querySelector("#continue-btn")?.addEventListener("click", () => { step = 2; renderStep(); });
    }
    if (step === 2) {
      root.querySelector("#start-ai")?.addEventListener("click", () => finish("ai-generate"));
      root.querySelector("#start-editor")?.addEventListener("click", () => finish("editor"));
      root.querySelector("#start-done")?.addEventListener("click", () => finish("home"));
    }
  }

  async function finish(navigateTo) {
    const settings = await loadSettings();
    settings.onboardingDone = true;
    if (selectedField && STUDY_PRESETS[selectedField]) {
      settings.studyField = selectedField;
      settings.studyPresets = STUDY_PRESETS[selectedField].presets;
    }
    await saveSettings(settings);
    navigate(navigateTo || "home");
    if (!navigateTo || navigateTo === "home") setTimeout(() => window.location.reload(), 100);
  }

  renderStep();
}
