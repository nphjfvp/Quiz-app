"""SR Dashboard and Achievements screens for the desktop app.

Mixed into the App class via binding in app.py.
"""

from datetime import datetime
import customtkinter as ctk

from .theme import COLORS, RADIUS_SM, RADIUS_MD, RADIUS_LG


def _back_header(self, scroll, title):
    top = ctk.CTkFrame(scroll, fg_color="transparent")
    top.grid(row=0, column=0, sticky="ew", pady=(0, 12))
    top.grid_columnconfigure(1, weight=1)
    ctk.CTkButton(top, text="← Zurück", width=80, height=32, corner_radius=RADIUS_MD,
                  fg_color=COLORS["card"], text_color=COLORS["text"],
                  hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                  border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=self.show_home).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(top, text=title, font=("Segoe UI", 20, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=1, sticky="w")


# =====================================================================
#  SR DASHBOARD
# =====================================================================
def show_sr_dashboard(self):
    self._clear_main()
    self.header_subtitle.configure(text="🧠 Spaced Repetition")
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)
    _back_header(self, scroll, "🧠 Spaced Repetition")

    progress = self.store.load_progress()
    all_questions = []
    for q in self.quizzes:
        for qq in q.questions:
            all_questions.append((qq, q))

    due_now = mature = young = unseen = 0
    per_quiz = {}
    for qq, quiz in all_questions:
        pq = per_quiz.setdefault(quiz.id, {"name": quiz.name, "total": 0, "mastered": 0, "due": 0})
        pq["total"] += 1
        p = progress.get(qq.id)
        if not p:
            unseen += 1
            pq["due"] += 1
            continue
        box = p.box
        if box >= 4:
            mature += 1
            pq["mastered"] += 1
        else:
            young += 1
        # Approx "due" = box 1-2 questions need review soon
        if box <= 2:
            due_now += 1
            pq["due"] += 1

    total = len(all_questions)

    # Summary cards
    summ = ctk.CTkFrame(scroll, fg_color="transparent")
    summ.grid(row=1, column=0, sticky="ew", pady=(0, 12))
    for i in range(4):
        summ.grid_columnconfigure(i, weight=1)
    cards = [
        (due_now, "Jetzt fällig", COLORS["danger"]),
        (young, "In Arbeit", COLORS["warning"]),
        (mature, "Gemeistert", COLORS["success"]),
        (unseen, "Neu", COLORS["text_light"]),
    ]
    for i, (num, label, color) in enumerate(cards):
        c = ctk.CTkFrame(summ, fg_color=color, corner_radius=RADIUS_MD)
        c.grid(row=0, column=i, padx=4, sticky="ew")
        ctk.CTkLabel(c, text=str(num), font=("Segoe UI", 24, "bold"),
                     text_color="#ffffff").grid(row=0, column=0, padx=14, pady=(10, 0))
        ctk.CTkLabel(c, text=label, font=("Segoe UI", 10),
                     text_color="#ffffff").grid(row=1, column=0, padx=14, pady=(0, 10))

    if due_now > 0:
        ctk.CTkButton(scroll, text=f"🚀 {due_now} fällige Karten wiederholen",
                      height=42, corner_radius=RADIUS_MD, fg_color=COLORS["primary"],
                      font=("Segoe UI", 14, "bold"),
                      command=self.show_study_plan
                      ).grid(row=2, column=0, sticky="ew", pady=(0, 12))

    # Per-quiz mastery
    ctk.CTkLabel(scroll, text="📚 Fortschritt pro Quiz", font=("Segoe UI", 15, "bold"),
                 text_color=COLORS["text"]).grid(row=3, column=0, sticky="w", pady=(6, 6))
    row = 4
    entries = sorted(per_quiz.values(), key=lambda x: -x["due"])
    for q in entries:
        pct = round(q["mastered"] / q["total"] * 100) if q["total"] else 0
        color = COLORS["success"] if pct >= 80 else COLORS["warning"] if pct >= 40 else COLORS["danger"]
        card = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_MD,
                            border_width=1, border_color=COLORS["border"])
        card.grid(row=row, column=0, sticky="ew", pady=4)
        card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(card, text=q["name"], font=("Segoe UI", 13, "bold"),
                     text_color=COLORS["text"]).grid(row=0, column=0, sticky="w", padx=14, pady=(8, 0))
        ctk.CTkLabel(card, text=f"{q['due']} fällig" if q["due"] else "✓",
                     font=("Segoe UI", 11), text_color=COLORS["text_light"]
                     ).grid(row=0, column=1, sticky="e", padx=14)
        bar = ctk.CTkProgressBar(card, height=8, progress_color=color)
        bar.set(pct / 100)
        bar.grid(row=1, column=0, columnspan=2, sticky="ew", padx=14, pady=(6, 2))
        ctk.CTkLabel(card, text=f"{pct}% gemeistert ({q['mastered']}/{q['total']})",
                     font=("Segoe UI", 11), text_color=COLORS["text_light"]
                     ).grid(row=2, column=0, sticky="w", padx=14, pady=(0, 8))
        row += 1

    if not entries:
        ctk.CTkLabel(scroll, text="Noch keine Quizze vorhanden.", font=("Segoe UI", 13),
                     text_color=COLORS["text_light"]).grid(row=row, column=0, pady=20)


