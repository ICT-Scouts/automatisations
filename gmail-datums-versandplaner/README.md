# Gmail Datums-Kopierer & Versandplaner

Ein Google Apps Script (läuft auf script.google.com, nicht hier im Repo).
Nimmt einen Gmail-Entwurf als Vorlage und erstellt für jedes konfigurierte
Datum eine Kopie mit eingesetztem Datum, geplant zum Versand am Montag davor.

Diese Datei hier ist eine **Kopie zur Ablage/Versionierung** — der Code,
der tatsächlich läuft, liegt als eigenes Projekt in Google Apps Script
(https://script.google.com, "Meine Projekte"). Diese lokale Kopie wird
nicht automatisch synchronisiert; nach jeder Änderung am Live-Skript
den Stand am besten hier nachziehen (oder umgekehrt).

## Fix vom 2026-09-15: Bilder in der Vorlage

Bilder, die direkt in den Text der Vorlagen-Mail eingefügt waren (nicht
als Anhang), wurden in den erstellten Kopien nicht übernommen — nur ein
kaputter Bild-Platzhalter blieb übrig.

Ursache: `nachricht.getBody()` liefert HTML, in dem eingebettete Bilder
nur als `<img src="cid:XYZ">` referenziert sind. Die eigentlichen
Bilddaten sitzen als eigene MIME-Teile in der Original-Nachricht und
wurden vom Skript nie mitkopiert — die neue Kopie enthielt also die
cid-Referenz, aber nirgendwo das dazugehörige Bild.

Behoben durch die neue Funktion `inlineBilderErmitteln_()`: liest die
cid-Referenzen aus dem HTML aus, holt die eingebetteten Bilder der
Vorlage über `getAttachments({includeInlineImages: true,
includeAttachments: false})`, ordnet beides der Reihenfolge nach einander
zu und gibt das Ergebnis als `inlineImages`-Option an
`GmailApp.createDraft()` weiter. Wird einmal pro Lauf berechnet (nicht
pro Datum), da für alle Kopien identisch.

Bekannte Grenze: die Zuordnung Bild ↔ cid erfolgt nach Reihenfolge, weil
Apps Script keine direkte cid-Zuordnung herausgibt. Bei normalen
Vorlagen (Bilder in der Reihenfolge eingefügt, in der sie im Text
erscheinen) ist das zuverlässig. Falls die Anzahl gefundener
cid-Referenzen nicht mit der Anzahl eingebetteter Bilder übereinstimmt,
schreibt das Skript eine Warnung ins Protokoll (Ansicht > Protokolle).
Bilder, die als normaler Datei-Anhang (nicht im Text sichtbar)
beigefügt sind, werden weiterhin nicht übernommen — das war schon vorher
so und ist unverändert.
