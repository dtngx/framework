# 🟧 KEKS Werkzeugkasten

Zentrales Dashboard und Startpunkt für unsere Tools rund um den
Bauarchitektur-Workflow. Jedes Tool ist ein eigenständiges „Plugin“ –
neue Tools kommen als einzelner Ordner dazu und erscheinen automatisch
auf dem Dashboard.

## Start

Voraussetzung: **Node.js** ist installiert (keine weiteren Abhängigkeiten nötig).

```bash
node server.js
```

Dann im Browser öffnen: **http://localhost:4000**
(Port ändern: `PORT=8080 node server.js`)

### Start mit Docker

```bash
cp .env.example .env   # anpassen: PORT, ADMIN_USERNAME, ADMIN_PASSWORD
docker compose up --build
```

Dann im Browser öffnen: **http://localhost:4000** (bzw. der in `.env` gesetzte Port).

- `ADMIN_USERNAME`/`ADMIN_PASSWORD` legen beim **allerersten** Start automatisch
  einen aktiven Admin-Account an, damit man sich nicht erst manuell über die
  Weboberfläche registrieren und selbst freischalten muss. Beide Variablen
  sind optional – lässt man sie weg, funktioniert der übliche Weg (erster
  registrierter Account wird automatisch Admin) unverändert weiter.
- Das Passwort wird **nur beim ersten Start** übernommen. Ändert man es später
  im Dashboard, bleibt diese Änderung auch nach einem Neustart des Containers
  bestehen – Env-Variablen überschreiben kein bestehendes Passwort.
- Die SQLite-Datenbank liegt über das Volume `./data:/app/data` außerhalb des
  Containers und übersteht damit Neustarts und Image-Updates.
- Ohne Docker Compose reicht auch direkt `docker build -t keks-werkzeugkasten .`
  und `docker run -p 4000:4000 -v $(pwd)/data:/app/data -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=... keks-werkzeugkasten`.

## Idee

- **Ein Dashboard** als kachelbasierte Übersicht – Suche, Kategorien, Hell/Dunkel.
- **Tools als Plugins**: jeder Ordner unter `tools/` mit einer `tool.json` ist ein Tool.
- **Automatische Erkennung**: kein Eintragen in Listen, kein Anfassen des Dashboard-Codes.

## Tool-Typen

| Typ      | Beschreibung                                             |
|----------|---------------------------------------------------------|
| `link`   | Kachel öffnet eine externe Website.                     |
| `page`   | Eigenständiges HTML/JS-Tool, läuft im Browser.          |
| `script` | Script (Node, Python, Shell …), wird serverseitig ausgeführt; die Ausgabe erscheint im Dashboard. |

## Neues Tool hinzufügen

Siehe **[`tools/_vorlage/README.md`](tools/_vorlage/README.md)**. Kurzfassung:

1. `tools/_vorlage/` kopieren und umbenennen (z. B. `tools/mein-tool/`).
2. `tool.json` anpassen.
3. Server neu starten – fertig.

## Projektstruktur

```
framework/
├── Dockerfile            # Node-Basis-Image, kein npm install nötig
├── docker-compose.yml    # Port-Mapping, Volume für data/, Env-Vars
├── .env.example          # Vorlage für .env (PORT, ADMIN_USERNAME, ADMIN_PASSWORD)
├── server.js            # Dashboard-Server (reines Node, keine Dependencies)
├── lib/                  # Auth & Datenbank-Helfer
│   ├── db.js             # SQLite-Schema + Zugriffs-Helper (node:sqlite)
│   └── auth.js           # Passwort-Hashing, Sessions, requireAuth/requireAdmin
├── data/                 # SQLite-Datei (wird automatisch angelegt, nicht versioniert)
├── public/              # Dashboard-Oberfläche
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── admin.html         # Userverwaltung für Admins
│   └── toolbox-client.js  # Gemeinsamer Client-Helfer für Login-Status & Tool-Daten
└── tools/               # Ein Ordner pro Tool
    ├── _vorlage/            # Vorlage + Anleitung (wird nicht angezeigt)
    ├── rampen-check/        # page (v1.0) – Rampen-/Zufahrt-Kollisionscheck
    ├── ifc-renamer/         # page (v1.0) – IFC Projekt/Site/Building umbenennen
    ├── regenwasser-rechner/ # page (v1.1) – Regenwasserabfluss nach DIN 1986-100
    ├── fahrtenbuch/         # page (v1.0) – Kunden/Fahrten erfassen, Distanzen via OSM, Jahresübersicht
    ├── schleppkurve/        # page (v0.11) – visuelle Schleppkurve, 2-achsig (Import, Routenplaner/Simulation mit Reeds-Shepp-Rückwärtsplanung + hindernisbewusster Suchheuristik/Visualisierung, Rahmen/Stützen, DXF/PDF-Export)
    ├── u-wert-rechner/      # link – U-Wert-Rechner (ubakus.de)
    └── dataholz/            # link – Holzbauteil-Katalog dataholz.eu
```

