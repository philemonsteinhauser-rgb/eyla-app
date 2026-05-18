// Konsolidierter Strava-Handler — eine Function für alle Routen
// /api/strava/auth | callback | status | disconnect | activities

import { getRedis, tokenKey, userCodeFromReq, setCors } from "../_kv.js";
import { getStravaAccessToken } from "./_token.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const action = String(req.query.action || "").toLowerCase();
  switch (action) {
    case "auth":       return handleAuth(req, res);
    case "callback":   return handleCallback(req, res);
    case "status":     return handleStatus(req, res);
    case "disconnect": return handleDisconnect(req, res);
    case "activities": return handleActivities(req, res);
    default:           return res.status(404).json({ error: "unknown_action", action });
  }
}

function handleAuth(req, res) {
  const code = String(req.query.code || "").toLowerCase().trim();
  if (!code || code.length < 3) return res.status(400).json({ error: "Access-Code fehlt (?code=...)" });
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: "Strava nicht konfiguriert", hint: "ENV STRAVA_CLIENT_ID + STRAVA_CLIENT_SECRET in Vercel setzen" });

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/strava/callback`;

  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri,
    response_type: "code", approval_prompt: "auto",
    scope: "read,activity:read_all", state: code,
  });
  res.writeHead(302, { Location: `https://www.strava.com/oauth/authorize?${params.toString()}` });
  res.end();
}

async function handleCallback(req, res) {
  const { code: stravaCode, state, error } = req.query || {};
  if (error) return redirectToApp(req, res, `?app_error=strava_${encodeURIComponent(error)}`);
  if (!stravaCode || !state) return res.status(400).send("Missing code or state");
  const userCode = String(state).toLowerCase().trim();
  if (userCode.length < 3) return res.status(400).send("Invalid state");

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(503).send("Strava not configured");

  try {
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        code: stravaCode, grant_type: "authorization_code",
      })
    });
    if (!r.ok) { const t = await r.text(); console.error("[strava/callback]", r.status, t); return redirectToApp(req, res, "?app_error=strava_token_exchange"); }
    const j = await r.json();
    const redis = getRedis();
    if (!redis) return res.status(503).send("Storage not configured");
    await redis.set(tokenKey("strava", userCode), {
      provider: "strava",
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: j.expires_at * 1000,
      athlete: j.athlete ? { id: j.athlete.id, firstname: j.athlete.firstname, lastname: j.athlete.lastname, username: j.athlete.username } : null,
      connectedAt: new Date().toISOString(),
    });
    return redirectToApp(req, res, "?app_connected=strava");
  } catch (e) {
    console.error("[strava/callback] error:", e);
    return redirectToApp(req, res, "?app_error=strava_internal");
  }
}

async function handleStatus(req, res) {
  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ connected: false });
  const redis = getRedis();
  if (!redis) return res.status(503).json({ connected: false, error: "no_storage" });
  const stored = await redis.get(tokenKey("strava", code));
  if (!stored) return res.json({ connected: false });
  return res.json({
    connected: true,
    athlete: stored.athlete,
    email: stored.athlete ? `${stored.athlete.firstname||""} ${stored.athlete.lastname||""}`.trim() : null,
    connectedAt: stored.connectedAt,
  });
}

async function handleDisconnect(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });
  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ error: "no_user_code" });
  const redis = getRedis();
  if (!redis) return res.status(503).json({ error: "no_storage" });
  const stored = await redis.get(tokenKey("strava", code));
  if (stored?.access_token) {
    try { await fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { Authorization: `Bearer ${stored.access_token}` } }); } catch {}
  }
  await redis.del(tokenKey("strava", code));
  return res.json({ ok: true });
}

function mapType(t) {
  const lower = String(t||"").toLowerCase();
  if (lower.includes("run") || lower.includes("walk")) return "Cardio";
  if (lower.includes("ride") || lower.includes("bike")) return "Cardio";
  if (lower.includes("swim")) return "Schwimmen";
  if (lower.includes("yoga")) return "Yoga";
  if (lower.includes("weight") || lower.includes("crossfit") || lower.includes("workout")) return "Kraft";
  return t || "Sport";
}

async function handleActivities(req, res) {
  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ error: "no_user_code" });
  const tok = await getStravaAccessToken(code);
  if (tok.error) return res.status(tok.needsReconnect ? 401 : 503).json(tok);

  try {
    const afterDefault = Math.floor((Date.now() - 30*86400000)/1000);
    const after = req.query.after ? Math.floor(new Date(req.query.after).getTime()/1000) : afterDefault;
    const perPage = Math.min(50, parseInt(req.query.perPage) || 30);
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=${perPage}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok.token}` }});
    if (!r.ok) { const t = await r.text(); return res.status(r.status).json({ error:"strava_failed", detail:t.slice(0,500) }); }
    const arr = await r.json();
    const activities = (arr||[]).map(a => ({
      id: a.id, name: a.name,
      type: mapType(a.type || a.sport_type), sportType: a.sport_type || a.type,
      duration: Math.round((a.elapsed_time||0)/60),
      durationMoving: Math.round((a.moving_time||0)/60),
      distance: a.distance ? Math.round(a.distance/100)/10 : 0,
      calories: a.calories || 0,
      avgHeartRate: a.average_heartrate ? Math.round(a.average_heartrate) : 0,
      maxHeartRate: a.max_heartrate ? Math.round(a.max_heartrate) : 0,
      startDate: a.start_date_local,
      startTime: (a.start_date_local || "").slice(11, 16),
      date: (a.start_date_local || "").slice(0, 10),
      url: `https://www.strava.com/activities/${a.id}`,
    }));
    return res.json({ activities, athlete: tok.athlete });
  } catch (e) {
    console.error("[strava/activities] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

function redirectToApp(req, res, qs="") {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  res.writeHead(302, { Location: `${proto}://${host}/${qs}` });
  res.end();
}
