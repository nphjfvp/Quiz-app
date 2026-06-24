"""Folder screens (folder list, detail, add/remove quizzes, start folder quiz).

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


def show_folders(self):
    self._clear_main()
    self.header_subtitle.configure(text=t("folder.title"))
    scroll = self._make_screen()

    ctk.CTkLabel(scroll, text=t("folder.title"), font=("Segoe UI", 20, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 5))

    # New folder button
    new_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    new_frame.grid(row=1, column=0, sticky="w", pady=(5, 15))
    name_entry = ctk.CTkEntry(new_frame, width=250, placeholder_text=t("folder.name_ph"))
    name_entry.grid(row=0, column=0, padx=(0, 10))

    def create_folder():
        name = name_entry.get().strip()
        if not name:
            return
        from datetime import date as _date
        folder = Folder(name=name, created=_date.today().isoformat())
        self.folders.append(folder)
        self.store.save_folders(self.folders)
        self.show_folders()

    ctk.CTkButton(new_frame, text=t("folder.new"), fg_color=COLORS["success"],
                 command=create_folder).grid(row=0, column=1)

    if not self.folders:
        ctk.CTkLabel(scroll, text=t("folder.empty"), font=("Segoe UI", 13),
                    text_color=COLORS["text_light"]).grid(row=2, column=0, pady=20)
    else:
        for i, folder in enumerate(self.folders):
            self._folder_card(scroll, folder, row=2 + i)

    ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                 command=self.show_home).grid(row=2 + len(self.folders), column=0, pady=20)

def _folder_card(self, parent, folder: Folder, row: int):
    card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=RADIUS_MD,
                       border_width=1, border_color=COLORS["border"])
    card.grid(row=row, column=0, sticky="ew", pady=5)
    card.grid_columnconfigure(1, weight=1)
    self._bind_card_hover(card, accent_color=COLORS["primary_dark"])

    accent = ctk.CTkFrame(card, fg_color=COLORS["primary_dark"], width=5, corner_radius=3)
    accent.grid(row=0, column=0, rowspan=2, sticky="ns", padx=(0, 0), pady=8)

    info = ctk.CTkFrame(card, fg_color="transparent")
    info.grid(row=0, column=1, padx=15, pady=(10, 2), sticky="w")
    ctk.CTkLabel(info, text=folder.name, font=("Segoe UI", 15, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, sticky="w")
    n_quizzes = len(folder.quiz_ids)
    all_questions = sum(len(q.questions) for q in self.quizzes if q.id in folder.quiz_ids)
    ctk.CTkLabel(info, text=f"{t('folder.quizzes', n=n_quizzes)} · {all_questions} Fragen",
                font=("Segoe UI", 11), text_color=COLORS["text_light"]
                ).grid(row=1, column=0, sticky="w")

    btns = ctk.CTkFrame(card, fg_color="transparent")
    btns.grid(row=0, column=2, padx=10, pady=10)
    ctk.CTkButton(btns, text=t("home.open"), width=75, height=30, corner_radius=RADIUS_MD,
                 fg_color=COLORS["primary"],
                 command=lambda f=folder: self.show_folder_detail(f)).grid(row=0, column=0, padx=3)
    ctk.CTkButton(btns, text="✕", width=30, height=30, corner_radius=RADIUS_MD,
                 fg_color=COLORS["danger"],
                 command=lambda f=folder: self._delete_folder(f)).grid(row=0, column=1, padx=3)

def _delete_folder(self, folder: Folder):
    if messagebox.askyesno("Ordner löschen", t("folder.delete_confirm", name=folder.name)):
        self.folders = [f for f in self.folders if f.id != folder.id]
        self.store.save_folders(self.folders)
        self.show_folders()

def show_folder_detail(self, folder: Folder):
    self._clear_main()
    self.header_subtitle.configure(text=folder.name)
    scroll = self._make_screen()

    ctk.CTkLabel(scroll, text=folder.name, font=("Segoe UI", 20, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 10))

    # Quizzes in this folder
    folder_quizzes = [q for q in self.quizzes if q.id in folder.quiz_ids]
    row = 1
    if folder_quizzes:
        for i, quiz in enumerate(folder_quizzes):
            qf = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_MD,
                               border_width=1, border_color=COLORS["border"])
            qf.grid(row=row + i, column=0, sticky="ew", pady=3)
            qf.grid_columnconfigure(1, weight=1)
            self._bind_card_hover(qf)
            ctk.CTkLabel(qf, text=quiz.name, font=("Segoe UI", 13, "bold"),
                        text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=8, sticky="w")
            ctk.CTkLabel(qf, text=f"{len(quiz.questions)} Fragen", font=("Segoe UI", 11),
                        text_color=COLORS["text_light"]).grid(row=0, column=1, padx=10, pady=8, sticky="w")
            ctk.CTkButton(qf, text=t("card.learn"), width=65, height=28, corner_radius=RADIUS_SM,
                         fg_color=COLORS["primary"],
                         command=lambda q=quiz: self.show_quiz_modes(q)).grid(row=0, column=2, padx=5, pady=5)
            ctk.CTkButton(qf, text=t("folder.remove_quiz"), width=75, height=28, corner_radius=RADIUS_SM,
                         fg_color=COLORS["danger"],
                         command=lambda q=quiz: self._remove_quiz_from_folder(folder, q)).grid(row=0, column=3, padx=5, pady=5)
        row += len(folder_quizzes)
    else:
        ctk.CTkLabel(scroll, text=t("folder.no_quizzes"), font=("Segoe UI", 12),
                    text_color=COLORS["text_light"]).grid(row=row, column=0, pady=10)
        row += 1

    # Learn all button
    if folder_quizzes:
        all_questions = []
        for q in folder_quizzes:
            all_questions.extend(q.questions)
        if all_questions:
            ctk.CTkButton(scroll, text=f"{t('folder.learn_all')} ({len(all_questions)} Fragen)",
                         fg_color=COLORS["success"], height=40, corner_radius=RADIUS_MD,
                         font=("Segoe UI", 14, "bold"),
                         command=lambda: self._start_folder_quiz(folder_quizzes)
                         ).grid(row=row, column=0, sticky="ew", pady=(10, 15))
            row += 1

    # Add quiz section
    ctk.CTkLabel(scroll, text=t("folder.available"), font=("Segoe UI", 14, "bold"),
                text_color=COLORS["text"]).grid(row=row, column=0, sticky="w", pady=(15, 5))
    row += 1

    available = [q for q in self.quizzes if q.id not in folder.quiz_ids]
    if available:
        for i, quiz in enumerate(available):
            af = ctk.CTkFrame(scroll, fg_color=COLORS["row_neutral"], corner_radius=RADIUS_SM)
            af.grid(row=row + i, column=0, sticky="ew", pady=2)
            af.grid_columnconfigure(0, weight=1)
            ctk.CTkLabel(af, text=f"{quiz.name} ({len(quiz.questions)} Fragen)",
                        font=("Segoe UI", 12), text_color=COLORS["text"]
                        ).grid(row=0, column=0, padx=15, pady=6, sticky="w")
            ctk.CTkButton(af, text=t("folder.add_quiz"), width=100, height=28,
                         corner_radius=RADIUS_SM, fg_color=COLORS["primary"],
                         command=lambda q=quiz: self._add_quiz_to_folder(folder, q)
                         ).grid(row=0, column=1, padx=10, pady=4)
        row += len(available)
    else:
        ctk.CTkLabel(scroll, text="Alle Quizze bereits im Ordner.",
                    font=("Segoe UI", 12), text_color=COLORS["text_light"]
                    ).grid(row=row, column=0, pady=5)
        row += 1

    ctk.CTkButton(scroll, text=t("nav.back"), fg_color=COLORS["text_light"],
                 command=self.show_folders).grid(row=row, column=0, pady=20)

def _add_quiz_to_folder(self, folder: Folder, quiz: Quiz):
    if quiz.id not in folder.quiz_ids:
        folder.quiz_ids.append(quiz.id)
        self.store.save_folders(self.folders)
    self.show_folder_detail(folder)

def _remove_quiz_from_folder(self, folder: Folder, quiz: Quiz):
    folder.quiz_ids = [qid for qid in folder.quiz_ids if qid != quiz.id]
    self.store.save_folders(self.folders)
    self.show_folder_detail(folder)

def _start_folder_quiz(self, quizzes: list[Quiz]):
    all_questions = []
    for q in quizzes:
        all_questions.extend(q.questions)
    if not all_questions:
        return
    combined = Quiz(name="Alle Fragen", questions=all_questions)
    self.current_quiz = combined
    self.session = QuizSession(all_questions, mode="exam")
    self._show_question()

# ── RESULTS ──

