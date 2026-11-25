# RIDEWORKS: Betrieb und Vercel-Deployment

## Aktueller Funktionsumfang

Der bestehende Katalog und die vorhandenen Produktbilder bleiben erhalten. `products.json` ist der serverseitige Preis- und SKU-Katalog mit vier bereits vorhandenen Seed-Produkten plus elf neuen Produktentwürfen. Die Thermometer-Varianten verwenden die vom Shopbetreiber gelieferten roten und blauen Displaybilder unter `images/`. Neue Produkte ohne bestätigte Preise, Lieferantendaten oder Fahrzeugkompatibilität sind ausdrücklich `active: false`, zeigen „Preis folgt“ und können weder in den Warenkorb gelegt noch über die API bestellt werden. Sie brauchen verifizierte Preise, Bestandsmengen, Lieferantendaten und gegebenenfalls Fahrzeug-Fitment, bevor sie aktiviert werden. Die anderen neuen Produkte verwenden bis zu eigenen Produktfotos die neutrale Bildplatzhaltergrafik.

Der Bestellendpunkt akzeptiert nur Produkt-ID und SKU; Namen, Preise, Versand und Summen stammen immer vom Server. Bestellungen und Positionen werden in PostgreSQL gespeichert. Bestand wird in derselben Datenbanktransaktion geprüft und vor Annahme abgezogen; unbekannter Bestand startet bei null und wird niemals als verfügbar angenommen. Eine idempotente Bestellkennung schützt vor doppelt abgesendeten Formularen.

Zurzeit werden Versand nach Österreich (€ 4,90) und Deutschland (€ 7,90), Gratisversand ab € 75 Warenwert, Vorkasse/Banküberweisung und Barzahlung ausschließlich bei Abholung unterstützt. PayPal, Google-Kundenkonten, Google-Admin-OAuth, Admin-Bestellverwaltung, Support-Tickets, Bewertungen und weitere Shop-Workflows sind noch nicht implementiert. Es gibt keine öffentliche Admin- oder Lagerpflege-API. Nicht im Serverkatalog enthaltene Produkte (zum Beispiel aus einer früheren externen Datenquelle) werden absichtlich nicht zum Kauf angenommen, bis ihre bestätigten Preise und SKUs in `products.json` gepflegt sind.

## Voraussetzungen und Installation

- Node.js 20 oder neuer
- PostgreSQL-Datenbank mit TLS für Deployment
- Resend-Konto mit verifiziertem Absender
- Für Vorkasse: bestätigter Kontoname und IBAN (BIC optional)

```sh
npm install
```

Lege die Umgebungsvariablen aus `.env.example` lokal oder in den Vercel Project Settings fest. `.env` bleibt lokal und darf nicht eingecheckt oder in eine ZIP-Datei aufgenommen werden.

Erforderliche Variablen:

| Variable | Verwendung |
| --- | --- |
| `DATABASE_URL` | PostgreSQL-Verbindung für persistente Bestellungen und Lagerbestand |
| `DATABASE_SSL` | Standard ist TLS mit Zertifikatsprüfung; nur für lokale DB explizit `false` |
| `RESEND_API_KEY` | Serverseitiger Resend-Zugang |
| `MAIL_FROM` | Verifizierte Absenderadresse, z. B. `RIDEWORKS <shop@deine-domain.at>` |
| `BANK_ACCOUNT_NAME` | Kontoinhaber in den Zahlungsinformationen |
| `BANK_IBAN` | Empfängerkonto für Vorkasse |
| `BANK_BIC` | Optionaler BIC |

`MAIL_FROM` und `RESEND_API_KEY` müssen eingerichtet sein, bevor Bestellungen akzeptiert werden. Bestätigungs- und Shop-E-Mail werden nach der Datenbanktransaktion gesendet. Scheitert der Mailversand, bleibt die Bestellung gespeichert und der Checkout zeigt die Bestellnummer plus einen klaren Fehler; die Mail darf dann manuell nachbearbeitet werden.

## Datenbank einrichten

```sh
npm run db:migrate
```

Die Migration legt Bestellungen, Positionen und Inventar an. Alle Lagerbestände starten aus Sicherheitsgründen bei null. Vor dem Verkauf müssen bestätigte Mengen für die Produkte manuell in der Datenbank eingetragen werden, zum Beispiel:

```sql
UPDATE inventory SET stock = 12 WHERE sku = 'RW-RELAIS-1';
```

Führe Mengen nur ein, nachdem der tatsächliche Lagerbestand verifiziert wurde. Die Bestandsverwaltung über ein geschütztes Dashboard ist noch ausstehend. Sichere die Datenbank regelmäßig und teste Wiederherstellung sowie Migrationen auf einer separaten Datenbank.

## Vercel

Das Repository verwendet Vercel Functions unter `api/`. Importiere es als Vercel-Projekt, setze die oben genannten Production-Umgebungsvariablen, wende die Migration gegen die Production-Datenbank an und deploye anschließend. Vor dem Livegang sind Testbestellungen in einer getrennten Datenbank/Preview-Umgebung nötig. Lege niemals Zugangsdaten in HTML, JavaScript oder `products.json`.

## Vor Produktionsfreigabe noch erforderlich

1. Google OAuth-Endpunkte, sichere Session-Cookies und serverseitige Admin-Prüfung ausschließlich für `hatheierlukas@gmail.com`; die bisherige Frontend-Passwortprüfung wurde entfernt und kann keinen Adminzugriff gewähren.
2. Geschütztes Admin-Dashboard für Bestellungen, Bestands-/Katalogpflege, Support und Moderation.
3. PayPal Orders API mit serverseitiger Erfassung und Verifikation; derzeit nicht auswählbar.
4. Persistente E-Mail-Warteschlange und Wiederholungs-/Monitoringprozess für fehlgeschlagene E-Mails.
5. CAPTCHA oder gleichwertiger Bot-Schutz sowie verteiltes Rate-Limiting. Origin-Prüfung, Eingabevalidierung, Honeypot und idempotente Bestellungen sind nur Basisschutz.
6. Tatsächlicher Produktbestand, SKUs, Marken/Kategorien, Lieferzeiten und gegebenenfalls weitere externe Katalogprodukte.
7. Rechtlich geprüfte Unternehmensangaben und Inhalte: Firmenname/Rechtsform, ladungsfähige Anschrift, Kontakt, Firmenbuch-/UID-Daten soweit vorhanden, AGB, Datenschutz, Widerruf/Musterformular, Gewährleistung, Umsatzsteuer-/Preisangaben, Versand-/Zahlungsbedingungen und Cookie-Verwendung. Nichts davon wurde erfunden oder als rechtskonform behauptet.
8. Google-Kundenkonten, Bestellverlauf, Tracking, Bewertungsmoderation, Ticket-System, SEO-Metadaten/Sitemap und vollständige automatisierte API-/Integrations-Tests.

Der aktuelle Stand ist ein abgesicherter erster Bestellpfad, aber ausdrücklich noch kein vollständiger oder produktionsreifer Shop.
