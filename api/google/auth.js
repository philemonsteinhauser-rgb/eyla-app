// Startet OAuth-Flow für Google (Calendar + Gmail – gleicher Provider).
// User wird zu Google geleitet, kommt mit Code zurück → /api/google/callback.
//
// Scopes:
//   - calendar.events  → read/write Termine
//   - userinfo.email   → wir wissen welcher Account verbunden ist
//   - gmail.readonly   → optional, wird genutzt sobald Gmail-Feature an
//
// ENV nötig (in Vercel):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// Redirect-URI in Google-Cloud-Console MUSS sein:
//   https://<dein-vercel-domain>/api/google/callback

import { setCors } from "../_kv.js";

export default function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const code = String(req.query.code || "").toLowerCase().trim();
  if (!code || code.length < 3) {
    return res.status(400).json({ error: "Access-Code fehlt (?code=...)" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({
      error: "Google nicht konfiguriert",
      hint: "ENV GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in Vercel setzen"
    });
  }

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/google/callback`;

  // Scopes: Calendar (events) + Gmail-Readonly + Profile
  const scope = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",  // gibt uns refresh_token
    prompt: "consent",        // immer Consent zeigen, sonst kein refresh_token bei Re-Connect
    state: code,              // unser User-Code als State
    include_granted_scopes: "true",
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.writeHead(302, { Location: url });
  res.end();
}
