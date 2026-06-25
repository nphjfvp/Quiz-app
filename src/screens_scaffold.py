"""Scaffolding-Modus: 4-stage math/formula practice for the desktop app.

Stages (with real tasks from uploaded PDFs):
1. Geführte Formel  – full formula + values shown, user clicks variables to enter values + result
2. Struktur-Vorlage – formula with □ placeholders, user fills variables then solves
3. Formel-Recall    – user names the formula, then proceeds like stage 2
4. Lineare Eingabe  – user types the whole solution in linear notation

Mixed into the App class via binding in app.py.
"""

import json
import math
import threading
import random
import re
from tkinter import StringVar, messagebox
import customtkinter as ctk

from .models import Formula, FormulaSheet
from .theme import COLORS, RADIUS_SM, RADIUS_MD, RADIUS_LG, color_alpha
from .latex_render import render_formula, can_render as can_render_latex, has_latex

EPSILON = 0.02
STAGE_NAMES = {
    1: "Geführte Formel",
    2: "Struktur-Vorlage",
    3: "Formel-Recall",
    4: "Lineare Eingabe",
}
STAGE_ICONS = {1: "📝", 2: "🧩", 3: "🧠", 4: "✍️"}
STAGE_DESCS = {
    1: "Formel + Werte angezeigt. Klicke auf jede Variable, gib den Wert ein und berechne das Ergebnis.",
    2: "Formel mit □-Platzhaltern. Fülle erst die Formel aus, dann löse wie bei Stufe 1.",
    3: "Welche Formel wird benötigt? Benenne sie, dann weiter wie Stufe 2.",
    4: "Tippe die gesamte Lösung in linearer Schreibweise (z.B. x12=(-3+-wrzl(9+112))/8).",
}


def _render_latex_image(self, latex_str, parent, row, col=0, colspan=1):
    dark = COLORS.get("bg", "#f5fbf6") != "#f5fbf6"
    tc = COLORS.get("text", "#1a1a2e")
    img = render_formula(latex_str, fontsize=18, text_color=tc,
                         bg_color=COLORS.get("bg", "#ffffff"))
    if img:
        from PIL import ImageTk
        photo = ImageTk.PhotoImage(img)
        lbl = ctk.CTkLabel(parent, text="", image=photo)
        lbl.image = photo
        lbl.grid(row=row, column=col, columnspan=colspan, sticky="w", padx=14, pady=6)
        return lbl
    else:
        lbl = ctk.CTkLabel(parent, text=f"${latex_str}$", font=("Segoe UI", 14),
                           text_color=COLORS["text"], wraplength=550)
        lbl.grid(row=row, column=col, columnspan=colspan, sticky="w", padx=14, pady=6)
        return lbl


def _validate_numeric(value_str, correct, epsilon=EPSILON):
    try:
        user_val = float(str(value_str).replace(",", ".").strip())
        if isinstance(correct, (list, tuple)):
            return any(math.isclose(round(user_val, 2), round(float(c), 2), abs_tol=epsilon) for c in correct)
        correct_val = round(float(correct), 2)
        return math.isclose(round(user_val, 2), correct_val, abs_tol=epsilon)
    except (ValueError, TypeError):
        return False


def _safe_eval(expression, var_values):
    allowed = {
        "abs": abs, "round": round, "sqrt": math.sqrt, "pow": pow,
        "log": math.log, "log10": math.log10, "exp": math.exp,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "pi": math.pi, "e": math.e,
    }
    allowed.update(var_values)
    try:
        return round(eval(expression, {"__builtins__": {}}, allowed), 2)
    except Exception:
        return None


def _generate_task_local(formula):
    values = {}
    for v in formula.variables:
        values[v.symbol] = round(random.uniform(1, 100), 2)
    result = _safe_eval(formula.expression, values)
    if result is None:
        return None
    return {
        "task_text": f"Berechne {formula.result_symbol} mit den gegebenen Werten.",
        "variable_values": values,
        "result_value": round(result, 2),
        "hint": formula.description or "Setze die Werte in die Formel ein.",
    }


