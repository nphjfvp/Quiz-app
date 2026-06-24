"""Mini-Games for the Desktop app: Tower Defense & Quiz Battle.

These methods are mixed into the App class via import in app.py.
They use tkinter Canvas for rendering game graphics.
"""

import random
import math
import time
from tkinter import StringVar
import tkinter as tk
import customtkinter as ctk

from .models import QuestionType
from .theme import COLORS, RADIUS_SM, RADIUS_MD, RADIUS_LG, animate_color
from .i18n import t
from .latex_render import has_latex, latex_to_plain, autowrap_latex


def _display_text(s):
    """Make text with LaTeX readable in the game labels (plain-text math)."""
    s = s or ""
    return latex_to_plain(autowrap_latex(s)) if has_latex(s) else s


def _build_playable(questions):
    """Convert Question model objects into simple dicts for the game engine."""
    out = []
    for q in questions:
        if q.question_type == QuestionType.SINGLE_CHOICE:
            opts = [{"text": o.text, "correct": o.is_correct} for o in q.options]
            if not opts or not any(o["correct"] for o in opts):
                continue
            correct = [o for o in opts if o["correct"]]
            out.append({
                "prompt": q.text or q.title, "kind": "choice", "options": opts,
                "answer": correct[0]["text"] if correct else "",
                "explanation": q.explanation, "diff": _get_diff(q),
            })
        elif q.question_type == QuestionType.MULTIPLE_CHOICE:
            opts = [{"text": o.text, "correct": o.is_correct} for o in q.options]
            if not opts or not any(o["correct"] for o in opts):
                continue
            correct = [o["text"] for o in opts if o["correct"]]
            out.append({
                "prompt": q.text or q.title, "kind": "multi", "options": opts,
                "answer": ", ".join(correct),
                "explanation": q.explanation, "diff": _get_diff(q),
            })
        elif q.question_type == QuestionType.FILL_BLANK:
            blanks = [b.strip() for b in (q.blanks or []) if b.strip()]
            if not blanks:
                continue
            if len(blanks) > 1:
                # One input field per blank — checked positionally.
                out.append({
                    "prompt": q.text or q.title, "kind": "multi_text", "options": [],
                    "blanks": blanks, "accept": blanks, "answer": ", ".join(blanks),
                    "explanation": q.explanation, "diff": _get_diff(q),
                })
            else:
                out.append({
                    "prompt": q.text or q.title, "kind": "text", "options": [],
                    "accept": blanks, "answer": blanks[0],
                    "explanation": q.explanation, "diff": _get_diff(q),
                })
        elif q.question_type in (QuestionType.FREE_TEXT, QuestionType.MATH_FORMULA):
            accept = []
            if q.question_type == QuestionType.FREE_TEXT:
                accept = [a.strip() for a in (q.correct_text or "").replace(";", "|").split("|") if a.strip()]
            elif q.question_type == QuestionType.MATH_FORMULA:
                accept = [q.correct_formula.strip()] if q.correct_formula else []
            if not accept:
                continue
            out.append({
                "prompt": q.text or q.title, "kind": "text", "options": [],
                "accept": accept, "answer": accept[0],
                "explanation": q.explanation, "diff": _get_diff(q),
                "is_free_text": q.question_type == QuestionType.FREE_TEXT,
            })
    return out


def _game_sources(self):
    """Build selectable play sources for the games: each quiz and each folder.

    Returns a list of (label, questions) tuples. Folders combine the questions
    of all contained quizzes so a whole exam can be played at once.
    """
    sources = []
    for q in self.quizzes:
        sources.append((f"📄 {q.name or 'Quiz'} ({len(q.questions)})", list(q.questions)))
    folders = getattr(self, "folders", None) or []
    by_id = {q.id: q for q in self.quizzes}
    for f in folders:
        combined = []
        for qid in f.quiz_ids:
            qz = by_id.get(qid)
            if qz:
                combined.extend(qz.questions)
        if combined:
            sources.append((f"📁 {f.name or 'Ordner'} ({len(combined)} Fragen)", combined))
    return sources


def _get_diff(q):
    w = getattr(q, "weight", 1.0)
    if w <= 1.0:
        return 1
    if w <= 2.0:
        return 2
    return 3


