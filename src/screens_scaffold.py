"""Scaffolding-Modus: 4-stage math/formula practice for the desktop app.

Stages:
1. Geführte Formel  – full formula shown, user fills in variable values + result
2. Struktur-Vorlage – formula structure shown but variable names hidden
3. Formel-Recall    – user must name the formula, then it reveals the structure
4. Lineare Eingabe  – user types the whole solution in linear notation

Mixed into the App class via binding in app.py.
"""

import json
import math
import threading
import random
import re
import uuid
from tkinter import StringVar, messagebox
import customtkinter as ctk

from .models import Formula, FormulaSheet
from .theme import COLORS, RADIUS_SM, RADIUS_MD, RADIUS_LG, color_alpha
from .latex_render import render_formula, can_render as can_render_latex, has_latex

# ── Constants ────────────────────────────────────────────────────────────
EPSILON = 0.02
STAGE_NAMES = {
    1: "Geführte Formel",
    2: "Struktur-Vorlage",
    3: "Formel-Recall",
    4: "Lineare Eingabe",
}
STAGE_ICONS = {1: "📝", 2: "🧩", 3: "🧠", 4: "✍️"}
STAGE_DESCS = {
    1: "Die vollständige Formel wird angezeigt. Fülle die Variablen und das Ergebnis aus.",
    2: "Die Formelstruktur ist sichtbar, aber ohne Variablennamen. Wo gehört was hin?",
    3: "Wie heißt die Formel? Bei richtiger Eingabe wird sie angezeigt.",
    4: "Gib die komplette Lösung in linearer Schreibweise ein (z.B. (x^2+3x)/2).",
}


def _render_latex_image(self, latex_str, parent, row, col=0, colspan=1):
    """Render a LaTeX string as image and place it in the grid."""
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
    """Check if a user-entered value is close enough to the correct value."""
    try:
        user_val = float(value_str.replace(",", ".").strip())
        user_val = round(user_val, 2)
        correct_val = round(float(correct), 2)
        return math.isclose(user_val, correct_val, abs_tol=epsilon)
    except (ValueError, TypeError):
        return False


def _safe_eval(expression, var_values):
    """Safely evaluate a formula expression with given variable values."""
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


# ── AI Task Generation ──────────────────────────────────────────────────
_SCAFFOLD_PROMPT = """Du bist ein Mathematik-/Formeldozent. Erstelle eine Übungsaufgabe basierend auf der folgenden Formel.

Formel: {formula_name}
LaTeX: {formula_latex}
Variablen: {variables}
Berechnungsausdruck (Python): {expression}
Ergebnisvariable: {result_symbol}

Generiere eine REALISTISCHE Aufgabe mit konkreten Zahlenwerten.
Antworte AUSSCHLIESSLICH als JSON:
{{
  "task_text": "Aufgabenstellung als Text",
  "variable_values": {{"symbol1": wert1, "symbol2": wert2, ...}},
  "result_value": berechnetes_ergebnis,
  "hint": "Kurzer Hinweis zur Lösung"
}}

WICHTIG:
- Alle Werte auf 2 Nachkommastellen runden
- Nutze realistische Werte aus der Praxis
- Die variable_values müssen ALLE Variablen der Formel abdecken
- result_value muss das korrekte Ergebnis der Formel sein"""


def _generate_task_ai(self, formula, callback):
    """Generate a task via OpenRouter API in a background thread."""
    def _run():
        var_desc = ", ".join(f"{v.symbol} ({v.name}, {v.unit})" for v in formula.variables)
        prompt = _SCAFFOLD_PROMPT.format(
            formula_name=formula.name,
            formula_latex=formula.latex,
            variables=var_desc,
            expression=formula.expression,
            result_symbol=formula.result_symbol,
        )
        try:
            raw = self.ai._chat([
                {"role": "system", "content": "Du antwortest nur mit validem JSON."},
                {"role": "user", "content": prompt},
            ])
            cleaned = re.sub(r"```json\s*|\s*```", "", raw).strip()
            task = json.loads(self.ai._repair_json(cleaned))
            # Validate result
            if formula.expression and task.get("variable_values"):
                computed = _safe_eval(formula.expression, task["variable_values"])
                if computed is not None:
                    task["result_value"] = computed
            self.after(0, lambda: callback(task, None))
        except Exception as e:
            self.after(0, lambda: callback(None, str(e)))
    threading.Thread(target=_run, daemon=True).start()


