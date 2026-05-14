// Vercel Serverless Function – Cloud-Sync für EYLA-User-Daten.
//
// Schlüssel ist der Access-Code (lowercased), den der User eh schon ins
// Passcode-Gate eingibt. Pro Code wird ein JSON-Blob mit profile, logs,
// shopping, plan, events, chat etc. gespeichert.
//
// ENV-Setup: Upstash Integration in Vercel → Project → Storage. Liefert
// entweder KV_REST_API_URL/TOKEN (alte Vercel-KV-Variante) oder
// UPSTASH_REDIS_REST_URL/TOKEN (neue Marketplace-Variante). Wir nehmen beide.

import { Redis } from "@upstash/redis";

function getRedis() {
  // Versuche Vercel-KV-ENV zuerst, sonst Upstash-Direkt-ENV
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-eyla-code");
  if (req.method === "OPTIONS") return res.status(200).end();

  const redis = getRedis();
  if (!redis) {
    return res.status(503).json({
      error: "Cloud-Sync nicht konfiguriert",
      hint: "Vercel → Storage → Upstash Redis verbinden",
      seenEnv: {
        KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
      }
    });
  }

  const code = String(req.headers["x-eyla-code"] || "").toLowerCase().trim();
  if (!code || code.length < 3 || code.length > 64) {
    return res.status(401).json({ error: "Code fehlt oder ungültig" });
  }
  const key = `eyla:${code}`;

  try {
    if (req.method === "GET") {
      const data = await redis.get(key);
      return res.status(200).json({ data: data || null });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "Body muss ein Objekt sein" });
      }
      const payload = { ...body, updatedAt: new Date().toISOString() };
      const payloadSize = JSON.stringify(payload).length;
      if (payloadSize > 1024 * 1024) {
        return res.status(413).json({ error: "Datenmenge zu groß (>1MB)" });
      }
      await redis.set(key, payload);
      return res.status(200).json({ ok: true, size: payloadSize });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[/api/sync] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