# ── Main Screen ─────────────────────────────────────────────────────────
def show_scaffold(self):
    self._clear_main()
    self.header_subtitle.configure(text="🔢 Formel-Training")
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    top = ctk.CTkFrame(scroll, fg_color="transparent")
    top.grid(row=0, column=0, sticky="ew", pady=(0, 12))
    top.grid_columnconfigure(1, weight=1)
    ctk.CTkButton(top, text="← Zurück", width=80, height=32, corner_radius=RADIUS_MD,
                  fg_color=COLORS["card"], text_color=COLORS["text"],
                  hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                  border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=self.show_home).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(top, text="🔢 Formel-Training (Scaffolding)",
                 font=("Segoe UI", 20, "bold"), text_color=COLORS["text"]
                 ).grid(row=0, column=1, sticky="w")

    # ── Option 1: Upload math PDF ──
    upload_card = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                               border_width=2, border_color=COLORS["primary"], cursor="hand2")
    upload_card.grid(row=1, column=0, sticky="ew", pady=(0, 16))
    upload_card.grid_columnconfigure(0, weight=1)
    ctk.CTkLabel(upload_card, text="📄 Mathe-Aufgaben importieren",
                 font=("Segoe UI", 16, "bold"), text_color=COLORS["text"]
                 ).grid(row=0, column=0, sticky="w", padx=16, pady=(14, 4))
    ctk.CTkLabel(upload_card, text="Lade ein Mathe-PDF hoch → KI extrahiert & löst alle Aufgaben → Übe mit 4 Stufen",
                 font=("Segoe UI", 12), text_color=COLORS["text_light"], wraplength=550
                 ).grid(row=1, column=0, sticky="w", padx=16, pady=(0, 14))
    upload_card.bind("<Button-1>", lambda e: show_math_import(self))

    # ── Option 2: Practice with formula sheet ──
    sheets = self.formula_sheets
    if sheets:
        ctk.CTkLabel(scroll, text="📋 Oder übe mit einer Formelsammlung:",
                     font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                     ).grid(row=2, column=0, sticky="w", pady=(8, 8))

        sheet_names = [s.name for s in sheets]
        sheet_var = StringVar(value=sheet_names[0])
        ctk.CTkOptionMenu(scroll, values=sheet_names, variable=sheet_var, width=400
                          ).grid(row=3, column=0, sticky="w", pady=(0, 16))

        stage_grid = ctk.CTkFrame(scroll, fg_color="transparent")
        stage_grid.grid(row=4, column=0, sticky="ew")
        stage_grid.grid_columnconfigure(0, weight=1)
        stage_grid.grid_columnconfigure(1, weight=1)

        stage_colors = {
            1: COLORS["success"], 2: COLORS["warning"],
            3: COLORS["danger"], 4: COLORS["info"],
        }
        for stage in range(1, 5):
            col = (stage - 1) % 2
            row = (stage - 1) // 2
            card = ctk.CTkFrame(stage_grid, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                                border_width=2, border_color=COLORS["border"], cursor="hand2")
            card.grid(row=row, column=col, padx=8, pady=8, sticky="nsew")
            card.grid_columnconfigure(0, weight=1)
            accent = ctk.CTkFrame(card, fg_color=stage_colors[stage], corner_radius=4, height=4)
            accent.grid(row=0, column=0, sticky="ew", padx=16, pady=(14, 0))
            ctk.CTkLabel(card, text=STAGE_ICONS[stage], font=("Segoe UI", 32)
                         ).grid(row=1, column=0, padx=15, pady=(10, 4))
            lbl = ctk.CTkLabel(card, text=f"Stufe {stage}: {STAGE_NAMES[stage]}",
                               font=("Segoe UI", 14, "bold"), text_color=COLORS["text"])
            lbl.grid(row=2, column=0, padx=15, pady=(2, 2))
            dl = ctk.CTkLabel(card, text=STAGE_DESCS[stage], font=("Segoe UI", 11),
                              text_color=COLORS["text_light"], wraplength=240)
            dl.grid(row=3, column=0, padx=15, pady=(0, 14))

            def start(s=stage):
                idx = sheet_names.index(sheet_var.get()) if sheet_var.get() in sheet_names else 0
                sheet = sheets[idx]
                if not sheet.formulas:
                    messagebox.showinfo("Hinweis", "Diese Formelsammlung hat keine Formeln.")
                    return
                _run_scaffold_formulas(self, sheet, s)

            for w in [card, lbl, dl]:
                w.bind("<Button-1>", lambda e, s=stage: start(s))

    # ── Saved math task sets ──
    saved = self.store.load_json("math_tasks") or []
    if saved:
        ctk.CTkLabel(scroll, text="📦 Gespeicherte Mathe-Aufgaben:",
                     font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                     ).grid(row=5, column=0, sticky="w", pady=(16, 8))
        for i, ts in enumerate(saved):
            tf = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_MD,
                              border_width=1, border_color=COLORS["border"], cursor="hand2")
            tf.grid(row=6 + i, column=0, sticky="ew", pady=3)
            tf.grid_columnconfigure(1, weight=1)
            ctk.CTkLabel(tf, text="📐", font=("Segoe UI", 20)).grid(row=0, column=0, padx=12, pady=10)
            ctk.CTkLabel(tf, text=ts.get("name", "Mathe-Set"),
                         font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                         ).grid(row=0, column=1, sticky="w")
            ctk.CTkLabel(tf, text=f"{len(ts.get('tasks', []))} Aufgaben",
                         font=("Segoe UI", 11), text_color=COLORS["text_light"]
                         ).grid(row=1, column=1, sticky="w")
            tf.bind("<Button-1>", lambda e, t=ts: _show_task_set_stages(self, t))


# ── Math Import Screen ──────────────────────────────────────────────────
def show_math_import(self):
    self._clear_main()
    self.header_subtitle.configure(text="📄 Mathe-Import")
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    ctk.CTkButton(scroll, text="← Zurück", width=80, height=32, corner_radius=RADIUS_MD,
                  fg_color=COLORS["card"], text_color=COLORS["text"],
                  hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                  border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=self.show_scaffold).grid(row=0, column=0, sticky="w", pady=(0, 12))

    ctk.CTkLabel(scroll, text="📄 Mathe-Aufgaben importieren & lösen",
                 font=("Segoe UI", 18, "bold"), text_color=COLORS["text"]
                 ).grid(row=1, column=0, sticky="w", pady=(0, 4))
    ctk.CTkLabel(scroll, text="Lade ein PDF/Dokument mit Mathe-Aufgaben hoch. Die KI extrahiert jede Teilaufgabe einzeln, löst sie Schritt für Schritt und erstellt eine Formelsammlung.",
                 font=("Segoe UI", 12), text_color=COLORS["text_light"], wraplength=600
                 ).grid(row=2, column=0, sticky="w", pady=(0, 16))

    # File picker
    file_var = StringVar()
    file_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    file_frame.grid(row=3, column=0, sticky="ew")
    file_entry = ctk.CTkEntry(file_frame, textvariable=file_var, width=420,
                              placeholder_text="PDF/Dokument auswählen…")
    file_entry.grid(row=0, column=0, padx=(0, 10))

    def browse():
        path = self._file_dialog_with_pdf()
        if path:
            file_var.set(path)
    ctk.CTkButton(file_frame, text="Durchsuchen", width=100, command=browse
                  ).grid(row=0, column=1)

    # User instructions (prompt)
    ctk.CTkLabel(scroll, text="Anweisungen (optional):",
                 font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                 ).grid(row=4, column=0, sticky="w", pady=(16, 4))
    ctk.CTkLabel(scroll, text="z.B. \"Nutze ABC-Formel statt PQ\" oder \"Löse mit Substitution\"",
                 font=("Segoe UI", 11), text_color=COLORS["text_light"]
                 ).grid(row=5, column=0, sticky="w", pady=(0, 4))
    prompt_entry = ctk.CTkEntry(scroll, width=550, height=40,
                                placeholder_text="Anweisungen für die KI…")
    prompt_entry.grid(row=6, column=0, sticky="w", pady=(0, 16))

    # Name
    ctk.CTkLabel(scroll, text="Name für das Aufgaben-Set:",
                 font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                 ).grid(row=7, column=0, sticky="w", pady=(0, 4))
    name_entry = ctk.CTkEntry(scroll, width=400, placeholder_text="z.B. Analysis Übungsblatt 3")
    name_entry.grid(row=8, column=0, sticky="w", pady=(0, 16))

    # Progress
    progress_lbl = ctk.CTkLabel(scroll, text="", font=("Segoe UI", 12),
                                text_color=COLORS["primary"])
    progress_lbl.grid(row=9, column=0, sticky="w")
    progress_bar = ctk.CTkProgressBar(scroll, width=500)
    progress_bar.grid(row=10, column=0, sticky="w", pady=(4, 8))
    progress_bar.set(0)

    def do_import():
        path = file_var.get().strip()
        if not path:
            messagebox.showwarning("Hinweis", "Bitte eine Datei auswählen!")
            return
        if not self.ai.api_key:
            messagebox.showwarning("Hinweis", "Bitte zuerst API-Key in den Einstellungen speichern!")
            return

        instructions = prompt_entry.get().strip()
        set_name = name_entry.get().strip() or "Mathe-Aufgaben"

        def run():
            # Phase 1: Extract tasks
            def prog1(cur, tot, phase=""):
                self.after(0, lambda c=cur, t=tot, p=phase: (
                    progress_lbl.configure(text=f"Phase 1: {p} ({c}/{t})"),
                    progress_bar.set(c / (tot * 3))
                ))

            try:
                tasks = self.ai.extract_math_tasks(path, progress_callback=prog1,
                                                    user_instructions=instructions)
            except Exception as exc:
                self.after(0, lambda: progress_lbl.configure(
                    text=f"Fehler beim Extrahieren: {exc}"))
                return

            if not tasks:
                self.after(0, lambda: progress_lbl.configure(text="Keine Aufgaben gefunden."))
                return

            # Phase 2: Solve each task
            total_tasks = len(tasks)

            def prog2(cur, tot, phase=""):
                self.after(0, lambda c=cur, t=tot, p=phase: (
                    progress_lbl.configure(text=f"Phase 2: {p} ({c}/{t})"),
                    progress_bar.set(0.33 + c / (t * 3))
                ))

            try:
                solved = self.ai.solve_math_tasks(tasks, progress_callback=prog2,
                                                   user_instructions=instructions)
            except Exception as exc:
                self.after(0, lambda: progress_lbl.configure(
                    text=f"Fehler beim Lösen: {exc}"))
                return

            self.after(0, lambda: (
                progress_lbl.configure(text=f"✅ {len(solved)} Aufgaben extrahiert und gelöst!"),
                progress_bar.set(1.0)
            ))

            # Save task set
            task_set = {
                "name": set_name,
                "instructions": instructions,
                "tasks": solved,
            }
            saved_sets = self.store.load_json("math_tasks") or []
            saved_sets.append(task_set)
            self.store.save_json("math_tasks", saved_sets)

            self.after(500, lambda ts=task_set: _show_task_set_stages(self, ts))

        threading.Thread(target=run, daemon=True).start()

    btn_f = ctk.CTkFrame(scroll, fg_color="transparent")
    btn_f.grid(row=11, column=0, sticky="w", pady=12)
    ctk.CTkButton(btn_f, text="🚀 Importieren & Lösen", fg_color=COLORS["success"],
                  height=40, font=("Segoe UI", 14, "bold"), command=do_import
                  ).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkButton(btn_f, text="Abbrechen", fg_color=COLORS["text_light"],
                  command=self.show_scaffold).grid(row=0, column=1)


