"""KI-Lernmodus and Sokratischer Modus for the desktop app.

These methods are mixed into the App class via binding in app.py. They give the
learner a chat with an AI tutor that knows the quiz results (weak areas, errors)
and — if linked — the original source material (script/lecture PDF).
"""

import threading
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox
import customtkinter as ctk

from .models import Quiz
from .theme import COLORS, RADIUS_SM, RADIUS_MD, RADIUS_LG
from .latex_render import latex_to_plain, has_latex, autowrap_latex


def _plain(s):
    s = s or ""
    return latex_to_plain(autowrap_latex(s)) if has_latex(s) else s


def _build_study_context(self, quiz: Quiz, material):
    """Assemble a context string describing the learner's state + material."""
    questions = quiz.questions or []
    progress = self.store.load_progress()
    diary = self.store.load_error_diary()

    def _is_weak(q):
        p = progress.get(q.id)
        if not p:
            return True
        return p.box <= 2 or p.times_wrong > p.times_correct

    weak = [q for q in questions if _is_weak(q)]
    unseen = [q for q in questions if q.id not in progress]
    strong = [q for q in questions if progress.get(q.id) and progress[q.id].box >= 4]
    topics = sorted({q.topic.strip() for q in questions if q.topic.strip()})
    weak_topics = sorted({q.topic.strip() for q in weak if q.topic.strip()})
    quiz_errors = [e for e in diary if e.get("quiz") == quiz.name][:5]

    ctx = [f'Quiz: "{quiz.name}" ({len(questions)} Fragen)']
    if topics:
        ctx.append(f"Themen: {', '.join(topics)}")
    ctx.append(f"Lernstand: {len(weak)} schwach, {len(unseen)} ungesehen, {len(strong)} gut gelernt.")
    if weak_topics:
        ctx.append(f"Schwache Themen: {', '.join(weak_topics)}")
    if weak:
        ctx.append("Beispiele für Schwächen:")
        for q in weak[:8]:
            p = progress.get(q.id)
            tag = f"{p.times_wrong}x falsch" if p else "unbeantwortet"
            ctx.append(f"- {_plain(q.text)} ({tag})")
    if quiz_errors:
        ctx.append("Letzte Fehler:")
        for e in quiz_errors:
            ctx.append(f"- Frage: {e.get('question','')} → User: {e.get('user_answer','')} (Richtig: {e.get('correct','')})")
    if material and material.get("text"):
        txt = material["text"]
        if len(txt) > 12000:
            txt = txt[:12000] + "\n[… gekürzt]"
        ctx.append(f"\n── Quellmaterial (Skript/Vorlesung) ──\n{txt}")
    return "\n".join(ctx)


