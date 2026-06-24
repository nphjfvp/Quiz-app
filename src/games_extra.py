"""Additional mini-games for the Desktop app:
Speed-Quiz, Wer wird Millionär, Galgenmännchen, Boss-Kampf.

Mixed into the App class via binding in app.py. These reuse the question
normalisation and answer-checking helpers from games.py.
"""

import random
import string
from tkinter import StringVar, messagebox
import customtkinter as ctk

from .theme import COLORS, RADIUS_SM, RADIUS_MD, RADIUS_LG
from .games import (_build_playable, _game_sources, _check_text, _check_multi_text,
                    _display_text)


# ─── Shared setup screen ──────────────────────────────────────────────
def _game_setup(self, title, subtitle, on_start, weakest=False):
    """Render a source picker and a start button. Calls on_start(questions)."""
    self._clear_main()
    self.header_subtitle.configure(text=title)
    scroll = self._make_screen()

    top = ctk.CTkFrame(scroll, fg_color="transparent")
    top.grid(row=0, column=0, sticky="ew", pady=(0, 12))
    top.grid_columnconfigure(1, weight=1)
    ctk.CTkButton(top, text="← Zurück", width=80, height=32, corner_radius=RADIUS_MD,
                  fg_color=COLORS["card"], text_color=COLORS["text"],
                  hover_color=COLORS.get("card_hover", "#eef7f2"), border_width=1,
                  border_color=COLORS["border"], font=("Segoe UI", 12),
                  command=self.show_games).grid(row=0, column=0, padx=(0, 10))
    ctk.CTkLabel(top, text=title, font=("Segoe UI", 20, "bold"),
                 text_color=COLORS["text"]).grid(row=0, column=1, sticky="w")

    ctk.CTkLabel(scroll, text=subtitle, font=("Segoe UI", 13),
                 text_color=COLORS["text_light"], wraplength=640, justify="left"
                 ).grid(row=1, column=0, sticky="w", pady=(0, 14))

    sources = _game_sources(self)
    names = [label for label, _ in sources]
    quiz_var = StringVar(value=names[0] if names else "")
    qframe = ctk.CTkFrame(scroll, fg_color="transparent")
    qframe.grid(row=2, column=0, sticky="ew", pady=(0, 10))
    ctk.CTkLabel(qframe, text="Quiz/Ordner wählen:", font=("Segoe UI", 13)
                 ).grid(row=0, column=0, padx=(0, 10), sticky="w")
    ctk.CTkOptionMenu(qframe, values=names, variable=quiz_var, width=320
                      ).grid(row=0, column=1, sticky="w")

    def start():
        if not sources:
            messagebox.showinfo("Hinweis", "Es sind noch keine Quizze vorhanden.")
            return
        idx = names.index(quiz_var.get()) if quiz_var.get() in names else 0
        raw = sources[idx][1]
        if weakest:
            raw = _order_by_weakness(self, raw)
        questions = _build_playable(raw)
        if not questions:
            messagebox.showinfo("Hinweis", "Diese Auswahl hat keine geeigneten Fragen.")
            return
        on_start(questions)

    ctk.CTkButton(scroll, text="▶ Spiel starten", width=200, height=42,
                  corner_radius=RADIUS_MD, fg_color=COLORS["primary"],
                  font=("Segoe UI", 15, "bold"), command=start
                  ).grid(row=4, column=0, pady=16)


def _order_by_weakness(self, questions):
    """Sort questions hardest-first using Leitner progress (for Boss-Kampf)."""
    progress = self.store.load_progress()

    def score(q):
        p = progress.get(q.id)
        if not p:
            return 2
        s = p.times_wrong - p.times_correct
        if p.box <= 1:
            s += 3
        elif p.box <= 2:
            s += 1
        return s

    return sorted(questions, key=score, reverse=True)


