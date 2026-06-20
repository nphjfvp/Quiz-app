"""AI service for generating and importing questions via OpenRouter.

Features:
- PDF text extraction via PyMuPDF
- Parallel API calls via ThreadPoolExecutor
- Sliding window chunking with overlap
- Rolling summary for cross-chunk context
- Configurable chunk_size and temperature
"""

import json
import concurrent.futures
import threading
from pathlib import Path
from typing import Optional, Callable
import requests

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

from .models import Question, QuestionType, Option, DragDropPair


GENERATE_SYSTEM_PROMPT = """Du bist ein Experte für das Erstellen von Prüfungsfragen aus Vorlesungsunterlagen.
Erstelle hochwertige Fragen in verschiedenen Formaten.

Dein Output MUSS exakt dieses Format haben – ein JSON-Objekt mit zwei Feldern:
{
  "summary": "Kurze Zusammenfassung (2-3 Sätze) der Kernthemen dieses Abschnitts",
  "questions": [
    {
      "question_type": "single_choice" | "multiple_choice" | "free_text" | "fill_blank" | "drag_drop",
      "title": "Kurztitel der Frage",
      "text": "Der Fragentext",
      "topic": "Themengebiet",
      "points": 1-3,
      "options": [{"text": "Antwort A", "is_correct": false}, ...],
      "correct_text": "Richtige Antwort",
      "blanks": ["Wort1", "Wort2"],
      "drag_drop_pairs": [{"source": "Begriff", "target": "Ziel"}],
      "explanation": "Erklärung der richtigen Antwort"
    }
  ]
}

Regeln:
- Erstelle einen Mix aus verschiedenen Fragetypen
- Single Choice: genau eine richtige Antwort, 3-4 Optionen
- Multiple Choice: 1-3 richtige Antworten, 4-5 Optionen
- Lückentext: Markiere Lücken im Text mit ___ (drei Unterstriche)
- Drag & Drop: 3-5 Zuordnungspaare
- Freitext: Kurze, eindeutige Antworten
- Alle Fragen auf Deutsch
- Fragen sollen prüfungsrelevant und anspruchsvoll sein
- Die Zusammenfassung soll die wichtigsten Konzepte/Begriffe des Abschnitts nennen"""

IMPORT_SYSTEM_PROMPT = """Du bist ein Experte für das Importieren von Prüfungsfragen aus Dokumenten.
Das Dokument enthält bereits fertige Fragen (z.B. aus Übungsskripten).
Extrahiere ALLE Fragen und konvertiere sie in das folgende JSON-Format.

Dein Output MUSS exakt dieses Format haben:
{
  "summary": "Kurze Zusammenfassung der gefundenen Fragen-Themen",
  "questions": [
    {
      "question_type": "single_choice" | "multiple_choice" | "free_text" | "fill_blank" | "drag_drop",
      "title": "Kurztitel der Frage",
      "text": "Der Fragentext",
      "topic": "Themengebiet",
      "points": 1-3,
      "options": [{"text": "Antwort A", "is_correct": false}, ...],
      "correct_text": "Richtige Antwort",
      "blanks": ["Wort1", "Wort2"],
      "drag_drop_pairs": [{"source": "Begriff", "target": "Ziel"}],
      "explanation": "Erklärung (falls vorhanden)"
    }
  ]
}

Regeln:
- Importiere JEDE einzelne Frage aus dem Dokument
- Erkenne den Fragetyp automatisch
- Wenn Antworten gegeben sind, markiere die richtigen
- Behalte den originalen Fragentext bei"""


