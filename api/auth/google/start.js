import { OAuth2Client } from "google-auth-library";
import { csrfState, sign, COOKIE_NAME, clearSessionCookie } from "../../../lib/session.js";

export default async function handler(req, res) {
  if (req.method === "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Methode nicht erlaubt." });
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) {
    return res.status(503).json({
      error: "Google-Login ist nicht eingerichtet. Es fehlen GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET oder APP_URL."
    });
  }

  const state = csrfState();
  const stateCookie = `rideworks_oauth_state=${encodeURIComponent(sign({ state, expiresAt: Date.now() + 10 * 60 * 1000 }))}; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
  res.setHeader("Set-Cookie", [stateCookie]);
  const oauth = new OAuth2Client(clientId, clientSecret, `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`);
  const url = oauth.generateAuthUrl({
    access_type: "online",
    prompt: "select_account",
    scope: ["openid", "email", "profile"],
    state
  });
  res.status(302).setHeader("Location", url);
  return res.end();
}
