# Neues Tool anlegen

So fügst du ein Tool zur Toolbox hinzu – **ohne den Dashboard-Code anzufassen**.

## In 3 Schritten

1. Kopiere diesen Ordner `_vorlage/` und benenne die Kopie nach deinem Tool,
   z. B. `tools/fenster-u-wert/` (Kleinbuchstaben, Bindestriche, keine Leerzeichen).
2. Passe die `tool.json` an (siehe unten). Nicht benötigte Felder einfach löschen.
3. Server neu starten (`node server.js`) – das Tool erscheint automatisch als Kachel.

> Ordner, die mit `_` oder `.` beginnen, werden ignoriert (wie dieser hier).

## Die drei Tool-Typen

| `type`   | Wofür                                   | Wichtige Felder            |
|----------|-----------------------------------------|----------------------------|
| `link`   | Verweist auf eine externe Website       | `url`                      |
| `page`   | Eigenes HTML/JS-Tool, läuft im Browser  | `entry` (Start-HTML-Datei) |
| `script` | Script (Node/Python/Shell), serverseitig ausgeführt | `command`      |

### Beispiel `link`
```json
{ "name": "…", "type": "link", "url": "https://…", "icon": "link", "category": "Referenz" }
```

### Beispiel `page`
Lege deine `index.html` (und ggf. weitere Dateien) in den Tool-Ordner.
```json
{ "name": "…", "type": "page", "entry": "index.html", "icon": "ruler", "category": "Berechnung" }
```

Für das gemeinsame Aussehen (Farben, Buttons, Eingabefelder, Hell/Dunkel)
bindet die Seite das Design ein und kennzeichnet den Body als Tool:

```html
<head>
  <link rel="stylesheet" href="/design.css" />
  <script src="/theme.js"></script>
  <style>/* nur was dieses Tool zusätzlich braucht */</style>
</head>
<body class="tool">
  <div class="wrap" style="max-width: 960px">
    <a class="back" href="/">← Zurück zum Werkzeugkasten</a>
    <div class="head"><h1>Mein Tool</h1><span class="ver">v1.0</span></div>
    <p class="lead">Ein Satz, was das Tool macht.</p>
    <div class="panel">
      <input type="text" placeholder="Eingabe" />
      <button class="btn primary">Berechnen</button>
    </div>
  </div>
</body>
```

Bausteine aus `public/design.css`: `.btn` (sekundär), `.btn.primary` (Hauptaktion),
`.btn.active` (gewählter Modus), `.btn-sm`, `.btn-x`, `.panel`, `.hint`, `.mono`.
Farben nur über Variablen wie `var(--text)`, `var(--text-muted)`, `var(--surface)`,
`var(--border)`, `var(--accent)` – dann stimmt auch der Dunkelmodus.

### Beispiel `script`
Das `command` wird **im Tool-Ordner** ausgeführt. Ausgabe (stdout/stderr)
erscheint im Dashboard. Für Python z. B. `"command": "python3 main.py"`.
```json
{ "name": "…", "type": "script", "command": "node generate.js", "icon": "terminal", "category": "Automatisierung" }
```

## Felder-Referenz (tool.json)

- `name` – Anzeigename auf der Kachel *(Pflicht)*
- `description` – kurzer Text auf der Kachel
- `category` – gruppiert die Kachel im Filter (z. B. „Berechnung“, „Referenz“)
- `icon` – Name eines Liniensymbols aus `public/icons.js` (z. B. `car`, `truck`, `route`,
  `cloud-rain`, `thermometer`, `box`, `landmark`, `layers`, `tree`, `ruler`, `calculator`,
  `link`, `terminal`, `wrench`). Unbekannte Namen oder Emoji zeigen ein neutrales Symbol.
  Weitere Symbole: Pfad von [lucide.dev](https://lucide.dev) in `public/icons.js` ergänzen.
- `type` – `link` | `page` | `script`
- `url` – Ziel bei `link`
- `entry` – Start-HTML bei `page` (Standard: `index.html`)
- `command` – Shell-Kommando bei `script`
- `version` – Versionsnummer (z. B. `"1.0"`), wird als Badge auf der Kachel gezeigt.
  Für `link`-Tools nicht nötig – einfach weglassen.
- `tags` – Liste von Stichwörtern (für die Suche)
- `author` – optional
