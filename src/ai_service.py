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
    from pypdf import PdfReader
except ImportError:
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        PdfReader = None

try:
    from pptx import Presentation
except ImportError:
    Presentation = None

try:
    from docx import Document as DocxDocument
except ImportError:
    DocxDocument = None

from .models import (
    Question, QuestionType, Option, DragDropPair,
    Formula, FormulaVariable, FormulaSheet,
)


GENERATE_SYSTEM_PROMPT_BASE = """Du bist ein Experte für das Erstellen von Prüfungsfragen aus Vorlesungsunterlagen.
Erstelle hochwertige Fragen in verschiedenen Formaten.
WICHTIG: Erstelle Fragen zu ALLEN Inhalten – jedes Konzept, jede Definition, jeder Fakt soll abgedeckt werden. Überspringe NICHTS.

Dein Output MUSS exakt dieses Format haben – ein JSON-Objekt mit zwei Feldern:
{{
  "summary": "Kurze Zusammenfassung (2-3 Sätze) der Kernthemen dieses Abschnitts",
  "questions": [
    {{
      "question_type": "{types_str}",
      "title": "Kurztitel der Frage",
      "text": "Der Fragentext",
      "topic": "Themengebiet",
      "points": 1-3,
      "options": [{{"text": "Antwort A", "is_correct": false}}, ...],
      "correct_text": "Richtige Antwort",
      "correct_formula": "LaTeX-Formel der Lösung (nur bei math_formula)",
      "tolerance": 0.0,
      "blanks": ["Wort1", "Wort2"],
      "drag_drop_pairs": [{{"source": "Begriff", "target": "Zuordnung"}}],
      "explanation": "Erklärung der richtigen Antwort"
    }}
  ]
}}

Regeln:
- Erstelle Fragen NUR von diesen Typen: {types_list}
{types_rules}
- Alle Fragen auf Deutsch
- Fragen sollen prüfungsrelevant und anspruchsvoll sein
- Die Zusammenfassung soll die wichtigsten Konzepte/Begriffe des Abschnitts nennen
- WICHTIG: Verteile die Fragen gleichmäßig auf die erlaubten Fragetypen!"""

TYPE_RULES = {
    "single_choice": "- Single Choice: genau eine richtige Antwort, 3-4 Optionen",
    "multiple_choice": "- Multiple Choice: 1-3 richtige Antworten, 4-5 Optionen",
    "free_text": "- Freitext: Kurze, eindeutige Antworten",
    "fill_blank": "- Lückentext: Setze ___ (drei Unterstriche) für jede Lücke, blanks-Array enthält die Lösungen",
    "drag_drop": "- Drag & Drop: MINDESTENS 4-6 Zuordnungspaare als drag_drop_pairs (source → target), z.B. Begriff → Definition, Eigenschaft → Material",
    "diagram_label": "- Diagramm: Beschriftung von Positionen, diagram_labels mit label/x/y",
    "math_formula": '- Mathe-Formel: Die Frage stellt eine Rechenaufgabe oder fordert eine Formel. correct_text enthält die Lösung als LaTeX (z.B. "\\\\frac{a}{b}", "x^2 + 1", "42"). Das Feld "tolerance" (float, optional, default 0) gibt die erlaubte numerische Abweichung an (0 = exakt).',
}

def _build_generate_prompt(question_types: list[str] | None = None) -> str:
    if not question_types:
        question_types = ["single_choice", "multiple_choice", "free_text", "fill_blank", "drag_drop"]
    types_str = '" | "'.join(question_types)
    types_list = ", ".join(question_types)
    types_rules = "\n".join(TYPE_RULES.get(t, "") for t in question_types if t in TYPE_RULES)
    return GENERATE_SYSTEM_PROMPT_BASE.format(
        types_str=types_str, types_list=types_list, types_rules=types_rules
    )

IMPORT_SYSTEM_PROMPT = """Du bist ein Experte für das Importieren von Prüfungsfragen aus Dokumenten.
Das Dokument enthält bereits fertige Fragen (z.B. aus Übungsskripten, Altklausuren, Arbeitsblättern).
Extrahiere ALLE Fragen und konvertiere sie in das folgende JSON-Format.

Dein Output MUSS exakt dieses Format haben:
{
  "summary": "Kurze Zusammenfassung der gefundenen Fragen-Themen",
  "question_count_estimate": 12,
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
      "explanation": "Erklärung (falls vorhanden)",
      "source_hint": "z.B. 'Aufgabe 3b' oder 'Seite 5, Frage 2'"
    }
  ]
}

WICHTIGE Regeln:
- Importiere ABSOLUT JEDE einzelne Frage – überspringe KEINE einzige!
- Rechenaufgaben → question_type "free_text", korrekte Lösung in "correct_text"
- Wenn eine Frage am Textende abgeschnitten scheint, importiere sie trotzdem so weit wie möglich
- Erkenne den Fragetyp automatisch (Single/Multiple Choice, Freitext, Lückentext, Zuordnung)
- Wenn Antworten gegeben sind, markiere die richtigen
- Behalte den originalen Fragentext möglichst bei
- "question_count_estimate": Zähle wie viele Fragen du im Text siehst (auch die die du noch nicht importiert hast)
- "source_hint": Gib an wo im Dokument die Frage stand (Aufgabennummer, Seitenzahl o.ä.)

KRITISCH – Aufgaben-Splitting bei Mathe/MINT-Aufgaben:
- Wenn eine Aufgabe MEHRERE verschiedene Funktionen/Gleichungen/Objekte definiert
  (z.B. "Gegeben: g(x)=..., h(x)=..., i(x)=...") und dann Teilaufgaben a), b), c) stellt,
  dann ist JEDE Kombination aus Objekt+Teilaufgabe eine EIGENE Frage!
  Beispiel: "Aufgabe 1: g(x), h(x), i(x). a) Bestimmen Sie die Ableitung."
  → 3 separate Fragen: "Bestimme die Ableitung von g(x)=...",
    "Bestimme die Ableitung von h(x)=...", "Bestimme die Ableitung von i(x)=..."
- Jede Frage muss EIGENSTÄNDIG lösbar sein – alle nötigen Informationen
  (Funktionsdefinition, Konstanten, Bedingungen) müssen im Fragentext stehen!
- AUSNAHME: Wenn a), b), c) aufeinander aufbauen (z.B. "a) Berechne x. b) Setze x in ... ein"),
  dann zusammen lassen, aber trotzdem pro Funktion/Gleichung splitten.
- Bei Integralen, Grenzwerten, Reihen etc.: Jedes einzelne Integral/Grenzwert = eigene Frage.
  "Aufgabe 13: a) ∫... b) ∫... c) ∫..." → 3 separate Fragen."""

IMPORT_VERIFY_PROMPT = """Du bist ein Qualitätsprüfer für importierte Prüfungsfragen.

Du bekommst:
1. Den Originaltext eines Dokuments (oder Abschnitts)
2. Eine Liste bereits importierter Fragen

Deine Aufgabe: Finde ALLE Fragen im Originaltext, die NICHT in der importierten Liste enthalten sind.

Antworte im JSON-Format:
{
  "total_questions_in_text": 15,
  "imported_count": 12,
  "missing_questions": [
    {
      "question_type": "free_text",
      "title": "Kurztitel",
      "text": "Der fehlende Fragentext",
      "topic": "Themengebiet",
      "points": 1,
      "options": [],
      "correct_text": "Antwort falls bekannt",
      "blanks": [],
      "drag_drop_pairs": [],
      "explanation": "",
      "source_hint": "Aufgabe 5c, Seite 3"
    }
  ]
}

Wenn ALLE Fragen bereits importiert sind, gib "missing_questions": [] zurück.
Sei extrem gründlich – prüfe jeden Absatz, jede Nummerierung, jede Teilaufgabe.

BESONDERS WICHTIG bei Mathe/MINT:
- Wenn eine Aufgabe mehrere Funktionen/Gleichungen definiert (g, h, i, j, k...)
  und dann Teilaufgaben stellt, muss JEDE Kombination als eigene Frage existieren!
  z.B. "5 Funktionen × 4 Teilaufgaben = 20 Fragen" – nicht nur 4!
- Jedes einzelne Integral, jeder Grenzwert, jede Reihe = eigene Frage.
- Prüfe ob die importierten Fragen eigenständig lösbar sind (alle Infos enthalten)."""


