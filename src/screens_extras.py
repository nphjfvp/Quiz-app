"""Extra screens (error diary, pomodoro, flashcards, random mode).

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


def show_error_diary(self):
    self._clear_main()
    scroll = self._make_screen()

    ctk.CTkLabel(scroll, text=t("diary.title"), font=("Segoe UI", 18, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", pady=(0, 5))

    diary = self.store.load_error_diary()
    if not diary:
        ctk.CTkLabel(scroll, text=t("diary.empty"), font=("Segoe UI", 13),
                    text_color=COLORS["text_light"]).grid(row=1, column=0, pady=30)
        ctk.CTkButton(scroll, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                     command=self.show_home).grid(row=2, column=0, sticky="w", pady=15)
        return

    # Filter
    filter_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    filter_frame.grid(row=1, column=0, sticky="w", pady=(0, 10))
    all_topics = sorted({e.get("topic", "") for e in diary if e.get("topic")})
    filter_var = StringVar(value="all")
    ctk.CTkLabel(filter_frame, text=t("diary.filter"), font=("Segoe UI", 12)
                ).grid(row=0, column=0, padx=(0, 8))
    topic_options = [t("diary.all_topics")] + all_topics
    filter_menu = ctk.CTkOptionMenu(filter_frame, values=topic_options, width=200,
                                     command=lambda _: _refresh())
    filter_menu.grid(row=0, column=1)

    entries_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    entries_frame.grid(row=2, column=0, sticky="ew")
    entries_frame.grid_columnconfigure(0, weight=1)

    def _refresh():
        for w in entries_frame.winfo_children():
            w.destroy()
        sel = filter_menu.get()
        filtered = diary if sel == t("diary.all_topics") else [e for e in diary if e.get("topic") == sel]
        by_date: dict[str, list] = {}
        for e in reversed(filtered):
            by_date.setdefault(e.get("date", "?"), []).append(e)

        r = 0
        for d, entries in list(by_date.items())[:30]:
            ctk.CTkLabel(entries_frame, text=d, font=("Segoe UI", 12, "bold"),
                        text_color=COLORS["primary"]).grid(row=r, column=0, sticky="w", pady=(10, 3))
            r += 1
            for e in entries:
                ef = ctk.CTkFrame(entries_frame, fg_color=COLORS["card"], corner_radius=RADIUS_SM,
                                  border_width=1, border_color=COLORS["border"])
                ef.grid(row=r, column=0, sticky="ew", pady=2)
                ef.grid_columnconfigure(0, weight=1)
                self._bind_card_hover(ef, accent_color=COLORS["danger"])
                q_text = e.get("question", "?")
                if len(q_text) > 80:
                    q_text = q_text[:80] + "..."
                ctk.CTkLabel(ef, text=q_text, font=("Segoe UI", 11),
                            text_color=COLORS["text"], wraplength=500
                            ).grid(row=0, column=0, padx=10, pady=(6, 0), sticky="w")
                detail = ""
                if e.get("topic"):
                    detail += f"[{e['topic']}] "
                detail += f"Deine Antwort: {e.get('user_answer', '?')} → Richtig: {e.get('correct', '?')}"
                ctk.CTkLabel(ef, text=detail, font=("Segoe UI", 10),
                            text_color=COLORS["danger"], wraplength=500
                            ).grid(row=1, column=0, padx=10, pady=(0, 6), sticky="w")
                r += 1

    _refresh()

    btn_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    btn_frame.grid(row=3, column=0, sticky="w", pady=15)
    def _clear_diary():
        if messagebox.askyesno(t("diary.title"), t("diary.clear_confirm")):
            self.store.save_error_diary([])
            self.show_error_diary()
    ctk.CTkButton(btn_frame, text=t("diary.clear"), fg_color=COLORS["danger"],
                 font=("Segoe UI", 12), command=_clear_diary).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkButton(btn_frame, text=t("nav.back_menu"), fg_color=COLORS["text_light"],
                 command=self.show_home).grid(row=0, column=1)

# ── POMODORO TIMER ──

def show_pomodoro(self):
    self._clear_main()
    self.header_subtitle.configure(text=t("pomodoro.title"))
    frame = self._make_screen()

    ctk.CTkLabel(frame, text=t("pomodoro.title"), font=("Segoe UI", 22, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, pady=(0, 5))
    ctk.CTkLabel(frame, text=t("pomodoro.hint"), font=("Segoe UI", 12),
                text_color=COLORS["text_light"]).grid(row=1, column=0, pady=(0, 20))

    FOCUS, BREAK = 25 * 60, 5 * 60
    state = {"remaining": FOCUS, "running": False, "phase": "focus", "round": 1, "job": None}

    timer_card = ctk.CTkFrame(frame, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                               border_width=2, border_color=COLORS["danger"])
    timer_card.grid(row=2, column=0, pady=(0, 20), ipadx=40, ipady=10)
    timer_card.grid_columnconfigure(0, weight=1)

    phase_label = ctk.CTkLabel(timer_card, text=t("pomodoro.focus"), font=("Segoe UI", 18, "bold"),
                               text_color=COLORS["danger"])
    phase_label.grid(row=0, column=0, pady=(15, 5))
    round_label = ctk.CTkLabel(timer_card, text=t("pomodoro.round", n=1), font=("Segoe UI", 12),
                               text_color=COLORS["text_light"])
    round_label.grid(row=1, column=0, pady=(0, 5))
    time_label = ctk.CTkLabel(timer_card, text="25:00", font=("Segoe UI", 64, "bold"),
                              text_color=COLORS["text"])
    time_label.grid(row=2, column=0, pady=(0, 15))

    def render():
        m, s = divmod(state["remaining"], 60)
        time_label.configure(text=f"{m:02d}:{s:02d}")
        if state["phase"] == "focus":
            phase_label.configure(text=t("pomodoro.focus"), text_color=COLORS["danger"])
            timer_card.configure(border_color=COLORS["danger"])
        else:
            phase_label.configure(text=t("pomodoro.break"), text_color=COLORS["success"])
            timer_card.configure(border_color=COLORS["success"])
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

    ctk.CTkLabel(frame, text=t("flash.front"), font=("Segoe UI", 13, "bold"),
                text_color=COLORS["primary"]).grid(row=0, column=0, pady=(0, 5))

    card = ctk.CTkFrame(frame, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                       border_width=2, border_color=COLORS["primary"])
    card.grid(row=1, column=0, sticky="nsew", pady=(0, 15))
    card.grid_columnconfigure(0, weight=1)
    card.grid_rowconfigure(0, weight=1)
    self._bind_card_hover(card, accent_color=COLORS["primary"])

    front_text = (q.title + "\n\n" if q.title else "") + q.text
    content = ctk.CTkLabel(card, text=front_text, font=("Segoe UI", 16),
                          text_color=COLORS["text"], wraplength=600, justify="center")
    content.grid(row=0, column=0, padx=30, pady=30)

    side = {"flipped": False}

    def flip():
        side["flipped"] = not side["flipped"]
        if side["flipped"]:
            content.configure(text=self._answer_back_text(q),
                              text_color=COLORS["success"])
            animate_color(card, "border_color", COLORS["primary"], COLORS["success"], 200, 8)
            flip_btn.configure(text=t("flash.front"))
            grade.grid()
        else:
            content.configure(text=front_text, text_color=COLORS["text"])
            animate_color(card, "border_color", COLORS["success"], COLORS["primary"], 200, 8)
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
    ctk.CTkLabel(frame, text=t("flash.done"), font=("Segoe UI", 22, "bold"),
                text_color=COLORS["success"]).grid(row=0, column=0, pady=40)
    ctk.CTkButton(frame, text=t("nav.back_menu"), fg_color=COLORS["primary"],
                 command=self.show_home).grid(row=1, column=0)

# ── RANDOM CROSS-QUIZ MODE ──

def show_random_mode(self):
    self._clear_main()
    self.header_subtitle.configure(text=t("random.title"))
    frame = self._make_screen()

    ctk.CTkLabel(frame, text=t("random.title"), font=("Segoe UI", 22, "bold"),
                text_color=COLORS["text"]).grid(row=0, column=0, pady=(0, 5))
    ctk.CTkLabel(frame, text=t("random.sub"), font=("Segoe UI", 13),
                text_color=COLORS["text_light"]).grid(row=1, column=0, pady=(0, 20))

    all_questions = [q for quiz in self.quizzes for q in quiz.questions]
    ctk.CTkLabel(frame, text=f"{len(all_questions)} Fragen verfügbar", font=("Segoe UI", 12),
                text_color=COLORS["text"]).grid(row=2, column=0, pady=(0, 15))

    ctk.CTkLabel(frame, text=t("random.count"), font=("Segoe UI", 13, "bold"),
                text_color=COLORS["text"]).grid(row=3, column=0)
    max_q = max(6, len(all_questions))
    count_var = IntVar(value=min(20, max_q))
    slider_to = min(100, max_q)
    count_slider = ctk.CTkSlider(frame, from_=5, to=slider_to,
                                  number_of_steps=max(1, slider_to - 5),
                                  width=300)
    count_slider.set(float(count_var.get()))
    count_label = ctk.CTkLabel(frame, text=str(count_var.get()), font=("Segoe UI", 14, "bold"),
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

