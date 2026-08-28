# Gesture Research: Brave/macOS Trackpad

Stand: 28. August 2026<br>
PoC-Version: 0.1.0<br>
Entscheidungsstatus: **Phase 2 noch nicht freigegeben**

## Forschungsfrage

Kann eine Manifest-V3-Erweiterung in Brave unter macOS die normale horizontale
Zwei-Finger-Zurück-Geste rechtzeitig und zuverlässig erkennen, von normalem
horizontalem Scrollen unterscheiden und Braves eigene Navigation bei Bedarf
kontrollieren?

Der Proof of Concept beantwortet nur die Eingabeseite. Es gibt absichtlich noch
keinen Service Worker, keine Tab-API und keine History-Verwaltung.

## Wichtigste Trennung: belegt oder noch zu messen

### Durch Standards, Chrome-Dokumentation oder Chromium-Code belegt

1. Ein DOM-`WheelEvent` stellt `deltaX`, `deltaY`, `deltaZ` und `deltaMode`
   bereit. Das Vorzeichen der Bewegung hängt laut UI-Events-Spezifikation von
   Umgebung und Gerät ab. Deshalb darf die spätere Semantik „zurück“ nicht aus
   einem ungeprüften Vorzeichen abgeleitet werden.
2. `preventDefault()` kann nur ein tatsächlich abbrechbares Ereignis
   (`cancelable: true`) abbrechen. Ob dies auch Braves getrennte native
   Zurück-Geste in allen Phasen stoppt, folgt daraus nicht und muss praktisch
   geprüft werden.
3. Chromiums macOS-`HistorySwiper` verarbeitet native
   `NSEventTypeScrollWheel`-Ereignisse und deren native Phase. Er verwendet
   außerdem höher aufgelöste macOS-Touch-Rückmeldungen. Diese Informationen sind
   nicht Bestandteil des standardisierten DOM-`WheelEvent`.
4. Der aktuelle Chromium-Code beschreibt, dass als konsumiert bestätigte
   Scroll-/Wheel-Ereignisse eine Browser-Überlaufgeste verhindern können. Für
   macOS berücksichtigt Chromium außerdem das berechnete
   `overscroll-behavior` der Seite. Daraus entsteht eine plausible
   Testhypothese, aber noch kein Brave-Praxisergebnis.
5. Chrome dokumentiert, dass `overscroll-behavior: contain` am Wurzelelement
   Überlauf-Navigation (technisch: *overscroll navigation*) verhindern kann.
   Eine Erweiterung müsste dafür jedoch Seiten-CSS beeinflussen; das ist ein
   erheblicher Produkt- und Kompatibilitätseingriff und keinesfalls automatisch
   akzeptiert.

### Noch nicht empirisch belegt

- Ob die gesamte native Brave-Geste als DOM-`wheel`-Folge ankommt.
- Ab welchem Punkt Brave Ereignisse selbst verbraucht und nicht mehr an den
  Seiteninhalt weitergibt.
- Ob ein nicht-passiver Listener mit `preventDefault()` die native Navigation
  auf der konkret getesteten Brave-/macOS-Version stabil verhindert.
- Ob das Verhalten in Tabs ohne eigene Back-History vom Verhalten in Tabs mit
  Back-History abweicht.
- Welche `deltaX`-Polarität bei den beiden physischen Wischrichtungen mit den
  verwendeten macOS-Einstellungen erscheint.
- Ob robuste Grenzwerte über langsame, schnelle und momentumreiche Gesten sowie
  unterschiedliche Trackpads hinweg existieren.

## Versuchsaufbau

Vor der Auswertung ausfüllen:

| Merkmal | Wert |
| --- | --- |
| macOS-Version | Noch zu messen |
| Brave-Version | Noch zu messen |
| Chromium-Version laut `brave://version` | Noch zu messen |
| Gerät / Trackpad | Noch zu messen |
| „Natürliche Scrollrichtung“ | Noch zu messen |
| Brave-Einstellung für Seitennavigation per Wischgeste | Noch zu messen |
| Erweiterung | Backtrack Gesture Research 0.1.0 |
| DevTools „Protokoll beibehalten“ | Muss aktiv sein |

Wichtig: Eine synthetische Wheel-Eingabe aus DevTools oder Testsoftware reicht
nicht als Nachweis. Nur eine echte Zwei-Finger-Bewegung durchläuft die native
macOS-/Chromium-Gestenerkennung.

## Instrumentierung des PoC

Der Listener wird bei `document_start` auf `window` registriert:

```text
event: wheel
capture: true
passive: false
frames: alle passenden HTTP(S)-Rahmen
```

Pro Einzelereignis werden lokal protokolliert:

- `deltaX`, `deltaY`, `deltaZ`, `deltaMode`;
- Pixel-Normalisierung, bei Zeilen-/Seitenwerten ausdrücklich als Näherung;
- Zeitstempel und Abstand zum vorherigen Ereignis;
- Achsendominanz und noch unkalibriertes X-Vorzeichen;
- `cancelable`, `defaultPrevented` vor und nach dem eigenen Handler;
- Ergebnis eines kontrolliert zuschaltbaren `preventDefault()`-Versuchs;
- Zusatztasten, insbesondere `ctrlKey` als mögliches Zoom-Signal;
- Startposition und Abstand zu linkem/rechtem Fensterrand;
- erkennbarer horizontaler Scrollbereich unter dem Ziel;
- vorhandene nicht standardisierte/ältere Browserfelder als reine Probe;
- vorsichtiger Hinweis auf einen abklingenden Nachlauf.

Die Logs enthalten absichtlich keine URL, keinen Seitentext und keine
Netzwerkübertragung.

## Bildung einer Ereignisfolge

Einzelereignisse werden als zusammengehörig betrachtet, bis 160 ms Abstand
überschritten werden. Nach 220 ms Ruhe wird die Folge abgeschlossen. Ein
möglicher abklingender Nachlauf wird nur heuristisch markiert, wenn mehrere
spätere Horizontalwerte deutlich unter dem vorherigen Spitzenwert liegen und
dieselbe Richtung behalten.

Diese Markierung ist **kein** zuverlässiges Momentum-Feld. Der Standard stellt
eine solche Phase nicht bereit. Die Heuristik dient ausschließlich dazu,
Messreihen leichter zu vergleichen.

## Vorläufige Schwellenwerte

| Signal | Startwert | Zweck |
| --- | ---: | --- |
| Netto-Horizontaldistanz | 80 px | Kleine diagonale Korrekturen ignorieren |
| Horizontale Dominanz | 2,5 : 1 | Konservativer Startwert; Chromium verwendet in seinem Überlauf-Controller ebenfalls ein Verhältnis von 2,5 für die Richtungswahl, aber nicht zwingend dieselbe Messgrundlage |
| Richtungstreue | 80 % | Hin-und-her-Bewegungen aussortieren |
| Pause zwischen Folgen | 160 ms | Getrennte Eingaben nicht zusammenwerfen |
| Abschluss nach Ruhe | 220 ms | Nachlauf in dieselbe Zusammenfassung aufnehmen |
| Horizontaler Scrollbereich | Immer blockieren | False Positives sind gefährlicher als ein verpasster Wechsel |
| Beliebige Zusatztaste | Blockieren | Zoom- und modifizierte Scrollaktionen schützen |

Diese Werte sind Forschungsparameter und keine Empfehlung für Version 1. Das
Logsignal `threshold-crossed` bedeutet nur, dass die Zahlen eine Schwelle
überschritten haben. Es erzeugt niemals eine Browseraktion.

## Ergebnismatrix

`NICHT GETESTET` bedeutet: Es liegt noch keine echte Trackpad-Messung vor. Die
Felder dürfen nicht durch Annahmen oder synthetische Wheel-Ereignisse ersetzt
werden.

| Test | preventDefault | Erwartete Beobachtung | Tatsächlicher Befund | Status |
| --- | --- | --- | --- | --- |
| A1: einfache Seite, physisch nach rechts | aus | Vorzeichen und vollständige Folge erfassen | Ausstehend | NICHT GETESTET |
| A2: einfache Seite, physisch nach links | aus | Gegenrichtung zu A1 erfassen | Ausstehend | NICHT GETESTET |
| B1: vertikales Scrollen langsam | aus | Kein horizontaler Kandidat | Ausstehend | NICHT GETESTET |
| B2: vertikales Scrollen schnell | aus | Kein horizontaler Kandidat trotz kleiner X-Anteile | Ausstehend | NICHT GETESTET |
| C1: horizontaler Bereich, mittlere Position | aus | Scrollkontext erkannt, kein Kandidat | Ausstehend | NICHT GETESTET |
| C2: horizontaler Bereich, Randposition | aus | Scrollkontext weiterhin konservativ blockiert | Ausstehend | NICHT GETESTET |
| D1: native Back-Geste mit interner History | aus | Eventankunft, Vollständigkeit und Brave-Navigation vergleichen | Ausstehend | NICHT GETESTET |
| D2: Wiederholung von D1 | horizontal | Prüfen, ob DOM-Abbruch gelingt und native Navigation ausbleibt | Ausstehend | NICHT GETESTET |
| D3: Wiederholung von D1 | aus, Root-CSS `contain` | CSS-Einfluss getrennt vom JS-Abbruch prüfen | Ausstehend | NICHT GETESTET |
| D4: Back-Geste ohne interne History | aus | Prüfen, ob dieselbe Eventfolge sichtbar bleibt | Ausstehend | NICHT GETESTET |
| E1: kurzer schneller Impuls | aus | Anzahl und Dauer abklingender Folge messen | Ausstehend | NICHT GETESTET |
| E2: zwei getrennte schnelle Impulse | aus | Zwei Zusammenfassungen, kein Mehrfachsignal pro Impuls | Ausstehend | NICHT GETESTET |

