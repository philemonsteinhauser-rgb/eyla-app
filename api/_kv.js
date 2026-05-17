// Shared Helper für Upstash Redis (Token-Storage etc.)
// Re-export Redis-Client + Convenience-Helpers für App-Integrations.

import { Redis } from "@upstash/redis";

export function getRedis() {
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Token-Key: tokens:{provider}:{userCode}  → Token-Objekt (provider-spezifisch)
export function tokenKey(provider, code) {
  return `tokens:${provider}:${String(code||"").toLowerCase().trim()}`;
}

export function userCodeFromReq(req) {
  // Code kommt entweder als Header (für API-Calls aus dem Frontend)
  // oder im OAuth-State (für callback)
  const fromHeader = String(req.headers["x-eyla-code"] || "").toLowerCase().trim();
  if (fromHeader && fromHeader.length >= 3 && fromHeader.length <= 64) return fromHeader;
  return null;
}

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-eyla-code");
}
