"""Statistics screen (stats overview, bar charts, activity heatmap).

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


def show_stats(self):
    self._clear_main()
    self.header_subtitle.configure(text=t("stats.title"))
    scroll = self._make_screen()

    ctk.CTkLabel(scroll, text=t("stats.title"), font=("Segoe UI", 20, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 15))

    stats = self.store.load_stats()
    if not stats:
        ctk.CTkLabel(scroll, text=t("stats.no_data"), font=("Segoe UI", 13),
                    text_color=COLORS["text_light"]).grid(row=1, column=0, pady=30)
        ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=2, column=0, sticky="w", pady=15)
        return

    days = sorted(stats.keys())[-14:]  # last 14 days with activity
    answered = [stats[d]["answered"] for d in days]
    correct = [stats[d]["correct"] for d in days]
    accuracy = [(c / a * 100 if a else 0) for a, c in zip(answered, correct)]

    total_answered = sum(v["answered"] for v in stats.values())
    total_correct = sum(v["correct"] for v in stats.values())
    total_pct = (total_correct / total_answered * 100) if total_answered else 0

    ctk.CTkLabel(scroll, text=t("stats.totals", answered=total_answered,
                                correct=total_correct, pct=total_pct),
                font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                ).grid(row=1, column=0, sticky="w", pady=(0, 15))

    labels = [d[5:] for d in days]  # MM-DD

    self._bar_chart(scroll, 2, t("stats.per_day"), labels, answered, COLORS["primary"])
    self._bar_chart(scroll, 3, t("stats.accuracy"), labels, accuracy,
                    COLORS["success"], max_value=100, suffix="%")

    # Box distribution across all quizzes
    all_qids = [q.id for quiz in self.quizzes for q in quiz.questions]
    box_counts = self.sr.get_box_counts(all_qids)
    box_vals = [box_counts.get(b, 0) for b in range(1, 6)]
    self._bar_chart(scroll, 4, t("stats.box_dist"),
                    ["1", "2", "3", "4", "5"], box_vals,
                    COLORS["warning"], colors=[COLORS[f"box{b}"] for b in range(1, 6)])

    # Heatmap
    self._draw_heatmap(scroll, 5)

    # Streak info
    current_streak, max_streak = self.store.get_streak()
    streak_text = t("streak.current", n=current_streak) + "  ·  " + t("streak.best", n=max_streak)
    ctk.CTkLabel(scroll, text=streak_text, font=("Segoe UI", 13, "bold"),
                text_color=COLORS["warning"]).grid(row=6, column=0, sticky="w", pady=(0, 10))

    # Error diary link
    diary = self.store.load_error_diary()
    if diary:
        ctk.CTkButton(scroll, text=t("diary.open_full", n=len(diary)),
                     fg_color=COLORS["danger"], font=("Segoe UI", 12),
                     command=self.show_error_diary).grid(row=7, column=0, sticky="w", pady=(0, 10))

    ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                 command=self.show_home).grid(row=8, column=0, sticky="w", pady=15)

def _bar_chart(self, parent, row, title, labels, values, color,
               max_value=None, suffix="", colors=None):
    """Render a simple bar chart on a tkinter Canvas."""
    card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=RADIUS_MD,
                        border_width=1, border_color=COLORS["border"])
    card.grid(row=row, column=0, sticky="ew", pady=(0, 12))
    card.grid_columnconfigure(0, weight=1)
    self._bind_card_hover(card)
    ctk.CTkLabel(card, text=title, font=("Segoe UI", 14, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(10, 5), sticky="w")

    n = max(1, len(values))
    bar_w = 46
    gap = 18
    width = max(400, n * (bar_w + gap) + gap)
    height = 200
    top_pad, bottom_pad = 15, 30
    canvas = tk.Canvas(card, width=width, height=height, bg=COLORS["canvas_bg"],
                       highlightthickness=0)
    canvas.grid(row=1, column=0, padx=15, pady=(0, 12), sticky="w")

    mv = max_value if max_value is not None else (max(values) if values and max(values) > 0 else 1)
    usable = height - top_pad - bottom_pad
    for i, v in enumerate(values):
        x0 = gap + i * (bar_w + gap)
        bar_h = (v / mv) * usable if mv else 0
        y1 = height - bottom_pad
        y0 = y1 - bar_h
        bcolor = colors[i] if colors else color
        canvas.create_rectangle(x0, y0, x0 + bar_w, y1, fill=bcolor, outline="")
        val_txt = f"{v:.0f}{suffix}" if suffix else f"{v:.0f}"
        canvas.create_text(x0 + bar_w / 2, y0 - 8, text=val_txt,
                           font=("Segoe UI", 9, "bold"), fill=COLORS["text"])
        canvas.create_text(x0 + bar_w / 2, height - bottom_pad / 2, text=str(labels[i]),
                           font=("Segoe UI", 8), fill=COLORS["text_light"])

# ── HEATMAP (GitHub-style) ──

def _draw_heatmap(self, parent, row_idx):
    card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=RADIUS_MD,
                        border_width=1, border_color=COLORS["border"])
    card.grid(row=row_idx, column=0, sticky="ew", pady=(0, 12))
    card.grid_columnconfigure(0, weight=1)
    self._bind_card_hover(card)
    ctk.CTkLabel(card, text=t("stats.heatmap"), font=("Segoe UI", 14, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(10, 5), sticky="w")

    stats = self.store.load_stats()
    today = date.today()
    weeks = 13
    cell = 14
    gap = 2
    cols = weeks
    rows = 7
    width = cols * (cell + gap) + 50
    height = rows * (cell + gap) + 25
    canvas = tk.Canvas(card, width=width, height=height, bg=COLORS["canvas_bg"],
                       highlightthickness=0)
    canvas.grid(row=1, column=0, padx=15, pady=(0, 12), sticky="w")

    day_labels = ["Mo", "", "Mi", "", "Fr", "", "So"]
    for i, lbl in enumerate(day_labels):
        if lbl:
            canvas.create_text(18, i * (cell + gap) + cell // 2,
                               text=lbl, font=("Segoe UI", 8), fill=COLORS["text_light"])

    start = today - __import__("datetime").timedelta(days=weeks * 7 - 1)
    start = start - __import__("datetime").timedelta(days=start.weekday())

    max_val = max((s.get("answered", 0) for s in stats.values()), default=1) or 1
    greens = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"]
    dark_greens = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]
    palette = dark_greens if is_dark() else greens

    d = start
    for week in range(weeks):
        for dow in range(7):
            if d > today:
                d += __import__("datetime").timedelta(days=1)
                continue
            key = d.isoformat()
            val = stats.get(key, {}).get("answered", 0)
            if val == 0:
                ci = 0
            else:
                ci = min(4, max(1, int(val / max_val * 4)))
            x = 35 + week * (cell + gap)
            y = dow * (cell + gap)
            canvas.create_rectangle(x, y, x + cell, y + cell,
                                    fill=palette[ci], outline="")
            d += __import__("datetime").timedelta(days=1)

# ── ERROR DIARY ──