## Auswertungskriterien

### Reine Extension ist für Phase 2 ausreichend plausibel, wenn

alle folgenden Punkte auf echter Hardware wiederholt erfüllt sind:

1. Die beabsichtigte Back-Geste liefert früh genug eine unterscheidbare
   Ereignisfolge im Content Script.
2. Die Richtung lässt sich pro macOS-Konfiguration stabil kalibrieren oder aus
   einem browserseitig stabilen Signal ableiten.
3. Braves native Navigation lässt sich kontrolliert verhindern, bevor eine
   konkurrierende History-Navigation stattfindet.
4. Vertikales Scrollen und horizontale Scrollbereiche erzeugen in der
   Testmatrix keine Fehlkandidaten.
5. Momentum erzeugt höchstens ein abgeschlossenes Kandidatensignal.
6. Das Verhalten ist in mehreren normalen Webseiten und wiederholt über
   langsame wie schnelle Gesten stabil.

### Reine Extension ist abzulehnen, wenn

einer dieser Befunde reproduzierbar auftritt:

- Brave übernimmt die Geste, bevor ausreichend DOM-Ereignisse ankommen.
- Der sichtbare DOM-Strom ist nicht zuverlässig von normalem horizontalem
  Scrollen zu unterscheiden.
- `preventDefault()` beziehungsweise ein vertretbarer CSS-Ansatz kann die
  native Navigation nicht stabil kontrollieren.
- Die einzige funktionierende Unterdrückung verlangt einen globalen Eingriff,
  der normale horizontale Webinteraktionen regelmäßig beschädigt.
- Richtungs- oder Momentumverhalten schwankt so stark, dass unbeabsichtigtes
  Tab-Schließen realistisch bleibt.

## Vorläufige Entscheidung

**Noch keine Freigabe für Phase 2.**

Die Quellcodeanalyse bestätigt das zentrale Risiko: Brave/Chromium besitzt auf
macOS eine native Gestenerkennung mit Informationen, die ein Content Script
nicht vollständig sieht. Gleichzeitig zeigen Chromium-Code und
`overscroll-behavior`, dass der Renderer beziehungsweise Seiteninhalt Einfluss
auf die native Überlauf-Navigation haben kann. Ob dieser Einfluss für Backtrack
rechtzeitig, stabil und UX-sicher nutzbar ist, kann nur die oben stehende echte
Trackpad-Messung entscheiden.

Bis diese Matrix ausgefüllt ist, wäre jede Implementierung von Tab-Schließen,
`openerTabId` oder History-Erkennung verfrüht.

## Kleinstmögliche Alternativen bei negativem Ergebnis

Nur bewerten, noch nicht implementieren:

| Alternative | Vorteil | Nachteil |
| --- | --- | --- |
| Browser-Tastaturkürzel (`commands`) | Reine Extension, zuverlässig und eindeutig | Nicht dieselbe Trackpad-Geste |
| Modifier + beobachtbare Scrollbewegung | Weniger False Positives | Ungewohnt; Modifier-Erkennung und horizontales Scrollen bleiben Thema |
| Deutlich getrennte Drei-Finger-Geste | Semantisch näher am Wischen | Eine normale Web Extension erhält keine rohe Fingerzahl zuverlässig; wahrscheinlich native Hilfe nötig |
| Kleine native macOS-Hilfe plus Extension | Kann native Gesten gezielt erkennen | Zusätzliche Installation, Signierung, Rechte und deutlich größere Komplexität |

Die kleinste belastbare Ausweichlösung wäre voraussichtlich ein
Extension-Tastaturkürzel. Eine native Komponente darf erst nach ausdrücklicher
Freigabe untersucht oder gebaut werden.

## Quellen

- [W3C UI Events: Delta, Vorzeichen und Standardverhalten](https://www.w3.org/TR/uievents/)
- [Chrome: Content Scripts und isolierte Umgebung](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chromium: macOS HistorySwiper](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/renderer_host/chrome_render_widget_host_view_mac_history_swiper.h)
- [Chromium: OverscrollController](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/renderer_host/overscroll_controller.cc)
- [Chrome: overscroll-behavior](https://developer.chrome.com/blog/overscroll-behavior/)