class AIService:
    def __init__(self, api_key: str = "", model: str = "nvidia/nemotron-3-super-120b-a12b:free"):
        self.api_key = api_key
        self.model = model
        self.base_url = "https://openrouter.ai/api/v1/chat/completions"
        self.chunk_size = 6000
        self.overlap = 1000
        self.temperature = 0.3
        self.max_workers = 4
        from collections import OrderedDict
        self._cache: "OrderedDict[str, str]" = OrderedDict()
        self._cache_max = 256
        self._cache_lock = threading.Lock()

    # ── Caching ──

    def _cache_key(self, messages: list[dict]) -> str:
        raw = json.dumps(messages, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(raw.encode()).hexdigest()

    def _cache_get(self, key: str):
        with self._cache_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
            return None

    def _cache_put(self, key: str, value: str) -> None:
        with self._cache_lock:
            self._cache[key] = value
            self._cache.move_to_end(key)
            while len(self._cache) > self._cache_max:
                self._cache.popitem(last=False)

    def clear_cache(self) -> None:
        """Clear the in-memory response cache."""
        with self._cache_lock:
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
                  temperature: float | None = None, model: str | None = None) -> Optional[str]:
        if not self.api_key:
            return None

        # Check cache
        cache_key = self._cache_key(messages)
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://quiz-lerntrainer.app",
        }
        payload = {
            "model": model or self.model,
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
                if resp.status_code == 404 and (model or self.model) != "nvidia/nemotron-3-super-120b-a12b:free":
                    used = model or self.model
                    # Only prompt on the main (UI) thread – calling tkinter from
                    # a worker thread can crash. In a worker we fall back silently.
                    if threading.current_thread() is threading.main_thread():
                        from tkinter import messagebox
                        fallback = messagebox.askyesno(
                            "Modell nicht verfügbar",
                            f'Das Modell "{used}" ist nicht verfügbar (404).\n\n'
                            f'Soll stattdessen "nvidia/nemotron-3-super-120b-a12b:free" verwendet werden?'
                        )
                    else:
                        fallback = True
                    if fallback:
                        payload["model"] = "nvidia/nemotron-3-super-120b-a12b:free"
                        continue
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                self._cache_put(cache_key, content)
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
                elif qt == QuestionType.MATH_FORMULA:
                    q.correct_formula = item.get("correct_formula", item.get("correct_text", ""))
                    q.tolerance = float(item.get("tolerance", 0))
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
            if fitz is not None:
                doc = fitz.open(str(path))
                pages = []
                for page in doc:
                    pages.append(page.get_text("text"))
                doc.close()
                return "\n\n--- Seite ---\n\n".join(pages)
            if PdfReader is not None:
                reader = PdfReader(str(path))
                pages = []
                for page in reader.pages:
                    pages.append(page.extract_text() or "")
                return "\n\n--- Seite ---\n\n".join(pages)
            raise RuntimeError(
                "Keine PDF-Bibliothek installiert. Bitte 'pip install PyMuPDF' "
                "(oder 'pip install pypdf') ausführen und die App neu starten."
            )

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

    def extract_images_from_pdf(self, file_path: str, out_dir: str,
                                 min_width: int = 200, min_height: int = 200,
                                 max_images: int = 30) -> list[str]:
        """Extract significant images/diagrams from a PDF and save them to out_dir.
        Filters out tiny images (icons, logos, bullets) by minimum dimensions.
        Returns a list of saved image file paths. Requires PyMuPDF (fitz)."""
        if fitz is None:
            return []
        path = Path(file_path)
        if path.suffix.lower() != ".pdf":
            return []
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)

        saved = []
        seen_xrefs = set()
        try:
            doc = fitz.open(str(path))
        except Exception:
            return []
        try:
            for page_num in range(len(doc)):
                page = doc[page_num]
                for img in page.get_images(full=True):
                    xref = img[0]
                    if xref in seen_xrefs:
                        continue
                    seen_xrefs.add(xref)
                    try:
                        base = doc.extract_image(xref)
                    except Exception:
                        continue
                    w = base.get("width", 0)
                    h = base.get("height", 0)
                    if w < min_width or h < min_height:
                        continue
                    ext = base.get("ext", "png")
                    img_bytes = base.get("image")
                    if not img_bytes:
                        continue
                    fname = out / f"{path.stem}_p{page_num+1}_{xref}.{ext}"
                    try:
                        with open(fname, "wb") as f:
                            f.write(img_bytes)
                        saved.append(str(fname))
                    except OSError:
                        continue
                    if len(saved) >= max_images:
                        return saved
        finally:
            doc.close()
        return saved

    def _detect_visual_pages(self, file_path: str) -> list[dict]:
        """Detect PDF pages that contain significant visual content.

        Returns a list of dicts: {"page": int, "reason": str, "text": str,
        "has_embedded_images": bool, "has_drawings": bool, "text_ratio": float}.
        """
        if fitz is None:
            return []
        try:
            doc = fitz.open(str(file_path))
        except Exception:
            return []
        results = []
        try:
            for i in range(len(doc)):
                page = doc[i]
                text = page.get_text("text").strip()
                page_area = page.rect.width * page.rect.height
                text_blocks = page.get_text("blocks")
                text_area = sum(
                    (b[2] - b[0]) * (b[3] - b[1])
                    for b in text_blocks if b[6] == 0
                )
                text_ratio = text_area / page_area if page_area > 0 else 1.0

                embedded_imgs = page.get_images(full=True)
                has_big_images = any(
                    self._is_significant_image(doc, img[0])
                    for img in embedded_imgs
                )

                drawings = page.get_drawings()
                has_drawings = len(drawings) > 10

                is_visual = has_big_images or has_drawings or text_ratio < 0.3
                if is_visual:
                    reasons = []
                    if has_big_images:
                        reasons.append("eingebettete Bilder")
                    if has_drawings:
                        reasons.append(f"Vektorgrafiken ({len(drawings)} Zeichnungen)")
                    if text_ratio < 0.3:
                        reasons.append(f"wenig Text ({text_ratio:.0%})")
                    results.append({
                        "page": i,
                        "reason": ", ".join(reasons),
                        "text": text,
                        "has_embedded_images": has_big_images,
                        "has_drawings": has_drawings,
                        "text_ratio": text_ratio,
                    })
        finally:
            doc.close()
        return results

    @staticmethod
    def _is_significant_image(doc, xref: int, min_dim: int = 150) -> bool:
        try:
            base = doc.extract_image(xref)
            return base.get("width", 0) >= min_dim and base.get("height", 0) >= min_dim
        except Exception:
            return False

    def render_pdf_pages(self, file_path: str, out_dir: str,
                         pages: list[int] | None = None,
                         dpi: int = 150, max_pages: int = 30) -> list[dict]:
        """Render PDF pages as PNG images.

        Args:
            pages: list of 0-based page indices, or None for visual pages only.
        Returns list of {"page": int, "path": str, "text": str}.
        """
        if fitz is None:
            return []
        path = Path(file_path)
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)

        try:
            doc = fitz.open(str(path))
        except Exception:
            return []

        if pages is None:
            visual = self._detect_visual_pages(file_path)
            pages = [v["page"] for v in visual][:max_pages]

        results = []
        try:
            zoom = dpi / 72.0
            mat = fitz.Matrix(zoom, zoom)
            for page_num in pages[:max_pages]:
                if page_num >= len(doc):
                    continue
                page = doc[page_num]
                pix = page.get_pixmap(matrix=mat)
                fname = out / f"{path.stem}_page{page_num+1}.png"
                pix.save(str(fname))
                results.append({
                    "page": page_num,
                    "path": str(fname),
                    "text": page.get_text("text").strip(),
                })
        finally:
            doc.close()
        return results

    def extract_images_with_context(self, file_path: str, out_dir: str,
                                     max_items: int = 30) -> list[dict]:
        """Extract images from a PDF with surrounding text context.

        Combines embedded image extraction with page rendering for visual pages.
        Returns list of {"path": str, "context": str, "page": int, "source": str}.
        """
        path = Path(file_path)
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        results = []
        pages_covered = set()

        if fitz is None:
            return results

        try:
            doc = fitz.open(str(path))
        except Exception:
            return results

        try:
            for page_num in range(len(doc)):
                page = doc[page_num]
                page_text = page.get_text("text").strip()
                for img in page.get_images(full=True):
                    xref = img[0]
                    if not self._is_significant_image(doc, xref):
                        continue
                    try:
                        base = doc.extract_image(xref)
                    except Exception:
                        continue
                    ext = base.get("ext", "png")
                    img_bytes = base.get("image")
                    if not img_bytes:
                        continue
                    fname = out / f"{path.stem}_p{page_num+1}_{xref}.{ext}"
                    try:
                        with open(fname, "wb") as f:
                            f.write(img_bytes)
                    except OSError:
                        continue
                    results.append({
                        "path": str(fname),
                        "context": page_text[:2000],
                        "page": page_num,
                        "source": "embedded",
                    })
                    pages_covered.add(page_num)
                    if len(results) >= max_items:
                        break
                if len(results) >= max_items:
                    break
        finally:
            doc.close()

        visual_pages = self._detect_visual_pages(file_path)
        remaining = max_items - len(results)
        if remaining > 0:
            render_pages = [
                v["page"] for v in visual_pages
                if v["page"] not in pages_covered
                and (v["has_drawings"] or v["text_ratio"] < 0.3)
            ][:remaining]
            if render_pages:
                rendered = self.render_pdf_pages(file_path, str(out), pages=render_pages)
                for r in rendered:
                    results.append({
                        "path": r["path"],
                        "context": r["text"][:2000],
                        "page": r["page"],
                        "source": "page_render",
                    })

        return results

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

    def _chunk_by_pages(self, text: str) -> list[str]:
        """Split text by page/slide boundaries, grouping pages to fit chunk_size.

        Falls back to overlap chunking if no page markers are found."""
        separators = ["--- Seite ---", "--- Folie ---"]
        pages = None
        for sep in separators:
            if sep in text:
                pages = text.split(sep)
                break
        if not pages:
            return self._chunk_with_overlap(text)

        pages = [p.strip() for p in pages if p.strip()]
        if not pages:
            return self._chunk_with_overlap(text)

        chunks = []
        current = []
        current_len = 0
        for i, page in enumerate(pages):
            page_with_marker = f"\n\n[Seite {i+1}]\n{page}"
            if current_len + len(page_with_marker) > self.chunk_size and current:
                chunks.append("\n".join(current))
                overlap_text = current[-1] if current else ""
                current = [overlap_text] if len(overlap_text) < self.chunk_size // 3 else []
                current_len = len(current[0]) if current else 0
            current.append(page_with_marker)
            current_len += len(page_with_marker)
        if current:
            chunks.append("\n".join(current))
        return chunks if chunks else self._chunk_with_overlap(text)

    # ── Model Recommendations ──

    RECOMMENDED_MODELS = [
        # ── Gratis (nur Text) ──
        {"id": "nvidia/nemotron-3-super-120b-a12b:free", "name": "Nemotron 3 Super (gratis)", "cost_in": 0, "cost_out": 0, "speed": "schnell",
         "vision": False, "context": 128000, "strengths": ["Allgemeinwissen", "Informatik", "Technik"]},
        {"id": "meta-llama/llama-3.3-70b-instruct:free", "name": "Llama 3.3 70B (gratis)", "cost_in": 0, "cost_out": 0, "speed": "mittel",
         "vision": False, "context": 131072, "strengths": ["Allgemeinwissen", "Sprachen", "Logik"]},
        {"id": "qwen/qwen3-next-80b-a3b-instruct:free", "name": "Qwen3 Next 80B (gratis)", "cost_in": 0, "cost_out": 0, "speed": "schnell",
         "vision": False, "context": 262144, "strengths": ["MINT", "Mathematik", "Programmierung"]},
        {"id": "openai/gpt-oss-120b:free", "name": "GPT-OSS 120B (gratis)", "cost_in": 0, "cost_out": 0, "speed": "mittel",
         "vision": False, "context": 131072, "strengths": ["Allgemeinwissen", "Logik", "Naturwissenschaften"]},
        {"id": "google/gemma-4-31b-it:free", "name": "Gemma 4 31B (gratis)", "cost_in": 0, "cost_out": 0, "speed": "schnell",
         "vision": False, "context": 128000, "strengths": ["Sprachen", "Allgemeinwissen"]},
        # ── Gratis (mit Bildern) ──
        {"id": "nvidia/nemotron-nano-12b-v2-vl:free", "name": "Nemotron Nano VL (gratis)", "cost_in": 0, "cost_out": 0, "speed": "schnell",
         "vision": True, "context": 128000, "strengths": ["Bilder", "Diagramme", "Allgemeinwissen"]},
        {"id": "nvidia/nemotron-3.5-content-safety:free", "name": "Nemotron 3.5 Safety (gratis)", "cost_in": 0, "cost_out": 0, "speed": "schnell",
         "vision": True, "context": 128000, "strengths": ["Bilder", "Diagramme"]},
        # ── Günstig (mit Bildern) ──
        {"id": "openai/gpt-4o-mini-2024-07-18", "name": "GPT-4o Mini", "cost_in": 0.15, "cost_out": 0.60, "speed": "schnell",
         "vision": True, "context": 128000, "strengths": ["Allgemeinwissen", "Sprachen", "Bilder"]},
        {"id": "amazon/nova-2-lite-v1", "name": "Amazon Nova 2 Lite", "cost_in": 0.30, "cost_out": 2.50, "speed": "schnell",
         "vision": True, "context": 300000, "strengths": ["Allgemeinwissen", "Bilder", "Dokumente"]},
        {"id": "deepseek/deepseek-chat", "name": "DeepSeek Chat", "cost_in": 0.14, "cost_out": 0.28, "speed": "schnell",
         "vision": False, "context": 128000, "strengths": ["Mathematik", "Physik", "Programmierung", "Technik"]},
        {"id": "deepseek/deepseek-r1", "name": "DeepSeek R1 (Reasoning)", "cost_in": 0.70, "cost_out": 2.50, "speed": "langsam",
         "vision": False, "context": 164000, "strengths": ["Mathematik", "Logik", "Physik", "Programmierung"]},
        {"id": "google/gemini-2.5-flash", "name": "Gemini 2.5 Flash", "cost_in": 0.15, "cost_out": 0.60, "speed": "schnell",
         "vision": True, "context": 1000000, "strengths": ["Medizin", "Biologie", "Naturwissenschaften", "Sprachen"]},
        {"id": "google/gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash Lite", "cost_in": 0.075, "cost_out": 0.30, "speed": "schnell",
         "vision": True, "context": 1000000, "strengths": ["Allgemeinwissen", "Sprachen", "Bilder"]},
        {"id": "thudm/glm-4-32b:free", "name": "GLM-4 32B (gratis)", "cost_in": 0, "cost_out": 0, "speed": "schnell",
         "vision": False, "context": 32768, "strengths": ["MINT", "Sprachen", "Allgemeinwissen"]},
        # ── Mittelklasse ──
        {"id": "anthropic/claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5", "cost_in": 1.00, "cost_out": 5.00, "speed": "schnell",
         "vision": True, "context": 200000, "strengths": ["BWL", "VWL", "Geisteswissenschaften", "Pädagogik"]},
        {"id": "google/gemini-2.5-pro", "name": "Gemini 2.5 Pro", "cost_in": 1.25, "cost_out": 10.0, "speed": "mittel",
         "vision": True, "context": 1000000, "strengths": ["Medizin", "Jura", "Naturwissenschaften"]},
        {"id": "openai/gpt-4o", "name": "GPT-4o", "cost_in": 2.50, "cost_out": 10.0, "speed": "mittel",
         "vision": True, "context": 128000, "strengths": ["Geschichte", "Philosophie", "Sozialwissenschaften"]},
        {"id": "anthropic/claude-sonnet-4-6", "name": "Claude Sonnet 4.6", "cost_in": 3.00, "cost_out": 15.0, "speed": "mittel",
         "vision": True, "context": 200000, "strengths": ["MINT", "Informatik", "Logik", "Jura"]},
        # ── Premium ──
        {"id": "anthropic/claude-opus-4-8", "name": "Claude Opus 4.8", "cost_in": 15.00, "cost_out": 75.0, "speed": "langsam",
         "vision": True, "context": 200000, "strengths": ["Forschung", "komplexe Analysen", "Medizin"]},
    ]

    @classmethod
    def get_vision_models(cls) -> list[dict]:
        return [m for m in cls.RECOMMENDED_MODELS if m.get("vision")]

    @classmethod
    def get_cheapest_vision_model(cls) -> str:
        vision = cls.get_vision_models()
        if not vision:
            return "nvidia/nemotron-nano-12b-v2-vl:free"
        return min(vision, key=lambda m: m["cost_in"] + m["cost_out"])["id"]

    def is_current_model_vision(self) -> bool:
        m = next((m for m in self.RECOMMENDED_MODELS if m["id"] == self.model), None)
        return m.get("vision", False) if m else False

    @classmethod
    def rank_models_for_topic(cls, topic: str) -> list[dict]:
        """Return models sorted by relevance to the given topic.
        Top 3 get dynamic tags: Empfehlung, Geschwindigkeit, Kosten."""
        topic_lower = topic.lower()
        scored = []
        for m in cls.RECOMMENDED_MODELS:
            score = 0
            for s in m.get("strengths", []):
                if s.lower() in topic_lower or topic_lower in s.lower():
                    score += 10
                words_s = set(s.lower().split())
                words_t = set(topic_lower.split())
                score += len(words_s & words_t) * 3
            scored.append((score, m))

        scored.sort(key=lambda x: -x[0])
        best_accuracy = scored[0][1]
        fastest = min(cls.RECOMMENDED_MODELS, key=lambda m: 0 if m["speed"] == "schnell" else 1)
        cheapest = min(cls.RECOMMENDED_MODELS, key=lambda m: m["cost_in"] + m["cost_out"])

        result = []
        used_ids = set()
        for tag, model in [("Empfehlung", best_accuracy), ("Geschwindigkeit", fastest), ("Kosten", cheapest)]:
            entry = {**model, "tag": tag}
            if model["id"] not in used_ids:
                result.append(entry)
                used_ids.add(model["id"])

        for _, m in scored:
            if m["id"] not in used_ids:
                result.append({**m, "tag": ""})
                used_ids.add(m["id"])

        return result

    def analyze_document(self, file_path: str) -> dict:
        """Quick analysis of document: topic, complexity, language.
        Returns {topic, complexity, language, summary, num_pages_or_slides}."""
        try:
            text = self._read_file_as_text(file_path)
        except Exception as e:
            return {"topic": "Unbekannt", "complexity": "Unbekannt", "summary": str(e)}

        sample = text[:3000]
        messages = [
            {"role": "system", "content": (
                "Analysiere das folgende Dokument-Snippet und gib eine kurze Einschätzung. "
                "Antworte NUR mit diesem JSON-Format:\n"
                '{"topic": "Hauptthema (z.B. Werkstoffkunde, Mathematik, BWL)", '
                '"subtopics": ["Unterthema1", "Unterthema2"], '
                '"complexity": "einfach|mittel|schwer|sehr schwer", '
                '"language": "de|en|other", '
                '"summary": "1-2 Sätze Zusammenfassung"}'
            )},
            {"role": "user", "content": f"Dokument-Anfang:\n\n{sample}"},
        ]
        response = self._call_api(messages, max_tokens=256, temperature=0.0)
        if not response or response.startswith("ERROR:"):
            return {"topic": "Unbekannt", "complexity": "Unbekannt", "summary": "Analyse nicht möglich"}
        try:
            raw = response.strip()
            if "```json" in raw:
                raw = raw.split("```json")[1].split("```")[0]
            elif "```" in raw:
                raw = raw.split("```")[1].split("```")[0]
            brace_s = raw.find("{")
            brace_e = raw.rfind("}") + 1
            if brace_s != -1 and brace_e > 0:
                return json.loads(raw[brace_s:brace_e])
        except (json.JSONDecodeError, KeyError):
            pass
        return {"topic": "Unbekannt", "complexity": "Unbekannt", "summary": response[:200]}

    @classmethod
    def _cost_label(cls, cost_in: float, cost_out: float) -> str:
        total = cost_in + cost_out
        if total < 1.0:
            return "$"
        if total < 5.0:
            return "$$"
        return "$$$"

    def estimate_processing(self, file_path: str, mode: str = "generate",
                            model_override: str = "") -> dict:
        """Estimate processing time before starting.
        Returns {file_size, text_length, num_chunks, est_seconds_per_chunk,
                 est_total_seconds, parallel}."""
        import os
        file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
        try:
            text = self._read_file_as_text(file_path)
        except Exception:
            text = ""
        text_len = len(text)
        overlap = max(500, self.chunk_size // 6)
        if text_len <= self.chunk_size:
            num_chunks = 1
        else:
            step = max(1, self.chunk_size - overlap)
            num_chunks = max(1, (text_len - self.chunk_size) // step + 2)

        est_per_chunk = 30  # seconds — includes API latency + JSON generation + possible retry
        if mode == "import":
            est_per_chunk = 25
            parallel = min(self.max_workers, num_chunks)
            est_total = max(est_per_chunk, (num_chunks / parallel) * est_per_chunk)
        else:
            parallel = 1
            est_total = num_chunks * est_per_chunk

        # Cost estimation: ~1 token per 4 chars input, ~1000 tokens output per chunk
        input_tokens = (text_len / 4) + (num_chunks * 200)  # text + system prompt overhead
        output_tokens = num_chunks * 1000
        lookup_model = model_override or self.model
        model_info = next((m for m in self.RECOMMENDED_MODELS if m["id"] == lookup_model), None)
        if model_info:
            cost_in = model_info["cost_in"]
            cost_out = model_info["cost_out"]
        else:
            cost_in, cost_out = 1.0, 3.0  # conservative default
        est_cost = (input_tokens / 1_000_000) * cost_in + (output_tokens / 1_000_000) * cost_out

        return {
            "file_size": file_size,
            "text_length": text_len,
            "num_chunks": num_chunks,
            "est_seconds_per_chunk": est_per_chunk,
            "est_total_seconds": int(est_total),
            "parallel": parallel > 1,
            "est_cost_usd": round(est_cost, 4),
        }

    # ── Generate: Sequential with Rolling Summary ──

    def generate_from_slides(self, file_path: str, num_questions: int = 20,
                              progress_callback: Callable | None = None,
                              question_types: list[str] | None = None,
                              focus_topics: dict[str, float] | None = None,
                              auto_count: bool = False,
                              detail_level: str = "normal") -> list[Question]:
        full_text = self._read_file_as_text(file_path)
        chunks = self._chunk_with_overlap(full_text)
        if not chunks:
            return []

        system_prompt = _build_generate_prompt(question_types)
        all_questions: list[Question] = []
        rolling_summary = ""
        per_chunk = "so viele wie sinnvoll" if auto_count else str(max(3, num_questions // len(chunks)))

        focus_instruction = ""
        if focus_topics:
            weighted = [f"- {topic}: Gewichtung {w:.0%}" for topic, w in focus_topics.items() if w > 0]
            if weighted:
                focus_instruction = (
                    "\n\nFOKUS-THEMEN (erstelle proportional mehr Fragen zu höher gewichteten Themen):\n"
                    + "\n".join(weighted) + "\n"
                )

        for i, chunk in enumerate(chunks):
            if progress_callback:
                progress_callback(i + 1, len(chunks))

            context_prefix = ""
            if rolling_summary:
                context_prefix = (
                    f"Bisheriger Kontext (Zusammenfassung vorheriger Abschnitte):\n"
                    f"{rolling_summary}\n\n---\n\n"
                )

            detail_hint = ""
            if auto_count and detail_level == "thorough":
                detail_hint = " Sei MAXIMAL gründlich: Erstelle zu JEDEM Konzept, jeder Definition, jedem Fakt und jeder Formel mindestens eine Frage. Lieber zu viele als zu wenige!"
            elif auto_count and detail_level == "compact":
                detail_hint = " Konzentriere dich auf die wichtigsten Kernkonzepte."
            count_instruction = (
                f"Erstelle so viele Prüfungsfragen wie sinnvoll für diesen Abschnitt.{detail_hint}"
                if auto_count else
                f"Erstelle {per_chunk} Prüfungsfragen zu diesem Inhalt."
            )

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": (
                    f"{context_prefix}"
                    f"Hier ist Abschnitt {i+1} von {len(chunks)} der Vorlesungsfolien:\n\n"
                    f"{chunk}\n\n"
                    f"{count_instruction} "
                    f"Nutze verschiedene Fragetypen.{focus_instruction} "
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
        chunks = self._chunk_by_pages(full_text)
        if not chunks:
            return []

        total_steps = len(chunks) + 1  # +1 for verification pass
        result = []
        seen_texts = set()
        rolling_found: list[str] = []

        for i, chunk in enumerate(chunks):
            if progress_callback:
                progress_callback(i + 1, total_steps)

            context_prefix = ""
            if rolling_found:
                found_summary = "\n".join(f"- {t}" for t in rolling_found[-30:])
                context_prefix = (
                    f"Bereits importierte Fragen (NICHT nochmal importieren):\n"
                    f"{found_summary}\n\n---\n\n"
                )

            messages = [
                {"role": "system", "content": IMPORT_SYSTEM_PROMPT},
                {"role": "user", "content": (
                    f"{context_prefix}"
                    f"Hier ist Teil {i+1} von {len(chunks)} des Dokuments:\n\n"
                    f"{chunk}\n\n"
                    f"Importiere ALLE neuen Fragen aus diesem Abschnitt. "
                    f"Überspringe keine einzige Frage oder Teilaufgabe!"
                )},
            ]
            response = self._call_api(messages, max_tokens=8192)
            questions, _ = self._parse_response(response)
            for q in questions:
                normalized = q.text.strip().lower()
                if normalized not in seen_texts:
                    seen_texts.add(normalized)
                    result.append(q)
                    title_hint = q.title or q.text[:60]
                    rolling_found.append(title_hint)

        # Verification pass: check for missed questions
        if result and len(full_text) <= 80000:
            if progress_callback:
                progress_callback(total_steps, total_steps)
            found_list = "\n".join(
                f"{i+1}. [{q.question_type.value}] {q.title or ''}: {q.text[:80]}"
                for i, q in enumerate(result)
            )
            verify_text = full_text[:40000] if len(full_text) > 40000 else full_text
            messages = [
                {"role": "system", "content": IMPORT_VERIFY_PROMPT},
                {"role": "user", "content": (
                    f"Originaltext:\n{verify_text}\n\n---\n\n"
                    f"Bereits importierte Fragen ({len(result)} Stück):\n{found_list}\n\n"
                    f"Welche Fragen fehlen?"
                )},
            ]
            response = self._call_api(messages, max_tokens=8192)
            if response and not response.startswith("ERROR:"):
                missing_qs = self._parse_verify_response(response)
                for q in missing_qs:
                    normalized = q.text.strip().lower()
                    if normalized not in seen_texts:
                        seen_texts.add(normalized)
                        result.append(q)
        elif progress_callback:
            progress_callback(total_steps, total_steps)

        return result

    def _parse_verify_response(self, response: str) -> list['Question']:
        """Parse the verification pass response for missing questions."""
        text = response.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        brace_s = text.find("{")
        brace_e = text.rfind("}") + 1
        if brace_s == -1 or brace_e <= 0:
            return []
        raw = text[brace_s:brace_e]
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            try:
                obj = json.loads(self._repair_json(raw))
            except json.JSONDecodeError:
                return []
        missing = obj.get("missing_questions", [])
        if not missing:
            return []
        questions = []
        for item in missing:
            try:
                qt = QuestionType(item.get("question_type", "free_text"))
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

    # ── Math pipeline: extract → solve → formula sheet ──

    MATH_EXTRACT_PROMPT = """Du bist ein Experte für Mathematik-Aufgaben. Extrahiere ALLE Rechenaufgaben
aus dem Dokument. JEDE Teilaufgabe (a, b, c, …) wird eine EIGENE Aufgabe.

Wenn eine Aufgabe z.B. lautet "Löse die Gleichungen: a) 2x+3=7  b) x²-4=0  c) 3x²+x-7=0"
dann erzeuge DREI separate Einträge – einen pro Gleichung.

Dein Output MUSS dieses JSON-Format haben:
{
  "tasks": [
    {
      "id": "aufg1a",
      "source": "Aufgabe 1a",
      "text": "Vollständiger Aufgabentext dieser Teilaufgabe",
      "topic": "Gleichungen / Analysis / Geometrie / ...",
      "given": {"a": 4, "b": 3, "c": -7},
      "sought": "x_{1,2}"
    }
  ]
}

Regeln:
- JEDE Teilaufgabe = eigener Eintrag (a, b, c, i, ii, iii, etc.)
- "given": alle gegebenen Zahlenwerte als Key-Value (Symbol → Wert)
- "sought": was berechnet werden soll
- Behalte den Originaltext so genau wie möglich bei
- Importiere ALLE Aufgaben, überspringe KEINE"""

    MATH_SOLVE_PROMPT = """Du bist ein Mathematik-Tutor. Löse die folgende Aufgabe SCHRITT FÜR SCHRITT.

{user_instructions}

WICHTIG: Viele Aufgaben erfordern MEHRERE Rechenschritte mit verschiedenen Formeln.
Beispiel: Erst R_ges = R1 + R2 berechnen, dann I = U / R_ges, dann P = U * I.
Jeder Rechenschritt ist ein eigener Eintrag in "calc_chain"!

Dein Output MUSS dieses JSON-Format haben:
{{
  "calc_chain": [
    {{
      "step_nr": 1,
      "formula_name": "Name der Formel (z.B. Reihenschaltung Gesamtwiderstand)",
      "formula_latex": "R_{{ges}} = R_1 + R_2",
      "formula_template": "{{{{R_ges}}}} = {{{{R_1}}}} + {{{{R_2}}}}",
      "description": "Gesamtwiderstand berechnen",
      "inputs": [
        {{"symbol": "R_1", "name": "Widerstand 1", "unit": "Ω", "value": 100}},
        {{"symbol": "R_2", "name": "Widerstand 2", "unit": "Ω", "value": 200}}
      ],
      "result_symbol": "R_ges",
      "result_unit": "Ω",
      "result_numeric": [300.0],
      "result_text": "R_ges = 300 Ω",
      "linear_notation": "R_ges = 100 + 200 = 300"
    }},
    {{
      "step_nr": 2,
      "formula_name": "Ohmsches Gesetz",
      "formula_latex": "I = \\\\frac{{U}}{{R_{{ges}}}}",
      "formula_template": "{{{{I}}}} = \\\\frac{{{{{{U}}}}}}{{{{{{R_ges}}}}}}",
      "description": "Strom berechnen (nutzt R_ges aus Schritt 1)",
      "inputs": [
        {{"symbol": "U", "name": "Spannung", "unit": "V", "value": 12}},
        {{"symbol": "R_ges", "name": "Gesamtwiderstand (aus Schritt 1)", "unit": "Ω", "value": 300, "from_step": 1}}
      ],
      "result_symbol": "I",
      "result_unit": "A",
      "result_numeric": [0.04],
      "result_text": "I = 0,04 A = 40 mA",
      "linear_notation": "I = 12 / 300 = 0,04"
    }}
  ],
  "final_result_text": "R_ges = 300 Ω, I = 40 mA",
  "final_result_numeric": [300.0, 0.04]
}}

Regeln:
- JEDER Rechenschritt der eine eigene Formel braucht = eigener Eintrag in "calc_chain"
- Wenn ein Schritt das Ergebnis eines vorherigen nutzt: "from_step": Schritt-Nr setzen
- Auch einfache Aufgaben mit nur EINER Formel → calc_chain mit einem Eintrag
- "formula_template": Ersetze JEDE Eingabe-Variable durch {{{{symbol}}}}
- "linear_notation": Wie ein Schüler es tippen würde
- "result_numeric": Numerische Ergebnisse als Array (z.B. [1.0, -1.75] bei quadratischer Gl.)
- Nutze die Formel/Methode die der Benutzer bevorzugt (siehe Anweisungen)
- Runde auf sinnvolle Nachkommastellen"""

    MATH_GENERATE_MORE_PROMPT = """Du bist ein Mathematik-Aufgaben-Generator. Erstelle {count} neue Aufgaben
die dem gleichen Typ und Schwierigkeitsgrad entsprechen wie die Beispielaufgabe.

Beispielaufgabe:
{example}

Dein Output MUSS dieses JSON-Format haben:
{{
  "tasks": [
    {{
      "text": "Aufgabentext",
      "given": {{"a": 2, "b": 5, "c": -3}},
      "sought": "x_{{1,2}}",
      "result_text": "x₁ = 0,5; x₂ = -3",
      "result_numeric": [0.5, -3.0]
    }}
  ]
}}

Regeln:
- Variiere die Zahlenwerte, behalte den Aufgabentyp bei
- Wähle Zahlen die "schöne" Ergebnisse ergeben (ganzzahlig oder einfache Brüche)
- Rechne jede Aufgabe KORREKT durch, gib die richtigen Ergebnisse an
- Schwierigkeit beibehalten"""

    MATH_VERIFY_PROMPT = """Du bist ein präziser Mathematik-Prüfer. Dir wird eine Aufgabe
mit gegebenen Werten und einem BEHAUPTETEN Ergebnis vorgelegt. Rechne die Aufgabe
unabhängig nach und korrigiere das Ergebnis falls nötig.

Antworte NUR mit JSON:
{
  "correct": true/false,
  "result_text": "korrektes Ergebnis als Text",
  "result_numeric": [korrekte Zahl(en)]
}

Regeln:
- Rechne selbst, vertraue dem behaupteten Ergebnis NICHT
- Bei "correct": false gib die richtigen Werte in result_text/result_numeric an
- Runde auf sinnvolle Nachkommastellen"""

    def extract_math_tasks(self, file_path: str,
                           progress_callback: Callable | None = None,
                           user_instructions: str = "") -> list[dict]:
        """Extract individual math tasks from a document."""
        full_text = self._read_file_as_text(file_path)
        chunks = self._chunk_by_pages(full_text)
        if not chunks:
            return []

        all_tasks = []
        seen = set()
        total_steps = len(chunks)

        for i, chunk in enumerate(chunks):
            if progress_callback:
                progress_callback(i + 1, total_steps, "Aufgaben extrahieren")

            extra = ""
            if user_instructions:
                extra = f"\n\nBenutzer-Anweisungen: {user_instructions}"

            messages = [
                {"role": "system", "content": self.MATH_EXTRACT_PROMPT + extra},
                {"role": "user", "content": (
                    f"Abschnitt {i+1} von {len(chunks)}:\n\n{chunk}"
                )},
            ]
            response = self._call_api(messages, max_tokens=8192)
            tasks = self._parse_math_tasks(response)
            for t in tasks:
                text = t.get("text", "").strip().lower()
                if not text:
                    continue
                # Include the given values so two sub-tasks that share the same
                # wording ("Berechne x") but different data are kept separate.
                given_key = json.dumps(t.get("given", {}), sort_keys=True, ensure_ascii=False)
                key = hashlib.md5((text + "|" + given_key).encode("utf-8")).hexdigest()
                if key not in seen:
                    seen.add(key)
                    all_tasks.append(t)

        return all_tasks

    def solve_math_tasks(self, tasks: list[dict],
                         progress_callback: Callable | None = None,
                         user_instructions: str = "") -> list[dict]:
        """Solve each math task step by step, returning enriched task dicts.

        Tasks are solved concurrently (thread pool) since each is an
        independent API call – much faster for large task sets."""
        instr_text = ""
        if user_instructions:
            instr_text = f"WICHTIG – Benutzer-Anweisungen: {user_instructions}"
        prompt = self.MATH_SOLVE_PROMPT.format(user_instructions=instr_text)

        def _solve_one(task):
            messages = [
                {"role": "system", "content": prompt},
                {"role": "user", "content": (
                    f"Aufgabe: {task['text']}\n"
                    f"Gegeben: {json.dumps(task.get('given', {}), ensure_ascii=False)}\n"
                    f"Gesucht: {task.get('sought', '?')}"
                )},
            ]
            response = self._call_api(messages, max_tokens=4096)
            solution = self._parse_json_response(response) or {}
            return {**task, **solution}

        solved = [None] * len(tasks)
        done = 0
        workers = max(1, min(self.max_workers, len(tasks)))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(_solve_one, t): i for i, t in enumerate(tasks)}
            for fut in concurrent.futures.as_completed(futures):
                i = futures[fut]
                try:
                    solved[i] = fut.result()
                except Exception:
                    solved[i] = tasks[i]
                done += 1
                if progress_callback:
                    progress_callback(done, len(tasks), "Aufgaben lösen")

        return [s for s in solved if s is not None]

    def generate_similar_tasks(self, example_task: dict, count: int = 5,
                               progress_callback: Callable | None = None,
                               verify: bool = True) -> list[dict]:
        """Generate similar math tasks based on an example.

        When `verify` is set, each generated task is independently re-checked by
        a second AI pass and its result corrected if the generator miscalculated."""
        prompt = self.MATH_GENERATE_MORE_PROMPT.format(
            count=count,
            example=json.dumps(example_task, ensure_ascii=False, indent=2),
        )
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"Erstelle {count} ähnliche Aufgaben."},
        ]
        if progress_callback:
            progress_callback(1, 2, "Aufgaben generieren")
        response = self._call_api(messages, max_tokens=8192)
        result = self._parse_json_response(response) or {}
        tasks = result.get("tasks", [])

        if verify and tasks:
            if progress_callback:
                progress_callback(2, 2, "Aufgaben prüfen")
            tasks = self._verify_generated_tasks(tasks)
        return tasks

    def _verify_generated_tasks(self, tasks: list[dict]) -> list[dict]:
        """Independently re-check each generated task and patch wrong results."""
        def _verify_one(task):
            messages = [
                {"role": "system", "content": self.MATH_VERIFY_PROMPT},
                {"role": "user", "content": (
                    f"Aufgabe: {task.get('text', '')}\n"
                    f"Gegeben: {json.dumps(task.get('given', {}), ensure_ascii=False)}\n"
                    f"Gesucht: {task.get('sought', '?')}\n"
                    f"Behauptetes Ergebnis: {task.get('result_text', '')} "
                    f"{task.get('result_numeric', [])}"
                )},
            ]
            check = self._parse_json_response(self._call_api(messages, max_tokens=1024)) or {}
            if check.get("correct") is False:
                if check.get("result_text"):
                    task["result_text"] = check["result_text"]
                if check.get("result_numeric"):
                    task["result_numeric"] = check["result_numeric"]
            return task

        workers = max(1, min(self.max_workers, len(tasks)))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            return list(ex.map(_verify_one, tasks))

    def _parse_math_tasks(self, response: str | None) -> list[dict]:
        if not response or response.startswith("ERROR:"):
            return []
        parsed = self._parse_json_response(response)
        if parsed and isinstance(parsed, dict):
            return parsed.get("tasks", [])
        return []

    # ── Formula sheet (FoSa) extraction ──

    FORMULA_SYSTEM_PROMPT = r"""Du bist ein Experte für MINT-Fächer (Mathematik, Physik, Elektrotechnik,
Mechanik, Chemie usw.). Deine Aufgabe: Extrahiere ABSOLUT ALLE Formeln aus dem
gegebenen Dokumentabschnitt – sei dabei MAXIMAL gründlich und vollständig.

WICHTIG – Vollständigkeit:
1. Extrahiere JEDE Formel, die im Text vorkommt oder sich daraus ableiten lässt.
2. Für JEDE Formel: Gib auch ALLE umgestellten Varianten an!
   Beispiel: Wenn U = R * I gegeben ist, erzeuge DREI Einträge:
   - U = R * I  (berechnet U)
   - R = U / I  (berechnet R)
   - I = U / R  (berechnet I)
3. Extrahiere ALLE Hilfsformeln und Zwischenformeln, die man für mehrstufige
   Aufgaben braucht (z.B. bei Reihenschaltung: R_ges, dann I, dann U_1, U_2 …).
4. Füge relevante Einheiten-Umrechnungsformeln hinzu (z.B. km/h in m/s,
   kW in W, mA in A, Grad in Radiant usw.), wenn der Kontext es erfordert.
5. Ziel: Mindestens 10–20 Formeln pro Abschnitt. Lieber zu viele als zu wenige!

WICHTIG – ± Handling:
Wenn eine Formel ± enthält (z.B. abc-Formel), erzeuge ZWEI separate Einträge:
- Einen mit + (Name z.B. "abc-Formel (x₁, mit +)")
- Einen mit - (Name z.B. "abc-Formel (x₂, mit −)")
Jeder Eintrag muss einen eigenen gültigen Python-"expression" haben.

Dein Output MUSS exakt dieses JSON-Format haben:
{
  "summary": "Kurze Zusammenfassung der behandelten Themen/Formeln",
  "formulas": [
    {
      "name": "Name der Formel (z.B. Ohmsches Gesetz – nach U aufgelöst)",
      "category": "Mathematik | Physik | Elektrotechnik | Mechanik | Chemie | ...",
      "latex": "Anzeige-LaTeX der Formel, z.B. U = R \\cdot I",
      "template": "Gleiches LaTeX, aber jede EINGABE-Variable in {{symbol}} gewrappt, z.B. U = {{R}} \\cdot {{I}}",
      "expression": "Python-auswertbarer Ausdruck für das Ergebnis mit den Symbolen, z.B. R * I",
      "result_symbol": "Symbol das berechnet wird, z.B. U",
      "variables": [
        {"symbol": "R", "name": "Widerstand", "unit": "Ω"},
        {"symbol": "I", "name": "Stromstärke", "unit": "A"}
      ],
      "description": "Wann/wofür man die Formel benutzt"
    }
  ]
}

Regeln:
- Extrahiere JEDE relevante Formel UND alle ihre Umstellungen. Keine Duplikate,
  aber umgestellte Varianten sind KEINE Duplikate – sie sind eigene Einträge!
- "expression" MUSS gültiges Python sein (nutze ** für Potenz, x**0.5 für Wurzel).
  Bei ± erzeuge zwei separate Formeln (siehe oben). Nur wenn wirklich nicht
  auswertbar (z.B. Vektoren), setze "expression": "".
- "template" muss exakt die gleichen Symbole wie "variables" als {{symbol}} enthalten.
- Symbole in expression/template müssen mit den "variables"-Symbolen übereinstimmen.
- Alles auf Deutsch (außer Formelsymbole).
- Denke an: Grundformeln, umgestellte Varianten, Hilfsformeln, Zusammenhänge
  zwischen Größen, und Einheitenumrechnungen."""

    def _parse_formulas(self, response: str) -> tuple[list[Formula], str]:
        if not response or response.startswith("ERROR:"):
            return [], ""
        text = response.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        brace_s = text.find("{")
        brace_e = text.rfind("}") + 1
        if brace_s == -1 or brace_e <= 0:
            return [], ""
        raw = text[brace_s:brace_e]
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            try:
                obj = json.loads(self._repair_json(raw))
            except json.JSONDecodeError:
                return [], ""
        summary = obj.get("summary", "")
        formulas = []
        for item in obj.get("formulas", []):
            try:
                variables = [
                    FormulaVariable(
                        symbol=str(v.get("symbol", "")),
                        name=v.get("name", ""),
                        unit=v.get("unit", ""),
                    )
                    for v in item.get("variables", [])
                ]
                formulas.append(Formula(
                    name=item.get("name", ""),
                    category=item.get("category", ""),
                    latex=item.get("latex", ""),
                    template=item.get("template", ""),
                    expression=item.get("expression", ""),
                    result_symbol=item.get("result_symbol", ""),
                    variables=variables,
                    description=item.get("description", ""),
                ))
            except (KeyError, ValueError, TypeError):
                continue
        return formulas, summary

    def build_formula_sheet(self, file_path: str, name: str = "",
                            progress_callback: Callable | None = None) -> FormulaSheet:
        """Analyze a document and build a FormulaSheet (FoSa) covering all
        formulas needed for the contained problems – math, physics, E-tech etc."""
        import datetime
        full_text = self._read_file_as_text(file_path)
        chunks = self._chunk_with_overlap(full_text)

        all_formulas: list[Formula] = []
        seen: set[str] = set()
        rolling_summary = ""

        for i, chunk in enumerate(chunks):
            if progress_callback:
                progress_callback(i + 1, len(chunks))
            context_prefix = ""
            if rolling_summary:
                context_prefix = (
                    f"Bereits erfasste Formeln/Themen:\n{rolling_summary}\n\n---\n\n"
                )
            messages = [
                {"role": "system", "content": self.FORMULA_SYSTEM_PROMPT},
                {"role": "user", "content": (
                    f"{context_prefix}"
                    f"Abschnitt {i+1} von {len(chunks)} des Dokuments:\n\n{chunk}\n\n"
                    "Extrahiere alle relevanten Formeln im geforderten JSON-Format. "
                    "Lass bereits erfasste Formeln weg."
                )},
            ]
            response = self._call_api(messages, max_tokens=8192)
            formulas, summary = self._parse_formulas(response)
            for f in formulas:
                key = (f.name.strip().lower(), f.latex.strip())
                key_str = "|".join(key)
                if key_str not in seen and f.name.strip():
                    seen.add(key_str)
                    all_formulas.append(f)
            if summary:
                rolling_summary = (rolling_summary + " " + summary).strip()[-2000:]

        sheet_name = name or Path(file_path).stem
        subject = all_formulas[0].category if all_formulas else ""
        return FormulaSheet(
            name=sheet_name,
            subject=subject,
            formulas=all_formulas,
            created=datetime.date.today().isoformat(),
        )

    def check_solution_path(self, problem_text: str, steps: list[dict],
                            final_answer: str = "") -> str:
        """Check a worked solution (list of {formula, inputs, result} steps)
        and give detailed feedback: what was right, where errors occurred, why.
        Returns markdown feedback."""
        steps_text = "\n".join(
            f"Schritt {i+1}: Formel '{s.get('formula', '')}', "
            f"Eingaben: {s.get('inputs', '')}, Ergebnis: {s.get('result', '')}"
            for i, s in enumerate(steps)
        )
        messages = [
            {"role": "system", "content": (
                "Du bist ein Prüfungs-Tutor für MINT-Fächer. Prüfe den Lösungsweg eines "
                "Studenten Schritt für Schritt: Formelwahl, eingesetzte Werte, Rechenfehler "
                "und das Endergebnis. Gib detailliertes, konstruktives Feedback auf Deutsch "
                "im Markdown-Format: 1) Was war richtig, 2) Wo waren Fehler und warum, "
                "3) Korrekter Lösungsweg falls nötig."
            )},
            {"role": "user", "content": (
                f"Aufgabe:\n{problem_text}\n\nMein Lösungsweg:\n{steps_text}\n\n"
                f"Mein Endergebnis: {final_answer}\n\nBitte prüfe alles und gib Feedback."
            )},
        ]
        response = self._call_api(messages, max_tokens=2048)
        return response if response and not response.startswith("ERROR:") else "Feedback nicht verfügbar."

    def check_handwritten_solution(self, problem_text: str, image_path: str) -> str:
        """Vision-based check of a handwritten solution photo/screenshot.
        Analyzes solution path, calculation errors, and final answer.
        Returns markdown feedback. Requires a vision-capable model."""
        try:
            with open(image_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("ascii")
        except OSError as e:
            return f"Bild konnte nicht gelesen werden: {e}"
        suffix = Path(image_path).suffix.lower().lstrip(".") or "png"
        if suffix == "jpg":
            suffix = "jpeg"
        messages = [
            {"role": "system", "content": (
                "Du bist ein Prüfungs-Tutor für MINT-Fächer. Du bekommst eine "
                "handschriftliche Lösung als Bild. Lies sie sorgfältig, prüfe den "
                "kompletten Lösungsweg (gegebene Werte, gewählte Formeln, Umstellungen, "
                "Rechenschritte, Endergebnis) und gib detailliertes Feedback auf Deutsch "
                "im Markdown-Format: 1) Was war richtig, 2) Wo waren Rechen-/Denkfehler "
                "und warum, 3) korrektes Ergebnis und optimaler Lösungsweg."
            )},
            {"role": "user", "content": [
                {"type": "text", "text": f"Aufgabe:\n{problem_text}\n\nHier meine handschriftliche Lösung:"},
                {"type": "image_url", "image_url": {"url": f"data:image/{suffix};base64,{encoded}"}},
            ]},
        ]
        response = self._call_api(messages, max_tokens=2048)
        return response if response and not response.startswith("ERROR:") else "Feedback nicht verfügbar."

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

    def generate_cloze_text(self, text: str, blank_pct: float = 0.2,
                            min_chars: int = 0, max_chars: int = 0) -> tuple[str, list[str]]:
        """Create a cloze/fill-blank version.
        min_chars/max_chars: if >0, instruct AI to produce text in that range.
        Returns (text_with_blanks, list_of_correct_words)."""
        length_hint = ""
        if min_chars > 0 and max_chars > 0:
            length_hint = (f"Der Lückentext soll zwischen {min_chars} und {max_chars} Zeichen lang sein. "
                          f"Kürze oder erweitere den Text entsprechend, aber behalte die wichtigsten Inhalte bei. ")
        elif max_chars > 0:
            length_hint = f"Der Lückentext soll maximal {max_chars} Zeichen lang sein. "

        messages = [
            {"role": "system", "content": (
                "Du bist ein Experte für Lernmaterial. Erstelle eine EIGENE Zusammenfassung des gegebenen "
                "Textes als Lückentext. KOPIERE NICHT den Originaltext! Schreibe einen neuen, "
                "zusammenhängenden Fließtext, der die wichtigsten Konzepte erklärt. "
                "Ersetze dann wichtige Fachbegriffe, Zahlen und Schlüsselwörter durch '___'. "
                "Jede Lücke '___' muss GENAU EIN Wort oder eine kurze Wortgruppe (max 3 Wörter) ersetzen. "
                f"{length_hint}"
                "Antworte mit exakt diesem JSON-Format:\n"
                '{"cloze_text": "Zusammenfassender Text mit ___ Lücken", "answers": ["Wort1", "Wort2"]}\n'
                "Die Reihenfolge der answers muss der Reihenfolge der Lücken im Text entsprechen."
            )},
            {"role": "user", "content": (
                f"Erstelle eine lernfreundliche Zusammenfassung als Lückentext. "
                f"Etwa {int(blank_pct * 100)}% der Schlüsselbegriffe sollen als Lücken erscheinen. "
                f"Schreibe einen NEUEN zusammenfassenden Text, nicht den Originaltext kopieren!\n\n"
                f"Quelltext:\n{text}"
            )},
        ]
        max_tokens = 2048
        if max_chars > 3000:
            max_tokens = 4096
        if max_chars > 6000:
            max_tokens = 8192
        response = self._call_api(messages, max_tokens=max_tokens)
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

    def analyze_keywords(self, text: str, min_chars: int = 0, max_chars: int = 0) -> dict:
        """Analyze text, create summary, identify key terms.
        Returns {"summary": str, "keywords": [{"word": str, "index": int}, ...]}"""
        length_hint = ""
        if min_chars > 0 and max_chars > 0:
            length_hint = f"Der Text soll zwischen {min_chars} und {max_chars} Zeichen lang sein. "

        messages = [
            {"role": "system", "content": (
                "Du bist ein Experte für Lernmaterial. Erstelle eine EIGENE Zusammenfassung des gegebenen "
                "Textes als Fließtext. KOPIERE NICHT den Originaltext! "
                f"{length_hint}"
                "Identifiziere dann die wichtigsten Fachbegriffe, Zahlen und Schlüsselwörter im Text. "
                "Antworte mit exakt diesem JSON-Format:\n"
                '{"summary": "Dein zusammenfassender Fließtext hier...", '
                '"keywords": [{"word": "Wort1", "index": 0}, {"word": "Wort2", "index": 50}]}\n'
                "WICHTIG: 'index' ist die Zeichenposition wo das Wort im summary-Text BEGINNT. "
                "Jedes keyword muss EXAKT so im summary vorkommen wie angegeben. "
                "Identifiziere 10-30 relevante Wörter."
            )},
            {"role": "user", "content": f"Erstelle eine lernfreundliche Zusammenfassung und identifiziere Schlüsselwörter:\n\n{text}"},
        ]
        max_tokens = 2048
        if max_chars > 3000:
            max_tokens = 4096
        response = self._call_api(messages, max_tokens=max_tokens)
        if not response or response.startswith("ERROR:"):
            return {"summary": text, "keywords": []}
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
                summary = obj.get("summary", text)
                keywords = obj.get("keywords", [])
                # Validate: ensure each keyword actually exists in the summary
                validated = []
                for kw in keywords:
                    word = kw.get("word", "")
                    if word and word in summary:
                        real_idx = summary.index(word)
                        validated.append({"word": word, "index": real_idx})
                return {"summary": summary, "keywords": validated}
        except (json.JSONDecodeError, KeyError):
            pass
        return {"summary": text, "keywords": []}

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

    def explain_formula(self, formula_name: str, formula_latex: str,
                        variables: list[dict], style: str = "wissenschaftlich") -> Optional[str]:
        style_prompts = {
            "brain_rot": (
                "Du bist ein Gen-Z TikTok Creator. Erkläre die Formel so, als wäre sie ein Drama "
                "zwischen den Variablen. Jede Variable ist ein Charakter mit eigener Persönlichkeit. "
                "Nutze Slang, Emojis, übertriebene Metaphern. Mach es unterhaltsam und einprägsam. "
                "Stell jeden Charakter (Variable) einzeln vor mit Name, Rolle und Catchphrase."
            ),
            "wissenschaftlich": (
                "Du bist ein Uni-Professor. Erkläre die Formel und jede Variable wissenschaftlich "
                "präzise mit korrekter Terminologie. Beschreibe die physikalische/mathematische "
                "Bedeutung, Einheiten, typische Wertebereiche und Zusammenhänge."
            ),
            "klasse_1_4": (
                "Du bist ein Grundschullehrer. Erkläre die Formel so einfach wie möglich mit "
                "Alltagsbeispielen (Spielplatz, Bonbons, Tiere). Jede Variable bekommt einen "
                "einfachen Spitznamen. Keine Fachbegriffe."
            ),
            "klasse_5_7": (
                "Du bist ein engagierter Mathelehrer für die Mittelstufe. Erkläre die Formel mit "
                "konkreten Beispielen aus dem Alltag von Jugendlichen (Sport, Gaming, Social Media). "
                "Variablen werden als 'Teammitglieder' vorgestellt."
            ),
            "klasse_8_10": (
                "Du bist ein cooler MINT-Lehrer. Erkläre die Formel anschaulich mit Beispielen "
                "aus Technik und Natur. Jede Variable wird mit ihrer Rolle im 'Team' erklärt. "
                "Fachbegriffe werden eingeführt aber einfach erklärt."
            ),
            "klasse_11_13": (
                "Du bist ein Oberstufen-Lehrer der auf die Klausur vorbereitet. Erkläre die Formel "
                "semi-formal mit Fokus auf Klausur-Relevanz. Zeige typische Fehlerquellen, "
                "Spezialfälle und Eselsbrücken. Jede Variable mit Einheit und typischen Werten."
            ),
        }

        system = style_prompts.get(style, style_prompts["wissenschaftlich"])
        system += (
            "\n\nFormat: Markdown. Starte mit einer kurzen Vorstellung der Formel, "
            "dann stelle JEDE Variable einzeln vor (als eigenen Abschnitt). "
            "Am Ende: Wie hängen die Variablen zusammen? Was passiert wenn eine steigt/sinkt? "
            "Nutze $LaTeX$ für Formeln."
        )

        vars_desc = "\n".join(
            f"- {v.get('symbol', '?')}: {v.get('name', '')} [{v.get('unit', '')}]"
            for v in variables
        )

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": (
                f"Erkläre diese Formel und ihre Variablen:\n\n"
                f"**{formula_name}**\n$$${formula_latex}$$$\n\n"
                f"Variablen:\n{vars_desc}"
            )},
        ]
        return self._call_api(messages, max_tokens=2048)

    def generate_solution_path(self, question_text: str, correct_answer: str,
                                question_type: str, options: list[str] | None = None) -> Optional[str]:
        context = f"Frage: {question_text}\nRichtige Antwort: {correct_answer}"
        if options:
            context += f"\nAntwortmöglichkeiten: {', '.join(options)}"
        messages = [
            {"role": "system", "content": (
                "Du bist ein exzellenter Tutor. Erstelle den OPTIMALEN Lösungsweg für diese "
                "Aufgabe. Struktur:\n\n"
                "## Schritt 1: Aufgabe verstehen\n"
                "Was ist gegeben? Was ist gesucht?\n\n"
                "## Schritt 2-N: Lösungsschritte\n"
                "Jeder Schritt klar erklärt mit Begründung.\n"
                "Bei Mathe/Physik: Formel aufstellen → Werte einsetzen → Berechnen.\n"
                "Bei Theorie: Schlüsselbegriffe → Zusammenhänge → Begründung.\n"
                "Bei Multiple Choice: Warum die richtige Antwort stimmt UND warum die anderen falsch sind.\n\n"
                "## Ergebnis\n"
                "Die finale Antwort klar hervorgehoben.\n\n"
                "## Merkhilfe\n"
                "Eine kurze Eselsbrücke oder Tipp für die Klausur.\n\n"
                "Nutze $LaTeX$ für Formeln. Schreibe auf Deutsch."
            )},
            {"role": "user", "content": context},
        ]
        return self._call_api(messages, max_tokens=2048)

    # ── EXPERIMENTAL: AI Question Creation ── START
    def generate_single_question(self, topic: str, question_type: str,
                                  difficulty: str = "mittel",
                                  context: str = "") -> Optional[dict]:
        type_instructions = {
            "single_choice": "Erstelle eine Single-Choice-Frage mit genau 4 Optionen. Genau EINE ist korrekt.",
            "multiple_choice": "Erstelle eine Multiple-Choice-Frage mit genau 4 Optionen. MEHRERE können korrekt sein.",
            "free_text": "Erstelle eine Freitext-Frage mit einer klaren, kurzen Musterantwort.",
            "fill_blank": "Erstelle einen Lückentext. Markiere Lücken mit ___. Gib die Lösungen an.",
            "drag_drop": "Erstelle eine Zuordnungsaufgabe mit 4-6 Paaren (Begriff → Ziel).",
        }
        instruction = type_instructions.get(question_type, type_instructions["single_choice"])
        context_part = f"\n\nZusätzlicher Kontext:\n{context}" if context else ""

        messages = [
            {"role": "system", "content": (
                "Du bist ein Experte für Prüfungsfragen. "
                f"Schwierigkeit: {difficulty}. "
                f"{instruction}\n\n"
                "Antworte AUSSCHLIESSLICH mit validem JSON (kein Markdown, keine Erklärung):\n"
                "{\n"
                '  "title": "Kurztitel",\n'
                '  "text": "Vollständiger Fragentext",\n'
                '  "topic": "Themengebiet",\n'
                '  "options": [{"text": "...", "is_correct": true/false}, ...],  // nur bei SC/MC\n'
                '  "correct_text": "...",  // nur bei Freitext\n'
                '  "blanks": ["...", "..."],  // nur bei Lückentext\n'
                '  "drag_drop_pairs": [{"source": "...", "target": "..."}, ...],  // nur bei D&D\n'
                '  "explanation": "Kurze Erklärung der richtigen Antwort"\n'
                "}"
            )},
            {"role": "user", "content": f"Thema: {topic}{context_part}"},
        ]
        raw = self._call_api(messages, max_tokens=1500)
        return self._parse_json_response(raw)

    def generate_question_from_image(self, image_path: str, question_type: str = "diagram_label",
                                      topic: str = "", difficulty: str = "mittel",
                                      vision_model: str = "",
                                      context_text: str = "") -> Optional[dict]:
        """Generate a question from an image, optionally with surrounding text context."""
        if not vision_model:
            if self.is_current_model_vision():
                vision_model = self.model
            else:
                vision_model = self.get_cheapest_vision_model()
        try:
            with open(image_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("ascii")
        except OSError:
            return None
        suffix = Path(image_path).suffix.lower().lstrip(".") or "png"
        if suffix == "jpg":
            suffix = "jpeg"

        type_instructions = {
            "diagram_label": (
                "Analysiere das Diagramm/Bild SEHR GENAU. Erstelle eine DIAGRAM-LABEL Frage: "
                "Der Student soll Labels an die richtige Stelle im Diagramm ziehen.\n"
                "Identifiziere 4-8 wichtige Elemente im Bild und gib ihre Position als "
                "x/y Koordinaten (0.0 bis 1.0, relativ zur Bildgröße) an.\n\n"
                "WICHTIG für die Koordinaten:\n"
                "- x=0.0 ist der LINKE Rand, x=1.0 ist der RECHTE Rand\n"
                "- y=0.0 ist der OBERE Rand, y=1.0 ist der UNTERE Rand\n"
                "- Teile das Bild gedanklich in ein 10x10 Raster\n"
                "- Positioniere die Labels EXAKT auf dem Element, nicht daneben\n"
                "- Beispiel: Ein Element in der Mitte hat x=0.5, y=0.5\n"
                "- Beispiel: Etwas oben links hat x=0.2, y=0.15\n"
                "- Beispiel: Etwas unten rechts hat x=0.8, y=0.85\n"
                "- Nutze ZWEI Dezimalstellen für Präzision (z.B. 0.35, nicht 0.3)\n\n"
                "JSON-Format:\n"
                "{\n"
                '  "title": "Kurztitel",\n'
                '  "text": "Beschrifte das folgende Diagramm korrekt.",\n'
                '  "topic": "Themengebiet",\n'
                '  "question_type": "diagram_label",\n'
                '  "diagram_labels": [{"label": "Name des Elements", "x": 0.35, "y": 0.60}, ...],\n'
                '  "explanation": "Erklärung der korrekten Zuordnung"\n'
                "}"
            ),
            "drag_drop": (
                "Analysiere das Diagramm/Bild. Erstelle eine ZUORDNUNGS-Frage (Drag & Drop): "
                "Der Student soll Begriffe den richtigen Beschreibungen/Kategorien zuordnen, "
                "basierend auf dem was im Bild zu sehen ist.\n\n"
                "JSON-Format:\n"
                "{\n"
                '  "title": "Kurztitel",\n'
                '  "text": "Ordne die Begriffe basierend auf dem Diagramm richtig zu.",\n'
                '  "topic": "Themengebiet",\n'
                '  "question_type": "drag_drop",\n'
                '  "drag_drop_pairs": [{"source": "Begriff", "target": "Zuordnung"}, ...],\n'
                '  "explanation": "Erklärung"\n'
                "}"
            ),
            "single_choice": (
                "Analysiere das Diagramm/Bild. Erstelle eine Single-Choice-Frage darüber, "
                "was im Bild zu sehen ist. 4 Optionen, genau EINE korrekt.\n\n"
                "JSON-Format:\n"
                "{\n"
                '  "title": "Kurztitel",\n'
                '  "text": "Frage zum Diagramm",\n'
                '  "topic": "Themengebiet",\n'
                '  "question_type": "single_choice",\n'
                '  "options": [{"text": "...", "is_correct": true/false}, ...],\n'
                '  "explanation": "Erklärung"\n'
                "}"
            ),
            "multiple_choice": (
                "Analysiere das Diagramm/Bild. Erstelle eine Multiple-Choice-Frage darüber. "
                "4 Optionen, MEHRERE können korrekt sein.\n\n"
                "JSON-Format:\n"
                "{\n"
                '  "title": "Kurztitel",\n'
                '  "text": "Frage zum Diagramm",\n'
                '  "topic": "Themengebiet",\n'
                '  "question_type": "multiple_choice",\n'
                '  "options": [{"text": "...", "is_correct": true/false}, ...],\n'
                '  "explanation": "Erklärung"\n'
                "}"
            ),
        }
        instruction = type_instructions.get(question_type, type_instructions["diagram_label"])
        topic_part = f"\nThema/Kontext: {topic}" if topic else ""
        context_part = ""
        if context_text:
            context_part = (
                f"\n\nUmgebender Text auf dieser Seite (nutze ihn für Kontext, "
                f"Fachbegriffe und korrekte Antworten):\n{context_text[:2000]}"
            )

        messages = [
            {"role": "system", "content": (
                "Du bist ein Experte für visuelle Prüfungsfragen. Du analysierst Diagramme, "
                "Schaubilder und Grafiken aus Vorlesungen und erstellst daraus Prüfungsfragen.\n"
                f"Schwierigkeit: {difficulty}.\n"
                f"{instruction}\n\n"
                "Antworte AUSSCHLIESSLICH mit validem JSON (kein Markdown, keine Erklärung)."
            )},
            {"role": "user", "content": [
                {"type": "text", "text": f"Erstelle eine Frage basierend auf diesem Diagramm/Bild.{topic_part}{context_part}"},
                {"type": "image_url", "image_url": {"url": f"data:image/{suffix};base64,{encoded}"}},
            ]},
        ]
        raw = self._call_api(messages, max_tokens=2000, model=vision_model)
        return self._parse_json_response(raw)

    def _parse_json_response(self, raw: Optional[str]) -> Optional[dict]:
        if not raw or raw.startswith("ERROR:"):
            return None
        import json as _json
        text = raw.strip()
        # Strip code fences if present
        if "```json" in text:
            text = text.split("```json", 1)[1].split("```", 1)[0]
        elif text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
        # Direct parse
        try:
            return _json.loads(text.strip())
        except _json.JSONDecodeError:
            pass
        # Extract the outermost {...} object even if surrounded by prose
        start = text.find("{")
        end = text.rfind("}") + 1
        if start != -1 and end > start:
            chunk = text[start:end]
            try:
                return _json.loads(chunk)
            except _json.JSONDecodeError:
                try:
                    return _json.loads(self._repair_json(chunk))
                except _json.JSONDecodeError:
                    return None
        return None
    # ── EXPERIMENTAL: AI Question Creation ── END
