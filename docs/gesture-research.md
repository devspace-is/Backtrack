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
   `overscroll-behavior` der Seite. Der kontrollierte Brave-Test weiter unten
   bestätigt diesen Einfluss für die getestete Konfiguration.
5. Chrome dokumentiert, dass `overscroll-behavior: contain` am Wurzelelement
   Überlauf-Navigation (technisch: *overscroll navigation*) verhindern kann.
   Eine Erweiterung müsste dafür jedoch Seiten-CSS beeinflussen; das ist ein
   erheblicher Produkt- und Kompatibilitätseingriff und keinesfalls automatisch
   akzeptiert.

### Durch die erste echte Trackpad-Messreihe belegt

Auf der getesteten Seite ohne nutzbares Zurück-Ziel kamen vier physische
Zurück-Wischbewegungen jeweils als lange DOM-`wheel`-Folge im Content Script
an. Alle vier Folgen wurden abgeschlossen und zusammengefasst. Auf diesem Mac
lieferte die physische Zurück-Bewegung ein negatives `deltaX`. Diese Zuordnung
gilt nur für die gemessene Geräte- und Systemeinstellung; der Code behandelt
das Vorzeichen weiterhin nicht allgemein als festes „Zurück“.

Besonders wichtig: In jeder Folge war nur das erste Ereignis abbrechbar
(`cancelable: true`). Alle weiteren 83 bis 141 Ereignisse derselben Folge waren
nicht mehr abbrechbar. Ein erst nach Überschreiten der 80-Pixel-Schwelle
aufgerufenes `preventDefault()` käme damit zu spät. Der kontrollierte
Unterdrückungsversuch zeigte anschließend, dass auch das vorsorgliche
DOM-Abbrechen horizontaler Ereignisse Braves native Navigation nicht stoppt.

### Durch die kontrollierten Navigationstests belegt

1. Mit geöffneter, rechts angedockter DevTools-Konsole blieb die IANA-Testseite
   trotz vorhandener Zurück-History stehen. Das Content Script erhielt dabei
   eine vollständige Folge mit 176 Ereignissen. Mit geschlossenen DevTools
   navigierte dieselbe physische Geste erwartungsgemäß von IANA zurück zu
   `example.com`. Die geöffneten DevTools verändern also selbst den zu
   untersuchenden Navigationspfad und dürfen nicht als Nachweis einer
   erfolgreichen Unterdrückung verwendet werden.
2. Mit geschlossenen DevTools und dem kontrollierten Modus
   `preventDefaultMode: "horizontal"` navigierte Brave weiterhin von IANA zu
   `example.com`. Der DOM-Abbruch allein kontrolliert die native
   Zwei-Finger-Zurück-Navigation auf der getesteten Version nicht zuverlässig.
3. Mit ausgeschaltetem DOM-Abbruch und
   `overscroll-behavior-x: contain !important` am Wurzelelement blieb IANA auch
   nach zwei physischen Zurück-Gesten geöffnet. Beide Gesten kamen als getrennte
   vollständige Folgen im Content Script an. Die Root-CSS-Sperre ist damit der
   bisher einzige praktisch erfolgreiche reine-Extension-Ansatz.

### Noch nicht empirisch belegt

- Ob die vollständige DOM-`wheel`-Folge auch dann auswertbar bleibt, wenn Brave
  ohne DevTools tatsächlich während der Folge navigiert. Das Messfenster selbst
  verändert diesen Pfad; der alte Seitenkontext verschwindet bei Navigation.
- Ob die erfolgreiche Root-CSS-Sperre auf weiteren normalen Webseiten und nach
  wiederholten Seitenwechseln stabil bleibt.
- Welche Auswirkungen die Root-CSS-Sperre auf Tabellen, Carousels, Kanban-Boards
  und andere echte horizontale Interaktionen hat.
- Welche `deltaX`-Polarität die physische Gegenrichtung auf dieser Konfiguration
  liefert.
- Ob robuste Grenzwerte über langsame, schnelle und momentumreiche Gesten sowie
  unterschiedliche Trackpads hinweg existieren.

## Versuchsaufbau

Aktueller Stand der erfassten Testumgebung:

| Merkmal | Wert |
| --- | --- |
| macOS-Version | 26.6.2 (Build 25G83) |
| Brave-Version | 152.1.94.117 |
| Chromium-Version laut `brave://version` | Noch zu messen |
| Gerät / Trackpad | MacBook Pro (Mac14,6), eingebautes Trackpad |
| „Natürliche Scrollrichtung“ | Noch zu messen |
| Brave-Einstellung für Seitennavigation per Wischgeste | Noch zu messen |
| Erweiterung | Backtrack Gesture Research 0.1.0 |
| Testseiten | `https://ai4performance.com/` ohne Zurück-Ziel; `example.com` → IANA mit nutzbarer Zurück-History |
| DevTools „Protokoll beibehalten“ | Aktiv; DevTools für die eigentlichen Navigationstests geschlossen |

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

