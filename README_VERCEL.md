# RIDEWORKS: Betrieb und Vercel-Deployment

## Aktueller Funktionsumfang

Der bestehende Katalog und die vorhandenen Produktbilder bleiben erhalten. `products.json` ist der serverseitige Preis- und SKU-Katalog mit vier bereits vorhandenen Seed-Produkten plus elf neuen Produktentwürfen. Die Thermometer-Varianten verwenden die vom Shopbetreiber gelieferten roten und blauen Displaybilder unter `images/`. Neue Produkte ohne bestätigte Preise, Lieferantendaten oder Fahrzeugkompatibilität sind ausdrücklich `active: false`, zeigen „Preis folgt“ und können weder in den Warenkorb gelegt noch über die API bestellt werden. Sie brauchen verifizierte Preise, Bestandsmengen, Lieferantendaten und gegebenenfalls Fahrzeug-Fitment, bevor sie aktiviert werden. Die anderen neuen Produkte verwenden bis zu eigenen Produktfotos die neutrale Bildplatzhaltergrafik.

Der Bestellendpunkt akzeptiert nur Produkt-ID und SKU; Namen, Preise, Versand und Summen stammen immer vom Server. Bestellungen und Positionen werden in PostgreSQL gespeichert. Bestand wird in derselben Datenbanktransaktion geprüft und vor Annahme abgezogen; unbekannter Bestand startet bei null und wird niemals als verfügbar angenommen. Eine idempotente Bestellkennung schützt vor doppelt abgesendeten Formularen.

Zurzeit werden Versand nach Österreich (€ 4,90) und Deutschland (€ 7,90), Gratisversand ab € 75 Warenwert, Vorkasse/Banküberweisung und Barzahlung ausschließlich bei Abholung unterstützt. Der Admin kann sich über serverseitig bestätigtes Google-OAuth oder den per Umgebungsvariablen konfigurierten scrypt-Passwort-Login anmelden; Produktänderungen werden in PostgreSQL gespeichert. PayPal, Google-Kundenkonten, vollständiges Admin-Bestell-Dashboard, Support-Tickets, Bewertungen und weitere Shop-Workflows sind noch nicht implementiert. Nicht im Serverkatalog enthaltene Produkte werden absichtlich nicht zum Kauf angenommen, bis ihre bestätigten Preise und SKUs gepflegt sind.

## Voraussetzungen und Installation

- Node.js 20 oder neuer
- PostgreSQL-Datenbank mit TLS für Deployment
- Resend-Konto mit verifiziertem Absender
- Für Vorkasse: bestätigter Kontoname und IBAN (BIC optional)

```sh
npm install
```

Lege die Umgebungsvariablen aus `.env.example` lokal oder in den Vercel Project Settings fest. `.env` bleibt lokal und darf nicht eingecheckt oder in eine ZIP-Datei aufgenommen werden.

Umgebungsvariablen (welche davon erforderlich sind, hängt von den aktivierten Funktionen ab):

| Variable | Verwendung |
| --- | --- |
| `DATABASE_URL` | PostgreSQL-Verbindung für dauerhaft gespeicherte Produkte, Bestellungen und Lagerbestand |
| `DATABASE_SSL` | Standard ist TLS mit Zertifikatsprüfung; nur für lokale DB explizit `false` |
| `RESEND_API_KEY` | Serverseitiger Resend-Zugang |
| `MAIL_FROM` | Verifizierte Absenderadresse, z. B. `RIDEWORKS <shop@deine-domain.at>` |
| `GOOGLE_CLIENT_ID` | Optional: OAuth-Webclient-ID aus Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Optional: OAuth-Webclient-Geheimnis |
| `APP_URL` | Optional: öffentliche Shop-URL, für Google OAuth erforderlich |
| `SESSION_SECRET` | Erforderlich für Admin-Logins; langes zufälliges Geheimnis für signierte HttpOnly-Cookies |
| `ADMIN_USERNAME` | Optionaler Benutzername für den Admin-Passwort-Login |
| `ADMIN_PASSWORD_HASH` | Optionaler scrypt-Hash des Admin-Passworts, niemals das Passwort selbst |
| `GOOGLE_ADMIN_EMAIL` | Optional; Standard ist `hatheierlukas@gmail.com` |
| `BANK_ACCOUNT_NAME` | Kontoinhaber in den Zahlungsinformationen |
| `BANK_IBAN` | Empfängerkonto für Vorkasse |
| `BANK_BIC` | Optionaler BIC |

