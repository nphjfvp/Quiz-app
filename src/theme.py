"""Theme management: light/dark color palettes.

The module exposes a single mutable ``COLORS`` dict. UI code reads
``COLORS["key"]`` at render time, so calling ``apply_theme()`` and then
rebuilding the current screen is enough to switch appearance.
"""

import customtkinter as ctk

LIGHT = {
    "primary": "#2980b9",
    "primary_dark": "#1a5276",
    "success": "#27ae60",
    "danger": "#c0392b",
    "warning": "#e67e22",
    "bg": "#f0f0f0",
    "card": "#ffffff",
    "text": "#2c3e50",
    "text_light": "#7f8c8d",
    "row_ok": "#eafaf1",
    "row_bad": "#fdedec",
    "row_neutral": "#f8f9fa",
    "canvas_bg": "#ffffff",
    "box1": "#c0392b",
    "box2": "#e67e22",
    "box3": "#f1c40f",
    "box4": "#2ecc71",
    "box5": "#27ae60",
}

DARK = {
    "primary": "#3498db",
    "primary_dark": "#2980b9",
    "success": "#2ecc71",
    "danger": "#e74c3c",
    "warning": "#f39c12",
    "bg": "#1e1e1e",
    "card": "#2b2b2b",
    "text": "#ecf0f1",
    "text_light": "#95a5a6",
    "row_ok": "#1e3a2a",
    "row_bad": "#3a1e1e",
    "row_neutral": "#333333",
    "canvas_bg": "#3a3a3a",
    "box1": "#c0392b",
    "box2": "#e67e22",
    "box3": "#f1c40f",
    "box4": "#2ecc71",
    "box5": "#27ae60",
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
