# Push-Notifications Setup

Damit EYLA dir Reminder schicken kann **auch wenn die App zu ist**, brauchst du:

## 1. VAPID-Keys generieren (lokal, einmal)

```bash
npx web-push generate-vapid-keys
```

Gibt aus:
```
Public Key: BNxxxx...
Private Key: xxxx...
```

## 2. ENV-Variables in Vercel setzen

Vercel → Project → Settings → Environment Variables, für Production+Preview+Development setzen:

```
VAPID_PUBLIC_KEY     = <Public Key aus Schritt 1>
VAPID_PRIVATE_KEY    = <Private Key aus Schritt 1>
VAPID_EMAIL          = mailto:deine@email.de
PUSH_CRON_SECRET     = <ein zufälliger Long-String, z.B. openssl rand -hex 32>
```

## 3. Cron-Job einrichten (extern, weil Vercel Hobby max 2/Tag erlaubt)

**Empfohlen: [cron-job.org](https://cron-job.org)** (kostenlos)

1. Account erstellen
2. „Create Cron Job"
3. URL: `https://eyla-app.vercel.app/api/push?action=trigger-reminders`
4. Schedule: alle **15 Minuten** (Mindest-Intervall, deckt alle Reminder-Zeiten ab)
5. Method: `POST`
6. Custom HTTP Headers:
   ```
   x-cron-secret: <dein PUSH_CRON_SECRET>
   ```
7. Aktivieren

**Alternative:** [GitHub Actions Cron](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule) wenn du das lieber hast.

## 4. In der App aktivieren

1. EYLA-App im Browser öffnen
2. **Wichtig auf iOS:** Als PWA installieren (Safari → Teilen → „Zum Home-Bildschirm"). Push funktioniert auf iOS nur im PWA-Modus seit iOS 16.4.
3. Profil → „PUSH-NOTIFICATIONS" → ✦ Aktivieren
4. Permission erteilen
5. „TEST" tippen — Test-Notification kommt sofort

## Wie das funktioniert

```
EYLA-App                                Cron-Job (cron-job.org)
   │                                         │
   │   subscribe()                           │ alle 15min
   │ ─────────────────► /api/push            │ ─────────────►
   │                    └── Upstash          │                /api/push?action=trigger-reminders
   │                                         │                └── prüft alle User
   │                                         │                └── sendet Push wenn Reminder-Zeit erreicht
   │                                         │                └── via web-push lib
   │                                         │                       │
   │ ◄──────────── Push-Server (Mozilla/Apple/Google) ◄──────────────│
   │
   │  Service Worker zeigt Notification
   │  (auch wenn App zu)
```

## Privacy

- Push-Subscriptions liegen in Upstash Redis (gleicher Storage wie Cloud-Sync)
- Pro User-Code separate Subscriptions, max 5 Devices
- Trennen löscht Subscription bei dir UND beim Push-Server
- Cron-Secret schützt davor dass jemand Random Pushes triggern kann

## Troubleshooting

**„VAPID-Key fehlt im Backend"** → ENV-Variables nicht gesetzt oder Vercel-Deploy mit alten ENVs. Redeploy nach ENV-Änderung.

**Push kommt nicht** → 
- Browser-Permission gecheckt?
- iOS: App wirklich vom Home Screen aus geöffnet, nicht Safari?
- Cron-Job läuft? Im Dashboard prüfen ob letzte Runs erfolgreich.
- ENV-Logs in Vercel Functions checken (`/api/push?action=trigger-reminders` 200?)

**„Endpoint expired"** → Wenn ein Browser die Subscription invalidiert (z.B. User hat Permission entzogen), wird sie beim nächsten Cron-Run automatisch aus Upstash gelöscht.
