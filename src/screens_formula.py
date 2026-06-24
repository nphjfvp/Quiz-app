"""Formula sheet screens (formula sheets list, create, view, explorer, explain).

These methods are mixed into the App class via binding in app.py.
"""

import os
import sys
import random
import threading
import time
from datetime import datetime, date
from pathlib import Path
from tkinter import filedialog, messagebox, StringVar, IntVar, BooleanVar
import tkinter as tk
import customtkinter as ctk

try:
    from PIL import Image, ImageTk
except ImportError:
    Image = None
    ImageTk = None

import json

from .models import (
    Quiz, Question, QuestionType, Option, DragDropPair, DiagramLabel, DataStore,
    FormulaSheet, Formula, Folder, MemoryEntry,
)
from .quiz_engine import QuizSession, SpacedRepetition, AnswerResult, DeadlinePlanner
from .ai_service import AIService
from .fsrs import FSRSScheduler, FSRSCard, to_dict as fsrs_to_dict, from_dict as fsrs_from_dict
from .theme import COLORS, apply_theme, is_dark, RADIUS_SM, RADIUS_MD, RADIUS_LG, RADIUS_XL, animate_color
from .i18n import t, set_language, get_language
from .latex_render import has_latex, split_text_and_formulas, render_formula, latex_to_plain, can_render as can_render_latex


def show_formula_sheets(self):
    self._clear_main()
    scroll = self._make_screen()

    ctk.CTkLabel(scroll, text=t("fosa.title"), font=("Segoe UI", 18, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 5))
    ctk.CTkLabel(scroll, text=t("fosa.intro"), font=("Segoe UI", 12),
                 text_color=COLORS["text_light"]).grid(row=1, column=0, sticky="w", pady=(0, 15))

    ctk.CTkButton(scroll, text=t("fosa.new"), fg_color=COLORS["success"],
                  command=self.show_create_formula_sheet
                  ).grid(row=2, column=0, sticky="w", pady=(0, 15))

    if not self.formula_sheets:
        ctk.CTkLabel(scroll, text=t("fosa.empty"), font=("Segoe UI", 13),
                     text_color=COLORS["text_light"]).grid(row=3, column=0, pady=30)
    else:
        for i, sheet in enumerate(self.formula_sheets):
            card = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=12,
                                border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
            card.grid(row=3 + i, column=0, sticky="ew", pady=5)
            card.grid_columnconfigure(1, weight=1)
            ctk.CTkFrame(card, fg_color=COLORS["primary"], width=5, corner_radius=3
                         ).grid(row=0, column=0, rowspan=2, sticky="ns", pady=8)
            info = ctk.CTkFrame(card, fg_color="transparent")
            info.grid(row=0, column=1, padx=15, pady=10, sticky="w")
            ctk.CTkLabel(info, text=sheet.name, font=("Segoe UI", 15, "bold"),
                         text_color=COLORS["text"]).grid(row=0, column=0, sticky="w")
            sub = sheet.subject + "  ·  " if sheet.subject else ""
            ctk.CTkLabel(info, text=f"{sub}{t('fosa.count', n=len(sheet.formulas))}",
                         font=("Segoe UI", 11), text_color=COLORS["text_light"]
                         ).grid(row=1, column=0, sticky="w")
            btns = ctk.CTkFrame(card, fg_color="transparent")
            btns.grid(row=0, column=2, padx=10, pady=10)
            ctk.CTkButton(btns, text=t("home.open"), width=75, height=30, corner_radius=RADIUS_MD,
                          fg_color=COLORS["primary"], font=("Segoe UI", 12, "bold"),
                          command=lambda s=sheet: self.show_formula_sheet_view(s)
                          ).grid(row=0, column=0, padx=3)
            ctk.CTkButton(btns, text="✕", width=30, height=30, corner_radius=RADIUS_MD,
                          fg_color=COLORS["danger"],
                          command=lambda s=sheet: self._delete_formula_sheet(s)
                          ).grid(row=0, column=1, padx=3)

    ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                  command=self.show_home).grid(row=3 + len(self.formula_sheets) + 1,
                                               column=0, sticky="w", pady=15)

def _delete_formula_sheet(self, sheet):
    if messagebox.askyesno(t("fosa.title"), t("fosa.delete_confirm", name=sheet.name)):
        self.formula_sheets = [s for s in self.formula_sheets if s.id != sheet.id]
        self.store.save_formula_sheets(self.formula_sheets)
        self.show_formula_sheets()

