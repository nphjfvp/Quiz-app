import { loadQuizzes, loadProgress, loadDailyState, saveDailyState, loadFsrs, loadSettings, saveSettings, trackRecent } from "../store.js";
import { navigate } from "../router.js";
import { daysUntilDue, retrievability } from "../fsrs.js";
import { esc } from "../utils.js";

export async function render(root) {
  trackRecent("daily", "", "Tägliches Lernen");
  const quizzes = await loadQuizzes();
  const progress = await loadProgress();
  const settings = await loadSettings();
  const today = new Date().toISOString().slice(0, 10);
  let daily = await loadDailyState();

  const learningPhase = settings.learning_phase || "deepen";
  const disabledTopics = new Set(settings.disabled_topics || []);

  // Collect all topics
  const allTopics = [];
  const topicSet = new Set();
  for (const q of quizzes.flatMap(q => q.questions || [])) {
    if (q.topic && !topicSet.has(q.topic)) {
      topicSet.add(q.topic);
      allTopics.push({ name: q.topic, enabled: !disabledTopics.has(q.topic) });
    }
  }
  allTopics.sort((a, b) => a.name.localeCompare(b.name));

  if (!quizzes.length) {
    root.innerHTML = `<button class="back-btn" id="back-btn">‹ Zurück</button>
      <div class="empty">Keine Quizze vorhanden.<br>Importiere zuerst Quizze!</div>`;
    root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
    return;
  }

  // Create daily plan if needed
  if (!daily || daily.date !== today) {
    const fsrs = await loadFsrs();
    daily = createDailyPlan(quizzes, progress, today, fsrs, disabledTopics, learningPhase, settings.useFsrs !== false);
    await saveDailyState(daily);
  }

  const allQs = quizzes.flatMap(q => q.questions || []);
  const planQs = daily.plan?.map(id => allQs.find(q => q.id === id)).filter(Boolean) ?? [];
  const completed = new Set(daily.completed || []);
  const remaining = planQs.filter(q => !completed.has(q.id));
  const totalPlan = planQs.length;
  const donePct = totalPlan > 0 ? Math.round((completed.size / totalPlan) * 100) : 0;

  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="card-hero" style="background:var(--primary-dark)">
      <div style="font-size:2rem">📅</div>
      <div style="font-size:1.2rem;font-weight:700;margin:6px 0">Tägliches Lernen</div>
      <div style="font-size:0.85rem;opacity:0.9">${today}</div>
      <div class="progress-row" style="margin-top:12px;justify-content:center">
        <div class="progress-bar" style="max-width:250px">
          <div class="progress-fill" style="width:${donePct}%"></div>
        </div>
        <span class="progress-label">${completed.size}/${totalPlan}</span>
      </div>
    </div>`;

  // ── Lernphase ──
  const phaseHints = {
    basics: "Fokus auf Grundlagen und neue Inhalte.",
    deepen: "Ausgewogene Mischung aus Wiederholung und Vertiefung.",
    exam: "Prüfungsmodus: mehr Fragen, höherer Anteil Wiederholung.",
  };
  html += `<div class="card" style="margin-top:8px">
    <div style="font-size:0.85rem;font-weight:600;margin-bottom:4px">Lernphase</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">${["basics","deepen","exam"].map(p => {
      const labels = { basics: "📗 Grundlagen", deepen: "📘 Vertiefen", exam: "📕 Prüfung" };
      const active = learningPhase === p;
      return `<label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer">
        <input type="radio" name="learning-phase" value="${p}" ${active ? "checked" : ""}> ${labels[p]}
      </label>`;
    }).join("")}</div>
    <div id="phase-hint" style="font-size:0.75rem;color:var(--text-light);margin-top:4px">${phaseHints[learningPhase]}</div>
  </div>`;

  // ── Topic toggles ──
  if (allTopics.length > 0) {
    html += `<div class="card" style="margin-top:8px">
      <div style="font-size:0.85rem;font-weight:600;margin-bottom:4px">Themen</div>
      <div style="font-size:0.75rem;color:var(--text-light);margin-bottom:6px">Deaktiviere Themen, die du aktuell nicht lernen möchtest.</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${allTopics.map(t =>
        `<label style="display:flex;align-items:center;gap:4px;font-size:0.8rem;cursor:pointer">
          <input type="checkbox" class="topic-toggle" data-topic="${esc(t.name)}" ${t.enabled ? "checked" : ""}> ${esc(t.name)}
        </label>`
      ).join("")}</div>
    </div>`;
  }

  if (remaining.length > 0) {
    html += `<button class="btn btn-primary btn-lg btn-block" id="start-btn">
      🚀 ${remaining.length} Fragen lernen
    </button>`;
  } else if (totalPlan > 0) {
    html += `<div class="card" style="text-align:center">
      <div style="font-size:2rem;margin-bottom:8px">🎉</div>
      <div style="font-size:1rem;font-weight:700">Alles geschafft!</div>
      <div style="font-size:0.85rem;color:var(--text-light);margin-top:4px">Dein Daily ist erledigt. Komm morgen wieder!</div>
      ${daily.bonus_awarded ? `<div style="margin-top:8px;font-size:0.85rem;color:var(--warning);font-weight:600">🪙 +15 Münzen Tagesbonus erhalten!</div>` : ""}
    </div>`;
  }

  // Show wrong questions for retry
  const wrongIds = daily.wrong || [];
  if (wrongIds.length > 0 && remaining.length === 0) {
    const wrongQs = wrongIds.map(id => allQs.find(q => q.id === id)).filter(Boolean);
    html += `<button class="btn btn-warning btn-block" id="retry-wrong" style="margin-top:12px">
      🔄 ${wrongQs.length} falsche Fragen wiederholen
    </button>`;
  }

  // Deep Learning sessions: suggest topics to review
  let dlSessions = [];
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("lerntrainer", 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    dlSessions = await new Promise((res, rej) => {
      const tx = db.transaction("kv", "readonly");
      const rq = tx.objectStore("kv").get("deep_learn_sessions");
      rq.onsuccess = () => res(rq.result ?? []);
      rq.onerror = () => rej(rq.error);
    });
  } catch { /* no sessions */ }

  // ── Study Plan: today's topics ────────────────────────────────────────
  try {
    const { loadStudyPlans } = await import("../store.js");
    const plans = await loadStudyPlans();
    const today = new Date().toISOString().split("T")[0];
    const todayTopics = [];
    for (const p of plans) {
      for (const t of (p.topics || [])) {
        if (t.scheduledDate === today) todayTopics.push({ plan: p.name, ...t });
      }
    }
    if (todayTopics.length > 0) {
      html += `<div class="section-title" style="margin-top:16px">📅 Heutige Lernplan-Themen</div>`;
      for (const t of todayTopics) {
        html += `<div class="card" style="padding:10px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
          <div><strong>${esc(t.name)}</strong> <span style="font-size:0.75rem;color:var(--text-light)">aus ${esc(t.plan)}</span></div>
          <span style="font-size:0.75rem">~${t.estimatedHours}h</span>
        </div>`;
      }
      html += `<button class="btn btn-ghost btn-sm btn-block" id="open-study-plans" style="margin-top:4px">Alle Lernpläne ansehen ›</button>`;
    }
  } catch { /* no study plans */ }

  if (dlSessions.length > 0) {
    html += `<div class="section-title" style="margin-top:16px">🔬 Konzepte vertiefen</div>`;
    for (const sess of dlSessions.slice(0, 3)) {
      const topics = (sess.topics || []).slice(0, 4);
      html += `<div class="card" style="padding:12px;margin-bottom:8px">
        <div style="font-weight:600;margin-bottom:8px">${esc(sess.name)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">`;
      for (const t of topics) {
        const prompt = sess.mathMode
          ? `Erkläre mir das Grundprinzip von '${t.name}' — welche Formel steckt dahinter?`
          : `Erkläre mir die Kernidee von '${t.name}' — was ist das Wichtigste?`;
        html += `<button class="btn btn-ghost btn-sm dl-topic-btn"
          data-sess="${esc(sess.id)}" data-topic="${esc(t.name)}"
          data-prompt="${esc(prompt)}"
          style="font-size:0.8rem">${esc(t.name)}</button>`;
      }
      html += `</div></div>`;
    }
  }

  root.innerHTML = html;

  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));
  root.querySelector("#open-study-plans")?.addEventListener("click", () => navigate("study-plan"));

  // Lernphase radios
  root.querySelectorAll("input[name='learning-phase']").forEach(r => {
    r.addEventListener("change", async () => {
      if (!r.checked) return;
      const s = await loadSettings();
      s.learning_phase = r.value;
      await saveSettings(s);
      // Refresh to rebuild plan with new phase
      const fsrs = await loadFsrs();
      const disabled = new Set(s.disabled_topics || []);
      daily = createDailyPlan(quizzes, progress, today, fsrs, disabled, s.learning_phase || "deepen", s.useFsrs !== false);
      await saveDailyState(daily);
      const hintEl = root.querySelector("#phase-hint");
      if (hintEl) hintEl.textContent = phaseHints[r.value];
      render(root);
    });
  });

  // Topic checkboxes
  root.querySelectorAll(".topic-toggle").forEach(cb => {
    cb.addEventListener("change", async () => {
      const s = await loadSettings();
      const disabled = new Set(s.disabled_topics || []);
      if (cb.checked) disabled.delete(cb.dataset.topic);
      else disabled.add(cb.dataset.topic);
      s.disabled_topics = [...disabled];
      await saveSettings(s);
      // Rebuild plan with new topic filter
      const fsrs = await loadFsrs();
      daily = createDailyPlan(quizzes, progress, today, fsrs, disabled, s.learning_phase || "deepen", s.useFsrs !== false);
      await saveDailyState(daily);
      render(root);
    });
  });

  // Deep learn topic buttons
  root.querySelectorAll(".dl-topic-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      navigate("deep-learn", {
        sessionId: btn.dataset.sess,
        topicName: btn.dataset.topic,
        prompt: btn.dataset.prompt,
      });
    });
  });
  root.querySelector("#start-btn")?.addEventListener("click", () => {
    const fakeQuiz = { id: "daily", name: "Tägliches Lernen", questions: remaining, description: "", created: "", exam_date: "", weight: 1 };
    navigate("quiz", { quiz: fakeQuiz, mode: "single" });
  });
  root.querySelector("#retry-wrong")?.addEventListener("click", () => {
    const wrongQs = wrongIds.map(id => allQs.find(q => q.id === id)).filter(Boolean);
    const fakeQuiz = { id: "daily-retry", name: "Wiederholung", questions: wrongQs, description: "", created: "", exam_date: "", weight: 1 };
    navigate("quiz", { quiz: fakeQuiz, mode: "single" });
  });
}

