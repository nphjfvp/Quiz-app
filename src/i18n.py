"""Lightweight internationalization (i18n) for the Lerntrainer app.

Usage:
    from .i18n import t, set_language
    t("home.title")            # -> translated string for current language
    t("results.score", pct=80) # -> with formatting

Languages: "de" (German, default), "en" (English).
Falls back to the key itself if a translation is missing.
"""

_current = {"lang": "de"}

_listeners = []


def set_language(lang: str):
    if lang in TRANSLATIONS:
        _current["lang"] = lang
        for cb in list(_listeners):
            try:
                cb(lang)
            except Exception:
                pass


def get_language() -> str:
    return _current["lang"]


def on_change(callback):
    """Register a callback fired when the language changes."""
    _listeners.append(callback)


def t(key: str, **kwargs) -> str:
    lang = _current["lang"]
    table = TRANSLATIONS.get(lang, {})
    text = table.get(key)
    if text is None:
        # fall back to German, then to the raw key
        text = TRANSLATIONS["de"].get(key, key)
    if kwargs:
        try:
            text = text.format(**kwargs)
        except (KeyError, IndexError):
            pass
    return text


TRANSLATIONS = {
    "de": {
        "app.title": "Lerntrainer – Quiz App",
        "app.header": "Lerntrainer",
        "app.subtitle": "Quiz & Klausurvorbereitung",
        "nav.back": "Zurück",
        "nav.back_menu": "Zurück zum Menü",
        "nav.save": "Speichern",
        "nav.cancel": "Abbrechen",
        "home.welcome": "Willkommen beim Lerntrainer",
        "home.welcome_sub": "Erstelle Quizze, lerne mit Wiederholungen und bereite dich auf Klausuren vor.",
        "home.new_quiz": "Neues Quiz",
        "home.new_quiz_sub": "Quiz manuell erstellen",
        "home.ai_generate": "KI-Generierung",
        "home.ai_generate_sub": "Fragen aus Folien generieren",
        "home.import": "Fragen importieren",
        "home.import_sub": "Aus Übungsdokument importieren",
        "home.settings": "Einstellungen",
        "home.settings_sub": "API-Key & Modell",
        "home.stats": "Statistik",
        "home.stats_sub": "Lernfortschritt ansehen",
        "home.pomodoro": "Pomodoro",
        "home.pomodoro_sub": "Fokus-Timer zum Lernen",
        "home.import_quiz": "Quiz importieren",
        "home.import_quiz_sub": "Quiz aus Datei laden",
        "home.your_quizzes": "Deine Quizze",
        "home.no_quizzes": "Noch keine Quizze erstellt. Starte mit einer der Optionen oben!",
        "home.open": "Öffnen",
        "card.questions": "{n} Fragen",
        "card.learn": "Lernen",
        "card.edit": "Bearbeiten",
        "card.export": "Export",
        "settings.title": "Einstellungen",
        "settings.api_key": "OpenRouter API-Key",
        "settings.model": "Modell",
        "settings.model_hint": "Empfohlen: deepseek/deepseek-chat, google/gemini-2.5-flash, anthropic/claude-sonnet-4-6",
        "settings.appearance": "Darstellung",
        "settings.dark_mode": "Dunkelmodus",
        "settings.language": "Sprache",
        "settings.saved": "Einstellungen gespeichert!",
        "modes.exam": "Klausur-Modus",
        "modes.exam_sub": "Alle Fragen mit Timer, Auswertung am Ende",
        "modes.single": "Einzelfragen",
        "modes.single_sub": "Frage für Frage mit sofortiger Korrektur",
        "modes.weak": "Schwächen üben",
        "modes.weak_sub": "Spaced Repetition: schwache Fragen gezielt",
        "modes.topic": "Themen-Modus",
        "modes.topic_sub": "Zufällige Fragen, optional nach Thema gefiltert",
        "modes.flashcards": "Karteikarten",
        "modes.flashcards_sub": "Frage vorne, Antwort hinten – zum Wiederholen",
        "modes.start": "Starten",
        "modes.topic_filter": "Themenfilter",
        "modes.all_topics": "Alle Themen",
        "stats.title": "Lernstatistik",
        "stats.per_day": "Beantwortete Fragen pro Tag",
        "stats.accuracy": "Trefferquote pro Tag",
        "stats.box_dist": "Verteilung der Leitner-Boxen",
        "stats.totals": "Gesamt: {answered} Antworten · {correct} richtig · {pct:.0f}% Quote",
        "stats.no_data": "Noch keine Lerndaten vorhanden. Beantworte ein paar Fragen!",
        "pomodoro.title": "Pomodoro-Timer",
        "pomodoro.focus": "Fokus",
        "pomodoro.break": "Pause",
        "pomodoro.start": "Start",
        "pomodoro.pause": "Pause",
        "pomodoro.reset": "Zurücksetzen",
        "pomodoro.round": "Runde {n}",
        "pomodoro.hint": "25 Minuten konzentriert lernen, dann 5 Minuten Pause.",
        "flash.show_answer": "Antwort zeigen",
        "flash.know": "Gewusst",
        "flash.dont_know": "Nicht gewusst",
        "flash.front": "Frage",
        "flash.back": "Antwort",
        "flash.done": "Alle Karten durchgesehen!",
    },
    "en": {
        "app.title": "Study Trainer – Quiz App",
        "app.header": "Study Trainer",
        "app.subtitle": "Quiz & exam preparation",
        "nav.back": "Back",
        "nav.back_menu": "Back to menu",
        "nav.save": "Save",
        "nav.cancel": "Cancel",
        "home.welcome": "Welcome to the Study Trainer",
        "home.welcome_sub": "Create quizzes, learn with spaced repetition and prepare for exams.",
        "home.new_quiz": "New Quiz",
        "home.new_quiz_sub": "Create a quiz manually",
        "home.ai_generate": "AI Generation",
        "home.ai_generate_sub": "Generate questions from slides",
        "home.import": "Import Questions",
        "home.import_sub": "Import from exercise document",
        "home.settings": "Settings",
        "home.settings_sub": "API key & model",
        "home.stats": "Statistics",
        "home.stats_sub": "View learning progress",
        "home.pomodoro": "Pomodoro",
        "home.pomodoro_sub": "Focus timer for studying",
        "home.import_quiz": "Import Quiz",
        "home.import_quiz_sub": "Load a quiz from a file",
        "home.your_quizzes": "Your Quizzes",
        "home.no_quizzes": "No quizzes yet. Start with one of the options above!",
        "home.open": "Open",
        "card.questions": "{n} questions",
        "card.learn": "Study",
        "card.edit": "Edit",
        "card.export": "Export",
        "settings.title": "Settings",
        "settings.api_key": "OpenRouter API key",
        "settings.model": "Model",
        "settings.model_hint": "Recommended: deepseek/deepseek-chat, google/gemini-2.5-flash, anthropic/claude-sonnet-4-6",
        "settings.appearance": "Appearance",
        "settings.dark_mode": "Dark mode",
        "settings.language": "Language",
        "settings.saved": "Settings saved!",
        "modes.exam": "Exam Mode",
        "modes.exam_sub": "All questions with timer, evaluation at the end",
        "modes.single": "Single Questions",
        "modes.single_sub": "Question by question with instant feedback",
        "modes.weak": "Practice Weak Spots",
        "modes.weak_sub": "Spaced repetition: target weak questions",
        "modes.topic": "Topic Mode",
        "modes.topic_sub": "Random questions, optionally filtered by topic",
        "modes.flashcards": "Flashcards",
        "modes.flashcards_sub": "Question front, answer back – for review",
        "modes.start": "Start",
        "modes.topic_filter": "Topic filter",
        "modes.all_topics": "All topics",
        "stats.title": "Learning Statistics",
        "stats.per_day": "Questions answered per day",
        "stats.accuracy": "Accuracy per day",
        "stats.box_dist": "Leitner box distribution",
        "stats.totals": "Total: {answered} answers · {correct} correct · {pct:.0f}% accuracy",
        "stats.no_data": "No learning data yet. Answer a few questions!",
        "pomodoro.title": "Pomodoro Timer",
        "pomodoro.focus": "Focus",
        "pomodoro.break": "Break",
        "pomodoro.start": "Start",
        "pomodoro.pause": "Pause",
        "pomodoro.reset": "Reset",
        "pomodoro.round": "Round {n}",
        "pomodoro.hint": "Study focused for 25 minutes, then take a 5-minute break.",
        "flash.show_answer": "Show answer",
        "flash.know": "Knew it",
        "flash.dont_know": "Didn't know",
        "flash.front": "Question",
        "flash.back": "Answer",
        "flash.done": "All cards reviewed!",
    },
}
