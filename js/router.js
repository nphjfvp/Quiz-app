const _routes = {};
let _currentCleanup = null;
let _currentScreen = null;

export function route(name, handler) {
  _routes[name] = handler;
}

export async function navigate(name, params = {}) {
  _currentScreen = name;
  if (_currentCleanup) { _currentCleanup(); _currentCleanup = null; }
  const root = document.getElementById("app");
  root.innerHTML = "";
  const handler = _routes[name];
  if (!handler) { root.textContent = `Screen "${name}" not found`; return; }
  let cleanup;
  try {
    cleanup = await handler(root, params);
  } catch (err) {
    console.error(`[Router] Screen "${name}" crashed:`, err);
    root.innerHTML = `<div style="padding:30px 20px"><h3>⚠️ Fehler beim Laden</h3>
      <p style="color:#f87171;font-family:monospace;font-size:0.85rem;word-break:break-all">${err?.message || err}</p>
      <button onclick="location.hash='home';location.reload()" style="margin-top:16px;padding:10px 20px;border-radius:8px;background:var(--primary,#0d9488);color:#fff;border:none;cursor:pointer">🏠 Startseite</button></div>`;
    return;
  }
  if (typeof cleanup === "function") _currentCleanup = cleanup;
  history.pushState({ screen: name, params }, "", `#${name}`);
  // Sanfte Einblende-Animation (respektiert prefers-reduced-motion via CSS)
  root.classList.remove("screen-enter");
  void root.offsetWidth; // Reflow erzwingen, damit die Animation neu startet
  root.classList.add("screen-enter");
}

window.addEventListener("popstate", (e) => {
  if (e.state?.screen) navigate(e.state.screen, e.state.params || {});
});

// Safety net: handle direct hash changes (e.g. location.hash = "home" or #-links).
// pushState in navigate() does not fire hashchange, so this only runs for
// external hash changes and won't double-navigate.
window.addEventListener("hashchange", () => {
  const name = location.hash.slice(1) || "home";
  if (name !== _currentScreen) navigate(name);
});
