// Strava Activities laden + optional in EYLA-Format konvertieren
// GET /api/strava/activities?after=ISO&perPage=30

import { getStravaAccessToken } from "./_token.js";
import { userCodeFromReq, setCors } from "../_kv.js";

// Strava-Sport-Type → EYLA-Workout-Type
function mapType(t) {
  const lower = String(t||"").toLowerCase();
  if (lower.includes("run") || lower.includes("walk")) return "Cardio";
  if (lower.includes("ride") || lower.includes("bike")) return "Cardio";
  if (lower.includes("swim")) return "Schwimmen";
  if (lower.includes("yoga")) return "Yoga";
  if (lower.includes("weight") || lower.includes("crossfit") || lower.includes("workout")) return "Kraft";
  return t || "Sport";
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ error: "no_user_code" });

  const tok = await getStravaAccessToken(code);
  if (tok.error) return res.status(tok.needsReconnect ? 401 : 503).json(tok);

  try {
    // Default: letzte 30 Tage
    const afterDefault = Math.floor((Date.now() - 30*86400000)/1000);
    const after = req.query.after ? Math.floor(new Date(req.query.after).getTime()/1000) : afterDefault;
    const perPage = Math.min(50, parseInt(req.query.perPage) || 30);
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=${perPage}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok.token}` }});
    if (!r.ok) { const t = await r.text(); return res.status(r.status).json({ error:"strava_failed", detail:t.slice(0,500) }); }
    const arr = await r.json();
    const activities = (arr||[]).map(a => ({
      id: a.id,
      name: a.name,
      type: mapType(a.type || a.sport_type),
      sportType: a.sport_type || a.type,
      duration: Math.round((a.elapsed_time||0)/60), // Minuten
      durationMoving: Math.round((a.moving_time||0)/60),
      distance: a.distance ? Math.round(a.distance/100)/10 : 0, // km
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