def show_create_formula_sheet(self):
    self._clear_main()
    scroll = self._make_screen()

    ctk.CTkLabel(scroll, text=t("fosa.new"), font=("Segoe UI", 18, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 5))
    ctk.CTkLabel(scroll, text=t("fosa.new_sub"), font=("Segoe UI", 12),
                 text_color=COLORS["text_light"]).grid(row=1, column=0, sticky="w", pady=(0, 20))

    file_var = StringVar()
    file_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    file_frame.grid(row=2, column=0, sticky="ew")
    ctk.CTkEntry(file_frame, textvariable=file_var, width=400,
                 placeholder_text=t("fosa.pick_file")).grid(row=0, column=0, padx=(0, 10))

    def pick():
        path = self._file_dialog_with_pdf()
        if path:
            file_var.set(path)
            if not name_entry.get().strip():
                name_entry.insert(0, Path(path).stem)
    ctk.CTkButton(file_frame, text=t("fosa.browse"), width=100, command=pick
                  ).grid(row=0, column=1)

    ctk.CTkLabel(scroll, text=t("fosa.name"), font=("Segoe UI", 13, "bold")
                 ).grid(row=3, column=0, sticky="w", pady=(15, 0))
    name_entry = ctk.CTkEntry(scroll, width=400, placeholder_text=t("fosa.name_ph"))
    name_entry.grid(row=4, column=0, sticky="w", pady=5)

    progress_label = ctk.CTkLabel(scroll, text="", font=("Segoe UI", 12),
                                  text_color=COLORS["primary"])
    progress_label.grid(row=5, column=0, sticky="w", pady=10)
    progress_bar = ctk.CTkProgressBar(scroll, width=400)
    progress_bar.grid(row=6, column=0, sticky="w")
    progress_bar.set(0)

    def build():
        if not file_var.get():
            messagebox.showwarning("Hinweis", t("fosa.no_file"))
            return
        if not self.ai.api_key:
            messagebox.showwarning("Hinweis", t("fosa.no_key"))
            return

        def run():
            def progress_cb(current, total):
                self.after(0, lambda c=current, tt=total: (
                    progress_label.configure(text=t("fosa.progress", c=c, t=tt)),
                    progress_bar.set(c / tt),
                ))
            try:
                sheet = self.ai.build_formula_sheet(
                    file_var.get(), name=name_entry.get().strip(),
                    progress_callback=progress_cb)
            except Exception as exc:
                msg = str(exc)
                self.after(0, lambda m=msg: messagebox.showerror("Fehler", m))
                return

            def done():
                if sheet.formulas:
                    self.formula_sheets.append(sheet)
                    self.store.save_formula_sheets(self.formula_sheets)
                    messagebox.showinfo(t("fosa.title"),
                                        t("fosa.done", n=len(sheet.formulas)))
                    self.show_formula_sheet_view(sheet)
                else:
                    progress_label.configure(text=t("fosa.none"))
            self.after(0, done)

        threading.Thread(target=run, daemon=True).start()

    btn_f = ctk.CTkFrame(scroll, fg_color="transparent")
    btn_f.grid(row=7, column=0, sticky="w", pady=15)
    ctk.CTkButton(btn_f, text=t("fosa.generate"), fg_color=COLORS["success"],
                  command=build).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkButton(btn_f, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                  command=self.show_formula_sheets).grid(row=0, column=1)