class AIService:
    def __init__(self, api_key: str = "", model: str = "deepseek/deepseek-chat"):
        self.api_key = api_key
        self.model = model
        self.base_url = "https://openrouter.ai/api/v1/chat/completions"
        self.chunk_size = 6000
        self.overlap = 1000
        self.temperature = 0.3
        self.max_workers = 4

    def _call_api(self, messages: list[dict], max_tokens: int = 4096,
                  temperature: float | None = None) -> Optional[str]:
        if not self.api_key:
            return None
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://quiz-lerntrainer.app",
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature if temperature is not None else self.temperature,
        }
        try:
            resp = requests.post(self.base_url, headers=headers, json=payload, timeout=180)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            return f"ERROR: {e}"

    def _parse_response(self, response: str) -> tuple[list[Question], str]:
        """Parse response returning (questions, summary)."""
        if not response or response.startswith("ERROR:"):
            return [], ""
        text = response.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]

        # Try to parse as {summary, questions} object first
        brace_start = text.find("{")
        brace_end = text.rfind("}") + 1
        summary = ""
        items = []

        if brace_start != -1 and brace_end > 0:
            try:
                obj = json.loads(text[brace_start:brace_end])
                if isinstance(obj, dict) and "questions" in obj:
                    summary = obj.get("summary", "")
                    items = obj["questions"]
                elif isinstance(obj, dict):
                    items = [obj]
            except json.JSONDecodeError:
                pass

        # Fallback: try as plain list
        if not items:
            arr_start = text.find("[")
            arr_end = text.rfind("]") + 1
            if arr_start != -1 and arr_end > 0:
                try:
                    items = json.loads(text[arr_start:arr_end])
                except json.JSONDecodeError:
                    return [], summary

        questions = []
        for item in items:
            try:
                qt = QuestionType(item.get("question_type", "single_choice"))
                q = Question(
                    question_type=qt,
                    title=item.get("title", ""),
                    text=item.get("text", ""),
                    topic=item.get("topic", ""),
                    points=item.get("points", 1),
                    explanation=item.get("explanation", ""),
                )
                if qt in (QuestionType.SINGLE_CHOICE, QuestionType.MULTIPLE_CHOICE):
                    q.options = [Option(text=o["text"], is_correct=o.get("is_correct", False))
                                 for o in item.get("options", [])]
                elif qt == QuestionType.FREE_TEXT:
                    q.correct_text = item.get("correct_text", "")
                elif qt == QuestionType.FILL_BLANK:
                    q.blanks = item.get("blanks", [])
                elif qt == QuestionType.DRAG_DROP:
                    q.drag_drop_pairs = [DragDropPair(source=p["source"], target=p["target"])
                                         for p in item.get("drag_drop_pairs", [])]
                questions.append(q)
            except (KeyError, ValueError):
                continue
        return questions, summary

    # ── File Reading with PDF support ──

    def _read_file_as_text(self, file_path: str) -> str:
        """Read entire file as text. Supports PDF via PyMuPDF."""
        path = Path(file_path)
        suffix = path.suffix.lower()

        if suffix == ".pdf":
            if fitz is None:
                raise RuntimeError("PyMuPDF (fitz) nicht installiert. Bitte 'pip install PyMuPDF' ausführen.")
            doc = fitz.open(str(path))
            pages = []
            for page in doc:
                pages.append(page.get_text("text"))
            doc.close()
            return "\n\n--- Seite ---\n\n".join(pages)

        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    def _chunk_with_overlap(self, text: str) -> list[str]:
        """Split text into overlapping chunks (sliding window)."""
        if len(text) <= self.chunk_size:
            return [text]
        chunks = []
        step = max(1, self.chunk_size - self.overlap)
        for start in range(0, len(text), step):
            chunk = text[start:start + self.chunk_size]
            if chunk.strip():
                chunks.append(chunk)
            if start + self.chunk_size >= len(text):
                break
        return chunks

    # ── Generate: Sequential with Rolling Summary ──

    def generate_from_slides(self, file_path: str, num_questions: int = 20,
                              progress_callback: Callable | None = None) -> list[Question]:
        full_text = self._read_file_as_text(file_path)
        chunks = self._chunk_with_overlap(full_text)
        if not chunks:
            return []

        all_questions: list[Question] = []
        rolling_summary = ""
        per_chunk = max(3, num_questions // len(chunks))

        for i, chunk in enumerate(chunks):
            if progress_callback:
                progress_callback(i + 1, len(chunks))

            context_prefix = ""
            if rolling_summary:
                context_prefix = (
                    f"Bisheriger Kontext (Zusammenfassung vorheriger Abschnitte):\n"
                    f"{rolling_summary}\n\n---\n\n"
                )

            messages = [
                {"role": "system", "content": GENERATE_SYSTEM_PROMPT},
                {"role": "user", "content": (
                    f"{context_prefix}"
                    f"Hier ist Abschnitt {i+1} von {len(chunks)} der Vorlesungsfolien:\n\n"
                    f"{chunk}\n\n"
                    f"Erstelle {per_chunk} Prüfungsfragen zu diesem Inhalt. "
                    f"Nutze verschiedene Fragetypen. "
                    f"Antworte mit dem JSON-Objekt (summary + questions)."
                )},
            ]
            response = self._call_api(messages, max_tokens=4096)
            questions, summary = self._parse_response(response)
            all_questions.extend(questions)

            if summary:
                rolling_summary = (rolling_summary + " " + summary).strip()
                if len(rolling_summary) > 2000:
                    rolling_summary = rolling_summary[-2000:]

        return all_questions

    # ── Import: Parallel with ThreadPoolExecutor ──

    def import_questions(self, file_path: str,
                         progress_callback: Callable | None = None) -> list[Question]:
        full_text = self._read_file_as_text(file_path)
        chunks = self._chunk_with_overlap(full_text)
        if not chunks:
            return []

        all_questions: list[Question] = [None] * len(chunks)  # type: ignore
        completed = [0]
        lock = threading.Lock()

        def process_chunk(idx: int, chunk: str) -> list[Question]:
            messages = [
                {"role": "system", "content": IMPORT_SYSTEM_PROMPT},
                {"role": "user", "content": (
                    f"Hier ist Teil {idx+1} von {len(chunks)} des Dokuments mit Übungsfragen:\n\n"
                    f"{chunk}\n\n"
                    f"Importiere ALLE Fragen aus diesem Abschnitt."
                )},
            ]
            response = self._call_api(messages, max_tokens=4096)
            questions, _ = self._parse_response(response)
            with lock:
                completed[0] += 1
                if progress_callback:
                    progress_callback(completed[0], len(chunks))
            return questions

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {
                executor.submit(process_chunk, i, chunk): i
                for i, chunk in enumerate(chunks)
            }
            for future in concurrent.futures.as_completed(futures):
                idx = futures[future]
                try:
                    all_questions[idx] = future.result()
                except Exception:
                    all_questions[idx] = []

        # Flatten and deduplicate by question text
        result = []
        seen_texts = set()
        for chunk_questions in all_questions:
            if chunk_questions:
                for q in chunk_questions:
                    normalized = q.text.strip().lower()
                    if normalized not in seen_texts:
                        seen_texts.add(normalized)
                        result.append(q)
        return result

    def explain_question(self, question: Question, user_answer: str = "") -> str:
        messages = [
            {"role": "system", "content": "Du bist ein hilfreicher Tutor. Erkläre Prüfungsfragen verständlich auf Deutsch."},
            {"role": "user", "content": (
                f"Frage: {question.title}\n{question.text}\n\n"
                f"Meine Antwort war: {user_answer}\n\n"
                f"Richtige Antwort: {question.explanation or 'Nicht angegeben'}\n\n"
                "Erkläre mir bitte warum die richtige Antwort korrekt ist und was das Thema dahinter ist."
            )},
        ]
        response = self._call_api(messages, max_tokens=1024)
        return response if response and not response.startswith("ERROR:") else "Erklärung nicht verfügbar."
