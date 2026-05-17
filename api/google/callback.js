// OAuth-Callback von Google: Code → Token-Tausch → in Redis speichern.
// State enthält unseren User-Code. Nach Erfolg: Redirect zurück zur App.

import { getRedis, tokenKey } from "../_kv.js";

export default async function handler(req, res) {
  const { code: googleCode, state, error } = req.query || {};

  if (error) {
    return redirectToApp(req, res, `?app_error=google_${encodeURIComponent(error)}`);
  }
  if (!googleCode || !state) {
    return res.status(400).send("Missing code or state");
  }

  const userCode = String(state).toLowerCase().trim();
  if (userCode.length < 3) return res.status(400).send("Invalid state");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(503).send("Google not configured");
  }

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/google/callback`;

  try {
    // Code → Tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: googleCode,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      })
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error("[google/callback] token exchange failed:", tokenRes.status, t);
      return redirectToApp(req, res, "?app_error=google_token_exchange");
    }
    const tokens = await tokenRes.json();
    // tokens enthält: access_token, expires_in, refresh_token, scope, token_type, id_token

    // Email aus userinfo holen für Status-Anzeige
    let email = "";
    try {
      const uRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      if (uRes.ok) { const u = await uRes.json(); email = u.email || ""; }
    } catch {}

    const redis = getRedis();
    if (!redis) return res.status(503).send("Storage not configured");

    const stored = {
      provider: "google",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, // wichtig für späteren Refresh
      expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
      scope: tokens.scope,
      email,
      connectedAt: new Date().toISOString(),
    };

    await redis.set(tokenKey("google", userCode), stored);

    return redirectToApp(req, res, "?app_connected=google");
  } catch (e) {
    console.error("[google/callback] error:", e);
    return redirectToApp(req, res, "?app_error=google_internal");
  }
}

function redirectToApp(req, res, qs = "") {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `${proto}://${host}/${qs}`;
  res.writeHead(302, { Location: url });
  res.end();
}