def show_formula_sheet_view(self, sheet):
    self._clear_main()
    scroll = self._make_screen()

    ctk.CTkLabel(scroll, text=sheet.name, font=("Segoe UI", 18, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 2))
    sub = sheet.subject + "  ·  " if sheet.subject else ""
    ctk.CTkLabel(scroll, text=f"{sub}{t('fosa.count', n=len(sheet.formulas))}",
                 font=("Segoe UI", 12), text_color=COLORS["text_light"]
                 ).grid(row=1, column=0, sticky="w", pady=(0, 15))

    row = 2
    for f in sheet.formulas:
        card = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=12,
                            border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
        card.grid(row=row, column=0, sticky="ew", pady=6)
        card.grid_columnconfigure(0, weight=1)
        head = f.name
        if f.category:
            head += f"   [{f.category}]"
        ctk.CTkLabel(card, text=head, font=("Segoe UI", 14, "bold"),
                     text_color=COLORS["text"]).grid(row=0, column=0, sticky="w",
                                                     padx=15, pady=(12, 4))
        # LaTeX (rendered if possible, else plain)
        if f.latex:
            img = render_formula(f.latex, fontsize=18) if can_render_latex() else None
            if img is not None:
                ctk_img = ctk.CTkImage(light_image=img, dark_image=img,
                                       size=(img.width, img.height))
                lbl = ctk.CTkLabel(card, image=ctk_img, text="")
                lbl.image = ctk_img
                lbl.grid(row=1, column=0, sticky="w", padx=15, pady=4)
            else:
                ctk.CTkLabel(card, text=latex_to_plain(f"${f.latex}$"),
                             font=("Consolas", 13), text_color=COLORS["text"]
                             ).grid(row=1, column=0, sticky="w", padx=15, pady=4)
        if f.variables:
            vars_txt = "  ·  ".join(
                f"{v.symbol}: {v.name}" + (f" [{v.unit}]" if v.unit else "")
                for v in f.variables)
            ctk.CTkLabel(card, text=vars_txt, font=("Segoe UI", 11),
                         text_color=COLORS["text_light"], wraplength=700, justify="left"
                         ).grid(row=2, column=0, sticky="w", padx=15, pady=(2, 4))
        if f.description:
            ctk.CTkLabel(card, text=f.description, font=("Segoe UI", 11),
                         text_color=COLORS["text_light"], wraplength=700, justify="left"
                         ).grid(row=3, column=0, sticky="w", padx=15, pady=(0, 4))

        # Action buttons per formula
        btn_row = ctk.CTkFrame(card, fg_color="transparent")
        btn_row.grid(row=4, column=0, sticky="w", padx=15, pady=(2, 12))
        if f.expression and f.variables:
            ctk.CTkButton(btn_row, text="Interaktiv", width=90, height=28,
                         corner_radius=RADIUS_SM, fg_color=COLORS["success"],
                         command=lambda fm=f: self._show_formula_explorer(fm, sheet)
                         ).grid(row=0, column=0, padx=(0, 5))
        ctk.CTkButton(btn_row, text="KI erklären", width=90, height=28,
                     corner_radius=RADIUS_SM, fg_color=COLORS["primary"],
                     command=lambda fm=f: self._show_formula_explain(fm, sheet)
                     ).grid(row=0, column=1)
        row += 1

    ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                  command=self.show_formula_sheets).grid(row=row, column=0, sticky="w", pady=15)