def _generate_task_local(formula):
    """Generate a task locally with random values (no API needed)."""
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
    """Show the scaffolding mode: choose a formula sheet and stage."""
    self._clear_main()
    self.header_subtitle.configure(text="🔢 Formel-Training")
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    # Back header
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

    sheets = self.formula_sheets
    if not sheets:
        ctk.CTkLabel(scroll, text="Erstelle zuerst eine Formelsammlung unter 📋 Formelsammlung.",
                     font=("Segoe UI", 14), text_color=COLORS["text_light"], wraplength=600
                     ).grid(row=1, column=0, pady=40)
        ctk.CTkButton(scroll, text="📋 Zur Formelsammlung", fg_color=COLORS["primary"],
                      command=self.show_formula_sheets
                      ).grid(row=2, column=0)
        return

    # Formula sheet picker
    ctk.CTkLabel(scroll, text="Formelsammlung wählen:", font=("Segoe UI", 14, "bold"),
                 text_color=COLORS["text"]).grid(row=1, column=0, sticky="w", pady=(0, 8))

    sheet_names = [s.name for s in sheets]
    sheet_var = StringVar(value=sheet_names[0])
    ctk.CTkOptionMenu(scroll, values=sheet_names, variable=sheet_var, width=400
                      ).grid(row=2, column=0, sticky="w", pady=(0, 16))

    # Stage cards
    ctk.CTkLabel(scroll, text="Schwierigkeitsstufe:", font=("Segoe UI", 14, "bold"),
                 text_color=COLORS["text"]).grid(row=3, column=0, sticky="w", pady=(0, 8))

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
                            border_width=2, border_color=COLORS.get("border", "#e3ece6"),
                            cursor="hand2")
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

        _stage = stage
        def start(s=_stage):
            idx = sheet_names.index(sheet_var.get()) if sheet_var.get() in sheet_names else 0
            sheet = sheets[idx]
            if not sheet.formulas:
                messagebox.showinfo("Hinweis", "Diese Formelsammlung hat keine Formeln.")
                return
            _run_scaffold(self, sheet, s)

        card.bind("<Button-1>", lambda e, s=_stage: start(s))
        lbl.bind("<Button-1>", lambda e, s=_stage: start(s))
        dl.bind("<Button-1>", lambda e, s=_stage: start(s))


# ── Scaffold Runner ──────────────────────────────────────────────────────
def _run_scaffold(self, sheet, stage):
    """Run a scaffolding session with the given formula sheet and stage."""
    self._clear_main()
    self.header_subtitle.configure(text=f"🔢 Stufe {stage}: {STAGE_NAMES[stage]}")
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)

    formulas = list(sheet.formulas)
    random.shuffle(formulas)
    state = {
        "idx": 0, "correct": 0, "total": 0,
        "formulas": formulas, "stage": stage,
    }

    content = ctk.CTkFrame(scroll, fg_color="transparent")
    content.grid(row=0, column=0, sticky="ew")
    content.grid_columnconfigure(0, weight=1)

    def show_formula(idx):
        for w in content.winfo_children():
            w.destroy()

        if idx >= len(formulas):
            _show_scaffold_end(self, content, state, sheet, stage)
            return

        formula = formulas[idx]
        task = _generate_task_local(formula)
        if not task:
            state["idx"] += 1
            show_formula(state["idx"])
            return

        # Progress bar
        prog = ctk.CTkFrame(content, fg_color="transparent")
        prog.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        prog.grid_columnconfigure(1, weight=1)
        ctk.CTkButton(prog, text="← Beenden", width=80, height=32, corner_radius=RADIUS_MD,
                      fg_color=COLORS["card"], text_color=COLORS["text"],
                      hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                      border_color=COLORS["border"], font=("Segoe UI", 12),
                      command=self.show_scaffold).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkLabel(prog, text=f"Aufgabe {idx + 1}/{len(formulas)} · {STAGE_ICONS[stage]} Stufe {stage}",
                     font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                     ).grid(row=0, column=1, sticky="w")
        pbar = ctk.CTkProgressBar(prog, height=6, progress_color=COLORS["primary"])
        pbar.set((idx) / len(formulas))
        pbar.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(6, 0))

        # Task text
        ctk.CTkLabel(content, text=task["task_text"], font=("Segoe UI", 14),
                     text_color=COLORS["text"], wraplength=600, justify="left"
                     ).grid(row=1, column=0, sticky="w", padx=14, pady=(12, 8))

        if stage == 1:
            _stage1_guided(self, content, formula, task, state, show_formula)
        elif stage == 2:
            _stage2_structure(self, content, formula, task, state, show_formula)
        elif stage == 3:
            _stage3_recall(self, content, formula, task, state, show_formula)
        elif stage == 4:
            _stage4_linear(self, content, formula, task, state, show_formula)

    show_formula(0)


