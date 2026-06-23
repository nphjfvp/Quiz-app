"""Firebase Authentication via the Identity Toolkit REST API.

Optionaler Account: Die App bleibt komplett ohne Login nutzbar. Ein Account
dient nur als komfortable, geraeteuebergreifende Identitaet fuer den Sync und
spaetere geteilte Features (Lerngruppen, Peer-Review).

Verwendet dasselbe Firebase-Projekt wie der Sync (quiz-test-37d87).
"""

import time
import requests

# Gleiche Firebase-Konfiguration wie cloud_sync / Mobile-App.
API_KEY = "AIzaSyBzslbApoDz0UWusBpS10DEGWY7cvIUK5s"

_AUTH_BASE = "https://identitytoolkit.googleapis.com/v1/accounts"
_TOKEN_BASE = "https://securetoken.googleapis.com/v1/token"


class AuthError(Exception):
    """Fehler mit benutzerfreundlicher Nachricht."""


# Firebase-Fehlercodes -> verstaendliche (DE) Meldungen.
_ERROR_MESSAGES = {
    "EMAIL_EXISTS": "Diese E-Mail ist bereits registriert.",
    "EMAIL_NOT_FOUND": "Kein Konto mit dieser E-Mail gefunden.",
    "INVALID_PASSWORD": "Falsches Passwort.",
    "INVALID_LOGIN_CREDENTIALS": "E-Mail oder Passwort ist falsch.",
    "INVALID_EMAIL": "Ungueltige E-Mail-Adresse.",
    "WEAK_PASSWORD : Password should be at least 6 characters":
        "Passwort muss mindestens 6 Zeichen haben.",
    "USER_DISABLED": "Dieses Konto wurde deaktiviert.",
    "TOO_MANY_ATTEMPTS_TRY_LATER": "Zu viele Versuche. Bitte spaeter erneut versuchen.",
    "OPERATION_NOT_ALLOWED": "E-Mail/Passwort-Login ist im Firebase-Projekt nicht aktiviert.",
    "PASSWORD_LOGIN_DISABLED":
        "E-Mail/Passwort-Login ist im Firebase-Projekt noch nicht aktiviert. "
        "Bitte in der Firebase-Console unter Authentication > Sign-in method "
        "die Methode 'E-Mail/Passwort' aktivieren.",
}


def _friendly(code: str) -> str:
    if code in _ERROR_MESSAGES:
        return _ERROR_MESSAGES[code]
    if code.startswith("WEAK_PASSWORD"):
        return "Passwort muss mindestens 6 Zeichen haben."
    return code or "Unbekannter Fehler."


def _post(url: str, body: dict) -> dict:
    try:
        r = requests.post(url, json=body, timeout=20)
    except requests.RequestException as e:
        raise AuthError(f"Netzwerkfehler: {e}")
    data = {}
    try:
        data = r.json()
    except ValueError:
        pass
    if not r.ok:
        code = data.get("error", {}).get("message", "")
        raise AuthError(_friendly(code))
    return data


def _session_from_response(data: dict) -> dict:
    """Baut ein lokal speicherbares Account-Dict aus der API-Antwort."""
    expires_in = int(data.get("expiresIn", "3600"))
    return {
        "email": data.get("email", ""),
        "uid": data.get("localId", ""),
        "id_token": data.get("idToken", ""),
        "refresh_token": data.get("refreshToken", ""),
        "expires_at": time.time() + expires_in,
    }


def sign_up(email: str, password: str) -> dict:
    """Registriert ein neues Konto. Gibt das Account-Dict zurueck."""
    data = _post(
        f"{_AUTH_BASE}:signUp?key={API_KEY}",
        {"email": email.strip(), "password": password, "returnSecureToken": True},
    )
    return _session_from_response(data)


def sign_in(email: str, password: str) -> dict:
    """Meldet ein bestehendes Konto an. Gibt das Account-Dict zurueck."""
    data = _post(
        f"{_AUTH_BASE}:signInWithPassword?key={API_KEY}",
        {"email": email.strip(), "password": password, "returnSecureToken": True},
    )
    return _session_from_response(data)


def send_password_reset(email: str) -> None:
    """Sendet eine Passwort-Reset-E-Mail."""
    _post(
        f"{_AUTH_BASE}:sendOobCode?key={API_KEY}",
        {"requestType": "PASSWORD_RESET", "email": email.strip()},
    )


def refresh(account: dict) -> dict:
    """Erneuert das ID-Token ueber das Refresh-Token. Gibt aktualisiertes Dict."""
    refresh_token = account.get("refresh_token")
    if not refresh_token:
        raise AuthError("Kein Refresh-Token vorhanden.")
    try:
        r = requests.post(
            f"{_TOKEN_BASE}?key={API_KEY}",
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
            timeout=20,
        )
    except requests.RequestException as e:
        raise AuthError(f"Netzwerkfehler: {e}")
    if not r.ok:
        raise AuthError("Sitzung abgelaufen. Bitte erneut anmelden.")
    data = r.json()
    expires_in = int(data.get("expires_in", "3600"))
    updated = dict(account)
    updated["id_token"] = data.get("id_token", account.get("id_token", ""))
    updated["refresh_token"] = data.get("refresh_token", refresh_token)
    updated["uid"] = data.get("user_id", account.get("uid", ""))
    updated["expires_at"] = time.time() + expires_in
    return updated


def ensure_valid(account: dict) -> dict:
    """Gibt ein Account-Dict mit gueltigem Token zurueck (refresht bei Bedarf)."""
    if not account:
        return account
    if account.get("expires_at", 0) - time.time() > 60:
        return account
    return refresh(account)
