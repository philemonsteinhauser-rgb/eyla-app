// Vercel Serverless Function – ElevenLabs TTS Proxy.
// Frontend ruft fetch("/api/tts", {body:{text, voiceId}}) auf,
// hier wird mit ELEVENLABS_API_KEY aus ENV gegen api.elevenlabs.io
// gesprochen. Antwort ist audio/mpeg (mp3).
//
// Setup in Vercel:
//   ENV: ELEVENLABS_API_KEY (Account auf elevenlabs.io anlegen,
//        Free-Tier hat 10.000 Zeichen/Monat)
//
// Wenn ENV fehlt: 503, Frontend fällt automatisch auf Browser-TTS zurück.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "ElevenLabs nicht konfiguriert",
      hint: "ENV ELEVENLABS_API_KEY in Vercel setzen"
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const text = String(body?.text || "").slice(0, 5000);
    const voiceId = String(body?.voiceId || "EXAVITQu4vr4xnSDxMaL"); // Default: "Sarah"
    const model = String(body?.model || "eleven_multilingual_v2");

    if (!text) return res.status(400).json({ error: "text fehlt" });

    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.85,
          style: 0.15,
          use_speaker_boost: true
        }
      })
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[/api/tts] upstream error:", upstream.status, errText);
      return res.status(upstream.status).json({ error: "ElevenLabs failed", detail: errText.slice(0, 500) });
    }

    const audioBuffer = await upstream.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.send(Buffer.from(audioBuffer));
  } catch (e) {
    console.error("[/api/tts] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
