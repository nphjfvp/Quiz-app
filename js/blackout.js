// Blackout-Zeichentool: Legt ein Canvas über ein Bild und erlaubt schwarze Striche.
// Gibt den geänderten Data-URL zurück wenn gespeichert wird.

export function openBlackoutEditor(imageSrc, onSave) {
  const overlay = document.createElement("div");
  overlay.className = "blackout-overlay";
  overlay.innerHTML = `
    <div class="blackout-editor">
      <div class="blackout-toolbar">
        <label>Stärke: <input type="range" id="bo-size" min="5" max="60" value="20"></label>
        <button class="btn btn-sm" id="bo-undo">↩ Rückgängig</button>
        <button class="btn btn-sm btn-primary" id="bo-save">✓ Speichern</button>
        <button class="btn btn-sm btn-ghost" id="bo-cancel">✕ Abbrechen</button>
      </div>
      <div class="blackout-canvas-wrap">
        <canvas id="bo-canvas"></canvas>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector("#bo-canvas");
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.crossOrigin = "anonymous";

  const strokes = []; // history for undo
  let currentStroke = null;
  let drawing = false;

  img.onload = () => {
    const maxW = Math.min(window.innerWidth - 40, 800);
    const scale = Math.min(maxW / img.width, 1);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    redraw();
  };
  img.src = imageSrc;

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) drawStroke(stroke);
    if (currentStroke) drawStroke(currentStroke);
  }

  function drawStroke(stroke) {
    if (stroke.points.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  const brushSize = overlay.querySelector("#bo-size");

  canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    currentStroke = { size: parseInt(brushSize.value), points: [getPos(e)] };
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
    currentStroke.points.push(getPos(e));
    redraw();
  });
  canvas.addEventListener("mouseup", () => {
    if (currentStroke) { strokes.push(currentStroke); currentStroke = null; }
    drawing = false;
    redraw();
  });

  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    drawing = true;
    currentStroke = { size: parseInt(brushSize.value), points: [getPos(e)] };
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!drawing) return;
    currentStroke.points.push(getPos(e));
    redraw();
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    if (currentStroke) { strokes.push(currentStroke); currentStroke = null; }
    drawing = false;
    redraw();
  });

  overlay.querySelector("#bo-undo").addEventListener("click", () => {
    strokes.pop();
    redraw();
  });

  overlay.querySelector("#bo-save").addEventListener("click", () => {
    // Re-render at full resolution for quality
    const outCanvas = document.createElement("canvas");
    outCanvas.width = img.width;
    outCanvas.height = img.height;
    const outCtx = outCanvas.getContext("2d");
    outCtx.drawImage(img, 0, 0);
    const scaleX = img.width / canvas.width;
    const scaleY = img.height / canvas.height;
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      outCtx.beginPath();
      outCtx.strokeStyle = "#000";
      outCtx.lineWidth = stroke.size * scaleX;
      outCtx.lineCap = "round";
      outCtx.lineJoin = "round";
      outCtx.moveTo(stroke.points[0].x * scaleX, stroke.points[0].y * scaleY);
      for (let i = 1; i < stroke.points.length; i++) {
        outCtx.lineTo(stroke.points[i].x * scaleX, stroke.points[i].y * scaleY);
      }
      outCtx.stroke();
    }
    const dataUrl = outCanvas.toDataURL("image/png");
    onSave(dataUrl);
    overlay.remove();
  });

  overlay.querySelector("#bo-cancel").addEventListener("click", () => {
    overlay.remove();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