def _game_end_screen(self, parent_back, title, stats, retry):
    """Generic end screen. stats: list of (label, value). retry: callable."""
    self._clear_main()
    scroll = self._make_screen()
    ctk.CTkLabel(scroll, text=title, font=("Segoe UI", 24, "bold"),
                 text_color=COLORS["primary"]).grid(row=0, column=0, pady=(20, 10))
    box = ctk.CTkFrame(scroll, fg_color=COLORS["card"], corner_radius=RADIUS_MD)
    box.grid(row=1, column=0, pady=10, sticky="ew", padx=40)
    box.grid_columnconfigure(0, weight=1)
    for i, (lbl, val) in enumerate(stats):
        ctk.CTkLabel(box, text=f"{lbl}: {val}", font=("Segoe UI", 14),
                     text_color=COLORS["text"]).grid(row=i, column=0, padx=20, pady=6, sticky="w")
    brow = ctk.CTkFrame(scroll, fg_color="transparent")
    brow.grid(row=2, column=0, pady=20)
    ctk.CTkButton(brow, text="🔄 Nochmal", width=140, height=42, fg_color=COLORS["primary"],
                  font=("Segoe UI", 14, "bold"), command=retry).grid(row=0, column=0, padx=8)
    ctk.CTkButton(brow, text="← Zu den Spielen", width=160, height=42, fg_color=COLORS["card"],
                  text_color=COLORS["text"], border_width=1, border_color=COLORS["border"],
                  font=("Segoe UI", 13), command=self.show_games).grid(row=0, column=1, padx=8)


# =====================================================================
#  SPEED-QUIZ
# =====================================================================
def show_speed_quiz(self):
    _game_setup(self, "⚡ Speed-Quiz",
                "60 Sekunden — beantworte so viele Fragen wie möglich! Combos geben "
                "Bonuspunkte, richtige Antworten geben +2 Sekunden.",
                lambda qs: _run_speed(self, qs))


