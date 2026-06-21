"""Quiz engine handling quiz sessions, scoring, and spaced repetition."""

import math
import random
import time
from datetime import datetime, date
from dataclasses import dataclass
from typing import Optional
from .models import Question, QuestionType, QuestionProgress, Quiz, DataStore


@dataclass
class AnswerResult:
    question_id: str
    is_correct: bool
    score: float
    max_score: float
    user_answer: str
    correct_answer: str


class QuizSession:
    def __init__(self, questions: list[Question], mode: str = "single",
                 time_limit: int = 0):
        self.questions = questions
        self.mode = mode
        self.time_limit = time_limit
        self.current_index = 0
        self.answers: dict[str, AnswerResult] = {}
        self.start_time = time.time()

    @property
    def current_question(self) -> Optional[Question]:
        if 0 <= self.current_index < len(self.questions):
            return self.questions[self.current_index]
        return None

    @property
    def is_finished(self) -> bool:
        return self.current_index >= len(self.questions)

    @property
    def time_remaining(self) -> int:
        if self.time_limit <= 0:
            return -1
        elapsed = time.time() - self.start_time
        return max(0, self.time_limit - int(elapsed))

    @property
    def total_score(self) -> float:
        return sum(a.score for a in self.answers.values())

    @property
    def max_possible_score(self) -> float:
        return sum(q.points for q in self.questions)

    @property
    def progress_fraction(self) -> float:
        if not self.questions:
            return 0
        return len(self.answers) / len(self.questions)

    def check_answer(self, question: Question, user_input) -> AnswerResult:
        qt = question.question_type
        if qt == QuestionType.SINGLE_CHOICE:
            return self._check_single_choice(question, user_input)
        elif qt == QuestionType.MULTIPLE_CHOICE:
            return self._check_multiple_choice(question, user_input)
        elif qt == QuestionType.FREE_TEXT:
            return self._check_free_text(question, user_input)
        elif qt == QuestionType.FILL_BLANK:
            return self._check_fill_blank(question, user_input)
        elif qt == QuestionType.DRAG_DROP:
            return self._check_drag_drop(question, user_input)
        elif qt == QuestionType.DIAGRAM_LABEL:
            return self._check_diagram_label(question, user_input)
        elif qt == QuestionType.MARK_IMAGE:
            return self._check_mark_image(question, user_input)
        return AnswerResult(question.id, False, 0, question.points, str(user_input), "")

    def _check_single_choice(self, q: Question, selected_index: int) -> AnswerResult:
        correct_idx = next((i for i, o in enumerate(q.options) if o.is_correct), -1)
        is_correct = selected_index == correct_idx
        user_text = q.options[selected_index].text if 0 <= selected_index < len(q.options) else ""
        correct_text = q.options[correct_idx].text if correct_idx >= 0 else ""
        return AnswerResult(q.id, is_correct, q.points if is_correct else 0, q.points, user_text, correct_text)

    def _check_multiple_choice(self, q: Question, selected_indices: list[int]) -> AnswerResult:
        correct_indices = {i for i, o in enumerate(q.options) if o.is_correct}
        selected_set = set(selected_indices)
        is_correct = selected_set == correct_indices
        partial = len(selected_set & correct_indices) / max(len(correct_indices), 1)
        penalty = len(selected_set - correct_indices) * 0.5
        score = max(0, partial * q.points - penalty) if not is_correct else q.points
        user_text = ", ".join(q.options[i].text for i in sorted(selected_indices) if i < len(q.options))
        correct_text = ", ".join(q.options[i].text for i in sorted(correct_indices))
        return AnswerResult(q.id, is_correct, round(score, 1), q.points, user_text, correct_text)

    def _check_free_text(self, q: Question, answer: str) -> AnswerResult:
        normalized_answer = answer.strip().lower()
        normalized_correct = q.correct_text.strip().lower()
        is_correct = normalized_answer == normalized_correct
        return AnswerResult(q.id, is_correct, q.points if is_correct else 0, q.points, answer, q.correct_text)

    def _check_fill_blank(self, q: Question, answers: list[str]) -> AnswerResult:
        correct_count = 0
        for given, expected in zip(answers, q.blanks):
            if given.strip().lower() == expected.strip().lower():
                correct_count += 1
        total = max(len(q.blanks), 1)
        score = (correct_count / total) * q.points
        is_correct = correct_count == total
        return AnswerResult(q.id, is_correct, round(score, 1), q.points,
                          " | ".join(answers), " | ".join(q.blanks))

    def _check_drag_drop(self, q: Question, assignments: dict[str, str]) -> AnswerResult:
        correct = 0
        for pair in q.drag_drop_pairs:
            if assignments.get(pair.target, "") == pair.source:
                correct += 1
        total = max(len(q.drag_drop_pairs), 1)
        score = (correct / total) * q.points
        is_correct = correct == total
        return AnswerResult(q.id, is_correct, round(score, 1), q.points,
                          str(assignments), str({p.target: p.source for p in q.drag_drop_pairs}))

    def _check_diagram_label(self, q: Question, placements: dict, tolerance: float = 0.13) -> AnswerResult:
        """placements: {label: [x_frac, y_frac]}. A label is correct if it was
        dropped within `tolerance` (euclidean, fractional coords) of its target."""
        correct = 0
        for label in q.diagram_labels:
            pos = placements.get(label.label)
            if pos:
                dx = pos[0] - label.x
                dy = pos[1] - label.y
                if (dx * dx + dy * dy) ** 0.5 <= tolerance:
                    correct += 1
        total = max(len(q.diagram_labels), 1)
        score = (correct / total) * q.points
        is_correct = correct == total
        correct_text = ", ".join(label.label for label in q.diagram_labels)
        return AnswerResult(q.id, is_correct, round(score, 1), q.points,
                          f"{correct}/{total} richtig platziert", correct_text)

    def _check_mark_image(self, q: Question, click_pos: dict) -> AnswerResult:
        """click_pos: {"x": float, "y": float} normalized 0-1.
        Check if click is within any of q.mark_regions."""
        if not click_pos or click_pos.get("x") is None:
            return AnswerResult(q.id, False, 0, q.points, "Keine Markierung", "")
        cx, cy = click_pos.get("x", -1), click_pos.get("y", -1)
        for region in getattr(q, "mark_regions", []):
            rx, ry, rr = region.get("x", 0), region.get("y", 0), region.get("radius", 0.05)
            dist = ((cx - rx) ** 2 + (cy - ry) ** 2) ** 0.5
            if dist <= rr:
                return AnswerResult(q.id, True, q.points, q.points,
                                  f"({cx:.2f}, {cy:.2f})", "Korrekte Region getroffen")
        return AnswerResult(q.id, False, 0, q.points,
                          f"({cx:.2f}, {cy:.2f})", "Keine korrekte Region getroffen")

    def submit_answer(self, user_input) -> AnswerResult:
        q = self.current_question
        if not q:
            return AnswerResult("", False, 0, 0, "", "")
        result = self.check_answer(q, user_input)
        self.answers[q.id] = result
        return result

    def next_question(self):
        self.current_index += 1

    def prev_question(self):
        self.current_index = max(0, self.current_index - 1)

    def go_to_question(self, index: int):
        self.current_index = max(0, min(index, len(self.questions) - 1))


