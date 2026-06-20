"""AI service for generating and importing questions via OpenRouter.

Features:
- PDF text extraction via PyMuPDF
- PPTX/DOCX/image file support
- Parallel API calls via ThreadPoolExecutor
- Sliding window chunking with overlap
- Rolling summary for cross-chunk context
- Configurable chunk_size and temperature
- JSON repair and retry logic
- Response caching
"""

import base64
import hashlib
import json
import re
import time
import concurrent.futures
import threading
from pathlib import Path
from typing import Optional, Callable
import requests

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

try:
    from pptx import Presentation
except ImportError:
    Presentation = None

try:
    from docx import Document as DocxDocument
except ImportError:
    DocxDocument = None

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
        self._cache: dict[str, str] = {}

    # ── Caching ──

    def _cache_key(self, messages: list[dict]) -> str:
        raw = json.dumps(messages, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(raw.encode()).hexdigest()

    def clear_cache(self) -> None:
        """Clear the in-memory response cache."""
        self._cache.clear()

    # ── JSON Repair ──

    @staticmethod
    def _repair_json(text: str) -> str:
        """Attempt to repair common JSON issues."""
        # Strip trailing commas before } or ]
        text = re.sub(r',\s*([}\]])', r'\1', text)
        # Fix unquoted keys: word followed by colon at start of key position
        text = re.sub(r'(?<=[{,])\s*(\w+)\s*:', r' "\1":', text)
        return text

    def _call_api(self, messages: list[dict], max_tokens: int = 4096,
                  temperature: float | None = None) -> Optional[str]:
        if not self.api_key:
            return None

        # Check cache
        cache_key = self._cache_key(messages)
        if cache_key in self._cache:
            return self._cache[cache_key]

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

        last_error = None
        for attempt in range(3):  # up to 2 retries
            try:
                resp = requests.post(self.base_url, headers=headers, json=payload, timeout=180)
                if resp.status_code >= 500 and attempt < 2:
                    last_error = f"HTTP {resp.status_code}"
                    time.sleep(2)
                    continue
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                self._cache[cache_key] = content
                return content
            except (requests.ConnectionError, requests.Timeout) as e:
                last_error = str(e)
                if attempt < 2:
                    time.sleep(2)
                    continue
                return f"ERROR: {last_error}"
            except Exception as e:
                return f"ERROR: {e}"

        return f"ERROR: {last_error}"

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
            raw = text[brace_start:brace_end]
            try:
                obj = json.loads(raw)
                if isinstance(obj, dict) and "questions" in obj:
                    summary = obj.get("summary", "")
                    items = obj["questions"]
                elif isinstance(obj, dict):
                    items = [obj]
            except json.JSONDecodeError:
                # Try repairing JSON
                try:
                    repaired = self._repair_json(raw)
                    obj = json.loads(repaired)
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
                raw = text[arr_start:arr_end]
                try:
                    items = json.loads(raw)
                except json.JSONDecodeError:
                    try:
                        items = json.loads(self._repair_json(raw))
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

    # ── File Reading with PDF/PPTX/DOCX/image support ──

    def _read_file_as_text(self, file_path: str) -> str:
        """Read entire file as text. Supports PDF, PPTX, DOCX, images, and plain text."""
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

        if suffix == ".pptx":
            if Presentation is None:
                raise RuntimeError("python-pptx nicht installiert. Bitte 'pip install python-pptx' ausführen.")
            prs = Presentation(str(path))
            slides_text = []
            for slide in prs.slides:
                parts = []
                for shape in slide.shapes:
                    if shape.has_text_frame:
                        parts.append(shape.text_frame.text)
                slides_text.append("\n".join(parts))
            return "\n\n--- Folie ---\n\n".join(slides_text)

        if suffix == ".docx":
            if DocxDocument is None:
                raise RuntimeError("python-docx nicht installiert. Bitte 'pip install python-docx' ausführen.")
            doc = DocxDocument(str(path))
            parts = []
            for para in doc.paragraphs:
                if para.text.strip():
                    parts.append(para.text)
            for table in doc.tables:
                for row in table.rows:
                    cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if cells:
                        parts.append(" | ".join(cells))
            return "\n".join(parts)

        if suffix in (".png", ".jpg", ".jpeg", ".gif", ".bmp"):
            with open(path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("ascii")
            return f"[IMAGE:base64:{suffix[1:]}:{encoded}]"

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

            # If JSON parsing failed completely, retry once asking for valid JSON
            if not questions and response and not response.startswith("ERROR:"):
                retry_messages = messages + [
                    {"role": "assistant", "content": response},
                    {"role": "user", "content": "Dein letzter Output war kein valides JSON. Bitte antworte erneut mit exakt dem geforderten JSON-Format."},
                ]
                response = self._call_api(retry_messages, max_tokens=4096)
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

    # ── New methods ──

    def generate_cloze_text(self, text: str, blank_pct: float = 0.2) -> tuple[str, list[str]]:
        """Ask AI to create a cloze/fill-blank version of the text.
        Returns (text_with_blanks, list_of_correct_words).
        blank_pct controls roughly what fraction of key terms to blank out."""
        messages = [
            {"role": "system", "content": (
                "Du bist ein Experte für Lückentexte. Erstelle einen Lückentext aus dem gegebenen Text. "
                "Ersetze wichtige Fachbegriffe durch '___'. "
                "Antworte mit exakt diesem JSON-Format:\n"
                '{"cloze_text": "Text mit ___ Lücken", "answers": ["Wort1", "Wort2"]}\n'
                "Die Reihenfolge der answers muss der Reihenfolge der Lücken im Text entsprechen."
            )},
            {"role": "user", "content": (
                f"Erstelle einen Lückentext aus folgendem Text. "
                f"Etwa {int(blank_pct * 100)}% der Schlüsselbegriffe sollen als Lücken erscheinen.\n\n"
                f"{text}"
            )},
        ]
        response = self._call_api(messages, max_tokens=2048)
        if not response or response.startswith("ERROR:"):
            return text, []
        try:
            raw = response.strip()
            if "```json" in raw:
                raw = raw.split("```json")[1].split("```")[0]
            elif "```" in raw:
                raw = raw.split("```")[1].split("```")[0]
            brace_start = raw.find("{")
            brace_end = raw.rfind("}") + 1
            if brace_start != -1 and brace_end > 0:
                obj = json.loads(raw[brace_start:brace_end])
                return obj.get("cloze_text", text), obj.get("answers", [])
        except (json.JSONDecodeError, KeyError):
            pass
        return text, []

    def ai_validate_answer(self, question_text: str, correct_answer: str, user_answer: str) -> bool:
        """Use AI to check if user_answer is semantically correct, ignoring typos."""
        messages = [
            {"role": "system", "content": (
                "Du bist ein Prüfungsbewerter. Prüfe ob die Antwort des Studenten inhaltlich korrekt ist. "
                "Ignoriere Tippfehler und kleine Formulierungsunterschiede. "
                "Antworte NUR mit 'JA' oder 'NEIN'."
            )},
            {"role": "user", "content": (
                f"Frage: {question_text}\n"
                f"Richtige Antwort: {correct_answer}\n"
                f"Antwort des Studenten: {user_answer}\n\n"
                "Ist die Antwort des Studenten inhaltlich korrekt? Antworte nur mit JA oder NEIN."
            )},
        ]
        response = self._call_api(messages, max_tokens=16, temperature=0.0)
        if not response or response.startswith("ERROR:"):
            return False
        return response.strip().upper().startswith("JA")

    def generate_summary(self, results: list[dict]) -> str:
        """Generate a post-quiz AI summary. results is a list of
        {question, user_answer, correct_answer, is_correct} dicts.
        Returns markdown text with: 1) strengths, 2) weaknesses, 3) study recommendations."""
        results_text = "\n".join(
            f"- Frage: {r['question']}\n  Deine Antwort: {r['user_answer']}\n  "
            f"Richtig: {r['correct_answer']}\n  Korrekt: {'Ja' if r['is_correct'] else 'Nein'}"
            for r in results
        )
        messages = [
            {"role": "system", "content": (
                "Du bist ein hilfreicher Lernberater. Analysiere die Quiz-Ergebnisse und erstelle "
                "eine Zusammenfassung auf Deutsch im Markdown-Format mit drei Abschnitten:\n"
                "1. **Stärken** - Was der Student gut kann\n"
                "2. **Schwächen** - Wo Verbesserungsbedarf besteht\n"
                "3. **Lernempfehlungen** - Konkrete Tipps zum Verbessern"
            )},
            {"role": "user", "content": (
                f"Hier sind meine Quiz-Ergebnisse:\n\n{results_text}\n\n"
                "Erstelle bitte eine Lernzusammenfassung."
            )},
        ]
        response = self._call_api(messages, max_tokens=2048)
        if not response or response.startswith("ERROR:"):
            return "Zusammenfassung nicht verfügbar."
        return response

    def generate_tutor_prompt(self, wrong_questions: list[dict]) -> str:
        """Generate a copy-paste prompt for an AI tutor to explain wrong answers step by step.
        wrong_questions: [{question, user_answer, correct_answer, options}]"""
        questions_text = "\n\n".join(
            f"Frage {i+1}: {q['question']}\n"
            f"Meine Antwort: {q['user_answer']}\n"
            f"Richtige Antwort: {q['correct_answer']}\n"
            f"Optionen: {', '.join(q.get('options', []))}"
            for i, q in enumerate(wrong_questions)
        )
        messages = [
            {"role": "system", "content": (
                "Erstelle einen kopierbaren Prompt, den ein Student an einen KI-Tutor senden kann. "
                "Der Prompt soll den Tutor bitten, jede falsch beantwortete Frage Schritt für Schritt "
                "zu erklären, mit Fokus auf das Verständnis der Konzepte."
            )},
            {"role": "user", "content": (
                f"Ich habe folgende Fragen falsch beantwortet:\n\n{questions_text}\n\n"
                "Erstelle einen Prompt, den ich an einen KI-Tutor senden kann, "
                "um diese Themen besser zu verstehen."
            )},
        ]
        response = self._call_api(messages, max_tokens=2048)
        if not response or response.startswith("ERROR:"):
            return "Tutor-Prompt nicht verfügbar."
        return response
