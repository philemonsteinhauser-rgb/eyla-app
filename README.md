# EYLA · Zweites Gehirn

Personal-Health-Companion in React – Tageslog, Kalender, EYLA-Chat, 7-Tage-Ernährungsplan. Stack: Vite + React 19. Anthropic-API über Vercel Serverless Function.

---

## Lokal entwickeln

```bash
npm install
npm run dev          # nur Frontend – /api/chat antwortet hier nicht
```

Damit `/api/chat` lokal funktioniert, brauchst du `vercel dev`:

```bash
npm i -g vercel
vercel link          # einmalig
vercel env pull      # zieht die ENV-Variablen aus Vercel runter
vercel dev           # läuft auf http://localhost:3000
```

Alternativ `.env.local` selbst anlegen (siehe `.env.example`) und nur Frontend testen – der Chat zeigt dann "Kurze Unterbrechung." als Fallback.

---

## Auf Vercel deployen

1. Repo bei GitHub anlegen, `eyla-app` Ordner pushen
2. https://vercel.com → New Project → Repo importieren
3. Framework wird auto-erkannt als **Vite**
4. **Environment Variables** setzen:
   - `ANTHROPIC_API_KEY` = dein Key von https://console.anthropic.com/settings/keys
5. Deploy → fertig

Die Serverless Function `/api/chat` läuft automatisch.

---

## Was funktioniert / was nicht

| Feature              | Funktioniert auf Vercel? |
| -------------------- | ------------------------ |
| Profil + Onboarding  | Ja (localStorage)        |
| Tageslog (Wasser, Mahlzeiten, Energie, Schlaf) | Ja |
| EYLA-Chat            | Ja (via /api/chat)       |
| 7-Tage-Plan          | Ja (via /api/chat)       |
| Voice-Input          | Ja (Web Speech API – nur Chrome/Safari) |
| Manuelle Termine     | Ja (localStorage)        |
| Google Calendar Sync | Nicht (MCP nur in Claude-Sandbox verfügbar) |

---

## Projektstruktur

```
eyla-app/
├─ api/
│   └─ chat.js          ← Serverless Proxy zu Anthropic
├─ src/
│   ├─ App.jsx          ← komplette UI (~1000 Zeilen)
│   └─ main.jsx
├─ .env.example
├─ index.html
└─ package.json
```

---

*Version 1.0 · Stuttgart 2025*
