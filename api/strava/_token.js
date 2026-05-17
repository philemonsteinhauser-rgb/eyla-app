// Strava Token-Refresh
import { getRedis, tokenKey } from "../_kv.js";

export async function getStravaAccessToken(userCode) {
  const redis = getRedis();
  if (!redis) return { error: "Storage not configured" };
  const stored = await redis.get(tokenKey("strava", userCode));
  if (!stored) return { error: "not_connected" };

  if (stored.expires_at && stored.expires_at > Date.now() + 60_000) {
    return { token: stored.access_token, athlete: stored.athlete };
  }
  if (!stored.refresh_token) return { error: "no_refresh_token", needsReconnect: true };

  try {
    const r = await fetch("https://www.strava.com/api/v3/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        refresh_token: stored.refresh_token,
        grant_type: "refresh_token",
      })
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("[strava refresh] failed:", r.status, t);
      return { error: "refresh_failed", needsReconnect: true };
    }
    const j = await r.json();
    const updated = {
      ...stored,
      access_token: j.access_token,
      refresh_token: j.refresh_token || stored.refresh_token,
      expires_at: j.expires_at * 1000,
    };
    await redis.set(tokenKey("strava", userCode), updated);
    return { token: j.access_token, athlete: stored.athlete };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}
