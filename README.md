# Backtrack

Backtrack untersucht, ob sich die normale horizontale Zwei-Finger-Geste von
Brave unter macOS in einer Chromium-Erweiterung zuverlässig erkennen lässt.

## Aktueller Stand

**Phase 2 – erster begrenzter Baustein.** Der Gesture-Proof-of-Concept aus
Phase 1 bleibt unverändert nutzbar. Zusätzlich prüft ein kleiner
Hintergrundprozess (Manifest-V3-Service-Worker) jetzt, ob ein neu geöffneter Tab
einen noch vorhandenen, eindeutigen Ursprungstab (`openerTabId`) im selben
Browserfenster besitzt. Die Erweiterung schließt oder aktiviert weiterhin
keine Tabs und verändert keine Browser-History.

Die entscheidenden echten Trackpad-Messungen ergeben ein **Conditional Go**:
Ein begrenzter Phase-2-Prototyp ist technisch vertretbar. DOM-`preventDefault()`
stoppt Braves native Zurück-Geste nicht; `overscroll-behavior-x: contain` am
Wurzelelement tat dies im kontrollierten Versuch. Vertikales Scrollen blieb
ohne Fehlkandidat, und der lokale horizontale Scrollbereich blieb auch mit
diesem Schutz bedienbar. Die sichere Herkunftsprüfung ist damit isoliert
umgesetzt. History-Erkennung und Tab-Aktionen folgen erst in getrennten
Schritten. Reale Tabellen, Carousels und komplexe Webanwendungen bleiben Teil
der offenen erweiterten Kompatibilitätsmatrix.

## Enthaltene Dateien

```text
manifest.json
package.json
src/background/opener-message-handler.js
src/background/opener-resolver.js
src/background/service-worker.js
src/content/gesture-debug.js
src/shared/messages.js
docs/gesture-fixture.html
docs/opener-safety.md
docs/gesture-research.md
tests/opener-message-handler.test.js
tests/opener-resolver.test.js
README.md
```

Es gibt bewusst keinen Build-Schritt und keine externen Abhängigkeiten. Brave
kann den Ordner direkt als entpackte Erweiterung laden. `package.json` enthält
nur den lokalen Testbefehl.

## Installation in Brave

1. `brave://extensions` öffnen.
2. Rechts oben den **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** wählen.
4. Diesen Projektordner auswählen.
5. Bereits geöffnete Testseiten neu laden.

Der Projektordner ist:

```text
/Users/bodhi/Documents/Codex/Backtrack
```

## Debug-Protokoll öffnen

1. Eine normale `https://`-Webseite öffnen.
2. Die Entwicklerwerkzeuge öffnen (`⌥⌘I`).
3. In der Konsole **Preserve log** beziehungsweise **Protokoll beibehalten**
   aktivieren. Das hilft beim Vergleichen von Rohdaten über ein Neuladen hinweg.
4. Die Protokollstufe **Verbose** einblenden. Einzelereignisse werden mit
   `console.debug` ausgegeben; Beginn, Ende und Schwellenüberschreitung einer
   Geste erscheinen zusätzlich als hervorgehobene Einträge.
5. Nach `[Backtrack:Gesture]` filtern.

Wichtig für echte Navigationsversuche: In der getesteten Brave-Version hat die
rechts angedockte DevTools-Konsole die native Zwei-Finger-Zurück-Navigation
selbst verhindert. DevTools eignen sich deshalb zum Erfassen der Ereignisse,
aber nicht als alleiniger Nachweis dafür, dass Backtrack die Browsernavigation
unterdrückt. Für diesen Test DevTools schließen und den tatsächlichen
Seitenwechsel beobachten.

### Herkunftsprüfung im Hintergrund

Die Diagnose der Tab-Herkunft erscheint nicht in der Webseitenkonsole, sondern
in der Konsole des Erweiterungs-Hintergrundprozesses:

1. `brave://extensions` öffnen.
2. Bei **Backtrack Development** auf den Link zum Service Worker klicken.
3. Aus einem vorhandenen Tab einen Link in einem neuen Tab öffnen.
4. Nach `[Backtrack:Opener]` filtern.

