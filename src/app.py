"""Main application UI using CustomTkinter."""

import os
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
    FormulaSheet, Formula, Folder,
)
from .quiz_engine import QuizSession, SpacedRepetition, AnswerResult, DeadlinePlanner
from .ai_service import AIService
from .fsrs import FSRSScheduler, FSRSCard, to_dict as fsrs_to_dict, from_dict as fsrs_from_dict
from .theme import COLORS, apply_theme, is_dark
from .i18n import t, set_language, get_language
from .latex_render import has_latex, split_text_and_formulas, render_formula, latex_to_plain, can_render as can_render_latex
from . import cloud_sync

ctk.set_default_color_theme("blue")


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title(t("app.title"))
        self.geometry("1100x750")
        self.minsize(800, 600)

        self.store = DataStore(str(Path(__file__).parent.parent / "data"))
        self.quizzes = self.store.load_quizzes()
        self.formula_sheets = self.store.load_formula_sheets()
        self.folders = self.store.load_folders()
        self.sr = SpacedRepetition(self.store)
        settings = self.store.load_settings()
        apply_theme(settings.get("dark_mode", False))
        set_language(settings.get("language", "de"))
        self.ai = AIService(
            api_key=settings.get("api_key", ""),
            model=settings.get("model", "deepseek/deepseek-chat"),
        )

        self.session: QuizSession | None = None
        self.current_quiz: Quiz | None = None
        self.timer_running = False
        self.fsrs = FSRSScheduler()
        self._fsrs_data: dict[str, dict] = self.store.load_fsrs()

        self._build_ui()
        self.show_home()

    def _build_ui(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self.header = ctk.CTkFrame(self, fg_color=COLORS["header_bg"], corner_radius=0, height=70)
        self.header.grid(row=0, column=0, sticky="ew")
        self.header.grid_columnconfigure(1, weight=1)

        self.header_title = ctk.CTkLabel(
            self.header, text=f"  {t('app.header')}", font=("Segoe UI", 22, "bold"),
            text_color="white"
        )
        self.header_title.grid(row=0, column=0, padx=(20, 5), pady=15)

        self.header_subtitle = ctk.CTkLabel(
            self.header, text=t("app.subtitle"),
            font=("Segoe UI", 12), text_color="#b8c6ff"
        )
        self.header_subtitle.grid(row=0, column=1, padx=10, pady=15, sticky="w")

        self.timer_label = ctk.CTkLabel(
            self.header, text="", font=("Arial", 14, "bold"),
            text_color="white", fg_color=COLORS["danger"],
            corner_radius=15, width=100
        )

        self.main_frame = ctk.CTkFrame(self, fg_color=COLORS["bg"])
        self.main_frame.grid(row=1, column=0, sticky="nsew")
        self.main_frame.grid_columnconfigure(0, weight=1)
        self.main_frame.grid_rowconfigure(0, weight=1)

    def _clear_main(self):
        for w in self.main_frame.winfo_children():
            w.destroy()
        self.timer_running = False
        self.timer_label.grid_forget()

    def _make_screen(self, padx=20, pady=20, max_width=900):
        """Create a centered, scrollable content area. Returns the inner frame to add widgets to."""
        outer = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        outer.grid(row=0, column=0, sticky="nsew")
        outer.grid_columnconfigure(0, weight=1)
        outer.grid_columnconfigure(2, weight=1)
        inner = ctk.CTkFrame(outer, fg_color="transparent", width=max_width)
        inner.grid(row=0, column=1, sticky="n", padx=padx, pady=pady)
        inner.grid_columnconfigure(0, weight=1)
        inner.grid_propagate(True)
        inner.configure(width=max_width)
        return inner

    # ── HOME SCREEN ──

    def show_home(self):
        self._clear_main()
        self.header_subtitle.configure(text=t("app.subtitle"))

        scroll = self._make_screen()

        # Welcome
        welcome = ctk.CTkFrame(scroll, fg_color=COLORS["primary"], corner_radius=12)
        welcome.grid(row=0, column=0, sticky="ew", pady=(0, 20))
        welcome.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(welcome, text=f"  {t('home.welcome')}",
                     font=("Segoe UI", 20, "bold"), text_color="white"
                     ).grid(row=0, column=0, padx=25, pady=(20, 5), sticky="w")
        ctk.CTkLabel(welcome, text=t("home.welcome_sub"),
                     font=("Segoe UI", 13), text_color="#d0deff"
                     ).grid(row=1, column=0, padx=25, pady=(0, 20), sticky="w")

        # Daily Learning Button - prominent at top
        daily_card = ctk.CTkFrame(scroll, fg_color=COLORS["primary"], corner_radius=12)
        daily_card.grid(row=1, column=0, sticky="ew", pady=(0, 15))
        daily_card.grid_columnconfigure(1, weight=1)
        daily_icon = ctk.CTkLabel(daily_card, text="📅", font=("Segoe UI", 28))
        daily_icon.grid(row=0, column=0, rowspan=2, padx=(20, 10), pady=15)
        ctk.CTkLabel(daily_card, text=t("daily.card_title"),
                     font=("Segoe UI", 17, "bold"), text_color="white"
                     ).grid(row=0, column=1, padx=5, pady=(15, 0), sticky="w")
        ctk.CTkLabel(daily_card, text=t("daily.card_desc"),
                     font=("Segoe UI", 12), text_color="#d0deff"
                     ).grid(row=1, column=1, padx=5, pady=(0, 15), sticky="w")
        ctk.CTkButton(daily_card, text=t("daily.start"), width=130, height=36,
                     corner_radius=8, fg_color="white", text_color=COLORS["primary"],
                     hover_color="#e0e8ff", font=("Segoe UI", 13, "bold"),
                     command=self.show_daily
                     ).grid(row=0, column=2, rowspan=2, padx=20, pady=15)

        # Actions (two rows of 4)
        actions = ctk.CTkFrame(scroll, fg_color="transparent")
        actions.grid(row=2, column=0, sticky="ew", pady=(0, 15))
        for i in range(4):
            actions.grid_columnconfigure(i, weight=1)

        cards = [
            (t("home.new_quiz"), t("home.new_quiz_sub"), COLORS["primary"], self.show_create_quiz),
            (t("home.ai_generate"), t("home.ai_generate_sub"), COLORS["success"], self.show_ai_generate),
            (t("home.import"), t("home.import_sub"), COLORS["warning"], self.show_ai_import),
            (t("home.stats"), t("home.stats_sub"), COLORS["primary_dark"], self.show_stats),
            (t("home.pomodoro"), t("home.pomodoro_sub"), COLORS["danger"], self.show_pomodoro),
            (t("home.import_quiz"), t("home.import_quiz_sub"), COLORS["warning"], self.import_quiz_file),
            (t("random.title"), t("random.sub"), COLORS["danger"], self.show_random_mode),
            (t("cloze.title"), t("cloze.sub"), COLORS["success"], self.show_cloze_generator),
            (t("folder.title"), t("folder.sub"), COLORS["primary_dark"], self.show_folders),
            (t("fosa.title"), t("fosa.sub"), COLORS["primary"], self.show_formula_sheets),
            (t("home.settings"), t("home.settings_sub"), COLORS["text_light"], self.show_settings),
        ]
        for idx, (title_, desc, color, command) in enumerate(cards):
            self._action_card(actions, idx % 4, idx // 4, title_, desc, color, command)

        # Marked questions card
        marked_ids = self.store.load_marked()
        if marked_ids:
            marked_card = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=12,
                                       border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
            marked_card.grid(row=3, column=0, sticky="ew", pady=(0, 15))
            marked_card.grid_columnconfigure(1, weight=1)
            accent = ctk.CTkFrame(marked_card, fg_color=COLORS["warning"], width=5, corner_radius=3)
            accent.grid(row=0, column=0, rowspan=2, sticky="ns", padx=(0, 0), pady=8)
            mc_info = ctk.CTkFrame(marked_card, fg_color="transparent")
            mc_info.grid(row=0, column=1, padx=15, pady=(10, 2), sticky="w")
            ctk.CTkLabel(mc_info, text=t("marked.card_title"), font=("Segoe UI", 15, "bold"),
                        text_color=COLORS["text"]).grid(row=0, column=0, sticky="w")
            ctk.CTkLabel(mc_info, text=t("marked.count", n=len(marked_ids)),
                        font=("Segoe UI", 11), text_color=COLORS["text_light"]
                        ).grid(row=1, column=0, sticky="w")
            ctk.CTkButton(marked_card, text=t("home.open"), width=75, height=30, corner_radius=8,
                         fg_color=COLORS["warning"], font=("Segoe UI", 12, "bold"),
                         command=self.show_marked).grid(row=0, column=2, padx=10, pady=10)
            quiz_list_start_row = 4
        else:
            quiz_list_start_row = 3

        # Quiz list
        if self.quizzes:
            ctk.CTkLabel(scroll, text=t("home.your_quizzes"), font=("Arial", 16, "bold"),
                        text_color=COLORS["text"]).grid(row=quiz_list_start_row, column=0, sticky="w", pady=(10, 10))
            for i, quiz in enumerate(self.quizzes):
                self._quiz_card(scroll, quiz, row=quiz_list_start_row + 1 + i)
        else:
            ctk.CTkLabel(scroll, text=t("home.no_quizzes"),
                        font=("Arial", 13), text_color=COLORS["text_light"]
                        ).grid(row=quiz_list_start_row, column=0, pady=30)

    def _action_card(self, parent, col, row, title, desc, color, command):
        card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=12,
                           border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
        card.grid(row=row, column=col, padx=6, pady=6, sticky="nsew")
        card.grid_columnconfigure(0, weight=1)

        color_bar = ctk.CTkFrame(card, fg_color=color, corner_radius=6, height=4)
        color_bar.grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 0))

        ctk.CTkLabel(card, text=title, font=("Segoe UI", 14, "bold"),
                    text_color=COLORS["text"]).grid(row=1, column=0, padx=15, pady=(10, 3))
        ctk.CTkLabel(card, text=desc, font=("Segoe UI", 11),
                    text_color=COLORS["text_light"], wraplength=160
                    ).grid(row=2, column=0, padx=15, pady=(0, 10))
        ctk.CTkButton(card, text=t("home.open"), fg_color=color, hover_color=color,
                     corner_radius=8, width=110, height=32,
                     font=("Segoe UI", 12, "bold"),
                     command=command).grid(row=3, column=0, padx=15, pady=(0, 14))

    def _quiz_card(self, parent, quiz: Quiz, row: int):
        card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=12,
                           border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
        card.grid(row=row, column=0, sticky="ew", pady=5)
        card.grid_columnconfigure(1, weight=1)

        accent = ctk.CTkFrame(card, fg_color=COLORS["primary"], width=5, corner_radius=3)
        accent.grid(row=0, column=0, rowspan=2, sticky="ns", padx=(0, 0), pady=8)

        info = ctk.CTkFrame(card, fg_color="transparent")
        info.grid(row=0, column=1, padx=15, pady=(10, 2), sticky="w")
        ctk.CTkLabel(info, text=quiz.name, font=("Segoe UI", 15, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w")
        weight_tag = f"  ⚖ {quiz.weight:.1f}" if quiz.weight != 1.0 else ""
        desc_text = f"{len(quiz.questions)} Fragen{weight_tag}"
        if quiz.description:
            desc_text += f"  ·  {quiz.description}"
        ctk.CTkLabel(info, text=desc_text, font=("Segoe UI", 11),
                    text_color=COLORS["text_light"]).grid(row=1, column=0, sticky="w")

        qids = [q.id for q in quiz.questions]
        counts = self.sr.get_box_counts(qids)
        boxes_frame = ctk.CTkFrame(card, fg_color="transparent")
        boxes_frame.grid(row=0, column=2, padx=10, pady=10)
        for b in range(1, 6):
            c = counts.get(b, 0)
            lbl = ctk.CTkLabel(boxes_frame, text=str(c), width=28, height=28,
                              corner_radius=14, fg_color=COLORS[f"box{b}"],
                              text_color="white", font=("Segoe UI", 11, "bold"))
            lbl.grid(row=0, column=b - 1, padx=2)

        btns = ctk.CTkFrame(card, fg_color="transparent")
        btns.grid(row=0, column=3, padx=10, pady=10)
        ctk.CTkButton(btns, text=t("card.learn"), width=75, height=30, corner_radius=8,
                     fg_color=COLORS["primary"], font=("Segoe UI", 12, "bold"),
                     command=lambda q=quiz: self.show_quiz_modes(q)).grid(row=0, column=0, padx=3)
        ctk.CTkButton(btns, text=t("card.edit"), width=75, height=30, corner_radius=8,
                     fg_color=COLORS["text_light"],
                     command=lambda q=quiz: self.show_edit_quiz(q)).grid(row=0, column=1, padx=3)
        ctk.CTkButton(btns, text=t("card.export"), width=65, height=30, corner_radius=8,
                     fg_color=COLORS["success"],
                     command=lambda q=quiz: self.export_quiz_file(q)).grid(row=0, column=2, padx=3)
        ctk.CTkButton(btns, text="✕", width=30, height=30, corner_radius=8,
                     fg_color=COLORS["danger"],
                     command=lambda q=quiz: self._delete_quiz(q)).grid(row=0, column=3, padx=3)

    def _delete_quiz(self, quiz: Quiz):
        if messagebox.askyesno("Quiz löschen", f"'{quiz.name}' wirklich löschen?"):
            self.quizzes = [q for q in self.quizzes if q.id != quiz.id]
            self.store.save_quizzes(self.quizzes)
            self.show_home()

    # ── DAILY LEARNING ──

    def show_daily(self):
        self._clear_main()
        self.header_subtitle.configure(text=t("daily.title"))
        scroll = self._make_screen()

        if not self.quizzes:
            ctk.CTkLabel(scroll, text=t("daily.no_quizzes"),
                        font=("Segoe UI", 14), text_color=COLORS["text_light"]
                        ).grid(row=0, column=0, pady=30)
            ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                         command=self.show_home).grid(row=1, column=0)
            return

        today = date.today().isoformat()
        state = self.store.load_daily_state()

        # Reset if new day
        if state.get("date") != today:
            state = self._create_daily_plan(today)

        question_ids = state.get("question_ids", [])
        completed = state.get("completed", [])
        wrong = state.get("wrong", [])
        quiz_plans = state.get("quiz_plans", [])

        # Title
        ctk.CTkLabel(scroll, text=t("daily.title"), font=("Segoe UI", 20, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 5))
        ctk.CTkLabel(scroll, text=t("daily.subtitle"), font=("Segoe UI", 13),
                    text_color=COLORS["text_light"]).grid(row=1, column=0, sticky="w", pady=(0, 15))

        # Progress bar
        total = len(question_ids)
        done = len(completed)
        progress_val = done / total if total > 0 else 0
        prog_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=10)
        prog_frame.grid(row=2, column=0, sticky="ew", pady=(0, 15))
        prog_frame.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(prog_frame, text=f"{t('daily.progress')}: {done}/{total}",
                    font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                    ).grid(row=0, column=0, padx=15, pady=(10, 5), sticky="w")
        pbar = ctk.CTkProgressBar(prog_frame, width=500)
        pbar.set(progress_val)
        pbar.grid(row=1, column=0, padx=15, pady=(0, 10), sticky="ew")

        # Quiz plan list
        row = 3
        for plan in quiz_plans:
            pf = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8,
                             border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
            pf.grid(row=row, column=0, sticky="ew", pady=3)
            pf.grid_columnconfigure(1, weight=1)
            accent_color = COLORS["danger"] if plan.get("urgency", 0) > 0.7 else COLORS["primary"]
            ctk.CTkFrame(pf, fg_color=accent_color, width=4, corner_radius=2
                        ).grid(row=0, column=0, sticky="ns", padx=(0, 0), pady=6)
            info_text = f"{plan['quiz_name']} ({t('daily.questions_n', n=plan['count'])})"
            if plan.get("exam_date"):
                try:
                    exam_d = date.fromisoformat(plan["exam_date"])
                    days_left = (exam_d - date.today()).days
                    if days_left >= 0:
                        info_text += f"  ·  {t('daily.exam_in', n=days_left)}"
                except ValueError:
                    pass
            ctk.CTkLabel(pf, text=info_text, font=("Segoe UI", 12),
                        text_color=COLORS["text"]).grid(row=0, column=1, padx=12, pady=8, sticky="w")
            row += 1

        # Determine remaining questions
        remaining = [qid for qid in question_ids if qid not in completed]

        if remaining:
            # Start learning button
            ctk.CTkButton(scroll, text=t("daily.start"), fg_color=COLORS["primary"],
                         font=("Segoe UI", 14, "bold"), height=42, corner_radius=10,
                         command=lambda: self._start_daily_session(remaining)
                         ).grid(row=row, column=0, pady=15)
            row += 1
        elif done > 0:
            # Completed!
            done_frame = ctk.CTkFrame(scroll, fg_color=COLORS["success"], corner_radius=10)
            done_frame.grid(row=row, column=0, sticky="ew", pady=10)
            done_frame.grid_columnconfigure(0, weight=1)
            ctk.CTkLabel(done_frame, text=t("daily.completed"),
                        font=("Segoe UI", 16, "bold"), text_color="white"
                        ).grid(row=0, column=0, padx=20, pady=15)
            row += 1

            # Wrong answers review
            if wrong:
                ctk.CTkLabel(scroll, text=t("daily.wrong_title"),
                            font=("Segoe UI", 15, "bold"), text_color=COLORS["text"]
                            ).grid(row=row, column=0, sticky="w", pady=(15, 8))
                row += 1

                # Build question lookup
                all_q = {}
                for quiz in self.quizzes:
                    for q in quiz.questions:
                        all_q[q.id] = q

                for wid in wrong:
                    wq = all_q.get(wid)
                    if not wq:
                        continue
                    wf = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8,
                                     border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
                    wf.grid(row=row, column=0, sticky="ew", pady=3)
                    wf.grid_columnconfigure(0, weight=1)
                    ctk.CTkLabel(wf, text=wq.text, font=("Segoe UI", 12),
                                text_color=COLORS["text"], wraplength=600
                                ).grid(row=0, column=0, padx=12, pady=(8, 3), sticky="w")
                    # Show correct answer
                    correct_text = ""
                    if wq.question_type == QuestionType.SINGLE_CHOICE:
                        correct_text = ", ".join(o.text for o in wq.options if o.is_correct)
                    elif wq.question_type == QuestionType.MULTIPLE_CHOICE:
                        correct_text = ", ".join(o.text for o in wq.options if o.is_correct)
                    elif wq.question_type == QuestionType.FREE_TEXT:
                        correct_text = wq.correct_text
                    elif wq.question_type == QuestionType.FILL_BLANK:
                        correct_text = ", ".join(wq.blanks)
                    if correct_text:
                        ctk.CTkLabel(wf, text=f"Richtig: {correct_text}",
                                    font=("Segoe UI", 11), text_color=COLORS["success"]
                                    ).grid(row=1, column=0, padx=12, pady=(0, 8), sticky="w")
                    row += 1

                # Retry wrong questions
                ctk.CTkButton(scroll, text=t("daily.retry"), fg_color=COLORS["warning"],
                             font=("Segoe UI", 13, "bold"), height=38, corner_radius=8,
                             command=lambda: self._start_daily_session(wrong)
                             ).grid(row=row, column=0, pady=10)
                row += 1

            # Extra learning
            extra_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
            extra_frame.grid(row=row, column=0, sticky="ew", pady=(15, 5))
            extra_frame.grid_columnconfigure(1, weight=1)
            ctk.CTkLabel(extra_frame, text=t("daily.extra"),
                        font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                        ).grid(row=0, column=0, padx=12, pady=10, sticky="w")
            extra_entry = ctk.CTkEntry(extra_frame, width=80, placeholder_text=t("daily.extra_hint"))
            extra_entry.grid(row=0, column=1, padx=5, pady=10)

            def start_extra():
                try:
                    count = int(extra_entry.get())
                except ValueError:
                    return
                if count <= 0:
                    return
                all_questions = []
                for quiz in self.quizzes:
                    all_questions.extend(quiz.questions)
                random.shuffle(all_questions)
                extra_ids = [q.id for q in all_questions[:count]]
                self._start_daily_session(extra_ids)

            ctk.CTkButton(extra_frame, text=t("daily.start"), width=100,
                         fg_color=COLORS["primary"], command=start_extra
                         ).grid(row=0, column=2, padx=12, pady=10)
            row += 1

        # Back button
        ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=row, column=0, pady=15)

    def _create_daily_plan(self, today_str: str) -> dict:
        today = date.fromisoformat(today_str)
        plan_questions = []
        quiz_plans = []

        for quiz in self.quizzes:
            if not quiz.questions:
                continue
            urgency = 1.0
            if quiz.exam_date:
                try:
                    exam = date.fromisoformat(quiz.exam_date)
                    days_left = (exam - today).days
                    if days_left < 0:
                        urgency = 0.1  # past exam
                    else:
                        urgency = max(0.2, 1.0 - days_left / 60)
                except ValueError:
                    pass

            count = max(3, int(20 * quiz.weight * urgency))
            # Prioritize weak questions
            weak = self.sr.select_weak_questions(quiz.questions, quiz_weight=quiz.weight)
            selected = weak[:count] if len(weak) >= count else weak + quiz.questions[:count - len(weak)]
            # Avoid duplicates
            seen = {q.id for q in plan_questions}
            added = 0
            for q in selected:
                if q.id not in seen:
                    plan_questions.append(q)
                    seen.add(q.id)
                    added += 1

            quiz_plans.append({
                "quiz_id": quiz.id,
                "quiz_name": quiz.name,
                "exam_date": quiz.exam_date,
                "count": added,
                "urgency": round(urgency, 2),
            })

        # Cap at 50
        plan_questions = plan_questions[:50]

        state = {
            "date": today_str,
            "question_ids": [q.id for q in plan_questions],
            "completed": [],
            "wrong": [],
            "quiz_plans": quiz_plans,
            "extra_done": False,
        }
        self.store.save_daily_state(state)
        return state

    def _start_daily_session(self, question_ids):
        all_questions = {}
        for quiz in self.quizzes:
            for q in quiz.questions:
                all_questions[q.id] = q

        session_questions = [all_questions[qid] for qid in question_ids if qid in all_questions]
        if not session_questions:
            messagebox.showinfo("Hinweis", "Keine Fragen für heute!")
            return

        random.shuffle(session_questions)
        self.session = QuizSession(session_questions, mode="single")
        self._daily_mode = True
        self._show_question()

    # ── MARKED QUESTIONS ──

    def show_marked(self):
        self._clear_main()
        scroll = self._make_screen()

        ctk.CTkLabel(scroll, text=t("marked.title"), font=("Segoe UI", 20, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 10))

        marked_ids = self.store.load_marked()
        marked_questions = []
        for quiz in self.quizzes:
            for q in quiz.questions:
                if q.id in marked_ids:
                    marked_questions.append(q)

        if not marked_questions:
            ctk.CTkLabel(scroll, text=t("marked.none"), font=("Segoe UI", 13),
                        text_color=COLORS["text_light"]).grid(row=1, column=0, pady=30)
        else:
            for i, q in enumerate(marked_questions):
                rf = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
                rf.grid(row=1 + i, column=0, sticky="ew", pady=3)
                rf.grid_columnconfigure(0, weight=1)
                ctk.CTkLabel(rf, text=q.text, font=("Segoe UI", 12),
                            text_color=COLORS["text"], wraplength=600, justify="left"
                            ).grid(row=0, column=0, padx=15, pady=10, sticky="w")

                def unmark(qid=q.id):
                    mids = self.store.load_marked()
                    if qid in mids:
                        mids.remove(qid)
                        self.store.save_marked(mids)
                    self.show_marked()

                ctk.CTkButton(rf, text=t("marked.unmark"), fg_color=COLORS["danger"],
                             width=80, height=28, font=("Segoe UI", 11),
                             command=unmark).grid(row=0, column=1, padx=10, pady=10)

        btn_row = 2 + len(marked_questions)
        btn_f = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_f.grid(row=btn_row, column=0, sticky="w", pady=15)
        if marked_questions:
            ctk.CTkButton(btn_f, text=t("marked.chat"), fg_color=COLORS["primary"],
                         font=("Segoe UI", 12, "bold"), command=self.show_marked_chat
                         ).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(btn_f, text=t("nav.back"), fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=0, column=1)

    def show_marked_chat(self):
        self._clear_main()
        frame = self._make_screen()
        frame.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(frame, text=t("marked.chat"), font=("Segoe UI", 20, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 10))

        chat_scroll = ctk.CTkScrollableFrame(frame, fg_color=COLORS["card"], corner_radius=8)
        chat_scroll.grid(row=1, column=0, sticky="nsew", pady=(0, 10))
        chat_scroll.grid_columnconfigure(0, weight=1)

        chat_history = []
        marked_ids = self.store.load_marked()
        marked_questions = []
        for quiz in self.quizzes:
            for q in quiz.questions:
                if q.id in marked_ids:
                    marked_questions.append(q)

        context = "Markierte Fragen:\n" + "\n".join(f"- {q.text}" for q in marked_questions)
        uploaded_content = {"text": ""}

        settings = self.store.load_settings()
        if settings.get("use_memory"):
            memory = self.store.load_memory()
            if memory:
                context = f"Lernprofil des Studenten:\n{memory}\n\n{context}"

        msg_row = {"idx": 0}

        def add_message(role, text):
            bg = COLORS["primary"] if role == "user" else COLORS["card_hover"]
            tc = "white" if role == "user" else COLORS["text"]
            anchor = "e" if role == "user" else "w"
            mf = ctk.CTkFrame(chat_scroll, fg_color=bg, corner_radius=8)
            mf.grid(row=msg_row["idx"], column=0, sticky=anchor, pady=3, padx=10)
            self._render_rich_text(mf, text, font=("Segoe UI", 12), text_color=tc,
                                   wraplength=500, row=0, column=0, padx=12, pady=8)
            msg_row["idx"] += 1

        def upload_file():
            path = filedialog.askopenfilename(filetypes=[("Text", "*.txt"), ("All", "*.*")])
            if path:
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        uploaded_content["text"] = f.read()
                    add_message("user", f"[Datei hochgeladen: {Path(path).name}]")
                except Exception as e:
                    add_message("user", f"[Fehler: {e}]")

        def send_message():
            user_text = input_entry.get("1.0", "end").strip()
            if not user_text:
                return
            input_entry.delete("1.0", "end")
            add_message("user", user_text)
            chat_history.append({"role": "user", "content": user_text})

            def run():
                sys_content = f"Du bist ein hilfreicher Lern-Tutor. Kontext:\n{context}"
                if uploaded_content["text"]:
                    sys_content += f"\n\nHochgeladenes Dokument:\n{uploaded_content['text']}"
                msgs = [{"role": "system", "content": sys_content}] + chat_history
                resp = self.ai._call_api(msgs, max_tokens=2048)
                answer = resp or "Keine Antwort erhalten."
                chat_history.append({"role": "assistant", "content": answer})
                self.after(0, lambda: add_message("assistant", answer))
            threading.Thread(target=run, daemon=True).start()

        input_frame = ctk.CTkFrame(frame, fg_color="transparent")
        input_frame.grid(row=2, column=0, sticky="ew", pady=(0, 5))
        input_frame.grid_columnconfigure(0, weight=1)

        input_entry = ctk.CTkTextbox(input_frame, height=50, font=("Segoe UI", 12),
                                     fg_color=COLORS["input_bg"])
        input_entry.grid(row=0, column=0, sticky="ew", padx=(0, 5))
        ctk.CTkButton(input_frame, text=t("chat.send"), fg_color=COLORS["primary"],
                     width=80, font=("Segoe UI", 12, "bold"), command=send_message
                     ).grid(row=0, column=1, padx=(0, 5))
        ctk.CTkButton(input_frame, text=t("marked.upload"), fg_color=COLORS["text_light"],
                     width=100, font=("Segoe UI", 11), command=upload_file
                     ).grid(row=0, column=2)

        btn_f = ctk.CTkFrame(frame, fg_color="transparent")
        btn_f.grid(row=3, column=0, sticky="w", pady=5)
        ctk.CTkButton(btn_f, text=t("nav.back"), fg_color=COLORS["text_light"],
                     command=self.show_marked).grid(row=0, column=0)

    # ── QUICK ACTIONS EDITOR ──

    def show_quick_actions_editor(self):
        self._clear_main()
        frame = self._make_screen()

        ctk.CTkLabel(frame, text=t("qa.title"), font=("Segoe UI", 20, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 15))

        actions = self.store.load_quick_actions()

        list_frame = ctk.CTkScrollableFrame(frame, fg_color="transparent", height=200)
        list_frame.grid(row=1, column=0, sticky="ew", pady=(0, 10))
        list_frame.grid_columnconfigure(0, weight=1)

        for i, qa in enumerate(actions):
            rf = ctk.CTkFrame(list_frame, fg_color=COLORS["card"], corner_radius=8)
            rf.grid(row=i, column=0, sticky="ew", pady=3)
            rf.grid_columnconfigure(0, weight=1)
            ctk.CTkLabel(rf, text=qa["name"], font=("Segoe UI", 13, "bold"),
                        text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(8, 2), sticky="w")
            ctk.CTkLabel(rf, text=qa.get("user_story", "")[:80], font=("Segoe UI", 11),
                        text_color=COLORS["text_light"]).grid(row=1, column=0, padx=15, pady=(0, 8), sticky="w")

            def delete_qa(idx=i):
                acts = self.store.load_quick_actions()
                if idx < len(acts):
                    acts.pop(idx)
                    self.store.save_quick_actions(acts)
                self.show_quick_actions_editor()

            ctk.CTkButton(rf, text=t("qa.delete"), fg_color=COLORS["danger"],
                         width=70, height=28, font=("Segoe UI", 11),
                         command=delete_qa).grid(row=0, column=1, rowspan=2, padx=10, pady=8)

        # New button form
        if len(actions) < 8:
            form = ctk.CTkFrame(frame, fg_color=COLORS["card"], corner_radius=8)
            form.grid(row=2, column=0, sticky="ew", pady=10)
            form.grid_columnconfigure(0, weight=1)

            ctk.CTkLabel(form, text=t("qa.new"), font=("Segoe UI", 14, "bold"),
                        text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(10, 5), sticky="w")

            ctk.CTkLabel(form, text=t("qa.name"), font=("Segoe UI", 12),
                        text_color=COLORS["text"]).grid(row=1, column=0, padx=15, sticky="w")
            name_entry = ctk.CTkEntry(form, width=400, font=("Segoe UI", 12),
                                      placeholder_text="z.B. Eselsbrücken")
            name_entry.grid(row=2, column=0, padx=15, pady=(2, 8), sticky="w")

            ctk.CTkLabel(form, text=t("qa.story"), font=("Segoe UI", 12),
                        text_color=COLORS["text"]).grid(row=3, column=0, padx=15, sticky="w")
            story_entry = ctk.CTkTextbox(form, height=80, width=500, font=("Segoe UI", 12),
                                         fg_color=COLORS["input_bg"])
            story_entry.grid(row=4, column=0, padx=15, pady=(2, 8), sticky="w")

            slider_frame = ctk.CTkFrame(form, fg_color="transparent")
            slider_frame.grid(row=5, column=0, padx=15, pady=(0, 5), sticky="w")
            ctk.CTkLabel(slider_frame, text=t("qa.creativity"), font=("Segoe UI", 12),
                        text_color=COLORS["text"]).grid(row=0, column=0, padx=(0, 10))
            temp_slider = ctk.CTkSlider(slider_frame, from_=0, to=1, number_of_steps=10, width=200)
            temp_slider.set(0.7)
            temp_slider.grid(row=0, column=1, padx=(0, 10))
            ai_decides_var = BooleanVar(value=False)
            ctk.CTkCheckBox(slider_frame, text=t("qa.ai_decides"), variable=ai_decides_var,
                           font=("Segoe UI", 11)).grid(row=0, column=2)

            status_lbl = ctk.CTkLabel(form, text="", font=("Segoe UI", 11),
                                      text_color=COLORS["text_light"])
            status_lbl.grid(row=7, column=0, padx=15, pady=(0, 10), sticky="w")

            def save_new():
                name = name_entry.get().strip()
                story = story_entry.get("1.0", "end").strip()
                if not name or not story:
                    return
                temp = 0.7 if ai_decides_var.get() else temp_slider.get()
                status_lbl.configure(text=t("qa.generating"))

                def run():
                    msgs = [{"role": "system", "content": "Du bist ein Experte für Prompt Engineering. Erstelle einen optimierten System-Prompt für einen Lern-Tutor-Button. Der Prompt soll präzise beschreiben, was der Tutor tun soll, wenn er eine Quiz-Frage als Kontext bekommt. Antworte NUR mit dem fertigen Prompt, ohne Erklärung."},
                            {"role": "user", "content": f"Button-Name: {name}\nBeschreibung / User Story: {story}"}]
                    resp = self.ai._call_api(msgs, max_tokens=512)
                    prompt = resp or story
                    action = {"name": name, "prompt": prompt, "temperature": temp, "user_story": story}
                    acts = self.store.load_quick_actions()
                    acts.append(action)
                    self.store.save_quick_actions(acts)
                    self.after(0, self.show_quick_actions_editor)
                threading.Thread(target=run, daemon=True).start()

            ctk.CTkButton(form, text=t("qa.save"), fg_color=COLORS["success"],
                         font=("Segoe UI", 12, "bold"), command=save_new
                         ).grid(row=6, column=0, padx=15, pady=(0, 5), sticky="w")
        else:
            ctk.CTkLabel(frame, text=t("qa.max_reached"), font=("Segoe UI", 12),
                        text_color=COLORS["warning"]).grid(row=2, column=0, sticky="w", pady=10)

        ctk.CTkButton(frame, text=t("nav.back"), fg_color=COLORS["text_light"],
                     command=self.show_settings).grid(row=3, column=0, sticky="w", pady=10)

    # ── EXPORT / IMPORT QUIZ AS JSON ──

    def export_quiz_file(self, quiz: Quiz):
        safe_name = "".join(c for c in quiz.name if c.isalnum() or c in " -_").strip() or "quiz"
        path = filedialog.asksaveasfilename(
            defaultextension=".json",
            initialfile=f"{safe_name}.json",
            filetypes=[("Quiz JSON", "*.json"), ("Alle", "*.*")],
        )
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(quiz.to_dict(), f, ensure_ascii=False, indent=2)
            messagebox.showinfo("Export", f"Quiz '{quiz.name}' exportiert nach:\n{path}")
        except Exception as e:
            messagebox.showerror("Export", f"Export fehlgeschlagen: {e}")

    def import_quiz_file(self):
        path = filedialog.askopenfilename(
            filetypes=[("Quiz JSON", "*.json"), ("Alle", "*.*")],
        )
        if not path:
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            quiz = Quiz.from_dict(data)
            # fresh ids to avoid clashing with existing quizzes/progress
            quiz.id = str(__import__("uuid").uuid4())
            for q in quiz.questions:
                q.id = str(__import__("uuid").uuid4())
            if not quiz.name:
                quiz.name = Path(path).stem
            self.quizzes.append(quiz)
            self.store.save_quizzes(self.quizzes)
            messagebox.showinfo("Import", f"Quiz '{quiz.name}' mit {len(quiz.questions)} Fragen importiert!")
            self.show_home()
        except Exception as e:
            messagebox.showerror("Import", f"Import fehlgeschlagen: {e}")

    # ── SETTINGS ──

    def show_settings(self):
        self._clear_main()
        frame = self._make_screen()

        ctk.CTkLabel(frame, text=t("settings.title"), font=("Arial", 20, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 20))

        settings = self.store.load_settings()

        # API Key
        ctk.CTkLabel(frame, text=t("settings.api_key"), font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=1, column=0, sticky="w")
        api_entry = ctk.CTkEntry(frame, placeholder_text="sk-or-...", width=500, show="*")
        api_entry.grid(row=2, column=0, sticky="w", pady=(5, 15))
        if settings.get("api_key"):
            api_entry.insert(0, settings["api_key"])

        # Model
        ctk.CTkLabel(frame, text=t("settings.model"), font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=3, column=0, sticky="w")
        model_entry = ctk.CTkEntry(frame, placeholder_text="deepseek/deepseek-chat", width=500)
        model_entry.grid(row=4, column=0, sticky="w", pady=(5, 5))
        if settings.get("model"):
            model_entry.insert(0, settings["model"])

        ctk.CTkLabel(frame, text=t("settings.model_hint"),
                    font=("Arial", 11), text_color=COLORS["text_light"]
                    ).grid(row=5, column=0, sticky="w", pady=(0, 20))

        # Appearance & language
        ctk.CTkLabel(frame, text=t("settings.appearance"), font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=6, column=0, sticky="w")
        appear_row = ctk.CTkFrame(frame, fg_color="transparent")
        appear_row.grid(row=7, column=0, sticky="w", pady=(5, 15))

        # Feature toggles
        ctk.CTkLabel(frame, text="Features", font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=6, column=0, sticky="w")
        feat_row = ctk.CTkFrame(frame, fg_color="transparent")
        feat_row.grid(row=7, column=0, sticky="w", pady=(5, 15))
        fsrs_switch = ctk.CTkSwitch(feat_row, text=t("settings.fsrs"))
        fsrs_switch.grid(row=0, column=0, padx=(0, 20))
        if settings.get("use_fsrs", False):
            fsrs_switch.select()
        img_switch = ctk.CTkSwitch(feat_row, text=t("settings.images"))
        img_switch.grid(row=0, column=1, padx=(0, 20))
        if settings.get("enable_images", False):
            img_switch.select()
        aival_switch = ctk.CTkSwitch(feat_row, text=t("settings.ai_validation"))
        aival_switch.grid(row=0, column=2, padx=(0, 20))
        if settings.get("ai_validation", False):
            aival_switch.select()
        detailed_switch = ctk.CTkSwitch(feat_row, text=t("settings.detailed_answer"))
        detailed_switch.grid(row=1, column=0, padx=(0, 20), pady=(8, 0))
        if settings.get("detailed_answer", False):
            detailed_switch.select()
        math_switch = ctk.CTkSwitch(feat_row, text=t("settings.math_mode"))
        math_switch.grid(row=1, column=1, padx=(0, 20), pady=(8, 0))
        if settings.get("math_mode", False):
            math_switch.select()

        # Appearance & language
        ctk.CTkLabel(frame, text=t("settings.appearance"), font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=8, column=0, sticky="w")
        appear_row = ctk.CTkFrame(frame, fg_color="transparent")
        appear_row.grid(row=9, column=0, sticky="w", pady=(5, 15))

        dark_switch = ctk.CTkSwitch(appear_row, text=t("settings.dark_mode"))
        dark_switch.grid(row=0, column=0, padx=(0, 30))
        if is_dark():
            dark_switch.select()

        ctk.CTkLabel(appear_row, text=t("settings.language"), font=("Arial", 12),
                    text_color=COLORS["text"]).grid(row=0, column=1, padx=(0, 8))
        lang_menu = ctk.CTkOptionMenu(appear_row, values=["Deutsch", "English"], width=140)
        lang_menu.set("English" if get_language() == "en" else "Deutsch")
        lang_menu.grid(row=0, column=2)

        # Learning profile / memory
        ctk.CTkLabel(frame, text=t("memory.title"), font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=10, column=0, sticky="w", pady=(10, 0))
        memory_switch = ctk.CTkSwitch(frame, text=t("memory.enable"), font=("Segoe UI", 12))
        memory_switch.grid(row=11, column=0, sticky="w", pady=(5, 5))
        if settings.get("use_memory", False):
            memory_switch.select()

        ctk.CTkLabel(frame, text=t("memory.template"), font=("Segoe UI", 11),
                    text_color=COLORS["text_light"], wraplength=500, justify="left"
                    ).grid(row=12, column=0, sticky="w", pady=(5, 5))
        memory_text = ctk.CTkTextbox(frame, height=120, width=500, font=("Segoe UI", 12),
                                     fg_color=COLORS["input_bg"])
        memory_text.grid(row=13, column=0, sticky="w", pady=(0, 10))
        existing_memory = self.store.load_memory()
        if existing_memory:
            memory_text.insert("1.0", existing_memory)

        # Quick actions editor link
        ctk.CTkLabel(frame, text=t("qa.title"), font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=14, column=0, sticky="w", pady=(10, 0))
        ctk.CTkButton(frame, text=t("qa.title"), fg_color=COLORS["primary_light"],
                     font=("Segoe UI", 12), width=200,
                     command=self.show_quick_actions_editor
                     ).grid(row=15, column=0, sticky="w", pady=(5, 15))

        # ── Cloud-Sync (geteilter Sync-Code mit der Mobile-App) ──
        ctk.CTkLabel(frame, text=t("sync.title"), font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=16, column=0, sticky="w", pady=(10, 0))
        ctk.CTkLabel(frame, text=t("sync.hint"), font=("Segoe UI", 11),
                    text_color=COLORS["text_light"], wraplength=500, justify="left"
                    ).grid(row=17, column=0, sticky="w", pady=(2, 5))
        sync_entry = ctk.CTkEntry(frame, placeholder_text=t("sync.code_placeholder"), width=300)
        sync_entry.grid(row=18, column=0, sticky="w", pady=(0, 8))
        if settings.get("sync_code"):
            sync_entry.insert(0, settings["sync_code"])

        sync_status = ctk.CTkLabel(frame, text="", font=("Segoe UI", 11),
                                   text_color=COLORS["text_light"])
        sync_status.grid(row=20, column=0, sticky="w", pady=(2, 10))

        def _cloud_upload():
            code = cloud_sync.sanitize_code(sync_entry.get())
            if not code:
                sync_status.configure(text=t("sync.no_code"), text_color=COLORS["danger"])
                return
            s = self.store.load_settings()
            s["sync_code"] = code
            self.store.save_settings(s)
            sync_status.configure(text=t("sync.uploading"), text_color=COLORS["text_light"])
            self.update_idletasks()

            def work():
                quizzes_data = [q.to_dict() for q in self.quizzes]
                from dataclasses import asdict as _asdict
                progress_data = {k: _asdict(v) for k, v in self.store.load_progress().items()}
                daily_data = self.store.load_daily_state()
                ok = cloud_sync.upload(code, "quizzes", quizzes_data)
                ok = cloud_sync.upload(code, "progress", progress_data) and ok
                cloud_sync.upload(code, "daily", daily_data)

                def done():
                    if ok:
                        sync_status.configure(text=t("sync.uploaded"), text_color=COLORS["success"])
                    else:
                        sync_status.configure(text=t("sync.error"), text_color=COLORS["danger"])
                self.after(0, done)

            threading.Thread(target=work, daemon=True).start()

        def _cloud_download():
            code = cloud_sync.sanitize_code(sync_entry.get())
            if not code:
                sync_status.configure(text=t("sync.no_code"), text_color=COLORS["danger"])
                return
            if not messagebox.askyesno(t("sync.title"), t("sync.confirm_download")):
                return
            s = self.store.load_settings()
            s["sync_code"] = code
            self.store.save_settings(s)
            sync_status.configure(text=t("sync.downloading"), text_color=COLORS["text_light"])
            self.update_idletasks()

            def work():
                quizzes_data = cloud_sync.download(code, "quizzes")
                progress_data = cloud_sync.download(code, "progress")
                daily_data = cloud_sync.download(code, "daily")

                def done():
                    if quizzes_data is None and progress_data is None:
                        sync_status.configure(text=t("sync.nothing"), text_color=COLORS["danger"])
                        return
                    if quizzes_data is not None:
                        self.quizzes = [Quiz.from_dict(q) for q in quizzes_data]
                        self.store.save_quizzes(self.quizzes)
                    if progress_data is not None:
                        from .models import QuestionProgress as _QP
                        prog = {k: _QP(**v) for k, v in progress_data.items()}
                        self.store.save_progress(prog)
                    if daily_data:
                        self.store.save_daily_state(daily_data)
                    sync_status.configure(text=t("sync.downloaded"), text_color=COLORS["success"])
                self.after(0, done)

            threading.Thread(target=work, daemon=True).start()

        sync_btn_row = ctk.CTkFrame(frame, fg_color="transparent")
        sync_btn_row.grid(row=19, column=0, sticky="w", pady=(0, 5))
        ctk.CTkButton(sync_btn_row, text=t("sync.upload"), fg_color=COLORS["primary"],
                     font=("Segoe UI", 12), width=180, command=_cloud_upload
                     ).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(sync_btn_row, text=t("sync.download"), fg_color=COLORS["primary_light"],
                     font=("Segoe UI", 12), width=180, command=_cloud_download
                     ).grid(row=0, column=1)

        def save():
            s = self.store.load_settings()
            s["api_key"] = api_entry.get().strip()
            s["model"] = model_entry.get().strip() or "deepseek/deepseek-chat"
            s["use_fsrs"] = bool(fsrs_switch.get())
            s["enable_images"] = bool(img_switch.get())
            s["ai_validation"] = bool(aival_switch.get())
            s["detailed_answer"] = bool(detailed_switch.get())
            s["math_mode"] = bool(math_switch.get())
            s["dark_mode"] = bool(dark_switch.get())
            s["language"] = "en" if lang_menu.get() == "English" else "de"
            s["use_memory"] = bool(memory_switch.get())
            s["sync_code"] = cloud_sync.sanitize_code(sync_entry.get())
            self.store.save_settings(s)
            # Save memory text
            mem = memory_text.get("1.0", "end").strip()
            self.store.save_memory(mem)
            self.ai.api_key = s["api_key"]
            self.ai.model = s["model"]
            apply_theme(s["dark_mode"])
            set_language(s["language"])
            self.title(t("app.title"))
            self.header_title.configure(text=t("app.header"))
            messagebox.showinfo("OK", t("settings.saved"))
            self.show_home()

        btn_frame = ctk.CTkFrame(frame, fg_color="transparent")
        btn_frame.grid(row=21, column=0, sticky="w", pady=(10, 0))
        ctk.CTkButton(btn_frame, text=t("nav.save"), fg_color=COLORS["success"],
                     command=save).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(btn_frame, text=t("nav.back"), fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=0, column=1)

    # ── CREATE QUIZ (manual) ──

    def show_create_quiz(self, quiz: Quiz | None = None):
        self._clear_main()
        editing = quiz is not None
        if quiz is None:
            quiz = Quiz(created=datetime.now().isoformat())

        scroll = self._make_screen()

        ctk.CTkLabel(scroll, text="Quiz bearbeiten" if editing else "Neues Quiz erstellen",
                    font=("Arial", 18, "bold"), text_color=COLORS["text"]
                    ).grid(row=0, column=0, sticky="w", pady=(0, 15))

        # Name & Description
        ctk.CTkLabel(scroll, text="Quiz-Name", font=("Arial", 13, "bold")).grid(row=1, column=0, sticky="w")
        name_entry = ctk.CTkEntry(scroll, width=500, placeholder_text="z.B. Werkstoffkunde Klausur")
        name_entry.grid(row=2, column=0, sticky="w", pady=(3, 10))
        if quiz.name:
            name_entry.insert(0, quiz.name)

        ctk.CTkLabel(scroll, text="Beschreibung", font=("Arial", 13, "bold")).grid(row=3, column=0, sticky="w")
        desc_entry = ctk.CTkEntry(scroll, width=500, placeholder_text="Optionale Beschreibung")
        desc_entry.grid(row=4, column=0, sticky="w", pady=(3, 15))
        if quiz.description:
            desc_entry.insert(0, quiz.description)

        # Quiz weight
        ctk.CTkLabel(scroll, text="Quiz-Gewichtung", font=("Arial", 13, "bold")).grid(row=5, column=0, sticky="w")
        weight_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        weight_frame.grid(row=6, column=0, sticky="w", pady=(3, 15))
        weight_val = ctk.CTkLabel(weight_frame, text=f"{quiz.weight:.1f}", width=35, font=("Arial", 13, "bold"),
                                  text_color=COLORS["primary"])
        weight_val.grid(row=0, column=1, padx=8)
        def on_weight(v):
            quiz.weight = round(float(v), 1)
            weight_val.configure(text=f"{quiz.weight:.1f}")
        weight_slider = ctk.CTkSlider(weight_frame, from_=1.0, to=5.0, number_of_steps=8, width=200,
                                       command=on_weight)
        weight_slider.set(quiz.weight)
        weight_slider.grid(row=0, column=0)
        ctk.CTkLabel(weight_frame, text="(1.0 = normal, 5.0 = sehr wichtig)", font=("Arial", 11),
                    text_color=COLORS["text_light"]).grid(row=0, column=2, padx=5)

        # Questions list
        questions_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        questions_frame.grid(row=7, column=0, sticky="ew")
        questions_frame.grid_columnconfigure(0, weight=1)

        def refresh_questions():
            for w in questions_frame.winfo_children():
                w.destroy()
            for i, q in enumerate(quiz.questions):
                qf = ctk.CTkFrame(questions_frame, fg_color=COLORS["card"], corner_radius=6)
                qf.grid(row=i, column=0, sticky="ew", pady=3)
                qf.grid_columnconfigure(1, weight=1)
                ctk.CTkLabel(qf, text=f"{i+1}.", width=30, font=("Arial", 12, "bold")
                           ).grid(row=0, column=0, padx=8)
                type_text = {
                    QuestionType.SINGLE_CHOICE: "SC",
                    QuestionType.MULTIPLE_CHOICE: "MC",
                    QuestionType.FREE_TEXT: "FT",
                    QuestionType.FILL_BLANK: "LT",
                    QuestionType.DRAG_DROP: "DD",
                    QuestionType.DIAGRAM_LABEL: "DL",
                }.get(q.question_type, "?")
                ctk.CTkLabel(qf, text=f"[{type_text}] {q.title or q.text[:50]}",
                           font=("Arial", 12), text_color=COLORS["text"]
                           ).grid(row=0, column=1, sticky="w", padx=5, pady=8)
                ctk.CTkButton(qf, text="Bearbeiten", width=70, fg_color=COLORS["primary"],
                            command=lambda idx=i: edit_question(idx)).grid(row=0, column=2, padx=3, pady=5)
                ctk.CTkButton(qf, text="X", width=30, fg_color=COLORS["danger"],
                            command=lambda idx=i: delete_question(idx)).grid(row=0, column=3, padx=(0, 8), pady=5)

        def delete_question(idx):
            quiz.questions.pop(idx)
            refresh_questions()

        def edit_question(idx):
            self._show_question_editor(quiz, idx, on_done=lambda: self.show_create_quiz(quiz))

        def add_question():
            quiz.name = name_entry.get().strip()
            quiz.description = desc_entry.get().strip()
            self._show_question_editor(quiz, None, on_done=lambda: self.show_create_quiz(quiz))

        refresh_questions()

        # Buttons
        btn_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_frame.grid(row=8, column=0, sticky="w", pady=15)
        ctk.CTkButton(btn_frame, text="+ Frage hinzufügen", fg_color=COLORS["success"],
                     command=add_question).grid(row=0, column=0, padx=(0, 10))

        def save_quiz():
            quiz.name = name_entry.get().strip() or "Unbenanntes Quiz"
            quiz.description = desc_entry.get().strip()
            if not quiz.questions:
                messagebox.showwarning("Hinweis", "Füge mindestens eine Frage hinzu!")
                return
            existing = [q for q in self.quizzes if q.id == quiz.id]
            if existing:
                idx = self.quizzes.index(existing[0])
                self.quizzes[idx] = quiz
            else:
                self.quizzes.append(quiz)
            self.store.save_quizzes(self.quizzes)
            messagebox.showinfo("Gespeichert", f"Quiz '{quiz.name}' mit {len(quiz.questions)} Fragen gespeichert!")
            self.show_home()

        ctk.CTkButton(btn_frame, text="Quiz speichern", fg_color=COLORS["primary"],
                     command=save_quiz).grid(row=0, column=1, padx=(0, 10))
        ctk.CTkButton(btn_frame, text="Abbrechen", fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=0, column=2)

    def show_edit_quiz(self, quiz: Quiz):
        self.show_create_quiz(quiz)

    # ── QUESTION EDITOR ──

    def _show_question_editor(self, quiz: Quiz, question_idx: int | None, on_done):
        self._clear_main()
        editing = question_idx is not None
        if editing:
            question = quiz.questions[question_idx]
        else:
            question = Question()

        scroll = self._make_screen()

        ctk.CTkLabel(scroll, text="Frage bearbeiten" if editing else "Neue Frage",
                    font=("Arial", 18, "bold"), text_color=COLORS["text"]
                    ).grid(row=0, column=0, sticky="w", pady=(0, 15))

        # Type selection
        ctk.CTkLabel(scroll, text="Fragetyp", font=("Arial", 13, "bold")).grid(row=1, column=0, sticky="w")
        type_var = StringVar(value=question.question_type.value)
        type_options = {
            "Single Choice": QuestionType.SINGLE_CHOICE.value,
            "Multiple Choice": QuestionType.MULTIPLE_CHOICE.value,
            "Freitext": QuestionType.FREE_TEXT.value,
            "Lückentext": QuestionType.FILL_BLANK.value,
            "Drag & Drop (Zuordnung)": QuestionType.DRAG_DROP.value,
            "Diagramm beschriften": QuestionType.DIAGRAM_LABEL.value,
            "Markieren (Bild)": QuestionType.MARK_IMAGE.value,
            "Mathe-Formel": QuestionType.MATH_FORMULA.value,
        }
        def on_type_change(v):
            type_var.set(type_options[v])
            rebuild_options()
        type_menu = ctk.CTkOptionMenu(scroll, values=list(type_options.keys()),
                                       command=on_type_change, width=250)
        reverse_types = {v: k for k, v in type_options.items()}
        type_menu.set(reverse_types.get(question.question_type.value, "Single Choice"))
        type_menu.grid(row=2, column=0, sticky="w", pady=(3, 10))

        # Title
        ctk.CTkLabel(scroll, text="Titel", font=("Arial", 13, "bold")).grid(row=3, column=0, sticky="w")
        title_entry = ctk.CTkEntry(scroll, width=500, placeholder_text="Kurztitel")
        title_entry.grid(row=4, column=0, sticky="w", pady=(3, 10))
        if question.title:
            title_entry.insert(0, question.title)

        # Text
        ctk.CTkLabel(scroll, text="Fragentext", font=("Arial", 13, "bold")).grid(row=5, column=0, sticky="w")
        text_box = ctk.CTkTextbox(scroll, width=600, height=80)
        text_box.grid(row=6, column=0, sticky="w", pady=(3, 10))
        if question.text:
            text_box.insert("1.0", question.text)

        # Topic
        ctk.CTkLabel(scroll, text="Thema", font=("Arial", 13, "bold")).grid(row=7, column=0, sticky="w")
        topic_entry = ctk.CTkEntry(scroll, width=300, placeholder_text="z.B. Zugversuch")
        topic_entry.grid(row=8, column=0, sticky="w", pady=(3, 10))
        if question.topic:
            topic_entry.insert(0, question.topic)

        # Points + Weight
        meta = ctk.CTkFrame(scroll, fg_color="transparent")
        meta.grid(row=9, column=0, sticky="w", pady=(3, 10))
        ctk.CTkLabel(meta, text="Punkte", font=("Arial", 13, "bold")).grid(row=0, column=0, padx=(0, 8))
        points_var = IntVar(value=question.points)
        points_menu = ctk.CTkOptionMenu(meta, values=["1", "2", "3", "4", "5"],
                                        command=lambda v: points_var.set(int(v)), width=70)
        points_menu.set(str(question.points))
        points_menu.grid(row=0, column=1, padx=(0, 25))

        weight_label = ctk.CTkLabel(meta, text=f"Wichtigkeit: {question.weight:.1f}x",
                                    font=("Arial", 13, "bold"), text_color=COLORS["text"])
        weight_label.grid(row=0, column=2, padx=(0, 8))
        weight_slider = ctk.CTkSlider(meta, from_=1.0, to=5.0, number_of_steps=8, width=180)
        weight_slider.set(question.weight)
        weight_slider.configure(command=lambda v: weight_label.configure(text=f"Wichtigkeit: {v:.1f}x"))
        weight_slider.grid(row=0, column=3)

        # Image (for all question types, toggleable)
        settings = self.store.load_settings()
        if settings.get("enable_images", False):
            img_frame = ctk.CTkFrame(scroll, fg_color="transparent")
            img_frame.grid(row=10, column=0, sticky="w", pady=(3, 10))
            ctk.CTkLabel(img_frame, text=t("editor.image"), font=("Arial", 13, "bold")
                        ).grid(row=0, column=0, padx=(0, 10))
            q_img_entry = ctk.CTkEntry(img_frame, width=340, placeholder_text="Pfad zum Bild")
            q_img_entry.grid(row=0, column=1, padx=(0, 5))
            if question.image_path:
                q_img_entry.insert(0, question.image_path)
            ctk.CTkButton(img_frame, text=t("editor.image_add"), width=100,
                         command=lambda: self._browse_image(q_img_entry)).grid(row=0, column=2, padx=3)
            def remove_img():
                q_img_entry.delete(0, "end")
            ctk.CTkButton(img_frame, text=t("editor.image_remove"), width=100,
                         fg_color=COLORS["danger"],
                         command=remove_img).grid(row=0, column=3, padx=3)
        else:
            q_img_entry = None

        # Type-specific fields
        specific_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        specific_frame.grid(row=11, column=0, sticky="ew", pady=10)
        specific_frame.grid_columnconfigure(0, weight=1)

        # Options for SC/MC
        options_data = []
        for o in question.options:
            options_data.append({"text": o.text, "is_correct": o.is_correct})
        if not options_data:
            options_data = [{"text": "", "is_correct": False} for _ in range(4)]

        options_widgets = []

        def rebuild_options():
            for w in specific_frame.winfo_children():
                w.destroy()
            options_widgets.clear()

            qt = type_var.get()
            if qt in (QuestionType.SINGLE_CHOICE.value, QuestionType.MULTIPLE_CHOICE.value):
                ctk.CTkLabel(specific_frame, text="Antwortoptionen (markiere korrekte)",
                           font=("Arial", 13, "bold")).grid(row=0, column=0, sticky="w")
                for i, od in enumerate(options_data):
                    row_f = ctk.CTkFrame(specific_frame, fg_color="transparent")
                    row_f.grid(row=i + 1, column=0, sticky="ew", pady=2)
                    check_var = BooleanVar(value=od["is_correct"])
                    cb = ctk.CTkCheckBox(row_f, text="", variable=check_var, width=30)
                    cb.grid(row=0, column=0, padx=(0, 5))
                    entry = ctk.CTkEntry(row_f, width=450, placeholder_text=f"Option {i+1}")
                    entry.grid(row=0, column=1, padx=(0, 5))
                    if od["text"]:
                        entry.insert(0, od["text"])
                    ctk.CTkButton(row_f, text="X", width=30, fg_color=COLORS["danger"],
                                command=lambda idx=i: remove_option(idx)).grid(row=0, column=2)
                    options_widgets.append((entry, check_var))
                ctk.CTkButton(specific_frame, text="+ Option", width=100, fg_color=COLORS["success"],
                            command=add_option).grid(row=len(options_data) + 1, column=0, sticky="w", pady=5)

            elif qt == QuestionType.FREE_TEXT.value:
                ctk.CTkLabel(specific_frame, text="Korrekte Antwort",
                           font=("Arial", 13, "bold")).grid(row=0, column=0, sticky="w")
                ft_entry = ctk.CTkEntry(specific_frame, width=500, placeholder_text="Exakte richtige Antwort")
                ft_entry.grid(row=1, column=0, sticky="w", pady=5)
                if question.correct_text:
                    ft_entry.insert(0, question.correct_text)
                options_widgets.append(("free_text", ft_entry))

            elif qt == QuestionType.FILL_BLANK.value:
                ctk.CTkLabel(specific_frame, text="Lücken-Antworten (eine pro Zeile, in Reihenfolge)",
                           font=("Arial", 13, "bold")).grid(row=0, column=0, sticky="w")
                ctk.CTkLabel(specific_frame, text="Markiere Lücken im Fragentext mit ___",
                           font=("Arial", 11), text_color=COLORS["text_light"]
                           ).grid(row=1, column=0, sticky="w")
                blanks_box = ctk.CTkTextbox(specific_frame, width=400, height=80)
                blanks_box.grid(row=2, column=0, sticky="w", pady=5)
                if question.blanks:
                    blanks_box.insert("1.0", "\n".join(question.blanks))
                options_widgets.append(("blanks", blanks_box))

            elif qt == QuestionType.DRAG_DROP.value:
                ctk.CTkLabel(specific_frame, text="Zuordnungspaare (Begriff → Ziel)",
                           font=("Arial", 13, "bold")).grid(row=0, column=0, sticky="w")
                for i, pair in enumerate(question.drag_drop_pairs if question.drag_drop_pairs else [{"source": "", "target": ""}] * 3):
                    row_f = ctk.CTkFrame(specific_frame, fg_color="transparent")
                    row_f.grid(row=i + 1, column=0, sticky="ew", pady=2)
                    src = ctk.CTkEntry(row_f, width=200, placeholder_text="Begriff")
                    src.grid(row=0, column=0, padx=(0, 5))
                    ctk.CTkLabel(row_f, text="→").grid(row=0, column=1, padx=5)
                    tgt = ctk.CTkEntry(row_f, width=200, placeholder_text="Ziel")
                    tgt.grid(row=0, column=2)
                    if isinstance(pair, DragDropPair):
                        src.insert(0, pair.source)
                        tgt.insert(0, pair.target)
                    elif isinstance(pair, dict):
                        src.insert(0, pair.get("source", ""))
                        tgt.insert(0, pair.get("target", ""))
                    options_widgets.append(("dd_pair", src, tgt))
                ctk.CTkButton(specific_frame, text="+ Paar", width=100, fg_color=COLORS["success"],
                            command=lambda: add_dd_pair()).grid(
                    row=len(question.drag_drop_pairs or [{"source": "", "target": ""}] * 3) + 1,
                    column=0, sticky="w", pady=5)

            elif qt == QuestionType.DIAGRAM_LABEL.value:
                ctk.CTkLabel(specific_frame, text="Diagramm-Bild (optional)",
                           font=("Arial", 13, "bold")).grid(row=0, column=0, sticky="w")
                img_row = ctk.CTkFrame(specific_frame, fg_color="transparent")
                img_row.grid(row=1, column=0, sticky="w", pady=3)
                img_entry = ctk.CTkEntry(img_row, width=340, placeholder_text="Pfad zum Bild")
                img_entry.grid(row=0, column=0, padx=(0, 8))
                if question.diagram_image_path:
                    img_entry.insert(0, question.diagram_image_path)

                # position state: {label_name: [x_frac, y_frac]}
                positions = {l.label: [l.x, l.y] for l in question.diagram_labels}

                ctk.CTkLabel(specific_frame,
                           text="Ziehe die Labels an die richtige Stelle im Diagramm:",
                           font=("Arial", 12), text_color=COLORS["text_light"]
                           ).grid(row=2, column=0, sticky="w", pady=(10, 2))

                canvas_holder = ctk.CTkFrame(specific_frame, fg_color="transparent")
                canvas_holder.grid(row=3, column=0, sticky="w", pady=5)

                dl_zoom_holder = ctk.CTkFrame(specific_frame, fg_color="transparent")
                dl_zoom_holder.grid(row=4, column=0, sticky="w", pady=2)

                chip_list_holder = ctk.CTkFrame(specific_frame, fg_color="transparent")
                chip_list_holder.grid(row=5, column=0, sticky="w", pady=(4, 0))

                def reload_diagram_canvas():
                    for w in canvas_holder.winfo_children():
                        w.destroy()
                    for w in dl_zoom_holder.winfo_children():
                        w.destroy()
                    for w in chip_list_holder.winfo_children():
                        w.destroy()

                    img_path = img_entry.get().strip()
                    canvas, ctrl_frame, s2i, zstate = self._make_zoomable_canvas(
                        canvas_holder, img_path, max_w=520, max_h=360)
                    canvas.grid(row=0, column=0)
                    # Place zoom controls
                    ctrl_frame.grid_forget()
                    ctrl_new = ctk.CTkFrame(dl_zoom_holder, fg_color="transparent")
                    ctrl_new.grid(row=0, column=0, sticky="w")
                    ctk.CTkButton(ctrl_new, text="+", width=35, height=28,
                                  command=lambda: (zstate.update({"scale": min(5.0, zstate["scale"] * 1.3)}), zstate["_redraw"]())
                                  ).grid(row=0, column=0, padx=2)
                    ctk.CTkButton(ctrl_new, text="-", width=35, height=28,
                                  command=lambda: (zstate.update({"scale": max(0.2, zstate["scale"] / 1.3)}), zstate["_redraw"]())
                                  ).grid(row=0, column=1, padx=2)
                    ctk.CTkButton(ctrl_new, text="Reset", width=50, height=28,
                                  command=lambda: (zstate.update({"scale": 1.0, "offset_x": 0, "offset_y": 0}), zstate["_redraw"]())
                                  ).grid(row=0, column=2, padx=2)

                    cw = zstate["base_w"]
                    ch = zstate["base_h"]

                    for name, (fx, fy) in positions.items():
                        cx, cy = fx * cw, fy * ch

                        def make_drop(nm):
                            def on_drop(px, py):
                                positions[nm] = [max(0.0, min(1.0, px / cw)),
                                                 max(0.0, min(1.0, py / ch))]
                            return on_drop
                        self._make_draggable_chip(canvas, cx, cy, name, make_drop(name))

                    # removable list of labels
                    for i, name in enumerate(list(positions.keys())):
                        chip = ctk.CTkFrame(chip_list_holder, fg_color="#e8f0fe", corner_radius=12)
                        chip.grid(row=0, column=i, padx=3)
                        ctk.CTkLabel(chip, text=name, font=("Arial", 11),
                                    text_color=COLORS["primary"]).grid(row=0, column=0, padx=(8, 2), pady=2)

                        def remove(nm=name):
                            positions.pop(nm, None)
                            reload_diagram_canvas()
                        ctk.CTkButton(chip, text="✕", width=22, height=22, fg_color=COLORS["danger"],
                                     command=remove).grid(row=0, column=1, padx=(0, 4), pady=2)

                def browse_and_reload():
                    self._browse_image(img_entry)
                    reload_diagram_canvas()
                ctk.CTkButton(img_row, text="Durchsuchen", width=100,
                            command=browse_and_reload).grid(row=0, column=1, padx=(0, 6))
                ctk.CTkButton(img_row, text="Bild laden", width=90, fg_color=COLORS["text_light"],
                            command=reload_diagram_canvas).grid(row=0, column=2)

                # add new label
                add_row = ctk.CTkFrame(specific_frame, fg_color="transparent")
                add_row.grid(row=6, column=0, sticky="w", pady=(8, 0))
                new_label_entry = ctk.CTkEntry(add_row, width=220, placeholder_text="Neues Label (z.B. Rm)")
                new_label_entry.grid(row=0, column=0, padx=(0, 8))

                def add_label():
                    nm = new_label_entry.get().strip()
                    if nm and nm not in positions:
                        positions[nm] = [0.5, 0.5]
                        new_label_entry.delete(0, "end")
                        reload_diagram_canvas()
                ctk.CTkButton(add_row, text="+ Label", width=90, fg_color=COLORS["success"],
                             command=add_label).grid(row=0, column=1)

                reload_diagram_canvas()
                options_widgets.append(("diagram", img_entry, lambda: positions))

            elif qt == QuestionType.MARK_IMAGE.value:
                ctk.CTkLabel(specific_frame, text="Bild für Markierungsfrage",
                           font=("Arial", 13, "bold")).grid(row=0, column=0, sticky="w")
                mi_img_row = ctk.CTkFrame(specific_frame, fg_color="transparent")
                mi_img_row.grid(row=1, column=0, sticky="w", pady=3)
                mi_img_entry = ctk.CTkEntry(mi_img_row, width=340, placeholder_text="Pfad zum Bild")
                mi_img_entry.grid(row=0, column=0, padx=(0, 8))
                if question.image_path:
                    mi_img_entry.insert(0, question.image_path)
                ctk.CTkButton(mi_img_row, text="Durchsuchen", width=100,
                            command=lambda: self._browse_image(mi_img_entry)
                            ).grid(row=0, column=1)

                # Region definitions
                mark_regions_data = list(getattr(question, "mark_regions", []))

                ctk.CTkLabel(specific_frame,
                           text="Klicke auf das Bild, um korrekte Regionen zu definieren:",
                           font=("Arial", 12), text_color=COLORS["text_light"]
                           ).grid(row=2, column=0, sticky="w", pady=(10, 2))

                # Drawing mode selection
                draw_mode_var = StringVar(value="circle")
                mode_frame = ctk.CTkFrame(specific_frame, fg_color="transparent")
                mode_frame.grid(row=3, column=0, sticky="w", pady=3)
                ctk.CTkRadioButton(mode_frame, text="Kreis", variable=draw_mode_var,
                                  value="circle", font=("Arial", 12)
                                  ).grid(row=0, column=0, padx=(0, 15))
                ctk.CTkRadioButton(mode_frame, text="Freihand", variable=draw_mode_var,
                                  value="freehand", font=("Arial", 12)
                                  ).grid(row=0, column=1)

                mi_canvas_holder = ctk.CTkFrame(specific_frame, fg_color="transparent")
                mi_canvas_holder.grid(row=4, column=0, sticky="w", pady=5)

                mi_zoom_holder = ctk.CTkFrame(specific_frame, fg_color="transparent")
                mi_zoom_holder.grid(row=5, column=0, sticky="w", pady=2)

                radius_var = StringVar(value="0.05")
                rad_frame = ctk.CTkFrame(specific_frame, fg_color="transparent")
                rad_frame.grid(row=6, column=0, sticky="w", pady=3)
                ctk.CTkLabel(rad_frame, text="Radius:", font=("Arial", 12)).grid(row=0, column=0, padx=(0, 5))
                rad_entry = ctk.CTkEntry(rad_frame, width=60, placeholder_text="0.05")
                rad_entry.insert(0, "0.05")
                rad_entry.grid(row=0, column=1, padx=(0, 10))

                region_list_holder = ctk.CTkFrame(specific_frame, fg_color="transparent")
                region_list_holder.grid(row=7, column=0, sticky="w", pady=3)

                # Freehand drawing state
                freehand_state = {"drawing": False, "points": [], "line_ids": []}

                def reload_mark_canvas():
                    for w in mi_canvas_holder.winfo_children():
                        w.destroy()
                    for w in mi_zoom_holder.winfo_children():
                        w.destroy()
                    for w in region_list_holder.winfo_children():
                        w.destroy()

                    img_path = mi_img_entry.get().strip()
                    mi_canvas, ctrl_frame, s2i, zstate = self._make_zoomable_canvas(
                        mi_canvas_holder, img_path, max_w=500, max_h=350)
                    mi_canvas.grid(row=0, column=0)
                    ctrl_frame.grid(row=0, column=0, sticky="w")
                    # Re-parent ctrl_frame into zoom holder
                    ctrl_frame.grid_forget()
                    ctrl_frame_new = ctk.CTkFrame(mi_zoom_holder, fg_color="transparent")
                    ctrl_frame_new.grid(row=0, column=0, sticky="w")
                    ctk.CTkButton(ctrl_frame_new, text="+", width=35, height=28,
                                  command=lambda: (zstate.update({"scale": min(5.0, zstate["scale"] * 1.3)}), zstate["_redraw"]())
                                  ).grid(row=0, column=0, padx=2)
                    ctk.CTkButton(ctrl_frame_new, text="-", width=35, height=28,
                                  command=lambda: (zstate.update({"scale": max(0.2, zstate["scale"] / 1.3)}), zstate["_redraw"]())
                                  ).grid(row=0, column=1, padx=2)
                    ctk.CTkButton(ctrl_frame_new, text="Reset", width=50, height=28,
                                  command=lambda: (zstate.update({"scale": 1.0, "offset_x": 0, "offset_y": 0}), zstate["_redraw"]())
                                  ).grid(row=0, column=2, padx=2)

                    cw = zstate["base_w"]
                    ch = zstate["base_h"]

                    # Draw existing regions
                    for reg in mark_regions_data:
                        if reg.get("type") == "polygon":
                            pts = reg.get("points", [])
                            if len(pts) >= 3:
                                flat = []
                                for px, py in pts:
                                    flat.extend([px * cw, py * ch])
                                mi_canvas.create_polygon(*flat, outline="blue", width=2,
                                                         fill="", dash=(3, 2))
                        else:
                            rx, ry = reg["x"] * cw, reg["y"] * ch
                            rr = reg.get("radius", 0.05) * max(cw, ch)
                            mi_canvas.create_oval(rx - rr, ry - rr, rx + rr, ry + rr,
                                                  outline="red", width=2, dash=(3, 2))

                    freehand_state["drawing"] = False
                    freehand_state["points"] = []
                    freehand_state["line_ids"] = []

                    def on_click(e):
                        if draw_mode_var.get() == "circle":
                            nx, ny = s2i(e.x, e.y)
                            try:
                                rad = float(rad_entry.get())
                            except ValueError:
                                rad = 0.05
                            mark_regions_data.append({
                                "x": round(nx, 4),
                                "y": round(ny, 4),
                                "radius": round(rad, 4)
                            })
                            reload_mark_canvas()
                        else:
                            # Freehand: start drawing
                            freehand_state["drawing"] = True
                            freehand_state["points"] = [(e.x, e.y)]
                            freehand_state["line_ids"] = []

                    def on_motion(e):
                        if draw_mode_var.get() == "freehand" and freehand_state["drawing"]:
                            pts = freehand_state["points"]
                            if pts:
                                lid = mi_canvas.create_line(pts[-1][0], pts[-1][1], e.x, e.y,
                                                            fill="blue", width=2)
                                freehand_state["line_ids"].append(lid)
                            freehand_state["points"].append((e.x, e.y))

                    def on_release(e):
                        if draw_mode_var.get() == "freehand" and freehand_state["drawing"]:
                            freehand_state["drawing"] = False
                            pts = freehand_state["points"]
                            if len(pts) >= 3:
                                # Convert to normalized points
                                norm_pts = []
                                for px, py in pts:
                                    nx, ny = s2i(px, py)
                                    norm_pts.append([round(nx, 4), round(ny, 4)])
                                mark_regions_data.append({
                                    "type": "polygon",
                                    "points": norm_pts
                                })
                                reload_mark_canvas()
                            else:
                                # Too few points, clean up lines
                                for lid in freehand_state["line_ids"]:
                                    mi_canvas.delete(lid)

                    mi_canvas.bind("<Button-1>", on_click)
                    mi_canvas.bind("<B1-Motion>", on_motion)
                    mi_canvas.bind("<ButtonRelease-1>", on_release)

                    # Show region list
                    for i, reg in enumerate(mark_regions_data):
                        chip = ctk.CTkFrame(region_list_holder, fg_color="#fde8e8", corner_radius=10)
                        chip.grid(row=0, column=i, padx=3)
                        if reg.get("type") == "polygon":
                            label = f"Polygon ({len(reg.get('points', []))}P)"
                        else:
                            label = f"({reg['x']:.2f}, {reg['y']:.2f})"
                        ctk.CTkLabel(chip, text=label,
                                    font=("Arial", 10), text_color="#c0392b"
                                    ).grid(row=0, column=0, padx=(6, 2), pady=2)

                        def remove_reg(idx=i):
                            mark_regions_data.pop(idx)
                            reload_mark_canvas()
                        ctk.CTkButton(chip, text="X", width=20, height=20,
                                     fg_color=COLORS["danger"], command=remove_reg
                                     ).grid(row=0, column=1, padx=(0, 4), pady=2)

                reload_mark_canvas()
                options_widgets.append(("mark_image", mi_img_entry, lambda: mark_regions_data))

            elif qt == QuestionType.MATH_FORMULA.value:
                ctk.CTkLabel(specific_frame, text="Korrekte Formel / Lösung (LaTeX oder Zahl)",
                           font=("Arial", 13, "bold")).grid(row=0, column=0, sticky="w")
                mf_entry = ctk.CTkEntry(specific_frame, width=500,
                                         placeholder_text="z.B. \\frac{1}{2} oder 42 oder x^2+1")
                mf_entry.grid(row=1, column=0, sticky="w", pady=5)
                if question.correct_formula:
                    mf_entry.insert(0, question.correct_formula)
                ctk.CTkLabel(specific_frame, text="Toleranz (0 = exakt)",
                           font=("Arial", 12), text_color=COLORS["text_light"]
                           ).grid(row=2, column=0, sticky="w", pady=(5, 0))
                tol_entry = ctk.CTkEntry(specific_frame, width=100, placeholder_text="0.0")
                tol_entry.grid(row=3, column=0, sticky="w", pady=3)
                tol_entry.insert(0, str(question.tolerance))
                options_widgets.append(("math_formula", mf_entry, tol_entry))

        def add_option():
            sync_options()
            options_data.append({"text": "", "is_correct": False})
            rebuild_options()

        def remove_option(idx):
            sync_options()
            if len(options_data) > 2:
                options_data.pop(idx)
            rebuild_options()

        def add_dd_pair():
            question.drag_drop_pairs.append(DragDropPair(source="", target=""))
            rebuild_options()

        def sync_options():
            qt = type_var.get()
            if qt in (QuestionType.SINGLE_CHOICE.value, QuestionType.MULTIPLE_CHOICE.value):
                options_data.clear()
                for entry, check_var in options_widgets:
                    options_data.append({"text": entry.get(), "is_correct": check_var.get()})

        rebuild_options()

        # Explanation
        ctk.CTkLabel(scroll, text="Erklärung (optional)", font=("Arial", 13, "bold")
                    ).grid(row=12, column=0, sticky="w")
        expl_box = ctk.CTkTextbox(scroll, width=600, height=60)
        expl_box.grid(row=13, column=0, sticky="w", pady=(3, 15))
        if question.explanation:
            expl_box.insert("1.0", question.explanation)

        def save_question():
            qt = QuestionType(type_var.get())
            question.question_type = qt
            question.title = title_entry.get().strip()
            question.text = text_box.get("1.0", "end-1c").strip()
            question.topic = topic_entry.get().strip()
            question.points = points_var.get()
            question.weight = round(weight_slider.get(), 1)
            question.explanation = expl_box.get("1.0", "end-1c").strip()
            if q_img_entry is not None:
                question.image_path = q_img_entry.get().strip()

            if qt in (QuestionType.SINGLE_CHOICE, QuestionType.MULTIPLE_CHOICE):
                sync_options()
                question.options = [Option(text=o["text"], is_correct=o["is_correct"])
                                   for o in options_data if o["text"].strip()]
            elif qt == QuestionType.FREE_TEXT:
                for item in options_widgets:
                    if item[0] == "free_text":
                        question.correct_text = item[1].get().strip()
            elif qt == QuestionType.FILL_BLANK:
                for item in options_widgets:
                    if item[0] == "blanks":
                        text = item[1].get("1.0", "end-1c").strip()
                        question.blanks = [b.strip() for b in text.split("\n") if b.strip()]
            elif qt == QuestionType.DRAG_DROP:
                pairs = []
                for item in options_widgets:
                    if item[0] == "dd_pair":
                        s = item[1].get().strip()
                        t = item[2].get().strip()
                        if s and t:
                            pairs.append(DragDropPair(source=s, target=t))
                question.drag_drop_pairs = pairs
            elif qt == QuestionType.DIAGRAM_LABEL:
                for item in options_widgets:
                    if item[0] == "diagram":
                        question.diagram_image_path = item[1].get().strip()
                        positions = item[2]()  # {label: [x_frac, y_frac]}
                        question.diagram_labels = [
                            DiagramLabel(label=name, x=round(coord[0], 4), y=round(coord[1], 4))
                            for name, coord in positions.items()
                        ]
            elif qt == QuestionType.MARK_IMAGE:
                for item in options_widgets:
                    if item[0] == "mark_image":
                        question.image_path = item[1].get().strip()
                        question.mark_regions = item[2]()
            elif qt == QuestionType.MATH_FORMULA:
                for item in options_widgets:
                    if item[0] == "math_formula":
                        question.correct_formula = item[1].get().strip()
                        try:
                            question.tolerance = float(item[2].get())
                        except ValueError:
                            question.tolerance = 0.0

            if not question.text:
                messagebox.showwarning("Hinweis", "Bitte Fragentext eingeben!")
                return

            if editing:
                quiz.questions[question_idx] = question
            else:
                quiz.questions.append(question)
            on_done()

        btn_f = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_f.grid(row=14, column=0, sticky="w", pady=10)
        ctk.CTkButton(btn_f, text="Speichern", fg_color=COLORS["success"],
                     command=save_question).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(btn_f, text="Abbrechen", fg_color=COLORS["text_light"],
                     command=on_done).grid(row=0, column=1)

    def _browse_image(self, entry):
        path = filedialog.askopenfilename(filetypes=[("Bilder", "*.png *.jpg *.jpeg *.gif *.bmp")])
        if path:
            entry.delete(0, "end")
            entry.insert(0, path)

    def _load_diagram_image(self, image_path, max_w=520, max_h=360):
        """Load and scale a diagram image. Returns (PhotoImage|None, width, height)."""
        if image_path and os.path.exists(image_path) and Image is not None:
            try:
                img = Image.open(image_path)
                img.thumbnail((max_w, max_h))
                return ImageTk.PhotoImage(img), img.width, img.height
            except Exception:
                pass
        return None, max_w, max_h

    @staticmethod
    def _point_in_polygon(px, py, polygon_points):
        """Ray casting algorithm for point-in-polygon test."""
        n = len(polygon_points)
        inside = False
        j = n - 1
        for i in range(n):
            xi, yi = polygon_points[i]
            xj, yj = polygon_points[j]
            if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
                inside = not inside
            j = i
        return inside

    def _make_zoomable_canvas(self, parent, image_path, max_w=600, max_h=400):
        """Create a canvas with zoom and pan for an image.
        Returns (canvas, ctrl_frame, screen_to_image_fn, zoom_state)."""
        photo, cw, ch = self._load_diagram_image(image_path, max_w=max_w, max_h=max_h)

        zoom_state = {"scale": 1.0, "offset_x": 0, "offset_y": 0,
                      "dragging": False, "last_x": 0, "last_y": 0,
                      "base_w": cw, "base_h": ch}

        canvas = tk.Canvas(parent, width=cw, height=ch, bg="white",
                          highlightthickness=1, highlightbackground="#cccccc")

        if photo:
            canvas.create_image(0, 0, anchor="nw", image=photo, tags="bg_image")
            canvas.image = photo

        # Store original PIL image for re-rendering at different zoom levels
        original_img = None
        if image_path and os.path.exists(image_path) and Image is not None:
            try:
                original_img = Image.open(image_path)
            except Exception:
                pass

        def _redraw():
            canvas.delete("bg_image")
            if original_img and ImageTk:
                s = zoom_state["scale"]
                new_w = int(zoom_state["base_w"] * s)
                new_h = int(zoom_state["base_h"] * s)
                if new_w > 0 and new_h > 0:
                    resized = original_img.resize((new_w, new_h), Image.LANCZOS)
                    new_photo = ImageTk.PhotoImage(resized)
                    canvas.create_image(zoom_state["offset_x"], zoom_state["offset_y"],
                                       anchor="nw", image=new_photo, tags="bg_image")
                    canvas.tag_lower("bg_image")
                    canvas._zoom_photo = new_photo  # prevent GC

        zoom_state["_redraw"] = _redraw

        def on_scroll(e):
            if e.delta > 0 or e.num == 4:
                zoom_state["scale"] = min(5.0, zoom_state["scale"] * 1.15)
            else:
                zoom_state["scale"] = max(0.2, zoom_state["scale"] / 1.15)
            _redraw()

        def on_right_press(e):
            zoom_state["dragging"] = True
            zoom_state["last_x"] = e.x
            zoom_state["last_y"] = e.y

        def on_right_motion(e):
            if zoom_state["dragging"]:
                dx = e.x - zoom_state["last_x"]
                dy = e.y - zoom_state["last_y"]
                zoom_state["offset_x"] += dx
                zoom_state["offset_y"] += dy
                zoom_state["last_x"] = e.x
                zoom_state["last_y"] = e.y
                _redraw()

        def on_right_release(e):
            zoom_state["dragging"] = False

        canvas.bind("<MouseWheel>", on_scroll)
        canvas.bind("<Button-4>", on_scroll)
        canvas.bind("<Button-5>", on_scroll)
        canvas.bind("<Button-3>", on_right_press)
        canvas.bind("<B3-Motion>", on_right_motion)
        canvas.bind("<ButtonRelease-3>", on_right_release)

        # Zoom controls
        ctrl_frame = ctk.CTkFrame(parent, fg_color="transparent")
        ctk.CTkButton(ctrl_frame, text="+", width=35, height=28,
                      command=lambda: (zoom_state.update({"scale": min(5.0, zoom_state["scale"] * 1.3)}), _redraw())
                      ).grid(row=0, column=0, padx=2)
        ctk.CTkButton(ctrl_frame, text="-", width=35, height=28,
                      command=lambda: (zoom_state.update({"scale": max(0.2, zoom_state["scale"] / 1.3)}), _redraw())
                      ).grid(row=0, column=1, padx=2)
        ctk.CTkButton(ctrl_frame, text="Reset", width=50, height=28,
                      command=lambda: (zoom_state.update({"scale": 1.0, "offset_x": 0, "offset_y": 0}), _redraw())
                      ).grid(row=0, column=2, padx=2)

        def screen_to_image(sx, sy):
            """Convert screen coords to original image coords (0-1 normalized)."""
            s = zoom_state["scale"]
            bw = zoom_state["base_w"]
            bh = zoom_state["base_h"]
            ix = (sx - zoom_state["offset_x"]) / (bw * s) if bw > 0 else 0
            iy = (sy - zoom_state["offset_y"]) / (bh * s) if bh > 0 else 0
            return max(0, min(1, ix)), max(0, min(1, iy))

        return canvas, ctrl_frame, screen_to_image, zoom_state

    def _render_rich_text(self, parent, text: str, font=("Segoe UI", 13),
                         text_color=None, wraplength=700, **grid_kw):
        """Render text that may contain LaTeX ($...$) formulas.
        If LaTeX found and matplotlib available: uses tk.Text with embedded images.
        Otherwise: falls back to CTkLabel with plain-text formulas."""
        tc = text_color or COLORS["text"]
        if not has_latex(text):
            lbl = ctk.CTkLabel(parent, text=text, font=font, text_color=tc,
                               wraplength=wraplength, justify="left")
            if grid_kw:
                lbl.grid(**grid_kw)
            return lbl

        if not can_render_latex():
            plain = latex_to_plain(text)
            lbl = ctk.CTkLabel(parent, text=plain, font=font, text_color=tc,
                               wraplength=wraplength, justify="left")
            if grid_kw:
                lbl.grid(**grid_kw)
            return lbl

        parts = split_text_and_formulas(text)
        tw = tk.Text(parent, wrap="word", font=font, fg=tc,
                     bg=COLORS.get("card", "#ffffff"), bd=0, highlightthickness=0,
                     padx=4, pady=4, width=wraplength // 8, height=1)
        tw.configure(state="normal")
        self._latex_images = getattr(self, "_latex_images", [])
        for part in parts:
            if part["type"] == "text":
                tw.insert("end", part["content"])
            else:
                img = render_formula(part["content"], fontsize=font[1], text_color=tc)
                if img:
                    if ImageTk:
                        photo = ImageTk.PhotoImage(img)
                    else:
                        photo = None
                    if photo:
                        self._latex_images.append(photo)
                        tw.image_create("end", image=photo, padx=2)
                    else:
                        tw.insert("end", latex_to_plain(f"${part['content']}$"))
                else:
                    tw.insert("end", latex_to_plain(f"${part['content']}$"))
        tw.configure(state="disabled")
        tw.update_idletasks()
        line_count = int(tw.index("end-1c").split(".")[0])
        tw.configure(height=max(1, line_count))
        if grid_kw:
            tw.grid(**grid_kw)
        return tw

    def _make_draggable_chip(self, canvas, x, y, text, on_drop):
        """Create a draggable label chip (rectangle + text) on a canvas.
        on_drop(center_x, center_y) is called after each drag release."""
        tag = f"chip{id(text)}_{random.randint(0, 1_000_000)}"
        tid = canvas.create_text(x, y, text=text, font=("Arial", 10, "bold"),
                                 fill="white", tags=(tag,))
        bb = canvas.bbox(tid)
        pad = 6
        rid = canvas.create_rectangle(bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad,
                                      fill="#2980b9", outline="#1a5276", width=2, tags=(tag,))
        canvas.tag_lower(rid, tid)
        state = {"x": 0, "y": 0}

        def press(e):
            state["x"], state["y"] = e.x, e.y

        def motion(e):
            canvas.move(tag, e.x - state["x"], e.y - state["y"])
            state["x"], state["y"] = e.x, e.y

        def release(e):
            box = canvas.bbox(tag)
            cx = (box[0] + box[2]) / 2
            cy = (box[1] + box[3]) / 2
            on_drop(cx, cy)

        canvas.tag_bind(tag, "<Button-1>", press)
        canvas.tag_bind(tag, "<B1-Motion>", motion)
        canvas.tag_bind(tag, "<ButtonRelease-1>", release)
        return tag

    # ── AI GENERATE ──

    def _file_dialog_with_pdf(self):
        return filedialog.askopenfilename(filetypes=[
            ("Dokumente", "*.pdf *.pptx *.docx *.txt *.md *.csv *.png *.jpg"),
            ("PDF", "*.pdf"),
            ("PowerPoint", "*.pptx"),
            ("Word", "*.docx"),
            ("Bilder", "*.png *.jpg *.jpeg"),
            ("Text", "*.txt *.md"),
            ("Alle", "*.*"),
        ])

    def _build_model_selector(self, parent, row_start: int, topic: str = "") -> tuple:
        """Build model dropdown with recommendations. Returns (model_var, model_id_map, menu_widget, rec_frame, next_row)."""
        from .ai_service import AIService

        if topic:
            models = AIService.rank_models_for_topic(topic)
        else:
            models = []
            for m in AIService.RECOMMENDED_MODELS:
                models.append({**m, "tag": ""})
            models[0]["tag"] = "Empfehlung"
            fastest = min(range(len(models)), key=lambda i: 0 if models[i]["speed"] == "schnell" else 1)
            cheapest = min(range(len(models)), key=lambda i: models[i]["cost_in"] + models[i]["cost_out"])
            if not models[fastest].get("tag"):
                models[fastest]["tag"] = "Geschwindigkeit"
            if not models[cheapest].get("tag"):
                models[cheapest]["tag"] = "Kosten"

        ctk.CTkLabel(parent, text=t("ai.model_select"), font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=row_start, column=0, sticky="w", pady=(15, 5))

        rec_frame = ctk.CTkFrame(parent, fg_color="transparent")
        rec_frame.grid(row=row_start + 1, column=0, sticky="w", pady=(0, 5))
        self._populate_rec_badges(rec_frame, models)

        display_names, model_id_map = self._model_display_list(models)

        settings = self.store.load_settings()
        current_model = settings.get("model", "deepseek/deepseek-chat")
        current_in_list = any(mid == current_model for mid in model_id_map.values())
        if not current_in_list:
            custom_label = f"{current_model} (aktuell)"
            display_names.append(custom_label)
            model_id_map[custom_label] = current_model

        model_var = StringVar(value=display_names[0])
        for label, mid in model_id_map.items():
            if mid == current_model:
                model_var.set(label)
                break

        menu = ctk.CTkOptionMenu(parent, values=display_names, variable=model_var, width=500)
        menu.grid(row=row_start + 2, column=0, sticky="w", pady=5)

        return model_var, model_id_map, menu, rec_frame, row_start + 3

    def _populate_rec_badges(self, frame, models):
        for w in frame.winfo_children():
            w.destroy()
        tags_map = {"Empfehlung": (t("ai.rec_accuracy"), "🎯", COLORS["success"]),
                    "Geschwindigkeit": (t("ai.rec_speed"), "⚡", COLORS["primary"]),
                    "Kosten": (t("ai.rec_cost"), "💰", COLORS["warning"])}
        col = 0
        for m in models[:3]:
            tag = m.get("tag", "")
            if tag in tags_map:
                label_text, icon, color = tags_map[tag]
                ctk.CTkLabel(frame, text=f"{icon} {label_text}: {m['name']}",
                            font=("Arial", 11), text_color=color,
                            ).grid(row=0, column=col, padx=(0, 15))
                col += 1

    def _model_display_list(self, models):
        from .ai_service import AIService
        tags_t = {"Empfehlung": t("ai.rec_accuracy"), "Geschwindigkeit": t("ai.rec_speed"), "Kosten": t("ai.rec_cost")}
        display_names = []
        model_id_map = {}
        for m in models:
            cost_sym = AIService._cost_label(m["cost_in"], m["cost_out"])
            cost_cents = f"~${m['cost_in'] + m['cost_out']:.1f}/1M"
            tag = f" [{tags_t.get(m.get('tag', ''), m.get('tag', ''))}]" if m.get("tag") else ""
            label = f"{m['name']} ({cost_sym} {cost_cents}, {m['speed']}){tag}"
            display_names.append(label)
            model_id_map[label] = m["id"]
        return display_names, model_id_map

    def _update_model_selector_for_topic(self, topic, model_var, model_id_map, menu, rec_frame):
        from .ai_service import AIService
        models = AIService.rank_models_for_topic(topic)
        self._populate_rec_badges(rec_frame, models)
        display_names, new_map = self._model_display_list(models)
        model_id_map.clear()
        model_id_map.update(new_map)

        settings = self.store.load_settings()
        current_model = settings.get("model", "deepseek/deepseek-chat")
        if not any(mid == current_model for mid in model_id_map.values()):
            custom_label = f"{current_model} (aktuell)"
            display_names.append(custom_label)
            model_id_map[custom_label] = current_model

        menu.configure(values=display_names)
        model_var.set(display_names[0])

    def _build_analysis_panel(self, parent, row: int) -> ctk.CTkFrame:
        """Build the document analysis display frame. Returns the frame."""
        analysis_frame = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=8, border_width=1,
                                      border_color=COLORS["primary"])
        analysis_frame.grid(row=row, column=0, sticky="ew", pady=(10, 5))
        analysis_frame.grid_columnconfigure(1, weight=1)
        analysis_frame.grid_remove()
        return analysis_frame

    def _run_analysis(self, file_path: str, analysis_frame: ctk.CTkFrame,
                      model_selector_state: tuple = None):
        """Run document analysis in background and populate the frame.
        model_selector_state: (model_var, model_id_map, menu, rec_frame) to update recommendations."""
        for w in analysis_frame.winfo_children():
            w.destroy()
        ctk.CTkLabel(analysis_frame, text=f"  {t('ai.analyzing')}", font=("Arial", 12),
                    text_color=COLORS["text_light"]).grid(row=0, column=0, columnspan=2, padx=10, pady=8)
        analysis_frame.grid()

        def run():
            result = self.ai.analyze_document(file_path)
            def update():
                for w in analysis_frame.winfo_children():
                    w.destroy()
                ctk.CTkLabel(analysis_frame, text=f"  {t('ai.analysis_title')}", font=("Arial", 13, "bold"),
                            text_color=COLORS["primary"]).grid(row=0, column=0, columnspan=2, sticky="w", padx=10, pady=(8, 4))

                r = 1
                topic = result.get("topic", "Unbekannt")
                complexity = result.get("complexity", "Unbekannt")
                summary = result.get("summary", "")
                subtopics = result.get("subtopics", [])

                complexity_colors = {"einfach": COLORS["success"], "mittel": COLORS["warning"],
                                     "schwer": COLORS["danger"], "sehr schwer": COLORS["danger"]}

                ctk.CTkLabel(analysis_frame, text=f"{t('ai.topic')}:", font=("Arial", 12, "bold"),
                            text_color=COLORS["text"]).grid(row=r, column=0, sticky="w", padx=(10, 5), pady=2)
                ctk.CTkLabel(analysis_frame, text=topic, font=("Arial", 12),
                            text_color=COLORS["text"]).grid(row=r, column=1, sticky="w", pady=2)
                r += 1

                ctk.CTkLabel(analysis_frame, text=f"{t('ai.complexity')}:", font=("Arial", 12, "bold"),
                            text_color=COLORS["text"]).grid(row=r, column=0, sticky="w", padx=(10, 5), pady=2)
                ctk.CTkLabel(analysis_frame, text=complexity, font=("Arial", 12),
                            text_color=complexity_colors.get(complexity, COLORS["text"])
                            ).grid(row=r, column=1, sticky="w", pady=2)
                r += 1

                if subtopics:
                    ctk.CTkLabel(analysis_frame, text=f"{t('ai.subtopics')}:", font=("Arial", 12, "bold"),
                                text_color=COLORS["text"]).grid(row=r, column=0, sticky="nw", padx=(10, 5), pady=2)
                    ctk.CTkLabel(analysis_frame, text=", ".join(subtopics[:6]), font=("Arial", 11),
                                text_color=COLORS["text_light"], wraplength=400
                                ).grid(row=r, column=1, sticky="w", pady=2)
                    r += 1

                if summary:
                    ctk.CTkLabel(analysis_frame, text=summary, font=("Arial", 11),
                                text_color=COLORS["text_light"], wraplength=500
                                ).grid(row=r, column=0, columnspan=2, sticky="w", padx=10, pady=(4, 8))

                if model_selector_state and topic and topic != "Unbekannt":
                    mv, mid_map, menu_w, rf = model_selector_state
                    self._update_model_selector_for_topic(topic, mv, mid_map, menu_w, rf)

            self.after(0, update)

        threading.Thread(target=run, daemon=True).start()

    # ── FORMULA SHEET (FoSa) ──

    def show_formula_sheets(self):
        self._clear_main()
        scroll = self._make_screen()

        ctk.CTkLabel(scroll, text=t("fosa.title"), font=("Arial", 18, "bold"),
                     text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 5))
        ctk.CTkLabel(scroll, text=t("fosa.intro"), font=("Arial", 12),
                     text_color=COLORS["text_light"]).grid(row=1, column=0, sticky="w", pady=(0, 15))

        ctk.CTkButton(scroll, text=t("fosa.new"), fg_color=COLORS["success"],
                      command=self.show_create_formula_sheet
                      ).grid(row=2, column=0, sticky="w", pady=(0, 15))

        if not self.formula_sheets:
            ctk.CTkLabel(scroll, text=t("fosa.empty"), font=("Arial", 13),
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
                ctk.CTkButton(btns, text=t("home.open"), width=75, height=30, corner_radius=8,
                              fg_color=COLORS["primary"], font=("Segoe UI", 12, "bold"),
                              command=lambda s=sheet: self.show_formula_sheet_view(s)
                              ).grid(row=0, column=0, padx=3)
                ctk.CTkButton(btns, text="✕", width=30, height=30, corner_radius=8,
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

        ctk.CTkLabel(scroll, text=t("fosa.new"), font=("Arial", 18, "bold"),
                     text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 5))
        ctk.CTkLabel(scroll, text=t("fosa.new_sub"), font=("Arial", 12),
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

        ctk.CTkLabel(scroll, text=sheet.name, font=("Arial", 18, "bold"),
                     text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 2))
        sub = sheet.subject + "  ·  " if sheet.subject else ""
        ctk.CTkLabel(scroll, text=f"{sub}{t('fosa.count', n=len(sheet.formulas))}",
                     font=("Arial", 12), text_color=COLORS["text_light"]
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
                             ).grid(row=3, column=0, sticky="w", padx=15, pady=(0, 12))
            else:
                ctk.CTkLabel(card, text="").grid(row=3, column=0, pady=(0, 6))
            row += 1

        ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                      command=self.show_formula_sheets).grid(row=row, column=0, sticky="w", pady=15)

    def show_ai_generate(self):
        self._clear_main()
        scroll = self._make_screen()

        ctk.CTkLabel(scroll, text="KI-Fragengenerierung aus Vorlesungsfolien",
                    font=("Arial", 18, "bold"), text_color=COLORS["text"]
                    ).grid(row=0, column=0, sticky="w", pady=(0, 5))
        ctk.CTkLabel(scroll, text="Lade eine PDF-, PowerPoint-, Word- oder Textdatei hoch.",
                    font=("Arial", 12), text_color=COLORS["text_light"]
                    ).grid(row=1, column=0, sticky="w", pady=(0, 20))

        # File selection
        file_var = StringVar()
        file_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        file_frame.grid(row=2, column=0, sticky="ew")
        ctk.CTkEntry(file_frame, textvariable=file_var, width=400, placeholder_text="Datei auswählen..."
                    ).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(file_frame, text="Durchsuchen", width=100,
                     command=lambda: self._on_file_selected_gen(file_var, est_label, chunk_slider, analysis_frame,
                                                                (model_var, model_id_map, model_menu, model_rec_frame))
                     ).grid(row=0, column=1)

        # Estimation display
        est_label = ctk.CTkLabel(scroll, text="", font=("Arial", 12, "bold"),
                                text_color=COLORS["primary"])
        est_label.grid(row=3, column=0, sticky="w", pady=(8, 0))

        # Analysis panel (hidden until file selected)
        analysis_frame = self._build_analysis_panel(scroll, row=4)

        # Model selector
        model_var, model_id_map, model_menu, model_rec_frame, next_row = self._build_model_selector(scroll, row_start=5)

        model_menu.configure(command=lambda _: update_estimate())

        # Question type selection
        ctk.CTkLabel(scroll, text="Fragetypen auswählen:", font=("Segoe UI", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=next_row, column=0, sticky="w", pady=(15, 5))
        qt_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        qt_frame.grid(row=next_row + 1, column=0, sticky="w")
        QUESTION_TYPES_UI = [
            ("Single Choice", "single_choice"),
            ("Multiple Choice", "multiple_choice"),
            ("Freitext", "free_text"),
            ("Lückentext", "fill_blank"),
            ("Drag & Drop", "drag_drop"),
            ("Mathe-Formel", "math_formula"),
        ]
        qt_vars = {}
        for i, (label, key) in enumerate(QUESTION_TYPES_UI):
            var = BooleanVar(value=True)
            qt_vars[key] = var
            ctk.CTkCheckBox(qt_frame, text=label, variable=var, font=("Segoe UI", 12),
                           ).grid(row=0, column=i, padx=(0, 12))

        # Number of questions
        ctk.CTkLabel(scroll, text="Anzahl Fragen (1–500)", font=("Segoe UI", 13, "bold")
                    ).grid(row=next_row + 2, column=0, sticky="w", pady=(15, 0))
        num_var = IntVar(value=20)
        num_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        num_frame.grid(row=next_row + 3, column=0, sticky="w", pady=5)
        num_entry = ctk.CTkEntry(num_frame, width=80, font=("Segoe UI", 12),
                                 placeholder_text="20")
        num_entry.insert(0, "20")
        num_entry.grid(row=0, column=0, padx=(0, 10))
        for preset in ["10", "20", "50", "100"]:
            ctk.CTkButton(num_frame, text=preset, width=45, height=28, fg_color=COLORS["text_light"],
                         font=("Segoe UI", 11),
                         command=lambda v=preset: (num_entry.delete(0, "end"), num_entry.insert(0, v))
                         ).grid(row=0, column=int(preset) + 1, padx=2)

        def _get_num():
            try:
                n = int(num_entry.get())
                return max(1, min(500, n))
            except ValueError:
                return 20

        # Quiz name
        ctk.CTkLabel(scroll, text="Quiz-Name", font=("Segoe UI", 13, "bold")
                    ).grid(row=next_row + 4, column=0, sticky="w", pady=(10, 0))
        name_entry = ctk.CTkEntry(scroll, width=400, placeholder_text="Name für das Quiz")
        name_entry.grid(row=next_row + 5, column=0, sticky="w", pady=5)

        # ── Slider: Kontext-Größe ──
        chunk_label = ctk.CTkLabel(scroll, text="Kontext-Größe: 6.000 Zeichen",
                                   font=("Segoe UI", 13, "bold"), text_color=COLORS["text"])
        chunk_label.grid(row=next_row + 6, column=0, sticky="w", pady=(15, 0))
        ctk.CTkLabel(scroll, text="Wie viel Text pro API-Call gesendet wird (größer = weniger Aufrufe, aber teurer)",
                    font=("Segoe UI", 11), text_color=COLORS["text_light"]
                    ).grid(row=next_row + 7, column=0, sticky="w")
        chunk_slider = ctk.CTkSlider(scroll, from_=2000, to=40000, number_of_steps=38, width=400)
        chunk_slider.set(6000)
        def on_chunk(v):
            chunk_label.configure(text=f"Kontext-Größe: {int(v):,} Zeichen".replace(",", "."))
            update_estimate()
        chunk_slider.configure(command=on_chunk)
        chunk_slider.grid(row=next_row + 8, column=0, sticky="w", pady=5)

        # ── Slider: Temperature ──
        temp_label = ctk.CTkLabel(scroll, text="Kreativität (Temperature): 0.30",
                                  font=("Segoe UI", 13, "bold"), text_color=COLORS["text"])
        temp_label.grid(row=next_row + 9, column=0, sticky="w", pady=(15, 0))
        ctk.CTkLabel(scroll, text="Niedrig = präziser, Hoch = kreativer/vielfältiger",
                    font=("Segoe UI", 11), text_color=COLORS["text_light"]
                    ).grid(row=next_row + 10, column=0, sticky="w")
        temp_slider = ctk.CTkSlider(scroll, from_=0, to=1.0, number_of_steps=20, width=400)
        temp_slider.set(0.3)
        temp_slider.configure(command=lambda v: temp_label.configure(
            text=f"Kreativität (Temperature): {v:.2f}"))
        temp_slider.grid(row=next_row + 11, column=0, sticky="w", pady=5)

        def update_estimate():
            path = file_var.get()
            if not path:
                est_label.configure(text="")
                return
            self.ai.chunk_size = int(chunk_slider.get())
            self.ai.overlap = max(500, self.ai.chunk_size // 6)
            selected_model = model_id_map.get(model_var.get(), self.ai.model)
            try:
                est = self.ai.estimate_processing(path, mode="generate",
                                                  model_override=selected_model)
                size_kb = est["file_size"] / 1024
                mins = est["est_total_seconds"] // 60
                secs = est["est_total_seconds"] % 60
                est_label.configure(
                    text=f"Datei: {size_kb:.0f} KB · {est['text_length']:,} Zeichen · "
                         f"{est['num_chunks']} Chunks (sequentiell) · "
                         f"ca. {mins}:{secs:02d} min · "
                         f"~${est.get('est_cost_usd', 0):.3f}".replace(",", "."))
            except Exception:
                est_label.configure(text="Schätzung nicht möglich")

        # Progress
        progress_label = ctk.CTkLabel(scroll, text="", font=("Segoe UI", 12), text_color=COLORS["primary"])
        progress_label.grid(row=next_row + 13, column=0, sticky="w", pady=10)
        progress_bar = ctk.CTkProgressBar(scroll, width=400)
        progress_bar.grid(row=next_row + 14, column=0, sticky="w")
        progress_bar.set(0)

        def generate():
            if not file_var.get():
                messagebox.showwarning("Hinweis", "Bitte eine Datei auswählen!")
                return
            if not self.ai.api_key:
                messagebox.showwarning("Hinweis", "Bitte zuerst API-Key in den Einstellungen speichern!")
                return

            selected_model = model_id_map.get(model_var.get(), self.ai.model)
            self.ai.model = selected_model
            self.ai.chunk_size = int(chunk_slider.get())
            self.ai.overlap = max(500, self.ai.chunk_size // 6)
            self.ai.temperature = round(temp_slider.get(), 2)
            start_time = time.time()

            def run():
                def progress_cb(current, total):
                    elapsed = time.time() - start_time
                    per_chunk = elapsed / max(1, current)
                    remaining = int(per_chunk * (total - current))
                    r_min, r_sec = divmod(remaining, 60)
                    self.after(0, lambda c=current, t=total, rm=r_min, rs=r_sec: (
                        progress_label.configure(
                            text=f"Chunk {c}/{t} · ca. {rm}:{rs:02d} verbleibend"),
                        progress_bar.set(c / t)
                    ))

                selected_types = [k for k, v in qt_vars.items() if v.get()]
                try:
                    questions = self.ai.generate_from_slides(
                        file_var.get(), _get_num(), progress_cb,
                        question_types=selected_types or None)
                except Exception as exc:
                    msg = str(exc)
                    self.after(0, lambda m=msg: (
                        progress_label.configure(text="Fehler: " + m),
                        messagebox.showerror("Fehler beim Lesen der Datei", m)
                    ))
                    return
                def done():
                    elapsed = int(time.time() - start_time)
                    em, es = divmod(elapsed, 60)
                    if questions:
                        quiz = Quiz(
                            name=name_entry.get().strip() or "KI-generiertes Quiz",
                            description=f"{len(questions)} Fragen aus {Path(file_var.get()).name}",
                            created=datetime.now().isoformat(),
                            questions=questions,
                        )
                        self.quizzes.append(quiz)
                        self.store.save_quizzes(self.quizzes)
                        messagebox.showinfo("Fertig",
                            f"{len(questions)} Fragen in {em}:{es:02d} min generiert!")
                        self.show_home()
                    else:
                        progress_label.configure(text="Keine Fragen generiert. Prüfe API-Key und Datei.")
                self.after(0, done)

            threading.Thread(target=run, daemon=True).start()

        btn_f = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_f.grid(row=next_row + 15, column=0, sticky="w", pady=15)
        ctk.CTkButton(btn_f, text="Fragen generieren", fg_color=COLORS["success"],
                     command=generate).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(btn_f, text="Zurück", fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=0, column=1)

    def _on_file_selected_gen(self, file_var, est_label, chunk_slider, analysis_frame,
                              model_selector_state=None):
        path = self._file_dialog_with_pdf()
        if not path:
            return
        file_var.set(path)
        self.ai.chunk_size = int(chunk_slider.get())
        self.ai.overlap = max(500, self.ai.chunk_size // 6)
        self._save_source_text_bg(path)
        selected_model = ""
        if model_selector_state:
            mv, mid_map = model_selector_state[0], model_selector_state[1]
            selected_model = mid_map.get(mv.get(), self.ai.model)
        try:
            est = self.ai.estimate_processing(path, mode="generate",
                                              model_override=selected_model)
            size_kb = est["file_size"] / 1024
            mins = est["est_total_seconds"] // 60
            secs = est["est_total_seconds"] % 60
            est_label.configure(
                text=f"Datei: {size_kb:.0f} KB · {est['text_length']:,} Zeichen · "
                     f"{est['num_chunks']} Chunks (sequentiell) · "
                     f"ca. {mins}:{secs:02d} min · "
                     f"~${est.get('est_cost_usd', 0):.3f}".replace(",", "."))
        except Exception:
            est_label.configure(text="Schätzung nicht möglich")
        if self.ai.api_key:
            self._run_analysis(path, analysis_frame, model_selector_state)

    def _on_file_selected_imp(self, file_var, est_label, chunk_slider, analysis_frame,
                              model_selector_state=None):
        path = self._file_dialog_with_pdf()
        if not path:
            return
        file_var.set(path)
        self.ai.chunk_size = int(chunk_slider.get())
        self.ai.overlap = max(500, self.ai.chunk_size // 6)
        self._save_source_text_bg(path)
        selected_model = ""
        if model_selector_state:
            mv, mid_map = model_selector_state[0], model_selector_state[1]
            selected_model = mid_map.get(mv.get(), self.ai.model)
        try:
            est = self.ai.estimate_processing(path, mode="import",
                                              model_override=selected_model)
            size_kb = est["file_size"] / 1024
            mins = est["est_total_seconds"] // 60
            secs = est["est_total_seconds"] % 60
            par_text = "parallel" if est["parallel"] else "sequentiell"
            est_label.configure(
                text=f"Datei: {size_kb:.0f} KB · {est['text_length']:,} Zeichen · "
                     f"{est['num_chunks']} Chunks ({par_text}) · "
                     f"ca. {mins}:{secs:02d} min · "
                     f"~${est.get('est_cost_usd', 0):.3f}".replace(",", "."))
        except Exception:
            est_label.configure(text="Schätzung nicht möglich")
        if self.ai.api_key:
            self._run_analysis(path, analysis_frame, model_selector_state)

    def _save_source_text_bg(self, file_path: str):
        """Save extracted text from uploaded file in background for cloze reuse."""
        def run():
            try:
                text = self.ai._read_file_as_text(file_path)
                if text and not text.startswith("[IMAGE:"):
                    name = Path(file_path).name
                    self.store.save_source_text(name, text)
            except Exception:
                pass
        threading.Thread(target=run, daemon=True).start()

    # ── AI IMPORT ──

    def show_ai_import(self):
        self._clear_main()
        scroll = self._make_screen()

        ctk.CTkLabel(scroll, text="Fragen aus Dokument importieren",
                    font=("Arial", 18, "bold"), text_color=COLORS["text"]
                    ).grid(row=0, column=0, sticky="w", pady=(0, 5))
        ctk.CTkLabel(scroll, text="Lade ein PDF, PowerPoint, Word oder Übungsskript hoch. Die KI erkennt und importiert alle Fragen (parallel).",
                    font=("Arial", 12), text_color=COLORS["text_light"]
                    ).grid(row=1, column=0, sticky="w", pady=(0, 20))

        file_var = StringVar()
        file_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        file_frame.grid(row=2, column=0, sticky="ew")
        ctk.CTkEntry(file_frame, textvariable=file_var, width=400, placeholder_text="Datei auswählen..."
                    ).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(file_frame, text="Durchsuchen", width=100,
                     command=lambda: self._on_file_selected_imp(file_var, est_label, chunk_slider, analysis_frame,
                                                                (model_var, model_id_map, model_menu, model_rec_frame))
                     ).grid(row=0, column=1)

        # Estimation
        est_label = ctk.CTkLabel(scroll, text="", font=("Arial", 12, "bold"),
                                text_color=COLORS["primary"])
        est_label.grid(row=3, column=0, sticky="w", pady=(8, 0))

        # Analysis panel
        analysis_frame = self._build_analysis_panel(scroll, row=4)

        # Model selector
        model_var, model_id_map, model_menu, model_rec_frame, next_row = self._build_model_selector(scroll, row_start=5)

        ctk.CTkLabel(scroll, text="Quiz-Name", font=("Arial", 13, "bold")
                    ).grid(row=next_row, column=0, sticky="w", pady=(15, 0))
        name_entry = ctk.CTkEntry(scroll, width=400, placeholder_text="Name für das importierte Quiz")
        name_entry.grid(row=next_row + 1, column=0, sticky="w", pady=5)

        # ── Slider: Kontext-Größe ──
        chunk_label = ctk.CTkLabel(scroll, text="Kontext-Größe: 6.000 Zeichen",
                                   font=("Arial", 13, "bold"), text_color=COLORS["text"])
        chunk_label.grid(row=next_row + 2, column=0, sticky="w", pady=(15, 0))
        chunk_slider = ctk.CTkSlider(scroll, from_=2000, to=40000, number_of_steps=38, width=400)
        chunk_slider.set(6000)
        def on_chunk_import(v):
            chunk_label.configure(text=f"Kontext-Größe: {int(v):,} Zeichen".replace(",", "."))
            update_estimate()
        chunk_slider.configure(command=on_chunk_import)
        chunk_slider.grid(row=next_row + 3, column=0, sticky="w", pady=5)

        # ── Slider: Temperature ──
        temp_label = ctk.CTkLabel(scroll, text="Kreativität (Temperature): 0.30",
                                  font=("Arial", 13, "bold"), text_color=COLORS["text"])
        temp_label.grid(row=next_row + 4, column=0, sticky="w", pady=(15, 0))
        temp_slider = ctk.CTkSlider(scroll, from_=0, to=1.0, number_of_steps=20, width=400)
        temp_slider.set(0.3)
        temp_slider.configure(command=lambda v: temp_label.configure(
            text=f"Kreativität (Temperature): {v:.2f}"))
        temp_slider.grid(row=next_row + 5, column=0, sticky="w", pady=5)

        def update_estimate():
            path = file_var.get()
            if not path:
                est_label.configure(text="")
                return
            self.ai.chunk_size = int(chunk_slider.get())
            self.ai.overlap = max(500, self.ai.chunk_size // 6)
            selected_model = model_id_map.get(model_var.get(), self.ai.model)
            try:
                est = self.ai.estimate_processing(path, mode="import",
                                                  model_override=selected_model)
                size_kb = est["file_size"] / 1024
                mins = est["est_total_seconds"] // 60
                secs = est["est_total_seconds"] % 60
                par_text = "parallel" if est["parallel"] else "sequentiell"
                est_label.configure(
                    text=f"Datei: {size_kb:.0f} KB · {est['text_length']:,} Zeichen · "
                         f"{est['num_chunks']} Chunks ({par_text}) · "
                         f"ca. {mins}:{secs:02d} min · "
                         f"~${est.get('est_cost_usd', 0):.3f}".replace(",", "."))
            except Exception:
                est_label.configure(text="Schätzung nicht möglich")

        model_menu.configure(command=lambda _: update_estimate())

        progress_label = ctk.CTkLabel(scroll, text="", font=("Arial", 12), text_color=COLORS["primary"])
        progress_label.grid(row=next_row + 6, column=0, sticky="w", pady=10)
        progress_bar = ctk.CTkProgressBar(scroll, width=400)
        progress_bar.grid(row=next_row + 7, column=0, sticky="w")
        progress_bar.set(0)

        def do_import():
            if not file_var.get():
                messagebox.showwarning("Hinweis", "Bitte eine Datei auswählen!")
                return
            if not self.ai.api_key:
                messagebox.showwarning("Hinweis", "Bitte zuerst API-Key in den Einstellungen speichern!")
                return

            selected_model = model_id_map.get(model_var.get(), self.ai.model)
            self.ai.model = selected_model
            self.ai.chunk_size = int(chunk_slider.get())
            self.ai.overlap = max(500, self.ai.chunk_size // 6)
            self.ai.temperature = round(temp_slider.get(), 2)
            start_time = time.time()

            def run():
                def progress_cb(current, total):
                    elapsed = time.time() - start_time
                    per_chunk = elapsed / max(1, current)
                    remaining = int(per_chunk * max(0, total - current))
                    r_min, r_sec = divmod(remaining, 60)
                    self.after(0, lambda c=current, t=total, rm=r_min, rs=r_sec: (
                        progress_label.configure(
                            text=f"Chunk {c}/{t} · ca. {rm}:{rs:02d} verbleibend"),
                        progress_bar.set(c / t)
                    ))

                try:
                    questions = self.ai.import_questions(file_var.get(), progress_cb)
                except Exception as exc:
                    msg = str(exc)
                    self.after(0, lambda m=msg: (
                        progress_label.configure(text="Fehler: " + m),
                        messagebox.showerror("Fehler beim Lesen der Datei", m)
                    ))
                    return
                def done():
                    elapsed = int(time.time() - start_time)
                    em, es = divmod(elapsed, 60)
                    if questions:
                        quiz = Quiz(
                            name=name_entry.get().strip() or "Importiertes Quiz",
                            description=f"{len(questions)} importierte Fragen",
                            created=datetime.now().isoformat(),
                            questions=questions,
                        )
                        self.quizzes.append(quiz)
                        self.store.save_quizzes(self.quizzes)
                        messagebox.showinfo("Fertig",
                            f"{len(questions)} Fragen in {em}:{es:02d} min importiert!")
                        self.show_home()
                    else:
                        progress_label.configure(text="Keine Fragen importiert. Prüfe API-Key und Datei.")
                self.after(0, done)

            threading.Thread(target=run, daemon=True).start()

        btn_f = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_f.grid(row=next_row + 8, column=0, sticky="w", pady=15)
        ctk.CTkButton(btn_f, text="Fragen importieren", fg_color=COLORS["success"],
                     command=do_import).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(btn_f, text="Zurück", fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=0, column=1)

    # ── QUIZ MODES ──

    def show_quiz_modes(self, quiz: Quiz):
        self._clear_main()
        self.current_quiz = quiz

        scroll = self._make_screen()

        ctk.CTkLabel(scroll, text=quiz.name, font=("Arial", 20, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 5))
        ctk.CTkLabel(scroll, text=f"{len(quiz.questions)} Fragen", font=("Arial", 13),
                    text_color=COLORS["text_light"]).grid(row=1, column=0, sticky="w", pady=(0, 10))

        # ── Deadline Dashboard ──
        planner = DeadlinePlanner(self.sr)
        plan = planner.compute_plan(quiz)

        deadline_card = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8,
                                      border_width=2, border_color=COLORS["primary"])
        deadline_card.grid(row=2, column=0, sticky="ew", pady=(0, 15))
        deadline_card.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(deadline_card, text="Klausurtermin", font=("Arial", 14, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(10, 5), sticky="w")

        date_frame = ctk.CTkFrame(deadline_card, fg_color="transparent")
        date_frame.grid(row=1, column=0, columnspan=2, padx=15, pady=(0, 5), sticky="w")
        date_entry = ctk.CTkEntry(date_frame, width=150, placeholder_text="JJJJ-MM-TT")
        date_entry.grid(row=0, column=0, padx=(0, 10))
        if quiz.exam_date:
            date_entry.insert(0, quiz.exam_date)

        def save_date():
            quiz.exam_date = date_entry.get().strip()
            existing = [q for q in self.quizzes if q.id == quiz.id]
            if existing:
                idx = self.quizzes.index(existing[0])
                self.quizzes[idx] = quiz
            self.store.save_quizzes(self.quizzes)
            self.show_quiz_modes(quiz)

        ctk.CTkButton(date_frame, text="Speichern", width=80, fg_color=COLORS["primary"],
                     command=save_date).grid(row=0, column=1)

        if plan:
            urgency_colors = {
                "critical": COLORS["danger"],
                "urgent": COLORS["warning"],
                "normal": COLORS["primary"],
                "relaxed": COLORS["success"],
            }
            urgency_labels = {
                "critical": "KRITISCH",
                "urgent": "DRINGEND",
                "normal": "NORMAL",
                "relaxed": "ENTSPANNT",
            }
            u_color = urgency_colors[plan.urgency]
            u_label = urgency_labels[plan.urgency]

            dash = ctk.CTkFrame(deadline_card, fg_color="transparent")
            dash.grid(row=2, column=0, columnspan=2, padx=15, pady=(5, 10), sticky="ew")
            for c in range(4):
                dash.grid_columnconfigure(c, weight=1)

            # Days remaining
            d_frame = ctk.CTkFrame(dash, fg_color=u_color, corner_radius=8)
            d_frame.grid(row=0, column=0, padx=3, sticky="ew")
            ctk.CTkLabel(d_frame, text=str(plan.days_remaining), font=("Arial", 24, "bold"),
                        text_color="white").grid(row=0, column=0, padx=10, pady=(8, 0))
            ctk.CTkLabel(d_frame, text="Tage", font=("Arial", 10),
                        text_color="white").grid(row=1, column=0, padx=10, pady=(0, 8))

            # Today's workload
            t_frame = ctk.CTkFrame(dash, fg_color=COLORS["primary"], corner_radius=8)
            t_frame.grid(row=0, column=1, padx=3, sticky="ew")
            ctk.CTkLabel(t_frame, text=str(plan.questions_today), font=("Arial", 24, "bold"),
                        text_color="white").grid(row=0, column=0, padx=10, pady=(8, 0))
            ctk.CTkLabel(t_frame, text="Heute", font=("Arial", 10),
                        text_color="white").grid(row=1, column=0, padx=10, pady=(0, 8))

            # Readiness
            r_color = COLORS["success"] if plan.readiness_pct >= 80 else COLORS["warning"] if plan.readiness_pct >= 50 else COLORS["danger"]
            r_frame = ctk.CTkFrame(dash, fg_color=r_color, corner_radius=8)
            r_frame.grid(row=0, column=2, padx=3, sticky="ew")
            ctk.CTkLabel(r_frame, text=f"{plan.readiness_pct:.0f}%", font=("Arial", 24, "bold"),
                        text_color="white").grid(row=0, column=0, padx=10, pady=(8, 0))
            ctk.CTkLabel(r_frame, text="Bereit", font=("Arial", 10),
                        text_color="white").grid(row=1, column=0, padx=10, pady=(0, 8))

            # Urgency badge
            b_frame = ctk.CTkFrame(dash, fg_color=u_color, corner_radius=8)
            b_frame.grid(row=0, column=3, padx=3, sticky="ew")
            ctk.CTkLabel(b_frame, text=u_label, font=("Arial", 14, "bold"),
                        text_color="white").grid(row=0, column=0, padx=10, pady=(8, 0))
            ctk.CTkLabel(b_frame, text="Status", font=("Arial", 10),
                        text_color="white").grid(row=1, column=0, padx=10, pady=(0, 8))

            # Box breakdown for today
            if plan.box_breakdown:
                bd_text = " | ".join(f"Box {b}: {c}" for b, c in sorted(plan.box_breakdown.items()) if c > 0)
                ctk.CTkLabel(deadline_card, text=f"Tagespensum: {bd_text}",
                            font=("Arial", 11), text_color=COLORS["text_light"]
                            ).grid(row=3, column=0, columnspan=2, padx=15, pady=(0, 10), sticky="w")

        # ── Topic filter ──
        topics = sorted({q.topic.strip() for q in quiz.questions if q.topic.strip()})
        topic_var = StringVar(value=t("modes.all_topics"))
        if topics:
            topic_row = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
            topic_row.grid(row=3, column=0, sticky="ew", pady=(0, 10))
            ctk.CTkLabel(topic_row, text=t("modes.topic_filter"), font=("Arial", 13, "bold"),
                        text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=10)
            ctk.CTkOptionMenu(topic_row, values=[t("modes.all_topics")] + topics,
                             variable=topic_var, width=260).grid(row=0, column=1, padx=10, pady=10)

        def selected_topic():
            val = topic_var.get()
            return None if val == t("modes.all_topics") else val

        # ── Mode Cards ──
        modes = ctk.CTkFrame(scroll, fg_color="transparent")
        modes.grid(row=4, column=0, sticky="ew")
        for i in range(2):
            modes.grid_columnconfigure(i, weight=1)

        cards = [
            (t("modes.exam"), t("modes.exam_sub"), COLORS["danger"],
             lambda: self._start_quiz(quiz, "exam", time_limit=3600, topic=selected_topic())),
            (t("modes.single"), t("modes.single_sub"), COLORS["success"],
             lambda: self._start_quiz(quiz, "single", topic=selected_topic())),
            (t("modes.weak"), t("modes.weak_sub"), COLORS["warning"],
             lambda: self._start_quiz(quiz, "weak", topic=selected_topic())),
            (t("modes.topic"), t("modes.topic_sub"), COLORS["primary"],
             lambda: self._start_quiz(quiz, "topic", count=20, topic=selected_topic())),
            (t("modes.flashcards"), t("modes.flashcards_sub"), COLORS["primary_dark"],
             lambda: self._start_flashcards(quiz, topic=selected_topic())),
        ]
        for i, (title_, desc, color, cmd) in enumerate(cards):
            card = ctk.CTkFrame(modes, fg_color=COLORS["card"], corner_radius=8,
                               border_width=3, border_color=color)
            card.grid(row=i // 2, column=i % 2, padx=8, pady=8, sticky="nsew")
            card.grid_columnconfigure(0, weight=1)
            ctk.CTkLabel(card, text=title_, font=("Arial", 16, "bold"),
                        text_color=color).grid(row=0, column=0, padx=20, pady=(15, 5))
            ctk.CTkLabel(card, text=desc, font=("Arial", 12),
                        text_color=COLORS["text_light"], wraplength=250
                        ).grid(row=1, column=0, padx=20, pady=(0, 10))
            ctk.CTkButton(card, text=t("modes.start"), fg_color=color, width=120,
                         command=cmd).grid(row=2, column=0, padx=20, pady=(0, 15))

        # Leitner stats
        qids = [q.id for q in quiz.questions]
        counts = self.sr.get_box_counts(qids)
        stats = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
        stats.grid(row=5, column=0, sticky="ew", pady=(10, 0))
        ctk.CTkLabel(stats, text="Lernstand (Leitner-Boxen)", font=("Arial", 14, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, columnspan=5, padx=15, pady=(10, 5), sticky="w")
        labels = ["Box 1\n(Neu)", "Box 2", "Box 3", "Box 4", "Box 5\n(Sicher)"]
        for b in range(1, 6):
            stats.grid_columnconfigure(b - 1, weight=1)
            f = ctk.CTkFrame(stats, fg_color=COLORS[f"box{b}"], corner_radius=8)
            f.grid(row=1, column=b - 1, padx=5, pady=(0, 10), sticky="ew")
            ctk.CTkLabel(f, text=str(counts.get(b, 0)), font=("Arial", 20, "bold"),
                        text_color="white").grid(row=0, column=0, padx=10, pady=(8, 0))
            ctk.CTkLabel(f, text=labels[b - 1], font=("Arial", 10),
                        text_color="white").grid(row=1, column=0, padx=10, pady=(0, 8))

        # ── Grade Estimation ──
        grade_card = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8,
                                   border_width=2, border_color=COLORS["warning"])
        grade_card.grid(row=6, column=0, sticky="ew", pady=(10, 0))
        grade_card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(grade_card, text=t("grade.title"), font=("Arial", 14, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(10, 5), sticky="w")

        topic_scores = self._compute_topic_scores(quiz)
        if topic_scores:
            overall = sum(s for s in topic_scores.values()) / len(topic_scores) if topic_scores else 0
            grade = self._pct_to_grade(overall)
            ctk.CTkLabel(grade_card, text=t("grade.overall", grade=grade),
                        font=("Arial", 18, "bold"), text_color=COLORS["warning"]
                        ).grid(row=1, column=0, padx=15, pady=(0, 5), sticky="w")
            topic_f = ctk.CTkFrame(grade_card, fg_color="transparent")
            topic_f.grid(row=2, column=0, padx=15, pady=(0, 10), sticky="ew")
            for i, (topic_name, pct) in enumerate(sorted(topic_scores.items())):
                g = self._pct_to_grade(pct)
                color = COLORS["success"] if pct >= 75 else COLORS["warning"] if pct >= 50 else COLORS["danger"]
                ctk.CTkLabel(topic_f, text=f"{topic_name}: {pct:.0f}% ({g})",
                            font=("Arial", 12), text_color=color
                            ).grid(row=i, column=0, sticky="w", pady=1)
        else:
            ctk.CTkLabel(grade_card, text=t("grade.no_data"), font=("Arial", 12),
                        text_color=COLORS["text_light"]).grid(row=1, column=0, padx=15, pady=(0, 10), sticky="w")

        ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=7, column=0, sticky="w", pady=15)

    def _compute_topic_scores(self, quiz: Quiz) -> dict[str, float]:
        """Compute per-topic mastery % based on Leitner boxes."""
        topic_data: dict[str, list[int]] = {}
        for q in quiz.questions:
            topic_name = q.topic.strip() or "Allgemein"
            box = self.sr.get_box(q.id)
            topic_data.setdefault(topic_name, []).append(box)
        result = {}
        for topic_name, boxes in topic_data.items():
            result[topic_name] = (sum(b for b in boxes) / (len(boxes) * 5)) * 100
        return result

    @staticmethod
    def _pct_to_grade(pct: float) -> str:
        """Map percentage to German grade (1.0 = best, 5.0 = fail)."""
        if pct >= 96: return "1,0"
        if pct >= 91: return "1,3"
        if pct >= 86: return "1,7"
        if pct >= 81: return "2,0"
        if pct >= 76: return "2,3"
        if pct >= 71: return "2,7"
        if pct >= 66: return "3,0"
        if pct >= 61: return "3,3"
        if pct >= 56: return "3,7"
        if pct >= 50: return "4,0"
        return "5,0"

    def _start_quiz(self, quiz: Quiz, mode: str, time_limit: int = 0, count: int = 0,
                    topic: str | None = None):
        questions = list(quiz.questions)
        if topic:
            questions = [q for q in questions if q.topic.strip() == topic]
        if not questions:
            messagebox.showinfo("Hinweis", "Keine Fragen für diese Auswahl.")
            return
        if mode == "weak":
            questions = self.sr.select_weak_questions(questions, quiz_weight=quiz.weight)
        elif mode == "topic" and count > 0:
            random.shuffle(questions)
            questions = questions[:count]
        elif mode == "exam":
            random.shuffle(questions)

        self.session = QuizSession(questions, mode=mode, time_limit=time_limit)
        self._show_question()

    # ── QUIZ PLAYER ──

    def _show_question(self):
        if not self.session:
            return
        if self.session.is_finished:
            self._show_results()
            return

        self._clear_main()
        q = self.session.current_question
        if not q:
            return

        # Timer
        if self.session.time_limit > 0:
            self.timer_running = True
            self.timer_label.grid(row=0, column=2, padx=20, pady=10)
            self._update_timer()

        # Header info
        total = len(self.session.questions)
        current = self.session.current_index + 1
        self.header_subtitle.configure(
            text=f"Frage {current}/{total} · {q.points} Punkt{'e' if q.points > 1 else ''}"
        )

        scroll = self._make_screen()

        # Progress bar
        progress = ctk.CTkProgressBar(scroll, width=600)
        progress.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        progress.set(self.session.progress_fraction)

        # Question card
        card = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
        card.grid(row=1, column=0, sticky="ew", pady=(0, 10))
        card.grid_columnconfigure(0, weight=1)

        if q.title:
            ctk.CTkLabel(card, text=q.title, font=("Arial", 16, "bold"),
                        text_color=COLORS["text"]).grid(row=0, column=0, padx=20, pady=(15, 5), sticky="w")
        self._render_rich_text(card, q.text, font=("Segoe UI", 13), text_color=COLORS["text"],
                              wraplength=700, row=1, column=0, padx=20, pady=(5, 15), sticky="w")

        # Question image
        if q.image_path and os.path.exists(q.image_path):
            photo, iw, ih = self._load_diagram_image(q.image_path, max_w=600, max_h=300)
            if photo:
                img_lbl = ctk.CTkLabel(card, text="", image=ctk.CTkImage(
                    light_image=Image.open(q.image_path),
                    size=(iw, ih)
                ) if Image else None)
                img_lbl.grid(row=2, column=0, padx=20, pady=(0, 15))
                if not Image:
                    img_canvas = tk.Canvas(card, width=iw, height=ih)
                    img_canvas.grid(row=2, column=0, padx=20, pady=(0, 15))
                    img_canvas.create_image(0, 0, anchor="nw", image=photo)
                    img_canvas.image = photo

        # Answer area
        answer_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
        answer_frame.grid(row=2, column=0, sticky="ew", pady=(0, 10))
        answer_frame.grid_columnconfigure(0, weight=1)

        answer_var = None
        answer_widgets = []
        diagram_get_positions = None

        if q.question_type == QuestionType.SINGLE_CHOICE:
            answer_var = IntVar(value=-1)
            for i, opt in enumerate(q.options):
                rb = ctk.CTkRadioButton(answer_frame, text=opt.text, variable=answer_var,
                                        value=i, font=("Arial", 13))
                rb.grid(row=i, column=0, padx=20, pady=6, sticky="w")
                answer_widgets.append(rb)

        elif q.question_type == QuestionType.MULTIPLE_CHOICE:
            for i, opt in enumerate(q.options):
                var = BooleanVar(value=False)
                cb = ctk.CTkCheckBox(answer_frame, text=opt.text, variable=var, font=("Arial", 13))
                cb.grid(row=i, column=0, padx=20, pady=6, sticky="w")
                answer_widgets.append((cb, var, i))

        elif q.question_type == QuestionType.FREE_TEXT:
            entry = ctk.CTkEntry(answer_frame, width=500, placeholder_text="Deine Antwort eingeben...",
                                font=("Arial", 13))
            entry.grid(row=0, column=0, padx=20, pady=15, sticky="w")
            answer_widgets.append(entry)

        elif q.question_type == QuestionType.FILL_BLANK:
            ctk.CTkLabel(answer_frame, text="Fülle die Lücken aus:",
                        font=("Arial", 12), text_color=COLORS["text_light"]
                        ).grid(row=0, column=0, padx=20, pady=(10, 5), sticky="w")
            for i, blank in enumerate(q.blanks):
                f = ctk.CTkFrame(answer_frame, fg_color="transparent")
                f.grid(row=i + 1, column=0, padx=20, pady=3, sticky="w")
                ctk.CTkLabel(f, text=f"Lücke {i+1}:", font=("Arial", 12)).grid(row=0, column=0, padx=(0, 10))
                entry = ctk.CTkEntry(f, width=300, placeholder_text="...")
                entry.grid(row=0, column=1)
                answer_widgets.append(entry)

        elif q.question_type == QuestionType.DRAG_DROP:
            ctk.CTkLabel(answer_frame, text="Ordne die Begriffe zu:",
                        font=("Segoe UI", 12, "bold"), text_color=COLORS["text"]
                        ).grid(row=0, column=0, padx=20, pady=(10, 5), sticky="w")

            sources = [p.source for p in q.drag_drop_pairs]
            targets = [p.target for p in q.drag_drop_pairs]
            random.shuffle(sources)

            # Canvas-based drag & drop with snap zones
            row_height = 40
            target_width = 200
            zone_width = 150
            pool_height = 50
            canvas_width = 600
            canvas_height = len(targets) * row_height + pool_height + 20

            dnd_canvas = tk.Canvas(answer_frame, width=canvas_width, height=canvas_height,
                                   bg=COLORS.get("canvas_bg", "white"), highlightthickness=0)
            dnd_canvas.grid(row=1, column=0, padx=20, pady=(0, 12))

            # Draw targets and drop zones
            dnd_drop_zones = {}  # target -> zone info
            dnd_assignments = {}  # target -> source or None

            for i, target in enumerate(targets):
                y = 20 + i * row_height
                dnd_canvas.create_text(10, y + row_height // 2, text=f"{target}:",
                                      font=("Segoe UI", 11, "bold"), anchor="w",
                                      fill=COLORS.get("text", "black"))
                zx = target_width + 20
                zy = y + 5
                zone_rect = dnd_canvas.create_rectangle(
                    zx, zy, zx + zone_width, zy + row_height - 10,
                    outline="#888", dash=(4, 2), width=2, fill=""
                )
                dnd_drop_zones[target] = {
                    "x": zx + zone_width // 2, "y": zy + (row_height - 10) // 2,
                    "rect_id": zone_rect, "left": zx, "top": zy,
                    "right": zx + zone_width, "bottom": zy + row_height - 10
                }
                dnd_assignments[target] = None

            # Divider
            pool_y = len(targets) * row_height + 20
            dnd_canvas.create_line(0, pool_y, canvas_width, pool_y, fill="#ccc", dash=(4, 3))

            # Source chips
            dnd_chip_assignments = {}  # chip_tag -> target or None
            spacing = max(80, canvas_width // (len(sources) + 1))

            for i, source in enumerate(sources):
                sx = spacing * (i + 1)
                if sx > canvas_width - 40:
                    sx = 20 + (i * 90) % (canvas_width - 40)
                sy = pool_y + pool_height // 2

                chip_tag = f"dndchip_{i}"
                dnd_chip_assignments[chip_tag] = None

                tid = dnd_canvas.create_text(sx, sy, text=source, font=("Segoe UI", 10, "bold"),
                                             fill="white", tags=(chip_tag,))
                bb = dnd_canvas.bbox(tid)
                pad = 6
                rid = dnd_canvas.create_rectangle(bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad,
                                                  fill="#2980b9", outline="#1a5276", width=2, tags=(chip_tag,))
                dnd_canvas.tag_lower(rid, tid)

                def make_dnd_handlers(tag, src):
                    drag = {"x": 0, "y": 0}

                    def press(e):
                        drag["x"], drag["y"] = e.x, e.y
                        dnd_canvas.tag_raise(tag)

                    def motion(e):
                        dnd_canvas.move(tag, e.x - drag["x"], e.y - drag["y"])
                        drag["x"], drag["y"] = e.x, e.y

                    def release(e):
                        box = dnd_canvas.bbox(tag)
                        if not box:
                            return
                        cx = (box[0] + box[2]) / 2
                        cy = (box[1] + box[3]) / 2

                        prev_target = dnd_chip_assignments.get(tag)
                        if prev_target:
                            dnd_assignments[prev_target] = None
                            dnd_canvas.itemconfig(dnd_drop_zones[prev_target]["rect_id"],
                                                  outline="#888", fill="")

                        snapped = False
                        for tgt, zone in dnd_drop_zones.items():
                            if (zone["left"] - 30 < cx < zone["right"] + 30 and
                                zone["top"] - 15 < cy < zone["bottom"] + 15):
                                snap_x = zone["x"] - cx
                                snap_y = zone["y"] - cy
                                dnd_canvas.move(tag, snap_x, snap_y)
                                for other_tag, other_tgt in dnd_chip_assignments.items():
                                    if other_tgt == tgt and other_tag != tag:
                                        dnd_chip_assignments[other_tag] = None
                                dnd_assignments[tgt] = src
                                dnd_chip_assignments[tag] = tgt
                                dnd_canvas.itemconfig(zone["rect_id"],
                                                      outline=COLORS.get("primary", "#3366cc"),
                                                      fill=COLORS.get("card_hover", "#f0f3ff"))
                                snapped = True
                                break
                        if not snapped:
                            dnd_chip_assignments[tag] = None

                    return press, motion, release

                p, m, r = make_dnd_handlers(chip_tag, source)
                dnd_canvas.tag_bind(chip_tag, "<Button-1>", p)
                dnd_canvas.tag_bind(chip_tag, "<B1-Motion>", m)
                dnd_canvas.tag_bind(chip_tag, "<ButtonRelease-1>", r)

            answer_widgets.append(("dnd_canvas", dnd_assignments))

        elif q.question_type == QuestionType.DIAGRAM_LABEL:
            ctk.CTkLabel(answer_frame, text="Ziehe die Labels an die richtige Stelle im Diagramm:",
                        font=("Arial", 12, "bold"), text_color=COLORS["text"]
                        ).grid(row=0, column=0, padx=20, pady=(10, 5), sticky="w")

            photo, cw, ch = self._load_diagram_image(q.diagram_image_path)
            pool_h = 55
            canvas = tk.Canvas(answer_frame, width=cw, height=ch + pool_h, bg="white",
                               highlightthickness=1, highlightbackground="#cccccc")
            canvas.grid(row=1, column=0, padx=20, pady=(0, 12))
            if photo:
                canvas.create_image(0, 0, anchor="nw", image=photo)
                canvas.image = photo
            # divider line between diagram and label pool
            canvas.create_line(0, ch, cw, ch, fill="#cccccc", dash=(4, 3))

            # placed[label] = [x_frac, y_frac] or None while still in pool
            placed = {}
            shuffled = [l.label for l in q.diagram_labels]
            random.shuffle(shuffled)
            spacing = max(70, cw // (len(shuffled) + 1)) if shuffled else 70
            for i, name in enumerate(shuffled):
                placed[name] = None
                start_x = spacing * (i + 1)
                start_y = ch + pool_h / 2

                def make_drop(nm):
                    def on_drop(px, py):
                        if py < ch:  # dropped onto the diagram
                            placed[nm] = [max(0.0, min(1.0, px / cw)),
                                          max(0.0, min(1.0, py / ch))]
                        else:  # back in the pool → unplaced
                            placed[nm] = None
                    return on_drop
                self._make_draggable_chip(canvas, start_x, start_y, name, make_drop(name))

            def diagram_get_positions():
                return {k: v for k, v in placed.items() if v is not None}

        elif q.question_type == QuestionType.MARK_IMAGE:
            ctk.CTkLabel(answer_frame, text=q.text, font=("Segoe UI", 13, "bold"),
                        text_color=COLORS["text"]).grid(row=0, column=0, padx=20, pady=(10, 5), sticky="w")

            img_path = q.image_path or q.diagram_image_path
            mark_canvas, mark_ctrl, mark_s2i, mark_zstate = self._make_zoomable_canvas(
                answer_frame, img_path, max_w=600, max_h=400)
            mark_canvas.grid(row=1, column=0, padx=20, pady=10)
            mark_ctrl.grid(row=2, column=0, padx=20, sticky="w")
            cw = mark_zstate["base_w"]
            ch = mark_zstate["base_h"]

            click_pos = {"x": None, "y": None}
            marker_id = {"id": None}

            def on_canvas_click(e):
                if marker_id["id"]:
                    mark_canvas.delete(marker_id["id"])
                r = 12
                marker_id["id"] = mark_canvas.create_oval(e.x - r, e.y - r, e.x + r, e.y + r,
                                                            outline="red", width=3, fill="")
                nx, ny = mark_s2i(e.x, e.y)
                click_pos["x"] = nx
                click_pos["y"] = ny

            mark_canvas.bind("<Button-1>", on_canvas_click)
            answer_widgets.append(("mark_image", click_pos, q.mark_regions, mark_canvas))

        elif q.question_type == QuestionType.MATH_FORMULA:
            # Check if any formula sheets are available for interactive solving
            fosa_available = bool(self.formula_sheets)
            solution_steps: list[dict] = []

            if fosa_available:
                # ── Interactive FoSa-based solver ──
                ctk.CTkLabel(answer_frame, text=t("math.fosa_title"),
                             font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                             ).grid(row=0, column=0, padx=20, pady=(10, 2), sticky="w")
                ctk.CTkLabel(answer_frame, text=t("math.fosa_hint"),
                             font=("Segoe UI", 11), text_color=COLORS["text_light"]
                             ).grid(row=1, column=0, padx=20, pady=(0, 10), sticky="w")

                # Gather all formulas from all sheets
                all_formulas: list[Formula] = []
                for sheet in self.formula_sheets:
                    all_formulas.extend(sheet.formulas)
                formula_names = [f"{f.name}  [{f.category}]" if f.category else f.name
                                 for f in all_formulas]

                # Steps container (scrollable)
                steps_container = ctk.CTkFrame(answer_frame, fg_color="transparent")
                steps_container.grid(row=2, column=0, sticky="ew", padx=20)
                steps_container.grid_columnconfigure(0, weight=1)
                step_widgets: list[dict] = []

                def _render_step(step_idx: int, formula: Formula):
                    """Build UI for one solution step with the given formula.
                    Hybrid layout: full formula image on top, inline fill-in row below."""
                    step_frame = ctk.CTkFrame(steps_container, fg_color=COLORS["card"],
                                              corner_radius=10, border_width=1,
                                              border_color=COLORS.get("border", "#e0e4f0"))
                    step_frame.grid(row=step_idx, column=0, sticky="ew", pady=5)
                    step_frame.grid_columnconfigure(0, weight=1)

                    head = f"Schritt {step_idx + 1}: {formula.name}"
                    ctk.CTkLabel(step_frame, text=head, font=("Segoe UI", 13, "bold"),
                                 text_color=COLORS["primary"]
                                 ).grid(row=0, column=0, padx=15, pady=(10, 4), sticky="w")

                    # Row 1: Full formula as rendered image (reference)
                    if formula.latex and can_render_latex():
                        img = render_formula(formula.latex, fontsize=16,
                                             text_color=COLORS.get("text", "#000"))
                        if img:
                            ctk_img = ctk.CTkImage(light_image=img, dark_image=img,
                                                   size=(img.width, img.height))
                            lbl = ctk.CTkLabel(step_frame, image=ctk_img, text="")
                            lbl.image = ctk_img
                            lbl.grid(row=1, column=0, padx=15, pady=4, sticky="w")
                    elif formula.latex:
                        ctk.CTkLabel(step_frame, text=latex_to_plain(f"${formula.latex}$"),
                                     font=("Consolas", 13), text_color=COLORS["text"]
                                     ).grid(row=1, column=0, padx=15, pady=4, sticky="w")

                    # Row 2: Inline fill-in row — split template at {{var}} placeholders
                    # and place Entry widgets where the variables go
                    var_entries: dict[str, ctk.CTkEntry] = {}
                    inline_frame = ctk.CTkFrame(step_frame, fg_color=COLORS.get("input_bg", "#f0f0f0"),
                                                corner_radius=8)
                    inline_frame.grid(row=2, column=0, padx=15, pady=(4, 5), sticky="w")

                    template = formula.template or ""
                    var_symbols = {v.symbol for v in formula.variables}

                    if template and "{{" in template:
                        # Parse template: split on {{symbol}} placeholders
                        import re as _re
                        parts = _re.split(r'\{\{(\w+)\}\}', template)
                        col = 0
                        for pi, part in enumerate(parts):
                            if pi % 2 == 0:
                                # Static LaTeX segment — render as small image or plain text
                                segment = part.strip()
                                if not segment:
                                    continue
                                if can_render_latex() and any(c in segment for c in ('\\', '^', '_', '{')):
                                    seg_img = render_formula(segment, fontsize=14,
                                                             text_color=COLORS.get("text", "#000"))
                                    if seg_img:
                                        ci = ctk.CTkImage(light_image=seg_img, dark_image=seg_img,
                                                          size=(seg_img.width, seg_img.height))
                                        sl = ctk.CTkLabel(inline_frame, image=ci, text="")
                                        sl.image = ci
                                        sl.grid(row=0, column=col, padx=2, pady=6)
                                        col += 1
                                        continue
                                # Plain text fallback
                                plain = latex_to_plain(f"${segment}$") if ('\\' in segment) else segment
                                if plain.strip():
                                    ctk.CTkLabel(inline_frame, text=plain,
                                                 font=("Consolas", 14), text_color=COLORS["text"]
                                                 ).grid(row=0, column=col, padx=2, pady=6)
                                    col += 1
                            else:
                                # Variable placeholder — insert Entry widget
                                sym = part
                                v_info = next((v for v in formula.variables if v.symbol == sym), None)
                                ph = sym
                                if v_info and v_info.unit:
                                    ph = f"{sym} [{v_info.unit}]"
                                e = ctk.CTkEntry(inline_frame, width=80, font=("Segoe UI", 13),
                                                 placeholder_text=ph, justify="center",
                                                 border_width=2, border_color=COLORS["primary"],
                                                 corner_radius=6)
                                e.grid(row=0, column=col, padx=3, pady=6)
                                var_entries[sym] = e
                                col += 1
                    else:
                        # No template — fall back to labeled fields
                        for vi, v in enumerate(formula.variables):
                            lbl_text = f"{v.symbol}"
                            if v.name:
                                lbl_text += f" ({v.name})"
                            if v.unit:
                                lbl_text += f" [{v.unit}]"
                            ctk.CTkLabel(inline_frame, text=lbl_text + " =",
                                         font=("Segoe UI", 12), text_color=COLORS["text"]
                                         ).grid(row=vi, column=0, padx=(8, 4), pady=3, sticky="w")
                            e = ctk.CTkEntry(inline_frame, width=120, font=("Segoe UI", 12),
                                             placeholder_text=v.symbol, border_width=2,
                                             border_color=COLORS["primary"], corner_radius=6)
                            e.grid(row=vi, column=1, padx=(0, 8), pady=3)
                            var_entries[v.symbol] = e

                    # Variable legend (small, below the inline row)
                    if formula.variables:
                        legend_parts = [
                            f"{v.symbol}: {v.name}" + (f" [{v.unit}]" if v.unit else "")
                            for v in formula.variables if v.name
                        ]
                        if legend_parts:
                            ctk.CTkLabel(step_frame, text="  ·  ".join(legend_parts),
                                         font=("Segoe UI", 10), text_color=COLORS["text_light"],
                                         wraplength=700, justify="left"
                                         ).grid(row=3, column=0, padx=15, pady=(0, 2), sticky="w")

                    # Result field
                    res_frame = ctk.CTkFrame(step_frame, fg_color="transparent")
                    res_frame.grid(row=4, column=0, padx=15, pady=(5, 10), sticky="w")
                    res_sym = formula.result_symbol or "Ergebnis"
                    ctk.CTkLabel(res_frame, text=f"{res_sym} =",
                                 font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                                 ).grid(row=0, column=0, padx=(0, 8))
                    result_entry = ctk.CTkEntry(res_frame, width=200, font=("Segoe UI", 13),
                                                placeholder_text=t("math.enter_result"),
                                                border_width=2, border_color=COLORS["success"],
                                                corner_radius=6)
                    result_entry.grid(row=0, column=1)

                    step_data = {
                        "formula": formula,
                        "var_entries": var_entries,
                        "result_entry": result_entry,
                        "frame": step_frame,
                    }
                    step_widgets.append(step_data)

                def _add_step():
                    """Show formula picker and add a new step."""
                    pick_win = ctk.CTkToplevel(self)
                    pick_win.title(t("math.pick_formula"))
                    pick_win.geometry("500x400")
                    pick_win.transient(self)
                    pick_win.grab_set()

                    ctk.CTkLabel(pick_win, text=t("math.pick_formula"),
                                 font=("Segoe UI", 15, "bold")).pack(padx=20, pady=(15, 10))

                    search_var = StringVar()
                    search = ctk.CTkEntry(pick_win, textvariable=search_var, width=400,
                                          placeholder_text=t("math.search_formula"))
                    search.pack(padx=20, pady=(0, 10))

                    list_frame = ctk.CTkScrollableFrame(pick_win, width=440, height=250)
                    list_frame.pack(padx=20, fill="both", expand=True)

                    def _populate(filter_text=""):
                        for w in list_frame.winfo_children():
                            w.destroy()
                        ft = filter_text.lower()
                        for idx, f in enumerate(all_formulas):
                            display = formula_names[idx]
                            if ft and ft not in display.lower() and ft not in (f.description or "").lower():
                                continue
                            btn = ctk.CTkButton(
                                list_frame, text=display, anchor="w",
                                fg_color=COLORS.get("input_bg", "#e8e8e8"),
                                text_color=COLORS.get("text", "#000"),
                                hover_color=COLORS.get("card_hover", "#ddd"),
                                font=("Segoe UI", 12), height=34,
                                command=lambda ff=f: (_select(ff),))
                            btn.pack(fill="x", pady=2)

                    def _select(f: Formula):
                        pick_win.destroy()
                        step_idx = len(step_widgets)
                        _render_step(step_idx, f)
                        # Re-grid the add/final buttons below the steps
                        _reposition_bottom()

                    def _on_search(*_):
                        _populate(search_var.get())
                    search_var.trace_add("write", _on_search)
                    _populate()

                # Add step + final answer area
                bottom_frame = ctk.CTkFrame(answer_frame, fg_color="transparent")
                bottom_frame.grid(row=3, column=0, padx=20, sticky="w", pady=5)

                add_step_btn = ctk.CTkButton(bottom_frame, text=t("math.add_step"),
                                             fg_color=COLORS["primary"], width=180,
                                             command=_add_step)
                add_step_btn.grid(row=0, column=0, pady=(0, 10))

                ctk.CTkLabel(answer_frame, text=t("math.final_answer"),
                             font=("Segoe UI", 13, "bold"), text_color=COLORS["text"]
                             ).grid(row=4, column=0, padx=20, pady=(10, 2), sticky="w")
                final_entry = ctk.CTkEntry(answer_frame, width=300, font=("Segoe UI", 14),
                                           placeholder_text=t("math.enter_final"))
                final_entry.grid(row=5, column=0, padx=20, pady=(0, 10), sticky="w")
                answer_widgets.append(final_entry)

                def _reposition_bottom():
                    n = len(step_widgets)
                    bottom_frame.grid(row=2 + n + 1, column=0, padx=20, sticky="w", pady=5)

                # Store step_widgets ref for answer extraction and AI check
                answer_widgets.append(("fosa_steps", step_widgets, final_entry))

            else:
                # ── Fallback: simple text entry (no FoSa available) ──
                ctk.CTkLabel(answer_frame, text=t("math.no_fosa_hint"),
                             font=("Segoe UI", 11), text_color=COLORS["text_light"]
                             ).grid(row=0, column=0, padx=20, pady=(10, 5), sticky="w")
                math_entry = ctk.CTkEntry(answer_frame, width=500, font=("Segoe UI", 14),
                                           placeholder_text=t("math.input_placeholder"))
                math_entry.grid(row=1, column=0, padx=20, pady=(0, 10), sticky="w")
                answer_widgets.append(math_entry)

        # Answer timing
        _answer_start_ms = int(time.time() * 1000)
        use_fsrs = self.store.load_settings().get("use_fsrs", False)

        # Confidence selector (FSRS)
        confidence_var = IntVar(value=3)
        if use_fsrs:
            conf_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
            conf_frame.grid(row=3, column=0, sticky="ew", pady=(0, 10))
            ctk.CTkLabel(conf_frame, text=t("confidence.title"), font=("Arial", 12, "bold"),
                        text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(8, 3), sticky="w")
            for ci in range(1, 5):
                ctk.CTkRadioButton(conf_frame, text=t(f"confidence.{ci}"),
                                   variable=confidence_var, value=ci, font=("Arial", 12)
                                   ).grid(row=0, column=ci, padx=8, pady=8)

        # Optional detailed answer
        use_detailed = self.store.load_settings().get("detailed_answer", False)
        detailed_entry = None
        if use_detailed:
            det_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
            det_frame.grid(row=4, column=0, sticky="ew", pady=(0, 10))
            det_frame.grid_columnconfigure(0, weight=1)
            ctk.CTkLabel(det_frame, text=t("detailed.label"), font=("Segoe UI", 12, "bold"),
                        text_color=COLORS["text_light"]).grid(row=0, column=0, padx=15, pady=(8, 3), sticky="w")
            detailed_entry = ctk.CTkTextbox(det_frame, height=70, font=("Segoe UI", 12),
                                            fg_color=COLORS["input_bg"])
            detailed_entry.grid(row=1, column=0, padx=15, pady=(0, 10), sticky="ew")

        # Feedback area (for single mode)
        feedback_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        feedback_frame.grid(row=5, column=0, sticky="ew")

        def get_answer():
            if q.question_type == QuestionType.SINGLE_CHOICE:
                return answer_var.get()
            elif q.question_type == QuestionType.MULTIPLE_CHOICE:
                return [i for _, var, i in answer_widgets if var.get()]
            elif q.question_type == QuestionType.FREE_TEXT:
                return answer_widgets[0].get()
            elif q.question_type == QuestionType.FILL_BLANK:
                return [e.get() for e in answer_widgets]
            elif q.question_type == QuestionType.DRAG_DROP:
                for item in answer_widgets:
                    if isinstance(item, tuple) and len(item) == 2 and item[0] == "dnd_canvas":
                        return dict(item[1])
                # Fallback for old-style menus (shouldn't happen)
                result = {}
                for item in answer_widgets:
                    if isinstance(item, tuple) and len(item) == 2:
                        target, menu = item
                        if hasattr(menu, 'get'):
                            val = menu.get()
                            if val != "-- Auswählen --":
                                result[target] = val
                return result
            elif q.question_type == QuestionType.DIAGRAM_LABEL:
                return diagram_get_positions() if diagram_get_positions else {}
            elif q.question_type == QuestionType.MARK_IMAGE:
                for item in answer_widgets:
                    if isinstance(item, tuple) and len(item) == 4 and item[0] == "mark_image":
                        return {"x": item[1]["x"], "y": item[1]["y"]}
                return None
            elif q.question_type == QuestionType.MATH_FORMULA:
                for item in answer_widgets:
                    if hasattr(item, 'get') and not isinstance(item, tuple):
                        return item.get()
                return ""
            return None

        def submit():
            answer = get_answer()
            answer_time_ms = int(time.time() * 1000) - _answer_start_ms
            result = self.session.submit_answer(answer)
            self.sr.update(q.id, result.is_correct)
            self.store.log_answer(result.is_correct)

            # Daily mode tracking
            if getattr(self, '_daily_mode', False):
                daily = self.store.load_daily_state()
                if q.id not in daily.get("completed", []):
                    daily.setdefault("completed", []).append(q.id)
                if not result.is_correct and q.id not in daily.get("wrong", []):
                    daily.setdefault("wrong", []).append(q.id)
                self.store.save_daily_state(daily)

            # FSRS update
            if use_fsrs:
                card_data = self._fsrs_data.get(q.id)
                card = fsrs_from_dict(card_data) if card_data else FSRSCard(question_id=q.id)
                conf = confidence_var.get()
                rating = 4 if result.is_correct and conf >= 3 else 3 if result.is_correct else 2 if conf >= 2 else 1
                card = self.fsrs.review(card, rating, answer_time_ms=answer_time_ms,
                                        confidence=conf / 4.0)
                self._fsrs_data[q.id] = fsrs_to_dict(card)
                self.store.save_fsrs(self._fsrs_data)

            if self.session.mode in ("single", "weak"):
                for w in feedback_frame.winfo_children():
                    w.destroy()
                color = COLORS["success"] if result.is_correct else COLORS["danger"]
                fb = ctk.CTkFrame(feedback_frame, fg_color=color, corner_radius=8)
                fb.grid(row=0, column=0, sticky="ew", pady=10)
                fb.grid_columnconfigure(0, weight=1)
                text = "Richtig!" if result.is_correct else "Falsch!"
                ctk.CTkLabel(fb, text=text, font=("Arial", 16, "bold"),
                            text_color="white").grid(row=0, column=0, padx=20, pady=(10, 5), sticky="w")
                ctk.CTkLabel(fb, text=f"Punkte: {result.score}/{result.max_score}",
                            font=("Arial", 12), text_color="white"
                            ).grid(row=1, column=0, padx=20, pady=(0, 5), sticky="w")
                if not result.is_correct:
                    ctk.CTkLabel(fb, text=f"Richtige Antwort: {result.correct_answer}",
                                font=("Arial", 12), text_color="white", wraplength=600
                                ).grid(row=2, column=0, padx=20, pady=(0, 5), sticky="w")
                if q.explanation:
                    ctk.CTkLabel(fb, text=q.explanation, font=("Arial", 11),
                                text_color="white", wraplength=600
                                ).grid(row=3, column=0, padx=20, pady=(0, 10), sticky="w")
                submit_btn.configure(state="disabled")

                # Analyze detailed answer if provided
                if detailed_entry:
                    det_text = detailed_entry.get("1.0", "end").strip()
                    if det_text and self.ai.api_key:
                        det_fb = ctk.CTkFrame(feedback_frame, fg_color=COLORS["card"], corner_radius=8)
                        det_fb.grid(row=1, column=0, sticky="ew", pady=(5, 0))
                        det_fb.grid_columnconfigure(0, weight=1)
                        det_lbl = ctk.CTkLabel(det_fb, text=t("detailed.checking"),
                                               font=("Segoe UI", 12), text_color=COLORS["text_light"])
                        det_lbl.grid(row=0, column=0, padx=15, pady=10, sticky="w")

                        def _check_detailed(user_text=det_text, frame=det_fb):
                            correct = result.correct_answer if not result.is_correct else "korrekt beantwortet"
                            msgs = [
                                {"role": "system", "content": (
                                    "Du bist ein strenger aber fairer Tutor. Analysiere die ausführliche "
                                    "Antwort des Studenten. Prüfe auf:\n"
                                    "1. Korrektheit der Aussagen\n"
                                    "2. Denkfehler oder Missverständnisse\n"
                                    "3. Vollständigkeit\n"
                                    "4. Was gut war\n"
                                    "Gib konstruktives Feedback. Nutze $LaTeX$ für Formeln."
                                )},
                                {"role": "user", "content": (
                                    f"Frage: {q.text}\n"
                                    f"Richtige Antwort: {correct}\n"
                                    f"Ausführliche Antwort des Studenten:\n{user_text}"
                                )},
                            ]
                            resp = self.ai._call_api(msgs, max_tokens=1024)
                            def _show(r=resp):
                                for w in frame.winfo_children():
                                    w.destroy()
                                ctk.CTkLabel(frame, text=t("detailed.feedback_title"),
                                             font=("Segoe UI", 13, "bold"),
                                             text_color=COLORS["primary"]
                                             ).grid(row=0, column=0, padx=15, pady=(10, 3), sticky="w")
                                self._render_rich_text(frame, r or "Keine Antwort erhalten.",
                                                       font=("Segoe UI", 12),
                                                       text_color=COLORS["text"], wraplength=650,
                                                       row=1, column=0, padx=15, pady=(0, 10), sticky="w")
                            self.after(0, _show)
                        threading.Thread(target=_check_detailed, daemon=True).start()

                # Analyze FoSa solution steps if present
                if q.question_type == QuestionType.MATH_FORMULA and self.ai.api_key:
                    fosa_step_data = None
                    for item in answer_widgets:
                        if isinstance(item, tuple) and len(item) == 3 and item[0] == "fosa_steps":
                            fosa_step_data = item
                    if fosa_step_data and fosa_step_data[1]:
                        steps_list = fosa_step_data[1]
                        final_e = fosa_step_data[2]
                        ai_steps = []
                        for sw in steps_list:
                            inputs = {sym: e.get() for sym, e in sw["var_entries"].items() if e.get().strip()}
                            ai_steps.append({
                                "formula": sw["formula"].name,
                                "inputs": inputs,
                                "result": sw["result_entry"].get(),
                            })
                        if ai_steps:
                            step_fb = ctk.CTkFrame(feedback_frame, fg_color=COLORS["card"], corner_radius=8)
                            step_fb.grid(row=2, column=0, sticky="ew", pady=(5, 0))
                            step_fb.grid_columnconfigure(0, weight=1)
                            ctk.CTkLabel(step_fb, text=t("math.checking_steps"),
                                         font=("Segoe UI", 12), text_color=COLORS["text_light"]
                                         ).grid(row=0, column=0, padx=15, pady=10, sticky="w")

                            def _check_steps(steps=ai_steps, frame=step_fb, fa=final_e.get()):
                                resp = self.ai.check_solution_path(q.text, steps, fa)
                                def _show(r=resp):
                                    for w in frame.winfo_children():
                                        w.destroy()
                                    ctk.CTkLabel(frame, text=t("math.step_feedback"),
                                                 font=("Segoe UI", 13, "bold"),
                                                 text_color=COLORS["primary"]
                                                 ).grid(row=0, column=0, padx=15, pady=(10, 3), sticky="w")
                                    self._render_rich_text(frame, r or "Keine Antwort erhalten.",
                                                           font=("Segoe UI", 12),
                                                           text_color=COLORS["text"], wraplength=650,
                                                           row=1, column=0, padx=15, pady=(0, 10), sticky="w")
                                self.after(0, _show)
                            threading.Thread(target=_check_steps, daemon=True).start()
            else:
                self.session.next_question()
                self._show_question()

        # Navigation
        nav = ctk.CTkFrame(scroll, fg_color="transparent")
        nav.grid(row=6, column=0, sticky="ew", pady=15)

        if self.session.current_index > 0:
            ctk.CTkButton(nav, text="< Zurück", fg_color=COLORS["text_light"], width=100,
                         command=lambda: (self.session.prev_question(), self._show_question())
                         ).grid(row=0, column=0, padx=(0, 10))

        submit_btn = ctk.CTkButton(nav, text="Antwort prüfen" if self.session.mode in ("single", "weak") else "Weiter",
                                   fg_color=COLORS["primary"], width=150, command=submit)
        submit_btn.grid(row=0, column=1, padx=(0, 10))

        if self.session.mode in ("single", "weak"):
            ctk.CTkButton(nav, text="Nächste Frage >", fg_color=COLORS["success"], width=130,
                         command=lambda: (self.session.next_question(), self._show_question())
                         ).grid(row=0, column=2, padx=(0, 10))

        ctk.CTkButton(nav, text="Auswertung", fg_color=COLORS["danger"], width=120,
                     command=self._show_results).grid(row=0, column=3)

        # Mark button
        marked_ids = self.store.load_marked()
        is_marked = q.id in marked_ids
        mark_text = t("marked.btn_marked") if is_marked else t("marked.btn")
        mark_color = COLORS["warning"] if is_marked else COLORS["text_light"]

        def toggle_mark():
            mids = self.store.load_marked()
            if q.id in mids:
                mids.remove(q.id)
                mark_btn.configure(text=t("marked.btn"), fg_color=COLORS["text_light"])
            else:
                mids.append(q.id)
                mark_btn.configure(text=t("marked.btn_marked"), fg_color=COLORS["warning"])
            self.store.save_marked(mids)

        mark_btn = ctk.CTkButton(nav, text=mark_text, fg_color=mark_color, width=100,
                                 font=("Segoe UI", 12), command=toggle_mark)
        mark_btn.grid(row=0, column=5, padx=(10, 0))

        # AI Help button
        ai_help_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        ai_help_frame.grid(row=7, column=0, sticky="ew")
        ai_help_visible = {"shown": False}
        ai_help_inner = ctk.CTkFrame(ai_help_frame, fg_color=COLORS["card"], corner_radius=8)

        def toggle_ai_help():
            if ai_help_visible["shown"]:
                ai_help_inner.grid_forget()
                ai_help_visible["shown"] = False
            else:
                ai_help_inner.grid(row=1, column=0, sticky="ew", pady=(5, 0))
                ai_help_inner.grid_columnconfigure(0, weight=1)
                ai_help_visible["shown"] = True

        ctk.CTkButton(nav, text=t("ai_help.title"), fg_color=COLORS["primary_light"], width=100,
                     font=("Segoe UI", 12), command=toggle_ai_help
                     ).grid(row=0, column=6, padx=(10, 0))

        # AI help inner content
        ai_help_btns = ctk.CTkFrame(ai_help_inner, fg_color="transparent")
        ai_help_btns.grid(row=0, column=0, padx=10, pady=10, sticky="w")
        ai_response_frame = ctk.CTkFrame(ai_help_inner, fg_color="transparent")
        ai_response_frame.grid(row=1, column=0, padx=15, pady=(0, 10), sticky="ew")
        ai_response_frame.grid_columnconfigure(0, weight=1)

        def _set_ai_response(text):
            for w in ai_response_frame.winfo_children():
                w.destroy()
            self._render_rich_text(ai_response_frame, text, font=("Segoe UI", 12),
                                   text_color=COLORS["text"], wraplength=650,
                                   row=0, column=0, sticky="w")

        def _get_memory_prefix():
            settings = self.store.load_settings()
            if settings.get("use_memory"):
                memory = self.store.load_memory()
                if memory:
                    return f"Lernprofil des Studenten:\n{memory}\n\n"
            return ""

        def ask_ai_hint():
            _set_ai_response(t("ai_help.loading"))
            def run():
                prefix = _get_memory_prefix()
                msgs = [{"role": "system", "content": prefix + "Du bist ein hilfreicher Tutor. Gib einen Hinweis zur folgenden Frage, aber verrate NICHT die Antwort. Hilf dem Studenten, selbst auf die Lösung zu kommen."},
                        {"role": "user", "content": f"Frage: {q.text}"}]
                resp = self.ai._call_api(msgs, max_tokens=512)
                self.after(0, lambda: _set_ai_response(resp or "Keine Antwort erhalten."))
            threading.Thread(target=run, daemon=True).start()

        def ask_ai_explain():
            _set_ai_response(t("ai_help.loading"))
            def run():
                prefix = _get_memory_prefix()
                msgs = [{"role": "system", "content": prefix + "Du bist ein hilfreicher Tutor. Erkläre das Konzept hinter der folgenden Frage ausführlich, aber verrate NICHT die richtige Antwort direkt."},
                        {"role": "user", "content": f"Frage: {q.text}"}]
                resp = self.ai._call_api(msgs, max_tokens=1024)
                self.after(0, lambda: _set_ai_response(resp or "Keine Antwort erhalten."))
            threading.Thread(target=run, daemon=True).start()

        ctk.CTkButton(ai_help_btns, text=t("ai_help.hint"), fg_color=COLORS["primary"],
                     width=120, height=28, font=("Segoe UI", 11), command=ask_ai_hint
                     ).grid(row=0, column=0, padx=(0, 8))
        ctk.CTkButton(ai_help_btns, text=t("ai_help.explain"), fg_color=COLORS["primary"],
                     width=120, height=28, font=("Segoe UI", 11), command=ask_ai_explain
                     ).grid(row=0, column=1)

        # Quick action buttons
        quick_actions = self.store.load_quick_actions()
        if quick_actions:
            qa_frame = ctk.CTkFrame(scroll, fg_color="transparent")
            qa_frame.grid(row=8, column=0, sticky="ew", pady=5)

            def run_quick_action(action):
                ai_help_inner.grid(row=1, column=0, sticky="ew", pady=(5, 0))
                ai_help_inner.grid_columnconfigure(0, weight=1)
                ai_help_visible["shown"] = True
                _set_ai_response(t("ai_help.loading"))
                def run():
                    prefix = _get_memory_prefix()
                    msgs = [{"role": "system", "content": prefix + action["prompt"]},
                            {"role": "user", "content": f"Frage: {q.text}"}]
                    temp = action.get("temperature", 0.7)
                    resp = self.ai._call_api(msgs, max_tokens=1024, temperature=temp)
                    self.after(0, lambda: _set_ai_response(resp or "Keine Antwort erhalten."))
                threading.Thread(target=run, daemon=True).start()

            for i, qa in enumerate(quick_actions):
                ctk.CTkButton(qa_frame, text=qa["name"], width=100, height=28,
                              fg_color=COLORS["primary_light"], font=("Segoe UI", 11),
                              command=lambda a=qa: run_quick_action(a)
                              ).grid(row=0, column=i, padx=3)

    def _update_timer(self):
        if not self.timer_running or not self.session:
            return
        remaining = self.session.time_remaining
        if remaining <= 0:
            self.timer_label.configure(text="Zeit abgelaufen!")
            self._show_results()
            return
        mins = remaining // 60
        secs = remaining % 60
        self.timer_label.configure(text=f"{mins:02d}:{secs:02d}")
        if remaining < 300:
            self.timer_label.configure(fg_color=COLORS["danger"])
        self.after(1000, self._update_timer)

    # ── FOLDERS ──

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
        card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=12,
                           border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
        card.grid(row=row, column=0, sticky="ew", pady=5)
        card.grid_columnconfigure(1, weight=1)

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
        ctk.CTkButton(btns, text=t("home.open"), width=75, height=30, corner_radius=8,
                     fg_color=COLORS["primary"],
                     command=lambda f=folder: self.show_folder_detail(f)).grid(row=0, column=0, padx=3)
        ctk.CTkButton(btns, text="✕", width=30, height=30, corner_radius=8,
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
                qf = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
                qf.grid(row=row + i, column=0, sticky="ew", pady=3)
                qf.grid_columnconfigure(1, weight=1)
                ctk.CTkLabel(qf, text=quiz.name, font=("Segoe UI", 13, "bold"),
                            text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=8, sticky="w")
                ctk.CTkLabel(qf, text=f"{len(quiz.questions)} Fragen", font=("Segoe UI", 11),
                            text_color=COLORS["text_light"]).grid(row=0, column=1, padx=10, pady=8, sticky="w")
                ctk.CTkButton(qf, text=t("card.learn"), width=65, height=28, corner_radius=6,
                             fg_color=COLORS["primary"],
                             command=lambda q=quiz: self.show_quiz_modes(q)).grid(row=0, column=2, padx=5, pady=5)
                ctk.CTkButton(qf, text=t("folder.remove_quiz"), width=75, height=28, corner_radius=6,
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
                             fg_color=COLORS["success"], height=40, corner_radius=8,
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
                af = ctk.CTkFrame(scroll, fg_color=COLORS["row_neutral"], corner_radius=6)
                af.grid(row=row + i, column=0, sticky="ew", pady=2)
                af.grid_columnconfigure(0, weight=1)
                ctk.CTkLabel(af, text=f"{quiz.name} ({len(quiz.questions)} Fragen)",
                            font=("Segoe UI", 12), text_color=COLORS["text"]
                            ).grid(row=0, column=0, padx=15, pady=6, sticky="w")
                ctk.CTkButton(af, text=t("folder.add_quiz"), width=100, height=28,
                             corner_radius=6, fg_color=COLORS["primary"],
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

    def _show_results(self):
        was_daily = getattr(self, '_daily_mode', False)
        self._daily_mode = False
        self._clear_main()
        if not self.session:
            if was_daily:
                self.show_daily()
            else:
                self.show_home()
            return

        self._results_session = self.session
        self._results_was_daily = was_daily
        scroll = self._make_screen()

        total = self.session.total_score
        maximum = self.session.max_possible_score
        pct = (total / maximum * 100) if maximum > 0 else 0

        # Score card
        score_card = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
        score_card.grid(row=0, column=0, sticky="ew", pady=(0, 15))
        score_card.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(score_card, text=t("results.title"), font=("Arial", 20, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, padx=20, pady=(15, 5))

        color = COLORS["success"] if pct >= 60 else COLORS["warning"] if pct >= 40 else COLORS["danger"]
        ctk.CTkLabel(score_card, text=f"{pct:.0f}%", font=("Arial", 48, "bold"),
                    text_color=color).grid(row=1, column=0, pady=5)
        ctk.CTkLabel(score_card, text=f"{total:.1f} / {maximum:.1f} Punkte",
                    font=("Arial", 14), text_color=COLORS["text_light"]
                    ).grid(row=2, column=0, pady=(0, 5))

        answered = len(self.session.answers)
        correct = sum(1 for a in self.session.answers.values() if a.is_correct)
        ctk.CTkLabel(score_card, text=f"{correct}/{answered} Fragen richtig",
                    font=("Arial", 13), text_color=COLORS["text"]
                    ).grid(row=3, column=0, pady=(0, 15))

        # Details — clickable rows
        ctk.CTkLabel(scroll, text=t("results.details"), font=("Arial", 16, "bold"),
                    text_color=COLORS["text"]).grid(row=1, column=0, sticky="w", pady=(10, 10))

        for i, q in enumerate(self.session.questions):
            result = self.session.answers.get(q.id)
            is_ok = result and result.is_correct
            row_color = COLORS["row_ok"] if is_ok else COLORS["row_bad"] if result else COLORS["row_neutral"]
            rf = ctk.CTkFrame(scroll, fg_color=row_color, corner_radius=6, cursor="hand2")
            rf.grid(row=2 + i, column=0, sticky="ew", pady=2)
            rf.grid_columnconfigure(1, weight=1)

            icon = "✓" if is_ok else "✗" if result else "–"
            icon_color = COLORS["success"] if is_ok else COLORS["danger"]
            ctk.CTkLabel(rf, text=icon, font=("Arial", 16, "bold"),
                        text_color=icon_color, width=30).grid(row=0, column=0, padx=10, pady=8)
            title_lbl = ctk.CTkLabel(rf, text=f"{q.title or q.text[:60]}", font=("Arial", 12),
                        text_color=COLORS["text"])
            title_lbl.grid(row=0, column=1, sticky="w", padx=5, pady=8)
            if result:
                ctk.CTkLabel(rf, text=f"{result.score}/{result.max_score}",
                            font=("Arial", 12, "bold"), text_color=icon_color
                            ).grid(row=0, column=2, padx=(5, 5), pady=8)
            # Mark button
            marked_ids = self.store.load_marked()
            is_marked = q.id in marked_ids
            mark_btn = ctk.CTkButton(rf, text="★" if is_marked else "☆", width=30, height=28,
                                    corner_radius=6, fg_color=COLORS["warning"] if is_marked else COLORS["text_light"],
                                    command=lambda qid=q.id: self._toggle_mark_from_results(qid))
            mark_btn.grid(row=0, column=3, padx=(0, 5), pady=5)
            # Arrow indicating clickable
            ctk.CTkLabel(rf, text="›", font=("Arial", 16), text_color=COLORS["text_light"],
                        width=20).grid(row=0, column=4, padx=(0, 10), pady=8)

            # Make entire row clickable
            def _bind_click(widget, question=q, res=result):
                widget.bind("<Button-1>", lambda e: self._show_result_detail(question, res))
                for child in widget.winfo_children():
                    if not isinstance(child, ctk.CTkButton):
                        child.bind("<Button-1>", lambda e, qq=question, rr=res: self._show_result_detail(qq, rr))
            _bind_click(rf)

        # Actions
        base_row = 2 + len(self.session.questions)
        btn_f = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_f.grid(row=base_row, column=0, sticky="w", pady=20)
        ctk.CTkButton(btn_f, text=t("results.retry"), fg_color=COLORS["warning"],
                     command=lambda: self._start_quiz(self.current_quiz, self.session.mode,
                                                      self.session.time_limit)
                     ).grid(row=0, column=0, padx=(0, 10))
        back_cmd = self.show_daily if was_daily else self.show_home
        ctk.CTkButton(btn_f, text=t("nav.back_menu"), fg_color=COLORS["primary"],
                     command=back_cmd).grid(row=0, column=1)

        # AI Summary area
        ai_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        ai_frame.grid(row=base_row + 1, column=0, sticky="ew", pady=(0, 10))
        ai_frame.grid_columnconfigure(0, weight=1)

        summary_box = ctk.CTkTextbox(ai_frame, width=700, height=200, state="disabled")

        def gen_summary():
            results_data = []
            for q2 in self.session.questions:
                r = self.session.answers.get(q2.id)
                results_data.append({
                    "question": q2.title or q2.text[:80],
                    "topic": q2.topic,
                    "user_answer": r.user_answer if r else "",
                    "correct_answer": r.correct_answer if r else "",
                    "is_correct": r.is_correct if r else False,
                })
            summary_label.configure(text=t("summary.loading"))
            def _run():
                text = self.ai.generate_summary(results_data)
                self.after(0, lambda: _show_summary(text))
            def _show_summary(text):
                summary_label.configure(text="")
                summary_box.grid(row=2, column=0, sticky="ew", pady=5)
                summary_box.configure(state="normal")
                summary_box.delete("1.0", "end")
                summary_box.insert("1.0", text)
                summary_box.configure(state="disabled")
            threading.Thread(target=_run, daemon=True).start()

        def gen_tutor_prompt():
            wrong = []
            for q2 in self.session.questions:
                r = self.session.answers.get(q2.id)
                if r and not r.is_correct:
                    wrong.append({
                        "question": q2.title or q2.text[:80],
                        "text": q2.text,
                        "user_answer": r.user_answer,
                        "correct_answer": r.correct_answer,
                        "options": [o.text for o in q2.options] if q2.options else [],
                    })
            if not wrong:
                messagebox.showinfo("Info", "Alles richtig — kein Tutor-Prompt nötig!")
                return
            prompt = self.ai.generate_tutor_prompt(wrong)
            self.clipboard_clear()
            self.clipboard_append(prompt)
            messagebox.showinfo(t("summary.copy"), "Prompt in Zwischenablage kopiert!")

        summary_label = ctk.CTkLabel(ai_frame, text="", font=("Arial", 12),
                                     text_color=COLORS["text_light"])
        summary_label.grid(row=1, column=0, sticky="w")

        ai_btns = ctk.CTkFrame(ai_frame, fg_color="transparent")
        ai_btns.grid(row=0, column=0, sticky="w")
        ctk.CTkButton(ai_btns, text=t("summary.generate"), fg_color=COLORS["primary"],
                     command=gen_summary).grid(row=0, column=0, padx=(0, 8))
        ctk.CTkButton(ai_btns, text=t("summary.prompt"), fg_color=COLORS["warning"],
                     command=gen_tutor_prompt).grid(row=0, column=1)

    def _toggle_mark_from_results(self, question_id: str):
        marked = self.store.load_marked()
        if question_id in marked:
            marked.remove(question_id)
        else:
            marked.append(question_id)
        self.store.save_marked(marked)
        self._show_results()

    def _show_result_detail(self, question: Question, result: AnswerResult | None):
        """Show detailed view of a single question result with AI chat."""
        self._clear_main()
        scroll = self._make_screen()

        is_ok = result and result.is_correct
        status_color = COLORS["success"] if is_ok else COLORS["danger"]
        status_text = "✓ Richtig" if is_ok else "✗ Falsch"

        # Header with status
        header = ctk.CTkFrame(scroll, fg_color=status_color, corner_radius=8)
        header.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        header.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(header, text=status_text, font=("Segoe UI", 16, "bold"),
                    text_color="white").grid(row=0, column=0, padx=15, pady=10, sticky="w")

        # Question text
        q_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
        q_frame.grid(row=1, column=0, sticky="ew", pady=(0, 10))
        q_frame.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(q_frame, text=question.title or "Frage", font=("Segoe UI", 14, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(10, 5), sticky="w")
        ctk.CTkLabel(q_frame, text=question.text, font=("Segoe UI", 12),
                    text_color=COLORS["text"], wraplength=650, justify="left"
                    ).grid(row=1, column=0, padx=15, pady=(0, 10), sticky="w")

        # Answers comparison
        ans_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
        ans_frame.grid(row=2, column=0, sticky="ew", pady=(0, 10))
        ans_frame.grid_columnconfigure(0, weight=1)

        if result:
            # User's answer (red if wrong, green if correct)
            user_color = COLORS["success"] if is_ok else COLORS["danger"]
            ua_frame = ctk.CTkFrame(ans_frame, fg_color=user_color + "20", corner_radius=6)
            ua_frame.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 5))
            ua_frame.grid_columnconfigure(1, weight=1)
            ctk.CTkLabel(ua_frame, text=t("results.your_answer") + ":", font=("Segoe UI", 11, "bold"),
                        text_color=user_color).grid(row=0, column=0, padx=10, pady=8, sticky="w")
            ctk.CTkLabel(ua_frame, text=result.user_answer or "–", font=("Segoe UI", 12),
                        text_color=COLORS["text"], wraplength=500, justify="left"
                        ).grid(row=0, column=1, padx=10, pady=8, sticky="w")

            # Correct answer (always green)
            ca_frame = ctk.CTkFrame(ans_frame, fg_color=COLORS["success"] + "20", corner_radius=6)
            ca_frame.grid(row=1, column=0, sticky="ew", padx=10, pady=(0, 5))
            ca_frame.grid_columnconfigure(1, weight=1)
            ctk.CTkLabel(ca_frame, text=t("results.correct_answer") + ":", font=("Segoe UI", 11, "bold"),
                        text_color=COLORS["success"]).grid(row=0, column=0, padx=10, pady=8, sticky="w")

            correct_text = result.correct_answer
            if question.question_type == QuestionType.SINGLE_CHOICE:
                for o in question.options:
                    if o.is_correct:
                        correct_text = o.text
                        break
            elif question.question_type == QuestionType.MULTIPLE_CHOICE:
                correct_text = ", ".join(o.text for o in question.options if o.is_correct)

            ctk.CTkLabel(ca_frame, text=correct_text or "–", font=("Segoe UI", 12),
                        text_color=COLORS["text"], wraplength=500, justify="left"
                        ).grid(row=0, column=1, padx=10, pady=8, sticky="w")

            # For single/multiple choice: show all options with coloring
            if question.question_type in (QuestionType.SINGLE_CHOICE, QuestionType.MULTIPLE_CHOICE):
                opts_frame = ctk.CTkFrame(ans_frame, fg_color="transparent")
                opts_frame.grid(row=2, column=0, sticky="ew", padx=10, pady=(5, 10))
                opts_frame.grid_columnconfigure(0, weight=1)
                for oi, opt in enumerate(question.options):
                    opt_color = COLORS["success"] + "30" if opt.is_correct else COLORS["row_neutral"]
                    of = ctk.CTkFrame(opts_frame, fg_color=opt_color, corner_radius=4)
                    of.grid(row=oi, column=0, sticky="ew", pady=1)
                    of.grid_columnconfigure(1, weight=1)
                    marker = "✓" if opt.is_correct else ""
                    ctk.CTkLabel(of, text=marker, font=("Segoe UI", 12, "bold"),
                                text_color=COLORS["success"], width=25
                                ).grid(row=0, column=0, padx=(8, 0), pady=4)
                    ctk.CTkLabel(of, text=opt.text, font=("Segoe UI", 12),
                                text_color=COLORS["text"], wraplength=550, justify="left"
                                ).grid(row=0, column=1, padx=8, pady=4, sticky="w")

        if question.explanation:
            exp_frame = ctk.CTkFrame(ans_frame, fg_color=COLORS["primary"] + "15", corner_radius=6)
            exp_frame.grid(row=3, column=0, sticky="ew", padx=10, pady=(5, 10))
            exp_frame.grid_columnconfigure(0, weight=1)
            ctk.CTkLabel(exp_frame, text="Erklärung:", font=("Segoe UI", 11, "bold"),
                        text_color=COLORS["primary"]).grid(row=0, column=0, padx=10, pady=(8, 2), sticky="w")
            ctk.CTkLabel(exp_frame, text=question.explanation, font=("Segoe UI", 12),
                        text_color=COLORS["text"], wraplength=600, justify="left"
                        ).grid(row=1, column=0, padx=10, pady=(0, 8), sticky="w")

        # Mark for review
        marked_ids = self.store.load_marked()
        is_marked = question.id in marked_ids
        mark_btn_text = t("marked.btn_marked") + " ★" if is_marked else t("results.mark_for_later") + " ☆"
        ctk.CTkButton(scroll, text=mark_btn_text, fg_color=COLORS["warning"],
                     command=lambda: self._toggle_mark_and_refresh_detail(question, result)
                     ).grid(row=3, column=0, sticky="w", pady=(0, 10))

        # AI Chat section
        chat_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
        chat_frame.grid(row=4, column=0, sticky="ew", pady=(0, 10))
        chat_frame.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(chat_frame, text="KI-Chat zu dieser Frage", font=("Segoe UI", 14, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, padx=15, pady=(10, 5), sticky="w")

        chat_history = []
        chat_display = ctk.CTkTextbox(chat_frame, width=700, height=200, state="disabled",
                                       font=("Segoe UI", 12))
        chat_display.grid(row=1, column=0, sticky="ew", padx=10, pady=5)

        input_frame = ctk.CTkFrame(chat_frame, fg_color="transparent")
        input_frame.grid(row=2, column=0, sticky="ew", padx=10, pady=(0, 10))
        input_frame.grid_columnconfigure(0, weight=1)
        chat_input = ctk.CTkEntry(input_frame, placeholder_text="Frage zur Aufgabe stellen...")
        chat_input.grid(row=0, column=0, sticky="ew", padx=(0, 10))

        def _append_chat(role, text):
            chat_display.configure(state="normal")
            prefix = "Du: " if role == "user" else "KI: "
            chat_display.insert("end", f"\n{prefix}{text}\n")
            chat_display.configure(state="disabled")
            chat_display.see("end")

        def send_chat(event=None):
            msg = chat_input.get().strip()
            if not msg:
                return
            chat_input.delete(0, "end")
            chat_history.append({"role": "user", "content": msg})
            _append_chat("user", msg)

            def _run():
                context = (
                    f"Frage: {question.text}\n"
                    f"Richtige Antwort: {result.correct_answer if result else 'unbekannt'}\n"
                    f"Antwort des Schülers: {result.user_answer if result else 'keine'}\n"
                )
                system = (
                    "Du bist ein hilfreicher Tutor. Der Schüler hat gerade eine Quizfrage beantwortet "
                    "und möchte mehr darüber erfahren. Hier ist der Kontext:\n" + context +
                    "\nBeantworte die Frage des Schülers auf Deutsch. Nutze $LaTeX$ für Formeln."
                )
                msgs = [{"role": "system", "content": system}] + chat_history
                resp = self.ai._call_api(msgs, max_tokens=1024)
                answer = resp or "Keine Antwort erhalten."
                chat_history.append({"role": "assistant", "content": answer})
                self.after(0, lambda: _append_chat("assistant", answer))

            threading.Thread(target=_run, daemon=True).start()

        chat_input.bind("<Return>", send_chat)
        ctk.CTkButton(input_frame, text=t("chat.send"), width=80, fg_color=COLORS["primary"],
                     command=send_chat).grid(row=0, column=1)

        # Quick AI buttons
        quick_btns = ctk.CTkFrame(chat_frame, fg_color="transparent")
        quick_btns.grid(row=3, column=0, sticky="w", padx=10, pady=(0, 10))

        def ask_why_wrong():
            chat_input.delete(0, "end")
            chat_input.insert(0, "Warum ist meine Antwort falsch? Erkläre Schritt für Schritt.")
            send_chat()

        def ask_explain():
            chat_input.delete(0, "end")
            chat_input.insert(0, "Erkläre mir das Konzept hinter dieser Frage ausführlich.")
            send_chat()

        def ask_similar():
            chat_input.delete(0, "end")
            chat_input.insert(0, "Gib mir eine ähnliche Übungsaufgabe mit Lösung.")
            send_chat()

        if not is_ok:
            ctk.CTkButton(quick_btns, text="Warum falsch?", width=110, height=28,
                         fg_color=COLORS["danger"], corner_radius=6,
                         command=ask_why_wrong).grid(row=0, column=0, padx=(0, 5))
        ctk.CTkButton(quick_btns, text="Konzept erklären", width=120, height=28,
                     fg_color=COLORS["primary"], corner_radius=6,
                     command=ask_explain).grid(row=0, column=1, padx=(0, 5))
        ctk.CTkButton(quick_btns, text="Ähnliche Aufgabe", width=120, height=28,
                     fg_color=COLORS["success"], corner_radius=6,
                     command=ask_similar).grid(row=0, column=2)

        # Back button
        ctk.CTkButton(scroll, text=t("results.back_to_results"), fg_color=COLORS["text_light"],
                     command=self._show_results).grid(row=5, column=0, pady=20)

    def _toggle_mark_and_refresh_detail(self, question: Question, result: AnswerResult | None):
        marked = self.store.load_marked()
        if question.id in marked:
            marked.remove(question.id)
        else:
            marked.append(question.id)
        self.store.save_marked(marked)
        self._show_result_detail(question, result)

    # ── STATISTICS DASHBOARD ──

    def _answer_back_text(self, q: Question) -> str:
        """Human-readable 'correct answer' for a question (for flashcards)."""
        qt = q.question_type
        if qt in (QuestionType.SINGLE_CHOICE, QuestionType.MULTIPLE_CHOICE):
            return ", ".join(o.text for o in q.options if o.is_correct) or "—"
        if qt == QuestionType.FREE_TEXT:
            return q.correct_text or "—"
        if qt == QuestionType.FILL_BLANK:
            return " | ".join(q.blanks) or "—"
        if qt == QuestionType.DRAG_DROP:
            return "\n".join(f"{p.source} → {p.target}" for p in q.drag_drop_pairs) or "—"
        if qt == QuestionType.DIAGRAM_LABEL:
            return ", ".join(l.label for l in q.diagram_labels) or "—"
        return q.explanation or "—"

    def show_stats(self):
        self._clear_main()
        self.header_subtitle.configure(text=t("stats.title"))
        scroll = self._make_screen()

        ctk.CTkLabel(scroll, text=t("stats.title"), font=("Arial", 20, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 15))

        stats = self.store.load_stats()
        if not stats:
            ctk.CTkLabel(scroll, text=t("stats.no_data"), font=("Arial", 13),
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
                    font=("Arial", 13, "bold"), text_color=COLORS["text"]
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

        ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=5, column=0, sticky="w", pady=15)

    def _bar_chart(self, parent, row, title, labels, values, color,
                   max_value=None, suffix="", colors=None):
        """Render a simple bar chart on a tkinter Canvas."""
        card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=8)
        card.grid(row=row, column=0, sticky="ew", pady=(0, 12))
        card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(card, text=title, font=("Arial", 14, "bold"),
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
                               font=("Arial", 9, "bold"), fill=COLORS["text"])
            canvas.create_text(x0 + bar_w / 2, height - bottom_pad / 2, text=str(labels[i]),
                               font=("Arial", 8), fill=COLORS["text_light"])

    # ── POMODORO TIMER ──

    def show_pomodoro(self):
        self._clear_main()
        self.header_subtitle.configure(text=t("pomodoro.title"))
        frame = self._make_screen()

        ctk.CTkLabel(frame, text=t("pomodoro.title"), font=("Arial", 22, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, pady=(0, 5))
        ctk.CTkLabel(frame, text=t("pomodoro.hint"), font=("Arial", 12),
                    text_color=COLORS["text_light"]).grid(row=1, column=0, pady=(0, 20))

        FOCUS, BREAK = 25 * 60, 5 * 60
        state = {"remaining": FOCUS, "running": False, "phase": "focus", "round": 1, "job": None}

        phase_label = ctk.CTkLabel(frame, text=t("pomodoro.focus"), font=("Arial", 18, "bold"),
                                   text_color=COLORS["danger"])
        phase_label.grid(row=2, column=0, pady=(0, 5))
        round_label = ctk.CTkLabel(frame, text=t("pomodoro.round", n=1), font=("Arial", 12),
                                   text_color=COLORS["text_light"])
        round_label.grid(row=3, column=0, pady=(0, 10))
        time_label = ctk.CTkLabel(frame, text="25:00", font=("Arial", 64, "bold"),
                                  text_color=COLORS["text"])
        time_label.grid(row=4, column=0, pady=(0, 20))

        def render():
            m, s = divmod(state["remaining"], 60)
            time_label.configure(text=f"{m:02d}:{s:02d}")
            if state["phase"] == "focus":
                phase_label.configure(text=t("pomodoro.focus"), text_color=COLORS["danger"])
            else:
                phase_label.configure(text=t("pomodoro.break"), text_color=COLORS["success"])
            round_label.configure(text=t("pomodoro.round", n=state["round"]))

        def tick():
            if not state["running"]:
                return
            if state["remaining"] <= 0:
                # switch phase
                if state["phase"] == "focus":
                    state["phase"] = "break"
                    state["remaining"] = BREAK
                else:
                    state["phase"] = "focus"
                    state["round"] += 1
                    state["remaining"] = FOCUS
                try:
                    self.bell()
                except Exception:
                    pass
                render()
            else:
                state["remaining"] -= 1
                render()
            state["job"] = self.after(1000, tick)

        def start_pause():
            state["running"] = not state["running"]
            start_btn.configure(text=t("pomodoro.pause") if state["running"] else t("pomodoro.start"))
            if state["running"]:
                tick()

        def reset():
            state["running"] = False
            state["phase"] = "focus"
            state["round"] = 1
            state["remaining"] = FOCUS
            start_btn.configure(text=t("pomodoro.start"))
            render()

        btns = ctk.CTkFrame(frame, fg_color="transparent")
        btns.grid(row=5, column=0, pady=10)
        start_btn = ctk.CTkButton(btns, text=t("pomodoro.start"), fg_color=COLORS["success"],
                                  width=120, command=start_pause)
        start_btn.grid(row=0, column=0, padx=8)
        ctk.CTkButton(btns, text=t("pomodoro.reset"), fg_color=COLORS["warning"],
                     width=120, command=reset).grid(row=0, column=1, padx=8)
        ctk.CTkButton(btns, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                     width=120, command=self.show_home).grid(row=0, column=2, padx=8)
        render()

    # ── FLASHCARD MODE ──

    def _start_flashcards(self, quiz: Quiz, topic: str | None = None):
        cards = list(quiz.questions)
        if topic:
            cards = [q for q in cards if q.topic.strip() == topic]
        if not cards:
            messagebox.showinfo("Hinweis", "Keine Fragen für diese Auswahl.")
            return
        random.shuffle(cards)
        self._flash_cards = cards
        self._flash_index = 0
        self._show_flashcard()

    def _show_flashcard(self):
        self._clear_main()
        cards = getattr(self, "_flash_cards", [])
        idx = getattr(self, "_flash_index", 0)
        if idx >= len(cards):
            self._flash_done()
            return
        q = cards[idx]
        self.header_subtitle.configure(text=f"{t('modes.flashcards')} {idx + 1}/{len(cards)}")

        frame = self._make_screen()
        frame.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(frame, text=t("flash.front"), font=("Arial", 13, "bold"),
                    text_color=COLORS["primary"]).grid(row=0, column=0, pady=(0, 5))

        card = ctk.CTkFrame(frame, fg_color=COLORS["card"], corner_radius=12,
                           border_width=2, border_color=COLORS["primary"])
        card.grid(row=1, column=0, sticky="nsew", pady=(0, 15))
        card.grid_columnconfigure(0, weight=1)
        card.grid_rowconfigure(0, weight=1)

        front_text = (q.title + "\n\n" if q.title else "") + q.text
        content = ctk.CTkLabel(card, text=front_text, font=("Arial", 16),
                              text_color=COLORS["text"], wraplength=600, justify="center")
        content.grid(row=0, column=0, padx=30, pady=30)

        side = {"flipped": False}

        def flip():
            side["flipped"] = not side["flipped"]
            if side["flipped"]:
                content.configure(text=self._answer_back_text(q),
                                  text_color=COLORS["success"])
                flip_btn.configure(text=t("flash.front"))
                grade.grid()
            else:
                content.configure(text=front_text, text_color=COLORS["text"])
                flip_btn.configure(text=t("flash.show_answer"))
                grade.grid_remove()

        def advance(known: bool):
            self.sr.update(q.id, known)
            self.store.log_answer(known)
            self._flash_index += 1
            self._show_flashcard()

        controls = ctk.CTkFrame(frame, fg_color="transparent")
        controls.grid(row=2, column=0, pady=10)
        flip_btn = ctk.CTkButton(controls, text=t("flash.show_answer"), fg_color=COLORS["primary"],
                                 width=160, command=flip)
        flip_btn.grid(row=0, column=0, padx=8)

        grade = ctk.CTkFrame(controls, fg_color="transparent")
        grade.grid(row=0, column=1)
        ctk.CTkButton(grade, text=t("flash.dont_know"), fg_color=COLORS["danger"],
                     width=130, command=lambda: advance(False)).grid(row=0, column=0, padx=6)
        ctk.CTkButton(grade, text=t("flash.know"), fg_color=COLORS["success"],
                     width=130, command=lambda: advance(True)).grid(row=0, column=1, padx=6)
        grade.grid_remove()

        ctk.CTkButton(frame, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=3, column=0, pady=10)

    def _flash_done(self):
        self._clear_main()
        frame = self._make_screen()
        ctk.CTkLabel(frame, text=t("flash.done"), font=("Arial", 22, "bold"),
                    text_color=COLORS["success"]).grid(row=0, column=0, pady=40)
        ctk.CTkButton(frame, text=t("nav.back_menu"), fg_color=COLORS["primary"],
                     command=self.show_home).grid(row=1, column=0)

    # ── RANDOM CROSS-QUIZ MODE ──

    def show_random_mode(self):
        self._clear_main()
        self.header_subtitle.configure(text=t("random.title"))
        frame = self._make_screen()

        ctk.CTkLabel(frame, text=t("random.title"), font=("Arial", 22, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, pady=(0, 5))
        ctk.CTkLabel(frame, text=t("random.sub"), font=("Arial", 13),
                    text_color=COLORS["text_light"]).grid(row=1, column=0, pady=(0, 20))

        all_questions = [q for quiz in self.quizzes for q in quiz.questions]
        ctk.CTkLabel(frame, text=f"{len(all_questions)} Fragen verfügbar", font=("Arial", 12),
                    text_color=COLORS["text"]).grid(row=2, column=0, pady=(0, 15))

        ctk.CTkLabel(frame, text=t("random.count"), font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=3, column=0)
        max_q = max(6, len(all_questions))
        count_var = IntVar(value=min(20, max_q))
        slider_to = min(100, max_q)
        count_slider = ctk.CTkSlider(frame, from_=5, to=slider_to,
                                      number_of_steps=max(1, slider_to - 5),
                                      width=300)
        count_slider.set(float(count_var.get()))
        count_label = ctk.CTkLabel(frame, text=str(count_var.get()), font=("Arial", 14, "bold"),
                                   text_color=COLORS["primary"])
        count_label.grid(row=4, column=0, pady=(0, 5))
        def on_count(v):
            count_var.set(int(v))
            count_label.configure(text=str(int(v)))
        count_slider.configure(command=on_count)
        count_slider.grid(row=5, column=0, pady=(0, 20))

        def start():
            if not all_questions:
                messagebox.showinfo("Hinweis", "Keine Fragen vorhanden.")
                return
            n = count_var.get()
            selected = list(all_questions)
            random.shuffle(selected)
            selected = selected[:n]
            self.current_quiz = Quiz(name=t("random.title"), questions=selected)
            self.session = QuizSession(selected, mode="single")
            self._show_question()

        ctk.CTkButton(frame, text=t("random.start"), fg_color=COLORS["success"],
                     width=160, command=start).grid(row=6, column=0, pady=10)
        ctk.CTkButton(frame, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                     width=160, command=self.show_home).grid(row=7, column=0, pady=5)

    # ── CLOZE TEXT GENERATOR ──

    def show_cloze_generator(self):
        self._clear_main()
        self.header_subtitle.configure(text=t("cloze.title"))
        scroll = self._make_screen()

        ctk.CTkLabel(scroll, text=t("cloze.title"), font=("Arial", 20, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 10))
        ctk.CTkLabel(scroll, text=t("cloze.sub"), font=("Arial", 13),
                    text_color=COLORS["text_light"]).grid(row=1, column=0, sticky="w", pady=(0, 15))

        # Source selection: stored slides or manual text
        source_texts = self.store.load_source_texts()
        source_names = list(source_texts.keys())
        row = 2

        if source_names:
            ctk.CTkLabel(scroll, text="Quelle auswählen:", font=("Arial", 13, "bold"),
                        text_color=COLORS["text"]).grid(row=row, column=0, sticky="w")
            row += 1
            source_var = StringVar(value="Eigener Text")
            options = ["Eigener Text"] + source_names
            source_menu = ctk.CTkOptionMenu(scroll, values=options, variable=source_var, width=400,
                                           command=lambda v: _on_source_change(v))
            source_menu.grid(row=row, column=0, sticky="w", pady=5)
            row += 1
        else:
            source_var = StringVar(value="Eigener Text")

        ctk.CTkLabel(scroll, text="Quelltext eingeben oder einfügen:", font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=row, column=0, sticky="w")
        row += 1
        source_box = ctk.CTkTextbox(scroll, width=700, height=150)
        source_box.grid(row=row, column=0, sticky="ew", pady=(3, 10))
        row += 1

        def _on_source_change(name):
            source_box.delete("1.0", "end")
            if name != "Eigener Text" and name in source_texts:
                text = source_texts[name]
                if len(text) > 10000:
                    text = text[:10000]
                source_box.insert("1.0", text)

        # Length presets
        LENGTH_PRESETS = {
            "Sehr kurz": (200, 500),
            "Kurz": (500, 1200),
            "Mittel": (1200, 2500),
            "Lang": (2500, 5000),
            "Sehr lang": (5000, 10000),
        }
        MIN_CHARS_ABS = 100
        MAX_CHARS_ABS = 15000
        MIN_GAP = 200

        ctk.CTkLabel(scroll, text="Textlänge:", font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=row, column=0, sticky="w", pady=(10, 0))
        row += 1

        length_var = StringVar(value="Mittel")
        preset_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        preset_frame.grid(row=row, column=0, sticky="w", pady=5)
        for i, name in enumerate(LENGTH_PRESETS):
            ctk.CTkRadioButton(preset_frame, text=name, variable=length_var, value=name,
                              command=lambda: _on_length_change()
                              ).grid(row=0, column=i, padx=(0, 12))
        row += 1

        # Advanced checkbox
        advanced_var = BooleanVar(value=False)
        ctk.CTkCheckBox(scroll, text="Erweitert (eigene Länge)", variable=advanced_var,
                       command=lambda: _toggle_advanced()
                       ).grid(row=row, column=0, sticky="w", pady=(5, 0))
        row += 1

        adv_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        adv_frame.grid(row=row, column=0, sticky="w", pady=5)
        row += 1

        ctk.CTkLabel(adv_frame, text="Min:", font=("Arial", 12)).grid(row=0, column=0, padx=(0, 5))
        min_entry = ctk.CTkEntry(adv_frame, width=80, placeholder_text=str(MIN_CHARS_ABS))
        min_entry.grid(row=0, column=1, padx=(0, 15))
        min_entry.insert(0, "1200")
        ctk.CTkLabel(adv_frame, text="Max:", font=("Arial", 12)).grid(row=0, column=2, padx=(0, 5))
        max_entry = ctk.CTkEntry(adv_frame, width=80, placeholder_text=str(MAX_CHARS_ABS))
        max_entry.grid(row=0, column=3, padx=(0, 10))
        max_entry.insert(0, "2500")
        ctk.CTkLabel(adv_frame, text="Zeichen", font=("Arial", 11),
                    text_color=COLORS["text_light"]).grid(row=0, column=4)
        adv_frame.grid_remove()

        def _toggle_advanced():
            if advanced_var.get():
                adv_frame.grid()
            else:
                adv_frame.grid_remove()

        def _on_length_change():
            preset = LENGTH_PRESETS.get(length_var.get(), (1200, 2500))
            min_entry.delete(0, "end")
            min_entry.insert(0, str(preset[0]))
            max_entry.delete(0, "end")
            max_entry.insert(0, str(preset[1]))

        def _get_length_params():
            if advanced_var.get():
                try:
                    mn = max(MIN_CHARS_ABS, int(min_entry.get()))
                    mx = max(mn + MIN_GAP, int(max_entry.get()))
                    mx = min(mx, MAX_CHARS_ABS)
                    return mn, mx
                except ValueError:
                    pass
            preset = LENGTH_PRESETS.get(length_var.get(), (1200, 2500))
            return preset

        # Phase 2+3 container
        result_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        result_frame.grid(row=row + 1, column=0, sticky="ew")
        result_frame.grid_columnconfigure(0, weight=1)

        cloze_state = {"summary": "", "keywords": [], "entries": [],
                       "hidden_words": [], "mode": "freetext"}

        def analyze():
            text = source_box.get("1.0", "end-1c").strip()
            if not text:
                messagebox.showwarning("Hinweis", "Bitte Text eingeben!")
                return
            progress_lbl.configure(text=t("summary.loading"))
            min_c, max_c = _get_length_params()

            def _run():
                result = self.ai.analyze_keywords(text, min_chars=min_c, max_chars=max_c)
                self.after(0, lambda: _show_phase2(result))

            threading.Thread(target=_run, daemon=True).start()

        def _show_phase2(result):
            progress_lbl.configure(text="")
            for w in result_frame.winfo_children():
                w.destroy()
            summary = result.get("summary", "")
            keywords = result.get("keywords", [])
            # Sort keywords by index position
            keywords.sort(key=lambda k: k.get("index", 0))
            cloze_state["summary"] = summary
            cloze_state["keywords"] = keywords

            phase2 = ctk.CTkFrame(result_frame, fg_color=COLORS["card"], corner_radius=12,
                                  border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
            phase2.grid(row=0, column=0, sticky="ew", pady=10, padx=5)
            phase2.grid_columnconfigure(0, weight=1)

            n_kw = len(keywords)
            ctk.CTkLabel(phase2, text=f"{n_kw} relevante Wörter gefunden",
                        font=("Segoe UI", 14, "bold"), text_color=COLORS["primary"]
                        ).grid(row=0, column=0, padx=15, pady=(12, 5), sticky="w")

            # Slider: how many to hide
            hide_var = IntVar(value=min(n_kw, max(1, n_kw // 2)))
            slider_label = ctk.CTkLabel(phase2, text=f"Wörter verstecken: {hide_var.get()}",
                                        font=("Segoe UI", 12), text_color=COLORS["text"])
            slider_label.grid(row=1, column=0, padx=15, pady=(5, 0), sticky="w")

            def on_slider(val):
                hide_var.set(int(val))
                slider_label.configure(text=f"Wörter verstecken: {int(val)}")

            if n_kw > 0:
                slider = ctk.CTkSlider(phase2, from_=0, to=n_kw, number_of_steps=n_kw,
                                       width=400, command=on_slider)
                slider.set(hide_var.get())
                slider.grid(row=2, column=0, padx=15, pady=5, sticky="w")

            # Mode selection
            mode_var = StringVar(value="freetext")
            mode_frame = ctk.CTkFrame(phase2, fg_color="transparent")
            mode_frame.grid(row=3, column=0, padx=15, pady=5, sticky="w")
            ctk.CTkRadioButton(mode_frame, text="Freitext (schwer)", variable=mode_var,
                              value="freetext", font=("Segoe UI", 12)
                              ).grid(row=0, column=0, padx=(0, 20))
            ctk.CTkRadioButton(mode_frame, text="Drag & Drop (einfach)", variable=mode_var,
                              value="dragdrop", font=("Segoe UI", 12)
                              ).grid(row=0, column=1)

            # Start button
            ctk.CTkButton(phase2, text="Lückentext starten", fg_color=COLORS["success"],
                         font=("Segoe UI", 13, "bold"),
                         command=lambda: _start_exercise(hide_var.get(), mode_var.get())
                         ).grid(row=4, column=0, padx=15, pady=(8, 12), sticky="w")

        def _start_exercise(num_hide, mode):
            summary = cloze_state["summary"]
            keywords = cloze_state["keywords"]
            # Pick the first num_hide keywords (sorted by position)
            hidden = keywords[:num_hide]
            cloze_state["hidden_words"] = [kw["word"] for kw in hidden]
            cloze_state["mode"] = mode

            for w in result_frame.winfo_children():
                w.destroy()

            if mode == "freetext":
                _render_freetext(summary, hidden)
            else:
                _render_dragdrop(summary, hidden)

        def _render_freetext(summary, hidden_keywords):
            """Render cloze exercise in free text mode."""
            cloze_state["entries"] = []
            flow = ctk.CTkFrame(result_frame, fg_color=COLORS["card"], corner_radius=12,
                               border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
            flow.grid(row=0, column=0, sticky="ew", pady=10, padx=5)
            flow.grid_columnconfigure(0, weight=1)

            # Build display text with numbered blanks
            display_text = summary
            # Replace keywords from end to start to preserve indices
            replacements = []
            for i, kw in enumerate(sorted(hidden_keywords, key=lambda k: k["index"], reverse=True)):
                word = kw["word"]
                idx = kw["index"]
                display_text = display_text[:idx] + f"[{i+1}]" + display_text[idx + len(word):]
            # Re-number in forward order
            display_text = summary
            sorted_kws = sorted(hidden_keywords, key=lambda k: k["index"], reverse=True)
            for i, kw in enumerate(sorted_kws):
                blank_num = len(sorted_kws) - i
                word = kw["word"]
                idx = kw["index"]
                display_text = display_text[:idx] + f"[ {blank_num} ]" + display_text[idx + len(word):]

            text_widget = ctk.CTkTextbox(flow, width=680, height=max(200, len(hidden_keywords) * 20 + 100),
                                         fg_color=COLORS["card"], text_color=COLORS["text"],
                                         font=("Segoe UI", 13), wrap="word", state="disabled")
            text_widget.grid(row=0, column=0, sticky="ew", padx=10, pady=10)
            text_widget.configure(state="normal")
            text_widget.delete("1.0", "end")
            text_widget.insert("1.0", display_text)
            text_widget.configure(state="disabled")

            # Entry fields
            blank_frame = ctk.CTkFrame(flow, fg_color="transparent")
            blank_frame.grid(row=1, column=0, sticky="ew", padx=10, pady=(0, 10))
            blank_frame.grid_columnconfigure((0, 1, 2), weight=1)

            ctk.CTkLabel(blank_frame, text="Lücken ausfüllen:", font=("Segoe UI", 13, "bold"),
                        text_color=COLORS["text"]).grid(row=0, column=0, columnspan=3, sticky="w", pady=(5, 8))

            forward_kws = sorted(hidden_keywords, key=lambda k: k["index"])
            for i, kw in enumerate(forward_kws):
                r = 1 + i // 3
                c = i % 3
                entry_frame = ctk.CTkFrame(blank_frame, fg_color="transparent")
                entry_frame.grid(row=r, column=c, sticky="w", padx=5, pady=3)
                ctk.CTkLabel(entry_frame, text=f"[{i+1}]", font=("Segoe UI", 12, "bold"),
                            text_color=COLORS["primary"], width=30
                            ).grid(row=0, column=0, padx=(0, 4))
                entry = ctk.CTkEntry(entry_frame, width=160, placeholder_text=f"Lücke {i+1}",
                                    corner_radius=8, border_color=COLORS.get("border", "#e0e4f0"))
                entry.grid(row=0, column=1)
                cloze_state["entries"].append(entry)

            # Buttons
            _render_check_buttons(result_frame, forward_kws)

        def _render_dragdrop(summary, hidden_keywords):
            """Render cloze exercise in drag & drop mode on a Canvas."""
            forward_kws = sorted(hidden_keywords, key=lambda k: k["index"])
            words_to_hide = [kw["word"] for kw in forward_kws]

            flow = ctk.CTkFrame(result_frame, fg_color=COLORS["card"], corner_radius=12,
                               border_width=1, border_color=COLORS.get("border", "#e0e4f0"))
            flow.grid(row=0, column=0, sticky="ew", pady=10, padx=5)
            flow.grid_columnconfigure(0, weight=1)

            canvas_width = 680
            line_height = 22
            pool_height = 60

            # Build text segments with blanks
            segments = []  # list of (text, is_blank, blank_index_or_None)
            last_end = 0
            for i, kw in enumerate(forward_kws):
                idx = kw["index"]
                word = kw["word"]
                if idx > last_end:
                    segments.append((summary[last_end:idx], False, None))
                segments.append((word, True, i))
                last_end = idx + len(word)
            if last_end < len(summary):
                segments.append((summary[last_end:], False, None))

            # Estimate canvas height (rough: 80 chars per line)
            total_chars = len(summary)
            est_lines = max(5, total_chars // 70 + 3)
            canvas_height = est_lines * line_height + pool_height + 30

            canvas_bg = COLORS.get("canvas_bg", "white")
            dnd_canvas = tk.Canvas(flow, width=canvas_width, height=canvas_height,
                                   bg=canvas_bg, highlightthickness=0)
            dnd_canvas.grid(row=0, column=0, padx=10, pady=10)

            # Render text with drop zones
            x_cursor = 10
            y_cursor = 15
            max_x = canvas_width - 20
            drop_zones = {}  # blank_index -> {"x", "y", "width", "rect_id", "word"}
            assignments = {}  # blank_index -> chip_tag or None

            font_spec = ("Segoe UI", 11)
            blank_font = ("Segoe UI", 11, "bold")

            for text_part, is_blank, blank_idx in segments:
                if is_blank:
                    # Measure blank width
                    blank_label = f"[{blank_idx+1}]"
                    # Use a wider zone
                    zone_w = max(60, len(text_part) * 9 + 20)
                    zone_h = line_height
                    if x_cursor + zone_w > max_x:
                        x_cursor = 10
                        y_cursor += line_height + 4
                    zx = x_cursor
                    zy = y_cursor - 2
                    rect_id = dnd_canvas.create_rectangle(
                        zx, zy, zx + zone_w, zy + zone_h,
                        outline="#888", dash=(4, 2), width=2, fill=""
                    )
                    # Label inside zone
                    label_id = dnd_canvas.create_text(
                        zx + zone_w // 2, zy + zone_h // 2,
                        text=blank_label, font=("Segoe UI", 9),
                        fill="#aaa"
                    )
                    drop_zones[blank_idx] = {
                        "x": zx + zone_w // 2, "y": zy + zone_h // 2,
                        "left": zx, "top": zy, "right": zx + zone_w, "bottom": zy + zone_h,
                        "rect_id": rect_id, "label_id": label_id, "word": text_part
                    }
                    assignments[blank_idx] = None
                    x_cursor += zone_w + 4
                else:
                    # Render plain text word by word
                    words = text_part.split(" ")
                    for wi, w in enumerate(words):
                        if not w:
                            continue
                        w_display = w + (" " if wi < len(words) - 1 else "")
                        est_w = len(w_display) * 7
                        if x_cursor + est_w > max_x and x_cursor > 10:
                            x_cursor = 10
                            y_cursor += line_height + 4
                        dnd_canvas.create_text(x_cursor, y_cursor + line_height // 2,
                                              text=w_display, font=font_spec,
                                              fill=COLORS.get("text", "black"), anchor="w")
                        x_cursor += est_w

            # Divider
            pool_y = y_cursor + line_height + 15
            dnd_canvas.create_line(0, pool_y, canvas_width, pool_y, fill="#ccc", dash=(4, 3))

            # Resize canvas to fit
            total_h = pool_y + pool_height + 10
            dnd_canvas.configure(height=total_h)

            # Source chips in pool
            chip_assignments = {}  # chip_tag -> blank_idx or None
            shuffled_words = list(words_to_hide)
            random.shuffle(shuffled_words)

            spacing = max(80, canvas_width // (len(shuffled_words) + 1))
            for i, word in enumerate(shuffled_words):
                sx = spacing * (i + 1)
                if sx > canvas_width - 40:
                    sx = 20 + (i * 80) % (canvas_width - 40)
                sy = pool_y + pool_height // 2

                chip_tag = f"clozechip_{i}"
                chip_assignments[chip_tag] = None

                tid = dnd_canvas.create_text(sx, sy, text=word, font=("Segoe UI", 10, "bold"),
                                             fill="white", tags=(chip_tag,))
                bb = dnd_canvas.bbox(tid)
                pad = 6
                rid = dnd_canvas.create_rectangle(bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad,
                                                  fill="#2980b9", outline="#1a5276", width=2, tags=(chip_tag,))
                dnd_canvas.tag_lower(rid, tid)

                _state = {"x": 0, "y": 0}
                _word = word

                def make_handlers(tag, w):
                    drag = {"x": 0, "y": 0}

                    def press(e):
                        drag["x"], drag["y"] = e.x, e.y
                        dnd_canvas.tag_raise(tag)

                    def motion(e):
                        dnd_canvas.move(tag, e.x - drag["x"], e.y - drag["y"])
                        drag["x"], drag["y"] = e.x, e.y

                    def release(e):
                        box = dnd_canvas.bbox(tag)
                        if not box:
                            return
                        cx = (box[0] + box[2]) / 2
                        cy = (box[1] + box[3]) / 2

                        # Unassign from previous zone
                        prev = chip_assignments.get(tag)
                        if prev is not None:
                            assignments[prev] = None
                            dnd_canvas.itemconfig(drop_zones[prev]["rect_id"],
                                                  outline="#888", fill="")

                        # Check proximity to each zone
                        snapped = False
                        for bidx, zone in drop_zones.items():
                            if (zone["left"] - 30 < cx < zone["right"] + 30 and
                                zone["top"] - 15 < cy < zone["bottom"] + 15):
                                snap_x = zone["x"] - cx
                                snap_y = zone["y"] - cy
                                dnd_canvas.move(tag, snap_x, snap_y)
                                # Unassign any chip already in this zone
                                for other_tag, other_bidx in chip_assignments.items():
                                    if other_bidx == bidx and other_tag != tag:
                                        chip_assignments[other_tag] = None
                                assignments[bidx] = w
                                chip_assignments[tag] = bidx
                                dnd_canvas.itemconfig(zone["rect_id"],
                                                      outline=COLORS.get("primary", "#3366cc"),
                                                      fill=COLORS.get("card_hover", "#f0f3ff"))
                                snapped = True
                                break
                        if not snapped:
                            chip_assignments[tag] = None

                    return press, motion, release

                p, m, r = make_handlers(chip_tag, _word)
                dnd_canvas.tag_bind(chip_tag, "<Button-1>", p)
                dnd_canvas.tag_bind(chip_tag, "<B1-Motion>", m)
                dnd_canvas.tag_bind(chip_tag, "<ButtonRelease-1>", r)

            # Store assignments ref for checking
            cloze_state["dnd_assignments"] = assignments
            cloze_state["dnd_zones"] = drop_zones

            # Buttons
            _render_dnd_check_buttons(result_frame, forward_kws, assignments, drop_zones, dnd_canvas)

        def _render_check_buttons(parent, forward_kws):
            """Render check/add-to-quiz buttons for freetext mode."""
            check_row = ctk.CTkFrame(parent, fg_color="transparent")
            check_row.grid(row=1, column=0, sticky="w", pady=10)

            def check_freetext(use_ai):
                entries = cloze_state["entries"]
                correct_count = 0
                for i, (entry, kw) in enumerate(zip(entries, forward_kws)):
                    user_val = entry.get().strip()
                    answer = kw["word"]
                    if use_ai and self.ai.api_key:
                        ok = self.ai.ai_validate_answer(f"Lücke {i+1}", answer, user_val)
                    else:
                        ok = user_val.lower() == answer.lower()
                    color = COLORS["success"] if ok else COLORS["danger"]
                    entry.configure(border_color=color)
                    if ok:
                        correct_count += 1
                messagebox.showinfo(t("cloze.check"),
                                  f"{correct_count}/{len(forward_kws)} richtig!")

            ctk.CTkButton(check_row, text=t("cloze.exact_check"), fg_color=COLORS["primary"],
                         command=lambda: check_freetext(False)).grid(row=0, column=0, padx=(0, 8))
            if self.ai.api_key:
                ctk.CTkButton(check_row, text=t("cloze.ai_check"), fg_color=COLORS["success"],
                             command=lambda: check_freetext(True)).grid(row=0, column=1, padx=(0, 8))
            ctk.CTkButton(check_row, text=t("cloze.new_version"), fg_color=COLORS["warning"],
                         command=analyze).grid(row=0, column=2)

        def _render_dnd_check_buttons(parent, forward_kws, assignments, drop_zones, canvas):
            """Render check/add-to-quiz buttons for drag&drop mode."""
            check_row = ctk.CTkFrame(parent, fg_color="transparent")
            check_row.grid(row=1, column=0, sticky="w", pady=10)

            def check_dnd():
                correct_count = 0
                for i, kw in enumerate(forward_kws):
                    assigned_word = assignments.get(i)
                    expected = kw["word"]
                    ok = assigned_word is not None and assigned_word.lower() == expected.lower()
                    zone = drop_zones.get(i)
                    if zone:
                        color = "#2ecc71" if ok else "#e74c3c"
                        canvas.itemconfig(zone["rect_id"], outline=color, width=3)
                    if ok:
                        correct_count += 1
                messagebox.showinfo(t("cloze.check"),
                                  f"{correct_count}/{len(forward_kws)} richtig!")

            ctk.CTkButton(check_row, text=t("cloze.exact_check"), fg_color=COLORS["primary"],
                         command=check_dnd).grid(row=0, column=0, padx=(0, 8))
            ctk.CTkButton(check_row, text=t("cloze.new_version"), fg_color=COLORS["warning"],
                         command=analyze).grid(row=0, column=1)

        progress_lbl = ctk.CTkLabel(scroll, text="", font=("Arial", 12),
                                    text_color=COLORS["text_light"])
        progress_lbl.grid(row=row, column=0, sticky="w")

        btn_row = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_row.grid(row=row + 2, column=0, sticky="w", pady=10)
        ctk.CTkButton(btn_row, text=t("cloze.analyze") if hasattr(t, '__call__') and t("cloze.analyze") != "cloze.analyze" else "Analysieren",
                     fg_color=COLORS["success"],
                     command=analyze).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(btn_row, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=0, column=1)
