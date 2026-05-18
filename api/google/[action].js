// Konsolidierter Google-Handler — eine Function für alle Routen.
// Vercel-Hobby-Plan erlaubt max 12 Functions, daher Bundling per Dynamic-Route.
// /api/google/auth        → action="auth"        – startet OAuth-Redirect
// /api/google/callback    → action="callback"    – tauscht Code gegen Tokens
// /api/google/status      → action="status"      – Connection-Status
// /api/google/disconnect  → action="disconnect"  – Token löschen + revoken
// /api/google/events      → action="events"      – Calendar lesen/schreiben
// /api/google/gmail       → action="gmail"       – Gmail-Inbox lesen

import { getRedis, tokenKey, userCodeFromReq, setCors } from "../../lib/kv.js";
import { getGoogleAccessToken } from "../../lib/google-token.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query.action || "").toLowerCase();

  switch (action) {
    case "auth":       return handleAuth(req, res);
    case "callback":   return handleCallback(req, res);
    case "status":     return handleStatus(req, res);
    case "disconnect": return handleDisconnect(req, res);
    case "events":     return handleEvents(req, res);
    case "gmail":      return handleGmail(req, res);
    default:
      return res.status(404).json({ error: "unknown_action", action });
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function handleAuth(req, res) {
  const code = String(req.query.code || "").toLowerCase().trim();
  if (!code || code.length < 3) return res.status(400).json({ error: "Access-Code fehlt (?code=...)" });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: "Google nicht konfiguriert", hint: "ENV GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in Vercel setzen" });

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/google/callback`;

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
    access_type: "offline",
    prompt: "consent",
    state: code,
    include_granted_scopes: "true",
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.writeHead(302, { Location: url });
  res.end();
}

// ─── CALLBACK ─────────────────────────────────────────────────────────────────
async function handleCallback(req, res) {
  const { code: googleCode, state, error } = req.query || {};
  if (error)        return redirectToApp(req, res, `?app_error=google_${encodeURIComponent(error)}`);
  if (!googleCode || !state) return res.status(400).send("Missing code or state");

  const userCode = String(state).toLowerCase().trim();
  if (userCode.length < 3) return res.status(400).send("Invalid state");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(503).send("Google not configured");

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/google/callback`;

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: googleCode, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: "authorization_code",
      })
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error("[google/callback] token exchange failed:", tokenRes.status, t);
      return redirectToApp(req, res, "?app_error=google_token_exchange");
    }
    const tokens = await tokenRes.json();

    let email = "";
    try {
      const uRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      if (uRes.ok) { const u = await uRes.json(); email = u.email || ""; }
    } catch {}

    const redis = getRedis();
    if (!redis) return res.status(503).send("Storage not configured");

    await redis.set(tokenKey("google", userCode), {
      provider: "google",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
      scope: tokens.scope,
      email,
      connectedAt: new Date().toISOString(),
    });
    return redirectToApp(req, res, "?app_connected=google");
  } catch (e) {
    console.error("[google/callback] error:", e);
    return redirectToApp(req, res, "?app_error=google_internal");
  }
}

// ─── STATUS ───────────────────────────────────────────────────────────────────
async function handleStatus(req, res) {
  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ connected: false, error: "no_user_code" });
  const redis = getRedis();
  if (!redis) return res.status(503).json({ connected: false, error: "no_storage" });
  const stored = await redis.get(tokenKey("google", code));
  if (!stored) return res.json({ connected: false });
  return res.json({
    connected: true,
    email: stored.email || null,
    connectedAt: stored.connectedAt || null,
    hasRefresh: !!stored.refresh_token,
  });
}

