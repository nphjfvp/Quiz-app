#!/bin/bash
# Build standalone executable with PyInstaller
# Requires: pip install pyinstaller customtkinter Pillow requests PyMuPDF
set -e

python3 -m PyInstaller --onefile --name Lerntrainer --windowed \
  --add-data "src:src" \
  --hidden-import customtkinter --hidden-import PIL \
  --collect-all customtkinter \
  --exclude-module cryptography \
  --clean -y \
  main.py

echo "Build complete: dist/Lerntrainer"