# ── Task Set Stage Picker ───────────────────────────────────────────────
def _show_task_set_stages(self, task_set):
    self._clear_main()
    self.header_subtitle.configure(text=f"📐 {task_set.get('name', 'Mathe')}")
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    ctk.CTkButton(scroll, text="← Zurück", width=80, height=32, corner_radius=RADIUS_MD,
                  fg_color=COLORS["card"], text_color=COLORS["text"],
                  hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                  border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=self.show_scaffold).grid(row=0, column=0, sticky="w", pady=(0, 12))

    tasks = task_set.get("tasks", [])
    ctk.CTkLabel(scroll, text=f"📐 {task_set.get('name', 'Mathe-Aufgaben')}",
                 font=("Segoe UI", 18, "bold"), text_color=COLORS["text"]
                 ).grid(row=1, column=0, sticky="w", pady=(0, 4))
    ctk.CTkLabel(scroll, text=f"{len(tasks)} Aufgaben · Wähle eine Schwierigkeitsstufe:",
                 font=("Segoe UI", 12), text_color=COLORS["text_light"]
                 ).grid(row=2, column=0, sticky="w", pady=(0, 16))

    stage_colors = {
        1: COLORS["success"], 2: COLORS["warning"],
        3: COLORS["danger"], 4: COLORS["info"],
    }
    stage_grid = ctk.CTkFrame(scroll, fg_color="transparent")
    stage_grid.grid(row=3, column=0, sticky="ew")
    stage_grid.grid_columnconfigure(0, weight=1)
    stage_grid.grid_columnconfigure(1, weight=1)

    for stage in range(1, 5):
        col = (stage - 1) % 2
        row = (stage - 1) // 2
        card = ctk.CTkFrame(stage_grid, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                            border_width=2, border_color=COLORS["border"], cursor="hand2")
        card.grid(row=row, column=col, padx=8, pady=8, sticky="nsew")
        card.grid_columnconfigure(0, weight=1)
        accent = ctk.CTkFrame(card, fg_color=stage_colors[stage], corner_radius=4, height=4)
        accent.grid(row=0, column=0, sticky="ew", padx=16, pady=(14, 0))
        ctk.CTkLabel(card, text=STAGE_ICONS[stage], font=("Segoe UI", 32)
                     ).grid(row=1, column=0, padx=15, pady=(10, 4))
        lbl = ctk.CTkLabel(card, text=f"Stufe {stage}: {STAGE_NAMES[stage]}",
                           font=("Segoe UI", 14, "bold"), text_color=COLORS["text"])
        lbl.grid(row=2, column=0, padx=15, pady=(2, 2))
        dl = ctk.CTkLabel(card, text=STAGE_DESCS[stage], font=("Segoe UI", 11),
                          text_color=COLORS["text_light"], wraplength=240)
        dl.grid(row=3, column=0, padx=15, pady=(0, 14))

        def start(s=stage):
            _run_scaffold_tasks(self, tasks, s, task_set)
        for w in [card, lbl, dl]:
            w.bind("<Button-1>", lambda e, s=stage: start(s))

    # Task list preview
    ctk.CTkLabel(scroll, text="Aufgaben-Übersicht:", font=("Segoe UI", 14, "bold"),
                 text_color=COLORS["text"]).grid(row=4, column=0, sticky="w", pady=(16, 8))
    for i, t in enumerate(tasks[:20]):
        tf = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_SM,
                          border_width=1, border_color=COLORS["border"])
        tf.grid(row=5 + i, column=0, sticky="ew", pady=2)
        tf.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(tf, text=f"{i+1}.", width=30, font=("Segoe UI", 12, "bold"),
                     text_color=COLORS["text"]).grid(row=0, column=0, padx=8, pady=6)
        task_text = t.get("text", "")[:80]
        formula_name = t.get("formula_name", "")
        sub = f" · {formula_name}" if formula_name else ""
        ctk.CTkLabel(tf, text=f"{task_text}{sub}",
                     font=("Segoe UI", 12), text_color=COLORS["text"], wraplength=500
                     ).grid(row=0, column=1, sticky="w", padx=4, pady=6)


