# Sichere Prüfung des Ursprungstabs

Stand: 30. August 2026

## Zweck dieses Schritts

Dieser erste Baustein von Phase 2 beantwortet ausschließlich die Frage:

> Besitzt der aktuelle Tab einen noch vorhandenen und eindeutig erreichbaren
> Ursprungstab?

Chromium trägt dafür bei Tabs, die aus einem anderen Tab geöffnet wurden, die
ID des Ursprungstabs in `openerTabId` ein. Backtrack liest diese Beziehung in
einem Manifest-V3-Hintergrundprozess (Service Worker) und prüft sie
konservativ. Es werden noch keine Tabs aktiviert oder geschlossen.

## Sicherheitsentscheidung

Backtrack akzeptiert die Beziehung nur, wenn alle folgenden Bedingungen
erfüllt sind:

- der aktuelle Tab und `openerTabId` besitzen gültige numerische IDs;
- ein Tab darf nicht auf sich selbst als Ursprung verweisen;
- der aktuelle Tab ist nicht angeheftet;
- der Ursprungstab kann unmittelbar über `chrome.tabs.get()` gefunden werden;
- der zurückgegebene Tab hat exakt die erwartete ID;
- beide Tabs befinden sich aktuell im selben Browserfenster;
- beide Tabs gehören entweder zum normalen oder zum privaten Browserkontext;
- der Ursprungstab wurde nicht vom Browser aus dem Speicher verworfen.

Wenn eine Bedingung nicht sicher bestätigt werden kann, lautet das Ergebnis
`ok: false`. Der spätere Aktionsschritt muss dann ohne automatisches Schließen
enden.

## Sonderfälle

| Situation | Entscheidung | Begründung |
| --- | --- | --- |
| Ursprungstab wurde geschlossen | Ablehnen | Die gespeicherte ID ist nicht mehr auflösbar. |
| Nur der neue Tab wurde in ein anderes Fenster verschoben | Ablehnen | Der Ursprung ist nicht mehr im selben sichtbaren Navigationskontext. |
| Beide Tabs wurden gemeinsam in dasselbe andere Fenster verschoben | Akzeptieren | Die aktuelle, eindeutige Beziehung im selben Fenster besteht fort. |
| Aktueller Tab ist angeheftet | Ablehnen | Automatisches Schließen eines angehefteten Tabs wäre überraschend. |
| Ursprungstab ist angeheftet | Akzeptieren | Er ist ein eindeutiges und stabiles Fokusziel; geschlossen würde nur der nicht angeheftete aktuelle Tab. |
| Tabs sind gruppiert | Akzeptieren | Die Gruppe ändert die eindeutige `openerTabId`-Beziehung nicht. |
| Ursprungstab wurde verworfen | Ablehnen | Das automatische Wiederladen und Fokussieren soll nicht nebenbei ausgelöst werden. |
| Normaler und privater Kontext unterscheiden sich | Ablehnen | Kontextgrenzen werden nicht überbrückt. |

## Verschachtelte Tabs

Eine Folge `Tab A → Tab B → Tab C` benötigt keinen gespeicherten Tab-Baum.
Backtrack prüft immer nur die unmittelbare Beziehung:

```text
Tab C → openerTabId von Tab C → Tab B
Tab B → openerTabId von Tab B → Tab A
```

Damit bleiben verschachtelte Ursprünge möglich, ohne eine eigene langfristige
Browserhistorie aufzubauen.

## Keine dauerhafte Speicherung

Die Prüfung verarbeitet nur kurzlebige Tab-Metadaten im Hintergrundprozess:

- Tab-ID;
- Fenster-ID;
- Ursprungstab-ID;
- aktiv, angeheftet, verworfen, privat und Gruppen-ID.

Die ausgegebenen Diagnoseobjekte enthalten keine URL, keinen Seitentitel, kein
Favicon und keinen Seiteninhalt. Seit Version `0.3.0` nutzt der getrennte
History-Baustein den flüchtigen Sitzungsspeicher (`storage.session`) für
nicht sprechende Navigationseintrags-Kennungen. Es gibt weiterhin keine lokale
Datenbank, keine dauerhafte Speicherung, keine Telemetrie und keine
Serververbindung.

## Berechtigung

Das Manifest fordert weiterhin keine `tabs`-Berechtigung an. Laut
[Chrome-Dokumentation zur Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
können die meisten Funktionen der API ohne zusätzliche Berechtigung verwendet
werden. Die `tabs`-Berechtigung wird insbesondere für sensible Eigenschaften
wie URL, Seitentitel und Favicon benötigt; Backtrack greift auf diese Felder
nicht zu.

Die seit Version `0.3.0` eingetragene Berechtigung `storage` gehört zum
getrennten History-Baustein. Warum dort ausschließlich `storage.session`
verwendet wird, ist in
[`internal-history.md`](internal-history.md) dokumentiert.

Der Hintergrundprozess ist als Modul-Service-Worker im Manifest eingetragen.
Die Ereignisempfänger werden entsprechend der
[Chrome-Dokumentation zu Erweiterungs-Service-Workern](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics)
direkt beim Laden registriert.

## Verpflichtung für spätere Tab-Aktionen

Ein positives Prüfergebnis ist keine dauerhafte Zusage. Tabs können zwischen
Prüfung und Aktion geschlossen oder verschoben werden. Bevor eine spätere
Version einen Ursprungstab aktiviert oder den aktuellen Tab schließt, muss sie
dieselbe Beziehung deshalb unmittelbar erneut auflösen und vollständig prüfen.

Die sichere Reihenfolge für den künftigen Aktionsschritt wird separat
entwickelt und getestet. Dieses Modul führt bewusst weder
`chrome.tabs.update()` noch `chrome.tabs.remove()` aus.

## Automatisierte Abdeckung

Die Tests prüfen unter anderem:

- gültige Herkunft und sichere Diagnosefelder;
- fehlenden oder geschlossenen Ursprung;
- verschachtelte Beziehungen;
- Fensterwechsel;
- angeheftete und gruppierte Tabs;
- verworfenen Ursprung;
- Selbstverweis, ID-Abweichung und privaten Kontext;
- die Nachrichtenschnittstelle zwischen Content Script und Hintergrundprozess.

Ausführen:

```sh
npm test
```

## Manueller Brave-Praxistest

Am 30. August 2026 wurde die entpackte Version `0.2.0` in Brave neu geladen.
Ein kontrolliert im selben Fenster erzeugter Kind-Tab trug die echte
`openerTabId` seines Ursprungstabs. Der Hintergrundprozess lieferte dafür:

```text
ok: true
reason: VALID_OPENER
```

Das Protokoll bestätigte zugleich den vorgesehenen Umfang: ausschließlich
Diagnose, keine Tab-Aktion und keine dauerhafte Speicherung.
