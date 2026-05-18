// Push-Notifications-Endpoint mit Action-Dispatch (1 Vercel Function für alles)
//
// /api/push?action=public-key            → GET  → VAPID public key
// /api/push?action=subscribe             → POST → Subscription speichern
// /api/push?action=unsubscribe           → POST → Subscription löschen
// /api/push?action=test                  → POST → Test-Push an User
// /api/push?action=trigger-reminders     → POST → Cron-Endpoint (externer Trigger)
//   - prüft alle Subscriptions ob ein Reminder fällig ist (basierend auf User-Profil)
//   - schickt Push-Notifications via web-push
//
// ENV nötig:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (per `npx web-push generate-vapid-keys`)
//   VAPID_EMAIL (mailto:dein@email.de)
//   KV_REST_API_URL/_TOKEN oder UPSTASH_REDIS_REST_URL/_TOKEN (haben wir)
//   PUSH_CRON_SECRET (optional, schützt trigger-reminders vor unbefugtem Aufruf)

import { Redis } from "@upstash/redis";
import webpush from "web-push";

function getRedis() {
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}
function configureVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL || "mailto:noreply@eyla.app";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(email, pub, priv);
  return true;
}
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-eyla-code, x-cron-secret");
}
function userCode(req) {
  return String(req.headers["x-eyla-code"] || "").toLowerCase().trim();
}
function subsKey(code) { return `push:subs:${code}`; }
function profKey(code) { return `eyla:${code}`; }  // Sync-Daten (enthält profile)

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query.action || "").toLowerCase();

  // GET public-key
  if (action === "public-key") {
    const pub = process.env.VAPID_PUBLIC_KEY;
    if (!pub) return res.status(503).json({ error: "VAPID_PUBLIC_KEY fehlt in ENV" });
    return res.json({ key: pub });
  }

  const redis = getRedis();
  if (!redis) return res.status(503).json({ error: "Storage nicht konfiguriert" });

  // SUBSCRIBE
  if (action === "subscribe") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST nötig" });
    const code = userCode(req);
    if (!code) return res.status(401).json({ error: "x-eyla-code header fehlt" });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const sub = body?.subscription;
    if (!sub?.endpoint) return res.status(400).json({ error: "subscription.endpoint fehlt" });
    // Pro User max 5 Devices
    let arr = (await redis.get(subsKey(code))) || [];
    if (!Array.isArray(arr)) arr = [];
    arr = arr.filter(s => s.endpoint !== sub.endpoint).slice(-4);
    arr.push({ ...sub, subscribedAt: new Date().toISOString() });
    await redis.set(subsKey(code), arr);
    // Auch in global-index für Cron
    await redis.sadd("push:active_codes", code);
    return res.json({ ok: true, devices: arr.length });
  }

  // UNSUBSCRIBE
  if (action === "unsubscribe") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST nötig" });
    const code = userCode(req);
    if (!code) return res.status(401).json({ error: "x-eyla-code header fehlt" });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const endpoint = body?.endpoint;
    let arr = (await redis.get(subsKey(code))) || [];
    if (!Array.isArray(arr)) arr = [];
    if (endpoint) arr = arr.filter(s => s.endpoint !== endpoint);
    else arr = [];
    if (arr.length > 0) await redis.set(subsKey(code), arr);
    else { await redis.del(subsKey(code)); await redis.srem("push:active_codes", code); }
    return res.json({ ok: true, remaining: arr.length });
  }

  // TEST
  if (action === "test") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST nötig" });
    if (!configureVapid()) return res.status(503).json({ error: "VAPID-Keys fehlen in ENV" });
    const code = userCode(req);
    if (!code) return res.status(401).json({ error: "x-eyla-code header fehlt" });
    const subs = (await redis.get(subsKey(code))) || [];
    if (subs.length === 0) return res.status(404).json({ error: "Keine Subscription für diesen User" });
    let ok = 0, failed = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, JSON.stringify({
          title: "EYLA · Test ✦",
          body: "Push funktioniert. Du bekommst Reminder auch wenn die App zu ist.",
          tag: "eyla-test",
        }));
        ok++;
      } catch (e) { failed++; console.error("[push test] failed", e?.statusCode); }
    }
    return res.json({ ok: true, sent: ok, failed });
  }

  // TRIGGER-REMINDERS (Cron-Endpoint)
  if (action === "trigger-reminders") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST nötig" });
    // Optional Schutz vor Missbrauch
    const expected = process.env.PUSH_CRON_SECRET;
    if (expected && req.headers["x-cron-secret"] !== expected) {
      return res.status(401).json({ error: "Cron secret falsch" });
    }
    if (!configureVapid()) return res.status(503).json({ error: "VAPID fehlt" });

    const codes = await redis.smembers("push:active_codes");
    if (!Array.isArray(codes) || codes.length === 0) return res.json({ ok: true, sent: 0, users: 0 });

    const REMINDER_MESSAGES = {
      morning:  { title:"EYLA · Guten Morgen", body:"Wie war die Nacht? Trag deinen Schlaf ein." },
      lunch:    { title:"EYLA · Mittag fällig", body:"Was hast du gegessen?" },
      water:    { title:"EYLA · Wasser-Check", body:"Trink noch was. Du liegst noch unter Ziel." },
      evening:  { title:"EYLA · Tag-Reflexion", body:"Wie war heute? Kurz aufschreiben?" },
    };

    const now = new Date();
    const dateKey = now.toISOString().slice(0,10);
    const currentMin = now.getUTCHours()*60 + now.getUTCMinutes();
    // Hinweis: User-Profile-reminders haben Zeit in lokaler Zeit. Wir gehen pragmatisch
    // davon aus dass alle in DE Zeitzone sind → CET/CEST offset +1/+2.
    // TODO: per-User-Zeitzone wenn international relevant.
    const localOffset = 2; // CEST. Wenn Berlin DST aus: 1. Pragmatisch fix für jetzt.
    const localMin = (currentMin + localOffset*60) % (24*60);

    let totalSent = 0, totalUsers = 0;
    for (const code of codes) {
      const profileData = await redis.get(profKey(code));
      const profile = profileData?.data?.eyla_profile_v3 || profileData?.eyla_profile_v3;
      if (!profile?.reminders?.enabled) continue;
      const subs = (await redis.get(subsKey(code))) || [];
      if (subs.length === 0) continue;

      // Welche Reminder fällig? (in den letzten 15min seit der Zeit)
      const types = ["morning","lunch","water","evening"];
      for (const type of types) {
        const r = profile.reminders[type];
        if (!r?.enabled || !r.time) continue;
        const [h, m] = r.time.split(":").map(n => parseInt(n)||0);
        const targetMin = h*60 + m;
        // Trigger wenn lokale Zeit innerhalb der letzten 15min seit Target
        const diff = localMin - targetMin;
        if (diff < 0 || diff > 15) continue;
        // Schon heute geschickt?
        const markerKey = `push:sent:${code}:${type}:${dateKey}`;
        if (await redis.get(markerKey)) continue;
        // Smart Skip: Datentyp schon erfasst?
        const logs = profileData?.data?.eyla_logs_v1 || profileData?.eyla_logs_v1 || {};
        const todayLog = Object.values(logs).find(l => l?.date && (
          (typeof l.date === "string" && l.date.includes(dateKey.slice(0,4))) ||
          new Date(l.date).toISOString().slice(0,10) === dateKey
        ));
        if (type === "morning"  && todayLog?.sleep) continue;
        if (type === "lunch"    && (todayLog?.meals||[]).length > 0) continue;
        if (type === "water"    && (todayLog?.water||0) >= 8) continue;
        if (type === "evening"  && todayLog?.note) continue;
        // Senden
        const msg = REMINDER_MESSAGES[type];
        const payload = JSON.stringify({ title: msg.title, body: msg.body, tag: `eyla-${type}-${dateKey}` });
        for (const sub of subs) {
          try { await webpush.sendNotification(sub, payload); totalSent++; }
          catch (e) {
            // Endpoint expired → aufräumen
            if (e?.statusCode === 410 || e?.statusCode === 404) {
              const cleaned = subs.filter(s => s.endpoint !== sub.endpoint);
              await redis.set(subsKey(code), cleaned);
            }
          }
        }
        await redis.set(markerKey, "1", { ex: 86400 }); // 24h Marker
      }
      totalUsers++;
    }
    return res.json({ ok: true, sent: totalSent, users: totalUsers });
  }

  return res.status(404).json({ error: "Unknown action. Try public-key | subscribe | unsubscribe | test | trigger-reminders" });
}
