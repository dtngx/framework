#!/usr/bin/env node
'use strict';

/*
 * Projektstruktur-Generator
 * -------------------------------------------------------------
 * Legt eine standardisierte Ordnerstruktur für ein Bauprojekt an,
 * orientiert an den HOAI-Leistungsphasen.
 *
 * Aufruf (aus dem Dashboard oder Terminal):
 *   node generate.js [Zielverzeichnis]
 *
 * Ohne Argument wird ein Ordner "Neues-Projekt_<Datum>" im
 * aktuellen Verzeichnis erstellt.
 */

const fs = require('fs');
const path = require('path');

// Standard-Ordnerstruktur nach HOAI-Leistungsphasen
const STRUCTURE = {
  '00_Projektmanagement': ['Verträge', 'Termine', 'Protokolle'],
  '01_Grundlagenermittlung_LP1': [],
  '02_Vorplanung_LP2': ['Skizzen', 'Varianten'],
  '03_Entwurfsplanung_LP3': ['Pläne', 'Visualisierung'],
  '04_Genehmigungsplanung_LP4': ['Bauantrag', 'Nachweise'],
  '05_Ausführungsplanung_LP5': ['Werkpläne', 'Details'],
  '06_Vorbereitung_Vergabe_LP6': ['Leistungsverzeichnisse'],
  '07_Mitwirkung_Vergabe_LP7': ['Angebote', 'Preisspiegel'],
  '08_Objektüberwachung_LP8': ['Bautagebuch', 'Abnahmen', 'Fotos'],
  '09_Objektbetreuung_LP9': [],
  '10_Schriftverkehr': ['Eingang', 'Ausgang'],
  '99_Archiv': [],
};

function main() {
  const arg = process.argv[2];
  const stamp = new Date().toISOString().slice(0, 10);
  const base = path.resolve(arg || `Neues-Projekt_${stamp}`);

  if (fs.existsSync(base)) {
    console.error(`⚠  Zielordner existiert bereits: ${base}`);
    console.error('   Bitte anderen Namen wählen oder Ordner entfernen.');
    process.exit(1);
  }

  fs.mkdirSync(base, { recursive: true });
  let count = 1;

  for (const [top, subs] of Object.entries(STRUCTURE)) {
    const topPath = path.join(base, top);
    fs.mkdirSync(topPath, { recursive: true });
    count++;
    for (const sub of subs) {
      fs.mkdirSync(path.join(topPath, sub), { recursive: true });
      count++;
    }
  }

  // README als Orientierung im Projektordner ablegen
  const readme = [
    `# Projektordner`,
    ``,
    `Erstellt am ${stamp} mit dem Projektstruktur-Generator der Architektur-Toolbox.`,
    ``,
    `Struktur nach HOAI-Leistungsphasen. Bitte Dateien in den passenden`,
    `Leistungsphasen-Ordnern ablegen.`,
    ``,
  ].join('\n');
  fs.writeFileSync(path.join(base, 'README.md'), readme, 'utf8');

  console.log('✓ Projektstruktur angelegt.');
  console.log(`  Ort:     ${base}`);
  console.log(`  Ordner:  ${count} angelegt`);
  console.log('');
  console.log('Nächster Schritt: Ordner umbenennen (Projektnummer/-name) und ins Projektlaufwerk verschieben.');
}

main();