`NICHT GETESTET` bedeutet: Es liegt noch keine passende echte
Trackpad-Messung vor. `TEILWEISE GETESTET` bedeutet: Es gibt echte Messdaten,
aber mindestens eine Bedingung des Testfalls ist noch nicht ausreichend
kontrolliert. Die Felder dürfen nicht durch Annahmen oder synthetische
Wheel-Ereignisse ersetzt werden.

| Test | preventDefault | Erwartete Beobachtung | Tatsächlicher Befund | Status |
| --- | --- | --- | --- | --- |
| A1: einfache Seite, physisch nach rechts | aus | Vorzeichen und vollständige Folge erfassen | Vier vollständige Folgen; Zurück-Bewegung ergab `NEGATIVE_X`. Seitlicher Scrollkontext der Seite noch nicht separat kontrolliert. | TEILWEISE GETESTET |
| A2: einfache Seite, physisch nach links | aus | Gegenrichtung zu A1 erfassen | Ausstehend | NICHT GETESTET |
| B1: vertikales Scrollen langsam | aus | Kein horizontaler Kandidat | Ausstehend | NICHT GETESTET |
| B2: vertikales Scrollen schnell | aus | Kein horizontaler Kandidat trotz kleiner X-Anteile | Ausstehend | NICHT GETESTET |
| C1: horizontaler Bereich, mittlere Position | aus | Scrollkontext erkannt, kein Kandidat | Ausstehend | NICHT GETESTET |
| C2: horizontaler Bereich, Randposition | aus | Scrollkontext weiterhin konservativ blockiert | Ausstehend | NICHT GETESTET |
| D1: native Back-Geste mit interner History | aus | Eventankunft, Vollständigkeit und Brave-Navigation vergleichen | Mit DevTools: 176 Ereignisse, aber keine Navigation. Ohne DevTools: native Navigation IANA → `example.com`. DevTools beeinflussen den Test selbst. | GETESTET |
| D2: Wiederholung von D1 | horizontal | Prüfen, ob DOM-Abbruch gelingt und native Navigation ausbleibt | Trotz geladenem horizontalen Abbruchmodus und geschlossenen DevTools navigierte Brave IANA → `example.com`. | GETESTET |
| D3: Wiederholung von D1 | aus, Root-CSS `contain` | CSS-Einfluss getrennt vom JS-Abbruch prüfen | Zwei physische Back-Gesten, zwei getrennte Ereignisfolgen; IANA blieb geöffnet. | GETESTET |
| D4: Back-Geste ohne interne History | aus | Prüfen, ob dieselbe Eventfolge sichtbar bleibt | Vier vollständige Folgen sichtbar; jeweils nur Ereignis 1 abbrechbar, alle Folgeereignisse nicht abbrechbar. Keine Navigation beobachtet, da kein Zurück-Ziel vorhanden war. | GETESTET |
| E1: kurzer schneller Impuls | aus | Anzahl und Dauer abklingender Folge messen | Ausstehend | NICHT GETESTET |
| E2: zwei getrennte schnelle Impulse | aus | Zwei Zusammenfassungen, kein Mehrfachsignal pro Impuls | Zwei versehentlich nacheinander ausgeführte Gesten ergaben zwei Zusammenfassungen. Der Abstand war für den ausdrücklich schnellen Doppelimpuls-Test noch zu groß. | TEILWEISE GETESTET |

## Erste Messreihe: Back-Geste ohne interne History

Am 28. August 2026 wurden auf echter Hardware vier physische
Zurück-Wischbewegungen aufgezeichnet. `preventDefault` war ausgeschaltet. Die
Seite hatte kein nutzbares internes Zurück-Ziel, deshalb beweist diese Reihe
noch nicht, ob Brave bei möglicher Navigation parallel selbst zurücknavigiert.

| Folge | Dauer | Ereignisse | Netto-X | Absolut-X | Absolut-Y | größtes \|X\| | Abbrechbar / nicht abbrechbar |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.074,7 ms | 129 | -2.764 px | 2.764 px | 24 px | 73 px | 1 / 128 |
| 2 | 682,3 ms | 84 | -2.481 px | 2.481 px | 25 px | 64 px | 1 / 83 |
| 3 | 1.370,0 ms | 142 | -2.910 px | 2.910 px | 29 px | 76 px | 1 / 141 |
| 4 | 1.328,1 ms | 134 | -2.326 px | 2.326 px | 24 px | 60 px | 1 / 133 |