# ── Run Scaffold with Real Tasks ────────────────────────────────────────
def _run_scaffold_tasks(self, tasks, stage, task_set=None):
    self._clear_main()
    self.header_subtitle.configure(text=f"{STAGE_ICONS[stage]} Stufe {stage}: {STAGE_NAMES[stage]}")
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    task_list = list(tasks)
    random.shuffle(task_list)
    state = {"idx": 0, "correct": 0, "total": 0, "tasks": task_list, "stage": stage}

    content = ctk.CTkFrame(scroll, fg_color="transparent")
    content.grid(row=0, column=0, sticky="ew")
    content.grid_columnconfigure(0, weight=1)

    def show_task(idx):
        for w in content.winfo_children():
            w.destroy()

        if idx >= len(task_list):
            _show_end(self, content, state, task_set)
            return

        task = task_list[idx]

        # Progress
        prog = ctk.CTkFrame(content, fg_color="transparent")
        prog.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        prog.grid_columnconfigure(1, weight=1)
        ctk.CTkButton(prog, text="← Beenden", width=80, height=32, corner_radius=RADIUS_MD,
                      fg_color=COLORS["card"], text_color=COLORS["text"],
                      hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                      border_color=COLORS["border"], font=("Segoe UI", 12),
                      command=lambda: _show_task_set_stages(self, task_set) if task_set else self.show_scaffold()
                      ).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkLabel(prog, text=f"Aufgabe {idx+1}/{len(task_list)} · {STAGE_ICONS[stage]} Stufe {stage}",
                     font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                     ).grid(row=0, column=1, sticky="w")
        pbar = ctk.CTkProgressBar(prog, height=6, progress_color=COLORS["primary"])
        pbar.set(idx / len(task_list))
        pbar.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(6, 0))

        # Task text
        ctk.CTkLabel(content, text=task.get("text", task.get("source", "")),
                     font=("Segoe UI", 14), text_color=COLORS["text"],
                     wraplength=600, justify="left"
                     ).grid(row=1, column=0, sticky="w", padx=14, pady=(12, 8))

        if stage == 1:
            _stage1_guided(self, content, task, state, show_task)
        elif stage == 2:
            _stage2_structure(self, content, task, state, show_task)
        elif stage == 3:
            _stage3_recall(self, content, task, state, show_task)
        elif stage == 4:
            _stage4_linear(self, content, task, state, show_task)

    show_task(0)


# ── Stage 1: Geführte Formel (mit Rechenketten) ───────────────────────
def _stage1_guided(self, parent, task, state, next_fn):
    chain = task.get("calc_chain", [])
    if not chain:
        chain = [_task_as_single_step(task)]

    chain_state = {"step_idx": 0, "computed": {}, "all_ok": True}

    chain_frame = ctk.CTkFrame(parent, fg_color="transparent")
    chain_frame.grid(row=2, column=0, sticky="ew")
    chain_frame.grid_columnconfigure(0, weight=1)

    def show_chain_step(si):
        for w in chain_frame.winfo_children():
            w.destroy()

        if si >= len(chain):
            state["total"] += 1
            if chain_state["all_ok"]:
                state["correct"] += 1
            final = task.get("final_result_text", chain[-1].get("result_text", ""))
            lbl_text = f"✅ Alle Schritte richtig! → {final}" if chain_state["all_ok"] else f"Endergebnis: {final}"
            lbl_color = COLORS["success"] if chain_state["all_ok"] else COLORS["text"]
            ctk.CTkLabel(chain_frame, text=lbl_text, font=("Segoe UI", 14, "bold"),
                         text_color=lbl_color, wraplength=600
                         ).grid(row=0, column=0, sticky="w", padx=14, pady=12)
            state["idx"] += 1
            self.after(2000, lambda: next_fn(state["idx"]))
            return

        step = chain[si]
        total_steps = len(chain)

        card = ctk.CTkFrame(chain_frame, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                            border_width=1, border_color=COLORS["border"])
        card.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        card.grid_columnconfigure(0, weight=1)

        # Step header
        step_label = f"Rechenschritt {si+1}/{total_steps}" if total_steps > 1 else "Rechnung"
        desc = step.get("description", "")
        fname = step.get("formula_name", "")
        header = f"📝 {step_label}: {desc}" + (f" ({fname})" if fname else "")
        ctk.CTkLabel(card, text=header, font=("Segoe UI", 13, "bold"),
                     text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 4))

        # Show formula
        flatex = step.get("formula_latex", "")
        if flatex and can_render_latex():
            _render_latex_image(self, flatex, card, row=1)
        elif flatex:
            ctk.CTkLabel(card, text=flatex, font=("Consolas", 14),
                         text_color=COLORS["text"]).grid(row=1, column=0, sticky="w", padx=14, pady=4)

        # Show carried-forward values
        inputs = step.get("inputs", [])
        r = 2
        if inputs:
            ctk.CTkLabel(card, text="Setze die Werte ein:",
                         font=("Segoe UI", 12, "bold"), text_color=COLORS["text"]
                         ).grid(row=r, column=0, sticky="w", padx=14, pady=(8, 4))
            r += 1

            var_frame = ctk.CTkFrame(card, fg_color="transparent")
            var_frame.grid(row=r, column=0, sticky="ew", padx=14, pady=(0, 8))
            var_frame.grid_columnconfigure(1, weight=1)

            entries = {}
            for i, inp in enumerate(inputs):
                sym = inp.get("symbol", f"x{i}")
                name = inp.get("name", sym)
                unit = inp.get("unit", "")
                from_step = inp.get("from_step")
                unit_str = f" [{unit}]" if unit else ""

                # Value either from previous step or given
                if from_step and sym in chain_state["computed"]:
                    expected = chain_state["computed"][sym]
                    source_hint = f" (aus Schritt {from_step})"
                else:
                    expected = inp.get("value")
                    source_hint = ""

                ctk.CTkLabel(var_frame, text=f"{sym}{unit_str}{source_hint} =",
                             font=("Segoe UI", 13), text_color=COLORS["text"]
                             ).grid(row=i, column=0, sticky="w", padx=(0, 8), pady=4)
                e = ctk.CTkEntry(var_frame, height=36, font=("Segoe UI", 13),
                                 placeholder_text=f"Wert für {sym}")
                e.grid(row=i, column=1, sticky="ew", pady=4)
                entries[sym] = (e, expected)
            r += 1
        else:
            entries = {}

        # Result input
        res_sym = step.get("result_symbol", "?")
        res_unit = step.get("result_unit", "")
        res_label = f"{res_sym}" + (f" [{res_unit}]" if res_unit else "")
        ctk.CTkLabel(card, text=f"Ergebnis: {res_label} =",
                     font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                     ).grid(row=r, column=0, sticky="w", padx=14, pady=(8, 4))
        r += 1

        result_entry = ctk.CTkEntry(card, height=42, font=("Segoe UI", 15),
                                    placeholder_text=f"{res_sym} = ?")
        result_entry.grid(row=r, column=0, sticky="ew", padx=14, pady=(0, 8))
        result_entry.focus_set()
        r += 1

        feedback_lbl = ctk.CTkLabel(card, text="", font=("Segoe UI", 13))
        feedback_lbl.grid(row=r, column=0, sticky="w", padx=14, pady=(0, 4))
        r += 1

        def check_step():
            step_ok = True
            for sym, (e, expected) in entries.items():
                val = e.get().strip()
                if expected is not None and not _validate_numeric(val, expected):
                    e.configure(border_color=COLORS["danger"])
                    step_ok = False
                else:
                    e.configure(border_color=COLORS["success"])

            res_nums = step.get("result_numeric", [])
            res_text = step.get("result_text", "")
            val = result_entry.get().strip()

            result_ok = False
            if res_nums:
                result_ok = _validate_numeric(val, res_nums)
            elif res_text:
                try:
                    result_ok = _validate_numeric(val, float(res_text.replace(",", ".")))
                except (ValueError, TypeError):
                    result_ok = val.lower().strip() == res_text.lower().strip()

            result_entry.configure(border_color=COLORS["success"] if result_ok else COLORS["danger"])
            if not result_ok:
                step_ok = False

            if step_ok:
                feedback_lbl.configure(text=f"✅ Richtig! {res_text}",
                                       text_color=COLORS["success"])
                # Store result for next steps
                if res_nums:
                    chain_state["computed"][res_sym] = res_nums[0]
                next_label = "Weiter →" if si + 1 < len(chain) else "Fertig!"
            else:
                chain_state["all_ok"] = False
                feedback_lbl.configure(text=f"❌ Lösung: {res_text}",
                                       text_color=COLORS["danger"])
                if res_nums:
                    chain_state["computed"][res_sym] = res_nums[0]

            chain_state["step_idx"] = si + 1
            self.after(1800, lambda: show_chain_step(si + 1))

        btn_frame = ctk.CTkFrame(card, fg_color="transparent")
        btn_frame.grid(row=r, column=0, sticky="ew", padx=14, pady=(0, 14))
        ctk.CTkButton(btn_frame, text="✓ Prüfen", fg_color=COLORS["primary"], height=40,
                      font=("Segoe UI", 14, "bold"), command=check_step
                      ).grid(row=0, column=0, padx=(0, 8))

        result_entry.bind("<Return>", lambda e: check_step())

    show_chain_step(0)