def _show_formula_explorer(self, formula: Formula, sheet):
    """Interactive slider view: adjust variables, see result change live."""
    self._clear_main()
    scroll = self._make_screen()

    ctk.CTkLabel(scroll, text=formula.name, font=("Segoe UI", 20, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 5))

    # Show formula image
    if formula.latex and can_render_latex():
        img = render_formula(formula.latex, fontsize=22)
        if img:
            ctk_img = ctk.CTkImage(light_image=img, dark_image=img,
                                   size=(img.width, img.height))
            lbl = ctk.CTkLabel(scroll, image=ctk_img, text="")
            lbl.image = ctk_img
            lbl.grid(row=1, column=0, sticky="w", pady=(0, 15))

    # Result display
    result_var = StringVar(value="–")
    result_frame = ctk.CTkFrame(scroll, fg_color=COLORS["success"], corner_radius=RADIUS_MD)
    result_frame.grid(row=2, column=0, sticky="ew", pady=(0, 15))
    result_frame.grid_columnconfigure(1, weight=1)
    ctk.CTkLabel(result_frame, text=f"{formula.result_symbol} =",
                font=("Segoe UI", 20, "bold"), text_color="white"
                ).grid(row=0, column=0, padx=15, pady=10)
    result_label = ctk.CTkLabel(result_frame, textvariable=result_var,
                               font=("Segoe UI", 24, "bold"), text_color="white")
    result_label.grid(row=0, column=1, padx=10, pady=10, sticky="w")

    # Sliders for each variable
    slider_vars = {}
    slider_entries = {}

    def recalculate(*_):
        try:
            local_vars = {}
            for v in formula.variables:
                if v.symbol == formula.result_symbol:
                    continue
                val = slider_vars[v.symbol].get()
                local_vars[v.symbol] = val
                slider_entries[v.symbol].delete(0, "end")
                slider_entries[v.symbol].insert(0, f"{val:.3g}")
            import math as _math
            safe = {"__builtins__": {}, "abs": abs, "sqrt": _math.sqrt,
                    "sin": _math.sin, "cos": _math.cos, "tan": _math.tan,
                    "log": _math.log, "pi": _math.pi, "e": _math.e,
                    "exp": _math.exp, "pow": pow}
            safe.update(local_vars)
            res = eval(formula.expression, safe)
            result_var.set(f"{res:.4g}")
        except Exception:
            result_var.set("–")

    def on_entry_change(symbol):
        try:
            val = float(slider_entries[symbol].get())
            slider_vars[symbol].set(val)
            recalculate()
        except ValueError:
            pass

    row = 3
    for v in formula.variables:
        if v.symbol == formula.result_symbol:
            continue
        vf = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_MD)
        vf.grid(row=row, column=0, sticky="ew", pady=3)
        vf.grid_columnconfigure(1, weight=1)

        label_text = f"{v.symbol}"
        if v.name:
            label_text += f" ({v.name})"
        if v.unit:
            label_text += f" [{v.unit}]"
        ctk.CTkLabel(vf, text=label_text, font=("Segoe UI", 12, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(8, 2), sticky="w")

        sv = tk.DoubleVar(value=1.0)
        slider_vars[v.symbol] = sv

        slider = ctk.CTkSlider(vf, from_=0.01, to=100, variable=sv,
                              command=lambda val, s=v.symbol: recalculate())
        slider.grid(row=1, column=0, columnspan=2, sticky="ew", padx=15, pady=(0, 2))

        entry = ctk.CTkEntry(vf, width=80, font=("Segoe UI", 12))
        entry.insert(0, "1.0")
        entry.grid(row=0, column=1, padx=15, pady=(8, 2), sticky="e")
        entry.bind("<Return>", lambda e, s=v.symbol: on_entry_change(s))
        slider_entries[v.symbol] = entry

        row += 1

    recalculate()

    ctk.CTkButton(scroll, text=t("nav.back"), fg_color=COLORS["text_light"],
                 command=lambda: self.show_formula_sheet_view(sheet)
                 ).grid(row=row, column=0, sticky="w", pady=15)

def _show_formula_explain(self, formula: Formula, sheet):
    """AI explanation of a formula with style selection."""
    self._clear_main()
    scroll = self._make_screen()

    ctk.CTkLabel(scroll, text=formula.name, font=("Segoe UI", 20, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 5))

    # Show formula
    if formula.latex and can_render_latex():
        img = render_formula(formula.latex, fontsize=20)
        if img:
            ctk_img = ctk.CTkImage(light_image=img, dark_image=img,
                                   size=(img.width, img.height))
            lbl = ctk.CTkLabel(scroll, image=ctk_img, text="")
            lbl.image = ctk_img
            lbl.grid(row=1, column=0, sticky="w", pady=(0, 15))

    # Style selector
    style_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_MD)
    style_frame.grid(row=2, column=0, sticky="ew", pady=(0, 10))
    ctk.CTkLabel(style_frame, text="Erklär-Stil wählen:", font=("Segoe UI", 13, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(10, 5), sticky="w")

    styles = [
        ("Brain Rot 🧠", "brain_rot"),
        ("Wissenschaftlich 🔬", "wissenschaftlich"),
        ("Klasse 1-4 🎒", "klasse_1_4"),
        ("Klasse 5-7 📐", "klasse_5_7"),
        ("Klasse 8-10 🧮", "klasse_8_10"),
        ("Klasse 11-13 🎓", "klasse_11_13"),
    ]

    style_var = StringVar(value="wissenschaftlich")
    btn_frame = ctk.CTkFrame(style_frame, fg_color="transparent")
    btn_frame.grid(row=1, column=0, padx=15, pady=(0, 10), sticky="w")
    for i, (label, key) in enumerate(styles):
        ctk.CTkRadioButton(btn_frame, text=label, variable=style_var, value=key,
                          font=("Segoe UI", 12)).grid(row=i // 3, column=i % 3, padx=10, pady=3, sticky="w")

    # Output area
    output_box = ctk.CTkTextbox(scroll, width=700, height=350, font=("Segoe UI", 12),
                                state="disabled")
    loading_label = ctk.CTkLabel(scroll, text="", font=("Segoe UI", 12),
                                text_color=COLORS["text_light"])

    def generate():
        loading_label.configure(text="KI generiert Erklärung...")
        loading_label.grid(row=4, column=0, sticky="w", pady=5)
        output_box.grid_forget()

        def _run():
            vars_data = [{"symbol": v.symbol, "name": v.name, "unit": v.unit}
                        for v in formula.variables]
            result = self.ai.explain_formula(
                formula.name, formula.latex, vars_data, style_var.get())
            def _show():
                loading_label.grid_forget()
                output_box.grid(row=4, column=0, sticky="ew", pady=5)
                output_box.configure(state="normal")
                output_box.delete("1.0", "end")
                output_box.insert("1.0", result or "Keine Erklärung erhalten.")
                output_box.configure(state="disabled")
            self.after(0, _show)

        threading.Thread(target=_run, daemon=True).start()

    ctk.CTkButton(scroll, text="Erklärung generieren", fg_color=COLORS["primary"],
                 height=36, font=("Segoe UI", 13, "bold"),
                 command=generate).grid(row=3, column=0, sticky="w", pady=5)

    ctk.CTkButton(scroll, text=t("nav.back"), fg_color=COLORS["text_light"],
                 command=lambda: self.show_formula_sheet_view(sheet)
                 ).grid(row=5, column=0, sticky="w", pady=15)