# ── Stage 1: Geführte Formel ────────────────────────────────────────────
def _stage1_guided(self, parent, formula, task, state, next_fn):
    """Full formula shown, user fills in values and result."""
    card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                        border_width=1, border_color=COLORS["border"])
    card.grid(row=2, column=0, sticky="ew", padx=0, pady=(0, 12))
    card.grid_columnconfigure(0, weight=1)

    ctk.CTkLabel(card, text="📝 Formel:", font=("Segoe UI", 13, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 4))

    if can_render_latex() and formula.latex:
        _render_latex_image(self, formula.latex, card, row=1)
    else:
        ctk.CTkLabel(card, text=formula.latex or formula.name, font=("Segoe UI", 14),
                     text_color=COLORS["text"]).grid(row=1, column=0, sticky="w", padx=14, pady=4)

    # Variable inputs
    entries = {}
    r = 2
    ctk.CTkLabel(card, text="Setze die Werte ein:", font=("Segoe UI", 12, "bold"),
                 text_color=COLORS["text"]).grid(row=r, column=0, sticky="w", padx=14, pady=(12, 6))
    r += 1

    var_frame = ctk.CTkFrame(card, fg_color="transparent")
    var_frame.grid(row=r, column=0, sticky="ew", padx=14, pady=(0, 8))

    for i, v in enumerate(formula.variables):
        correct_val = task["variable_values"].get(v.symbol, 0)
        unit_str = f" [{v.unit}]" if v.unit else ""
        ctk.CTkLabel(var_frame, text=f"{v.symbol} ({v.name}{unit_str}) =",
                     font=("Segoe UI", 13), text_color=COLORS["text"]
                     ).grid(row=i, column=0, sticky="w", padx=(0, 8), pady=4)
        # Show the given value (user reads from task)
        ctk.CTkLabel(var_frame, text=f"{correct_val}", font=("Segoe UI", 13, "bold"),
                     text_color=COLORS["primary"]).grid(row=i, column=1, sticky="w", pady=4)
    r += 1

    # Result input
    ctk.CTkLabel(card, text=f"Ergebnis ({formula.result_symbol}) =",
                 font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                 ).grid(row=r, column=0, sticky="w", padx=14, pady=(8, 4))
    r += 1

    result_entry = ctk.CTkEntry(card, height=42, font=("Segoe UI", 15),
                                placeholder_text=f"{formula.result_symbol} = ?")
    result_entry.grid(row=r, column=0, sticky="ew", padx=14, pady=(0, 8))
    result_entry.focus_set()
    r += 1

    feedback_lbl = ctk.CTkLabel(card, text="", font=("Segoe UI", 13))
    feedback_lbl.grid(row=r, column=0, sticky="w", padx=14, pady=(0, 4))
    r += 1

    hint_shown = {"v": False}

    def check():
        val = result_entry.get().strip()
        if not val:
            return
        correct = _validate_numeric(val, task["result_value"])
        state["total"] += 1
        if correct:
            state["correct"] += 1
            result_entry.configure(border_color=COLORS["success"])
            feedback_lbl.configure(text=f"✅ Richtig! {formula.result_symbol} = {task['result_value']}",
                                   text_color=COLORS["success"])
        else:
            result_entry.configure(border_color=COLORS["danger"])
            feedback_lbl.configure(
                text=f"❌ Falsch. Richtig wäre: {task['result_value']}",
                text_color=COLORS["danger"])

        state["idx"] += 1
        self.after(1500, lambda: next_fn(state["idx"]))

    def show_hint():
        if not hint_shown["v"]:
            hint_shown["v"] = True
            feedback_lbl.configure(text=f"💡 {task.get('hint', '')}", text_color=COLORS["info"])

    btn_frame = ctk.CTkFrame(card, fg_color="transparent")
    btn_frame.grid(row=r, column=0, sticky="ew", padx=14, pady=(0, 14))
    ctk.CTkButton(btn_frame, text="✓ Prüfen", fg_color=COLORS["primary"], height=40,
                  font=("Segoe UI", 14, "bold"), command=check
                  ).grid(row=0, column=0, padx=(0, 8))
    ctk.CTkButton(btn_frame, text="💡 Hinweis", fg_color=COLORS["warning"], height=40,
                  font=("Segoe UI", 13), command=show_hint
                  ).grid(row=0, column=1)

    result_entry.bind("<Return>", lambda e: check())


