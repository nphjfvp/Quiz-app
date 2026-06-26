// Shop / Meta-Progression catalog + SVG renderers.
// Avatar is a layered portrait (bg → skin → top → face → hat → accessory)
// composed in a 0 0 100 100 viewBox. House is rendered separately by level.
// Theme skins re-color the global --primary accent.

// ─── Avatar item catalog ─────────────────────────────────────────────
// Each item: { id, name, price, svg }  (svg = string in 100x100 space)
// Items with price 0 are owned & equipped by default.

const skinColor = { skin_light: ["#f1c27d", "#d9a866"], skin_pale: ["#ffe0bd", "#e8c39e"], skin_medium: ["#c68642", "#a86d34"], skin_dark: ["#8d5524", "#6e4019"] };

function baseBody(skinId) {
  const [c, d] = skinColor[skinId] || skinColor.skin_light;
  return `
    <ellipse cx="22" cy="48" rx="5" ry="6.5" fill="${c}"/>
    <ellipse cx="78" cy="48" rx="5" ry="6.5" fill="${c}"/>
    <rect x="43" y="62" width="14" height="20" rx="6" fill="${d}"/>
    <circle cx="50" cy="44" r="27" fill="${c}"/>`;
}

export const CATALOG = {
  skin: [
    { id: "skin_light", name: "Hautton Hell", price: 0 },
    { id: "skin_pale", name: "Hautton Blass", price: 0 },
    { id: "skin_medium", name: "Hautton Mittel", price: 0 },
    { id: "skin_dark", name: "Hautton Dunkel", price: 0 },
  ],
  top: [
    { id: "top_tee", name: "T-Shirt", price: 0,
      svg: `<path d="M16 100 Q18 80 40 75 Q50 86 60 75 Q82 80 84 100 Z" fill="#6b7280"/>` },
    { id: "top_lab", name: "Laborkittel", price: 80,
      svg: `<path d="M16 100 Q18 80 40 75 Q50 86 60 75 Q82 80 84 100 Z" fill="#f3f4f6"/>
            <path d="M50 78 L50 100" stroke="#d1d5db" stroke-width="2"/>
            <rect x="56" y="82" width="7" height="9" rx="1" fill="#cbd5e1"/>` },
    { id: "top_hoodie", name: "Hoodie", price: 120,
      svg: `<path d="M16 100 Q18 80 40 75 Q50 86 60 75 Q82 80 84 100 Z" fill="#3b82f6"/>
            <path d="M40 75 Q50 90 60 75" stroke="#1e40af" stroke-width="2.5" fill="none"/>
            <line x1="46" y1="84" x2="46" y2="96" stroke="#1e40af" stroke-width="2"/>
            <line x1="54" y1="84" x2="54" y2="96" stroke="#1e40af" stroke-width="2"/>` },
    { id: "top_suit", name: "Anzug", price: 200,
      svg: `<path d="M16 100 Q18 80 40 75 Q50 86 60 75 Q82 80 84 100 Z" fill="#1f2937"/>
            <path d="M44 76 L50 92 L56 76 Z" fill="#f9fafb"/>
            <path d="M48 78 L50 90 L52 78 Z" fill="#dc2626"/>` },
    { id: "top_armor", name: "Ritterrüstung", price: 350,
      svg: `<path d="M16 100 Q18 80 40 75 Q50 86 60 75 Q82 80 84 100 Z" fill="#94a3b8"/>
            <circle cx="26" cy="82" r="7" fill="#cbd5e1"/><circle cx="74" cy="82" r="7" fill="#cbd5e1"/>
            <path d="M50 80 L50 100" stroke="#64748b" stroke-width="2"/>` },
  ],
  face: [
    { id: "face_default", name: "Normal", price: 0,
      svg: `<circle cx="40" cy="42" r="3.2" fill="#3a3a3a"/><circle cx="60" cy="42" r="3.2" fill="#3a3a3a"/>
            <path d="M43 54 Q50 60 57 54" stroke="#3a3a3a" stroke-width="2.4" fill="none" stroke-linecap="round"/>` },
    { id: "face_happy", name: "Fröhlich", price: 40,
      svg: `<circle cx="40" cy="42" r="3.2" fill="#3a3a3a"/><circle cx="60" cy="42" r="3.2" fill="#3a3a3a"/>
            <circle cx="32" cy="50" r="4" fill="#fca5a5" opacity=".6"/><circle cx="68" cy="50" r="4" fill="#fca5a5" opacity=".6"/>
            <path d="M40 53 Q50 64 60 53" stroke="#3a3a3a" stroke-width="2.6" fill="none" stroke-linecap="round"/>` },
    { id: "face_glasses", name: "Brille", price: 60,
      svg: `<circle cx="40" cy="42" r="3" fill="#3a3a3a"/><circle cx="60" cy="42" r="3" fill="#3a3a3a"/>
            <path d="M43 54 Q50 59 57 54" stroke="#3a3a3a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
            <circle cx="40" cy="42" r="8" fill="none" stroke="#111827" stroke-width="2"/>
            <circle cx="60" cy="42" r="8" fill="none" stroke="#111827" stroke-width="2"/>
            <line x1="48" y1="42" x2="52" y2="42" stroke="#111827" stroke-width="2"/>` },
    { id: "face_sunglasses", name: "Sonnenbrille", price: 100,
      svg: `<path d="M43 54 Q50 59 57 54" stroke="#3a3a3a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
            <rect x="31" y="37" width="16" height="10" rx="3" fill="#111827"/>
            <rect x="53" y="37" width="16" height="10" rx="3" fill="#111827"/>
            <line x1="47" y1="40" x2="53" y2="40" stroke="#111827" stroke-width="2"/>` },
    { id: "face_nerd", name: "Streber", price: 90,
      svg: `<circle cx="40" cy="42" r="2.6" fill="#3a3a3a"/><circle cx="60" cy="42" r="2.6" fill="#3a3a3a"/>
            <path d="M44 54 Q50 57 56 54" stroke="#3a3a3a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
            <rect x="31" y="35" width="17" height="14" rx="7" fill="none" stroke="#111827" stroke-width="2.4"/>
            <rect x="52" y="35" width="17" height="14" rx="7" fill="none" stroke="#111827" stroke-width="2.4"/>
            <line x1="48" y1="40" x2="52" y2="40" stroke="#111827" stroke-width="2.4"/>` },
  ],
  hat: [
    { id: "hat_none", name: "Kein Hut", price: 0, svg: `` },
    { id: "hat_cap", name: "Cap", price: 70,
      svg: `<path d="M25 31 Q50 6 75 31 Z" fill="#ef4444"/>
            <path d="M62 31 Q86 30 90 37 Q70 34 60 33 Z" fill="#dc2626"/>
            <circle cx="50" cy="13" r="2.5" fill="#b91c1c"/>` },
    { id: "hat_grad", name: "Doktorhut", price: 150,
      svg: `<rect x="40" y="20" width="20" height="13" rx="2" fill="#1f2937"/>
            <polygon points="50,9 87,20 50,31 13,20" fill="#111827"/>
            <circle cx="87" cy="20" r="2.5" fill="#fbbf24"/>
            <line x1="87" y1="20" x2="87" y2="34" stroke="#fbbf24" stroke-width="2"/>
            <circle cx="87" cy="35" r="2.2" fill="#fbbf24"/>` },
    { id: "hat_beanie", name: "Mütze", price: 90,
      svg: `<path d="M26 32 Q50 6 74 32 Z" fill="#10b981"/>
            <rect x="24" y="29" width="52" height="7" rx="3.5" fill="#059669"/>
            <circle cx="50" cy="10" r="4" fill="#a7f3d0"/>` },
    { id: "hat_wizard", name: "Zaubererhut", price: 250,
      svg: `<path d="M50 0 L72 34 L28 34 Z" fill="#5b21b6"/>
            <rect x="26" y="31" width="48" height="6" rx="3" fill="#4c1d95"/>
            <circle cx="57" cy="22" r="1.8" fill="#fbbf24"/><circle cx="46" cy="14" r="1.5" fill="#fbbf24"/>` },
    { id: "hat_halo", name: "Heiligenschein", price: 300,
      svg: `<ellipse cx="50" cy="13" rx="20" ry="6" fill="none" stroke="#fde047" stroke-width="3.5"/>` },
    { id: "hat_crown", name: "Krone", price: 400,
      svg: `<path d="M30 32 L33 14 L42 25 L50 10 L58 25 L67 14 L70 32 Z" fill="#fcd34d" stroke="#f59e0b" stroke-width="1.5"/>
            <circle cx="50" cy="15" r="2.2" fill="#ef4444"/><circle cx="35" cy="20" r="1.6" fill="#3b82f6"/><circle cx="65" cy="20" r="1.6" fill="#3b82f6"/>` },
  ],
  accessory: [
    { id: "acc_none", name: "Keins", price: 0, svg: `` },
    { id: "acc_earring", name: "Ohrringe", price: 50,
      svg: `<circle cx="22" cy="55" r="2.5" fill="#fbbf24"/><circle cx="78" cy="55" r="2.5" fill="#fbbf24"/>` },
    { id: "acc_scarf", name: "Schal", price: 80,
      svg: `<path d="M30 74 Q50 84 70 74 L70 82 Q50 92 30 82 Z" fill="#ef4444"/>
            <path d="M44 80 L40 99 L50 97 Z" fill="#dc2626"/>` },
    { id: "acc_headphones", name: "Kopfhörer", price: 130,
      svg: `<path d="M20 44 Q20 16 50 16 Q80 16 80 44" stroke="#374151" stroke-width="4" fill="none"/>
            <rect x="13" y="42" width="11" height="17" rx="4" fill="#374151"/>
            <rect x="76" y="42" width="11" height="17" rx="4" fill="#374151"/>` },
  ],
  bg: [
    { id: "bg_none", name: "Schlicht", price: 0, svg: `<rect width="100" height="100" rx="16" fill="#e5e7eb"/>` },
    { id: "bg_mint", name: "Mint", price: 40, svg: `<rect width="100" height="100" rx="16" fill="#d1fae5"/>` },
    { id: "bg_sky", name: "Himmel", price: 60, svg: `<rect width="100" height="100" rx="16" fill="#bae6fd"/><circle cx="78" cy="22" r="10" fill="#fde68a"/>` },
    { id: "bg_sunset", name: "Sonnenuntergang", price: 90, svg: `<rect width="100" height="100" rx="16" fill="#fed7aa"/><rect y="58" width="100" height="42" fill="#fdba74"/><circle cx="50" cy="58" r="14" fill="#fb923c"/>` },
    { id: "bg_stars", name: "Sternenhimmel", price: 140, svg: `<rect width="100" height="100" rx="16" fill="#1e293b"/><circle cx="20" cy="20" r="1.5" fill="#fde047"/><circle cx="80" cy="30" r="1.5" fill="#fde047"/><circle cx="35" cy="60" r="1.2" fill="#fde047"/><circle cx="70" cy="70" r="1.5" fill="#fde047"/><circle cx="50" cy="18" r="1" fill="#fde047"/>` },
  ],
};

