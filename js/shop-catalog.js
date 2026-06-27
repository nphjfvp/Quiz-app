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
    <!-- Hair (back) -->
    <path d="M25 44 Q22 16 50 13 Q78 16 75 44 Q72 26 50 19 Q28 26 25 44Z" fill="${d}"/>
    <!-- Shoulders / body -->
    <ellipse cx="50" cy="88" rx="38" ry="22" fill="${c}"/>
    <!-- Neck -->
    <rect x="44" y="60" width="12" height="14" rx="4" fill="${d}"/>
    <!-- Head -->
    <ellipse cx="50" cy="42" rx="25" ry="27" fill="${c}"/>
    <!-- Eyebrows (subtle, beneath face items) -->
    <path d="M36 39 Q41 36 45 39" fill="none" stroke="${d}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M55 39 Q59 36 64 39" fill="none" stroke="${d}" stroke-width="1.6" stroke-linecap="round"/>`;
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

export function renderHouseSVG(level, size = 160, decos = []) {
  const ground = `<rect x="0" y="82" width="120" height="18" rx="3" fill="#7cb84a"/>
            <rect x="0" y="84" width="120" height="16" fill="#6daa3c"/>`;
  const path = `<path d="M60 84 Q60 90 60 94" stroke="#5a9030" stroke-width="8" stroke-linecap="round" fill="none" opacity=".4"/>`;
  const bushes = `<ellipse cx="18" cy="84" rx="10" ry="6" fill="#5a9030" opacity=".5"/><ellipse cx="102" cy="84" rx="10" ry="6" fill="#5a9030" opacity=".5"/>`;
  let body = "";
  if (level <= 0) { // Zelt
    body = `${bushes}
            <!-- Tent -->
            <polygon points="60,26 96,82 24,82" fill="#e8943a"/>
            <polygon points="60,26 60,82 38,82" fill="#d4772a"/>
            <polygon points="60,46 72,82 48,82" fill="#b85a1a"/>
            <!-- Campfire -->
            <rect x="56" y="78" width="8" height="10" rx="1" fill="#78350f"/>
            <circle cx="60" cy="70" r="4" fill="#f59e0b" opacity=".8"/>
            <circle cx="60" cy="70" r="2.5" fill="#fbbf24"/>`;
  } else if (level === 1) { // Hütte
    body = `${path}${bushes}
            <!-- House body -->
            <rect x="34" y="52" width="52" height="30" fill="#c8965c"/>
            <!-- Siding lines -->
            <line x1="34" y1="60" x2="86" y2="60" stroke="#b07d4f" stroke-width=".6" opacity=".4"/>
            <line x1="34" y1="68" x2="86" y2="68" stroke="#b07d4f" stroke-width=".6" opacity=".4"/>
            <!-- Roof -->
            <polygon points="28,54 60,28 92,54" fill="#8b4513"/>
            <line x1="60" y1="28" x2="28" y2="54" stroke="#7a3b0f" stroke-width=".8" opacity=".3"/>
            <line x1="60" y1="28" x2="92" y2="54" stroke="#7a3b0f" stroke-width=".8" opacity=".3"/>
            <!-- Chimney -->
            <rect x="74" y="32" width="10" height="18" rx="2" fill="#7a3b0f"/>
            <!-- Smoke -->
            <circle cx="79" cy="24" r="4" fill="#94a3b8" opacity=".15"/>
            <circle cx="83" cy="16" r="3" fill="#94a3b8" opacity=".1"/>
            <!-- Window -->
            <rect x="40" y="60" width="12" height="12" rx="2" fill="#cfe8ff"/>
            <line x1="46" y1="60" x2="46" y2="72" stroke="#8b4513" stroke-width="1.2" opacity=".5"/>
            <line x1="40" y1="66" x2="52" y2="66" stroke="#8b4513" stroke-width="1.2" opacity=".5"/>
            <!-- Door -->
            <rect x="62" y="66" width="14" height="16" rx="3" fill="#6b3a1a"/>
            <rect x="65" y="70" width="8" height="5" rx="1.5" fill="#5b2a0a" opacity=".4"/>
            <circle cx="72" cy="75" r="1.5" fill="#fbbf24"/>`;
  } else if (level === 2) { // Haus
    body = `${path}${bushes}
            <!-- House body -->
            <rect x="28" y="48" width="64" height="36" rx="3" fill="#f0d4a8"/>
            <!-- Siding lines -->
            <line x1="28" y1="56" x2="92" y2="56" stroke="#d4b088" stroke-width=".6" opacity=".4"/>
            <line x1="28" y1="64" x2="92" y2="64" stroke="#d4b088" stroke-width=".6" opacity=".4"/>
            <!-- Roof -->
            <polygon points="22,50 60,22 98,50" fill="#b8422a"/>
            <line x1="60" y1="22" x2="22" y2="50" stroke="#9a3522" stroke-width=".8" opacity=".3"/>
            <line x1="60" y1="22" x2="98" y2="50" stroke="#9a3522" stroke-width=".8" opacity=".3"/>
            <!-- Chimney -->
            <rect x="76" y="28" width="10" height="18" rx="2" fill="#8b5a2b"/>
            <!-- Smoke -->
            <circle cx="81" cy="20" r="4" fill="#94a3b8" opacity=".15"/>
            <circle cx="85" cy="12" r="3" fill="#94a3b8" opacity=".1"/>
            <!-- Left window -->
            <rect x="36" y="56" width="14" height="14" rx="2" fill="#cfe8ff"/>
            <line x1="43" y1="56" x2="43" y2="70" stroke="#8b4513" stroke-width="1.2" opacity=".5"/>
            <line x1="36" y1="63" x2="50" y2="63" stroke="#8b4513" stroke-width="1.2" opacity=".5"/>
            <!-- Right window -->
            <rect x="72" y="56" width="14" height="14" rx="2" fill="#cfe8ff"/>
            <line x1="79" y1="56" x2="79" y2="70" stroke="#8b4513" stroke-width="1.2" opacity=".5"/>
            <line x1="72" y1="63" x2="86" y2="63" stroke="#8b4513" stroke-width="1.2" opacity=".5"/>
            <!-- Door -->
            <rect x="56" y="66" width="16" height="18" rx="3" fill="#6b3a1a"/>
            <rect x="59" y="70" width="10" height="6" rx="1.5" fill="#5b2a0a" opacity=".4"/>
            <rect x="59" y="78" width="10" height="6" rx="1.5" fill="#5b2a0a" opacity=".4"/>
            <circle cx="67" cy="76" r="1.5" fill="#fbbf24"/>`;
  } else if (level === 3) { // Villa
    body = `${path}${bushes}
            <rect x="18" y="42" width="84" height="42" rx="3" fill="#f5e6d0"/>
            <polygon points="14,44 60,18 106,44" fill="#8b5cf6"/>
            <line x1="60" y1="18" x2="14" y2="44" stroke="#7c3aed" stroke-width=".8" opacity=".3"/>
            <line x1="60" y1="18" x2="106" y2="44" stroke="#7c3aed" stroke-width=".8" opacity=".3"/>
            <!-- Chimney -->
            <rect x="82" y="24" width="10" height="18" rx="2" fill="#7c3aed"/>
            <circle cx="87" cy="16" r="4" fill="#94a3b8" opacity=".15"/>
            <circle cx="91" cy="8" r="3" fill="#94a3b8" opacity=".1"/>
            <!-- Windows -->
            <rect x="28" y="50" width="14" height="14" rx="2" fill="#cfe8ff"/>
            <line x1="35" y1="50" x2="35" y2="64" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <line x1="28" y1="57" x2="42" y2="57" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <rect x="78" y="50" width="14" height="14" rx="2" fill="#cfe8ff"/>
            <line x1="85" y1="50" x2="85" y2="64" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <line x1="78" y1="57" x2="92" y2="57" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <rect x="28" y="70" width="14" height="14" rx="2" fill="#cfe8ff"/>
            <line x1="35" y1="70" x2="35" y2="84" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <line x1="28" y1="77" x2="42" y2="77" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <rect x="78" y="70" width="14" height="14" rx="2" fill="#cfe8ff"/>
            <line x1="85" y1="70" x2="85" y2="84" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <line x1="78" y1="77" x2="92" y2="77" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <!-- Door -->
            <rect x="54" y="64" width="18" height="20" rx="4" fill="#6b4423"/>
            <rect x="57" y="68" width="12" height="7" rx="2" fill="#5b3a1a" opacity=".4"/>
            <rect x="57" y="77" width="12" height="7" rx="2" fill="#5b3a1a" opacity=".4"/>
            <circle cx="68" cy="75" r="1.5" fill="#fbbf24"/>`;
  } else { // Schloss
    body = `${path}${bushes}
            <!-- Castle body -->
            <rect x="22" y="44" width="76" height="40" rx="2" fill="#d1d5db"/>
            <!-- Left tower -->
            <rect x="16" y="32" width="18" height="52" fill="#a8b4c0"/>
            <rect x="14" y="30" width="22" height="6" rx="1" fill="#9ca3af"/>
            <polygon points="16,32 34,32 25,18" fill="#7c3aed"/>
            <rect x="22" y="6" width="8" height="6" fill="#ef4444"/>
            <line x1="26" y1="6" x2="26" y2="2" stroke="#6b7280" stroke-width="1.5"/>
            <polygon points="26,2 22,6 30,6" fill="#ef4444"/>
            <!-- Right tower -->
            <rect x="86" y="32" width="18" height="52" fill="#a8b4c0"/>
            <rect x="84" y="30" width="22" height="6" rx="1" fill="#9ca3af"/>
            <polygon points="86,32 104,32 95,18" fill="#7c3aed"/>
            <rect x="92" y="4" width="8" height="8" fill="#ef4444"/>
            <line x1="96" y1="4" x2="96" y2="0" stroke="#6b7280" stroke-width="1.5"/>
            <polygon points="96,0 92,6 100,6" fill="#ef4444"/>
            <!-- Battlements (top edge) -->
            <rect x="22" y="40" width="10" height="6" fill="#a8b4c0"/>
            <rect x="36" y="40" width="10" height="6" fill="#a8b4c0"/>
            <rect x="50" y="40" width="10" height="6" fill="#a8b4c0"/>
            <rect x="64" y="40" width="10" height="6" fill="#a8b4c0"/>
            <rect x="78" y="40" width="10" height="6" fill="#a8b4c0"/>
            <rect x="92" y="40" width="10" height="6" fill="#a8b4c0"/>
            <!-- Windows -->
            <rect x="38" y="50" width="10" height="10" rx="2" fill="#cfe8ff"/>
            <line x1="43" y1="50" x2="43" y2="60" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <line x1="38" y1="55" x2="48" y2="55" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <rect x="72" y="50" width="10" height="10" rx="2" fill="#cfe8ff"/>
            <line x1="77" y1="50" x2="77" y2="60" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <line x1="72" y1="55" x2="82" y2="55" stroke="#7c3aed" stroke-width="1" opacity=".4"/>
            <!-- Door (portcullis style) -->
            <rect x="52" y="60" width="16" height="24" rx="3" fill="#5b3a1a"/>
            <rect x="55" y="63" width="10" height="6" rx="1.5" fill="#4a2a0a" opacity=".4"/>
            <rect x="55" y="71" width="10" height="6" rx="1.5" fill="#4a2a0a" opacity=".4"/>
            <circle cx="63" cy="74" r="1.5" fill="#fbbf24"/>`;
  }
  const decoSvg = decos.map(id => HOUSE_DECOS.find(d => d.id === id)?.svg || "").join("");
  return `<svg viewBox="0 0 120 100" width="${size}" height="${size * 0.83}" xmlns="http://www.w3.org/2000/svg" style="display:block">${ground}${body}${decoSvg}</svg>`;
}

// ─── House Decorations ───────────────────────────────────────────────
// Rendered inside the house SVG as overlay elements.
export const HOUSE_DECOS = [
  { id: "deco_flag", name: "Flagge", price: 50, svg: `<line x1="100" y1="20" x2="100" y2="45" stroke="#6b7280" stroke-width="2"/><polygon points="100,20 115,26 100,32" fill="#ef4444"/>` },
  { id: "deco_flowers", name: "Blumen", price: 40, svg: `<circle cx="28" cy="84" r="3" fill="#f472b6"/><circle cx="35" cy="82" r="3" fill="#fb923c"/><circle cx="92" cy="84" r="3" fill="#a78bfa"/><line x1="28" y1="84" x2="28" y2="90" stroke="#22c55e" stroke-width="1.5"/><line x1="35" y1="82" x2="35" y2="90" stroke="#22c55e" stroke-width="1.5"/><line x1="92" y1="84" x2="92" y2="90" stroke="#22c55e" stroke-width="1.5"/>` },
  { id: "deco_cat", name: "Katze", price: 80, svg: `<ellipse cx="16" cy="82" rx="5" ry="4" fill="#f59e0b"/><circle cx="16" cy="77" r="3.5" fill="#f59e0b"/><polygon points="13,74 14,70 16,73" fill="#f59e0b"/><polygon points="19,74 18,70 16,73" fill="#f59e0b"/><circle cx="14.5" cy="76.5" r="1" fill="#1e293b"/><circle cx="17.5" cy="76.5" r="1" fill="#1e293b"/>` },
  { id: "deco_lamp", name: "Laterne", price: 60, svg: `<line x1="105" y1="60" x2="105" y2="80" stroke="#92400e" stroke-width="2"/><circle cx="105" cy="58" r="4" fill="#fde047" opacity="0.8"/><rect x="103" y="56" width="4" height="3" rx="1" fill="#78350f"/>` },
  { id: "deco_tree", name: "Baum", price: 70, svg: `<rect x="8" y="72" width="4" height="14" fill="#92400e"/><circle cx="10" cy="68" r="9" fill="#22c55e"/><circle cx="6" cy="72" r="6" fill="#16a34a"/><circle cx="14" cy="71" r="6" fill="#16a34a"/>` },
  { id: "deco_well", name: "Brunnen", price: 100, svg: `<ellipse cx="95" cy="82" rx="9" ry="5" fill="#64748b"/><ellipse cx="95" cy="82" rx="7" ry="3.5" fill="#1e3a5f"/><line x1="88" y1="82" x2="88" y2="72" stroke="#92400e" stroke-width="1.5"/><line x1="102" y1="82" x2="102" y2="72" stroke="#92400e" stroke-width="1.5"/><line x1="87" y1="72" x2="103" y2="72" stroke="#92400e" stroke-width="1.5"/>` },
];

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
// ─── Game skins (tower colors, bloon styles) ────────────────────────
// Each: { id, name, price, game, palette: [base, earned] }
export const GAME_SKINS = [
  { id: "td_default", name: "Standard", price: 0, game: "tower-defense", palette: ["#1cb487", "#06b6d4"] },
  { id: "td_fire", name: "Feuer", price: 120, game: "tower-defense", palette: ["#ef4444", "#f97316"] },
  { id: "td_ice", name: "Eis", price: 120, game: "tower-defense", palette: ["#38bdf8", "#818cf8"] },
  { id: "td_neon", name: "Neon", price: 180, game: "tower-defense", palette: ["#a855f7", "#ec4899"] },
  { id: "td_gold", name: "Gold", price: 250, game: "tower-defense", palette: ["#eab308", "#f59e0b"] },
  { id: "qb_default", name: "Standard", price: 0, game: "quiz-battle", palette: ["#3b82f6", "#22c55e"] },
  { id: "qb_dark", name: "Dunkel", price: 120, game: "quiz-battle", palette: ["#6366f1", "#14b8a6"] },
  { id: "qb_fire", name: "Feuer", price: 150, game: "quiz-battle", palette: ["#dc2626", "#f97316"] },
  { id: "qb_royal", name: "Royal", price: 200, game: "quiz-battle", palette: ["#7c3aed", "#c084fc"] },
];

export function getGameSkin(game, equippedSkins) {
  const id = equippedSkins?.[game];
  return GAME_SKINS.find(s => s.id === id) || GAME_SKINS.find(s => s.game === game);
}

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
