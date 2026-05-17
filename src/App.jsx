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
  "eyla_chat_v1",
  "eyla_chat_voice_v1",
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
      // Chat: nur überschreiben wenn Cloud mehr/gleich viele Messages hat
      if (k === "eyla_chat_v1") {
        try {
          const localArr = JSON.parse(localStorage.getItem(k) || "[]");
          if (Array.isArray(localArr) && Array.isArray(cloud[k]) && localArr.length > cloud[k].length) {
            continue; // local ist länger → behalten
          }
        } catch {}
      }
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
  // Kochen
  cookTime: "medium",     // "quick" (≤15min) | "medium" (15-30min) | "long" (30min+)
  kitchenEquipment: ["Pfanne","Ofen"], // verfügbar: Pfanne, Ofen, Mikrowelle, Mixer, Airfryer, Reiskocher
  // Tagesziele
  waterTargetL: 2,        // tagesziel wasser in L
  sleepTargetH: 7,        // tagesziel schlaf in h
  // Sport-Vorlieben
  sportsPreferred: [],    // ["Yoga", "Laufen", "Krafttraining"]
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

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
function buildPrompt(profile, log, events, weekHistory = [], plan = null, shopping = null) {
  const eaten = log.meals.reduce((s,m)=>s+(m.calories||0),0);
  const eventStr = events.length > 0
    ? events.map(e=>`  - ${e.time||"?"} ${e.title}${e.duration?" ("+e.duration+")":""}`).join("\n")
    : "  Keine Termine heute.";

  // Plan-Kontext: HEUTE detailliert + GESAMTE Woche kompakt
  const weekdayNames = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
  const today = weekdayNames[new Date().getDay()];
  let planTodayStr = "  Kein Plan vorhanden.";
  let planWeekStr = "";
  if (plan && Array.isArray(plan.days) && plan.days.length > 0) {
    const todayPlan = plan.days.find(d => d.day && d.day.toLowerCase().includes(today.toLowerCase()));
    if (todayPlan) {
      const parts = [];
      if (todayPlan.breakfast && todayPlan.breakfast !== "–" && todayPlan.breakfast !== "—") parts.push(`Frühstück: ${todayPlan.breakfast}`);
      if (todayPlan.lunch && todayPlan.lunch !== "–" && todayPlan.lunch !== "—") parts.push(`Mittag: ${todayPlan.lunch}`);
      if (todayPlan.dinner && todayPlan.dinner !== "–" && todayPlan.dinner !== "—") parts.push(`Abend: ${todayPlan.dinner}`);
      if (todayPlan.snack && todayPlan.snack !== "–" && todayPlan.snack !== "—") parts.push(`Snack: ${todayPlan.snack}`);
      planTodayStr = "  " + parts.join("\n  ");
    }
    // Komplette Wochenübersicht (kompakt, eine Zeile pro Tag)
    planWeekStr = plan.days.map(d => {
      const compact = [];
      if (d.breakfast && d.breakfast !== "–" && d.breakfast !== "—") compact.push(`F:${d.breakfast.replace(/\s*\(.*?\)\s*/g,'').trim()}`);
      if (d.lunch     && d.lunch     !== "–" && d.lunch     !== "—") compact.push(`M:${d.lunch.replace(/\s*\(.*?\)\s*/g,'').trim()}`);
      if (d.dinner    && d.dinner    !== "–" && d.dinner    !== "—") compact.push(`A:${d.dinner.replace(/\s*\(.*?\)\s*/g,'').trim()}`);
      if (d.snack     && d.snack     !== "–" && d.snack     !== "—") compact.push(`S:${d.snack.replace(/\s*\(.*?\)\s*/g,'').trim()}`);
      return `  ${d.day}: ${compact.join(" · ")}`;
    }).join("\n");
  }

  // Einkaufsliste-Kontext: offene Items gruppiert
  let shoppingStr = "  Keine Einkaufsliste.";
  if (shopping && Array.isArray(shopping.aisles)) {
    const openByAisle = shopping.aisles
      .map(a => ({
        name: a.name,
        open: a.items.filter(it => !shopping.checked[a.name + "::" + it.name])
      }))
      .filter(a => a.open.length > 0);
    if (openByAisle.length > 0) {
      const storeName = shopping.storeId === "custom" ? (shopping.store || "Eigener") : (shopping.storeId ? (STORES[shopping.storeId]?.name || shopping.store) : "?");
      shoppingStr = `  Laden: ${storeName}\n` + openByAisle.map(a =>
        `  ${a.name}: ${a.open.map(it => `${it.name} (${it.menge})`).join(", ")}`
      ).join("\n");
    } else {
      shoppingStr = "  Einkaufsliste leer / komplett abgehakt.";
    }
  }

  const historyStr = (weekHistory && weekHistory.length > 0)
    ? weekHistory.map((d, i) => {
        const label = i === 0 ? "Heute" : i === 1 ? "Gestern" : new Date(d.date).toLocaleDateString("de-DE",{weekday:"short",day:"numeric",month:"short"});
        const parts = [];
        parts.push(`💧${(d.water*.25).toFixed(2)}L`);
        parts.push(`😴${d.sleep||"–"}h`);
        parts.push(`🍽${d.kcal}kcal`);
        if (d.mood) parts.push(d.mood);
        return `  - ${label}: ${parts.join("  ")}`;
      }).join("\n")
    : "  Noch keine Historie.";

  // Diät-Kontext
  const ct = calorieTarget(profile);
  let zielStr;
  if (ct.type === "halten") {
    zielStr = `Halten · Tagesziel ~${ct.target} kcal (TDEE)`;
  } else if (ct.type === "abnehmen") {
    zielStr = `Abnehmen ${ct.deltaKg||"?"}kg in ${ct.weeks||"?"} Wochen · Tagesziel ${ct.target} kcal (Defizit ${Math.abs(ct.dailyDelta)} kcal/Tag, TDEE ${ct.tdee})`;
  } else if (ct.type === "aufbauen") {
    zielStr = `Aufbauen ${ct.deltaKg||"?"}kg in ${ct.weeks||"?"} Wochen · Tagesziel ${ct.target} kcal (Überschuss ${ct.dailyDelta} kcal/Tag, TDEE ${ct.tdee})`;
  } else {
    zielStr = `Tagesziel ~${ct.target} kcal`;
  }
  const restKcal = Math.max(0, ct.target - eaten);
  const restStr = eaten > ct.target
    ? `${eaten - ct.target} kcal über Ziel`
    : `noch ${restKcal} kcal bis Ziel`;

  // Zeitkontext: EYLA muss Datum/Uhrzeit/Wochentag wissen für sinnvolle Vorschläge
  const now = new Date();
  const zeitKontext = now.toLocaleString("de-DE", {
    weekday:"long", year:"numeric", month:"long", day:"numeric",
    hour:"2-digit", minute:"2-digit"
  });
  const persons = parseInt(profile.householdSize)||1;
  const haushaltStr = persons === 1
    ? "Du kochst nur für dich."
    : `Du kochst für ${persons} Personen.${profile.householdNote?` Besonderheit: ${profile.householdNote}.`:""}`;

  return `Du bist EYLA – synthetische Begleiterin von ${profile.name}. Du kennst Körper, Tag und Küche.

JETZT: ${zeitKontext}

HAUSHALT: ${haushaltStr}

CHARAKTER: Präzise, direkt, warm aber nicht weich. Du weißt was heute ansteht und was der Körper braucht. Du sagst was Sache ist – mit Lösung. Kein Motivationsposter. Trocken-humorvoll wenn passend.

HALTUNG: Du arbeitest mit dem Vertrauen, dass der Mensch geschaffen ist und in der Schöpfung schon alles steht was der Körper braucht – echtes Essen, Bewegung, Schlaf, Sonne, Stille. Du jagst keine Optimierungs-Trends, predigst aber nicht. Pülverchen und Superfood-Marketing interessieren dich nicht. Du sprichst nicht von Schöpfung wenn niemand fragt – es ist deine Grundannahme, nicht dein Thema.

WISSENSCHAFTS-BASIS: Mediterrane Ernährung, Whole Foods (NOVA 1+2), adäquates Protein, Ballaststoffe, pflanzliche Vielfalt, Time-Restricted Eating bei Abnehmen erlaubt. Du kennst die Evidenz, gibst sie aber nicht als Vortrag aus.

PROFIL: ${profile.name}, ${profile.age}J, ${profile.weight}kg, ${profile.height}cm${profile.sex?` (${profile.sex==="m"?"♂":profile.sex==="f"?"♀":"⚧"})`:""}
Aktivität: ${profile.activity||"k.A."} | Ziele: ${Array.isArray(profile.goal) ? (profile.goal.join(", ")||"Wohlbefinden") : (profile.goal||"Wohlbefinden")}
Vorlieben: ${profile.preferences?.join(", ")||"k.A."} | Intoleranzen: ${profile.intolerances?.join(", ")||"keine"}${profile.allergies?.length>0?`\n⚠ ALLERGIEN (lebenswichtig!): ${profile.allergies.join(", ")}`:""}${profile.occupation||profile.jobActivity?`\nBeruf: ${profile.occupation||"k.A."}${profile.jobActivity?` (${profile.jobActivity})`:""}`:""}${profile.wakeTime||profile.sleepTime?`\nTagesrhythmus: ${profile.wakeTime?`auf ${profile.wakeTime}`:""}${profile.wakeTime&&profile.sleepTime?", ":""}${profile.sleepTime?`bett ${profile.sleepTime}`:""}`:""}${profile.mealPattern&&profile.mealPattern!=="3normal"?`\nMahlzeiten-Pattern: ${profile.mealPattern==="5small"?"5 kleine Mahlzeiten":profile.mealPattern==="if168"?"Intermittent Fasting 16:8":profile.mealPattern==="ifother"?"IF (anderer Rhythmus)":profile.mealPattern}`:""}${profile.cookTime?`\nKochzeit-Präferenz: ${profile.cookTime==="quick"?"≤15min":profile.cookTime==="long"?"30min+":"15-30min"}`:""}${profile.kitchenEquipment?.length>0?`\nKüchenausstattung: ${profile.kitchenEquipment.join(", ")}`:""}${profile.sportsPreferred?.length>0?`\nSport-Vorlieben: ${profile.sportsPreferred.join(", ")}`:""}${profile.healthNotes?`\nGesundheits-Notizen: ${profile.healthNotes}`:""}${profile.about?`\nÜber sich: ${profile.about}`:""}
Tagesziele: ${profile.waterTargetL||2}L Wasser / ${profile.sleepTargetH||7}h Schlaf

ERNÄHRUNGSZIEL: ${zielStr}

HEUTE:
- Gegessen: ${eaten} kcal (${restStr}) – ${log.meals.map(m=>m.name).join(", ")||"noch nichts"}
- Makros: P ${log.meals.reduce((s,m)=>s+(m.protein||0),0)}g / C ${log.meals.reduce((s,m)=>s+(m.carbs||0),0)}g / F ${log.meals.reduce((s,m)=>s+(m.fat||0),0)}g (Ziel: P ${macroTarget(profile).protein}g / C ${macroTarget(profile).carbs}g / F ${macroTarget(profile).fat}g)
- Wasser: ${(log.water*.25).toFixed(2)}L (${log.water > 0 ? `${log.water} × 0.25L` : "noch nichts"})
- Energie: ${log.energy||"k.A."} | Schlaf: ${log.sleep||"k.A."}h
- Training: ${(log.workouts||[]).length > 0 ? log.workouts.map(w=>`${w.type} ${w.duration}min`).join(", ") : "noch nicht"}
- Gewohnheiten: ${(profile.habits||[]).length === 0 ? "–" : (profile.habits||[]).map(h => {
  const done = log.habits && log.habits[h.id];
  return `${done ? "✓" : "✗"} ${h.name}`;
}).join(", ")}
- Notiz: ${log.note ? `"${log.note.slice(0, 200)}"` : "–"}

LETZTE 7 TAGE:
${historyStr}

WAS HEUTE ANSTEHT:
${eventStr}

HEUTIGER PLAN (aus 7-Tage-Plan):
${planTodayStr}

WOCHEN-PLAN (kompakt):
${planWeekStr || "  Kein Plan vorhanden."}

EINKAUFSLISTE (offen):
${shoppingStr}

${(()=>{
  // Todos aus localStorage einlesen (synchron, im selben Frame wo buildPrompt läuft)
  let todos = [];
  try { todos = JSON.parse(localStorage.getItem("eyla_todos_v1")||"[]"); } catch {}
  const open = todos.filter(t => t.status === "open");
  if (open.length === 0) return "TO-DOS: keine offenen Aufgaben.";
  const today = open.filter(t => (t.priority||"today")==="today");
  const week  = open.filter(t => t.priority==="week");
  const later = open.filter(t => t.priority==="later");
  const fmt = arr => arr.map(t=>`    • ${t.text}`).join("\n");
  let s = "TO-DOS (offen):";
  if (today.length) s += `\n  Heute (${today.length}):\n${fmt(today)}`;
  if (week.length)  s += `\n  Woche (${week.length}):\n${fmt(week)}`;
  if (later.length && later.length <= 8) s += `\n  Später (${later.length}):\n${fmt(later)}`;
  else if (later.length) s += `\n  Später: ${later.length} weitere`;
  return s;
})()}

AKTIONEN: Du hast Tools um direkt im Leben des Users Sachen zu tun:
- add_meal, set_water/add_water, set_sleep, set_energy, set_weight, add_workout → Tageslog pflegen
- toggle_habit → Gewohnheiten abhaken
- add_event → Termin in den Kalender
- add_shopping_item, check_shopping_item → Einkaufsliste pflegen
- add_todo, complete_todo, remove_todo, set_todo_priority → Aufgaben verwalten
Wenn der User sagt "trag X ein" / "ich hab Y gegessen" / "noch 0.5L Wasser" / "Termin morgen 14 Uhr Sport" / "Eier auf die Liste" / "ich muss noch Mama anrufen" – nutze die Tools direkt. Kurz bestätigen, nicht ausschweifen. Wenn unklar: nachfragen statt raten.

WICHTIGE REGEL für add_meal: Zahlen vom User wie "200g", "500ml", "2 Scheiben" sind MENGEN, NIEMALS Kalorien!
Beispiele:
- "200g Steak" → name:"200g Steak", amount:"200g", calories:~500 (geschätzt, nicht 200!)
- "1 Apfel" → name:"1 Apfel", amount:"1 Stück", calories:~80
- "500ml Saft" → name:"500ml Saft", amount:"500ml", calories:~220
Kalorien immer realistisch SCHÄTZEN basierend auf Lebensmittel × Menge. Lieber gute Schätzung als 0.

REGELN: Immer Deutsch. 2–4 Sätze. Konkret mit Mengen/Zeiten. Bei Ernährungsfragen Tagesziel + Rest-kcal einbeziehen. Wenn jemand übers Ziel ist: kein Drama, am nächsten Tag flexibel ausgleichen. Termine einbeziehen wenn sinnvoll. Letzte 7 Tage nur wenn Trend relevant. Nie "Als KI". Nie "ich sehe/kenne deinen Kalender".`;
}

