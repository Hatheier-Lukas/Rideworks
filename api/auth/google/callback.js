import { OAuth2Client } from "google-auth-library";
import { verify, sign, sessionCookie, clearSessionCookie, COOKIE_NAME } from "../../../lib/session.js";

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Methode nicht erlaubt." });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) {
    return res.status(503).json({ error: "Google-Login ist nicht eingerichtet." });
  }

  const stateValue = readCookie(req, "rideworks_oauth_state");
  const stateData = verify(stateValue);
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!stateData || stateData.state !== state) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.status(400).send("Ungültige oder abgelaufene OAuth-Anfrage.");
  }
  if (typeof req.query.code !== "string") {
    return res.status(400).send("Google hat keinen Login-Code geliefert.");
  }

  try {
    const oauth = new OAuth2Client(clientId, clientSecret, `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`);
    const { tokens } = await oauth.getToken(req.query.code);
    if (!tokens.id_token) throw new Error("missing_id_token");
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
    const payload = ticket.getPayload();
    const email = String(payload?.email || "").toLowerCase();
    const adminEmail = (process.env.GOOGLE_ADMIN_EMAIL || "hatheierlukas@gmail.com").toLowerCase();
    if (!payload?.email_verified || email !== adminEmail) {
      res.setHeader("Set-Cookie", clearSessionCookie());
      return res.status(403).send("Dieses Google-Konto ist nicht für den Admin-Zugang freigegeben.");
    }

    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    const token = sign({ email, expiresAt });
    res.setHeader("Set-Cookie", [
      sessionCookie(token, expiresAt),
      "rideworks_oauth_state=; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    ]);
    res.status(302).setHeader("Location", `${appUrl.replace(/\/$/, "")}/shop.html`);
    return res.end();
  } catch {
    return res.status(401).send("Google-Login konnte nicht sicher bestätigt werden.");
  }
}
