// Gemeinsame Hilfsfunktionen für alle Screens

// HTML-escapen, um XSS bei String-Interpolation in Templates zu vermeiden
export function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}
