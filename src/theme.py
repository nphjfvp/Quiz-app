"""Theme management: light/dark color palettes.

Design direction: Duolingo meets Anki – slightly playful but clean.
Primary color family: Teal/Green. Both light and dark mode should look great.
"""

import customtkinter as ctk

# ── Design Tokens ──
FONT_FAMILY = "Segoe UI"
FONT_MONO = "Cascadia Code"
RADIUS_SM = 8
RADIUS_MD = 12
RADIUS_LG = 16
RADIUS_XL = 20

LIGHT = {
    # Brand
    "primary": "#0d9488",        # Teal 600
    "primary_dark": "#0f766e",   # Teal 700
    "primary_light": "#5eead4",  # Teal 300
    "primary_subtle": "#ccfbf1", # Teal 100
    # Semantic
    "success": "#22c55e",        # Green 500
    "success_light": "#dcfce7",  # Green 100
    "danger": "#ef4444",         # Red 500
    "danger_light": "#fee2e2",   # Red 100
    "warning": "#f59e0b",        # Amber 500
    "warning_light": "#fef3c7",  # Amber 100
    "info": "#3b82f6",           # Blue 500
    # Surfaces
    "bg": "#f0fdf4",             # Green 50 – subtle tint
    "card": "#ffffff",
    "card_hover": "#ecfdf5",     # Green 50
    "card_elevated": "#ffffff",
    # Text
    "text": "#0f172a",           # Slate 900
    "text_light": "#64748b",     # Slate 500
    "text_accent": "#0d9488",    # = primary
    # Borders
    "border": "#e2e8f0",         # Slate 200
    "border_focus": "#0d9488",
    # Header
    "header_bg": "#0d9488",
    "header_accent": "#0f766e",
    # Feedback rows
    "row_ok": "#dcfce7",
    "row_bad": "#fee2e2",
    "row_neutral": "#f1f5f9",
    # Canvas
    "canvas_bg": "#ffffff",
    "input_bg": "#f1f5f9",       # Slate 100
    # Leitner boxes (kept colorful for gamification)
    "box1": "#ef4444",
    "box2": "#f59e0b",
    "box3": "#22c55e",
    "box4": "#0ea5e9",
    "box5": "#0f766e",
    # Streak & gamification
    "streak": "#f59e0b",
    "xp": "#8b5cf6",
}

DARK = {
    # Brand
    "primary": "#2dd4bf",        # Teal 400
    "primary_dark": "#14b8a6",   # Teal 500
    "primary_light": "#5eead4",  # Teal 300
    "primary_subtle": "#042f2e", # Teal 950
    # Semantic
    "success": "#4ade80",        # Green 400
    "success_light": "#052e16",  # Green 950
    "danger": "#f87171",         # Red 400
    "danger_light": "#450a0a",   # Red 950
    "warning": "#fbbf24",        # Amber 400
    "warning_light": "#451a03",  # Amber 950
    "info": "#60a5fa",           # Blue 400
    # Surfaces
    "bg": "#0c1a14",             # Deep dark green
    "card": "#152820",           # Dark card
    "card_hover": "#1a332a",
    "card_elevated": "#1e3a30",
    # Text
    "text": "#f0fdf4",           # Green 50
    "text_light": "#94a3b8",     # Slate 400
    "text_accent": "#2dd4bf",    # = primary
    # Borders
    "border": "#1e3a30",
    "border_focus": "#2dd4bf",
    # Header
    "header_bg": "#0a1f18",
    "header_accent": "#14b8a6",
    # Feedback rows
    "row_ok": "#052e16",
    "row_bad": "#450a0a",
    "row_neutral": "#152820",
    # Canvas
    "canvas_bg": "#152820",
    "input_bg": "#1a332a",
    # Leitner boxes
    "box1": "#f87171",
    "box2": "#fbbf24",
    "box3": "#4ade80",
    "box4": "#38bdf8",
    "box5": "#2dd4bf",
    # Streak & gamification
    "streak": "#fbbf24",
    "xp": "#a78bfa",
}

# Live palette other modules import and read.
COLORS = dict(LIGHT)
_state = {"dark": False}


def is_dark() -> bool:
    return _state["dark"]


def apply_theme(dark: bool):
    _state["dark"] = dark
    palette = DARK if dark else LIGHT
    COLORS.clear()
    COLORS.update(palette)
    ctk.set_appearance_mode("dark" if dark else "light")
