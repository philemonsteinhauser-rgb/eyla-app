# EYLA Integrations Setup

Damit Google Calendar, Gmail und Strava funktionieren, brauchst du:
1. Apps bei Google + Strava registrieren
2. Client-IDs und Secrets bekommen
3. Diese als ENV-Variables in Vercel hinterlegen
4. Redirect-URIs konfigurieren

Pro Provider ~10 Minuten Klickerei. Du machst das einmal, dann funktioniert's für immer.

---

## 1. Google (Calendar + Gmail in einem)

### Google Cloud Console
1. https://console.cloud.google.com/ öffnen
2. Neues Projekt erstellen (z.B. "EYLA")
3. **APIs aktivieren** unter "APIs & Services → Library":
   - "Google Calendar API"
   - "Gmail API"
4. **OAuth Consent Screen** einrichten ("APIs & Services → OAuth consent screen"):
   - User Type: **External**
   - App-Name: "EYLA"
   - User support email: deine
   - Scopes: hinzufügen
     - `.../auth/calendar.events`
     - `.../auth/gmail.readonly`
     - `.../auth/userinfo.email`
     - `openid`
   - Test users: deine eigene Email hinzufügen (sonst wirst du nicht zugelassen solange App im "Testing"-Modus ist)
5. **Credentials** erstellen ("APIs & Services → Credentials → Create Credentials → OAuth Client ID"):
   - Application type: **Web application**
   - Name: "EYLA Web"
   - Authorized redirect URIs:
     ```
     https://<deine-domain>.vercel.app/api/google/callback
     ```
     (mehrere wenn du verschiedene Vercel-Branches hast – auch Preview-URLs falls du da testest)
6. Du bekommst **Client ID** + **Client Secret** — beides kopieren.

### In Vercel ENV setzen
Settings → Environment Variables:
```
GOOGLE_CLIENT_ID     = <dein client_id aus Schritt 6>
GOOGLE_CLIENT_SECRET = <dein client_secret aus Schritt 6>
```
Für Production + Preview + Development setzen.

### Testen
- Deploy abwarten
- EYLA → Profil → Verbundene Apps → "Google Calendar" Verbinden
- Wird zu Google geleitet, Consent geben, kommt zurück → "✓ verbunden"
- Auf Kalender-Tab: Google-Termine erscheinen automatisch
- Chat: "trag morgen 10 Uhr Friseur ein" → landet in Google Calendar UND lokal

---

## 2. Strava

### Strava-App registrieren
1. https://www.strava.com/settings/api öffnen (eingeloggt)
2. "Create & Manage Your App" → Create New App
3. Felder:
   - Application Name: "EYLA"
   - Category: "Other" oder "Visualizer"
   - Club: leer
   - Website: `https://<deine-vercel-domain>.vercel.app`
   - Authorization Callback Domain: nur die Domain **ohne** `https://`, z.B. `eyla-app.vercel.app`
4. App-Icon hochladen (optional, ist Strava-Pflicht für public, für dich alleine egal)
5. Du bekommst **Client ID** + **Client Secret**

### In Vercel ENV setzen
```
STRAVA_CLIENT_ID     = <deine client_id>
STRAVA_CLIENT_SECRET = <dein client_secret>
```

### Testen
- Profil → Verbundene Apps → Strava Verbinden
- Strava-OAuth → Zustimmen → "✓ verbunden"
- Auf Heute: nächstes Mal wenn du den Tab öffnest, werden Aktivitäten von heute automatisch synced
- Chat: "sync mein training" → `sync_strava_today` Tool zieht aktuelle Activities

---

## 3. Gmail
Nutzt den **gleichen Google-OAuth** wie Calendar — wenn du Schritt 1 durchhast und das Gmail-Scope dabei war, ist Gmail automatisch verbunden.

Im Chat: "was kam heute rein?" oder "letzte 5 mails von linkedin" → `read_recent_emails` Tool.

Wichtig: Wenn du Google schon vor diesem Update verbunden hattest, musst du einmal trennen + neu verbinden damit das Gmail-Scope dazukommt.

---

## 4. Sicherheit / Datenschutz
- **Tokens** liegen verschlüsselt in Upstash Redis (gleicher Storage wie Cloud-Sync)
- **Pro User** = pro Access-Code separat
- **Trennen** im Profil revoked auch beim Provider (Google `oauth2/revoke`, Strava `oauth/deauthorize`)
- Wenn du dein App-Bundle inspizieren würdest: keine Tokens im Frontend, nur User-Code

## 5. Was passiert wenn nicht konfiguriert?
- ENV fehlt → "Verbinden"-Button gibt 503 mit Hinweis welches ENV fehlt
- Provider gibt Fehler → Frontend zeigt Toast mit Fehler-Code
- Token abgelaufen → automatisch refresh via refresh_token
- refresh_token verloren (User hat App in Google revoked) → nächster API-Call gibt `needsReconnect: true` zurück

## 6. Vercel Function Limits (Hobby-Plan)
- 100GB-Hours/Monat — für persönliche Nutzung weit drunter
- 10s Timeout pro Function — alle unsere Functions <1s
- 12 Functions max — wir haben ~12 (api/_kv.js zählt nicht, /api/google/_token.js auch nicht da Helper)

## 7. Token-Cleanup im Notfall
Wenn was hängt, im Upstash Console direkt löschen:
- Key: `tokens:google:<dein-code>`
- Key: `tokens:strava:<dein-code>`