`MAIL_FROM` und `RESEND_API_KEY` müssen eingerichtet sein, bevor Bestellungen akzeptiert werden. Bestätigungs- und Shop-E-Mail werden nach der Datenbanktransaktion gesendet. Scheitert der Mailversand, bleibt die Bestellung gespeichert und der Checkout zeigt die Bestellnummer plus einen klaren Fehler; die Mail darf dann manuell nachbearbeitet werden.

Für den alternativen Admin-Passwort-Login ist `admin` der Standard-Benutzername (oder setze `ADMIN_USERNAME` abweichend) und generiere den Passwort-Hash in einem interaktiven Terminal:

```sh
node scripts/generate-admin-password-hash.js
```

Gib das Passwort am verborgenen Prompt ein und speichere nur die ausgegebene Hash-Zeichenfolge als `ADMIN_PASSWORD_HASH` in den Vercel-Umgebungsvariablen. Melde dich anschließend mit dem konfigurierten Nutzernamen (`admin`) oder dem in `GOOGLE_ADMIN_EMAIL` festgelegten Admin-Konto und diesem Passwort an. Das Passwort selbst gehört weder in den Quellcode noch in `.env.example`. `SESSION_SECRET` muss ebenfalls gesetzt sein. Alternativ bleibt der Google-OAuth-Login verfügbar. Der integrierte Fehlversuchs-Schutz gilt pro laufendem Prozess; für verteilte Produktionsumgebungen ist zusätzliches Rate-Limiting beim Hosting erforderlich.

## Datenbank einrichten

```sh
npm run db:migrate
```

Die Migration legt Bestellungen, Positionen und Inventar an. Alle Lagerbestände starten aus Sicherheitsgründen bei null. Vor dem Verkauf müssen bestätigte Mengen für die Produkte manuell in der Datenbank eingetragen werden, zum Beispiel:

```sql
UPDATE inventory SET stock = 12 WHERE sku = 'RW-RELAIS-1';
```

Führe Mengen nur ein, nachdem der tatsächliche Lagerbestand verifiziert wurde. Die Bestandsverwaltung über ein geschütztes Dashboard ist noch ausstehend. Sichere die Datenbank regelmäßig und teste Wiederherstellung sowie Migrationen auf einer separaten Datenbank.

## PostgreSQL als Quelle, lokales Produkt-Backup

Vercel und der lokale Shop verwenden PostgreSQL als primäre Produktquelle. Der lokale Server synchronisiert erfolgreiche Datenbank-Lese- und Schreibvorgänge atomar in `products.json` als Backup auf dem Laptop. Die lokale Datei ist schreibgeschützt, wenn PostgreSQL nicht erreichbar ist; so werden Änderungen nicht fälschlich als gespeichert gemeldet.