def _ai_chat_panel(self, scroll, start_row, system_prompt, context, suggestions):
    """Build a reusable chat panel (messages + input). Returns nothing.

    suggestions: list of (label, prompt) tuples rendered as quick buttons.
    """
    history = []  # list of {"role","content"}

    msg_frame = ctk.CTkScrollableFrame(scroll, fg_color=COLORS["bg"], corner_radius=RADIUS_MD,
                                        height=320)
    msg_frame.grid(row=start_row + 1, column=0, sticky="ew", pady=(8, 8))
    msg_frame.grid_columnconfigure(0, weight=1)
    self._study_msg_row = 0

    def add_bubble(role, text):
        align = "e" if role == "user" else "w"
        color = COLORS["primary"] if role == "user" else COLORS["card"]
        txt_color = "#ffffff" if role == "user" else COLORS["text"]
        bubble = ctk.CTkFrame(msg_frame, fg_color=color, corner_radius=RADIUS_MD)
        bubble.grid(row=self._study_msg_row, column=0, sticky=align, padx=8, pady=4)
        lbl = ctk.CTkLabel(bubble, text=_plain(text), font=("Segoe UI", 12),
                           text_color=txt_color, wraplength=520, justify="left")
        lbl.grid(row=0, column=0, padx=12, pady=8)
        self._study_msg_row += 1
        msg_frame._parent_canvas.yview_moveto(1.0)
        return lbl

    # Suggestion buttons
    if suggestions:
        sug_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        sug_frame.grid(row=start_row, column=0, sticky="ew", pady=(0, 4))
        col = 0
        for label, prompt in suggestions:
            b = ctk.CTkButton(sug_frame, text=label, height=30, corner_radius=RADIUS_SM,
                              fg_color=COLORS["card"], text_color=COLORS["text"],
                              hover_color=COLORS.get("card_hover", "#eef7f2"),
                              border_width=1, border_color=COLORS["border"],
                              font=("Segoe UI", 11),
                              command=lambda p=prompt: send(p))
            b.grid(row=col // 2, column=col % 2, padx=4, pady=3, sticky="ew")
            sug_frame.grid_columnconfigure(col % 2, weight=1)
            col += 1

    input_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    input_frame.grid(row=start_row + 2, column=0, sticky="ew", pady=(4, 0))
    input_frame.grid_columnconfigure(0, weight=1)
    entry = ctk.CTkEntry(input_frame, placeholder_text="Was möchtest du lernen?",
                         height=40, font=("Segoe UI", 13))
    entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
    send_btn = ctk.CTkButton(input_frame, text="▶", width=50, height=40,
                             fg_color=COLORS["primary"])
    send_btn.grid(row=0, column=1)

    def send(text=None):
        msg = text if text is not None else entry.get().strip()
        if not msg:
            return
        if not self.ai.api_key:
            add_bubble("assistant", "⚠️ Kein API-Key konfiguriert. Bitte in den KI-Einstellungen hinterlegen.")
            return
        entry.delete(0, "end")
        add_bubble("user", msg)
        send_btn.configure(state="disabled")
        entry.configure(state="disabled")
        typing = add_bubble("assistant", "…")

        def run():
            messages = [{"role": "system", "content": system_prompt + "\n\n" + context}]
            messages += history[-10:]
            messages.append({"role": "user", "content": msg})
            try:
                reply = self.ai._call_api(messages, max_tokens=900) or "Keine Antwort erhalten."
            except Exception as e:
                reply = f"Fehler: {e}"

            def done():
                typing.configure(text=_plain(reply))
                history.append({"role": "user", "content": msg})
                history.append({"role": "assistant", "content": reply})
                send_btn.configure(state="normal")
                entry.configure(state="normal")
                entry.focus_set()
                msg_frame._parent_canvas.yview_moveto(1.0)
            self.after(0, done)

        threading.Thread(target=run, daemon=True).start()

    send_btn.configure(command=lambda: send())
    entry.bind("<Return>", lambda e: send())
    entry.focus_set()


def show_study(self, quiz: Quiz):
    """KI-Lernmodus: chat tutor that knows quiz state + linked material."""
    self._clear_main()
    self.current_quiz = quiz
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    material = self.store.get_material(quiz.id)

    header = ctk.CTkFrame(scroll, fg_color="transparent")
    header.grid(row=0, column=0, sticky="ew", pady=(0, 8))
    header.grid_columnconfigure(1, weight=1)
    ctk.CTkButton(header, text="← Zurück", width=80, height=32, corner_radius=RADIUS_MD,
                  fg_color=COLORS["card"], text_color=COLORS["text"],
                  hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                  border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=lambda: self.show_quiz_modes(quiz)
                  ).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(header, text="📖 KI-Lernmodus", font=("Segoe UI", 20, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=1, sticky="w")

    # Material status / link button
    mat_row = ctk.CTkFrame(scroll, fg_color="transparent")
    mat_row.grid(row=1, column=0, sticky="ew", pady=(0, 6))
    if material:
        ctk.CTkLabel(mat_row, text=f"📄 Quellmaterial verknüpft: {material.get('name','')}",
                     font=("Segoe UI", 12), text_color=COLORS["success"]).grid(row=0, column=0, sticky="w")
        ctk.CTkButton(mat_row, text="Entfernen", width=90, height=28, corner_radius=RADIUS_SM,
                      fg_color=COLORS["danger"], font=("Segoe UI", 11),
                      command=lambda: (self.store.delete_material(quiz.id), self.show_study(quiz))
                      ).grid(row=0, column=1, padx=10)
    else:
        ctk.CTkLabel(mat_row, text="Kein Quellmaterial verknüpft.",
                     font=("Segoe UI", 12), text_color=COLORS["text_light"]).grid(row=0, column=0, sticky="w")
        ctk.CTkButton(mat_row, text="📄 Material hochladen", width=160, height=28,
                      corner_radius=RADIUS_SM, fg_color=COLORS["primary"], font=("Segoe UI", 11),
                      command=lambda: self._link_material(quiz)
                      ).grid(row=0, column=1, padx=10)

    # Socratic mode button
    ctk.CTkButton(scroll, text="🏛️ Sokratischer Modus — KI fragt, du antwortest",
                  height=34, corner_radius=RADIUS_MD, fg_color=COLORS["card"],
                  text_color=COLORS["text"], hover_color=COLORS.get("card_hover", "#eef7f2"),
                  border_width=1, border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=lambda: self.show_socratic(quiz)
                  ).grid(row=2, column=0, sticky="ew", pady=(0, 8))

    context = _build_study_context(self, quiz, material)
    system_prompt = (
        "Du bist ein freundlicher, kompetenter Lerntutor. Hilf dem Lernenden, den "
        "Stoff zu verstehen. Antworte auf Deutsch, klar und verständlich. Du kennst "
        "den Lernstand und (falls vorhanden) das Quellmaterial — nutze es gezielt."
    )

    topics = sorted({q.topic.strip() for q in quiz.questions if q.topic.strip()})
    suggestions = [("🎯 Schwächen erklären",
                    "Erkläre mir die Themen, bei denen ich am schwächsten bin. Fang mit dem Wichtigsten an.")]
    for tp in topics[:2]:
        suggestions.append((f"📚 {tp}", f"Erkläre mir das Thema '{tp}' ausführlich. Ich habe damit Probleme."))
    if material:
        suggestions.append(("📝 Zusammenfassung",
                            "Fasse das Quellmaterial zusammen — was sind die wichtigsten Konzepte?"))
        suggestions.append(("🔍 Was fehlt im Quiz?",
                            "Welche wichtigen Themen aus dem Quellmaterial werden im Quiz NICHT abgefragt?"))
    suggestions.append(("❓ Mich abfragen",
                        "Stelle mir 3 Verständnisfragen zu den wichtigsten Konzepten. Warte auf meine Antwort, bevor du die nächste stellst."))
    suggestions.append(("🗂️ Karteikarten",
                        "Erstelle mir eine kurze Übersicht der wichtigsten Definitionen und Formeln."))

    _ai_chat_panel(self, scroll, 3, system_prompt, context, suggestions)


def show_socratic(self, quiz: Quiz = None):
    """Sokratischer Modus: tutor that only asks guiding counter-questions."""
    self._clear_main()
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    header = ctk.CTkFrame(scroll, fg_color="transparent")
    header.grid(row=0, column=0, sticky="ew", pady=(0, 8))
    header.grid_columnconfigure(1, weight=1)
    back_cmd = (lambda: self.show_study(quiz)) if quiz else self.show_home
    ctk.CTkButton(header, text="← Zurück", width=80, height=32, corner_radius=RADIUS_MD,
                  fg_color=COLORS["card"], text_color=COLORS["text"],
                  hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                  border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=back_cmd).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(header, text="🏛️ Sokratischer Modus", font=("Segoe UI", 20, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=1, sticky="w")

    ctk.CTkLabel(scroll, text="Die KI gibt dir nie direkt die Antwort — sie stellt Gegenfragen, "
                 "bis du selbst draufkommst.", font=("Segoe UI", 12),
                 text_color=COLORS["text_light"], wraplength=620, justify="left"
                 ).grid(row=1, column=0, sticky="w", pady=(0, 8))

    material = self.store.get_material(quiz.id) if quiz else None
    context = _build_study_context(self, quiz, material) if quiz else "Kein spezifisches Quiz gewählt."
    system_prompt = (
        "Du bist ein sokratischer Lerntutor. Regeln:\n"
        "1. Gib NIEMALS direkt die Antwort auf eine Frage.\n"
        "2. Stelle stattdessen Gegenfragen, die den Lernenden Schritt für Schritt zur Antwort führen.\n"
        "3. Wenn er feststeckt, gib einen kleinen Hinweis — aber NICHT die Lösung.\n"
        "4. Wenn er die richtige Antwort findet, bestätige es und erkläre, WARUM es richtig ist.\n"
        "5. Nutze einfache Sprache (Deutsch). Sei geduldig und ermutigend.\n"
        "6. Passe dich dem Niveau an — bei vielen Fehlern fang einfacher an.\n"
        "Antworte IMMER auf Deutsch."
    )

    suggestions = []
    if quiz:
        topics = sorted({q.topic.strip() for q in quiz.questions if q.topic.strip()})
        suggestions.append(("🎯 Schwächen abfragen",
                            "Frag mich zu meinen schwachen Themen ab. Fang mit dem an, wo ich am meisten Probleme habe."))
        for tp in topics[:3]:
            suggestions.append((f"📚 {tp}",
                               f"Frag mich zum Thema '{tp}' ab. Beginne mit einer grundlegenden Verständnisfrage."))

    _ai_chat_panel(self, scroll, 2, system_prompt, context, suggestions)


def _link_material(self, quiz: Quiz):
    """Upload a PDF/text/doc and link it as study material for the quiz."""
    path = filedialog.askopenfilename(
        filetypes=[("Dokumente", "*.pdf *.txt *.md *.docx *.pptx"), ("Alle", "*.*")])
    if not path:
        return
    try:
        text = self.ai._read_file_as_text(path)
    except Exception as e:
        messagebox.showerror("Fehler", f"Datei konnte nicht gelesen werden:\n{e}")
        return
    if not text or len(text.strip()) < 50:
        messagebox.showwarning("Hinweis", "Die Datei enthält zu wenig Text zum Verknüpfen.")
        return
    self.store.save_material(quiz.id, {
        "text": text.strip(),
        "name": Path(path).name,
        "saved": datetime.now().isoformat(),
    })
    messagebox.showinfo("OK", "Quellmaterial verknüpft!")
    self.show_study(quiz)