Ein Ergebnis mit `ok: true` bestätigt nur die eindeutige Herkunftsbeziehung.
Es löst keine Navigation aus. URLs, Seitentitel und Seiteninhalte werden dabei
weder protokolliert noch gespeichert.

Jedes Protokollobjekt besitzt ein Feld `kind`:

- `wheel`: einzelnes rohes und normalisiertes `wheel`-Ereignis;
- `session-start`: Beginn einer zusammengehörigen Ereignisfolge;
- `threshold-crossed`: nur ein vorläufiges Messsignal, niemals eine Aktion;
- `session-end`: Zusammenfassung und vorsichtige Einordnung;
- `post-dispatch-default-prevented`: die Webseite hat das Ereignis vermutlich
  nach dem Backtrack-Aufzeichner abgebrochen.

Abgeschlossene Messungen erscheinen zusätzlich als einzelne Zeile mit dem
Präfix `[Backtrack:Gesture:SessionJSON]`. Diese kompakte JSON-Zeile ist in
jedem JavaScript-Kontext der DevTools sichtbar. Für eine schnelle Auswertung
ist deshalb kein Wechsel zu **Backtrack Gesture Research** erforderlich.

Schwellenüberschreitungen erscheinen außerdem als
`[Backtrack:Gesture:ThresholdJSON]`. Diese zweite kompakte Zeile bewahrt den
letzten Scrollkontext bei eingeschaltetem **Protokoll beibehalten** auch dann,
wenn Brave die Seite vor dem normalen Ende der Messfolge verlässt.

`POSITIVE_X` und `NEGATIVE_X` sind absichtlich noch **nicht** als „zurück“ oder
„vorwärts“ bezeichnet. Welche Richtung welche Bedeutung hat, hängt von Gerät,
macOS-Einstellung und Browser ab und muss im Versuch bestimmt werden.

## Bedienung des Messwerkzeugs

Das Content Script läuft in einer von der Webseite getrennten JavaScript-Umgebung
(„isolierte Umgebung“, technisch: *isolated world*). Um die folgenden Befehle
zu verwenden, in der Konsole über die Kontextauswahl neben `top` den Eintrag
**Backtrack Gesture Research** wählen.

Status anzeigen:

```js
BacktrackGestureDebug.getStatus()
```

Messpuffer leeren:

```js
BacktrackGestureDebug.clearLog()
```

Aktuelle Ereignisfolge sofort abschließen und auswerten:

```js
BacktrackGestureDebug.finishSession()
```

Messungen als JSON kopieren:

```js
copy(BacktrackGestureDebug.exportJson())
```

Die Daten bleiben nur im Arbeitsspeicher des jeweiligen Seitenrahmens. Ein
Neuladen oder Schließen der Seite löscht sie. Es werden keine Daten versendet
oder dauerhaft gespeichert.

## Kontrollierter `preventDefault()`-Versuch

Standardmäßig beobachtet der PoC ausschließlich:

```js
BacktrackGestureDebug.getConfig().preventDefaultMode
// "off"
```

Für Testfall D kann das Abbrechen horizontal dominanter Einzelereignisse
vorübergehend aktiviert werden:

```js
BacktrackGestureDebug.configure({ preventDefaultMode: "horizontal" })
```

Danach unbedingt wieder ausschalten:

```js
BacktrackGestureDebug.configure({ preventDefaultMode: "off" })
```

Der Modus `horizontal` kann horizontales Scrollen auf der Testseite stören. Er
ist nur für einen kontrollierten Vergleich gedacht. Der noch stärkere Modus
`all` unterdrückt versuchsweise jedes abbrechbare `wheel`-Ereignis und sollte
nicht beim normalen Browsen aktiv bleiben.

Zusätzlich lässt sich für einen getrennten Vergleich die horizontale
Überlauf-Navigation am Wurzelelement per CSS begrenzen:

