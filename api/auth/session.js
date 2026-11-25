import { getSession, clearSessionCookie } from "../../lib/session.js";

export default async function handler(req, res) {
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.status(200).json({ admin: false });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, DELETE");
    return res.status(405).json({ error: "Methode nicht erlaubt." });
  }
  const session = getSession(req);
  const adminEmail = (process.env.GOOGLE_ADMIN_EMAIL || "hatheierlukas@gmail.com").toLowerCase();
  if (!session || session.email.toLowerCase() !== adminEmail) {
    return res.status(200).json({ admin: false });
  }
  return res.status(200).json({ admin: true, email: session.email });
}