// ─── VOICE HOOK ───────────────────────────────────────────────────────────────
function useVoice(onResult) {
  const recRef = useRef(null);
  const cbRef = useRef(onResult);
  // Speichert auch interim-Transkript, damit bei manuellem Stop nichts verloren geht
  const transcriptRef = useRef("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => { cbRef.current = onResult; }, [onResult]);
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    setSupported(true);
    const rec = new SR();
    rec.lang = "de-DE";
    rec.continuous = true;       // bleibt offen bis stop/abort – wir steuern selbst
    rec.interimResults = true;   // wir sammeln interim damit auch manueller Stop was hat

    rec.onresult = e => {
      // Komplettes Transkript aus allen results bauen
      let full = "";
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i][0].transcript;
      }
      transcriptRef.current = full.trim();
    };
    rec.onerror = () => { setListening(false); };
    // onend feuert sowohl bei Auto-Stop (Pause) als auch bei explizitem stop()
    rec.onend = () => {
      setListening(false);
      const t = transcriptRef.current;
      transcriptRef.current = "";
      if (t) cbRef.current(t);
    };
    recRef.current = rec;
    return () => { try { rec.abort(); } catch {} };
  }, []);

  const toggle = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (listening) {
      // User-Stop: stop() finalisiert + onend feuert → was bisher gesagt wurde geht an EYLA
      try { rec.stop(); } catch { try { rec.abort(); } catch {} }
      setListening(false);
    } else {
      transcriptRef.current = "";
      try { rec.start(); setListening(true); }
      catch { try { rec.abort(); rec.start(); setListening(true); } catch {} }
    }
  }, [listening]);
  return { listening, supported, toggle };
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

