import { useState, useEffect, useRef, useCallback, Fragment } from "react";

// ─── STORAGE (localStorage – browserkompatibel) ───────────────────────────────
async function persist(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch(e) { console.warn("persist failed", e); }
  // Eyla-User-Daten auch in die Cloud syncen (debounced)
  if (key.startsWith("eyla_") &&
      key !== "eyla_access_code_v1" &&
      key !== "eyla_access_granted_v1" &&
      key !== "eyla_cloud_sync_disabled_v1") {
    scheduleSyncUp();
  }
}
async function retrieve(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

// ─── CLOUD-SYNC ───────────────────────────────────────────────────────────────
// Sync ist soft: ohne Vercel KV (oder bei Fehlern) bleibt alles trotzdem in
// localStorage. Pull beim Unlock, Push debounced bei jeder Änderung.
const SYNC_KEYS = [
  "eyla_profile_v3",
  "eyla_logs_v1",
  "eyla_local_events_v2",
  "eyla_shopping_v1",
  "eyla_plan_v1",
  "eyla_todos_v1",
  "eyla_points_v1",     // Studio-Punkte
  "eyla_cycle_v1",      // FLO
  "eyla_reflections_v1",// Wochen-Reflexionen
  "eyla_favorites_v1",  // Mahlzeit-Favoriten
  "eyla_measurements_v1",// Körpermaße
  "eyla_ref_code_v1",   // persönlicher Werbe-Code
];
const SYNC_STATE = { status: "idle", lastSyncedAt: null }; // status: idle|syncing|ok|error|off
const syncListeners = new Set();
function notifySyncListeners() { syncListeners.forEach(l => l(SYNC_STATE)); }

let syncTimer = null;
let syncPending = false;
function scheduleSyncUp() {
  // Nicht syncen wenn Cloud-Sync deaktiviert
  try {
    if (localStorage.getItem("eyla_cloud_sync_disabled_v1") === "true") return;
  } catch {}
  syncPending = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncPending = false; syncUp(); }, 800);
}

// Wenn App in den Hintergrund wandert (iOS PWA close, Tab-Switch):
// pending Sync sofort fluschen, weil iOS sonst alles verliert.
if (typeof window !== "undefined") {
  const flush = () => {
    if (syncPending) {
      clearTimeout(syncTimer);
      syncPending = false;
      syncUp();
    }
  };
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
}

async function syncUp() {
  let code = null;
  try { code = JSON.parse(localStorage.getItem("eyla_access_code_v1") || "null"); } catch {}
  if (!code) return;

  const payload = {};
  for (const k of SYNC_KEYS) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) payload[k] = JSON.parse(raw);
    } catch {}
  }
  SYNC_STATE.status = "syncing"; notifySyncListeners();
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-eyla-code": code },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      SYNC_STATE.status = "ok";
      SYNC_STATE.lastSyncedAt = new Date();
    } else if (res.status === 503) {
      SYNC_STATE.status = "off";
    } else {
      SYNC_STATE.status = "error";
    }
  } catch {
    SYNC_STATE.status = "error";
  }
  notifySyncListeners();
}

async function syncDown() {
  let code = null;
  try { code = JSON.parse(localStorage.getItem("eyla_access_code_v1") || "null"); } catch {}
  if (!code) return null;

  SYNC_STATE.status = "syncing"; notifySyncListeners();
  try {
    const res = await fetch("/api/sync", { headers: { "x-eyla-code": code } });
    if (res.status === 503) {
      SYNC_STATE.status = "off"; notifySyncListeners();
      return null;
    }
    if (!res.ok) {
      SYNC_STATE.status = "error"; notifySyncListeners();
      return null;
    }
    const j = await res.json();
    SYNC_STATE.status = "ok";
    SYNC_STATE.lastSyncedAt = new Date();
    notifySyncListeners();
    return j?.data || null;
  } catch {
    SYNC_STATE.status = "error"; notifySyncListeners();
    return null;
  }
}

// Pulls cloud data and writes into localStorage if cloud has data.
// Spezial-Schutz für Chat: wenn local mehr Nachrichten hat als Cloud,
// behalten wir local. Schützt vor Verlust wenn Cloud-Sync hinterher hängt.
async function pullCloudIntoLocal() {
  const cloud = await syncDown();
  if (!cloud) return false;
  for (const k of SYNC_KEYS) {
    if (cloud[k] !== undefined && cloud[k] !== null) {
      try { localStorage.setItem(k, JSON.stringify(cloud[k])); } catch {}
    }
  }
  return true;
}

// Hook: aktuellen Sync-Status abonnieren
function useSyncStatus() {
  const [state, setState] = useState({ ...SYNC_STATE });
  useEffect(() => {
    const l = (s) => setState({ ...s });
    syncListeners.add(l);
    return () => { syncListeners.delete(l); };
  }, []);
  return state;
}

// ─── EYLA THEME ───────────────────────────────────────────────────────────────
const T = {
  bg:     "#050A14",
  bg2:    "#090F1C",
  card:   "#0D1525",
  border: "#00E5FF14",
  borderS:"#00E5FF28",
  acc:    "#00E5FF",
  bright: "#38D9F5",
  dim:    "#0891B2",
  gold:   "#EAAB00",
  goldL:  "#FFB800",
  rose:   "#818CF8",
  text:   "#F0F9FF",
  mid:    "#7DD3FC",
  muted:  "#B0BEC5",   // nochmal heller für Lesbarkeit (war #94A3B8, davor #64748B)
  faint:  "#1E293B",
  green:  "#34D399",
  red:    "#F87171",
  serif:  "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  mono:   "'Courier New', Courier, monospace",
  sans:   "'Trebuchet MS', 'Gill Sans', sans-serif",
};

const GOALS = ["Langfristig fit bleiben","Mehr Energie","Gesünder essen","Gewicht halten","Besser schlafen","Leistung steigern"];

// ─── STUDIO / GAMIFICATION ENGINE (suma-Merge) ───────────────────────────────
// Punkte-System für EMS-Studio: Training → Punkte → Shop/Freunde-Loop.
// Speicher: eyla_points_v1 = { total, history:[{action,points,ts,note}], monthStreak,
//   friends:[{name,mult}], redeemed:[{item,points,ts}] }
const POINT_VALUES = {
  ems_training:  50,   // EMS-Session absolviert
  punctual:      10,   // pünktlich erschienen
  offpeak:       10,   // Off-Peak-Termin gebucht
  friend:        500,  // Freund geworben (aktiviert)
  social_share:  15,   // Story / Post geteilt
  water_goal:    20,   // Wasserziel erreicht
  meals_logged:  30,   // alle Mahlzeiten geloggt
  steps:         25,   // 10.000 Schritte
  perfect_day:   40,   // alle Tagesziele
};
const POINT_LABELS = {
  ems_training:  "EMS Training",
  punctual:      "Pünktlich erschienen",
  offpeak:       "Off-Peak Termin",
  friend:        "Freund geworben",
  social_share:  "Social Share",
  water_goal:    "Wasserziel erreicht",
  meals_logged:  "Mahlzeiten geloggt",
  steps:         "10.000 Schritte",
  perfect_day:   "Perfekter Tag",
};
const LEVELS = [
  { level:1, name:"Starter",   min:0,    max:500,  mult:1.0 },
  { level:2, name:"Mover",     min:501,  max:1500, mult:1.2 },
  { level:3, name:"Performer", min:1501, max:3500, mult:1.5 },
  { level:4, name:"Champion",  min:3501, max:Infinity, mult:2.0 },
];
// Shop-Katalog (1000 Pts ≈ 10 €)
const SHOP_ITEMS = [
  { id:"riegel",  cat:"A", icon:"🍫", name:"Proteinriegel",     sub:"Auswahl an der Theke",      pts:300,   eur:3 },
  { id:"shake",   cat:"A", icon:"🥤", name:"Protein Shake",     sub:"1× nach dem Training",      pts:400,   eur:4 },
  { id:"session", cat:"B", icon:"⚡", name:"Extra EMS Session", sub:"+ 15 € Zuzahlung",          pts:1000,  eur:0, addEur:15 },
  { id:"hoodie",  cat:"B", icon:"👕", name:"Pandactive Hoodie", sub:"max. 4.000 Pts anrechenbar", pts:4000, eur:0 },
  { id:"contract",cat:"C", icon:"🚀", name:"2× Vertrag · 3 Monate", sub:"50 % Rabatt · danach kündbar", pts:10000, eur:0 },
];
const SHOP_CAT_LABELS = { A:"Gratis", B:"Upgrade", C:"Upsell" };

function loadPoints() {
  try {
    const p = JSON.parse(localStorage.getItem("eyla_points_v1") || "null");
    if (p && typeof p.total === "number") return p;
  } catch {}
  return { total: 0, history: [], monthStreak: 0, friends: [], redeemed: [] };
}
function savePoints(p) {
  try { localStorage.setItem("eyla_points_v1", JSON.stringify(p)); } catch {}
  window.dispatchEvent(new Event("eyla_points_changed"));
  try { scheduleSyncUp(); } catch {}
}
function getLevel(total) {
  return LEVELS.find(l => total >= l.min && total <= l.max) || LEVELS[0];
}
function getMultiplier(points) {
  const lvl = getLevel(points.total);
  const friendBonus = Math.min(0.5, (points.friends?.length || 0) * 0.1);
  return +(lvl.mult + friendBonus).toFixed(1);
}
// Punkte vergeben – mit Multiplikator + Dedup pro Tag für action-Typen die nur 1×/Tag zählen
const ONCE_PER_DAY = new Set(["water_goal","meals_logged","steps","perfect_day","punctual"]);
function awardPoints(action, opts = {}) {
  const base = POINT_VALUES[action];
  if (base === undefined) return null;
  const p = loadPoints();
  const today = new Date().toDateString();
  // Dedup: manche Aktionen max 1× pro Tag
  if (ONCE_PER_DAY.has(action)) {
    const already = (p.history || []).some(h => h.action === action && new Date(h.ts).toDateString() === today);
    if (already) return null;
  }
  const mult = getMultiplier(p);
  const pts = Math.round(base * (opts.applyMult === false ? 1 : mult));
  p.total += pts;
  p.history = [{ action, points: pts, ts: Date.now(), note: opts.note || "" }, ...(p.history || [])].slice(0, 200);
  savePoints(p);
  // Visuelles Feedback global
  window.dispatchEvent(new CustomEvent("eyla_points_awarded", { detail: { action, points: pts, label: POINT_LABELS[action] || action } }));
  haptic(20);
  return pts;
}

// ─── SHARE: hübsche Story-Karte als Bild (Canvas) + Web-Share ────────────────
const APP_URL = "https://eyla-app.vercel.app";
// Zeichnet eine 1080×1350-Karte im EYLA-Look, gibt ein PNG-Blob zurück.
function buildShareCard({ eyebrow = "", big = "", sub = "", footer = "", accent } = {}) {
  return new Promise((resolve) => {
    const W = 1080, H = 1350;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    const acc = accent || T.acc;
    // Hintergrund
    x.fillStyle = T.bg; x.fillRect(0, 0, W, H);
    let g = x.createRadialGradient(W/2, 330, 40, W/2, 330, 760);
    g.addColorStop(0, acc + "33"); g.addColorStop(1, "transparent");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createRadialGradient(W/2, H-120, 20, W/2, H-120, 620);
    g.addColorStop(0, T.gold + "1A"); g.addColorStop(1, "transparent");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // Rahmen
    x.strokeStyle = acc + "44"; x.lineWidth = 3;
    x.strokeRect(40, 40, W-80, H-80);
    x.textAlign = "center";
    // Wordmark
    x.fillStyle = T.muted; x.font = "600 30px 'Courier New', monospace";
    x.fillText("E Y L A   ·   S T U D I O", W/2, 150);
    // Orb
    g = x.createRadialGradient(W/2, 360, 10, W/2, 360, 120);
    g.addColorStop(0, acc + "EE"); g.addColorStop(0.55, acc + "55"); g.addColorStop(1, "transparent");
    x.fillStyle = g; x.beginPath(); x.arc(W/2, 360, 120, 0, Math.PI*2); x.fill();
    x.strokeStyle = acc + "AA"; x.lineWidth = 4;
    x.beginPath(); x.arc(W/2, 360, 92, 0, Math.PI*2); x.stroke();
    // Eyebrow
    if (eyebrow) {
      x.fillStyle = T.gold; x.font = "700 34px 'Courier New', monospace";
      x.fillText(eyebrow.toUpperCase(), W/2, 660);
    }
    // Big (auto-fit Schriftgröße)
    x.fillStyle = "#FFFFFF";
    let size = 150; x.font = `800 ${size}px 'Palatino Linotype','Georgia',serif`;
    while (x.measureText(big).width > W-160 && size > 60) { size -= 6; x.font = `800 ${size}px 'Palatino Linotype','Georgia',serif`; }
    x.fillText(big, W/2, 800);
    // Sub
    if (sub) {
      x.fillStyle = acc; x.font = "400 46px 'Palatino Linotype','Georgia',serif";
      // Zeilenumbruch falls nötig
      const words = sub.split(" "); let line = "", y = 900;
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (x.measureText(test).width > W-200 && line) { x.fillText(line, W/2, y); line = w; y += 60; }
        else line = test;
      }
      x.fillText(line, W/2, y);
    }
    // Footer
    x.fillStyle = T.muted; x.font = "400 30px 'Palatino Linotype','Georgia',serif";
    x.fillText(footer || APP_URL.replace("https://", ""), W/2, H-110);
    c.toBlob(b => resolve(b), "image/png", 0.92);
  });
}
// Teilt Bild + Text; Fallback: Download + Text in Zwischenablage.
async function shareCard(cardOpts, text, title = "EYLA Studio") {
  try {
    const blob = await buildShareCard(cardOpts);
    const file = blob ? new File([blob], "eyla-studio.png", { type: "image/png" }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text, title });
      return true;
    }
    if (navigator.share) { await navigator.share({ text, title }); return true; }
    // Fallback: Bild herunterladen + Text kopieren
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "eyla-studio.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    try { await navigator.clipboard?.writeText(text); } catch {}
    alert("Bild gespeichert & Text kopiert — teil es in deiner Story!");
    return true;
  } catch (e) { return false; }
}

// ─── WERBEN: persönlicher Code ───────────────────────────────────────────────
function getRefCode(profile) {
  try { const s = JSON.parse(localStorage.getItem("eyla_ref_code_v1") || "null"); if (s) return s; } catch {}
  const initials = (profile?.name || "EYLA").replace(/[^A-Za-zÄÖÜäöü]/g, "").slice(0, 3).toUpperCase() || "FIT";
  const rand = (Date.now().toString(36) + Math.random().toString(36).slice(2)).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const code = `${initials}-${rand}`;
  try { localStorage.setItem("eyla_ref_code_v1", JSON.stringify(code)); } catch {}
  try { scheduleSyncUp(); } catch {}
  return code;
}
// Geworbenen Freund eintragen → Freunde-Liste (Multiplikator) + 500 Pts
function awardFriend(name) {
  const p = loadPoints();
  p.friends = [...(p.friends || []), { name: name || "Freund", mult: 0.1, ts: Date.now() }];
  savePoints(p);                       // Freund zählt jetzt in getMultiplier
  return awardPoints("friend", { note: name || "" });
}

// ─── KÖRPERMASSE ─────────────────────────────────────────────────────────────
const METRIC_DEFS = [
  { key:"weight",  label:"Gewicht",      unit:"kg", aliases:["gewicht","weight","kg","masse","körpergewicht","koerpergewicht"] },
  { key:"bodyfat", label:"Körperfett",   unit:"%",  aliases:["körperfett","koerperfett","kfa","bodyfat","body fat","fett","fat","%"] },
  { key:"muscle",  label:"Muskelmasse",  unit:"kg", aliases:["muskel","muscle","muskelmasse","lbm","muskelanteil"] },
  { key:"waist",   label:"Taille",       unit:"cm", aliases:["taille","waist","bauch","bauchumfang"] },
  { key:"hips",    label:"Hüfte",        unit:"cm", aliases:["hüfte","huefte","hips","po","gesäß","gesaess","hip"] },
  { key:"chest",   label:"Brust",        unit:"cm", aliases:["brust","chest","brustumfang","oberkörper","oberkoerper"] },
  { key:"arm",     label:"Oberarm",      unit:"cm", aliases:["arm","oberarm","bizeps","biceps","armumfang"] },
  { key:"thigh",   label:"Oberschenkel", unit:"cm", aliases:["oberschenkel","thigh","bein","schenkel","beinumfang"] },
  { key:"calf",    label:"Wade",         unit:"cm", aliases:["wade","calf","waden","wadenumfang"] },
];
function loadMeasurements() {
  try { const m = JSON.parse(localStorage.getItem("eyla_measurements_v1") || "null"); if (Array.isArray(m)) return m; } catch {}
  return [];
}
function saveMeasurements(arr) {
  const clean = (arr || []).filter(e => e && e.date).sort((a,b) => a.date.localeCompare(b.date));
  try { localStorage.setItem("eyla_measurements_v1", JSON.stringify(clean)); } catch {}
  window.dispatchEvent(new Event("eyla_measurements_changed"));
  try { scheduleSyncUp(); } catch {}
  return clean;
}
function normMetricDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);            // YYYY-MM-DD
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);            // DD.MM.YYYY
  if (m) { let y = m[3]; if (y.length === 2) y = "20" + y; return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; }
  const d = new Date(s); if (!isNaN(d)) return d.toISOString().slice(0,10);
  return null;
}
function parseMetricNum(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[^\d,.\-]/g, "").replace(",", ".");
  if (!s || s === "-" || s === ".") return null;
  const n = parseFloat(s); return isNaN(n) ? null : n;
}
function metricKeyFromHeader(h) {
  const clean = String(h).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[._]/g, " ").trim();
  for (const def of METRIC_DEFS) {
    if (def.aliases.some(a => clean === a || clean.includes(a))) return def.key;
  }
  return null;
}
// Wandelt CSV/TSV-Text (Excel-Export oder eingefügt) in Mess-Einträge.
function parseMeasurementsCSV(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { entries: [], cols: [] };
  const delim = [";", "\t", ","].sort((a,b) => (lines[0].split(b).length) - (lines[0].split(a).length))[0];
  const split = (l) => l.split(delim).map(c => c.trim().replace(/^"|"$/g, ""));
  const header = split(lines[0]);
  let dateIdx = header.findIndex(h => /datum|date|tag|day/i.test(h));
  if (dateIdx < 0) dateIdx = 0;
  const colMap = header.map((h, i) => i === dateIdx ? "__date" : metricKeyFromHeader(h));
  const usedKeys = new Set();
  const entries = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = split(lines[r]);
    const date = normMetricDate(cells[dateIdx]);
    if (!date) continue;
    const values = {};
    colMap.forEach((key, i) => {
      if (!key || key === "__date") return;
      const n = parseMetricNum(cells[i]);
      if (n != null) { values[key] = n; usedKeys.add(key); }
    });
    if (Object.keys(values).length) entries.push({ id: "imp_" + date, date, values });
  }
  return { entries, cols: [...usedKeys] };
}
// Mischt neue Einträge in vorhandene (Datum als Schlüssel, Werte werden gemerged).
function mergeMeasurements(existing, incoming) {
  const byDate = {};
  for (const e of existing || []) byDate[e.date] = { ...e, values: { ...e.values } };
  for (const e of incoming || []) {
    if (byDate[e.date]) byDate[e.date].values = { ...byDate[e.date].values, ...e.values };
    else byDate[e.date] = { ...e, values: { ...e.values } };
  }
  return Object.values(byDate);
}

const DEFAULT_PROFILE = {
  name: "Phil",
  sex: "m",               // "m" | "f" | "d"
  age: "35",
  weight: "79",
  height: "183",
  goal: "Beweglich, fit und energiegeladen bleiben",
  activity: "5x pro Woche, 1,5–2h Beweglichkeitstraining",
  preferences: ["Wenig Fleisch", "Proteinreich", "Mediterran"],
  intolerances: [],
  apps: [],
  // Diät-Logik
  goalType: "halten",     // "halten" | "abnehmen" | "aufbauen"
  targetWeight: "",       // kg (nur bei abnehmen/aufbauen relevant)
  targetWeeks: "",        // Wochen bis Zielgewicht
  // Haushalt für Plan + Liste
  householdSize: 1,       // wie viele Personen mitessen
  householdNote: "",      // freier Text – z.B. "Partner vegetarisch", "2 Kinder"
  // Erweiterte Profil-Daten
  about: "",              // freitext "über mich"
  occupation: "",         // beruf/tätigkeit
  jobActivity: "",        // "sitzend" | "gemischt" | "aktiv" – beeinflusst kalorienbedarf
  allergies: [],          // ECHTE allergien (lebensbedrohlich), separat von intoleranzen
  healthNotes: "",        // gesundheits-themen: medikamente, beschwerden, beobachtungen
  // Tagesrhythmus
  wakeTime: "",           // "07:00"
  sleepTime: "",          // "23:00"
  mealPattern: "3normal", // "3normal" | "5small" | "if168" | "ifother" | "custom"
  mealPatternCustom: "",  // Freitext bei "custom": eigener Essrhythmus für EYLA
  // Kochen
  cookTime: "medium",     // "quick" (≤15min) | "medium" (15-30min) | "long" (30min+)
  kitchenEquipment: ["Pfanne","Ofen"], // verfügbar: Pfanne, Ofen, Mikrowelle, Mixer, Airfryer, Reiskocher
  // Tagesziele
  waterTargetL: 2,        // tagesziel wasser in L
  sleepTargetH: 7,        // tagesziel schlaf in h
  // Sport-Vorlieben
  sportsPreferred: [],    // ["Yoga", "Laufen", "Krafttraining"]
  // FLO – Zyklus-Tracking (für Frauen, optional)
  trackCycle: false,           // master-toggle
  cycleLengthAvg: 28,           // durchschnittliche Zykluslänge (default 28)
  periodLengthAvg: 5,           // durchschnittliche Periodendauer
  // Reminder/Notifications
  reminders: {
    enabled: false,                                            // Master-Toggle
    morning:  { enabled: true,  time: "08:30" },              // Schlaf + Energie eintragen
    lunch:    { enabled: true,  time: "12:30" },              // Was zu Mittag?
    water:    { enabled: true,  time: "14:00" },              // Wasser-Check
    evening:  { enabled: true,  time: "21:00" },              // Tag-Reflexion
  },
};

// Makronährstoff-Ziele aus Kalorien + Diät-Typ. Protein angemessen für Aktivität,
// Fett ~28% der Kalorien, Kohlenhydrate fülllen den Rest.
function macroTarget(profile) {
  const ct = calorieTarget(profile);
  const w = parseFloat(profile.weight) || 79;
  const proteinPerKg = ct.type === "aufbauen" ? 2.0 : ct.type === "abnehmen" ? 1.8 : 1.4;
  const protein = Math.round(w * proteinPerKg);
  const fatKcal = Math.round(ct.target * 0.28);
  const fat = Math.round(fatKcal / 9);
  const carbsKcal = Math.max(0, ct.target - protein*4 - fatKcal);
  const carbs = Math.round(carbsKcal / 4);
  return { protein, fat, carbs, kcal: ct.target };
}

// Kalorienziel + TDEE berechnen aus Profil. Mifflin-St-Jeor +
// pauschaler Aktivitätsoffset (+400). Geschlecht beeinflusst BMR-Konstante.
// Sicherheitslimit: Defizit max. 1000, Min. 1200.
function calorieTarget(profile) {
  const w = parseFloat(profile.weight) || 79;
  const h = parseFloat(profile.height) || 180;
  const a = parseFloat(profile.age) || 30;
  const sex = profile.sex || "m";
  // Mifflin-St Jeor Konstante: Männer +5, Frauen -161, Divers Mittelwert -78
  const sexK = sex === "f" ? -161 : sex === "d" ? -78 : 5;
  const tdee = Math.round(10*w + 6.25*h - 5*a + sexK + 400);

  const type = profile.goalType || "halten";
  if (type === "halten") return { tdee, target: tdee, dailyDelta: 0, type };

  const tw = parseFloat(profile.targetWeight) || w;
  const wk = parseFloat(profile.targetWeeks) || 12;
  if (!wk || wk <= 0) return { tdee, target: tdee, dailyDelta: 0, type };

  if (type === "abnehmen") {
    const deltaKg = Math.max(0, w - tw);
    const dailyDef = Math.min(1000, Math.round((deltaKg * 7700) / (wk * 7)));
    return { tdee, target: Math.max(1200, tdee - dailyDef), dailyDelta: -dailyDef, type, deltaKg, weeks: wk };
  }
  if (type === "aufbauen") {
    const deltaKg = Math.max(0, tw - w);
    const dailySur = Math.min(500, Math.round((deltaKg * 7700) / (wk * 7)));
    return { tdee, target: tdee + dailySur, dailyDelta: dailySur, type, deltaKg, weeks: wk };
  }
  return { tdee, target: tdee, dailyDelta: 0, type };
}

const TODAY = new Date().toDateString();
const EMPTY_LOG = () => ({ meals:[], water:0, energy:"", sleep:"", workouts:[], weight:null, habits:{}, date:TODAY });

// ─── LADEN-LAYOUTS ────────────────────────────────────────────────────────────
// Typische Gang-Reihenfolge vom Eingang zur Kasse pro Discounter/Supermarkt.
// User pickt den Laden und die Einkaufsliste wird entsprechend sortiert,
// damit man nicht hin und her läuft.
const STORES = {
  lidl: {
    name: "Lidl",
    aisleOrder: ["Obst & Gemüse", "Brot & Backwaren", "Trockenwaren & Regal-Mitte", "Molkerei & Kühlwaren", "Fisch & Fleisch", "Haushalt"]
  },
  aldi: {
    name: "Aldi",
    aisleOrder: ["Obst & Gemüse", "Trockenwaren & Regal-Mitte", "Molkerei & Kühlwaren", "Fisch & Fleisch", "Brot & Backwaren", "Haushalt"]
  },
  rewe: {
    name: "Rewe",
    aisleOrder: ["Obst & Gemüse", "Brot & Backwaren", "Molkerei & Kühlwaren", "Fisch & Fleisch", "Trockenwaren & Regal-Mitte", "Haushalt"]
  },
  edeka: {
    name: "Edeka",
    aisleOrder: ["Obst & Gemüse", "Brot & Backwaren", "Molkerei & Kühlwaren", "Fisch & Fleisch", "Trockenwaren & Regal-Mitte", "Haushalt"]
  },
  kaufland: {
    name: "Kaufland",
    aisleOrder: ["Obst & Gemüse", "Brot & Backwaren", "Fisch & Fleisch", "Molkerei & Kühlwaren", "Trockenwaren & Regal-Mitte", "Haushalt"]
  },
  penny: {
    name: "Penny",
    aisleOrder: ["Obst & Gemüse", "Trockenwaren & Regal-Mitte", "Molkerei & Kühlwaren", "Fisch & Fleisch", "Brot & Backwaren", "Haushalt"]
  },
  netto: {
    name: "Netto",
    aisleOrder: ["Obst & Gemüse", "Trockenwaren & Regal-Mitte", "Molkerei & Kühlwaren", "Brot & Backwaren", "Fisch & Fleisch", "Haushalt"]
  },
  custom: {
    name: "Eigener",
    aisleOrder: null   // null = aktuelle Reihenfolge beibehalten
  }
};

// Gänge neu sortieren nach Layout des gewählten Ladens
function reorderAisles(aisles, order) {
  if (!order) return aisles;
  return [...aisles].sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// ─── EINKAUFSLISTE DEFAULTS ───────────────────────────────────────────────────
// Items mit Quelle: "plan" (aus Ernährungsplan), "manuell" (eigene), "beide".
const DEFAULT_SHOPPING = {
  storeId: null,         // null = noch nicht gewählt
  store: "",
  aisles: [
    {
      name: "Obst & Gemüse", icon: "🥦", color: "green",
      hint: "Direkt am Eingang",
      items: [
        { name: "Zucchini (groß)", menge: "5 Stk", quelle: "plan" },
        { name: "Paprika (bunt, groß)", menge: "8 Stk", quelle: "plan" },
        { name: "Blumenkohl", menge: "2 Köpfe", quelle: "plan" },
        { name: "Champignons", menge: "500g", quelle: "plan" },
        { name: "Kirschtomaten", menge: "500g", quelle: "plan" },
        { name: "Gurke", menge: "2 Stk", quelle: "beide" },
        { name: "Tomaten", menge: "6 Stk", quelle: "plan" },
        { name: "Rote Zwiebeln", menge: "3 Stk", quelle: "plan" },
        { name: "Zwiebeln (gelb)", menge: "4 Stk", quelle: "plan" },
        { name: "Knoblauch", menge: "2 Knollen", quelle: "plan" },
        { name: "Ingwer (frisch)", menge: "1 Stück", quelle: "plan" },
        { name: "Frühlingszwiebeln", menge: "1 Bund", quelle: "plan" },
        { name: "Zitrone", menge: "2 Stk", quelle: "plan" },
        { name: "Petersilie (frisch)", menge: "1 Bund", quelle: "plan" },
        { name: "Basilikum (Topf)", menge: "1 Topf", quelle: "plan" },
        { name: "Sellerie", menge: "1 Knolle", quelle: "manuell" },
      ]
    },
    {
      name: "Brot & Backwaren", icon: "🍞", color: "gold",
      hint: "Meist neben Gemüse",
      items: [
        { name: "Sauerteigbrot", menge: "1 Laib", quelle: "manuell" },
      ]
    },
    {
      name: "Molkerei & Kühlwaren", icon: "🧀", color: "mid",
      hint: "Linke oder hintere Wand",
      items: [
        { name: "Eier (10er Pack)", menge: "2 Pkg", quelle: "beide" },
        { name: "Milch frisch", menge: "1–2 Fl.", quelle: "manuell" },
        { name: "Magerquark 0%", menge: "1 Becher (500g)", quelle: "manuell" },
        { name: "Feta light", menge: "200g + 1 extra Pkg", quelle: "beide" },
        { name: "Hüttenkäse / körniger Frischkäse", menge: "1 Becher", quelle: "manuell" },
        { name: "Reibekäse", menge: "150g", quelle: "plan" },
        { name: "Parmesan (gerieben)", menge: "80g", quelle: "plan" },
        { name: "Butter", menge: "1 Pkg", quelle: "plan" },
        { name: "Basilikum-Pesto (Glas)", menge: "1 Glas", quelle: "plan", tipp: "Oft im Kühlregal" },
        { name: "Chilitaler (rot/grün)", menge: "1 Pkg", quelle: "manuell", tipp: "Meist bei Aufschnitt/Käse" },
      ]
    },
    {
      name: "Fisch & Fleisch", icon: "🐟", color: "rose",
      hint: "Meist hinten im Laden",
      items: [
        { name: "Hackfleisch (gemischt)", menge: "600g", quelle: "plan" },
        { name: "Lachs / Graved Lachs", menge: "1 Pkg", quelle: "manuell" },
        { name: "Thunfisch (Dose in Wasser)", menge: "2 Dosen", quelle: "manuell", tipp: "Oder frisch, falls verfügbar" },
      ]
    },
    {
      name: "Trockenwaren & Regal-Mitte", icon: "🫙", color: "coral",
      hint: "Mittelgänge",
      items: [
        { name: "Rote Linsen (500g)", menge: "1 Pkg", quelle: "plan" },
        { name: "Gekochte braune Linsen", menge: "2x (Dose/Pkg)", quelle: "manuell" },
        { name: "Kichererbsen (Dose)", menge: "3 Dosen", quelle: "plan" },
        { name: "Kokosmilch (400ml)", menge: "2 Dosen", quelle: "plan" },
        { name: "Gehackte Tomaten", menge: "3 Dosen", quelle: "plan" },
        { name: "Tomatenmark", menge: "1 Tube", quelle: "plan" },
        { name: "Gemüsebrühe (Würfel)", menge: "1 Pkg", quelle: "plan" },
        { name: "Basmati-Reis (500g)", menge: "1 Pkg", quelle: "plan" },
        { name: "Quinoa", menge: "1 Pkg (400–500g)", quelle: "manuell" },
        { name: "Olivenöl (500ml)", menge: "1 Fl.", quelle: "plan" },
        { name: "Sesam (Körner)", menge: "1 Pkg", quelle: "plan" },
        { name: "Pinienkerne", menge: "50g", quelle: "plan" },
      ]
    },
    {
      name: "Haushalt", icon: "🧹", color: "muted",
      hint: "Meist am Ende vor der Kasse",
      items: [
        { name: "Spülmaschinen-Tabs", menge: "1 Pkg", quelle: "manuell" },
      ]
    },
  ],
  checked: {},
};

// ─── DATUMS-HELFER ────────────────────────────────────────────────────────────
// Liefert ein Array der letzten n Tage als toDateString()-Keys (heute zuerst).
function lastNDays(n) {
  const out = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(d.toDateString());
  }
  return out;
}

// Komprimiertes 7-Tage-History-Objekt für Chat-Prompt aus logsByDate ableiten.
function weekHistoryFromLogs(logsByDate) {
  return lastNDays(7).map(dateKey => {
    const l = logsByDate?.[dateKey];
    const kcal = l?.meals?.reduce((s,m)=>s+(m.calories||0),0) || 0;
    return {
      date: dateKey,
      water: l?.water || 0,
      sleep: l?.sleep || "",
      kcal,
      mood: l?.energy || "",
    };
  });
}

// ─── CALENDAR FETCH ───────────────────────────────────────────────────────────
// Google-Calendar-MCP-Sync ist im Browser/Vercel nicht verfügbar (nur in der
// Claude-Sandbox). Hier wird ein leeres Array zurückgegeben – Termine werden
// rein lokal verwaltet (siehe KalenderScreen, "+ TERMIN"-Button).
async function fetchCalendarEvents() {
  return [];
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function EylaOrb({ size=48, thinking=false, listening=false }) {
  const col = listening ? T.green : T.acc;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <style>{`
        @keyframes eR1{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes eR2{from{transform:rotate(0)}to{transform:rotate(-360deg)}}
        @keyframes eFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
        @keyframes eGlow{0%,100%{box-shadow:0 0 12px ${T.acc}44}50%{box-shadow:0 0 24px ${T.acc}88}}
        @keyframes eListen{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
        @keyframes eThink{0%,100%{box-shadow:0 0 16px ${T.acc}88}50%{box-shadow:0 0 32px ${T.acc}ff}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
      `}</style>
      <div style={{ position:"absolute", inset:0, borderRadius:"50%", border:`1px solid ${col}33`, borderTopColor:`${col}88`, animation:`eR1 ${thinking?1.5:10}s linear infinite` }}/>
      <div style={{ position:"absolute", inset:size*.1, borderRadius:"50%", border:`1px solid ${col}18`, borderBottomColor:`${col}55`, animation:`eR2 ${thinking?1:7}s linear infinite` }}/>
      <div style={{ position:"absolute", inset:size*.18, borderRadius:"50%",
        background:`radial-gradient(circle at 35% 35%, ${T.goldL}, ${col}, ${T.dim})`,
        animation: listening?`eListen .6s ease-in-out infinite`:thinking?`eThink .8s ease-in-out infinite`:`eFloat 4s ease-in-out infinite, eGlow 3s ease-in-out infinite`,
        display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*.3,
        boxShadow:`0 0 ${size*.3}px ${col}55`
      }}>✦</div>
    </div>
  );
}

function Waveform() {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:3, height:22 }}>
      {Array.from({length:16}).map((_,i)=>(
        <div key={i} style={{ width:3, borderRadius:3, background:`linear-gradient(${T.dim},${T.acc})`,
          animation:`eW ${.5+(i%4)*.2}s ease-in-out infinite alternate`, animationDelay:`${(i*.07).toFixed(2)}s` }}/>
      ))}
      <style>{`@keyframes eW{from{height:3px;opacity:.3}to{height:18px;opacity:1}}`}</style>
    </div>
  );
}

function Card({ children, style={}, accent=false, gold=false }) {
  return (
    <div style={{
      background: gold ? "linear-gradient(135deg,#1C1500,#211A00)" : accent ? `linear-gradient(135deg,${T.dim}18,${T.acc}08)` : T.card,
      border:`1px solid ${gold?T.gold+"44":accent?T.acc+"33":T.borderS}`,
      borderRadius:14, padding:"18px 22px",
      boxShadow: accent ? `0 0 24px ${T.acc}0A` : "none",
      ...style
    }}>{children}</div>
  );
}

// Sub-Toggle Row für innerhalb eines Tabs (z.B. Heute/Kalender, Plan/Liste)
function SubTabRow({ current, onChange, options }) {
  return (
    <div style={{
      display:"flex", gap:6, marginBottom:18, padding:4,
      background:T.bg2, borderRadius:12, border:`1px solid ${T.border}`
    }}>
      {options.map(o => {
        const active = current === o.id;
        const col = o.color || T.acc;
        return (
          <button key={o.id} onClick={()=>onChange(o.id)} style={{
            flex:1, background: active ? `linear-gradient(135deg,${col}22,${col}11)` : "transparent",
            border: active ? `1px solid ${col}55` : `1px solid transparent`,
            borderRadius:9, padding:"8px 6px",
            color: active ? col : T.muted,
            fontFamily:T.serif, fontSize:13, fontStyle: active ? "normal" : "italic",
            cursor:"pointer", transition:"all .2s"
          }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Lbl({ children, color=T.muted, style={} }) {
  return <div style={{ fontFamily:T.mono, fontSize:10, letterSpacing:2.5, color, textTransform:"uppercase", ...style }}>{children}</div>;
}

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [p, setP] = useState({
    name:"", sex:"", age:"", weight:"", height:"",
    goal:[], activity:"",
    preferences:"", intolerances:"", allergies:"",
    apps:[],
    goalType:"halten", targetWeight:"", targetWeeks:"",
    householdSize:1, householdNote:"",
    // NEU
    occupation:"", jobActivity:"",
    wakeTime:"07:00", sleepTime:"23:00", mealPattern:"3normal", mealPatternCustom:"",
    waterTargetL:2, sleepTargetH:7,
    healthNotes:"", about:"",
    cookTime:"medium", kitchenEquipment:["Pfanne","Ofen"],
    sportsPreferred:"",
  });
  const set = (k,v) => setP(prev=>({...prev,[k]:v}));
  const iStyle = { width:"100%", background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:10,
    padding:"12px 16px", color:T.text, fontSize:14, fontFamily:T.serif, outline:"none",
    fontStyle:"italic", boxSizing:"border-box", transition:"border-color .2s" };

  const goals = GOALS;
  const apps  = ["Apple Health","Google Fit","Garmin","Polar","MyFitnessPal","Whoop","Oura Ring"];

  const steps = [
    { title:"Ich bin EYLA.", sub:"Deine Begleiterin. Ruhig. Genau.", content:(
      <div style={{ textAlign:"center" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:32 }}><EylaOrb size={90}/></div>
        <p style={{ color:T.mid, lineHeight:1.9, fontStyle:"italic", fontSize:15, fontFamily:T.serif }}>
          Du erzählst, was du isst, wie du schläfst, was ansteht.<br/>
          Ich denke mit. Ich erinnere dich.<br/>
          Keine Trends. Keine Vorhaltungen.<br/>
          Was dein Körper braucht, ist meist schon da –<br/>
          ich helfe dir, hinzuhören.
        </p>
      </div>
    )},
    { title:"Wer bist du?", sub:"Je mehr ich weiß, desto präziser bin ich.", content:(
      <div>
        <div style={{ marginBottom:14 }}>
          <Lbl style={{ marginBottom:8 }}>Dein Name</Lbl>
          <input value={p.name} onChange={e=>set("name",e.target.value)} placeholder="Wie soll ich dich nennen?" style={iStyle}/>
        </div>
        <div style={{ marginBottom:14 }}>
          <Lbl style={{ marginBottom:8 }}>Geschlecht</Lbl>
          <div style={{ display:"flex", gap:8 }}>
            {[
              {id:"m", label:"♂ Mann"},
              {id:"f", label:"♀ Frau"},
              {id:"d", label:"⚧ Divers"},
            ].map(o=>{
              const sel = (p.sex||"")===o.id;
              return (
                <button key={o.id} onClick={()=>set("sex",o.id)} style={{
                  flex:1, background:sel?T.acc+"22":"transparent",
                  border:`1px solid ${sel?T.acc:T.borderS}`, borderRadius:10,
                  padding:"9px 6px", color:sel?T.text:T.muted,
                  fontFamily:T.serif, fontSize:13, cursor:"pointer",
                  fontStyle:sel?"normal":"italic", transition:"all .2s"
                }}>{o.label}</button>
              );
            })}
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
          {[["Alter","age","Jahre","number"],["Gewicht","weight","kg","number"],["Größe","height","cm","number"]].map(([l,k,ph,t])=>(
            <div key={k}>
              <Lbl style={{ marginBottom:8 }}>{l}</Lbl>
              <input value={p[k]} onChange={e=>set(k,e.target.value)} placeholder={ph} type={t} style={{...iStyle,fontFamily:T.mono,fontStyle:"normal"}}/>
            </div>
          ))}
        </div>
      </div>
    )},
    { title:"Was willst du?", sub:"Mehrere möglich.", content:(
      <div>
        <Lbl style={{ marginBottom:12 }}>Meine Ziele</Lbl>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:20 }}>
          {goals.map(g=>{
            const sel = Array.isArray(p.goal) ? p.goal.includes(g) : p.goal===g;
            return (
              <button key={g} onClick={()=>{
                const current = Array.isArray(p.goal) ? p.goal : (p.goal ? [p.goal] : []);
                const next = current.includes(g) ? current.filter(x=>x!==g) : [...current, g];
                set("goal", next);
              }} style={{ background:sel?T.acc+"22":"transparent",
                border:`1px solid ${sel?T.acc:T.borderS}`, borderRadius:20, padding:"8px 16px",
                color:sel?T.text:T.muted, fontFamily:T.serif, fontSize:13, cursor:"pointer",
                fontStyle:"italic", transition:"all .2s" }}>{g}</button>
            );
          })}
        </div>
        <Lbl style={{ marginBottom:8 }}>Wie aktiv bist du?</Lbl>
        <input value={p.activity} onChange={e=>set("activity",e.target.value)}
          placeholder="z.B. 4x pro Woche Laufen, täglich Yoga …" style={iStyle}/>
      </div>
    )},
    { title:"Gewicht.", sub:"Halten, abnehmen oder aufbauen?", content:(
      <div>
        <Lbl style={{ marginBottom:12 }}>Richtung</Lbl>
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          {[
            {id:"halten",   label:"🟰 Halten",   col:T.acc},
            {id:"abnehmen", label:"↓ Abnehmen",  col:T.green},
            {id:"aufbauen", label:"↑ Aufbauen",  col:T.gold},
          ].map(o=>{
            const sel = p.goalType===o.id;
            return (
              <button key={o.id} onClick={()=>set("goalType",o.id)} style={{
                flex:1, background:sel?o.col+"22":"transparent",
                border:`1px solid ${sel?o.col:T.borderS}`, borderRadius:12,
                padding:"12px 8px", color:sel?T.text:T.muted,
                fontFamily:T.serif, fontSize:13, cursor:"pointer",
                fontStyle:sel?"normal":"italic", transition:"all .2s"
              }}>{o.label}</button>
            );
          })}
        </div>
        {p.goalType !== "halten" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, animation:"fadeUp .3s ease both" }}>
            <div>
              <Lbl style={{ marginBottom:8 }}>Zielgewicht</Lbl>
              <input value={p.targetWeight} onChange={e=>set("targetWeight",e.target.value)}
                placeholder="kg" type="number" style={{...iStyle,fontFamily:T.mono,fontStyle:"normal"}}/>
            </div>
            <div>
              <Lbl style={{ marginBottom:8 }}>In wie vielen Wochen?</Lbl>
              <input value={p.targetWeeks} onChange={e=>set("targetWeeks",e.target.value)}
                placeholder="Wochen" type="number" style={{...iStyle,fontFamily:T.mono,fontStyle:"normal"}}/>
            </div>
          </div>
        )}
        {p.goalType !== "halten" && p.targetWeight && p.targetWeeks && p.weight && (
          <p style={{ color:T.mid, fontSize:12, fontStyle:"italic", fontFamily:T.serif, marginTop:14, padding:"8px 12px", background:T.bg2, borderRadius:8 }}>
            ✦ {(() => {
              const ct = calorieTarget({weight:p.weight,height:p.height||180,age:p.age||30,goalType:p.goalType,targetWeight:p.targetWeight,targetWeeks:p.targetWeeks});
              return p.goalType==="abnehmen"
                ? `Tagesziel ~${ct.target} kcal (${Math.abs(ct.dailyDelta)} kcal Defizit)`
                : `Tagesziel ~${ct.target} kcal (${ct.dailyDelta} kcal Überschuss)`;
            })()}
          </p>
        )}
      </div>
    )},
    { title:"Deine Küche.", sub:"Was liebst du? Was verträgst du nicht?", content:(
      <div>
        {[
          ["Vorlieben","preferences","z.B. Mediterran, vegetarisch, Meal Prep …"],
          ["Intoleranzen","intolerances","z.B. Laktose, Gluten"],
          ["⚠ Allergien (lebenswichtig)","allergies","z.B. Erdnüsse, Penicillin"],
        ].map(([l,k,ph])=>(
          <div key={k} style={{ marginBottom:14 }}>
            <Lbl style={{ marginBottom:8 }}>{l}</Lbl>
            <input value={p[k]} onChange={e=>set(k,e.target.value)} placeholder={ph} style={iStyle}/>
          </div>
        ))}
      </div>
    )},
    { title:"Dein Tagesrhythmus.", sub:"Wann läufst du? Wie isst du?", content:(
      <div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:18 }}>
          <div>
            <Lbl style={{ marginBottom:8 }}>🌅 Aufstehen</Lbl>
            <input type="time" value={p.wakeTime} onChange={e=>set("wakeTime",e.target.value)} style={{...iStyle,fontFamily:T.mono,fontStyle:"normal"}}/>
          </div>
          <div>
            <Lbl style={{ marginBottom:8 }}>🌙 Schlafen</Lbl>
            <input type="time" value={p.sleepTime} onChange={e=>set("sleepTime",e.target.value)} style={{...iStyle,fontFamily:T.mono,fontStyle:"normal"}}/>
          </div>
        </div>
        <Lbl style={{ marginBottom:10 }}>Mahlzeiten-Muster</Lbl>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:p.mealPattern==="custom"?10:18 }}>
          {[
            {id:"3normal", label:"🍳 3× normal"},
            {id:"5small",  label:"🥗 5× klein"},
            {id:"if168",   label:"⏱ IF 16:8"},
            {id:"ifother", label:"⏱ IF anders"},
            {id:"custom",  label:"✏️ Eigenes"},
          ].map(o=>{
            const sel = p.mealPattern===o.id;
            return (
              <button key={o.id} onClick={()=>set("mealPattern",o.id)} style={{
                background:sel?T.acc+"22":"transparent", border:`1px solid ${sel?T.acc:T.borderS}`,
                borderRadius:10, padding:"10px 8px", color:sel?T.text:T.muted,
                fontFamily:T.serif, fontSize:13, cursor:"pointer",
                fontStyle:sel?"normal":"italic", transition:"all .2s"
              }}>{o.label}</button>
            );
          })}
        </div>
        {p.mealPattern==="custom" && (
          <textarea value={p.mealPatternCustom} onChange={e=>set("mealPatternCustom",e.target.value)}
            placeholder='Beschreib deinen Essrhythmus – z.B. "morgens nur Kaffee, große Mahlzeit 14 Uhr, Snack nach Training, Abendessen 20 Uhr" oder "2 Mahlzeiten + 2 Shakes"'
            rows={3} style={{...iStyle, marginBottom:18, resize:"vertical", lineHeight:1.5}}/>
        )}
        <Lbl style={{ marginBottom:10 }}>Tagesziele</Lbl>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>💧 Wasser (L)</Lbl>
            <input type="number" step="0.25" min="0.5" max="5"
              value={p.waterTargetL} onChange={e=>set("waterTargetL", parseFloat(e.target.value)||2)}
              style={{...iStyle,fontFamily:T.mono,fontStyle:"normal"}}/>
          </div>
          <div>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>😴 Schlaf (h)</Lbl>
            <input type="number" step="0.5" min="4" max="12"
              value={p.sleepTargetH} onChange={e=>set("sleepTargetH", parseFloat(e.target.value)||7)}
              style={{...iStyle,fontFamily:T.mono,fontStyle:"normal"}}/>
          </div>
        </div>
      </div>
    )},
    { title:"Beruf & Gesundheit.", sub:"Optional – hilft EYLA dich besser zu verstehen.", content:(
      <div>
        <Lbl style={{ marginBottom:8 }}>Was machst du beruflich?</Lbl>
        <input value={p.occupation} onChange={e=>set("occupation",e.target.value)}
          placeholder='z.B. "Software-Entwickler", "Lehrerin"' style={{...iStyle, marginBottom:14}}/>
        <Lbl style={{ marginBottom:10 }}>Wie aktiv ist dein Job?</Lbl>
        <div style={{ display:"flex", gap:8, marginBottom:18 }}>
          {[
            {id:"sitzend", label:"🪑 Sitzend"},
            {id:"gemischt", label:"🚶 Gemischt"},
            {id:"aktiv", label:"💪 Aktiv"},
          ].map(o=>{
            const sel = p.jobActivity===o.id;
            return (
              <button key={o.id} onClick={()=>set("jobActivity",o.id)} style={{
                flex:1, background:sel?T.acc+"22":"transparent",
                border:`1px solid ${sel?T.acc:T.borderS}`, borderRadius:10,
                padding:"10px 4px", color:sel?T.text:T.muted,
                fontFamily:T.serif, fontSize:12, cursor:"pointer", transition:"all .2s"
              }}>{o.label}</button>
            );
          })}
        </div>
        <Lbl style={{ marginBottom:8 }}>Gesundheits-Notizen (optional)</Lbl>
        <textarea value={p.healthNotes} onChange={e=>set("healthNotes",e.target.value)}
          placeholder='z.B. "Knieprobleme rechts", "L-Thyroxin morgens", "Reflux"'
          rows={3}
          style={{...iStyle, resize:"vertical", minHeight:60, marginBottom:14}}/>
        <Lbl style={{ marginBottom:8 }}>Über dich (optional)</Lbl>
        <textarea value={p.about} onChange={e=>set("about",e.target.value)}
          placeholder='Alles, was EYLA über dich wissen sollte – Werte, Lebenssituation, was dir wichtig ist...'
          rows={3}
          style={{...iStyle, resize:"vertical", minHeight:60}}/>
      </div>
    )},
    { title:"Du kochst für …", sub:"EYLA passt Portionen daran an.", content:(
      <div>
        <Lbl style={{ marginBottom:12 }}>Wie viele essen mit?</Lbl>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:16 }}>
          {[
            { n:1, label:"Nur ich" },
            { n:2, label:"Paar" },
            { n:3, label:"Familie" },
            { n:4, label:"Großfamilie" },
          ].map(o => {
            const sel = (parseInt(p.householdSize)||1) === o.n;
            return (
              <button key={o.n} onClick={()=>set("householdSize", o.n)} style={{
                background:sel?T.acc+"22":"transparent",
                border:`1px solid ${sel?T.acc:T.borderS}`, borderRadius:12,
                padding:"14px 6px", color:sel?T.text:T.muted,
                fontFamily:T.serif, fontSize:12, cursor:"pointer",
                fontStyle:sel?"normal":"italic",
                display:"flex", flexDirection:"column", alignItems:"center", gap:4
              }}>
                <span style={{ fontFamily:T.mono, fontSize:18 }}>{o.n}{o.n===4?"+":""}</span>
                <span style={{ fontSize:11 }}>{o.label}</span>
              </button>
            );
          })}
        </div>
        <Lbl style={{ marginBottom:8 }}>Notiz (optional)</Lbl>
        <input value={p.householdNote||""} onChange={e=>set("householdNote",e.target.value)}
          placeholder='z.B. "Partner vegetarisch", "2 Kinder unter 10"' style={iStyle}/>
      </div>
    )},
  ];

  function finish() {
    const cleaned = {...p,
      preferences:p.preferences.split(",").map(s=>s.trim()).filter(Boolean),
      intolerances:p.intolerances.split(",").map(s=>s.trim()).filter(Boolean),
      allergies:p.allergies.split(",").map(s=>s.trim()).filter(Boolean),
      sportsPreferred: typeof p.sportsPreferred === "string" ? p.sportsPreferred.split(",").map(s=>s.trim()).filter(Boolean) : (p.sportsPreferred||[]),
    };
    onDone(cleaned);
  }

  const cur = steps[step];
  const canNext = step!==1 || (p.name.trim().length > 0 && !!p.sex);

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center",
      justifyContent:"center", padding:24, fontFamily:T.serif }}>
      <style>{`*{box-sizing:border-box} input:focus{border-color:${T.acc}88!important} input::placeholder{color:${T.muted};font-style:italic}`}</style>
      <div style={{ width:"100%", maxWidth:520 }}>
        {/* Progress */}
        <div style={{ display:"flex", gap:6, marginBottom:44 }}>
          {steps.map((_,i)=><div key={i} style={{ height:2, flex:1, borderRadius:2,
            background:i<=step?T.acc:T.faint, transition:"background .4s" }}/>)}
        </div>
        <div style={{ animation:"fadeUp .4s ease both" }}>
          <Lbl style={{ marginBottom:10 }}>Schritt {step+1} von {steps.length}</Lbl>
          <h2 style={{ fontSize:28, fontWeight:300, color:T.text, margin:"0 0 6px", letterSpacing:.5 }}>{cur.title}</h2>
          <p style={{ color:T.muted, fontStyle:"italic", margin:"0 0 32px", fontSize:13 }}>{cur.sub}</p>
          {cur.content}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:36 }}>
          {step>0
            ? <button onClick={()=>setStep(s=>s-1)} style={{ background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:12, padding:"12px 24px", color:T.muted, fontFamily:T.serif, fontSize:14, cursor:"pointer", fontStyle:"italic" }}>← Zurück</button>
            : <div/>}
          {step===0
            ? <button onClick={()=>setStep(1)} style={{ background:`linear-gradient(135deg,${T.dim},${T.acc})`, border:"none", borderRadius:12, padding:"12px 28px", color:T.bg, fontFamily:T.serif, fontSize:14, cursor:"pointer", fontWeight:700 }}>Los geht's →</button>
            : step===steps.length-1
            ? <button onClick={finish} disabled={!canNext} style={{ background:canNext?`linear-gradient(135deg,${T.dim},${T.acc})`:"transparent", border:canNext?"none":`1px solid ${T.borderS}`, borderRadius:12, padding:"12px 28px", color:canNext?T.bg:T.muted, fontFamily:T.serif, fontSize:14, cursor:canNext?"pointer":"default", fontWeight:700 }}>EYLA starten ✦</button>
            : <button onClick={()=>setStep(s=>s+1)} disabled={!canNext} style={{ background:canNext?`linear-gradient(135deg,${T.dim},${T.acc})`:"transparent", border:canNext?"none":`1px solid ${T.borderS}`, borderRadius:12, padding:"12px 28px", color:canNext?T.bg:T.muted, fontFamily:T.serif, fontSize:14, cursor:canNext?"pointer":"default", fontWeight:700 }}>Weiter →</button>
          }
        </div>
      </div>
    </div>
  );
}

// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────
// Mini-Konfetti-Effekt – kurz, sparsam, pure CSS
// ── Perfect-Day Modal – wenn alle Tagesziele erreicht ──────────────────────
// Zeigt Stats + Share-Bild zum Teilen via navigator.share() oder Download.
function PerfectDayModal({ profile, log, tagKey, onClose }) {
  const canvasRef = useRef(null);
  const [shareUrl, setShareUrl] = useState(null);
  const [sharing, setSharing] = useState(false);

  const sleepNum = parseFloat(String(log.sleep||"0").replace("+","")) || 0;
  const totalKcal = (log.meals||[]).reduce((s,m)=>s+(m.calories||0),0);
  const waterL = ((log.water||0) * 0.25).toFixed(2);
  const workoutMin = (log.workouts||[]).reduce((s,w)=>s+(w.duration||0),0);
  const firstName = (profile.name||"").split(" ")[0];
  const today = new Date(tagKey).toLocaleDateString("de-DE", { day:"2-digit", month:"long", year:"numeric" });

  // Share-Bild zeichnen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 1080, H = 1080;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    // Hintergrund-Gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0d0e10");
    grad.addColorStop(1, "#1a1c20");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // Soft radial glow
    const g2 = ctx.createRadialGradient(W/2, H*0.3, 0, W/2, H*0.3, W*0.7);
    g2.addColorStop(0, "rgba(176, 156, 122, 0.18)");
    g2.addColorStop(1, "rgba(176, 156, 122, 0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
    // Top "EYLA" Wordmark
    ctx.fillStyle = "#e8e6e1";
    ctx.font = "300 56px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("EYLA.", W/2, 130);
    // Klein "EIN PERFEKTER TAG"
    ctx.fillStyle = "#b09c7a";
    ctx.font = "500 18px ui-monospace, monospace";
    ctx.letterSpacing = "4px";
    ctx.fillText("·  EIN PERFEKTER TAG  ·", W/2, 175);
    // Name + Datum
    ctx.fillStyle = "#e8e6e1";
    ctx.font = "italic 300 96px Georgia, serif";
    ctx.fillText(firstName || "Du", W/2, 320);
    ctx.fillStyle = "#7a7a78";
    ctx.font = "italic 28px Georgia, serif";
    ctx.fillText(today, W/2, 380);
    // Stat-Boxen
    const stats = [
      { icon:"💧", val:`${waterL}L`, label:"WASSER" },
      { icon:"😴", val:`${sleepNum}h`, label:"SCHLAF" },
      { icon:"🍽", val:`${totalKcal}`, label:"KCAL" },
      { icon:"🏋", val:`${workoutMin}min`, label:"BEWEGUNG" },
    ];
    const cardW = 220, cardH = 220, gap = 24;
    const totalW = cardW*2 + gap;
    const startX = (W - totalW)/2;
    const startY = 480;
    stats.forEach((s, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = startX + col*(cardW+gap);
      const y = startY + row*(cardH+gap);
      // card bg
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.strokeStyle = "rgba(176,156,122,0.3)";
      ctx.lineWidth = 1;
      const r = 24;
      ctx.beginPath();
      ctx.roundRect(x, y, cardW, cardH, r);
      ctx.fill();
      ctx.stroke();
      // icon
      ctx.font = "60px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(s.icon, x + cardW/2, y + 80);
      // value
      ctx.fillStyle = "#e8e6e1";
      ctx.font = "300 44px ui-monospace, monospace";
      ctx.fillText(s.val, x + cardW/2, y + 145);
      // label
      ctx.fillStyle = "#7a7a78";
      ctx.font = "500 14px ui-monospace, monospace";
      ctx.fillText(s.label, x + cardW/2, y + 185);
    });
    // Footer
    ctx.fillStyle = "#5a5a58";
    ctx.font = "italic 22px Georgia, serif";
    ctx.fillText("alle Ziele erreicht.", W/2, H - 130);
    ctx.fillStyle = "#b09c7a";
    ctx.font = "500 16px ui-monospace, monospace";
    ctx.fillText("eyla-app.vercel.app", W/2, H - 80);
    // Als Blob für Share/Download
    canvas.toBlob(blob => {
      if (blob) setShareUrl(URL.createObjectURL(blob));
    }, "image/png");
  }, [firstName, today, waterL, sleepNum, totalKcal, workoutMin]);

  async function handleShare() {
    if (!canvasRef.current) return;
    setSharing(true);
    try {
      canvasRef.current.toBlob(async (blob) => {
        if (!blob) { setSharing(false); return; }
        const file = new File([blob], `eyla-perfect-day-${tagKey.replace(/\s/g,"-")}.png`, { type:"image/png" });
        const shareText = `Perfekter EYLA-Tag ${today} ✨ — Wasser ${waterL}L · Schlaf ${sleepNum}h · ${totalKcal} kcal · ${workoutMin}min Bewegung`;
        if (navigator.canShare && navigator.canShare({ files:[file] })) {
          try {
            await navigator.share({ files:[file], title:"EYLA – Perfekter Tag", text: shareText });
          } catch (err) {
            // User abgebrochen oder nicht erlaubt → Fallback Download
            if (err?.name !== "AbortError") downloadBlob(blob);
          }
        } else {
          downloadBlob(blob);
        }
        setSharing(false);
      }, "image/png");
    } catch (e) {
      console.error("share err", e);
      setSharing(false);
    }
  }
  function downloadBlob(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eyla-perfect-day-${tagKey.replace(/\s/g,"-")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, zIndex:1000,
      background:"rgba(0,0,0,0.75)", backdropFilter:"blur(8px)",
      display:"flex", alignItems:"center", justifyContent:"center", padding:20,
      animation:"fadeUp .3s ease both"
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:T.bg2, border:`1px solid ${T.gold}55`, borderRadius:18,
        padding:24, maxWidth:380, width:"100%", textAlign:"center",
        boxShadow:`0 10px 60px ${T.gold}33, 0 0 80px ${T.acc}22`
      }}>
        <div style={{ fontSize:48, marginBottom:8, animation:"bounce 1.2s ease infinite" }}>✨</div>
        <style>{`@keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }`}</style>
        <div style={{ fontFamily:T.mono, fontSize:10, color:T.gold, letterSpacing:3, marginBottom:8 }}>PERFEKTER TAG</div>
        <h2 style={{ fontSize:24, fontWeight:300, color:T.text, margin:"0 0 6px", fontFamily:T.serif }}>
          Alle Ziele erreicht.
        </h2>
        <p style={{ color:T.mid, fontSize:13, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 16px", lineHeight:1.5 }}>
          {firstName}, das hat heute gepasst. Wasser, Schlaf, Essen, Bewegung. <br/>
          Wenn du willst, teil's mit jemandem der's mitkriegen soll.
        </p>
        {/* Preview */}
        {shareUrl && (
          <img src={shareUrl} alt="Share Preview" style={{
            width:"100%", borderRadius:12, marginBottom:16,
            border:`1px solid ${T.borderS}`
          }}/>
        )}
        <canvas ref={canvasRef} style={{ display:"none" }}/>
        <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
          <button onClick={handleShare} disabled={sharing} style={{
            flex:1,
            background:`linear-gradient(135deg, ${T.gold}, ${T.acc})`,
            border:"none", borderRadius:12, padding:"12px 20px",
            color:T.bg, fontFamily:T.serif, fontSize:14, fontWeight:700,
            cursor: sharing ? "default" : "pointer",
            opacity: sharing ? .5 : 1
          }}>{sharing ? "…" : "✦ Teilen"}</button>
          <button onClick={onClose} style={{
            background:"transparent", border:`1px solid ${T.borderS}`,
            borderRadius:12, padding:"12px 20px",
            color:T.muted, fontFamily:T.serif, fontSize:14, cursor:"pointer", fontStyle:"italic"
          }}>Schließen</button>
        </div>
      </div>
    </div>
  );
}

function Confetti({ show, onDone, mode = "normal" }) {
  // "normal" = einzelnes Ziel erreicht (50 Stück, 2.4s)
  // "super"  = ALLE Ziele erreicht (180 Stück, 4.5s, 3 Wellen, größer)
  const isSuper = mode === "super";
  const count = isSuper ? 180 : 50;
  const duration = isSuper ? 4500 : 2400;

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => onDone?.(), duration);
    return () => clearTimeout(t);
  }, [show, onDone, duration]);
  if (!show) return null;

  const colors = [T.acc, T.gold, T.green, T.rose, T.mid, T.goldL];
  const pieces = Array.from({length:count}, (_, i) => ({
    id: i,
    color: colors[i % colors.length],
    left: Math.random()*100,
    size: isSuper ? (5 + Math.random()*9) : 7,
    duration: (isSuper ? 2.2 : 1.4) + Math.random()*1.4,
    delay: Math.random() * (isSuper ? 2.0 : 0.4),
    rot: -360 + Math.random()*720,
    drift: -40 + Math.random()*80,
    shape: isSuper ? (i % 3) : 0, // 0=rect 1=circle 2=star
  }));
  return (
    <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:999, overflow:"hidden" }}>
      <style>{`
        @keyframes confettiFall {
          0%   { transform: translate3d(0, -20px, 0) rotate(0deg); opacity:1; }
          100% { transform: translate3d(var(--drift), 110vh, 0) rotate(var(--rot)); opacity:0; }
        }
      `}</style>
      {pieces.map(p => (
        <div key={p.id} style={{
          position:"absolute", top:0,
          left:`${p.left}%`,
          width:p.size, height:p.size * (p.shape===1?1:1.6),
          background: p.color,
          borderRadius: p.shape===1 ? "50%" : 1,
          boxShadow: isSuper ? `0 0 ${p.size*1.2}px ${p.color}66` : "none",
          animation:`confettiFall ${p.duration}s ${p.delay}s cubic-bezier(.4,0,.2,1) forwards`,
          ["--drift"]: `${p.drift}vw`,
          ["--rot"]: `${p.rot}deg`,
        }}/>
      ))}
    </div>
  );
}

// Haptic-Feedback Helper (works on Android, no-op auf iOS Safari – kein Problem)
function haptic(ms = 20) {
  try { navigator.vibrate?.(ms); } catch {}
}

// Smart-Hint: ein kontextabhängiger EYLA-Satz oben in Heute, basierend auf
// Tageszeit + Datenlücken + Plan. Wechselt im Lauf des Tages.
// ── Tagesziele-Helper ─────────────────────────────────────────────────────────
// User-konfigurierbar in Profil. Default 2L / 7h falls noch nicht gesetzt.
// waterTargetUnits gibt die Anzahl 0.25L-Einheiten (z.B. 2.5L → 10 Units)
function waterTargetUnits(profile) {
  const liters = parseFloat(profile?.waterTargetL) || 2;
  return Math.round(liters * 4); // 1 Unit = 0.25L
}
function waterTargetL(profile) {
  return parseFloat(profile?.waterTargetL) || 2;
}
function sleepTargetH(profile) {
  return parseFloat(profile?.sleepTargetH) || 7;
}

function smartHintFor(log, profile, plan) {
  const hour = new Date().getHours();
  const eaten = (log.meals||[]).reduce((s,m)=>s+(m.calories||0),0);
  const water = log.water || 0;
  const targetUnits = waterTargetUnits(profile);
  const halfTarget = Math.ceil(targetUnits / 2); // Mittagsbenchmark = halbes Tagesziel
  const quartTarget = Math.ceil(targetUnits / 4);
  const hasWorkout = (log.workouts||[]).length > 0;
  const todayWeekday = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"][new Date().getDay()];
  const todayPlan = plan?.days?.find(d => d.day && d.day.toLowerCase().includes(todayWeekday.toLowerCase()));

  // Priorität 1: Plan-Bezug zur Tageszeit
  if (todayPlan) {
    if (hour >= 7 && hour <= 10 && (log.meals||[]).length === 0 && todayPlan.breakfast && todayPlan.breakfast !== "—") {
      return `Plan-Frühstück heute: ${todayPlan.breakfast.split("(")[0].trim()}.`;
    }
    if (hour >= 11 && hour <= 14 && eaten < 600 && todayPlan.lunch && todayPlan.lunch !== "—") {
      return `Mittag fällig. Im Plan: ${todayPlan.lunch.split("(")[0].trim()}.`;
    }
    if (hour >= 17 && hour <= 20 && todayPlan.dinner && todayPlan.dinner !== "—") {
      return `Heute Abend laut Plan: ${todayPlan.dinner.split("(")[0].trim()}.`;
    }
  }
  // Priorität 2: Wasser-Lücke – relativ zum User-Ziel
  if (hour >= 14 && water < halfTarget) return `Schon ${hour} Uhr und erst ${(water*.25).toFixed(2)}L Wasser (Ziel: ${waterTargetL(profile)}L). Schluck noch was.`;
  if (hour >= 11 && water < quartTarget) return `Vergiss das Wasser nicht – noch fast nichts heute.`;
  // Priorität 3: Training
  if (hour >= 17 && !hasWorkout && new Date().getDay() !== 0) return `Heute noch keine Bewegung. Auch 20 Min Spazieren zählen.`;
  // Priorität 4: Abend-Reflexion
  if (hour >= 21 && !log.note) return `Schon spät. Kurz aufschreiben wie der Tag war?`;
  // Priorität 4.5: Todos – wenn welche heute offen sind, mention sie
  try {
    const todosRaw = localStorage.getItem("eyla_todos_v1");
    if (todosRaw) {
      const todos = JSON.parse(todosRaw);
      const openTodayTodos = todos.filter(t => t.status==="open" && (t.priority||"today")==="today");
      if (openTodayTodos.length > 0) {
        // Finde den ältesten Todo (lange offen)
        const sorted = [...openTodayTodos].sort((a,b) => (a.createdAt||"").localeCompare(b.createdAt||""));
        const oldest = sorted[0];
        const ageDays = oldest.createdAt ? Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / 86400000) : 0;
        if (hour >= 9 && hour <= 12 && openTodayTodos.length >= 1) {
          if (ageDays >= 3) return `"${oldest.text}" hängt seit ${ageDays} Tagen. Heute angehen?`;
          if (openTodayTodos.length >= 3) return `${openTodayTodos.length} Todos heute. Was zuerst?`;
        }
        if (hour >= 16 && hour <= 19 && ageDays >= 2) {
          return `"${oldest.text}" ist noch offen. Schnell jetzt?`;
        }
      }
    }
  } catch {}
  // Priorität 5: Morgens neutral
  if (hour < 9) return `Guten Morgen. ${profile.name?.split(" ")[0] || ""}.`;
  return null;
}

// Apple-Watch-Style konzentrische Ringe für Tages-Overview
// 4 Ringe: Wasser (außen), Schlaf, Kalorien, Bewegung (innen)
function ActivityRings({ water, waterTarget, sleep, sleepTarget, kcal, kcalTarget, workouts, workoutTarget = 60 }) {
  const size = 84, stroke = 5, gap = 1.5;
  const c = size / 2;
  const ring = (radius, percent, color) => {
    const circ = 2 * Math.PI * radius;
    const p = Math.max(0, Math.min(1, percent));
    return (
      <>
        <circle cx={c} cy={c} r={radius} fill="none" stroke={color+"22"} strokeWidth={stroke}/>
        <circle cx={c} cy={c} r={radius} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={circ - p*circ}
          strokeLinecap="round" transform={`rotate(-90 ${c} ${c})`} />
      </>
    );
  };
  const r1 = c - stroke/2 - 1;
  const r2 = r1 - stroke - gap;
  const r3 = r2 - stroke - gap;
  const r4 = r3 - stroke - gap;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ flexShrink:0 }}>
      {ring(r1, water / waterTarget, T.acc)}
      {ring(r2, sleep / sleepTarget, T.mid)}
      {ring(r3, kcal / Math.max(1, kcalTarget), T.gold)}
      {ring(r4, (workouts||0) / workoutTarget, T.green)}
    </svg>
  );
}

function TodayScreen({ profile, setLog: setLogRaw, logsByDate, events = [], initialDate }) {
  // Todos im Heute-Screen sichtbar machen (Live-Sync via storage + custom event)
  const [todos, setTodos] = useState([]);
  const [localEvents, setLocalEvents] = useState([]);
  useEffect(() => {
    setTodos(loadTodos());
    retrieve("eyla_local_events_v2", []).then(e => setLocalEvents(Array.isArray(e) ? e : []));
    function onStorage(e) {
      if (e.key === "eyla_todos_v1") setTodos(loadTodos());
      if (e.key === "eyla_local_events_v2") retrieve("eyla_local_events_v2", []).then(arr => setLocalEvents(arr||[]));
    }
    function onCustom() { setTodos(loadTodos()); }
    function onEvCustom() { retrieve("eyla_local_events_v2", []).then(arr => setLocalEvents(arr||[])); }
    window.addEventListener("storage", onStorage);
    window.addEventListener("eyla_todos_changed", onCustom);
    window.addEventListener("eyla_events_changed", onEvCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("eyla_todos_changed", onCustom);
      window.removeEventListener("eyla_events_changed", onEvCustom);
    };
  }, []);

  const [mealName, setMealName] = useState("");
  const [mealCal, setMealCal] = useState("");
  const [mealP, setMealP] = useState("");
  const [mealC, setMealC] = useState("");
  const [mealF, setMealF] = useState("");
  const [showMacros, setShowMacros] = useState(false);
  // Foto-Analyse-State
  const [photoData, setPhotoData] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const fileInputRef = useRef(null);
  // Favoriten + Plan-Daten für Smart-Hints
  const [favorites, setFavorites] = useState([]);
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    retrieve("eyla_favorites_v1", []).then(f => setFavorites(Array.isArray(f) ? f : []));
    retrieve("eyla_plan_v1", null).then(p => setPlan(p));
  }, []);

  // Konfetti-State (Effekt-Trigger wird weiter unten gesetzt nachdem `log` existiert)
  const [konfetti, setKonfetti] = useState(false);
  const [konfettiMode, setKonfettiMode] = useState("normal"); // "normal" | "super"
  const [perfectDayOpen, setPerfectDayOpen] = useState(false);
  // WICHTIG: Refs lazy initialisieren mit dem aktuellen Wert beim ersten Mount,
  // sonst feuert das Konfetti bei jedem Tab-Wechsel weil from-0-rüber gerechnet wird.
  const prevWaterRef = useRef(null);          // lazy: erst beim ersten Effekt-Lauf gesetzt
  const prevKcalReachedRef = useRef(null);
  const prevAllReachedRef = useRef(null);
  const prevTodoAllDoneRef = useRef(null);

  // Datum-Navigator: User kann auch andere Tage nachtragen
  const [tagDate, setTagDate] = useState(() => initialDate || new Date());
  // Wenn initialDate von außen kommt (z.B. Woche-Tag-Tap): tagDate updaten
  const lastInitialRef = useRef(initialDate ? initialDate.toDateString() : null);
  useEffect(() => {
    if (!initialDate) return;
    const k = initialDate.toDateString();
    if (k !== lastInitialRef.current) {
      lastInitialRef.current = k;
      setTagDate(initialDate);
    }
  }, [initialDate]);
  const tagKey = tagDate.toDateString();
  const todayKey = new Date().toDateString();
  const isToday = tagKey === todayKey;
  const isPast = tagKey < todayKey;
  const log = logsByDate?.[tagKey] || { meals:[], water:0, energy:"", sleep:"", workouts:[], weight:null, habits:{}, date:tagKey };
  // setLog für den gerade gewählten Tag
  const setLog = useCallback((updater) => setLogRaw(updater, tagKey), [setLogRaw, tagKey]);
  function prevDay() { const d = new Date(tagDate); d.setDate(d.getDate()-1); setTagDate(d); }
  function nextDay() { const d = new Date(tagDate); d.setDate(d.getDate()+1); setTagDate(d); }
  function goToday() { setTagDate(new Date()); }

  // Konfetti-Trigger: wenn Wasser-Ziel oder Kcal-Ziel erstmalig erreicht.
  // WICHTIG: beim ersten Effect-Lauf (ref===null) NUR initialisieren, nicht feuern.
  useEffect(() => {
    const wTarget = waterTargetUnits(profile);
    const cur = log.water || 0;
    // Nur heute feiern; vergangene Tage nur Ref setzen
    if (!isToday) { prevWaterRef.current = cur; return; }
    // Pro Tag nur EINMAL feiern – verhindert Spam beim Daten-Nachladen (Hydration)
    const markerKey = `eyla_cele_water_${tagKey}`;
    let already = false; try { already = !!localStorage.getItem(markerKey); } catch {}
    if (prevWaterRef.current !== null && prevWaterRef.current < wTarget && cur >= wTarget && !already) {
      try { localStorage.setItem(markerKey, "1"); } catch {}
      setKonfettiMode("normal");
      setKonfetti(true);
      haptic(60);
      awardPoints("water_goal"); // Studio-Punkte
    }
    prevWaterRef.current = cur;
  }, [log.water, profile, isToday, tagKey]);
  useEffect(() => {
    const totalKcal = (log.meals||[]).reduce((s,m)=>s+(m.calories||0),0);
    const target = calorieTarget(profile).target;
    const reached = totalKcal >= target;
    if (!isToday) { prevKcalReachedRef.current = reached; return; }
    const markerKey = `eyla_cele_kcal_${tagKey}`;
    let already = false; try { already = !!localStorage.getItem(markerKey); } catch {}
    if (prevKcalReachedRef.current !== null && !prevKcalReachedRef.current && reached && !already) {
      try { localStorage.setItem(markerKey, "1"); } catch {}
      setKonfettiMode("normal");
      setKonfetti(true);
      haptic(60);
    }
    prevKcalReachedRef.current = reached;
  }, [log.meals, profile, isToday, tagKey]);

// Konfetti wenn der letzte Heute-Todo abgehakt wird (cleaner Subtrigger)
  useEffect(() => {
    if (!isToday) return;
    const todayTodos = todos.filter(t => (t.priority||"today")==="today");
    if (todayTodos.length === 0) { prevTodoAllDoneRef.current = false; return; }
    const allDone = todayTodos.every(t => t.status === "done");
    // Erste Init: nur setzen, nicht feuern (sonst spam bei jedem Tab-Wechsel)
    if (prevTodoAllDoneRef.current === null) {
      prevTodoAllDoneRef.current = allDone;
      return;
    }
    const markerKey = `eyla_cele_todos_${tagKey}`;
    let already = false; try { already = !!localStorage.getItem(markerKey); } catch {}
    if (allDone && !prevTodoAllDoneRef.current && !already) {
      try { localStorage.setItem(markerKey, "1"); } catch {}
      setKonfettiMode("normal");
      setKonfetti(true);
      haptic(40);
    }
    prevTodoAllDoneRef.current = allDone;
  }, [todos, isToday, tagKey]);

  // ── PERFECT-DAY-Trigger: ALLE Tagesziele erreicht ──────────────────────────
  // Bedingungen: Wasser ≥ Ziel, Schlaf ≥ Ziel, Kcal ≥ 90% Ziel, mind. 1 Workout
  useEffect(() => {
    if (!isToday) return; // nur für heute, nicht beim Nachtragen vergangener Tage
    const wTarget = waterTargetUnits(profile);
    const sTarget = sleepTargetH(profile);
    const kcalTarget = calorieTarget(profile).target;
    const sleepNum = parseFloat(String(log.sleep||"0").replace("+","")) || 0;
    const totalKcal = (log.meals||[]).reduce((s,m)=>s+(m.calories||0),0);
    const hasWorkout = (log.workouts||[]).length > 0;

    const allReached =
      (log.water||0) >= wTarget &&
      sleepNum >= sTarget &&
      totalKcal >= kcalTarget * 0.9 &&
      hasWorkout;

    // Persisted-Marker damit beim Reload nicht nochmal feuert
    const storageKey = `eyla_perfectday_${tagKey}`;
    const alreadyCelebrated = !!localStorage.getItem(storageKey);

    // Erste Init: nur setzen, nicht feuern
    if (prevAllReachedRef.current === null) {
      prevAllReachedRef.current = allReached;
      return;
    }
    if (allReached && !prevAllReachedRef.current && !alreadyCelebrated) {
      try { localStorage.setItem(storageKey, "1"); } catch {}
      setKonfettiMode("super");
      setKonfetti(true);
      setPerfectDayOpen(true);
      haptic([50, 80, 50, 80, 120]); // longer pattern
      if (isToday) awardPoints("perfect_day"); // Studio-Punkte
    }
    prevAllReachedRef.current = allReached;
  }, [log, profile, tagKey, isToday]);

  // Mahlzeiten-Punkte: wenn 3+ Mahlzeiten geloggt (1× pro Tag)
  const prevMealCountRef = useRef(null);
  useEffect(() => {
    if (!isToday) return;
    const n = (log.meals||[]).length;
    if (prevMealCountRef.current !== null && prevMealCountRef.current < 3 && n >= 3) {
      awardPoints("meals_logged");
    }
    prevMealCountRef.current = n;
  }, [log.meals, isToday]);

  const eaten = log.meals.reduce((s,m)=>s+(m.calories||0),0);
  const eatenP = log.meals.reduce((s,m)=>s+(m.protein||0),0);
  const eatenC = log.meals.reduce((s,m)=>s+(m.carbs||0),0);
  const eatenF = log.meals.reduce((s,m)=>s+(m.fat||0),0);
  const ct = calorieTarget(profile);
  const mt = macroTarget(profile);
  const tdee = ct.tdee;
  const targetKcal = ct.target;

  // Häufige Mahlzeiten der letzten 14 Tage (für Quick-Add). Nach Letzt-Verwendung sortiert,
  // ohne die heute schon eingetragenen.
  const recentMeals = (() => {
    const today = TODAY;
    const seen = new Set(log.meals.map(m => m.name.toLowerCase()));
    const out = [];
    const keys = lastNDays(14).slice(1); // ab gestern rückwärts
    for (const k of keys) {
      const l = logsByDate?.[k];
      if (!l?.meals) continue;
      for (const m of [...l.meals].reverse()) {
        const lk = m.name.toLowerCase();
        if (seen.has(lk)) continue;
        seen.add(lk);
        out.push({ name: m.name, calories: m.calories||0, protein: m.protein||0, carbs: m.carbs||0, fat: m.fat||0 });
        if (out.length >= 5) return out;
      }
    }
    return out;
  })();

  function quickAddMeal(m) {
    setLog(l => ({...l, meals:[...l.meals, {
      id: Date.now(),
      name: m.name,
      calories: m.calories,
      protein: m.protein,
      carbs: m.carbs,
      fat: m.fat,
      time: new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})
    }]}));
  }

  function addMeal() {
    if (!mealName.trim()) return;
    const meal = {
      id: Date.now(),
      name: mealName.trim(),
      calories: parseInt(mealCal) || 0,
      protein: parseInt(mealP) || 0,
      carbs:   parseInt(mealC) || 0,
      fat:     parseInt(mealF) || 0,
      time: new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})
    };
    setLog(l=>({...l, meals:[...l.meals, meal]}));
    setMealName(""); setMealCal(""); setMealP(""); setMealC(""); setMealF("");
    setShowMacros(false);
  }

  // Foto auswählen und an Claude Vision schicken
  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalysisError(null);

    // Bild auf ~max 1024px herunterskalieren, damit Payload klein bleibt
    const img = new Image();
    const reader = new FileReader();
    reader.onload = async () => {
      img.src = reader.result;
      await new Promise(r=>{ img.onload = r; });
      const max = 1024;
      const scale = Math.min(1, max/Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width*scale);
      canvas.height = Math.round(img.height*scale);
      const ctx2 = canvas.getContext("2d");
      ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      const base64 = dataUrl.split(",")[1];
      setPhotoData({ dataUrl, base64, mime: "image/jpeg" });
      analyzePhoto(base64);
    };
    reader.readAsDataURL(file);
    // Input resetten damit gleiches File nochmal gewählt werden kann
    e.target.value = "";
  }

  async function analyzePhoto(base64) {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 400,
          system: "Du analysierst Essens-Fotos. Antworte IMMER in genau diesen 5 Zeilen, ohne weitere Erklärungen, keine Markdown:\nNAME: kurze Beschreibung der Mahlzeit (max 6 Wörter)\nKCAL: geschätzte Gesamtkalorien (nur Zahl, z.B. 620)\nPROTEIN: Protein in g (nur Zahl)\nCARBS: Kohlenhydrate in g (nur Zahl)\nFAT: Fett in g (nur Zahl)",
          messages: [{
            role:"user",
            content: [
              { type:"image", source:{ type:"base64", media_type:"image/jpeg", data: base64 } },
              { type:"text", text:"Was ist auf dem Bild? Schätze Kalorien und Makronährstoffe (Protein, Kohlenhydrate, Fett in g)." }
            ]
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.find(b=>b.type==="text")?.text || "";
      const nameMatch = text.match(/NAME:\s*(.+)/i);
      const kcalMatch = text.match(/KCAL:\s*(\d+)/i);
      const pMatch = text.match(/PROTEIN:\s*(\d+)/i);
      const cMatch = text.match(/CARBS:\s*(\d+)/i);
      const fMatch = text.match(/FAT:\s*(\d+)/i);
      const name = nameMatch ? nameMatch[1].trim() : "Mahlzeit";
      const cal = kcalMatch ? parseInt(kcalMatch[1]) : 0;
      setMealName(name);
      setMealCal(String(cal));
      if (pMatch) setMealP(pMatch[1]); else setMealP("");
      if (cMatch) setMealC(cMatch[1]); else setMealC("");
      if (fMatch) setMealF(fMatch[1]); else setMealF("");
      setShowMacros(true);
    } catch(e) {
      setAnalysisError("Konnte das Bild nicht analysieren – versuch's nochmal oder tipp ein.");
    }
    setAnalyzing(false);
  }

  function clearPhoto() {
    setPhotoData(null);
    setAnalysisError(null);
    setMealName("");
    setMealCal("");
  }

  function acceptPhotoMeal() {
    if (!mealName.trim()) return;
    addMeal();
    setPhotoData(null);
  }

  const energyOpts = ["💤 Erschöpft","😴 Müde","😐 Ok","😊 Gut","⚡ Energiegeladen"];

  const hint = isToday ? smartHintFor(log, profile, plan) : null;

  // ─── WAS JETZT? — kontextuelle nächste Aktion mit Direkt-Button ─────────
  const nextAction = (() => {
    if (!isToday) return null;
    const hour = new Date().getHours();
    const eaten = (log.meals||[]).reduce((s,m)=>s+(m.calories||0),0);
    const water = log.water || 0;
    const wTarget = waterTargetUnits(profile);
    const hasWorkout = (log.workouts||[]).length > 0;
    // Wasser-Lücke nach Mittag → direkter +0.25L Button
    if (hour >= 13 && water < wTarget / 2) {
      return {
        label: `+0.25L Wasser`, icon:"💧", hint:`Erst ${(water*.25).toFixed(2)}L heute.`,
        action: () => { setLog(l => ({...l, water: Math.min(12, (l.water||0) + 1)})); haptic(15); }
      };
    }
    // Mahlzeit fehlt mittags
    if (hour >= 12 && hour <= 14 && eaten < 200) {
      return {
        label:"Mahlzeit", icon:"🍽", hint:"Mittagspause — was gegessen?",
        action: () => { document.querySelector('input[placeholder*="Mahlzeit"], input[placeholder*="Was hast du"]')?.focus(); }
      };
    }
    // Bewegung fehlt nachmittags
    if (hour >= 16 && hour <= 19 && !hasWorkout && new Date().getDay() !== 0) {
      return {
        label:"Workout", icon:"🏋", hint:"Heute noch keine Bewegung — 20min reichen.",
        action: () => { document.querySelector('[data-section="workout"], [placeholder*="workout"], [placeholder*="Sport"]')?.scrollIntoView({behavior:"smooth", block:"center"}); }
      };
    }
    return null;
  })();

  return (
    <div>
      <Confetti show={konfetti} mode={konfettiMode} onDone={()=>setKonfetti(false)}/>
      {perfectDayOpen && (
        <PerfectDayModal
          profile={profile}
          log={log}
          tagKey={tagKey}
          onClose={()=>setPerfectDayOpen(false)}
        />
      )}
      {/* FLO – Zyklus-Status + Phase-Tipps (wenn aktiviert) */}
      {isToday && profile?.trackCycle && <FloCard profile={profile}/>}

      {/* HEUTE-ÜBERSICHT – Nudge + Anstehend + Abend-Story in EINER Karte */}
      {isToday && (() => {
        // 1) Nudge (Smart-Hint oder Direkt-Action)
        const hasNudge = !!(hint || nextAction);

        // 2) Anstehend – Termine + Heute-Todos
        const todayTodos = todos.filter(t => t.status==="open" && (t.priority||"today")==="today");
        const todayKey = isoDateKey(new Date());
        const todayDow = new Date().getDay();
        const allEv = [...(events||[]), ...localEvents];
        const todayEvents = allEv.filter(ev => {
          if (ev.date === todayKey) return true;
          if (ev.recurring === "daily" && ev.date && ev.date <= todayKey) return true;
          if (ev.recurring === "weekly" && ev.date) {
            const orig = new Date(ev.date);
            return orig.getDay() === todayDow && ev.date <= todayKey;
          }
          return false;
        }).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
        const hasAgenda = todayTodos.length > 0 || todayEvents.length > 0;

        // 3) Abend-Story (ab 21 Uhr)
        const hour = new Date().getHours();
        const isEvening = hour >= 21 || hour === 0;
        const eatenStory = (log.meals||[]).reduce((s,m)=>s+(m.calories||0),0);
        const waterL = ((log.water||0)*.25).toFixed(2);
        const workoutMin = (log.workouts||[]).reduce((s,w)=>s+(w.duration||0),0);
        const habitsArr = profile?.habits || [];
        const doneHabits = habitsArr.filter(h => log.habits?.[h.id]).length;
        const storyParts = [];
        if (log.meals?.length > 0) storyParts.push(`${log.meals.length} Mahlzeit${log.meals.length>1?"en":""} · ${eatenStory} kcal`);
        if (log.water > 0) storyParts.push(`${waterL}L Wasser`);
        if (workoutMin > 0) storyParts.push(`${workoutMin}min Bewegung`);
        if (doneHabits > 0) storyParts.push(`${doneHabits}/${habitsArr.length} Gewohnheiten`);
        const sleepNum = parseFloat(String(log.sleep||"").replace("+","")) || 0;
        const reflectionQ = !log.note
          ? (sleepNum >= 7 ? "Wie war heute?" : "Was nimmst du in den Schlaf mit?")
          : null;
        const hasStory = isEvening && storyParts.length > 0;

        if (!hasNudge && !hasAgenda && !hasStory) return null;

        const divider = { height:1, background:T.border, margin:"12px 0" };

        return (
          <Card style={{ marginBottom:14 }}>
            {/* Nudge */}
            {hasNudge && (
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                {nextAction && <span style={{ fontSize:18 }}>{nextAction.icon}</span>}
                {!nextAction && <span style={{ color:T.acc, fontSize:14 }}>✦</span>}
                <div style={{ flex:1, minWidth:0 }}>
                  <span style={{ color: nextAction ? T.text : T.mid, fontSize:12, fontFamily:T.serif, fontStyle:"italic" }}>
                    {nextAction ? nextAction.hint : hint}
                  </span>
                </div>
                {nextAction && (
                  <button onClick={nextAction.action} style={{
                    background:T.gold+"33", border:`1px solid ${T.gold}88`, borderRadius:18,
                    padding:"4px 11px", color:T.gold, fontFamily:T.mono, fontSize:10,
                    letterSpacing:1, cursor:"pointer", whiteSpace:"nowrap"
                  }}>{nextAction.label} →</button>
                )}
              </div>
            )}

            {/* Anstehend */}
            {hasAgenda && (
              <>
                {hasNudge && <div style={divider}/>}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                  <Lbl>ANSTEHEND</Lbl>
                  <span style={{ fontFamily:T.mono, fontSize:9, color:T.muted, letterSpacing:1 }}>
                    {todayEvents.length}T · {todayTodos.length}TODO
                  </span>
                </div>
                {todayEvents.length > 0 && (
                  <div style={{ marginBottom: todayTodos.length > 0 ? 10 : 0 }}>
                    {todayEvents.slice(0, 5).map((ev, i) => (
                      <div key={ev.id||i} style={{
                        display:"flex", alignItems:"center", gap:10, padding:"5px 0",
                        borderBottom: i < Math.min(4, todayEvents.length-1) ? `1px solid ${T.border}` : "none"
                      }}>
                        <span style={{ fontFamily:T.mono, fontSize:11, color:T.gold, minWidth:42 }}>
                          {ev.time || "–"}
                        </span>
                        <span style={{ flex:1, color:T.text, fontSize:13, fontFamily:T.serif }}>{ev.title}</span>
                        {ev.duration && <span style={{ fontFamily:T.mono, fontSize:9, color:T.muted }}>{ev.duration}min</span>}
                      </div>
                    ))}
                    {todayEvents.length > 5 && (
                      <div style={{ fontSize:10, color:T.muted, fontStyle:"italic", fontFamily:T.serif, marginTop:4 }}>
                        +{todayEvents.length-5} weitere Termine
                      </div>
                    )}
                  </div>
                )}
                {todayTodos.length > 0 && (
                  <div style={{
                    paddingTop: todayEvents.length > 0 ? 8 : 0,
                    borderTop: todayEvents.length > 0 ? `1px dashed ${T.border}` : "none"
                  }}>
                    {todayTodos.slice(0, 6).map((t, i) => (
                      <div key={t.id} style={{
                        display:"flex", alignItems:"center", gap:10, padding:"6px 0",
                        borderBottom: i < Math.min(5, todayTodos.length-1) ? `1px solid ${T.border}` : "none"
                      }}>
                        <button onClick={()=>{
                          const arr = loadTodos();
                          const idx = arr.findIndex(x => x.id === t.id);
                          if (idx >= 0) {
                            arr[idx] = {...arr[idx], status:"done", completedAt:new Date().toISOString()};
                            saveTodos(arr);
                            setTodos(arr);
                            window.dispatchEvent(new Event("eyla_todos_changed"));
                            haptic(15);
                          }
                        }} style={{
                          width:20, height:20, borderRadius:5,
                          border:`1.5px solid ${T.rose}88`, background:"transparent",
                          cursor:"pointer", padding:0, flexShrink:0
                        }}/>
                        <span style={{ flex:1, color:T.text, fontSize:13, fontFamily:T.serif }}>{t.text}</span>
                      </div>
                    ))}
                    {todayTodos.length > 6 && (
                      <div style={{ fontSize:10, color:T.muted, fontStyle:"italic", fontFamily:T.serif, marginTop:4 }}>
                        +{todayTodos.length-6} weitere offen
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Abend-Story */}
            {hasStory && (
              <>
                {(hasNudge || hasAgenda) && <div style={divider}/>}
                <Lbl color={T.gold} style={{ marginBottom:8 }}>🌙 HEUTE</Lbl>
                <div style={{ color:T.text, fontSize:13, fontFamily:T.serif, lineHeight:1.7 }}>
                  {storyParts.join(" · ")}.
                </div>
                {reflectionQ && (
                  <div style={{
                    marginTop:10, padding:"8px 12px",
                    background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:8,
                    color:T.mid, fontSize:12, fontFamily:T.serif, fontStyle:"italic"
                  }}>
                    ✦ {reflectionQ}
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })()}
      {/* Header + Datum-Navigation (zusammengefasst) */}
      <div style={{ marginBottom:18, display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
            <button onClick={prevDay} style={{
              background:"transparent", border:"none", color:T.muted,
              fontFamily:T.serif, fontSize:18, cursor:"pointer", lineHeight:1, padding:"0 2px"
            }}>‹</button>
            <Lbl style={{ margin:0 }}>
              {isToday ? "HEUTE" : isPast ? "RÜCKBLICK" : "VORAUS"} · {tagDate.toLocaleDateString("de-DE",{weekday:"short",day:"numeric",month:"short"})}
            </Lbl>
            <button onClick={nextDay} style={{
              background:"transparent", border:"none", color:T.muted,
              fontFamily:T.serif, fontSize:18, cursor:"pointer", lineHeight:1, padding:"0 2px"
            }}>›</button>
            {!isToday && (
              <button onClick={goToday} style={{
                background:T.acc+"18", border:`1px solid ${T.acc}44`, borderRadius:14,
                padding:"2px 10px", color:T.acc, fontFamily:T.mono, fontSize:9,
                cursor:"pointer", letterSpacing:1, marginLeft:2
              }}>↺ HEUTE</button>
            )}
          </div>
          <h2 style={{ fontSize:20, fontWeight:300, color:T.text, margin:0 }}>
            {isToday
              ? <>Wie geht's dir, <span style={{ color:T.acc }}>{profile.name.split(" ")[0]}</span>?</>
              : <span style={{ color:T.muted, fontStyle:"italic" }}>Nachtragen</span>}
          </h2>
        </div>
        <ActivityRings
          water={log.water||0} waterTarget={waterTargetUnits(profile)}
          sleep={parseFloat(String(log.sleep||"0").replace("+",""))||0} sleepTarget={sleepTargetH(profile)}
          kcal={eaten} kcalTarget={targetKcal}
          workouts={(log.workouts||[]).reduce((s,w)=>s+(w.duration||0),0)}
        />
      </div>

      {/* Energie & Schlaf */}
      <Card style={{ marginBottom:12 }}>
        <Lbl style={{ marginBottom:10 }}>Wie fühlst du dich?</Lbl>
        <div style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:16 }}>
          {energyOpts.map(e=>(
            <button key={e} onClick={()=>setLog(l=>({...l,energy:e}))} style={{
              background:log.energy===e?T.acc+"22":"transparent",
              border:`1px solid ${log.energy===e?T.acc:T.borderS}`,
              borderRadius:20, padding:"7px 14px", color:log.energy===e?T.text:T.muted,
              fontFamily:T.serif, fontSize:12, cursor:"pointer", transition:"all .2s"
            }}>{e}</button>
          ))}
        </div>
        <Lbl style={{ marginBottom:8 }}>Schlaf letzte Nacht</Lbl>
        <div style={{ display:"flex", gap:7 }}>
          {["4","5","6","7","8","9+"].map(s=>(
            <button key={s} onClick={()=>setLog(l=>({...l,sleep:s}))} style={{
              background:log.sleep===s?T.acc+"22":T.bg2,
              border:`1px solid ${log.sleep===s?T.acc:T.borderS}`,
              borderRadius:8, padding:"7px 14px", color:log.sleep===s?T.text:T.muted,
              fontFamily:T.mono, fontSize:12, cursor:"pointer", transition:"all .2s"
            }}>{s}h</button>
          ))}
        </div>
      </Card>

      {/* Wasser + Gewicht */}
      <div style={{ display:"grid", gridTemplateColumns:"1.5fr 1fr", gap:12, marginBottom:12 }}>
        <Card style={{ padding:"14px 16px" }}>
          <Lbl style={{ marginBottom:5 }}>Wasser</Lbl>
          <div style={{ fontSize:22, fontWeight:300, color:T.text, marginBottom:8 }}>
            {(log.water*.25).toFixed(2)}<span style={{ fontSize:13, color:T.muted, marginLeft:3 }}>L</span>
            <span style={{ fontSize:10, color:T.muted, marginLeft:8, fontFamily:T.mono }}>von {waterTargetL(profile)}L</span>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button onClick={()=>setLog(l=>({...l,water:Math.max(0,l.water-1)}))} style={{ width:30,height:30,borderRadius:"50%",background:T.bg2,border:`1px solid ${T.borderS}`,color:T.muted,fontSize:16,cursor:"pointer" }}>−</button>
            <div style={{ display:"flex", gap:2, flex:1 }}>
              {Array.from({length:8}).map((_,i)=>(
                <div key={i} style={{ flex:1, height:22, borderRadius:3,
                  background:i<log.water?`linear-gradient(${T.dim},${T.acc})`:T.bg2,
                  border:`1px solid ${T.borderS}`,transition:"background .2s" }}/>
              ))}
            </div>
            <button onClick={()=>setLog(l=>({...l,water:Math.min(12,l.water+1)}))} style={{ width:30,height:30,borderRadius:"50%",background:T.acc+"22",border:`1px solid ${T.acc}`,color:T.acc,fontSize:16,cursor:"pointer" }}>+</button>
          </div>
        </Card>
        <Card style={{ padding:"14px 16px" }}>
          <Lbl style={{ marginBottom:5 }}>Gewicht</Lbl>
          <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
            <input
              type="number"
              step="0.1"
              value={log.weight||""}
              onChange={e=>setLog(l=>({...l, weight: e.target.value === "" ? null : parseFloat(e.target.value)}))}
              placeholder={profile.weight}
              style={{
                width:"100%",
                background:"transparent", border:"none",
                color: log.weight ? T.text : T.muted,
                fontFamily: T.mono, fontSize: 22, fontWeight: 300,
                outline:"none", padding:0, minWidth:0
              }}
            />
            <span style={{ fontSize:11, color:T.muted, fontFamily:T.mono }}>kg</span>
          </div>
          {log.weight && profile.weight && (
            <div style={{ fontSize:10, color: log.weight < parseFloat(profile.weight) ? T.green : log.weight > parseFloat(profile.weight) ? T.gold : T.muted, fontFamily:T.mono, marginTop:4 }}>
              {(log.weight - parseFloat(profile.weight)).toFixed(1) > 0 ? "+" : ""}{(log.weight - parseFloat(profile.weight)).toFixed(1)}kg vs. Start
            </div>
          )}
          {!log.weight && (
            <div style={{ fontSize:10, color:T.muted, fontStyle:"italic", marginTop:4, fontFamily:T.serif }}>
              Heute morgens gewogen?
            </div>
          )}
        </Card>
      </div>

      {/* Training */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div>
            <Lbl style={{ marginBottom:5 }}>Training heute</Lbl>
            <div style={{ fontSize:18, fontWeight:300, color:T.text }}>
              {(log.workouts||[]).length === 0
                ? <span style={{ color:T.muted, fontStyle:"italic", fontSize:13, fontFamily:T.serif }}>Noch nichts</span>
                : <>{(log.workouts||[]).reduce((s,w)=>s+(w.duration||0),0)} <span style={{ fontSize:12, color:T.muted }}>min</span></>}
            </div>
          </div>
        </div>
        {/* Quick-Add Buttons */}
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:(log.workouts||[]).length>0?10:0 }}>
          {[
            { type:"EMS",           duration:20, icon:"⚡" },
            { type:"Beweglichkeit", duration:30, icon:"🧘" },
            { type:"Cardio",        duration:30, icon:"🏃" },
            { type:"Gehen",         duration:45, icon:"🚶" },
          ].map(opt => (
            <button key={opt.type} onClick={()=>{ setLog(l=>({...l, workouts:[...(l.workouts||[]), {
              id:Date.now(), type:opt.type, duration:opt.duration,
              time:new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})
            }]})); if (isToday) awardPoints("ems_training"); }} style={{
              background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:18,
              padding:"5px 12px", color:T.muted, fontFamily:T.serif, fontSize:12,
              fontStyle:"italic", cursor:"pointer", transition:"all .2s",
              display:"flex", alignItems:"center", gap:5
            }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=T.acc; e.currentTarget.style.color=T.text;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=T.borderS; e.currentTarget.style.color=T.muted;}}>
              <span>{opt.icon}</span><span>{opt.type}</span><span style={{ fontFamily:T.mono, fontSize:10, color:T.muted, marginLeft:2 }}>{opt.duration}min</span>
            </button>
          ))}
        </div>

        {/* Liste */}
        {(log.workouts||[]).length > 0 && (
          <div>
            {(log.workouts||[]).map(w => (
              <div key={w.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${T.border}` }}>
                <div style={{ color:T.text, fontSize:13 }}>{w.type}</div>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ color:T.mid, fontFamily:T.mono, fontSize:12 }}>{w.duration||0}<span style={{ color:T.muted, marginLeft:2 }}>min</span></div>
                  <div style={{ color:T.muted, fontFamily:T.mono, fontSize:10 }}>{w.time}</div>
                  <button onClick={()=>setLog(l=>({...l, workouts:(l.workouts||[]).filter(x=>x.id!==w.id)}))} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:15, padding:2 }}>×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Mahlzeiten */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
          <div>
            <Lbl style={{ marginBottom:5 }}>Mahlzeiten heute</Lbl>
            <div style={{ fontSize:22, fontWeight:300, color:T.text }}>{eaten}
              <span style={{ fontSize:12, color:T.muted, marginLeft:6 }}>
                von {targetKcal} kcal
                {ct.dailyDelta < 0 && <span style={{ color:T.green, marginLeft:4 }}>↓</span>}
                {ct.dailyDelta > 0 && <span style={{ color:T.gold,  marginLeft:4 }}>↑</span>}
              </span>
            </div>
            {/* Daily Makros */}
            {(eatenP > 0 || eatenC > 0 || eatenF > 0 || log.meals.length > 0) && (
              <div style={{ display:"flex", gap:10, marginTop:6, fontFamily:T.mono, fontSize:10 }}>
                <span style={{ color:eatenP >= mt.protein ? T.green : T.rose }}>P {eatenP}<span style={{ color:T.muted }}>/{mt.protein}</span></span>
                <span style={{ color:T.gold }}>C {eatenC}<span style={{ color:T.muted }}>/{mt.carbs}</span></span>
                <span style={{ color:T.green }}>F {eatenF}<span style={{ color:T.muted }}>/{mt.fat}</span></span>
              </div>
            )}
          </div>
          <div style={{ width:48,height:48,borderRadius:"50%",
            background:`conic-gradient(${T.acc} ${Math.min(100,Math.round(eaten/targetKcal*100))}%,${T.bg2} 0)`,
            display:"flex",alignItems:"center",justifyContent:"center" }}>
            <div style={{ width:36,height:36,borderRadius:"50%",background:T.card,
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:10,color:T.muted,fontFamily:T.mono }}>
              {Math.min(100,Math.round(eaten/targetKcal*100))}%
            </div>
          </div>
        </div>

        {/* Input */}
        <div style={{ background:T.bg2, borderRadius:10, padding:12, marginBottom:12 }}>
          {/* Hidden file input für Foto */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFile}
            style={{ display:"none" }}
          />

          {/* Foto-Vorschau wenn vorhanden */}
          {photoData && (
            <div style={{
              display:"flex", gap:10, marginBottom:10, padding:8,
              background:T.bg, borderRadius:8, border:`1px solid ${T.acc}33`,
              animation:"fadeUp .3s ease both"
            }}>
              <img src={photoData.dataUrl} alt="Mahlzeit" style={{
                width:60, height:60, objectFit:"cover", borderRadius:6,
                border:`1px solid ${T.borderS}`, flexShrink:0
              }}/>
              <div style={{ flex:1, minWidth:0 }}>
                {analyzing ? (
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <Waveform/>
                    <span style={{ color:T.acc, fontFamily:T.mono, fontSize:10, letterSpacing:1 }}>EYLA SCHAUT …</span>
                  </div>
                ) : analysisError ? (
                  <div style={{ color:T.red, fontSize:12, fontFamily:T.serif, fontStyle:"italic" }}>{analysisError}</div>
                ) : (
                  <div style={{ color:T.mid, fontSize:11, fontFamily:T.serif, fontStyle:"italic" }}>
                    EYLA hat geschätzt – kannst du noch anpassen unten.
                  </div>
                )}
              </div>
              <button onClick={clearPhoto} style={{
                background:"none", border:"none", color:T.muted, cursor:"pointer",
                fontSize:18, padding:"0 4px", alignSelf:"flex-start"
              }} title="Foto verwerfen">×</button>
            </div>
          )}

          {/* Favoriten + Häufig */}
          {!photoData && (favorites.length > 0 || recentMeals.length > 0) && (
            <div style={{ marginBottom:10 }}>
              {favorites.length > 0 && (
                <>
                  <Lbl style={{ marginBottom:6, fontSize:10 }}>★ FAVORITEN</Lbl>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
                    {favorites.slice(0, 6).map((f, i) => (
                      <button key={i} onClick={()=>quickAddMeal({ name:f.name, calories:0, protein:0, carbs:0, fat:0 })} style={{
                        background:T.gold+"10", border:`1px solid ${T.gold}33`, borderRadius:18,
                        padding:"4px 10px", color:T.gold, fontFamily:T.serif, fontSize:11,
                        fontStyle:"italic", cursor:"pointer", transition:"all .2s",
                        display:"flex", alignItems:"center", gap:5
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.background=T.gold+"22";}}
                      onMouseLeave={e=>{e.currentTarget.style.background=T.gold+"10";}}>
                        <span style={{ fontSize:9 }}>★</span>
                        <span style={{ maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {recentMeals.length > 0 && (
                <>
                  <Lbl style={{ marginBottom:6, fontSize:10 }}>HÄUFIG</Lbl>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {recentMeals.map((m, i) => (
                      <button key={i} onClick={()=>quickAddMeal(m)} style={{
                        background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:18,
                        padding:"4px 10px", color:T.muted, fontFamily:T.serif, fontSize:11,
                        fontStyle:"italic", cursor:"pointer", transition:"all .2s",
                        display:"flex", alignItems:"center", gap:5
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=T.acc; e.currentTarget.style.color=T.text;}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=T.borderS; e.currentTarget.style.color=T.muted;}}>
                        <span style={{ maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.name}</span>
                        {m.calories>0 && <span style={{ fontFamily:T.mono, fontSize:9, color:T.muted }}>{m.calories}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            <input value={mealName} onChange={e=>setMealName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMeal()}
              placeholder={photoData ? "EYLA hat geschätzt – ändern?" : "Was hast du gegessen?"}
              style={{ flex:1,background:"transparent",border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 12px",color:T.text,fontFamily:T.serif,fontSize:13,fontStyle:"italic",outline:"none" }}/>
            <input value={mealCal} onChange={e=>setMealCal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMeal()}
              placeholder="kcal" type="number" style={{ width:70,background:"transparent",border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 10px",color:T.text,fontFamily:T.mono,fontSize:13,outline:"none" }}/>
          </div>

          {/* Makros (optional, expandierbar) */}
          {showMacros ? (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:8, animation:"fadeUp .2s ease both" }}>
              {[["P","mealP",mealP,setMealP,T.rose],["C","mealC",mealC,setMealC,T.gold],["F","mealF",mealF,setMealF,T.green]].map(([lbl,k,v,setter,col]) => (
                <div key={k} style={{ display:"flex", alignItems:"center", background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:8, padding:"6px 10px", gap:6 }}>
                  <span style={{ color:col, fontFamily:T.mono, fontSize:11, fontWeight:700 }}>{lbl}</span>
                  <input value={v} onChange={e=>setter(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMeal()}
                    placeholder="g" type="number" style={{ flex:1, background:"transparent", border:"none", color:T.text, fontFamily:T.mono, fontSize:12, outline:"none", minWidth:0, width:"100%" }}/>
                </div>
              ))}
            </div>
          ) : (
            <button onClick={()=>setShowMacros(true)} style={{
              background:"transparent", border:"none", color:T.muted,
              fontFamily:T.serif, fontSize:11, fontStyle:"italic", cursor:"pointer",
              padding:"0 0 8px", textDecoration:"underline dotted"
            }}>+ Makros (P / C / F)</button>
          )}
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button onClick={()=>fileInputRef.current?.click()} disabled={analyzing} style={{
              width:40, height:40, borderRadius:10, flexShrink:0,
              border:`1px solid ${photoData?T.acc:T.borderS}`,
              background: photoData ? T.acc+"22" : T.bg2,
              color: photoData ? T.acc : T.muted,
              fontSize:17, cursor:analyzing?"default":"pointer", transition:"all .2s",
              display:"flex", alignItems:"center", justifyContent:"center",
              opacity: analyzing ? 0.5 : 1
            }} title="Foto aufnehmen / hochladen">📷</button>
            {!photoData && (
              <span style={{ color:T.muted,fontSize:10,fontStyle:"italic",fontFamily:T.serif,alignSelf:"center" }}>
                tippen oder fotografieren
              </span>
            )}
            <button onClick={addMeal} disabled={!mealName.trim()} style={{
              marginLeft:"auto",
              background: mealName.trim() ? `linear-gradient(135deg,${T.dim},${T.acc})` : T.bg2,
              border:"none", borderRadius:8, padding:"0 18px",
              color: mealName.trim() ? T.bg : T.muted,
              fontSize:18, cursor: mealName.trim() ? "pointer" : "default", fontWeight:700
            }}>+</button>
          </div>
        </div>

        {log.meals.length===0
          ? <div style={{ textAlign:"center", padding:"14px 6px" }}>
              <p style={{ color:T.mid, fontStyle:"italic", fontSize:13, fontFamily:T.serif, margin:"0 0 4px" }}>
                Noch nichts gegessen heute.
              </p>
              <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, margin:0 }}>
                Tippen oder Foto vom Teller.
              </p>
            </div>
          : log.meals.map(m=>(
            <MealRow key={m.id} meal={m}
              onEdit={(updated)=>setLog(l=>({...l, meals: l.meals.map(x=>x.id===m.id?{...x,...updated}:x)}))}
              onDelete={()=>setLog(l=>({...l,meals:l.meals.filter(x=>x.id!==m.id)}))}
              onDuplicate={()=>setLog(l=>({...l, meals: [...l.meals, {
                ...m,
                id: Date.now(),
                time: new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})
              }]}))}
            />
          ))
        }
      </Card>

      {/* Habits */}
      {Array.isArray(profile.habits) && profile.habits.length > 0 && (
        <Card style={{ marginTop:12 }}>
          <Lbl style={{ marginBottom:10 }}>Gewohnheiten</Lbl>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {profile.habits.map(h => {
              const done = !!(log.habits && log.habits[h.id]);
              return (
                <button key={h.id} onClick={()=>setLog(l=>({
                  ...l,
                  habits: { ...(l.habits||{}), [h.id]: !done }
                }))} style={{
                  background: done ? T.acc+"22" : "transparent",
                  border:`1px solid ${done ? T.acc : T.borderS}`,
                  borderRadius:20, padding:"7px 12px",
                  color: done ? T.text : T.muted,
                  fontFamily:T.serif, fontSize:13, cursor:"pointer",
                  fontStyle: done ? "normal" : "italic",
                  display:"flex", alignItems:"center", gap:6,
                  transition:"all .2s"
                }}>
                  <span style={{ fontSize:13 }}>{done ? "✓" : h.emoji}</span>
                  <span>{h.name}</span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Journal / Tagebuch */}
      <Card style={{ marginTop:12 }}>
        <Lbl style={{ marginBottom:10 }}>Notiz zum Tag</Lbl>
        <textarea
          value={log.note || ""}
          onChange={e=>setLog(l=>({...l, note: e.target.value}))}
          placeholder="Wie war dein Tag? Was lief? Was nicht?"
          rows={2}
          style={{
            width:"100%", background:T.bg2,
            border:`1px solid ${T.borderS}`, borderRadius:8,
            padding:"10px 12px", color:T.text,
            fontFamily:T.serif, fontSize:13, fontStyle:"italic",
            outline:"none", boxSizing:"border-box", resize:"vertical",
            minHeight:60, lineHeight:1.6
          }}
        />
        {log.note && (
          <div style={{ fontSize:10, color:T.muted, fontFamily:T.mono, marginTop:4, textAlign:"right" }}>
            {log.note.length} Zeichen
          </div>
        )}
      </Card>
    </div>
  );
}

// Einzelne Mahlzeit-Zeile mit Tap-to-Edit (Name, kcal, Makros)
function MealRow({ meal, onEdit, onDelete, onDuplicate }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(meal.name);
  const [cal, setCal] = useState(String(meal.calories || ""));
  const [p, setP] = useState(String(meal.protein || ""));
  const [c, setC] = useState(String(meal.carbs || ""));
  const [f, setF] = useState(String(meal.fat || ""));

  // ── Swipe-to-delete State ────────────────────────────────────────────────────
  const [swipeX, setSwipeX] = useState(0);          // aktueller Offset während Swipe
  const [swiping, setSwiping] = useState(false);    // sind wir gerade dran zu swipen?
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const isHorizontalRef = useRef(null);             // wird auf true/false gesetzt nach ersten 8px
  const SWIPE_THRESHOLD = 90;                       // pixel ab denen geloescht wird

  function handleTouchStart(e) {
    if (editing) return;
    const t = e.touches[0];
    touchStartXRef.current = t.clientX;
    touchStartYRef.current = t.clientY;
    isHorizontalRef.current = null;
    setSwiping(true);
  }
  function handleTouchMove(e) {
    if (editing || !swiping) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartXRef.current;
    const dy = t.clientY - touchStartYRef.current;
    // Entscheide nach ersten Bewegungen ob horizontal oder vertikal
    if (isHorizontalRef.current === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        isHorizontalRef.current = Math.abs(dx) > Math.abs(dy);
      } else {
        return;
      }
    }
    if (!isHorizontalRef.current) return;
    // Nur Links-Swipe darstellen
    if (dx < 0) {
      setSwipeX(Math.max(-180, dx));
      // verhindere Scrollen waehrend horizontaler Swipe
      if (e.cancelable) e.preventDefault();
    } else {
      setSwipeX(0);
    }
  }
  function handleTouchEnd() {
    setSwiping(false);
    if (swipeX < -SWIPE_THRESHOLD) {
      // Wegswipen → bis Rand animieren und dann löschen
      setSwipeX(-400);
      try { navigator.vibrate?.(20); } catch {}
      setTimeout(()=>{ onDelete(); }, 180);
    } else {
      // Zurück snappen
      setSwipeX(0);
    }
    isHorizontalRef.current = null;
  }

  function save() {
    if (!name.trim()) return;
    onEdit({
      name: name.trim(),
      calories: parseInt(cal) || 0,
      protein: parseInt(p) || 0,
      carbs: parseInt(c) || 0,
      fat: parseInt(f) || 0
    });
    setEditing(false);
  }
  function cancel() {
    setName(meal.name); setCal(String(meal.calories || ""));
    setP(String(meal.protein || "")); setC(String(meal.carbs || "")); setF(String(meal.fat || ""));
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ padding:"8px 0", borderBottom:`1px solid ${T.border}`, animation:"fadeUp .2s ease both" }}>
        <div style={{ display:"flex", gap:6, marginBottom:6 }}>
          <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}
            autoFocus style={{ flex:1, background:T.bg, border:`1px solid ${T.acc}55`, borderRadius:6, padding:"6px 10px", color:T.text, fontFamily:T.serif, fontSize:13, fontStyle:"italic", outline:"none" }}/>
          <input value={cal} onChange={e=>setCal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}
            type="number" placeholder="kcal" style={{ width:70, background:T.bg, border:`1px solid ${T.acc}55`, borderRadius:6, padding:"6px 8px", color:T.text, fontFamily:T.mono, fontSize:12, outline:"none" }}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:6 }}>
          {[
            ["P", p, setP, T.rose],
            ["C", c, setC, T.gold],
            ["F", f, setF, T.green],
          ].map(([lbl, val, setter, col]) => (
            <div key={lbl} style={{ display:"flex", alignItems:"center", gap:5, background:T.bg, border:`1px solid ${T.borderS}`, borderRadius:6, padding:"4px 8px" }}>
              <span style={{ color:col, fontFamily:T.mono, fontSize:10, fontWeight:700 }}>{lbl}</span>
              <input value={val} onChange={e=>setter(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}
                type="number" placeholder="g" style={{ flex:1, background:"transparent", border:"none", color:T.text, fontFamily:T.mono, fontSize:11, outline:"none", minWidth:0, width:"100%" }}/>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={save} style={{ background:`linear-gradient(135deg,${T.dim},${T.acc})`, border:"none", borderRadius:6, padding:"4px 14px", color:T.bg, fontFamily:T.serif, fontSize:11, fontWeight:700, cursor:"pointer" }}>Speichern</button>
          <button onClick={cancel} style={{ background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:6, padding:"4px 12px", color:T.muted, fontFamily:T.serif, fontSize:11, cursor:"pointer", fontStyle:"italic" }}>Abbrechen</button>
          <button onClick={onDelete} style={{ marginLeft:"auto", background:"transparent", border:`1px solid ${T.red}33`, borderRadius:6, padding:"4px 12px", color:T.red, fontFamily:T.mono, fontSize:10, cursor:"pointer", letterSpacing:1 }}>LÖSCHEN</button>
        </div>
      </div>
    );
  }

  const hasMacros = (meal.protein || meal.carbs || meal.fat);
  // Stärke der Lösch-Anzeige skaliert mit Swipe-Distanz
  const swipeProgress = Math.min(1, Math.abs(swipeX) / SWIPE_THRESHOLD);
  return (
    <div style={{
      position:"relative", overflow:"hidden", borderBottom:`1px solid ${T.border}`
    }}>
      {/* Lösch-Hintergrund (sichtbar wenn nach links geswiped) */}
      <div style={{
        position:"absolute", top:0, right:0, bottom:0,
        width:"100%", display:"flex", alignItems:"center", justifyContent:"flex-end",
        paddingRight:18,
        background:`linear-gradient(90deg, transparent 0%, ${T.red}${swipeProgress >= 1 ? "33" : "22"} 50%, ${T.red}${swipeProgress >= 1 ? "44" : "22"} 100%)`,
        opacity: Math.abs(swipeX) > 4 ? 1 : 0,
        transition: swiping ? "none" : "opacity .15s",
        pointerEvents:"none"
      }}>
        <span style={{
          fontFamily:T.mono, fontSize:11, color:T.red, letterSpacing:2,
          fontWeight: swipeProgress >= 1 ? 700 : 400
        }}>
          {swipeProgress >= 1 ? "↞ LOSLASSEN" : "← LÖSCHEN"}
        </span>
      </div>

      {/* Mahlzeit-Row (verschiebt sich beim Swipe) */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={()=>{ if (Math.abs(swipeX) < 4) setEditing(true); }}
        style={{
          display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"8px 0", cursor:"pointer",
          background: T.bg,
          transform: `translateX(${swipeX}px)`,
          transition: swiping ? "none" : "transform .2s cubic-bezier(.2,.8,.2,1)",
          touchAction: isHorizontalRef.current ? "pan-y" : "auto",
        }}
        onMouseEnter={e=>e.currentTarget.style.background=T.acc+"06"}
        onMouseLeave={e=>e.currentTarget.style.background=T.bg}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:T.text, fontSize:13 }}>{meal.name}</div>
          {hasMacros && (
            <div style={{ display:"flex", gap:8, marginTop:2, fontFamily:T.mono, fontSize:9 }}>
              {meal.protein > 0 && <span style={{ color:T.rose }}>P {meal.protein}g</span>}
              {meal.carbs   > 0 && <span style={{ color:T.gold }}>C {meal.carbs}g</span>}
              {meal.fat     > 0 && <span style={{ color:T.green }}>F {meal.fat}g</span>}
            </div>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {meal.calories>0 && <div style={{ color:T.acc, fontFamily:T.mono, fontSize:12 }}>{meal.calories}</div>}
          <div style={{ color:T.muted, fontFamily:T.mono, fontSize:10 }}>{meal.time}</div>
          {onDuplicate && (
            <button onClick={(e)=>{ e.stopPropagation(); onDuplicate(); }}
              title="Nochmal eintragen"
              style={{ background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:6,
                padding:"2px 7px", color:T.muted, fontFamily:T.mono, fontSize:11, cursor:"pointer", lineHeight:1 }}
            >+1</button>
          )}
          {/* Desktop-Lösch-Knopf (mobile macht Swipe) */}
          <button onClick={(e)=>{ e.stopPropagation(); onDelete(); }}
            title="Löschen"
            style={{ background:"transparent", border:`1px solid ${T.red}33`, borderRadius:6,
              padding:"2px 7px", color:T.red+"99", fontFamily:T.mono, fontSize:11, cursor:"pointer",
              lineHeight:1, opacity:.7 }}
            onMouseEnter={e=>e.currentTarget.style.opacity=1}
            onMouseLeave={e=>e.currentTarget.style.opacity=.7}
          >×</button>
        </div>
      </div>
    </div>
  );
}

// ─── SMART-CALENDAR HELPERS ───────────────────────────────────────────────────
// Flexibler Duration-Parser: akzeptiert Number, "240", "4h", "30min", "1h 30min", "1.5h"
// Returns: Minuten als Integer. Fallback: 60.
function parseDurationFlexible(input) {
  if (input === null || input === undefined || input === "") return 60;
  if (typeof input === "number" && isFinite(input)) return Math.max(0, Math.round(input));
  const s = String(input).trim().toLowerCase().replace(",", ".");
  if (!s) return 60;
  // Pures "240" / "1.5"
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    // Heuristik: wenn < 24 → wahrscheinlich Stunden, sonst Minuten
    return n <= 12 ? Math.round(n * 60) : Math.round(n);
  }
  // "1h 30min", "1h30", "90min", "2h"
  let total = 0;
  const hMatch = s.match(/(\d+(?:\.\d+)?)\s*h(our|r)?/);
  if (hMatch) total += parseFloat(hMatch[1]) * 60;
  const mMatch = s.match(/(\d+)\s*(min|m)\b/);
  if (mMatch) total += parseInt(mMatch[1]);
  // Spezifisch "1h30" ohne min-suffix
  const combined = s.match(/(\d+)h(\d+)/);
  if (combined && !mMatch) total = parseInt(combined[1]) * 60 + parseInt(combined[2]);
  return total > 0 ? Math.round(total) : 60;
}

// Smart-Duration aus Titel ableiten – sodass EYLA und User nicht jedes Mal
// die Dauer eintragen müssen wenn klar ist worum es geht.
function smartDurationFromTitle(title) {
  const t = String(title||"").toLowerCase();
  // Quick patterns
  if (/\b(call|meeting|standup|sync|kurz|short|quick|1on1|11)\b/.test(t)) return 30;
  if (/\b(kaffee|coffee|tea|tee)\b/.test(t)) return 30;
  if (/\b(lunch|essen|mittag|dinner|abendessen|brunch|fr[uü]hst[uü]ck|breakfast)\b/.test(t)) return 60;
  if (/\b(yoga|stretching|beweglichkeit|mobility)\b/.test(t)) return 60;
  if (/\b(sport|workout|training|gym|run|laufen|cardio|kraft|schwimmen)\b/.test(t)) return 60;
  if (/\b(deep|focus|fokus|coding|programming|writing|schreiben)\b/.test(t)) return 90;
  if (/\b(workshop|seminar|kurs|vortrag|talk)\b/.test(t)) return 120;
  if (/\b(arzt|doktor|therapie|massage|friseur)\b/.test(t)) return 45;
  return 60; // Default
}

// Travel-Time/Vorbereitung aus Titel ableiten (z.B. Termin außer Haus brauchen Fahrt)
function smartTravelFromTitle(title) {
  const t = String(title||"").toLowerCase();
  if (/\b(arzt|doktor|friseur|massage|therapie|treffen|außer|haus|stadt|büro|office)\b/.test(t)) return 20;
  if (/\b(lunch|essen|dinner|abendessen) (mit|with)\b/.test(t)) return 15;
  return 0;
}

// Konflikt-Detection: prüft ob ein neuer Termin mit existierenden überlappt
function detectConflicts(newEv, allEvents) {
  if (!newEv.time || !newEv.duration) return [];
  const [h, m] = newEv.time.split(":").map(n => parseInt(n)||0);
  const newStart = h*60 + m;
  const newEnd = newStart + parseDurationFlexible(newEv.duration);
  return allEvents.filter(ev => {
    if (!ev.time || !ev.date) return false;
    if (ev.date !== newEv.date) return false;
    if (ev.id === newEv.id) return false; // gleicher Termin
    const [eh, em] = ev.time.split(":").map(n => parseInt(n)||0);
    const evStart = eh*60 + em;
    const evEnd = evStart + parseDurationFlexible(ev.duration);
    return newStart < evEnd && newEnd > evStart;
  });
}

// Free-Slot-Detection: findet freie Lücken zwischen Terminen für einen Tag
// rangeStart/End in Minuten (z.B. 6*60 bis 22*60). Min-Length in Minuten.
function findFreeSlots(events, dayKey, rangeStart = 7*60, rangeEnd = 22*60, minLen = 30) {
  const dayEvents = events
    .filter(e => e.date === dayKey && e.time)
    .map(e => {
      const [h, m] = e.time.split(":").map(n => parseInt(n)||0);
      const start = h*60 + m;
      const dur = parseDurationFlexible(e.duration);
      return { start, end: start + dur };
    })
    .sort((a, b) => a.start - b.start);

  const slots = [];
  let cursor = rangeStart;
  for (const ev of dayEvents) {
    if (ev.start > cursor && ev.start - cursor >= minLen) {
      slots.push({ start: cursor, end: ev.start, duration: ev.start - cursor });
    }
    cursor = Math.max(cursor, ev.end);
  }
  if (rangeEnd > cursor && rangeEnd - cursor >= minLen) {
    slots.push({ start: cursor, end: rangeEnd, duration: rangeEnd - cursor });
  }
  return slots;
}
function minToHHMM(min) {
  const h = Math.floor(min/60);
  const m = min % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

// Day-Timeline – visuelle vertikale Zeitleiste eines Tages
// Stunden 6-22 default. Termine als positionierte Blöcke. Jetzt-Linie wenn heute.
function DayTimeline({ events, dayKey, isToday, onSlotClick, onEventClick, freeSlots = [], conflictsById = {} }) {
  const HOUR_START = 6;
  const HOUR_END = 23;
  const HOUR_HEIGHT = 38; // px pro Stunde
  const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
  const nowMin = new Date().getHours()*60 + new Date().getMinutes();
  const nowY = (nowMin - HOUR_START*60) * (HOUR_HEIGHT/60);
  const showNowLine = isToday && nowY >= 0 && nowY <= TOTAL_HEIGHT;

  // Events mit Zeit für diesen Tag filtern + positionieren
  const positioned = events
    .filter(e => e.date === dayKey && e.time)
    .map(e => {
      const [h, m] = e.time.split(":").map(n => parseInt(n)||0);
      const startMin = h*60 + m;
      const dur = parseDurationFlexible(e.duration);
      const top = (startMin - HOUR_START*60) * (HOUR_HEIGHT/60);
      const height = Math.max(22, dur * (HOUR_HEIGHT/60));
      const travel = parseInt(e.travelTime) || 0;
      const travelHeight = travel > 0 ? travel * (HOUR_HEIGHT/60) : 0;
      const travelTop = top - travelHeight;
      return { ev:e, top, height, travelTop, travelHeight, startMin };
    })
    .filter(p => p.top + p.height >= 0 && p.top <= TOTAL_HEIGHT);

  // Stunden-Labels
  const hours = [];
  for (let h = HOUR_START; h <= HOUR_END; h++) hours.push(h);

  return (
    <div style={{
      position:"relative", height: TOTAL_HEIGHT, marginLeft:38, marginRight:4,
      borderLeft:`1px solid ${T.borderS}`,
    }}>
      {/* Hour-Grid + Labels */}
      {hours.map(h => {
        const y = (h - HOUR_START) * HOUR_HEIGHT;
        return (
          <Fragment key={h}>
            <div style={{
              position:"absolute", left:-38, top: y - 6,
              fontFamily:T.mono, fontSize:9, color:T.muted, width:34,
              textAlign:"right", paddingRight:6, letterSpacing:.5
            }}>{String(h).padStart(2,"0")}</div>
            <div style={{
              position:"absolute", left:0, right:0, top:y, height:1,
              background: h%6===0 ? T.borderS : T.border, opacity: h%6===0 ? .7 : .35
            }}/>
          </Fragment>
        );
      })}

      {/* Free Slots subtil markieren */}
      {freeSlots.map((slot, i) => {
        const top = (slot.start - HOUR_START*60) * (HOUR_HEIGHT/60);
        const height = slot.duration * (HOUR_HEIGHT/60);
        if (height < 24) return null;
        return (
          <button key={`slot-${i}`} onClick={()=>onSlotClick?.(slot)} style={{
            position:"absolute", left:6, right:6, top, height,
            background: `repeating-linear-gradient(45deg, transparent 0 6px, ${T.acc}06 6px 12px)`,
            border:`1px dashed ${T.acc}33`, borderRadius:6, cursor:"pointer",
            padding:"4px 8px", textAlign:"left", overflow:"hidden",
            display:"flex", alignItems:"center", gap:6
          }}
          title={`${minToHHMM(slot.start)} – ${minToHHMM(slot.end)} · ${slot.duration}min frei`}>
            <span style={{ fontFamily:T.mono, fontSize:9, color:T.acc+"AA", opacity:.7 }}>
              {slot.duration >= 60 ? `${Math.floor(slot.duration/60)}h${slot.duration%60?` ${slot.duration%60}m`:''}` : `${slot.duration}min`} frei
            </span>
          </button>
        );
      })}

      {/* Termine */}
      {positioned.map(({ ev, top, height, travelTop, travelHeight }) => {
        const isGoogle = ev.google || ev.source === "google";
        const isLocal = ev.local || !ev.source;
        const baseCol = isGoogle ? T.acc : T.gold;
        const hasConflict = !!conflictsById[ev.id];
        return (
          <Fragment key={ev.id || `${ev.title}-${ev.time}`}>
            {/* Travel-Time (schraffiert davor) */}
            {travelHeight > 0 && (
              <div style={{
                position:"absolute", left:6, right:6, top:travelTop, height:travelHeight,
                background: `repeating-linear-gradient(45deg, ${baseCol}11 0 4px, transparent 4px 8px)`,
                borderRadius:6, pointerEvents:"none"
              }} title={`Vorbereitung/Fahrt ${ev.travelTime}min`}/>
            )}
            <button onClick={()=>onEventClick?.(ev)} style={{
              position:"absolute", left:6, right:6, top, height: Math.max(22, height),
              background: baseCol+"22",
              border:`1px solid ${hasConflict ? T.red : baseCol+"99"}`,
              borderLeft: `3px solid ${hasConflict ? T.red : baseCol}`,
              borderRadius:6, padding:"3px 8px", cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"flex-start", justifyContent:"center",
              overflow:"hidden", textAlign:"left"
            }}>
              <div style={{
                fontFamily:T.serif, fontSize:12, color:T.text, fontWeight:500,
                width:"100%", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"
              }}>{ev.title}</div>
              {height >= 36 && (
                <div style={{ fontFamily:T.mono, fontSize:9, color:T.muted, marginTop:2, display:"flex", gap:6, alignItems:"center" }}>
                  <span>{ev.time}{ev.duration?` · ${ev.duration}min`:""}</span>
                  {isGoogle && <span style={{ color:T.acc, opacity:.7 }}>· Google</span>}
                </div>
              )}
            </button>
          </Fragment>
        );
      })}

      {/* Jetzt-Linie */}
      {showNowLine && (
        <div style={{ position:"absolute", left:-44, right:0, top:nowY, pointerEvents:"none", zIndex:5 }}>
          <div style={{ position:"absolute", left:40, right:0, height:2, background:T.red, opacity:.85, boxShadow:`0 0 6px ${T.red}` }}/>
          <div style={{
            position:"absolute", left:34, top:-4,
            width:10, height:10, borderRadius:"50%", background:T.red,
            boxShadow:`0 0 8px ${T.red}`
          }}/>
          <div style={{
            position:"absolute", left:0, top:-7,
            fontFamily:T.mono, fontSize:9, color:T.red, fontWeight:700, letterSpacing:.5,
            background:T.bg, padding:"1px 3px", borderRadius:3
          }}>{minToHHMM(nowMin)}</div>
        </div>
      )}
    </div>
  );
}

// Wochen-Timeline: 7 Tage nebeneinander als Mini-Spalten
function WeekTimeline({ events, weekStart, isTodayKey, onDayClick, onEventClick }) {
  const HOUR_START = 7;
  const HOUR_END = 22;
  const HOUR_HEIGHT = 18; // kompakter als Tag-View
  const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
  const dayNames = ["Mo","Di","Mi","Do","Fr","Sa","So"];
  const days = Array.from({length:7}, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return { date: d, key: isoDateKey(d), label: dayNames[i], dayNum: d.getDate() };
  });
  const nowMin = new Date().getHours()*60 + new Date().getMinutes();
  const nowY = (nowMin - HOUR_START*60) * (HOUR_HEIGHT/60);

  return (
    <div style={{ position:"relative" }}>
      {/* Stunden-Labels links */}
      <div style={{ position:"absolute", left:0, top:24, width:30, height:TOTAL_HEIGHT }}>
        {Array.from({length: HOUR_END - HOUR_START + 1}, (_, i) => {
          const h = HOUR_START + i;
          const y = i * HOUR_HEIGHT;
          if (h % 3 !== 0) return null;
          return (
            <div key={h} style={{
              position:"absolute", top: y - 5, right:2, width:26,
              fontFamily:T.mono, fontSize:8, color:T.muted, textAlign:"right"
            }}>{String(h).padStart(2,"0")}</div>
          );
        })}
      </div>
      {/* 7 Tag-Spalten */}
      <div style={{ marginLeft:32, display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap:2 }}>
        {days.map(d => {
          const isCurrentDay = d.key === isTodayKey;
          const dayEvents = events.filter(e => e.date === d.key && e.time);
          return (
            <div key={d.key} style={{ position:"relative" }}>
              {/* Header Tag */}
              <button onClick={()=>onDayClick?.(d.date)} style={{
                width:"100%", background: isCurrentDay ? T.acc+"22" : "transparent",
                border: `1px solid ${isCurrentDay ? T.acc : T.borderS}`,
                borderRadius:6, padding:"3px 0",
                color: isCurrentDay ? T.acc : T.muted, fontFamily:T.mono, fontSize:9,
                letterSpacing:.5, cursor:"pointer", marginBottom:4,
                display:"flex", flexDirection:"column", alignItems:"center"
              }}>
                <span style={{ opacity:.7, fontSize:8 }}>{d.label}</span>
                <span style={{ fontSize:11, fontWeight:isCurrentDay ? 700 : 400 }}>{d.dayNum}</span>
              </button>
              {/* Tag-Slot */}
              <div style={{
                position:"relative", height: TOTAL_HEIGHT,
                background: T.bg2 + "55", border:`1px solid ${T.border}`, borderRadius:4,
              }}>
                {/* Hour-Gridlines */}
                {Array.from({length: HOUR_END - HOUR_START + 1}, (_, i) => i % 3 === 0 && (
                  <div key={i} style={{
                    position:"absolute", left:0, right:0, top: i * HOUR_HEIGHT, height:1,
                    background: T.border, opacity:.5
                  }}/>
                ))}
                {/* Jetzt-Linie nur am heutigen Tag */}
                {isCurrentDay && nowY >= 0 && nowY <= TOTAL_HEIGHT && (
                  <div style={{
                    position:"absolute", left:0, right:0, top:nowY, height:2,
                    background:T.red, opacity:.85, zIndex:5
                  }}/>
                )}
                {/* Events */}
                {dayEvents.map(ev => {
                  const [h, m] = ev.time.split(":").map(n => parseInt(n)||0);
                  const startMin = h*60 + m;
                  const dur = parseDurationFlexible(ev.duration);
                  const top = (startMin - HOUR_START*60) * (HOUR_HEIGHT/60);
                  const height = Math.max(14, dur * (HOUR_HEIGHT/60));
                  const isGoogle = ev.google || ev.source === "google";
                  const col = isGoogle ? T.acc : T.gold;
                  return (
                    <button key={ev.id || `${ev.title}-${ev.time}`} onClick={()=>onEventClick?.(ev)} style={{
                      position:"absolute", left:1, right:1, top, height,
                      background: col+"33", borderLeft:`2px solid ${col}`, borderRadius:3,
                      padding:"1px 3px", overflow:"hidden", cursor:"pointer",
                      display:"flex", alignItems:"flex-start"
                    }} title={`${ev.title} · ${ev.time} (${dur}min)`}>
                      <span style={{
                        fontFamily:T.serif, fontSize:8, color:T.text,
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                        width:"100%", textAlign:"left", lineHeight:1.2
                      }}>{ev.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── KALENDER SCREEN ──────────────────────────────────────────────────────────
// ISO Date Key "YYYY-MM-DD" für Kalender-Speicherung
function isoDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

// ─── TODOS (Datenebene) ───────────────────────────────────────────────────────
// Werden in der "Anstehend"-Karte auf Heute angezeigt + abgehakt.
// Speicherung: eyla_todos_v1 (Array von Todo-Objekten)

function loadTodos() {
  try { const raw = localStorage.getItem("eyla_todos_v1"); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function saveTodos(arr) {
  try { localStorage.setItem("eyla_todos_v1", JSON.stringify(arr)); } catch {}
}
function makeTodo(text, priority="today") {
  return {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    text: String(text||"").trim(),
    priority,                          // "today" | "week" | "later"
    status: "open",                    // "open" | "done"
    createdAt: new Date().toISOString(),
    completedAt: null,
    notes: "",
  };
}

function KalenderScreen({ events, eventsLoading, onRefresh, profile, log }) {
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newDur, setNewDur] = useState("");
  const [newRec, setNewRec] = useState("");  // ""|"daily"|"weekly"
  const [newTravel, setNewTravel] = useState(0); // Vorbereitungszeit in Minuten
  const [showLegacyList, setShowLegacyList] = useState(false); // alte Stunden-Liste collapsed
  const [calView, setCalView] = useState("day"); // "day" | "week"
  const [localEvents, setLocalEvents] = useState([]);
  // (Google-Sync entfernt – Kalender ist self-contained)
  const [showAdd, setShowAdd] = useState(false);
  const [selectedDate, setSelectedDate] = useState(()=>new Date());
  // Inline-Edit-Mode für Termine
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editDur, setEditDur] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editRec, setEditRec] = useState("");
  // AI-Quick-Add
  const [aiInput, setAiInput] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [aiError, setAiError] = useState(null);

  const todayKey = isoDateKey(new Date());
  const selectedKey = isoDateKey(selectedDate);
  const isToday = selectedKey === todayKey;
  const isPast = selectedKey < todayKey;
  const isFuture = selectedKey > todayKey;

  useEffect(() => {
    retrieve("eyla_local_events_v2", []).then(e => {
      // Migration: alte Events ohne date-Feld → heute
      const arr = e || [];
      const needsMigration = arr.some(ev => !ev.date);
      const migrated = arr.map(ev => ev.date ? ev : { ...ev, date: isoDateKey(new Date()) });
      setLocalEvents(migrated);
      if (needsMigration) persist("eyla_local_events_v2", migrated);
    });
  }, []);

  function saveLocal(evts) { setLocalEvents(evts); persist("eyla_local_events_v2", evts); }

  function startEdit(ev) {
    setEditingId(ev.id);
    setEditTitle(ev.title || "");
    setEditTime(ev.time || "");
    setEditDur(ev.duration || "");
    setEditDate(ev.date || selectedKey);
    setEditRec(ev.recurrence || "");
  }
  function cancelEdit() { setEditingId(null); }
  function saveEdit() {
    if (!editTitle.trim()) return;
    saveLocal(localEvents.map(e => e.id === editingId ? {
      ...e,
      title: editTitle.trim(),
      time: editTime,
      duration: editDur,
      date: editDate || e.date,
      recurrence: editRec || null,
    } : e));
    setEditingId(null);
  }

  function addEvent() {
    if (!newTitle.trim()) return;
    saveLocal([...localEvents, {
      id:Date.now(), title:newTitle.trim(), time:newTime||"",
      duration:newDur||"", date:selectedKey, local:true,
      recurrence: newRec || null,
      travelTime: newTravel || 0,
    }]);
    setNewTitle(""); setNewTime(""); setNewDur(""); setNewRec(""); setNewTravel(0); setShowAdd(false);
    window.dispatchEvent(new Event("eyla_events_changed"));
  }

  // AI-Quick-Add: Natürliche Sprache → Termin
  async function aiQuickAdd() {
    const text = aiInput.trim();
    if (!text) return;
    setAiParsing(true);
    setAiError(null);
    try {
      const todayStr = new Date().toLocaleDateString("de-DE",{ weekday:"long", year:"numeric", month:"2-digit", day:"2-digit" });
      const todayIso = isoDateKey(new Date());
      const res = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-5",
          max_tokens:200,
          system:`Du parst Termin-Beschreibungen in strukturierte Daten. Heute ist ${todayStr} (${todayIso}). Antworte STRENG mit einem JSON-Objekt, KEIN Markdown, KEIN Text drumherum:\n{"title":"<Was>","date":"YYYY-MM-DD","time":"HH:MM oder leer","duration":"z.B. 1h oder leer","recurrence":"daily|weekly|null"}\nWenn 'jeden Mittwoch' o.ä. → recurrence weekly. 'morgen' = heute +1 Tag. 'übermorgen' = +2. 'nächsten Montag' = nächster Montag. Bei Zweifel time leer lassen.`,
          messages:[{ role:"user", content:text }]
        })
      });
      const data = await res.json();
      const txt = data.content?.find(b=>b.type==="text")?.text?.trim() || "";
      // JSON aus Text extrahieren (manchmal hat Modell Markdown-Reste)
      const cleaned = txt.replace(/^```json\s*|```\s*$/g, "").replace(/^```\s*|```\s*$/g, "").trim();
      let parsed;
      try { parsed = JSON.parse(cleaned); } catch { throw new Error("Konnte Antwort nicht parsen"); }

      if (!parsed.title) throw new Error("Titel fehlt");
      const newEv = {
        id: Date.now(),
        title: parsed.title,
        time: parsed.time || "",
        duration: parsed.duration || "",
        date: parsed.date || selectedKey,
        recurrence: parsed.recurrence && parsed.recurrence !== "null" ? parsed.recurrence : null,
        local: true,
      };
      saveLocal([...localEvents, newEv]);
      // Springe zum Datum des neuen Events
      if (parsed.date) {
        try { setSelectedDate(new Date(parsed.date + "T00:00:00")); } catch {}
      }
      setAiInput("");
    } catch (e) {
      setAiError("Konnte nicht verstanden werden: " + (e.message||e));
    }
    setAiParsing(false);
  }

  function prevDay() {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d);
  }
  function nextDay() {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d);
  }
  function goToToday() { setSelectedDate(new Date()); }

  // Events nur für ausgewählten Tag (Migration: events von API werden als heute behandelt)
  // Wiederkehrende Events einbeziehen:
  // - "daily": jeden Tag ab event.date
  // - "weekly": gleicher Wochentag wie event.date, ab event.date
  // - kein recurrence: nur exakt am event.date
  const selDate = new Date(selectedDate);
  const selWeekday = selDate.getDay();
  const matchesRecurrence = (e) => {
    const evDateStr = e.date || todayKey;
    if (evDateStr === selectedKey) return true; // direkt Match
    if (!e.recurrence) return false;
    // Nur ab Original-Datum
    if (evDateStr > selectedKey) return false;
    if (e.recurrence === "daily") return true;
    if (e.recurrence === "weekly") {
      const evDate = new Date(evDateStr);
      return evDate.getDay() === selWeekday;
    }
    return false;
  };

  const eventsForSelected = [
    ...(isToday ? events.map(e=>({...e,local:false,date:todayKey})) : []),
    ...localEvents.filter(matchesRecurrence),
  ].sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));

  const nowH = new Date().getHours();
  const hours = Array.from({length:17},(_,i)=>i+6);

  function eventAtHour(h) {
    return eventsForSelected.filter(e=>{
      if (!e.time) return false;
      const eh = parseInt(e.time.split(":")[0]);
      return eh === h;
    });
  }

  const weekdayLabel = selectedDate.toLocaleDateString("de-DE",{ weekday:"long", day:"numeric", month:"long" });

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <Lbl style={{ marginBottom:6 }}>KALENDER</Lbl>

        {/* Wochen-Strip: 7 Tage als Pills mit Event-Dots */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap:4, marginBottom:14 }}>
          {Array.from({length:7}, (_, i) => {
            // Strip startet 3 Tage vor selectedDate, endet 3 Tage danach (zentriert auf gewählten)
            const d = new Date(selectedDate);
            d.setDate(d.getDate() + (i - 3));
            const dKey = isoDateKey(d);
            const dTodayK = isoDateKey(new Date());
            const isSelected = dKey === selectedKey;
            const isTodayPill = dKey === dTodayK;
            // Anzahl Events an dem Tag (lokale + recurring)
            const dWeekday = d.getDay();
            const count = localEvents.filter(e => {
              const evDateStr = e.date || dTodayK;
              if (evDateStr === dKey) return true;
              if (!e.recurrence) return false;
              if (evDateStr > dKey) return false;
              if (e.recurrence === "daily") return true;
              if (e.recurrence === "weekly") {
                const evDate = new Date(evDateStr);
                return evDate.getDay() === dWeekday;
              }
              return false;
            }).length;
            return (
              <button key={dKey} onClick={()=>setSelectedDate(new Date(d))} style={{
                background: isSelected ? T.gold+"22" : isTodayPill ? T.acc+"14" : T.bg2,
                border:`1px solid ${isSelected ? T.gold : isTodayPill ? T.acc+"55" : T.borderS}`,
                borderRadius:10, padding:"6px 2px", cursor:"pointer",
                color: isSelected ? T.gold : isTodayPill ? T.acc : T.muted,
                fontFamily:T.mono, fontSize:10, letterSpacing:.5,
                display:"flex", flexDirection:"column", alignItems:"center", gap:2,
                transition:"all .2s"
              }}>
                <span style={{ fontSize:9, opacity:.7 }}>
                  {d.toLocaleDateString("de-DE",{weekday:"short"}).slice(0,2).toUpperCase()}
                </span>
                <span style={{ fontSize:15, fontWeight:300 }}>{d.getDate()}</span>
                {count > 0 && (
                  <span style={{
                    width: count > 3 ? 18 : 6, height:6, borderRadius:6,
                    background: isSelected ? T.gold : isTodayPill ? T.acc : T.mid,
                    fontSize:8, lineHeight:"6px", color:T.bg, textAlign:"center", fontFamily:T.mono
                  }}>{count > 3 ? count : ""}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Date Navigator */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:14 }}>
          <button onClick={prevDay} style={{
            background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:10,
            padding:"8px 12px", color:T.mid, fontFamily:T.serif, fontSize:18,
            cursor:"pointer", lineHeight:1
          }}>‹</button>

          <div style={{ textAlign:"center", flex:1, minWidth:0 }}>
            <div style={{ fontSize:11, color:T.muted, fontFamily:T.mono, letterSpacing:1, marginBottom:2 }}>
              {isToday ? "HEUTE" : isPast ? "VERGANGEN" : "BEVORSTEHEND"}
            </div>
            <h2 style={{ fontSize:17, fontWeight:300, color:isToday?T.gold:T.text, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {weekdayLabel}
            </h2>
          </div>

          <button onClick={nextDay} style={{
            background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:10,
            padding:"8px 12px", color:T.mid, fontFamily:T.serif, fontSize:18,
            cursor:"pointer", lineHeight:1
          }}>›</button>
        </div>

        {/* Heute-Button wenn nicht heute */}
        {!isToday && (
          <div style={{ textAlign:"center", marginBottom:14 }}>
            <button onClick={goToToday} style={{
              background:T.acc+"18", border:`1px solid ${T.acc}44`, borderRadius:18,
              padding:"5px 14px", color:T.acc, fontFamily:T.mono, fontSize:10,
              cursor:"pointer", letterSpacing:1.5
            }}>↺ HEUTE</button>
          </div>
        )}

        {/* Aktionen */}
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={()=>setShowAdd(s=>!s)} style={{ background:showAdd?T.gold+"22":"transparent",
            border:`1px solid ${showAdd?T.gold:T.borderS}`, borderRadius:8, padding:"6px 14px",
            color:showAdd?T.gold:T.muted, fontFamily:T.mono, fontSize:10, cursor:"pointer", letterSpacing:1 }}>
            + TERMIN
          </button>
        </div>
      </div>

      {/* Termin hinzufügen */}
      {showAdd && (
        <Card gold style={{ marginBottom:14, animation:"fadeUp .3s ease both" }}>
          {/* AI-Quick-Add via Natural Language */}
          <Lbl color={T.acc} style={{ marginBottom:6 }}>✦ EYLA VERSTEHT</Lbl>
          <div style={{ display:"flex", gap:6, marginBottom:14 }}>
            <input value={aiInput} onChange={e=>setAiInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&aiQuickAdd()}
              placeholder='z.B. "morgen 14 Uhr Sport mit Tom" oder "jeden Mittwoch 19 Uhr Yoga"'
              disabled={aiParsing}
              style={{ flex:1, background:T.bg2, border:`1px solid ${T.acc}44`, borderRadius:8,
                padding:"9px 12px", color:T.text, fontFamily:T.serif, fontSize:13,
                fontStyle:"italic", outline:"none" }}/>
            <button onClick={aiQuickAdd} disabled={!aiInput.trim()||aiParsing} style={{
              background: (aiInput.trim()&&!aiParsing) ? `linear-gradient(135deg,${T.dim},${T.acc})` : T.bg2,
              border:"none", borderRadius:8, padding:"0 14px",
              color: (aiInput.trim()&&!aiParsing) ? T.bg : T.muted,
              fontFamily:T.serif, fontSize:13, fontWeight:700,
              cursor: (aiInput.trim()&&!aiParsing) ? "pointer" : "default"
            }}>{aiParsing ? "…" : "✦"}</button>
          </div>
          {aiError && (
            <p style={{ color:T.red, fontSize:11, fontStyle:"italic", margin:"-8px 0 12px", fontFamily:T.serif }}>{aiError}</p>
          )}
          <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:12, marginBottom:10 }}>
            <Lbl color={T.gold} style={{ marginBottom:10 }}>Oder manuell</Lbl>
          </div>
          <input value={newTitle} onChange={e=>{
              const v = e.target.value;
              setNewTitle(v);
              // Smart-Duration auto-vorschlagen wenn Dauer noch leer
              if (!newDur || newDur === "60") {
                const dur = smartDurationFromTitle(v);
                if (dur && dur !== 60) setNewDur(String(dur));
              }
              // Smart-Travel-Time auto-vorschlagen (wenn noch 0)
              if (!newTravel) {
                const tr = smartTravelFromTitle(v);
                if (tr > 0) setNewTravel(tr);
              }
            }} onKeyDown={e=>e.key==="Enter"&&addEvent()}
            placeholder="Was?" autoFocus
            style={{ width:"100%", background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 12px",color:T.text,fontFamily:T.serif,fontSize:13,fontStyle:"italic",outline:"none", boxSizing:"border-box", marginBottom:8 }}/>
          <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr 1fr", gap:8, marginBottom:8 }}>
            <input value={selectedKey} onChange={e=>{
              const d = new Date(e.target.value + "T00:00:00");
              if (!isNaN(d)) setSelectedDate(d);
            }} type="date"
              style={{ background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 10px",color:T.text,fontFamily:T.mono,fontSize:12,outline:"none" }}/>
            <input value={newTime} onChange={e=>setNewTime(e.target.value)} type="time"
              style={{ background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 10px",color:T.text,fontFamily:T.mono,fontSize:12,outline:"none" }}/>
            <input value={newDur} onChange={e=>setNewDur(e.target.value)} placeholder="z.B. 60"
              style={{ background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 10px",color:T.text,fontFamily:T.mono,fontSize:12,outline:"none" }}/>
          </div>
          {/* Travel-Time / Vorbereitung (optional) */}
          <div style={{ display:"flex", gap:8, marginBottom:10, alignItems:"center" }}>
            <Lbl style={{ fontSize:9, color:T.muted, marginRight:4 }}>VORBEREITUNG</Lbl>
            {[0, 15, 30, 60].map(t => (
              <button key={t} onClick={()=>setNewTravel(t)} style={{
                background: (newTravel||0)===t ? T.acc+"22" : "transparent",
                border:`1px solid ${(newTravel||0)===t ? T.acc : T.borderS}`,
                borderRadius:6, padding:"4px 10px",
                color: (newTravel||0)===t ? T.acc : T.muted,
                fontFamily:T.mono, fontSize:10, cursor:"pointer", letterSpacing:.5
              }}>{t===0?"–":`+${t}m`}</button>
            ))}
          </div>
          {/* Live Konflikt-Check */}
          {newTitle.trim() && newTime && (() => {
            const tentative = { title:newTitle, time:newTime, duration:parseInt(newDur)||60, date:selectedKey };
            const conflicts = detectConflicts(tentative, eventsForSelected);
            if (conflicts.length === 0) return null;
            return (
              <div style={{ padding:"6px 10px", marginBottom:10, background:T.red+"22", border:`1px solid ${T.red}55`, borderRadius:8, color:T.red, fontSize:11, fontFamily:T.serif, fontStyle:"italic" }}>
                ⚠ Konflikt mit: {conflicts.map(c=>`${c.time} ${c.title}`).join(", ")}
              </div>
            );
          })()}
          {/* Recurrence */}
          <div style={{ display:"flex", gap:6, marginBottom:10 }}>
            {[["", "Einmalig"], ["daily", "Täglich"], ["weekly", "Wöchentlich"]].map(([val, lbl])=>(
              <button key={val} onClick={()=>setNewRec(val)} style={{
                flex:1, padding:"7px 8px", borderRadius:8,
                background: newRec===val ? T.gold+"22" : "transparent",
                border: `1px solid ${newRec===val ? T.gold : T.borderS}`,
                color: newRec===val ? T.text : T.muted,
                fontFamily:T.serif, fontSize:11, cursor:"pointer",
                fontStyle: newRec===val ? "normal" : "italic"
              }}>{lbl}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={addEvent} disabled={!newTitle.trim()} style={{
              background:newTitle.trim()?`linear-gradient(135deg,#78350F,${T.goldL})`:"transparent",
              border:"none",borderRadius:8,padding:"9px 20px",color:newTitle.trim()?T.bg:T.muted,
              fontFamily:T.serif,fontSize:13,cursor:newTitle.trim()?"pointer":"default",fontWeight:700 }}>
              Speichern
            </button>
            <button onClick={()=>setShowAdd(false)} style={{ background:"transparent",border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 16px",color:T.muted,fontFamily:T.serif,fontSize:13,cursor:"pointer" }}>
              Abbrechen
            </button>
          </div>
        </Card>
      )}

      {/* SMART DAY-TIMELINE – visuelle Übersicht für den ausgewählten Tag */}
      {(() => {
        // Konflikte berechnen
        const conflictsById = {};
        for (const ev of eventsForSelected) {
          if (!ev.time) continue;
          const conflicts = detectConflicts(ev, eventsForSelected);
          if (conflicts.length > 0) conflictsById[ev.id] = conflicts;
        }
        // Free-Slots berechnen (für Tag, 7-22, min 30min)
        const slots = findFreeSlots(eventsForSelected, selectedKey, 7*60, 22*60, 45);
        // Top-3 längste Slots
        const topSlots = [...slots].sort((a,b)=>b.duration-a.duration).slice(0, 3);
        const hasConflicts = Object.keys(conflictsById).length > 0;
        return (
          <Card style={{ marginBottom:12 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <Lbl>{calView==="week" ? "WOCHE" : isToday ? "HEUTE" : "TAG"} · TIMELINE</Lbl>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                {/* Tag/Woche Toggle */}
                <div style={{ display:"flex", background:T.bg, borderRadius:8, padding:2, border:`1px solid ${T.borderS}` }}>
                  {[["day","Tag"],["week","Woche"]].map(([id, lbl]) => (
                    <button key={id} onClick={()=>setCalView(id)} style={{
                      background: calView===id ? T.acc+"33" : "transparent",
                      border:"none", borderRadius:6, padding:"3px 10px",
                      color: calView===id ? T.acc : T.muted, fontFamily:T.mono, fontSize:9,
                      letterSpacing:1, cursor:"pointer"
                    }}>{lbl.toUpperCase()}</button>
                  ))}
                </div>
                {hasConflicts && (
                  <span style={{ background:T.red+"22", border:`1px solid ${T.red}55`, borderRadius:10, padding:"1px 8px", fontSize:9, color:T.red, fontFamily:T.mono, letterSpacing:1 }}>
                    {Object.keys(conflictsById).length} KONFLIKT{Object.keys(conflictsById).length>1?"E":""}
                  </span>
                )}
              </div>
            </div>
            {topSlots.length > 0 && (
              <div style={{ marginBottom:10, padding:"6px 10px", background:T.acc+"08", border:`1px solid ${T.acc}22`, borderRadius:8, display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
                <span style={{ fontFamily:T.mono, fontSize:9, color:T.acc, letterSpacing:1.5 }}>✦ FREI:</span>
                {topSlots.map((s, i) => (
                  <span key={i} style={{ fontFamily:T.mono, fontSize:10, color:T.mid }}>
                    {minToHHMM(s.start)}–{minToHHMM(s.end)} <span style={{ color:T.muted }}>({s.duration>=60 ? `${Math.floor(s.duration/60)}h${s.duration%60?` ${s.duration%60}m`:""}` : `${s.duration}m`})</span>
                  </span>
                ))}
              </div>
            )}
            {calView === "week" ? (() => {
              // Wochen-Start: Montag der ausgewählten Woche
              const wkStart = new Date(selectedDate);
              const dow = (wkStart.getDay() + 6) % 7; // 0=Mo
              wkStart.setDate(wkStart.getDate() - dow);
              wkStart.setHours(0,0,0,0);
              // 7 Tage Events sammeln (lokal + Google in dem Zeitraum)
              const wkEnd = new Date(wkStart); wkEnd.setDate(wkEnd.getDate()+7);
              const wkKeys = Array.from({length:7},(_,i)=>{ const d=new Date(wkStart); d.setDate(d.getDate()+i); return isoDateKey(d); });
              const weekEvents = [
                ...localEvents.filter(e => wkKeys.includes(e.date)),
              ];
              return (
                <WeekTimeline
                  events={weekEvents}
                  weekStart={wkStart}
                  isTodayKey={isoDateKey(new Date())}
                  onDayClick={(d)=>{ setSelectedDate(d); setCalView("day"); }}
                  onEventClick={(ev)=>{ if (ev.local) startEdit(ev); }}
                />
              );
            })() : (
              <DayTimeline
                events={eventsForSelected}
                dayKey={selectedKey}
                isToday={isToday}
                freeSlots={slots}
                conflictsById={conflictsById}
                onSlotClick={(slot) => {
                  setNewTime(minToHHMM(slot.start));
                  setNewDur(String(Math.min(slot.duration, 60)));
                  setShowAdd(true);
                }}
                onEventClick={(ev) => { if (ev.local) startEdit(ev); }}
              />
            )}
          </Card>
        );
      })()}

      {/* Legacy Stunden-Liste (collapsed by default, nur zum Editieren) */}
      <button onClick={()=>setShowLegacyList(s=>!s)} style={{
        width:"100%", background:"transparent", border:"none",
        display:"flex", alignItems:"center", gap:8, padding:"6px 4px",
        fontFamily:T.mono, fontSize:9, color:T.muted, letterSpacing:2,
        cursor:"pointer", textAlign:"left", marginBottom:8
      }}>
        <span>{showLegacyList ? "▾" : "▸"} TERMINE BEARBEITEN · {eventsForSelected.length}</span>
        <div style={{ flex:1, height:1, background:T.borderS, opacity:.4 }}/>
      </button>
      {showLegacyList && (
      <Card style={{ padding:"16px 0", overflow:"hidden" }}>
        {eventsLoading && isToday && (
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <Lbl>LADE GOOGLE CALENDAR …</Lbl>
          </div>
        )}
        {hours.map(h=>{
          const hStr = `${String(h).padStart(2,"0")}:00`;
          // "Jetzt"-Markierung nur am heutigen Tag
          const isNow = isToday && h === nowH;
          const evts = eventAtHour(h);
          const past = isToday ? h < nowH : isPast;

          return (
            <div key={h} style={{ display:"flex", gap:0, position:"relative",
              opacity:past?0.45:1, minHeight:evts.length>0?undefined:36 }}>
              {/* Stunde */}
              <div style={{ width:52, flexShrink:0, paddingTop:2, paddingLeft:16,
                fontFamily:T.mono, fontSize:10, color:isNow?T.acc:T.muted, letterSpacing:1 }}>
                {hStr}
              </div>

              {/* Linie + Jetzt-Marker */}
              <div style={{ width:1, background:isNow?T.acc:T.border, flexShrink:0, position:"relative" }}>
                {isNow && (
                  <>
                    <div style={{ position:"absolute", left:-3, top:8, width:7, height:7,
                      borderRadius:"50%", background:T.acc, boxShadow:`0 0 8px ${T.acc}` }}/>
                    <div style={{ position:"absolute", left:0, top:11, right:-300, height:1,
                      background:`linear-gradient(90deg,${T.acc}88,transparent)` }}/>
                  </>
                )}
              </div>

              {/* Inhalt */}
              <div style={{ flex:1, paddingLeft:12, paddingBottom:evts.length>0?8:4, paddingTop:2, paddingRight:16 }}>
                {evts.map((e,i)=>{
                  const isEditing = editingId === e.id;
                  if (isEditing) {
                    return (
                      <div key={e.id} style={{ background:T.gold+"11", border:`1px solid ${T.gold}55`,
                        borderRadius:8, padding:10, marginBottom:4, animation:"fadeUp .2s ease both" }}>
                        <input value={editTitle} onChange={ev=>setEditTitle(ev.target.value)} onKeyDown={ev=>ev.key==="Enter"&&saveEdit()}
                          autoFocus placeholder="Was?" style={{ width:"100%", marginBottom:6, background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:6, padding:"6px 10px", color:T.text, fontFamily:T.serif, fontSize:13, fontStyle:"italic", outline:"none", boxSizing:"border-box" }}/>
                        <div style={{ display:"grid", gridTemplateColumns:"1.3fr 1fr 1fr", gap:6, marginBottom:6 }}>
                          <input value={editDate} onChange={ev=>setEditDate(ev.target.value)} type="date"
                            style={{ background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:6, padding:"6px 8px", color:T.text, fontFamily:T.mono, fontSize:11, outline:"none" }}/>
                          <input value={editTime} onChange={ev=>setEditTime(ev.target.value)} type="time"
                            style={{ background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:6, padding:"6px 8px", color:T.text, fontFamily:T.mono, fontSize:11, outline:"none" }}/>
                          <input value={editDur} onChange={ev=>setEditDur(ev.target.value)} placeholder="z.B. 1h"
                            style={{ background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:6, padding:"6px 8px", color:T.text, fontFamily:T.mono, fontSize:11, outline:"none" }}/>
                        </div>
                        <div style={{ display:"flex", gap:4, marginBottom:6 }}>
                          {[["", "Einmalig"], ["daily", "Täglich"], ["weekly", "Wöchentlich"]].map(([val, lbl])=>(
                            <button key={val} onClick={()=>setEditRec(val)} style={{
                              flex:1, padding:"4px 6px", borderRadius:6,
                              background: editRec===val ? T.gold+"22" : "transparent",
                              border: `1px solid ${editRec===val ? T.gold : T.borderS}`,
                              color: editRec===val ? T.text : T.muted,
                              fontFamily:T.serif, fontSize:10, cursor:"pointer",
                              fontStyle: editRec===val ? "normal" : "italic"
                            }}>{lbl}</button>
                          ))}
                        </div>
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={saveEdit} style={{ background:`linear-gradient(135deg,#78350F,${T.goldL})`, border:"none", borderRadius:6, padding:"4px 14px", color:T.bg, fontFamily:T.serif, fontSize:11, fontWeight:700, cursor:"pointer" }}>Speichern</button>
                          <button onClick={cancelEdit} style={{ background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:6, padding:"4px 12px", color:T.muted, fontFamily:T.serif, fontSize:11, cursor:"pointer", fontStyle:"italic" }}>Abbrechen</button>
                          <button onClick={()=>{ saveLocal(localEvents.filter(x=>x.id!==e.id)); setEditingId(null); }} style={{ marginLeft:"auto", background:"transparent", border:`1px solid ${T.red}33`, borderRadius:6, padding:"4px 12px", color:T.red, fontFamily:T.mono, fontSize:10, cursor:"pointer", letterSpacing:1 }}>LÖSCHEN</button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={e.id||i}
                      onClick={()=> e.local && startEdit(e)}
                      style={{ background:e.local?T.gold+"18":T.acc+"12",
                        border:`1px solid ${e.local?T.gold+"44":T.acc+"33"}`,
                        borderRadius:8, padding:"8px 12px", marginBottom:4,
                        display:"flex", justifyContent:"space-between", alignItems:"flex-start",
                        cursor: e.local ? "pointer" : "default" }}>
                      <div>
                        <div style={{ color:T.text, fontSize:13, fontWeight:500 }}>{e.title}</div>
                        <div style={{ display:"flex", gap:10, marginTop:3 }}>
                          {e.time && <span style={{ color:e.local?T.gold:T.acc, fontFamily:T.mono, fontSize:10 }}>{e.time}</span>}
                          {e.duration && <span style={{ color:T.muted, fontFamily:T.mono, fontSize:10 }}>⏱ {e.duration}</span>}
                          {e.location && <span style={{ color:T.muted, fontSize:10 }}>📍 {e.location}</span>}
                        </div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        {e.recurrence && (
                          <span style={{ fontFamily:T.mono,fontSize:10,color:T.gold,background:"transparent",border:`1px solid ${T.gold}33`,borderRadius:3,padding:"1px 6px",letterSpacing:.5 }}
                            title={e.recurrence === "weekly" ? "Wöchentlich" : "Täglich"}>
                            ↻ {e.recurrence === "weekly" ? "wö" : "tgl"}
                          </span>
                        )}
                        {e.local && <span style={{ fontFamily:T.mono,fontSize:10,color:T.gold,background:T.gold+"18",border:`1px solid ${T.gold}33`,borderRadius:3,padding:"1px 6px",letterSpacing:1 }}>LOKAL</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </Card>
      )}

      {/* Keine Termine Info */}
      {!eventsLoading && eventsForSelected.length === 0 && (
        <div style={{ textAlign:"center", padding:"20px 0", color:T.muted, fontStyle:"italic", fontSize:13, fontFamily:T.serif }}>
          {isToday ? "Keine Termine heute." : "Keine Termine an diesem Tag."} Mit „+ TERMIN" einen anlegen.
        </div>
      )}
    </div>
  );
}

// ─── WOCHEN SCREEN ────────────────────────────────────────────────────────────
// Mini-Heatmap: Habit-Erledigung über 7 Tage (Card rendert nichts wenn keine Habits)
function HabitHeatmap({ habits, days, logsByDate }) {
  if (!habits || habits.length === 0) return null;
  const reversed = days.slice().reverse(); // älteste links → heute rechts
  return (
    <Card style={{ marginBottom:12 }}>
      <Lbl style={{ marginBottom:12 }}>GEWOHNHEITEN · WOCHE</Lbl>
      <div style={{ display:"grid", gridTemplateColumns:"1.6fr repeat(7, 1fr)", gap:4, alignItems:"center" }}>
        <div></div>
        {reversed.map((d, i) => {
          const dt = new Date(d);
          const isToday = i === reversed.length - 1;
          return (
            <div key={d} style={{
              textAlign:"center", fontSize:9, color: isToday ? T.acc : T.muted,
              fontFamily:T.mono, letterSpacing:.5
            }}>
              {isToday ? "H" : dt.toLocaleDateString("de-DE",{weekday:"narrow"})}
            </div>
          );
        })}
        {habits.map(h => (
          <Fragment key={h.id}>
            <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0, paddingRight:4 }}>
              <span style={{ fontSize:13 }}>{h.emoji}</span>
              <span style={{ color:T.text, fontSize:11, fontFamily:T.serif, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.name}</span>
            </div>
            {reversed.map((d) => {
              const done = !!(logsByDate?.[d]?.habits && logsByDate[d].habits[h.id]);
              return (
                <div key={d} style={{
                  height:18, borderRadius:3,
                  background: done ? T.acc : T.faint,
                  border:`1px solid ${done ? T.acc+"55" : T.borderS}`,
                  opacity: done ? 1 : 0.5,
                  transition:"background .2s"
                }}/>
              );
            })}
          </Fragment>
        ))}
      </div>
    </Card>
  );
}

function WeekScreen({ logsByDate, profile, onJumpToDay }) {
  const days = lastNDays(7);
  const targetK = calorieTarget(profile || {}).target;
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState(null);

  // Week-Hash zur Cache-Invalidierung: Datum + Anzahl Einträge
  const weekHash = days[0] + "|" + days.reduce((s,k)=>{
    const l = logsByDate?.[k]; if(!l) return s;
    return s + (l.meals?.length||0) + (l.water||0) + (l.workouts?.length||0) + (l.weight?1:0);
  }, 0);

  useEffect(() => {
    retrieve("eyla_week_insight_v1", null).then(saved => {
      if (saved && saved.hash === weekHash) {
        setInsight(saved.text);
      } else {
        // Auto-Generierung wenn keine Daten oder älter als 6h
        const ageMs = saved ? (Date.now() - new Date(saved.createdAt||0).getTime()) : Infinity;
        if (ageMs > 6 * 60 * 60 * 1000 && Object.keys(logsByDate||{}).length > 0) {
          // Verzögert generieren – User soll Tab erst sehen können
          const t = setTimeout(() => generateInsight(), 400);
          return () => clearTimeout(t);
        }
      }
    });
  }, [weekHash]);

  async function generateInsight() {
    setInsightLoading(true);
    setInsightError(null);
    try {
      // Komprimiertes Wochen-Summary
      const summary = days.map((k, i) => {
        const l = logsByDate?.[k];
        if (!l) return null;
        const kcal = l.meals?.reduce((s,m)=>s+(m.calories||0),0) || 0;
        const wo = (l.workouts||[]).map(w=>`${w.type}${w.duration?` ${w.duration}min`:""}`).join(", ");
        const parts = [];
        if (l.water) parts.push(`💧${(l.water*.25).toFixed(2)}L`);
        if (l.sleep) parts.push(`😴${l.sleep}h`);
        if (kcal) parts.push(`🍽${kcal}`);
        if (l.energy) parts.push(l.energy);
        if (l.weight) parts.push(`⚖${l.weight}kg`);
        if (wo) parts.push(`🏋${wo}`);
        const label = i === 0 ? "Heute" : i === 1 ? "Gestern" : new Date(k).toLocaleDateString("de-DE",{weekday:"short"});
        return parts.length ? `${label}: ${parts.join(" · ")}` : null;
      }).filter(Boolean).join("\n");

      if (!summary) {
        setInsightError("Zu wenig Daten – trag mehr ein bevor ich was sagen kann.");
        setInsightLoading(false);
        return;
      }

      const ct = calorieTarget(profile);
      const ziel = ct.type === "halten" ? `Halten ~${ct.target}kcal` :
                   ct.type === "abnehmen" ? `Abnehmen, Tagesziel ${ct.target}kcal` :
                   `Aufbauen, Tagesziel ${ct.target}kcal`;

      const res = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-5",
          max_tokens:400,
          system:`Du bist EYLA, ${profile.name||"Phil"}s Begleiterin. Lies die Wochen-Daten und schreib eine kurze, ehrliche Analyse: 3-5 Sätze. Konkret, präzise, keine Ratschlag-Phrasen. Wenn was auffällt (Trend, Lücke, Stärke) – benenne es. Wenn Daten dünn sind, sag das. Keine Listen, keine Bullets, kein "Insgesamt …" am Anfang. Direkt rein.`,
          messages:[{ role:"user", content:`Ziel: ${ziel}\n\nWoche:\n${summary}` }]
        })
      });
      const data = await res.json();
      const text = data.content?.find(b=>b.type==="text")?.text || "";
      if (!text) throw new Error("Leere Antwort");
      setInsight(text);
      await persist("eyla_week_insight_v1", { hash: weekHash, text, createdAt: new Date().toISOString() });
    } catch(e) {
      setInsightError("Konnte keine Analyse erstellen.");
    }
    setInsightLoading(false);
  }

  // Per-Day-Werte (auch für Charts)
  const dayData = days.map(key => {
    const l = logsByDate?.[key];
    const kcal = l?.meals?.reduce((s,m)=>s+(m.calories||0),0) || 0;
    const sleepNum = parseFloat(String(l?.sleep||"").replace("+","")) || 0;
    return {
      key,
      water: l?.water || 0,
      sleepNum,
      kcal,
      hasAny: !!(l && ((l.meals?.length||0) > 0 || l.water > 0 || l.sleep || l.energy)),
    };
  });

  // Aggregate für Summary
  const stats = dayData.reduce((acc, d) => {
    if (!d.hasAny) return acc;
    acc.count++;
    acc.water += d.water;
    acc.kcal += d.kcal;
    if (d.sleepNum > 0) { acc.sleep += d.sleepNum; acc.sleepN++; }
    return acc;
  }, { count:0, water:0, kcal:0, sleep:0, sleepN:0 });

  const avgWater = stats.count>0 ? (stats.water/stats.count).toFixed(1) : "0";
  const avgSleep = stats.sleepN>0 ? (stats.sleep/stats.sleepN).toFixed(1) : "–";
  const avgKcal  = stats.count>0 ? Math.round(stats.kcal/stats.count) : 0;

  // Streaks (heute zuerst, rückwärts)
  function streakOf(predicate) {
    let s = 0;
    for (const d of dayData) {
      if (predicate(d)) s++;
      else break;
    }
    return s;
  }
  const waterStreak = streakOf(d => d.water >= waterTargetUnits(profile));
  const sleepStreak = streakOf(d => d.sleepNum >= sleepTargetH(profile));
  const mealStreak  = streakOf(d => d.hasAny && (logsByDate?.[d.key]?.meals?.length||0) > 0);

  function labelFor(dateKey, idx) {
    if (idx === 0) return "Heute";
    if (idx === 1) return "Gestern";
    const d = new Date(dateKey);
    return d.toLocaleDateString("de-DE",{weekday:"short",day:"numeric",month:"short"});
  }

  function moodEmoji(energy) {
    if (!energy) return "·";
    const m = energy.match(/\p{Emoji}/u);
    return m ? m[0] : "·";
  }

  // Mini-Bar-Chart Komponente (SVG-frei, pure DOM)
  function MiniBars({ values, max, color, targetLine }) {
    return (
      <div style={{ position:"relative", display:"flex", gap:5, height:50, alignItems:"flex-end", padding:"4px 0" }}>
        {/* Target-Linie */}
        {targetLine && max > 0 && (
          <div style={{
            position:"absolute", left:0, right:0,
            bottom: `${Math.min(98, (targetLine/max)*100)}%`,
            height:1, borderTop:`1px dashed ${T.muted}55`, pointerEvents:"none"
          }}/>
        )}
        {values.slice().reverse().map((v, i) => (
          <div key={i} style={{
            flex:1,
            height: max > 0 ? `${Math.max(2, Math.min(100, (v/max)*100))}%` : "2px",
            background: v > 0 ? color : T.faint,
            borderRadius:2,
            opacity: v > 0 ? 1 : 0.4,
            transition:"height .3s"
          }} title={`${v}`}/>
        ))}
      </div>
    );
  }
  function chartLabels() {
    return (
      <div style={{ display:"flex", gap:5, fontSize:9, color:T.muted, fontFamily:T.mono, marginTop:4 }}>
        {dayData.slice().reverse().map((d, i) => {
          const dt = new Date(d.key);
          const label = i === dayData.length-1 ? "H" : dt.toLocaleDateString("de-DE",{weekday:"narrow"});
          return <div key={i} style={{ flex:1, textAlign:"center" }}>{label}</div>;
        })}
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <Lbl style={{ marginBottom:6 }}>WOCHE · LETZTE 7 TAGE</Lbl>
        <h2 style={{ fontSize:20, fontWeight:300, color:T.text, margin:0 }}>
          Dein <span style={{ color:T.acc }}>Verlauf.</span>
        </h2>
      </div>

      {/* EYLAs Wochen-Analyse */}
      {insight ? (
        <Card accent style={{ marginBottom:12, padding:"14px 18px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8, gap:8 }}>
            <Lbl style={{ marginBottom:0 }}>✦ EYLAS ANALYSE</Lbl>
            <button onClick={()=>{ persist("eyla_week_insight_v1", null); setInsight(null); }} style={{
              background:"transparent", border:"none", color:T.muted,
              fontFamily:T.mono, fontSize:9, letterSpacing:1, cursor:"pointer", padding:0
            }}>↺ NEU</button>
          </div>
          <p style={{ color:T.mid, fontSize:13, lineHeight:1.7, fontFamily:T.serif, fontStyle:"italic", margin:0 }}>
            {insight}
          </p>
        </Card>
      ) : (
        <button onClick={generateInsight} disabled={insightLoading} style={{
          width:"100%", marginBottom:12, padding:"11px 14px", borderRadius:10,
          border:`1px solid ${T.acc}44`,
          background: insightLoading ? T.bg2 : T.acc+"10",
          color:T.acc, fontFamily:T.serif, fontSize:13,
          cursor: insightLoading ? "default" : "pointer",
          fontStyle:"italic", transition:"all .2s",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8
        }}>
          {insightLoading ? (
            <>
              <Waveform/>
              <span style={{ fontFamily:T.mono, fontSize:10, letterSpacing:1 }}>EYLA LIEST DEINE WOCHE …</span>
            </>
          ) : (
            <>✦ EYLAs Analyse zur Woche</>
          )}
        </button>
      )}
      {insightError && (
        <p style={{ color:T.red, fontSize:11, fontStyle:"italic", margin:"-6px 0 12px", fontFamily:T.serif }}>{insightError}</p>
      )}

      {/* Habit-Heatmap */}
      <HabitHeatmap habits={profile?.habits || []} days={days} logsByDate={logsByDate}/>

      {/* Streaks */}
      {(waterStreak > 0 || sleepStreak > 0 || mealStreak > 0) && (
        <Card style={{ marginBottom:12, padding:"14px 18px" }}>
          <Lbl style={{ marginBottom:10 }}>STREAKS</Lbl>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
            {[
              { label:`💧 Wasser ≥${waterTargetL(profile)}L`, value:waterStreak, color:T.acc },
              { label:`😴 Schlaf ≥${sleepTargetH(profile)}h`, value:sleepStreak, color:T.mid },
              { label:"🍽 Mahlzeit", value:mealStreak, color:T.gold },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize:10, color:T.muted, marginBottom:2, fontStyle:"italic", fontFamily:T.serif }}>{s.label}</div>
                <div style={{ fontSize:18, fontFamily:T.mono, color:s.value > 0 ? s.color : T.muted }}>
                  {s.value}<span style={{ fontSize:10, color:T.muted, marginLeft:3 }}>Tag{s.value===1?"":"e"}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Summary */}
      <Card accent style={{ marginBottom:12 }}>
        <Lbl style={{ marginBottom:12 }}>SCHNITTWERTE</Lbl>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
          <div>
            <div style={{ fontSize:11, color:T.muted, marginBottom:4 }}>💧 Wasser</div>
            <div style={{ fontSize:22, fontWeight:300, color:T.text, fontFamily:T.mono }}>
              {(avgWater*.25).toFixed(2)}<span style={{ fontSize:11, color:T.muted, marginLeft:4 }}>L</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:T.muted, marginBottom:4 }}>😴 Schlaf</div>
            <div style={{ fontSize:22, fontWeight:300, color:T.text, fontFamily:T.mono }}>
              {avgSleep}<span style={{ fontSize:11, color:T.muted, marginLeft:4 }}>h</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:T.muted, marginBottom:4 }}>🍽 kcal</div>
            <div style={{ fontSize:22, fontWeight:300, color:T.text, fontFamily:T.mono }}>
              {avgKcal}
            </div>
          </div>
        </div>
        {stats.count === 0 && (
          <p style={{ color:T.muted, fontStyle:"italic", fontSize:12, fontFamily:T.serif, margin:"12px 0 0" }}>
            Noch keine Daten – trag heute was ein, dann füllt sich der Verlauf.
          </p>
        )}
      </Card>

      {/* Charts */}
      {stats.count > 0 && (
        <Card style={{ marginBottom:12, padding:"14px 18px" }}>
          <Lbl style={{ marginBottom:10 }}>VERLAUF</Lbl>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
            <div>
              <div style={{ fontSize:10, color:T.muted, marginBottom:4, fontFamily:T.mono, letterSpacing:1 }}>💧 WASSER</div>
              <MiniBars values={dayData.map(d=>d.water)} max={12} color={T.acc} targetLine={waterTargetUnits(profile)}/>
              {chartLabels()}
            </div>
            <div>
              <div style={{ fontSize:10, color:T.muted, marginBottom:4, fontFamily:T.mono, letterSpacing:1 }}>😴 SCHLAF</div>
              <MiniBars values={dayData.map(d=>d.sleepNum)} max={10} color={T.mid} targetLine={7}/>
              {chartLabels()}
            </div>
            <div>
              <div style={{ fontSize:10, color:T.muted, marginBottom:4, fontFamily:T.mono, letterSpacing:1 }}>🍽 KCAL</div>
              <MiniBars values={dayData.map(d=>d.kcal)} max={Math.max(targetK*1.4, ...dayData.map(d=>d.kcal))} color={T.gold} targetLine={targetK}/>
              {chartLabels()}
            </div>
          </div>
        </Card>
      )}

      {/* Tagesliste */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {days.map((dateKey, idx) => {
          const l = logsByDate?.[dateKey];
          const kcal = l?.meals?.reduce((s,m)=>s+(m.calories||0),0) || 0;
          const empty = !l || ((l.meals?.length||0)===0 && !l.water && !l.sleep && !l.energy);
          const isToday = idx === 0;
          return (
            <Card key={dateKey} onClick={()=>onJumpToDay?.(new Date(dateKey))} style={{
              opacity: empty ? 0.55 : 1,
              borderColor: isToday ? T.acc+"55" : T.borderS,
              padding:"14px 18px",
              cursor: onJumpToDay ? "pointer" : "default",
              transition: "all .15s"
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
                <div style={{ minWidth:0, flex:"0 0 auto" }}>
                  <div style={{ fontSize:13, color:isToday?T.acc:T.text, fontWeight:500 }}>
                    {labelFor(dateKey, idx)}
                  </div>
                  {!isToday && idx !== 1 && (
                    <div style={{ fontSize:10, color:T.muted, fontFamily:T.mono, letterSpacing:1, marginTop:2 }}>
                      {new Date(dateKey).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})}
                    </div>
                  )}
                </div>
                {empty ? (
                  <div style={{ color:T.muted, fontStyle:"italic", fontSize:12, fontFamily:T.serif }}>
                    Keine Einträge
                  </div>
                ) : (
                  <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
                    <div style={{ fontFamily:T.mono, fontSize:11, color:T.acc }}>
                      💧 {((l.water||0)*.25).toFixed(2)}<span style={{ color:T.muted }}>L</span>
                    </div>
                    <div style={{ fontFamily:T.mono, fontSize:11, color:T.mid }}>
                      😴 {l.sleep||"–"}<span style={{ color:T.muted }}>h</span>
                    </div>
                    <div style={{ fontFamily:T.mono, fontSize:11, color:T.gold }}>
                      🍽 {kcal}
                    </div>
                    <div style={{ fontSize:14 }}>{moodEmoji(l.energy)}</div>
                  </div>
                )}
              </div>
              {/* Tagebuch-Notiz wenn vorhanden */}
              {l?.note && (
                <div style={{
                  marginTop:10, paddingTop:10, borderTop:`1px solid ${T.border}`,
                  color:T.mid, fontSize:12, fontStyle:"italic", fontFamily:T.serif, lineHeight:1.6
                }}>
                  <span style={{ color:T.muted, fontFamily:T.mono, fontSize:9, letterSpacing:1, marginRight:6 }}>📝</span>
                  {l.note}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── TOOLS für EYLA-Chat ──────────────────────────────────────────────────────
// EYLA kann diese Tools im Chat aufrufen, um direkt im User-Datenmodell
// Änderungen zu machen (Mahlzeit eintragen, Wasser hochzählen, Termin anlegen,
// Einkaufsliste pflegen). Frontend führt sie lokal aus, sendet tool_result
// zurück und EYLA generiert ihre Antwort.
const EYLA_TOOLS = [
  {
    name: "add_meal",
    description: "Trag eine Mahlzeit in den heutigen Tageslog ein. " +
      "WICHTIG zur Zahlen-Interpretation: Wenn der User eine Zahl mit Einheit angibt " +
      "(z.B. '200g Steak', '500ml Saft', '2 Scheiben Brot', '1 Apfel'), ist das die MENGE – " +
      "NIEMALS in 'calories' eintragen! Die Menge gehört in 'amount' und in den 'name'. " +
      "Kalorien IMMER selbst schätzen basierend auf Lebensmittel + Menge " +
      "(z.B. 200g Rindersteak ≈ 500 kcal, nicht 200 kcal!). " +
      "Bei reinen Mengenangaben ohne Klarheit: lieber realistisch schätzen als 0 nehmen.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Mahlzeit inkl. Menge wenn bekannt, z.B. '200g Steak', '1 Apfel', 'Müsli mit Milch'" },
        amount: { type: "string", description: "Mengenangabe wenn vorhanden, z.B. '200g', '500ml', '2 Stück', '1 Portion'" },
        calories: { type: "number", description: "GESCHÄTZTE Kalorien (kcal) – NICHT die Menge! Z.B. 200g Steak ≈ 500 kcal." },
        protein: { type: "number", description: "Protein in g (geschätzt)" },
        carbs:   { type: "number", description: "Kohlenhydrate in g (geschätzt)" },
        fat:     { type: "number", description: "Fett in g (geschätzt)" }
      },
      required: ["name"]
    }
  },
  {
    name: "set_water",
    description: "Setze die heute getrunkene Wasser-Menge in 0.25L-Einheiten (1 = 0.25L, 4 = 1L, max 12 = 3L).",
    input_schema: {
      type: "object",
      properties: { units: { type: "number", description: "Anzahl 0.25L-Einheiten" } },
      required: ["units"]
    }
  },
  {
    name: "add_water",
    description: "Addiere oder subtrahiere Wasser in 0.25L-Einheiten (z.B. +2 für 0.5L mehr, oder Liter direkt umrechnen).",
    input_schema: {
      type: "object",
      properties: { delta: { type: "number", description: "Anzahl 0.25L-Einheiten (positiv oder negativ)" } },
      required: ["delta"]
    }
  },
  {
    name: "set_sleep",
    description: "Setze die Schlafdauer letzter Nacht.",
    input_schema: {
      type: "object",
      properties: { hours: { type: "string", description: "z.B. '7', '8', '9+'" } },
      required: ["hours"]
    }
  },
  {
    name: "set_energy",
    description: "Setze Energie/Stimmung. Genau einer der Werte: '💤 Erschöpft', '😴 Müde', '😐 Ok', '😊 Gut', '⚡ Energiegeladen'",
    input_schema: {
      type: "object",
      properties: { mood: { type: "string" } },
      required: ["mood"]
    }
  },
  {
    name: "set_weight",
    description: "Trag das heutige Körpergewicht in kg ein (z.B. 78.5).",
    input_schema: {
      type: "object",
      properties: { kg: { type: "number" } },
      required: ["kg"]
    }
  },
  {
    name: "add_workout",
    description: "Trag eine Trainingseinheit heute ein (z.B. wenn der User 'hab grad 30min joggen war' sagt).",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", description: "z.B. Beweglichkeit, Cardio, Kraft, Gehen, Yoga, Schwimmen" },
        duration: { type: "number", description: "Dauer in Minuten" },
        intensity: { type: "string", description: "leicht | mittel | hart (optional)" }
      },
      required: ["type", "duration"]
    }
  },
  {
    name: "toggle_habit",
    description: "Hak eine Gewohnheit für heute ab (oder wieder weg). Sucht per Teilstring-Match im Namen.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name (oder Teil) der Gewohnheit" },
        done: { type: "boolean", description: "true = abgehakt, false = nicht erledigt. Default true." }
      },
      required: ["name"]
    }
  },
  {
    name: "add_todo",
    description: "Trag eine Aufgabe / Todo ein. Wenn User sagt 'ich muss noch X', 'denk dran dass ich Y mache', 'erinnere mich an Z' – nutze dieses Tool. Priorität entscheiden: 'today' für heute/akut, 'week' für diese Woche, 'later' für Backlog/irgendwann.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Die Aufgabe als kurzer prägnanter Text" },
        priority: { type: "string", description: "today | week | later. Default today." }
      },
      required: ["text"]
    }
  },
  {
    name: "complete_todo",
    description: "Hak ein Todo als erledigt ab. Sucht per Teilstring-Match.",
    input_schema: {
      type: "object",
      properties: { match: { type: "string", description: "Text-Teil zum Matchen (z.B. 'Mama anrufen' findet 'Mama anrufen wegen Weihnachten')" } },
      required: ["match"]
    }
  },
  {
    name: "remove_todo",
    description: "Lösche ein Todo komplett (nicht nur abhaken). Sucht per Teilstring.",
    input_schema: {
      type: "object",
      properties: { match: { type: "string", description: "Text-Teil zum Matchen" } },
      required: ["match"]
    }
  },
  {
    name: "set_todo_priority",
    description: "Verschiebe ein Todo in ein anderes Bucket (today/week/later).",
    input_schema: {
      type: "object",
      properties: {
        match: { type: "string", description: "Text-Teil zum Matchen" },
        priority: { type: "string", description: "today | week | later" }
      },
      required: ["match", "priority"]
    }
  },
  {
    name: "find_free_slot",
    description: "Findet freie Lücken im Kalender für einen Tag (oder über mehrere Tage). Antwortet mit Zeiten in HH:MM. Nutzen wenn User sagt 'wann hab ich Zeit für X', 'plan mir 90min ein', 'wann ist Platz für Yoga'.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD (default heute)" },
        duration: { type: "number", description: "Mindestdauer in Minuten (z.B. 60)" },
        preferAfter: { type: "string", description: "Frühestens HH:MM (optional)" },
        preferBefore: { type: "string", description: "Spätestens HH:MM (optional)" }
      },
      required: ["duration"]
    }
  },
  {
    name: "move_event",
    description: "Verschiebe einen Termin auf eine andere Zeit/Tag. Sucht Termin per Teilstring im Titel.",
    input_schema: {
      type: "object",
      properties: {
        match: { type: "string", description: "Teilstring im Termin-Titel" },
        newTime: { type: "string", description: "Neue Uhrzeit HH:MM (optional)" },
        newDate: { type: "string", description: "Neues Datum YYYY-MM-DD (optional)" }
      },
      required: ["match"]
    }
  },
  {
    name: "delete_event",
    description: "Lösche einen Termin. Sucht per Teilstring im Titel. Vorsicht – fragt nicht nach.",
    input_schema: {
      type: "object",
      properties: { match: { type: "string", description: "Teilstring im Titel" } },
      required: ["match"]
    }
  },
  {
    name: "update_plan_preferences",
    description: "Aktualisiere die Plan-Präferenzen (was der User gerne/nicht isst, Frühstücks-Routine). Nutzen wenn User sagt 'ich esse kein Frühstück', 'jeden Tag Müsli zum Frühstück', 'ich mag keine Pilze', 'Mittag oft Bowl', etc. WICHTIG: nach Update sagen dass der User den Plan neu erstellen sollte (Profil → Plan-Wizard → 'Plan erstellen' oder einfach im Plan-Tab den 'Plan erstellen'-Button drücken).",
    input_schema: {
      type: "object",
      properties: {
        skipBreakfast:    { type: "boolean", description: "true wenn User KEIN Frühstück isst" },
        breakfastFixed:   { type: "string",  description: "Wenn User jeden Tag dasselbe Frühstück will – als Text" },
        breakfastVariety: { type: "string",  description: "'same' | 'rotate' | 'varied'" },
        addFavoriteLunch: { type: "string",  description: "Eine Mahlzeit zu Mittag-Favoriten hinzufügen" },
        addFavoriteDinner:{ type: "string",  description: "Eine Mahlzeit zu Abend-Favoriten hinzufügen" },
        dislikes:         { type: "string",  description: "Was der User nicht mag (komma-getrennt, ersetzt bisherige)" },
        quickOption:      { type: "string",  description: "Schnell-Mahlzeit wenn keine Zeit" }
      }
    }
  },
  {
    name: "modify_plan_meal",
    description: "Ändere eine einzelne Mahlzeit im aktuellen Plan. Nutzen wenn User sagt 'tausch Mittag am Mittwoch zu Pasta' oder 'lass Frühstück Montag weg'.",
    input_schema: {
      type: "object",
      properties: {
        day:  { type: "string", description: "Montag | Dienstag | Mittwoch | Donnerstag | Freitag | Samstag | Sonntag" },
        slot: { type: "string", description: "breakfast | lunch | dinner | snack" },
        meal: { type: "string", description: "Neue Mahlzeit (oder '—' zum Leeren)" }
      },
      required: ["day", "slot", "meal"]
    }
  },
  {
    name: "log_period_start",
    description: "Trag den Start der Periode ein. Default heute. Nutzen wenn User sagt 'meine Periode hat angefangen', 'Tag 1 heute', 'mens hat begonnen'.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD (default heute)" } }
    }
  },
  {
    name: "log_period_end",
    description: "Beende den letzten Periode-Eintrag (setze end-Datum). Nutzen wenn User sagt 'Periode ist vorbei', 'fertig'.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "daily_briefing",
    description: "Generiere einen Tages-Brief: was steht heute an (Termine + Todos + Plan + freie Slots). Nutzen wenn User sagt 'wie sieht heute aus', 'gib mir nen Überblick', 'tagesbrief', 'wie ist mein Tag'.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "add_event",
    description: "Trag einen Termin/Zeit-Block in den Kalender ein. Spannen ('von X bis Y') IMMER als duration in MINUTEN (z.B. 10-14 Uhr = 240min). 'time' ist die START-Zeit.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Was steht an" },
        time: { type: "string", description: "Startzeit HH:MM" },
        duration: { type: "number", description: "Dauer in MINUTEN als Zahl. Bsp: 10-14 Uhr → 240. 'ne Stunde → 60. 30min → 30. Default 60." },
        date: { type: "string", description: "YYYY-MM-DD. Default heute." }
      },
      required: ["title"]
    }
  },
  {
    name: "add_shopping_item",
    description: "Pack ein Item auf die Einkaufsliste. Wähl den passenden Gang.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        menge: { type: "string", description: "z.B. '500g', '2 Stk'" },
        gang: {
          type: "string",
          description: "Eine von: Obst & Gemüse, Brot & Backwaren, Molkerei & Kühlwaren, Fisch & Fleisch, Trockenwaren & Regal-Mitte, Haushalt"
        }
      },
      required: ["name", "gang"]
    }
  },
  {
    name: "check_shopping_item",
    description: "Hak ein Item auf der Einkaufsliste ab (gekauft markieren). Sucht per Teilstring-Match im Namen.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"]
    }
  }
];

// ─── PLAN SCREEN ──────────────────────────────────────────────────────────────
// Standard-Vorschläge für den Plan-Wizard (Multi-Select-Pool)
const PLAN_LUNCH_OPTIONS = [
  "Bowl mit Quinoa + Gemüse + Protein",
  "Salat mit Hähnchen + Avocado",
  "Pasta mit Tomatensauce + Gemüse",
  "Wraps mit Hummus + Falafel",
  "Asiatischer Reis mit Tofu + Gemüse",
  "Suppe + Vollkornbrot",
  "Linsenpfanne mit Reis",
  "Brot mit Aufstrich + Salat",
  "Mediterraner Teller (Falafel, Hummus, Salat)",
  "Ofengemüse mit Halloumi",
  "Couscous-Salat mit Kichererbsen",
  "Käse-Brot mit Tomatensalat",
];
const PLAN_DINNER_OPTIONS = [
  "Lachs mit Reis + Gemüse",
  "Steak mit Süßkartoffel + Brokkoli",
  "Ofengemüse mit Halloumi",
  "Stir-Fry mit Hühnchen + Reis",
  "Linsen-Dal mit Reis",
  "Pasta mit Pesto + Mozzarella",
  "Frittata mit Salat",
  "Buddha Bowl",
  "Suppe + Vollkornbrot",
  "Pizza vom Blech",
  "Curry mit Reis",
  "Wraps + Salat",
];

// ─── STUDIO SCREEN (Punkte / Shop / Ranking) ────────────────────────────────
function StudioScreen({ profile }) {
  const [sub, setSub] = useState("verdienen"); // verdienen | shop | ranking
  const [points, setPoints] = useState(loadPoints());
  useEffect(() => {
    function onChange() { setPoints(loadPoints()); }
    window.addEventListener("eyla_points_changed", onChange);
    return () => window.removeEventListener("eyla_points_changed", onChange);
  }, []);

  const lvl = getLevel(points.total);
  const mult = getMultiplier(points);
  const nextLvl = LEVELS.find(l => l.level === lvl.level + 1);
  const inLevelMin = lvl.min;
  const inLevelMax = nextLvl ? nextLvl.min : lvl.max;
  const lvlProgress = nextLvl ? Math.min(100, Math.round(((points.total - inLevelMin) / (inLevelMax - inLevelMin)) * 100)) : 100;
  const ptsToNext = nextLvl ? Math.max(0, nextLvl.min - points.total) : 0;

  // Heute
  const today = new Date().toDateString();
  const todayHist = (points.history || []).filter(h => new Date(h.ts).toDateString() === today);
  const earnedToday = todayHist.reduce((s, h) => s + (h.points || 0), 0);
  const doneToday = new Set(todayHist.map(h => h.action));
  const dailyActions = ["ems_training", "water_goal", "meals_logged", "perfect_day", "social_share", "steps"];
  const dayIcons = { ems_training:"⚡", water_goal:"💧", meals_logged:"🥗", perfect_day:"✨", social_share:"📸", steps:"👟" };
  const openToday = dailyActions.filter(a => !doneToday.has(a));

  // Nächste Belohnung
  const sortedShop = [...SHOP_ITEMS].sort((a, b) => a.pts - b.pts);
  const nextReward = sortedShop.find(it => it.pts > points.total) || sortedShop[sortedShop.length - 1];
  const canRedeemNow = points.total >= nextReward.pts;
  const rewardProgress = Math.min(100, Math.round((points.total / nextReward.pts) * 100));
  const rewardGap = Math.max(0, nextReward.pts - points.total);

  // Monats-Streak (EMS-Sessions)
  const thisMonth = new Date().getMonth();
  const emsThisMonth = (points.history || []).filter(h => h.action === "ems_training" && new Date(h.ts).getMonth() === thisMonth).length;
  const streakGoal = 8;

  return (
    <div>
      {/* HERO – Level + Punkte + Multiplikator + Fortschritt */}
      <Card style={{ marginBottom:12, background:`radial-gradient(120% 90% at 100% 0%, ${T.gold}18 0%, transparent 58%), ${T.card}`, border:`1px solid ${T.gold}44` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div style={{ minWidth:0 }}>
            <Lbl color={T.gold} style={{ marginBottom:4 }}>LEVEL {lvl.level} · {lvl.name.toUpperCase()}</Lbl>
            <div style={{ fontSize:30, fontWeight:300, color:T.text, fontFamily:T.mono, lineHeight:1 }}>
              {points.total.toLocaleString("de-DE")}<span style={{ fontSize:13, color:T.muted, marginLeft:6 }}>Pts</span>
            </div>
            <div style={{ fontSize:11, color: earnedToday>0 ? T.green : T.muted, fontFamily:T.serif, fontStyle:"italic", marginTop:5 }}>
              {earnedToday > 0 ? `heute +${earnedToday} Pts` : "heute noch nichts verdient"}
            </div>
          </div>
          <div style={{ textAlign:"right", flexShrink:0 }}>
            <div style={{ fontSize:24, fontWeight:900, color:T.gold, fontFamily:T.mono }}>×{mult}</div>
            <div style={{ fontSize:9, color:T.muted }}>Multiplikator</div>
          </div>
        </div>
        <div style={{ height:6, borderRadius:99, background:T.faint, overflow:"hidden" }}>
          <div style={{ width:`${lvlProgress}%`, height:"100%", background:`linear-gradient(90deg,${T.gold},${T.acc})`, boxShadow:`0 0 8px ${T.gold}66`, transition:"width .4s" }}/>
        </div>
        <div style={{ fontSize:10, color:T.muted, marginTop:6, fontFamily:T.serif, display:"flex", justifyContent:"space-between", gap:8 }}>
          <span>{nextLvl ? `${ptsToNext.toLocaleString("de-DE")} Pts bis Level ${nextLvl.level} · ${nextLvl.name}` : "Höchstes Level erreicht 🏆"}</span>
          <span style={{ whiteSpace:"nowrap" }}>Monat {Math.min(emsThisMonth, streakGoal)}/{streakGoal} 🔥</span>
        </div>
      </Card>

      {/* HEUTE HOLEN – offene Tagesaktionen */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <Lbl>HEUTE HOLEN</Lbl>
          <span style={{ fontFamily:T.mono, fontSize:9, color:T.muted, letterSpacing:1 }}>
            {dailyActions.length - openToday.length}/{dailyActions.length} ✓
          </span>
        </div>
        {openToday.length === 0 ? (
          <p style={{ color:T.green, fontSize:12, fontFamily:T.serif, fontStyle:"italic", margin:0 }}>
            Alles für heute geholt. Stark. 🏆
          </p>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
            {dailyActions.map(a => {
              const done = doneToday.has(a);
              return (
                <div key={a} style={{
                  display:"flex", alignItems:"center", gap:10, padding:"6px 0",
                  borderBottom:`1px solid ${T.border}`, opacity: done ? 0.45 : 1
                }}>
                  <span style={{ fontSize:15 }}>{dayIcons[a]}</span>
                  <span style={{ flex:1, fontSize:12, color:T.text, fontFamily:T.serif }}>
                    {POINT_LABELS[a]}{done ? " ✓" : ""}
                  </span>
                  <span style={{ fontFamily:T.mono, fontSize:12, fontWeight:700, color: done ? T.muted : T.gold }}>
                    +{POINT_VALUES[a]}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", fontFamily:T.serif, margin:"10px 0 0", lineHeight:1.5 }}>
          Training, Wasser & Mahlzeiten zählen automatisch – einfach im Tag eintragen.
        </p>
      </Card>

      {/* NÄCHSTE BELOHNUNG */}
      <Card style={{ marginBottom:16 }}>
        <Lbl style={{ marginBottom:10 }}>NÄCHSTE BELOHNUNG</Lbl>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
          <div style={{ fontSize:28, width:44, height:44, display:"grid", placeItems:"center", background:T.faint, borderRadius:12, flexShrink:0 }}>
            {nextReward.icon}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, color:T.text, fontFamily:T.serif }}>{nextReward.name}</div>
            <div style={{ fontSize:11, color: canRedeemNow ? T.green : T.muted, fontFamily:T.serif, fontStyle:"italic" }}>
              {canRedeemNow ? "✓ jetzt einlösbar" : `noch ${rewardGap.toLocaleString("de-DE")} Pts`}
            </div>
          </div>
          <div style={{ fontFamily:T.mono, fontSize:13, fontWeight:700, color:T.gold, flexShrink:0 }}>
            {nextReward.pts.toLocaleString("de-DE")}
          </div>
        </div>
        <div style={{ height:5, borderRadius:99, background:T.faint, overflow:"hidden", marginBottom:12 }}>
          <div style={{ width:`${rewardProgress}%`, height:"100%", background: canRedeemNow ? T.green : T.gold, transition:"width .4s" }}/>
        </div>
        <button onClick={()=>setSub("shop")} style={{
          width:"100%", background:T.green+"14", border:`1px solid ${T.green}44`, borderRadius:10,
          padding:"9px 0", color:T.green, fontFamily:T.mono, fontSize:11, letterSpacing:1.5, cursor:"pointer"
        }}>ZUM SHOP →</button>
      </Card>

      <SubTabRow current={sub} onChange={setSub} options={[
        { id:"verdienen", label:"Verdienen", color:T.gold },
        { id:"shop",      label:"Shop",      color:T.green },
        { id:"ranking",   label:"Ranking",   color:T.rose },
      ]}/>
      {sub==="verdienen" && <PunkteScreen profile={profile}/>}
      {sub==="shop"      && <ShopScreen profile={profile}/>}
      {sub==="ranking"   && <RankingScreen profile={profile}/>}
    </div>
  );
}

function WerbenCard({ profile }) {
  const [code] = useState(() => getRefCode(profile));
  const [points, setPoints] = useState(loadPoints());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const on = () => setPoints(loadPoints());
    window.addEventListener("eyla_points_changed", on);
    return () => window.removeEventListener("eyla_points_changed", on);
  }, []);
  const friends = points.friends || [];
  const shareText = `Komm mit mir ins EYLA Studio! 💪 Mit meinem Code ${code} bekommst du ein Probetraining. ${APP_URL}`;
  function doShare() {
    shareCard(
      { eyebrow:"Trainier mit mir", big:code, sub:"Code beim Probetraining zeigen", footer:APP_URL.replace("https://",""), accent:T.gold },
      shareText, "EYLA Studio – Einladung"
    );
  }
  function copyCode() {
    try { navigator.clipboard?.writeText(code); } catch {}
    setCopied(true); haptic(20); setTimeout(() => setCopied(false), 1400);
  }
  function logFriend() {
    const name = prompt("Wen hast du geworben? (Name – nur für deine Übersicht)", "");
    if (name === null) return;
    const pts = awardFriend(name.trim());
    haptic(40);
    alert(pts ? `🎉 +${pts} Pkt fürs Werben!${name.trim() ? " " + name.trim() : ""} ist eingetragen.\n\nDein Studio bestätigt die Werbung beim Probetraining.` : "Eingetragen.");
  }
  return (
    <Card style={{ marginBottom:12, background:`radial-gradient(120% 90% at 0% 0%, ${T.gold}14 0%, transparent 55%), ${T.card}`, border:`1px solid ${T.gold}33` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <Lbl>FREUNDE WERBEN</Lbl>
        <span style={{ background:T.gold+"18", border:`1px solid ${T.gold}33`, borderRadius:99, padding:"2px 8px", fontSize:9, color:T.gold, fontFamily:T.mono }}>+{POINT_VALUES.friend} Pts</span>
      </div>
      {/* Code-Box */}
      <div onClick={copyCode} style={{
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, cursor:"pointer",
        background:T.bg2, border:`1px dashed ${T.gold}55`, borderRadius:12, padding:"12px 14px", marginBottom:10
      }}>
        <div>
          <div style={{ fontSize:9, color:T.muted, fontFamily:T.mono, letterSpacing:1 }}>DEIN CODE</div>
          <div style={{ fontSize:22, fontWeight:800, color:T.gold, fontFamily:T.mono, letterSpacing:2 }}>{code}</div>
        </div>
        <span style={{ fontSize:11, color: copied ? T.green : T.muted, fontFamily:T.serif, fontStyle:"italic" }}>{copied ? "✓ kopiert" : "tippen zum Kopieren"}</span>
      </div>
      <button onClick={doShare} style={{
        width:"100%", padding:"11px", background:`linear-gradient(135deg,${T.gold},#C8920A)`,
        border:"none", borderRadius:11, color:T.bg, fontFamily:T.serif, fontSize:14, fontWeight:700, cursor:"pointer", marginBottom:8
      }}>📲 Einladung teilen</button>
      <button onClick={logFriend} style={{
        width:"100%", padding:"9px", background:"transparent", border:`1px solid ${T.borderS}`,
        borderRadius:10, color:T.text, fontFamily:T.serif, fontSize:12, cursor:"pointer"
      }}>＋ Geworbenen Freund eintragen</button>
      <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", fontFamily:T.serif, margin:"10px 0 0", lineHeight:1.5 }}>
        Jeder geworbene Freund bringt +{POINT_VALUES.friend} Pts und dauerhaft ×0,1 auf deinen Multiplikator (max +0,5).
      </p>
      {friends.length > 0 && (
        <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:6 }}>
          {friends.map((f, i) => (
            <span key={i} style={{ background:T.faint, border:`1px solid ${T.border}`, borderRadius:99, padding:"3px 10px", fontSize:11, color:T.text, fontFamily:T.serif }}>
              👥 {f.name || "Freund"} <span style={{ color:T.gold, fontFamily:T.mono, fontSize:9 }}>×0,1</span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function MeasurementsCard() {
  const [items, setItems] = useState(loadMeasurements());
  const [mode, setMode] = useState(null);     // null | "add" | "import"
  const [draft, setDraft] = useState({ date: new Date().toISOString().slice(0,10), values:{} });
  const [csv, setCsv] = useState("");
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const on = () => setItems(loadMeasurements());
    window.addEventListener("eyla_measurements_changed", on);
    return () => window.removeEventListener("eyla_measurements_changed", on);
  }, []);

  const latest = items[items.length-1];
  const prev = items[items.length-2];
  const presentKeys = METRIC_DEFS.filter(d => items.some(e => e.values?.[d.key] != null)).map(d => d.key);
  const selDef = METRIC_DEFS.find(d => d.key === sel);
  const series = sel ? items.filter(e => e.values?.[sel] != null).map(e => ({ date:e.date, v:e.values[sel] })) : [];

  const iStyle = { width:"100%", background:T.bg, border:`1px solid ${T.borderS}`, borderRadius:9,
    padding:"9px 11px", color:T.text, fontSize:13, fontFamily:T.mono, outline:"none", boxSizing:"border-box" };

  function saveAdd() {
    const vals = {};
    for (const d of METRIC_DEFS) {
      const raw = draft.values[d.key];
      if (raw !== "" && raw != null) { const n = parseFloat(String(raw).replace(",", ".")); if (!isNaN(n)) vals[d.key] = n; }
    }
    if (!Object.keys(vals).length) { setMsg("Trag mindestens einen Wert ein."); setTimeout(()=>setMsg(""),3000); return; }
    setItems(saveMeasurements(mergeMeasurements(items, [{ id:"m_"+Date.now(), date: draft.date, values: vals }])));
    setDraft({ date: new Date().toISOString().slice(0,10), values:{} });
    setMode(null); haptic(30);
  }
  function doImport() {
    const { entries, cols } = parseMeasurementsCSV(csv);
    if (!entries.length) { setMsg("Keine Zeilen erkannt. Erwartet: Kopfzeile mit 'Datum' + Spalten wie Gewicht, Taille, Hüfte …"); setTimeout(()=>setMsg(""),6000); return; }
    setItems(saveMeasurements(mergeMeasurements(items, entries)));
    setCsv(""); setMode(null); haptic(40);
    setMsg(`✓ ${entries.length} Einträge importiert · ${cols.map(k => METRIC_DEFS.find(d=>d.key===k)?.label || k).join(", ") || "keine Spalten erkannt"}`);
    setTimeout(()=>setMsg(""), 6000);
  }
  function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => setCsv(String(r.result || "")); r.readAsText(f);
  }

  return (
    <Card style={{ marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: items.length ? 12 : 8 }}>
        <Lbl>KÖRPERMASSE{items.length ? ` · ${items.length}` : ""}</Lbl>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={()=>{ setMode(mode==="add"?null:"add"); setMsg(""); }} style={{ background: mode==="add"?T.acc+"22":"transparent", border:`1px solid ${mode==="add"?T.acc:T.borderS}`, borderRadius:8, padding:"4px 10px", color: mode==="add"?T.text:T.muted, fontFamily:T.serif, fontSize:11, cursor:"pointer" }}>＋ Eintrag</button>
          <button onClick={()=>{ setMode(mode==="import"?null:"import"); setMsg(""); }} style={{ background: mode==="import"?T.acc+"22":"transparent", border:`1px solid ${mode==="import"?T.acc:T.borderS}`, borderRadius:8, padding:"4px 10px", color: mode==="import"?T.text:T.muted, fontFamily:T.serif, fontSize:11, cursor:"pointer" }}>⇪ Import</button>
        </div>
      </div>

      {msg && <div style={{ fontSize:11, color: msg.startsWith("✓")?T.green:T.gold, fontFamily:T.serif, marginBottom:10, lineHeight:1.5 }}>{msg}</div>}

      {/* Empty state */}
      {items.length === 0 && mode === null && (
        <p style={{ color:T.muted, fontSize:12, fontStyle:"italic", fontFamily:T.serif, margin:0, lineHeight:1.6 }}>
          Noch keine Maße. Trag deine Werte ein – oder importiere deine Excel (als CSV exportieren) über „⇪ Import".
        </p>
      )}

      {/* Chips */}
      {items.length > 0 && mode === null && (
        <>
          <div style={{ fontSize:10, color:T.muted, fontFamily:T.mono, marginBottom:8 }}>
            Letzte Messung · {new Date(latest.date).toLocaleDateString("de-DE",{day:"2-digit",month:"short",year:"numeric"})}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {presentKeys.map(key => {
              const def = METRIC_DEFS.find(d => d.key === key);
              const cur = latest.values?.[key];
              const before = prev?.values?.[key];
              const delta = (cur != null && before != null) ? +(cur - before).toFixed(1) : null;
              // Bei Umfängen/Fett ist runter = grün, bei Muskel rauf = grün
              const goodDown = key !== "muscle";
              const dColor = delta == null || delta === 0 ? T.muted : ((delta < 0) === goodDown ? T.green : T.gold);
              const active = sel === key;
              return (
                <button key={key} onClick={()=>setSel(active?null:key)} style={{
                  textAlign:"left", background: active?T.acc+"14":T.bg2, border:`1px solid ${active?T.acc:T.border}`,
                  borderRadius:11, padding:"9px 11px", cursor:"pointer"
                }}>
                  <div style={{ fontSize:10, color:T.muted, fontFamily:T.serif }}>{def.label}</div>
                  <div style={{ fontSize:17, color:T.text, fontFamily:T.mono, fontWeight:300 }}>
                    {cur}<span style={{ fontSize:9, color:T.muted, marginLeft:2 }}>{def.unit}</span>
                  </div>
                  {delta != null && delta !== 0 && (
                    <div style={{ fontSize:9, color:dColor, fontFamily:T.mono }}>{delta>0?"+":""}{delta} {def.unit}</div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Sparkline für ausgewählte Metrik */}
          {sel && series.length >= 2 && (() => {
            const vals = series.map(s => s.v);
            const min = Math.min(...vals), max = Math.max(...vals), range = Math.max(0.001, max-min);
            const W = 100, H = 40;
            const pts = series.map((s,i)=>`${((i/(series.length-1))*W).toFixed(1)},${(H-((s.v-min)/range)*H).toFixed(1)}`).join(" ");
            const first = vals[0], last = vals[vals.length-1], d = +(last-first).toFixed(1);
            return (
              <div style={{ marginTop:10, padding:"10px 12px", background:T.bg2, borderRadius:11, border:`1px solid ${T.border}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                  <span style={{ fontSize:11, color:T.text, fontFamily:T.serif }}>{selDef.label}-Verlauf · {series.length}×</span>
                  <span style={{ fontSize:10, color: d===0?T.muted:((d<0)===(sel!=="muscle")?T.green:T.gold), fontFamily:T.mono }}>
                    {d>0?"+":""}{d} {selDef.unit} gesamt
                  </span>
                </div>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width:"100%", height:60, display:"block" }}>
                  <polyline points={pts} fill="none" stroke={T.acc} strokeWidth="0.8" strokeLinejoin="round" strokeLinecap="round"/>
                  {series.map((s,i)=>{ const x=(i/(series.length-1))*W, y=H-((s.v-min)/range)*H; return <circle key={i} cx={x} cy={y} r="1" fill={T.acc}/>; })}
                </svg>
              </div>
            );
          })()}
        </>
      )}

      {/* Eintrag-Form */}
      {mode === "add" && (
        <div>
          <Lbl style={{ marginBottom:6, fontSize:10 }}>DATUM</Lbl>
          <input type="date" value={draft.date} onChange={e=>setDraft(d=>({...d, date:e.target.value}))} style={{...iStyle, marginBottom:10}}/>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {METRIC_DEFS.map(def => (
              <div key={def.key}>
                <Lbl style={{ marginBottom:4, fontSize:9 }}>{def.label.toUpperCase()} ({def.unit})</Lbl>
                <input type="number" inputMode="decimal" step="0.1" value={draft.values[def.key] ?? ""}
                  onChange={e=>setDraft(d=>({...d, values:{...d.values, [def.key]: e.target.value}}))}
                  placeholder="–" style={iStyle}/>
              </div>
            ))}
          </div>
          <button onClick={saveAdd} style={{ width:"100%", marginTop:12, padding:"11px", background:`linear-gradient(135deg,${T.dim},${T.acc})`, border:"none", borderRadius:11, color:T.bg, fontFamily:T.serif, fontSize:13, fontWeight:700, cursor:"pointer" }}>Speichern</button>
        </div>
      )}

      {/* Import-Form */}
      {mode === "import" && (
        <div>
          <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 10px", lineHeight:1.6 }}>
            Excel → „Speichern unter" → CSV. Datei wählen oder Inhalt einfügen. Erste Zeile = Spaltenköpfe (Datum, Gewicht, Taille, Hüfte …).
          </p>
          <label style={{ display:"block", marginBottom:10 }}>
            <input type="file" accept=".csv,text/csv,text/plain,.tsv" onChange={onFile} style={{ fontSize:12, color:T.text, fontFamily:T.serif }}/>
          </label>
          <textarea value={csv} onChange={e=>setCsv(e.target.value)} rows={5}
            placeholder={"Datum;Gewicht;Taille;Hüfte\n01.03.2026;82,4;88;102\n01.04.2026;80,1;85;100"}
            style={{ ...iStyle, fontFamily:T.mono, fontSize:11, resize:"vertical", lineHeight:1.5 }}/>
          <button onClick={doImport} disabled={!csv.trim()} style={{ width:"100%", marginTop:10, padding:"11px", background: csv.trim()?`linear-gradient(135deg,${T.dim},${T.acc})`:T.faint, border:"none", borderRadius:11, color: csv.trim()?T.bg:T.muted, fontFamily:T.serif, fontSize:13, fontWeight:700, cursor: csv.trim()?"pointer":"default" }}>Importieren</button>
        </div>
      )}
    </Card>
  );
}

function PunkteScreen({ profile }) {
  const [points, setPoints] = useState(loadPoints());
  useEffect(() => {
    function onChange() { setPoints(loadPoints()); }
    window.addEventListener("eyla_points_changed", onChange);
    return () => window.removeEventListener("eyla_points_changed", onChange);
  }, []);
  const mult = getMultiplier(points);
  // Monats-Streak: Sessions im aktuellen Monat (aus history ems_training)
  const thisMonth = new Date().getMonth();
  const emsThisMonth = (points.history||[]).filter(h => h.action==="ems_training" && new Date(h.ts).getMonth()===thisMonth).length;
  const streakGoal = 8;

  return (
    <div>
      {/* VERDIENEN */}
      <Card style={{ marginBottom:12 }}>
        <Lbl style={{ marginBottom:10 }}>SO VERDIENST DU PUNKTE</Lbl>
        {Object.entries(POINT_VALUES).map(([action, base]) => {
          const todayDone = ONCE_PER_DAY.has(action) && (points.history||[]).some(h => h.action===action && new Date(h.ts).toDateString()===new Date().toDateString());
          const icon = { ems_training:"⚡", punctual:"📅", offpeak:"🌙", friend:"👥", social_share:"📸", water_goal:"💧", meals_logged:"🥗", steps:"👟", perfect_day:"✨" }[action];
          return (
            <div key={action} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:`1px solid ${T.border}`, opacity: todayDone ? 0.5 : 1 }}>
              <span style={{ fontSize:15 }}>{icon}</span>
              <span style={{ flex:1, fontSize:12, color:T.text, fontFamily:T.serif }}>{POINT_LABELS[action]}{todayDone ? " ✓" : ""}</span>
              <span style={{ fontFamily:T.mono, fontSize:12, fontWeight:700, color:T.gold }}>+{base}</span>
            </div>
          );
        })}
        <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", fontFamily:T.serif, margin:"10px 0 0", lineHeight:1.5 }}>
          Punkte werden mit deinem Multiplikator (×{mult}) verrechnet. Training, Wasser & Mahlzeiten zählen automatisch.
        </p>
      </Card>

      {/* FREUNDE WERBEN */}
      <WerbenCard profile={profile}/>

      {/* MONATS-STREAK */}
      <Card style={{ marginBottom:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <Lbl>MONATS-STREAK</Lbl>
          <span style={{ fontFamily:T.mono, fontSize:11, color:T.muted }}>{Math.min(emsThisMonth, streakGoal)} / {streakGoal} 🔥</span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(8,1fr)", gap:4 }}>
          {Array.from({length:streakGoal}).map((_, i) => (
            <div key={i} style={{
              aspectRatio:"1", borderRadius:6,
              background: i < emsThisMonth ? `linear-gradient(${T.dim},${T.acc})` : T.faint,
              display:"grid", placeItems:"center",
              color: i < emsThisMonth ? T.gold : T.muted, fontSize:11,
              boxShadow: i < emsThisMonth ? `0 3px 10px -3px ${T.acc}44` : "none"
            }}>{i < emsThisMonth ? "⚡" : ""}</div>
          ))}
        </div>
        <div style={{ fontSize:10, color:T.muted, marginTop:7, fontFamily:T.serif }}>
          {emsThisMonth >= streakGoal ? "Monatsziel erreicht! 🏆" : `Noch ${streakGoal - emsThisMonth} Sessions bis zur Streak-Prämie`}
        </div>
      </Card>
    </div>
  );
}

function ShopScreen({ profile }) {
  const [points, setPoints] = useState(loadPoints());
  const [filter, setFilter] = useState("alle");
  useEffect(() => {
    function onChange() { setPoints(loadPoints()); }
    window.addEventListener("eyla_points_changed", onChange);
    return () => window.removeEventListener("eyla_points_changed", onChange);
  }, []);

  function redeem(item) {
    if (points.total < item.pts) { alert(`Dir fehlen ${(item.pts - points.total).toLocaleString("de-DE")} Punkte für ${item.name}.`); return; }
    const extra = item.addEur ? `\n+ ${item.addEur} € Zuzahlung an der Theke.` : "";
    if (!confirm(`${item.name} für ${item.pts.toLocaleString("de-DE")} Pts einlösen?${extra}\n\nZeig den Bestätigungs-Screen an der Theke.`)) return;
    const p = loadPoints();
    p.total -= item.pts;
    p.redeemed = [{ item: item.name, points: item.pts, ts: Date.now() }, ...(p.redeemed || [])].slice(0, 50);
    savePoints(p);
    haptic(40);
    alert(`✓ ${item.name} eingelöst! Zeig das dem Studio-Team.`);
  }

  const cats = ["A","B","C"];
  const eurValue = (points.total / 100).toFixed(2);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:18, marginBottom:20 }}>
        <EylaOrb size={48}/>
        <div style={{ flex:1, minWidth:0 }}>
          <Lbl style={{ marginBottom:5 }}>SHOP</Lbl>
          <h2 style={{ fontSize:22, fontWeight:300, color:T.text, margin:0 }}>Punkte einlösen</h2>
        </div>
      </div>

      {/* Wallet */}
      <Card style={{ marginBottom:12, background:`linear-gradient(90deg, ${T.green}22, ${T.green}06)`, border:`1px solid ${T.green}33`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <Lbl style={{ marginBottom:3 }}>GUTHABEN</Lbl>
          <div style={{ fontSize:24, fontWeight:800, color:T.green, fontFamily:T.mono }}>{points.total.toLocaleString("de-DE")} <span style={{ fontSize:12 }}>Pts</span></div>
          <div style={{ fontSize:10, color:T.gold, fontFamily:T.mono }}>≈ {eurValue} €</div>
        </div>
        <div style={{ textAlign:"right", fontSize:10, color:T.muted, fontFamily:T.serif, fontStyle:"italic", maxWidth:120 }}>
          1.000 Pts ≈ 10 €<br/>Punkte verfallen nach 12 Monaten
        </div>
      </Card>

      {/* Filter */}
      <div style={{ display:"flex", gap:6, marginBottom:12, overflowX:"auto" }}>
        {["alle","A","B","C"].map(c => (
          <button key={c} onClick={()=>setFilter(c)} style={{
            padding:"5px 12px", borderRadius:99, whiteSpace:"nowrap",
            background: filter===c ? T.acc+"22" : "transparent",
            border:`1px solid ${filter===c ? T.acc : T.borderS}`,
            color: filter===c ? T.text : T.muted, fontFamily:T.serif, fontSize:11, cursor:"pointer"
          }}>{c==="alle" ? "Alle" : `${SHOP_CAT_LABELS[c]} (${c})`}</button>
        ))}
      </div>

      {cats.filter(c => filter==="alle" || filter===c).map(cat => (
        <div key={cat} style={{ marginBottom:8 }}>
          <div style={{ fontFamily:T.mono, fontSize:9, letterSpacing:2, textTransform:"uppercase", color: cat==="A"?T.green:cat==="B"?T.gold:T.rose, margin:"8px 2px 6px" }}>
            ● Kategorie {cat} — {SHOP_CAT_LABELS[cat]}
          </div>
          {SHOP_ITEMS.filter(i => i.cat===cat).map(item => {
            const affordable = points.total >= item.pts;
            return (
              <button key={item.id} onClick={()=>redeem(item)} style={{
                width:"100%", display:"flex", alignItems:"center", gap:12,
                background: T.card, border:`1px solid ${affordable ? T.borderS : T.border}`,
                borderRadius:14, padding:"11px 12px", marginBottom:7, cursor:"pointer",
                opacity: affordable ? 1 : 0.55, textAlign:"left", transition:"all .15s"
              }}>
                <div style={{ width:38, height:38, borderRadius:10, background:T.bg2, display:"grid", placeItems:"center", fontSize:19, flexShrink:0 }}>{item.icon}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:T.text }}>{item.name}</div>
                  <div style={{ fontSize:9, color:T.muted, marginTop:1, fontFamily:T.serif }}>{item.sub}</div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div style={{ fontFamily:T.mono, fontSize:13, fontWeight:800, color: cat==="A"?T.green:cat==="B"?T.gold:T.rose }}>{item.pts.toLocaleString("de-DE")}</div>
                  <div style={{ fontSize:8, color:T.muted }}>{item.addEur ? `+${item.addEur} €` : item.eur ? `≈ ${item.eur},00 €` : "Pts"}</div>
                </div>
              </button>
            );
          })}
        </div>
      ))}

      {/* Eingelöst-History */}
      {points.redeemed?.length > 0 && (
        <Card style={{ marginTop:8 }}>
          <Lbl style={{ marginBottom:8 }}>ZULETZT EINGELÖST</Lbl>
          {points.redeemed.slice(0, 5).map((r, i) => (
            <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom: i<Math.min(4,points.redeemed.length-1)?`1px solid ${T.border}`:"none", fontSize:11 }}>
              <span style={{ color:T.text, fontFamily:T.serif }}>{r.item}</span>
              <span style={{ color:T.muted, fontFamily:T.mono }}>−{r.points} · {new Date(r.ts).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function RankingScreen({ profile }) {
  const [points, setPoints] = useState(loadPoints());
  const [scope, setScope] = useState("monat"); // monat | gesamt | freunde
  useEffect(() => {
    function onChange() { setPoints(loadPoints()); }
    window.addEventListener("eyla_points_changed", onChange);
    return () => window.removeEventListener("eyla_points_changed", onChange);
  }, []);

  // Demo-Mitglieder (lokal — echtes Ranking braucht Backend, kommt später)
  const firstName = (profile?.name || "Du").split(" ")[0];
  const demoMembers = [
    { name:"Finn B.",  av:"😎", pts:1940, sub:"Champion · 12 Sessions" },
    { name:"Lea K.",   av:"💪", pts:1510, sub:"Performer · 10 Sessions" },
    { name:"Mia S.",   av:"🔥", pts:1330, sub:"Performer · 9 Sessions" },
    { name:"Tom R.",   av:"⚡", pts:900,  sub:"Mover · 7 Sessions" },
    { name:"Nora P.",  av:"🌟", pts:840,  sub:"Mover · 6 Sessions" },
    { name:"Jan W.",   av:"🦾", pts:610,  sub:"Mover · 5 Sessions" },
    { name:"Kim T.",   av:"✨", pts:420,  sub:"Starter · 4 Sessions" },
  ];
  const me = { name:`${firstName} (Du)`, av:firstName[0]?.toUpperCase()||"D", pts:points.total, sub:`${getLevel(points.total).name} · ×${getMultiplier(points)}`, isMe:true };
  const ranked = [...demoMembers, me].sort((a,b) => b.pts - a.pts);
  const myRank = ranked.findIndex(m => m.isMe) + 1;
  const ahead = myRank > 1 ? ranked[myRank-2] : null;
  const ptsToNext = ahead ? ahead.pts - points.total : 0;

  function shareSession() {
    const lvl = getLevel(points.total);
    const text = `Platz #${myRank} im EYLA Studio-Ranking mit ${points.total} Punkten 💪 ${APP_URL}`;
    shareCard(
      { eyebrow:`${lvl.name} · ×${getMultiplier(points)}`, big:`Platz #${myRank}`, sub:`${points.total.toLocaleString("de-DE")} Punkte`, footer:APP_URL.replace("https://","") },
      text, "Mein Studio-Ranking"
    );
    awardPoints("social_share");
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:18, marginBottom:20 }}>
        <EylaOrb size={48}/>
        <div style={{ flex:1, minWidth:0 }}>
          <Lbl style={{ marginBottom:5 }}>RANKING</Lbl>
          <h2 style={{ fontSize:22, fontWeight:300, color:T.text, margin:0 }}>Studio-Wettbewerb</h2>
        </div>
      </div>

      <div style={{ display:"flex", gap:6, marginBottom:12 }}>
        {[["monat","Dieser Monat"],["gesamt","Gesamt"],["freunde","Freunde"]].map(([id,lbl]) => (
          <button key={id} onClick={()=>setScope(id)} style={{
            padding:"5px 12px", borderRadius:99,
            background: scope===id ? T.acc+"22" : "transparent",
            border:`1px solid ${scope===id ? T.acc : T.borderS}`,
            color: scope===id ? T.text : T.muted, fontFamily:T.serif, fontSize:11, cursor:"pointer"
          }}>{lbl}</button>
        ))}
      </div>

      {/* Meine Position */}
      <Card style={{ marginBottom:12, background:`radial-gradient(110% 90% at 100% 0%, ${T.acc}14 0%, transparent 55%), ${T.card}`, border:`1px solid ${T.acc}33` }}>
        <Lbl style={{ marginBottom:6 }}>DEINE POSITION</Lbl>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ fontSize:30, fontWeight:900, color:T.acc, fontFamily:T.mono }}>#{myRank}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.text }}>von {ranked.length} Mitgliedern</div>
            <div style={{ fontSize:9, color:T.muted, marginTop:1, fontFamily:T.serif }}>
              {ahead ? `${ptsToNext.toLocaleString("de-DE")} Pts bis Platz ${myRank-1} 🎯` : "Du führst! 🏆"}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:9, color:T.muted }}>Deine Pts</div>
            <div style={{ fontSize:18, fontWeight:800, color:T.acc, fontFamily:T.mono }}>{points.total.toLocaleString("de-DE")}</div>
          </div>
        </div>
      </Card>

      {/* Liste */}
      <Card style={{ marginBottom:12 }}>
        {ranked.slice(0, 8).map((m, i) => {
          const rank = i + 1;
          const medal = rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":String(rank);
          return (
            <div key={m.name} style={{
              display:"flex", alignItems:"center", gap:10, padding:"8px 0",
              borderBottom: i < Math.min(7, ranked.length-1) ? `1px solid ${T.border}` : "none",
              ...(m.isMe ? { background:`linear-gradient(90deg, ${T.acc}12, transparent)`, borderRadius:10, margin:"0 -7px", padding:"8px 7px" } : {})
            }}>
              <div style={{ width:20, textAlign:"center", fontSize: rank<=3?14:11, fontWeight:800, color: rank<=3?T.gold:T.muted, flexShrink:0 }}>{medal}</div>
              <div style={{ width:26, height:26, borderRadius:"50%", background: m.isMe?T.dim:T.bg2, display:"grid", placeItems:"center", fontSize:13, color:T.text, flexShrink:0 }}>{m.av}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:11, fontWeight:600, color: m.isMe?T.acc:T.text }}>{m.name}{m.isMe?" 🌟":""}</div>
                <div style={{ fontSize:9, color:T.muted, fontFamily:T.serif }}>{m.sub}</div>
              </div>
              <div style={{ fontFamily:T.mono, fontSize:12, fontWeight:800, color: m.isMe?T.acc:T.mid }}>{m.pts.toLocaleString("de-DE")}</div>
            </div>
          );
        })}
        <p style={{ color:T.muted, fontSize:9, fontStyle:"italic", fontFamily:T.serif, margin:"10px 0 0", lineHeight:1.5 }}>
          Demo-Mitglieder. Echtes Studio-Ranking über alle Mitglieder kommt mit dem Backend.
        </p>
      </Card>

      {/* Share */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <Lbl>SESSION TEILEN</Lbl>
          <span style={{ background:T.gold+"18", border:`1px solid ${T.gold}33`, borderRadius:99, padding:"2px 8px", fontSize:9, color:T.gold, fontFamily:T.mono }}>+{POINT_VALUES.social_share} Pts</span>
        </div>
        <button onClick={shareSession} style={{
          width:"100%", padding:"10px", background:`linear-gradient(135deg,${T.dim},${T.acc})`,
          border:"none", borderRadius:11, color:T.bg, fontFamily:T.serif, fontSize:13, fontWeight:700, cursor:"pointer"
        }}>📲 Mein Ranking teilen</button>
      </Card>
    </div>
  );
}

function PlanWizard({ profile, onSave, onCancel }) {
  const existing = profile?.planPreferences || {};
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState({
    breakfastFixed:    existing.breakfastFixed || "",
    breakfastVariety:  existing.breakfastVariety || "same",  // "same" | "rotate" | "varied"
    favoriteLunches:   existing.favoriteLunches || [],
    favoriteDinners:   existing.favoriteDinners || [],
    quickOption:       existing.quickOption || "",
    dislikes:          existing.dislikes || "",
    customLunch:       "",
    customDinner:      "",
  });
  function patch(p) { setPrefs(x => ({...x, ...p})); }
  function toggle(key, value) {
    setPrefs(x => {
      const arr = x[key] || [];
      return {...x, [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]};
    });
  }
  function addCustomLunch() {
    const v = prefs.customLunch.trim();
    if (!v) return;
    patch({ favoriteLunches: [...(prefs.favoriteLunches||[]), v], customLunch:"" });
  }
  function addCustomDinner() {
    const v = prefs.customDinner.trim();
    if (!v) return;
    patch({ favoriteDinners: [...(prefs.favoriteDinners||[]), v], customDinner:"" });
  }

  const steps = [
    { title:"Lass uns deine Routinen abklopfen", sub:"5 kurze Fragen — dann passt der Plan zu dir, nicht andersrum." },
    { title:"Frühstück", sub:"Hast du eines das du oft isst?" },
    { title:"Mittag-Favoriten", sub:"Was magst du am häufigsten? (max 5 wählen)" },
    { title:"Abend-Favoriten", sub:"Und abends? (max 5)" },
    { title:"Schnell-Optionen", sub:"Wenn keine Zeit oder Lust — was geht dann?" },
    { title:"Letzte Frage", sub:"Was magst du gar nicht?" },
  ];

  function finish() {
    onSave({
      breakfastFixed: prefs.breakfastFixed.trim() || null,
      breakfastVariety: prefs.breakfastVariety,
      favoriteLunches: prefs.favoriteLunches.slice(0, 5),
      favoriteDinners: prefs.favoriteDinners.slice(0, 5),
      quickOption: prefs.quickOption.trim() || null,
      dislikes: prefs.dislikes.trim() || null,
      completedAt: new Date().toISOString(),
    });
  }

  const iStyle = { width:"100%", background:T.bg, border:`1px solid ${T.borderS}`, borderRadius:10,
    padding:"10px 14px", color:T.text, fontSize:13, fontFamily:T.serif, fontStyle:"italic",
    outline:"none", boxSizing:"border-box" };

  const cur = steps[step];

  return (
    <div onClick={onCancel} style={{
      position:"fixed", inset:0, zIndex:1200, background:"rgba(0,0,0,0.75)",
      backdropFilter:"blur(10px)", display:"flex", alignItems:"center", justifyContent:"center", padding:20,
      animation:"fadeUp .3s ease both"
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:T.bg2, border:`1px solid ${T.gold}55`, borderRadius:16,
        padding:24, maxWidth:440, width:"100%", maxHeight:"85vh", overflowY:"auto",
        boxShadow:`0 10px 60px ${T.gold}33`
      }}>
        {/* Progress */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
          <Lbl color={T.gold}>PLAN-WIZARD · {step+1}/{steps.length}</Lbl>
          {step > 0 && (
            <span style={{ fontFamily:T.mono, fontSize:10, color:T.muted }}>{Math.round(step/(steps.length-1)*100)}%</span>
          )}
        </div>
        <div style={{ height:3, background:T.bg, borderRadius:2, marginBottom:14, overflow:"hidden" }}>
          <div style={{ width:`${(step/(steps.length-1))*100}%`, height:"100%", background:T.gold, transition:"width .3s" }}/>
        </div>

        <h2 style={{ fontSize:20, fontWeight:300, color:T.text, margin:"0 0 4px", fontFamily:T.serif }}>{cur.title}</h2>
        <p style={{ color:T.mid, fontSize:12, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 18px" }}>{cur.sub}</p>

        {step === 0 && (
          <div style={{ textAlign:"center", padding:"10px 0" }}>
            <div style={{ fontSize:42, marginBottom:10 }}>✦</div>
            <p style={{ color:T.text, fontSize:14, fontFamily:T.serif, lineHeight:1.7 }}>
              Statt jeden Tag ein Zufallsplan — sag mir was du wirklich isst.<br/>
              Dann wird der Plan langweilig genug um durchgehalten zu werden.
            </p>
          </div>
        )}

        {step === 1 && (
          <div>
            <Lbl style={{ marginBottom:10 }}>VARIATION</Lbl>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:14 }}>
              {[
                {id:"same",   label:"Jeden Tag gleich"},
                {id:"rotate", label:"2-3 rotieren"},
                {id:"varied", label:"Variiert"},
              ].map(o => {
                const sel = prefs.breakfastVariety===o.id;
                return (
                  <button key={o.id} onClick={()=>patch({breakfastVariety:o.id})} style={{
                    background:sel?T.gold+"22":"transparent", border:`1px solid ${sel?T.gold:T.borderS}`,
                    borderRadius:10, padding:"10px 4px", color:sel?T.text:T.muted,
                    fontFamily:T.serif, fontSize:11, cursor:"pointer", fontStyle:sel?"normal":"italic"
                  }}>{o.label}</button>
                );
              })}
            </div>
            {prefs.breakfastVariety === "same" && (
              <>
                <Lbl style={{ marginBottom:8 }}>WAS GENAU?</Lbl>
                <input value={prefs.breakfastFixed} onChange={e=>patch({breakfastFixed:e.target.value})}
                  placeholder='z.B. "Müsli mit Joghurt und Beeren"' style={iStyle}/>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
              {[...PLAN_LUNCH_OPTIONS, ...prefs.favoriteLunches.filter(x => !PLAN_LUNCH_OPTIONS.includes(x))].map(opt => {
                const sel = prefs.favoriteLunches.includes(opt);
                return (
                  <button key={opt} onClick={()=>toggle("favoriteLunches", opt)} style={{
                    background:sel?T.gold+"22":"transparent", border:`1px solid ${sel?T.gold:T.borderS}`,
                    borderRadius:18, padding:"5px 12px", color:sel?T.text:T.muted,
                    fontFamily:T.serif, fontSize:12, cursor:"pointer", fontStyle:sel?"normal":"italic"
                  }}>{sel?"✓ ":""}{opt}</button>
                );
              })}
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <input value={prefs.customLunch} onChange={e=>patch({customLunch:e.target.value})}
                onKeyDown={e=>e.key==="Enter"&&addCustomLunch()}
                placeholder="Eigenes hinzufügen" style={{...iStyle, flex:1}}/>
              <button onClick={addCustomLunch} disabled={!prefs.customLunch.trim()} style={{
                background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:10,
                padding:"0 14px", color:prefs.customLunch.trim()?T.gold:T.muted,
                fontFamily:T.mono, fontSize:14, cursor:prefs.customLunch.trim()?"pointer":"default"
              }}>+</button>
            </div>
            <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", marginTop:8, fontFamily:T.serif }}>
              {prefs.favoriteLunches.length}/5 ausgewählt
            </p>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
              {[...PLAN_DINNER_OPTIONS, ...prefs.favoriteDinners.filter(x => !PLAN_DINNER_OPTIONS.includes(x))].map(opt => {
                const sel = prefs.favoriteDinners.includes(opt);
                return (
                  <button key={opt} onClick={()=>toggle("favoriteDinners", opt)} style={{
                    background:sel?T.gold+"22":"transparent", border:`1px solid ${sel?T.gold:T.borderS}`,
                    borderRadius:18, padding:"5px 12px", color:sel?T.text:T.muted,
                    fontFamily:T.serif, fontSize:12, cursor:"pointer", fontStyle:sel?"normal":"italic"
                  }}>{sel?"✓ ":""}{opt}</button>
                );
              })}
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <input value={prefs.customDinner} onChange={e=>patch({customDinner:e.target.value})}
                onKeyDown={e=>e.key==="Enter"&&addCustomDinner()}
                placeholder="Eigenes hinzufügen" style={{...iStyle, flex:1}}/>
              <button onClick={addCustomDinner} disabled={!prefs.customDinner.trim()} style={{
                background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:10,
                padding:"0 14px", color:prefs.customDinner.trim()?T.gold:T.muted,
                fontFamily:T.mono, fontSize:14, cursor:prefs.customDinner.trim()?"pointer":"default"
              }}>+</button>
            </div>
            <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", marginTop:8, fontFamily:T.serif }}>
              {prefs.favoriteDinners.length}/5 ausgewählt
            </p>
          </div>
        )}

        {step === 4 && (
          <div>
            <textarea value={prefs.quickOption} onChange={e=>patch({quickOption:e.target.value})}
              placeholder='z.B. "Wraps mit Hummus", "Pasta einfach", "Brot mit Käse + Tomate"'
              rows={3}
              style={{...iStyle, resize:"vertical", minHeight:80}}/>
            <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", marginTop:8, fontFamily:T.serif, lineHeight:1.5 }}>
              EYLA nutzt das als Fallback wenn ein Tag eng wird oder du keine Lust hast.
            </p>
          </div>
        )}

        {step === 5 && (
          <div>
            <textarea value={prefs.dislikes} onChange={e=>patch({dislikes:e.target.value})}
              placeholder='z.B. "Pilze, Sellerie, Innereien, Kohl"'
              rows={3}
              style={{...iStyle, resize:"vertical", minHeight:80}}/>
            <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", marginTop:8, fontFamily:T.serif, lineHeight:1.5 }}>
              Was nie im Plan auftauchen soll. EYLA hält sich dran.
            </p>
          </div>
        )}

        <div style={{ display:"flex", gap:8, marginTop:20 }}>
          {step > 0 && (
            <button onClick={()=>setStep(s=>s-1)} style={{
              background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:10,
              padding:"10px 16px", color:T.muted, fontFamily:T.serif, fontSize:13, cursor:"pointer"
            }}>← Zurück</button>
          )}
          {step < steps.length - 1 ? (
            <button onClick={()=>setStep(s=>s+1)} style={{
              flex:1, background:`linear-gradient(135deg,#78350F,${T.gold})`,
              border:"none", borderRadius:10, padding:"10px 16px",
              color:T.bg, fontFamily:T.serif, fontSize:13, fontWeight:700, cursor:"pointer"
            }}>{step === 0 ? "Los geht's →" : "Weiter →"}</button>
          ) : (
            <button onClick={finish} style={{
              flex:1, background:`linear-gradient(135deg,${T.gold},${T.acc})`,
              border:"none", borderRadius:10, padding:"10px 16px",
              color:T.bg, fontFamily:T.serif, fontSize:13, fontWeight:700, cursor:"pointer"
            }}>✓ Speichern + Plan erstellen</button>
          )}
          <button onClick={onCancel} style={{
            background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:10,
            padding:"10px 14px", color:T.muted, fontFamily:T.serif, fontSize:12,
            fontStyle:"italic", cursor:"pointer"
          }}>✕</button>
        </div>
      </div>
    </div>
  );
}

function PlanScreen({ profile, onUpdateProfile }) {
  const [days, setDays] = useState([]);
  const [intro, setIntro] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  // "Heute im Fokus": welcher Tag ist gerade ausgewählt (Index in days)
  const [selDay, setSelDay] = useState(0);
  // Swap-Modus: welche Mahlzeit gerade ersetzt wird (id "dayIdx:slot")
  const [swappingKey, setSwappingKey] = useState(null);
  // Favoriten – Set von normalisierten Mahlzeit-Namen
  const [favorites, setFavorites] = useState([]);
  // Kühlschrank-Foto State
  const [fridgeAnalyzing, setFridgeAnalyzing] = useState(false);
  const [fridgeIdeas, setFridgeIdeas] = useState(null); // {ingredients, ideas[]}
  const [fridgeError, setFridgeError] = useState(null);
  const fridgeFileRef = useRef(null);

  // Index des heutigen Wochentags im Plan (für "Heute im Fokus"); sonst 0
  const todayDayIdx = (daysArr) => {
    const wd = new Date().toLocaleDateString("de-DE", { weekday: "long" }).toLowerCase().slice(0, 2);
    const i = (daysArr || []).findIndex(d => (d.day || "").toLowerCase().slice(0, 2) === wd);
    return i >= 0 ? i : 0;
  };

  async function handleFridgeFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFridgeError(null);
    setFridgeAnalyzing(true);
    setFridgeIdeas(null);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const img = new Image();
      img.src = dataUrl;
      await new Promise(r => { img.onload = r; });
      const max = 1400;
      const scale = Math.min(1, max/Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width*scale);
      canvas.height = Math.round(img.height*scale);
      const ctx2 = canvas.getContext("2d");
      ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];

      const ct = calorieTarget(profile);
      const mt = macroTarget(profile);
      const prefs = profile.preferences?.join(", ") || "wenig Fleisch, mediterran";
      const intol = profile.intolerances?.length>0 ? "Intoleranzen meiden: " + profile.intolerances.join(", ") + "." : "";

      const res = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 800,
          system: `Du analysierst ein Kühlschrank-/Vorrats-Foto und schlägst Mahlzeit-Ideen vor. Antworte STRENG in diesem Format, kein Markdown:

ZUTATEN: <komma-separierte Liste was du siehst, max 15 Items>

IDEE 1: <kurze Mahlzeit-Beschreibung mit Zutaten aus dem Foto> (~XXX kcal)
IDEE 2: <...> (~XXX kcal)
IDEE 3: <...> (~XXX kcal)

Mahlzeiten passend zu Profil (${prefs}, ${ct.type === "abnehmen" ? "Defizit" : ct.type === "aufbauen" ? "Überschuss" : "Halten"}, ${mt.protein}g Protein/Tag-Ziel). ${intol} Kein Markdown, keine Bullets. 3 ideen genau.`,
          messages: [{
            role: "user",
            content: [
              { type:"image", source:{ type:"base64", media_type:"image/jpeg", data: base64 } },
              { type:"text", text:"Was siehst du, was kann ich daraus machen?" }
            ]
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.find(b=>b.type==="text")?.text || "";
      if (!text) throw new Error("Leere Antwort");

      // Parse
      const ingredientsMatch = text.match(/ZUTATEN:\s*([^\n]+)/i);
      const ingredients = ingredientsMatch ? ingredientsMatch[1].trim() : "";
      const ideaRegex = /IDEE\s*\d+:\s*([^\n]+)/gi;
      const ideas = [];
      let m;
      while ((m = ideaRegex.exec(text)) !== null) {
        ideas.push(m[1].trim());
      }
      if (ideas.length === 0) throw new Error("Konnte keine Ideen lesen");

      setFridgeIdeas({ ingredients, ideas });
    } catch(err) {
      setFridgeError("Konnte Foto nicht analysieren: " + (err.message||err));
    }
    setFridgeAnalyzing(false);
    e.target.value = "";
  }

  useEffect(() => {
    retrieve("eyla_favorites_v1", []).then(f => setFavorites(Array.isArray(f) ? f : []));
  }, []);

  function isFav(meal) {
    return favorites.some(f => f.name === meal);
  }
  function toggleFav(meal) {
    const exists = favorites.some(f => f.name === meal);
    const next = exists ? favorites.filter(f => f.name !== meal) : [...favorites, { name: meal, addedAt: Date.now() }];
    setFavorites(next);
    persist("eyla_favorites_v1", next);
  }

  // Plan beim Mount aus localStorage laden – sonst geht er bei Tab-Wechsel verloren
  useEffect(() => {
    retrieve("eyla_plan_v1", null).then(saved => {
      if (saved && Array.isArray(saved.days) && saved.days.length > 0) {
        setDays(saved.days);
        setIntro(saved.intro || "");
        setSelDay(todayDayIdx(saved.days));
      }
      setLoaded(true);
    });
    // Live-Sync: wenn EYLA via Tool den Plan ändert, neu laden
    function onPlanChange() {
      retrieve("eyla_plan_v1", null).then(saved => {
        if (saved && Array.isArray(saved.days)) {
          setDays(saved.days);
          setIntro(saved.intro || "");
        }
      });
    }
    window.addEventListener("eyla_plan_changed", onPlanChange);
    return () => window.removeEventListener("eyla_plan_changed", onPlanChange);
  }, []);

  // Plan persistieren wenn er sich ändert
  useEffect(() => {
    if (loaded && days.length > 0) {
      persist("eyla_plan_v1", { days, intro, savedAt: new Date().toISOString() });
    }
  }, [days, intro, loaded]);

  async function generate() {
    setLoading(true);
    setError(null);
    setDays([]);
    setIntro("");
    try {
      const ct = calorieTarget(profile);
      const proteinPerKg = ct.type === "aufbauen" ? 2.0 : ct.type === "abnehmen" ? 1.8 : 1.4;
      const proteinG = Math.round((parseFloat(profile.weight)||79) * proteinPerKg);

      let zielKontext = "";
      if (ct.type === "halten")    zielKontext = `Ziel: HALTEN. Tagesziel ~${ct.target} kcal, Protein ~${proteinG}g.`;
      else if (ct.type === "abnehmen") zielKontext = `Ziel: ABNEHMEN ${ct.deltaKg||"?"}kg in ${ct.weeks||"?"} Wochen. Tagesziel ${ct.target} kcal (Defizit ${Math.abs(ct.dailyDelta)} kcal). Protein hoch halten (~${proteinG}g/Tag) damit Muskeln bleiben.`;
      else if (ct.type === "aufbauen") zielKontext = `Ziel: AUFBAUEN ${ct.deltaKg||"?"}kg in ${ct.weeks||"?"} Wochen. Tagesziel ${ct.target} kcal (Überschuss ${ct.dailyDelta}). Protein ~${proteinG}g, dichte Kohlenhydrate um's Training.`;

      const intolSatz = profile.intolerances?.length>0 ? `Intoleranzen STRIKT meiden: ${profile.intolerances.join(", ")}.` : "";
      const sexLabel = profile.sex === "f" ? "Frau" : profile.sex === "d" ? "divers" : "Mann";

      const systemPrompt = `Du bist EYLA – Ernährungsberaterin mit fundiertem Wissen. Du erstellst 7-Tage-Pläne, die wissenschaftlich tragfähig UND wholistisch sind.

EVIDENZ-BASIS (worauf du dich stützt):
- Mediterrane Ernährung (am besten erforscht für Langlebigkeit + Stoffwechselgesundheit – PREDIMED, Lyon Heart Study, EAT-Lancet)
- Whole foods, minimal verarbeitet (NOVA-Klassifikation: NOVA 1+2 dominieren, NOVA 4 vermeiden)
- Adäquates Protein gleichmäßig über den Tag verteilt (Leucin-Schwelle ~3g/Mahlzeit, ISSN-Position)
- Ballaststoff-Reichtum (25–40g/Tag, gut für Mikrobiom + Sättigung)
- Pflanzliche Vielfalt (American Gut: >30 verschiedene Pflanzenarten/Woche)
- Bei Abnehmen: Time-Restricted Eating optional (10–12h Essfenster zeigt konsistente Vorteile)
- Hydratation, Schlaf, Bewegung gehören zum Gesamtbild – Ernährung ist EIN Hebel

WELTBILD (subtil, nie predigend):
Du arbeitest mit dem Vertrauen, dass der Mensch geschaffen ist und die Schöpfung alles bereitstellt, was er braucht – echtes Essen, gewachsen, mit Bedacht zubereitet. Du redest nicht von "Lebensmitteln" als Nährstoff-Container, sondern von Nahrung als Gabe. Du pathologisierst nicht, optimierst nicht zwanghaft, traust dem Körper und der Schöpfungsordnung. Keine "Superfoods"-Marketing-Sprache. Eher: einfach, ehrlich, nährend.

STRUKTUR (Standard: 3 Hauptmahlzeiten – FRUEHSTUECK, MITTAG, ABEND IMMER ausfüllen):
- DREI Hauptmahlzeiten sind PFLICHT: Frühstück, Mittag, Abend. Niemals "—" oder leer lassen.
- SNACK ist optional: bei Halten/Abnehmen oft "—", bei Aufbauen/hoher Aktivität sinnvoll.
- Time-Restricted Eating verschiebt das Essfenster (z.B. Frühstück 10:00, Abend 18:00) – aber alle drei Hauptmahlzeiten bleiben drin.
- Bei Abnehmen: gleiche 3 Hauptmahlzeiten, nur kleiner portioniert, kein Snack.
- Bei Aufbauen: 3 Hauptmahlzeiten + Snack + ggf. Post-Workout.
- Bei Halten: 3 Hauptmahlzeiten, Snack je nach Hunger.
- An Trainings-Tagen Kohlenhydrate näher am Training, an Ruhetagen weniger.
- Variabilität über die Woche – nicht jeden Tag dasselbe Schema.

FORMAT (genau so antworten – KEIN Markdown, KEINE **, KEINE ##, kein Listen-Bullet):
INTRO: [2-3 Sätze die Logik des Plans erklären – warum diese Struktur für DIESES Profil]

TAG: Montag
FRUEHSTUECK: [Mahlzeit mit ungefährer kcal in Klammern, oder "—" wenn weggelassen]
MITTAG: [Mahlzeit mit kcal]
ABEND: [Mahlzeit mit kcal]
SNACK: [Snack mit kcal, oder "—" wenn weggelassen]
TIPP: [Konkreter Hinweis für diesen Tag – Timing, Zubereitung, Variation. Nicht generisch.]

[wiederhole für Dienstag bis Sonntag]`;

      const persons = parseInt(profile.householdSize)||1;
      const personsSatz = persons === 1
        ? "Koche nur für mich – Portion 1."
        : `Koche für ${persons} Personen.${profile.householdNote?` Besonderheit: ${profile.householdNote}.`:""} Plan-Mengen für ${persons} Personen, kcal-Angaben pro Portion (also pro Person).`;

      // Plan-Präferenzen aus dem Wizard
      const pp = profile.planPreferences || {};
      const prefStrings = [];
      if (pp.breakfastVariety === "same" && pp.breakfastFixed) {
        prefStrings.push(`FRÜHSTÜCK FIX (jeden Tag dasselbe): "${pp.breakfastFixed}"`);
      } else if (pp.breakfastVariety === "rotate") {
        prefStrings.push(`Frühstück rotiert (2-3 verschiedene über die Woche).`);
      } else if (pp.skipBreakfast) {
        prefStrings.push(`KEIN FRÜHSTÜCK – Frühstück IMMER als "—" lassen. User isst nicht morgens.`);
      }
      if (pp.favoriteLunches?.length > 0) {
        prefStrings.push(`Mittag-Favoriten (Pool, daraus variieren): ${pp.favoriteLunches.join(" · ")}.`);
      }
      if (pp.favoriteDinners?.length > 0) {
        prefStrings.push(`Abend-Favoriten (Pool, daraus variieren): ${pp.favoriteDinners.join(" · ")}.`);
      }
      if (pp.quickOption) {
        prefStrings.push(`Quick-Fallback wenn keine Zeit: "${pp.quickOption}".`);
      }
      if (pp.dislikes) {
        prefStrings.push(`STRIKT MEIDEN (User mag nicht): ${pp.dislikes}.`);
      }
      const planPrefsBlock = prefStrings.length > 0
        ? `\nPLAN-PRÄFERENZEN (HARTE Vorgaben, kein Abweichen):\n${prefStrings.map(s => "- " + s).join("\n")}\n`
        : "";

      // ── ERWEITERTER KONTEXT: alle Profildaten + Zyklus + Training + Saison ──
      const ctxLines = [];
      // Tagesrhythmus → Essfenster
      if (profile.wakeTime || profile.sleepTime || profile.mealPattern) {
        const mp = profile.mealPattern==="custom" ? (profile.mealPatternCustom?.trim() ? `eigener Essrhythmus: ${profile.mealPatternCustom.trim()}` : "eigener Essrhythmus") : profile.mealPattern==="5small" ? "5 kleine Mahlzeiten" : profile.mealPattern==="if168" ? "Intermittent Fasting 16:8 (Essfenster ~8h)" : profile.mealPattern==="ifother" ? "Intermittent Fasting (eigener Rhythmus)" : "3 Hauptmahlzeiten";
        ctxLines.push(`Tagesrhythmus: ${profile.wakeTime?`auf ${profile.wakeTime}`:""}${profile.sleepTime?`, Bett ${profile.sleepTime}`:""} · ${mp}. Timing der Mahlzeiten daran anpassen.`);
      }
      // Beruf → Aktivitätslevel
      if (profile.occupation || profile.jobActivity) {
        const ja = profile.jobActivity==="sitzend" ? "überwiegend sitzend (geringer NEAT)" : profile.jobActivity==="aktiv" ? "körperlich aktiv (höherer Bedarf)" : "gemischt aktiv";
        ctxLines.push(`Beruf: ${profile.occupation||"k.A."}${profile.jobActivity?` – ${ja}`:""}.`);
      }
      // Allergien STRIKT
      if (profile.allergies?.length > 0) {
        ctxLines.push(`⚠ ALLERGIEN (LEBENSWICHTIG – absolut NIE verwenden, auch nicht in Spuren): ${profile.allergies.join(", ")}.`);
      }
      // Gesundheits-Notizen
      if (profile.healthNotes) {
        ctxLines.push(`Gesundheit/Beschwerden berücksichtigen: ${profile.healthNotes}.`);
      }
      // Kochzeit + Equipment → Rezept-Komplexität
      if (profile.cookTime) {
        const ck = profile.cookTime==="quick" ? "max 15 Min Zubereitung – einfache, schnelle Rezepte" : profile.cookTime==="long" ? "bis 30+ Min ok – auch aufwändigere Gerichte" : "15-30 Min Zubereitung";
        ctxLines.push(`Kochzeit: ${ck}.`);
      }
      if (profile.kitchenEquipment?.length > 0) {
        ctxLines.push(`Verfügbare Küchengeräte (nur darauf basierende Rezepte): ${profile.kitchenEquipment.join(", ")}.`);
      }
      // Sport → Trainingstag-Anpassung
      if (profile.sportsPreferred?.length > 0) {
        ctxLines.push(`Trainingsarten: ${profile.sportsPreferred.join(", ")}. An Trainingstagen Kohlenhydrate + Protein erhöhen.`);
      }
      // EMS-Studio-Kontext: Trainingstage aus Kalender + Plan
      try {
        const evs = JSON.parse(localStorage.getItem("eyla_local_events_v2")||"[]");
        const emsDays = [...new Set(evs.filter(e => /ems|training|workout|sport|gym/i.test(e.title||"")).map(e => {
          const d = new Date(e.date); return ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"][d.getDay()];
        }))];
        if (emsDays.length > 0) ctxLines.push(`EMS-/Trainingstage diese Woche: ${emsDays.join(", ")}. An diesen Tagen Protein-Fokus + Post-Workout-Carbs einplanen.`);
      } catch {}
      // FLO Zyklus-Phase
      if (profile.trackCycle) {
        try {
          const cycles = JSON.parse(localStorage.getItem("eyla_cycle_v1")||"[]");
          const status = getCycleStatus(cycles, profile);
          if (status.phase) {
            const info = PHASE_INFO[status.phase];
            ctxLines.push(`Zyklusphase: ${info.label} (Tag ${status.dayOfCycle}). Ernährung anpassen: ${info.nutrition}.`);
          }
        } catch {}
      }
      // Saisonalität (Monat)
      const monthName = new Date().toLocaleDateString("de-DE",{month:"long"});
      ctxLines.push(`Aktueller Monat: ${monthName}. Saisonales/regionales Gemüse & Obst bevorzugen.`);
      // Gewichtsverlauf-Trend
      try {
        const logs = JSON.parse(localStorage.getItem("eyla_logs_v1")||"{}");
        const weights = Object.values(logs).filter(l=>typeof l?.weight==="number").map(l=>({w:l.weight,t:new Date(l.date).getTime()})).sort((a,b)=>a.t-b.t);
        if (weights.length >= 3) {
          const delta = (weights[weights.length-1].w - weights[0].w).toFixed(1);
          ctxLines.push(`Gewichtstrend: ${delta>0?"+":""}${delta}kg über ${weights.length} Messungen. ${ct.type==="abnehmen" && delta>=0 ? "Defizit greift noch nicht – etwas straffer kalkulieren." : ct.type==="aufbauen" && delta<=0 ? "Aufbau stockt – Kalorien leicht hoch." : "Trend passt."}`);
        }
      } catch {}

      const ctxBlock = ctxLines.length > 0
        ? `\nKONTEXT (für maximale Personalisierung nutzen):\n${ctxLines.map(s => "- " + s).join("\n")}\n`
        : "";

      const userPrompt = `Profil: ${profile.name||"Phil"}, ${sexLabel}, ${profile.age||35}J, ${profile.weight||79}kg, ${profile.height||183}cm. Aktivität: ${profile.activity||"5x Woche Beweglichkeit"}. Vorlieben: ${profile.preferences?.join(", ")||"wenig Fleisch, proteinreich, mediterran"}. ${intolSatz} ${zielKontext} ${personsSatz}${planPrefsBlock}${ctxBlock}\nErstelle den 7-Tage-Plan – maximal personalisiert auf ALLE oben genannten Faktoren. Jede Mahlzeit mit kcal-Angabe. Variiere sinnvoll, aber respektiere die Präferenzen strikt.`;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 3000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }]
        })
      });
      if (!res.ok) {
        if (res.status === 504 || res.status === 524 || res.status === 502)
          throw new Error("EYLA hat zu lange gebraucht. Tippe nochmal auf „Plan generieren“ – meist klappt es beim 2. Versuch.");
        throw new Error("Status " + res.status);
      }
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      if (!text) throw new Error("Leere Antwort");

      const introMatch = text.match(/INTRO:\s*(.+)/);
      if (introMatch) setIntro(introMatch[1].trim());

      // Robustes Splitten:
      // 1) Markdown-Prefix-Zeichen vor TAG: erlauben (*, #, -, >, _, space)
      // 2) Falls TAG: gar nicht vorkommt, fallback auf Wochentag-Namen am Zeilenanfang
      let blocks = text.split(/^[\s*#_>\-]*TAG:\s*/gmi).slice(1);
      if (blocks.length === 0) {
        const dayWords = "(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)";
        const fallback = new RegExp(`^[\\s*#_>\\-]*${dayWords}[\\s*:_-]*`, "gmi");
        const parts = text.split(fallback);
        // parts wechseln zwischen [vor erstem Tag, day1, content1, day2, content2, ...]
        const out = [];
        for (let i = 1; i < parts.length; i += 2) {
          out.push((parts[i] || "") + "\n" + (parts[i+1] || ""));
        }
        blocks = out;
      }

      const parsed = blocks.map(block => {
        // Markdown-Müll wegputzen pro Zeile, dann erste echte Zeile = Tagesname
        const lines = block.split("\n")
          .map(l => l.replace(/^[\s*#_>\-]+|[\s*]+$/g, "").trim())
          .filter(Boolean);
        const day = lines[0]?.replace(/[*_#:]/g, "").trim() || "";

        // Sucht in Zeilen nach Schlüssel-Prefix, mit Markdown-Toleranz
        const get = (keys) => {
          for (const key of keys) {
            const keyNorm = key.toUpperCase().replace(/Ü/g,"UE").replace(/Ä/g,"AE").replace(/Ö/g,"OE");
            const line = lines.find(l => {
              const clean = l.replace(/[*_#]/g,"").toUpperCase().replace(/Ü/g,"UE").replace(/Ä/g,"AE").replace(/Ö/g,"OE").trim();
              return clean.startsWith(keyNorm + ":") || clean.startsWith(keyNorm + " :");
            });
            if (line) {
              const cleaned = line.replace(/[*_#]/g,"");
              return cleaned.slice(cleaned.indexOf(":") + 1).trim();
            }
          }
          return "–";
        };
        return {
          day,
          breakfast: get(["FRÜHSTÜCK","FRUEHSTUECK","FRUEHS","BREAKFAST","MORGEN"]),
          lunch:     get(["MITTAG","LUNCH","MITTAGESSEN"]),
          dinner:    get(["ABEND","DINNER","ABENDESSEN"]),
          snack:     get(["SNACK","ZWISCHENMAHLZEIT","IMBISS"]),
          tip:       get(["TIPP","TIP","HINWEIS","EYLA"]),
        };
      }).filter(d => d.day && d.day.length > 1 && d.day.length < 40);

      if (parsed.length === 0) {
        console.warn("[PlanScreen] Konnte Plan nicht parsen. Antwort war:", text.slice(0, 500));
        throw new Error("Konnte Plan nicht lesen");
      }
      setDays(parsed);
      setSelDay(todayDayIdx(parsed));
    } catch(e) {
      setError("Fehler: " + e.message);
    }
    setLoading(false);
  }

  // Tauscht eine einzelne Mahlzeit gegen Claude-Vorschlag
  async function swapMeal(dayIdx, slot, customWish = "") {
    const key = `${dayIdx}:${slot}`;
    setSwappingKey(key);
    try {
      const day = days[dayIdx];
      const slotDe = { breakfast:"Frühstück", lunch:"Mittag", dinner:"Abend", snack:"Snack" }[slot];
      const currentMeal = day[slot] || "—";
      const other = ["breakfast","lunch","dinner","snack"]
        .filter(s => s !== slot && day[s] && day[s] !== "—" && day[s] !== "–")
        .map(s => `${({breakfast:"Frühstück",lunch:"Mittag",dinner:"Abend",snack:"Snack"})[s]}: ${day[s]}`)
        .join("; ");

      const ct = calorieTarget(profile);
      const mt = macroTarget(profile);
      const wishText = customWish ? `Wunsch: ${customWish}. ` : "";

      const userMsg = `Ich möchte die Mahlzeit für ${slotDe} am ${day.day} ersetzen.\nAktuell: ${currentMeal}\nDer Rest des Tages bleibt: ${other||"–"}\nVorlieben: ${profile.preferences?.join(", ")||"k.A."}\nIntoleranzen: ${profile.intolerances?.join(", ")||"keine"}\nTagesziel ~${ct.target}kcal, Protein-Tag ~${mt.protein}g.\n${wishText}\n\nGib mir genau EINE neue Mahlzeit für diesen Slot. Format strikt: 'Mahlzeit-Beschreibung (~XXX kcal)'. Keine Erklärung, kein Markdown, kein Listenpunkt.`;

      const res = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-5",
          max_tokens:200,
          system:"Du ersetzt einzelne Mahlzeiten in einem 7-Tage-Plan. Antworte mit GENAU EINER Zeile in dem Format: '<Mahlzeit> (~<kcal> kcal)'. Kein Markdown. Keine Erklärung. Wenn Wunsch genannt, beachten.",
          messages:[{ role:"user", content: userMsg }]
        })
      });
      const data = await res.json();
      const newMeal = (data.content?.find(b=>b.type==="text")?.text||"")
        .replace(/^[\s*#_>-]+/, "")
        .replace(/[*_#]/g, "")
        .trim();
      if (!newMeal) throw new Error("Kein Vorschlag");

      setDays(prev => prev.map((d, i) => i === dayIdx ? { ...d, [slot]: newMeal } : d));
    } catch(e) {
      setError("Tausch fehlgeschlagen: " + (e.message||e));
      setTimeout(()=>setError(null), 3000);
    }
    setSwappingKey(null);
  }

  const icons = { breakfast:"☀️", lunch:"🌿", dinner:"🌙", snack:"✦" };
  const labels = { breakfast:"Frühstück", lunch:"Mittag", dinner:"Abend", snack:"Snack" };

  return (
    <div>
      <Lbl style={{ marginBottom:8 }}>ERNÄHRUNGSPLAN</Lbl>
      <h2 style={{ fontSize:20, fontWeight:300, color:T.text, margin:"0 0 14px" }}>
        Eine Woche, <span style={{ color:T.gold }}>nur für dich.</span>
      </h2>

      {/* Quick-Action: Kühlschrank-Foto → Ideen */}
      <input ref={fridgeFileRef} type="file" accept="image/*" capture="environment" onChange={handleFridgeFile} style={{ display:"none" }}/>
      <button onClick={()=>fridgeFileRef.current?.click()} disabled={fridgeAnalyzing} style={{
        width:"100%", padding:"10px 14px", borderRadius:10, marginBottom:14,
        border:`1px solid ${T.gold}44`,
        background: fridgeAnalyzing ? T.bg2 : T.gold+"10",
        color: T.gold, fontFamily:T.serif, fontSize:13,
        cursor: fridgeAnalyzing ? "default" : "pointer",
        fontStyle:"italic", transition:"all .2s",
        display:"flex", alignItems:"center", justifyContent:"center", gap:8
      }}>
        {fridgeAnalyzing ? (
          <>
            <Waveform/>
            <span style={{ fontFamily:T.mono, fontSize:10, letterSpacing:1 }}>EYLA SCHAUT IN DEN KÜHLSCHRANK …</span>
          </>
        ) : (
          <>📷 Was kann ich heute kochen? · Foto vom Kühlschrank</>
        )}
      </button>
      {fridgeError && (
        <p style={{ color:T.red, fontSize:11, fontStyle:"italic", margin:"0 0 12px", fontFamily:T.serif }}>{fridgeError}</p>
      )}
      {fridgeIdeas && (
        <Card gold style={{ marginBottom:14, animation:"fadeUp .3s ease both" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
            <Lbl color={T.gold} style={{ marginBottom:0 }}>EYLAS IDEEN</Lbl>
            <button onClick={()=>setFridgeIdeas(null)} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:14, padding:2 }}>×</button>
          </div>
          {fridgeIdeas.ingredients && (
            <p style={{ color:T.mid, fontSize:11, fontStyle:"italic", margin:"0 0 12px", lineHeight:1.6, fontFamily:T.serif }}>
              <span style={{ color:T.muted, fontFamily:T.mono, fontSize:10, letterSpacing:1, marginRight:6 }}>GESEHEN:</span>
              {fridgeIdeas.ingredients}
            </p>
          )}
          <div>
            {fridgeIdeas.ideas.map((idea, i) => (
              <div key={i} style={{
                padding:"10px 12px", marginBottom:6,
                background:T.bg2, borderRadius:8,
                borderLeft:`2px solid ${T.gold}`
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
                  <span style={{ color:T.text, fontSize:13, fontFamily:T.serif, fontStyle:"italic", flex:1 }}>
                    {idea}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {days.length === 0 && !loading && (
        <Card accent style={{ textAlign:"center", padding:40 }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:20 }}><EylaOrb size={60}/></div>
          <p style={{ color:T.mid, fontStyle:"italic", marginBottom:12, fontSize:14, fontFamily:T.serif }}>
            {profile.planPreferences?.completedAt
              ? "Ich erstelle deinen Plan basierend auf deinen Routinen und Vorlieben."
              : "Damit der Plan zu dir passt, klopfen wir kurz deine Routinen ab — 5 Fragen, eine Minute."}
          </p>
          {error && <p style={{ color:T.red, fontSize:12, fontFamily:T.mono, marginBottom:16, padding:"8px 12px", background:T.red+"11", borderRadius:8 }}>{error}</p>}
          <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
            <button onClick={()=>setShowWizard(true)} style={{
              background:`linear-gradient(135deg,#78350F,${T.gold})`,
              border:"none", borderRadius:12, padding:"12px 22px",
              color:T.bg, fontFamily:T.serif, fontSize:14, cursor:"pointer", fontWeight:700
            }}>
              {profile.planPreferences?.completedAt ? "✎ Präferenzen ändern" : "✦ Plan-Wizard starten"}
            </button>
            {profile.planPreferences?.completedAt && (
              <button onClick={generate} style={{ background:"linear-gradient(135deg," + T.dim + "," + T.acc + ")", border:"none", borderRadius:12, padding:"12px 22px", color:T.bg, fontFamily:T.serif, fontSize:14, cursor:"pointer", fontWeight:700 }}>
                Plan erstellen ✦
              </button>
            )}
          </div>
        </Card>
      )}

      {/* PLAN-WIZARD MODAL */}
      {showWizard && (
        <PlanWizard
          profile={profile}
          onCancel={()=>setShowWizard(false)}
          onSave={(prefs) => {
            onUpdateProfile?.({ planPreferences: prefs });
            setShowWizard(false);
            // Direkt Plan generieren mit den neuen Präferenzen
            setTimeout(() => generate(), 300);
          }}
        />
      )}
      {loading && (
        <Card style={{ textAlign:"center", padding:48 }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:20 }}><EylaOrb size={64} thinking/></div>
          <Lbl style={{ marginBottom:8 }}>EYLA ERSTELLT DEINEN PLAN …</Lbl>
          <p style={{ color:T.muted, fontSize:12, fontStyle:"italic", fontFamily:T.serif, margin:0 }}>Dauert ca. 15 Sekunden.</p>
        </Card>
      )}
      {days.length > 0 && (() => {
        const day = days[selDay] || days[0];
        const tIdx = todayDayIdx(days);
        const isToday = selDay === tIdx;
        const slots = ["breakfast","lunch","dinner","snack"];
        return (
          <div>
            {/* Wochen-Leiste */}
            <div style={{ display:"flex", gap:5, marginBottom:14 }}>
              {days.map((d, i) => {
                const active = i === selDay;
                return (
                  <button key={i} onClick={()=>setSelDay(i)} style={{
                    flex:1, minWidth:0, padding:"8px 0", borderRadius:10, cursor:"pointer",
                    background: active ? T.gold+"22" : T.bg2,
                    border:`1px solid ${active ? T.gold : T.borderS}`,
                    color: active ? T.gold : T.muted,
                    fontFamily:T.mono, fontSize:11, letterSpacing:1,
                    display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                    transition:"all .15s"
                  }}>
                    <span>{(d.day||"").slice(0,2).toUpperCase()}</span>
                    <span style={{ width:4, height:4, borderRadius:"50%", background: i===tIdx ? T.acc : "transparent" }}/>
                  </button>
                );
              })}
            </div>

            {/* Fokus-Tag */}
            <Card style={{ marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <h2 style={{ fontSize:20, fontWeight:300, color:T.text, margin:0 }}>{day.day}</h2>
                {isToday && (
                  <span style={{ fontFamily:T.mono, fontSize:9, letterSpacing:1.5, color:T.acc,
                    background:T.acc+"18", border:`1px solid ${T.acc}44`, borderRadius:20, padding:"3px 10px" }}>HEUTE</span>
                )}
              </div>
              {slots.map((m, mi) => {
                const isEmpty = !day[m] || day[m] === "—" || day[m] === "–";
                if (m === "snack" && isEmpty) return null; // leeren Snack ausblenden
                const isSwapping = swappingKey === `${selDay}:${m}`;
                const isLast = mi === slots.length - 1 || (m === "dinner" && (!day.snack || day.snack === "–" || day.snack === "—"));
                return (
                  <div key={m} style={{ marginBottom:13, paddingBottom:13, borderBottom: isLast ? "none" : `1px solid ${T.border}` }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                        <span style={{ fontSize:15 }}>{icons[m]}</span>
                        <Lbl>{labels[m]}</Lbl>
                      </div>
                      {!isEmpty && (
                        <div style={{ display:"flex", gap:2 }}>
                          <button onClick={()=>toggleFav(day[m])} title={isFav(day[m]) ? "Aus Favoriten" : "Als Favorit"} style={{
                            background:"transparent", border:"none", color: isFav(day[m]) ? T.gold : T.muted,
                            cursor:"pointer", padding:"2px 6px", fontSize:15
                          }}>{isFav(day[m]) ? "★" : "☆"}</button>
                          <button onClick={()=>swapMeal(selDay, m)} disabled={isSwapping} title="Tauschen" style={{
                            background:"transparent", border:"none", color: isSwapping ? T.acc : T.muted,
                            cursor: isSwapping ? "default" : "pointer", padding:"2px 6px", fontFamily:T.mono, fontSize:14
                          }}>{isSwapping ? "…" : "↻"}</button>
                        </div>
                      )}
                    </div>
                    <div style={{ color: isSwapping ? T.acc : T.text, fontSize:15, fontFamily:T.serif, lineHeight:1.5, paddingLeft:23 }}>
                      {isSwapping ? "Suche Alternative …" : (isEmpty ? "—" : day[m])}
                    </div>
                  </div>
                );
              })}
              {day.tip && day.tip !== "–" && (
                <div style={{ marginTop:4, padding:"10px 12px", background:T.acc+"0A", borderRadius:8, borderLeft:"2px solid "+T.acc }}>
                  <Lbl color={T.acc} style={{ marginBottom:3 }}>EYLA</Lbl>
                  <div style={{ color:T.mid, fontSize:12, fontStyle:"italic", fontFamily:T.serif, lineHeight:1.5 }}>{day.tip}</div>
                </div>
              )}
            </Card>

            {intro && (
              <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, lineHeight:1.6, margin:"0 4px 14px", textAlign:"center" }}>✦ {intro}</p>
            )}
            <div style={{ textAlign:"center" }}>
              <button onClick={generate} style={{ background:"transparent", border:"1px solid "+T.borderS, borderRadius:10, padding:"9px 20px", color:T.muted, fontFamily:T.serif, fontSize:12, cursor:"pointer", fontStyle:"italic" }}>Plan neu generieren</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}


// ─── EINKAUFSLISTE ────────────────────────────────────────────────────────────
function ShoppingScreen() {
  const [data, setData] = useState(DEFAULT_SHOPPING);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("alle"); // alle | offen | manuell
  const [addingTo, setAddingTo] = useState(null); // aisle-index oder null
  const [newName, setNewName] = useState("");
  const [newMenge, setNewMenge] = useState("");
  const [planHint, setPlanHint] = useState(false);  // Banner: "Plan-Items fehlen"
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  // Receipt-Foto-State
  const [receiptScanning, setReceiptScanning] = useState(false);
  const [receiptMatches, setReceiptMatches] = useState(null); // { matched:[{aisle,name,checked}], unmatched:[strings] }
  const [receiptError, setReceiptError] = useState(null);
  const receiptFileRef = useRef(null);

  // Generiert Einkaufsliste aus dem gespeicherten 7-Tage-Plan.
  // Manuelle Items bleiben erhalten, Plan-Items werden ersetzt.
  async function generateFromPlan() {
    setGenError(null);
    const savedPlan = await retrieve("eyla_plan_v1", null);
    if (!savedPlan || !Array.isArray(savedPlan.days) || savedPlan.days.length === 0) {
      setGenError("Kein Plan vorhanden. Erst im Tab Essen → Plan generieren.");
      return;
    }

    setGenerating(true);
    try {
      const planText = savedPlan.days.map(d =>
        `${d.day}: Frühstück: ${d.breakfast}; Mittag: ${d.lunch}; Abend: ${d.dinner}; Snack: ${d.snack||"–"}`
      ).join("\n");

      const aisleList = data.aisles.map(a => a.name).join(" / ");

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1500,
          system: `Du erstellst Einkaufslisten aus 7-Tage-Plänen. Antworte STRENG in diesem Format, kein Markdown, keine Erklärungen:\n\nGANG: <Name>\n- <Item> | <Menge>\n- <Item> | <Menge>\n\nGANG: <Name>\n...\n\nGruppiere in genau diese Gänge in dieser Reihenfolge: ${aisleList}. Gang weglassen wenn leer. Mengen für 1 Person × 7 Tage. Konsolidiere doppelte Items.`,
          messages: [{ role: "user", content: `Plan:\n\n${planText}\n\nErstelle die Einkaufsliste.` }]
        })
      });
      const dataRes = await res.json();
      const text = dataRes.content?.find(b=>b.type==="text")?.text || "";
      if (!text) throw new Error("Leere Antwort");

      // Parse: blocks getrennt durch "GANG:"
      const blocks = text.split(/GANG:\s*/gi).slice(1);
      const generatedAisles = blocks.map(block => {
        const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
        const name = lines[0]?.replace(/[*_#]/g, "").trim() || "";
        const items = lines.slice(1)
          .filter(l => l.startsWith("-"))
          .map(l => {
            const cleaned = l.replace(/^-\s*/, "");
            const parts = cleaned.split("|").map(s => s.trim());
            return { name: parts[0]||"", menge: parts[1]||"1", quelle: "plan" };
          })
          .filter(it => it.name.length > 0);
        return { name, items };
      }).filter(g => g.name && g.items.length > 0);

      if (generatedAisles.length === 0) throw new Error("Konnte Liste nicht lesen");

      // Merge: Plan-Items ersetzen, manuelle bleiben
      setData(prev => {
        const newAisles = prev.aisles.map(aisle => {
          // Suche generated-aisle mit ähnlichem Namen (erstes Wort match)
          const aisleFirst = aisle.name.split(/[\s&]/)[0].toLowerCase();
          const gen = generatedAisles.find(g => {
            const genFirst = g.name.split(/[\s&]/)[0].toLowerCase();
            return aisleFirst === genFirst || aisleFirst.startsWith(genFirst) || genFirst.startsWith(aisleFirst);
          });
          const manual = aisle.items.filter(it => it.quelle === "manuell");
          const plan = gen ? gen.items : [];
          return { ...aisle, items: [...plan, ...manual] };
        });
        return { ...prev, aisles: newAisles, checked: {} };
      });
    } catch(e) {
      setGenError("Fehler: " + (e.message || e));
    }
    setGenerating(false);
  }

  // Plan-Hint Check: gibt es einen Plan + hat die Liste KEINE plan-Items?
  useEffect(() => {
    if (!loaded || !data.storeId) return;
    retrieve("eyla_plan_v1", null).then(plan => {
      if (!plan || !Array.isArray(plan.days) || plan.days.length === 0) {
        setPlanHint(false);
        return;
      }
      // Hat die aktuelle Liste irgendwelche "plan"-Items? Wenn ja: kein Hint.
      const hasPlanItems = data.aisles.some(a => a.items.some(it => it.quelle === "plan"));
      setPlanHint(!hasPlanItems);
    });
  }, [loaded, data.aisles, data.storeId]);

  useEffect(() => {
    retrieve("eyla_shopping_v1", null).then(s => {
      if (s && s.aisles) {
        // Migration: alte Daten ohne storeId hatten 'store: "Lidl"' hart gesetzt
        // Wenn kein storeId aber store-Name vorhanden → ggf. zuordnen, sonst null lassen.
        if (!s.storeId && s.store) {
          const match = Object.entries(STORES).find(([id, st]) =>
            st.name.toLowerCase() === String(s.store).toLowerCase()
          );
          if (match) {
            s.storeId = match[0];
          } else {
            s.storeId = null; // User soll bewusst neu wählen
            s.store = "";
          }
        }
        setData(s);
      } else {
        // Frische Liste: items aus DEFAULT_SHOPPING, aber kein Store-Default
        setData({ ...DEFAULT_SHOPPING });
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) persist("eyla_shopping_v1", data);
  }, [data, loaded]);

  // Quelle-Styles in EYLA-Farben
  const quelleStyle = {
    plan:    { bg: T.acc+"18",  color: T.acc,  label: "📋 Plan" },
    manuell: { bg: T.gold+"18", color: T.gold, label: "✎ Eigen" },
    beide:   { bg: T.rose+"22", color: T.rose, label: "◆ Beide" },
  };

  // Farben für Gänge auf EYLA-Palette mappen
  const colorMap = {
    green: T.green, gold: T.gold, mid: T.mid, rose: T.rose,
    coral: "#F0997B", muted: T.muted, acc: T.acc,
  };

  function toggle(aisleName, itemName) {
    const key = aisleName + "::" + itemName;
    setData(d => ({ ...d, checked: { ...d.checked, [key]: !d.checked[key] }}));
  }

  function resetChecks() {
    setData(d => ({ ...d, checked: {} }));
  }

  function addItem(aisleIdx) {
    if (!newName.trim()) return;
    setData(d => {
      const aisles = d.aisles.map((a, i) => i === aisleIdx ? {
        ...a, items: [...a.items, { name: newName.trim(), menge: newMenge.trim()||"1", quelle: "manuell" }]
      } : a);
      return { ...d, aisles };
    });
    setNewName(""); setNewMenge(""); setAddingTo(null);
  }

  function removeItem(aisleIdx, itemName) {
    setData(d => {
      const aisles = d.aisles.map((a, i) => i === aisleIdx ? {
        ...a, items: a.items.filter(it => it.name !== itemName)
      } : a);
      const checkedCopy = { ...d.checked };
      delete checkedCopy[d.aisles[aisleIdx].name + "::" + itemName];
      return { ...d, aisles, checked: checkedCopy };
    });
  }

  // Receipt-Foto: User wählt Bild → wird komprimiert → an Claude Vision für Item-Extraktion
  async function handleReceiptFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptError(null);
    setReceiptScanning(true);

    try {
      // Bild komprimieren
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const img = new Image();
      img.src = dataUrl;
      await new Promise(r => { img.onload = r; });
      const max = 1400;
      const scale = Math.min(1, max/Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width*scale);
      canvas.height = Math.round(img.height*scale);
      const ctx2 = canvas.getContext("2d");
      ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];

      // An Claude Vision: alle Lebensmittel-Items vom Kassenbon
      const res = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 800,
          system: "Du analysierst Kassenbons. Liste ALLE Lebensmittel-Artikel die du erkennst. Pro Zeile EIN Artikel-Name (vereinfacht, ohne Marke/Menge). Beispiel:\n- Tomaten\n- Vollmilch\n- Vollkornbrot\nKeine Erklärung, keine Markdown-Überschriften. Wenn nichts erkennbar: 'KEINE ITEMS'.",
          messages: [{
            role: "user",
            content: [
              { type:"image", source:{ type:"base64", media_type:"image/jpeg", data: base64 } },
              { type:"text", text:"Was steht auf diesem Kassenbon?" }
            ]
          }]
        })
      });
      const dataRes = await res.json();
      const text = dataRes.content?.find(b=>b.type==="text")?.text || "";

      if (!text || text.includes("KEINE ITEMS")) {
        setReceiptError("Keine Lebensmittel erkannt – versuch ein klareres Foto.");
        setReceiptScanning(false);
        return;
      }

      // Items aus dem Response extrahieren (Zeilen die mit - oder * starten oder einfach Text)
      const detectedItems = text.split("\n")
        .map(l => l.replace(/^[\s\-*•·#>]+/, "").replace(/[*_#]/g,"").trim())
        .filter(l => l.length > 1 && l.length < 60);

      // Fuzzy Match gegen offene Items
      const matched = [];
      const unmatched = [];
      const alreadyMatched = new Set();
      for (const detected of detectedItems) {
        const norm = detected.toLowerCase();
        let hit = null;
        for (const aisle of data.aisles) {
          for (const item of aisle.items) {
            const key = aisle.name + "::" + item.name;
            if (data.checked[key]) continue; // schon abgehakt
            if (alreadyMatched.has(key)) continue;
            const itemNorm = item.name.toLowerCase();
            // Direkt-Substring oder umgekehrt
            if (itemNorm.includes(norm) || norm.includes(itemNorm.split(/[\s(]/)[0])) {
              hit = { aisle: aisle.name, name: item.name, key };
              break;
            }
          }
          if (hit) break;
        }
        if (hit) {
          alreadyMatched.add(hit.key);
          matched.push({ ...hit, detected, checked: true });
        } else {
          unmatched.push(detected);
        }
      }

      setReceiptMatches({ matched, unmatched });
    } catch(err) {
      setReceiptError("Konnte Kassenbon nicht lesen: " + (err.message||err));
    }
    setReceiptScanning(false);
    e.target.value = "";
  }

  function applyReceiptMatches() {
    if (!receiptMatches) return;
    setData(d => {
      const newChecked = { ...d.checked };
      receiptMatches.matched.filter(m => m.checked).forEach(m => {
        newChecked[m.key] = true;
      });
      return { ...d, checked: newChecked };
    });
    setReceiptMatches(null);
  }

  function selectStore(storeId) {
    const store = STORES[storeId];
    if (!store) return;
    setData(d => ({
      ...d,
      storeId,
      store: store.name,
      aisles: reorderAisles(d.aisles, store.aisleOrder)
    }));
  }
  function updateCustomStoreName(name) {
    setData(d => ({ ...d, store: name }));
  }

  // Filter anwenden
  const filteredAisles = data.aisles.map(a => ({
    ...a,
    items: a.items.filter(it => {
      if (filter === "alle") return true;
      if (filter === "offen") return !data.checked[a.name + "::" + it.name];
      if (filter === "manuell") return it.quelle === "manuell";
      return true;
    })
  })).filter(a => a.items.length > 0 || addingTo === data.aisles.indexOf(data.aisles.find(x=>x.name===a.name)));

  const totalItems = data.aisles.flatMap(a => a.items).length;
  const checkedCount = Object.values(data.checked).filter(Boolean).length;
  const progress = totalItems > 0 ? Math.round((checkedCount/totalItems)*100) : 0;

  // Wenn noch kein Laden gewählt: groß die Frage stellen, Liste verstecken
  if (!data.storeId) {
    return (
      <div>
        <div style={{ marginBottom:20 }}>
          <Lbl style={{ marginBottom:6 }}>EINKAUFSLISTE</Lbl>
          <h2 style={{ fontSize:22, fontWeight:300, color:T.text, margin:"0 0 4px", display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:22 }}>🛒</span> Wo gehst du heute einkaufen?
          </h2>
          <p style={{ color:T.mid, fontSize:13, fontStyle:"italic", fontFamily:T.serif, margin:"6px 0 0", lineHeight:1.6 }}>
            Dann sortiere ich die Liste so wie der Laden aufgebaut ist –<br/>
            damit du nicht hin und her läufst.
          </p>
        </div>

        <Card accent style={{ padding:"18px 20px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            {Object.entries(STORES).map(([id, st]) => {
              const isCustom = id === "custom";
              return (
                <button key={id} onClick={()=>selectStore(id)} style={{
                  padding:"14px 16px",
                  borderRadius:12,
                  background: isCustom ? "transparent" : T.bg2,
                  border:`1px solid ${isCustom ? T.borderS : T.acc+"55"}`,
                  color: isCustom ? T.muted : T.acc,
                  fontFamily:T.serif, fontSize:15,
                  cursor:"pointer",
                  fontStyle: isCustom ? "italic" : "normal",
                  transition:"all .2s",
                  textAlign:"left"
                }}>{st.name}</button>
              );
            })}
          </div>
          <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, margin:"14px 0 0", textAlign:"center" }}>
            Kannst später jederzeit den Laden wechseln.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom:18 }}>
        <Lbl style={{ marginBottom:6 }}>EINKAUFSLISTE</Lbl>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
          <h2 style={{ fontSize:20, fontWeight:300, color:T.text, margin:0, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:20 }}>🛒</span>
            <span style={{ color:T.acc }}>{data.storeId === "custom" ? (data.store||"Eigener") : STORES[data.storeId].name}</span>
          </h2>
          <div style={{ fontFamily:T.mono, fontSize:11, color:T.muted }}>
            <span style={{ color:T.acc }}>{checkedCount}</span>/{totalItems}
          </div>
        </div>

        {/* Store-Picker (klein, zum Wechseln) */}
        <div style={{
          display:"flex", gap:6, marginTop:12, overflowX:"auto",
          paddingBottom:6, scrollbarWidth:"none"
        }}>
          {Object.entries(STORES).map(([id, st]) => {
            const sel = data.storeId === id;
            return (
              <button key={id} onClick={()=>selectStore(id)} style={{
                flex:"0 0 auto", padding:"6px 14px", borderRadius:18,
                background: sel ? T.acc+"22" : "transparent",
                border: `1px solid ${sel ? T.acc : T.borderS}`,
                color: sel ? T.text : T.muted,
                fontFamily: T.serif, fontSize: 12,
                cursor: "pointer", whiteSpace: "nowrap",
                fontStyle: sel ? "normal" : "italic",
                transition: "all .2s"
              }}>{st.name}</button>
            );
          })}
        </div>

        {/* Custom Store Name Input */}
        {data.storeId === "custom" && (
          <div style={{ marginTop:8, animation:"fadeUp .3s ease both" }}>
            <input
              value={data.store||""}
              onChange={e=>updateCustomStoreName(e.target.value)}
              placeholder="Name deines Ladens"
              style={{
                width:"100%", background:T.bg2,
                border:`1px solid ${T.borderS}`, borderRadius:8,
                padding:"8px 12px", color:T.text,
                fontFamily:T.serif, fontSize:13, fontStyle:"italic",
                outline:"none", boxSizing:"border-box"
              }}
            />
            <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", margin:"4px 0 0", fontFamily:T.serif }}>
              Gänge bleiben in aktueller Reihenfolge – kannst Items selbst dazupacken.
            </p>
          </div>
        )}

        {/* Progress */}
        <div style={{ height:3, background:T.faint, borderRadius:2, marginTop:10 }}>
          <div style={{ height:3, background:`linear-gradient(90deg,${T.dim},${T.acc})`, borderRadius:2, width:`${progress}%`, transition:"width .3s" }}/>
        </div>

        {/* Filter Pills */}
        <div style={{ display:"flex", gap:6, marginTop:12, alignItems:"center", flexWrap:"wrap" }}>
          {[["alle","Alle"],["offen","Offen"],["manuell","✎ Eigene"]].map(([v,l])=>(
            <button key={v} onClick={()=>setFilter(v)} style={{
              padding:"5px 12px", borderRadius:20,
              border:`1px solid ${filter===v?T.acc:T.borderS}`,
              background:filter===v?T.acc+"18":"transparent",
              color:filter===v?T.acc:T.muted, fontFamily:T.serif, fontSize:11,
              cursor:"pointer", fontStyle:"italic", transition:"all .2s"
            }}>{l}</button>
          ))}
          <button onClick={resetChecks} style={{
            marginLeft:"auto", padding:"5px 12px", borderRadius:20,
            border:`1px solid ${T.borderS}`, background:"transparent",
            color:T.muted, fontFamily:T.mono, fontSize:10, cursor:"pointer", letterSpacing:1
          }}>↺ RESET</button>
        </div>

        {/* Aktionen: Aus Plan füllen + Kassenbon scannen */}
        <input ref={receiptFileRef} type="file" accept="image/*" capture="environment" onChange={handleReceiptFile} style={{ display:"none" }}/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:10 }}>
          <button onClick={generateFromPlan} disabled={generating || receiptScanning} style={{
            padding:"9px 10px", borderRadius:10,
            border:`1px solid ${T.acc}44`,
            background: generating ? T.bg2 : T.acc+"12",
            color: T.acc, fontFamily:T.serif, fontSize:12,
            cursor: generating ? "default" : "pointer",
            fontStyle:"italic", transition:"all .2s",
            display:"flex", alignItems:"center", justifyContent:"center", gap:6
          }}>
            {generating ? (
              <>
                <Waveform/>
                <span style={{ fontFamily:T.mono, fontSize:9, letterSpacing:1 }}>SCHREIBT …</span>
              </>
            ) : (
              <>📋 Aus Plan</>
            )}
          </button>
          <button onClick={()=>receiptFileRef.current?.click()} disabled={generating || receiptScanning} style={{
            padding:"9px 10px", borderRadius:10,
            border:`1px solid ${T.gold}44`,
            background: receiptScanning ? T.bg2 : T.gold+"12",
            color: T.gold, fontFamily:T.serif, fontSize:12,
            cursor: receiptScanning ? "default" : "pointer",
            fontStyle:"italic", transition:"all .2s",
            display:"flex", alignItems:"center", justifyContent:"center", gap:6
          }}>
            {receiptScanning ? (
              <>
                <Waveform/>
                <span style={{ fontFamily:T.mono, fontSize:9, letterSpacing:1 }}>SCANNT …</span>
              </>
            ) : (
              <>📷 Kassenbon</>
            )}
          </button>
        </div>
        {genError && (
          <p style={{ color:T.red, fontSize:11, fontStyle:"italic", margin:"6px 0 0", fontFamily:T.serif }}>
            {genError}
          </p>
        )}
        {/* Plan-Hint Banner */}
        {planHint && !generating && (
          <div style={{ marginTop:10, padding:"8px 12px",
            background:T.acc+"10", border:`1px solid ${T.acc}33`, borderRadius:10,
            display:"flex", alignItems:"center", gap:10,
            animation:"fadeUp .3s ease both"
          }}>
            <span style={{ color:T.acc, fontSize:14 }}>✦</span>
            <span style={{ flex:1, color:T.mid, fontSize:12, fontFamily:T.serif, fontStyle:"italic" }}>
              EYLA-Tipp: dein Plan ist noch nicht in der Liste. Übernehmen?
            </span>
            <button onClick={()=>{ setPlanHint(false); generateFromPlan(); }} style={{
              background:T.acc+"22", border:`1px solid ${T.acc}55`, borderRadius:8,
              padding:"5px 12px", color:T.acc, fontFamily:T.mono, fontSize:10,
              letterSpacing:1, cursor:"pointer"
            }}>JA</button>
            <button onClick={()=>setPlanHint(false)} style={{
              background:"none", border:"none", color:T.muted, fontSize:14, padding:"0 4px", cursor:"pointer"
            }}>×</button>
          </div>
        )}
        {receiptError && (
          <p style={{ color:T.red, fontSize:11, fontStyle:"italic", margin:"6px 0 0", fontFamily:T.serif }}>
            {receiptError}
          </p>
        )}

        {/* Receipt-Matches Preview */}
        {receiptMatches && (
          <Card gold style={{ marginTop:12, animation:"fadeUp .3s ease both" }}>
            <Lbl color={T.gold} style={{ marginBottom:10 }}>KASSENBON ERKANNT</Lbl>
            {receiptMatches.matched.length > 0 ? (
              <>
                <p style={{ color:T.mid, fontSize:12, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 10px" }}>
                  {receiptMatches.matched.filter(m=>m.checked).length} von {receiptMatches.matched.length} werden abgehakt:
                </p>
                <div style={{ marginBottom:12 }}>
                  {receiptMatches.matched.map((m, i) => (
                    <label key={i} style={{
                      display:"flex", alignItems:"center", gap:10,
                      padding:"6px 0", borderBottom:`1px solid ${T.border}`, cursor:"pointer"
                    }}>
                      <input type="checkbox" checked={m.checked} onChange={e=>{
                        const next = [...receiptMatches.matched];
                        next[i] = { ...next[i], checked: e.target.checked };
                        setReceiptMatches({ ...receiptMatches, matched: next });
                      }} style={{ accentColor:T.gold }}/>
                      <div style={{ flex:1 }}>
                        <div style={{ color:T.text, fontSize:13 }}>{m.name}</div>
                        <div style={{ color:T.muted, fontSize:10, fontFamily:T.mono }}>{m.aisle} · erkannt als „{m.detected}"</div>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ color:T.muted, fontSize:12, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 10px" }}>
                Keine Treffer in der Liste.
              </p>
            )}
            {receiptMatches.unmatched.length > 0 && (
              <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 12px" }}>
                Nicht zugeordnet: {receiptMatches.unmatched.slice(0, 8).join(", ")}{receiptMatches.unmatched.length > 8 ? " …" : ""}
              </p>
            )}
            <div style={{ display:"flex", gap:8 }}>
              {receiptMatches.matched.length > 0 && (
                <button onClick={applyReceiptMatches} style={{
                  background:`linear-gradient(135deg,#78350F,${T.goldL})`, border:"none",
                  borderRadius:8, padding:"8px 18px", color:T.bg,
                  fontFamily:T.serif, fontSize:13, fontWeight:700, cursor:"pointer"
                }}>Übernehmen</button>
              )}
              <button onClick={()=>setReceiptMatches(null)} style={{
                background:"transparent", border:`1px solid ${T.borderS}`,
                borderRadius:8, padding:"8px 14px", color:T.muted,
                fontFamily:T.serif, fontSize:13, fontStyle:"italic", cursor:"pointer"
              }}>Abbrechen</button>
            </div>
          </Card>
        )}
      </div>

      {/* Legende */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
        {Object.entries(quelleStyle).map(([k,v])=>(
          <span key={k} style={{
            background:v.bg, color:v.color, fontSize:10, padding:"3px 9px",
            borderRadius:20, fontFamily:T.mono, letterSpacing:.5
          }}>{v.label}</span>
        ))}
      </div>

      {/* Gänge */}
      {filteredAisles.map((aisle, ai) => {
        const originalIdx = data.aisles.findIndex(a => a.name === aisle.name);
        const aisleColor = colorMap[aisle.color] || T.acc;
        const totalInAisle = data.aisles[originalIdx].items.length;
        const doneInAisle = data.aisles[originalIdx].items.filter(it => data.checked[aisle.name+"::"+it.name]).length;
        return (
          <div key={aisle.name} style={{ marginBottom:18 }}>
            {/* Header */}
            <div style={{
              display:"flex", alignItems:"center", gap:10, paddingBottom:6,
              borderBottom:`1px solid ${aisleColor}44`, marginBottom:8
            }}>
              <div style={{
                background:aisleColor+"22", color:aisleColor, borderRadius:6,
                padding:"2px 8px", fontSize:10, fontFamily:T.mono, fontWeight:700,
                border:`1px solid ${aisleColor}55`
              }}>{originalIdx+1}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:500, color:aisleColor, display:"flex", alignItems:"center", gap:6 }}>
                  <span>{aisle.icon}</span>
                  <span>{aisle.name}</span>
                </div>
                <div style={{ fontSize:10, color:T.muted, fontStyle:"italic", fontFamily:T.serif }}>{aisle.hint}</div>
              </div>
              <div style={{ fontFamily:T.mono, fontSize:10, color:T.muted }}>
                {doneInAisle}/{totalInAisle}
              </div>
            </div>

            {/* Items */}
            {aisle.items.map(item => {
              const key = aisle.name + "::" + item.name;
              const done = !!data.checked[key];
              const st = quelleStyle[item.quelle] || quelleStyle.manuell;
              return (
                <div key={item.name} style={{
                  display:"flex", alignItems:"flex-start", gap:10,
                  padding:"9px 0", borderBottom:`1px solid ${T.border}`,
                  opacity: done ? 0.4 : 1, transition:"opacity .2s"
                }}>
                  <div onClick={()=>toggle(aisle.name, item.name)} style={{
                    width:22, height:22, borderRadius:6, flexShrink:0, marginTop:1,
                    border:`1.5px solid ${done?aisleColor:T.borderS}`,
                    background:done?aisleColor:"transparent",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    cursor:"pointer"
                  }}>
                    {done && <span style={{ color:T.bg, fontSize:13, fontWeight:700 }}>✓</span>}
                  </div>
                  <div onClick={()=>toggle(aisle.name, item.name)} style={{ flex:1, cursor:"pointer", minWidth:0 }}>
                    <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                      <span style={{
                        fontSize:14, color:T.text,
                        textDecoration:done?"line-through":"none"
                      }}>{item.name}</span>
                      <span style={{
                        fontSize:9, padding:"1px 7px", borderRadius:20,
                        background:st.bg, color:st.color, fontFamily:T.mono, letterSpacing:.5
                      }}>{st.label}</span>
                    </div>
                    <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>
                      <span style={{ color:T.mid, fontFamily:T.mono }}>{item.menge}</span>
                      {item.tipp && <span style={{ color:T.gold, marginLeft:8, fontStyle:"italic", fontFamily:T.serif }}>💡 {item.tipp}</span>}
                    </div>
                  </div>
                  {item.quelle === "manuell" && (
                    <button onClick={()=>removeItem(originalIdx, item.name)} style={{
                      background:"none", border:"none", color:T.muted,
                      cursor:"pointer", fontSize:14, padding:"2px 4px",
                      alignSelf:"flex-start"
                    }} title="Eigenes Item entfernen">×</button>
                  )}
                </div>
              );
            })}

            {/* + Hinzufügen */}
            {addingTo === originalIdx ? (
              <div style={{ marginTop:8, padding:10, background:T.bg2, borderRadius:8 }}>
                <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                  <input
                    value={newName} onChange={e=>setNewName(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&addItem(originalIdx)}
                    placeholder="Was hinzufügen?" autoFocus
                    style={{
                      flex:1, background:"transparent", border:`1px solid ${T.borderS}`,
                      borderRadius:6, padding:"7px 10px", color:T.text,
                      fontFamily:T.serif, fontSize:13, fontStyle:"italic", outline:"none"
                    }}/>
                  <input
                    value={newMenge} onChange={e=>setNewMenge(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&addItem(originalIdx)}
                    placeholder="Menge"
                    style={{
                      width:80, background:"transparent", border:`1px solid ${T.borderS}`,
                      borderRadius:6, padding:"7px 10px", color:T.text,
                      fontFamily:T.mono, fontSize:12, outline:"none"
                    }}/>
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={()=>addItem(originalIdx)} disabled={!newName.trim()} style={{
                    background:newName.trim()?`linear-gradient(135deg,${T.dim},${T.acc})`:"transparent",
                    border:newName.trim()?"none":`1px solid ${T.borderS}`,
                    borderRadius:6, padding:"6px 16px",
                    color:newName.trim()?T.bg:T.muted,
                    fontFamily:T.serif, fontSize:12, fontWeight:700,
                    cursor:newName.trim()?"pointer":"default"
                  }}>Hinzufügen</button>
                  <button onClick={()=>{setAddingTo(null);setNewName("");setNewMenge("");}} style={{
                    background:"transparent", border:`1px solid ${T.borderS}`,
                    borderRadius:6, padding:"6px 12px", color:T.muted,
                    fontFamily:T.serif, fontSize:12, cursor:"pointer", fontStyle:"italic"
                  }}>Abbrechen</button>
                </div>
              </div>
            ) : (
              <button onClick={()=>setAddingTo(originalIdx)} style={{
                marginTop:8, width:"100%", background:"transparent",
                border:`1px dashed ${T.borderS}`, borderRadius:8,
                padding:"7px 10px", color:T.muted, fontFamily:T.serif,
                fontSize:12, cursor:"pointer", fontStyle:"italic"
              }}>+ Hinzufügen</button>
            )}
          </div>
        );
      })}

      {/* Footer-Tipp */}
      <Card accent style={{ marginTop:18, padding:"12px 16px" }}>
        <div style={{ fontFamily:T.serif, fontSize:12, color:T.mid, lineHeight:1.7 }}>
          <span style={{ color:T.acc, fontWeight:700 }}>✦ Tipp: </span>
          Mengen sind für 2 Personen / 5 Tage kalkuliert. Eigene Items wandern automatisch in den Rundweg.
        </div>
      </Card>
    </div>
  );
}

// ─── PROFIL SCREEN ────────────────────────────────────────────────────────────
// Habits-Editor – im Profil. Profile.habits = [{id, emoji, name}]
function HabitsEditor({ profile, onUpdate }) {
  const habits = Array.isArray(profile.habits) ? profile.habits : [];
  const [newEmoji, setNewEmoji] = useState("✓");
  const [newName, setNewName] = useState("");

  function add() {
    if (!newName.trim()) return;
    const next = [...habits, { id: String(Date.now()), emoji: newEmoji||"·", name: newName.trim() }];
    onUpdate({ ...profile, habits: next });
    setNewName(""); setNewEmoji("✓");
  }
  function remove(id) {
    onUpdate({ ...profile, habits: habits.filter(h => h.id !== id) });
  }

  return (
    <Card style={{ marginBottom:12 }}>
      <Lbl style={{ marginBottom:10 }}>GEWOHNHEITEN</Lbl>
      {habits.length === 0 ? (
        <p style={{ color:T.muted, fontSize:12, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 12px", lineHeight:1.6 }}>
          Kleine Sachen die du täglich tun willst – Meditation, 10 Min Lesen, kein Alkohol.
        </p>
      ) : (
        <div style={{ marginBottom:12 }}>
          {habits.map(h => (
            <div key={h.id} style={{ display:"flex", alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${T.border}`, gap:10 }}>
              <span style={{ fontSize:16, width:24, textAlign:"center" }}>{h.emoji}</span>
              <span style={{ flex:1, color:T.text, fontSize:13 }}>{h.name}</span>
              <button onClick={()=>remove(h.id)} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:15, padding:2 }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display:"flex", gap:6 }}>
        <input value={newEmoji} onChange={e=>setNewEmoji(e.target.value.slice(0,2))}
          placeholder="✓" style={{ width:44, textAlign:"center", background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:8, padding:"8px 6px", color:T.text, fontSize:14, outline:"none" }}/>
        <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()}
          placeholder="Neue Gewohnheit (z.B. Meditation, 10 Min Lesen)"
          style={{ flex:1, background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:8, padding:"8px 12px", color:T.text, fontFamily:T.serif, fontSize:13, fontStyle:"italic", outline:"none" }}/>
        <button onClick={add} disabled={!newName.trim()} style={{
          background:newName.trim()?`linear-gradient(135deg,${T.dim},${T.acc})`:T.bg2,
          border:"none", borderRadius:8, padding:"0 14px",
          color:newName.trim()?T.bg:T.muted, fontFamily:T.serif, fontSize:13, fontWeight:700,
          cursor:newName.trim()?"pointer":"default"
        }}>+</button>
      </div>
    </Card>
  );
}

function ProfilScreen({ profile, onReset, onUpdate, logsByDate }) {
  // Gewichts-Historie aus allen logs sammeln (gefiltert auf nicht-null)
  const weightHistory = (() => {
    const entries = Object.entries(logsByDate || {})
      .filter(([_, l]) => typeof l?.weight === "number")
      .map(([k, l]) => ({ date: k, weight: l.weight, ts: new Date(k).getTime() }))
      .sort((a, b) => a.ts - b.ts);
    return entries;
  })();

  // Lifetime-Stats: Total-Counts über alles
  const stats = (() => {
    const entries = Object.values(logsByDate || {});
    let totalDays = 0, totalMeals = 0, totalWorkouts = 0, totalMinutes = 0, totalWater = 0;
    for (const l of entries) {
      if (!l) continue;
      const hasAny = (l.meals?.length||0) > 0 || l.water > 0 || l.sleep || l.energy || (l.workouts?.length||0) > 0;
      if (hasAny) totalDays++;
      totalMeals += l.meals?.length || 0;
      totalWater += l.water || 0;
      totalWorkouts += l.workouts?.length || 0;
      totalMinutes += (l.workouts||[]).reduce((s,w)=>s+(w.duration||0),0);
    }
    return { totalDays, totalMeals, totalWorkouts, totalMinutes, totalWater };
  })();

  // Längste Streaks aller Zeiten – durchgehende Tage rückwärts ab je Endpunkt scannen,
  // den längsten Run finden für Wasser≥8, Schlaf≥7h, mindestens 1 Mahlzeit.
  const allTimeStreaks = (() => {
    const dates = Object.keys(logsByDate || {})
      .map(k => ({ k, ts: new Date(k).getTime() }))
      .sort((a, b) => a.ts - b.ts);
    if (dates.length === 0) return { water:0, sleep:0, meal:0 };

    // Vollständige Day-Sequenz vom ersten Eintrag bis heute (mit null wo nichts)
    const start = new Date(dates[0].ts);
    const today = new Date();
    const sequence = [];
    for (let d = new Date(start); d <= today; d.setDate(d.getDate()+1)) {
      const key = d.toDateString();
      sequence.push(logsByDate[key] || null);
    }
    function longestStreak(predicate) {
      let cur = 0, max = 0;
      for (const l of sequence) {
        if (l && predicate(l)) { cur++; if (cur > max) max = cur; }
        else cur = 0;
      }
      return max;
    }
    const wTarget = waterTargetUnits(profile);
    const sTarget = sleepTargetH(profile);
    return {
      water: longestStreak(l => (l.water||0) >= wTarget),
      sleep: longestStreak(l => (parseFloat(String(l.sleep||"0").replace("+","")) || 0) >= sTarget),
      meal:  longestStreak(l => (l.meals?.length||0) > 0),
    };
  })();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);

  function startEdit() {
    setDraft({
      ...profile,
      // Arrays als Comma-Strings darstellen für Inputs
      preferences: Array.isArray(profile.preferences) ? profile.preferences.join(", ") : (profile.preferences||""),
      intolerances: Array.isArray(profile.intolerances) ? profile.intolerances.join(", ") : (profile.intolerances||""),
      allergies: Array.isArray(profile.allergies) ? profile.allergies.join(", ") : (profile.allergies||""),
      sportsPreferred: Array.isArray(profile.sportsPreferred) ? profile.sportsPreferred.join(", ") : (profile.sportsPreferred||""),
    });
    setEditing(true);
  }

  function save() {
    const cleaned = {
      ...draft,
      preferences: String(draft.preferences||"").split(",").map(s=>s.trim()).filter(Boolean),
      intolerances: String(draft.intolerances||"").split(",").map(s=>s.trim()).filter(Boolean),
      allergies: String(draft.allergies||"").split(",").map(s=>s.trim()).filter(Boolean),
      sportsPreferred: String(draft.sportsPreferred||"").split(",").map(s=>s.trim()).filter(Boolean),
    };
    onUpdate?.(cleaned);
    setEditing(false);
  }

  // Toggle für Array-Felder (z.B. kitchenEquipment)
  function toggleArr(key, value) {
    setDraft(prev => {
      const arr = Array.isArray(prev[key]) ? prev[key] : [];
      const next = arr.includes(value) ? arr.filter(x=>x!==value) : [...arr, value];
      return { ...prev, [key]: next };
    });
  }

  function cancel() {
    setDraft(profile);
    setEditing(false);
  }

  const set = (k, v) => setDraft(prev => ({ ...prev, [k]: v }));

  const inputStyle = {
    width:"100%", background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:8,
    padding:"9px 12px", color:T.text, fontSize:13, fontFamily:T.serif, fontStyle:"italic",
    outline:"none", boxSizing:"border-box"
  };
  const numStyle = {...inputStyle, fontFamily:T.mono, fontStyle:"normal"};

  if (editing) {
    return (
      <div>
        <div style={{ display:"flex", alignItems:"center", gap:18, marginBottom:24 }}>
          <EylaOrb size={60}/>
          <div style={{ flex:1 }}>
            <Lbl style={{ marginBottom:5 }}>PROFIL BEARBEITEN</Lbl>
            <h2 style={{ fontSize:22, fontWeight:300, color:T.text, margin:0 }}>Anpassen.</h2>
          </div>
        </div>

        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>NAME & ZIEL</Lbl>
          <div style={{ marginBottom:12 }}>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>NAME</Lbl>
            <input value={draft.name||""} onChange={e=>set("name",e.target.value)} style={inputStyle}/>
          </div>
          <div>
            <Lbl style={{ marginBottom:8, fontSize:10 }}>ZIELE (MEHRERE)</Lbl>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {GOALS.map(g=>{
                const currentArr = Array.isArray(draft.goal) ? draft.goal : (draft.goal ? [draft.goal] : []);
                const sel = currentArr.includes(g);
                return (
                  <button key={g} onClick={()=>{
                    const next = sel ? currentArr.filter(x=>x!==g) : [...currentArr, g];
                    set("goal", next);
                  }} style={{
                    background:sel?T.acc+"22":"transparent",
                    border:`1px solid ${sel?T.acc:T.borderS}`, borderRadius:18,
                    padding:"6px 12px", color:sel?T.text:T.muted,
                    fontFamily:T.serif, fontSize:12, cursor:"pointer",
                    fontStyle:sel?"normal":"italic", transition:"all .2s"
                  }}>{g}</button>
                );
              })}
            </div>
          </div>
        </Card>

        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>KÖRPERDATEN</Lbl>
          <div style={{ marginBottom:12 }}>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>GESCHLECHT</Lbl>
            <div style={{ display:"flex", gap:6 }}>
              {[
                {id:"m", label:"♂ Mann"},
                {id:"f", label:"♀ Frau"},
                {id:"d", label:"⚧ Divers"},
              ].map(o=>{
                const sel = (draft.sex||"")===o.id;
                return (
                  <button key={o.id} onClick={()=>set("sex",o.id)} style={{
                    flex:1, background:sel?T.acc+"22":"transparent",
                    border:`1px solid ${sel?T.acc:T.borderS}`, borderRadius:8,
                    padding:"8px 4px", color:sel?T.text:T.muted,
                    fontFamily:T.serif, fontSize:12, cursor:"pointer", transition:"all .2s"
                  }}>{o.label}</button>
                );
              })}
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:12 }}>
            {[["ALTER","age","Jahre"],["GEWICHT","weight","kg"],["GRÖSSE","height","cm"]].map(([l,k,ph])=>(
              <div key={k}>
                <Lbl style={{ marginBottom:6, fontSize:10 }}>{l}</Lbl>
                <input value={draft[k]||""} onChange={e=>set(k,e.target.value)} type="number" placeholder={ph} style={numStyle}/>
              </div>
            ))}
          </div>
          <div>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>AKTIVITÄT</Lbl>
            <input value={draft.activity||""} onChange={e=>set("activity",e.target.value)} placeholder="z.B. 5x Woche Beweglichkeit" style={inputStyle}/>
          </div>
        </Card>

        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>GEWICHTS-ZIEL</Lbl>
          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
            {[
              {id:"halten",   label:"🟰 Halten",   col:T.acc},
              {id:"abnehmen", label:"↓ Abnehmen",  col:T.green},
              {id:"aufbauen", label:"↑ Aufbauen",  col:T.gold},
            ].map(o=>{
              const sel = (draft.goalType||"halten")===o.id;
              return (
                <button key={o.id} onClick={()=>set("goalType",o.id)} style={{
                  flex:1, background:sel?o.col+"22":"transparent",
                  border:`1px solid ${sel?o.col:T.borderS}`, borderRadius:10,
                  padding:"9px 4px", color:sel?T.text:T.muted,
                  fontFamily:T.serif, fontSize:12, cursor:"pointer", transition:"all .2s"
                }}>{o.label}</button>
              );
            })}
          </div>
          {(draft.goalType && draft.goalType !== "halten") && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div>
                <Lbl style={{ marginBottom:6, fontSize:10 }}>ZIELGEWICHT (KG)</Lbl>
                <input value={draft.targetWeight||""} onChange={e=>set("targetWeight",e.target.value)} type="number" placeholder="kg" style={numStyle}/>
              </div>
              <div>
                <Lbl style={{ marginBottom:6, fontSize:10 }}>IN WOCHEN</Lbl>
                <input value={draft.targetWeeks||""} onChange={e=>set("targetWeeks",e.target.value)} type="number" placeholder="z.B. 12" style={numStyle}/>
              </div>
            </div>
          )}
          {(draft.goalType && draft.goalType !== "halten" && draft.targetWeight && draft.targetWeeks && draft.weight) && (
            <p style={{ color:T.mid, fontSize:11, fontStyle:"italic", fontFamily:T.serif, marginTop:10, padding:"6px 10px", background:T.bg2, borderRadius:6 }}>
              ✦ {(() => {
                const ct = calorieTarget(draft);
                return draft.goalType==="abnehmen"
                  ? `Tagesziel ~${ct.target} kcal (${Math.abs(ct.dailyDelta)} kcal Defizit)`
                  : `Tagesziel ~${ct.target} kcal (${ct.dailyDelta} kcal Überschuss)`;
              })()}
            </p>
          )}
        </Card>

        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>HAUSHALT</Lbl>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:6, marginBottom:10 }}>
            {[
              { n:1, label:"Nur ich" },
              { n:2, label:"Paar" },
              { n:3, label:"Familie" },
              { n:4, label:"Großfamilie" },
            ].map(o => {
              const sel = (parseInt(draft.householdSize)||1) === o.n;
              return (
                <button key={o.n} onClick={()=>set("householdSize", o.n)} style={{
                  background: sel ? T.acc+"22" : "transparent",
                  border:`1px solid ${sel ? T.acc : T.borderS}`,
                  borderRadius:10, padding:"10px 4px",
                  color: sel ? T.text : T.muted,
                  fontFamily:T.serif, fontSize:11, cursor:"pointer",
                  fontStyle: sel ? "normal" : "italic",
                  display:"flex", flexDirection:"column", alignItems:"center", gap:3
                }}>
                  <span style={{ fontFamily:T.mono, fontSize:16 }}>{o.n}{o.n === 4 ? "+" : ""}</span>
                  <span style={{ fontSize:10 }}>{o.label}</span>
                </button>
              );
            })}
          </div>
          <input value={draft.householdNote||""} onChange={e=>set("householdNote",e.target.value)}
            placeholder='Notiz (z.B. "Partner vegetarisch", "2 Kinder unter 10")'
            style={inputStyle}/>
        </Card>

        {/* BERUF & ALLTAG */}
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>BERUF & ALLTAG</Lbl>
          <div style={{ marginBottom:12 }}>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>WAS MACHST DU BERUFLICH?</Lbl>
            <input value={draft.occupation||""} onChange={e=>set("occupation",e.target.value)}
              placeholder='z.B. "Software-Entwickler", "Lehrerin"' style={inputStyle}/>
          </div>
          <div>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>WIE AKTIV IST DEIN JOB?</Lbl>
            <div style={{ display:"flex", gap:6 }}>
              {[
                {id:"sitzend", label:"🪑 Sitzend"},
                {id:"gemischt", label:"🚶 Gemischt"},
                {id:"aktiv", label:"💪 Aktiv"},
              ].map(o=>{
                const sel = (draft.jobActivity||"")===o.id;
                return (
                  <button key={o.id} onClick={()=>set("jobActivity",o.id)} style={{
                    flex:1, background:sel?T.acc+"22":"transparent",
                    border:`1px solid ${sel?T.acc:T.borderS}`, borderRadius:8,
                    padding:"8px 4px", color:sel?T.text:T.muted,
                    fontFamily:T.serif, fontSize:11, cursor:"pointer", transition:"all .2s"
                  }}>{o.label}</button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* TAGESRHYTHMUS */}
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>TAGESRHYTHMUS</Lbl>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
            <div>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>AUFSTEHEN</Lbl>
              <input type="time" value={draft.wakeTime||""} onChange={e=>set("wakeTime",e.target.value)} style={numStyle}/>
            </div>
            <div>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>SCHLAFEN</Lbl>
              <input type="time" value={draft.sleepTime||""} onChange={e=>set("sleepTime",e.target.value)} style={numStyle}/>
            </div>
          </div>
          <div>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>MAHLZEITEN-MUSTER</Lbl>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              {[
                {id:"3normal", label:"🍳 3× normal"},
                {id:"5small",  label:"🥗 5× klein"},
                {id:"if168",   label:"⏱ IF 16:8"},
                {id:"ifother", label:"⏱ IF anders"},
                {id:"custom",  label:"✏️ Eigenes"},
              ].map(o=>{
                const sel = (draft.mealPattern||"3normal")===o.id;
                return (
                  <button key={o.id} onClick={()=>set("mealPattern",o.id)} style={{
                    background:sel?T.acc+"22":"transparent",
                    border:`1px solid ${sel?T.acc:T.borderS}`, borderRadius:8,
                    padding:"8px 6px", color:sel?T.text:T.muted,
                    fontFamily:T.serif, fontSize:11, cursor:"pointer", transition:"all .2s"
                  }}>{o.label}</button>
                );
              })}
            </div>
            {draft.mealPattern==="custom" && (
              <textarea value={draft.mealPatternCustom||""} onChange={e=>set("mealPatternCustom",e.target.value)}
                placeholder='Dein Essrhythmus – z.B. "morgens nur Kaffee, große Mahlzeit 14 Uhr, Snack nach Training, Abendessen 20 Uhr"'
                rows={3} style={{...inputStyle, marginTop:8, resize:"vertical", lineHeight:1.5}}/>
            )}
          </div>
        </Card>

        {/* GESUNDHEIT */}
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>GESUNDHEIT</Lbl>
          <div style={{ marginBottom:12 }}>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>ALLERGIEN (LEBENSWICHTIG)</Lbl>
            <input value={draft.allergies||""} onChange={e=>set("allergies",e.target.value)}
              placeholder="z.B. Erdnüsse, Penicillin" style={inputStyle}/>
          </div>
          <div>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>NOTIZEN (BESCHWERDEN, MEDIKAMENTE, BEOBACHTUNGEN)</Lbl>
            <textarea value={draft.healthNotes||""} onChange={e=>set("healthNotes",e.target.value)}
              placeholder='z.B. "Knieprobleme rechts", "L-Thyroxin morgens", "Reflux abends"'
              rows={3}
              style={{...inputStyle, resize:"vertical", minHeight:60, fontFamily:T.serif, fontStyle:"italic"}}/>
          </div>
        </Card>

        {/* TAGESZIELE */}
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>TAGESZIELE</Lbl>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>WASSER (L)</Lbl>
              <input type="number" step="0.25" min="0.5" max="5"
                value={draft.waterTargetL ?? 2}
                onChange={e=>set("waterTargetL", parseFloat(e.target.value)||2)}
                style={numStyle}/>
            </div>
            <div>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>SCHLAF (H)</Lbl>
              <input type="number" step="0.5" min="4" max="12"
                value={draft.sleepTargetH ?? 7}
                onChange={e=>set("sleepTargetH", parseFloat(e.target.value)||7)}
                style={numStyle}/>
            </div>
          </div>
        </Card>

        {/* SPORT */}
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>SPORT-VORLIEBEN (KOMMAGETRENNT)</Lbl>
          <input value={draft.sportsPreferred||""} onChange={e=>set("sportsPreferred",e.target.value)}
            placeholder="z.B. Yoga, Laufen, Krafttraining, Schwimmen" style={inputStyle}/>
        </Card>

        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>KÜCHE</Lbl>
          <div style={{ marginBottom:12 }}>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>VORLIEBEN (KOMMAGETRENNT)</Lbl>
            <input value={draft.preferences||""} onChange={e=>set("preferences",e.target.value)} placeholder="z.B. Mediterran, Proteinreich" style={inputStyle}/>
          </div>
          <div style={{ marginBottom:12 }}>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>INTOLERANZEN (KOMMAGETRENNT)</Lbl>
            <input value={draft.intolerances||""} onChange={e=>set("intolerances",e.target.value)} placeholder="z.B. Laktose, Gluten" style={inputStyle}/>
          </div>
          <div style={{ marginBottom:12 }}>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>WIE VIEL ZEIT FÜRS KOCHEN?</Lbl>
            <div style={{ display:"flex", gap:6 }}>
              {[
                {id:"quick", label:"⚡ ≤15min"},
                {id:"medium", label:"⏱ 15-30min"},
                {id:"long", label:"🍲 30min+"},
              ].map(o=>{
                const sel = (draft.cookTime||"medium")===o.id;
                return (
                  <button key={o.id} onClick={()=>set("cookTime",o.id)} style={{
                    flex:1, background:sel?T.acc+"22":"transparent",
                    border:`1px solid ${sel?T.acc:T.borderS}`, borderRadius:8,
                    padding:"8px 4px", color:sel?T.text:T.muted,
                    fontFamily:T.serif, fontSize:11, cursor:"pointer", transition:"all .2s"
                  }}>{o.label}</button>
                );
              })}
            </div>
          </div>
          <div>
            <Lbl style={{ marginBottom:6, fontSize:10 }}>KÜCHEN-AUSSTATTUNG</Lbl>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {["Pfanne","Ofen","Mikrowelle","Mixer","Airfryer","Reiskocher","Wok","Thermomix"].map(item=>{
                const sel = (Array.isArray(draft.kitchenEquipment)?draft.kitchenEquipment:[]).includes(item);
                return (
                  <button key={item} onClick={()=>toggleArr("kitchenEquipment", item)} style={{
                    background:sel?T.acc+"22":"transparent",
                    border:`1px solid ${sel?T.acc:T.borderS}`, borderRadius:18,
                    padding:"5px 12px", color:sel?T.text:T.muted,
                    fontFamily:T.serif, fontSize:11, cursor:"pointer",
                    fontStyle:sel?"normal":"italic", transition:"all .2s"
                  }}>{item}</button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* ÜBER MICH – frei text */}
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>ÜBER MICH (FREITEXT)</Lbl>
          <textarea value={draft.about||""} onChange={e=>set("about",e.target.value)}
            placeholder='Alles, was EYLA über dich wissen sollte – Persönlichkeit, Lebenssituation, Werte, was dir wichtig ist...'
            rows={4}
            style={{...inputStyle, resize:"vertical", minHeight:80, fontFamily:T.serif, fontStyle:"italic", lineHeight:1.5}}/>
        </Card>

        {/* FLO – Zyklus-Tracking */}
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>🌸 FLO – ZYKLUS-TRACKING</Lbl>
          <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 14px", lineHeight:1.5 }}>
            Periode tracken + Empfehlungen pro Zyklusphase. Nur du siehst diese Daten (lokal + dein Cloud-Sync).
          </p>
          {/* Master Toggle */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", marginBottom:8 }}>
            <span style={{ fontFamily:T.serif, fontSize:13, color:T.text }}>Zyklus tracken</span>
            <button onClick={()=>set("trackCycle", !draft.trackCycle)} style={{
              width:42, height:24, borderRadius:14,
              background: draft.trackCycle ? "#c97a6f" : T.border,
              border:"none", cursor:"pointer", position:"relative", transition:"background .2s"
            }}>
              <span style={{
                position:"absolute", top:2, left: draft.trackCycle ? 20 : 2,
                width:20, height:20, borderRadius:"50%", background:T.bg,
                transition:"left .2s"
              }}/>
            </button>
          </div>
          {draft.trackCycle && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:6 }}>
              <div>
                <Lbl style={{ marginBottom:6, fontSize:10 }}>ZYKLUS Ø-LÄNGE (TAGE)</Lbl>
                <input type="number" min="21" max="40"
                  value={draft.cycleLengthAvg||28}
                  onChange={e=>set("cycleLengthAvg", parseInt(e.target.value)||28)}
                  style={numStyle}/>
              </div>
              <div>
                <Lbl style={{ marginBottom:6, fontSize:10 }}>PERIODEN-DAUER</Lbl>
                <input type="number" min="2" max="10"
                  value={draft.periodLengthAvg||5}
                  onChange={e=>set("periodLengthAvg", parseInt(e.target.value)||5)}
                  style={numStyle}/>
              </div>
            </div>
          )}
        </Card>

        {/* PUSH-NOTIFICATIONS (vor Erinnerungen weil die nichts wert sind ohne Push) */}
        <PushSettingsCard/>

        {/* ERINNERUNGEN */}
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>ERINNERUNGEN</Lbl>
          <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 14px", lineHeight:1.5 }}>
            EYLA erinnert dich an Wasser, Mahlzeiten, Schlaf. Browser-Notification wenn erlaubt, sonst in-App-Banner. Nur 1x pro Tag pro Reminder.
          </p>
          {/* Master Toggle */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", marginBottom:8, borderBottom:`1px solid ${T.border}` }}>
            <span style={{ fontFamily:T.serif, fontSize:13, color:T.text }}>Erinnerungen aktiv</span>
            <button onClick={()=>set("reminders", { ...(draft.reminders||{}), enabled: !(draft.reminders?.enabled) })}
              style={{
                width:42, height:24, borderRadius:14,
                background: draft.reminders?.enabled ? T.acc : T.border,
                border:"none", cursor:"pointer", position:"relative", transition:"background .2s"
              }}>
              <span style={{
                position:"absolute", top:2, left: draft.reminders?.enabled ? 20 : 2,
                width:20, height:20, borderRadius:"50%", background:T.bg,
                transition:"left .2s"
              }}/>
            </button>
          </div>
          {/* Permission-Hint */}
          {draft.reminders?.enabled && typeof Notification !== "undefined" && Notification.permission !== "granted" && (
            <button onClick={async ()=>{
              try { await Notification.requestPermission(); } catch {}
              setDraft(p => ({...p})); // re-render
            }} style={{
              width:"100%", background:T.gold+"18", border:`1px solid ${T.gold}55`,
              borderRadius:10, padding:"9px 12px", color:T.gold,
              fontFamily:T.serif, fontSize:12, cursor:"pointer", marginBottom:12,
              fontStyle:"italic"
            }}>
              {Notification.permission === "denied"
                ? "🔕 Browser-Benachrichtigungen blockiert – nur In-App-Banner"
                : "🔔 Browser-Benachrichtigungen erlauben (empfohlen)"}
            </button>
          )}
          {/* Pro Reminder: Toggle + Zeit */}
          {[
            { key:"morning",  label:"Morgens",   hint:"Schlaf + Energie eintragen" },
            { key:"lunch",    label:"Mittag",    hint:"Was hast du gegessen?" },
            { key:"water",    label:"Wasser",    hint:"Falls Tagesziel noch nicht erreicht" },
            { key:"evening",  label:"Abends",    hint:"Tag kurz reflektieren" },
          ].map(r => {
            const settings = draft.reminders?.[r.key] || { enabled:true, time:"" };
            const disabled = !draft.reminders?.enabled;
            return (
              <div key={r.key} style={{
                display:"flex", alignItems:"center", gap:10, padding:"8px 0",
                borderBottom:`1px solid ${T.border}`,
                opacity: disabled ? .4 : 1, pointerEvents: disabled ? "none" : "auto"
              }}>
                <button onClick={()=>{
                  const newRems = { ...(draft.reminders||{}) };
                  newRems[r.key] = { ...settings, enabled: !settings.enabled };
                  set("reminders", newRems);
                }} style={{
                  width:30, height:18, borderRadius:10,
                  background: settings.enabled ? T.acc : T.border,
                  border:"none", cursor:"pointer", position:"relative", flexShrink:0
                }}>
                  <span style={{
                    position:"absolute", top:2, left: settings.enabled ? 14 : 2,
                    width:14, height:14, borderRadius:"50%", background:T.bg
                  }}/>
                </button>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:T.serif, fontSize:13, color:T.text }}>{r.label}</div>
                  <div style={{ color:T.muted, fontSize:10, fontStyle:"italic", fontFamily:T.serif }}>{r.hint}</div>
                </div>
                <input type="time" value={settings.time||""} onChange={e=>{
                  const newRems = { ...(draft.reminders||{}) };
                  newRems[r.key] = { ...settings, time: e.target.value };
                  set("reminders", newRems);
                }} style={{
                  background:T.bg, border:`1px solid ${T.borderS}`, borderRadius:6,
                  padding:"5px 8px", color:T.text, fontFamily:T.mono, fontSize:12, outline:"none"
                }}/>
              </div>
            );
          })}
        </Card>

        <div style={{ display:"flex", gap:10, marginTop:18 }}>
          <button onClick={save} disabled={!String(draft.name||"").trim()} style={{
            background: String(draft.name||"").trim() ? `linear-gradient(135deg,${T.dim},${T.acc})` : "transparent",
            border: String(draft.name||"").trim() ? "none" : `1px solid ${T.borderS}`,
            borderRadius:12, padding:"11px 24px",
            color: String(draft.name||"").trim() ? T.bg : T.muted,
            fontFamily:T.serif, fontSize:14, fontWeight:700,
            cursor: String(draft.name||"").trim() ? "pointer" : "default"
          }}>Speichern ✦</button>
          <button onClick={cancel} style={{
            background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:12,
            padding:"11px 22px", color:T.muted, fontFamily:T.serif, fontSize:14,
            cursor:"pointer", fontStyle:"italic"
          }}>Abbrechen</button>
        </div>
      </div>
    );
  }

  // View mode
  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",gap:18,marginBottom:28 }}>
        <EylaOrb size={60}/>
        <div style={{ flex:1, minWidth:0 }}>
          <Lbl style={{ marginBottom:5 }}>DEIN PROFIL</Lbl>
          <h2 style={{ fontSize:22,fontWeight:300,color:T.text,margin:0 }}>{profile.name}</h2>
          <p style={{ color:T.muted,fontStyle:"italic",fontSize:12,margin:"4px 0 0",fontFamily:T.serif }}>{Array.isArray(profile.goal) ? (profile.goal.join(", ")||"Wohlbefinden") : (profile.goal||"Wohlbefinden")}</p>
        </div>
        <button onClick={startEdit} style={{
          background:T.acc+"18", border:`1px solid ${T.acc}44`, borderRadius:10,
          padding:"8px 14px", color:T.acc, fontFamily:T.mono, fontSize:10,
          cursor:"pointer", letterSpacing:1, flexShrink:0
        }}>✎ BEARBEITEN</button>
      </div>
      {/* ÜBER MICH – Sektion */}
      <div style={{ fontFamily:T.mono, fontSize:9, color:T.muted, letterSpacing:2, margin:"4px 4px 10px", display:"flex", alignItems:"center", gap:8 }}>
        <span>ÜBER MICH</span>
        <div style={{ flex:1, height:1, background:T.borderS, opacity:.5 }}/>
      </div>

      <Card style={{ marginBottom:12 }}>
        <Lbl style={{ marginBottom:14 }}>KÖRPERDATEN</Lbl>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }}>
          {[
            ["Geschlecht", profile.sex==="m"?"♂ Mann":profile.sex==="f"?"♀ Frau":profile.sex==="d"?"⚧ Divers":"–"],
            ["Alter",`${profile.age||"–"}J`],
            ["Gewicht",`${profile.weight||"–"}kg`],
            ["Größe",`${profile.height||"–"}cm`],
            ["Aktivität",profile.activity||"–"]
          ].map(([k,v])=>(
            <div key={k}><Lbl style={{ marginBottom:3,fontSize:10 }}>{k}</Lbl><div style={{ color:T.text,fontSize:14 }}>{v}</div></div>
          ))}
        </div>
      </Card>

      {/* HAUSHALT – fehlt bisher in View-Mode! */}
      <Card style={{ marginBottom:12 }}>
        <Lbl style={{ marginBottom:14 }}>HAUSHALT</Lbl>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{
            width:46, height:46, borderRadius:"50%", background:T.acc+"18",
            border:`1px solid ${T.acc}44`, display:"flex", alignItems:"center",
            justifyContent:"center", fontFamily:T.mono, fontSize:17, color:T.acc, flexShrink:0
          }}>
            {(parseInt(profile.householdSize)||1)}{parseInt(profile.householdSize)>=4?"+":""}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:T.text, fontSize:14, fontFamily:T.serif }}>
              {(()=>{const n=parseInt(profile.householdSize)||1; return n===1?"Nur ich":n===2?"Paar":n===3?"Familie":"Großfamilie";})()}
            </div>
            {profile.householdNote ? (
              <div style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, marginTop:3, lineHeight:1.5 }}>
                {profile.householdNote}
              </div>
            ) : (
              <div style={{ color:T.muted, fontSize:10, fontFamily:T.mono, marginTop:3, opacity:.6 }}>
                tippe BEARBEITEN für Notizen
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* BERUF & ALLTAG */}
      {(profile.occupation || profile.jobActivity) && (
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:14 }}>BERUF & ALLTAG</Lbl>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            {profile.occupation && (
              <div>
                <Lbl style={{ marginBottom:3, fontSize:10 }}>Beruf</Lbl>
                <div style={{ color:T.text, fontSize:14 }}>{profile.occupation}</div>
              </div>
            )}
            {profile.jobActivity && (
              <div>
                <Lbl style={{ marginBottom:3, fontSize:10 }}>Aktivität</Lbl>
                <div style={{ color:T.text, fontSize:14 }}>
                  {profile.jobActivity==="sitzend"?"🪑 Sitzend":profile.jobActivity==="aktiv"?"💪 Aktiv":"🚶 Gemischt"}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* TAGESRHYTHMUS */}
      {(profile.wakeTime || profile.sleepTime || profile.mealPattern) && (
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:14 }}>TAGESRHYTHMUS</Lbl>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
            {profile.wakeTime && (
              <div>
                <Lbl style={{ marginBottom:3, fontSize:10 }}>Auf</Lbl>
                <div style={{ color:T.text, fontSize:14, fontFamily:T.mono }}>🌅 {profile.wakeTime}</div>
              </div>
            )}
            {profile.sleepTime && (
              <div>
                <Lbl style={{ marginBottom:3, fontSize:10 }}>Bett</Lbl>
                <div style={{ color:T.text, fontSize:14, fontFamily:T.mono }}>🌙 {profile.sleepTime}</div>
              </div>
            )}
            {profile.mealPattern && (
              <div>
                <Lbl style={{ marginBottom:3, fontSize:10 }}>Pattern</Lbl>
                <div style={{ color:T.text, fontSize:13 }}>
                  {profile.mealPattern==="3normal"?"🍳 3× normal":
                   profile.mealPattern==="5small"?"🥗 5× klein":
                   profile.mealPattern==="if168"?"⏱ IF 16:8":
                   profile.mealPattern==="ifother"?"⏱ IF anders":
                   profile.mealPattern==="custom"?"✏️ Eigenes":"–"}
                </div>
                {profile.mealPattern==="custom" && profile.mealPatternCustom?.trim() && (
                  <div style={{ color:T.muted, fontSize:11, fontFamily:T.serif, fontStyle:"italic", marginTop:2, lineHeight:1.4 }}>
                    {profile.mealPatternCustom.trim()}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* GESUNDHEIT */}
      {((profile.allergies?.length>0) || profile.healthNotes) && (
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:14 }}>GESUNDHEIT</Lbl>
          {profile.allergies?.length>0 && (
            <div style={{ marginBottom: profile.healthNotes ? 14 : 0 }}>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>⚠ ALLERGIEN</Lbl>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {profile.allergies.map((a,i)=>(
                  <span key={i} style={{ background:T.red+"22",border:`1px solid ${T.red}55`,borderRadius:18,padding:"3px 12px",fontSize:11,color:T.red,fontFamily:T.mono }}>{a}</span>
                ))}
              </div>
            </div>
          )}
          {profile.healthNotes && (
            <div>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>NOTIZEN</Lbl>
              <div style={{ color:T.text, fontSize:13, fontFamily:T.serif, fontStyle:"italic", lineHeight:1.6, whiteSpace:"pre-wrap" }}>
                {profile.healthNotes}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* KÜCHE – Vorlieben + Intoleranzen + Kochzeit + Equipment */}
      {((profile.preferences?.length>0) || (profile.intolerances?.length>0) || profile.cookTime || (profile.kitchenEquipment?.length>0)) && (
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:14 }}>KÜCHE</Lbl>
          {profile.preferences?.length>0 && (
            <div style={{ marginBottom: 14 }}>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>VORLIEBEN</Lbl>
              <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                {profile.preferences.map((p,i)=>(
                  <span key={i} style={{ background:T.acc+"18",border:`1px solid ${T.acc}33`,borderRadius:18,padding:"3px 12px",fontSize:11,color:T.acc,fontFamily:T.mono }}>{p}</span>
                ))}
              </div>
            </div>
          )}
          {profile.intolerances?.length>0 && (
            <div style={{ marginBottom: 14 }}>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>INTOLERANZEN</Lbl>
              <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                {profile.intolerances.map((p,i)=>(
                  <span key={i} style={{ background:T.gold+"18",border:`1px solid ${T.gold}33`,borderRadius:18,padding:"3px 12px",fontSize:11,color:T.gold,fontFamily:T.mono }}>{p}</span>
                ))}
              </div>
            </div>
          )}
          {profile.cookTime && (
            <div style={{ marginBottom: (profile.kitchenEquipment?.length>0) ? 14 : 0 }}>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>KOCHZEIT</Lbl>
              <div style={{ color:T.text, fontSize:13 }}>
                {profile.cookTime==="quick"?"⚡ ≤15min":profile.cookTime==="long"?"🍲 30min+":"⏱ 15-30min"}
              </div>
            </div>
          )}
          {profile.kitchenEquipment?.length>0 && (
            <div>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>AUSSTATTUNG</Lbl>
              <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                {profile.kitchenEquipment.map((p,i)=>(
                  <span key={i} style={{ background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:18,padding:"3px 12px",fontSize:11,color:T.mid,fontFamily:T.mono }}>{p}</span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* SPORT */}
      {profile.sportsPreferred?.length>0 && (
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:14 }}>SPORT-VORLIEBEN</Lbl>
          <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
            {profile.sportsPreferred.map((p,i)=>(
              <span key={i} style={{ background:T.green+"18",border:`1px solid ${T.green}33`,borderRadius:18,padding:"3px 12px",fontSize:11,color:T.green,fontFamily:T.mono }}>{p}</span>
            ))}
          </div>
        </Card>
      )}

      {/* ÜBER MICH (Freitext) */}
      {profile.about && (
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:10 }}>ÜBER MICH</Lbl>
          <div style={{ color:T.text, fontSize:13, fontFamily:T.serif, fontStyle:"italic", lineHeight:1.6, whiteSpace:"pre-wrap" }}>
            {profile.about}
          </div>
        </Card>
      )}

      {/* ZIEL & KALORIEN – Sektion */}
      <div style={{ fontFamily:T.mono, fontSize:9, color:T.muted, letterSpacing:2, margin:"22px 4px 10px", display:"flex", alignItems:"center", gap:8 }}>
        <span>ZIEL & KALORIEN</span>
        <div style={{ flex:1, height:1, background:T.borderS, opacity:.5 }}/>
      </div>
      {/* Gewichts-Ziel + Kalorien-Target */}
      {(() => {
        const ct = calorieTarget(profile);
        const typeLabel = ct.type === "halten" ? "🟰 Halten" : ct.type === "abnehmen" ? "↓ Abnehmen" : "↑ Aufbauen";
        const typeCol = ct.type === "halten" ? T.acc : ct.type === "abnehmen" ? T.green : T.gold;
        return (
          <Card style={{ marginBottom:12 }}>
            <Lbl style={{ marginBottom:12 }}>GEWICHTS-ZIEL</Lbl>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <span style={{
                background:typeCol+"18", border:`1px solid ${typeCol}44`, borderRadius:20,
                padding:"4px 12px", fontSize:12, color:typeCol, fontFamily:T.serif
              }}>{typeLabel}</span>
              {ct.type !== "halten" && profile.targetWeight && profile.targetWeeks && (
                <span style={{ fontFamily:T.mono, fontSize:11, color:T.muted }}>
                  → {profile.targetWeight}kg in {profile.targetWeeks} Wochen
                </span>
              )}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <div>
                <Lbl style={{ marginBottom:3, fontSize:10 }}>TDEE</Lbl>
                <div style={{ color:T.muted, fontSize:14, fontFamily:T.mono }}>{ct.tdee} kcal</div>
              </div>
              <div>
                <Lbl style={{ marginBottom:3, fontSize:10 }}>TAGESZIEL</Lbl>
                <div style={{ color:typeCol, fontSize:14, fontFamily:T.mono }}>
                  {ct.target} kcal
                  {ct.dailyDelta !== 0 && (
                    <span style={{ fontSize:11, color:T.muted, marginLeft:6 }}>
                      ({ct.dailyDelta>0?"+":""}{ct.dailyDelta})
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })()}

      {/* Gewichts-Verlauf */}
      {weightHistory.length >= 2 && (
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:12 }}>GEWICHTS-VERLAUF · {weightHistory.length} EINTRÄGE</Lbl>
          {(() => {
            const values = weightHistory.map(e => e.weight);
            const min = Math.min(...values, parseFloat(profile.targetWeight)||values[0]) - 0.5;
            const max = Math.max(...values, parseFloat(profile.targetWeight)||values[0]) + 0.5;
            const range = Math.max(0.001, max - min);
            const W = 100, H = 60;
            const pts = weightHistory.map((e, i) => {
              const x = (i / (weightHistory.length-1)) * W;
              const y = H - ((e.weight - min) / range) * H;
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(" ");
            const targetY = profile.targetWeight ? H - ((parseFloat(profile.targetWeight) - min) / range) * H : null;
            const lastWeight = values[values.length-1];
            const firstWeight = values[0];
            const delta = lastWeight - firstWeight;
            return (
              <>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
                  <div>
                    <div style={{ fontSize:20, color:T.text, fontFamily:T.mono, fontWeight:300 }}>
                      {lastWeight}<span style={{ fontSize:11, color:T.muted, marginLeft:3 }}>kg</span>
                    </div>
                    <div style={{ fontSize:10, color: delta < 0 ? T.green : delta > 0 ? T.gold : T.muted, fontFamily:T.mono, marginTop:2 }}>
                      {delta > 0 ? "+" : ""}{delta.toFixed(1)}kg seit {new Date(weightHistory[0].date).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})}
                    </div>
                  </div>
                  {profile.targetWeight && (
                    <div style={{ fontSize:10, color:T.acc, fontFamily:T.mono, textAlign:"right" }}>
                      Ziel: {profile.targetWeight}kg
                      <div style={{ color:T.muted, marginTop:2 }}>
                        {(lastWeight - parseFloat(profile.targetWeight)).toFixed(1)}kg zu gehen
                      </div>
                    </div>
                  )}
                </div>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width:"100%", height:90, display:"block" }}>
                  {targetY !== null && (
                    <line x1="0" y1={targetY} x2={W} y2={targetY}
                      stroke={T.acc+"66"} strokeWidth="0.4" strokeDasharray="1.5,1.5"/>
                  )}
                  <polyline points={pts} fill="none" stroke={T.mid} strokeWidth="0.7" strokeLinejoin="round" strokeLinecap="round"/>
                  {weightHistory.map((e, i) => {
                    const x = (i / (weightHistory.length-1)) * W;
                    const y = H - ((e.weight - min) / range) * H;
                    return <circle key={i} cx={x} cy={y} r="0.9" fill={T.mid}/>;
                  })}
                </svg>
              </>
            );
          })()}
        </Card>
      )}

      {/* Körpermaße */}
      <MeasurementsCard/>

      {/* TRACKING – Sektion */}
      <div style={{ fontFamily:T.mono, fontSize:9, color:T.muted, letterSpacing:2, margin:"22px 4px 10px", display:"flex", alignItems:"center", gap:8 }}>
        <span>TRACKING</span>
        <div style={{ flex:1, height:1, background:T.borderS, opacity:.5 }}/>
      </div>

      {/* Habits-Editor */}
      <HabitsEditor profile={profile} onUpdate={onUpdate}/>

      {/* Lifetime-Stats */}
      {stats.totalDays > 0 && (
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:12 }}>ZAHLEN · GESAMT</Lbl>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:20, color:T.text, fontFamily:T.mono, fontWeight:300 }}>{stats.totalDays}</div>
              <div style={{ fontSize:9, color:T.muted, fontFamily:T.mono, letterSpacing:1, marginTop:2 }}>TAGE</div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:20, color:T.gold, fontFamily:T.mono, fontWeight:300 }}>{stats.totalMeals}</div>
              <div style={{ fontSize:9, color:T.muted, fontFamily:T.mono, letterSpacing:1, marginTop:2 }}>MAHLZEITEN</div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:20, color:T.green, fontFamily:T.mono, fontWeight:300 }}>{stats.totalWorkouts}</div>
              <div style={{ fontSize:9, color:T.muted, fontFamily:T.mono, letterSpacing:1, marginTop:2 }}>WORKOUTS</div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:20, color:T.acc, fontFamily:T.mono, fontWeight:300 }}>
                {(stats.totalWater*.25).toFixed(0)}<span style={{ fontSize:11, color:T.muted, marginLeft:1 }}>L</span>
              </div>
              <div style={{ fontSize:9, color:T.muted, fontFamily:T.mono, letterSpacing:1, marginTop:2 }}>WASSER</div>
            </div>
          </div>
          {stats.totalMinutes > 0 && (
            <div style={{ marginTop:10, textAlign:"center", color:T.muted, fontFamily:T.serif, fontSize:11, fontStyle:"italic" }}>
              Insgesamt {Math.floor(stats.totalMinutes/60)}h {stats.totalMinutes%60}min trainiert.
            </div>
          )}
        </Card>
      )}

      {/* Rekord-Streaks */}
      {(allTimeStreaks.water > 0 || allTimeStreaks.sleep > 0 || allTimeStreaks.meal > 0) && (
        <Card style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:12 }}>REKORDE · LÄNGSTE STREAKS</Lbl>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
            {[
              { label:`💧 Wasser ≥${waterTargetL(profile)}L`, value:allTimeStreaks.water, color:T.acc },
              { label:`😴 Schlaf ≥${sleepTargetH(profile)}h`, value:allTimeStreaks.sleep, color:T.mid },
              { label:"🍽 Mahlzeit", value:allTimeStreaks.meal, color:T.gold },
            ].map(s => (
              <div key={s.label} style={{ textAlign:"center", padding:"4px 0" }}>
                <div style={{ fontSize:11, color:T.muted, fontStyle:"italic", fontFamily:T.serif, marginBottom:4 }}>{s.label}</div>
                <div style={{ fontSize:24, fontFamily:T.mono, color: s.value > 0 ? s.color : T.muted, fontWeight:300 }}>
                  {s.value}
                </div>
                <div style={{ fontSize:9, color:T.muted, fontFamily:T.mono, letterSpacing:1, marginTop:2 }}>
                  TAG{s.value===1?"":"E"}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* DATEN – Sektion */}
      <div style={{ fontFamily:T.mono, fontSize:9, color:T.muted, letterSpacing:2, margin:"22px 4px 10px", display:"flex", alignItems:"center", gap:8 }}>
        <span>DATEN</span>
        <div style={{ flex:1, height:1, background:T.borderS, opacity:.5 }}/>
      </div>

      {/* Backup-Card – jetzt hinter EYLA */}
      <Card style={{ marginBottom:12 }}>
        <Lbl style={{ marginBottom:10 }}>BACKUP</Lbl>
        <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 14px", lineHeight:1.6 }}>
          Sicherheits-Backup als JSON. Wenn was schiefgeht oder du auf ein anderes Gerät willst – Datei reichen, fertig.
        </p>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button onClick={async ()=>{
            const keys = ["eyla_profile_v3","eyla_logs_v1","eyla_local_events_v2","eyla_shopping_v1","eyla_plan_v1","eyla_chat_v1","eyla_chat_voice_v1"];
            const data = {};
            for (const k of keys) {
              const raw = localStorage.getItem(k);
              if (raw) { try { data[k] = JSON.parse(raw); } catch {} }
            }
            const blob = new Blob([JSON.stringify({ exportedAt:new Date().toISOString(), version:1, data }, null, 2)], { type:"application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const today = new Date().toISOString().slice(0,10);
            a.href = url;
            a.download = `eyla-backup-${today}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }} style={{
            background:T.acc+"18", border:`1px solid ${T.acc}44`, borderRadius:10,
            padding:"9px 16px", color:T.acc, fontFamily:T.serif, fontSize:12,
            cursor:"pointer", fontStyle:"italic"
          }}>↓ Export (JSON)</button>

          <button onClick={()=>document.getElementById("eyla-import-input")?.click()} style={{
            background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:10,
            padding:"9px 16px", color:T.mid, fontFamily:T.serif, fontSize:12,
            cursor:"pointer", fontStyle:"italic"
          }}>↑ Import</button>
          <input id="eyla-import-input" type="file" accept="application/json,.json" style={{ display:"none" }}
            onChange={(e)=>{
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  const parsed = JSON.parse(reader.result);
                  const data = parsed?.data || parsed;
                  if (!data || typeof data !== "object") throw new Error("ungültig");
                  if (!confirm("Daten aus dem Backup importieren? Bestehende Daten werden überschrieben.")) return;
                  for (const [k, v] of Object.entries(data)) {
                    if (k.startsWith("eyla_")) {
                      try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
                    }
                  }
                  alert("Import erfolgreich. App lädt neu.");
                  location.reload();
                } catch (err) {
                  alert("Konnte Backup nicht lesen: " + (err.message||err));
                }
                e.target.value = "";
              };
              reader.readAsText(file);
            }}/>
        </div>
      </Card>

      <button onClick={onReset} style={{ background:"transparent",border:`1px solid ${T.borderS}`,borderRadius:10,padding:"9px 18px",color:T.muted,fontFamily:T.serif,fontSize:12,cursor:"pointer",fontStyle:"italic" }}>Profil zurücksetzen</button>
    </div>
  );
}

// ─── PASSCODE GATE ────────────────────────────────────────────────────────────
// Verhindert Zugriff ohne Code. Code aus VITE_ACCESS_CODE (Vercel ENV) oder
// fallback. Einmal entsperrt: in localStorage gemerkt. Soft-Gate, kein Krypto:
// JS-Bundle könnte mit DevTools inspiziert werden – reicht aber als
// Casual-Zugriffsschutz solange die App nicht öffentlich sein soll.
function PasscodeGate({ onUnlock }) {
  const correctCode = (import.meta.env.VITE_ACCESS_CODE || "eyla-2026").toLowerCase();
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  function submit() {
    if (input.trim().toLowerCase() === correctCode) {
      persist("eyla_access_granted_v1", true);
      // Code auch direkt persistieren – wird als User-Identifier für Cloud-Sync genutzt
      persist("eyla_access_code_v1", input.trim().toLowerCase());
      onUnlock();
    } else {
      setError(true);
      setTimeout(() => setError(false), 1500);
      setInput("");
    }
  }

  return (
    <div style={{
      minHeight:"100vh", background:T.bg, display:"flex",
      alignItems:"center", justifyContent:"center", padding:24,
      fontFamily:T.serif
    }}>
      <div style={{ width:"100%", maxWidth:360, textAlign:"center" }}>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:28 }}>
          <EylaOrb size={70}/>
        </div>
        <Lbl style={{ marginBottom:14 }}>EYLA · ZUGANG</Lbl>
        <h2 style={{ fontSize:22, fontWeight:300, color:T.text, margin:"0 0 10px", letterSpacing:.5 }}>
          Geschlossener Vorabbereich.
        </h2>
        <p style={{ color:T.mid, fontSize:13, fontStyle:"italic", marginBottom:30, fontFamily:T.serif, lineHeight:1.6 }}>
          Aktuell nur über Code erreichbar.<br/>
          Wenn du keinen hast, frag Phil.
        </p>
        <input
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&submit()}
          placeholder="Code"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          style={{
            width:"100%",
            background:T.bg2,
            border:`1px solid ${error?T.red:T.borderS}`,
            borderRadius:10,
            padding:"13px 16px",
            color:T.text,
            fontSize:15,
            textAlign:"center",
            letterSpacing:3,
            fontFamily:T.mono,
            outline:"none",
            boxSizing:"border-box",
            marginBottom:12,
            transition:"border-color .2s"
          }}
        />
        {error && (
          <p style={{ color:T.red, fontSize:12, fontStyle:"italic", margin:"0 0 12px", fontFamily:T.serif }}>
            Falscher Code.
          </p>
        )}
        <button onClick={submit} disabled={!input.trim()} style={{
          marginTop:6,
          width:"100%",
          background: input.trim() ? `linear-gradient(135deg,${T.dim},${T.acc})` : "transparent",
          border: input.trim() ? "none" : `1px solid ${T.borderS}`,
          borderRadius:12,
          padding:"12px 28px",
          color: input.trim() ? T.bg : T.muted,
          fontFamily:T.serif,
          fontSize:14,
          fontWeight:700,
          cursor: input.trim() ? "pointer" : "default"
        }}>Eintreten ✦</button>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [cloudPulling, setCloudPulling] = useState(false);

  useEffect(() => {
    (async () => {
      const granted = await retrieve("eyla_access_granted_v1", false);
      if (granted) {
        // Cloud-Pull beim Boot wenn schon entsperrt
        setCloudPulling(true);
        await pullCloudIntoLocal().catch(()=>{});
        setCloudPulling(false);
        // Falls Cloud leer war aber local Daten hat: push hoch.
        // Falls Cloud Daten hatte: push lokales (was identisch sein sollte) ebenfalls hoch.
        scheduleSyncUp();
      }
      setAccessGranted(!!granted);
      setAccessChecked(true);

      // Persistent-Storage-API: iOS evictet sonst nach 7 Tagen
      try {
        if (navigator.storage && navigator.storage.persist) {
          await navigator.storage.persist();
        }
      } catch {}
    })();
  }, []);

  async function handleUnlock() {
    setCloudPulling(true);
    await pullCloudIntoLocal().catch(()=>{});
    setCloudPulling(false);
    // Falls auf diesem Gerät schon Daten lokal sind aber Cloud leer war,
    // push hoch damit andere Geräte sie sehen.
    scheduleSyncUp();
    setAccessGranted(true);
  }

  // Warten bis Storage-Check fertig (vermeidet kurzes Flackern der Gate)
  if (!accessChecked) {
    return <div style={{ minHeight:"100vh", background:T.bg }}/>;
  }

  if (!accessGranted) {
    return <PasscodeGate onUnlock={handleUnlock}/>;
  }

  if (cloudPulling) {
    return (
      <div style={{ minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14 }}>
        <EylaOrb size={56} thinking/>
        <Lbl>SYNCHRONISIERE …</Lbl>
      </div>
    );
  }

  return <AppContent/>;
}

// ─── KLEINE HELPERS ───────────────────────────────────────────────────────────
function getEylaCode() {
  try { return JSON.parse(localStorage.getItem("eyla_access_code_v1") || "null"); } catch { return null; }
}

async function fetchJSON(url, opts={}) {
  const code = getEylaCode();
  const headers = { ...(opts.headers||{}) };
  if (code) headers["x-eyla-code"] = code;
  if (opts.body && !(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const r = await fetch(url, { ...opts, headers });
  let j = null;
  try { j = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data: j };
}

// (Integrations-Code entfernt – wir bauen den Kalender selbst, ohne Google/Strava/Gmail)
// ─── FLO – Zyklus-Tracking + Phase-Detection ──────────────────────────────────
// Datenmodell eyla_cycle_v1: Array von Period-Einträgen:
//   { id, start: "YYYY-MM-DD", end: "YYYY-MM-DD"|null, flow:"light|medium|heavy",
//     symptoms:[], notes }
// Phasen klassisch (28-Tage Zyklus):
//   Tag 1-5:    Menstruation
//   Tag 6-13:   Follikulär
//   Tag 14-16:  Ovulation
//   Tag 17-28:  Luteal (inkl. PMS in den letzten Tagen)
function loadCycles() {
  try { return JSON.parse(localStorage.getItem("eyla_cycle_v1")||"[]"); } catch { return []; }
}
function saveCycles(arr) {
  try { localStorage.setItem("eyla_cycle_v1", JSON.stringify(arr)); } catch {}
  window.dispatchEvent(new Event("eyla_cycle_changed"));
}
function isoToday() { return new Date().toISOString().slice(0,10); }
function daysBetween(isoA, isoB) {
  return Math.round((new Date(isoB) - new Date(isoA)) / 86400000);
}
// Aktueller Zyklus-Status für ein Datum (default heute)
function getCycleStatus(cycles, profile, refDate = isoToday()) {
  if (!cycles || cycles.length === 0) return { phase: null, dayOfCycle: null };
  // Sortiere absteigend nach start
  const sorted = [...cycles].sort((a,b) => b.start.localeCompare(a.start));
  // Finde letzten Period-Start der vor refDate liegt
  const last = sorted.find(c => c.start <= refDate);
  if (!last) return { phase: null, dayOfCycle: null };
  const dayOfCycle = daysBetween(last.start, refDate) + 1;
  const cycleLength = parseInt(profile?.cycleLengthAvg) || 28;
  const periodLength = parseInt(profile?.periodLengthAvg) || 5;
  // Wenn end gesetzt: Menstruation bis dahin
  const periodEnd = last.end ? daysBetween(last.start, last.end) + 1 : periodLength;
  let phase;
  if (dayOfCycle <= periodEnd) phase = "menstruation";
  else if (dayOfCycle <= Math.floor(cycleLength / 2) - 2) phase = "follikular";
  else if (dayOfCycle <= Math.floor(cycleLength / 2) + 2) phase = "ovulation";
  else phase = "luteal";
  const nextPeriodIn = cycleLength - dayOfCycle + 1;
  return {
    phase, dayOfCycle, cycleLength,
    lastStart: last.start,
    nextPeriodIn: nextPeriodIn > 0 ? nextPeriodIn : null,
    isOverdue: dayOfCycle > cycleLength + 2,
  };
}
const PHASE_INFO = {
  menstruation: {
    label: "Menstruation", icon: "🌙", color: "#c97a6f",
    short: "Ruhe-Modus", nutrition: "Eisenreich (rotes Fleisch, Linsen, Spinat) · Magnesium · viel Wasser · Wärme",
    workout: "Sanft: Yoga, Spazieren, Mobility — kein Hardcore",
  },
  follikular: {
    label: "Follikulär", icon: "🌱", color: "#6b8e84",
    short: "Aufbau-Phase", nutrition: "Frisches Gemüse · Beeren · fermentierte Lebensmittel · genug Protein",
    workout: "Energie steigt — neue Workouts ausprobieren, Kraft, Cardio",
  },
  ovulation: {
    label: "Ovulation", icon: "✨", color: "#d4a574",
    short: "Peak-Energie", nutrition: "Antioxidantien · Avocado · Nüsse · genug Wasser (Hitzewallungen)",
    workout: "Stärkste Zeit — HIIT, Wettkampf, Maximal-Versuche",
  },
  luteal: {
    label: "Luteal / PMS", icon: "🌗", color: "#b09c7a",
    short: "Rückzug", nutrition: "Komplexe Carbs · Kalzium · weniger Koffein/Salz · Magnesium gegen PMS",
    workout: "Moderate Cardio · Yoga · Pilates — auf Körper hören",
  },
};

// FloCard – Status, Phase, Tipps, Period-Toggle
function FloCard({ profile }) {
  const [cycles, setCycles] = useState(loadCycles());
  const [showTips, setShowTips] = useState(false);
  useEffect(() => {
    function onChange() { setCycles(loadCycles()); }
    window.addEventListener("eyla_cycle_changed", onChange);
    return () => window.removeEventListener("eyla_cycle_changed", onChange);
  }, []);
  const status = getCycleStatus(cycles, profile);
  const today = isoToday();

  function startPeriod() {
    const arr = loadCycles();
    arr.push({ id: Date.now(), start: today, end: null, flow:"medium", symptoms:[] });
    saveCycles(arr);
    haptic(15);
  }
  function endPeriod() {
    const arr = loadCycles();
    if (arr.length === 0) return;
    const sorted = [...arr].sort((a,b) => b.start.localeCompare(a.start));
    const last = sorted[0];
    last.end = today;
    saveCycles(arr);
    haptic(15);
  }
  function deleteLast() {
    if (!confirm("Letzten Period-Eintrag löschen?")) return;
    const arr = loadCycles();
    const sorted = [...arr].sort((a,b) => b.start.localeCompare(a.start));
    if (sorted.length === 0) return;
    const newArr = arr.filter(c => c.id !== sorted[0].id);
    saveCycles(newArr);
  }

  // Wenn noch nie ein Period eingetragen: Onboarding-Hint
  if (!status.phase) {
    return (
      <Card style={{ marginBottom:12, background:"#c97a6f0A", border:"1px solid #c97a6f33" }}>
        <Lbl color="#c97a6f" style={{ marginBottom:8 }}>🌸 FLO – ZYKLUS</Lbl>
        <p style={{ color:T.mid, fontSize:12, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 10px", lineHeight:1.5 }}>
          Noch kein Eintrag. Tippe wenn deine Periode heute startet — danach erkennt EYLA die Phase automatisch und passt Empfehlungen an.
        </p>
        <button onClick={startPeriod} style={{
          background:"#c97a6f22", border:"1px solid #c97a6f88", borderRadius:10,
          padding:"8px 14px", color:"#c97a6f", fontFamily:T.serif, fontSize:12,
          cursor:"pointer", fontStyle:"italic"
        }}>🌙 Periode startet heute</button>
      </Card>
    );
  }

  const info = PHASE_INFO[status.phase];
  const isInPeriod = status.phase === "menstruation";
  // Letzten Eintrag finden für end-Toggle
  const last = [...cycles].sort((a,b) => b.start.localeCompare(a.start))[0];
  const periodIsOpen = isInPeriod && !last?.end;

  return (
    <Card style={{ marginBottom:12, background: info.color + "0A", border:`1px solid ${info.color}33` }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <Lbl color={info.color}>🌸 FLO · {info.label.toUpperCase()}</Lbl>
        <span style={{ fontFamily:T.mono, fontSize:10, color:T.muted, letterSpacing:1 }}>
          TAG {status.dayOfCycle}/{status.cycleLength}
        </span>
      </div>
      <div style={{ display:"flex", alignItems:"flex-start", gap:14, marginBottom:10 }}>
        <div style={{
          width:54, height:54, borderRadius:"50%",
          background: info.color + "22", border:`2px solid ${info.color}88`,
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0
        }}>{info.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:T.text, fontSize:14, fontFamily:T.serif, marginBottom:3 }}>
            {info.short}
          </div>
          {status.nextPeriodIn !== null && (
            <div style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif }}>
              {status.isOverdue
                ? `Periode ${status.dayOfCycle - status.cycleLength} Tage überfällig`
                : status.nextPeriodIn <= 3
                ? `Nächste Periode in ${status.nextPeriodIn} Tag${status.nextPeriodIn===1?"":"en"}`
                : `Nächste Periode ca. in ${status.nextPeriodIn} Tagen`}
            </div>
          )}
        </div>
      </div>

      <button onClick={()=>setShowTips(s=>!s)} style={{
        width:"100%", background:"transparent", border:`1px dashed ${info.color}66`, borderRadius:8,
        padding:"6px 10px", color:info.color, fontFamily:T.mono, fontSize:10,
        letterSpacing:1, cursor:"pointer", textAlign:"left", marginBottom:showTips?10:0
      }}>{showTips?"▾":"▸"} TIPPS FÜR DIESE PHASE</button>

      {showTips && (
        <div style={{ animation:"fadeUp .2s ease both" }}>
          <div style={{ marginBottom:8 }}>
            <Lbl style={{ marginBottom:3, fontSize:9 }}>🍽 ERNÄHRUNG</Lbl>
            <div style={{ color:T.text, fontSize:12, fontFamily:T.serif, lineHeight:1.6 }}>{info.nutrition}</div>
          </div>
          <div>
            <Lbl style={{ marginBottom:3, fontSize:9 }}>🏋 BEWEGUNG</Lbl>
            <div style={{ color:T.text, fontSize:12, fontFamily:T.serif, lineHeight:1.6 }}>{info.workout}</div>
          </div>
        </div>
      )}

      {/* Action-Pills */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:12 }}>
        {!periodIsOpen ? (
          <button onClick={startPeriod} style={{
            background:info.color+"22", border:`1px solid ${info.color}88`, borderRadius:18,
            padding:"5px 12px", color:info.color, fontFamily:T.mono, fontSize:10,
            letterSpacing:1, cursor:"pointer"
          }}>🌙 PERIODE STARTET</button>
        ) : (
          <button onClick={endPeriod} style={{
            background:info.color+"22", border:`1px solid ${info.color}88`, borderRadius:18,
            padding:"5px 12px", color:info.color, fontFamily:T.mono, fontSize:10,
            letterSpacing:1, cursor:"pointer"
          }}>✓ PERIODE ENDET HEUTE</button>
        )}
        <button onClick={deleteLast} title="Letzten Eintrag löschen (falls Fehleingabe)" style={{
          background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:18,
          padding:"5px 10px", color:T.muted, fontFamily:T.mono, fontSize:10,
          letterSpacing:1, cursor:"pointer"
        }}>↶</button>
      </div>
    </Card>
  );
}

// ─── PUNKTE-AWARD-TOAST (Studio-Feedback) ───────────────────────────────────
function PointsAwardToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    function onAward(e) {
      setToast({ ...e.detail, id: Date.now() });
    }
    window.addEventListener("eyla_points_awarded", onAward);
    return () => window.removeEventListener("eyla_points_awarded", onAward);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div style={{
      position:"fixed", left:0, right:0,
      top:"calc(env(safe-area-inset-top, 0px) + 70px)",
      zIndex:300, display:"flex", justifyContent:"center", padding:"0 14px",
      pointerEvents:"none", animation:"fadeUp .3s ease both"
    }}>
      <div style={{
        background:`linear-gradient(135deg, ${T.gold}, ${T.goldL})`,
        color:"#1a1200", borderRadius:99, padding:"8px 16px",
        fontFamily:T.serif, fontSize:13, fontWeight:700,
        display:"flex", alignItems:"center", gap:8,
        boxShadow:`0 8px 28px ${T.gold}66`
      }}>
        <span style={{ fontSize:16 }}>⭐</span>
        +{toast.points} Punkte · {toast.label}
      </div>
    </div>
  );
}

// ─── WOCHEN-REFLEXION (Sonntagabend) ──────────────────────────────────────────
// Sonntags ab 19 Uhr: Modal mit geführten Fragen + Wochen-Statistik.
// Antworten werden als Notiz pro Tag gespeichert + als "weekly_reflections" Liste.
function WeeklyReflectionModal({ logsByDate, profile, open, onClose }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ highlight:"", challenge:"", learning:"", next_week:"" });
  if (!open) return null;

  // Wochen-Stats berechnen
  const stats = (() => {
    const days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toDateString();
      const l = logsByDate?.[key];
      if (l) days.push(l);
    }
    if (days.length === 0) return null;
    const meals = days.reduce((s,l)=>s+(l.meals?.length||0),0);
    const totalKcal = days.reduce((s,l)=>s + (l.meals||[]).reduce((a,m)=>a+(m.calories||0),0), 0);
    const water = days.reduce((s,l)=>s+(l.water||0),0);
    const workouts = days.reduce((s,l)=>s+(l.workouts?.length||0),0);
    const workoutMin = days.reduce((s,l)=>s+(l.workouts||[]).reduce((a,w)=>a+(w.duration||0),0), 0);
    const sleeps = days.map(l => parseFloat(String(l.sleep||"0").replace("+",""))).filter(n => n > 0);
    const avgSleep = sleeps.length > 0 ? (sleeps.reduce((s,n)=>s+n,0) / sleeps.length).toFixed(1) : "–";
    return {
      meals, kcalAvg: Math.round(totalKcal / Math.max(1, days.length)),
      waterAvgL: ((water / Math.max(1, days.length)) * 0.25).toFixed(1),
      workouts, workoutMin, avgSleep, daysTracked: days.length,
    };
  })();

  const questions = [
    { key:"highlight",  q:"Was war diese Woche dein Highlight?", placeholder:"Ein Moment, ein Erfolg, ein gutes Gespräch …" },
    { key:"challenge",  q:"Was hat dich gefordert?",             placeholder:"Eine schwierige Sache, ein Konflikt, eine Hürde …" },
    { key:"learning",   q:"Was hast du gelernt?",                placeholder:"Über dich, über andere, über die Welt …" },
    { key:"next_week",  q:"Was nimmst du dir für nächste Woche vor?", placeholder:"Eine Sache, ein Habit, ein Vorhaben …" },
  ];

  function save() {
    const entry = {
      weekEnding: new Date().toISOString().slice(0,10),
      stats,
      ...answers,
      createdAt: new Date().toISOString(),
    };
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem("eyla_reflections_v1") || "[]"); } catch {}
    arr.unshift(entry);
    try { localStorage.setItem("eyla_reflections_v1", JSON.stringify(arr.slice(0, 52))); } catch {}
    // Marker dass diese Woche reflektiert
    try { localStorage.setItem("eyla_reflected_" + new Date().toISOString().slice(0,10).slice(0,7), "1"); } catch {}
    onClose();
  }

  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, zIndex:1100, background:"rgba(0,0,0,0.78)",
      backdropFilter:"blur(10px)", display:"flex", alignItems:"center", justifyContent:"center", padding:20,
      animation:"fadeUp .3s ease both"
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:T.bg2, border:`1px solid ${T.acc}55`, borderRadius:16,
        padding:24, maxWidth:420, width:"100%",
        boxShadow:`0 10px 60px ${T.acc}33`
      }}>
        {step === 0 ? (
          <>
            <div style={{ textAlign:"center", marginBottom:14 }}>
              <div style={{ fontSize:36, marginBottom:6 }}>✨</div>
              <Lbl color={T.acc} style={{ marginBottom:6 }}>WOCHEN-REFLEXION</Lbl>
              <h2 style={{ fontSize:22, fontWeight:300, color:T.text, margin:"0 0 6px", fontFamily:T.serif }}>
                Die Woche kurz durchgehen?
              </h2>
              <p style={{ color:T.mid, fontSize:12, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 16px", lineHeight:1.6 }}>
                4 kurze Fragen. Hilft dir den Bogen zu spannen.
              </p>
            </div>
            {stats && (
              <div style={{ background:T.bg, border:`1px solid ${T.borderS}`, borderRadius:12, padding:14, marginBottom:18 }}>
                <Lbl style={{ marginBottom:10 }}>DEINE WOCHE</Lbl>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div><span style={{ fontFamily:T.mono, fontSize:18, color:T.gold }}>{stats.meals}</span><span style={{ fontSize:10, color:T.muted, marginLeft:6, fontFamily:T.serif, fontStyle:"italic" }}>Mahlzeiten</span></div>
                  <div><span style={{ fontFamily:T.mono, fontSize:18, color:T.acc }}>{stats.waterAvgL}L</span><span style={{ fontSize:10, color:T.muted, marginLeft:6, fontFamily:T.serif, fontStyle:"italic" }}>Wasser/Tag</span></div>
                  <div><span style={{ fontFamily:T.mono, fontSize:18, color:T.green }}>{stats.workouts}</span><span style={{ fontSize:10, color:T.muted, marginLeft:6, fontFamily:T.serif, fontStyle:"italic" }}>Workouts · {stats.workoutMin}min</span></div>
                  <div><span style={{ fontFamily:T.mono, fontSize:18, color:T.mid }}>{stats.avgSleep}h</span><span style={{ fontSize:10, color:T.muted, marginLeft:6, fontFamily:T.serif, fontStyle:"italic" }}>Schlaf Ø</span></div>
                </div>
              </div>
            )}
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setStep(1)} style={{
                flex:1, background:`linear-gradient(135deg,${T.dim},${T.acc})`,
                border:"none", borderRadius:12, padding:"12px 18px",
                color:T.bg, fontFamily:T.serif, fontSize:14, fontWeight:700, cursor:"pointer"
              }}>Los geht's →</button>
              <button onClick={onClose} style={{
                background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:12,
                padding:"12px 18px", color:T.muted, fontFamily:T.serif, fontSize:14,
                fontStyle:"italic", cursor:"pointer"
              }}>Später</button>
            </div>
          </>
        ) : step <= questions.length ? (() => {
          const q = questions[step - 1];
          return (
            <>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <Lbl color={T.acc}>FRAGE {step} VON {questions.length}</Lbl>
                <span style={{ fontFamily:T.mono, fontSize:10, color:T.muted }}>{Math.round((step / questions.length) * 100)}%</span>
              </div>
              <div style={{ height:3, background:T.bg, borderRadius:2, marginBottom:16, overflow:"hidden" }}>
                <div style={{ width:`${(step / questions.length) * 100}%`, height:"100%", background:T.acc, transition:"width .3s" }}/>
              </div>
              <h3 style={{ fontSize:18, fontWeight:300, color:T.text, margin:"0 0 14px", fontFamily:T.serif }}>
                {q.q}
              </h3>
              <textarea value={answers[q.key]} onChange={e=>setAnswers(a=>({...a, [q.key]:e.target.value}))}
                placeholder={q.placeholder} rows={5}
                style={{
                  width:"100%", background:T.bg, border:`1px solid ${T.borderS}`,
                  borderRadius:10, padding:"12px 14px",
                  color:T.text, fontSize:14, fontFamily:T.serif, fontStyle:"italic",
                  outline:"none", resize:"vertical", minHeight:100, lineHeight:1.6,
                  boxSizing:"border-box", marginBottom:14
                }} autoFocus/>
              <div style={{ display:"flex", gap:8 }}>
                {step > 1 && (
                  <button onClick={()=>setStep(s=>s-1)} style={{
                    background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:10,
                    padding:"10px 16px", color:T.muted, fontFamily:T.serif, fontSize:13, cursor:"pointer"
                  }}>← Zurück</button>
                )}
                {step < questions.length ? (
                  <button onClick={()=>setStep(s=>s+1)} style={{
                    flex:1, background:`linear-gradient(135deg,${T.dim},${T.acc})`,
                    border:"none", borderRadius:10, padding:"10px 16px",
                    color:T.bg, fontFamily:T.serif, fontSize:13, fontWeight:700, cursor:"pointer"
                  }}>Weiter →</button>
                ) : (
                  <button onClick={save} style={{
                    flex:1, background:`linear-gradient(135deg,${T.gold},${T.acc})`,
                    border:"none", borderRadius:10, padding:"10px 16px",
                    color:T.bg, fontFamily:T.serif, fontSize:13, fontWeight:700, cursor:"pointer"
                  }}>✓ Speichern</button>
                )}
              </div>
            </>
          );
        })() : null}
      </div>
    </div>
  );
}

function WeeklyReflectionTrigger({ logsByDate, profile }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const now = new Date();
    if (now.getDay() !== 0) return; // nur Sonntag
    if (now.getHours() < 19 || now.getHours() > 23) return;
    const weekKey = "eyla_reflected_" + now.toISOString().slice(0,10).slice(0,7) + "_" + Math.floor(now.getDate() / 7);
    if (localStorage.getItem(weekKey)) return;
    // Nur triggern wenn es überhaupt Daten gibt
    const hasData = Object.keys(logsByDate||{}).length >= 3;
    if (!hasData) return;
    // Nach 4s automatisch öffnen (App-Settling)
    const t = setTimeout(() => setOpen(true), 4000);
    return () => clearTimeout(t);
  }, [logsByDate]);
  return (
    <WeeklyReflectionModal
      logsByDate={logsByDate}
      profile={profile}
      open={open}
      onClose={() => {
        setOpen(false);
        try {
          const now = new Date();
          const weekKey = "eyla_reflected_" + now.toISOString().slice(0,10).slice(0,7) + "_" + Math.floor(now.getDate() / 7);
          localStorage.setItem(weekKey, "1");
        } catch {}
      }}
    />
  );
}

// ─── PUSH NOTIFICATIONS (echte System-Notifications via Service Worker) ──────
// urlBase64ToUint8Array – Helper für VAPID applicationServerKey
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function usePushSubscription() {
  const [status, setStatus] = useState({
    supported: false, registered: false, subscribed: false, loading: true, error: null
  });

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window;
    if (!supported) {
      setStatus({ supported:false, registered:false, subscribed:false, loading:false, error:null });
      return;
    }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        setStatus({ supported:true, registered:true, subscribed: !!sub, loading:false, error:null });
      } catch (e) {
        setStatus({ supported:true, registered:false, subscribed:false, loading:false, error:String(e?.message||e) });
      }
    })();
  }, []);

  async function subscribe() {
    setStatus(s => ({...s, loading:true, error:null}));
    try {
      // Permission anfordern
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setStatus(s => ({...s, loading:false, error:"Permission abgelehnt"})); return; }
      // VAPID Public Key holen
      const { ok, data } = await fetchJSON("/api/push?action=public-key");
      if (!ok || !data?.key) { setStatus(s => ({...s, loading:false, error: data?.error || "VAPID-Key fehlt im Backend"})); return; }
      // SW + Push subscribe
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.key),
      });
      // An Backend schicken
      const r = await fetchJSON("/api/push?action=subscribe", {
        method:"POST", body: JSON.stringify({ subscription: sub })
      });
      if (!r.ok) { setStatus(s => ({...s, loading:false, error: r.data?.error || "Subscribe failed"})); return; }
      setStatus(s => ({...s, subscribed:true, loading:false }));
    } catch (e) {
      setStatus(s => ({...s, loading:false, error: String(e?.message||e) }));
    }
  }
  async function unsubscribe() {
    setStatus(s => ({...s, loading:true}));
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetchJSON("/api/push?action=unsubscribe", {
          method:"POST", body: JSON.stringify({ endpoint: sub.endpoint })
        });
        await sub.unsubscribe();
      }
      setStatus(s => ({...s, subscribed:false, loading:false}));
    } catch (e) {
      setStatus(s => ({...s, loading:false, error: String(e?.message||e)}));
    }
  }
  async function sendTest() {
    const r = await fetchJSON("/api/push?action=test", { method:"POST" });
    if (!r.ok) alert("Test-Push fehlgeschlagen: " + (r.data?.error || r.status));
    else alert(`✓ Test-Push verschickt (${r.data.sent}/${r.data.sent+r.data.failed} Devices). Sollte gleich kommen.`);
  }
  return { ...status, subscribe, unsubscribe, sendTest };
}

function PushSettingsCard() {
  const push = usePushSubscription();
  if (!push.supported) {
    return (
      <Card style={{ marginBottom:12, opacity:.6 }}>
        <Lbl style={{ marginBottom:8 }}>PUSH-NOTIFICATIONS</Lbl>
        <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, margin:0, lineHeight:1.5 }}>
          Dein Browser unterstützt das nicht (iOS &lt; 16.4 oder kein PWA).<br/>
          Tipp: App zum Home-Screen hinzufügen (Safari → Teilen → „Zum Home-Bildschirm").
        </p>
      </Card>
    );
  }
  return (
    <Card style={{ marginBottom:12 }}>
      <Lbl style={{ marginBottom:8 }}>PUSH-NOTIFICATIONS</Lbl>
      <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 14px", lineHeight:1.5 }}>
        Echte System-Benachrichtigungen — auch wenn die App zu ist. Funktioniert nur wenn die App als PWA installiert ist (iOS Safari → Teilen → Zum Home-Bildschirm).
      </p>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontFamily:T.serif, fontSize:13, color:T.text }}>
          {push.subscribed ? "✓ Aktiv auf diesem Gerät" : push.loading ? "…" : "Nicht aktiv"}
        </span>
        {push.subscribed ? (
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={push.sendTest} style={{
              background:"transparent", border:`1px solid ${T.acc}55`, borderRadius:8,
              padding:"5px 12px", color:T.acc, fontFamily:T.mono, fontSize:10,
              letterSpacing:1, cursor:"pointer"
            }}>TEST</button>
            <button onClick={push.unsubscribe} disabled={push.loading} style={{
              background:"transparent", border:`1px solid ${T.red}33`, borderRadius:8,
              padding:"5px 12px", color:T.red+"AA", fontFamily:T.mono, fontSize:10,
              letterSpacing:1, cursor:"pointer"
            }}>TRENNEN</button>
          </div>
        ) : (
          <button onClick={push.subscribe} disabled={push.loading} style={{
            background: T.acc+"22", border:`1px solid ${T.acc}88`, borderRadius:8,
            padding:"6px 14px", color:T.acc, fontFamily:T.mono, fontSize:11,
            letterSpacing:1, cursor:"pointer", fontWeight:700
          }}>{push.loading ? "…" : "✦ AKTIVIEREN"}</button>
        )}
      </div>
      {push.error && (
        <p style={{ color:T.red, fontSize:10, fontStyle:"italic", margin:"10px 0 0", fontFamily:T.serif }}>
          {push.error}
        </p>
      )}
    </Card>
  );
}

// ─── REMINDERS ────────────────────────────────────────────────────────────────
// Mix aus Browser-Notification (wenn Permission granted) und In-App-Banner
// als Fallback. Pro Tag pro Typ max 1 Trigger (localStorage-Marker).
// Checkt alle 60s ob ein Reminder fällig ist; nur wenn App offen ist.

const REMINDER_MESSAGES = {
  morning:  { title:"Guten Morgen", body:"Wie war die Nacht? Trag deinen Schlaf ein." },
  lunch:    { title:"Mittag fällig", body:"Was hast du gegessen?" },
  water:    { title:"Wasser-Check", body:"Trink noch was. Du liegst noch unter Ziel." },
  evening:  { title:"Tag-Reflexion", body:"Wie war heute? Kurz aufschreiben?" },
};

function reminderDueAt(profile, type) {
  const r = profile?.reminders?.[type];
  if (!r || !r.enabled) return null;
  return r.time || null; // "HH:MM"
}
function isAfterTime(now, hhmm) {
  if (!hhmm) return false;
  const [h, m] = hhmm.split(":").map(n => parseInt(n)||0);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  return now >= target;
}
function reminderMarkerKey(type, dateKey) { return `eyla_rem_${type}_${dateKey}`; }

function useReminders(profile, log) {
  const [activeReminder, setActiveReminder] = useState(null);
  const [hasPermission, setHasPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission === "granted" : false
  );

  function dismissReminder() {
    if (activeReminder) {
      try { localStorage.setItem(reminderMarkerKey(activeReminder.type, new Date().toDateString()), "1"); } catch {}
    }
    setActiveReminder(null);
  }

  async function requestPermission() {
    if (typeof Notification === "undefined") return false;
    try {
      const result = await Notification.requestPermission();
      const granted = result === "granted";
      setHasPermission(granted);
      return granted;
    } catch { return false; }
  }

  useEffect(() => {
    if (!profile?.reminders?.enabled) return;
    function check() {
      const now = new Date();
      const dateKey = now.toDateString();
      // Reihenfolge: morning, lunch, water, evening
      const types = ["morning","lunch","water","evening"];
      for (const type of types) {
        const time = reminderDueAt(profile, type);
        if (!time) continue;
        if (!isAfterTime(now, time)) continue;
        // bereits heute getriggert?
        try { if (localStorage.getItem(reminderMarkerKey(type, dateKey))) continue; } catch {}
        // Sinnvolle Skip-Logik – wenn der Datentyp schon erledigt ist, nicht triggern
        if (type === "morning"  && log?.sleep) continue;
        if (type === "lunch"    && (log?.meals||[]).length > 0) continue;
        if (type === "water"    && (log?.water||0) >= waterTargetUnits(profile)) continue;
        if (type === "evening"  && log?.note) continue;
        // Trigger
        const msg = REMINDER_MESSAGES[type];
        setActiveReminder({ type, ...msg });
        if (hasPermission && typeof Notification !== "undefined") {
          try { new Notification(`EYLA · ${msg.title}`, { body: msg.body, icon:"/icon-192.png", tag:`eyla-${type}-${dateKey}` }); } catch {}
        }
        try { localStorage.setItem(reminderMarkerKey(type, dateKey), "1"); } catch {}
        haptic(40);
        return; // ein Reminder pro Check
      }
    }
    check(); // sofort beim Mount/Profil-Change
    const id = setInterval(check, 60_000); // alle 60s
    // auch beim sichtbar-werden checken (z.B. zurück aus Tab-Switch)
    function onVis() { if (document.visibilityState === "visible") check(); }
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [profile, log, hasPermission]);

  return { activeReminder, dismissReminder, requestPermission, hasPermission };
}

function ReminderBanner({ reminder, onDismiss }) {
  if (!reminder) return null;
  return (
    <div style={{
      position:"fixed", left:0, right:0,
      top:"calc(env(safe-area-inset-top, 0px) + 70px)",
      zIndex:60, display:"flex", justifyContent:"center", padding:"0 14px",
      pointerEvents:"none",
      animation:"fadeUp .3s ease both"
    }}>
      <div style={{
        pointerEvents:"auto",
        maxWidth:480, width:"100%",
        background: T.bg2+"F0", backdropFilter:"blur(20px)",
        border:`1px solid ${T.gold}55`, borderRadius:12,
        padding:"12px 14px",
        display:"flex", alignItems:"flex-start", gap:12,
        boxShadow:`0 8px 30px ${T.gold}22`
      }}>
        <div style={{ fontSize:18 }}>✦</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:T.mono, fontSize:9, color:T.gold, letterSpacing:1.5, marginBottom:3 }}>
            EYLA · {reminder.title.toUpperCase()}
          </div>
          <div style={{ color:T.text, fontSize:13, fontFamily:T.serif, lineHeight:1.45 }}>
            {reminder.body}
          </div>
        </div>
        <button onClick={onDismiss} style={{
          background:"transparent", border:"none", color:T.muted,
          fontSize:18, cursor:"pointer", padding:"0 4px", lineHeight:1
        }}>×</button>
      </div>
    </div>
  );
}

function AppContent() {
  const [profile, setProfile] = useState(null);
  const [logsByDate, setLogsByDate] = useState({});
  const [screen, setScreen] = useState("tag");
  const [tagSub, setTagSub] = useState("heute");      // heute | kalender
  const [essenSub, setEssenSub] = useState("plan");   // plan | liste
  const [heuteDate, setHeuteDate] = useState(()=>new Date());  // Datum für TodayScreen, lift für Cross-Screen-Navigation
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const syncState = useSyncStatus();

  // Abgeleiteter Log für heute
  const log = logsByDate[TODAY] || EMPTY_LOG();

  // Reminders – nur wenn profile geladen
  const reminders = useReminders(profile, log);

  // Load everything on mount – migriert alle alten Keys automatisch
  useEffect(()=>{
    (async()=>{
      const profileKeys = ["eyla_profile_v3","eyla_profile_v2","lyra_profile_v2","lyra_profile"];

      let p = null;
      for (const k of profileKeys) { p = await retrieve(k); if (p) break; }

      // Profil akzeptieren wenn es gesetzt ist und einen Namen hat.
      // (Frueher wurden "Phil" und "Marcus" als Demo-Defaults verworfen –
      //  Quatsch wenn der User echt Phil heisst.)
      if (p && p.name && p.name.trim().length > 0) {
        setProfile(p);
      } else {
        setProfile(null);
      }

      // Neue Date-Map laden
      let map = await retrieve("eyla_logs_v1", null) || {};

      // Migration: alter Single-Day-Log → Date-Map
      const legacyLog = await retrieve("eyla_log_v3", null);
      if (legacyLog && legacyLog.date) {
        // Nur einfügen wenn dieser Tag noch nicht in der neuen Map ist
        if (!map[legacyLog.date]) {
          map = { ...map, [legacyLog.date]: legacyLog };
        }
        await persist("eyla_logs_v1", map);
        await persist("eyla_log_v3", null);
      }

      setLogsByDate(map);
      setReady(true);
    })();
  },[]);

  // Fetch calendar when profile ready
  useEffect(()=>{
    if (!profile) return;
    loadCalendar();
  },[profile]);

  function loadCalendar() {
    setEventsLoading(true);
    fetchCalendarEvents().then(ev=>{ setEvents(ev||[]); setEventsLoading(false); });
  }

  // setLog akzeptiert optional einen dateKey (toDateString format) – sonst TODAY
  function setLog(fn, dateKey) {
    const key = dateKey || TODAY;
    setLogsByDate(prevMap=>{
      const prevLog = prevMap[key] || { meals:[], water:0, energy:"", sleep:"", workouts:[], weight:null, date:key };
      const next = typeof fn==="function" ? fn(prevLog) : fn;
      const withDate = {...next, date:key};
      const nextMap = { ...prevMap, [key]: withDate };
      persist("eyla_logs_v1", nextMap);
      return nextMap;
    });
  }

  function finishOnboarding(p) {
    persist("eyla_profile_v3", p);
    setProfile(p);
  }

  function updateProfile(p) {
    persist("eyla_profile_v3", p);
    setProfile(p);
  }

  function reset() {
    persist("eyla_profile_v3", null);
    persist("eyla_log_v3", null);
    persist("eyla_logs_v1", null);
    persist("eyla_local_events_v2", null);
    persist("eyla_shopping_v1", null);
    persist("eyla_plan_v1", null);
    persist("eyla_chat_v1", null);
    // Auch leeren Stand in die Cloud syncen damit andere Geräte nicht alte Daten zurückbringen
    setProfile(null);
    setLogsByDate({});
    setEvents([]);
  }

  if (!ready) return (
    <div style={{ minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center" }}>
      <EylaOrb size={60} thinking/>
    </div>
  );

  if (!profile) return <Onboarding onDone={finishOnboarding}/>;

  const nav = [
    {id:"tag",    icon:"◎", label:"Tag"},
    {id:"studio", icon:"★", label:"Studio"},
    {id:"essen",  icon:"◈", label:"Essen"},
    {id:"profil", icon:"◉", label:"Profil"},
  ];

  const sectionColor =
    screen==="tag" ? (tagSub==="kalender" ? T.gold : T.acc) :
    screen==="woche" ? T.acc :
    screen==="studio" ? T.gold :
    screen==="essen" ? (essenSub==="liste" ? T.green : T.gold) :
    T.muted;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:T.serif, color:T.text }}>
      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:${T.acc}22;border-radius:2px}
        input::placeholder{color:${T.muted};font-style:italic}
        input:focus{border-color:${T.acc}88!important;outline:none}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
      `}</style>

      {/* BG glow – Farbe je nach aktivem Tab */}
      <div style={{ position:"fixed",inset:0,pointerEvents:"none",transition:"background .4s",
        background:`radial-gradient(ellipse at 50% 0%, ${sectionColor}0A 0%, transparent 50%)` }}/>

      {/* Reminder-Banner (oben unter Top-Bar, wenn ein Reminder aktiv ist) */}
      <ReminderBanner reminder={reminders.activeReminder} onDismiss={reminders.dismissReminder}/>

      {/* Studio-Punkte-Award-Toast */}
      <PointsAwardToast/>

      {/* Wochen-Reflexion — Sonntag 19-23 Uhr automatisch */}
      <WeeklyReflectionTrigger logsByDate={logsByDate} profile={profile}/>

      {/* Top bar – feiner Akzent von Section-Color am unteren Rand. Safe-Area für iPhone-Notch. */}
      <div style={{ position:"sticky",top:0,zIndex:40,background:T.bg+"F0",
        backdropFilter:"blur(20px)",borderBottom:`1px solid ${sectionColor}33`,
        paddingTop:"calc(12px + env(safe-area-inset-top, 0px))",
        paddingBottom:"12px",
        paddingLeft:"calc(20px + env(safe-area-inset-left, 0px))",
        paddingRight:"calc(20px + env(safe-area-inset-right, 0px))",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        transition:"border-color .4s" }}>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          <EylaOrb size={38} thinking={eventsLoading}/>
          <div>
            <div style={{ fontSize:18, fontWeight:300, color:T.text, letterSpacing:1.5, lineHeight:1 }}>
              EYLA<span style={{ color:T.acc, marginLeft:2 }}>.</span>
            </div>
            <div style={{ fontSize:11, color:T.muted, fontStyle:"italic", marginTop:3, fontFamily:T.serif }}>
              {profile.name.split(" ")[0]}
            </div>
          </div>
        </div>
        <div style={{ display:"flex",gap:6,alignItems:"center" }}>
          {events.length>0&&<span style={{ background:T.gold+"18",border:`1px solid ${T.gold}33`,borderRadius:20,padding:"3px 10px",fontSize:10,color:T.gold,fontFamily:T.mono }}>▦ {events.length}</span>}
          {/* Sync-Indikator (nur wenn was zu zeigen ist) */}
          {syncState.status !== "idle" && (
            <span title={
              syncState.status === "ok" ? `Synchronisiert ${syncState.lastSyncedAt?.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})||""}` :
              syncState.status === "syncing" ? "Synchronisiere …" :
              syncState.status === "off" ? "Cloud-Sync nicht eingerichtet" :
              "Sync-Fehler – Daten bleiben lokal"
            } style={{
              fontSize:10, fontFamily:T.mono,
              color: syncState.status === "ok" ? T.green
                   : syncState.status === "syncing" ? T.mid
                   : syncState.status === "off" ? T.muted
                   : T.gold,
              padding:"3px 8px", borderRadius:20,
              background: (syncState.status === "ok" ? T.green : syncState.status === "syncing" ? T.mid : syncState.status === "off" ? T.muted : T.gold) + "18",
              border:`1px solid ${(syncState.status === "ok" ? T.green : syncState.status === "syncing" ? T.mid : syncState.status === "off" ? T.muted : T.gold) + "33"}`,
              cursor:"default"
            }}>
              {syncState.status === "ok" ? "↑ sync" :
               syncState.status === "syncing" ? "↻ sync" :
               syncState.status === "off" ? "× sync" : "! sync"}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{
        maxWidth:920, margin:"0 auto", position:"relative", zIndex:2,
        paddingTop: 22,
        paddingLeft: "calc(18px + env(safe-area-inset-left, 0px))",
        paddingRight: "calc(18px + env(safe-area-inset-right, 0px))",
        paddingBottom: "calc(96px + env(safe-area-inset-bottom, 0px))"
      }}>
        {screen==="tag" && (
          <>
            <SubTabRow current={tagSub} onChange={setTagSub} options={[
              {id:"heute",    label:"Heute",    color:T.acc},
              {id:"woche",    label:"Woche",    color:T.acc},
              {id:"kalender", label:"Kalender", color:T.gold},
            ]}/>
            {tagSub==="heute"    && <TodayScreen profile={profile} setLog={setLog} logsByDate={logsByDate} events={events} initialDate={heuteDate}/>}
            {tagSub==="woche"    && <WeekScreen logsByDate={logsByDate} profile={profile} onJumpToDay={(d) => { setHeuteDate(d); setTagSub("heute"); }}/>}
            {tagSub==="kalender" && <KalenderScreen events={events} eventsLoading={eventsLoading} onRefresh={loadCalendar} profile={profile} log={log}/>}
          </>
        )}
        {screen==="studio" && <StudioScreen profile={profile}/>}
        {screen==="essen" && (
          <>
            <SubTabRow current={essenSub} onChange={setEssenSub} options={[
              {id:"plan",  label:"Plan",          color:T.gold},
              {id:"liste", label:"Einkaufsliste", color:T.green},
            ]}/>
            {essenSub==="plan"  && <PlanScreen profile={profile} onUpdateProfile={(updates) => {
              setProfile(p => {
                const next = { ...p, ...updates };
                persist("eyla_profile_v3", next);
                return next;
              });
            }}/>}
            {essenSub==="liste" && <ShoppingScreen/>}
          </>
        )}
        {screen==="profil" && <ProfilScreen profile={profile} onReset={reset} onUpdate={updateProfile} logsByDate={logsByDate}/>}
      </div>

      {/* Bottom nav – Safe-Area unten für iPhone-Home-Indicator */}
      <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:40,
        background:T.bg+"F0",backdropFilter:"blur(20px)",borderTop:`1px solid ${T.border}`,
        paddingTop:"8px",
        paddingBottom:"calc(14px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display:"flex",justifyContent:"space-around",maxWidth:620,margin:"0 auto",padding:"0 2px" }}>
          {nav.map(n=>(
            <button key={n.id} onClick={()=>setScreen(n.id)} style={{
              background:"none",border:"none",cursor:"pointer",
              display:"flex",flexDirection:"column",alignItems:"center",gap:3,
              color:screen===n.id?sectionColor:T.muted,
              transition:"color .2s",padding:"4px 6px",flex:"1 1 0",minWidth:0
            }}>
              <span style={{ fontSize:17,
                filter:screen===n.id?`drop-shadow(0 0 6px ${sectionColor})`:"none",
                transition:"filter .2s" }}>{n.icon}</span>
              <span style={{ fontFamily:T.mono,fontSize:10,letterSpacing:1.5 }}>{n.label.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