class SpacedRepetition:
    def __init__(self, store: DataStore):
        self.store = store
        self.progress = store.load_progress()

    def get_box(self, question_id: str) -> int:
        if question_id in self.progress:
            return self.progress[question_id].box
        return 1

    def update(self, question_id: str, correct: bool):
        if question_id not in self.progress:
            self.progress[question_id] = QuestionProgress(question_id=question_id)
        p = self.progress[question_id]
        p.last_seen = datetime.now().isoformat()
        if correct:
            p.times_correct += 1
            p.box = min(5, p.box + 1)
        else:
            p.times_wrong += 1
            p.box = max(1, p.box - 1)
        self.store.save_progress(self.progress)

    def get_box_counts(self, question_ids: list[str]) -> dict[int, int]:
        counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for qid in question_ids:
            box = self.get_box(qid)
            counts[box] = counts.get(box, 0) + 1
        return counts

    def select_weak_questions(self, questions: list[Question], count: int = 20,
                              quiz_weight: float = 1.0) -> list[Question]:
        weighted = []
        for q in questions:
            box = self.get_box(q.id)
            reps = max(1, int(round((6 - box) * getattr(q, "weight", 1.0) * quiz_weight)))
            weighted.extend([q] * reps)
        random.shuffle(weighted)
        seen = set()
        result = []
        for q in weighted:
            if q.id not in seen and len(result) < count:
                seen.add(q.id)
                result.append(q)
        while len(result) < count and len(result) < len(questions):
            q = random.choice(questions)
            if q.id not in seen:
                seen.add(q.id)
                result.append(q)
        return result


