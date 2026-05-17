// Google Calendar Events – read/list + create.
// GET  /api/google/events?from=ISO&to=ISO   → liste Events
// POST /api/google/events { title, time, date, duration } → erstellt Event
//
// Time-Format: einfache HH:MM (Berlin-Zeit), Date YYYY-MM-DD

import { getGoogleAccessToken } from "./_token.js";
import { userCodeFromReq, setCors } from "../_kv.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

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
        timeMin: from,
        timeMax: to,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "100",
      });
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: auth });
      if (!r.ok) { const t = await r.text(); return res.status(r.status).json({ error: "google_failed", detail: t.slice(0, 500) }); }
      const j = await r.json();
      // Vereinfachte Event-Liste
      const events = (j.items || []).map(ev => {
        const start = ev.start?.dateTime || ev.start?.date;
        const end   = ev.end?.dateTime   || ev.end?.date;
        const isAllDay = !!ev.start?.date && !ev.start?.dateTime;
        const dateStr = (start || "").slice(0, 10);
        const timeStr = isAllDay ? "" : (start || "").slice(11, 16);
        let durationMin = 0;
        if (start && end && !isAllDay) {
          durationMin = Math.round((new Date(end) - new Date(start)) / 60000);
        }
        return {
          id: ev.id,
          title: ev.summary || "(ohne Titel)",
          date: dateStr,
          time: timeStr,
          duration: durationMin || "",
          location: ev.location || "",
          allDay: isAllDay,
          source: "google",
          rawLink: ev.htmlLink,
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

      const startObj = time
        ? { dateTime: `${date}T${time}:00`, timeZone: "Europe/Berlin" }
        : { date }; // All-day
      const endObj = time
        ? { dateTime: `${date}T${addMinutes(time, duration)}:00`, timeZone: "Europe/Berlin" }
        : { date }; // All-day end == start für single all-day

      const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
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

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(n => parseInt(n)||0);
  const tot = h*60 + m + mins;
  const hh = String(Math.floor(tot/60) % 24).padStart(2,"0");
  const mm = String(tot % 60).padStart(2,"0");
  return `${hh}:${mm}`;
}
