/**
 * Gmail Datums-Kopierer & Versandplaner
 * ---------------------------------------------------------------
 * Nimmt EINE Vorlagen-E-Mail und erstellt für jedes unten aufgeführte
 * Datum:
 *   1. eine Kopie davon, bei der das Datum überall dort eingesetzt wird,
 *      wo der Platzhalter steht (Standard: {{datum}}),
 *   2. einen automatischen Versand dieser Kopie am Montag VOR diesem
 *      Datum, zur Uhrzeit VERSAND_STUNDE.
 *
 * Läuft als einfaches Google Apps Script auf deinem eigenen Gmail-Konto
 * — nichts zu installieren, kein Add-on zu veröffentlichen. Die
 * Einrichtung steht ganz unten in dieser Datei.
 *
 *
 * ZUM BEGRIFF "VORLAGE": Gmails eingebaute Vorlagen-Funktion (Einstellungen
 * > Erweitert > Vorlagen, "Entwurf als Vorlage speichern") hat keine
 * öffentliche Schnittstelle — Google hat weder für GmailApp noch für die
 * Gmail-API noch für irgendein Skript einen Weg freigegeben, diese
 * auszulesen. Die "Vorlage" hier ist deshalb ein ganz normaler
 * Gmail-Entwurf: E-Mail schreiben, speichern lassen (Gmail speichert
 * Entwürfe automatisch beim Tippen) und einfach im Entwurfsordner liegen
 * lassen — nicht "Als Vorlage speichern" verwenden, sondern als normalen
 * Entwurf belassen. Dieser Entwurf wird selbst nie verschickt; das
 * Skript liest nur seinen Inhalt aus, um die Kopien zu bauen.
 *
 * So funktioniert der "zukünftige Versand": Auch für Gmails eingebaute
 * Funktion "Später senden" gibt es keine öffentliche Schnittstelle.
 * Stattdessen legt dieses Skript für jede Kopie einen einmaligen,
 * zeitgesteuerten Apps-Script-Trigger an, der zum richtigen Zeitpunkt
 * feuert und genau diese Kopie verschickt. Im Ergebnis dasselbe — es
 * läuft nur auf Googles Servern statt in der Gmail-Oberfläche, funktioniert
 * also auch, wenn Browser oder Computer zum Versandzeitpunkt aus sind.
 *
 * BILDER IN DER VORLAGE: Wenn die Vorlage eingebettete Bilder enthält
 * (z. B. per Copy-Paste oder Drag&Drop direkt in den Mailtext eingefügt,
 * nicht als Anhang), verweist der HTML-Text der Vorlage auf diese Bilder
 * nur über eine "cid:"-Referenz (z. B. <img src="cid:ii_abc123">). Beim
 * Erstellen der Kopien wird deshalb zusätzlich zum reinen HTML-Text auch
 * das zugehörige Bildmaterial aus der Vorlage übernommen und der neuen
 * Kopie als eingebettetes Bild mitgegeben (siehe inlineBilderErmitteln_
 * unten) — sonst blieben in den Kopien nur die kaputten Bild-Platzhalter
 * übrig, weil die cid-Referenz sonst ins Leere zeigt.
 *
 * Zu wissende Grenze: Google erlaubt einem privaten Google-Konto maximal
 * 20 zeitgesteuerte Trigger pro Skript. Für eine Handvoll Termine reicht
 * das locker — sind irgendwann ~20+ ZIEL_DATEN gleichzeitig geplant,
 * schlagen weitere fehl (siehe Ansicht > Protokolle / Ausführungen für
 * Fehlermeldungen). Workspace-Konten (Arbeit/Schule) haben ein höheres
 * Limit.
 * ================================================================
 */