# ── Stage 2: Struktur-Vorlage ───────────────────────────────────────────
def _stage2_structure(self, parent, formula, task, state, next_fn):
    """Formula structure shown but variable names replaced with blanks."""
    card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                        border_width=1, border_color=COLORS["border"])
    card.grid(row=2, column=0, sticky="ew", padx=0, pady=(0, 12))
    card.grid_columnconfigure(0, weight=1)

    ctk.CTkLabel(card, text="🧩 Formelstruktur (ohne Variablennamen):",
                 font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                 ).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 4))

    # Show template with placeholders
    template = formula.template or formula.latex
    if can_render_latex() and template:
        display = template
        for v in formula.variables:
            display = display.replace("{{" + v.symbol + "}}", r"\boxed{?}")
        _render_latex_image(self, display, card, row=1)
    else:
        ctk.CTkLabel(card, text="Formelstruktur: Fülle die Lücken",
                     font=("Segoe UI", 14), text_color=COLORS["text"]
                     ).grid(row=1, column=0, sticky="w", padx=14, pady=4)

    # Input for each variable
    entries = {}
    var_frame = ctk.CTkFrame(card, fg_color="transparent")
    var_frame.grid(row=2, column=0, sticky="ew", padx=14, pady=(8, 4))

    for i, v in enumerate(formula.variables):
        unit_str = f" [{v.unit}]" if v.unit else ""
        ctk.CTkLabel(var_frame, text=f"Feld {i + 1}{unit_str} =",
                     font=("Segoe UI", 13), text_color=COLORS["text"]
                     ).grid(row=i, column=0, sticky="w", padx=(0, 8), pady=3)
        e = ctk.CTkEntry(var_frame, height=36, font=("Segoe UI", 13),
                         placeholder_text=f"Wert für Feld {i + 1}")
        e.grid(row=i, column=1, sticky="ew", pady=3)
        entries[v.symbol] = e
    var_frame.grid_columnconfigure(1, weight=1)

    # Result
    ctk.CTkLabel(card, text=f"Ergebnis =", font=("Segoe UI", 14, "bold"),
                 text_color=COLORS["text"]).grid(row=3, column=0, sticky="w", padx=14, pady=(8, 4))
    result_entry = ctk.CTkEntry(card, height=42, font=("Segoe UI", 15),
                                placeholder_text="Ergebnis = ?")
    result_entry.grid(row=4, column=0, sticky="ew", padx=14, pady=(0, 8))

    feedback_lbl = ctk.CTkLabel(card, text="", font=("Segoe UI", 13))
    feedback_lbl.grid(row=5, column=0, sticky="w", padx=14, pady=(0, 4))

    if entries:
        first = list(entries.values())[0]
        first.focus_set()

    def check():
        all_correct = True
        for v in formula.variables:
            e = entries[v.symbol]
            val = e.get().strip()
            expected = task["variable_values"].get(v.symbol, 0)
            if _validate_numeric(val, expected):
                e.configure(border_color=COLORS["success"])
            else:
                e.configure(border_color=COLORS["danger"])
                all_correct = False

        result_ok = _validate_numeric(result_entry.get().strip(), task["result_value"])
        result_entry.configure(border_color=COLORS["success"] if result_ok else COLORS["danger"])

        state["total"] += 1
        if all_correct and result_ok:
            state["correct"] += 1
            feedback_lbl.configure(text="✅ Alles richtig!", text_color=COLORS["success"])
        else:
            parts = []
            for v in formula.variables:
                parts.append(f"{v.symbol} = {task['variable_values'].get(v.symbol, '?')}")
            parts.append(f"Ergebnis = {task['result_value']}")
            feedback_lbl.configure(
                text=f"❌ Lösung: {', '.join(parts)}", text_color=COLORS["danger"])

        state["idx"] += 1
        self.after(2000, lambda: next_fn(state["idx"]))

    ctk.CTkButton(card, text="✓ Prüfen", fg_color=COLORS["primary"], height=40,
                  font=("Segoe UI", 14, "bold"), command=check
                  ).grid(row=6, column=0, sticky="w", padx=14, pady=(0, 14))
    result_entry.bind("<Return>", lambda e: check())


