# Backtrack

Backtrack untersucht, ob sich die normale horizontale Zwei-Finger-Geste von
Brave unter macOS in einer Chromium-Erweiterung zuverlässig erkennen lässt.

## Aktueller Stand

**Phase 2 – zwei begrenzte Bausteine.** Der Gesture-Proof-of-Concept aus
Phase 1 bleibt unverändert nutzbar. Ein kleiner Hintergrundprozess
(Manifest-V3-Service-Worker) prüft, ob ein neu geöffneter Tab einen noch
vorhandenen, eindeutigen Ursprungstab (`openerTabId`) im selben Browserfenster
besitzt. Zusätzlich unterscheidet Backtrack jetzt zwischen interner
Zurück-Historie und dem ursprünglichen Einstieg des Kind-Tabs. Das gilt für
vollständige Seitenwechsel und für Einzelseiten-Apps, die
`history.pushState()` oder `history.replaceState()` verwenden.

Die Erweiterung gibt dabei nur eine Diagnoseentscheidung aus. Sie schließt
oder aktiviert weiterhin keine Tabs und verändert keine Browser-History.

Die entscheidenden echten Trackpad-Messungen ergeben ein **Conditional Go**:
Ein begrenzter Phase-2-Prototyp ist technisch vertretbar. DOM-`preventDefault()`
stoppt Braves native Zurück-Geste nicht; `overscroll-behavior-x: contain` am
Wurzelelement tat dies im kontrollierten Versuch. Vertikales Scrollen blieb
ohne Fehlkandidat, und der lokale horizontale Scrollbereich blieb auch mit
diesem Schutz bedienbar. Die sichere Herkunftsprüfung ist damit isoliert
umgesetzt. Die konservative History-Erkennung ist ebenfalls isoliert
umgesetzt. Tab-Aktionen folgen erst im nächsten getrennten Schritt. Reale
Tabellen, Carousels und komplexe Webanwendungen bleiben Teil der offenen
erweiterten Kompatibilitätsmatrix.

## Enthaltene Dateien

```text
manifest.json
package.json
src/background/opener-message-handler.js
src/background/opener-resolver.js
src/background/back-decision.js
src/background/navigation-message-handler.js
src/background/navigation-tracker.js
src/background/service-worker.js
src/content/gesture-debug.js
src/content/navigation-state.js
src/shared/messages.js
src/shared/navigation-snapshot.js
docs/gesture-fixture.html
docs/navigation-fixture.html
docs/opener-safety.md
docs/internal-history.md
docs/gesture-research.md
tests/back-decision.test.js
tests/navigation-message-handler.test.js
tests/navigation-snapshot.test.js
tests/navigation-tracker.test.js
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

### Interne History prüfen

Auf normalen Seiten protokolliert `[Backtrack:Navigation]` die lokale
History-Messung. Im isolierten Backtrack-Kontext der DevTools kann die aktuelle
Entscheidung außerdem direkt abgefragt werden:

```js
BacktrackNavigationState.requestBackDecision()
```

Die Antwort bedeutet:

- `USE_INTERNAL_HISTORY`: Der Tab besitzt noch eine interne Zurückstufe.
- `RETURN_TO_OPENER_ELIGIBLE`: Der Tab ist wieder an seinem erfassten Einstieg
  und der Ursprung ist weiterhin sicher.
- `NO_SPECIAL_ACTION`: Die Daten sind unvollständig, widersprüchlich oder der
  Ursprung ist nicht mehr sicher.

Alle drei Antworten sind in Version `0.3.0` reine Diagnose. Eine lokale
Testseite für klassische und SPA-artige Wechsel ist unter
[`docs/navigation-fixture.html`](docs/navigation-fixture.html) enthalten. Die
technische Herleitung und alle Sicherheitsgrenzen stehen in
[`docs/internal-history.md`](docs/internal-history.md).

Der manuelle Praxistest mit Brave `152.1.94.117` bestätigte am 30. August 2026
die vollständige Folge: Einstieg → zwei SPA-Schritte → zweimal zurück zum
Einstieg sowie einen vollständigen Dokumentwechsel. Die jeweilige Diagnose
wechselte erst am wirklichen Einstieg von `USE_INTERNAL_HISTORY` zu
`RETURN_TO_OPENER_ELIGIBLE`.

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
| `storage` | `chrome.storage.session` hält die nicht sprechende Einstiegskennung im Arbeitsspeicher, auch wenn Chromium den kurzlebigen Hintergrundprozess schlafen legt und neu startet. | Nicht sicher vermeidbar. Ein verlorener Einstieg dürfte nicht durch eine erfundene neue Grundlinie ersetzt werden. | Die Berechtigung könnte theoretisch auch dauerhaften Erweiterungsspeicher öffnen. Backtrack verwendet ausschließlich den flüchtigen Sitzungsspeicher und legt dort keine URLs, Titel oder Inhalte ab. |
| Keine `tabs`-Berechtigung | Der Hintergrundprozess verwendet `chrome.tabs.onCreated` und `chrome.tabs.get()` nur für nicht sensible Tab-Eigenschaften wie IDs, Fenster, angeheftet/gruppiert und `openerTabId`. | Bereits vermieden. | Ohne `tabs`-Berechtigung erhält die Erweiterung über diese API insbesondere keine freigeschalteten Felder für URL, Seitentitel oder Favicon. |
| Keine `webNavigation`-Berechtigung | Vollständige Seitenwechsel und SPA-Routen werden über die Navigation API im Content Script erkannt. | Bereits vermieden. | Backtrack erhält dadurch keine zusätzliche Erweiterungs-Schnittstelle für Navigationsereignisse und Adressen. |
| Automatisches Content Script auf `http://*/*` und `https://*/*` | Gesten und Wechsel der Browser-History müssen auf unterschiedlichen normalen Webseiten möglichst früh beobachtet werden. | Für eine manuell pro Seite aktivierte Forschungsversion wäre `activeTab` möglich, würde aber Toolbar-Aktion, Service Worker und einen zusätzlichen Bedienungsschritt verlangen. Für eine Produktionsversion muss die Entscheidung neu bewertet werden. | Ein Content Script könnte grundsätzlich Seiten-DOM lesen oder verändern. Backtrack verarbeitet nur Ereignis-, Größen- und Scrollkontextdaten sowie nicht sprechende Navigationseintrags-Kennungen. Es protokolliert keine URL und sendet nichts an einen Server. |