/** ======================= KONFIGURATION — hier anpassen ======================= */
// Welcher Entwurf als Vorlage dient, per Betreff ODER per ID — GENAU EINEN
// der beiden unten setzen (ID hat Vorrang, falls beide gesetzt sind). Die
// ID ist die zuverlässigere Wahl: sie kann nicht versehentlich den
// falschen Entwurf treffen und funktioniert auch weiter, wenn du später
// den Betreff änderst. Zu finden über meineVorlagenAuflisten().
//
// Per Betreff — muss exakt mit dem Betreff des Entwurfs übereinstimmen:
const VORLAGE_BETREFF = "Campus diesen Samstag";
// Per ID stattdessen (leer lassen "", um VORLAGE_BETREFF zu verwenden):
const VORLAGE_ENTWURF_ID = "";
// Platzhalter, nach dem im Betreff UND im Text der Vorlage gesucht wird —
// jedes Vorkommen wird durch das formatierte Datum der jeweiligen Kopie
// ersetzt.
const DATUM_PLATZHALTER = "{{datum}}";
// Wie das Datum in die E-Mail geschrieben wird. Siehe Apps Scripts
// Utilities.formatDate-Muster (dieselben Platzhalter wie bei Java
// SimpleDateFormat).
// Beispiel: "EEEE, d. MMMM yyyy" -> "Montag, 14. September 2026"
const DATUM_FORMAT = " d. MMMM yyyy";
// Uhrzeit (24h, in ZEITZONE unten), zu der der Montag-davor-Versand
// ausgelöst werden soll.
const VERSAND_STUNDE = 8;
// Verwendet standardmäßig die Zeitzone deines Apps-Script-Projekts
// (Projekteinstellungen im Editor auf script.google.com). Bei Bedarf fest
// eintragen, z. B. "Europe/Zurich" oder "Europe/Vaduz".
const ZEITZONE = Session.getScriptTimeZone();
// Fällt ein Zieldatum selbst auf einen Montag: soll der Versand an genau
// DIESEM Montag erfolgen, oder eine volle Woche früher ("davor" wörtlich
// genommen)? true = immer streng früher (empfohlen, entspricht "der
// Montag vor X" auch dann, wenn X selbst ein Montag ist).
const STRIKT_DAVOR = true;
// Die Daten, für die Kopien erstellt werden sollen, als "JJJJ-MM-TT".
// Beliebig viele hinzufügen.
const ZIEL_DATEN = [
"2026-09-20"
];
/** ===================== ENDE KONFIGURATION — Code ab hier ===================== */
function geplanteDatumsKopienErstellen() {
const vorlage = vorlageFinden_();
const nachricht = vorlage.getMessage();
const an = nachricht.getTo();
const cc = nachricht.getCc();
const bcc = nachricht.getBcc();
const betreffVorlage = nachricht.getSubject();
const htmlVorlage = nachricht.getBody();       // HTML-Version
const textVorlage = nachricht.getPlainBody();  // Nur-Text-Version als Fallback
// Eingebettete Bilder der Vorlage EINMAL ermitteln (nicht pro Kopie —
// sie sind für jede Kopie identisch) und jeder Kopie unten mitgeben.
const inlineBilder = inlineBilderErmitteln_(nachricht, htmlVorlage);
let erstellt = 0;
let uebersprungen = 0;
ZIEL_DATEN.forEach(function (datumStr) {
const zielDatum = datumParsen_(datumStr);
const versandDatum = montagDavor_(zielDatum);
versandDatum.setHours(VERSAND_STUNDE, 0, 0, 0);
if (versandDatum.getTime() <= Date.now()) {
Logger.log(
"ÜBERSPRUNGEN " + datumStr + " — berechnetes Versanddatum " +
versandDatum + " liegt bereits in der Vergangenheit."
      );
uebersprungen++;
return;
    }
const formatiertesDatum = Utilities.formatDate(zielDatum, ZEITZONE, DATUM_FORMAT);
const betreff = betreffVorlage.split(DATUM_PLATZHALTER).join(formatiertesDatum);
const htmlText = htmlVorlage.split(DATUM_PLATZHALTER).join(formatiertesDatum);
const reinerText = textVorlage.split(DATUM_PLATZHALTER).join(formatiertesDatum);
const neuerEntwurf = GmailApp.createDraft(an, betreff, reinerText, {
htmlBody: htmlText,
cc: cc,
bcc: bcc,
inlineImages: inlineBilder,
    });
versandPlanen_(neuerEntwurf.getId(), versandDatum);
Logger.log(
"ERSTELLT: Kopie für " + datumStr + " — wird versendet am " +
versandDatum + " (Entwurfs-ID " + neuerEntwurf.getId() + ")"
    );
erstellt++;
  });
Logger.log(erstellt + " Entwurf/Entwürfe geplant, " + uebersprungen + " übersprungen (Versanddatum in der Vergangenheit).");
}
/**
 * Listet jeden Entwurf mit ID und Betreff im Protokoll auf (Ansicht >
 * Protokolle) — inklusive deiner Vorlage — damit du bei Bedarf eine
 * VORLAGE_ENTWURF_ID findest, falls der Abgleich per Betreff nicht
 * eindeutig ist (z. B. mehrere Entwürfe mit demselben Betreff). Zeigt
 * nichts an, was über Gmails eigene "Vorlagen"-Funktion gespeichert wurde
 * — siehe die Anmerkung ganz oben in dieser Datei dazu.
 */