1. Lege im Projektordner eine von Git ignorierte `.env.local` an. Trage dort `DATABASE_URL` mit der vollständigen Supabase-Verbindungszeichenfolge und URL-kodiertem Datenbankpasswort ein. Für Serverless/Vercel bei Bedarf den Supabase-Pooler verwenden. Ergänze `DATABASE_SSL=true`, `ADMIN_USERNAME=admin`, `ADMIN_PASSWORD_HASH` und `SESSION_SECRET`. Für den Hash nutze `node scripts/generate-admin-password-hash.js`; für ein Sitzungsgeheimnis `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Zugangsdaten nicht einchecken oder teilen.
2. Führe die Migrationen mit `npm.cmd run db:migrate` aus (Windows PowerShell; in anderen Shells `npm run db:migrate`). Das Skript liest `.env.local`.
3. Starte den lokalen Shop mit `npm.cmd run local` und öffne `http://localhost:4173`. Produktänderungen werden zuerst in PostgreSQL gespeichert; nach Erfolg wird das lokale Backup erneuert.
4. Vercel muss dieselbe `DATABASE_URL` sowie `SESSION_SECRET` und `ADMIN_PASSWORD_HASH` unter Production-Umgebungsvariablen haben und nach Änderungen neu deployt werden. Katalogänderungen aus lokalem Admin sind dann direkt in der Datenbank und für die öffentliche Website sichtbar.

Der lokale Entwicklungsserver bindet nur an `127.0.0.1` und verarbeitet keine Bestellungen; nutze dafür den deployten Checkout samt erforderlicher Datenbank-, E-Mail- und Zahlungs-Konfiguration. `.env.local` wird von Git ignoriert und darf nicht veröffentlicht werden.

## Vercel

Das Repository verwendet Vercel Functions unter `api/`. Importiere es als Vercel-Projekt, setze die oben genannten Production-Umgebungsvariablen, wende die Migration gegen die Production-Datenbank an und deploye anschließend. Vor dem Livegang sind Testbestellungen in einer getrennten Datenbank/Preview-Umgebung nötig. Lege niemals Zugangsdaten in HTML, JavaScript oder `products.json`.

## Vor Produktionsfreigabe noch erforderlich

1. Auth-Konfiguration: Für Google OAuth `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`, `SESSION_SECRET` und optional `GOOGLE_ADMIN_EMAIL`. Standard-Admin ist `hatheierlukas@gmail.com`. In Google Cloud muss die Callback-URL `https://<Domain>/api/auth/google/callback` als autorisierte Redirect-URI eingetragen sein. Für den Passwort-Login müssen `ADMIN_PASSWORD_HASH` und `SESSION_SECRET` gesetzt sein; `ADMIN_USERNAME` ist optional und standardmäßig `admin`.
2. Geschütztes Admin-Dashboard für Bestellungen, Bestands-/Katalogpflege, Support und Moderation.
3. PayPal Orders API mit serverseitiger Erfassung und Verifikation; derzeit nicht auswählbar.
4. Persistente E-Mail-Warteschlange und Wiederholungs-/Monitoringprozess für fehlgeschlagene E-Mails.
5. CAPTCHA oder gleichwertiger Bot-Schutz sowie verteiltes Rate-Limiting. Origin-Prüfung, Eingabevalidierung, Honeypot und idempotente Bestellungen sind nur Basisschutz.
6. Tatsächlicher Produktbestand, SKUs, Marken/Kategorien, Lieferzeiten und gegebenenfalls weitere externe Katalogprodukte.
7. Rechtlich geprüfte Unternehmensangaben und Inhalte: Firmenname/Rechtsform, ladungsfähige Anschrift, Kontakt, Firmenbuch-/UID-Daten soweit vorhanden, AGB, Datenschutz, Widerruf/Musterformular, Gewährleistung, Umsatzsteuer-/Preisangaben, Versand-/Zahlungsbedingungen und Cookie-Verwendung. Nichts davon wurde erfunden oder als rechtskonform behauptet.
8. Google-Kundenkonten, Bestellverlauf, Tracking, Bewertungsmoderation, Ticket-System, SEO-Metadaten/Sitemap und vollständige automatisierte API-/Integrations-Tests.

Der aktuelle Stand ist ein abgesicherter erster Bestellpfad, aber ausdrücklich noch kein vollständiger oder produktionsreifer Shop.
