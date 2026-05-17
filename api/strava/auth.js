// Startet OAuth-Flow für Strava
// ENV nötig: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
// Redirect-URI in Strava-App-Settings:
//   https://<vercel-domain>/api/strava/callback

import { setCors } from "../_kv.js";

export default function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const code = String(req.query.code || "").toLowerCase().trim();
  if (!code || code.length < 3) {
    return res.status(400).json({ error: "Access-Code fehlt (?code=...)" });
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({
      error: "Strava nicht konfiguriert",
      hint: "ENV STRAVA_CLIENT_ID + STRAVA_CLIENT_SECRET in Vercel setzen"
    });
  }

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/strava/callback`;

  // Strava-Scopes: activity:read_all für alle Aktivitäten lesen
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    state: code,
  });

  const url = `https://www.strava.com/oauth/authorize?${params.toString()}`;
  res.writeHead(302, { Location: url });
  res.end();
}
