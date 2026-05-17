// Gibt Connection-Status zurück: connected? mit welcher email?
import { getRedis, tokenKey, userCodeFromReq, setCors } from "../_kv.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ connected: false, error: "no_user_code" });

  const redis = getRedis();
  if (!redis) return res.status(503).json({ connected: false, error: "no_storage" });

  const stored = await redis.get(tokenKey("google", code));
  if (!stored) return res.json({ connected: false });
  return res.json({
    connected: true,
    email: stored.email || null,
    connectedAt: stored.connectedAt || null,
    hasRefresh: !!stored.refresh_token,
  });
}