Die Erweiterung läuft nicht auf `brave://`, `chrome://`, im Chrome Web Store
oder auf anderen geschützten Browserseiten. `file://` ist ebenfalls nicht im
Manifest enthalten. Unterseiten in eingebetteten Rahmen werden nur erfasst,
wenn deren eigene Adresse ebenfalls `http://` oder `https://` verwendet.
Die Herkunftsprüfung speichert keinen dauerhaften Tab-Baum und keine Adressen
aus der Browser-History. Ihre genauen Sicherheitsregeln stehen in
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
- Tabs, die bereits vor dem Laden oder Neuladen der Erweiterung offen waren,
  erhalten aus Sicherheitsgründen keinen nachträglich erfundenen Einstieg.
- Nach einem Browserneustart oder Erweiterungs-Neuladen ist der flüchtige
  History-Zustand weg. Der betroffene Tab bleibt dann unangetastet.
- Geschützte Browserseiten, auf denen kein Content Script laufen darf, liefern
  keine History-Messung und führen zu keiner besonderen Aktion.

## Quellen für die technische Ausgangslage

- [Chrome-Dokumentation zu Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome-Dokumentation zur Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome-Dokumentation zur Navigation API](https://developer.chrome.com/docs/web-platform/navigation-api/)
- [WHATWG-Spezifikation der Navigation API](https://html.spec.whatwg.org/multipage/nav-history-apis.html)
- [Chrome-Dokumentation zur Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage/)
- [Chrome-Dokumentation zu Erweiterungs-Service-Workern](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics)
- [UI-Events-Spezifikation des W3C](https://www.w3.org/TR/uievents/)
- [Chromiums macOS-`HistorySwiper`](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/renderer_host/chrome_render_widget_host_view_mac_history_swiper.h)
- [Chromiums `OverscrollController`](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/renderer_host/overscroll_controller.cc)
- [Chrome-Dokumentation zu `overscroll-behavior`](https://developer.chrome.com/blog/overscroll-behavior/)

## Noch ausdrücklich nicht enthalten

- `chrome.tabs.remove()` oder `chrome.tabs.update()`
- tatsächliches Zurücknavigieren innerhalb des Tabs
- Aktivieren oder Schließen des Ursprungstabs
- dauerhaft gespeicherter Tab-Baum oder dauerhaft gespeicherte Browser-History
- Optionsseite
- Telemetrie, Serverzugriffe oder dauerhafte Speicherung
