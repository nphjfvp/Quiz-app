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


def _detect_math_focus(text):
    import re
    math_syms = len(re.findall(r'[=∫∑∏√±≤≥≠∞∂αβγδθλμσπω∆Σ]', text))
    formula_like = len(re.findall(r'\b\d+[\s]*[+\-*/^]\s*\d+', text))
    math_words = len(re.findall(
        r'\b(Formel|Gleichung|Integral|Ableitung|Funktion|Matrix|Vektor|Sinus|Cosinus|'
        r'Tangens|Logarithmus|Polynom|Bruch|Wurzel|Quotient|Faktor|Koeffizient|Variable|'
        r'Ohm|Watt|Volt|Ampere|Newton|Joule|Kraft|Spannung|Strom|Widerstand|Impedanz|Frequenz)\b',
        text, re.IGNORECASE))
    return (math_syms + formula_like + math_words) > 5


def show_deep_learn(self):
    """Deep Learning mode: upload script → extract topics → pick one → deep Q&A."""
    import json as _json

    self._clear_main()
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    header = ctk.CTkFrame(scroll, fg_color="transparent")
    header.grid(row=0, column=0, sticky="ew", pady=(0, 8))
    header.grid_columnconfigure(1, weight=1)
    ctk.CTkButton(header, text="← Zurück", width=80, height=32, corner_radius=RADIUS_MD,
                  fg_color=COLORS["card"], text_color=COLORS["text"],
                  hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                  border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=self.show_home).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(header, text="🔬 Deep Learning", font=("Segoe UI", 20, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=1, sticky="w")

    ctk.CTkLabel(scroll, text="Lade ein Skript/Aufgabenblatt hoch. Die KI extrahiert Themen, "
                 "du wählst eines und kannst unbegrenzt tief nachfragen.",
                 font=("Segoe UI", 12), text_color=COLORS["text_light"],
                 wraplength=620, justify="left").grid(row=1, column=0, sticky="w", pady=(0, 12))

    upload_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_LG)
    upload_frame.grid(row=2, column=0, sticky="ew", pady=(0, 12))
    upload_frame.grid_columnconfigure(0, weight=1)

    status_lbl = ctk.CTkLabel(upload_frame, text="", font=("Segoe UI", 11),
                              text_color=COLORS["text_light"])
    status_lbl.grid(row=1, column=0, padx=16, pady=(0, 12))

    text_box = ctk.CTkTextbox(upload_frame, height=120, font=("Segoe UI", 12),
                              fg_color=COLORS["bg"], corner_radius=RADIUS_SM)
    text_box.grid(row=2, column=0, padx=16, pady=(0, 8), sticky="ew")
    text_box.insert("1.0", "…oder Text hier einfügen")

    file_text = {"val": ""}
    math_mode = {"val": None}  # None = auto, True = math, False = text

    mode_btn = ctk.CTkButton(upload_frame, text="🔬 Auto-Erkennung", height=30,
                             corner_radius=RADIUS_SM, fg_color=COLORS["card"],
                             text_color=COLORS["text"], hover_color=COLORS.get("card_hover", "#eef7f2"),
                             border_width=1, border_color=COLORS["border"],
                             font=("Segoe UI", 11))
    mode_btn.grid(row=3, column=0, padx=16, pady=(0, 4), sticky="w")
    modes_cycle = [(None, "🔬 Auto-Erkennung"), (True, "📐 Mathe/MINT-Fokus"), (False, "📖 Text/Theorie-Fokus")]
    mode_idx = {"val": 0}

    def toggle_mode():
        mode_idx["val"] = (mode_idx["val"] + 1) % len(modes_cycle)
        math_mode["val"] = modes_cycle[mode_idx["val"]][0]
        mode_btn.configure(text=modes_cycle[mode_idx["val"]][1])

    mode_btn.configure(command=toggle_mode)

    def pick_file():
        path = filedialog.askopenfilename(
            filetypes=[("Dokumente", "*.pdf *.txt *.md *.docx *.pptx"), ("Alle", "*.*")])
        if not path:
            return
        try:
            file_text["val"] = self.ai._read_file_as_text(path)
            status_lbl.configure(text=f"✅ {Path(path).name} geladen ({len(file_text['val'])} Zeichen)")
        except Exception as e:
            status_lbl.configure(text=f"❌ {e}")

    ctk.CTkButton(upload_frame, text="📂 Datei wählen", height=36, corner_radius=RADIUS_MD,
                  fg_color=COLORS["primary"], font=("Segoe UI", 13),
                  command=pick_file).grid(row=0, column=0, padx=16, pady=(16, 8), sticky="ew")

    def extract_topics():
        text = file_text["val"] or text_box.get("1.0", "end").strip()
        if not text or len(text) < 50:
            messagebox.showwarning("Hinweis", "Bitte einen längeren Text eingeben oder eine Datei wählen.")
            return

        is_math = math_mode["val"]
        if is_math is None:
            is_math = _detect_math_focus(text)

        status_lbl.configure(text="⏳ KI extrahiert Themen…")
        self.update_idletasks()

        if is_math:
            extract_detail = (
                "Extrahiere ALLE Themen, Konzepte und Rechenverfahren.\n"
                'Jedes Element: {"name":"<Themenname>","desc":"<1-Satz: welche Formeln/Verfahren>","difficulty":"basic|intermediate|advanced","formulas":["<LaTeX>"]}'
            )
        else:
            extract_detail = (
                "Extrahiere ALLE Themen, Konzepte und Theorien.\n"
                '{"name":"<Themenname>","desc":"<1-Satz-Zusammenfassung>","difficulty":"basic|intermediate|advanced"}'
            )

        prompt = (
            "Analysiere den folgenden Text (Vorlesung/Skript/Aufgabenblatt).\n"
            + extract_detail + "\n"
            "Gib sie als JSON-Array zurück, sortiert nach logischer Reihenfolge (Grundlagen zuerst).\n"
            "NUR das JSON-Array ausgeben.\n\nText:\n" + text[:15000]
        )

        def run():
            try:
                msgs = [{"role": "system", "content": "Du bist ein Experte für MINT-Fächer."},
                        {"role": "user", "content": prompt}]
                reply = self.ai._call_api(msgs, max_tokens=1500) or ""
                parsed = self.ai._parse_json_response(reply)
                if isinstance(parsed, dict) and "topics" in parsed:
                    topics = parsed["topics"]
                elif isinstance(parsed, list):
                    topics = parsed
                else:
                    import re
                    m = re.search(r'\[[\s\S]*\]', reply)
                    topics = _json.loads(m.group(0)) if m else []
                topics = [t for t in topics if isinstance(t, dict) and t.get("name")]
            except Exception as e:
                self.after(0, lambda: status_lbl.configure(text=f"❌ Fehler: {e}"))
                return

            def done():
                if not topics:
                    status_lbl.configure(text="Keine Themen gefunden. Versuche einen anderen Text.")
                    return
                _show_topic_picker(self, scroll, text, topics, is_math)
            self.after(0, done)

        threading.Thread(target=run, daemon=True).start()

    ctk.CTkButton(upload_frame, text="🚀 Themen extrahieren", height=40, corner_radius=RADIUS_MD,
                  fg_color=COLORS["success"], font=("Segoe UI", 14, "bold"),
                  command=extract_topics).grid(row=4, column=0, padx=16, pady=(8, 16), sticky="ew")


