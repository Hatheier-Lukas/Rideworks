import { createPasswordHash } from "../lib/password.js";

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
  console.error("Dieses Skript benötigt ein interaktives Terminal, damit das Passwort verborgen eingegeben wird.");
  process.exitCode = 1;
} else {
  const password = await new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = "";
    const finish = (error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") return finish(new Error("Abgebrochen."));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdout.write("Admin-Passwort eingeben (Eingabe bleibt verborgen): ");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });

  try {
    console.log(createPasswordHash(password));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
