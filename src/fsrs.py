"""
FSRS (Free Spaced Repetition Scheduler) - FSRS-4.5 implementation.

A standalone module implementing the FSRS algorithm for spaced repetition
scheduling, as used in Anki. No external dependencies beyond stdlib.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional
import math


@dataclass
class FSRSCard:
    question_id: str = ""
    difficulty: float = 5.0  # 1-10
    stability: float = 1.0   # days
    reps: int = 0
    lapses: int = 0
    last_review: str = ""    # ISO timestamp
    scheduled_days: float = 1.0
    elapsed_days: float = 0.0
    state: str = "new"       # new, learning, review, relearning


class FSRSScheduler:
    """FSRS-4.5 scheduler."""

    # Default parameters (w0..w18 from FSRS-4.5 paper defaults)
    W = [
        0.4, 0.6, 2.4, 5.8,   # w0-w3: initial stability for Again/Hard/Good/Easy
        4.93,                    # w4: difficulty mean reversion
        0.94,                    # w5: difficulty multiplier for rating
        0.86,                    # w6: difficulty multiplier for delta
        0.01,                    # w7: stability base after failure
        1.49,                    # w8: stability exponent for D after failure
        0.14,                    # w9: stability exponent for S after failure
        0.94,                    # w10: stability factor for success
        2.18,                    # w11: stability exponent for D on success
        0.05,                    # w12: stability exponent for S on success
        0.34,                    # w13: stability decay for retrievability
        1.26,                    # w14: stability growth for success
        0.29,                    # w15: difficulty weight on stability
        2.61,                    # w16: stability scaling on success
        0.0,                     # w17: reserved
        0.0,                     # w18: reserved
    ]

    def __init__(self, request_retention: float = 0.9):
        self.request_retention = request_retention  # target retention rate

    def review(
        self,
        card: FSRSCard,
        rating: int,
        answer_time_ms: int = 0,
        confidence: float = 0.5,
    ) -> FSRSCard:
        """Process a review. rating: 1=Again, 2=Hard, 3=Good, 4=Easy.
        Returns updated card with new scheduled_days."""
        rating = max(1, min(4, rating))
        confidence = max(0.0, min(1.0, confidence))
        now = datetime.utcnow()

        # Calculate elapsed days since last review
        if card.last_review:
            last = datetime.fromisoformat(card.last_review)
            elapsed_days = max(0.0, (now - last).total_seconds() / 86400.0)
        else:
            elapsed_days = 0.0

        card.elapsed_days = elapsed_days
        card.last_review = now.isoformat()

        if card.state == "new":
            # First review: initialize D and S from rating
            card.difficulty = self._init_difficulty(rating)
            card.stability = self._init_stability(rating)
            card.reps = 1

            if rating == 1:
                card.state = "learning"
                card.lapses = 1
            elif rating in (3, 4):
                card.state = "learning"
            else:
                card.state = "learning"
        else:
            # Existing card: update D and S
            retrievability = self._forgetting_curve(elapsed_days, card.stability)

            # Update difficulty
            new_d = self._next_difficulty(card.difficulty, rating)
            card.difficulty = new_d

            if rating == 1:
                # Failure: compute new stability after lapse
                new_s = self._next_forget_stability(
                    card.difficulty, card.stability, retrievability
                )
                card.lapses += 1
                card.state = "relearning"
            else:
                # Success: compute new stability
                new_s = self._next_recall_stability(
                    card.difficulty, card.stability, retrievability, rating
                )
                card.state = "review"

            card.stability = new_s
            card.reps += 1

        # Apply answer_time factor
        card.stability = self._apply_answer_time_factor(
            card.stability, answer_time_ms, rating
        )

        # Apply confidence factor
        confidence_factor = 0.8 + 0.4 * confidence
        card.stability = card.stability * confidence_factor

        # Ensure stability stays positive
        card.stability = max(0.1, card.stability)

        # Clamp difficulty to 1-10
        card.difficulty = max(1.0, min(10.0, card.difficulty))

        # Calculate next interval from target retention
        card.scheduled_days = self._next_interval(card.stability)

        return card

    def retrievability(self, card: FSRSCard) -> float:
        """Current probability of recall (0-1)."""
        if card.state == "new" or not card.last_review:
            return 0.0
        now = datetime.utcnow()
        last = datetime.fromisoformat(card.last_review)
        elapsed = max(0.0, (now - last).total_seconds() / 86400.0)
        return self._forgetting_curve(elapsed, card.stability)

    def estimated_difficulty(self, card: FSRSCard) -> str:
        """Human-readable difficulty label."""
        if card.difficulty <= 3:
            return "easy"
        if card.difficulty <= 6:
            return "medium"
        return "hard"

    # ---- Internal FSRS-4.5 formulas ----

    def _forgetting_curve(self, elapsed_days: float, stability: float) -> float:
        """R = (1 + t/(9*S))^(-1)"""
        if stability <= 0:
            return 0.0
        return (1.0 + elapsed_days / (9.0 * stability)) ** (-1)

    def _init_stability(self, rating: int) -> float:
        """Initial stability based on first rating. Uses w0..w3."""
        return max(0.1, self.W[rating - 1])

    def _init_difficulty(self, rating: int) -> float:
        """Initial difficulty based on first rating.
        D0(G) = w4 - exp(w5 * (G - 1)) + 1
        """
        d = self.W[4] - math.exp(self.W[5] * (rating - 1)) + 1
        return max(1.0, min(10.0, d))

    def _next_difficulty(self, d: float, rating: int) -> float:
        """Update difficulty after a review.
        D' = w6 * D0(3) + (1 - w6) * (D - w7 * (rating - 3))
        Mean reversion towards D0(3).
        """
        d0_3 = self.W[4] - math.exp(self.W[5] * (3 - 1)) + 1
        new_d = self.W[6] * d0_3 + (1.0 - self.W[6]) * (d - self.W[7] * (rating - 3))
        return max(1.0, min(10.0, new_d))

    def _next_recall_stability(
        self, d: float, s: float, r: float, rating: int
    ) -> float:
        """Stability after successful recall (rating >= 2).
        S'_r = S * (e^(w8) * (11 - D) * S^(-w9) * (e^(w10*(1-R)) - 1) * hard_penalty * easy_bonus + 1)
        """
        hard_penalty = self.W[15] if rating == 2 else 1.0
        easy_bonus = self.W[16] if rating == 4 else 1.0

        inner = (
            math.exp(self.W[10])
            * (11.0 - d)
            * (s ** (-self.W[11]))
            * (math.exp(self.W[12] * (1.0 - r)) - 1.0)
            * hard_penalty
            * easy_bonus
        )
        new_s = s * (inner + 1.0)
        return max(0.1, new_s)

    def _next_forget_stability(self, d: float, s: float, r: float) -> float:
        """Stability after forgetting (rating == 1).
        S'_f = w11 * D^(-w12) * ((S+1)^w13 - 1) * e^(w14*(1-R))
        Using w7, w8, w9, w13, w14 for the lapse formula.
        """
        new_s = (
            self.W[7]
            * (d ** (-self.W[8]))
            * ((s + 1.0) ** self.W[9] - 1.0)
            * math.exp(self.W[13] * (1.0 - r))
        )
        return max(0.1, new_s)

    def _next_interval(self, stability: float) -> float:
        """Calculate next interval in days from stability and target retention.
        interval = 9 * S * (1/R - 1)
        Derived from inverting the forgetting curve: R = (1 + t/(9*S))^(-1)
        => t = 9*S*(1/R - 1)
        """
        if self.request_retention <= 0 or self.request_retention >= 1:
            return max(1.0, stability)
        interval = 9.0 * stability * (1.0 / self.request_retention - 1.0)
        return max(1.0, round(interval, 1))

    def _apply_answer_time_factor(
        self, stability: float, answer_time_ms: int, rating: int
    ) -> float:
        """Adjust stability based on answer time.
        Baseline: 10000ms. Faster correct answers boost stability (up to 1.1x),
        slower answers reduce it (down to 0.9x). No effect for Again (rating 1).
        """
        if answer_time_ms <= 0 or rating == 1:
            return stability

        baseline_ms = 10000.0
        ratio = baseline_ms / max(answer_time_ms, 500.0)
        # Clamp factor to [0.9, 1.1]
        factor = max(0.9, min(1.1, 0.9 + 0.2 * min(ratio, 1.0) if ratio < 1.0 else 1.0 + 0.1 * min(ratio - 1.0, 1.0)))
        return stability * factor


def to_dict(card: FSRSCard) -> dict:
    """Convert an FSRSCard to a dictionary."""
    return asdict(card)


def from_dict(d: dict) -> FSRSCard:
    """Create an FSRSCard from a dictionary."""
    return FSRSCard(
        question_id=d.get("question_id", ""),
        difficulty=float(d.get("difficulty", 5.0)),
        stability=float(d.get("stability", 1.0)),
        reps=int(d.get("reps", 0)),
        lapses=int(d.get("lapses", 0)),
        last_review=d.get("last_review", ""),
        scheduled_days=float(d.get("scheduled_days", 1.0)),
        elapsed_days=float(d.get("elapsed_days", 0.0)),
        state=d.get("state", "new"),
    )
