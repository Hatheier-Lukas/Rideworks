INSERT INTO products (id, name, description, fits, active)
VALUES
  ('thermometer', 'Digitales Motorrad-Thermometer mit Sensor', 'Digitalanzeige mit Temperaturfühler. Fahrzeugkompatibilität und Einbau vor Bestellung prüfen.', '[]'::jsonb, false),
  ('usb-charger', 'USB-Ladegerät für den Lenker', '12-V-Ladegerät für die Montage am Lenker. Spannung, Absicherung und Fahrzeugkompatibilität vor Einbau prüfen.', '[]'::jsonb, false),
  ('usb-outlet', '12-V-Steckdose fürs Moped', 'Zusätzliche 12-V-Steckdose. Anschluss, Absicherung und Fahrzeugkompatibilität vor Einbau prüfen.', '[]'::jsonb, false),
  ('phone-holder', 'Lenker-Handyhalterung', 'Halterung zur Montage am Lenker. Lenkerdurchmesser und sichere Befestigung vor Bestellung prüfen.', '[]'::jsonb, false),
  ('led-indicators', 'LED-Blinker-Set', 'Paar LED-Blinker. Elektrische Kompatibilität, Widerstand und Zulassung für das Fahrzeug vor Einbau prüfen.', '[]'::jsonb, false),
  ('tail-light', 'LED-Rücklicht', 'LED-Rücklicht. Maße, Anschlussbelegung und Zulassung für das Fahrzeug vor Bestellung prüfen.', '[]'::jsonb, false),
  ('chain-lock', 'Kettenschloss', 'Sicherungsschloss für Mopeds. Länge und Stärke werden nach Lieferantenauswahl ergänzt.', '[]'::jsonb, false),
  ('brake-lever', 'Bremshebel', 'Ersatz-Bremshebel. Fahrzeugmodell, Hebelaufnahme und Ausführung vor Bestellung abgleichen.', '[]'::jsonb, false),
  ('clutch-lever', 'Kupplungshebel', 'Ersatz-Kupplungshebel. Fahrzeugmodell, Hebelaufnahme und Ausführung vor Bestellung abgleichen.', '[]'::jsonb, false),
  ('chain-brush', 'Kettenreinigungsbürste', 'Bürste zur Reinigung der Antriebskette.', '[]'::jsonb, false),
  ('tie-down-straps', 'Spanngurte fürs Moped', 'Spanngurte zur Sicherung beim Transport. Traglast und Länge werden nach Lieferantenauswahl ergänzt.', '[]'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_variants (sku, product_id, name, price_cents, stock, low_stock_threshold, active, image)
VALUES
  ('RW-THERMOMETER-RED', 'thermometer', 'Rotes Display', NULL, 0, 3, false, '/images/thermometer-red.jpg'),
  ('RW-THERMOMETER-BLUE', 'thermometer', 'Blaues Display', NULL, 0, 3, false, '/images/thermometer-blue.jpg'),
  ('RW-USB-CHARGER-1', 'usb-charger', 'USB-Ladegerät', NULL, 0, 3, false, ''),
  ('RW-USB-OUTLET-1', 'usb-outlet', '12-V-Steckdose', NULL, 0, 3, false, ''),
  ('RW-PHONE-HOLDER-1', 'phone-holder', 'Schwarz', NULL, 0, 3, false, ''),
  ('RW-LED-INDICATOR-PAIR', 'led-indicators', 'Paar, schwarz', NULL, 0, 3, false, ''),
  ('RW-LED-TAIL-LIGHT-1', 'tail-light', 'Rücklicht', NULL, 0, 3, false, ''),
  ('RW-CHAIN-LOCK-1', 'chain-lock', 'Kettenschloss', NULL, 0, 3, false, ''),
  ('RW-BRAKE-LEVER-1', 'brake-lever', 'Bremshebel', NULL, 0, 3, false, ''),
  ('RW-CLUTCH-LEVER-1', 'clutch-lever', 'Kupplungshebel', NULL, 0, 3, false, ''),
  ('RW-CHAIN-BRUSH-1', 'chain-brush', 'Reinigungsbürste', NULL, 0, 3, false, ''),
  ('RW-STRAP-PAIR-1', 'tie-down-straps', 'Paar', NULL, 0, 3, false, '')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO inventory (sku, stock)
VALUES
  ('RW-THERMOMETER-RED', 0),
  ('RW-THERMOMETER-BLUE', 0),
  ('RW-USB-CHARGER-1', 0),
  ('RW-USB-OUTLET-1', 0),
  ('RW-PHONE-HOLDER-1', 0),
  ('RW-LED-INDICATOR-PAIR', 0),
  ('RW-LED-TAIL-LIGHT-1', 0),
  ('RW-CHAIN-LOCK-1', 0),
  ('RW-BRAKE-LEVER-1', 0),
  ('RW-CLUTCH-LEVER-1', 0),
  ('RW-CHAIN-BRUSH-1', 0),
  ('RW-STRAP-PAIR-1', 0)
ON CONFLICT (sku) DO NOTHING;
