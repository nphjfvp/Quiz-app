"""Theme management: light/dark color palettes.

The module exposes a single mutable ``COLORS`` dict. UI code reads
``COLORS["key"]`` at render time, so calling ``apply_theme()`` and then
rebuilding the current screen is enough to switch appearance.
"""

import customtkinter as ctk

LIGHT = {
    "primary": "#4361ee",
    "primary_dark": "#3a0ca3",
    "primary_light": "#7b8ff7",
    "success": "#06d6a0",
    "danger": "#ef476f",
    "warning": "#ffd166",
    "bg": "#f8f9fc",
    "card": "#ffffff",
    "card_hover": "#f0f3ff",
    "text": "#1a1a2e",
    "text_light": "#6c757d",
    "text_accent": "#4361ee",
    "border": "#e0e4f0",
    "header_bg": "#4361ee",
    "header_accent": "#7209b7",
    "row_ok": "#d4edda",
    "row_bad": "#f8d7da",
    "row_neutral": "#f1f3f5",
    "canvas_bg": "#ffffff",
    "input_bg": "#f1f3f8",
    "box1": "#ef476f",
    "box2": "#ffd166",
    "box3": "#06d6a0",
    "box4": "#118ab2",
    "box5": "#073b4c",
}

DARK = {
    "primary": "#5e7ce2",
    "primary_dark": "#4361ee",
    "primary_light": "#8fa4f0",
    "success": "#06d6a0",
    "danger": "#ef476f",
    "warning": "#ffd166",
    "bg": "#0f0f1a",
    "card": "#1a1a2e",
    "card_hover": "#222240",
    "text": "#e4e4f0",
    "text_light": "#8d8daa",
    "text_accent": "#7b8ff7",
    "border": "#2a2a45",
    "header_bg": "#16163a",
    "header_accent": "#7209b7",
    "row_ok": "#0a2e1a",
    "row_bad": "#2e0a15",
    "row_neutral": "#1a1a2e",
    "canvas_bg": "#1a1a2e",
    "input_bg": "#222240",
    "box1": "#ef476f",
    "box2": "#ffd166",
    "box3": "#06d6a0",
    "box4": "#118ab2",
    "box5": "#073b4c",
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
