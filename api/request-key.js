// Vercel serverless function — POST /api/request-key
//
// Receives the lock-modal request form and sends the email via Resend.
// Returns 200 { ok: true } on success, 4xx on validation error, 5xx on backend failure.
//
// Required env var (set in Vercel project settings → Environment Variables) :
//   RESEND_API_KEY   API key from resend.com (free tier : 100 emails/day)
//
// Optional env vars :
//   REQUEST_TO       Destination address (defaults to jaime.vile@gmail.com)
//   REQUEST_FROM     Sender (defaults to onboarding@resend.dev — works
//                    immediately, no domain verification needed. Replace
//                    with a verified custom domain for production polish.)

const DEFAULT_TO = "jaime.vile@gmail.com";
const DEFAULT_FROM = "JVM Portfolio <onboarding@resend.dev>";

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

  const to = process.env.REQUEST_TO || DEFAULT_TO;
  const from = process.env.REQUEST_FROM || DEFAULT_FROM;
  const subject = `Demande de clé — ${email}`;
  const text =
    `Email · ${email}\n` +
    `Téléphone · ${phone}\n` +
    `Consentement de rappel · oui\n\n` +
    `Demande ·\n${why}\n`;
  const html =
    `<p><strong>Email</strong> · ${escapeHtml(email)}</p>` +
    `<p><strong>Téléphone</strong> · ${escapeHtml(phone)}</p>` +
    `<p><strong>Consentement de rappel</strong> · oui</p>` +
    `<p><strong>Demande</strong></p>` +
    `<p>${escapeHtml(why).replace(/\n/g, "<br>")}</p>`;

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