# =====================================================================
#  ACHIEVEMENTS
# =====================================================================
ACHIEVEMENTS = [
    ("first_quiz", "🎯", "Erster Schritt", "Beantworte deine erste Frage", lambda s: s["answered"] >= 1),
    ("ans_50", "📝", "Fleißig", "50 Fragen beantwortet", lambda s: s["answered"] >= 50),
    ("ans_200", "📚", "Bücherwurm", "200 Fragen beantwortet", lambda s: s["answered"] >= 200),
    ("ans_500", "🏆", "Meisterschüler", "500 Fragen beantwortet", lambda s: s["answered"] >= 500),
    ("ans_1000", "👑", "Legende", "1000 Fragen beantwortet", lambda s: s["answered"] >= 1000),
    ("streak_3", "🔥", "Auf Kurs", "3 Tage Streak", lambda s: s["max_streak"] >= 3),
    ("streak_7", "🔥", "Woche geschafft", "7 Tage Streak", lambda s: s["max_streak"] >= 7),
    ("streak_14", "💪", "Zwei Wochen", "14 Tage Streak", lambda s: s["max_streak"] >= 14),
    ("streak_30", "⚡", "Monats-Streak", "30 Tage Streak", lambda s: s["max_streak"] >= 30),
    ("perfect", "💯", "Perfekt!", "Ein Tag mit 100% (min. 5 Fragen)", lambda s: s["has_perfect"]),
    ("box5_10", "🧠", "Langzeitgedächtnis", "10 Karten in Box 5", lambda s: s["box5"] >= 10),
    ("box5_50", "🎓", "Wissensfestung", "50 Karten in Box 5", lambda s: s["box5"] >= 50),
    ("quizzes_5", "📂", "Sammler", "5 Quizze erstellt/importiert", lambda s: s["quiz_count"] >= 5),
    ("quizzes_20", "🗄️", "Bibliothek", "20 Quizze", lambda s: s["quiz_count"] >= 20),
    ("errors_fixed", "🔧", "Fehlersucher", "10 Einträge im Fehlerbuch", lambda s: s["diary_count"] >= 10),
]


def show_achievements(self):
    self._clear_main()
    self.header_subtitle.configure(text="🏅 Erfolge")
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)
    _back_header(self, scroll, "🏅 Erfolge")

    stats = self.store.load_stats()
    progress = self.store.load_progress()
    saved = self.store.load_achievements()

    days = list(stats.values())
    answered = sum(d.get("answered", 0) for d in days)
    correct = sum(d.get("correct", 0) for d in days)
    has_perfect = any(d.get("answered", 0) >= 5 and d.get("correct") == d.get("answered") for d in days)
    box5 = sum(1 for p in progress.values() if p.box >= 5)
    try:
        _cur, max_streak = self.store.get_streak()
    except Exception:
        max_streak = 0

    ctx = {
        "answered": answered, "correct": correct, "max_streak": max_streak,
        "box5": box5, "has_perfect": has_perfect, "quiz_count": len(self.quizzes),
        "diary_count": len(self.store.load_error_diary()),
    }

    newly = []
    unlocked = {}
    for aid, icon, name, desc, check in ACHIEVEMENTS:
        is_un = bool(check(ctx))
        unlocked[aid] = is_un
        if is_un and not saved.get(aid):
            saved[aid] = datetime.now().isoformat()
            newly.append((icon, name))
    if newly:
        self.store.save_achievements(saved)

    count = sum(1 for a in ACHIEVEMENTS if unlocked[a[0]])
    pct = round(count / len(ACHIEVEMENTS) * 100)

    head = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_MD,
                        border_width=1, border_color=COLORS["border"])
    head.grid(row=1, column=0, sticky="ew", pady=(0, 12))
    head.grid_columnconfigure(0, weight=1)
    ctk.CTkLabel(head, text=f"{count} / {len(ACHIEVEMENTS)}", font=("Segoe UI", 22, "bold"),
                 text_color=COLORS["primary"]).grid(row=0, column=0, pady=(12, 4))
    bar = ctk.CTkProgressBar(head, height=10, progress_color=COLORS["primary"])
    bar.set(pct / 100)
    bar.grid(row=1, column=0, sticky="ew", padx=40, pady=4)
    ctk.CTkLabel(head, text=f"{pct}% freigeschaltet", font=("Segoe UI", 12),
                 text_color=COLORS["text_light"]).grid(row=2, column=0, pady=(0, 12))

    if newly:
        nb = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_MD,
                          border_width=2, border_color=COLORS["warning"])
        nb.grid(row=2, column=0, sticky="ew", pady=(0, 12))
        nb.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(nb, text="🎉 Neu freigeschaltet!", font=("Segoe UI", 14, "bold"),
                     text_color=COLORS["warning"]).grid(row=0, column=0, pady=(10, 4))
        for icon, name in newly:
            ctk.CTkLabel(nb, text=f"{icon} {name}", font=("Segoe UI", 13),
                         text_color=COLORS["text"]).grid(sticky="w", padx=20)
        ctk.CTkLabel(nb, text="", height=4).grid()

    row = 3
    for aid, icon, name, desc, check in ACHIEVEMENTS:
        done = unlocked[aid]
        card = ctk.CTkFrame(scroll, fg_color=COLORS["card"] if done else COLORS["bg"],
                            corner_radius=RADIUS_MD, border_width=1,
                            border_color=COLORS["border"])
        card.grid(row=row, column=0, sticky="ew", pady=3)
        card.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(card, text=icon if done else "🔒", font=("Segoe UI", 24)
                     ).grid(row=0, column=0, rowspan=2, padx=14, pady=8)
        ctk.CTkLabel(card, text=name, font=("Segoe UI", 13, "bold"),
                     text_color=COLORS["text"] if done else COLORS["text_light"]
                     ).grid(row=0, column=1, sticky="w", pady=(8, 0))
        ctk.CTkLabel(card, text=desc, font=("Segoe UI", 11),
                     text_color=COLORS["text_light"]).grid(row=1, column=1, sticky="w", pady=(0, 8))
        row += 1