function meineVorlagenAuflisten() {
GmailApp.getDrafts().forEach(function (d) {
const m = d.getMessage();
Logger.log(d.getId() + "  |  " + m.getSubject());
  });
}
/**
 * Bricht jeden von diesem Skript geplanten, noch ausstehenden Versand ab
 * und löscht die zugehörigen, noch nicht versendeten Entwurfskopien.
 * Damit lässt sich ein Durchlauf rückgängig machen, z. B. nach einem Test
 * oder einem Fehler in ZIEL_DATEN. Bereits versendete Kopien sind davon
 * nicht betroffen.
 */
function allePlanungenLoeschen() {
const props = PropertiesService.getScriptProperties();
let geloescht = 0;
const alle = props.getProperties();
ScriptApp.getProjectTriggers().forEach(function (trigger) {
if (trigger.getHandlerFunction() !== "geplantenEntwurfSenden_") return;
const schluessel = "ausstehend_" + trigger.getUniqueId();
const roh = alle[schluessel];
if (roh) {
try {
const daten = JSON.parse(roh);
GmailApp.getDraft(daten.entwurfId).deleteDraft();
      } catch (err) {
// bereits versendet, bereits gelöscht, oder defekter Eintrag — ignorieren
      }
props.deleteProperty(schluessel);
    }
ScriptApp.deleteTrigger(trigger);
geloescht++;
  });
Logger.log(geloescht + " ausstehende Planung(en) storniert.");
}
/**
 * Zeigt im Protokoll (Ansicht > Protokolle) alle aktuell ausstehenden
 * geplanten Sendungen mit Entwurfs-ID und geplantem Versandzeitpunkt an.
 * Nützlich zur Kontrolle, DASS wirklich etwas geplant ist — im Gegensatz
 * zum Gmail-Entwurfsordner selbst zeigt Gmail diese Planung nirgendwo an
 * (siehe Anmerkung oben in dieser Datei), diese Funktion schon.
 */
function geplanteSendungenAnzeigen() {
const props = PropertiesService.getScriptProperties();
const alle = props.getProperties();
const eintraege = Object.keys(alle).filter(function (k) {
return k.indexOf("ausstehend_") === 0;
  });
if (eintraege.length === 0) {
Logger.log("Keine ausstehenden geplanten Sendungen gefunden.");
return;
  }
eintraege.forEach(function (k) {
try {
const daten = JSON.parse(alle[k]);
Logger.log("Entwurf " + daten.entwurfId + "  ->  geplant für " + new Date(daten.faelligAb));
    } catch (err) {
Logger.log("Defekter Eintrag übersprungen: " + k);
    }
  });
}
/** ======================= Interna — hier muss nichts angepasst werden ======================= */
function vorlageFinden_() {
if (VORLAGE_ENTWURF_ID) {
return GmailApp.getDraft(VORLAGE_ENTWURF_ID);
  }
const treffer = GmailApp.getDrafts().find(function (d) {
return d.getMessage().getSubject() === VORLAGE_BETREFF;
  });
if (!treffer) {
throw new Error(
'Kein Entwurf mit dem Betreff "' + VORLAGE_BETREFF + '" gefunden. ' +
"meineVorlagenAuflisten() ausführen, um exakte Betreffs/IDs zu sehen, " +
"dann VORLAGE_BETREFF korrigieren oder VORLAGE_ENTWURF_ID setzen."
    );
  }
return treffer;
}
/**
 * Ermittelt die in der Vorlage EINGEBETTETEN Bilder (nicht normale
 * Datei-Anhänge) und liefert sie als Objekt {cid: Blob} zurück, so wie
 * es GmailApp.createDraft() im Options-Parameter "inlineImages" erwartet.
 *
 * Hintergrund: nachricht.getBody() liefert HTML, in dem eingebettete
 * Bilder nur als <img src="cid:XYZ"> referenziert werden — die
 * eigentlichen Bilddaten stecken als eigene MIME-Teile in der
 * Original-Nachricht und werden von getBody() NICHT mitkopiert. Ohne
 * diese Funktion enthält jede erstellte Kopie also nur die kaputte
 * cid-Referenz, aber kein Bild mehr (das Symptom, das behoben wird).
 *
 * Funktionsweise: Apps Script gibt uns leider keine direkte Zuordnung
 * "dieses Bild gehört zu dieser cid" — deshalb werden die cid-Referenzen
 * aus dem HTML in der Reihenfolge ihres Auftretens ausgelesen und der
 * Reihe nach den eingebetteten Bildern zugeordnet, die
 * getAttachments({includeInlineImages: true, includeAttachments: false})
 * liefert. Das entspricht in der Praxis zuverlässig der tatsächlichen
 * Zuordnung, weil Gmail beide Listen in derselben Reihenfolge aufbaut,
 * in der die Bilder ursprünglich in die Vorlage eingefügt wurden.
 * Normale Datei-Anhänge (nicht im Text sichtbare Bilder/Dokumente) sind
 * hiervon nicht betroffen und werden weiterhin nicht in die Kopien
 * übernommen.
 */