def _show_topic_picker(self, parent, source_text, topics, is_math=True):
    """Show extracted topics as clickable cards."""
    self._clear_main()
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    header = ctk.CTkFrame(scroll, fg_color="transparent")
    header.grid(row=0, column=0, sticky="ew", pady=(0, 8))
    header.grid_columnconfigure(1, weight=1)
    ctk.CTkButton(header, text="← Zurück", width=80, height=32, corner_radius=RADIUS_MD,
                  fg_color=COLORS["card"], text_color=COLORS["text"],
                  hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                  border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=lambda: self.show_deep_learn()).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(header, text=f"🔬 {len(topics)} Themen gefunden",
                 font=("Segoe UI", 18, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=1, sticky="w")

    diff_colors = {"basic": COLORS["success"], "intermediate": COLORS["warning"],
                   "advanced": COLORS["danger"]}
    diff_labels = {"basic": "Grundlagen", "intermediate": "Mittel", "advanced": "Fortgeschritten"}

    for i, t in enumerate(topics):
        color = diff_colors.get(t.get("difficulty"), COLORS["primary"])
        frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_MD,
                             border_width=1, border_color=COLORS["border"])
        frame.grid(row=i + 1, column=0, sticky="ew", pady=4)
        frame.grid_columnconfigure(1, weight=1)

        accent = ctk.CTkFrame(frame, width=6, fg_color=color, corner_radius=3)
        accent.grid(row=0, column=0, rowspan=2, sticky="ns", padx=(0, 8))

        ctk.CTkLabel(frame, text=_plain(t["name"]), font=("Segoe UI", 14, "bold"),
                     text_color=COLORS["text"]).grid(row=0, column=1, sticky="w", padx=8, pady=(8, 0))

        desc = t.get("desc", "")
        dl = diff_labels.get(t.get("difficulty"), "")
        formulas = ", ".join(t.get("formulas", []))
        sub = f"{desc} · {dl}" + (f"\n{_plain(formulas)}" if formulas else "")
        ctk.CTkLabel(frame, text=sub, font=("Segoe UI", 11),
                     text_color=COLORS["text_light"], wraplength=580,
                     justify="left").grid(row=1, column=1, sticky="w", padx=8, pady=(0, 8))

        ctk.CTkButton(frame, text="›", width=32, height=32, corner_radius=RADIUS_SM,
                      fg_color="transparent", text_color=COLORS["text_light"],
                      hover_color=COLORS.get("card_hover", "#eef7f2"),
                      font=("Segoe UI", 16),
                      command=lambda tp=t: _start_deep_chat(self, source_text, tp, is_math)
                      ).grid(row=0, column=2, rowspan=2, padx=8)


