// Vercel Serverless Function – Proxy zu Anthropic Messages API.
// Frontend ruft fetch("/api/chat", {body: {model, max_tokens, system, messages}}) auf,
// hier wird der API-Key (aus ENV-Variable ANTHROPIC_API_KEY) ergänzt und an
// api.anthropic.com weitergeleitet. Der API-Key bleibt serverseitig.
//
// Lokales Dev: `vercel dev` benutzen (nicht `npm run dev`), damit dieser
// Endpoint angesprochen werden kann. Alternativ `.env.local` + ENV setzen.

export default async function handler(req, res) {
  // CORS (für den Fall dass jemand die App auf eigener Domain fährt)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY fehlt. In Vercel: Settings → Environment Variables setzen."
    });
  }

  try {
    // req.body ist auf Vercel bereits geparst, lokal manchmal nicht
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { model, max_tokens, system, messages } = body || {};

    if (!model || !messages) {
      return res.status(400).json({ error: "model und messages sind Pflicht" });
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: max_tokens ?? 1024,
        ...(system ? { system } : {}),
        messages,
      }),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e) {
    console.error("[/api/chat] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
