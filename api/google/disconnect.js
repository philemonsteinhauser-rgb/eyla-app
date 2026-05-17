// Löscht Google-Token. Optional: token revoken bei Google.
import { getRedis, tokenKey, userCodeFromReq, setCors } from "../_kv.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ error: "no_user_code" });

  const redis = getRedis();
  if (!redis) return res.status(503).json({ error: "no_storage" });

  const stored = await redis.get(tokenKey("google", code));
  if (stored?.access_token) {
    // Best-effort revoke bei Google
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${stored.access_token}`, { method: "POST" });
    } catch {}
  }
  await redis.del(tokenKey("google", code));
  return res.json({ ok: true });
}
