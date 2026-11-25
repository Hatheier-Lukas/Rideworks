# RIDEWORKS: Betrieb und Vercel-Deployment

## Aktueller Funktionsumfang

Der bestehende Katalog und die vorhandenen Produktbilder bleiben erhalten. `products.json` ist der serverseitige Preis- und SKU-Katalog mit vier bereits vorhandenen Seed-Produkten plus elf neuen Produktentwürfen. Die Thermometer-Varianten verwenden die vom Shopbetreiber gelieferten roten und blauen Displaybilder unter `images/`. Neue Produkte ohne bestätigte Preise, Lieferantendaten oder Fahrzeugkompatibilität sind ausdrücklich `active: false`, zeigen „Preis folgt“ und können weder in den Warenkorb gelegt noch über die API bestellt werden. Sie brauchen verifizierte Preise, Bestandsmengen, Lieferantendaten und gegebenenfalls Fahrzeug-Fitment, bevor sie aktiviert werden. Die anderen neuen Produkte verwenden bis zu eigenen Produktfotos die neutrale Bildplatzhaltergrafik.

Der Bestellendpunkt akzeptiert nur Produkt-ID und SKU; Namen, Preise, Versand und Summen stammen immer vom Server. Im Vercel-Deployment werden Bestellungen, Positionen, Produkte und Bestand in PostgreSQL gespeichert. Der lokale Entwicklungsserver verwendet stattdessen JSON-Dateien unter `data/` und verarbeitet keine Bestellungen. Bestand startet in beiden Modi bei null und wird niemals als verfügbar angenommen, bevor er gepflegt wurde.

Zurzeit werden Versand nach Österreich (€ 4,90) und Deutschland (€ 7,90), Gratisversand ab € 75 Warenwert, Vorkasse/Banküberweisung und Barzahlung ausschließlich bei Abholung unterstützt. Der Admin kann sich über serverseitig bestätigtes Google-OAuth oder den per Umgebungsvariablen konfigurierten scrypt-Passwort-Login anmelden; Produktänderungen werden in PostgreSQL gespeichert. PayPal, Google-Kundenkonten, vollständiges Admin-Bestell-Dashboard, Support-Tickets, Bewertungen und weitere Shop-Workflows sind noch nicht implementiert. Nicht im Serverkatalog enthaltene Produkte werden absichtlich nicht zum Kauf angenommen, bis ihre bestätigten Preise und SKUs gepflegt sind.

## Voraussetzungen und Installation

- Node.js 20 oder neuer
- Für das Vercel-Deployment: PostgreSQL-Datenbank mit TLS und Resend-Konto mit verifiziertem Absender
- Für Vorkasse: bestätigter Kontoname und IBAN (BIC optional)

```sh
npm install
```

Für den lokalen Dateimodus wird keine `DATABASE_URL` benötigt. Deployment-Variablen für Vercel aus `.env.example` gehören in die Vercel Project Settings; lokale Geheimnisse kommen in `.env.local`, die nicht eingecheckt oder in eine ZIP-Datei aufgenommen werden darf.

Umgebungsvariablen (welche davon erforderlich sind, hängt von den aktivierten Funktionen ab):

| Variable | Verwendung |
| --- | --- |
| `DATABASE_URL` | PostgreSQL-Verbindung für das Vercel-Deployment; lokal optional und nicht vom Dateimodus verwendet |
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

## Datenbank für Vercel einrichten

```sh
npm run db:migrate
```

Die Migration legt Bestellungen, Positionen und Inventar an. Alle Lagerbestände starten aus Sicherheitsgründen bei null. Vor dem Verkauf müssen bestätigte Mengen für die Produkte manuell in der Datenbank eingetragen werden, zum Beispiel:

```sql
UPDATE inventory SET stock = 12 WHERE sku = 'RW-RELAIS-1';
```

Führe Mengen nur ein, nachdem der tatsächliche Lagerbestand verifiziert wurde. Die Bestandsverwaltung über ein geschütztes Dashboard ist noch ausstehend. Sichere die Datenbank regelmäßig und teste Wiederherstellung sowie Migrationen auf einer separaten Datenbank.

## Lokale Dateispeicherung

Der lokale Entwicklungsserver benötigt keine `DATABASE_URL`. Beim ersten Start erstellt er den ignorierten Ordner `data/` und initialisiert `data/products.json`, `data/drafts.json` und `data/inventory.json` aus dem vorhandenen Produktkatalog. Damit bleiben auch die bisherigen Standardprodukte, inaktiven Entwürfe und Variantenbestände erhalten. Produktänderungen werden lokal gespeichert; `/api/products` bestätigt sie mit `persistent: true`. Entwürfe und Bestand sind lokal über `/api/drafts` und `/api/inventory` abrufbar und änderbar.

1. Für den lokalen Admin-Login `.env.local` mit `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` und `SESSION_SECRET` verwenden. Der Passwort-Hash wird mit `node scripts/generate-admin-password-hash.js` erzeugt; das Skript fragt das Passwort verborgen ab. Zugangsdaten nicht einchecken oder teilen.
2. Starte `npm.cmd run local` (Windows PowerShell; in anderen Shells `npm run local`) und öffne `http://localhost:4173`. Änderungen bleiben nach Server-Neustarts in `data/` erhalten.
3. Sichere `data/` separat, falls diese lokalen Änderungen wichtig sind. Der Ordner wird von Git ignoriert und nicht automatisch mit Vercel synchronisiert.

Die lokale Speicherung gilt nur für den lokalen Node-Server. Vercel Functions bieten kein dauerhaftes beschreibbares lokales Dateisystem; für persistente Speicherung auf der öffentlichen Website ist weiterhin ein externer Datenspeicher erforderlich. Der lokale Server verarbeitet keine Bestellungen.

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