def _run_speed(self, questions):
    self._clear_main()
    scroll = self._make_screen()
    scroll.grid_columnconfigure(0, weight=1)
    st = {"time": 60, "score": 0, "combo": 0, "maxcombo": 0,
          "answered": 0, "correct": 0, "qidx": 0, "running": True}
    pool = list(questions)
    random.shuffle(pool)

    hud = ctk.CTkFrame(scroll, fg_color="transparent")
    hud.grid(row=0, column=0, sticky="ew", pady=(0, 8))
    hud.grid_columnconfigure((0, 1, 2), weight=1)
    time_lbl = ctk.CTkLabel(hud, text="⏱ 60s", font=("Segoe UI", 18, "bold"), text_color=COLORS["text"])
    time_lbl.grid(row=0, column=0, sticky="w")
    score_lbl = ctk.CTkLabel(hud, text="⭐ 0", font=("Segoe UI", 18, "bold"), text_color=COLORS["primary"])
    score_lbl.grid(row=0, column=1)
    combo_lbl = ctk.CTkLabel(hud, text="", font=("Segoe UI", 14, "bold"), text_color=COLORS["warning"])
    combo_lbl.grid(row=0, column=2, sticky="e")

    qbox = ctk.CTkFrame(scroll, fg_color="transparent")
    qbox.grid(row=1, column=0, sticky="ew", pady=8)
    qbox.grid_columnconfigure(0, weight=1)

    def mult():
        c = st["combo"]
        return 4 if c >= 10 else 3 if c >= 5 else 2 if c >= 3 else 1

    def tick():
        if not st["running"]:
            return
        st["time"] -= 1
        time_lbl.configure(text=f"⏱ {st['time']}s",
                           text_color=COLORS["danger"] if st["time"] <= 10 else COLORS["text"])
        if st["time"] <= 0:
            end()
            return
        self.after(1000, tick)

    def handle(q, correct, user_ans=""):
        st["answered"] += 1
        if correct:
            st["combo"] += 1
            st["maxcombo"] = max(st["maxcombo"], st["combo"])
            st["correct"] += 1
            st["score"] += 10 * mult()
            st["time"] = min(st["time"] + 2, 60)
        else:
            st["combo"] = 0
        score_lbl.configure(text=f"⭐ {st['score']}")
        combo_lbl.configure(text=f"🔥 {st['combo']}x ({mult()}x)" if st["combo"] >= 2 else "")
        self.after(250 if correct else 700, show_q)

    def show_q():
        if not st["running"]:
            return
        for w in qbox.winfo_children():
            w.destroy()
        if st["qidx"] >= len(pool):
            st["qidx"] = 0
            random.shuffle(pool)
        q = pool[st["qidx"]]
        st["qidx"] += 1

        ctk.CTkLabel(qbox, text=_display_text(q["prompt"]), font=("Segoe UI", 15, "bold"),
                     text_color=COLORS["text"], wraplength=620, justify="left"
                     ).grid(row=0, column=0, sticky="w", pady=(0, 12))

        if q["kind"] in ("choice", "multi"):
            opts = list(q["options"])
            random.shuffle(opts)
            for i, o in enumerate(opts):
                ctk.CTkButton(qbox, text=_display_text(o["text"]), height=44, anchor="w",
                              corner_radius=RADIUS_MD, fg_color=COLORS["card"],
                              text_color=COLORS["text"], hover_color=COLORS.get("card_hover", "#eef7f2"),
                              border_width=1, border_color=COLORS["border"], font=("Segoe UI", 13),
                              command=lambda oo=o: handle(q, oo["correct"], oo["text"])
                              ).grid(row=i + 1, column=0, sticky="ew", pady=3)
        else:
            entry = ctk.CTkEntry(qbox, height=40, font=("Segoe UI", 14), placeholder_text="Antwort…")
            entry.grid(row=1, column=0, sticky="ew", pady=4)
            entry.focus_set()

            def submit(_=None):
                val = entry.get().strip()
                if not val:
                    return
                if q["kind"] == "multi_text":
                    ok = _check_multi_text(q["blanks"], [val])
                else:
                    ok = _check_text(q["accept"], val)
                handle(q, ok, val)
            entry.bind("<Return>", submit)
            ctk.CTkButton(qbox, text="OK", height=36, fg_color=COLORS["primary"],
                          command=submit).grid(row=2, column=0, sticky="w", pady=4)

    def end():
        st["running"] = False
        coins = st["score"] // 5
        pct = round(st["correct"] / st["answered"] * 100) if st["answered"] else 0
        _game_end_screen(self, self.show_games, "⏱ Zeit abgelaufen!", [
            ("Punkte", f"⭐ {st['score']}"),
            ("Fragen beantwortet", st["answered"]),
            ("Richtig", f"{st['correct']} ({pct}%)"),
            ("Max Combo", f"🔥 {st['maxcombo']}x"),
            ("Münzen", f"🪙 +{coins}"),
        ], lambda: _run_speed(self, questions))

    show_q()
    self.after(1000, tick)


# =====================================================================
#  WER WIRD MILLIONÄR
# =====================================================================
_PRIZES = ["50 €", "100 €", "200 €", "300 €", "500 €", "1.000 €", "2.000 €",
           "4.000 €", "8.000 €", "16.000 €", "32.000 €", "64.000 €",
           "125.000 €", "500.000 €", "1.000.000 €"]
_PRIZE_PTS = [1, 2, 3, 4, 5, 7, 9, 12, 15, 18, 22, 27, 33, 40, 50]
_SAFE = {4, 9}


def show_millionaire(self):
    _game_setup(self, "💰 Wer wird Millionär",
                "15 Fragen mit steigender Schwierigkeit. Drei Joker: 50:50, Publikum, "
                "Überspringen. Sichere Stufen bei Frage 5 und 10.",
                lambda qs: _run_millionaire(self, qs))