def _task_as_single_step(task):
    """Convert a legacy single-formula task into a one-element calc_chain step."""
    return {
        "step_nr": 1,
        "formula_name": task.get("formula_name", ""),
        "formula_latex": task.get("formula_latex", ""),
        "formula_template": task.get("formula_template", ""),
        "description": task.get("text", "")[:80],
        "inputs": task.get("variables", []),
        "result_symbol": task.get("result_symbol", task.get("sought", "?")),
        "result_unit": "",
        "result_numeric": task.get("result_numeric", []),
        "result_text": task.get("result_text", ""),
        "linear_notation": task.get("linear_notation", ""),
    }


# ── Stage 2: Struktur-Vorlage (mit Rechenketten) ─────────────────────
def _stage2_structure(self, parent, task, state, next_fn):
    chain = task.get("calc_chain", [])
    if not chain:
        chain = [_task_as_single_step(task)]

    chain_state = {"step_idx": 0, "computed": {}, "all_ok": True}

    chain_frame = ctk.CTkFrame(parent, fg_color="transparent")
    chain_frame.grid(row=2, column=0, sticky="ew")
    chain_frame.grid_columnconfigure(0, weight=1)

    def show_chain_step(si):
        for w in chain_frame.winfo_children():
            w.destroy()

        if si >= len(chain):
            state["total"] += 1
            if chain_state["all_ok"]:
                state["correct"] += 1
            final = task.get("final_result_text", chain[-1].get("result_text", ""))
            lbl_text = f"✅ Alle Schritte richtig! → {final}" if chain_state["all_ok"] else f"Endergebnis: {final}"
            lbl_color = COLORS["success"] if chain_state["all_ok"] else COLORS["text"]
            ctk.CTkLabel(chain_frame, text=lbl_text, font=("Segoe UI", 14, "bold"),
                         text_color=lbl_color, wraplength=600
                         ).grid(row=0, column=0, sticky="w", padx=14, pady=12)
            state["idx"] += 1
            self.after(2000, lambda: next_fn(state["idx"]))
            return

        step = chain[si]
        total_steps = len(chain)

        card = ctk.CTkFrame(chain_frame, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                            border_width=1, border_color=COLORS["border"])
        card.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        card.grid_columnconfigure(0, weight=1)

        step_label = f"Rechenschritt {si+1}/{total_steps}" if total_steps > 1 else "Rechnung"
        desc = step.get("description", "")
        ctk.CTkLabel(card, text=f"🧩 {step_label}: {desc}",
                     font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                     ).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 4))

        # Show formula with □ placeholders
        formula_template = step.get("formula_template", "")
        formula_latex = step.get("formula_latex", "")
        display_latex = formula_template or formula_latex
        if display_latex:
            blanked = re.sub(r'\{\{(\w+)\}\}', r'\\boxed{?}', display_latex)
            if can_render_latex():
                _render_latex_image(self, blanked, card, row=1)
            else:
                ctk.CTkLabel(card, text=blanked, font=("Consolas", 14),
                             text_color=COLORS["text"]).grid(row=1, column=0, sticky="w", padx=14, pady=4)

        # Variable inputs as □ placeholders
        inputs = step.get("inputs", [])
        entries = {}
        r = 2

        if inputs:
            ctk.CTkLabel(card, text="Fülle die □ Platzhalter aus:",
                         font=("Segoe UI", 12, "bold"), text_color=COLORS["text"]
                         ).grid(row=r, column=0, sticky="w", padx=14, pady=(8, 4))
            r += 1

            var_frame = ctk.CTkFrame(card, fg_color="transparent")
            var_frame.grid(row=r, column=0, sticky="ew", padx=14, pady=(0, 8))
            var_frame.grid_columnconfigure(1, weight=1)

            for i, inp in enumerate(inputs):
                sym = inp.get("symbol", f"x{i}")
                unit = inp.get("unit", "")
                from_step = inp.get("from_step")
                unit_str = f" [{unit}]" if unit else ""

                if from_step and sym in chain_state["computed"]:
                    expected = chain_state["computed"][sym]
                else:
                    expected = inp.get("value")

                ctk.CTkLabel(var_frame, text=f"□ {i+1}{unit_str} =",
                             font=("Segoe UI", 13), text_color=COLORS["text"]
                             ).grid(row=i, column=0, sticky="w", padx=(0, 8), pady=3)
                e = ctk.CTkEntry(var_frame, height=36, font=("Segoe UI", 13),
                                 placeholder_text=f"Wert für □ {i+1}")
                e.grid(row=i, column=1, sticky="ew", pady=3)
                entries[sym] = (e, expected)
            r += 1

        # Result input
        res_sym = step.get("result_symbol", "?")
        res_unit = step.get("result_unit", "")
        res_label = f"{res_sym}" + (f" [{res_unit}]" if res_unit else "")
        ctk.CTkLabel(card, text=f"Ergebnis: {res_label} =",
                     font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                     ).grid(row=r, column=0, sticky="w", padx=14, pady=(8, 4))
        r += 1

        result_entry = ctk.CTkEntry(card, height=42, font=("Segoe UI", 15),
                                    placeholder_text=f"{res_sym} = ?")
        result_entry.grid(row=r, column=0, sticky="ew", padx=14, pady=(0, 8))
        if not entries:
            result_entry.focus_set()
        else:
            list(entries.values())[0][0].focus_set()
        r += 1

        feedback_lbl = ctk.CTkLabel(card, text="", font=("Segoe UI", 13))
        feedback_lbl.grid(row=r, column=0, sticky="w", padx=14, pady=(0, 4))
        r += 1

        def check_step():
            step_ok = True
            for sym, (e, expected) in entries.items():
                val = e.get().strip()
                if expected is not None and not _validate_numeric(val, expected):
                    e.configure(border_color=COLORS["danger"])
                    step_ok = False
                else:
                    e.configure(border_color=COLORS["success"])

            res_nums = step.get("result_numeric", [])
            res_text = step.get("result_text", "")
            val = result_entry.get().strip()
            result_ok = False
            if res_nums:
                result_ok = _validate_numeric(val, res_nums)
            elif res_text:
                try:
                    result_ok = _validate_numeric(val, float(res_text.replace(",", ".")))
                except (ValueError, TypeError):
                    result_ok = val.lower().strip() == res_text.lower().strip()

            result_entry.configure(border_color=COLORS["success"] if result_ok else COLORS["danger"])
            if not result_ok:
                step_ok = False

            if step_ok:
                feedback_lbl.configure(text=f"✅ Richtig! {res_text}",
                                       text_color=COLORS["success"])
            else:
                chain_state["all_ok"] = False
                feedback_lbl.configure(text=f"❌ Lösung: {res_text}",
                                       text_color=COLORS["danger"])

            if res_nums:
                chain_state["computed"][res_sym] = res_nums[0]
            chain_state["step_idx"] = si + 1
            self.after(1800, lambda: show_chain_step(si + 1))

        btn_frame = ctk.CTkFrame(card, fg_color="transparent")
        btn_frame.grid(row=r, column=0, sticky="ew", padx=14, pady=(0, 14))
        ctk.CTkButton(btn_frame, text="✓ Prüfen", fg_color=COLORS["primary"], height=40,
                      font=("Segoe UI", 14, "bold"), command=check_step
                      ).grid(row=0, column=0, padx=(0, 8))
        result_entry.bind("<Return>", lambda e: check_step())

    show_chain_step(0)


