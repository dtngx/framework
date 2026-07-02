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
{ "name": "…", "type": "link", "url": "https://…", "icon": "🔗", "category": "Referenz" }
```

### Beispiel `page`
Lege deine `index.html` (und ggf. weitere Dateien) in den Tool-Ordner.
```json
{ "name": "…", "type": "page", "entry": "index.html", "icon": "📐", "category": "Berechnung" }
```

### Beispiel `script`
Das `command` wird **im Tool-Ordner** ausgeführt. Ausgabe (stdout/stderr)
erscheint im Dashboard. Für Python z. B. `"command": "python3 main.py"`.
```json
{ "name": "…", "type": "script", "command": "node generate.js", "icon": "⚙️", "category": "Automatisierung" }
```

## Felder-Referenz (tool.json)

- `name` – Anzeigename auf der Kachel *(Pflicht)*
- `description` – kurzer Text auf der Kachel
- `category` – gruppiert die Kachel im Filter (z. B. „Berechnung“, „Referenz“)
- `icon` – ein Emoji als Symbol
- `type` – `link` | `page` | `script`
- `url` – Ziel bei `link`
- `entry` – Start-HTML bei `page` (Standard: `index.html`)
- `command` – Shell-Kommando bei `script`
- `tags` – Liste von Stichwörtern (für die Suche)
- `author` – optional
