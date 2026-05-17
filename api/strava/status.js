import { getRedis, tokenKey, userCodeFromReq, setCors } from "../_kv.js";
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ connected:false });
  const redis = getRedis();
  if (!redis) return res.status(503).json({ connected:false, error:"no_storage" });
  const stored = await redis.get(tokenKey("strava", code));
  if (!stored) return res.json({ connected:false });
  return res.json({
    connected: true,
    athlete: stored.athlete,
    email: stored.athlete ? `${stored.athlete.firstname||""} ${stored.athlete.lastname||""}`.trim() : null,
    connectedAt: stored.connectedAt,
  });
}