# ── Stage 3: Formel-Recall (mit Rechenketten) ────────────────────────
def _stage3_recall(self, parent, task, state, next_fn):
    chain = task.get("calc_chain", [])
    if not chain:
        chain = [_task_as_single_step(task)]

    # Collect unique formula names from chain
    formula_names = []
    for step in chain:
        fn = step.get("formula_name", "")
        if fn and fn not in formula_names:
            formula_names.append(fn)

    if not formula_names:
        formula_names = [task.get("formula_name", "Formel")]

    recall_state = {"idx": 0}

    recall_frame = ctk.CTkFrame(parent, fg_color="transparent")
    recall_frame.grid(row=2, column=0, sticky="ew")
    recall_frame.grid_columnconfigure(0, weight=1)

    def _fuzzy_match(user_input, correct):
        u = user_input.strip().lower()
        c = correct.strip().lower()
        if not u or not c:
            return False
        if u == c or u in c or c in u:
            return True
        try:
            from .games import _fuzzy_equal
            return _fuzzy_equal(u, c)
        except Exception:
            return False

    def show_recall(fi):
        for w in recall_frame.winfo_children():
            w.destroy()

        if fi >= len(formula_names):
            # All formulas named, proceed to stage 2 structure
            _stage2_structure(self, parent, task, state, next_fn)
            return

        fname = formula_names[fi]

        card = ctk.CTkFrame(recall_frame, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                            border_width=1, border_color=COLORS["border"])
        card.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        card.grid_columnconfigure(0, weight=1)

        step_label = f"Formel {fi+1}/{len(formula_names)}" if len(formula_names) > 1 else ""
        ctk.CTkLabel(card, text=f"🧠 Welche Formel wird benötigt? {step_label}",
                     font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                     ).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 8))

        topic = task.get("topic", "")
        if topic:
            ctk.CTkLabel(card, text=f"Thema: {topic}", font=("Segoe UI", 12),
                         text_color=COLORS["text_light"]
                         ).grid(row=1, column=0, sticky="w", padx=14, pady=(0, 8))

        name_entry = ctk.CTkEntry(card, height=42, font=("Segoe UI", 15),
                                  placeholder_text="Formelname eingeben…")
        name_entry.grid(row=2, column=0, sticky="ew", padx=14, pady=(0, 8))
        name_entry.focus_set()

        feedback_lbl = ctk.CTkLabel(card, text="", font=("Segoe UI", 13))
        feedback_lbl.grid(row=3, column=0, sticky="w", padx=14, pady=(0, 4))

        revealed = {"v": False}

        def check_name():
            if revealed["v"]:
                return
            if _fuzzy_match(name_entry.get(), fname):
                revealed["v"] = True
                feedback_lbl.configure(text="✅ Richtig!",
                                       text_color=COLORS["success"])
                name_entry.configure(border_color=COLORS["success"])
                self.after(800, lambda: show_recall(fi + 1))
            else:
                hint = fname[:3] + "…" if len(fname) > 3 else fname
                feedback_lbl.configure(text=f"❌ Nicht ganz. Tipp: {hint}",
                                       text_color=COLORS["danger"])
                name_entry.configure(border_color=COLORS["danger"])

        btn_frame = ctk.CTkFrame(card, fg_color="transparent")
        btn_frame.grid(row=4, column=0, sticky="ew", padx=14, pady=(0, 14))
        ctk.CTkButton(btn_frame, text="✓ Prüfen", fg_color=COLORS["primary"], height=40,
                      font=("Segoe UI", 14, "bold"), command=check_name
                      ).grid(row=0, column=0, padx=(0, 8))

        def skip():
            revealed["v"] = True
            feedback_lbl.configure(text=f"Die Formel war: {fname}",
                                   text_color=COLORS["warning"])
            self.after(1200, lambda: show_recall(fi + 1))

        ctk.CTkButton(btn_frame, text="⏭ Überspringen", fg_color=COLORS["warning"], height=40,
                      font=("Segoe UI", 13), command=skip
                      ).grid(row=0, column=1)
        name_entry.bind("<Return>", lambda e: check_name())

    show_recall(0)


