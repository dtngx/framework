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
├── server.js            # Dashboard-Server (reines Node, keine Dependencies)
├── public/              # Dashboard-Oberfläche
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── tools/               # Ein Ordner pro Tool
    ├── _vorlage/            # Vorlage + Anleitung (wird nicht angezeigt)
    ├── rampen-check/        # page (v1.0) – Rampen-/Zufahrt-Kollisionscheck
    ├── ifc-renamer/         # page (v1.0) – IFC Projekt/Site/Building umbenennen
    ├── regenwasser-rechner/ # page (v1.1) – Regenwasserabfluss nach DIN 1986-100
    ├── schleppkurve/        # page (v0.6) – visuelle Schleppkurve, 2-achsig (Import + DXF/PDF-Export)
    ├── u-wert-rechner/      # link – U-Wert-Rechner (ubakus.de)
    └── dataholz/            # link – Holzbauteil-Katalog dataholz.eu
```

## Hinweis zur Ausführung von Scripts

`script`-Tools führen das in ihrer `tool.json` hinterlegte Kommando lokal auf
dem Rechner aus, auf dem der Server läuft. Da die Kommandos aus dem
versionierten Repository stammen, ist die Quelle nachvollziehbar. Betreibe das
Dashboard im internen Netz / lokal, nicht öffentlich erreichbar.
