// Vercel serverless function — POST /api/request-key
//
// Receives the lock-modal request form, generates a fresh per-request key,
// stores its SHA-256 hash in Vercel KV with a TTL, and emails the plaintext
// key (along with requester info) to the site owner. The owner then forwards
// the key to the requester — never has to edit code.
//
// Returns 200 { ok: true } on success, 4xx on validation error, 5xx on backend failure.
//
// Required env vars (set in Vercel project settings → Environment Variables) :
//   RESEND_API_KEY       API key from resend.com (free tier : 100 emails/day)
//   KV_REST_API_URL      Auto-injected when a Vercel KV store is connected
//   KV_REST_API_TOKEN    Auto-injected when a Vercel KV store is connected
//
// Optional env vars :
//   REQUEST_TO           Destination address (defaults to jaime.vile@gmail.com)
//   REQUEST_FROM         Sender (defaults to onboarding@resend.dev)
//   KEY_TTL_DAYS         Validity window for generated keys (defaults to 90)
//   LOCK_KEY_HINT        Free-text reminder appended to every notification
//                        email (e.g. permanent override keys). Optional.

const crypto = require("crypto");

const DEFAULT_TO = "jaime.vile@gmail.com";
const DEFAULT_FROM = "JVM Portfolio <onboarding@resend.dev>";
const DEFAULT_TTL_DAYS = 90;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^0[67][\s.\-]?([0-9][\s.\-]?){8}$/;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);

const sha256Hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const randomKey = () => crypto.randomBytes(18).toString("base64url");

async function kvSetEx(key, value, ttlSeconds) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV not configured");
  const r = await fetch(`${url}/setex/${encodeURIComponent(key)}/${ttlSeconds}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: value,
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`KV setex ${r.status} ${detail}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set");
    return res.status(500).json({ error: "Service d'envoi non configuré." });
  }

  const body = req.body || {};
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const why = String(body.why || "").trim();
  const consent = Boolean(body.consent);
  const honeypot = String(body.hp || "").trim();

  if (honeypot) {
    return res.status(200).json({ ok: true });
  }

  if (!email || !phone || !why || !consent) {
    return res.status(400).json({ error: "Tous les champs sont requis." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Email invalide." });
  }
  if (!PHONE_RE.test(phone)) {
    return res.status(400).json({ error: "Téléphone invalide." });
  }
  if (why.length > 2000) {
    return res.status(400).json({ error: "Demande trop longue." });
  }

  const ttlDays = Math.max(1, Number(process.env.KEY_TTL_DAYS) || DEFAULT_TTL_DAYS);
  const ttlSeconds = ttlDays * 86400;

  const issuedKey = randomKey();
  const issuedHash = sha256Hex(issuedKey);
  const meta = {
    requester: email,
    issued: new Date().toISOString(),
    ttl_days: ttlDays,
  };

  try {
    await kvSetEx(`magickey:${issuedHash}`, JSON.stringify(meta), ttlSeconds);
  } catch (e) {
    console.error("KV store failed:", e);
    return res.status(502).json({ error: "Service indisponible. Réessayez ou écrivez directement à jaime.vile@gmail.com." });
  }

  const to = process.env.REQUEST_TO || DEFAULT_TO;
  const from = process.env.REQUEST_FROM || DEFAULT_FROM;
  const hint = (process.env.LOCK_KEY_HINT || "").trim();
  const subject = `Demande de clé — ${email}`;

  let text =
    `Email · ${email}\n` +
    `Téléphone · ${phone}\n` +
    `Consentement de rappel · oui\n\n` +
    `Demande ·\n${why}\n\n` +
    `═══════ CLÉ GÉNÉRÉE POUR CETTE DEMANDE ═══════\n` +
    `\n` +
    `   ${issuedKey}\n` +
    `\n` +
    `   Valide ${ttlDays} jours. À transmettre au demandeur.\n` +
    `   Ne pas citer en réponse — supprimer cette section\n` +
    `   avant d'envoyer.\n` +
    `\n` +
    `══════════════════════════════════════════════\n`;

  let html =
    `<p><strong>Email</strong> · ${escapeHtml(email)}</p>` +
    `<p><strong>Téléphone</strong> · ${escapeHtml(phone)}</p>` +
    `<p><strong>Consentement de rappel</strong> · oui</p>` +
    `<p><strong>Demande</strong></p>` +
    `<p>${escapeHtml(why).replace(/\n/g, "<br>")}</p>` +
    `<div style="margin:1.5em 0;padding:1em 1.25em;border:1px solid #d8a800;background:#fffbe6;border-radius:6px;">` +
    `<p style="margin:0 0 0.5em;font-size:0.75em;color:#a00;letter-spacing:0.04em;text-transform:uppercase;">Clé générée pour cette demande</p>` +
    `<pre style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.05em;margin:0;padding:0;background:transparent;">${escapeHtml(issuedKey)}</pre>` +
    `<p style="margin:0.75em 0 0;font-size:0.8em;color:#555;">Valide ${ttlDays} jours. À transmettre au demandeur. Ne pas citer en réponse — supprimer ce bloc avant d'envoyer.</p>` +
    `</div>`;

  if (hint) {
    text +=
      `\n———————— Rappel privé (clés permanentes) ————————\n` +
      `${hint}\n` +
      `————————————————————————————————————————\n`;
    html +=
      `<hr style="border:none;border-top:1px solid #ddd;margin:1.5em 0 0.5em;">` +
      `<p style="margin:0;font-size:0.75em;color:#888;letter-spacing:0.04em;text-transform:uppercase;">Rappel privé — clés permanentes</p>` +
      `<pre style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f7f7f7;padding:0.75em 1em;border-radius:4px;white-space:pre-wrap;margin:0.5em 0 0;font-size:0.85em;">${escapeHtml(hint)}</pre>`;
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject,
        text,
        html,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Resend non-2xx:", r.status, detail);
      return res.status(502).json({ error: "Envoi impossible. Réessayez ou écrivez directement à jaime.vile@gmail.com." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Resend fetch failed:", e);
    return res.status(502).json({ error: "Envoi impossible. Réessayez ou écrivez directement à jaime.vile@gmail.com." });
  }
};
