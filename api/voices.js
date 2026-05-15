// Vercel Serverless Function – fetcht alle Stimmen aus dem User-ElevenLabs-Account.
// So weiß das Frontend exakt welche IDs verfügbar sind (inkl. geklonte Stimmen).

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "ElevenLabs nicht konfiguriert" });
  }

  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey }
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: "ElevenLabs API Fehler", detail: t.slice(0, 500) });
    }
    const data = await r.json();
    // Auf relevante Felder reduzieren – kein Bedarf den User mit allem zu fluten
    const voices = (data.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,           // premade | cloned | generated | professional
      description: v.description || "",
      labels: v.labels || {},          // accent, gender, age, ...
    }));
    res.setHeader("Cache-Control", "private, max-age=300"); // 5 Min Cache
    return res.json({ voices });
  } catch (e) {
    console.error("[/api/voices]", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