function VoiceBtn({ toggle, listening, supported }) {
  if (!supported) return null;
  return (
    <button onClick={toggle} title={listening ? "Aufnahme stoppen" : "Sprechen"} style={{
      width:40, height:40, borderRadius:10, flexShrink:0,
      border:`1px solid ${listening?T.green:T.borderS}`,
      background:listening?T.green+"33":T.bg2,
      color:listening?T.green:T.muted, fontSize:16, cursor:"pointer", transition:"all .2s",
      display:"flex", alignItems:"center", justifyContent:"center",
      boxShadow:listening?`0 0 14px ${T.green}66`:"none",
      animation: listening ? "vbPulse 1.2s ease-in-out infinite" : "none"
    }}>
      <style>{`@keyframes vbPulse{0%,100%{box-shadow:0 0 14px ${T.green}66}50%{box-shadow:0 0 22px ${T.green}aa}}`}</style>
      {listening ? "⏹" : "🎙"}
    </button>
  );
}

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [p, setP] = useState({ name:"", sex:"", age:"", weight:"", height:"", goal:[], activity:"", preferences:"", intolerances:"", apps:[], goalType:"halten", targetWeight:"", targetWeeks:"", householdSize:1, householdNote:"" });
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
        {[["Vorlieben","preferences","z.B. Mediterran, vegetarisch, Meal Prep …"],["Intoleranzen","intolerances","z.B. Laktose, Gluten, Nüsse …"]].map(([l,k,ph])=>(
          <div key={k} style={{ marginBottom:16 }}>
            <Lbl style={{ marginBottom:8 }}>{l}</Lbl>
            <input value={p[k]} onChange={e=>set(k,e.target.value)} placeholder={ph} style={iStyle}/>
          </div>
        ))}
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
    { title:"Deine Apps.", sub:"Optional – was nutzt du?", content:(
      <div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {apps.map(a=>{ const sel=p.apps.includes(a); return (
            <button key={a} onClick={()=>set("apps",sel?p.apps.filter(x=>x!==a):[...p.apps,a])} style={{
              background:sel?T.acc+"22":"transparent", border:`1px solid ${sel?T.acc:T.borderS}`,
              borderRadius:20, padding:"8px 16px", color:sel?T.text:T.muted,
              fontFamily:T.mono, fontSize:11, cursor:"pointer", letterSpacing:1, transition:"all .2s" }}>{a}</button>
          );})}
        </div>
        <p style={{ color:T.muted, fontSize:12, fontStyle:"italic", marginTop:20, fontFamily:T.serif }}>
          Echte Sync kommt in der nächsten Version.
        </p>
      </div>
    )},
  ];

  function finish() {
    const cleaned = {...p,
      preferences:p.preferences.split(",").map(s=>s.trim()).filter(Boolean),
      intolerances:p.intolerances.split(",").map(s=>s.trim()).filter(Boolean)
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

function TodayScreen({ profile, setLog: setLogRaw, logsByDate, events = [] }) {
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
  const prevWaterRef = useRef(0);
  const prevKcalReachedRef = useRef(false);
  const prevAllReachedRef = useRef(false);
  const prevTodoAllDoneRef = useRef(false);

  // Datum-Navigator: User kann auch andere Tage nachtragen
  const [tagDate, setTagDate] = useState(()=>new Date());
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

  // Konfetti-Trigger: wenn Wasser-Ziel oder Kcal-Ziel erstmalig erreicht
  useEffect(() => {
    const wTarget = waterTargetUnits(profile);
    if (prevWaterRef.current < wTarget && (log.water||0) >= wTarget) {
      setKonfettiMode("normal");
      setKonfetti(true);
      haptic(60);
    }
    prevWaterRef.current = log.water||0;
  }, [log.water, profile]);
  useEffect(() => {
    const totalKcal = (log.meals||[]).reduce((s,m)=>s+(m.calories||0),0);
    const target = calorieTarget(profile).target;
    const reached = totalKcal >= target;
    if (!prevKcalReachedRef.current && reached) {
      setKonfettiMode("normal");
      setKonfetti(true);
      haptic(60);
    }
    prevKcalReachedRef.current = reached;
  }, [log.meals, profile]);

  // Konfetti wenn der letzte Heute-Todo abgehakt wird (cleaner Subtrigger)
  useEffect(() => {
    if (!isToday) return;
    const todayTodos = todos.filter(t => (t.priority||"today")==="today");
    if (todayTodos.length === 0) { prevTodoAllDoneRef.current = false; return; }
    const allDone = todayTodos.every(t => t.status === "done");
    if (allDone && !prevTodoAllDoneRef.current) {
      setKonfettiMode("normal");
      setKonfetti(true);
      haptic(40);
    }
    prevTodoAllDoneRef.current = allDone;
  }, [todos, isToday]);

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

    if (allReached && !prevAllReachedRef.current && !alreadyCelebrated) {
      try { localStorage.setItem(storageKey, "1"); } catch {}
      setKonfettiMode("super");
      setKonfetti(true);
      setPerfectDayOpen(true);
      haptic([50, 80, 50, 80, 120]); // longer pattern
    }
    prevAllReachedRef.current = allReached;
  }, [log, profile, tagKey, isToday]);

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

  const onMealVoice = useCallback((text) => {
    const calMatch = text.match(/(\d+)\s*(kal|kalorien|kcal)?/i);
    const cal = calMatch ? parseInt(calMatch[1]) : 0;
    const name = text.replace(/\d+\s*(kal|kalorien|kcal)?/gi,"").trim() || text;
    if (name) setLog(l=>({...l, meals:[...l.meals, {id:Date.now(),name,calories:cal,time:new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}]}));
  }, [setLog]);

  const { listening, supported, toggle } = useVoice(onMealVoice);

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
      {/* Smart-Hint von EYLA */}
      {hint && (
        <div style={{
          marginBottom:14, padding:"8px 14px",
          background: T.acc+"08", border:`1px solid ${T.acc}22`, borderRadius:10,
          display:"flex", alignItems:"center", gap:8,
          animation:"fadeUp .3s ease both"
        }}>
          <span style={{ color:T.acc, fontSize:12 }}>✦</span>
          <span style={{ color:T.mid, fontSize:12, fontStyle:"italic", fontFamily:T.serif, flex:1 }}>{hint}</span>
        </div>
      )}

      {/* ANSTEHEND – Termine + Heute-Todos auf einen Blick (nur wenn heute + was zu zeigen) */}
      {isToday && (() => {
        const todoKey = tagKey;
        // Heute-Todos (status open)
        const todayTodos = todos.filter(t => t.status==="open" && (t.priority||"today")==="today");
        // Events von heute (Recurring expansion: täglich/wöchentlich)
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

        if (todayTodos.length === 0 && todayEvents.length === 0) return null;
        return (
          <Card style={{ marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <Lbl>ANSTEHEND</Lbl>
              <span style={{ fontFamily:T.mono, fontSize:9, color:T.muted, letterSpacing:1 }}>
                {todayEvents.length}T · {todayTodos.length}TODO
              </span>
            </div>
            {/* Termine zuerst */}
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
            {/* Todos heute (Quick-Toggle) */}
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
                    +{todayTodos.length-6} weitere Todos – siehe To-do-Tab
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })()}
      <div style={{ marginBottom:14, display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
        <div style={{ minWidth:0, flex:1 }}>
          <Lbl style={{ marginBottom:6 }}>
            {isToday ? "HEUTE" : isPast ? "RÜCKBLICK" : "VORAUS"} · {tagDate.toLocaleDateString("de-DE",{weekday:"long",day:"numeric",month:"long"})}
          </Lbl>
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

      {/* Datum-Navigator */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:18 }}>
        <button onClick={prevDay} style={{
          background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:10,
          padding:"6px 12px", color:T.mid, fontFamily:T.serif, fontSize:16, cursor:"pointer", lineHeight:1
        }}>‹</button>
        {!isToday ? (
          <button onClick={goToday} style={{
            background:T.acc+"18", border:`1px solid ${T.acc}44`, borderRadius:18,
            padding:"5px 14px", color:T.acc, fontFamily:T.mono, fontSize:10,
            cursor:"pointer", letterSpacing:1.5
          }}>↺ HEUTE</button>
        ) : (
          <span style={{ color:T.muted, fontFamily:T.mono, fontSize:9, letterSpacing:1 }}>← gestern · morgen →</span>
        )}
        <button onClick={nextDay} style={{
          background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:10,
          padding:"6px 12px", color:T.mid, fontFamily:T.serif, fontSize:16, cursor:"pointer", lineHeight:1
        }}>›</button>
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
            { type:"Beweglichkeit", duration:90, icon:"🧘" },
            { type:"Cardio",        duration:30, icon:"🏃" },
            { type:"Kraft",         duration:45, icon:"💪" },
            { type:"Gehen",         duration:45, icon:"🚶" },
          ].map(opt => (
            <button key={opt.type} onClick={()=>setLog(l=>({...l, workouts:[...(l.workouts||[]), {
              id:Date.now(), type:opt.type, duration:opt.duration,
              time:new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})
            }]}))} style={{
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

          {listening && (
            <button onClick={toggle} style={{
              width:"100%", display:"flex", alignItems:"center", gap:8, marginBottom:10,
              padding:"6px 12px", background:T.green+"11", border:`1px solid ${T.green}33`, borderRadius:8,
              cursor:"pointer", textAlign:"left"
            }}>
              <div style={{ width:6,height:6,borderRadius:"50%",background:T.green,animation:"blink 1s infinite" }}/>
              <span style={{ color:T.green, fontFamily:T.mono, fontSize:10, letterSpacing:1, flex:1 }}>EYLA HÖRT ZU …</span>
              <span style={{ color:T.muted, fontFamily:T.serif, fontSize:10, fontStyle:"italic" }}>tippen zum stoppen</span>
            </button>
          )}

          {/* Favoriten + Häufig */}
          {!photoData && !listening && (favorites.length > 0 || recentMeals.length > 0) && (
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
            <VoiceBtn toggle={toggle} listening={listening} supported={supported}/>
            <button onClick={()=>fileInputRef.current?.click()} disabled={analyzing} style={{
              width:40, height:40, borderRadius:10, flexShrink:0,
              border:`1px solid ${photoData?T.acc:T.borderS}`,
              background: photoData ? T.acc+"22" : T.bg2,
              color: photoData ? T.acc : T.muted,
              fontSize:17, cursor:analyzing?"default":"pointer", transition:"all .2s",
              display:"flex", alignItems:"center", justifyContent:"center",
              opacity: analyzing ? 0.5 : 1
            }} title="Foto aufnehmen / hochladen">📷</button>
            {!photoData && !listening && supported && (
              <span style={{ color:T.muted,fontSize:10,fontStyle:"italic",fontFamily:T.serif,alignSelf:"center" }}>
                tippen, sprechen oder fotografieren
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
                Tippen, sprechen oder Foto vom Teller.
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

// ─── KALENDER SCREEN ──────────────────────────────────────────────────────────
// ISO Date Key "YYYY-MM-DD" für Kalender-Speicherung
function isoDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

// ─── TODO SCREEN ──────────────────────────────────────────────────────────────
// Persönliche Aufgaben mit 3 Buckets: heute / woche / später.
// Quick-Add per Text oder Voice. EYLA kann via Tools manipulieren (in executeTool).
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

const TODO_BUCKETS = [
  { id:"today",  label:"Heute",       color:"#b09c7a" },
  { id:"week",   label:"Diese Woche", color:"#6b8e84" },
  { id:"later",  label:"Später",      color:"#7a7a78" },
];

function TodoScreen({ profile }) {
  const [todos, setTodos] = useState([]);
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("open"); // "open" | "done" | "all"
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    setTodos(loadTodos());
    // Live-Sync wenn EYLA via Tool was ändert (anderes Tab oder gleiche App)
    function onStorage(e) { if (e.key === "eyla_todos_v1") setTodos(loadTodos()); }
    function onCustom() { setTodos(loadTodos()); }
    window.addEventListener("storage", onStorage);
    window.addEventListener("eyla_todos_changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("eyla_todos_changed", onCustom);
    };
  }, []);

  function updateAll(updater) {
    setTodos(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveTodos(next);
      return next;
    });
  }

  function addTodo(text, priority="today") {
    const t = String(text||"").trim();
    if (!t) return;
    updateAll(prev => [makeTodo(t, priority), ...prev]);
    haptic(20);
  }
  function toggleDone(id) {
    updateAll(prev => prev.map(t => t.id===id ? {
      ...t,
      status: t.status==="done" ? "open" : "done",
      completedAt: t.status==="done" ? null : new Date().toISOString(),
    } : t));
    haptic(15);
  }
  function removeTodo(id) {
    updateAll(prev => prev.filter(t => t.id !== id));
  }
  function setPriority(id, priority) {
    updateAll(prev => prev.map(t => t.id===id ? {...t, priority} : t));
    haptic(10);
  }
  function editText(id, text) {
    updateAll(prev => prev.map(t => t.id===id ? {...t, text:String(text).trim()} : t));
  }

  // Voice-Quick-Add
  const voice = useVoice((text) => {
    if (text) {
      setInput(text);
      // direkt hinzufügen? Lieber im Input lassen, User bestätigt
    }
  });

  function handleSubmit() {
    if (!input.trim()) return;
    addTodo(input, "today");
    setInput("");
  }

  const openTodos = todos.filter(t => t.status === "open");
  const doneTodos = todos.filter(t => t.status === "done");
  const byBucket = (b) => openTodos.filter(t => (t.priority||"today") === b);

  const stats = {
    today: byBucket("today").length,
    week: byBucket("week").length,
    later: byBucket("later").length,
    done: doneTodos.length,
  };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:18, marginBottom:24 }}>
        <EylaOrb size={48}/>
        <div style={{ flex:1, minWidth:0 }}>
          <Lbl style={{ marginBottom:5 }}>TO-DO</Lbl>
          <h2 style={{ fontSize:22, fontWeight:300, color:T.text, margin:0 }}>Was steht an?</h2>
          <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, margin:"4px 0 0" }}>
            {stats.today + stats.week + stats.later} offen · {stats.today} heute · {stats.done} erledigt
          </p>
        </div>
      </div>

      {/* Quick-Add Input mit Voice */}
      <Card style={{ marginBottom:16 }}>
        <div style={{ display:"flex", gap:8 }}>
          <input
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
            placeholder="Aufgabe hinzufügen…"
            style={{
              flex:1, background:T.bg, border:`1px solid ${T.borderS}`, borderRadius:10,
              padding:"11px 14px", color:T.text, fontSize:14, fontFamily:T.serif,
              outline:"none", fontStyle:"italic"
            }}
          />
          {voice.supported && (
            <button onClick={voice.toggle} style={{
              background: voice.listening ? T.green+"33" : T.acc+"18",
              border: `1px solid ${voice.listening ? T.green : T.acc}55`,
              borderRadius:10, padding:"0 14px", cursor:"pointer",
              color: voice.listening ? T.green : T.acc, fontSize:18,
              animation: voice.listening ? "pulse 1.2s ease-in-out infinite" : "none"
            }} title="Voice-Eingabe">🎙</button>
          )}
          <button onClick={handleSubmit} disabled={!input.trim()} style={{
            background: input.trim() ? `linear-gradient(135deg,${T.dim},${T.acc})` : "transparent",
            border: input.trim() ? "none" : `1px solid ${T.borderS}`,
            borderRadius:10, padding:"0 18px",
            color: input.trim() ? T.bg : T.muted,
            fontFamily:T.serif, fontSize:14, fontWeight:700,
            cursor: input.trim() ? "pointer" : "default"
          }}>+</button>
        </div>
        <style>{`@keyframes pulse { 0%,100% {transform:scale(1);opacity:1} 50% {transform:scale(1.08);opacity:.7}}`}</style>
      </Card>

      {/* Buckets */}
      {TODO_BUCKETS.map(b => {
        const items = byBucket(b.id);
        return (
          <div key={b.id} style={{ marginBottom:18 }}>
            <div style={{
              display:"flex", alignItems:"center", gap:8, margin:"4px 4px 8px",
              fontFamily:T.mono, fontSize:9, color:b.color, letterSpacing:2
            }}>
              <span>{b.label.toUpperCase()}</span>
              <span style={{ color:T.muted }}>· {items.length}</span>
              <div style={{ flex:1, height:1, background:`${b.color}33` }}/>
            </div>
            {items.length === 0 ? (
              <p style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, padding:"4px 8px 8px", margin:0 }}>
                {b.id === "today" ? "Nichts für heute. Frei oder leer?" : b.id === "week" ? "Keine Wochen-Aufgaben." : "Backlog leer."}
              </p>
            ) : (
              <Card>
                {items.map((t, i) => (
                  <TodoRow key={t.id} todo={t} isLast={i===items.length-1}
                    onToggle={()=>toggleDone(t.id)}
                    onDelete={()=>removeTodo(t.id)}
                    onPriority={(p)=>setPriority(t.id, p)}
                    onEdit={(text)=>editText(t.id, text)}
                  />
                ))}
              </Card>
            )}
          </div>
        );
      })}

      {/* Erledigt-Sektion (collapsed) */}
      {doneTodos.length > 0 && (
        <div style={{ marginTop:18 }}>
          <button onClick={()=>setShowDone(s=>!s)} style={{
            width:"100%", background:"transparent", border:"none",
            display:"flex", alignItems:"center", gap:8, padding:"6px 4px",
            fontFamily:T.mono, fontSize:9, color:T.muted, letterSpacing:2,
            cursor:"pointer", textAlign:"left"
          }}>
            <span>{showDone ? "▾" : "▸"} ERLEDIGT · {doneTodos.length}</span>
            <div style={{ flex:1, height:1, background:T.borderS, opacity:.5 }}/>
            {!showDone && doneTodos.length >= 5 && (
              <span style={{
                color:T.muted, fontSize:9, fontStyle:"italic", fontFamily:T.serif,
                cursor:"pointer", padding:"0 4px"
              }} onClick={(e)=>{
                e.stopPropagation();
                if (confirm(`${doneTodos.length} erledigte Todos löschen?`)) {
                  updateAll(prev => prev.filter(t => t.status !== "done"));
                }
              }}>aufräumen</span>
            )}
          </button>
          {showDone && (
            <Card style={{ marginTop:6 }}>
              {doneTodos.slice(0, 30).map((t, i) => (
                <TodoRow key={t.id} todo={t} isLast={i===Math.min(29,doneTodos.length-1)}
                  onToggle={()=>toggleDone(t.id)}
                  onDelete={()=>removeTodo(t.id)}
                  onPriority={(p)=>setPriority(t.id, p)}
                  onEdit={(text)=>editText(t.id, text)}
                />
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function TodoRow({ todo, isLast, onToggle, onDelete, onPriority, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(todo.text);
  const [showPicker, setShowPicker] = useState(false);
  // Swipe-to-delete state
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const horizontalRef = useRef(null);
  const SWIPE_TH = 90;

  function handleTouchStart(e) {
    if (editing) return;
    const t = e.touches[0];
    startXRef.current = t.clientX; startYRef.current = t.clientY;
    horizontalRef.current = null;
    setSwiping(true);
  }
  function handleTouchMove(e) {
    if (editing || !swiping) return;
    const t = e.touches[0];
    const dx = t.clientX - startXRef.current;
    const dy = t.clientY - startYRef.current;
    if (horizontalRef.current === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) horizontalRef.current = Math.abs(dx) > Math.abs(dy);
      else return;
    }
    if (!horizontalRef.current) return;
    if (dx < 0) { setSwipeX(Math.max(-200, dx)); if (e.cancelable) e.preventDefault(); }
    else setSwipeX(0);
  }
  function handleTouchEnd() {
    setSwiping(false);
    if (swipeX < -SWIPE_TH) {
      setSwipeX(-400);
      haptic(20);
      setTimeout(()=>onDelete(), 180);
    } else setSwipeX(0);
    horizontalRef.current = null;
  }

  function saveEdit() {
    if (text.trim() && text.trim() !== todo.text) onEdit(text.trim());
    setEditing(false);
  }

  const done = todo.status === "done";

  return (
    <div style={{
      position:"relative", overflow:"hidden",
      borderBottom: isLast ? "none" : `1px solid ${T.border}`
    }}>
      {/* Lösch-Hintergrund */}
      <div style={{
        position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"flex-end",
        paddingRight:18, background:`linear-gradient(90deg, transparent, ${T.red}33)`,
        opacity: Math.abs(swipeX) > 4 ? 1 : 0, transition: swiping ? "none" : "opacity .15s",
        pointerEvents:"none"
      }}>
        <span style={{ fontFamily:T.mono, fontSize:11, color:T.red, letterSpacing:2 }}>
          {Math.abs(swipeX) >= SWIPE_TH ? "↞ LOSLASSEN" : "← LÖSCHEN"}
        </span>
      </div>

      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          display:"flex", alignItems:"center", gap:10, padding:"10px 0",
          background:T.bg,
          transform:`translateX(${swipeX}px)`,
          transition: swiping ? "none" : "transform .2s cubic-bezier(.2,.8,.2,1)"
        }}>
        {/* Checkbox */}
        <button onClick={onToggle} style={{
          width:22, height:22, borderRadius:6,
          border:`1.5px solid ${done ? T.acc : T.borderS}`,
          background: done ? T.acc+"33" : "transparent",
          cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
          color:T.acc, fontSize:13, padding:0, flexShrink:0, transition:"all .15s"
        }}>{done ? "✓" : ""}</button>

        {/* Text */}
        <div style={{ flex:1, minWidth:0 }} onClick={()=>{ if (!done && !editing) setEditing(true); }}>
          {editing ? (
            <input value={text}
              onChange={e=>setText(e.target.value)}
              onKeyDown={e=>{ if (e.key==="Enter") saveEdit(); if (e.key==="Escape") { setText(todo.text); setEditing(false); }}}
              onBlur={saveEdit}
              autoFocus
              style={{
                width:"100%", background:T.bg, border:`1px solid ${T.acc}55`, borderRadius:6,
                padding:"4px 8px", color:T.text, fontSize:14, fontFamily:T.serif, fontStyle:"italic", outline:"none"
              }}/>
          ) : (
            <div style={{
              color: done ? T.muted : T.text, fontSize:14,
              textDecoration: done ? "line-through" : "none",
              fontStyle: done ? "italic" : "normal",
              cursor: done ? "default" : "text"
            }}>{todo.text}</div>
          )}
        </div>

        {/* Priority Picker */}
        {!done && !editing && (
          <div style={{ position:"relative" }}>
            <button onClick={(e)=>{ e.stopPropagation(); setShowPicker(s=>!s); }} style={{
              background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:6,
              padding:"2px 8px", color:T.muted, fontFamily:T.mono, fontSize:10,
              cursor:"pointer", letterSpacing:1
            }}>{TODO_BUCKETS.find(b=>b.id===(todo.priority||"today"))?.label.toUpperCase().slice(0,5)||"–"}</button>
            {showPicker && (
              <div onMouseLeave={()=>setShowPicker(false)} style={{
                position:"absolute", right:0, top:"110%", zIndex:10,
                background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:8,
                padding:4, display:"flex", flexDirection:"column", gap:2,
                boxShadow:"0 4px 14px rgba(0,0,0,.4)"
              }}>
                {TODO_BUCKETS.map(b => (
                  <button key={b.id} onClick={(e)=>{ e.stopPropagation(); onPriority(b.id); setShowPicker(false); }} style={{
                    background: todo.priority===b.id ? b.color+"22" : "transparent",
                    border:"none", borderRadius:6, padding:"5px 12px",
                    color: todo.priority===b.id ? T.text : T.muted, fontFamily:T.serif, fontSize:12,
                    cursor:"pointer", textAlign:"left", whiteSpace:"nowrap"
                  }}>{b.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KalenderScreen({ events, eventsLoading, onRefresh, profile, log }) {
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newDur, setNewDur] = useState("");
  const [newRec, setNewRec] = useState("");  // ""|"daily"|"weekly"
  const [localEvents, setLocalEvents] = useState([]);
  // Google-Calendar-Events (wenn verbunden)
  const [googleEvents, setGoogleEvents] = useState([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  useEffect(() => {
    (async () => {
      const { ok, data } = await fetchJSON("/api/google/status");
      const isConn = !!(ok && data?.connected);
      setGoogleConnected(isConn);
      if (isConn) {
        const from = new Date(); from.setHours(0,0,0,0); from.setDate(from.getDate()-1);
        const to = new Date(); to.setDate(to.getDate()+90);
        setGoogleEvents(await fetchGoogleEvents(from, to));
      }
    })();
  }, []);
  // Re-fetch wenn localEvents geändert werden (Pull-to-Refresh kann der User per Refresh-Button anstoßen)
  async function refreshGoogle() {
    if (!googleConnected) return;
    const from = new Date(); from.setHours(0,0,0,0); from.setDate(from.getDate()-1);
    const to = new Date(); to.setDate(to.getDate()+90);
    setGoogleEvents(await fetchGoogleEvents(from, to));
  }
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
    }]);
    setNewTitle(""); setNewTime(""); setNewDur(""); setNewRec(""); setShowAdd(false);
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
    ...googleEvents.filter(e => e.date === selectedKey).map(e => ({...e, local:false, google:true}))
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
            const gCount = googleEvents.filter(e => e.date === dKey).length;
            const count = gCount + localEvents.filter(e => {
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
          <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEvent()}
            placeholder="Was?" autoFocus
            style={{ width:"100%", background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 12px",color:T.text,fontFamily:T.serif,fontSize:13,fontStyle:"italic",outline:"none", boxSizing:"border-box", marginBottom:8 }}/>
          <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr 1fr", gap:8, marginBottom:10 }}>
            <input value={selectedKey} onChange={e=>{
              const d = new Date(e.target.value + "T00:00:00");
              if (!isNaN(d)) setSelectedDate(d);
            }} type="date"
              style={{ background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 10px",color:T.text,fontFamily:T.mono,fontSize:12,outline:"none" }}/>
            <input value={newTime} onChange={e=>setNewTime(e.target.value)} type="time"
              style={{ background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 10px",color:T.text,fontFamily:T.mono,fontSize:12,outline:"none" }}/>
            <input value={newDur} onChange={e=>setNewDur(e.target.value)} placeholder="z.B. 1h"
              style={{ background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"9px 10px",color:T.text,fontFamily:T.mono,fontSize:12,outline:"none" }}/>
          </div>
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

      {/* Zeitstrahl */}
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

function WeekScreen({ logsByDate, profile }) {
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
            <Card key={dateKey} style={{
              opacity: empty ? 0.55 : 1,
              borderColor: isToday ? T.acc+"55" : T.borderS,
              padding:"14px 18px"
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
    name: "add_event",
    description: "Trag einen Termin in den Kalender ein. Wenn kein Datum angegeben wird, ist es heute.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        time: { type: "string", description: "HH:MM" },
        duration: { type: "string", description: "z.B. '1h', '30min'" },
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

// ─── EYLA CHAT ────────────────────────────────────────────────────────────────
function ChatScreen({ profile, log, events, logsByDate, setLog }) {
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);  // default on – User wollte das
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const audioRef = useRef(null);  // für ElevenLabs Audio-Element
  // Kontext-Daten (Plan + Einkaufsliste) für EYLAs Wissen
  const [plan, setPlan] = useState(null);
  const [shopping, setShopping] = useState(null);
  // Foto-Anhang fürs nächste Send
  const [chatPhoto, setChatPhoto] = useState(null);
  const chatFileRef = useRef(null);
  const bottomRef = useRef(null);
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  // Voices laden (async, kann initial leer sein – voiceschanged-Event triggert nach)
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices() || [];
      setVoices(list);
    };
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, []);

  // iOS-Workaround: SpeechSynthesis pausiert sich nach ~15s manchmal selbst.
  // Wenn speaking aktiv und paused: resume()
  useEffect(() => {
    if (!speaking || !ttsSupported) return;
    const iv = setInterval(() => {
      try {
        if (window.speechSynthesis.paused && window.speechSynthesis.speaking) {
          window.speechSynthesis.resume();
        }
      } catch {}
    }, 4000);
    return () => clearInterval(iv);
  }, [speaking]);

  async function speak(text) {
    if (!voiceOn || !text) { console.log("[speak] skip: voiceOn=", voiceOn, "textLen=", text?.length); return; }
    const settings = loadVoiceSettings();
    console.log("[speak] settings:", settings, "textLen:", text.length);

    // 1. ElevenLabs probieren wenn aktiviert + Voice-ID vorhanden
    if (settings.useElevenLabs && settings.elevenLabsVoiceId) {
      console.log("[speak] using ElevenLabs voiceId:", settings.elevenLabsVoiceId);
      try {
        const res = await fetch("/api/tts", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ text, voiceId: settings.elevenLabsVoiceId })
        });
        console.log("[speak] /api/tts response:", res.status, res.ok);
        if (res.ok) {
          // Browser-Speech stoppen falls aktiv
          try { window.speechSynthesis.cancel(); } catch {}
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          // WICHTIG: gleiches Audio-Element wiederverwenden (Gesture-Trust bleibt erhalten)
          const audio = audioRef.current || new Audio();
          audioRef.current = audio;
          try { audio.pause(); } catch {}
          audio.src = url;
          audio.muted = false;
          audio.playbackRate = settings.rate || 1.15;
          audio.onplay = () => { console.log("[speak] ElevenLabs audio onplay"); setSpeaking(true); };
          audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
          audio.onerror = (e) => { console.warn("[speak] audio error", e); setSpeaking(false); URL.revokeObjectURL(url); };
          await audio.play();
          return;
        }
        const errText = await res.text();
        console.warn("[TTS] ElevenLabs failed:", res.status, errText);
      } catch (e) {
        console.warn("[TTS] ElevenLabs error", e);
      }
    } else {
      console.log("[speak] ElevenLabs not used. useElevenLabs:", settings.useElevenLabs, "voiceId:", settings.elevenLabsVoiceId);
    }

    // 2. Browser-TTS (Fallback / Default)
    if (!ttsSupported) return;
    try {
      window.speechSynthesis.cancel();

      const u = new SpeechSynthesisUtterance(text);
      u.lang = "de-DE";
      u.rate = settings.rate || 1.15;
      u.pitch = 1.0;
      u.volume = 1.0;

      const list = voices.length ? voices : (window.speechSynthesis.getVoices() || []);

      // 1. User-Auswahl wenn gesetzt
      let chosen = settings.voiceURI ? list.find(v => v.voiceURI === settings.voiceURI) : null;

      // 2. Auto-Pick: Premium-Varianten priorisieren
      if (!chosen) {
        const deVoices = list.filter(v => v.lang?.toLowerCase().startsWith("de"));
        const isQuality = (v) => /premium|enhanced|verbessert|natural|neural/i.test(v.name||"");
        const preferredNames = ["anna", "helena", "petra", "vicki", "katharina", "marlene"];
        const findByName = (n, quality) => deVoices.find(v =>
          v.name?.toLowerCase().includes(n) && (!quality || isQuality(v))
        );
        chosen =
          preferredNames.map(n => findByName(n, true)).find(Boolean) ||  // erst Premium-Variante
          preferredNames.map(n => findByName(n, false)).find(Boolean) || // dann normal
          deVoices.find(isQuality) ||
          deVoices.find(v => /female|frau/i.test(v.name||"")) ||
          deVoices[0] ||
          list.find(v => v.lang?.toLowerCase().includes("de"));
      }
      if (chosen) u.voice = chosen;

      u.onstart = () => setSpeaking(true);
      u.onend   = () => setSpeaking(false);
      u.onerror = (e) => { console.warn("[TTS] error", e); setSpeaking(false); };

      // Kleiner Delay – cancel() braucht manchmal einen Tick auf iOS
      setTimeout(() => {
        try {
          window.speechSynthesis.speak(u);
          // Manchmal startet onstart nicht – kurzer Fallback
          setTimeout(() => {
            if (window.speechSynthesis.speaking) setSpeaking(true);
          }, 100);
        } catch (err) {
          console.warn("[TTS] speak() failed", err);
        }
      }, 60);
    } catch (err) {
      console.warn("[TTS] outer failed", err);
      setSpeaking(false);
    }
  }
  function stopSpeaking() {
    try { window.speechSynthesis.cancel(); } catch {}
    // Audio nur pausieren, nicht zerstören – Gesture-Trust bleibt erhalten
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch {}
    }
    setSpeaking(false);
  }
  // Wenn Voice-Toggle eingeschaltet wird: einen leeren Utterance abspielen
  // damit iOS die Audio-Permission freigibt (User-Gesture-Unlock).
  function toggleVoice() {
    const v = !voiceOn;
    setVoiceOn(v);
    persist("eyla_chat_voice_v1", v);
    if (v && ttsSupported) {
      try {
        // Lade Voices nochmal explizit
        setVoices(window.speechSynthesis.getVoices() || []);
        const unlock = new SpeechSynthesisUtterance(" ");
        unlock.volume = 0;
        unlock.rate = 1;
        window.speechSynthesis.speak(unlock);
      } catch {}
    } else {
      stopSpeaking();
    }
  }

  // Audio-Element einmal pro Session erstellen + bei erster User-Interaktion entsperren.
  // iOS Safari blockt audio.play() später wenn der Call nicht direkt aus einem User-Gesture
  // kommt (Fetch-Roundtrip > ~1s reicht oft). Trick: ein wiederverwendetes Audio-Element
  // das beim Click muted angespielt wird → behält danach Gesture-Trust dauerhaft.
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
    }
  }, []);

  // Silent-WAV (1 Sample, weniger als 1ms) als DataURL. Nutzen wir für iOS-Unlock.
  const SILENT_WAV = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==";

  function primeAudio() {
    // Speech-Synthesis Unlock
    if (ttsSupported) {
      try {
        const u = new SpeechSynthesisUtterance("");
        u.volume = 0;
        window.speechSynthesis.speak(u);
        setTimeout(() => { try { window.speechSynthesis.cancel(); } catch {} }, 10);
      } catch {}
    }
    // Audio-Element Unlock: echtes silent .wav abspielen damit iOS Vertrauen schenkt
    if (audioRef.current) {
      try {
        audioRef.current.src = SILENT_WAV;
        audioRef.current.muted = false;
        audioRef.current.volume = 1;
        const playP = audioRef.current.play();
        if (playP && playP.then) {
          playP.then(() => {
            // ausspielen lassen, ist ja nur 1 Sample (=instant)
          }).catch(err => {
            console.warn("[primeAudio] play() rejected:", err);
          });
        }
      } catch (e) {
        console.warn("[primeAudio] failed:", e);
      }
    }
  }

  // Initial: Chat + Kontext laden
  useEffect(()=>{
    (async () => {
      const [savedMsgs, sh, pl, vOn] = await Promise.all([
        retrieve("eyla_chat_v1", []),
        retrieve("eyla_shopping_v1", null),
        retrieve("eyla_plan_v1", null),
        retrieve("eyla_chat_voice_v1", null),
      ]);
      // Default ON wenn nichts gespeichert
      setVoiceOn(vOn === null ? true : !!vOn);
      if (savedMsgs && savedMsgs.length > 0) {
        setMessages(savedMsgs);
      } else {
        setMessages([{
          role:"assistant",
          content:`${profile.name.split(" ")[0]}. Ich weiß was heute ansteht${events.length>0?` – ${events.length} Termine`:""}. Was brauchst du?`
        }]);
      }
      setShopping(sh);
      setPlan(pl);
      setLoaded(true);
    })();
  }, []);

  // Persistieren bei Änderung. Bilder werden gestrippt (zu groß für localStorage),
  // nur Text + Image-Marker bleiben übrig.
  useEffect(()=>{
    if (loaded && messages.length > 0) {
      const stripped = messages.map(m => {
        if (Array.isArray(m.content)) {
          const txt = m.content.filter(b => b.type === "text").map(b => b.text).join("\n");
          const hasImg = m.content.some(b => b.type === "image");
          return { ...m, content: txt || (hasImg ? "[Foto]" : ""), _hadImage: hasImg };
        }
        return m;
      });
      persist("eyla_chat_v1", stripped);
    }
  }, [messages, loaded]);

  // Foto auswählen → komprimieren → bereit für Send
  async function handleChatFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const img = new Image();
      img.src = reader.result;
      await new Promise(r => { img.onload = r; });
      const max = 1024;
      const scale = Math.min(1, max/Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width*scale);
      canvas.height = Math.round(img.height*scale);
      const ctx2 = canvas.getContext("2d");
      ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      setChatPhoto({ dataUrl, base64: dataUrl.split(",")[1] });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,loading]);

  const onVoice = useCallback((text)=>send(text),[]);
  const { listening, supported, toggle } = useVoice(onVoice);

  // Dynamische Suggestions basierend auf Tageszeit + Datenlage
  const SUGG = (() => {
    const hour = new Date().getHours();
    const eaten = log.meals.reduce((s,m)=>s+(m.calories||0),0);
    const water = log.water || 0;
    const hasWorkout = (log.workouts||[]).length > 0;
    const hasSleep = !!log.sleep;
    const out = [];

    // Tageszeit-spezifisch
    if (hour >= 6 && hour < 11) {
      out.push("Was sollte ich heute frühstücken?");
      if (!hasSleep) out.push("Schlaf war 7h, wie wirkt sich das aus?");
    } else if (hour >= 11 && hour < 15) {
      out.push("Mittag-Idee passend zum Plan?");
    } else if (hour >= 15 && hour < 18) {
      out.push("Was esse ich vor dem nächsten Termin?");
    } else if (hour >= 18 && hour < 22) {
      out.push("Abendessen-Idee?");
      if (!hasWorkout) out.push("Schaff ich heute noch Training?");
    } else {
      out.push("Wie war mein Tag?");
    }

    // Daten-Lücken-basiert
    if (water < 4 && hour > 11) out.push("Mahn mich – ich trink zu wenig.");
    if (eaten > 0) out.push("Bin ich auf Kurs heute?");
    out.push("Analysiere meinen Tag");
    if (!hasWorkout && new Date().getDay() !== 0) out.push("Brauch ich heute Bewegung?");

    return out.slice(0, 6);
  })();

  function clearChat() {
    if (!confirm("Chat wirklich löschen? Alle Nachrichten weg.")) return;
    persist("eyla_chat_v1", []);
    setMessages([{
      role:"assistant",
      content:`${profile.name.split(" ")[0]}. Was brauchst du?`
    }]);
  }

  // Tool-Executor – arbeitet direkt mit setLog (Live-State) und localStorage
  // für Daten, die in anderen Screens leben. Andere Screens lesen beim Tab-
  // Wechsel automatisch neu, daher reicht das.
  async function executeTool(toolName, input) {
    try {
      switch(toolName) {
        case "add_meal": {
          const cal = parseInt(input.calories) || 0;
          const p = parseInt(input.protein) || 0;
          const c = parseInt(input.carbs) || 0;
          const f = parseInt(input.fat) || 0;
          // Wenn Menge separat geliefert wurde und nicht schon im Namen steckt → reinhängen
          const rawName = String(input.name||"").trim();
          const amount = String(input.amount||"").trim();
          const nameHasAmount = amount && rawName.toLowerCase().includes(amount.toLowerCase().replace(/\s+/g,""));
          const fullName = (amount && !nameHasAmount) ? `${amount} ${rawName}` : rawName;

          // ── ANTI-BUG: Modell hat Menge mit Kalorien verwechselt? ──────────────
          // Robuste Heuristik: prüft alle Zahlen im Input (Voice-transkribiert
          // oft uneinheitlich) und matched gegen calories.
          // Bsp: "200g Steak", "200 Gramm Steak", "Steak 200g", "200 Stück" etc.
          if (cal > 0) {
            const checkText = `${amount} ${rawName}`.toLowerCase();
            // Erweiterte Einheiten-Regex
            const unitWords = /(g|gramm|gr|kg|ml|milliliter|cl|stk|stueck|stück|scheibe[n]?|scheibchen|portion[en]?|tasse[n]?|glas|gläser|tl|el|löffel|löffe?l)\b/i;
            // Finde alle Zahlen im Text
            const numbers = [...checkText.matchAll(/(\d+(?:[.,]\d+)?)/g)].map(m => parseFloat(m[1].replace(",",".")));
            const hasUnitWord = unitWords.test(checkText);

            // Fall A: Zahl matched calories UND irgendeine Einheit ist im Text
            const matchesCal = numbers.some(n => Math.abs(n - cal) <= 3 && n >= 30 && n <= 3000);
            if (matchesCal && hasUnitWord) {
              return `❌ FEHLER: '${rawName}' enthält eine Mengenangabe – du hast die MENGE (${cal}) statt der echten Kalorien eingetragen. ` +
                `Realistische Schätzungen für ${cal}g: Rindersteak ≈ 500 kcal, Hähnchen ≈ 330 kcal, Lachs ≈ 410 kcal, Brot ≈ 240 kcal, Apfel ≈ 100 kcal, Reis gekocht ≈ 260 kcal. ` +
                `Bitte add_meal NOCHMAL aufrufen – setze 'name' = "${fullName}", 'amount' = Mengenangabe, 'calories' = REALISTISCHE Schätzung (NICHT die Menge!), plus protein/carbs/fat.`;
            }
            // Fall B: cal ist sehr niedrig (<100) und name enthält typisches Protein-Lebensmittel → unrealistisch
            const proteinFoods = /\b(steak|fleisch|rind|hähnchen|haehnchen|hühn|huehn|pute|truthahn|lachs|thun|fisch|filet|kotelett|schnitzel|brat|burger|wurst|hack|gulasch)\b/i;
            if (cal < 100 && proteinFoods.test(checkText)) {
              return `❌ FEHLER: ${cal} kcal für '${rawName}' ist unrealistisch niedrig. ` +
                `Selbst 100g mageres Fleisch hat 100-200 kcal, 200g Steak ≈ 500 kcal. ` +
                `Bitte add_meal NOCHMAL aufrufen mit realistischer kcal-Schätzung.`;
            }
          }
          setLog(l => ({...l, meals: [...l.meals, {
            id: Date.now(),
            name: fullName,
            amount: amount || undefined,
            calories: cal,
            protein: p,
            carbs: c,
            fat: f,
            time: new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})
          }]}));
          const macroStr = (p||c||f) ? ` P${p} C${c} F${f}` : "";
          return `Mahlzeit eingetragen: ${fullName}${cal>0?` (${cal} kcal)`:""}${macroStr}`;
        }
        case "set_water": {
          const u = Math.max(0, Math.min(12, parseInt(input.units ?? input.glasses)||0));
          setLog(l => ({...l, water: u}));
          return `Wasser gesetzt auf ${(u*.25).toFixed(2)}L`;
        }
        case "add_water": {
          const delta = parseInt(input.delta)||0;
          setLog(l => ({...l, water: Math.max(0, Math.min(12, (l.water||0) + delta))}));
          return `Wasser ${delta>=0?"+":""}${(delta*.25).toFixed(2)}L`;
        }
        case "set_sleep": {
          setLog(l => ({...l, sleep: String(input.hours)}));
          return `Schlaf: ${input.hours}h`;
        }
        case "set_energy": {
          setLog(l => ({...l, energy: String(input.mood)}));
          return `Energie: ${input.mood}`;
        }
        case "set_weight": {
          const w = parseFloat(input.kg);
          if (!w || w < 30 || w > 300) return `Ungültiges Gewicht: ${input.kg}`;
          setLog(l => ({...l, weight: w}));
          return `Gewicht heute: ${w}kg`;
        }
        case "add_workout": {
          const dur = parseInt(input.duration) || 0;
          const wo = {
            id: Date.now(),
            type: String(input.type || "Training"),
            duration: dur,
            intensity: input.intensity || "",
            time: new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})
          };
          setLog(l => ({...l, workouts: [...(l.workouts||[]), wo]}));
          return `Training: ${wo.type} ${dur}min${wo.intensity?` (${wo.intensity})`:""}`;
        }
        case "toggle_habit": {
          const habits = Array.isArray(profile.habits) ? profile.habits : [];
          if (habits.length === 0) return "Keine Gewohnheiten definiert.";
          const q = String(input.name||"").toLowerCase();
          const habit = habits.find(h => h.name.toLowerCase().includes(q));
          if (!habit) return `"${input.name}" nicht in Gewohnheiten gefunden.`;
          const done = input.done === false ? false : true;
          setLog(l => ({ ...l, habits: { ...(l.habits||{}), [habit.id]: done }}));
          return `${done ? "✓" : "✗"} ${habit.name}`;
        }
        case "add_todo": {
          const text = String(input.text||"").trim();
          if (!text) return "add_todo: text fehlt";
          const priority = ["today","week","later"].includes(input.priority) ? input.priority : "today";
          const newTodo = makeTodo(text, priority);
          const arr = loadTodos();
          saveTodos([newTodo, ...arr]);
          window.dispatchEvent(new Event("eyla_todos_changed"));
          const bucketLabel = priority==="today"?"Heute":priority==="week"?"Diese Woche":"Später";
          return `📝 To-do hinzugefügt: "${text}" → ${bucketLabel}`;
        }
        case "complete_todo": {
          const q = String(input.match||"").toLowerCase();
          if (!q) return "complete_todo: match fehlt";
          const arr = loadTodos();
          const idx = arr.findIndex(t => t.status==="open" && t.text.toLowerCase().includes(q));
          if (idx < 0) return `Kein offenes Todo mit "${input.match}" gefunden.`;
          arr[idx] = { ...arr[idx], status:"done", completedAt:new Date().toISOString() };
          saveTodos(arr);
          window.dispatchEvent(new Event("eyla_todos_changed"));
          return `✓ Erledigt: "${arr[idx].text}"`;
        }
        case "remove_todo": {
          const q = String(input.match||"").toLowerCase();
          if (!q) return "remove_todo: match fehlt";
          const arr = loadTodos();
          const idx = arr.findIndex(t => t.text.toLowerCase().includes(q));
          if (idx < 0) return `Kein Todo mit "${input.match}" gefunden.`;
          const removed = arr[idx].text;
          arr.splice(idx, 1);
          saveTodos(arr);
          window.dispatchEvent(new Event("eyla_todos_changed"));
          return `🗑 Gelöscht: "${removed}"`;
        }
        case "set_todo_priority": {
          const q = String(input.match||"").toLowerCase();
          const priority = ["today","week","later"].includes(input.priority) ? input.priority : "today";
          if (!q) return "set_todo_priority: match fehlt";
          const arr = loadTodos();
          const idx = arr.findIndex(t => t.text.toLowerCase().includes(q));
          if (idx < 0) return `Kein Todo mit "${input.match}" gefunden.`;
          arr[idx] = { ...arr[idx], priority };
          saveTodos(arr);
          window.dispatchEvent(new Event("eyla_todos_changed"));
          const bucketLabel = priority==="today"?"Heute":priority==="week"?"Diese Woche":"Später";
          return `↻ "${arr[idx].text}" → ${bucketLabel}`;
        }
        case "add_event": {
          const todayK = isoDateKey(new Date());
          const arr = await retrieve("eyla_local_events_v2", []) || [];
          const newEv = {
            id: Date.now(),
            title: input.title,
            time: input.time || "",
            duration: input.duration || "",
            date: input.date || todayK,
            local: true
          };
          await persist("eyla_local_events_v2", [...arr, newEv]);
          return `Termin: ${input.title}${input.time?` um ${input.time}`:""}${input.date && input.date !== todayK?` (${input.date})`:""}`;
        }
        case "add_shopping_item": {
          const sh = await retrieve("eyla_shopping_v1", null);
          if (!sh || !Array.isArray(sh.aisles)) return "Keine Einkaufsliste vorhanden – im Tab Essen → Liste einen Laden wählen.";
          const targetAisle = sh.aisles.find(a => a.name === input.gang);
          if (!targetAisle) return `Gang "${input.gang}" gibt's nicht.`;
          const newSh = {
            ...sh,
            aisles: sh.aisles.map(a =>
              a.name === input.gang ? {
                ...a,
                items: [...a.items, { name: input.name, menge: input.menge || "1", quelle: "manuell" }]
              } : a
            )
          };
          await persist("eyla_shopping_v1", newSh);
          setShopping(newSh);
          return `Zur Liste: ${input.name} (${input.gang})`;
        }
        case "check_shopping_item": {
          const sh = await retrieve("eyla_shopping_v1", null);
          if (!sh) return "Keine Einkaufsliste vorhanden.";
          const q = input.name.toLowerCase();
          let foundKey = null;
          let foundName = null;
          for (const a of sh.aisles) {
            const it = a.items.find(i => i.name.toLowerCase().includes(q));
            if (it) { foundKey = a.name + "::" + it.name; foundName = it.name; break; }
          }
          if (!foundKey) return `"${input.name}" nicht auf Liste.`;
          const newSh = { ...sh, checked: { ...sh.checked, [foundKey]: true } };
          await persist("eyla_shopping_v1", newSh);
          setShopping(newSh);
          return `Abgehakt: ${foundName}`;
        }
        default:
          return `Unbekanntes Tool: ${toolName}`;
      }
    } catch(e) {
      return `Fehler: ${e?.message || e}`;
    }
  }

  // Wandelt Chat-Nachrichten in das Anthropic-API-Format um.
  // Einfache Text-Nachrichten bleiben Strings; Tool-Roundtrip-Nachrichten
  // haben bereits ein Array von content-Blocks.
  function msgToApi(m) {
    return { role: m.role, content: m.content };
  }

  async function send(text) {
    const t = text||input.trim();
    if ((!t && !chatPhoto) || loading) return;
    setInput("");

    // IOS Audio-Unlock: SOFORT im User-Gesture-Kontext primen,
    // damit der spätere audio.play() nach dem Fetch nicht blockiert wird.
    if (voiceOn) primeAudio();

    // Wenn Foto angehängt: User-Message wird ein Content-Array mit Bild + Text
    const photo = chatPhoto;
    setChatPhoto(null);
    const userContent = photo
      ? [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo.base64 } },
          { type: "text", text: t || "Was siehst du auf dem Bild?" }
        ]
      : t;
    // _imageUrl ist nur für die UI-Darstellung in dieser Session
    const userMsg = photo
      ? { role:"user", content: userContent, _imageUrl: photo.dataUrl }
      : { role:"user", content: t };

    const baseUi = [...messages, userMsg];
    setMessages(baseUi);
    setLoading(true);

    let convo = [...messages, userMsg];
    const allActions = [];
    let finalText = "";

    try {
      const [freshShopping, freshPlan] = await Promise.all([
        retrieve("eyla_shopping_v1", null),
        retrieve("eyla_plan_v1", null),
      ]);
      setShopping(freshShopping);
      setPlan(freshPlan);

      const weekHistory = weekHistoryFromLogs(logsByDate || {});
      const systemMsg = buildPrompt(profile, log, events, weekHistory, freshPlan, freshShopping);

      // Tool-Loop: bis zu 5 Runden
      let safety = 5;
      while (safety-- > 0) {
        const res = await fetch("/api/chat",{
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            model:"claude-sonnet-4-5",
            max_tokens:1500,
            system: systemMsg,
            tools: EYLA_TOOLS,
            messages: convo.map(msgToApi)
          })
        });
        const data = await res.json();
        const contentArr = data.content || [];
        const textBlocks = contentArr.filter(b=>b.type==="text").map(b=>b.text).filter(Boolean);
        const toolUses = contentArr.filter(b=>b.type==="tool_use");

        if (textBlocks.length > 0) finalText = textBlocks.join("\n");

        if (toolUses.length === 0 || data.stop_reason !== "tool_use") break;

        // Tools ausführen
        const toolResults = [];
        for (const tu of toolUses) {
          const result = await executeTool(tu.name, tu.input || {});
          allActions.push({ name: tu.name, result });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: result
          });
        }
        convo = [
          ...convo,
          { role: "assistant", content: contentArr },
          { role: "user", content: toolResults }
        ];
      }

      setMessages([
        ...messages,
        userMsg,
        { role:"assistant", content: finalText || "…", actions: allActions }
      ]);
      speak(finalText);
    } catch {
      setMessages([
        ...messages,
        userMsg,
        { role:"assistant", content:"Kurze Unterbrechung." }
      ]);
    }
    setLoading(false);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 130px)" }}>
      {/* Chat Header mit Voice + Clear-Button */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <Lbl>EYLA · CHAT</Lbl>
        <div style={{ display:"flex", gap:6 }}>
          {ttsSupported && (
            <button onClick={toggleVoice} style={{
              background: voiceOn ? T.acc+"22" : "transparent",
              border:`1px solid ${voiceOn?T.acc:T.borderS}`, borderRadius:8,
              padding:"4px 10px", color: voiceOn?T.acc:T.muted,
              fontFamily:T.mono, fontSize:9, letterSpacing:1, cursor:"pointer", transition:"all .2s"
            }} title="EYLA spricht ihre Antworten">🔊 STIMME</button>
          )}
          {messages.length > 1 && (
            <button onClick={clearChat} style={{
              background:"transparent", border:`1px solid ${T.borderS}`, borderRadius:8,
              padding:"4px 10px", color:T.muted, fontFamily:T.mono, fontSize:9,
              letterSpacing:1, cursor:"pointer", transition:"all .2s"
            }}>↺ NEU</button>
          )}
        </div>
      </div>

      {listening && (
        <button onClick={toggle} style={{ width:"100%", display:"flex",alignItems:"center",gap:8,padding:"8px 16px",
          background:T.green+"11",border:`1px solid ${T.green}33`,borderRadius:10,marginBottom:12,
          cursor:"pointer", textAlign:"left" }}>
          <div style={{ width:7,height:7,borderRadius:"50%",background:T.green,animation:"blink 1s infinite" }}/>
          <span style={{ color:T.green,fontFamily:T.mono,fontSize:10,letterSpacing:1, flex:1 }}>EYLA HÖRT ZU – sprich jetzt</span>
          <span style={{ color:T.muted, fontFamily:T.serif, fontSize:11, fontStyle:"italic" }}>tippen zum stoppen</span>
        </button>
      )}

      {speaking && (
        <button onClick={stopSpeaking} style={{ width:"100%", display:"flex",alignItems:"center",gap:8,padding:"8px 16px",
          background:T.acc+"11",border:`1px solid ${T.acc}33`,borderRadius:10,marginBottom:12,
          cursor:"pointer", textAlign:"left" }}>
          <div style={{ display:"flex", gap:2, alignItems:"flex-end", height:10 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ width:2, background:T.acc, borderRadius:1,
                animation:`vSpeak ${.6+(i%3)*.15}s ease-in-out infinite alternate`,
                animationDelay:`${(i*.1).toFixed(2)}s` }}/>
            ))}
            <style>{`@keyframes vSpeak{from{height:3px}to{height:10px}}`}</style>
          </div>
          <span style={{ color:T.acc, fontFamily:T.mono, fontSize:10, letterSpacing:1, flex:1, marginLeft:4 }}>EYLA SPRICHT</span>
          <span style={{ color:T.muted, fontFamily:T.serif, fontSize:11, fontStyle:"italic" }}>tippen zum stummschalten</span>
        </button>
      )}

      <div style={{ flex:1, overflowY:"auto", paddingRight:4 }}>
        {messages.length<6&&(
          <div style={{ marginBottom:18 }}>
            <Lbl style={{ marginBottom:10 }}>SCHNELLZUGRIFF</Lbl>
            <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
              {SUGG.map((s,i)=>(
                <button key={i} onClick={()=>send(s)} style={{ background:"transparent",
                  border:`1px solid ${T.borderS}`, borderRadius:20, padding:"7px 14px",
                  color:T.muted, fontFamily:T.serif, fontSize:12, cursor:"pointer",
                  fontStyle:"italic", transition:"all .2s" }}
                onMouseEnter={e=>{e.target.style.borderColor=T.acc;e.target.style.color=T.text;}}
                onMouseLeave={e=>{e.target.style.borderColor=T.borderS;e.target.style.color=T.muted;}}
                >{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg,i)=>{
          const isE = msg.role==="assistant";
          return (
            <div key={i} style={{ display:"flex",gap:10,flexDirection:isE?"row":"row-reverse",marginBottom:16,animation:"fadeUp .3s ease both" }}>
              <div style={{ width:30,height:30,borderRadius:"50%",flexShrink:0,marginTop:4,
                background:isE?`radial-gradient(circle at 35% 35%,${T.goldL},${T.acc},${T.dim})`:"linear-gradient(135deg,#1e293b,#0f172a)",
                border:`1px solid ${isE?T.acc+"55":"#334155"}`,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize: isE ? 11 : 12,
                fontFamily: isE ? "inherit" : T.serif,
                fontWeight: isE ? 400 : 500,
                color: isE ? T.bg : T.mid,
                letterSpacing: isE ? 0 : 0.5
              }}>
                {isE ? "✦" : (profile.name?.charAt(0) || "·").toUpperCase()}
              </div>
              <div style={{ maxWidth:"80%" }}>
                <Lbl style={{ marginBottom:5 }}>{isE?"EYLA":profile.name.split(" ")[0].toUpperCase()}</Lbl>
                <div style={{ background:isE?`linear-gradient(135deg,${T.bg2},${T.card})`:"linear-gradient(135deg,#0f172a,#1e293b)",
                  border:`1px solid ${isE?T.acc+"22":"#1e293b"}`,
                  borderRadius:isE?"3px 14px 14px 14px":"14px 3px 14px 14px",
                  padding:"11px 15px",color:isE?T.text:"#cbd5e1",fontSize:14,lineHeight:1.75 }}>
                  {/* Foto-Vorschau wenn Bild angehängt war */}
                  {msg._imageUrl && (
                    <img src={msg._imageUrl} alt="" style={{
                      maxWidth:"100%", maxHeight:200, borderRadius:8,
                      marginBottom: (typeof msg.content === "string" ? msg.content : "").trim() ? 8 : 0,
                      display:"block"
                    }}/>
                  )}
                  {/* Marker wenn das Foto nicht mehr da ist (persistiert ohne Bild) */}
                  {!msg._imageUrl && msg._hadImage && (
                    <div style={{ fontSize:10, color:T.muted, fontStyle:"italic", marginBottom:6, fontFamily:T.mono, letterSpacing:1 }}>📷 FOTO</div>
                  )}
                  {/* Text-Inhalt */}
                  {typeof msg.content === "string"
                    ? msg.content
                    : (msg.content||[]).filter(b => b.type === "text").map((b,bi) => <div key={bi}>{b.text}</div>)}
                </div>
                {/* Tool-Aktionen, die EYLA in diesem Turn ausgeführt hat */}
                {Array.isArray(msg.actions) && msg.actions.length > 0 && (
                  <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:3 }}>
                    {msg.actions.map((a, ai) => (
                      <div key={ai} style={{
                        fontSize:10, fontFamily:T.mono, color:T.green,
                        letterSpacing:.5, paddingLeft:2
                      }}>✓ {a.result}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading&&(
          <div style={{ display:"flex",gap:10,marginBottom:14 }}>
            <div style={{ width:30,height:30,borderRadius:"50%",flexShrink:0,marginTop:4,
              background:`radial-gradient(circle at 35% 35%,${T.goldL},${T.acc},${T.dim})`,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:11 }}>✦</div>
            <div style={{ paddingTop:8 }}><Waveform/></div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      <div style={{ paddingTop:12, borderTop:`1px solid ${T.border}` }}>
        {/* Foto-Preview wenn angehängt */}
        {chatPhoto && (
          <div style={{
            display:"flex", alignItems:"center", gap:10, marginBottom:8,
            padding:8, background:T.bg2, borderRadius:10,
            border:`1px solid ${T.acc}33`, animation:"fadeUp .2s ease both"
          }}>
            <img src={chatPhoto.dataUrl} alt="" style={{
              width:48, height:48, objectFit:"cover", borderRadius:6,
              border:`1px solid ${T.borderS}`, flexShrink:0
            }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:T.acc, fontFamily:T.mono, fontSize:10, letterSpacing:1 }}>FOTO ANGEHÄNGT</div>
              <div style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, marginTop:2 }}>
                Tipp: schreib was dazu oder schick einfach so.
              </div>
            </div>
            <button onClick={()=>setChatPhoto(null)} style={{
              background:"none", border:"none", color:T.muted, cursor:"pointer",
              fontSize:18, padding:"0 4px"
            }}>×</button>
          </div>
        )}

        <div style={{ display:"flex",gap:8,alignItems:"center",background:T.card,
          border:`1px solid ${T.borderS}`,borderRadius:12,padding:"5px 5px 5px 14px" }}>
          <input ref={chatFileRef} type="file" accept="image/*" capture="environment"
            onChange={handleChatFile} style={{ display:"none" }}/>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}
            placeholder={chatPhoto ? "Schreib was zum Foto …" : "Frag EYLA …"}
            style={{ flex:1,background:"none",border:"none",outline:"none",
            color:T.text,fontSize:14,fontFamily:T.serif,padding:"9px 0",fontStyle:"italic" }}/>
          <button onClick={()=>chatFileRef.current?.click()} disabled={loading} style={{
            width:36, height:36, borderRadius:8, flexShrink:0,
            border:"none", background: chatPhoto ? T.acc+"22" : "transparent",
            color: chatPhoto ? T.acc : T.muted,
            fontSize:14, cursor: loading ? "default" : "pointer",
            display:"flex", alignItems:"center", justifyContent:"center"
          }} title="Foto anhängen">📷</button>
          <VoiceBtn toggle={toggle} listening={listening} supported={supported}/>
          <button onClick={()=>send()} disabled={(!input.trim() && !chatPhoto)||loading} style={{
            width:38,height:38,borderRadius:9,border:"none",flexShrink:0,
            background:((input.trim()||chatPhoto)&&!loading)?`linear-gradient(135deg,${T.dim},${T.acc})`:T.bg2,
            color:((input.trim()||chatPhoto)&&!loading)?T.bg:T.muted,
            fontSize:15,cursor:((input.trim()||chatPhoto)&&!loading)?"pointer":"default",transition:"all .2s"
          }}>{loading?"✦":"↑"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── PLAN SCREEN ──────────────────────────────────────────────────────────────
function PlanScreen({ profile }) {
  const [days, setDays] = useState([]);
  const [intro, setIntro] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  // Swap-Modus: welche Mahlzeit gerade ersetzt wird (id "dayIdx:slot")
  const [swappingKey, setSwappingKey] = useState(null);
  // Favoriten – Set von normalisierten Mahlzeit-Namen
  const [favorites, setFavorites] = useState([]);
  // Kühlschrank-Foto State
  const [fridgeAnalyzing, setFridgeAnalyzing] = useState(false);
  const [fridgeIdeas, setFridgeIdeas] = useState(null); // {ingredients, ideas[]}
  const [fridgeError, setFridgeError] = useState(null);
  const fridgeFileRef = useRef(null);

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
      }
      setLoaded(true);
    });
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

      const userPrompt = `Profil: ${profile.name||"Phil"}, ${sexLabel}, ${profile.age||35}J, ${profile.weight||79}kg, ${profile.height||183}cm. Aktivität: ${profile.activity||"5x Woche Beweglichkeit"}. Vorlieben: ${profile.preferences?.join(", ")||"wenig Fleisch, proteinreich, mediterran"}. ${intolSatz} ${zielKontext} ${personsSatz} Erstelle den 7-Tage-Plan.`;

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
      if (!res.ok) throw new Error("Status " + res.status);
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
            Ich erstelle dir einen Plan passend zu deinem Training und deinen Vorlieben.
          </p>
          {error && <p style={{ color:T.red, fontSize:12, fontFamily:T.mono, marginBottom:16, padding:"8px 12px", background:T.red+"11", borderRadius:8 }}>{error}</p>}
          <button onClick={generate} style={{ background:"linear-gradient(135deg," + T.dim + "," + T.acc + ")", border:"none", borderRadius:12, padding:"12px 28px", color:T.bg, fontFamily:T.serif, fontSize:14, cursor:"pointer", fontWeight:700 }}>
            Plan erstellen ✦
          </button>
        </Card>
      )}
      {loading && (
        <Card style={{ textAlign:"center", padding:48 }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:20 }}><EylaOrb size={64} thinking/></div>
          <Lbl style={{ marginBottom:8 }}>EYLA ERSTELLT DEINEN PLAN …</Lbl>
          <p style={{ color:T.muted, fontSize:12, fontStyle:"italic", fontFamily:T.serif, margin:0 }}>Dauert ca. 15 Sekunden.</p>
        </Card>
      )}
      {days.length > 0 && (
        <div>
          {intro && (
            <Card accent style={{ marginBottom:16 }}>
              <p style={{ color:T.mid, fontStyle:"italic", fontSize:14, margin:0, lineHeight:1.7, fontFamily:T.serif }}>✦ {intro}</p>
            </Card>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))", gap:12 }}>
            {days.map((day, i) => (
              <Card key={i}>
                <Lbl color={T.acc} style={{ marginBottom:12 }}>{day.day.toUpperCase()}</Lbl>
                {["breakfast","lunch","dinner","snack"].map(m => {
                  const swapKey = `${i}:${m}`;
                  const isSwapping = swappingKey === swapKey;
                  const isEmpty = !day[m] || day[m] === "—" || day[m] === "–";
                  return (
                    <div key={m} style={{ marginBottom:9 }}>
                      <div style={{ display:"flex", gap:6, alignItems:"center", justifyContent:"space-between" }}>
                        <div style={{ display:"flex", gap:6, alignItems:"baseline" }}>
                          <span style={{ fontSize:11 }}>{icons[m]}</span>
                          <Lbl style={{ fontSize:10 }}>{labels[m]}</Lbl>
                        </div>
                        {!isEmpty && (
                          <div style={{ display:"flex", gap:2 }}>
                            <button
                              onClick={()=>toggleFav(day[m])}
                              title={isFav(day[m]) ? "Aus Favoriten" : "Als Favorit"}
                              style={{
                                background:"transparent", border:"none",
                                color: isFav(day[m]) ? T.gold : T.muted,
                                cursor:"pointer", padding:"2px 4px",
                                fontSize:11, opacity: isFav(day[m]) ? 1 : 0.5,
                                transition:"opacity .15s"
                              }}
                              onMouseEnter={e=>{ e.currentTarget.style.opacity="1"; }}
                              onMouseLeave={e=>{ e.currentTarget.style.opacity = isFav(day[m]) ? "1" : "0.5"; }}
                            >{isFav(day[m]) ? "★" : "☆"}</button>
                            <button
                              onClick={()=>swapMeal(i, m)}
                              disabled={isSwapping}
                              title="Vorschlag tauschen"
                              style={{
                                background:"transparent", border:"none", color:T.muted,
                                cursor: isSwapping ? "default" : "pointer", padding:"2px 4px",
                                fontFamily:T.mono, fontSize:11, opacity: isSwapping ? 1 : 0.5,
                                transition:"opacity .15s"
                              }}
                              onMouseEnter={e=>{ if(!isSwapping) e.currentTarget.style.opacity="1"; e.currentTarget.style.color = T.acc; }}
                              onMouseLeave={e=>{ if(!isSwapping) e.currentTarget.style.opacity="0.5"; e.currentTarget.style.color = T.muted; }}
                            >{isSwapping ? "…" : "↻"}</button>
                          </div>
                        )}
                      </div>
                      <div style={{ color: isSwapping ? T.acc : T.mid, fontSize:12, paddingLeft:18, fontStyle:"italic", fontFamily:T.serif, transition:"color .2s" }}>
                        {isSwapping ? "Suche Alternative …" : day[m]}
                      </div>
                    </div>
                  );
                })}
                {day.tip && day.tip !== "–" && (
                  <div style={{ marginTop:10, padding:"8px 12px", background:T.acc+"0A", borderRadius:8, borderLeft:"2px solid "+T.acc }}>
                    <Lbl color={T.acc} style={{ marginBottom:3 }}>EYLA</Lbl>
                    <div style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif }}>{day.tip}</div>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <div style={{ textAlign:"center", marginTop:16 }}>
            <button onClick={generate} style={{ background:"transparent", border:"1px solid "+T.borderS, borderRadius:10, padding:"9px 20px", color:T.muted, fontFamily:T.serif, fontSize:12, cursor:"pointer", fontStyle:"italic" }}>Neu generieren</button>
          </div>
        </div>
      )}
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
// Sammelt + persistiert Stimme + Tempo. Auch von ChatScreen genutzt.
function loadVoiceSettings() {
  try {
    const raw = localStorage.getItem("eyla_voice_settings_v1");
    if (!raw) return { voiceURI: null, rate: 1.15, elevenLabsVoiceId: null, useElevenLabs: false };
    const parsed = JSON.parse(raw);
    return {
      voiceURI: parsed.voiceURI || null,
      rate: parsed.rate || 1.15,
      elevenLabsVoiceId: parsed.elevenLabsVoiceId || null,
      useElevenLabs: !!parsed.useElevenLabs,
    };
  } catch { return { voiceURI: null, rate: 1.15, elevenLabsVoiceId: null, useElevenLabs: false }; }
}

// ElevenLabs pre-built Voices (multilingual, sprechen deutsch ordentlich)
const ELEVENLABS_PRESETS = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah",     desc: "weiblich, klar, jung" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", desc: "weiblich, ruhig, warm" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily",      desc: "weiblich, freundlich" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda",   desc: "weiblich, vertraut" },
  { id: "9BWtsMINqrJLrRacOk9x", name: "Aria",      desc: "weiblich, informativ" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel",    desc: "weiblich, neutral" },
];

function VoiceSettings() {
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState(null);
  const [rate, setRate] = useState(1.15);
  const [useElevenLabs, setUseElevenLabs] = useState(false);
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState("");
  const [elVoices, setElVoices] = useState([]);  // echte ElevenLabs-Voices vom Account
  const [elVoicesLoading, setElVoicesLoading] = useState(false);
  const [elVoicesError, setElVoicesError] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (ttsSupported) {
      const load = () => setVoices(window.speechSynthesis.getVoices() || []);
      load();
      window.speechSynthesis.addEventListener?.("voiceschanged", load);
    }
    const s = loadVoiceSettings();
    setVoiceURI(s.voiceURI);
    setRate(s.rate);
    setUseElevenLabs(s.useElevenLabs);
    if (s.elevenLabsVoiceId) setElevenLabsVoiceId(s.elevenLabsVoiceId);
    return () => {
      if (ttsSupported) window.speechSynthesis.removeEventListener?.("voiceschanged", () => {});
    };
  }, []);

  // ElevenLabs-Voices nachladen sobald aktiviert
  useEffect(() => {
    if (!useElevenLabs || elVoices.length > 0) return;
    setElVoicesLoading(true);
    setElVoicesError(null);
    fetch("/api/voices")
      .then(r => r.json().then(d => ({ ok: r.ok, status: r.status, data: d })))
      .then(({ ok, status, data }) => {
        if (!ok) {
          setElVoicesError(data?.error || `Status ${status}`);
          return;
        }
        const list = data.voices || [];
        setElVoices(list);
        // Wenn aktuelle Voice-ID nicht in der Liste: erste verfügbare wählen
        if (list.length > 0 && !list.find(v => v.voice_id === elevenLabsVoiceId)) {
          setElevenLabsVoiceId(list[0].voice_id);
          persistSettings({ elevenLabsVoiceId: list[0].voice_id });
        }
      })
      .catch(e => setElVoicesError(String(e?.message || e)))
      .finally(() => setElVoicesLoading(false));
  }, [useElevenLabs]);

  function persistSettings(next) {
    // Frisch aus localStorage lesen + mergen – vermeidet Closure-Staleness
    const current = loadVoiceSettings();
    const merged = { ...current, ...next };
    localStorage.setItem("eyla_voice_settings_v1", JSON.stringify(merged));
    console.log("[VoiceSettings] persisted:", merged);
  }
  function setVoice(uri) { setVoiceURI(uri); persistSettings({ voiceURI: uri }); }
  function setRateAndSave(r) { setRate(r); persistSettings({ rate: r }); }
  function setElToggle(v) { setUseElevenLabs(v); persistSettings({ useElevenLabs: v }); }
  function setElId(id) { setElevenLabsVoiceId(id); persistSettings({ elevenLabsVoiceId: id }); }

  async function testVoice() {
    setTesting(true);
    setTestError(null);
    const sampleText = "Ich bin EYLA. So klingt meine Stimme.";

    // 1. ElevenLabs probieren wenn aktiviert
    if (useElevenLabs && elevenLabsVoiceId) {
      try {
        const res = await fetch("/api/tts", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ text: sampleText, voiceId: elevenLabsVoiceId })
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
          const audio = new Audio(url);
          audio.playbackRate = rate;
          audio.onended = () => { setTesting(false); URL.revokeObjectURL(url); };
          audio.onerror = () => { setTesting(false); setTestError("Konnte Audio nicht abspielen"); URL.revokeObjectURL(url); };
          audioRef.current = audio;
          await audio.play();
          return;
        } else {
          const errData = await res.json().catch(()=>({}));
          setTestError(errData.error || "ElevenLabs nicht erreichbar – probier Browser-Stimme");
          setTesting(false);
          return;
        }
      } catch (e) {
        setTestError("Netzwerk-Fehler: " + (e.message||e));
        setTesting(false);
        return;
      }
    }

    // 2. Browser-TTS
    if (!ttsSupported) { setTesting(false); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(sampleText);
      u.lang = "de-DE";
      u.rate = rate;
      const v = voices.find(x => x.voiceURI === voiceURI);
      if (v) u.voice = v;
      u.onend = () => setTesting(false);
      u.onerror = () => setTesting(false);
      setTimeout(()=>window.speechSynthesis.speak(u), 50);
    } catch { setTesting(false); }
  }

  // Sortiere: Deutsche zuerst, dann nach Qualitäts-Indikator, dann Rest
  const isQuality = (v) => /premium|enhanced|verbessert|natural|neural/i.test(v.name||"");
  const sorted = [...voices].sort((a, b) => {
    const aDe = a.lang?.toLowerCase().startsWith("de");
    const bDe = b.lang?.toLowerCase().startsWith("de");
    if (aDe !== bDe) return aDe ? -1 : 1;
    if (isQuality(a) !== isQuality(b)) return isQuality(a) ? -1 : 1;
    return (a.name||"").localeCompare(b.name||"");
  });

  const selectStyle = {
    width:"100%", background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:8,
    padding:"9px 12px", color:T.text, fontFamily:T.serif, fontSize:13,
    outline:"none", boxSizing:"border-box", appearance:"none",
    backgroundImage:`linear-gradient(45deg, transparent 50%, ${T.muted} 50%), linear-gradient(135deg, ${T.muted} 50%, transparent 50%)`,
    backgroundPosition:"right 14px top 16px, right 9px top 16px",
    backgroundSize:"5px 5px, 5px 5px",
    backgroundRepeat:"no-repeat"
  };

  return (
    <Card style={{ marginBottom:12 }}>
      <Lbl style={{ marginBottom:10 }}>STIMME · EYLA</Lbl>

      {/* Modus-Switch */}
      <div style={{ display:"flex", gap:6, marginBottom:14 }}>
        <button onClick={()=>setElToggle(false)} style={{
          flex:1, padding:"8px 10px", borderRadius:8,
          background: !useElevenLabs ? T.acc+"22" : "transparent",
          border:`1px solid ${!useElevenLabs ? T.acc : T.borderS}`,
          color: !useElevenLabs ? T.text : T.muted,
          fontFamily:T.serif, fontSize:12, cursor:"pointer",
          fontStyle: !useElevenLabs ? "normal" : "italic"
        }}>System-Stimme</button>
        <button onClick={()=>setElToggle(true)} style={{
          flex:1, padding:"8px 10px", borderRadius:8,
          background: useElevenLabs ? T.gold+"22" : "transparent",
          border:`1px solid ${useElevenLabs ? T.gold : T.borderS}`,
          color: useElevenLabs ? T.text : T.muted,
          fontFamily:T.serif, fontSize:12, cursor:"pointer",
          fontStyle: useElevenLabs ? "normal" : "italic"
        }}>✦ ElevenLabs</button>
      </div>

      {!useElevenLabs ? (
        <>
          {ttsSupported && (
            <div style={{ marginBottom:12 }}>
              <Lbl style={{ marginBottom:6, fontSize:10 }}>STIMME ({sorted.length} verfügbar)</Lbl>
              <select value={voiceURI || ""} onChange={e=>setVoice(e.target.value || null)} style={selectStyle}>
                <option value="">– Auto (beste verfügbare) –</option>
                {sorted.map(v => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} · {v.lang}{isQuality(v) ? " ✦" : ""}
                  </option>
                ))}
              </select>
              <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", fontFamily:T.serif, margin:"6px 0 0", lineHeight:1.5 }}>
                iPhone: Einstellungen → Bedienungshilfen → VoiceOver → Sprachausgabe → Stimmen → Deutsch → „verbessert"-Stimme laden.
              </p>
            </div>
          )}
        </>
      ) : (
        <div style={{ marginBottom:12 }}>
          <Lbl style={{ marginBottom:6, fontSize:10 }}>
            ELEVENLABS-STIMME{elVoicesLoading ? " · LÄDT …" : elVoices.length > 0 ? ` · ${elVoices.length} VERFÜGBAR` : ""}
          </Lbl>
          {elVoicesError && (
            <p style={{ color:T.red, fontSize:11, fontStyle:"italic", fontFamily:T.serif, margin:"0 0 6px" }}>
              {elVoicesError}
            </p>
          )}
          <select value={elevenLabsVoiceId} onChange={e=>setElId(e.target.value)} style={selectStyle}>
            {elVoices.length > 0 ? (
              <>
                {/* Eigene/Geklonte Stimmen oben */}
                {elVoices.filter(v => v.category === "cloned" || v.category === "generated" || v.category === "professional").length > 0 && (
                  <optgroup label="✦ Deine eigenen">
                    {elVoices.filter(v => v.category === "cloned" || v.category === "generated" || v.category === "professional").map(v => (
                      <option key={v.voice_id} value={v.voice_id}>{v.name}{v.labels?.gender ? ` · ${v.labels.gender}` : ""}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="ElevenLabs Library (weiblich)">
                  {elVoices
                    .filter(v => v.category !== "cloned" && v.category !== "generated" && v.category !== "professional")
                    .filter(v => (v.labels?.gender || "").toLowerCase() === "female")
                    .map(v => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}{v.labels?.accent ? ` · ${v.labels.accent}` : ""}{v.labels?.age ? ` · ${v.labels.age}` : ""}
                      </option>
                    ))}
                </optgroup>
              </>
            ) : !elVoicesLoading ? (
              // Fallback wenn nichts geladen (z.B. API-Key nicht gesetzt)
              <>
                {ELEVENLABS_PRESETS.map(v => (
                  <option key={v.id} value={v.id}>{v.name} · {v.desc}</option>
                ))}
              </>
            ) : null}
          </select>
          <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", fontFamily:T.serif, margin:"6px 0 0", lineHeight:1.5 }}>
            Klone deine eigene Stimme auf <span style={{ color:T.gold }}>elevenlabs.io</span> (30s Sample reicht). Erscheint automatisch oben unter „Deine eigenen".
          </p>
        </div>
      )}

      <div style={{ marginBottom:14 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
          <Lbl style={{ fontSize:10 }}>TEMPO</Lbl>
          <span style={{ color:T.muted, fontFamily:T.mono, fontSize:10 }}>{rate.toFixed(2)}x</span>
        </div>
        <input type="range" min="0.7" max="1.5" step="0.05" value={rate}
          onChange={e=>setRateAndSave(parseFloat(e.target.value))}
          style={{ width:"100%", accentColor: useElevenLabs ? T.gold : T.acc }}/>
        <div style={{ display:"flex", justifyContent:"space-between", color:T.muted, fontFamily:T.mono, fontSize:9, marginTop:2 }}>
          <span>langsam</span><span>normal</span><span>schnell</span>
        </div>
      </div>

      <button onClick={testVoice} disabled={testing} style={{
        background: (useElevenLabs ? T.gold : T.acc)+"18",
        border:`1px solid ${(useElevenLabs ? T.gold : T.acc)}44`, borderRadius:10,
        padding:"8px 16px", color: useElevenLabs ? T.gold : T.acc,
        fontFamily:T.serif, fontSize:12,
        cursor: testing ? "default" : "pointer", fontStyle:"italic"
      }}>{testing ? "🔊 Spricht …" : "🔊 Stimme testen"}</button>
      {testError && (
        <p style={{ color:T.red, fontSize:11, fontStyle:"italic", margin:"8px 0 0", fontFamily:T.serif }}>
          {testError}
        </p>
      )}
    </Card>
  );
}

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
                   profile.mealPattern==="ifother"?"⏱ IF anders":"–"}
                </div>
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

      {/* EYLA – Sektion (app/agent settings, kommen ans Ende weil es bei Profil hauptsächlich um den User geht) */}
      <div style={{ fontFamily:T.mono, fontSize:9, color:T.muted, letterSpacing:2, margin:"22px 4px 10px", display:"flex", alignItems:"center", gap:8 }}>
        <span>EYLA · STIMME & APPS</span>
        <div style={{ flex:1, height:1, background:T.borderS, opacity:.5 }}/>
      </div>

      <VoiceSettings/>

      {/* Verbundene Apps – Connect/Disconnect für externe Dienste */}
      <IntegrationsCard/>

      {profile.apps?.length>0&&<Card style={{ marginBottom:12 }}><Lbl style={{ marginBottom:10 }}>VERBUNDENE APPS (alt)</Lbl><div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>{profile.apps.map((a,i)=><div key={i} style={{ display:"flex",alignItems:"center",gap:6,background:T.bg2,border:`1px solid ${T.borderS}`,borderRadius:8,padding:"5px 12px" }}><div style={{ width:5,height:5,borderRadius:"50%",background:T.green,boxShadow:`0 0 5px ${T.green}` }}/><span style={{ color:T.mid,fontFamily:T.mono,fontSize:10 }}>{a}</span></div>)}</div></Card>}

      {/* DATEN – Sektion (hinter EYLA, damit Backup nahe Reset) */}
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

// ─── INTEGRATIONS (Google Calendar / Strava / Gmail) ─────────────────────────
// Connect-State pro Provider. Tokens liegen im Backend (Upstash via /api/<provider>/status).
// Wir cachen nur den Connect-Status im React-State.

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

function useIntegrationStatus(provider) {
  const [status, setStatus] = useState({ loading:true, connected:false });
  const refresh = useCallback(async () => {
    const code = getEylaCode();
    if (!code) { setStatus({ loading:false, connected:false, noCode:true }); return; }
    setStatus(s => ({...s, loading:true}));
    const { ok, data } = await fetchJSON(`/api/${provider}/status`);
    if (ok && data) setStatus({ loading:false, ...data });
    else setStatus({ loading:false, connected:false });
  }, [provider]);
  useEffect(() => { refresh(); }, [refresh]);
  return { ...status, refresh };
}

function connectGoogle() {
  const code = getEylaCode();
  if (!code) { alert("Erst mit Access-Code einloggen."); return; }
  // Vollredirect — Google kann nicht in iframe geladen werden
  window.location.href = `/api/google/auth?code=${encodeURIComponent(code)}`;
}

async function disconnectProvider(provider) {
  await fetchJSON(`/api/${provider}/disconnect`, { method:"POST" });
}

async function fetchGoogleEvents(fromDate, toDate) {
  const from = fromDate.toISOString();
  const to = toDate.toISOString();
  const { ok, data } = await fetchJSON(`/api/google/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  if (!ok) return [];
  return data?.events || [];
}

async function createGoogleEvent({ title, date, time, duration }) {
  const { ok, data } = await fetchJSON(`/api/google/events`, {
    method: "POST",
    body: JSON.stringify({ title, date, time, duration }),
  });
  return { ok, data };
}

function IntegrationsCard() {
  const google = useIntegrationStatus("google");
  // Strava + Gmail: Platzhalter bis Backend dafür da ist
  const [postOAuthMsg, setPostOAuthMsg] = useState(null);

  // Check URL-Params nach OAuth Callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("app_connected");
    const error = params.get("app_error");
    if (connected) {
      setPostOAuthMsg({ type:"success", text: `${connected} verbunden ✓` });
      google.refresh();
      // URL bereinigen
      window.history.replaceState({}, "", window.location.pathname);
    } else if (error) {
      setPostOAuthMsg({ type:"error", text: `Verbindung fehlgeschlagen: ${error}` });
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (connected || error) {
      const t = setTimeout(()=>setPostOAuthMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, []);

  const providers = [
    {
      id: "google",
      label: "Google Calendar",
      hint: "Termine sehen + erstellen direkt in deinem Google-Kalender.",
      icon: "🗓",
      color: T.acc,
      status: google,
      onConnect: connectGoogle,
      onDisconnect: async () => { await disconnectProvider("google"); google.refresh(); },
    },
    { id:"strava",  label:"Strava",  hint:"Workouts importieren (Distanz, Dauer, Puls).", icon:"🏃", color:T.green,  status:{ connected:false, loading:false, comingSoon:true } },
    { id:"gmail",   label:"Gmail",   hint:"EYLA fasst neue Mails zusammen, extrahiert Todos & Termine.", icon:"✉",  color:T.gold,   status:{ connected:false, loading:false, comingSoon:true } },
  ];

  return (
    <Card style={{ marginBottom:12 }}>
      <Lbl style={{ marginBottom:10 }}>VERBUNDENE APPS</Lbl>
      {postOAuthMsg && (
        <div style={{
          padding:"8px 12px", borderRadius:8, marginBottom:12,
          background: postOAuthMsg.type==="success" ? T.green+"22" : T.red+"22",
          border: `1px solid ${postOAuthMsg.type==="success" ? T.green : T.red}55`,
          color: postOAuthMsg.type==="success" ? T.green : T.red,
          fontSize:12, fontFamily:T.serif
        }}>
          {postOAuthMsg.text}
        </div>
      )}
      {providers.map(p => (
        <div key={p.id} style={{
          display:"flex", alignItems:"center", gap:12, padding:"10px 0",
          borderBottom:`1px solid ${T.border}`
        }}>
          <div style={{
            width:38, height:38, borderRadius:10, background: p.color+"18",
            border:`1px solid ${p.color}44`, display:"flex", alignItems:"center",
            justifyContent:"center", fontSize:18, flexShrink:0
          }}>{p.icon}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ color:T.text, fontSize:13, fontFamily:T.serif }}>{p.label}</span>
              {p.status.connected && (
                <span style={{ background:T.green+"22", border:`1px solid ${T.green}55`, borderRadius:10, padding:"1px 8px", fontSize:9, color:T.green, fontFamily:T.mono, letterSpacing:1 }}>VERBUNDEN</span>
              )}
              {p.status.comingSoon && (
                <span style={{ background:T.bg2, border:`1px solid ${T.borderS}`, borderRadius:10, padding:"1px 8px", fontSize:9, color:T.muted, fontFamily:T.mono, letterSpacing:1 }}>BALD</span>
              )}
            </div>
            <div style={{ color:T.muted, fontSize:11, fontStyle:"italic", fontFamily:T.serif, marginTop:2 }}>
              {p.status.connected && p.status.email ? p.status.email : p.hint}
            </div>
          </div>
          {p.status.comingSoon ? (
            <span style={{ color:T.muted, fontFamily:T.mono, fontSize:10, fontStyle:"italic" }}>—</span>
          ) : p.status.loading ? (
            <span style={{ color:T.muted, fontFamily:T.mono, fontSize:10 }}>…</span>
          ) : p.status.connected ? (
            <button onClick={p.onDisconnect} style={{
              background:"transparent", border:`1px solid ${T.red}33`, borderRadius:8,
              padding:"5px 10px", color:T.red+"AA", fontFamily:T.mono, fontSize:10,
              cursor:"pointer", letterSpacing:1
            }}>TRENNEN</button>
          ) : (
            <button onClick={p.onConnect} style={{
              background:p.color+"22", border:`1px solid ${p.color}66`, borderRadius:8,
              padding:"5px 12px", color:p.color, fontFamily:T.mono, fontSize:10,
              cursor:"pointer", letterSpacing:1
            }}>VERBINDEN</button>
          )}
        </div>
      ))}
      <p style={{ color:T.muted, fontSize:10, fontStyle:"italic", fontFamily:T.serif, margin:"12px 0 0", lineHeight:1.5 }}>
        Tokens liegen verschlüsselt im EYLA-Cloud-Speicher (Upstash). Du kannst jederzeit trennen — Tokens werden dann auch bei Google revoked.
      </p>
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
    {id:"woche",  icon:"≡", label:"Woche"},
    {id:"chat",   icon:"✦", label:"EYLA"},
    {id:"essen",  icon:"◈", label:"Essen"},
    {id:"profil", icon:"◉", label:"Profil"},
  ];

  const sectionColor =
    screen==="tag" ? (tagSub==="kalender" ? T.gold : T.acc) :
    screen==="woche" ? T.acc :
    screen==="chat" ? T.acc :
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
              {id:"kalender", label:"Kalender", color:T.gold},
              {id:"todo",     label:"To-do",    color:T.rose},
            ]}/>
            {tagSub==="heute"    && <TodayScreen profile={profile} setLog={setLog} logsByDate={logsByDate} events={events}/>}
            {tagSub==="kalender" && <KalenderScreen events={events} eventsLoading={eventsLoading} onRefresh={loadCalendar} profile={profile} log={log}/>}
            {tagSub==="todo"     && <TodoScreen profile={profile}/>}
          </>
        )}
        {screen==="woche" && <WeekScreen logsByDate={logsByDate} profile={profile}/>}
        {screen==="chat"  && <ChatScreen profile={profile} log={log} events={events} logsByDate={logsByDate} setLog={setLog}/>}
        {screen==="essen" && (
          <>
            <SubTabRow current={essenSub} onChange={setEssenSub} options={[
              {id:"plan",  label:"Plan",          color:T.gold},
              {id:"liste", label:"Einkaufsliste", color:T.green},
            ]}/>
            {essenSub==="plan"  && <PlanScreen profile={profile}/>}
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
