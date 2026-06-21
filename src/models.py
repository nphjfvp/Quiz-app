"""Data models for the Quiz application."""

import json
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
    DIAGRAM_LABEL = "diagram_label"


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
        self.data_dir.mkdir(exist_ok=True)
        self.quizzes_file = self.data_dir / "quizzes.json"
        self.progress_file = self.data_dir / "progress.json"
        self.settings_file = self.data_dir / "settings.json"
        self.stats_file = self.data_dir / "stats.json"

    def load_quizzes(self) -> list[Quiz]:
        if not self.quizzes_file.exists():
            return []
        with open(self.quizzes_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return [Quiz.from_dict(q) for q in data]

    def save_quizzes(self, quizzes: list[Quiz]):
        with open(self.quizzes_file, "w", encoding="utf-8") as f:
            json.dump([q.to_dict() for q in quizzes], f, ensure_ascii=False, indent=2)

    def load_progress(self) -> dict[str, QuestionProgress]:
        if not self.progress_file.exists():
            return {}
        with open(self.progress_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        result = {}
        for k, v in data.items():
            result[k] = QuestionProgress(**v)
        return result

    def save_progress(self, progress: dict[str, QuestionProgress]):
        with open(self.progress_file, "w", encoding="utf-8") as f:
            json.dump({k: asdict(v) for k, v in progress.items()}, f, ensure_ascii=False, indent=2)

    def load_settings(self) -> dict:
        if not self.settings_file.exists():
            return {}
        with open(self.settings_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_settings(self, settings: dict):
        with open(self.settings_file, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)

    # ── Study stats: a daily-aggregated log of answers ──

    def load_stats(self) -> dict:
        """Returns {date_iso: {"answered": int, "correct": int}}."""
        if not self.stats_file.exists():
            return {}
        with open(self.stats_file, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}

    def save_stats(self, stats: dict):
        with open(self.stats_file, "w", encoding="utf-8") as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)

    def load_fsrs(self) -> dict:
        path = self.data_dir / "fsrs.json"
        if not path.exists():
            return {}
        with open(path, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}

    def save_fsrs(self, data: dict):
        path = self.data_dir / "fsrs.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def load_source_texts(self) -> dict:
        path = self.data_dir / "source_texts.json"
        if not path.exists():
            return {}
        with open(path, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}

    def save_source_text(self, filename: str, text: str):
        texts = self.load_source_texts()
        texts[filename] = text
        path = self.data_dir / "source_texts.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(texts, f, ensure_ascii=False, indent=2)

    # ── Marked questions ──

    def load_marked(self) -> list[str]:
        path = self.data_dir / "marked.json"
        if not path.exists():
            return []
        with open(path, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return []

    def save_marked(self, ids: list[str]):
        path = self.data_dir / "marked.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(ids, f, ensure_ascii=False, indent=2)

    # ── Quick actions ──

    def load_quick_actions(self) -> list[dict]:
        path = self.data_dir / "quick_actions.json"
        if not path.exists():
            return []
        with open(path, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return []

    def save_quick_actions(self, actions: list[dict]):
        path = self.data_dir / "quick_actions.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(actions, f, ensure_ascii=False, indent=2)

    # ── Memory / learning profile ──

    def load_memory(self) -> str:
        path = self.data_dir / "memory.json"
        if not path.exists():
            return ""
        with open(path, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
                return data.get("text", "")
            except json.JSONDecodeError:
                return ""

    def save_memory(self, text: str):
        path = self.data_dir / "memory.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"text": text}, f, ensure_ascii=False, indent=2)

    def log_answer(self, correct: bool):
        stats = self.load_stats()
        today = date.today().isoformat()
        day = stats.setdefault(today, {"answered": 0, "correct": 0})
        day["answered"] += 1
        if correct:
            day["correct"] += 1
        self.save_stats(stats)