def _run_millionaire(self, questions):
    choice_qs = [q for q in questions if q["kind"] == "choice"]
    if len(choice_qs) < 5:
        messagebox.showinfo("Hinweis", "Mindestens 5 Single-Choice-Fragen nötig.")
        self.show_games()
        return
    random.shuffle(choice_qs)
    ordered = choice_qs[:15]
    while len(ordered) < 15:
        ordered.append(random.choice(choice_qs))

    st = {"level": 0, "safe": 0, "jokers": {"fifty": True, "aud": True, "skip": True}}

    def render():
        if st["level"] >= 15:
            return win()
        self._clear_main()
        scroll = self._make_screen()
        scroll.grid_columnconfigure(0, weight=1)
        q = ordered[st["level"]]

        ctk.CTkLabel(scroll, text=f"Frage {st['level']+1}/15  —  {_PRIZES[st['level']]}",
                     font=("Segoe UI", 18, "bold"), text_color=COLORS["warning"]
                     ).grid(row=0, column=0, sticky="w", pady=(0, 10))
        ctk.CTkLabel(scroll, text=_display_text(q["prompt"]), font=("Segoe UI", 15, "bold"),
                     text_color=COLORS["text"], wraplength=620, justify="left"
                     ).grid(row=1, column=0, sticky="w", pady=(0, 12))

        opts = list(q["options"])
        random.shuffle(opts)
        obox = ctk.CTkFrame(scroll, fg_color="transparent")
        obox.grid(row=2, column=0, sticky="ew")
        obox.grid_columnconfigure(0, weight=1)
        btns = []
        eliminated = set()

        def answer(o, btn):
            for b in btns:
                b.configure(state="disabled")
            if o["correct"]:
                btn.configure(fg_color=COLORS["success"])
                if st["level"] in _SAFE:
                    st["safe"] = _PRIZE_PTS[st["level"]]
                st["level"] += 1
                self.after(1100, render)
            else:
                btn.configure(fg_color=COLORS["danger"])
                for b, oo in zip(btns, opts):
                    if oo["correct"]:
                        b.configure(fg_color=COLORS["success"])
                self.after(1300, lambda: game_over())

        for i, o in enumerate(opts):
            letter = string.ascii_uppercase[i]
            b = ctk.CTkButton(obox, text=f"{letter}:  {_display_text(o['text'])}", height=46,
                              anchor="w", corner_radius=RADIUS_MD, fg_color=COLORS["card"],
                              text_color=COLORS["text"], hover_color=COLORS.get("card_hover", "#eef7f2"),
                              border_width=1, border_color=COLORS["border"], font=("Segoe UI", 13))
            b.configure(command=lambda oo=o, bb=b: answer(oo, bb))
            b.grid(row=i, column=0, sticky="ew", pady=3)
            btns.append(b)

        # Jokers
        jrow = ctk.CTkFrame(scroll, fg_color="transparent")
        jrow.grid(row=3, column=0, pady=14)

        def use_fifty():
            if not st["jokers"]["fifty"]:
                return
            st["jokers"]["fifty"] = False
            jf.configure(state="disabled")
            wrong = [i for i, o in enumerate(opts) if not o["correct"]]
            random.shuffle(wrong)
            for i in wrong[:max(1, len(wrong) - 1)]:
                eliminated.add(i)
                btns[i].configure(state="disabled", text="—")

        def use_aud():
            if not st["jokers"]["aud"]:
                return
            st["jokers"]["aud"] = False
            ja.configure(state="disabled")
            ci = next(i for i, o in enumerate(opts) if o["correct"])
            pcts = []
            for i in range(len(opts)):
                if i in eliminated:
                    pcts.append(0)
                elif i == ci:
                    pcts.append(50 + random.randint(0, 30))
                else:
                    pcts.append(5 + random.randint(0, 15))
            tot = sum(pcts) or 1
            for i, b in enumerate(btns):
                p = round(pcts[i] / tot * 100)
                cur = b.cget("text")
                b.configure(text=f"{cur}   [{p}%]")

        def use_skip():
            if not st["jokers"]["skip"]:
                return
            st["jokers"]["skip"] = False
            if st["level"] in _SAFE:
                st["safe"] = _PRIZE_PTS[st["level"]]
            st["level"] += 1
            render()

        jf = ctk.CTkButton(jrow, text="50:50", width=90, fg_color=COLORS["info"],
                           state="normal" if st["jokers"]["fifty"] else "disabled", command=use_fifty)
        jf.grid(row=0, column=0, padx=6)
        ja = ctk.CTkButton(jrow, text="📊 Publikum", width=120, fg_color=COLORS["info"],
                           state="normal" if st["jokers"]["aud"] else "disabled", command=use_aud)
        ja.grid(row=0, column=1, padx=6)
        js = ctk.CTkButton(jrow, text="⏭ Überspringen", width=130, fg_color=COLORS["info"],
                           state="normal" if st["jokers"]["skip"] else "disabled", command=use_skip)
        js.grid(row=0, column=2, padx=6)

    def game_over():
        pts = st["safe"]
        _game_end_screen(self, self.show_games, "❌ Leider falsch!", [
            ("Erreicht", f"Frage {st['level']}/15"),
            ("Gesichert", _PRIZES[max((s for s in _SAFE if s < st['level']), default=-1)] if st['level'] else "0 €"),
            ("Punkte", f"⭐ {pts}"),
            ("Münzen", f"🪙 +{pts // 2}"),
        ], lambda: _run_millionaire(self, questions))

    def win():
        pts = _PRIZE_PTS[14]
        _game_end_screen(self, self.show_games, "🎉 MILLIONÄR!", [
            ("Alle 15 Fragen richtig!", "🏆"),
            ("Punkte", f"⭐ {pts}"),
            ("Münzen", f"🪙 +{pts // 2}"),
        ], lambda: _run_millionaire(self, questions))

    render()


