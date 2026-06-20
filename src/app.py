"""Main application UI using CustomTkinter."""

import os
import random
import threading
import time
from datetime import datetime
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
    Quiz, Question, QuestionType, Option, DragDropPair, DiagramLabel, DataStore
)
from .quiz_engine import QuizSession, SpacedRepetition, AnswerResult, DeadlinePlanner
from .ai_service import AIService
from .fsrs import FSRSScheduler, FSRSCard, to_dict as fsrs_to_dict, from_dict as fsrs_from_dict
from .theme import COLORS, apply_theme, is_dark
from .i18n import t, set_language, get_language

ctk.set_default_color_theme("blue")


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title(t("app.title"))
        self.geometry("1100x750")
        self.minsize(800, 600)

        self.store = DataStore(str(Path(__file__).parent.parent / "data"))
        self.quizzes = self.store.load_quizzes()
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

        self.header = ctk.CTkFrame(self, fg_color=COLORS["primary"], corner_radius=0, height=60)
        self.header.grid(row=0, column=0, sticky="ew")
        self.header.grid_columnconfigure(1, weight=1)

        self.header_title = ctk.CTkLabel(
            self.header, text=t("app.header"), font=("Arial", 20, "bold"),
            text_color="white"
        )
        self.header_title.grid(row=0, column=0, padx=20, pady=10)

        self.header_subtitle = ctk.CTkLabel(
            self.header, text=t("app.subtitle"),
            font=("Arial", 12), text_color="#d4e6f1"
        )
        self.header_subtitle.grid(row=0, column=1, padx=10, pady=10, sticky="w")

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

    # ── HOME SCREEN ──

    def show_home(self):
        self._clear_main()
        self.header_subtitle.configure(text=t("app.subtitle"))

        scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        scroll.grid(row=0, column=0, sticky="nsew", padx=20, pady=20)
        scroll.grid_columnconfigure(0, weight=1)

        # Welcome
        welcome = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
        welcome.grid(row=0, column=0, sticky="ew", pady=(0, 15))
        welcome.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(welcome, text=t("home.welcome"),
                     font=("Arial", 18, "bold"), text_color=COLORS["text"]
                     ).grid(row=0, column=0, padx=20, pady=(15, 5), sticky="w")
        ctk.CTkLabel(welcome, text=t("home.welcome_sub"),
                     font=("Arial", 13), text_color=COLORS["text_light"]
                     ).grid(row=1, column=0, padx=20, pady=(0, 15), sticky="w")

        # Actions (two rows of 4)
        actions = ctk.CTkFrame(scroll, fg_color="transparent")
        actions.grid(row=1, column=0, sticky="ew", pady=(0, 15))
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
            (t("home.settings"), t("home.settings_sub"), COLORS["text_light"], self.show_settings),
        ]
        for idx, (title_, desc, color, command) in enumerate(cards):
            self._action_card(actions, idx % 4, idx // 4, title_, desc, color, command)

        # Quiz list
        if self.quizzes:
            ctk.CTkLabel(scroll, text=t("home.your_quizzes"), font=("Arial", 16, "bold"),
                        text_color=COLORS["text"]).grid(row=2, column=0, sticky="w", pady=(10, 10))
            for i, quiz in enumerate(self.quizzes):
                self._quiz_card(scroll, quiz, row=3 + i)
        else:
            ctk.CTkLabel(scroll, text=t("home.no_quizzes"),
                        font=("Arial", 13), text_color=COLORS["text_light"]
                        ).grid(row=2, column=0, pady=30)

    def _action_card(self, parent, col, row, title, desc, color, command):
        card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=8,
                           border_width=2, border_color=color)
        card.grid(row=row, column=col, padx=5, pady=5, sticky="nsew")
        card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(card, text=title, font=("Arial", 14, "bold"),
                    text_color=color).grid(row=0, column=0, padx=15, pady=(12, 3))
        ctk.CTkLabel(card, text=desc, font=("Arial", 11),
                    text_color=COLORS["text_light"], wraplength=150
                    ).grid(row=1, column=0, padx=15, pady=(0, 8))
        ctk.CTkButton(card, text=t("home.open"), fg_color=color, width=100,
                     command=command).grid(row=2, column=0, padx=15, pady=(0, 12))

    def _quiz_card(self, parent, quiz: Quiz, row: int):
        card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=8)
        card.grid(row=row, column=0, sticky="ew", pady=4)
        card.grid_columnconfigure(1, weight=1)

        info = ctk.CTkFrame(card, fg_color="transparent")
        info.grid(row=0, column=0, padx=15, pady=10, sticky="w")
        ctk.CTkLabel(info, text=quiz.name, font=("Arial", 14, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w")
        weight_tag = f" · ⚖{quiz.weight:.1f}" if quiz.weight != 1.0 else ""
        ctk.CTkLabel(info, text=f"{len(quiz.questions)} Fragen{weight_tag} · {quiz.description}",
                    font=("Arial", 11), text_color=COLORS["text_light"]
                    ).grid(row=1, column=0, sticky="w")

        # Leitner boxes
        qids = [q.id for q in quiz.questions]
        counts = self.sr.get_box_counts(qids)
        boxes_frame = ctk.CTkFrame(card, fg_color="transparent")
        boxes_frame.grid(row=0, column=1, padx=10, pady=10)
        for b in range(1, 6):
            c = counts.get(b, 0)
            lbl = ctk.CTkLabel(boxes_frame, text=str(c), width=28, height=28,
                              corner_radius=14, fg_color=COLORS[f"box{b}"],
                              text_color="white", font=("Arial", 11, "bold"))
            lbl.grid(row=0, column=b - 1, padx=2)

        btns = ctk.CTkFrame(card, fg_color="transparent")
        btns.grid(row=0, column=2, padx=10, pady=10)
        ctk.CTkButton(btns, text=t("card.learn"), width=70, fg_color=COLORS["primary"],
                     command=lambda q=quiz: self.show_quiz_modes(q)).grid(row=0, column=0, padx=3)
        ctk.CTkButton(btns, text=t("card.edit"), width=80, fg_color=COLORS["text_light"],
                     command=lambda q=quiz: self.show_edit_quiz(q)).grid(row=0, column=1, padx=3)
        ctk.CTkButton(btns, text=t("card.export"), width=60, fg_color=COLORS["success"],
                     command=lambda q=quiz: self.export_quiz_file(q)).grid(row=0, column=2, padx=3)
        ctk.CTkButton(btns, text="X", width=30, fg_color=COLORS["danger"],
                     command=lambda q=quiz: self._delete_quiz(q)).grid(row=0, column=3, padx=3)

    def _delete_quiz(self, quiz: Quiz):
        if messagebox.askyesno("Quiz löschen", f"'{quiz.name}' wirklich löschen?"):
            self.quizzes = [q for q in self.quizzes if q.id != quiz.id]
            self.store.save_quizzes(self.quizzes)
            self.show_home()

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
        frame = ctk.CTkFrame(self.main_frame, fg_color=COLORS["bg"])
        frame.grid(row=0, column=0, sticky="nsew", padx=40, pady=30)
        frame.grid_columnconfigure(0, weight=1)

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

        def save():
            s = self.store.load_settings()
            s["api_key"] = api_entry.get().strip()
            s["model"] = model_entry.get().strip() or "deepseek/deepseek-chat"
            s["use_fsrs"] = bool(fsrs_switch.get())
            s["enable_images"] = bool(img_switch.get())
            s["ai_validation"] = bool(aival_switch.get())
            s["dark_mode"] = bool(dark_switch.get())
            s["language"] = "en" if lang_menu.get() == "English" else "de"
            self.store.save_settings(s)
            self.ai.api_key = s["api_key"]
            self.ai.model = s["model"]
            apply_theme(s["dark_mode"])
            set_language(s["language"])
            self.title(t("app.title"))
            self.header_title.configure(text=t("app.header"))
            messagebox.showinfo("OK", t("settings.saved"))
            self.show_home()

        btn_frame = ctk.CTkFrame(frame, fg_color="transparent")
        btn_frame.grid(row=10, column=0, sticky="w")
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

        scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        scroll.grid(row=0, column=0, sticky="nsew", padx=20, pady=20)
        scroll.grid_columnconfigure(0, weight=1)

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

        scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        scroll.grid(row=0, column=0, sticky="nsew", padx=20, pady=20)
        scroll.grid_columnconfigure(0, weight=1)

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

                chip_list_holder = ctk.CTkFrame(specific_frame, fg_color="transparent")
                chip_list_holder.grid(row=4, column=0, sticky="w", pady=(4, 0))

                def reload_diagram_canvas():
                    for w in canvas_holder.winfo_children():
                        w.destroy()
                    for w in chip_list_holder.winfo_children():
                        w.destroy()
                    photo, cw, ch = self._load_diagram_image(img_entry.get().strip())
                    canvas = tk.Canvas(canvas_holder, width=cw, height=ch, bg="white",
                                       highlightthickness=1, highlightbackground="#cccccc")
                    canvas.grid(row=0, column=0)
                    if photo:
                        canvas.create_image(0, 0, anchor="nw", image=photo)
                        canvas.image = photo  # keep reference

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
                add_row.grid(row=5, column=0, sticky="w", pady=(8, 0))
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
            ("Dokumente", "*.pdf *.txt *.md *.csv"),
            ("PDF", "*.pdf"),
            ("Text", "*.txt *.md"),
            ("Alle", "*.*"),
        ])

    def show_ai_generate(self):
        self._clear_main()
        scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        scroll.grid(row=0, column=0, sticky="nsew", padx=40, pady=20)
        scroll.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(scroll, text="KI-Fragengenerierung aus Vorlesungsfolien",
                    font=("Arial", 18, "bold"), text_color=COLORS["text"]
                    ).grid(row=0, column=0, sticky="w", pady=(0, 5))
        ctk.CTkLabel(scroll, text="Lade eine PDF- oder Textdatei hoch. Die KI liest seitenweise mit Sliding Window und generiert Prüfungsfragen.",
                    font=("Arial", 12), text_color=COLORS["text_light"]
                    ).grid(row=1, column=0, sticky="w", pady=(0, 20))

        # File selection
        file_var = StringVar()
        file_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        file_frame.grid(row=2, column=0, sticky="ew")
        ctk.CTkEntry(file_frame, textvariable=file_var, width=400, placeholder_text="Datei auswählen..."
                    ).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(file_frame, text="Durchsuchen", width=100,
                     command=lambda: file_var.set(self._file_dialog_with_pdf() or "")
                     ).grid(row=0, column=1)

        # Number of questions
        ctk.CTkLabel(scroll, text="Anzahl Fragen (ca.)", font=("Arial", 13, "bold")
                    ).grid(row=3, column=0, sticky="w", pady=(15, 0))
        num_var = IntVar(value=20)
        ctk.CTkOptionMenu(scroll, values=["10", "20", "30", "50"],
                          command=lambda v: num_var.set(int(v)), width=100
                          ).grid(row=4, column=0, sticky="w", pady=5)

        # Quiz name
        ctk.CTkLabel(scroll, text="Quiz-Name", font=("Arial", 13, "bold")
                    ).grid(row=5, column=0, sticky="w", pady=(10, 0))
        name_entry = ctk.CTkEntry(scroll, width=400, placeholder_text="Name für das Quiz")
        name_entry.grid(row=6, column=0, sticky="w", pady=5)

        # ── Slider: Kontext-Größe ──
        chunk_label = ctk.CTkLabel(scroll, text="Kontext-Größe: 6.000 Zeichen",
                                   font=("Arial", 13, "bold"), text_color=COLORS["text"])
        chunk_label.grid(row=7, column=0, sticky="w", pady=(15, 0))
        ctk.CTkLabel(scroll, text="Wie viel Text pro API-Call gesendet wird (größer = mehr Kontext, aber teurer)",
                    font=("Arial", 11), text_color=COLORS["text_light"]
                    ).grid(row=8, column=0, sticky="w")
        chunk_slider = ctk.CTkSlider(scroll, from_=2000, to=40000, number_of_steps=38, width=400)
        chunk_slider.set(6000)
        chunk_slider.configure(command=lambda v: chunk_label.configure(
            text=f"Kontext-Größe: {int(v):,} Zeichen".replace(",", ".")))
        chunk_slider.grid(row=9, column=0, sticky="w", pady=5)

        # ── Slider: Temperature ──
        temp_label = ctk.CTkLabel(scroll, text="Kreativität (Temperature): 0.30",
                                  font=("Arial", 13, "bold"), text_color=COLORS["text"])
        temp_label.grid(row=10, column=0, sticky="w", pady=(15, 0))
        ctk.CTkLabel(scroll, text="Niedrig = präziser, Hoch = kreativer/vielfältiger",
                    font=("Arial", 11), text_color=COLORS["text_light"]
                    ).grid(row=11, column=0, sticky="w")
        temp_slider = ctk.CTkSlider(scroll, from_=0, to=1.0, number_of_steps=20, width=400)
        temp_slider.set(0.3)
        temp_slider.configure(command=lambda v: temp_label.configure(
            text=f"Kreativität (Temperature): {v:.2f}"))
        temp_slider.grid(row=12, column=0, sticky="w", pady=5)

        # Progress
        progress_label = ctk.CTkLabel(scroll, text="", font=("Arial", 12), text_color=COLORS["primary"])
        progress_label.grid(row=13, column=0, sticky="w", pady=10)
        progress_bar = ctk.CTkProgressBar(scroll, width=400)
        progress_bar.grid(row=14, column=0, sticky="w")
        progress_bar.set(0)

        def generate():
            if not file_var.get():
                messagebox.showwarning("Hinweis", "Bitte eine Datei auswählen!")
                return
            if not self.ai.api_key:
                messagebox.showwarning("Hinweis", "Bitte zuerst API-Key in den Einstellungen speichern!")
                return

            self.ai.chunk_size = int(chunk_slider.get())
            self.ai.overlap = max(500, self.ai.chunk_size // 6)
            self.ai.temperature = round(temp_slider.get(), 2)

            def run():
                def progress_cb(current, total):
                    self.after(0, lambda: progress_label.configure(
                        text=f"Verarbeite Abschnitt {current}/{total} (Rolling Summary aktiv)..."))
                    self.after(0, lambda: progress_bar.set(current / total))

                questions = self.ai.generate_from_slides(file_var.get(), num_var.get(), progress_cb)
                def done():
                    if questions:
                        quiz = Quiz(
                            name=name_entry.get().strip() or "KI-generiertes Quiz",
                            description=f"{len(questions)} Fragen aus {Path(file_var.get()).name}",
                            created=datetime.now().isoformat(),
                            questions=questions,
                        )
                        self.quizzes.append(quiz)
                        self.store.save_quizzes(self.quizzes)
                        messagebox.showinfo("Fertig", f"{len(questions)} Fragen generiert und gespeichert!")
                        self.show_home()
                    else:
                        progress_label.configure(text="Keine Fragen generiert. Prüfe API-Key und Datei.")
                self.after(0, done)

            threading.Thread(target=run, daemon=True).start()

        btn_f = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_f.grid(row=15, column=0, sticky="w", pady=15)
        ctk.CTkButton(btn_f, text="Fragen generieren", fg_color=COLORS["success"],
                     command=generate).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(btn_f, text="Zurück", fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=0, column=1)

    # ── AI IMPORT ──

    def show_ai_import(self):
        self._clear_main()
        scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        scroll.grid(row=0, column=0, sticky="nsew", padx=40, pady=20)
        scroll.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(scroll, text="Fragen aus Dokument importieren",
                    font=("Arial", 18, "bold"), text_color=COLORS["text"]
                    ).grid(row=0, column=0, sticky="w", pady=(0, 5))
        ctk.CTkLabel(scroll, text="Lade ein PDF oder Übungsskript hoch. Die KI erkennt und importiert alle Fragen (parallel).",
                    font=("Arial", 12), text_color=COLORS["text_light"]
                    ).grid(row=1, column=0, sticky="w", pady=(0, 20))

        file_var = StringVar()
        file_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        file_frame.grid(row=2, column=0, sticky="ew")
        ctk.CTkEntry(file_frame, textvariable=file_var, width=400, placeholder_text="Datei auswählen..."
                    ).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(file_frame, text="Durchsuchen", width=100,
                     command=lambda: file_var.set(self._file_dialog_with_pdf() or "")
                     ).grid(row=0, column=1)

        ctk.CTkLabel(scroll, text="Quiz-Name", font=("Arial", 13, "bold")
                    ).grid(row=3, column=0, sticky="w", pady=(15, 0))
        name_entry = ctk.CTkEntry(scroll, width=400, placeholder_text="Name für das importierte Quiz")
        name_entry.grid(row=4, column=0, sticky="w", pady=5)

        # ── Slider: Kontext-Größe ──
        chunk_label = ctk.CTkLabel(scroll, text="Kontext-Größe: 6.000 Zeichen",
                                   font=("Arial", 13, "bold"), text_color=COLORS["text"])
        chunk_label.grid(row=5, column=0, sticky="w", pady=(15, 0))
        chunk_slider = ctk.CTkSlider(scroll, from_=2000, to=40000, number_of_steps=38, width=400)
        chunk_slider.set(6000)
        chunk_slider.configure(command=lambda v: chunk_label.configure(
            text=f"Kontext-Größe: {int(v):,} Zeichen".replace(",", ".")))
        chunk_slider.grid(row=6, column=0, sticky="w", pady=5)

        # ── Slider: Temperature ──
        temp_label = ctk.CTkLabel(scroll, text="Kreativität (Temperature): 0.30",
                                  font=("Arial", 13, "bold"), text_color=COLORS["text"])
        temp_label.grid(row=7, column=0, sticky="w", pady=(15, 0))
        temp_slider = ctk.CTkSlider(scroll, from_=0, to=1.0, number_of_steps=20, width=400)
        temp_slider.set(0.3)
        temp_slider.configure(command=lambda v: temp_label.configure(
            text=f"Kreativität (Temperature): {v:.2f}"))
        temp_slider.grid(row=8, column=0, sticky="w", pady=5)

        progress_label = ctk.CTkLabel(scroll, text="", font=("Arial", 12), text_color=COLORS["primary"])
        progress_label.grid(row=9, column=0, sticky="w", pady=10)
        progress_bar = ctk.CTkProgressBar(scroll, width=400)
        progress_bar.grid(row=10, column=0, sticky="w")
        progress_bar.set(0)

        def do_import():
            if not file_var.get():
                messagebox.showwarning("Hinweis", "Bitte eine Datei auswählen!")
                return
            if not self.ai.api_key:
                messagebox.showwarning("Hinweis", "Bitte zuerst API-Key in den Einstellungen speichern!")
                return

            self.ai.chunk_size = int(chunk_slider.get())
            self.ai.overlap = max(500, self.ai.chunk_size // 6)
            self.ai.temperature = round(temp_slider.get(), 2)

            def run():
                def progress_cb(current, total):
                    self.after(0, lambda: progress_label.configure(
                        text=f"Importiere Abschnitt {current}/{total} (parallel)..."))
                    self.after(0, lambda: progress_bar.set(current / total))

                questions = self.ai.import_questions(file_var.get(), progress_cb)
                def done():
                    if questions:
                        quiz = Quiz(
                            name=name_entry.get().strip() or "Importiertes Quiz",
                            description=f"{len(questions)} importierte Fragen",
                            created=datetime.now().isoformat(),
                            questions=questions,
                        )
                        self.quizzes.append(quiz)
                        self.store.save_quizzes(self.quizzes)
                        messagebox.showinfo("Fertig", f"{len(questions)} Fragen importiert!")
                        self.show_home()
                    else:
                        progress_label.configure(text="Keine Fragen importiert. Prüfe API-Key und Datei.")
                self.after(0, done)

            threading.Thread(target=run, daemon=True).start()

        btn_f = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_f.grid(row=11, column=0, sticky="w", pady=15)
        ctk.CTkButton(btn_f, text="Fragen importieren", fg_color=COLORS["success"],
                     command=do_import).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(btn_f, text="Zurück", fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=0, column=1)

    # ── QUIZ MODES ──

    def show_quiz_modes(self, quiz: Quiz):
        self._clear_main()
        self.current_quiz = quiz

        scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        scroll.grid(row=0, column=0, sticky="nsew", padx=20, pady=20)
        scroll.grid_columnconfigure(0, weight=1)

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

        scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        scroll.grid(row=0, column=0, sticky="nsew", padx=20, pady=10)
        scroll.grid_columnconfigure(0, weight=1)

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
        ctk.CTkLabel(card, text=q.text, font=("Arial", 13), text_color=COLORS["text"],
                    wraplength=700, justify="left"
                    ).grid(row=1, column=0, padx=20, pady=(5, 15), sticky="w")

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
                        font=("Arial", 12, "bold"), text_color=COLORS["text"]
                        ).grid(row=0, column=0, padx=20, pady=(10, 5), sticky="w")
            sources = [p.source for p in q.drag_drop_pairs]
            random.shuffle(sources)
            for i, pair in enumerate(q.drag_drop_pairs):
                f = ctk.CTkFrame(answer_frame, fg_color="transparent")
                f.grid(row=i + 1, column=0, padx=20, pady=5, sticky="w")
                ctk.CTkLabel(f, text=f"{pair.target}:", font=("Arial", 12, "bold"),
                            width=200, anchor="w").grid(row=0, column=0, padx=(0, 10))
                menu = ctk.CTkOptionMenu(f, values=["-- Auswählen --"] + sources, width=200)
                menu.set("-- Auswählen --")
                menu.grid(row=0, column=1)
                answer_widgets.append((pair.target, menu))

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

        # Feedback area (for single mode)
        feedback_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        feedback_frame.grid(row=4, column=0, sticky="ew")

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
                result = {}
                for target, menu in answer_widgets:
                    val = menu.get()
                    if val != "-- Auswählen --":
                        result[target] = val
                return result
            elif q.question_type == QuestionType.DIAGRAM_LABEL:
                return diagram_get_positions() if diagram_get_positions else {}
            return None

        def submit():
            answer = get_answer()
            answer_time_ms = int(time.time() * 1000) - _answer_start_ms
            result = self.session.submit_answer(answer)
            self.sr.update(q.id, result.is_correct)
            self.store.log_answer(result.is_correct)

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
            else:
                self.session.next_question()
                self._show_question()

        # Navigation
        nav = ctk.CTkFrame(scroll, fg_color="transparent")
        nav.grid(row=5, column=0, sticky="ew", pady=15)

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

        if self.session.mode == "exam":
            ctk.CTkButton(nav, text="Auswertung", fg_color=COLORS["danger"], width=120,
                         command=self._show_results).grid(row=0, column=3)

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

    # ── RESULTS ──

    def _show_results(self):
        self._clear_main()
        if not self.session:
            self.show_home()
            return

        scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        scroll.grid(row=0, column=0, sticky="nsew", padx=20, pady=20)
        scroll.grid_columnconfigure(0, weight=1)

        total = self.session.total_score
        maximum = self.session.max_possible_score
        pct = (total / maximum * 100) if maximum > 0 else 0

        # Score card
        score_card = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=8)
        score_card.grid(row=0, column=0, sticky="ew", pady=(0, 15))
        score_card.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(score_card, text="Auswertung", font=("Arial", 20, "bold"),
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

        # Details
        ctk.CTkLabel(scroll, text="Einzelergebnisse", font=("Arial", 16, "bold"),
                    text_color=COLORS["text"]).grid(row=1, column=0, sticky="w", pady=(10, 10))

        for i, q in enumerate(self.session.questions):
            result = self.session.answers.get(q.id)
            row_color = COLORS["row_ok"] if result and result.is_correct else COLORS["row_bad"] if result else COLORS["row_neutral"]
            rf = ctk.CTkFrame(scroll, fg_color=row_color, corner_radius=6)
            rf.grid(row=2 + i, column=0, sticky="ew", pady=2)
            rf.grid_columnconfigure(1, weight=1)

            icon = "✓" if result and result.is_correct else "✗" if result else "–"
            icon_color = COLORS["success"] if result and result.is_correct else COLORS["danger"]
            ctk.CTkLabel(rf, text=icon, font=("Arial", 16, "bold"),
                        text_color=icon_color, width=30).grid(row=0, column=0, padx=10, pady=8)
            ctk.CTkLabel(rf, text=f"{q.title or q.text[:60]}", font=("Arial", 12),
                        text_color=COLORS["text"]).grid(row=0, column=1, sticky="w", padx=5, pady=8)
            if result:
                ctk.CTkLabel(rf, text=f"{result.score}/{result.max_score}",
                            font=("Arial", 12, "bold"), text_color=icon_color
                            ).grid(row=0, column=2, padx=10, pady=8)

        # Actions
        btn_f = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_f.grid(row=2 + len(self.session.questions), column=0, sticky="w", pady=20)
        ctk.CTkButton(btn_f, text="Erneut versuchen", fg_color=COLORS["warning"],
                     command=lambda: self._start_quiz(self.current_quiz, self.session.mode,
                                                      self.session.time_limit)
                     ).grid(row=0, column=0, padx=(0, 10))
        ctk.CTkButton(btn_f, text=t("nav.back_menu"), fg_color=COLORS["primary"],
                     command=self.show_home).grid(row=0, column=1)

        # AI Summary area
        ai_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        ai_frame.grid(row=3 + len(self.session.questions), column=0, sticky="ew", pady=(0, 10))
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
        scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        scroll.grid(row=0, column=0, sticky="nsew", padx=20, pady=20)
        scroll.grid_columnconfigure(0, weight=1)

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
        frame = ctk.CTkFrame(self.main_frame, fg_color=COLORS["bg"])
        frame.grid(row=0, column=0, sticky="nsew", padx=40, pady=30)
        frame.grid_columnconfigure(0, weight=1)

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

        frame = ctk.CTkFrame(self.main_frame, fg_color=COLORS["bg"])
        frame.grid(row=0, column=0, sticky="nsew", padx=40, pady=30)
        frame.grid_columnconfigure(0, weight=1)
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
        frame = ctk.CTkFrame(self.main_frame, fg_color=COLORS["bg"])
        frame.grid(row=0, column=0, sticky="nsew", padx=40, pady=30)
        frame.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(frame, text=t("flash.done"), font=("Arial", 22, "bold"),
                    text_color=COLORS["success"]).grid(row=0, column=0, pady=40)
        ctk.CTkButton(frame, text=t("nav.back_menu"), fg_color=COLORS["primary"],
                     command=self.show_home).grid(row=1, column=0)

    # ── RANDOM CROSS-QUIZ MODE ──

    def show_random_mode(self):
        self._clear_main()
        self.header_subtitle.configure(text=t("random.title"))
        frame = ctk.CTkFrame(self.main_frame, fg_color=COLORS["bg"])
        frame.grid(row=0, column=0, sticky="nsew", padx=40, pady=30)
        frame.grid_columnconfigure(0, weight=1)

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
        scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color=COLORS["bg"])
        scroll.grid(row=0, column=0, sticky="nsew", padx=20, pady=20)
        scroll.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(scroll, text=t("cloze.title"), font=("Arial", 20, "bold"),
                    text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 10))
        ctk.CTkLabel(scroll, text=t("cloze.sub"), font=("Arial", 13),
                    text_color=COLORS["text_light"]).grid(row=1, column=0, sticky="w", pady=(0, 15))

        ctk.CTkLabel(scroll, text="Quelltext eingeben oder einfügen:", font=("Arial", 13, "bold"),
                    text_color=COLORS["text"]).grid(row=2, column=0, sticky="w")
        source_box = ctk.CTkTextbox(scroll, width=700, height=150)
        source_box.grid(row=3, column=0, sticky="ew", pady=(3, 10))

        result_frame = ctk.CTkFrame(scroll, fg_color="transparent")
        result_frame.grid(row=5, column=0, sticky="ew")
        result_frame.grid_columnconfigure(0, weight=1)

        cloze_state = {"text": "", "answers": [], "entries": []}

        def generate():
            text = source_box.get("1.0", "end-1c").strip()
            if not text:
                messagebox.showwarning("Hinweis", "Bitte Text eingeben!")
                return
            progress_lbl.configure(text=t("summary.loading"))
            def _run():
                cloze_text, answers = self.ai.generate_cloze_text(text, blank_pct=0.2)
                self.after(0, lambda: _show(cloze_text, answers))
            def _show(cloze_text, answers):
                progress_lbl.configure(text="")
                cloze_state["text"] = cloze_text
                cloze_state["answers"] = answers
                _render_cloze(cloze_text, answers)
            threading.Thread(target=_run, daemon=True).start()

        def _render_cloze(cloze_text, answers):
            for w in result_frame.winfo_children():
                w.destroy()
            cloze_state["entries"] = []
            parts = cloze_text.split("___")
            flow = ctk.CTkFrame(result_frame, fg_color=COLORS["card"], corner_radius=8)
            flow.grid(row=0, column=0, sticky="ew", pady=10, padx=5)
            flow.grid_columnconfigure(0, weight=1)
            text_row = 0
            for i, part in enumerate(parts):
                if part.strip():
                    ctk.CTkLabel(flow, text=part, font=("Arial", 13), text_color=COLORS["text"],
                                wraplength=650, justify="left"
                                ).grid(row=text_row, column=0, sticky="w", padx=10, pady=2)
                    text_row += 1
                if i < len(answers):
                    entry = ctk.CTkEntry(flow, width=180, placeholder_text=f"Lücke {i+1}")
                    entry.grid(row=text_row, column=0, sticky="w", padx=20, pady=3)
                    cloze_state["entries"].append(entry)
                    text_row += 1

            check_row = ctk.CTkFrame(result_frame, fg_color="transparent")
            check_row.grid(row=1, column=0, sticky="w", pady=10)
            ctk.CTkButton(check_row, text=t("cloze.exact_check"), fg_color=COLORS["primary"],
                         command=lambda: check_cloze(False)).grid(row=0, column=0, padx=(0, 8))
            if self.ai.api_key:
                ctk.CTkButton(check_row, text=t("cloze.ai_check"), fg_color=COLORS["success"],
                             command=lambda: check_cloze(True)).grid(row=0, column=1, padx=(0, 8))
            ctk.CTkButton(check_row, text=t("cloze.new_version"), fg_color=COLORS["warning"],
                         command=generate).grid(row=0, column=2)

        def check_cloze(use_ai):
            answers = cloze_state["answers"]
            entries = cloze_state["entries"]
            correct_count = 0
            for i, (entry, answer) in enumerate(zip(entries, answers)):
                user_val = entry.get().strip()
                if use_ai and self.ai.api_key:
                    ok = self.ai.ai_validate_answer(f"Lücke {i+1}", answer, user_val)
                else:
                    ok = user_val.lower() == answer.lower()
                color = COLORS["success"] if ok else COLORS["danger"]
                entry.configure(border_color=color)
                if ok:
                    correct_count += 1
            messagebox.showinfo(t("cloze.check"),
                              f"{correct_count}/{len(answers)} richtig!")

        progress_lbl = ctk.CTkLabel(scroll, text="", font=("Arial", 12),
                                    text_color=COLORS["text_light"])
        progress_lbl.grid(row=4, column=0, sticky="w")

        ctk.CTkButton(scroll, text=t("cloze.generate"), fg_color=COLORS["success"],
                     command=generate).grid(row=6, column=0, sticky="w", pady=10)
        ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=7, column=0, sticky="w", pady=5)
