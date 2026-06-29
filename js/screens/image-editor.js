import { navigate } from "../router.js";

// Eigenständiger Bild-Editor: Bild laden, mit Pinsel übermalen (Schwärzen/Weißen
// zum Abdecken von Lösungen, oder farbig markieren), rückgängig, als PNG speichern.
const COLORS = ["#000000", "#ffffff", "#ef4444", "#22c55e", "#3b82f6", "#eab308"];

export async function render(root) {
  let html = `<button class="back-btn" id="back-btn">‹ Zurück</button>
    <div class="section-title">🖌️ Bild-Editor</div>
    <p style="color:var(--text-light);font-size:0.88rem;margin:0 0 12px">
      Bild laden und übermalen – z.B. Lösungen schwärzen oder Bereiche markieren.
    </p>
    <input type="file" id="ie-file" accept="image/*" class="input">
    <div id="ie-stage" style="display:none">
      <div class="ie-toolbar">
        <div class="ie-colors">
          ${COLORS.map((c, i) => `<button type="button" class="ie-color${i === 0 ? " active" : ""}" data-color="${c}" style="background:${c}"></button>`).join("")}
        </div>
        <label class="ie-size">Stärke <input type="range" id="ie-size" min="4" max="80" value="22"></label>
        <button class="btn btn-sm btn-ghost" id="ie-undo">↩ Rückgängig</button>
        <button class="btn btn-sm btn-ghost" id="ie-clear">🗑️ Leeren</button>
        <button class="btn btn-sm btn-primary" id="ie-save">💾 Speichern (PNG)</button>
      </div>
      <div class="ie-canvas-wrap"><canvas id="ie-canvas"></canvas></div>
    </div>`;

  root.innerHTML = html;
  root.querySelector("#back-btn").addEventListener("click", () => navigate("home"));

  const fileInput = root.querySelector("#ie-file");
  const stage = root.querySelector("#ie-stage");
  const canvas = root.querySelector("#ie-canvas");
  const ctx = canvas.getContext("2d");
  const sizeInput = root.querySelector("#ie-size");

  const img = new Image();
  const strokes = [];
  let currentStroke = null;
  let drawing = false;
  let color = COLORS[0];

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.readAsDataURL(file);
  });

  img.onload = () => {
    strokes.length = 0;
    const maxW = Math.min(window.innerWidth - 32, 760);
    const scale = Math.min(maxW / img.width, 1);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    stage.style.display = "";
    redraw();
  };

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(ctx, s, 1);
    if (currentStroke) drawStroke(ctx, currentStroke, 1);
  }

  function drawStroke(c, stroke, k) {
    if (stroke.points.length < 1) return;
    c.beginPath();
    c.strokeStyle = stroke.color;
    c.fillStyle = stroke.color;
    c.lineWidth = stroke.size * k;
    c.lineCap = "round";
    c.lineJoin = "round";
    const p0 = stroke.points[0];
    if (stroke.points.length === 1) {
      c.arc(p0.x * k, p0.y * k, (stroke.size * k) / 2, 0, Math.PI * 2);
      c.fill();
      return;
    }
    c.moveTo(p0.x * k, p0.y * k);
    for (let i = 1; i < stroke.points.length; i++) c.lineTo(stroke.points[i].x * k, stroke.points[i].y * k);
    c.stroke();
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }
  function start(e) { drawing = true; currentStroke = { color, size: parseInt(sizeInput.value, 10), points: [getPos(e)] }; redraw(); }
  function move(e) { if (!drawing) return; currentStroke.points.push(getPos(e)); redraw(); }
  function end() { if (currentStroke) { strokes.push(currentStroke); currentStroke = null; } drawing = false; redraw(); }

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  canvas.addEventListener("mouseup", end);
  canvas.addEventListener("mouseleave", end);
  canvas.addEventListener("touchstart", (e) => { e.preventDefault(); start(e); }, { passive: false });
  canvas.addEventListener("touchmove", (e) => { e.preventDefault(); move(e); }, { passive: false });
  canvas.addEventListener("touchend", (e) => { e.preventDefault(); end(); }, { passive: false });

  root.querySelectorAll(".ie-color").forEach(b =>
    b.addEventListener("click", () => {
      root.querySelectorAll(".ie-color").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      color = b.dataset.color;
    }));
  root.querySelector("#ie-undo").addEventListener("click", () => { strokes.pop(); redraw(); });
  root.querySelector("#ie-clear").addEventListener("click", () => { strokes.length = 0; redraw(); });

  root.querySelector("#ie-save").addEventListener("click", () => {
    // In voller Auflösung rendern
    const out = document.createElement("canvas");
    out.width = img.width;
    out.height = img.height;
    const octx = out.getContext("2d");
    octx.drawImage(img, 0, 0);
    const k = img.width / canvas.width;
    for (const s of strokes) drawStroke(octx, s, k);
    out.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bild-editor.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  });
}