# =====================================================================
#  GALGENMÄNNCHEN
# =====================================================================
def show_hangman(self):
    _game_setup(self, "💀 Galgenmännchen",
                "Errate den Begriff Buchstabe für Buchstabe. 7 Fehlversuche pro Wort.",
                lambda qs: _run_hangman(self, qs))


def _run_hangman(self, questions):
    text_qs = [q for q in questions if q["kind"] == "text"
               and 3 <= len(q["answer"]) <= 30]
    if len(text_qs) < 3:
        messagebox.showinfo("Hinweis", "Mindestens 3 Freitext-Fragen mit kurzer Antwort nötig.")
        self.show_games()
        return
    random.shuffle(text_qs)
    rounds = text_qs[:10]
    st = {"round": 0, "score": 0, "correct": 0}
    MAX_WRONG = 7

    def play():
        if st["round"] >= len(rounds):
            return finish()
        q = rounds[st["round"]]
        answer = q["answer"].strip()
        upper = answer.upper()
        unique = {c for c in upper if c.isalnum()}
        rst = {"revealed": set(), "wrong": 0, "guessed": set()}

        def render():
            self._clear_main()
            scroll = self._make_screen()
            scroll.grid_columnconfigure(0, weight=1)

            ctk.CTkLabel(scroll, text=f"Runde {st['round']+1}/{len(rounds)}    "
                         f"❤️ {MAX_WRONG - rst['wrong']}    ⭐ {st['score']}",
                         font=("Segoe UI", 14, "bold"), text_color=COLORS["text"]
                         ).grid(row=0, column=0, sticky="w", pady=(0, 8))
            ctk.CTkLabel(scroll, text=_display_text(q["prompt"]), font=("Segoe UI", 14),
                         text_color=COLORS["text_light"], wraplength=620, justify="left"
                         ).grid(row=1, column=0, sticky="w", pady=(0, 6))

            disp = " ".join(c if (not c.isalnum() or c.upper() in rst["revealed"]) else "_"
                            for c in answer)
            ctk.CTkLabel(scroll, text=disp, font=("Consolas", 26, "bold"),
                         text_color=COLORS["primary"]).grid(row=2, column=0, pady=16)

            won = unique <= rst["revealed"]
            lost = rst["wrong"] >= MAX_WRONG

            if won or lost:
                if won:
                    st["score"] += 10
                    st["correct"] += 1
                ctk.CTkLabel(scroll, text="✅ Richtig!" if won else f"❌ Antwort: {answer}",
                             font=("Segoe UI", 16, "bold"),
                             text_color=COLORS["success"] if won else COLORS["danger"]
                             ).grid(row=3, column=0, pady=10)
                ctk.CTkButton(scroll, text="Weiter →", width=160, height=40,
                              fg_color=COLORS["primary"], font=("Segoe UI", 14, "bold"),
                              command=lambda: (st.update(round=st["round"] + 1), play())
                              ).grid(row=4, column=0, pady=10)
                return

            kb = ctk.CTkFrame(scroll, fg_color="transparent")
            kb.grid(row=3, column=0, pady=10)
            letters = string.ascii_uppercase + "ÄÖÜ0123456789"
            per_row = 9
            for i, c in enumerate(letters):
                used = c in rst["guessed"]
                color = COLORS["card"]
                if used:
                    color = COLORS["success"] if c in rst["revealed"] else COLORS["danger"]

                def guess(ch=c):
                    if ch in rst["guessed"]:
                        return
                    rst["guessed"].add(ch)
                    if ch in unique:
                        rst["revealed"].add(ch)
                    else:
                        rst["wrong"] += 1
                    render()

                ctk.CTkButton(kb, text=c, width=42, height=38, corner_radius=RADIUS_SM,
                              fg_color=color, text_color=COLORS["text"] if not used else "#ffffff",
                              border_width=1, border_color=COLORS["border"],
                              font=("Segoe UI", 13, "bold"),
                              state="disabled" if used else "normal",
                              command=guess).grid(row=i // per_row, column=i % per_row, padx=2, pady=2)

            ctk.CTkButton(scroll, text="Auflösen", width=120, height=32,
                          fg_color=COLORS["card"], text_color=COLORS["text"],
                          border_width=1, border_color=COLORS["border"], font=("Segoe UI", 11),
                          command=lambda: (rst.update(wrong=MAX_WRONG), render())
                          ).grid(row=4, column=0, pady=8)

        render()

    def finish():
        _game_end_screen(self, self.show_games, "🎯 Galgenmännchen beendet!", [
            ("Erraten", f"{st['correct']}/{len(rounds)}"),
            ("Punkte", f"⭐ {st['score']}"),
            ("Münzen", f"🪙 +{st['score']}"),
        ], lambda: _run_hangman(self, questions))

    play()


# =====================================================================
#  BOSS-KAMPF
# =====================================================================
def show_boss_fight(self):
    _game_setup(self, "👹 Boss-Kampf",
                "Kämpfe gegen deine schwächsten Fragen! Richtige Antworten verletzen "
                "den Boss, falsche kosten dich Lebenspunkte. Combos erhöhen den Schaden.",
                lambda qs: _run_boss(self, qs), weakest=True)


def _run_boss(self, questions):
    pool = questions[:20]
    st = {"boss": len(pool) * 20, "bossmax": len(pool) * 20, "hp": 100,
          "qidx": 0, "score": 0, "combo": 0, "correct": 0, "total": 0}

    def render():
        if st["boss"] <= 0:
            return finish(True)
        if st["hp"] <= 0:
            return finish(False)
        if st["qidx"] >= len(pool):
            return finish(True)
        self._clear_main()
        scroll = self._make_screen()
        scroll.grid_columnconfigure(0, weight=1)
        q = pool[st["qidx"]]

        arena = ctk.CTkFrame(scroll, fg_color="transparent")
        arena.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        arena.grid_columnconfigure((0, 1, 2), weight=1)
        ctk.CTkLabel(arena, text=f"👹\nBoss\n{st['boss']}/{st['bossmax']} HP",
                     font=("Segoe UI", 14, "bold"), text_color=COLORS["danger"]
                     ).grid(row=0, column=0)
        ctk.CTkLabel(arena, text="⚔️", font=("Segoe UI", 22)).grid(row=0, column=1)
        ctk.CTkLabel(arena, text=f"🧙\nDu\n{st['hp']}/100 HP",
                     font=("Segoe UI", 14, "bold"), text_color=COLORS["success"]
                     ).grid(row=0, column=2)

        if st["combo"] >= 2:
            ctk.CTkLabel(scroll, text=f"🔥 {st['combo']}x Combo", font=("Segoe UI", 13, "bold"),
                         text_color=COLORS["warning"]).grid(row=1, column=0, pady=(0, 4))

        ctk.CTkLabel(scroll, text=_display_text(q["prompt"]), font=("Segoe UI", 15, "bold"),
                     text_color=COLORS["text"], wraplength=620, justify="left"
                     ).grid(row=2, column=0, sticky="w", pady=(4, 12))

        qbox = ctk.CTkFrame(scroll, fg_color="transparent")
        qbox.grid(row=3, column=0, sticky="ew")
        qbox.grid_columnconfigure(0, weight=1)

        def resolve(correct):
            st["total"] += 1
            st["qidx"] += 1
            if correct:
                st["combo"] += 1
                st["correct"] += 1
                dmg = 20 + (15 if st["combo"] >= 5 else 10 if st["combo"] >= 3 else 0)
                st["boss"] -= dmg
                st["score"] += dmg
                msg, color = f"⚔️ Treffer! -{dmg} Boss-HP", COLORS["success"]
            else:
                st["combo"] = 0
                dmg = 15 + random.randint(0, 10)
                st["hp"] -= dmg
                msg, color = f"💥 Der Boss trifft dich! -{dmg} HP", COLORS["danger"]
            for w in qbox.winfo_children():
                w.destroy()
            ctk.CTkLabel(qbox, text=msg, font=("Segoe UI", 15, "bold"), text_color=color
                         ).grid(row=0, column=0, pady=20)
            self.after(1000, render)

        if q["kind"] in ("choice", "multi"):
            opts = list(q["options"])
            random.shuffle(opts)
            for i, o in enumerate(opts):
                ctk.CTkButton(qbox, text=_display_text(o["text"]), height=44, anchor="w",
                              corner_radius=RADIUS_MD, fg_color=COLORS["card"],
                              text_color=COLORS["text"], hover_color=COLORS.get("card_hover", "#eef7f2"),
                              border_width=1, border_color=COLORS["border"], font=("Segoe UI", 13),
                              command=lambda oo=o: resolve(oo["correct"])
                              ).grid(row=i, column=0, sticky="ew", pady=3)
        else:
            entry = ctk.CTkEntry(qbox, height=40, font=("Segoe UI", 14), placeholder_text="Antwort…")
            entry.grid(row=0, column=0, sticky="ew", pady=4)
            entry.focus_set()

            def submit(_=None):
                val = entry.get().strip()
                if not val:
                    return
                ok = (_check_multi_text(q["blanks"], [val]) if q["kind"] == "multi_text"
                      else _check_text(q["accept"], val))
                resolve(ok)
            entry.bind("<Return>", submit)
            ctk.CTkButton(qbox, text="⚔️ Angriff!", height=36, fg_color=COLORS["primary"],
                          command=submit).grid(row=1, column=0, sticky="w", pady=4)

    def finish(won):
        coins = st["score"] // (3 if won else 5)
        _game_end_screen(self, self.show_games,
                         "🏆 Boss besiegt!" if won else "💀 Niederlage!", [
                             ("Richtig", f"{st['correct']}/{st['total']}"),
                             ("Boss-HP übrig", max(0, st["boss"])),
                             ("Deine HP", max(0, st["hp"])),
                             ("Punkte", f"⭐ {st['score']}"),
                             ("Münzen", f"🪙 +{coins}"),
                         ], lambda: _run_boss(self, questions))

    render()
