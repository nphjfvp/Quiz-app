// Shared canvas utilities for game screens
import { CHIP_COLORS } from "./utils.js";

/**
 * Linear interpolation
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Add floating text to game state
 * @param {Object} state - Game state with floaters array
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} text - Text to display
 * @param {string} color - Text color
 * @param {number} life - Frames to live (default 40 for TD, 45 for QB)
 */
export function addFloater(state, x, y, text, color, life = 40) {
  state.floaters.push({ x, y, text, color, life });
}

/**
 * Begin a rounded rectangle path
 * @param {CanvasRenderingContext2D} ctx - 2D context
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {number} r - Corner radius
 */
export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Fill a rounded rectangle
 * @param {CanvasRenderingContext2D} ctx - 2D context
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {number} r - Corner radius
 * @param {string} fill - Fill color
 */
export function roundRectFill(ctx, x, y, w, h, r, fill) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Stroke a rounded rectangle
 * @param {CanvasRenderingContext2D} ctx - 2D context
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {number} r - Corner radius
 */
export function roundRectStroke(ctx, x, y, w, h, r) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.stroke();
}

/**
 * Clip to a rounded rectangle region
 * @param {CanvasRenderingContext2D} ctx - 2D context
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {number} r - Corner radius
 */
export function roundRectClip(ctx, x, y, w, h, r) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
}

/**
 * Draw a connected line through points
 * @param {CanvasRenderingContext2D} ctx - 2D context
 * @param {Array<{x,y}>} pts - Array of points
 */
export function strokePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/**
 * Create particle burst effect
 * @param {Object} state - Game state with particles array
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} color - Particle color
 * @param {number} n - Number of particles
 */
export function burst(state, x, y, color, n = 8) {
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.3;
    const speed = 1.5 + Math.random() * 1.5;
    state.particles.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      color, life: 20 + Math.random() * 10
    });
  }
}

/**
 * Update and draw floaters (floating text)
 * @param {CanvasRenderingContext2D} ctx - 2D context
 * @param {Object} state - Game state with floaters array
 */
export function drawFloaters(ctx, state) {
  for (let i = state.floaters.length - 1; i >= 0; i--) {
    const f = state.floaters[i];
    f.y -= 1;
    f.life--;
    if (f.life <= 0) {
      state.floaters.splice(i, 1);
      continue;
    }
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = f.color;
    ctx.globalAlpha = f.life / 40;
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }
}

/**
 * Update and draw particles
 * @param {CanvasRenderingContext2D} ctx - 2D context
 * @param {Object} state - Game state with particles array
 */
export function drawParticles(ctx, state) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.05;
    p.life--;
    if (p.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life / 30;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}