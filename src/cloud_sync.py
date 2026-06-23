"""Cloud-Sync ueber die Firestore REST-API.

Teilt sich denselben Sync-Code wie die Mobile-App. Jedes Geraet, das
denselben Code benutzt, liest und schreibt dieselben Cloud-Daten.

Datenformat (kompatibel mit der Mobile-App):
  Dokument  synced/{code}/data/{name}
  mit einem einzigen String-Feld "payload" = JSON-String der Nutzdaten.
"""

import json
import requests

# Gleiche Firebase-Konfiguration wie die Mobile-App (Projekt quiz-test-37d87)
PROJECT_ID = "quiz-test-37d87"
API_KEY = "AIzaSyBzslbApoDz0UWusBpS10DEGWY7cvIUK5s"

_BASE = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
    f"/databases/(default)/documents"
)


def sanitize_code(code: str) -> str:
    """Nur erlaubte Zeichen, max. 64 - identisch zur Mobile-App."""
    cleaned = "".join(c for c in (code or "") if c.isalnum() or c in "_-")
    return cleaned[:64]


def _doc_url(code: str, name: str) -> str:
    return f"{_BASE}/synced/{code}/data/{name}?key={API_KEY}"


def upload(code: str, name: str, data) -> bool:
    """Laedt `data` (JSON-serialisierbar) als payload-String hoch."""
    code = sanitize_code(code)
    if not code:
        return False
    body = {
        "fields": {
            "payload": {"stringValue": json.dumps(data, ensure_ascii=False)}
        }
    }
    try:
        r = requests.patch(_doc_url(code, name), json=body, timeout=20)
        return r.ok
    except requests.RequestException:
        return False


def download(code: str, name: str):
    """Holt die payload-Daten zurueck. Gibt None bei Fehler/leer."""
    code = sanitize_code(code)
    if not code:
        return None
    try:
        r = requests.get(_doc_url(code, name), timeout=20)
    except requests.RequestException:
        return None
    if r.status_code == 404:
        return None
    if not r.ok:
        return None
    try:
        doc = r.json()
        payload = doc.get("fields", {}).get("payload", {}).get("stringValue")
        if payload is None:
            return None
        return json.loads(payload)
    except (ValueError, KeyError):
        return None
