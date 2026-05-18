// Vercel serverless function — POST /api/verify-key
//
// Validates a magickey submitted from the lock modal. Hashes the input and
// looks it up first in PERMANENT_HASHES (in-memory, for legacy/override keys)
// then in Vercel KV (where dynamically issued keys live with a TTL).
//
// Returns 200 { ok: true | false } in all valid-input cases. 4xx for malformed
// requests. Never reveals which store matched or why a key was rejected.
//
// Required env vars when KV-backed dynamic keys are in use :
//   KV_REST_API_URL      Auto-injected when an Upstash Redis store is
//                        connected via the Vercel Marketplace.
//   KV_REST_API_TOKEN    Auto-injected (same as above).
//                        UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//                        are accepted as fallbacks under the newer naming.
// If both pairs are absent, only PERMANENT_HASHES is consulted.

const crypto = require("crypto");

// Permanent / override hashes — keys that never expire. Add a hash here only
// when you want a permanent backdoor (e.g. your own master key). Most keys
// should be issued dynamically via /api/request-key instead.
const PERMANENT_HASHES = new Set([
  "c6d13af9b9e2f23c32caa8970df3c7daf693c633dafc93440f17f8f36f54e9ec", // legacy
]);

const sha256Hex = (s) =>
  crypto.createHash("sha256").update(s, "utf8").digest("hex");

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return { url: url.replace(/\/$/, ""), token };
}

async function kvGet(key) {
  const { url, token } = kvCreds();
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.result !== undefined ? data.result : null;
  } catch (_) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const body = req.body || {};
  const input = String(body.key || "").trim();
  if (!input || input.length > 200) {
    return res.status(200).json({ ok: false });
  }

  const hash = sha256Hex(input);

  if (PERMANENT_HASHES.has(hash)) {
    return res.status(200).json({ ok: true });
  }

  const stored = await kvGet(`magickey:${hash}`);
  if (stored !== null) {
    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: false });
};
