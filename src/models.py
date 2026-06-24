"""Data models for the Quiz application."""

import json
import os
import uuid
from datetime import date
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional
from pathlib import Path


class QuestionType(str, Enum):
    SINGLE_CHOICE = "single_choice"
    MULTIPLE_CHOICE = "multiple_choice"
    FREE_TEXT = "free_text"
    FILL_BLANK = "fill_blank"
    DRAG_DROP = "drag_drop"
    DRAG_CATEGORY = "drag_category"
    DIAGRAM_LABEL = "diagram_label"
    MARK_IMAGE = "mark_image"
    MATH_FORMULA = "math_formula"


@dataclass
class Option:
    text: str
    is_correct: bool = False


@dataclass
class DragDropPair:
    source: str
    target: str


@dataclass
class DiagramLabel:
    label: str
    x: float
    y: float


@dataclass
class Question:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    question_type: QuestionType = QuestionType.SINGLE_CHOICE
    title: str = ""
    text: str = ""
    points: int = 1
    topic: str = ""
    weight: float = 1.0
    image_path: str = ""
    options: list[Option] = field(default_factory=list)
    correct_text: str = ""
    blanks: list[str] = field(default_factory=list)
    drag_drop_pairs: list[DragDropPair] = field(default_factory=list)
    diagram_image_path: str = ""
    diagram_labels: list[DiagramLabel] = field(default_factory=list)
    mark_regions: list[dict] = field(default_factory=list)
    correct_formula: str = ""
    tolerance: float = 0.0
    explanation: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["question_type"] = self.question_type.value
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Question":
        d = d.copy()
        d["question_type"] = QuestionType(d["question_type"])
        d["options"] = [Option(**o) for o in d.get("options", [])]
        d["drag_drop_pairs"] = [DragDropPair(**p) for p in d.get("drag_drop_pairs", [])]
        d["diagram_labels"] = [DiagramLabel(**l) for l in d.get("diagram_labels", [])]
        return cls(**d)


@dataclass
class FormulaVariable:
    """A single variable inside a formula, e.g. a, b, c in the abc-formula."""
    symbol: str = ""          # e.g. "a", "U", "F"
    name: str = ""            # human label, e.g. "Spannung"
    unit: str = ""            # e.g. "V", "m/s", "" for dimensionless


@dataclass
class Formula:
    """A formula in the digital formula sheet (FoSa).

    `latex` is the display form. `template` is the same formula with each
    variable wrapped in {{symbol}} placeholders so the UI can render empty
    input fields, e.g. "x = \\frac{-{{b}} \\pm \\sqrt{{{b}}^2 - 4{{a}}{{c}}}}{2{{a}}}".
    `expression` is a plain-python evaluable form (using the symbols) so the
    result can be computed once the user enters values, e.g.
    "(-b + (b**2 - 4*a*c)**0.5) / (2*a)".
    """
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""            # e.g. "abc-Formel", "Ohmsches Gesetz"
    category: str = ""        # e.g. "Mathematik", "Physik", "E-Technik"
    latex: str = ""           # display LaTeX
    template: str = ""        # LaTeX with {{symbol}} placeholders for inputs
    expression: str = ""      # python-evaluable expression for the result
    result_symbol: str = ""   # symbol the expression solves for, e.g. "x"
    variables: list[FormulaVariable] = field(default_factory=list)
    description: str = ""     # when/how the formula is used

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Formula":
        d = d.copy()
        d["variables"] = [FormulaVariable(**v) for v in d.get("variables", [])]
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class FormulaSheet:
    """A collection of formulas (Formelsammlung) for one subject/document."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""            # e.g. "Physik 1 – Mechanik"
    subject: str = ""         # e.g. "Physik"
    formulas: list[Formula] = field(default_factory=list)
    created: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "subject": self.subject,
            "created": self.created,
            "formulas": [f.to_dict() for f in self.formulas],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "FormulaSheet":
        return cls(
            id=d.get("id", str(uuid.uuid4())),
            name=d.get("name", ""),
            subject=d.get("subject", ""),
            created=d.get("created", ""),
            formulas=[Formula.from_dict(f) for f in d.get("formulas", [])],
        )


@dataclass
class MemoryEntry:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    category: str = ""  # "weakness", "strength", "preference", "fact", "custom"
    text: str = ""
    source: str = ""  # "auto" or "manual"
    created: str = ""
    topic: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "MemoryEntry":
        valid = {f.name for f in cls.__dataclass_fields__.values()}
        return cls(**{k: v for k, v in d.items() if k in valid})


@dataclass
class Folder:
    """A folder grouping multiple quizzes (e.g. all PDFs for one exam)."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    quiz_ids: list[str] = field(default_factory=list)
    created: str = ""

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "quiz_ids": self.quiz_ids, "created": self.created}

    @classmethod
    def from_dict(cls, d: dict) -> "Folder":
        return cls(
            id=d.get("id", str(uuid.uuid4())),
            name=d.get("name", ""),
            quiz_ids=d.get("quiz_ids", []),
            created=d.get("created", ""),
        )