Alle 489 Einzelereignisse verwendeten `deltaMode: PIXEL`. Die X-Bewegung war
in allen vier Folgen durchgehend negativ; `positiveX` blieb jeweils null. Jede
Folge überschritt die vorläufige Kandidatenschwelle genau einmal und erzeugte
eine einzelne Abschlusszusammenfassung. Da die Abbruchfunktion ausgeschaltet
war, gab es erwartungsgemäß keinen eigenen Abbruchversuch.

Diese Reihe zeigt, dass die Erkennung am History-Rand grundsätzlich genug
Messdaten erhält. Sie zeigt **noch nicht**, dass eine reine Extension die
native Brave-Navigation kontrollieren kann. Dafür sind D1 und D2 entscheidend.

## Kontrollierte Navigation und Unterdrückung

### D1: Native Navigation ohne Eingriff

Ausgangslage war jeweils dieselbe History:

```text
example.com → iana.org/help/example-domains
```

Braves Zurück-Schaltfläche war aktiv. Mit rechts angedockten DevTools blieb die
IANA-Seite nach der Geste stehen. Die dabei aufgezeichnete Folge umfasste
1.682,7 ms, 176 Ereignisse, `netX: -6547 px` und `netY: 38 px`. Nur das erste
Ereignis war abbrechbar; 175 waren nicht abbrechbar. `preventDefault` war aus.

Nach Schließen der DevTools navigierte die nächste physisch gleiche Geste
sofort zurück zu `example.com`. Damit ist belegt, dass angedockte DevTools die
native Geste in diesem Versuchsaufbau selbst beeinflussen. Künftige Aussagen
über die tatsächliche Brave-Navigation müssen mit geschlossenen DevTools durch
Beobachtung des Seitenzustands erfolgen.

### D2: DOM-Abbruch

Der PoC wurde mit `preventDefaultMode: "horizontal"` neu geladen. DevTools waren
geschlossen, und dieselbe IANA-History war aktiv. Die physische Zurück-Geste
navigierte erneut zu `example.com`. Der kontrollierte nicht-passive
`preventDefault()`-Ansatz reicht daher nicht aus, um Braves native Navigation
auf dieser Konfiguration zu übernehmen.

### D3: Root-CSS-Sperre

Für diesen Vergleich war `preventDefault` wieder aus. Der PoC setzte
`overscroll-behavior-x: contain !important` auf dem Wurzelelement und meldete
den Root-CSS-Wechsel im lokalen Debug-Log. DevTools wurden danach geschlossen.
Die IANA-Seite blieb nach zwei physischen Zurück-Gesten geöffnet.

| Folge | Dauer | Ereignisse | Netto-X | Absolut-X | Absolut-Y | größtes \|X\| | Abbrechbar / nicht abbrechbar |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.522,0 ms | 159 | -4.236 px | 4.236 px | 33 px | 105 px | 1 / 158 |
| 2 | 1.167,6 ms | 140 | -5.519 px | 5.519 px | 113 px | 127 px | 1 / 139 |

Beide Folgen verwendeten ausschließlich `deltaMode: PIXEL`, blieben vollständig
negativ auf X und wurden getrennt abgeschlossen. Es gab keinen DOM-Abbruch. Die
erfolgreiche Unterdrückung ist daher dem Root-CSS zuzuordnen, nicht
`preventDefault()`.

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

**Bedingte technische Plausibilität, aber noch keine Freigabe für Phase 2.**

Das Content Script sieht die Zurück-Geste wiederholbar und früh. Ein
DOM-`preventDefault()` kontrolliert Braves native Navigation jedoch nicht. Die
Root-CSS-Sperre `overscroll-behavior-x: contain` hat sie im kontrollierten Test
dagegen auch bei zwei Gesten verhindert. Eine reine Extension ist damit nicht
grundsätzlich ausgeschlossen, sie wäre aber auf einen Eingriff in das
Scroll-/Überlaufverhalten jeder betroffenen Webseite angewiesen.

Vor einer Freigabe für Tab-Schließen, `openerTabId` oder History-Erkennung muss
deshalb zuerst die False-Positive- und Kompatibilitätsmatrix B/C abgeschlossen
werden. Entscheidend ist, ob die Root-CSS-Sperre auf horizontal scrollbaren
Webseiten vertretbar eingesetzt und bei unsicherem Zustand zuverlässig entfernt
werden kann. Bis dahin bleibt das Phase-2-Gate geschlossen.

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
