const _routes = {};
let _currentCleanup = null;

export function route(name, handler) {
  _routes[name] = handler;
}

export async function navigate(name, params = {}) {
  if (_currentCleanup) { _currentCleanup(); _currentCleanup = null; }
  const root = document.getElementById("app");
  root.innerHTML = "";
  const handler = _routes[name];
  if (!handler) { root.textContent = `Screen "${name}" not found`; return; }
  const cleanup = await handler(root, params);
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