// Order in which avatar layers are stacked.
export const SLOT_ORDER = ["bg", "skin", "top", "face", "hat", "accessory"];
export const SLOT_LABELS = { bg: "Hintergrund", skin: "Hautton", top: "Kleidung", face: "Gesicht", hat: "Kopfbedeckung", accessory: "Accessoire" };

export function findItem(slot, id) {
  return (CATALOG[slot] || []).find((i) => i.id === id) || null;
}

// Render the full avatar as an inline <svg> string.
export function renderAvatarSVG(equipped, size = 110) {
  const eq = equipped || {};
  const bg = findItem("bg", eq.bg);
  const top = findItem("top", eq.top);
  const face = findItem("face", eq.face);
  const hat = findItem("hat", eq.hat);
  const acc = findItem("accessory", eq.accessory);
  const layers = [
    bg?.svg || "",
    baseBody(eq.skin || "skin_light"),
    top?.svg || "",
    face?.svg || "",
    hat?.svg || "",
    acc?.svg || "",
  ].join("");
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="display:block">${layers}</svg>`;
}

// ─── House ───────────────────────────────────────────────────────────
export const HOUSE_LEVELS = [
  { level: 0, name: "Zelt", price: 0 },
  { level: 1, name: "Hütte", price: 200 },
  { level: 2, name: "Haus", price: 500 },
  { level: 3, name: "Villa", price: 1000 },
  { level: 4, name: "Schloss", price: 2000 },
];

export function renderHouseSVG(level, size = 160) {
  const ground = `<rect x="0" y="86" width="120" height="14" fill="#86b85a"/>`;
  let body = "";
  if (level <= 0) { // Zelt
    body = `<polygon points="60,28 96,86 24,86" fill="#d97706"/>
            <polygon points="60,28 60,86 38,86" fill="#b45309"/>
            <polygon points="60,50 72,86 48,86" fill="#78350f"/>`;
  } else if (level === 1) { // Hütte
    body = `<rect x="36" y="56" width="48" height="30" fill="#b07d4f"/>
            <polygon points="30,56 90,56 60,34" fill="#7c4a24"/>
            <rect x="54" y="68" width="14" height="18" fill="#5b3a1a"/>
            <rect x="42" y="62" width="9" height="9" fill="#cfe8ff"/>`;
  } else if (level === 2) { // Haus
    body = `<rect x="32" y="52" width="56" height="34" fill="#e8c39e"/>
            <polygon points="26,52 94,52 60,28" fill="#c0392b"/>
            <rect x="54" y="66" width="14" height="20" fill="#6b4423"/>
            <rect x="38" y="60" width="10" height="10" fill="#cfe8ff"/><rect x="72" y="60" width="10" height="10" fill="#cfe8ff"/>
            <rect x="74" y="32" width="8" height="14" fill="#8b5a2b"/>`;
  } else if (level === 3) { // Villa
    body = `<rect x="22" y="44" width="76" height="42" fill="#f3e2c7"/>
            <polygon points="18,44 102,44 60,22" fill="#9b59b6"/>
            <rect x="52" y="64" width="16" height="22" fill="#6b4423"/>
            <rect x="30" y="52" width="11" height="11" fill="#cfe8ff"/><rect x="79" y="52" width="11" height="11" fill="#cfe8ff"/>
            <rect x="30" y="70" width="11" height="11" fill="#cfe8ff"/><rect x="79" y="70" width="11" height="11" fill="#cfe8ff"/>
            <rect x="48" y="86" width="24" height="0"/>`;
  } else { // Schloss
    body = `<rect x="24" y="46" width="72" height="40" fill="#cbd5e1"/>
            <rect x="18" y="36" width="16" height="50" fill="#94a3b8"/>
            <rect x="86" y="36" width="16" height="50" fill="#94a3b8"/>
            <polygon points="18,36 34,36 26,22" fill="#7c3aed"/>
            <polygon points="86,36 102,36 94,22" fill="#7c3aed"/>
            <rect x="94" y="14" width="14" height="9" fill="#ef4444"/>
            <rect x="52" y="62" width="16" height="24" fill="#5b3a1a"/>
            <rect x="40" y="52" width="10" height="10" fill="#cfe8ff"/><rect x="70" y="52" width="10" height="10" fill="#cfe8ff"/>
            <path d="M24 46 h72 v4 h-6 v-4 h-6 v4 h-6 v-4 h-6 v4 h-6 v-4 h-6 v4 h-6 v-4 h-6 v4 h-6 z" fill="#94a3b8"/>`;
  }
  return `<svg viewBox="0 0 120 100" width="${size}" height="${size * 0.83}" xmlns="http://www.w3.org/2000/svg" style="display:block">${ground}${body}</svg>`;
}

// ─── Theme skins (accent recolor) ────────────────────────────────────
// Each: { id, name, price, palette: [primary, dark, light, subtle] }
export const THEME_SKINS = [
  { id: "theme_default", name: "Standard (Teal)", price: 0, palette: ["#1cb487", "#148a68", "#7fd9c0", "#e7f7f1"] },
  { id: "theme_purple", name: "Violett", price: 100, palette: ["#7c5cff", "#5b3fd6", "#b9a7ff", "#ece7ff"] },
  { id: "theme_ocean", name: "Ozean", price: 100, palette: ["#2196f3", "#1769aa", "#90caf9", "#e3f2fd"] },
  { id: "theme_sunset", name: "Sonnenuntergang", price: 150, palette: ["#ff7043", "#d84315", "#ffab91", "#fbe9e7"] },
  { id: "theme_forest", name: "Wald", price: 150, palette: ["#2e9e5b", "#1b6e3c", "#8fd9a8", "#e3f6e9"] },
  { id: "theme_rose", name: "Rosé", price: 150, palette: ["#ec4899", "#be185d", "#f9a8d4", "#fce7f3"] },
  { id: "theme_gold", name: "Gold", price: 250, palette: ["#d4a017", "#a17a0e", "#ecd07a", "#faf3da"] },
];

export function findTheme(id) {
  return THEME_SKINS.find((t) => t.id === id) || THEME_SKINS[0];
}

// Apply a theme skin's accent to the document root (overrides theme primary).
export function applyThemeSkin(id) {
  const t = findTheme(id);
  const [p, d, l, s] = t.palette;
  const root = document.documentElement;
  if (id === "theme_default") {
    // Clear overrides so the normal light/dark accent applies again.
    ["--primary", "--primary-dark", "--primary-light", "--primary-subtle"].forEach((v) => root.style.removeProperty(v));
    return;
  }
  root.style.setProperty("--primary", p);
  root.style.setProperty("--primary-dark", d);
  root.style.setProperty("--primary-light", l);
  root.style.setProperty("--primary-subtle", s);
}
