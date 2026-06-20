"""AI service for generating and importing questions via OpenRouter."""

import json
import base64
import requests
from pathlib import Path
from typing import Optional
from .models import Question, QuestionType, Option, DragDropPair


GENERATE_SYSTEM_PROMPT = """Du bist ein Experte für das Erstellen von Prüfungsfragen aus Vorlesungsunterlagen.
Erstelle hochwertige Fragen in verschiedenen Formaten. Antworte NUR mit validem JSON.

Ausgabeformat: Eine JSON-Liste von Fragen, jede Frage hat folgende Struktur:
{
  "question_type": "single_choice" | "multiple_choice" | "free_text" | "fill_blank" | "drag_drop",
  "title": "Kurztitel der Frage",
  "text": "Der Fragentext",
  "topic": "Themengebiet",
  "points": 1-3,
  "options": [{"text": "Antwort A", "is_correct": false}, ...],  // für single/multiple choice
  "correct_text": "Richtige Antwort",  // für free_text
  "blanks": ["Wort1", "Wort2"],  // für fill_blank (die Lücken im Text mit ___ markieren)
  "drag_drop_pairs": [{"source": "Begriff", "target": "Ziel"}],  // für drag_drop
  "explanation": "Erklärung der richtigen Antwort"
}

Regeln:
- Erstelle einen Mix aus verschiedenen Fragetypen
- Single Choice: genau eine richtige Antwort, 3-4 Optionen
- Multiple Choice: 1-3 richtige Antworten, 4-5 Optionen
- Lückentext: Markiere Lücken im Text mit ___ (drei Unterstriche)
- Drag & Drop: 3-5 Zuordnungspaare
- Freitext: Kurze, eindeutige Antworten
- Alle Fragen auf Deutsch
- Fragen sollen prüfungsrelevant und anspruchsvoll sein"""

IMPORT_SYSTEM_PROMPT = """Du bist ein Experte für das Importieren von Prüfungsfragen aus Dokumenten.
Das Dokument enthält bereits fertige Fragen (z.B. aus Übungsskripten).
Extrahiere ALLE Fragen und konvertiere sie in das folgende JSON-Format.

Ausgabeformat: Eine JSON-Liste von Fragen:
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

Regeln:
- Importiere JEDE einzelne Frage aus dem Dokument
- Erkenne den Fragetyp automatisch
- Wenn Antworten gegeben sind, markiere die richtigen
- Behalte den originalen Fragentext bei
- Antworte NUR mit validem JSON (eine Liste von Fragen)"""


class AIService:
    def __init__(self, api_key: str = "", model: str = "deepseek/deepseek-chat"):
        self.api_key = api_key
        self.model = model
        self.base_url = "https://openrouter.ai/api/v1/chat/completions"

    def _call_api(self, messages: list[dict], max_tokens: int = 4096) -> Optional[str]:
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
            "temperature": 0.3,
        }
        try:
            resp = requests.post(self.base_url, headers=headers, json=payload, timeout=120)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            return f"ERROR: {e}"

    def _parse_questions(self, response: str) -> list[Question]:
        if not response or response.startswith("ERROR:"):
            return []
        text = response.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        start = text.find("[")
        end = text.rfind("]") + 1
        if start == -1 or end == 0:
            return []
        try:
            items = json.loads(text[start:end])
        except json.JSONDecodeError:
            return []
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
        return questions

    def _read_file_as_text(self, file_path: str) -> list[str]:
        """Read file and return content chunks for processing."""
        path = Path(file_path)
        suffix = path.suffix.lower()
        if suffix == ".txt":
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        elif suffix == ".md":
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        elif suffix == ".json":
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        else:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()

        chunk_size = 6000
        chunks = []
        for i in range(0, len(text), chunk_size):
            chunks.append(text[i:i + chunk_size])
        return chunks if chunks else [text]

    def generate_from_slides(self, file_path: str, num_questions: int = 20,
                              progress_callback=None) -> list[Question]:
        chunks = self._read_file_as_text(file_path)
        all_questions = []
        for i, chunk in enumerate(chunks):
            if progress_callback:
                progress_callback(i + 1, len(chunks))
            per_chunk = max(3, num_questions // len(chunks))
            messages = [
                {"role": "system", "content": GENERATE_SYSTEM_PROMPT},
                {"role": "user", "content": (
                    f"Hier ist Seite/Abschnitt {i+1} von {len(chunks)} der Vorlesungsfolien:\n\n"
                    f"{chunk}\n\n"
                    f"Erstelle {per_chunk} Prüfungsfragen zu diesem Inhalt. "
                    f"Nutze verschiedene Fragetypen. Antworte NUR mit JSON."
                )},
            ]
            response = self._call_api(messages, max_tokens=4096)
            questions = self._parse_questions(response)
            all_questions.extend(questions)
        return all_questions

    def import_questions(self, file_path: str, progress_callback=None) -> list[Question]:
        chunks = self._read_file_as_text(file_path)
        all_questions = []
        for i, chunk in enumerate(chunks):
            if progress_callback:
                progress_callback(i + 1, len(chunks))
            messages = [
                {"role": "system", "content": IMPORT_SYSTEM_PROMPT},
                {"role": "user", "content": (
                    f"Hier ist Teil {i+1} von {len(chunks)} des Dokuments mit Übungsfragen:\n\n"
                    f"{chunk}\n\n"
                    f"Importiere ALLE Fragen aus diesem Abschnitt. Antworte NUR mit JSON."
                )},
            ]
            response = self._call_api(messages, max_tokens=4096)
            questions = self._parse_questions(response)
            all_questions.extend(questions)
        return all_questions

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
