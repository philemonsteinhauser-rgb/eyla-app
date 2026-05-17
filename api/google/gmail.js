// Gmail-Reader – nutzt den gleichen Google-Token wie Calendar
// Scope `gmail.readonly` ist schon im OAuth-Flow (api/google/auth.js).
//
// GET /api/google/gmail            → letzte 10 ungelesene Mails (Headers + Snippet)
// GET /api/google/gmail?query=...  → custom Gmail-Suchquery
// GET /api/google/gmail?max=20     → bis zu 20 Stück
//
// Antwort: { messages: [{ id, from, subject, snippet, date, isUnread, link }] }

import { getGoogleAccessToken } from "./_token.js";
import { userCodeFromReq, setCors } from "../_kv.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const code = userCodeFromReq(req);
  if (!code) return res.status(401).json({ error: "no_user_code" });

  const tok = await getGoogleAccessToken(code);
  if (tok.error) return res.status(tok.needsReconnect ? 401 : 503).json(tok);

  const auth = { Authorization: `Bearer ${tok.token}` };
  const query = String(req.query.query || "in:inbox is:unread").trim();
  const max = Math.min(30, parseInt(req.query.max) || 10);

  try {
    // 1) Liste Message-IDs
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max}`;
    const listRes = await fetch(listUrl, { headers: auth });
    if (!listRes.ok) {
      const t = await listRes.text();
      return res.status(listRes.status).json({ error: "gmail_list_failed", detail: t.slice(0,400) });
    }
    const listJson = await listRes.json();
    const ids = (listJson.messages || []).map(m => m.id);
    if (ids.length === 0) return res.json({ messages: [], total: 0 });

    // 2) Für jede ID Header + Snippet parallel laden (only metadata für Speed)
    const msgs = await Promise.all(ids.map(async (id) => {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: auth });
      if (!r.ok) return null;
      const j = await r.json();
      const headers = (j.payload?.headers || []).reduce((acc, h) => { acc[h.name.toLowerCase()] = h.value; return acc; }, {});
      return {
        id: j.id,
        threadId: j.threadId,
        from: headers["from"] || "",
        subject: headers["subject"] || "(ohne Betreff)",
        snippet: j.snippet || "",
        date: headers["date"] || "",
        labels: j.labelIds || [],
        isUnread: (j.labelIds || []).includes("UNREAD"),
        link: `https://mail.google.com/mail/u/0/#inbox/${j.id}`,
      };
    }));
    return res.json({ messages: msgs.filter(Boolean), total: msgs.length });
  } catch (e) {
    console.error("[google/gmail] error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