def _start_deep_chat(self, source_text, topic, is_math=True):
    """Open the deep-learning chat for a specific topic."""
    self._clear_main()
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    header = ctk.CTkFrame(scroll, fg_color="transparent")
    header.grid(row=0, column=0, sticky="ew", pady=(0, 8))
    header.grid_columnconfigure(1, weight=1)
    ctk.CTkButton(header, text="← Zurück", width=80, height=32, corner_radius=RADIUS_MD,
                  fg_color=COLORS["card"], text_color=COLORS["text"],
                  hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                  border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=lambda: self.show_deep_learn()).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(header, text=f"🔬 {_plain(topic['name'])}", font=("Segoe UI", 18, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=1, sticky="w")

    ctk.CTkLabel(scroll, text="Frag warum, wie, was — so oft du willst. Die KI erklärt immer tiefer.",
                 font=("Segoe UI", 12), text_color=COLORS["text_light"],
                 wraplength=620, justify="left").grid(row=1, column=0, sticky="w", pady=(0, 4))

    relevant = source_text[:12000]
    name = topic["name"]

    if is_math:
        system_prompt = (
            f'Du bist ein Experten-Tutor für Mathematik, Physik und Ingenieurwissenschaften. '
            f'Der Lernende möchte das Thema "{name}" wirklich TIEF verstehen.\n\n'
            "Deine Regeln:\n"
            "1. Erkläre anhand der konkreten Aufgaben/Beispiele aus dem Material.\n"
            "2. Beginne mit dem Grundprinzip: welche Formel, welcher Satz, welches Gesetz steckt dahinter?\n"
            "3. Schreibe Formeln in LaTeX ($..$ oder $$..$$).\n"
            "4. Bei 'warum': erkläre die Herleitung.\n"
            "5. Bei 'wie': zeige den Rechenweg Schritt für Schritt mit konkreten Zahlen.\n"
            "6. Bei 'was': erkläre die Bedeutung jeder Variablen.\n"
            "7. Nutze Analogien und Alltagsbeispiele.\n"
            "8. Zeige typische Fallen und Vorzeichenfehler.\n"
            "9. Am Ende: stelle eine Verständnisfrage oder schlage eine Vertiefung vor.\n"
            "10. Antworte IMMER auf Deutsch.\n\n"
            f"Quellmaterial:\n{relevant}"
        )
        suggestions = [
            ("💡 Grundprinzip", f"Erkläre mir das Grundprinzip von '{name}' — welche Formel/welches Gesetz steckt dahinter und woher kommt es?"),
            ("📝 Rechenbeispiel", f"Zeig mir Schritt für Schritt mit konkreten Zahlen, wie man eine typische Aufgabe zu '{name}' löst."),
            ("🔬 Herleitung", "Woher kommt die Formel? Leite sie mir her und erkläre jeden Schritt der Herleitung."),
            ("⚠️ Typische Fehler", f"Welche typischen Rechen- und Vorzeichenfehler macht man bei '{name}' und wie vermeidet man sie?"),
        ]
    else:
        system_prompt = (
            f'Du bist ein Experten-Tutor. Der Lernende möchte das Thema "{name}" wirklich TIEF verstehen.\n\n'
            "Deine Regeln:\n"
            "1. Erkläre anhand der konkreten Inhalte aus dem Material.\n"
            "2. Beginne mit dem Kernkonzept: was ist die zentrale Idee?\n"
            "3. Bei 'warum': erkläre Hintergründe, Ursachen, Zusammenhänge.\n"
            "4. Bei 'wie': zeige den Ablauf/Prozess Schritt für Schritt.\n"
            "5. Bei 'was': definiere und erkläre die Begriffe genau.\n"
            "6. Nutze Analogien und Alltagsbeispiele.\n"
            "7. Zeige Zusammenhänge zu anderen Themen auf.\n"
            "8. Am Ende: stelle eine Verständnisfrage oder schlage eine Vertiefung vor.\n"
            "9. Antworte IMMER auf Deutsch.\n\n"
            f"Quellmaterial:\n{relevant}"
        )
        suggestions = [
            ("💡 Kernidee", f"Erkläre mir die Kernidee von '{name}' — was ist das Wichtigste?"),
            ("📝 Beispiel", f"Gib mir ein konkretes Beispiel aus dem Material, das '{name}' veranschaulicht."),
            ("🔗 Zusammenhänge", f"Wie hängt '{name}' mit den anderen Themen zusammen?"),
            ("⚠️ Missverständnisse", f"Was sind die häufigsten Missverständnisse bei '{name}'?"),
        ]

    context = ""

    _ai_chat_panel(self, scroll, 2, system_prompt, context, suggestions)