function createDailyPlan(quizzes, progress, today, fsrs = {}, disabledTopics = new Set(), phase = "deepen", useFsrs = true) {
  let allQs = quizzes.flatMap(q => q.questions || []);

  // Filter out disabled topics
  if (disabledTopics.size > 0) {
    allQs = allQs.filter(q => !q.topic || !disabledTopics.has(q.topic));
  }

  // Lernphase steuert Umfang und Mischung — vorher wurde die Einstellung
  // zwar gespeichert, aber nie in die Plan-Erstellung einbezogen.
  //   basics: kleinerer Plan, NEUE Inhalte zuerst
  //   deepen: ausgewogen (Standard)
  //   exam:   größerer Plan, Wiederholung/Überfälliges dominiert
  const PHASE = {
    basics: { size: 15, newBoost: 400, reviewBoost: 0 },
    deepen: { size: 20, newBoost: 0, reviewBoost: 0 },
    exam:   { size: 30, newBoost: -300, reviewBoost: 300 },
  }[phase] || { size: 20, newBoost: 0, reviewBoost: 0 };

  const scored = allQs.map(q => {
    const card = fsrs[q.id];
    const p = progress[q.id];
    const box = p?.box ?? 1;
    let score;
    const isNew = !card || card.state === "new" || !card.last_review;
    if (!useFsrs) {
      // FSRS abgeschaltet → reine Leitner-Priorisierung (niedrige Box zuerst,
      // häufig falsch beantwortete Fragen nach oben).
      const wrongRatio = p && p.times_correct + p.times_wrong > 0
        ? p.times_wrong / (p.times_correct + p.times_wrong) : 0;
      score = 600 - box * 100 + wrongRatio * 200 + (p ? 0 : 100);
      score += (p ? PHASE.reviewBoost : PHASE.newBoost);
    } else if (isNew) {
      // Noch nie / als neu gesehen → höchste Priorität
      score = 1000 - box * 10 + PHASE.newBoost;
    } else {
      const due = daysUntilDue(card);          // <0 = überfällig
      const recall = retrievability(card);      // 0..1, niedrig = vergessen
      // Überfällige Tage stark gewichten, niedriger Recall erhöht Priorität
      score = 500 + Math.max(0, -due) * 20 + (1 - recall) * 100 + PHASE.reviewBoost;
      // Noch nicht fällige Karten (due > 0) nach unten
      if (due > 0) score = 200 - Math.min(due, 30) * 5 + PHASE.reviewBoost;
    }
    return { q, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const plan = scored.slice(0, PHASE.size).map(s => s.q.id);

  return { date: today, plan, completed: [], wrong: [], extra_done: false };
}