```js
BacktrackGestureDebug.setRootOverscrollBehavior("contain")
BacktrackGestureDebug.setRootOverscrollBehavior("unchanged")
```

Auch das ist nur ein Messschalter. `unchanged` stellt den zuvor vorhandenen
Inline-Wert wieder her.

## Manuelle Testfolge

Für jeden Test zuerst den Messpuffer leeren, genau eine Geste ausführen, kurz
warten und anschließend den JSON-Export sichern. Browser-Version,
macOS-Version, Trackpad-Modell und die Einstellung **Natürliche
Scrollrichtung** mitnotieren.

Für die kontrollierten Fälle B und C kann die lokale Testseite verwendet
werden. Im Projektordner starten:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Danach in Brave öffnen:

```text
http://127.0.0.1:8765/docs/gesture-fixture.html
```

Die Seite lädt keine externen Ressourcen. Ihr blauer Bereich beginnt in einer
mittleren horizontalen Position, sodass beide Richtungen getestet werden
können.

### A. Seite ohne horizontales Scrollen

- Eine einfache normale Webseite verwenden.
- Einmal mit zwei Fingern nach rechts, dann in einer neuen Messung nach links
  wischen.
- Vorzeichen, Ereignisanzahl, Gesamtdistanz und die native Browserreaktion
  notieren.

### B. Vertikal scrollbare Seite

- Mehrmals normal nach oben und unten scrollen.
- Erwartung des PoC: `session-end.evaluation.classification` bleibt
  `NO_CANDIDATE`, meistens wegen unzureichender horizontaler Dominanz.

### C. Horizontaler Scrollbereich

- Über einer großen Tabelle, einem Karussell oder einem horizontalen
  Codebereich wischen.
- Prüfen, ob `horizontalScrollContext` erkannt wird.
- Die Sicherheitsregel des PoC blockiert einen Kandidaten vorsorglich bereits,
  sobald die Geste innerhalb eines erkennbaren horizontalen Scrollbereichs
  stattfindet – unabhängig davon, ob der Bereich gerade an seinem Rand steht.

### D. Native Brave-Zurück-Geste

- Zuerst innerhalb desselben Tabs auf eine zweite Seite navigieren.
- Mit ausgeschaltetem `preventDefaultMode` die native Zurück-Geste ausführen.
- Prüfen, welche `wheel`-Ereignisse vor der Navigation sichtbar sind und ob die
  Folge vollständig wirkt.
- Den Versuch kontrolliert mit `preventDefaultMode: "horizontal"` wiederholen.
- Optional als getrennten dritten Versuch
  `setRootOverscrollBehavior("contain")` verwenden.
- Nach jedem Versuch die Schalter zurücksetzen.

### E. Momentum beziehungsweise Nachlauf

- Eine kurze, schnelle Bewegung ausführen und die Finger abheben.
- Prüfen, wie viele abklingende Ereignisse folgen.
- Der PoC besitzt nur eine ausdrücklich als unsicher markierte
  `DECAY_TAIL_ONLY`-Heuristik. Der Standard-`WheelEvent` liefert keine
  verlässliche Momentum-Phase.

Die vollständige Ergebnistabelle steht in
[`docs/gesture-research.md`](docs/gesture-research.md).

## Erste, bewusst konservative Heuristik

Eine Ereignisfolge wird nur als horizontaler **Messkandidat** eingeordnet, wenn:

- die Netto-Horizontaldistanz mindestens 80 normalisierte Pixel beträgt;
- die aufsummierte horizontale Bewegung mindestens 2,5-mal so groß wie die
  vertikale Bewegung ist;
- mindestens 80 Prozent der Horizontalbewegung in dieselbe Richtung gehen;
- kein erkennbarer horizontaler Scrollbereich beteiligt war;
- keine Zusatztaste gedrückt war;
- die Webseite das Standardverhalten nicht erkennbar selbst abgebrochen hat.

Diese Werte sind Startwerte für die Forschung, keine fertige
Produkterkennung. Der PoC meldet bei einer Schwellenüberschreitung nur
`threshold-crossed` und führt keinerlei Navigation aus.