## Hinweis zur Ausführung von Scripts

`script`-Tools führen das in ihrer `tool.json` hinterlegte Kommando lokal auf
dem Rechner aus, auf dem der Server läuft. Da die Kommandos aus dem
versionierten Repository stammen, ist die Quelle nachvollziehbar. Betreibe das
Dashboard im internen Netz / lokal, nicht öffentlich erreichbar.

## Login & Userdaten

Das Dashboard und alle Tools bleiben auch ohne Login voll nutzbar. Mit einem
Account (Button oben rechts in der Toolbar) werden Daten statt im
`localStorage` des Browsers in einer lokalen SQLite-Datenbank
(`data/toolbox.sqlite`) gespeichert – damit sieht man seine Daten auf jedem
Gerät wieder.

- **Erster registrierter Account** wird automatisch als aktiver Admin
  angelegt (sonst könnte niemand weitere Accounts freischalten). Bei
  Docker-Betrieb kann dieser erste Admin-Account stattdessen auch direkt
  über `ADMIN_USERNAME`/`ADMIN_PASSWORD` vorgegeben werden (siehe „Start mit
  Docker" oben).
- Alle weiteren Registrierungen sind zunächst `pending` und müssen im
  Admin-Bereich (`/admin.html`, Link im Konto-Menü) freigeschaltet werden.
- Die Datenbank nutzt Node's eingebautes `node:sqlite` – bewusst gewählt,
  damit das Projekt weiterhin ohne `package.json`/`npm install` läuft. Node
  gibt dabei eine harmlose „experimental“-Warnung aus.
- `data/` ist in `.gitignore` (enthält Passwort-Hashes und Nutzdaten) und wird
  beim ersten Start automatisch angelegt.

**`fahrtenbuch` und `bauamt-links`**: einfache Daten (Kunden/Fahrten bzw.
gespeicherte Links) – beim ersten Login wird angeboten, vorhandene
Browser-Daten einmalig zu übernehmen.

**`rampen-check`, `regenwasser-rechner`, `schleppkurve`, `ifc-renamer`**:
diese Tools kennen zusätzlich **Projekte** – mehrere benannte, gespeicherte
Arbeitsstände pro Tool. Eingeloggte User sehen beim Öffnen dieser Tools immer
zuerst eine Projekt-Auswahl (bestehendes Projekt öffnen, umbenennen, löschen
oder ein neues anlegen); erst danach wird das Tool nutzbar. Über den Button
„⇄ Projekt wechseln" im Tool-Kopf kann jederzeit zu einem anderen Projekt
gewechselt werden, ohne die Seite neu zu laden. Ohne Login merken sich
`rampen-check`/`regenwasser-rechner` weiterhin nur den letzten Stand im
Browser (kein Projekt-Konzept). Wiederverwendbare Presets
(Schleppkurve-Fahrzeugprofile, IFC-Renamer-Favoriten) bleiben davon getrennt
und gelten global pro Account, unabhängig vom gewählten Projekt.

## Wichtiger Hinweis: Gewährleistung & Betriebsumgebung

- **Keine Gewähr für die Richtigkeit der Angaben.** Alle Tools können Fehler
  enthalten – Ergebnisse (Berechnungen, Maße, Kollisionsprüfungen etc.) sind
  ohne Gewähr und ersetzen keine fachliche Prüfung.
- **Das Login-/User-System ist ausschließlich für die interne Nutzung
  ausgelegt** (siehe Sicherheitshinweise oben: kein Rate-Limiting, kein
  2FA, einfache Bedrohungsannahmen). Ein öffentliches Hosting außerhalb
  eines internen/vertrauenswürdigen Netzes sollte erst nach einer
  gründlichen Sicherheitsüberprüfung und einem entsprechenden Umbau des
  Systems in Erwägung gezogen werden.

Dieser Hinweis wird auch auf der Werkzeugübersicht im Dashboard angezeigt.