# ── Stage 3: Formel-Recall ──────────────────────────────────────────────
def _stage3_recall(self, parent, formula, task, state, next_fn):
    """User must name the formula; on correct input → shows stage 1/2."""
    card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                        border_width=1, border_color=COLORS["border"])
    card.grid(row=2, column=0, sticky="ew", padx=0, pady=(0, 12))
    card.grid_columnconfigure(0, weight=1)

    ctk.CTkLabel(card, text="🧠 Wie heißt die benötigte Formel?",
                 font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                 ).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 8))

    ctk.CTkLabel(card, text=f"Tipp: {formula.category}" if formula.category else "",
                 font=("Segoe UI", 12), text_color=COLORS["text_light"]
                 ).grid(row=1, column=0, sticky="w", padx=14, pady=(0, 8))

    name_entry = ctk.CTkEntry(card, height=42, font=("Segoe UI", 15),
                              placeholder_text="Formelname eingeben…")
    name_entry.grid(row=2, column=0, sticky="ew", padx=14, pady=(0, 8))
    name_entry.focus_set()

    feedback_lbl = ctk.CTkLabel(card, text="", font=("Segoe UI", 13))
    feedback_lbl.grid(row=3, column=0, sticky="w", padx=14, pady=(0, 4))

    revealed = {"v": False}

    def _fuzzy_name_match(user_input, correct_name):
        u = user_input.strip().lower()
        c = correct_name.strip().lower()
        if not u:
            return False
        if u == c or u in c or c in u:
            return True
        # Levenshtein for typo tolerance
        from .games import _fuzzy_equal
        return _fuzzy_equal(u, c)

    def check_name():
        if revealed["v"]:
            return
        user_name = name_entry.get().strip()
        if _fuzzy_name_match(user_name, formula.name):
            revealed["v"] = True
            feedback_lbl.configure(text="✅ Richtig! Formel wird angezeigt…",
                                   text_color=COLORS["success"])
            name_entry.configure(border_color=COLORS["success"])
            # Show the guided stage below
            self.after(800, lambda: _stage1_guided(self, parent, formula, task, state, next_fn))
        else:
            feedback_lbl.configure(text=f"❌ Nicht ganz. Versuch nochmal! (Tipp: {formula.name[:3]}…)",
                                   text_color=COLORS["danger"])
            name_entry.configure(border_color=COLORS["danger"])

    btn_frame = ctk.CTkFrame(card, fg_color="transparent")
    btn_frame.grid(row=4, column=0, sticky="ew", padx=14, pady=(0, 14))
    ctk.CTkButton(btn_frame, text="✓ Prüfen", fg_color=COLORS["primary"], height=40,
                  font=("Segoe UI", 14, "bold"), command=check_name
                  ).grid(row=0, column=0, padx=(0, 8))

    def skip():
        revealed["v"] = True
        feedback_lbl.configure(text=f"Die Formel war: {formula.name}",
                               text_color=COLORS["warning"])
        name_entry.configure(border_color=COLORS["warning"])
        self.after(1200, lambda: _stage1_guided(self, parent, formula, task, state, next_fn))

    ctk.CTkButton(btn_frame, text="⏭ Überspringen", fg_color=COLORS["warning"], height=40,
                  font=("Segoe UI", 13), command=skip
                  ).grid(row=0, column=1)

    name_entry.bind("<Return>", lambda e: check_name())