@dataclass
class DailyPlan:
    days_remaining: int
    total_questions: int
    questions_today: int
    box_breakdown: dict[int, int]
    readiness_pct: float
    urgency: str  # "relaxed", "normal", "urgent", "critical"


class DeadlinePlanner:
    """Calculates daily study workload based on exam date and Leitner progress."""

    def __init__(self, sr: SpacedRepetition):
        self.sr = sr

    def days_until(self, exam_date_str: str) -> int:
        if not exam_date_str:
            return -1
        try:
            exam = date.fromisoformat(exam_date_str)
            return (exam - date.today()).days
        except ValueError:
            return -1

    def compute_plan(self, quiz: Quiz) -> Optional[DailyPlan]:
        days = self.days_until(quiz.exam_date)
        if days < 0:
            return None

        questions = quiz.questions
        total = len(questions)
        if total == 0:
            return None

        counts = self.sr.get_box_counts([q.id for q in questions])
        in_box_5 = counts.get(5, 0)
        readiness = (in_box_5 / total * 100) if total > 0 else 0

        if days <= 0:
            urgency = "critical"
        elif days <= 3:
            urgency = "critical"
        elif days <= 7:
            urgency = "urgent"
        elif days <= 14:
            urgency = "normal"
        else:
            urgency = "relaxed"

        # Weighted repetitions needed to bring every question to box 5.
        # Important questions (higher weight) count for more "work".
        reps_needed = 0.0
        not_mastered = 0
        for q in questions:
            box = self.sr.get_box(q.id)
            if box < 5:
                not_mastered += 1
                reps_needed += (5 - box) * getattr(q, "weight", 1.0) * getattr(quiz, "weight", 1.0)

        if not_mastered == 0:
            # everything already mastered → nothing to do today
            return DailyPlan(
                days_remaining=days, total_questions=total, questions_today=0,
                box_breakdown={}, readiness_pct=round(readiness, 1), urgency=urgency,
            )

        effective_days = max(1, days)

        # Adaptive base load: total work spread over remaining days.
        # Many open questions + few days → large; few questions + many days → small.
        base_daily = math.ceil(reps_needed / effective_days)

        # Urgency front-loads weak questions when the exam is near.
        if urgency == "critical":
            multiplier = 2.0
        elif urgency == "urgent":
            multiplier = 1.5
        elif urgency == "normal":
            multiplier = 1.0
        else:
            multiplier = 0.8

        # Floor of 1 (not 5) so light schedules stay genuinely light;
        # never schedule more than the questions that still need work.
        questions_today = min(not_mastered, max(1, int(round(base_daily * multiplier))))

        # Box breakdown for today: prioritize low boxes
        today_breakdown = {}
        remaining = questions_today
        for box in range(1, 6):
            available = counts.get(box, 0)
            if urgency in ("critical", "urgent") and box <= 3:
                take = min(available, remaining)
            elif box <= 2:
                take = min(available, int(remaining * 0.6))
            elif box <= 4:
                take = min(available, int(remaining * 0.3))
            else:
                take = min(available, int(remaining * 0.1))
            take = min(take, remaining)
            if take > 0:
                today_breakdown[box] = take
                remaining -= take
        # distribute any remainder to lowest boxes
        for box in range(1, 6):
            if remaining <= 0:
                break
            available = counts.get(box, 0) - today_breakdown.get(box, 0)
            take = min(available, remaining)
            if take > 0:
                today_breakdown[box] = today_breakdown.get(box, 0) + take
                remaining -= take

        return DailyPlan(
            days_remaining=days,
            total_questions=total,
            questions_today=questions_today,
            box_breakdown=today_breakdown,
            readiness_pct=round(readiness, 1),
            urgency=urgency,
        )