# ── Stage 4: Lineare Eingabe (mit Rechenketten) ──────────────────────
def _stage4_linear(self, parent, task, state, next_fn):
    chain = task.get("calc_chain", [])
    if not chain:
        chain = [_task_as_single_step(task)]

    chain_state = {"step_idx": 0, "computed": {}, "all_ok": True}

    chain_frame = ctk.CTkFrame(parent, fg_color="transparent")
    chain_frame.grid(row=2, column=0, sticky="ew")
    chain_frame.grid_columnconfigure(0, weight=1)

    def show_chain_step(si):
        for w in chain_frame.winfo_children():
            w.destroy()

        if si >= len(chain):
            state["total"] += 1
            if chain_state["all_ok"]:
                state["correct"] += 1
            final = task.get("final_result_text", chain[-1].get("result_text", ""))
            lbl_text = f"✅ Alle Schritte richtig! → {final}" if chain_state["all_ok"] else f"Endergebnis: {final}"
            lbl_color = COLORS["success"] if chain_state["all_ok"] else COLORS["text"]
            ctk.CTkLabel(chain_frame, text=lbl_text, font=("Segoe UI", 14, "bold"),
                         text_color=lbl_color, wraplength=600
                         ).grid(row=0, column=0, sticky="w", padx=14, pady=12)
            state["idx"] += 1
            self.after(2000, lambda: next_fn(state["idx"]))
            return

        step = chain[si]
        total_steps = len(chain)

        card = ctk.CTkFrame(chain_frame, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                            border_width=1, border_color=COLORS["border"])
        card.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        card.grid_columnconfigure(0, weight=1)

        step_label = f"Rechenschritt {si+1}/{total_steps}" if total_steps > 1 else "Rechnung"
        desc = step.get("description", "")
        ctk.CTkLabel(card, text=f"✍️ {step_label}: {desc}",
                     font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                     ).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 4))

        # Show given values for this step
        inputs = step.get("inputs", [])
        if inputs:
            parts = []
            for inp in inputs:
                sym = inp.get("symbol", "?")
                from_step = inp.get("from_step")
                if from_step and sym in chain_state["computed"]:
                    val = chain_state["computed"][sym]
                else:
                    val = inp.get("value", "?")
                parts.append(f"{sym} = {val}")
            ctk.CTkLabel(card, text=f"Gegeben: {', '.join(parts)}",
                         font=("Segoe UI", 13, "bold"), text_color=COLORS["primary"],
                         wraplength=550
                         ).grid(row=1, column=0, sticky="w", padx=14, pady=(4, 8))

        res_sym = step.get("result_symbol", "?")
        ctk.CTkLabel(card, text=f"Berechne: {res_sym} = ?",
                     font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                     ).grid(row=2, column=0, sticky="w", padx=14, pady=(4, 8))

        expr_entry = ctk.CTkEntry(card, height=46, font=("Consolas", 15),
                                  placeholder_text="Lösung oder numerisches Ergebnis eingeben")
        expr_entry.grid(row=3, column=0, sticky="ew", padx=14, pady=(0, 4))
        expr_entry.focus_set()

        feedback_lbl = ctk.CTkLabel(card, text="", font=("Segoe UI", 13))
        feedback_lbl.grid(row=4, column=0, sticky="w", padx=14, pady=(0, 4))

        linear_correct = step.get("linear_notation", "")
        res_text = step.get("result_text", "")
        res_nums = step.get("result_numeric", [])

        def check_step():
            raw = expr_entry.get().strip()
            if not raw:
                return

            correct = False
            user_result = None

            if res_nums and _validate_numeric(raw, res_nums):
                correct = True
            elif res_text:
                try:
                    correct = _validate_numeric(raw, float(res_text.replace(",", ".")))
                except (ValueError, TypeError):
                    pass

            if not correct:
                try:
                    sanitized = raw.replace("^", "**").replace(",", ".").replace("wrzl", "sqrt")
                    sanitized = re.sub(r'(\d)([a-zA-Z])', r'\1*\2', sanitized)
                    result = eval(sanitized.split("=")[-1], {"__builtins__": {}},
                                  {"sqrt": math.sqrt, "abs": abs, "pi": math.pi, "e": math.e})
                    user_result = round(float(result), 2)
                    if res_nums:
                        correct = _validate_numeric(str(user_result), res_nums)
                except Exception:
                    pass

            if correct:
                expr_entry.configure(border_color=COLORS["success"])
                feedback_lbl.configure(text=f"✅ Richtig! {res_text}",
                                       text_color=COLORS["success"])
            else:
                chain_state["all_ok"] = False
                expr_entry.configure(border_color=COLORS["danger"])
                hint = f" (dein Ergebnis: {user_result})" if user_result is not None else ""
                feedback_lbl.configure(
                    text=f"❌ Lösung: {linear_correct or res_text}{hint}",
                    text_color=COLORS["danger"])

            if res_nums:
                chain_state["computed"][res_sym] = res_nums[0]
            chain_state["step_idx"] = si + 1
            self.after(1800, lambda: show_chain_step(si + 1))

        btn_frame = ctk.CTkFrame(card, fg_color="transparent")
        btn_frame.grid(row=5, column=0, sticky="ew", padx=14, pady=(0, 14))
        ctk.CTkButton(btn_frame, text="✓ Prüfen", fg_color=COLORS["primary"], height=40,
                      font=("Segoe UI", 14, "bold"), command=check_step
                      ).grid(row=0, column=0, padx=(0, 8))

        fname = step.get("formula_name", "")
        if fname:
            def show_hint(f=fname):
                feedback_lbl.configure(text=f"💡 Formel: {f}", text_color=COLORS["info"])
            ctk.CTkButton(btn_frame, text="💡 Hinweis", fg_color=COLORS["warning"], height=40,
                          font=("Segoe UI", 13), command=show_hint
                          ).grid(row=0, column=1)

        expr_entry.bind("<Return>", lambda e: check_step())

    show_chain_step(0)


