# Interne Zurück-Historie

Stand: 30. August 2026

## Zweck dieses Schritts

Dieser zweite Baustein von Phase 2 beantwortet ausschließlich:

> Kann der aktuelle Kind-Tab sinnvoll innerhalb seiner eigenen Historie
> zurückgehen, oder steht er wieder an seinem ursprünglichen Einstieg?

Backtrack gibt dafür eine von drei vorsichtigen Entscheidungen aus:

| Entscheidung | Bedeutung in dieser Version |
| --- | --- |
| `USE_INTERNAL_HISTORY` | Der Tab befindet sich hinter seinem Einstieg. Ein späterer Aktionsschritt soll zuerst innerhalb des Tabs zurückgehen. |
| `RETURN_TO_OPENER_ELIGIBLE` | Der Tab steht wieder am erfassten Einstieg und der Ursprungstab ist weiterhin sicher. Ein späterer Aktionsschritt darf den Tab-Wechsel erwägen. |
| `NO_SPECIAL_ACTION` | Die Lage ist unklar oder unsicher. Backtrack soll nichts übernehmen. |

Diese Version führt noch keine dieser Aktionen aus. Sie ruft weder
`history.back()` auf noch aktiviert oder schließt sie einen Tab.

## Warum `history.length` nicht genügt

`history.length` zählt Einträge in der gemeinsamen Sitzungshistorie eines
Browserrahmens. Die Zahl verrät aber nicht, welcher Eintrag der Einstieg des
Kind-Tabs war. Sie kann außerdem bereits beim Öffnen größer als eins sein und
ändert sich bei Vorwärts- und Zurückbewegungen nicht so, dass daraus die
aktuelle Position eindeutig folgt.

Backtrack erfasst den Wert deshalb nur im lokalen Diagnoseprotokoll. Er fließt
nicht in die Entscheidung ein.

## Das verwendete Modell

Chromiums Navigation API gibt jeder Stelle der Sitzungshistorie eine nicht
sprechende Kennung (`NavigationHistoryEntry.key`). Diese Kennung bleibt bei
einem erneuten Besuch derselben Historiestelle gleich. Backtrack erfasst beim
Start eines sicher zugeordneten Kind-Tabs:

- die Kennung seiner Einstiegstelle;
- die Kennung seiner aktuellen Historiestelle;
- die Art des letzten Wechsels: neuer Eintrag, Ersetzen, Neuladen oder
  Zurück-/Vorwärtsbewegung;
- kleine Sicherheitssignale wie „Navigation läuft gerade“.

Es werden ausdrücklich keine URL, kein Seitentitel, kein Favicon und kein
Seiteninhalt gespeichert.

```text
Einstieg A → neuer Eintrag B → neuer Eintrag C
    ↑                                │
    └──────── zurück B ← zurück C ───┘

aktuelle Kennung != Einstiegskennung  → interne Zurück-Historie
aktuelle Kennung == Einstiegskennung  → wieder am Einstieg
```

### Behandlung der Navigationstypen

| Browsermeldung | Behandlung |
| --- | --- |
| `push` | Eine neue Historiestelle. Weicht ihre Kennung vom Einstieg ab, bleibt interne Zurück-Historie erhalten. Das umfasst klassische Seitenwechsel und `history.pushState()` in Einzelseiten-Apps (SPAs). |
| `traverse` | Zurück- oder Vorwärtsbewegung zu einer vorhandenen Kennung. Erst bei der Einstiegskennung ist der Tab wieder am Einstieg. |
| `replace` am Einstieg | Ersetzt den Einstieg, ohne eine zusätzliche Zurückstufe zu erzeugen. Die neue Kennung wird zum neuen Einstieg. |
| `replace` hinter dem Einstieg | Ersetzt nur die aktuelle interne Stufe. Der ursprüngliche Einstieg bleibt erhalten. |
| `reload` mit gleicher Kennung | Die Position bleibt bekannt. |
| unerwarteter Kennungswechsel | Unsicherer Zustand; keine besondere Aktion. |

## Warum `navigation.canGoBack` nur ein Kontrollsignal ist

Die Navigation API darf aus Datenschutzgründen nur gleichartige Einträge aus
demselben Ursprung vollständig offenlegen. Deshalb kann `canGoBack` den Wert
`false` liefern, obwohl vor der aktuellen Seite noch eine sinnvolle
andersartige oder fremde Seite in der Tab-Historie liegt.

Backtrack verwendet daher die über Seitenwechsel hinweg erfasste, nicht
sprechende Kennung als Hauptsignal. Meldet der Browser am erfassten Einstieg
gleichzeitig `canGoBack: true`, widersprechen sich die Signale. Backtrack
entscheidet dann sicherheitshalber `NO_SPECIAL_ACTION`.

## Normale Seiten und Einzelseiten-Apps

Das Content Script läuft früh auf normalen `http://`- und `https://`-Seiten.
Es veröffentlicht einen Zustand beim Dokumentstart, beim Anzeigen einer Seite
und bei den Ereignissen `currententrychange` und `navigatesuccess` der
Navigation API. Damit werden abgedeckt:

- vollständige Dokumentwechsel;
- `history.pushState()` und `history.replaceState()`;
- Zurück-/Vorwärtsbewegungen mit `popstate`-ähnlicher Wirkung;
- Routenwechsel moderner Einzelseiten-Apps, sofern sie die Browserhistorie
  korrekt benutzen.

Reine interne Ansichtswechsel ohne Browser-Historieneintrag sind keine
sinnvolle Browser-Zurückstufe und werden absichtlich nicht als solche gezählt.

## Kurzlebiger Zustand und Berechtigung

Manifest-V3-Hintergrundprozesse können vom Browser jederzeit beendet und
später neu gestartet werden. Ein gewöhnliches JavaScript-Objekt könnte dann
den erfassten Einstieg verlieren. Deshalb verwendet Backtrack
`chrome.storage.session` aus der Berechtigung `storage`.

Dieser Sitzungsspeicher:

- liegt nur im Arbeitsspeicher;
- übersteht das Schlafen und Neustarten des Hintergrundprozesses;
- wird beim Deaktivieren, Neuladen oder Aktualisieren der Erweiterung sowie
  beim Browserneustart geleert;
- ist standardmäßig nicht direkt für Webseiten-Content-Scripts freigegeben;
- enthält bei Backtrack nur Tab-IDs, Ursprungstab-ID, nicht sprechende
  Eintragskennungen und wenige Statuswerte.

Die Berechtigung könnte theoretisch auch dauerhaften Erweiterungsspeicher
zugänglich machen. Backtrack ruft jedoch ausschließlich `storage.session` auf.
Ohne diese Berechtigung wäre der Einstieg nach einem normalen Schlafen des
Hintergrundprozesses nicht zuverlässig bekannt. Eine dann erfundene neue
Grundlinie wäre gefährlicher als der kleine, flüchtige Zustand.

Die weitergehende Berechtigung `webNavigation` wird nicht verwendet. Sie wäre
für dieses Modell unnötig und könnte einer Erweiterung zusätzliche
Navigationsereignisse samt Adressen zugänglich machen.

## Sicheres Verhalten bei Lücken

`NO_SPECIAL_ACTION` gilt unter anderem, wenn:

- der Tab nicht seit seiner Erstellung als sicherer Kind-Tab verfolgt wird;
- die Erweiterung oder der Browser seit dem Öffnen neu gestartet wurde;
- die Navigation API fehlt oder unvollständige Daten liefert;
- ein Seitenwechsel gerade noch läuft;
- Kennungen oder Browsermeldungen einander widersprechen;
- der Ursprungstab inzwischen fehlt oder nicht mehr sicher erreichbar ist;
- die Seite geschützt ist und dort kein Content Script laufen darf.

Ein bereits geöffneter Tab wird nach einem Erweiterungs-Neuladen nicht
rückwirkend übernommen. Backtrack könnte seinen wirklichen Einstieg nicht mehr
beweisen und erfindet deshalb keinen.

## Lokaler Test

Die Datei [`navigation-fixture.html`](navigation-fixture.html) enthält eine
kleine Einzelseiten-App ohne externe Ressourcen. Nach dem Start eines lokalen
Webservers können dort neue und ersetzte Historienstellen sowie mehrstufiges
Zurückgehen geprüft werden.

Im isolierten Backtrack-Kontext der DevTools zeigt folgender Aufruf die
aktuelle Diagnoseentscheidung:

```js
BacktrackNavigationState.requestBackDecision()
```

## Manueller Brave-Praxistest

Am 30. August 2026 wurde Version `0.3.0` in Brave `152.1.94.117` unter macOS
neu geladen und mit einem echten, über den Link der Testseite geöffneten
Kind-Tab geprüft. Das beobachtete Ergebnis:

| Zustand des Kind-Tabs | Diagnose |
| --- | --- |
| Direkt am Einstieg | `RETURN_TO_OPENER_ELIGIBLE` |
| Nach zwei `history.pushState()`-Schritten | `USE_INTERNAL_HISTORY` |
| Nach einem Schritt zurück, noch oberhalb des Einstiegs | `USE_INTERNAL_HISTORY` |
| Nach dem zweiten Schritt zurück, wieder am Einstieg | `RETURN_TO_OPENER_ELIGIBLE` |
| Nach einem vollständigen Dokumentwechsel | `USE_INTERNAL_HISTORY` |
| Manuell geöffneter Tab ohne `openerTabId` | `NO_SPECIAL_ACTION` mit `NO_OPENER` |

Die Testseite zeigte beim Kind-Tab außerdem `history.length: 1` am Einstieg.
Die Entscheidung stammte trotzdem aus der erfassten Einstiegskennung, nicht
aus dieser Zahl. Beim Test wurden weder Browser-History noch Tabs verändert;
alle Ergebnisse waren reine Diagnose.

## Quellen

- [Chrome: Navigation API](https://developer.chrome.com/docs/web-platform/navigation-api/)
- [WHATWG HTML: Navigation API](https://html.spec.whatwg.org/multipage/nav-history-apis.html)
- [Chrome: Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage/)
- [Chrome: Web Navigation API](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)
