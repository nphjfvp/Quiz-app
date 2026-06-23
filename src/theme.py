"""Theme management: light/dark color palettes.

Design direction: "Frisch & Freundlich" (light) / "Fokus Dark" (dark).
Matches the PWA design system 1:1 for cross-platform consistency.
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
    "primary": "#1cb487",
    "primary_dark": "#148a68",
    "primary_light": "#7fd9c0",
    "primary_subtle": "#e7f7f1",
    "accent": "#ffd43b",
    # Semantic
    "success": "#22c55e",
    "success_light": "#dcfce7",
    "danger": "#ef4444",
    "danger_light": "#fee2e2",
    "warning": "#f59e0b",
    "warning_light": "#fef3c7",
    "info": "#3b82f6",
    # Surfaces
    "bg": "#f5fbf6",
    "card": "#ffffff",
    "card_hover": "#eef7f2",
    "card_elevated": "#ffffff",
    # Text
    "text": "#14241a",
    "text_light": "#5a6b62",
    "text_accent": "#148a68",
    # Borders
    "border": "#e3ece6",
    "border_focus": "#1cb487",
    # Header
    "header_bg": "#1cb487",
    "header_accent": "#148a68",
    "header_sub": "#c8f0e4",
    # Feedback rows
    "row_ok": "#e7f7f1",
    "row_bad": "#fee2e2",
    "row_neutral": "#f1f6f3",
    # Canvas / Input
    "canvas_bg": "#ffffff",
    "input_bg": "#f1f6f3",
    # Leitner boxes
    "box1": "#ef4444",
    "box2": "#f59e0b",
    "box3": "#22c55e",
    "box4": "#0ea5e9",
    "box5": "#0f766e",
    # Streak & gamification
    "streak": "#f59e0b",
    "xp": "#8b5cf6",
    # Button
    "cta_shadow": "#148a68",
    "on_primary": "#ffffff",
}

DARK = {
    # Brand – Cyan→Violett gradient feel
    "primary": "#22d3ee",
    "primary_dark": "#0e7490",
    "primary_light": "#67e8f9",
    "primary_subtle": "#0e2230",
    "accent": "#818cf8",
    # Semantic
    "success": "#4ade80",
    "success_light": "#0e2a18",
    "danger": "#f87171",
    "danger_light": "#3a1414",
    "warning": "#fbbf24",
    "warning_light": "#3a2a08",
    "info": "#60a5fa",
    # Surfaces
    "bg": "#0b1120",
    "card": "#131c30",
    "card_hover": "#1a2540",
    "card_elevated": "#1e293b",
    # Text
    "text": "#f1f5f9",
    "text_light": "#94a3b8",
    "text_accent": "#22d3ee",
    # Borders
    "border": "#243049",
    "border_focus": "#22d3ee",
    # Header
    "header_bg": "#0b1120",
    "header_accent": "#22d3ee",
    "header_sub": "#64748b",
    # Feedback rows
    "row_ok": "#0e2a18",
    "row_bad": "#3a1414",
    "row_neutral": "#1a2540",
    # Canvas / Input
    "canvas_bg": "#131c30",
    "input_bg": "#0f1a2e",
    # Leitner boxes
    "box1": "#f87171",
    "box2": "#fbbf24",
    "box3": "#4ade80",
    "box4": "#38bdf8",
    "box5": "#22d3ee",
    # Streak & gamification
    "streak": "#fbbf24",
    "xp": "#a78bfa",
    # Button
    "cta_shadow": "none",
    "on_primary": "#06121a",
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