# ── Run Scaffold with Formula Sheet (legacy mode) ──────────────────────
def _run_scaffold_formulas(self, sheet, stage):
    formulas = list(sheet.formulas)
    random.shuffle(formulas)
    tasks = []
    for f in formulas:
        t = _generate_task_local(f)
        if t:
            t["formula_name"] = f.name
            t["formula_latex"] = f.latex
            t["formula_template"] = getattr(f, "template", "") or ""
            t["result_symbol"] = f.result_symbol
            t["variables"] = [{"symbol": v.symbol, "name": v.name, "unit": v.unit,
                               "value": t["variable_values"].get(v.symbol)}
                              for v in f.variables]
            t["given"] = t["variable_values"]
            t["result_text"] = str(t["result_value"])
            t["result_numeric"] = [t["result_value"]]
            t["steps"] = []
            tasks.append(t)
    if not tasks:
        messagebox.showinfo("Hinweis", "Konnte keine Aufgaben generieren.")
        return
    _run_scaffold_tasks(self, tasks, stage, task_set={"name": sheet.name, "tasks": tasks})


# ── End Screen ──────────────────────────────────────────────────────────
def _show_end(self, parent, state, task_set=None):
    for w in parent.winfo_children():
        w.destroy()

    total = state["total"]
    correct = state["correct"]
    pct = int(correct / total * 100) if total > 0 else 0

    card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                        border_width=2, border_color=COLORS["primary"])
    card.grid(row=0, column=0, sticky="ew", pady=20)
    card.grid_columnconfigure(0, weight=1)

    emoji = "🎉" if pct >= 80 else "👍" if pct >= 50 else "💪"
    ctk.CTkLabel(card, text=f"{emoji} Ergebnis", font=("Segoe UI", 20, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=0, pady=(20, 8))
    ctk.CTkLabel(card, text=f"{correct} / {total} richtig ({pct}%)",
                 font=("Segoe UI", 18), text_color=COLORS["primary"]
                 ).grid(row=1, column=0, pady=(0, 8))

    msg = "Perfekt! 🏆" if pct == 100 else "Sehr gut!" if pct >= 80 else "Gut gemacht!" if pct >= 50 else "Weiter üben!"
    ctk.CTkLabel(card, text=msg, font=("Segoe UI", 14),
                 text_color=COLORS["text_light"]).grid(row=2, column=0, pady=(0, 20))

    btn_f = ctk.CTkFrame(parent, fg_color="transparent")
    btn_f.grid(row=1, column=0, pady=10)
    if task_set:
        ctk.CTkButton(btn_f, text="🔄 Nochmal", fg_color=COLORS["primary"],
                      command=lambda: _show_task_set_stages(self, task_set)
                      ).grid(row=0, column=0, padx=5)
    ctk.CTkButton(btn_f, text="🏠 Zurück", fg_color=COLORS["text_light"],
                  command=self.show_scaffold).grid(row=0, column=1, padx=5)


# ── Generate More Tasks ─────────────────────────────────────────────────
def _generate_more_tasks(self, quiz, on_done=None):
    """Show dialog to generate more math tasks similar to existing ones."""
    if not quiz.questions:
        messagebox.showinfo("Hinweis", "Das Quiz hat noch keine Fragen.")
        return
    if not self.ai.api_key:
        messagebox.showwarning("Hinweis", "Bitte zuerst API-Key in den Einstellungen speichern!")
        return

    win = ctk.CTkToplevel(self)
    win.title("Mehr Aufgaben generieren")
    win.geometry("500x400")
    win.grab_set()

    ctk.CTkLabel(win, text="➕ Ähnliche Aufgaben generieren",
                 font=("Segoe UI", 16, "bold"), text_color=COLORS["text"]
                 ).grid(row=0, column=0, padx=20, pady=(20, 8), sticky="w")

    # Pick which question type to duplicate
    math_qs = [q for q in quiz.questions if q.question_type.value in ("free_text", "math_formula")]
    if not math_qs:
        math_qs = list(quiz.questions)

    q_names = [f"{i+1}. {q.title or q.text[:50]}" for i, q in enumerate(math_qs)]
    ctk.CTkLabel(win, text="Aufgabentyp auswählen:", font=("Segoe UI", 13)
                 ).grid(row=1, column=0, padx=20, pady=(8, 4), sticky="w")
    q_var = StringVar(value=q_names[0] if q_names else "")
    ctk.CTkOptionMenu(win, values=q_names, variable=q_var, width=440
                      ).grid(row=2, column=0, padx=20, sticky="w")

    ctk.CTkLabel(win, text="Anzahl:", font=("Segoe UI", 13)
                 ).grid(row=3, column=0, padx=20, pady=(12, 4), sticky="w")
    count_var = StringVar(value="5")
    ctk.CTkEntry(win, textvariable=count_var, width=80).grid(row=4, column=0, padx=20, sticky="w")

    status = ctk.CTkLabel(win, text="", font=("Segoe UI", 12), text_color=COLORS["primary"])
    status.grid(row=5, column=0, padx=20, pady=8, sticky="w")

    def generate():
        idx = q_names.index(q_var.get()) if q_var.get() in q_names else 0
        example_q = math_qs[idx]
        try:
            count = max(1, min(20, int(count_var.get())))
        except ValueError:
            count = 5

        status.configure(text="Generiere…")

        def run():
            example = {
                "text": example_q.text,
                "correct_text": example_q.correct_text or "",
                "topic": example_q.topic,
            }
            try:
                new_tasks = self.ai.generate_similar_tasks(example, count)
            except Exception as exc:
                self.after(0, lambda: status.configure(text=f"Fehler: {exc}"))
                return

            from .models import Question, QuestionType
            new_qs = []
            for t in new_tasks:
                q = Question(
                    question_type=QuestionType.FREE_TEXT,
                    title=t.get("text", "")[:60],
                    text=t.get("text", ""),
                    topic=example_q.topic,
                    correct_text=t.get("result_text", str(t.get("result_numeric", [""])[0] if t.get("result_numeric") else "")),
                )
                new_qs.append(q)

            def done():
                quiz.questions.extend(new_qs)
                self._save_quizzes()
                status.configure(text=f"✅ {len(new_qs)} Aufgaben hinzugefügt!")
                win.after(1000, win.destroy)
                if on_done:
                    on_done()

            self.after(0, done)

        threading.Thread(target=run, daemon=True).start()

    ctk.CTkButton(win, text="🚀 Generieren", fg_color=COLORS["success"],
                  command=generate).grid(row=6, column=0, padx=20, pady=12, sticky="w")
