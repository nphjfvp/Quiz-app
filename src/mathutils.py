"""Shared math helpers for answer validation across scaffolding, formula
practice and games.

Consolidates the previously-duplicated `_validate_numeric` / `_safe_eval`
logic and adds an optional symbolic equivalence check (via sympy) so that
"1/2", "0.5" and "½" are all accepted as the same answer. sympy is optional –
if it is not installed everything degrades gracefully to numeric comparison.
"""

import math
import re

EPSILON = 0.02

try:  # optional dependency – symbolic checks are a bonus, never required
    import sympy as _sympy
    _HAS_SYMPY = True
except ImportError:  # pragma: no cover - depends on environment
    _sympy = None
    _HAS_SYMPY = False


# Names allowed inside user-entered expressions.
_ALLOWED_FUNCS = {
    "abs": abs, "round": round, "sqrt": math.sqrt, "pow": pow,
    "log": math.log, "log10": math.log10, "ln": math.log, "exp": math.exp,
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "asin": math.asin, "acos": math.acos, "atan": math.atan,
    "pi": math.pi, "e": math.e,
}


def has_symbolic() -> bool:
    """True when sympy is available for symbolic equivalence checks."""
    return _HAS_SYMPY


def normalize_number_str(value_str: str) -> str:
    """Normalise a user-typed number: German decimal comma, whitespace,
    common root/power notation."""
    s = str(value_str).strip()
    s = s.replace(" ", "")
    # Treat comma as decimal separator only when it is not an argument list.
    if "," in s and ";" not in s:
        s = s.replace(",", ".")
    return s


def validate_numeric(value_str, correct, epsilon: float = EPSILON) -> bool:
    """Return True if `value_str` matches `correct` within tolerance.

    `correct` may be a single number or a list/tuple of acceptable values
    (e.g. the two roots of a quadratic)."""
    try:
        user_val = float(normalize_number_str(value_str))
    except (ValueError, TypeError):
        return False
    candidates = correct if isinstance(correct, (list, tuple)) else [correct]
    for c in candidates:
        try:
            if math.isclose(round(user_val, 2), round(float(c), 2), abs_tol=epsilon):
                return True
        except (ValueError, TypeError):
            continue
    return False


def safe_eval(expression: str, var_values: dict | None = None):
    """Evaluate a restricted arithmetic expression. Returns the rounded float
    result, or None if it cannot be evaluated safely."""
    env = dict(_ALLOWED_FUNCS)
    if var_values:
        env.update(var_values)
    try:
        result = eval(expression, {"__builtins__": {}}, env)  # noqa: S307 - sandboxed
        return round(float(result), 2)
    except Exception:
        return None


def _sanitize_expr(raw: str) -> str:
    """Turn student notation into a python-evaluable expression."""
    s = normalize_number_str(raw)
    s = s.replace("^", "**").replace("wrzl", "sqrt").replace("√", "sqrt")
    # implicit multiplication: 2x -> 2*x, 3(... -> 3*(...
    s = re.sub(r'(\d)([a-zA-Z(])', r'\1*\2', s)
    # take the right-hand side if the user typed "x = ..."
    if "=" in s:
        s = s.split("=")[-1]
    return s


def evaluate_user_expression(raw: str, var_values: dict | None = None):
    """Evaluate a free-form student expression (handles ^, √, implicit ×,
    leading 'x ='). Returns rounded float or None."""
    if not raw or not raw.strip():
        return None
    return safe_eval(_sanitize_expr(raw), var_values)


def symbolic_equal(user_str: str, correct_str: str) -> bool:
    """Check symbolic/exact equivalence using sympy when available.

    Accepts e.g. "1/2" == "0.5", "2*pi" == "6.283...", "sqrt(2)" forms.
    Returns False (never raises) when sympy is missing or parsing fails."""
    if not _HAS_SYMPY or not user_str or not correct_str:
        return False
    try:
        u = _sympy.sympify(_sanitize_expr(user_str), rational=True)
        c = _sympy.sympify(_sanitize_expr(correct_str), rational=True)
        diff = _sympy.simplify(u - c)
        return diff == 0 or abs(float(diff)) < EPSILON
    except Exception:
        return False


def check_answer(value_str, correct_numeric=None, correct_text: str = "",
                 epsilon: float = EPSILON) -> bool:
    """Unified answer check: numeric tolerance first, then symbolic, then a
    case-insensitive text fallback.

    `correct_numeric` may be a number or list of numbers. `correct_text` is the
    canonical written answer (used for symbolic and text comparison)."""
    if value_str is None or str(value_str).strip() == "":
        return False

    if correct_numeric not in (None, [], ()):
        if validate_numeric(value_str, correct_numeric, epsilon):
            return True

    if correct_text:
        # numeric value of the canonical answer, if it is a plain number
        correct_val = None
        try:
            correct_val = float(normalize_number_str(correct_text))
        except (ValueError, TypeError):
            pass
        if correct_val is not None:
            if validate_numeric(value_str, correct_val, epsilon):
                return True
            # evaluate the user's expression (e.g. "1/2") against it
            user_eval = evaluate_user_expression(str(value_str))
            if user_eval is not None and validate_numeric(str(user_eval), correct_val, epsilon):
                return True
        if symbolic_equal(value_str, correct_text):
            return True
        if str(value_str).strip().lower() == correct_text.strip().lower():
            return True

    # Last resort: evaluate the user's expression and compare numerically.
    if correct_numeric not in (None, [], ()):
        user_eval = evaluate_user_expression(str(value_str))
        if user_eval is not None and validate_numeric(str(user_eval), correct_numeric, epsilon):
            return True

    return False
