"""Render LaTeX math formulas as PIL Images using matplotlib's mathtext."""

import re
from io import BytesIO

try:
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from PIL import Image as PILImage
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False

# Matches $...$ (inline) and $$...$$ (display) but not \$
_LATEX_RE = re.compile(r'(?<![\\])\$\$(.+?)\$\$|(?<![\\])\$(.+?)\$', re.DOTALL)

# Detects bare LaTeX commands/markup that the AI sometimes emits without $ delimiters
_BARE_LATEX_RE = re.compile(
    r'\\(?:frac|sqrt|sum|prod|int|lim|cdot|times|leq|geq|neq|approx|pm|infty|partial'
    r'|alpha|beta|gamma|delta|theta|lambda|mu|sigma|pi|omega|Delta|Sigma|Omega'
    r'|left|right|text|mathrm|mathbf|vec|hat|bar|overline|begin|end)\b'
    r'|[A-Za-z0-9\)\]\}]\s*\^\s*[A-Za-z0-9\{\(]'      # exponent: x^2, a^{n}
    r'|[A-Za-z0-9\)\]\}]\s*_\s*[A-Za-z0-9\{\(]'        # subscript: x_i, a_{n}
)


def autowrap_latex(text: str) -> str:
    """Wrap bare LaTeX tokens (no $ delimiters) in $...$ so the renderer picks
    them up. Token-based so prose stays intact: 'Berechne \\frac{1}{2}' becomes
    'Berechne $\\frac{1}{2}$'. Leaves text that already contains $ untouched."""
    if not text or "$" in text:
        return text
    if not _BARE_LATEX_RE.search(text):
        return text
    out = []
    for token in text.split(" "):
        if token and _BARE_LATEX_RE.search(token):
            out.append(f"${token}$")
        else:
            out.append(token)
    return " ".join(out)



def can_render() -> bool:
    return HAS_MATPLOTLIB


def render_formula(latex: str, fontsize: int = 16, dpi: int = 120,
                   text_color: str = "#1a1a2e", bg_color: str = "#ffffff") -> "PILImage.Image | None":
    """Render a LaTeX math string to a PIL Image. Returns None on failure."""
    if not HAS_MATPLOTLIB:
        return None
    try:
        fig = Figure(figsize=(4, 0.5))
        fig.patch.set_alpha(0.0)
        text_obj = fig.text(0.05, 0.5, f"${latex}$", fontsize=fontsize, color=text_color,
                            verticalalignment="center")
        canvas = FigureCanvasAgg(fig)
        canvas.draw()
        buf = BytesIO()
        fig.savefig(buf, format="png", dpi=dpi, transparent=True,
                    bbox_inches="tight", pad_inches=0.05)
        buf.seek(0)
        img = PILImage.open(buf).copy()
        buf.close()
        del fig, canvas
        return img
    except Exception:
        return None


def split_text_and_formulas(text: str) -> list[dict]:
    """Split text into segments: {"type": "text", "content": "..."} or {"type": "latex", "content": "..."}
    Display math ($$...$$) gets type "latex_block", inline ($...$) gets "latex"."""
    parts = []
    last_end = 0
    for m in _LATEX_RE.finditer(text):
        if m.start() > last_end:
            parts.append({"type": "text", "content": text[last_end:m.start()]})
        display = m.group(1)
        inline = m.group(2)
        if display is not None:
            parts.append({"type": "latex_block", "content": display})
        else:
            parts.append({"type": "latex", "content": inline})
        last_end = m.end()
    if last_end < len(text):
        parts.append({"type": "text", "content": text[last_end:]})
    return parts


def latex_to_plain(text: str) -> str:
    """Fallback: strip $ delimiters and do basic substitutions for readability."""
    def replace_formula(m):
        formula = m.group(1) or m.group(2)
        formula = re.sub(r'\\frac\{([^}]*)\}\{([^}]*)\}', r'(\1)/(\2)', formula)
        formula = formula.replace("\\cdot", "·").replace("\\times", "×")
        formula = formula.replace("\\sqrt", "√").replace("\\pm", "±")
        formula = formula.replace("\\leq", "≤").replace("\\geq", "≥")
        formula = formula.replace("\\neq", "≠").replace("\\approx", "≈")
        formula = formula.replace("\\alpha", "α").replace("\\beta", "β")
        formula = formula.replace("\\gamma", "γ").replace("\\delta", "δ")
        formula = formula.replace("\\pi", "π").replace("\\theta", "θ")
        formula = formula.replace("\\sum", "Σ").replace("\\prod", "Π")
        formula = formula.replace("\\infty", "∞").replace("\\partial", "∂")
        formula = formula.replace("\\int", "∫")
        formula = re.sub(r'\\text\{([^}]*)\}', r'\1', formula)
        formula = re.sub(r'([_^])\{([^}]*)\}', r'\1\2', formula)
        formula = formula.replace("{", "").replace("}", "")
        formula = formula.replace("\\left", "").replace("\\right", "")
        formula = formula.replace("\\", "")
        return formula
    return _LATEX_RE.sub(replace_formula, text)


def has_latex(text: str) -> bool:
    return bool(_LATEX_RE.search(text) or _BARE_LATEX_RE.search(text))