// ─── DISCONNECT ───────────────────────────────────────────────────────────────
async function handleDisconnect(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });
  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ error: "no_user_code" });
  const redis = getRedis();
  if (!redis) return res.status(503).json({ error: "no_storage" });
  const stored = await redis.get(tokenKey("google", code));
  if (stored?.access_token) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${stored.access_token}`, { method: "POST" }); } catch {}
  }
  await redis.del(tokenKey("google", code));
  return res.json({ ok: true });
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
async function handleEvents(req, res) {
  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ error: "no_user_code" });
  const tok = await getGoogleAccessToken(code);
  if (tok.error) return res.status(tok.needsReconnect ? 401 : 503).json(tok);
  const auth = { Authorization: `Bearer ${tok.token}` };

  try {
    if (req.method === "GET") {
      const from = req.query.from || new Date().toISOString();
      const to   = req.query.to   || new Date(Date.now() + 30*86400000).toISOString();
      const params = new URLSearchParams({
        timeMin: from, timeMax: to, singleEvents: "true", orderBy: "startTime", maxResults: "100",
      });
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: auth });
      if (!r.ok) { const t = await r.text(); return res.status(r.status).json({ error: "google_failed", detail: t.slice(0, 500) }); }
      const j = await r.json();
      const events = (j.items || []).map(ev => {
        const start = ev.start?.dateTime || ev.start?.date;
        const end   = ev.end?.dateTime   || ev.end?.date;
        const isAllDay = !!ev.start?.date && !ev.start?.dateTime;
        const dateStr = (start || "").slice(0, 10);
        const timeStr = isAllDay ? "" : (start || "").slice(11, 16);
        let durationMin = 0;
        if (start && end && !isAllDay) durationMin = Math.round((new Date(end) - new Date(start)) / 60000);
        return {
          id: ev.id, title: ev.summary || "(ohne Titel)",
          date: dateStr, time: timeStr, duration: durationMin || "",
          location: ev.location || "", allDay: isAllDay,
          source: "google", rawLink: ev.htmlLink,
        };
      });
      return res.json({ events });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const title = String(body?.title || "").trim();
      const date  = String(body?.date  || new Date().toISOString().slice(0,10));
      const time  = String(body?.time  || "");
      const duration = parseInt(body?.duration) || 60;
      if (!title) return res.status(400).json({ error: "title fehlt" });
      const startObj = time ? { dateTime: `${date}T${time}:00`, timeZone: "Europe/Berlin" } : { date };
      const endObj   = time ? { dateTime: `${date}T${addMinutes(time, duration)}:00`, timeZone: "Europe/Berlin" } : { date };
      const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ summary: title, start: startObj, end: endObj }),
      });
      if (!r.ok) { const t = await r.text(); return res.status(r.status).json({ error: "google_create_failed", detail: t.slice(0,500) }); }
      const j = await r.json();
      return res.json({ ok: true, id: j.id, htmlLink: j.htmlLink });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[google/events] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

// ─── GMAIL ────────────────────────────────────────────────────────────────────
async function handleGmail(req, res) {
  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ error: "no_user_code" });
  const tok = await getGoogleAccessToken(code);
  if (tok.error) return res.status(tok.needsReconnect ? 401 : 503).json(tok);
  const auth = { Authorization: `Bearer ${tok.token}` };
  const query = String(req.query.query || "in:inbox is:unread").trim();
  const max = Math.min(30, parseInt(req.query.max) || 10);

  try {
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max}`;
    const listRes = await fetch(listUrl, { headers: auth });
    if (!listRes.ok) {
      const t = await listRes.text();
      return res.status(listRes.status).json({ error: "gmail_list_failed", detail: t.slice(0,400) });
    }
    const listJson = await listRes.json();
    const ids = (listJson.messages || []).map(m => m.id);
    if (ids.length === 0) return res.json({ messages: [], total: 0 });

    const msgs = await Promise.all(ids.map(async (id) => {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: auth });
      if (!r.ok) return null;
      const j = await r.json();
      const headers = (j.payload?.headers || []).reduce((acc, h) => { acc[h.name.toLowerCase()] = h.value; return acc; }, {});
      return {
        id: j.id, threadId: j.threadId,
        from: headers["from"] || "", subject: headers["subject"] || "(ohne Betreff)",
        snippet: j.snippet || "", date: headers["date"] || "",
        labels: j.labelIds || [], isUnread: (j.labelIds || []).includes("UNREAD"),
        link: `https://mail.google.com/mail/u/0/#inbox/${j.id}`,
      };
    }));
    return res.json({ messages: msgs.filter(Boolean), total: msgs.length });
  } catch (e) {
    console.error("[google/gmail] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function redirectToApp(req, res, qs = "") {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  res.writeHead(302, { Location: `${proto}://${host}/${qs}` });
  res.end();
}
function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(n => parseInt(n)||0);
  const tot = h*60 + m + mins;
  return `${String(Math.floor(tot/60) % 24).padStart(2,"0")}:${String(tot % 60).padStart(2,"0")}`;
}