class LeitnerBox(int, Enum):
    BOX_1 = 1
    BOX_2 = 2
    BOX_3 = 3
    BOX_4 = 4
    BOX_5 = 5


@dataclass
class QuestionProgress:
    question_id: str = ""
    box: int = 1
    times_correct: int = 0
    times_wrong: int = 0
    last_seen: str = ""


@dataclass
class Quiz:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    description: str = ""
    questions: list[Question] = field(default_factory=list)
    created: str = ""
    exam_date: str = ""
    weight: float = 1.0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "created": self.created,
            "exam_date": self.exam_date,
            "weight": self.weight,
            "questions": [q.to_dict() for q in self.questions],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Quiz":
        questions = [Question.from_dict(q) for q in d.get("questions", [])]
        return cls(
            id=d.get("id", str(uuid.uuid4())),
            name=d.get("name", ""),
            description=d.get("description", ""),
            created=d.get("created", ""),
            exam_date=d.get("exam_date", ""),
            weight=d.get("weight", 1.0),
            questions=questions,
        )


class DataStore:
    def __init__(self, data_dir: str = "data"):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.quizzes_file = self.data_dir / "quizzes.json"
        self.progress_file = self.data_dir / "progress.json"
        self.settings_file = self.data_dir / "settings.json"
        self.stats_file = self.data_dir / "stats.json"

    # ── Crash-safe JSON helpers ──

    def _read_json(self, path: Path, default):
        """Read JSON safely. On corruption, fall back to the .bak backup,
        then to `default`. Never raises – a damaged file must not break the app."""
        for candidate in (path, path.with_suffix(path.suffix + ".bak")):
            if not candidate.exists():
                continue
            try:
                with open(candidate, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError, UnicodeDecodeError):
                continue
        return default

    def _atomic_write(self, path: Path, data):
        """Write JSON atomically: dump to a temp file, fsync, keep the previous
        good copy as .bak, then os.replace (atomic on the same filesystem).
        A crash mid-write can never leave a half-written target file."""
        tmp = path.with_suffix(path.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        if path.exists():
            try:
                os.replace(path, path.with_suffix(path.suffix + ".bak"))
            except OSError:
                pass
        os.replace(tmp, path)

    def load_quizzes(self) -> list[Quiz]:
        data = self._read_json(self.quizzes_file, [])
        return [Quiz.from_dict(q) for q in data]

    def save_quizzes(self, quizzes: list[Quiz]):
        self._atomic_write(self.quizzes_file, [q.to_dict() for q in quizzes])

    def load_progress(self) -> dict[str, QuestionProgress]:
        data = self._read_json(self.progress_file, {})
        return {k: QuestionProgress(**v) for k, v in data.items()}

    def save_progress(self, progress: dict[str, QuestionProgress]):
        self._atomic_write(self.progress_file, {k: asdict(v) for k, v in progress.items()})

    def merge_progress(self, remote: dict):
        """Merge a remote progress dict into local progress.

        For each question, keep the entry with more total attempts (a rough
        proxy for "more up to date"); newly seen remote entries are added.
        """
        local = self.load_progress()
        for qid, rdata in (remote or {}).items():
            try:
                rp = QuestionProgress(**rdata)
            except Exception:
                continue
            lp = local.get(qid)
            if lp is None:
                local[qid] = rp
            else:
                r_total = rp.times_correct + rp.times_wrong
                l_total = lp.times_correct + lp.times_wrong
                if r_total > l_total:
                    local[qid] = rp
        self.save_progress(local)

    def load_settings(self) -> dict:
        return self._read_json(self.settings_file, {})

    def save_settings(self, settings: dict):
        self._atomic_write(self.settings_file, settings)

    # ── Study stats: a daily-aggregated log of answers ──

    def load_stats(self) -> dict:
        """Returns {date_iso: {"answered": int, "correct": int}}."""
        return self._read_json(self.stats_file, {})

    def save_stats(self, stats: dict):
        self._atomic_write(self.stats_file, stats)

    def load_fsrs(self) -> dict:
        return self._read_json(self.data_dir / "fsrs.json", {})

    def save_fsrs(self, data: dict):
        self._atomic_write(self.data_dir / "fsrs.json", data)

    def load_source_texts(self) -> dict:
        return self._read_json(self.data_dir / "source_texts.json", {})

    def save_source_text(self, filename: str, text: str):
        texts = self.load_source_texts()
        texts[filename] = text
        self._atomic_write(self.data_dir / "source_texts.json", texts)

    # ── Study materials (Skript/Vorlesung linked to a quiz) ──

    def load_materials(self) -> dict:
        """Returns {quiz_id: {"text": str, "name": str, "saved": iso}}."""
        return self._read_json(self.data_dir / "materials.json", {})

    def save_materials(self, materials: dict):
        self._atomic_write(self.data_dir / "materials.json", materials)

    def save_material(self, quiz_id: str, material: dict):
        m = self.load_materials()
        m[quiz_id] = material
        self.save_materials(m)

    def get_material(self, quiz_id: str):
        return self.load_materials().get(quiz_id)

    def delete_material(self, quiz_id: str):
        m = self.load_materials()
        if quiz_id in m:
            del m[quiz_id]
            self.save_materials(m)

    # ── Achievements ──

    def load_achievements(self) -> dict:
        return self._read_json(self.data_dir / "achievements.json", {})

    def save_achievements(self, data: dict):
        self._atomic_write(self.data_dir / "achievements.json", data)

    # ── Folders ──

    def load_folders(self) -> list[Folder]:
        data = self._read_json(self.data_dir / "folders.json", [])
        return [Folder.from_dict(d) for d in data]

    def save_folders(self, folders: list[Folder]):
        self._atomic_write(self.data_dir / "folders.json", [f.to_dict() for f in folders])

    # ── Formula sheets (FoSa) ──

    def load_formula_sheets(self) -> list[FormulaSheet]:
        data = self._read_json(self.data_dir / "formula_sheets.json", [])
        return [FormulaSheet.from_dict(s) for s in data]

    def save_formula_sheets(self, sheets: list[FormulaSheet]):
        self._atomic_write(self.data_dir / "formula_sheets.json", [s.to_dict() for s in sheets])

    # ── Marked questions ──

    def load_marked(self) -> list[str]:
        return self._read_json(self.data_dir / "marked.json", [])

    def save_marked(self, ids: list[str]):
        self._atomic_write(self.data_dir / "marked.json", ids)

    # ── Quick actions ──

    def load_quick_actions(self) -> list[dict]:
        return self._read_json(self.data_dir / "quick_actions.json", [])

    def save_quick_actions(self, actions: list[dict]):
        self._atomic_write(self.data_dir / "quick_actions.json", actions)

    # ── Memory / learning profile ──

    def load_memory(self) -> str:
        data = self._read_json(self.data_dir / "memory.json", {})
        return data.get("text", data.get("profile_text", ""))

    def save_memory(self, text: str):
        existing = self._load_memory_data()
        existing["profile_text"] = text
        existing.setdefault("entries", [])
        self._atomic_write(self.data_dir / "memory.json", existing)

    def _load_memory_data(self) -> dict:
        data = self._read_json(self.data_dir / "memory.json", None)
        if not isinstance(data, dict):
            return {"profile_text": "", "entries": []}
        if "entries" not in data:
            return {"profile_text": data.get("text", ""), "entries": []}
        return data

    def load_memory_entries(self) -> list[MemoryEntry]:
        data = self._load_memory_data()
        return [MemoryEntry.from_dict(e) for e in data.get("entries", [])]

    def save_memory_entries(self, entries: list[MemoryEntry]):
        data = self._load_memory_data()
        data["entries"] = [e.to_dict() for e in entries]
        self._atomic_write(self.data_dir / "memory.json", data)

    def add_memory_entry(self, entry: MemoryEntry):
        entries = self.load_memory_entries()
        entries.append(entry)
        self.save_memory_entries(entries)

    def delete_memory_entry(self, entry_id: str):
        entries = self.load_memory_entries()
        entries = [e for e in entries if e.id != entry_id]
        self.save_memory_entries(entries)

    def get_full_memory_prompt(self) -> str:
        profile = self.load_memory()
        entries = self.load_memory_entries()
        parts = []
        if profile:
            parts.append(f"Lernprofil:\n{profile}")
        if entries:
            by_cat = {}
            for e in entries:
                by_cat.setdefault(e.category, []).append(e)
            cat_labels = {
                "weakness": "Schwächen", "strength": "Stärken",
                "preference": "Lern-Präferenzen", "fact": "Fakten",
                "custom": "Notizen"
            }
            for cat, items in by_cat.items():
                label = cat_labels.get(cat, cat)
                lines = [f"- {e.text}" + (f" (Thema: {e.topic})" if e.topic else "") for e in items]
                parts.append(f"{label}:\n" + "\n".join(lines))
        return "\n\n".join(parts)

    def load_daily_state(self) -> dict:
        """Load daily learning state. Returns {"date": "2024-01-01", "completed": [...question_ids], "wrong": [...question_ids], "extra_done": bool}"""
        return self._read_json(self.data_dir / "daily.json", {})

    def save_daily_state(self, state: dict):
        self._atomic_write(self.data_dir / "daily.json", state)

    def log_answer(self, correct: bool):
        stats = self.load_stats()
        today = date.today().isoformat()
        day = stats.setdefault(today, {"answered": 0, "correct": 0})
        day["answered"] += 1
        if correct:
            day["correct"] += 1
        self.save_stats(stats)

    # ── Error Diary ──

    def load_error_diary(self) -> list[dict]:
        return self._read_json(self.data_dir / "error_diary.json", [])

    def save_error_diary(self, diary: list[dict]):
        self._atomic_write(self.data_dir / "error_diary.json", diary)

    def log_wrong_answer(self, question_text: str, topic: str, correct_answer: str,
                          user_answer: str, quiz_name: str = ""):
        diary = self.load_error_diary()
        diary.append({
            "date": date.today().isoformat(),
            "time": __import__("datetime").datetime.now().strftime("%H:%M"),
            "question": question_text[:200],
            "topic": topic,
            "correct": correct_answer[:200],
            "user_answer": user_answer[:200],
            "quiz": quiz_name,
        })
        if len(diary) > 500:
            diary = diary[-500:]
        self.save_error_diary(diary)

    # ── Streak ──

    def get_streak(self) -> tuple[int, int]:
        stats = self.load_stats()
        if not stats:
            return 0, 0
        today = date.today()
        current_streak = 0
        check = today
        while check.isoformat() in stats:
            current_streak += 1
            check = check - __import__("datetime").timedelta(days=1)
        if today.isoformat() not in stats:
            yesterday = (today - __import__("datetime").timedelta(days=1))
            if yesterday.isoformat() in stats:
                check = yesterday
                current_streak = 0
                while check.isoformat() in stats:
                    current_streak += 1
                    check = check - __import__("datetime").timedelta(days=1)
        max_streak = 0
        sorted_days = sorted(stats.keys())
        s = 1
        for i in range(1, len(sorted_days)):
            d1 = date.fromisoformat(sorted_days[i - 1])
            d2 = date.fromisoformat(sorted_days[i])
            if (d2 - d1).days == 1:
                s += 1
            else:
                max_streak = max(max_streak, s)
                s = 1
        max_streak = max(max_streak, s)
        return current_streak, max_streak

    # ── Exam Archive ──

    def load_exam_archive(self) -> list[dict]:
        return self._read_json(self.data_dir / "exam_archive.json", [])

    def save_exam_attempt(self, attempt: dict):
        archive = self.load_exam_archive()
        archive.append(attempt)
        if len(archive) > 100:
            archive = archive[-100:]
        self._atomic_write(self.data_dir / "exam_archive.json", archive)
