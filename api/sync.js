// Vercel Serverless Function – Cloud-Sync für EYLA-User-Daten.
//
// Schlüssel ist der Access-Code (lowercased), den der User eh schon ins
// Passcode-Gate eingibt. Pro Code wird ein JSON-Blob mit profile, logs,
// shopping, plan, events, chat etc. gespeichert.
//
// Setup-Voraussetzung in Vercel:
//   Storage → Create Database → KV → Mit Projekt verbinden
//   Vercel injiziert automatisch KV_URL, KV_REST_API_URL,
//   KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN als ENV.
//
// Wenn KV nicht eingerichtet ist, antwortet der Endpoint mit 503 und das
// Frontend fällt automatisch auf reines localStorage zurück.

let kv = null;
try {
  // dynamic import damit der Build nicht killt wenn das package fehlt
  ({ kv } = await import("@vercel/kv"));
} catch {}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-eyla-code");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!kv || !process.env.KV_REST_API_URL) {
    return res.status(503).json({ error: "Cloud-Sync nicht konfiguriert (Vercel KV fehlt)." });
  }

  const code = String(req.headers["x-eyla-code"] || "").toLowerCase().trim();
  if (!code || code.length < 3 || code.length > 64) {
    return res.status(401).json({ error: "Code fehlt oder ungültig." });
  }
  const key = `eyla:${code}`;

  try {
    if (req.method === "GET") {
      const data = await kv.get(key);
      return res.json({ data: data || null });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "Body muss ein Objekt sein." });
      }
      // 1MB Soft-Limit pro User
      const payloadSize = JSON.stringify(body).length;
      if (payloadSize > 1024 * 1024) {
        return res.status(413).json({ error: "Datenmenge zu groß (>1MB)." });
      }
      await kv.set(key, { ...body, updatedAt: new Date().toISOString() });
      return res.json({ ok: true, size: payloadSize });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("[/api/sync] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