# ── Stage 4: Lineare Eingabe ────────────────────────────────────────────
def _stage4_linear(self, parent, formula, task, state, next_fn):
    """User types the complete solution in linear notation."""
    card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                        border_width=1, border_color=COLORS["border"])
    card.grid(row=2, column=0, sticky="ew", padx=0, pady=(0, 12))
    card.grid_columnconfigure(0, weight=1)

    ctk.CTkLabel(card, text="✍️ Gib die komplette Lösung in linearer Schreibweise ein:",
                 font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                 ).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 4))

    ctk.CTkLabel(card, text=f"Gegebene Werte:", font=("Segoe UI", 12),
                 text_color=COLORS["text"]).grid(row=1, column=0, sticky="w", padx=14, pady=(4, 2))

    vals_text = ", ".join(f"{k} = {v}" for k, v in task["variable_values"].items())
    ctk.CTkLabel(card, text=vals_text, font=("Segoe UI", 13, "bold"),
                 text_color=COLORS["primary"], wraplength=550
                 ).grid(row=2, column=0, sticky="w", padx=14, pady=(0, 8))

    ctk.CTkLabel(card, text=f"Berechne: {formula.result_symbol} = ?",
                 font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                 ).grid(row=3, column=0, sticky="w", padx=14, pady=(4, 8))

    # Single-line entry for full linear expression
    expr_entry = ctk.CTkEntry(card, height=46, font=("Consolas", 15),
                              placeholder_text="z.B. (500 + 300) / (1 + 0.05)^2")
    expr_entry.grid(row=4, column=0, sticky="ew", padx=14, pady=(0, 4))
    expr_entry.focus_set()

    # Also accept just the final numeric result
    ctk.CTkLabel(card, text="Oder gib direkt das Ergebnis ein:",
                 font=("Segoe UI", 11), text_color=COLORS["text_light"]
                 ).grid(row=5, column=0, sticky="w", padx=14, pady=(0, 8))

    feedback_lbl = ctk.CTkLabel(card, text="", font=("Segoe UI", 13))
    feedback_lbl.grid(row=6, column=0, sticky="w", padx=14, pady=(0, 4))

    def check():
        raw = expr_entry.get().strip()
        if not raw:
            return

        # Try to evaluate the expression
        correct = False
        user_result = None

        # First: try as direct number
        if _validate_numeric(raw, task["result_value"]):
            correct = True
            user_result = raw
        else:
            # Try evaluating as expression
            try:
                sanitized = raw.replace("^", "**").replace(",", ".")
                result = eval(sanitized, {"__builtins__": {}},
                              {"sqrt": math.sqrt, "abs": abs, "pi": math.pi, "e": math.e})
                user_result = round(float(result), 2)
                correct = math.isclose(user_result, task["result_value"], abs_tol=EPSILON)
            except Exception:
                pass

        state["total"] += 1
        if correct:
            state["correct"] += 1
            expr_entry.configure(border_color=COLORS["success"])
            feedback_lbl.configure(
                text=f"✅ Richtig! {formula.result_symbol} = {task['result_value']}",
                text_color=COLORS["success"])
        else:
            expr_entry.configure(border_color=COLORS["danger"])
            feedback_lbl.configure(
                text=f"❌ Falsch. Richtig: {task['result_value']}"
                     + (f" (dein Ergebnis: {user_result})" if user_result is not None else ""),
                text_color=COLORS["danger"])

        state["idx"] += 1
        self.after(1800, lambda: next_fn(state["idx"]))

    btn_frame = ctk.CTkFrame(card, fg_color="transparent")
    btn_frame.grid(row=7, column=0, sticky="ew", padx=14, pady=(0, 14))
    ctk.CTkButton(btn_frame, text="✓ Prüfen", fg_color=COLORS["primary"], height=40,
                  font=("Segoe UI", 14, "bold"), command=check
                  ).grid(row=0, column=0, padx=(0, 8))

    def show_hint():
        feedback_lbl.configure(text=f"💡 {task.get('hint', formula.description or '')}",
                               text_color=COLORS["info"])
    ctk.CTkButton(btn_frame, text="💡 Hinweis", fg_color=COLORS["warning"], height=40,
                  font=("Segoe UI", 13), command=show_hint
                  ).grid(row=0, column=1)

    expr_entry.bind("<Return>", lambda e: check())


