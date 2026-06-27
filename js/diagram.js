// Shared diagram canvas utilities for quiz.js and editor.js
import { CHIP_COLORS } from "./utils.js";

/**
 * Draw diagram on canvas with optional extra drawing function
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {CanvasRenderingContext2D} ctx - 2D context
 * @param {HTMLImageElement|null} img - Image to draw (or null)
 * @param {Function} extraDrawFn - Optional function to draw additional elements (ctx, w, h)
 */
export function drawDiagram(canvas, ctx, img, extraDrawFn = null) {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  if (img) {
    ctx.drawImage(img, 0, 0, w, h);
  } else {
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Lade zuerst ein Bild hoch", w / 2, h / 2);
  }
  if (extraDrawFn) extraDrawFn(ctx, w, h);
}

/**
 * Create floating drag ghost element
 * @param {string} text - Ghost text content
 * @param {string} color - Background color (hex)
 * @param {number} x - ClientX position
 * @param {number} y - ClientY position
 * @returns {HTMLElement} Ghost element
 */
export function createDragGhost(text, color, x, y) {
  const ghost = document.createElement("div");
  ghost.textContent = text;
  ghost.style.cssText = `position:fixed;left:${x-30}px;top:${y-18}px;z-index:9999;pointer-events:none;
    background:${color}dd;color:#fff;font-size:0.8rem;font-weight:700;padding:6px 14px;border-radius:20px;
    box-shadow:0 4px 16px rgba(0,0,0,0.3);transform:scale(1.1);transition:transform 0.1s`;
  document.body.appendChild(ghost);
  return ghost;
}

/**
 * Move drag ghost to new position
 * @param {HTMLElement} ghost - Ghost element
 * @param {number} x - ClientX position
 * @param {number} y - ClientY position
 */
export function moveDragGhost(ghost, x, y) {
  if (ghost) {
    ghost.style.left = (x - 30) + "px";
    ghost.style.top = (y - 18) + "px";
  }
}

/**
 * Remove drag ghost element
 * @param {HTMLElement} ghost - Ghost element to remove
 * @returns {null}
 */
export function removeDragGhost(ghost) {
  if (ghost) {
    ghost.remove();
  }
  return null;
}

/**
 * Bind drag listeners to a chip element (touch + mouse)
 * @param {HTMLElement} chip - Chip element
 * @param {string} label - Label identifier
 * @param {string} color - Background color (hex)
 * @param {Function} onDrop - Callback on drop: (label, clientX, clientY) => void
 * @param {Array} cleanups - Array to push cleanup functions into (for document listeners)
 * @param {boolean} preventDefault - Whether to prevent default on touch events
 */
export function bindChipDrag(chip, label, color, onDrop, cleanups = [], preventDefault = true) {
  // Touch drag
  const touchStart = (e) => {
    if (preventDefault) e.preventDefault();
    createDragGhost(label, color, e.touches[0].clientX, e.touches[0].clientY);
  };
  const touchMove = (e) => {
    if (preventDefault) e.preventDefault();
    const ghost = document.querySelector(".drag-ghost") || document.body.lastChild;
    moveDragGhost(ghost, e.touches[0].clientX, e.touches[0].clientY);
  };
  const touchEnd = (e) => {
    if (preventDefault) e.preventDefault();
    const ghost = document.querySelector(".drag-ghost") || document.body.lastChild;
    removeDragGhost(ghost);
    onDrop(label, e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  };
  chip.addEventListener("touchstart", touchStart, { passive: false });
  chip.addEventListener("touchmove", touchMove, { passive: false });
  chip.addEventListener("touchend", touchEnd);

  // Mouse drag
  let mouseDown = false;
  let ghost = null;
  const mouseDownHandler = (e) => {
    mouseDown = true;
    ghost = createDragGhost(label, color, e.clientX, e.clientY);
    e.preventDefault();
  };
  const mouseMoveHandler = (e) => {
    if (mouseDown && ghost) moveDragGhost(ghost, e.clientX, e.clientY);
  };
  const mouseUpHandler = (e) => {
    if (!mouseDown) return;
    mouseDown = false;
    removeDragGhost(ghost);
    ghost = null;
    onDrop(label, e.clientX, e.clientY);
  };
  chip.addEventListener("mousedown", mouseDownHandler);
  document.addEventListener("mousemove", mouseMoveHandler);
  document.addEventListener("mouseup", mouseUpHandler);
  cleanups.push(() => {
    document.removeEventListener("mousemove", mouseMoveHandler);
    document.removeEventListener("mouseup", mouseUpHandler);
  });
}

/**
 * Draw a labeled point on the canvas
 * @param {CanvasRenderingContext2D} ctx - 2D context
 * @param {number} x - X position (0-1 scale)
 * @param {number} y - Y position (0-1 scale)
 * @param {number} w - Canvas width
 * @param {number} h - Canvas height
 * @param {string} color - Color (hex)
 * @param {string} label - Label text
 */
export function drawLabeledPoint(ctx, x, y, w, h, color, label) {
  const px = x * w, py = y * h;
  ctx.beginPath();
  ctx.arc(px, py, 16, 0, Math.PI * 2);
  ctx.fillStyle = color + "dd";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((label || "?").slice(0, 5), px, py);
}

/**
 * Create a diagram chip element
 * @param {string} text - Chip text
 * @param {string} color - Border color (hex)
 * @param {boolean} placed - Whether already placed
 * @returns {HTMLElement} Chip element
 */
export function createDiagramChip(text, color, placed = false) {
  const chip = document.createElement("div");
  chip.className = "dnd-chip" + (placed ? " placed" : "");
  chip.textContent = text + (placed ? " ✓" : "");
  chip.style.cssText = `background:${color}20;border:2px solid ${color};color:var(--text);
    ${placed ? "opacity:0.5;" : "cursor:grab;"}touch-action:none;user-select:none`;
  return chip;
}