function inlineBilderErmitteln_(nachricht, html) {
const cidMuster = /cid:([^"'>\s]+)/gi;
const cids = [];
let treffer;
while ((treffer = cidMuster.exec(html)) !== null) {
if (cids.indexOf(treffer[1]) === -1) cids.push(treffer[1]);
  }
if (cids.length === 0) return {};
const inlineAnhaenge = nachricht.getAttachments({
includeInlineImages: true,
includeAttachments: false,
  });
if (inlineAnhaenge.length !== cids.length) {
Logger.log(
"WARNUNG: " + cids.length + " Bild-Referenz(en) im HTML der Vorlage gefunden, " +
"aber " + inlineAnhaenge.length + " eingebettete(s) Bild(er) im Entwurf. " +
"Die Zuordnung erfolgt nach Reihenfolge und kann falsch sein, wenn diese " +
"beiden Zahlen nicht übereinstimmen — im Zweifel Vorlage prüfen: enthält " +
"sie Bilder als normale Anhänge statt eingebettet, oder mehrfach " +
"dasselbe Bild eingefügt?"
    );
  }
const inlineBilder = {};
cids.forEach(function (cid, i) {
if (inlineAnhaenge[i]) {
inlineBilder[cid] = inlineAnhaenge[i].copyBlob();
    }
  });
return inlineBilder;
}
// "JJJJ-MM-TT" -> lokales Date um Mitternacht (vermeidet Verschiebungen um
// einen Tag durch UTC, die new Date("JJJJ-MM-TT") je nach Zeitzone
// verursachen kann).
function datumParsen_(datumStr) {
const teile = datumStr.split("-").map(Number);
return new Date(teile[0], teile[1] - 1, teile[2]);
}
// Gibt ein neues Date zurück, gesetzt auf den Montag vor `datum`.
function montagDavor_(datum) {
const d = new Date(datum.getTime());
const wochentag = d.getDay(); // 0=So, 1=Mo, ..., 6=Sa
let versatz = (wochentag + 6) % 7; // Tage zurück zum letzten Montag (0, falls datum selbst ein Montag ist)
if (versatz === 0 && STRIKT_DAVOR) {
versatz = 7; // Datum ist selbst ein Montag -> eine volle Woche früher
  }
d.setDate(d.getDate() - versatz);
return d;
}
function versandPlanen_(entwurfId, wann) {
const trigger = ScriptApp.newTrigger("geplantenEntwurfSenden_")
    .timeBased()
    .at(wann)
    .create();
const schluessel = "ausstehend_" + trigger.getUniqueId();
PropertiesService.getScriptProperties().setProperty(
schluessel,
JSON.stringify({ entwurfId: entwurfId, faelligAb: wann.getTime() })
  );
}
// Trigger-Ziel — nicht direkt aufrufen, und nicht umbenennen ohne auch die
// Prüfung von getHandlerFunction() in allePlanungenLoeschen() anzupassen.
//
// Ignoriert bewusst das Event-Objekt und durchsucht stattdessen die
// Script Properties nach allem, was tatsächlich fällig ist. Das ist
// robuster, als sich auf die Trigger-ID aus dem Event zu verlassen (für
// zeitgesteuerte Trigger nicht dokumentiert) — jede Ausführung verschickt
// einfach alles, was seit der letzten Prüfung fällig geworden ist, und
// heilt sich selbst, falls eine Ausführung einmal ausfällt oder sich
// verzögert.
function geplantenEntwurfSenden_() {
const props = PropertiesService.getScriptProperties();
const alle = props.getProperties();
const jetzt = Date.now();
Object.keys(alle).forEach(function (schluessel) {
if (schluessel.indexOf("ausstehend_") !== 0) return;
let daten;
try {
daten = JSON.parse(alle[schluessel]);
    } catch (err) {
props.deleteProperty(schluessel); // defekter Eintrag, verwerfen
return;
    }
if (daten.faelligAb > jetzt) return; // noch nicht fällig
try {
GmailApp.getDraft(daten.entwurfId).send();
Logger.log("VERSENDET: Entwurf " + daten.entwurfId);
    } catch (err) {
Logger.log("FEHLGESCHLAGEN beim Versenden von Entwurf " + daten.entwurfId + ": " + err);
    } finally {
props.deleteProperty(schluessel);
const uid = schluessel.substring("ausstehend_".length);
ScriptApp.getProjectTriggers().forEach(function (t) {
if (t.getUniqueId() === uid) ScriptApp.deleteTrigger(t);
      });
    }
  });
}
/**
 * ============================ EINRICHTUNG ============================
 * 1. In Gmail die Vorlagen-E-Mail schreiben und als normalen Entwurf
 *    speichern lassen (Gmail speichert Entwürfe automatisch beim Tippen —
 *    nicht "Als Vorlage speichern" verwenden, einfach im Entwurfsordner
 *    belassen). {{datum}} (oder was auch immer bei DATUM_PLATZHALTER
 *    eingetragen ist) dort einfügen, wo im Betreff und/oder Text das
 *    Datum erscheinen soll. Bilder direkt in den Text einfügen (per
 *    Drag&Drop oder Copy-Paste), nicht als separaten Anhang beifügen —
 *    nur eingebettete Bilder werden von diesem Skript in die Kopien
 *    übernommen.
 *
 * 2. Zu https://script.google.com gehen -> "Neues Projekt".
 *
 * 3. Den Platzhalter-Code dort löschen, diese gesamte Datei einfügen.
 *
 * 4. Den KONFIGURATION-Block oben anpassen: VORLAGE_BETREFF (muss exakt
 *    mit dem Betreff des Entwurfs übereinstimmen — am besten
 *    kopieren/einfügen; alternativ VORLAGE_ENTWURF_ID verwenden, siehe
 *    Kommentar darüber), DATUM_FORMAT, VERSAND_STUNDE und die Liste
 *    ZIEL_DATEN.
 *
 * 5. Speichern (Strg/Cmd+S). Im Funktions-Dropdown oben
 *    "geplanteDatumsKopienErstellen" auswählen, dann auf "Ausführen"
 *    klicken.
 *
 * 6. Nur beim ersten Mal: Google fragt nach Berechtigung für Gmail-Zugriff
 *    und zur Verwaltung von Triggern im eigenen Konto. Auf "Erweitert" ->
 *    "Zu (Projektname) wechseln (nicht sicher)" klicken — diese Warnung
 *    ist bei eigenen, privaten Skripten normal, da Google sie nicht
 *    geprüft hat (nur man selbst führt sie aus). Genehmigen, dann erneut
 *    auf "Ausführen" klicken.
 *
 * 7. Unter Ansicht -> Protokolle (oder Ausführungen) prüfen, wie viele
 *    Kopien erstellt wurden, und im Gmail-Entwurfsordner nachsehen — dort
 *    erscheint pro Datum eine Kopie, jeweils mit bereits eingesetztem
 *    Datum und (falls vorhanden) eingesetzten Bildern.
 *
 * 8. Sonst ist nichts mehr zu tun — jede Kopie verschickt sich selbst
 *    automatisch um VERSAND_STUNDE am Montag vor ihrem Datum, auch wenn
 *    dieser Browser-Tab oder der Computer geschlossen ist. Um einen
 *    Durchlauf komplett rückgängig zu machen, dieses Skript erneut öffnen
 *    und allePlanungenLoeschen() ausführen.
 * ================================================================
 */