# ── End Screen ──────────────────────────────────────────────────────────
def _show_scaffold_end(self, parent, state, sheet, stage):
    """Show results after completing all formulas."""
    for w in parent.winfo_children():
        w.destroy()

    pct = round(state["correct"] / state["total"] * 100) if state["total"] else 0
    color = COLORS["success"] if pct >= 70 else COLORS["warning"] if pct >= 40 else COLORS["danger"]

    card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                        border_width=1, border_color=COLORS["border"])
    card.grid(row=0, column=0, sticky="ew", pady=20)
    card.grid_columnconfigure(0, weight=1)

    ctk.CTkLabel(card, text="🏁 Training abgeschlossen!",
                 font=("Segoe UI", 20, "bold"), text_color=COLORS["text"]
                 ).grid(row=0, column=0, pady=(20, 8))

    ctk.CTkLabel(card, text=f"{state['correct']} / {state['total']} richtig ({pct}%)",
                 font=("Segoe UI", 28, "bold"), text_color=color
                 ).grid(row=1, column=0, pady=(0, 4))

    bar = ctk.CTkProgressBar(card, height=10, progress_color=color)
    bar.set(pct / 100)
    bar.grid(row=2, column=0, sticky="ew", padx=60, pady=(4, 8))

    verdict = ("Hervorragend! 🎉" if pct >= 90 else
               "Solide! 👍" if pct >= 70 else
               "Weiter üben! 💪" if pct >= 40 else
               "Formeln nochmal anschauen 📖")
    ctk.CTkLabel(card, text=verdict, font=("Segoe UI", 15),
                 text_color=COLORS["text_light"]).grid(row=3, column=0, pady=(0, 16))

    btn_frame = ctk.CTkFrame(card, fg_color="transparent")
    btn_frame.grid(row=4, column=0, pady=(0, 20))
    ctk.CTkButton(btn_frame, text="🔁 Nochmal", fg_color=COLORS["primary"], height=40,
                  font=("Segoe UI", 14, "bold"),
                  command=lambda: _run_scaffold(self, sheet, stage)
                  ).grid(row=0, column=0, padx=8)
    ctk.CTkButton(btn_frame, text="📊 Andere Stufe", fg_color=COLORS["info"], height=40,
                  font=("Segoe UI", 13), command=self.show_scaffold
                  ).grid(row=0, column=1, padx=8)
    ctk.CTkButton(btn_frame, text="🏠 Home", fg_color=COLORS["card"], height=40,
                  text_color=COLORS["text"], border_width=1, border_color=COLORS["border"],
                  font=("Segoe UI", 13), command=self.show_home
                  ).grid(row=0, column=2, padx=8)
