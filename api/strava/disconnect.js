import { getRedis, tokenKey, userCodeFromReq, setCors } from "../_kv.js";
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ error:"no_user_code" });
  const redis = getRedis();
  if (!redis) return res.status(503).json({ error:"no_storage" });
  // Optional bei Strava deauthorize – braucht POST mit access_token
  const stored = await redis.get(tokenKey("strava", code));
  if (stored?.access_token) {
    try {
      await fetch("https://www.strava.com/oauth/deauthorize", {
        method: "POST",
        headers: { Authorization: `Bearer ${stored.access_token}` }
      });
    } catch {}
  }
  await redis.del(tokenKey("strava", code));
  return res.json({ ok:true });
}
