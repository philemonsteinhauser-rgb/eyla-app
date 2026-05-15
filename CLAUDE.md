# EYLA – Projekt-Knowledge

Diese Datei ist die Bedienungsanleitung für jeden Claude (oder Menschen), der
nach dieser Session am Projekt weiterbaut. Lies sie bevor du Code änderst.

---

## Was ist EYLA

Persönliche Health-Companion-Web-App. Eine User-Person (Phil), persönlicher
Vorab-Bereich, nicht öffentlich. Stack ist absichtlich minimal: ein einziger
React-Component-Tree in `src/App.jsx`, ein Serverless-Proxy pro Backend-
Endpoint. Kein Build-Schritt-Gefrickel, kein State-Management-Library.

EYLAs Charakter: **Synthetische Begleiterin. Ruhig. Genau.** Direkt, warm
aber nicht weich. Trocken-humorvoll. Kein Motivationsposter, kein
Optimierungs-Marathon. Grundannahme dass der Körper geschaffen ist und
die Schöpfung das Nötige bereitstellt – das wird **nicht ausgesprochen**,
ist nur ihre Haltung. Antwortet immer auf Deutsch in 2–4 Sätzen.

---

## Stack

- **Frontend**: Vite 8 + React 19, ein File `src/App.jsx` (~4000 Zeilen).
  Bewusst monolithisch – jede neue Komponente direkt da rein.
