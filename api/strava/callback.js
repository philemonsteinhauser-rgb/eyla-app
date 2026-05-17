// Strava OAuth Callback
import { getRedis, tokenKey } from "../_kv.js";

export default async function handler(req, res) {
  const { code: stravaCode, state, error } = req.query || {};
  if (error) return redirectToApp(req, res, `?app_error=strava_${encodeURIComponent(error)}`);
  if (!stravaCode || !state) return res.status(400).send("Missing code or state");

  const userCode = String(state).toLowerCase().trim();
  if (userCode.length < 3) return res.status(400).send("Invalid state");

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(503).send("Strava not configured");

  try {
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        code: stravaCode, grant_type: "authorization_code"
      })
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error("[strava/callback] token exchange failed:", tokenRes.status, t);
      return redirectToApp(req, res, "?app_error=strava_token_exchange");
    }
    const j = await tokenRes.json();
    // j enthält: token_type, expires_at (Unix), expires_in, refresh_token, access_token, athlete

    const redis = getRedis();
    if (!redis) return res.status(503).send("Storage not configured");

    const stored = {
      provider: "strava",
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at * 1000, // Strava gibt Unix-Sekunden
      athlete: j.athlete ? {
        id: j.athlete.id,
        firstname: j.athlete.firstname,
        lastname: j.athlete.lastname,
        username: j.athlete.username,
      } : null,
      connectedAt: new Date().toISOString(),
    };
    await redis.set(tokenKey("strava", userCode), stored);
    return redirectToApp(req, res, "?app_connected=strava");
  } catch (e) {
    console.error("[strava/callback] error:", e);
    return redirectToApp(req, res, "?app_error=strava_internal");
  }
}

function redirectToApp(req, res, qs="") {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `${proto}://${host}/${qs}`;
  res.writeHead(302, { Location: url });
  res.end();
}