def _strip_latex(s):
    import re
    s = (s or "").strip().lower()
    s = re.sub(r"\$\$(.+?)\$\$", r"\1", s)
    s = re.sub(r"\$(.+?)\$", r"\1", s)
    s = re.sub(r"\\frac\{([^}]*)\}\{([^}]*)\}", r"(\1)/(\2)", s)
    s = re.sub(r"\\(?:text|mathrm|mathbf)\{([^}]*)\}", r"\1", s)
    s = re.sub(r"[\\{}^_]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _edit_distance(a, b):
    """Levenshtein edit distance."""
    m, n = len(a), len(b)
    if not m:
        return n
    if not n:
        return m
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        for j in range(1, n + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[n]


def _typo_tolerance(length):
    """How many typos to tolerate for a target of given length."""
    if length <= 3:
        return 0
    if length <= 6:
        return 1
    if length <= 12:
        return 2
    return 3


def _fuzzy_equal(a, b):
    if a == b:
        return True
    tol = _typo_tolerance(max(len(a), len(b)))
    if tol == 0:
        return False
    if abs(len(a) - len(b)) > tol:
        return False
    return _edit_distance(a, b) <= tol


def _check_text(accept, value):
    v = value.strip().lower()
    if not v:
        return False
    vs = _strip_latex(value)
    for a in accept:
        al = a.strip().lower()
        if v == al:
            return True
        if vs and _strip_latex(a) == vs:
            return True
        # Substring match for longer answers
        if len(al) > 3 and al in v:
            return True
        if len(v) > 3 and v in al:
            return True
        # Tolerate minor spelling mistakes (typos)
        if _fuzzy_equal(al, v) or (vs and _fuzzy_equal(_strip_latex(a), vs)):
            return True
    return False


def _check_multi_text(blanks, values):
    """All blanks must be answered correctly, positionally."""
    if len(values) != len(blanks):
        return False
    return all(_check_text([b], v) for b, v in zip(blanks, values))


# ─── Colors for arena drawing ────────────────────────────────────────────
ARENA_WALL = "#6b5d4f"
ARENA_FLOOR = "#cdb288"
ARENA_FLOOR2 = "#c2a679"
ARENA_DARK_WALL = "#2b2620"
ARENA_DARK_FLOOR = "#3a3024"
ARENA_DARK_FLOOR2 = "#332b20"

CROWD_COLORS = ["#e2725b", "#5b8def", "#46b46e", "#e0b341", "#b06fd4", "#d96fa3", "#dcdcdc"]
DIFF_LABEL = {1: "Leicht", 2: "Mittel", 3: "Schwer"}
DIFF_COLOR = {1: "#22c55e", 2: "#f59e0b", 3: "#ef4444"}


# =====================================================================
#  GAMES HUB
# =====================================================================
def show_games(self):
    """Show the mini-games selection screen."""
    self._clear_main()
    self.header_subtitle.configure(text="🎮 Mini-Games")
    scroll = self._make_screen()

    top = ctk.CTkFrame(scroll, fg_color="transparent")
    top.grid(row=0, column=0, sticky="ew", pady=(0, 16))
    top.grid_columnconfigure(1, weight=1)
    ctk.CTkButton(top, text="← Zurück", width=80, height=32,
                  corner_radius=RADIUS_MD, fg_color=COLORS["card"],
                  text_color=COLORS["text"], hover_color=COLORS.get("card_hover", "#eef7f2"),
                  border_width=1, border_color=COLORS["border"],
                  font=("Segoe UI", 12), command=self.show_home
                  ).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(top, text="🎮 Mini-Games",
                 font=("Segoe UI", 20, "bold"), text_color=COLORS["text"]
                 ).grid(row=0, column=1, sticky="w")

    ctk.CTkLabel(scroll, text="Lerne spielerisch — beantworte Fragen und kämpfe!",
                 font=("Segoe UI", 13), text_color=COLORS["text_light"]
                 ).grid(row=1, column=0, sticky="w", pady=(0, 16))

    grid = ctk.CTkFrame(scroll, fg_color="transparent")
    grid.grid(row=2, column=0, sticky="ew")
    grid.grid_columnconfigure(0, weight=1)
    grid.grid_columnconfigure(1, weight=1)

    _game_card(self, grid, 0, 0, "🏰", "Tower Defense",
               "Verteidige deine Basis gegen Wellen von Gegnern!",
               COLORS["primary"], self.show_tower_defense)
    _game_card(self, grid, 1, 0, "⚔️", "Quiz Battle",
               "Beantworte Fragen und sende Krieger ins Feld!",
               COLORS["danger"], self.show_quiz_battle)
    _game_card(self, grid, 0, 1, "⚡", "Speed-Quiz",
               "60 Sekunden, Combo-Multiplikator — wie viele schaffst du?",
               COLORS["warning"], self.show_speed_quiz)
    _game_card(self, grid, 1, 1, "💰", "Wer wird Millionär",
               "15 Fragen, 3 Joker, sichere Stufen.",
               COLORS["success"], self.show_millionaire)
    _game_card(self, grid, 0, 2, "💀", "Galgenmännchen",
               "Errate den Begriff Buchstabe für Buchstabe!",
               COLORS["info"], self.show_hangman)
    _game_card(self, grid, 1, 2, "👹", "Boss-Kampf",
               "Besiege deine schwächsten Fragen im Kampf!",
               COLORS["danger"], self.show_boss_fight)


def _game_card(self, parent, col, row, icon, title, desc, color, command):
    card = ctk.CTkFrame(parent, fg_color=COLORS["card"], corner_radius=RADIUS_LG,
                        border_width=2, border_color=COLORS.get("border", "#e3ece6"),
                        cursor="hand2")
    card.grid(row=row, column=col, padx=8, pady=8, sticky="nsew")
    card.grid_columnconfigure(0, weight=1)

    accent = ctk.CTkFrame(card, fg_color=color, corner_radius=4, height=4)
    accent.grid(row=0, column=0, sticky="ew", padx=16, pady=(14, 0))

    card.bind("<Enter>", lambda e: animate_color(card, "border_color",
              COLORS.get("border", "#e3ece6"), color, 150, 6))
    card.bind("<Leave>", lambda e: animate_color(card, "border_color",
              color, COLORS.get("border", "#e3ece6"), 150, 6))
    card.bind("<Button-1>", lambda e: command())

    ctk.CTkLabel(card, text=icon, font=("Segoe UI", 40)
                 ).grid(row=1, column=0, padx=15, pady=(14, 4))
    lbl = ctk.CTkLabel(card, text=title, font=("Segoe UI", 17, "bold"),
                       text_color=COLORS["text"])
    lbl.grid(row=2, column=0, padx=15, pady=(2, 2))
    lbl.bind("<Button-1>", lambda e: command())
    dl = ctk.CTkLabel(card, text=desc, font=("Segoe UI", 12),
                      text_color=COLORS["text_light"], wraplength=220)
    dl.grid(row=3, column=0, padx=15, pady=(0, 18))
    dl.bind("<Button-1>", lambda e: command())


# =====================================================================
#  TOWER DEFENSE
# =====================================================================
CW_TD, CH_TD = 600, 500
TILE = 40
COLS_TD = CW_TD // TILE
ROWS_TD = CH_TD // TILE


def _build_td_path():
    p = []
    row, col, d = 0, 0, 1
    while row < CH_TD // TILE:
        p.append((col, row))
        if (d == 1 and col >= COLS_TD - 1) or (d == -1 and col <= 0):
            row += 1
            if row < ROWS_TD:
                p.append((col, row))
            d *= -1
        else:
            col += d
    return p


TD_PATH = _build_td_path()

TD_DIFF = {
    "easy":   {"speed": 0.22, "spawn": 5500, "hp": 5, "hpS": 1.3, "baseHP": 20, "tDmg": 0.5, "tRate": 900, "waves": 12},
    "normal": {"speed": 0.35, "spawn": 4200, "hp": 6, "hpS": 1.7, "baseHP": 15, "tDmg": 0.5, "tRate": 1000, "waves": 16},
    "hard":   {"speed": 0.48, "spawn": 3200, "hp": 8, "hpS": 2.2, "baseHP": 10, "tDmg": 0.4, "tRate": 1100, "waves": 20},
}

BLOON_COLORS = ["#e11d48", "#3b82f6", "#22c55e", "#eab308", "#ec4899", "#1e293b"]


def show_tower_defense(self):
    """Tower Defense setup screen."""
    self._clear_main()
    self.header_subtitle.configure(text="🏰 Tower Defense")
    scroll = self._make_screen()

    top = ctk.CTkFrame(scroll, fg_color="transparent")
    top.grid(row=0, column=0, sticky="ew", pady=(0, 12))
    top.grid_columnconfigure(1, weight=1)
    ctk.CTkButton(top, text="← Zurück", width=80, height=32,
                  corner_radius=RADIUS_MD, fg_color=COLORS["card"],
                  text_color=COLORS["text"], hover_color=COLORS.get("card_hover", "#eef7f2"),
                  border_width=1, border_color=COLORS["border"],
                  font=("Segoe UI", 12), command=self.show_games
                  ).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(top, text="🏰 Tower Defense",
                 font=("Segoe UI", 20, "bold"), text_color=COLORS["text"]
                 ).grid(row=0, column=1, sticky="w")

    ctk.CTkLabel(scroll, text="Verteidige deine Basis! Beantworte Fragen, um Gegner zu beschädigen.",
                 font=("Segoe UI", 13), text_color=COLORS["text_light"]
                 ).grid(row=1, column=0, sticky="w", pady=(0, 14))

    # Quiz / folder select
    quiz_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    quiz_frame.grid(row=2, column=0, sticky="ew", pady=(0, 10))
    ctk.CTkLabel(quiz_frame, text="Quiz/Ordner wählen:", font=("Segoe UI", 13)
                 ).grid(row=0, column=0, padx=(0, 10), sticky="w")
    sources = _game_sources(self)
    quiz_names = [label for label, _ in sources]
    quiz_var = StringVar(value=quiz_names[0] if quiz_names else "")
    quiz_dd = ctk.CTkOptionMenu(quiz_frame, values=quiz_names, variable=quiz_var, width=320)
    quiz_dd.grid(row=0, column=1, sticky="w")

    # Difficulty
    diff_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    diff_frame.grid(row=3, column=0, sticky="ew", pady=(0, 10))
    ctk.CTkLabel(diff_frame, text="Schwierigkeit:", font=("Segoe UI", 13)
                 ).grid(row=0, column=0, padx=(0, 10), sticky="w")
    diff_var = StringVar(value="easy")
    for i, (key, label) in enumerate([("easy", "Leicht"), ("normal", "Normal"), ("hard", "Schwer")]):
        ctk.CTkRadioButton(diff_frame, text=label, variable=diff_var, value=key,
                           font=("Segoe UI", 12)).grid(row=0, column=i + 1, padx=8)

    def start():
        from tkinter import messagebox
        if not sources:
            messagebox.showinfo("Hinweis", "Es sind noch keine Quizze vorhanden. Erstelle zuerst ein Quiz.")
            return
        idx = quiz_names.index(quiz_var.get()) if quiz_var.get() in quiz_names else 0
        questions = _build_playable(sources[idx][1])
        if not questions:
            messagebox.showinfo("Hinweis", "Diese Auswahl hat keine für Spiele geeigneten Fragen.")
            return
        _run_td(self, questions, diff_var.get())

    ctk.CTkButton(scroll, text="⚔️ Spiel starten", width=200, height=42,
                  corner_radius=RADIUS_MD, fg_color=COLORS["primary"],
                  font=("Segoe UI", 15, "bold"), command=start
                  ).grid(row=4, column=0, pady=16)


def _run_td(self, questions, difficulty):
    """Run the Tower Defense game inside the main frame."""
    self._clear_main()
    cfg = TD_DIFF[difficulty]
    random.shuffle(questions)

    state = {
        "enemies": [], "towers": [], "projectiles": [], "particles": [], "floaters": [],
        "baseHP": cfg["baseHP"], "maxHP": cfg["baseHP"],
        "score": 0, "coins": 0, "wave": 0, "kills": 0, "qIdx": 0,
        "gameOver": False, "won": False, "answering": False,
        "lastSpawn": time.time() * 1000 - cfg["spawn"], "cfg": cfg, "questions": questions,
        "combo": 0, "goalWaves": cfg["waves"], "log": [],
        "tick": 0,
    }

    # Place initial towers
    initial_towers = [(2, 1), (COLS_TD - 3, 3), (2, 5)]
    for tc, tr in initial_towers:
        if not any(c == tc and r == tr for c, r in TD_PATH):
            state["towers"].append({
                "col": tc, "row": tr,
                "x": tc * TILE + TILE // 2, "y": tr * TILE + TILE // 2,
                "range": TILE * 2.5, "cd": 0, "rate": cfg["tRate"], "dmg": cfg["tDmg"],
                "color": "#1cb487", "aim": -math.pi / 2,
            })

    # Layout: canvas left, question panel right
    wrap = ctk.CTkFrame(self.main_frame, fg_color=COLORS["bg"])
    wrap.grid(row=0, column=0, sticky="nsew")
    self.main_frame.grid_rowconfigure(0, weight=1)
    self.main_frame.grid_columnconfigure(0, weight=1)
    wrap.grid_columnconfigure(0, weight=0)
    wrap.grid_columnconfigure(1, weight=1)
    wrap.grid_rowconfigure(1, weight=1)

    # HUD
    hud = ctk.CTkFrame(wrap, fg_color=COLORS["card"], corner_radius=10, height=40)
    hud.grid(row=0, column=0, columnspan=2, sticky="ew", padx=10, pady=(10, 4))
    hud_labels = {}
    for i, (icon, key, init) in enumerate([
        ("❤️", "hp", str(state["baseHP"])), ("🪙", "coins", "0"),
        ("💀", "kills", "0"), ("🌊", "wave", f"0/{cfg['waves']}"),
        ("⭐", "score", "0"),
    ]):
        ctk.CTkLabel(hud, text=icon, font=("Segoe UI", 14)).grid(row=0, column=i * 2, padx=(12 if i == 0 else 6, 2), pady=6)
        lbl = ctk.CTkLabel(hud, text=init, font=("Segoe UI", 13, "bold"), text_color=COLORS["text"])
        lbl.grid(row=0, column=i * 2 + 1, padx=(0, 8), pady=6)
        hud_labels[key] = lbl

    # Canvas
    canvas = tk.Canvas(wrap, width=CW_TD, height=CH_TD, bg="#6b5d4f", highlightthickness=0)
    canvas.grid(row=1, column=0, padx=(10, 4), pady=(4, 10), sticky="n")

    # Question panel
    q_panel = ctk.CTkFrame(wrap, fg_color=COLORS["card"], corner_radius=12)
    q_panel.grid(row=1, column=1, padx=(4, 10), pady=(4, 10), sticky="nsew")
    q_panel.grid_columnconfigure(0, weight=1)

    q_diff_lbl = ctk.CTkLabel(q_panel, text="", font=("Segoe UI", 12, "bold"), corner_radius=6)
    q_diff_lbl.grid(row=0, column=0, padx=12, pady=(12, 4), sticky="w")
    q_reward_lbl = ctk.CTkLabel(q_panel, text="", font=("Segoe UI", 11), text_color=COLORS["text_light"])
    q_reward_lbl.grid(row=0, column=1, padx=12, pady=(12, 4), sticky="e")
    q_text_lbl = ctk.CTkLabel(q_panel, text="Warte auf Gegner...", font=("Segoe UI", 14, "bold"),
                               text_color=COLORS["text"], wraplength=350, justify="left")
    q_text_lbl.grid(row=1, column=0, columnspan=2, padx=14, pady=(6, 10), sticky="w")

    opts_frame = ctk.CTkFrame(q_panel, fg_color="transparent")
    opts_frame.grid(row=2, column=0, columnspan=2, padx=10, pady=(0, 10), sticky="ew")
    opts_frame.grid_columnconfigure(0, weight=1)
    opts_frame.grid_columnconfigure(1, weight=1)

    combo_lbl = ctk.CTkLabel(q_panel, text="", font=("Segoe UI", 14, "bold"),
                              text_color=COLORS["warning"])
    combo_lbl.grid(row=3, column=0, columnspan=2, padx=12, pady=(0, 8))

    ui = {
        "canvas": canvas, "hud": hud_labels, "q_diff": q_diff_lbl,
        "q_reward": q_reward_lbl, "q_text": q_text_lbl, "opts": opts_frame,
        "combo": combo_lbl, "wrap": wrap, "q_panel": q_panel,
    }

    def _show_q():
        if state["gameOver"]:
            return
        if state["qIdx"] >= len(state["questions"]):
            state["qIdx"] = 0
            random.shuffle(state["questions"])
        q = state["questions"][state["qIdx"]]
        state["qIdx"] += 1
        state["answering"] = True
        state["currentQ"] = q

        diff = q.get("diff", 1)
        q_diff_lbl.configure(text=DIFF_LABEL[diff], fg_color=DIFF_COLOR[diff], text_color="#0d1117")
        q_reward_lbl.configure(text=f"💥 {3 * diff} Schaden · 🪙 {2 * diff}")
        q_text_lbl.configure(text=_display_text(q["prompt"]))

        for w in opts_frame.winfo_children():
            w.destroy()

        def answer(ok, user_ans=""):
            if state["gameOver"] or not state["answering"]:
                return
            state["answering"] = False
            state["log"].append({"q": q, "correct": ok, "userAnswer": user_ans})
            _handle_answer(state, ok, diff, ui)
            if not state["gameOver"]:
                canvas.after(800, lambda: _show_q() if not state["gameOver"] and any(e["hp"] > 0 for e in state["enemies"]) else None)

        if q["kind"] == "choice":
            shuffled = q["options"][:]
            random.shuffle(shuffled)
            for i, o in enumerate(shuffled):
                btn = ctk.CTkButton(opts_frame, text=_display_text(o["text"]), height=38,
                                    corner_radius=RADIUS_SM, fg_color=COLORS["card"],
                                    text_color=COLORS["text"], border_width=1,
                                    border_color=COLORS["border"],
                                    hover_color=COLORS.get("card_hover", "#eef7f2"),
                                    font=("Segoe UI", 12),
                                    command=lambda ok=o["correct"], t=o["text"]: answer(ok, t))
                btn.grid(row=i // 2, column=i % 2, padx=4, pady=4, sticky="ew")
        elif q["kind"] == "multi":
            shuffled = q["options"][:]
            random.shuffle(shuffled)
            selected = set()
            btns = []
            for i, o in enumerate(shuffled):
                b = ctk.CTkButton(opts_frame, text=_display_text(o["text"]), height=34,
                                  corner_radius=RADIUS_SM, fg_color=COLORS["card"],
                                  text_color=COLORS["text"], border_width=1,
                                  border_color=COLORS["border"], font=("Segoe UI", 11))
                b.grid(row=i // 2, column=i % 2, padx=3, pady=3, sticky="ew")
                btns.append(b)
                def toggle(idx=i, btn=b):
                    if idx in selected:
                        selected.discard(idx)
                        btn.configure(fg_color=COLORS["card"], text_color=COLORS["text"])
                    else:
                        selected.add(idx)
                        btn.configure(fg_color=COLORS["primary"], text_color=COLORS.get("on_primary", "#ffffff"))
                b.configure(command=toggle)
            confirm = ctk.CTkButton(opts_frame, text="✓ Bestätigen", height=36,
                                    corner_radius=RADIUS_SM, fg_color=COLORS["success"],
                                    font=("Segoe UI", 12, "bold"))
            confirm.grid(row=(len(shuffled) + 1) // 2, column=0, columnspan=2, padx=4, pady=6, sticky="ew")
            def check_multi():
                chosen = [shuffled[i] for i in selected]
                ok = set(i for i, o in enumerate(shuffled) if o["correct"]) == selected
                answer(ok, ", ".join(o["text"] for o in chosen))
            confirm.configure(command=check_multi)
        elif q["kind"] == "multi_text":
            blanks = q["blanks"]
            entries = []
            for i, _b in enumerate(blanks):
                row = ctk.CTkFrame(opts_frame, fg_color="transparent")
                row.grid(row=i, column=0, columnspan=2, padx=4, pady=3, sticky="ew")
                row.grid_columnconfigure(1, weight=1)
                ctk.CTkLabel(row, text=f"Lücke {i+1}:", font=("Segoe UI", 11),
                             text_color=COLORS["text_light"], width=60
                             ).grid(row=0, column=0, padx=(0, 6))
                e = ctk.CTkEntry(row, placeholder_text=f"Lücke {i+1}…",
                                 font=("Segoe UI", 13), height=34)
                e.grid(row=0, column=1, sticky="ew")
                entries.append(e)
            def submit_blanks(_=None):
                vals = [e.get() for e in entries]
                answer(_check_multi_text(blanks, vals), ", ".join(vals))
            btn = ctk.CTkButton(opts_frame, text="✓ Bestätigen", height=36,
                                corner_radius=RADIUS_SM, fg_color=COLORS["primary"],
                                font=("Segoe UI", 12, "bold"), command=submit_blanks)
            btn.grid(row=len(blanks), column=0, columnspan=2, padx=4, pady=6, sticky="ew")
            entries[-1].bind("<Return>", submit_blanks)
            entries[0].focus_set()
        else:
            inp = ctk.CTkEntry(opts_frame, placeholder_text="Antwort eingeben…",
                               font=("Segoe UI", 13), height=38)
            inp.grid(row=0, column=0, padx=4, pady=4, sticky="ew")
            def submit(_=None):
                val = inp.get()
                ok = _check_text(q.get("accept", []), val)
                answer(ok, val)
            btn = ctk.CTkButton(opts_frame, text="✓", width=50, height=38,
                                corner_radius=RADIUS_SM, fg_color=COLORS["primary"],
                                font=("Segoe UI", 14, "bold"), command=submit)
            btn.grid(row=0, column=1, padx=4, pady=4)
            inp.bind("<Return>", submit)
            inp.focus_set()

    def _handle_answer(st, correct, diff, ui):
        if correct:
            st["combo"] += 1
            mult = 1 + min(st["combo"] - 1, 4) * 0.25
            dmg = 3 * diff * mult
            earned = round(2 * diff * mult)
            st["coins"] += earned
            st["score"] += round(10 * diff * mult)
            if st["combo"] >= 2:
                combo_lbl.configure(text=f"🔥 Combo x{st['combo']}")
            lead = sorted([e for e in st["enemies"] if e["hp"] > 0], key=lambda e: -e["progress"])
            if lead:
                e = lead[0]
                e["hp"] -= dmg
                e["hit"] = 8
                _add_floater(st, e["x"], e["y"] - 18, f"-{round(dmg)}", "#22d3ee")
                _burst(st, e["x"], e["y"], "#22d3ee", 8)
        else:
            st["combo"] = 0
            combo_lbl.configure(text="")
            st["baseHP"] -= 1
            lp = TD_PATH[-1]
            _burst(st, lp[0] * TILE + TILE // 2, lp[1] * TILE + TILE // 2, "#ef4444", 6)

    def _update(st, dt_ms):
        cfg = st["cfg"]
        now_ms = time.time() * 1000
        # Spawn
        if not st["answering"] and st["wave"] < st["goalWaves"] and now_ms - st["lastSpawn"] > cfg["spawn"]:
            st["lastSpawn"] = now_ms
            st["wave"] += 1
            hp = round(cfg["hp"] + st["wave"] * cfg["hpS"])
            st["enemies"].append({
                "progress": 0, "hp": hp, "maxHp": hp,
                "speed": cfg["speed"] + random.random() * 0.06,
                "x": TD_PATH[0][0] * TILE + TILE // 2,
                "y": TD_PATH[0][1] * TILE + TILE // 2,
                "hit": 0, "wob": random.random() * 6.28,
            })
            if not st["answering"]:
                _show_q()

        # Move enemies
        for e in st["enemies"]:
            if e["hp"] <= 0:
                continue
            e["progress"] += e["speed"] * (dt_ms / 1000) * 2
            e["wob"] += dt_ms / 200
            idx = int(e["progress"])
            if idx >= len(TD_PATH) - 1:
                leak = 1 + e["maxHp"] // 12
                e["hp"] = 0
                st["baseHP"] -= leak
                lp = TD_PATH[-1]
                _add_floater(st, lp[0] * TILE + TILE // 2, lp[1] * TILE + TILE // 2 - 16, f"-{leak} ❤️", "#ef4444")
                _burst(st, lp[0] * TILE + TILE // 2, lp[1] * TILE + TILE // 2, "#ef4444", 8)
                continue
            frac = e["progress"] - idx
            a = TD_PATH[idx]
            b = TD_PATH[min(idx + 1, len(TD_PATH) - 1)]
            e["x"] = a[0] * TILE + TILE // 2 + (b[0] - a[0]) * TILE * frac
            e["y"] = a[1] * TILE + TILE // 2 + (b[1] - a[1]) * TILE * frac
            if e["hit"] > 0:
                e["hit"] -= 1

        # Remove dead
        alive = []
        for e in st["enemies"]:
            if e["hp"] <= 0:
                if e.get("progress", 999) < len(TD_PATH) - 1:
                    st["kills"] += 1
                    st["score"] += 5
                    st["coins"] += 1
                    _burst(st, e["x"], e["y"], "#f59e0b", 6)
            else:
                alive.append(e)
        st["enemies"] = alive

        # Tower shooting
        for t in st["towers"]:
            t["cd"] = max(0, t["cd"] - dt_ms)
            if t["cd"] > 0:
                continue
            targets = [e for e in st["enemies"] if e["hp"] > 0 and
                       math.hypot(e["x"] - t["x"], e["y"] - t["y"]) <= t["range"]]
            if targets:
                tgt = max(targets, key=lambda e: e["progress"])
                t["cd"] = t["rate"]
                t["aim"] = math.atan2(tgt["y"] - t["y"], tgt["x"] - t["x"])
                ang = math.atan2(tgt["y"] - t["y"], tgt["x"] - t["x"])
                st["projectiles"].append({"x": t["x"], "y": t["y"], "target": tgt, "dmg": t["dmg"], "angle": ang})

        # Move projectiles
        new_proj = []
        for p in st["projectiles"]:
            tgt = p["target"]
            if not tgt or tgt["hp"] <= 0:
                continue
            p["angle"] = math.atan2(tgt["y"] - p["y"], tgt["x"] - p["x"])
            p["x"] += (tgt["x"] - p["x"]) * 0.25
            p["y"] += (tgt["y"] - p["y"]) * 0.25
            if math.hypot(p["x"] - tgt["x"], p["y"] - tgt["y"]) < 8:
                tgt["hp"] -= p["dmg"]
                tgt["hit"] = 6
                _burst(st, p["x"], p["y"], "#fde047", 4)
            else:
                new_proj.append(p)
        st["projectiles"] = new_proj

        # Particles & floaters
        st["particles"] = [p for p in st["particles"] if _tick_particle(p)]
        st["floaters"] = [f for f in st["floaters"] if _tick_floater(f)]

    def _draw(canvas, st):
        canvas.delete("all")
        dark = COLORS.get("bg", "#f5fbf6") != "#f5fbf6"
        w, h = CW_TD, CH_TD
        st["tick"] += 1
        tick = st["tick"]

        # Arena wall
        canvas.create_rectangle(0, 0, w, h, fill=ARENA_DARK_WALL if dark else ARENA_WALL, outline="")

        # Spectators
        ci = 0
        for x in range(5, w - 3, 9):
            for dy in [5, 10]:
                bob = int(math.sin(tick / 15 + ci) * 1.5)
                canvas.create_oval(x - 2, dy + bob - 2, x + 2, dy + bob + 2,
                                   fill=CROWD_COLORS[ci % len(CROWD_COLORS)], outline="")
                ci += 1
        for x in range(5, w - 3, 9):
            for dy in [h - 10, h - 5]:
                bob = int(math.sin(tick / 15 + ci) * 1.5)
                canvas.create_oval(x - 2, dy + bob - 2, x + 2, dy + bob + 2,
                                   fill=CROWD_COLORS[ci % len(CROWD_COLORS)], outline="")
                ci += 1
        for y in range(16, h - 14, 9):
            for dx in [4, w - 4]:
                bob = int(math.sin(tick / 15 + ci) * 1.5)
                canvas.create_oval(dx - 2, y + bob - 2, dx + 2, y + bob + 2,
                                   fill=CROWD_COLORS[ci % len(CROWD_COLORS)], outline="")
                ci += 1

        # Sand floor
        pad = 12
        floor = ARENA_DARK_FLOOR if dark else ARENA_FLOOR
        floor2 = ARENA_DARK_FLOOR2 if dark else ARENA_FLOOR2
        canvas.create_rectangle(pad, pad, w - pad, h - pad, fill=floor, outline="")
        for r in range(0, h // 30 + 1):
            for c in range(0, w // 30 + 1):
                if (r + c) % 2 == 0:
                    canvas.create_rectangle(c * 30, r * 30, c * 30 + 30, r * 30 + 30,
                                            fill=floor2, outline="", stipple="")

        # Path
        pts = [(c * TILE + TILE // 2, r * TILE + TILE // 2) for c, r in TD_PATH]
        if len(pts) > 1:
            road_col = "#4a3a26" if dark else "#d9b888"
            edge_col = "#1a120b" if dark else "#7a5a34"
            flat = [coord for p in pts for coord in p]
            canvas.create_line(*flat, fill=edge_col, width=TILE * 0.82, joinstyle="round", capstyle="round")
            canvas.create_line(*flat, fill=road_col, width=TILE * 0.62, joinstyle="round", capstyle="round")

        # Fortress at the end
        lx, ly = pts[-1]
        hp_pct = max(0, st["baseHP"] / st["maxHP"])
        keep_c = "#3b82f6" if hp_pct > 0.5 else "#d97706" if hp_pct > 0.25 else "#dc2626"
        canvas.create_rectangle(lx - 20, ly - 14, lx + 20, ly + 14, fill=keep_c, outline="#1e293b", width=1)
        for i in range(4):
            bx = lx - 18 + i * 10
            canvas.create_rectangle(bx, ly - 20, bx + 6, ly - 14, fill="#64748b", outline="")
        canvas.create_rectangle(lx - 5, ly - 2, lx + 5, ly + 14, fill="#1e293b", outline="")
        sway = math.sin(tick / 20) * 3
        canvas.create_polygon(lx, ly - 20, lx + 10 + sway, ly - 24,
                              lx + 10 + sway, ly - 16, lx, ly - 14,
                              fill="#0d9488" if hp_pct > 0.25 else "#ef4444", outline="")

        # Towers
        for t in st["towers"]:
            canvas.create_oval(t["x"] - 14, t["y"] - 2, t["x"] + 14, t["y"] + 10,
                               fill="rgba(0,0,0,0.15)" if dark else "#ccc", outline="")
            canvas.create_oval(t["x"] - 14, t["y"] - 14, t["x"] + 14, t["y"] + 14,
                               fill="#3a4452" if dark else "#9aa6b4", outline="")
            canvas.create_oval(t["x"] - 9, t["y"] - 9, t["x"] + 9, t["y"] + 9,
                               fill=t["color"], outline="")
            aim = t.get("aim", -math.pi / 2)
            bx = t["x"] + math.cos(aim) * 16
            by = t["y"] + math.sin(aim) * 16
            canvas.create_line(t["x"], t["y"], bx, by, fill="#4b5563", width=4, capstyle="round")

        # Enemies
        for e in st["enemies"]:
            if e["hp"] <= 0:
                continue
            frac = e["hp"] / e["maxHp"]
            tier = min(len(BLOON_COLORS) - 1, int((1 - frac) * len(BLOON_COLORS)))
            color = "#ffffff" if e["hit"] > 0 else BLOON_COLORS[tier]
            r = 12 + (3 if e["maxHp"] > 20 else 0)
            wob = math.sin(e["wob"]) * 1.5
            ex, ey = e["x"] + wob, e["y"]
            canvas.create_oval(ex - r * 0.85, ey - r, ex + r * 0.85, ey + r, fill=color, outline="")
            # highlight
            canvas.create_oval(ex - r * 0.5, ey - r * 0.6, ex - r * 0.1, ey - r * 0.1,
                               fill="#ffffff", outline="", stipple="gray50")
            # HP bar
            bw = 22
            canvas.create_rectangle(ex - bw // 2, ey - r - 8, ex + bw // 2, ey - r - 4,
                                    fill="#333", outline="")
            hpc = "#22c55e" if frac > 0.5 else "#f59e0b" if frac > 0.25 else "#ef4444"
            canvas.create_rectangle(ex - bw // 2, ey - r - 8, ex - bw // 2 + bw * frac, ey - r - 4,
                                    fill=hpc, outline="")

        # Projectiles (arrows)
        for p in st["projectiles"]:
            a = p.get("angle", 0)
            cx, cy = p["x"], p["y"]
            ca, sa = math.cos(a), math.sin(a)
            # shaft
            x1, y1 = cx - 10 * ca, cy - 10 * sa
            x2, y2 = cx + 6 * ca, cy + 6 * sa
            canvas.create_line(x1, y1, x2, y2, fill="#92400e", width=2)
            # arrowhead
            tx, ty = cx + 10 * ca, cy + 10 * sa
            lx, ly = cx + 4 * ca - 4 * sa, cy + 4 * sa + 4 * ca
            rx, ry = cx + 4 * ca + 4 * sa, cy + 4 * sa - 4 * ca
            canvas.create_polygon(tx, ty, lx, ly, rx, ry, fill="#fde047", outline="#a16207")
            # fletching
            fx, fy = cx - 10 * ca, cy - 10 * sa
            fl1x, fl1y = cx - 7 * ca - 3 * sa, cy - 7 * sa + 3 * ca
            fl2x, fl2y = cx - 6 * ca, cy - 6 * sa
            canvas.create_polygon(fx, fy, fl1x, fl1y, fl2x, fl2y, fill="#ef4444", outline="")
            fr1x, fr1y = cx - 7 * ca + 3 * sa, cy - 7 * sa - 3 * ca
            canvas.create_polygon(fx, fy, fr1x, fr1y, fl2x, fl2y, fill="#ef4444", outline="")

        # Particles
        for p in st["particles"]:
            a = max(0, p["life"] / 30)
            if a < 0.3:
                continue
            canvas.create_oval(p["x"] - p["size"], p["y"] - p["size"],
                               p["x"] + p["size"], p["y"] + p["size"],
                               fill=p["color"], outline="")

        # Floaters
        for f in st["floaters"]:
            if f["life"] > 5:
                canvas.create_text(f["x"], f["y"], text=f["text"], fill=f["color"],
                                   font=("Segoe UI", 11, "bold"))

        # Base HP bar at bottom
        canvas.create_rectangle(0, h - 6, w, h, fill="#333", outline="")
        hpc = "#22c55e" if hp_pct > 0.5 else "#f59e0b" if hp_pct > 0.25 else "#ef4444"
        canvas.create_rectangle(0, h - 6, w * hp_pct, h, fill=hpc, outline="")

    def _update_hud(st):
        hud_labels["hp"].configure(text=str(max(0, st["baseHP"])))
        hud_labels["coins"].configure(text=str(st["coins"]))
        hud_labels["kills"].configure(text=str(st["kills"]))
        hud_labels["wave"].configure(text=f"{min(st['wave'], st['goalWaves'])}/{st['goalWaves']}")
        hud_labels["score"].configure(text=str(st["score"]))

    def _game_loop():
        if state["gameOver"] or not canvas.winfo_exists():
            return
        dt = 33  # ~30 fps
        _update(state, dt)
        _draw(canvas, state)
        _update_hud(state)

        if state["baseHP"] <= 0:
            _end_game(state, False)
            return
        if state["wave"] >= state["goalWaves"] and not any(e["hp"] > 0 for e in state["enemies"]):
            _end_game(state, True)
            return
        canvas.after(dt, _game_loop)

    def _end_game(st, won):
        st["gameOver"] = True
        st["won"] = won
        # Show results
        self._clear_main()
        scroll = self._make_screen()

        title = "🏆 Gewonnen!" if won else "💀 Basis gefallen"
        ctk.CTkLabel(scroll, text=title, font=("Segoe UI", 24, "bold"),
                     text_color=COLORS["success"] if won else COLORS["danger"]
                     ).grid(row=0, column=0, pady=(0, 8))

        sub = (f"Du hast alle {st['goalWaves']} Wellen überstanden!" if won
               else f"Du hast Welle {st['wave']} von {st['goalWaves']} erreicht.")
        ctk.CTkLabel(scroll, text=sub, font=("Segoe UI", 14),
                     text_color=COLORS["text_light"]).grid(row=1, column=0, pady=(0, 16))

        stats_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=12)
        stats_frame.grid(row=2, column=0, sticky="ew", pady=(0, 16))
        for i, (icon, label, val) in enumerate([
            ("⭐", "Score", st["score"]), ("💀", "Kills", st["kills"]),
            ("🌊", "Welle", f"{st['wave']}/{st['goalWaves']}"), ("🪙", "Coins", st["coins"]),
        ]):
            ctk.CTkLabel(stats_frame, text=f"{icon} {label}: {val}",
                         font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                         ).grid(row=i, column=0, padx=16, pady=6, sticky="w")

        # Feedback: wrong answers
        wrong = [e for e in st["log"] if not e["correct"]]
        if wrong:
            ctk.CTkLabel(scroll, text=f"❌ {len(wrong)} falsche Antworten:",
                         font=("Segoe UI", 14, "bold"), text_color=COLORS["danger"]
                         ).grid(row=3, column=0, sticky="w", pady=(8, 6))
            for j, entry in enumerate(wrong[:10]):
                q = entry["q"]
                f = ctk.CTkFrame(scroll, fg_color=COLORS.get("row_bad", "#fee2e2"), corner_radius=8)
                f.grid(row=4 + j, column=0, sticky="ew", pady=3)
                f.grid_columnconfigure(0, weight=1)
                ctk.CTkLabel(f, text=_display_text(q["prompt"]), font=("Segoe UI", 12, "bold"),
                             text_color=COLORS["text"], wraplength=500, justify="left"
                             ).grid(row=0, column=0, padx=10, pady=(6, 2), sticky="w")
                ctk.CTkLabel(f, text=f"Deine Antwort: {_display_text(entry.get('userAnswer', '—'))}",
                             font=("Segoe UI", 11), text_color=COLORS["danger"]
                             ).grid(row=1, column=0, padx=10, pady=1, sticky="w")
                ctk.CTkLabel(f, text=f"Richtig: {_display_text(q.get('answer', '—'))}",
                             font=("Segoe UI", 11), text_color=COLORS["success"]
                             ).grid(row=2, column=0, padx=10, pady=(1, 6), sticky="w")

        btn_row = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_row.grid(row=20, column=0, pady=16)
        ctk.CTkButton(btn_row, text="🔄 Nochmal", width=140, height=38,
                      corner_radius=RADIUS_MD, fg_color=COLORS["primary"],
                      font=("Segoe UI", 13, "bold"), command=self.show_tower_defense
                      ).grid(row=0, column=0, padx=6)
        ctk.CTkButton(btn_row, text="← Zurück", width=120, height=38,
                      corner_radius=RADIUS_MD, fg_color=COLORS["text_light"],
                      font=("Segoe UI", 13), command=self.show_games
                      ).grid(row=0, column=1, padx=6)

    # Tap canvas to buy tower
    def on_canvas_click(e):
        if state["gameOver"]:
            return
        col = e.x // TILE
        row = e.y // TILE
        if any(c == col and r == row for c, r in TD_PATH):
            return
        if any(t["col"] == col and t["row"] == row for t in state["towers"]):
            return
        if state["coins"] >= 15:
            state["coins"] -= 15
            state["towers"].append({
                "col": col, "row": row,
                "x": col * TILE + TILE // 2, "y": row * TILE + TILE // 2,
                "range": TILE * 2.5, "cd": 0, "rate": state["cfg"]["tRate"],
                "dmg": state["cfg"]["tDmg"], "color": "#06b6d4", "aim": -math.pi / 2,
            })
            _add_floater(state, col * TILE + TILE // 2, row * TILE + TILE // 2, "-15 🪙", "#f59e0b")
        else:
            _add_floater(state, col * TILE + TILE // 2, row * TILE + TILE // 2, "15 🪙 nötig", "#ef4444")

    canvas.bind("<Button-1>", on_canvas_click)

    # Start
    _game_loop()


# =====================================================================
#  QUIZ BATTLE
# =====================================================================
CW_QB, CH_QB = 600, 440

QB_DIFF = {
    "easy":   {"speed": 0.08, "hp": 16, "hpS": 8, "dmg": 6, "dS": 2, "aiAcc": 0.40, "cpuHP": 80},
    "normal": {"speed": 0.13, "hp": 18, "hpS": 10, "dmg": 8, "dS": 3, "aiAcc": 0.62, "cpuHP": 100},
    "hard":   {"speed": 0.20, "hp": 22, "hpS": 12, "dmg": 10, "dS": 4, "aiAcc": 0.82, "cpuHP": 120},
}


def show_quiz_battle(self):
    """Quiz Battle setup screen."""
    self._clear_main()
    self.header_subtitle.configure(text="⚔️ Quiz Battle")
    scroll = self._make_screen()

    top = ctk.CTkFrame(scroll, fg_color="transparent")
    top.grid(row=0, column=0, sticky="ew", pady=(0, 12))
    top.grid_columnconfigure(1, weight=1)
    ctk.CTkButton(top, text="← Zurück", width=80, height=32,
                  corner_radius=RADIUS_MD, fg_color=COLORS["card"],
                  text_color=COLORS["text"], hover_color=COLORS.get("card_hover", "#eef7f2"),
                  border_width=1, border_color=COLORS["border"],
                  font=("Segoe UI", 12), command=self.show_games
                  ).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(top, text="⚔️ Quiz Battle",
                 font=("Segoe UI", 20, "bold"), text_color=COLORS["text"]
                 ).grid(row=0, column=1, sticky="w")

    ctk.CTkLabel(scroll, text="Beantworte Fragen um Krieger zu spawnen — besiege die Gegner!",
                 font=("Segoe UI", 13), text_color=COLORS["text_light"]
                 ).grid(row=1, column=0, sticky="w", pady=(0, 14))

    # Quiz / folder
    quiz_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    quiz_frame.grid(row=2, column=0, sticky="ew", pady=(0, 10))
    ctk.CTkLabel(quiz_frame, text="Quiz/Ordner wählen:", font=("Segoe UI", 13)
                 ).grid(row=0, column=0, padx=(0, 10), sticky="w")
    sources = _game_sources(self)
    quiz_names = [label for label, _ in sources]
    quiz_var = StringVar(value=quiz_names[0] if quiz_names else "")
    ctk.CTkOptionMenu(quiz_frame, values=quiz_names, variable=quiz_var, width=320
                      ).grid(row=0, column=1, sticky="w")

    # Difficulty
    diff_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    diff_frame.grid(row=3, column=0, sticky="ew", pady=(0, 10))
    ctk.CTkLabel(diff_frame, text="Schwierigkeit:", font=("Segoe UI", 13)
                 ).grid(row=0, column=0, padx=(0, 10), sticky="w")
    diff_var = StringVar(value="easy")
    for i, (key, label) in enumerate([("easy", "Leicht"), ("normal", "Normal"), ("hard", "Schwer")]):
        ctk.CTkRadioButton(diff_frame, text=label, variable=diff_var, value=key,
                           font=("Segoe UI", 12)).grid(row=0, column=i + 1, padx=8)

    # Mode
    mode_frame = ctk.CTkFrame(scroll, fg_color="transparent")
    mode_frame.grid(row=4, column=0, sticky="ew", pady=(0, 10))
    ctk.CTkLabel(mode_frame, text="Modus:", font=("Segoe UI", 13)
                 ).grid(row=0, column=0, padx=(0, 10), sticky="w")
    mode_var = StringVar(value="classic")
    ctk.CTkRadioButton(mode_frame, text="🏰 Verteidigung", variable=mode_var, value="classic",
                       font=("Segoe UI", 12)).grid(row=0, column=1, padx=8)
    ctk.CTkRadioButton(mode_frame, text="🤖 Duell vs. KI", variable=mode_var, value="pvc",
                       font=("Segoe UI", 12)).grid(row=0, column=2, padx=8)

    def start():
        from tkinter import messagebox
        if not sources:
            messagebox.showinfo("Hinweis", "Es sind noch keine Quizze vorhanden. Erstelle zuerst ein Quiz.")
            return
        idx = quiz_names.index(quiz_var.get()) if quiz_var.get() in quiz_names else 0
        questions = _build_playable(sources[idx][1])
        if not questions:
            messagebox.showinfo("Hinweis", "Diese Auswahl hat keine für Spiele geeigneten Fragen.")
            return
        _run_qb(self, questions, diff_var.get(), mode_var.get())

    ctk.CTkButton(scroll, text="⚔️ Kampf starten", width=200, height=42,
                  corner_radius=RADIUS_MD, fg_color=COLORS["danger"],
                  font=("Segoe UI", 15, "bold"), command=start
                  ).grid(row=5, column=0, pady=16)


def _run_qb(self, questions, difficulty, mode):
    """Run the Quiz Battle game."""
    self._clear_main()
    cfg = QB_DIFF[difficulty]
    random.shuffle(questions)

    TOWER_Y = CH_QB - 36
    CPU_Y = 34

    state = {
        "mode": mode, "cfg": cfg, "difficulty": difficulty,
        "towerHP": 100, "towerMax": 100,
        "cpuHP": cfg["cpuHP"], "cpuMax": cfg["cpuHP"],
        "heroes": [], "foes": [], "particles": [], "floaters": [],
        "enemy": None, "enemyLevel": 1, "cpuLevel": 1, "correctTotal": 0,
        "score": 0, "coins": 0, "kills": 0, "qIdx": 0,
        "gameOver": False, "won": False, "locked": False,
        "goalKills": 5, "log": [], "questions": questions,
        "tick": 0, "TOWER_Y": TOWER_Y, "CPU_Y": CPU_Y,
    }

    if mode == "classic":
        _spawn_qb_enemy(state, cfg)

    # Layout
    wrap = ctk.CTkFrame(self.main_frame, fg_color=COLORS["bg"])
    wrap.grid(row=0, column=0, sticky="nsew")
    self.main_frame.grid_rowconfigure(0, weight=1)
    self.main_frame.grid_columnconfigure(0, weight=1)
    wrap.grid_columnconfigure(0, weight=0)
    wrap.grid_columnconfigure(1, weight=1)
    wrap.grid_rowconfigure(1, weight=1)

    # HUD
    hud = ctk.CTkFrame(wrap, fg_color=COLORS["card"], corner_radius=10, height=40)
    hud.grid(row=0, column=0, columnspan=2, sticky="ew", padx=10, pady=(10, 4))
    hud_labels = {}
    if mode == "pvc":
        items = [("🏰", "hp", "100"), ("🤖", "cpuhp", str(state["cpuMax"])), ("⭐", "score", "0")]
    else:
        items = [("🏰", "hp", "100"), ("💀", "kills", f"0/{state['goalKills']}"),
                 ("⚔️", "lvl", "1"), ("⭐", "score", "0")]
    for i, (icon, key, init) in enumerate(items):
        ctk.CTkLabel(hud, text=icon, font=("Segoe UI", 14)).grid(row=0, column=i * 2, padx=(12 if i == 0 else 6, 2), pady=6)
        lbl = ctk.CTkLabel(hud, text=init, font=("Segoe UI", 13, "bold"), text_color=COLORS["text"])
        lbl.grid(row=0, column=i * 2 + 1, padx=(0, 8), pady=6)
        hud_labels[key] = lbl

    # Canvas
    canvas = tk.Canvas(wrap, width=CW_QB, height=CH_QB, bg="#6b5d4f", highlightthickness=0)
    canvas.grid(row=1, column=0, padx=(10, 4), pady=(4, 10), sticky="n")

    # CPU popup label
    cpu_pop = ctk.CTkLabel(wrap, text="", font=("Segoe UI", 13, "bold"), fg_color="transparent",
                            corner_radius=8)
    cpu_pop.place(relx=0.25, rely=0.15)
    cpu_pop.place_forget()

    # Question panel
    q_panel = ctk.CTkFrame(wrap, fg_color=COLORS["card"], corner_radius=12)
    q_panel.grid(row=1, column=1, padx=(4, 10), pady=(4, 10), sticky="nsew")
    q_panel.grid_columnconfigure(0, weight=1)

    q_diff_lbl = ctk.CTkLabel(q_panel, text="", font=("Segoe UI", 12, "bold"), corner_radius=6)
    q_diff_lbl.grid(row=0, column=0, padx=12, pady=(12, 4), sticky="w")
    q_text_lbl = ctk.CTkLabel(q_panel, text="Bereit zum Kampf!", font=("Segoe UI", 14, "bold"),
                               text_color=COLORS["text"], wraplength=350, justify="left")
    q_text_lbl.grid(row=1, column=0, padx=14, pady=(6, 10), sticky="w")

    opts_frame = ctk.CTkFrame(q_panel, fg_color="transparent")
    opts_frame.grid(row=2, column=0, padx=10, pady=(0, 10), sticky="ew")
    opts_frame.grid_columnconfigure(0, weight=1)
    opts_frame.grid_columnconfigure(1, weight=1)

    ui = {
        "canvas": canvas, "hud": hud_labels, "q_diff": q_diff_lbl,
        "q_text": q_text_lbl, "opts": opts_frame, "wrap": wrap,
        "cpu_pop": cpu_pop,
    }

    def _show_q():
        if state["gameOver"]:
            return
        if state["qIdx"] >= len(state["questions"]):
            state["qIdx"] = 0
            random.shuffle(state["questions"])
        q = state["questions"][state["qIdx"]]
        state["qIdx"] += 1
        state["locked"] = False
        state["currentQ"] = q

        diff = q.get("diff", 1)
        q_diff_lbl.configure(text=DIFF_LABEL[diff], fg_color=DIFF_COLOR[diff], text_color="#0d1117")
        q_text_lbl.configure(text=_display_text(q["prompt"]))

        for w in opts_frame.winfo_children():
            w.destroy()

        def commit(ok, user_ans=""):
            if state["locked"] or state["gameOver"]:
                return
            state["locked"] = True
            state["log"].append({"q": q, "correct": ok, "userAnswer": user_ans})
            _qb_answer(state, ok, diff, ui)
            if mode == "pvc":
                _cpu_turn(state, q, ui)
            ongoing = not state["gameOver"] and state["towerHP"] > 0
            if mode == "pvc":
                ongoing = ongoing and state["cpuHP"] > 0
            else:
                ongoing = ongoing and state["kills"] < state["goalKills"]
            if ongoing:
                canvas.after(900, _show_q)

        if q["kind"] == "choice":
            shuffled = q["options"][:]
            random.shuffle(shuffled)
            for i, o in enumerate(shuffled):
                btn = ctk.CTkButton(opts_frame, text=_display_text(o["text"]), height=38,
                                    corner_radius=RADIUS_SM, fg_color=COLORS["card"],
                                    text_color=COLORS["text"], border_width=1,
                                    border_color=COLORS["border"],
                                    hover_color=COLORS.get("card_hover", "#eef7f2"),
                                    font=("Segoe UI", 12),
                                    command=lambda ok=o["correct"], t=o["text"]: commit(ok, t))
                btn.grid(row=i // 2, column=i % 2, padx=4, pady=4, sticky="ew")
        elif q["kind"] == "multi":
            shuffled = q["options"][:]
            random.shuffle(shuffled)
            selected = set()
            for i, o in enumerate(shuffled):
                b = ctk.CTkButton(opts_frame, text=_display_text(o["text"]), height=34,
                                  corner_radius=RADIUS_SM, fg_color=COLORS["card"],
                                  text_color=COLORS["text"], border_width=1,
                                  border_color=COLORS["border"], font=("Segoe UI", 11))
                b.grid(row=i // 2, column=i % 2, padx=3, pady=3, sticky="ew")
                def toggle(idx=i, btn=b):
                    if idx in selected:
                        selected.discard(idx)
                        btn.configure(fg_color=COLORS["card"], text_color=COLORS["text"])
                    else:
                        selected.add(idx)
                        btn.configure(fg_color=COLORS["primary"], text_color=COLORS.get("on_primary", "#ffffff"))
                b.configure(command=toggle)
            confirm = ctk.CTkButton(opts_frame, text="✓ Bestätigen", height=36,
                                    corner_radius=RADIUS_SM, fg_color=COLORS["success"],
                                    font=("Segoe UI", 12, "bold"))
            confirm.grid(row=(len(shuffled) + 1) // 2, column=0, columnspan=2, padx=4, pady=6, sticky="ew")
            def check_multi():
                ok = set(i for i, o in enumerate(shuffled) if o["correct"]) == selected
                commit(ok, ", ".join(shuffled[i]["text"] for i in selected))
            confirm.configure(command=check_multi)
        elif q["kind"] == "multi_text":
            blanks = q["blanks"]
            entries = []
            for i, _b in enumerate(blanks):
                row = ctk.CTkFrame(opts_frame, fg_color="transparent")
                row.grid(row=i, column=0, columnspan=2, padx=4, pady=3, sticky="ew")
                row.grid_columnconfigure(1, weight=1)
                ctk.CTkLabel(row, text=f"Lücke {i+1}:", font=("Segoe UI", 11),
                             text_color=COLORS["text_light"], width=60
                             ).grid(row=0, column=0, padx=(0, 6))
                e = ctk.CTkEntry(row, placeholder_text=f"Lücke {i+1}…",
                                 font=("Segoe UI", 13), height=34)
                e.grid(row=0, column=1, sticky="ew")
                entries.append(e)
            def submit_blanks(_=None):
                vals = [e.get() for e in entries]
                commit(_check_multi_text(blanks, vals), ", ".join(vals))
            btn = ctk.CTkButton(opts_frame, text="✓ Bestätigen", height=36,
                                corner_radius=RADIUS_SM, fg_color=COLORS["primary"],
                                font=("Segoe UI", 12, "bold"), command=submit_blanks)
            btn.grid(row=len(blanks), column=0, columnspan=2, padx=4, pady=6, sticky="ew")
            entries[-1].bind("<Return>", submit_blanks)
            entries[0].focus_set()
        else:
            inp = ctk.CTkEntry(opts_frame, placeholder_text="Antwort eingeben…",
                               font=("Segoe UI", 13), height=38)
            inp.grid(row=0, column=0, padx=4, pady=4, sticky="ew")
            def submit(_=None):
                commit(_check_text(q.get("accept", []), inp.get()), inp.get())
            btn = ctk.CTkButton(opts_frame, text="✓", width=50, height=38,
                                corner_radius=RADIUS_SM, fg_color=COLORS["primary"],
                                font=("Segoe UI", 14, "bold"), command=submit)
            btn.grid(row=0, column=1, padx=4, pady=4)
            inp.bind("<Return>", submit)
            inp.focus_set()

    def _qb_answer(st, correct, diff, ui):
        TY = st["TOWER_Y"]
        if correct:
            st["correctTotal"] += 1
            st["heroes"].append({
                "x": CW_QB / 2 + random.uniform(-30, 30), "y": TY - 10,
                "hp": 30 + diff * 15, "maxHp": 30 + diff * 15,
                "dmg": 6 + diff * 4, "speed": 0.14, "size": 10 + diff * 2,
                "attackCd": 0, "diff": diff, "hit": 0,
            })
            st["score"] += 10 * diff
            _add_floater(st, CW_QB / 2, TY - 30, f"+Held (Lvl {diff})", "#22c55e")
        if mode == "pvc":
            if not correct:
                _add_floater(st, CW_QB / 2, TY - 30, "✗ Kein Held", "#ef4444")
            return
        # Classic
        e = st["enemy"]
        if correct:
            if st["correctTotal"] % 3 == 0 and e:
                e["armor"] = min(0.7, e["armor"] + 0.06)
                e["size"] += 3
                e["maxHp"] += 8; e["hp"] += 8
        elif e:
            e["level"] += 1
            e["size"] += 4
            e["armor"] = min(0.8, e["armor"] + 0.1)
            e["dmg"] += 4
            e["maxHp"] += 10
            e["hp"] = min(e["maxHp"], e["hp"] + 10)
            _add_floater(st, e["x"], e["y"] - e["size"] - 10, f"⬆ Lvl {e['level']}", "#ef4444")
            _burst(st, e["x"], e["y"], "#ef4444", 10)
            if st["heroes"]:
                victim = min(st["heroes"], key=lambda h: h["y"])
                _burst(st, victim["x"], victim["y"], "#94a3b8", 8)
                st["heroes"].remove(victim)
            else:
                st["towerHP"] -= e["dmg"]

    def _cpu_turn(st, q, ui):
        correct = random.random() < st["cfg"]["aiAcc"]
        pop = ui["cpu_pop"]
        if correct:
            st["foes"].append({
                "x": CW_QB / 2 + random.uniform(-30, 30), "y": st["CPU_Y"] + 16,
                "hp": cfg["hp"] + st["cpuLevel"] * 6, "maxHp": cfg["hp"] + st["cpuLevel"] * 6,
                "dmg": cfg["dmg"] + st["cpuLevel"] * 2, "speed": cfg["speed"],
                "size": 11 + min(8, st["cpuLevel"]), "level": st["cpuLevel"],
                "hit": 0, "attackCd": 0, "wob": random.random() * 6,
            })
            st["cpuLevel"] = min(9, 1 + st["correctTotal"] // 2)
            pop.configure(text=f"🤖 {q.get('answer', 'Richtig!')}", fg_color="#16a34a", text_color="white")
        else:
            pop.configure(text="🤖 ✗", fg_color="#dc2626", text_color="white")
        pop.place(relx=0.05, rely=0.14)
        canvas.after(2200, lambda: pop.place_forget() if pop.winfo_exists() else None)

    def _update_qb(st, dt):
        TY, CY = st["TOWER_Y"], st["CPU_Y"]
        pvc = st["mode"] == "pvc"

        if pvc:
            _update_pvc(st, dt, TY, CY)
        else:
            _update_classic(st, dt, TY)

        st["particles"] = [p for p in st["particles"] if _tick_particle(p)]
        st["floaters"] = [f for f in st["floaters"] if _tick_floater(f)]

    def _update_classic(st, dt, TY):
        e = st["enemy"]
        if not e:
            return
        e["wob"] += dt / 200
        if e["hit"] > 0:
            e["hit"] -= 1
        engaged = next((h for h in st["heroes"]
                        if abs(h["y"] - e["y"]) < e["size"] + h["size"] + 4
                        and abs(h["x"] - e["x"]) < e["size"] + h["size"]), None)
        if engaged:
            e["attackCd"] -= dt
            if e["attackCd"] <= 0:
                e["attackCd"] = 700
                engaged["hp"] -= e["dmg"]
                _burst(st, engaged["x"], engaged["y"], "#ef4444", 4)
        else:
            e["y"] += e["speed"] * dt * 0.1
            if e["y"] >= TY - e["size"]:
                st["towerHP"] -= e["dmg"]
                _add_floater(st, CW_QB / 2, TY - 20, f"-{e['dmg']}", "#ef4444")
                e["y"] = 50
        if e["hp"] <= 0:
            st["kills"] += 1
            st["score"] += 25 * e["level"]
            st["coins"] += 3 * e["level"]
            _burst(st, e["x"], e["y"], "#fbbf24", 14)
            st["enemyLevel"] = e["level"] + 1
            _spawn_qb_enemy(st, st["cfg"])
        for h in st["heroes"]:
            if h["attackCd"] > 0:
                h["attackCd"] -= dt
            if e and abs(h["y"] - e["y"]) < e["size"] + h["size"] + 4 and abs(h["x"] - e["x"]) < e["size"] + h["size"]:
                if h["attackCd"] <= 0:
                    h["attackCd"] = 600
                    dmg = h["dmg"] * (1 - e["armor"])
                    e["hp"] -= dmg
                    e["hit"] = 6
                    _add_floater(st, e["x"] + random.uniform(-6, 6), e["y"] - e["size"], f"-{round(dmg)}", "#22d3ee")
            else:
                h["y"] -= h["speed"] * dt * 0.1 + h["speed"]
                if e:
                    h["x"] += (e["x"] - h["x"]) * 0.02
        st["heroes"] = [h for h in st["heroes"] if h["hp"] > 0 and h["y"] > -20]

    def _update_pvc(st, dt, TY, CY):
        in_range = lambda a, b: abs(a["y"] - b["y"]) < a["size"] + b["size"] + 4 and abs(a["x"] - b["x"]) < a["size"] + b["size"] + 6
        for h in st["heroes"]:
            if h["attackCd"] > 0:
                h["attackCd"] -= dt
            if h["hit"] > 0:
                h["hit"] -= 1
        for f in st["foes"]:
            if f["attackCd"] > 0:
                f["attackCd"] -= dt
            if f["hit"] > 0:
                f["hit"] -= 1
            f["wob"] += dt / 200

        for h in st["heroes"]:
            foe = _nearest(h, st["foes"])
            if foe and in_range(h, foe):
                if h["attackCd"] <= 0:
                    h["attackCd"] = 600
                    foe["hp"] -= h["dmg"]
                    foe["hit"] = 6
                    _add_floater(st, foe["x"], foe["y"] - foe["size"], f"-{round(h['dmg'])}", "#22d3ee")
            else:
                h["y"] -= h["speed"] * dt * 0.1 + h["speed"] * 0.5
                if foe:
                    h["x"] += (foe["x"] - h["x"]) * 0.03
                if h["y"] <= CY + 12:
                    st["cpuHP"] -= 12
                    _add_floater(st, h["x"], CY + 20, "-12", "#22d3ee")
                    _burst(st, h["x"], CY + 14, "#22d3ee", 8)
                    h["hp"] = 0

        for f in st["foes"]:
            hero = _nearest(f, st["heroes"])
            if hero and in_range(f, hero):
                if f["attackCd"] <= 0:
                    f["attackCd"] = 650
                    hero["hp"] -= f["dmg"]
                    hero["hit"] = 6
                    _add_floater(st, hero["x"], hero["y"] - hero["size"], f"-{round(f['dmg'])}", "#ef4444")
            else:
                f["y"] += f["speed"] * dt * 0.1 + f["speed"] * 0.5
                if hero:
                    f["x"] += (hero["x"] - f["x"]) * 0.03
                if f["y"] >= TY - 12:
                    st["towerHP"] -= f["dmg"]
                    _add_floater(st, f["x"], TY - 18, f"-{f['dmg']}", "#ef4444")
                    _burst(st, f["x"], TY - 6, "#ef4444", 8)
                    f["hp"] = 0

        st["foes"] = [f for f in st["foes"] if f["hp"] > 0]
        dead_heroes = [h for h in st["heroes"] if h["hp"] <= 0 and h["y"] < TY - 12]
        for d in dead_heroes:
            st["score"] += 8
            _burst(st, d["x"], d["y"], "#fbbf24", 8)
        st["heroes"] = [h for h in st["heroes"] if h["hp"] > 0]

    def _draw_qb(canvas, st):
        canvas.delete("all")
        w, h = CW_QB, CH_QB
        dark = COLORS.get("bg", "#f5fbf6") != "#f5fbf6"
        st["tick"] += 1
        tick = st["tick"]
        pvc = st["mode"] == "pvc"
        TY, CY = st["TOWER_Y"], st["CPU_Y"]

        # Arena
        canvas.create_rectangle(0, 0, w, h, fill=ARENA_DARK_WALL if dark else ARENA_WALL, outline="")
        ci = 0
        for x in range(5, w - 3, 8):
            for dy in [5, 10]:
                bob = int(math.sin(tick / 15 + ci) * 1)
                canvas.create_oval(x - 2, dy + bob - 2, x + 2, dy + bob + 2,
                                   fill=CROWD_COLORS[ci % len(CROWD_COLORS)], outline="")
                ci += 1
        for x in range(5, w - 3, 8):
            for dy in [h - 9, h - 4]:
                bob = int(math.sin(tick / 15 + ci) * 1)
                canvas.create_oval(x - 2, dy + bob - 2, x + 2, dy + bob + 2,
                                   fill=CROWD_COLORS[ci % len(CROWD_COLORS)], outline="")
                ci += 1
        for y in range(16, h - 14, 8):
            for dx in [4, w - 4]:
                canvas.create_oval(dx - 2, y - 2, dx + 2, y + 2,
                                   fill=CROWD_COLORS[ci % len(CROWD_COLORS)], outline="")
                ci += 1

        pad = 12
        floor = ARENA_DARK_FLOOR if dark else ARENA_FLOOR
        canvas.create_rectangle(pad, pad, w - pad, h - pad, fill=floor, outline="")
        midY = h // 2
        # red/blue zones
        canvas.create_rectangle(pad, pad, w - pad, midY, fill="#f5c5c5" if not dark else "#3a2020", outline="", stipple="gray25")
        canvas.create_rectangle(pad, midY, w - pad, h - pad, fill="#c5d5f5" if not dark else "#1a2040", outline="", stipple="gray25")
        # dashed center
        for x in range(pad + 8, w - pad - 8, 16):
            canvas.create_line(x, midY, x + 8, midY, fill="#888", width=2, dash=(4, 4))
        canvas.create_text(w // 2, midY, text="⚔️", font=("Segoe UI", 14))

        # Fortresses
        _draw_fortress(canvas, w // 2, TY, st["towerHP"] / st["towerMax"], "#3b82f6", tick, False)
        if pvc:
            _draw_fortress(canvas, w // 2, CY, st["cpuHP"] / st["cpuMax"], "#dc2626", tick, True)

        # Heroes
        for u in st["heroes"]:
            _draw_fighter(canvas, u, False)
        # Foes
        for u in st["foes"]:
            _draw_fighter(canvas, u, True)
        # Classic enemy
        if not pvc and st["enemy"]:
            _draw_boss(canvas, st["enemy"], dark)

        # Particles & floaters
        for p in st["particles"]:
            if p["life"] > 5:
                canvas.create_oval(p["x"] - p["size"], p["y"] - p["size"],
                                   p["x"] + p["size"], p["y"] + p["size"],
                                   fill=p["color"], outline="")
        for f in st["floaters"]:
            if f["life"] > 5:
                canvas.create_text(f["x"], f["y"], text=f["text"], fill=f["color"],
                                   font=("Segoe UI", 10, "bold"))

    def _update_hud_qb(st):
        hud_labels["hp"].configure(text=str(max(0, round(st["towerHP"]))))
        hud_labels["score"].configure(text=str(st["score"]))
        if st["mode"] == "pvc":
            hud_labels["cpuhp"].configure(text=str(max(0, round(st["cpuHP"]))))
        else:
            hud_labels["kills"].configure(text=f"{st['kills']}/{st['goalKills']}")
            hud_labels["lvl"].configure(text=str(st["enemy"]["level"] if st["enemy"] else 1))

    def _game_loop_qb():
        if state["gameOver"] or not canvas.winfo_exists():
            return
        dt = 33
        _update_qb(state, dt)
        _draw_qb(canvas, state)
        _update_hud_qb(state)

        if state["towerHP"] <= 0:
            _end_qb(state, False)
            return
        if mode == "pvc" and state["cpuHP"] <= 0:
            _end_qb(state, True)
            return
        if mode == "classic" and state["kills"] >= state["goalKills"]:
            _end_qb(state, True)
            return
        canvas.after(dt, _game_loop_qb)

    def _end_qb(st, won):
        st["gameOver"] = True
        self._clear_main()
        scroll = self._make_screen()

        pvc = st["mode"] == "pvc"
        title = ("🏆 KI besiegt!" if pvc else "🏆 Sieg!") if won else "🏰 Turm zerstört!"
        ctk.CTkLabel(scroll, text=title, font=("Segoe UI", 24, "bold"),
                     text_color=COLORS["success"] if won else COLORS["danger"]
                     ).grid(row=0, column=0, pady=(0, 8))

        sub = (f"Du hast die KI-Festung zerstört!" if pvc and won
               else f"Die KI hat deine Festung zerstört." if pvc
               else f"Du hast alle {st['goalKills']} Gegner besiegt!" if won
               else f"Du hast {st['kills']} von {st['goalKills']} Gegnern besiegt.")
        ctk.CTkLabel(scroll, text=sub, font=("Segoe UI", 14),
                     text_color=COLORS["text_light"]).grid(row=1, column=0, pady=(0, 16))

        stats_frame = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=12)
        stats_frame.grid(row=2, column=0, sticky="ew", pady=(0, 16))
        stat_items = [("⭐", "Score", st["score"])]
        if pvc:
            stat_items += [("🏰", "Deine Festung", max(0, round(st["towerHP"]))),
                           ("🤖", "KI-Festung", max(0, round(st["cpuHP"])))]
        else:
            stat_items += [("💀", "Besiegt", f"{st['kills']}/{st['goalKills']}")]
        stat_items.append(("🪙", "Coins", st["coins"]))
        for i, (icon, label, val) in enumerate(stat_items):
            ctk.CTkLabel(stats_frame, text=f"{icon} {label}: {val}",
                         font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                         ).grid(row=i, column=0, padx=16, pady=6, sticky="w")

        wrong = [e for e in st["log"] if not e["correct"]]
        if wrong:
            ctk.CTkLabel(scroll, text=f"❌ {len(wrong)} falsche Antworten:",
                         font=("Segoe UI", 14, "bold"), text_color=COLORS["danger"]
                         ).grid(row=3, column=0, sticky="w", pady=(8, 6))
            for j, entry in enumerate(wrong[:10]):
                q = entry["q"]
                f = ctk.CTkFrame(scroll, fg_color=COLORS.get("row_bad", "#fee2e2"), corner_radius=8)
                f.grid(row=4 + j, column=0, sticky="ew", pady=3)
                f.grid_columnconfigure(0, weight=1)
                ctk.CTkLabel(f, text=_display_text(q["prompt"]), font=("Segoe UI", 12, "bold"),
                             text_color=COLORS["text"], wraplength=500, justify="left"
                             ).grid(row=0, column=0, padx=10, pady=(6, 2), sticky="w")
                ctk.CTkLabel(f, text=f"Deine Antwort: {_display_text(entry.get('userAnswer', '—'))}",
                             font=("Segoe UI", 11), text_color=COLORS["danger"]
                             ).grid(row=1, column=0, padx=10, pady=1, sticky="w")
                ctk.CTkLabel(f, text=f"Richtig: {_display_text(q.get('answer', '—'))}",
                             font=("Segoe UI", 11), text_color=COLORS["success"]
                             ).grid(row=2, column=0, padx=10, pady=(1, 6), sticky="w")

        btn_row = ctk.CTkFrame(scroll, fg_color="transparent")
        btn_row.grid(row=20, column=0, pady=16)
        ctk.CTkButton(btn_row, text="🔄 Nochmal", width=140, height=38,
                      corner_radius=RADIUS_MD, fg_color=COLORS["danger"],
                      font=("Segoe UI", 13, "bold"), command=self.show_quiz_battle
                      ).grid(row=0, column=0, padx=6)
        ctk.CTkButton(btn_row, text="← Zurück", width=120, height=38,
                      corner_radius=RADIUS_MD, fg_color=COLORS["text_light"],
                      font=("Segoe UI", 13), command=self.show_games
                      ).grid(row=0, column=1, padx=6)

    _show_q()
    _game_loop_qb()


# =====================================================================
#  Shared draw helpers
# =====================================================================
def _draw_fortress(canvas, x, y, hp_frac, base_color, tick, flip):
    tp = max(0, hp_frac)
    keep = base_color if tp > 0.5 else "#d97706" if tp > 0.25 else "#dc2626"
    canvas.create_rectangle(x - 22, y - 12, x + 22, y + 14, fill=keep, outline="#1e293b", width=1)
    for i in range(4):
        bx = x - 20 + i * 11
        by = y + 14 if flip else y - 18
        canvas.create_rectangle(bx, by, bx + 6, by + 6, fill="#64748b", outline="")
    canvas.create_rectangle(x - 4, y, x + 4, y + 12, fill="#1e293b", outline="")
    sway = math.sin(tick / 20) * 3
    fc = "#0d9488" if tp > 0.25 else "#ef4444"
    if flip:
        fc = "#ef4444" if tp > 0.25 else "#ef4444"
    by = y + 16 if flip else y - 18
    canvas.create_polygon(x, by, x + 10 + sway, by - 4, x + 10 + sway, by + 4, x, by + 2,
                          fill=fc, outline="")
    # HP bar
    bar_y = y - 20 if not flip else y + 20
    canvas.create_rectangle(x - 28, bar_y, x + 28, bar_y + 5, fill="#333", outline="")
    hpc = "#22c55e" if tp > 0.5 else "#f59e0b" if tp > 0.25 else "#ef4444"
    canvas.create_rectangle(x - 28, bar_y, x - 28 + 56 * tp, bar_y + 5, fill=hpc, outline="")


def _draw_fighter(canvas, u, is_foe):
    x, y, s = u["x"], u["y"], u["size"]
    color = "#ffffff" if u.get("hit", 0) > 0 else ("#ef4444" if is_foe else
            ["#60a5fa", "#34d399", "#a78bfa"][min(u.get("diff", 1) - 1, 2)])
    canvas.create_oval(x - s, y - s, x + s, y + s, fill=color, outline="")
    # weapon
    d = 1 if is_foe else -1
    canvas.create_line(x, y + s * 0.3 * d, x, y + (s + 6) * d,
                       fill="#7f1d1d" if is_foe else "#e2e8f0", width=2, capstyle="round")
    # hp bar
    hpp = u["hp"] / u["maxHp"]
    canvas.create_rectangle(x - 8, y - s - 7, x + 8, y - s - 4, fill="#333", outline="")
    canvas.create_rectangle(x - 8, y - s - 7, x - 8 + 16 * hpp, y - s - 4,
                            fill="#fb7185" if is_foe else "#22c55e", outline="")


def _draw_boss(canvas, e, dark):
    wob = math.sin(e.get("wob", 0)) * 2
    ex = e["x"] + wob
    s = e["size"]
    color = "#ffffff" if e["hit"] > 0 else f"#{max(0, 200 - e['level'] * 20):02x}4040"
    canvas.create_oval(ex - s, e["y"] - s, ex + s, e["y"] + s, fill=color, outline="")
    if e.get("armor", 0) > 0:
        canvas.create_oval(ex - s - 3, e["y"] - s - 3, ex + s + 3, e["y"] + s + 3,
                           fill="", outline="#94a3b8", width=max(1, int(e["armor"] * 6)))
    # level badge
    canvas.create_oval(ex + s * 0.5, e["y"] - s * 0.9, ex + s * 0.5 + 16, e["y"] - s * 0.9 + 16,
                       fill="#1e293b", outline="")
    canvas.create_text(ex + s * 0.5 + 8, e["y"] - s * 0.9 + 8, text=str(e["level"]),
                       fill="white", font=("Segoe UI", 8, "bold"))
    # hp bar
    hp = e["hp"] / e["maxHp"]
    bw = s * 2.2
    canvas.create_rectangle(ex - bw / 2, e["y"] - s - 12, ex + bw / 2, e["y"] - s - 7, fill="#333", outline="")
    hpc = "#22c55e" if hp > 0.5 else "#f59e0b" if hp > 0.25 else "#ef4444"
    canvas.create_rectangle(ex - bw / 2, e["y"] - s - 12, ex - bw / 2 + bw * hp, e["y"] - s - 7,
                            fill=hpc, outline="")


def _spawn_qb_enemy(state, cfg):
    lvl = state["enemyLevel"]
    state["enemy"] = {
        "x": CW_QB / 2, "y": 50,
        "hp": cfg["hp"] + lvl * cfg["hpS"], "maxHp": cfg["hp"] + lvl * cfg["hpS"],
        "armor": min(0.6, (lvl - 1) * 0.08),
        "dmg": cfg["dmg"] + lvl * cfg["dS"],
        "speed": cfg["speed"] + lvl * 0.004,
        "size": 18 + min(22, lvl * 2),
        "level": lvl, "hit": 0, "attackCd": 0, "wob": 0,
    }


def _nearest(unit, targets):
    best, bd = None, float("inf")
    for t in targets:
        d = math.hypot(t["x"] - unit["x"], t["y"] - unit["y"])
        if d < bd:
            bd, best = d, t
    return best


# ─── Particles & Floaters ─────────────────────────────────────────────
def _burst(state, x, y, color, n):
    for _ in range(n):
        state["particles"].append({
            "x": x, "y": y,
            "vx": random.uniform(-2, 2), "vy": random.uniform(-3, 0),
            "life": 25, "color": color, "size": random.uniform(2, 4),
        })


def _add_floater(state, x, y, text, color):
    state["floaters"].append({"x": x, "y": y, "text": text, "color": color, "life": 40})


def _tick_particle(p):
    p["x"] += p["vx"]
    p["y"] += p["vy"]
    p["vy"] += 0.1
    p["life"] -= 1
    p["size"] *= 0.95
    return p["life"] > 0


def _tick_floater(f):
    f["y"] -= 0.6
    f["life"] -= 1
    return f["life"] > 0