- **Backend**: 2 Serverless Functions in `api/`:
  - `api/chat.js` – Proxy zu Anthropic Messages API (`claude-sonnet-4-5`),
    leitet Tools durch.
  - `api/sync.js` – Cloud-Sync zu Upstash Redis (User-Daten per
    Access-Code key'd).
- **Hosting**: Vercel (Free/Hobby), deploys auto auf jeden `git push origin master`.
- **Storage**: localStorage als Source of Truth, Upstash Redis als Backup/Sync.
- **Anthropic Vision**: für Foto-Analyse (Mahlzeiten, Kassenbon, Chat-Bilder).

---

## File Layout

```
eyla-app/
├─ api/
│  ├─ chat.js          # POST → Anthropic, Tools-Pass-through
│  └─ sync.js          # GET/POST → Upstash, Access-Code als Key
├─ public/
│  ├─ icon-192.png, icon-512.png, icon-maskable.png, apple-touch-icon.png
│  ├─ manifest.webmanifest
│  └─ favicon.svg
├─ src/
│  ├─ App.jsx          # ALLES. Eine Datei.
│  └─ main.jsx         # React-Root, kein CSS-Import
├─ index.html          # PWA Meta + iOS Apple-Touch-Icons
├─ package.json
└─ vite.config.js
```

---

## Tab-Struktur (5 Tabs)

1. **Tag** (`◎`) – Sub-Toggle Heute / Kalender
   - Heute: Activity-Rings, Energie/Schlaf, Wasser+Gewicht, Training, Mahlzeiten, Tagebuch-Notiz
   - Kalender: Multi-Day-Navigator, Events mit Datum-Picker
2. **Woche** (`≡`) – Wochen-Insight von EYLA, Streaks, Schnittwerte, Mini-Charts, Tagesliste
3. **EYLA** (`✦`) – Chat mit Tool-Use, Foto-Upload, Voice In/Out
4. **Essen** (`◈`) – Sub-Toggle Plan / Einkaufsliste
   - Plan: 7-Tage, einzelne Mahlzeit swappbar
   - Liste: Store-Picker, Aus-Plan-Generieren, Kassenbon-Scan, eigene Items
5. **Profil** (`◉`) – Daten, Diät-Ziele, Gewichts-Verlauf, Streak-Rekorde, Backup/Reset

---

## Storage Schema (localStorage)

Alle Keys mit Prefix `eyla_`. Werte sind JSON-encoded.

| Key | Inhalt |
|---|---|
| `eyla_profile_v3` | `{name, sex, age, weight, height, goal[], activity, preferences[], intolerances[], apps[], goalType, targetWeight, targetWeeks}` |
| `eyla_logs_v1` | Date-Map: `{"Thu May 14 2026": {meals[], water, energy, sleep, workouts[], weight, note, date}, ...}` |
| `eyla_local_events_v2` | Event-Array: `[{id, title, time, duration, date:YYYY-MM-DD, local}, ...]` |
| `eyla_shopping_v1` | `{storeId, store, aisles[], checked: {key: bool}}` (key = `aisleName + "::" + itemName`) |
| `eyla_plan_v1` | `{days[{day, breakfast, lunch, dinner, snack, tip}], intro, savedAt}` |
| `eyla_chat_v1` | Message-Array: `[{role, content, actions?, _imageUrl?, _hadImage?}, ...]` |
| `eyla_chat_voice_v1` | Boolean (TTS on/off) |
| `eyla_week_insight_v1` | `{hash, text, createdAt}` (cached) |
| `eyla_access_granted_v1` | Boolean (Passcode geknackt) |
| `eyla_access_code_v1` | String (lowercased Access-Code, User-Identifier für Sync) |
| `eyla_cloud_sync_disabled_v1` | Boolean (Sync ausschalten) |

`persist(key, value)` schreibt nach localStorage und triggert Cloud-Sync
(debounced 800ms) für alle eyla_* Keys außer `_access_*` und `_cloud_sync_disabled_*`.

`retrieve(key, fallback)` liest und parsed.

---

## Cloud-Sync

- **Endpoint**: `/api/sync` (GET/POST)
- **Identifier**: `x-eyla-code` Header = User's Access-Code (lowercased)
- **Storage**: Upstash Redis, Key `eyla:<code>`, Value = JSON aller SYNC_KEYS + `updatedAt`
- **Push**: `scheduleSyncUp()` debounced 800ms. Flush bei `visibilitychange/pagehide/beforeunload`.
- **Pull**: `pullCloudIntoLocal()` beim Boot/Unlock.
- **Schutz**: Chat wird NICHT überschrieben wenn local mehr Messages hat (sonst gehen
  Nachrichten verloren wenn iOS PWA schließt bevor Sync flushed).
- **Status-Indikator**: Top-Bar zeigt `↑ sync` (ok), `↻ sync` (laufend), `× sync` (off), `! sync` (error).

---

## Design-System

Theme-Object `T` ganz oben in App.jsx. **Niemals** hardcoded Farben, immer T.* nutzen.

```js
const T = {
  bg: "#050A14",           // page background
  bg2: "#090F1C",          // input/control bg
  card: "#0D1525",         // card bg
  border: "#00E5FF14",     // subtle 8% border
  borderS: "#00E5FF28",    // stronger 16%
  acc: "#00E5FF",          // cyan – primary accent
  bright: "#38D9F5",
  dim: "#0891B2",
  gold: "#EAAB00",         // gold – plan, manuell, gewichts-ziel
  goldL: "#FFB800",
  rose: "#818CF8",         // rose/violet – fish/fleisch, protein
  text: "#F0F9FF",         // primary text
  mid: "#7DD3FC",          // secondary text, italic
  muted: "#B0BEC5",        // tertiary text, labels
  faint: "#1E293B",        // dividers, faint bg
  green: "#34D399",
  red: "#F87171",
  serif: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  mono: "'Courier New', Courier, monospace",
  sans: "'Trebuchet MS', 'Gill Sans', sans-serif"
};
```

**Typografie-Hierarchie:**
- Header h2: 20px, weight 300, color T.text
- Body: 13-14px, Palatino serif, italic für „Stimme" oder Subtilität
- Mini-Label: 10px Courier mono mit letterSpacing 2.5 (Komponente `<Lbl>`)
- Zahlen: Courier mono

**Komponenten** (alle in App.jsx):
- `<Card>` – mit optional `accent` (cyan border + glow), `gold` (gold border)
- `<Lbl>` – Mini-Label all-caps mono, props: `color`, `style`
- `<EylaOrb>` – Animierte Logo-Kugel, props: `size`, `thinking`, `listening`
- `<Waveform>` – Listening/Loading-Wellen
- `<VoiceBtn>` – Mic/Stop-Toggle
- `<SubTabRow>` – Tab-im-Tab-Toggle (Heute/Kalender, Plan/Liste)
- `<ActivityRings>` – 3 konzentrische SVG-Ringe
- `<MealRow>` – Mahlzeit-Zeile mit Tap-to-Edit

**Layout-Regeln:**
- maxWidth Content: 760px, zentriert
- Safe-Area-Insets sind eingebaut (iPhone-Notch + Home-Indicator)
- Bottom-Nav fixed unten, Section-Color tönt Top-Bar-Border
- Cards: padding 14-18px / 16-22px, borderRadius 14
- Spacing: gap 6/8/10/12px für inline, marginBottom 10/12/14/18 für Karten

---

## EYLA Chat – Tools System

EYLA kann über die Anthropic Tool-Use API direkt Daten ändern. Tools sind
in der Konstante `EYLA_TOOLS` definiert. Frontend führt sie lokal aus,
sendet `tool_result` zurück, EYLA antwortet weiter.

| Tool | Wirkt auf |
|---|---|
| `add_meal(name, calories, protein?, carbs?, fat?)` | log.meals |
| `set_water(glasses)` / `add_water(delta)` | log.water |
| `set_sleep(hours)` | log.sleep |
| `set_energy(mood)` | log.energy |
| `set_weight(kg)` | log.weight |
| `add_workout(type, duration, intensity?)` | log.workouts |
| `add_event(title, time?, duration?, date?)` | eyla_local_events_v2 |
| `add_shopping_item(name, menge, gang)` | eyla_shopping_v1.aisles |
| `check_shopping_item(name)` | eyla_shopping_v1.checked |

Tool-Loop läuft max 5 Runden. Aktionen werden inline unter EYLAs Antwort
als grüne `✓ <text>`-Zeilen angezeigt.

---

## Foto / Vision Funktionen

Drei Stellen mit Claude-Vision:
1. **Heute → Mahlzeit per Foto**: 📷-Button im Mahlzeit-Input, gibt zurück
   NAME/KCAL/PROTEIN/CARBS/FAT (5 Zeilen).
2. **Chat → Foto anhängen**: 📷-Button im Chat-Input, EYLA sieht das Bild
   und kann mit Tools darauf reagieren.
3. **Liste → Kassenbon scannen**: Vision extrahiert Items, fuzzy-matcht
   gegen offene Listen-Items, User bestätigt im Preview.

Bilder werden client-seitig auf 1024px (Mahlzeit/Chat) bzw. 1400px
(Kassenbon) skaliert und als JPEG q82-85 gesendet.

---

## Diät-Logik

`calorieTarget(profile)`:
- BMR per Mifflin-St-Jeor: 10*kg + 6.25*cm - 5*age + Sex-Konstante (m:+5, f:-161, d:-78)
- TDEE: +400 Aktivitäts-Offset
- Halten: target = TDEE
- Abnehmen: target = TDEE - daily_def (max 1000 kcal Defizit, min 1200 absolut)
- Aufbauen: target = TDEE + daily_surplus (max 500 kcal Überschuss)

`macroTarget(profile)`:
- Protein: 1.4 g/kg (halten), 1.8 (abnehmen), 2.0 (aufbauen)
- Fett: 28% der Kalorien
- Carbs: Rest

---

## Plan-Generator

System-Prompt-Basis: Mediterran, Whole-Foods (NOVA 1+2), Leucin-Schwelle,
Ballaststoffe, Pflanzenvielfalt, Time-Restricted-Eating bei Abnehmen.
**Drei Hauptmahlzeiten** (F/M/A) sind PFLICHT, niemals leer. Snack
optional. Bei Aufbauen: 4-5 Mahlzeiten.

Response-Format strikt:
```
INTRO: <2-3 Sätze>

TAG: Montag
FRUEHSTUECK: <Mahlzeit (~XXX kcal)>
MITTAG: <Mahlzeit (~XXX kcal)>
ABEND: <Mahlzeit (~XXX kcal)>
SNACK: <Snack oder ->
TIPP: <Hinweis>
```

Parser splittet auf `^[\s*#_>-]*TAG:\s*` (multiline, mit Markdown-Toleranz),
fallback auf Wochentag-Namen. Einzelne Mahlzeit kann per `↻`-Button neu
generiert werden – schickt Day-Kontext + Slot an Claude, erwartet eine
Zeile `<Mahlzeit> (~XXX kcal)`.

---

## Bekannte Eigenheiten / Gotchas

- **iOS PWA Storage**: Safari und Home-Screen-App haben getrennten localStorage.
  Daten in Safari sind nicht in der PWA. Cloud-Sync löst das.
- **iOS Eviction**: iOS löscht PWA-localStorage nach ~7 Tagen Inaktivität.
  Cloud-Sync + `navigator.storage.persist()` minimieren das Risiko.
- **iOS SpeechSynthesis**: Pausiert sich nach ~15s. Resume-Loop alle 4s wenn speaking.
  Voices laden async via voiceschanged-Event. Erstes speak() braucht User-Gesture-Unlock.
- **Web Speech API SpeechRecognition**: Mit `continuous=true + interimResults=true`,
  finales Transkript wird in onend ausgeliefert – funktioniert für Auto-Stop UND User-Stop.
- **localStorage 5MB Limit**: Chat-Bilder werden gestrippt vor Persist
  (nur Text + `[Foto]`-Marker bleibt).
- **Passcode-Gate**: `VITE_ACCESS_CODE` in Vercel-ENV, lowercased Compare.
  Soft-Gate – nicht Krypto-sicher (DevTools können Bundle inspizieren).
- **Tool-Use Loop**: Max 5 Runden Safety-Limit, sonst Endlosschleife möglich.

---

## Roadmap / Nicht gebaut

- Recurring Termine (jeden Mittwoch …)
- Termin editieren (aktuell nur löschen)
- Receipt-Foto für Belege/Quittungen außer Lebensmittel
- Apple Health / Google Fit Integration
- Mehrere User pro Code (Family-Share)
- Echte Google Calendar Sync via OAuth (MCP-Variante war nur in Claude-Sandbox)
- Backup-Auto-Schedule (täglicher Cloud-Snapshot mit Versionierung)
- Push-Notifications (Wasser-Reminder)

---

## Konventionen

- **Commit-Messages**: Deutsch, beschreibend, mit Liste was geändert.
  Format: `<Bereich>: <Was> + ggf weitere Sachen`
- **Theme**: Niemals hardcoded Farben, nur T.* Werte
- **Komponenten**: Inline in App.jsx, keine eigenen Files
- **Storage**: Versioniert via `_v1`/`_v2` Suffix. Bei Schema-Bruch neuen Suffix + Migration
- **Tasks**: Bei nicht-trivialen Änderungen TaskCreate vor Beginn, Update bei Done
- **EYLA-Anrede im UI**: „EYLA" nie „Eyla" oder „eyla"
- **User wird mit „du" angeredet**, nie „Sie"

---

## Setup für neue Entwickler

```bash
git clone https://github.com/philemonsteinhauser-rgb/eyla-app.git
cd eyla-app
npm install
npm run dev   # http://localhost:5173
```

Für `/api/*` lokal:
```bash
npm i -g vercel
vercel link
vercel env pull
vercel dev    # http://localhost:3000
```

Setup-Voraussetzungen in Vercel:
- ENV `ANTHROPIC_API_KEY` (für /api/chat)
- ENV `VITE_ACCESS_CODE` (Soft-Gate-Passcode)
- Storage → Upstash Redis verbunden (für /api/sync)
