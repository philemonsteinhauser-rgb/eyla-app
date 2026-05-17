// Helper: Holt aktuelles Access-Token für User, refresht wenn abgelaufen.
// Wird von events.js und gmail.js benutzt.

import { getRedis, tokenKey } from "../_kv.js";

export async function getGoogleAccessToken(userCode) {
  const redis = getRedis();
  if (!redis) return { error: "Storage not configured" };
  const stored = await redis.get(tokenKey("google", userCode));
  if (!stored) return { error: "not_connected" };

  // Noch gültig (mit 60s buffer)?
  if (stored.expires_at && stored.expires_at > Date.now() + 60_000) {
    return { token: stored.access_token, email: stored.email };
  }

  // Refresh
  if (!stored.refresh_token) {
    return { error: "no_refresh_token", needsReconnect: true };
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: stored.refresh_token,
        grant_type: "refresh_token",
      })
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("[google refresh] failed:", r.status, t);
      return { error: "refresh_failed", needsReconnect: true };
    }
    const j = await r.json();
    const updated = {
      ...stored,
      access_token: j.access_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000,
    };
    await redis.set(tokenKey("google", userCode), updated);
    return { token: j.access_token, email: stored.email };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}