## Berechtigungen und Datenschutz

| Zugriff | Warum benötigt? | Vermeidbar? | Theoretischer Datenzugriff |
| --- | --- | --- | --- |
| Keine ausdrücklich angeforderte Chrome-API-Berechtigung | Der Hintergrundprozess verwendet `chrome.tabs.onCreated` und `chrome.tabs.get()` nur für nicht sensible Tab-Eigenschaften wie IDs, Fenster, angeheftet/gruppiert und `openerTabId`. Dafür verlangt Chromium keine `tabs`-Berechtigung. | Bereits vermieden. Die besonders weitreichende `tabs`-Berechtigung wird nicht eingetragen. | Ohne `tabs`-Berechtigung erhält die Erweiterung über diese API insbesondere keine freigeschalteten Felder für URL, Seitentitel oder Favicon. |
| Automatisches Content Script auf `http://*/*` und `https://*/*` | Gesten müssen auf unterschiedlichen normalen Webseiten und möglichst früh beobachtet werden. | Für eine manuell pro Seite aktivierte Forschungsversion wäre `activeTab` möglich, würde aber Toolbar-Aktion, Service Worker und einen zusätzlichen Bedienungsschritt verlangen. Für eine Produktionsversion muss die Entscheidung neu bewertet werden. | Ein Content Script könnte grundsätzlich Seiten-DOM lesen oder verändern. Dieser PoC liest nur Ereignis-, Größen- und Scrollkontextdaten, protokolliert keine URL und sendet nichts. |

Die Erweiterung läuft nicht auf `brave://`, `chrome://`, im Chrome Web Store
oder auf anderen geschützten Browserseiten. `file://` ist ebenfalls nicht im
Manifest enthalten. Unterseiten in eingebetteten Rahmen werden nur erfasst,
wenn deren eigene Adresse ebenfalls `http://` oder `https://` verwendet.
Die Herkunftsprüfung speichert keinen Tab-Baum und keine Browser-History. Ihre
genauen Sicherheitsregeln stehen in
[`docs/opener-safety.md`](docs/opener-safety.md).

## Bekannte Grenzen des PoC

- Webinhalte erhalten nicht zwingend dieselben Informationen wie Braves
  native macOS-Gestenverarbeitung.
- Ein Standard-`WheelEvent` benennt das Eingabegerät nicht sicher als Trackpad
  oder Maus und stellt keine standardisierte Gesture-/Momentum-Phase bereit.
- Webseiten mit eigener JavaScript-Gestenlogik können wie ein normaler
  Scrollbereich aussehen oder sich dem DOM-Scrolltest vollständig entziehen.
- Entwicklertools müssen **Protokoll beibehalten**, wenn Logs eine echte
  Navigation überstehen sollen.
- Die Messpuffer mehrerer eingebetteter Seitenrahmen sind voneinander getrennt.
- Die hier erkannten Richtungen sind noch nicht semantisch als `BACK_GESTURE`
  oder `FORWARD_GESTURE` kalibriert.

## Quellen für die technische Ausgangslage

- [Chrome-Dokumentation zu Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome-Dokumentation zur Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome-Dokumentation zu Erweiterungs-Service-Workern](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics)
- [UI-Events-Spezifikation des W3C](https://www.w3.org/TR/uievents/)
- [Chromiums macOS-`HistorySwiper`](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/renderer_host/chrome_render_widget_host_view_mac_history_swiper.h)
- [Chromiums `OverscrollController`](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/renderer_host/overscroll_controller.cc)
- [Chrome-Dokumentation zu `overscroll-behavior`](https://developer.chrome.com/blog/overscroll-behavior/)

## Noch ausdrücklich nicht enthalten

- `chrome.tabs.remove()` oder `chrome.tabs.update()`
- History- oder SPA-Verfolgung
- gespeicherter Tab-Baum
- Optionsseite
- Telemetrie, Serverzugriffe oder dauerhafte Speicherung
