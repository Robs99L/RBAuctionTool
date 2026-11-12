# Funktionstest und Fehlerkorrekturen des Auktionstools

Stand: 12. November 2026. Geprüft wurde der aktuelle lokale Projektstand mit Next.js 16.4.2 und Microsoft Edge. Gebuchte Tarife laut Nutzer: Netlify Free und Supabase Free.

## Datenbankseitig gebündelte Live-Updates

Die zusätzliche Bündelung ist lokal implementiert und geprüft, aber **im vorhandenen Supabase-Projekt noch nicht aktiv**. `20261112092653_batch_auction_broadcast.sql` legt für angenommene Gebote und öffentliche Teilnehmernamen eine private transaktionale Warteschlange an. Der Cronjob veröffentlicht höchstens 1.000 Datensätze zusammen pro Sekunde als privaten Broadcast. Jeder Gebotsdatensatz bleibt einzeln gespeichert. Fehlgeschlagene Nachrichteninserts und Überlauf bleiben für spätere Versuche erhalten. Ereigniswechsel und Eventende laufen weiterhin über den bestehenden Queuekanal; periodische Snapshots gleichen verpasste Zustellungen ab.

Bieter, Admin und Präsentation verwenden bei `NEXT_PUBLIC_BATCHED_REALTIME=true` denselben geprüften Broadcast. Die eigene Gebotsbestätigung erscheint direkt nach der RPC-Antwort, andere Ansichten normalerweise beim nächsten Sekundentakt zuzüglich Netzwerk- und Renderzeit. Eine private Empfangssession wird automatisch erzeugt oder wiederverwendet, ohne eine Teilnehmerregistrierung anzulegen. Vorübergehende Anmeldefehler lösen erneute Verbindungsversuche aus; abgelöste beziehungsweise entfernte Ansichten können keine verspäteten Kanalantworten mehr übernehmen. Ungültige Nachrichten werden vollständig verworfen und durch erneute Subscription mit frischem Snapshot ausgeglichen.

| Prüfung | Ergebnis |
| --- | --- |
| Automatisierte Tests, TypeScript und ESLint | 150 Tests in 23 Dateien bestanden; TypeScript und ESLint bestanden |
| PostgreSQL mit sämtlichen Anwendungsmigrationen | 300 einzelne Gebote und ein öffentlicher Name in einer Nachricht; keine Kontaktdaten im Broadcast |
| Warteschlange und Berechtigungen | Stiller Versandfehler mit erfolgreichem Wiederholungsversuch, 1.250 Gebote über mehrere Takte, Transaktionsrollback, Empfangsberechtigung und Schutz gegen gefälschte Nachrichten bestanden |
| Verbindungsaufbau | Erneuter Versuch nach Authfehler, Abbruch während Anmeldung, gemeinsam genutzte laufende Anmeldung, Wiederverbindung nach ungültiger Nachricht und Abbruch geplanter Wiederholung bestanden |
| Vier unabhängige Browserkontexte im isolierten Produktionsbuild | Gemeinsamer privater Kanal; keine direkten Bid-/Teilnehmer-Subscriptions; 12 Szenarien bestanden |
| 1.000 simulierte Gebote mit doppelten/umgeordneten Eingaben und zwei Sekunden verspäteten Snapshots | Alle Ansichten aktualisiert, bevor die alten Antworten eintrafen; im lokalen Lauf nach ungefähr 1,1 Sekunden einschließlich simulierter Bündelung |
| Fortlaufende Gebote, persönliche Höchstgebote und Adminverlauf | Ränge/Spendensumme konsistent; ältere Gewinner trotz 500-Zeilen-Verlauf erhalten; maximal eine geschützte Hintergrundanfrage gleichzeitig |
| Niedrige/gleiche Gebote, hohe Gebote, verpasste Nachricht, Gewinnerzahl und Eventende | Alle Ansichten konsistent; beide Gebotseingaben nach Eventende gesperrt; neues Adminformular bleibt erhalten |
| Isolierter Produktionsbuild mit aktiviertem Schalter | Bestanden |

Nachweis: [Gebündelte Live-Ansichten](qa/batched-broadcast-browser-results.json). PostgreSQL-Anwendungsfunktionen, Trigger und RLS werden in PGlite ausgeführt; Supabase Auth, Realtime und Cron sind Adapter, die nicht die tatsächlichen verwalteten Dienste ersetzen. Der Browser verwendet simulierte HTTP-/WebSocket-Antworten. Es wurden keine produktiven Gebote erzeugt, keine Migrationen im gehosteten Projekt ausgeführt und keine echten parallelen PostgreSQL-Verbindungen belastet. Die Grenze von 1.000 Datensätzen pro Veröffentlichung ist keine nachgewiesene Gebotskapazität.

Bei 300 verbundenen Ansichten reduziert ein Batch pro Sekunde den Gebots-/Namensstrom auf etwa 300 WebSocket-Zustellungen pro Sekunde. Payloadgröße, Eventwechsel, Verbindungen, Authlimits und Datenbankarbeit benötigen weiterhin Reserve. Vorbereitung und Aktivierung stehen im [Live-Runbook](LIVE_AUCTION_RUNBOOK.md): Pro-Einstellungen und tatsächliche Computegröße prüfen, beide noch offenen Migrationen anwenden, Cron und private Empfangsrechte im Testprojekt prüfen, Schalter beim Build aktivieren und echte Lastgeneralprobe durchführen. Ein Netlify-Pro-Tarif ist durch diese Implementierung allein nicht erforderlich; Gebote und Publisher laufen direkt in Supabase. Die folgenden Abschnitte dokumentieren frühere Prüfstände.

## Beliebige positive Gebote

Gebote müssen weder den Startpreis noch das bisherige Höchstgebot übertreffen. Jeder positive Betrag mit maximal zwei Nachkommastellen innerhalb von `numeric(12, 2)` wird als eigener Datensatz gespeichert, auch gleiche Beträge und niedrigere Folgegebote. Rangliste, Gewinner und Spendensumme verwenden weiterhin das höchste Gebot je Person; ein kleineres Folgegebot reduziert keine bestehende Verpflichtung. Die neue Migration ersetzt ausschließlich die Betragsregeln in `place_bid`. Anmeldung, vollständige Registrierung, Eventgrenzen, Transaktionssperre und der Abstand von 300 Millisekunden zwischen Geboten derselben Person bleiben bestehen. Bieteransicht und Demo prüfen dieselbe Betragsgültigkeit. Überholte Mindest-/Maximalanzeigen wurden entfernt; vorhandene Adminwerte bleiben für bestehende Events erhalten, die zugehörigen Eingabefelder sind ausgeblendet. Alte Excelvorlagen bleiben lesbar und erhalten aktualisierte Hinweise.

| Prüfung für die neue Gebotsregel | Ergebnis |
| --- | --- |
| Gesamte automatisierte Testsuite | 121 Tests in 20 Dateien bestanden |
| PostgreSQL-Prüfung mit PGlite und sämtlichen Migrationen | Niedrige erste Gebote, gleiche Gebote verschiedener Personen, niedrige nicht gewinnende Folgegebote und Beträge über der alten Maximalerhöhung separat gespeichert |
| Rangliste, Spendensumme und persistierte Gewinner in PostgreSQL | Bisherige persönliche Höchstgebote bleiben erhalten; nur Gewinnerbeträge zählen zur Spendensumme |
| Ungültige Beträge, Berechtigungen, Anmeldung, Kontaktregistrierung, Mehrfachgebote, Startsperre und Eventende | Ablehnung weiterhin korrekt |
| Vier isolierte Browserkontexte mit Produktionsbuild | Zwei echte Eingabeformulare akzeptieren jeweils 50 € unter dem Startpreis von 500 € und dem führenden Gebot; 0,01 € ebenfalls angenommen; Verlauf aktualisiert, bisherige Ränge erhalten |
| Gebot von 8.000 € über der alten Maximalerhöhung | Neue Führung in Bieter-, Admin- und Präsentationsansicht sichtbar |
| Gebotsschübe, verspätete Snapshots, Gewinnerzahl und Eventende | Alle zehn Browserszenarien bestanden, keine unbehandelten Laufzeitfehler |
| TypeScript, ESLint und isolierter Produktionsbuild | Bestanden |

Browsernachweis: [Neue Gebotsregel und Live-Abgleich](qa/any-bid-browser-results.json). Die PostgreSQL-Prüfung verwendet eine isolierte lokale Datenbank; nur der Supabase-Auth-Kontext ist nachgebildet, die in PGlite nicht verfügbare pgcrypto-Extensiondeklaration wird ausgelassen. Der Browserprüflauf ersetzt Supabase-HTTP und Realtime durch gemeinsame lokale Testantworten. Es wurden keine produktiven Gebote erzeugt und keine echte Free-Tier-Last gemessen. Das Lasttestskript wurde an die Annahme aller parallelen Gebote angepasst, aber nicht gegen ein gehostetes Projekt ausgeführt.

**Aktivierung im vorhandenen Supabase-Projekt noch offen:** `20261112081938_allow_any_positive_bid.sql` ist vorbereitet und lokal geprüft. Die CLI hat keinen Access Token; der vom Nutzer genannte Projektlink ersetzt keinen SQL-Verwaltungszugang. Die Migration wurde deshalb noch nicht im Projekt ausgeführt. Sie muss vor dem Deployment des aktualisierten Clients angewendet werden. Die folgenden Abschnitte dokumentieren frühere Prüfstände.

## Farbgestaltung der Präsentation

Die Präsentation verwendet einen dunkelblauen Hintergrund, einen tannengrünen Leaderboardkopf, warme elfenbeinfarbene Karten und goldene Akzente. Die damalige goldene Hervorhebung von Platz 1 wurde auf anschließenden Nutzerwunsch entfernt; alle Gewinnerzeilen erscheinen jetzt hellgrün. Die folgenden Farb-Screenshots zeigen den ursprünglichen Farbentwurf vor dieser kleinen Anpassung. Schnee, Lichterkette, Weihnachtsmütze und Geschenke bleiben erhalten. Verbindungs- und Eventstatus haben abgestimmte Farben. Die Farbänderung betrifft Darstellung und Platzbedarf; Liveverarbeitung und Gebotsregeln wurden dabei nicht geändert.

| Prüfung am 12. November | Ergebnis |
| --- | --- |
| Lokale Entwicklungsvorschau mit Beispielgeboten bei 1920 × 1080 | Zehn Plätze vollständig sichtbar; kein Scrollen der Seite oder Rangliste |
| 16:9 bei 1280 × 720 mit zwölf Gewinnerplätzen | Alle zwölf Plätze vollständig sichtbar; kein Scrollen der Seite oder Rangliste |
| Mobil bei 390 × 844 | Gestapelte Karten, kein horizontaler Überlauf |
| 16:9-Eventbildrahmen als im Browser eingefügte DOM-Fixture | Seitenverhältnis 16:9; Eventkarte bei beiden Desktopgrößen ohne Scrollen |
| Acht geprüfte Text-/Hintergrundfarbpaare | Alle mindestens 4,5:1 Kontrast |
| TypeScript, ESLint und isolierter Produktionsbuild mit webpack | Bestanden |

Nachweise: [Desktop](qa/presentation-colors-desktop.png), [16:9 mit zwölf Plätzen](qa/presentation-colors-slide.png), [Mobil](qa/presentation-colors-mobile.png) und [Messwerte](qa/presentation-colors-results.json). Die Bildrahmenprüfung erfolgte nach den Screenshots mit einer DOM-Fixture, ohne echten Upload. Die lokale Beispielvorschau stellt keine Supabase-Anfragen. Die nachfolgenden Funktions- und Lastprüfungen dokumentieren frühere Prüfstände und wurden für diese Gestaltung nicht erneut ausgeführt.

## Viele gleichzeitig eintreffende Gebote

Admin, Bieter und Präsentation verarbeiten Live-Nachrichten jetzt in festen 16-Millisekunden-Fenstern. Die Rangliste wird für einen ganzen Nachrichtenschub berechnet, statt jede Nachricht einzeln vollständig zu sortieren und an React zu übergeben. Ein fortlaufender Gebotsstrom verschiebt das Aktualisierungsfenster nicht. Die Administration übernimmt Gebote und Teilnehmernamen direkt aus Realtime; langsame geschützte Ladeantworten blockieren die Liveanzeige nicht. Während einer Anfrage eingehende Gebote und Eventänderungen werden über deren Antwort gelegt. Private Kontaktinformationen und finale Berichte werden weiterhin ausschließlich geschützt geladen, mit einer Sekunde Bündelung und ohne überlappende Hintergrundabrufe. Gleichzeitige Initialabrufe desselben Events werden zusammengefasst. Unveränderte Adminzeilen rendern nicht erneut; Formatierer für Beträge und Uhrzeiten werden wiederverwendet.

Beim Abgleich mit den bestehenden Migrationen wurde eine weitere wichtige Grenze gefunden: `get_auction_admin_bids` liefert nur die letzten 500 Gebote. Die Administration verwendet deshalb zusätzlich denselben vollständigen öffentlichen Dashboard-Snapshot wie Bieter und Präsentation. Gewinnerkennzeichnungen und Spendensummen basieren auf dieser vollständigen Rangliste, auch wenn ältere Gewinnergebote im sichtbaren Verlauf fehlen. Der Adminverlauf bleibt bei den letzten 500 angenommenen Geboten; diese Grenze wird angezeigt. Frühere Aussagen in diesem Bericht über einen vollständigen Adminverlauf waren unzutreffend. Auch nach dem Eventende darf eine verspätete Antwort die Spendensumme nicht gegenüber den angezeigten Gewinnern zurücksetzen.

| Abschließende Prüfung | Ergebnis |
| --- | --- |
| 101 automatisierte Tests in 19 Dateien; TypeScript, ESLint und isolierter Produktionsbuild | Bestanden |
| 10.000 Gebote mit doppelten, vertauschten Nachrichten und verspäteten Teilnehmernamen | Dieselben Ränge und Gewinner bei Gesamtverarbeitung und Verarbeitung in Teilmengen |
| Vier unabhängige Browserkontexte, 300 simulierte Teilnehmer, 1.000 Gebote / 2.000 Nachrichten pro Ansicht, zwei Sekunden verzögerte Snapshots | Aktualisierung des DOM nach rund 177 ms in der Präsentation, 302 ms im Admin und 269 beziehungsweise 236 ms bei den Bietern; aktueller Stand vor Abschluss der alten Antworten |
| Weitere 1.000 Gebote in einem fortlaufenden Strom | Alle Ansichten stimmen überein; maximal eine geschützte Hintergrundanfrage gleichzeitig |
| 600 weitere Gebote desselben Teilnehmers | Ältere Gewinner bleiben in der vollständigen Rangliste und in der Admin-Spendensumme, obwohl sie im 500-Zeilen-Verlauf fehlen |
| Gewinnerzahl von 12 auf 15 ändern, Event während laufender Anfragen beenden, neues Adminformular bei weiterer Live-Nachricht | Alle drei Fälle bestanden; finale Ansicht bleibt erhalten, beide Gebotseingaben gesperrt, neues Formular bleibt ausgewählt |
| Neue geschützte Adminantwort gegen die konfigurierte Supabase-Anbindung ausschließlich lesend | HTTP 200; ein Event, keine vorhandenen Gebote; vollständiger öffentlicher Snapshot vorhanden und ohne E-Mail-Felder |

Browserergebnisse: [Gebotsschübe](qa/realtime-burst-results.json). Lesender API-Nachweis: [Adminabruf](qa/realtime-admin-read.json). Der reproduzierbare Browserprüflauf liegt in `scripts/qa-realtime-bursts.mjs`. Es wurden keine produktiven Gebote, Registrierungen oder Eventwechsel durchgeführt. Die Browserprüfung simuliert die Zustellung bereits angenommener Gebote; sie misst weder konkurrierende PostgreSQL-Transaktionen noch die tatsächliche Kapazität von Supabase Free oder Netlify Free. Die genannten DOM-Zeiten gelten für den lokalen Prüflauf und enthalten keine echte Internet- oder Supabase-Verteilungsverzögerung. Die nachfolgenden Abschnitte dokumentieren frühere Prüfstände.

## Verstärkte Synchronisierung

Auf ausdrücklichen Nutzerwunsch wurde die Synchronisierung erneut geprüft und verstärkt. Alle drei View-Typen verwenden eine gemeinsame Anwendungsserverzeit für ihre Timer. Die Zeitkalibrierung berücksichtigt die halbe gemessene Anfragezeit und verwendet anschließend eine monotone Uhr. Falsch eingestellte Geräteuhren verschieben damit den Countdown nicht mehr. Die Serverzeit wird einmal pro Minute und beim Wiederverbinden beziehungsweise erneuten Sichtbarwerden abgeglichen; bis zur ersten erfolgreichen Kalibrierung bleibt die Gebotseingabe gesperrt.

Die Bieter- und Präsentationsansichten gleichen ihre Daten zusätzlich alle 15 Sekunden ab, solange sie sichtbar sind. Während der Wiederherstellung erfolgt der Versuch alle zehn Sekunden. Neuere Eventänderungen werden sowohl über verspätete Queueantworten als auch über verspätete Dashboardantworten übernommen. Dashboard-, Queue- und Admin-Ladeanfragen haben eine Zeitgrenze von zehn Sekunden. Verbindungsstatus und Gebotseingabe berücksichtigen, ob die notwendige Queue, die Live-Kanäle und das Dashboard des aktuellen Events tatsächlich bereit sind. Eine wiederhergestellte Anmeldung allein reicht nicht für die Anzeige „Live“. Beim Eventende wird ein neuer finaler Snapshot angefordert; persönliche Ergebnisdialoge warten auf dessen erfolgreichen Abruf und werden nach fehlgeschlagenem Abruf bei erneuter Synchronisierung wieder versucht.

Die Administration fasst eingehende Gebote über 250 Millisekunden zusammen und aktualisiert auch während eines fortlaufenden Gebotsstroms. Hintergrundanfragen überlappen nicht; während einer laufenden Anfrage eintreffende Änderungen lösen einen weiteren Abruf aus. Die frühere Verzögerung wurde durch jedes neue Gebot zurückgesetzt und konnte dadurch die Anzeige bis zum Ende eines Gebotsstroms aufschieben. Queue-Rejoining, Online- und Sichtbarkeitsereignisse sowie ein 15-Sekunden-Abgleich aktualisieren jetzt ebenfalls die Administration. Namen werden nachgetragen, wenn eine Gebotsnachricht vor der zugehörigen Registrierungsnachricht ankommt.

| Prüfung im isolierten Produktionsbuild | Ergebnis |
| --- | --- |
| Vier getrennte Browserkontexte: Präsentation, Admin und zwei registrierte Bieter; Geräteuhren ±5 beziehungsweise ±10 Minuten falsch | Alle vier Timer zeigten denselben 15-Sekunden-Countdown; beide Bieter wurden nach dem gemeinsamen Start freigeschaltet |
| Verpasstes Gebot ohne Verbindungs- oder Sichtbarkeitsereignis | Alle öffentlichen Views zogen das Gebot beim regelmäßigen Abgleich nach |
| Gleichzeitig abgeschickte identische Gebote | Die gemeinsame Serverfixture nahm genau ein Gebot an; alle öffentlichen Views zeigten danach dieselbe Rangliste |
| Verspätete Queueantwort während des Wechsels von Event A zu B | Kein Rückwechsel zum alten Event |
| 25 Gebotsnachrichten im Abstand von 100 Millisekunden; Adminantworten um 600 Millisekunden verzögert | Aktualisierung schon während des Stroms; vier Adminanfragen, maximal eine gleichzeitig, zuletzt aktueller Betrag sichtbar |
| Wiederhergestellte Anmeldung und verbundener Live-Kanal, Dashboardantwort absichtlich verzögert | Gebotseingabe gesperrt und kein falscher „Live“-Status; Freigabe nach erfolgreichem Snapshot |
| Gebotsnachricht vor Teilnehmernachricht | Gleicher korrekter Name in allen öffentlichen Views |
| Eventende | Finale Rangliste abgeglichen und beide Bieterformulare gesperrt |
| Automatisierte Tests, TypeScript, ESLint, Produktionsbuild | 90 Tests in 17 Dateien bestanden; übrige Prüfungen ebenfalls bestanden |

Der Browserprüflauf erfasste keine unbehandelten Laufzeitfehler. [Prüfergebnis](qa/synchronization-results.json). Supabase-HTTP-Antworten, Realtime und die Annahme konkurrierender Gebote wurden mit einer gemeinsamen lokalen Serverfixture simuliert; die Zeitkalibrierung verwendete den echten lokalen API-Endpunkt. Es wurden keine produktiven Supabase-Daten verändert. Die Prüfung ersetzt keinen Test konkurrierender Datenbanktransaktionen und keinen Lasttest auf den Free-Tarifen.

„Synchron“ bedeutet hier dieselbe serverseitige Event- und Gebotsgrundlage mit Live-Verteilung und automatischer Wiederherstellung. Netzwerk- und Renderverzögerungen verhindern eine garantierte Darstellung in derselben Millisekunde auf unabhängigen Geräten. Ein unterbrochenes Gerät kann erst nach erfolgreicher Wiederverbindung wieder den aktuellen Stand anzeigen. Die nachfolgenden Abschnitte dokumentieren frühere Prüfstände.

## Aktuelle Konsistenzprüfung zwischen den Ansichten

Admin-, Bieter- und Präsentationsansicht wurden gemeinsam in drei Tabs einer isolierten lokalen Demo geprüft. Zusätzlich wurden verzögerte Supabase-Dashboardantworten und Realtime-Nachrichten im Browser simuliert. Produktive Daten wurden nicht verändert.

Korrigiert wurden folgende Abweichungen:

- Die Bieteransicht und ihre Gebotsgrenzen verwenden jetzt das höchste Gebot aus der vollständigen Rangliste. Der zeitlich jüngste Aktivitätseintrag kann bei verzögerten Nachrichten oder abweichender Transaktionsreihenfolge einen niedrigeren Betrag haben. Präsentation, Bieteransicht und lokale Gebotsvalidierung verwenden damit dieselbe Grundlage.
- Eventupdates, die während einer Dashboardanfrage eintreffen, werden durch deren ältere Antwort nicht mehr zurückgesetzt. Der reproduzierte Fall „Event bereits beendet, verspätete Antwort noch aktiv“ bleibt jetzt beendet und zeigt finale Gewinnerkennzeichnungen.
- Beim Wechsel auf ein anderes Event wird das alte Gebotseingabefeld samt Feedback zurückgesetzt. Die Teilnehmeridentität bleibt erhalten.
- Bei identischen Beträgen und Zeitstempeln entscheidet auch die Admin-/Demo-Gewinnerauswahl anhand der Gebots-ID, entsprechend der Datenbank und der Live-Rangliste.
- Die README beschreibt jetzt die feste Präsentationsrangliste: Top 10, bei mehr als 10 Gewinnerplätzen bis zur Anzahl der Gewinner. Die Liste wechselt keine Seiten. Der eigenständige Beispielmodus wird als Entwicklungsvorschau beschrieben.

| Aktuelle Nachprüfung | Ergebnis |
| --- | --- |
| Automatisierte Tests | 82 bestanden, 15 Testdateien |
| TypeScript, ESLint und isolierter Produktionsbuild | Bestanden |
| Dasselbe aktive Event, höchstes Gebot, Gewinnerplätze und Gebotsgrenzen in den drei Ansichten | Bestanden mit lokalen Daten, auch bei umgekehrter Reihenfolge der Gebotszeitstempel |
| Ungültiges Gebot, akzeptiertes Gebot, sofortige Rangänderung und Ein-Cent-Erhöhung durch den Führenden | Bestanden in der gemeinsamen Demo |
| Manuelles Beenden, finale Ergebnisse, nächstes Event, fortgesetzte Identität und geleertes Eingabefeld | Bestanden in der gemeinsamen Demo |
| Gemeinsamer 15-Sekunden-Startcountdown und anschließende Freigabe des Bietens | Bestanden; alle drei Timer zeigten denselben Countdown |
| Verspäteter aktiver Snapshot nach dem Eventende | Bestanden mit simuliertem Realtime-Kanal; finaler Zustand bleibt erhalten |
| Verpasster Eventwechsel und inkrementelles Neusortieren bei Live-Geboten | Bestanden mit simulierten Supabase-Antworten |
| Lokaler Produktionsbuild mit `?demo=true&winners=12` | Zeigt die reguläre Live-Ansicht; Beispielmodus ist deaktiviert. Live-Regressionsfälle bestehen auch im Produktionsbuild |
| Präsentation mit 12 Gewinnerplätzen bei 1920×1080 und 1280×720 | Alle 12 Zeilen passen ohne Seitenüberlauf; kein Seitenwechsel nach neun Sekunden |
| Alle drei Ansichten bei 390×844 | Kein horizontaler Überlauf; Eventbilder behalten 16:9 und `object-fit: contain` |

Die Darstellungsunterschiede entsprechen den jeweiligen Aufgaben: Die Präsentation begrenzt die öffentliche Liste auf Top 10 beziehungsweise alle Gewinnerplätze, die Bieteransicht zeigt die vollständige Rangliste samt persönlichem Rang und die Administration den vollständigen Gebotsverlauf. Die Administration kann ein anderes Event zur Bearbeitung auswählen; öffentliche Ansichten folgen gemeinsam dem aktiven Event und behalten danach dessen Ergebnisse sichtbar. Die Anmeldemaske bleibt ausdrücklich vom festen 16:9-Format ausgenommen.

Die Browserprüfläufe erfassten keine unbehandelten Laufzeitfehler. Die gemeinsame Demo stellte keine Supabase-Anfragen. Ergebnisse: [Ansichten und Bedienabläufe](qa/consistency-results.json), [simulierte Live-Abläufe](qa/consistency-live-results.json), [lokaler Produktionsbuild](qa/consistency-production-results.json). Echte konkurrierende Datenbankgebote, produktive Schreibabläufe und Lasttests bleiben mangels separatem Testprojekt ungeprüft. Die nachfolgenden Abschnitte dokumentieren frühere Prüfstände.

## Korrekturen und Nachprüfung

Alle drei reproduzierten Fehler wurden am 11. November 2026 lokal korrigiert. Die README beschreibt die Spendensumme jetzt korrekt.

Auf anschließenden Nutzerwunsch verwendet die Anmeldemaske wieder das frühere responsive Layout mit der Christmas-Auction-Grafik ohne festes 16:9-Format. Die Eventbilder in der Bieter-, Admin- und Präsentationsansicht behalten 16:9.

- Die Eventqueue wird beim Wiederverbinden, beim erneuten Sichtbarwerden und nach erneuter Queue-Subscription geladen. Danach wird das aktuelle Event aktualisiert. Bei einem Eventwechsel bezieht die neue Live-Subscription ihren eigenen Snapshot; alte Event-IDs aus vorherigen Renderdurchläufen werden nicht für die Wiederherstellung verwendet. Gleichzeitige Wiederherstellungen werden zusammengefasst. Fehlgeschlagene Wiederherstellungen werden auch vor der Registrierung alle zehn Sekunden erneut versucht.
- Der Originvergleich berücksichtigt im Entwicklungsbetrieb den tatsächlichen Loopback-Hostheader. Anfragen über `localhost` und `127.0.0.1` funktionieren; fremde Origins, abweichende Ports und Protokolle bleiben gesperrt. Die Produktionsprüfung bleibt an die Request-URL gebunden und übernimmt keine fremden oder weitergeleiteten Hosts.
- Fehlerhafte JSON-Bodies und nichttextliche Secretwerte werden vor dem Secretvergleich und vor dem Supabase-Aufruf mit HTTP 400 zurückgewiesen. Falsche Stringpasswörter unterliegen weiterhin dem Datenbank-Ratelimiter.
- Spendensummen und der Startbutton sind in der README entsprechend dem tatsächlichen Verhalten beschrieben.

| Nachprüfung | Ergebnis |
| --- | --- |
| Automatisierte Tests einschließlich neuer Origin- und Loginregressionen | 81 bestanden, 15 Testdateien |
| TypeScript, ESLint und Produktionsbuild | Bestanden |
| Registrierter Teilnehmer: verpasstes Event, fortgesetzte Identität, Gebot im Folgeevent, weiterer Wechsel beim Sichtbarwerden | Bestanden mit vollständig simulierten Supabase-Antworten |
| Eventwechsel vor der Registrierung | Bestanden mit simulierten Antworten |
| Eventwechsel nach automatischer Queue-Resubscription | Bestanden mit simulierten Antworten |
| Erneuter Versuch nach fehlgeschlagenem Queueladen | Bestanden; Wiederherstellung über Offline-Polling |
| Präsentationsansicht: Event und Leaderboard nach Wiederverbindung | Bestanden mit simulierten Antworten |
| Echte lokale API über beide Hostnamen: ungültige Adminaktion / numerischer Secretwert / fremder Origin | Jeweils erwartete Antworten 400 / 400 / 403 |

Die fünf Browserergebnisse sind als [Prüfergebnis](qa/fix-recovery-results.json) gespeichert. Die Anwendung ist weiterhin unter `http://localhost:3000` erreichbar. Die Änderungen sind lokal; ein Netlify-Deployment wurde nicht ausgeführt. Produktive Supabase-Daten wurden nicht verändert. Die Grenzen für echte Datenbankschreibabläufe und Lasttests gelten weiterhin.

## Ergebnis der Erstprüfung

Die zentralen Bedienabläufe funktionierten in der isolierten lokalen Demo. Die echte Supabase-Anbindung lieferte Eventdaten, geschützte Adminberichte und eine funktionierende Realtime-Verbindung für die Präsentationsansicht. Die Erstprüfung reproduzierte drei Fehler und eine veraltete Beschreibung der Spendensumme. Diese Befunde wurden in der oben dokumentierten Nachprüfung korrigiert.

Bei der Erstprüfung wurde der Anwendungscode nicht geändert. Die folgenden Abschnitte dokumentieren den damaligen Stand, die Reproduktionen und die Prüfgrenzen.

## Prüfungen und Ergebnisse

| Prüfung | Ergebnis | Umfang und Aussagekraft |
| --- | --- | --- |
| Bestehende automatisierte Tests | 56 bestanden, 13 Testdateien | Gebotsregeln, Rangfolge, Gewinner, Eventqueue, Teilnehmeridentität, Timer, Livezustand, Eingaben, Bilder, Excel und Adminsessiontokens |
| TypeScript, ESLint und Produktionsbuild | Bestanden | `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`; einschließlich `/presentation` |
| API-Prüfungen über `localhost:3000` | 37 bestanden, 1 fehlgeschlagen | Echte lesende Zugriffe sowie ungültige Eingaben, die vor einer Datenänderung zurückgewiesen wurden |
| Zentrale Browserabläufe | 36 bestanden | Isolierte Demo auf Port 3110; abschließende Prüfung der Spendensumme separat nach Korrektur der Testannahme nachgeholt |
| Ergänzende Browserprüfungen | 11 bestanden | Vollbild, Rotation, Bildschirmgrößen, leere Queue, simulierte Adminanmeldung und echte lesende Präsentationsanbindung |
| Wiederverbindung nach verpasstem Eventwechsel | Fehler in Teilnehmeransicht reproduziert; Präsentation besteht | Kontrollierte HTTP- und WebSocket-Antworten im Browser, vollständig ohne produktive Datenänderungen |
| Lokaler Originvergleich | Fehler für `127.0.0.1` reproduziert | Gleiche ungültige Adminaktion mit unterschiedlichen lokalen Hostnamen und gültiger Adminsession |

### Teilnehmer und Gebote

- Leere Registrierung, ungültige E-Mail und bereits verwendeter Name werden zurückgewiesen.
- Gültige Registrierung normalisiert die E-Mail; sie erscheint nicht in der öffentlichen Präsentationsansicht.
- Gebote unter dem Minimum, über dem Maximum, mit mehr als zwei Nachkommastellen und mit ungültigem Text werden zurückgewiesen.
- Ein gültiges Gebot aktualisiert Teilnehmer-, Admin- und Präsentationsansicht über die lokale Tabsynchronisation.
- Der führende Teilnehmer kann sein eigenes Gebot um 0,01 erhöhen; Dezimalkomma wird akzeptiert.
- Nach einem Neuladen bleibt die Teilnehmeridentität erhalten.
- Beim nächsten Event bleibt die Registrierung erhalten. Der 15-Sekunden-Startcountdown sperrt Gebote und gibt sie anschließend frei.
- Das erste erlaubte Gebot entspricht **Startpreis plus Mindestschritt**: Bei 100 EUR Startpreis und 10 EUR Mindestschritt werden 100 EUR abgelehnt und 110 EUR angenommen. Dies entspricht den bestehenden Regeln und Tests.
- Das Ablaufen des anschließenden Anzeigetimers beendet die Auktion nicht. Bieten bleibt bis zum manuellen Abschluss möglich.
- Nach dem Abschluss sind Gebote gesperrt; Gewinnerdialog und finales Leaderboard erscheinen. Der Dialog lässt sich schließen.

### Administration, Berichte und Import

- Event anlegen, Beschreibung ändern und speichern, duplizieren, nach oben und unten verschieben sowie unbenutztes Event löschen funktionieren in der Demo.
- Abbrechen der Bestätigungsdialoge für Start, Ende und Löschen verändert den Eventstatus beziehungsweise die Queue nicht.
- Starten eines Events beendet das zuvor aktive Event; es bleibt genau ein aktives Event.
- Während eines aktiven Events sind Inhalt und Regeln gesperrt. Nach Abschluss sind beschreibende Inhalte wieder editierbar; Preis-, Gewinner- und Timerregeln bleiben gesperrt.
- Spendensummen berücksichtigen je Gewinner nur dessen höchstes Gebot. Im geprüften Beispiel erscheinen 725,01 EUR für das erste Event und 110 EUR für das zweite; das frühere Gebot von 725 EUR wird nicht zusätzlich summiert.
- Die echten Admin-API-Zugriffe ohne Session sowie mit manipuliertem oder abgelaufenem Cookie werden zurückgewiesen. Anfragen mit fremdem Origin werden zurückgewiesen.
- Gültige Adminsession, lesender Zugriff auf Queue und Berichte, CSV-Export und XLSX-Vorlage funktionieren. Im echten Projekt waren beim Lesen ein Event, keine Gebote und keine Gewinner vorhanden; der CSV-Test prüft deshalb Header und Downloadantwort, keine ausgefüllten Gewinnerzeilen.
- Fehlende oder ungültige Eventfelder, negative Preise, ungültige Schritte, Gewinnerzahl, Währung und Dauer werden zurückgewiesen. Ungültige oder zu große Bilder sowie fehlende, beschädigte, falsch benannte und zu große Importdateien werden ebenfalls zurückgewiesen.
- Die Excel-Unit-Tests prüfen gültige Vorlagenzeilen, Standardwerte und Zeilenfehler. Ein erfolgreicher Import mit anschließendem Datenbankinsert wurde nicht gegen das echte Projekt ausgeführt.
- Die Admin-Loginoberfläche zeigt ungültige Zugangsdaten an, öffnet nach Erfolg den Editor und kehrt nach Abmeldung zum Login zurück. Diese Browserprüfung verwendet simulierte Sessionantworten. Die echte Anmeldung einschließlich Datenbank-Ratelimiter wurde damit nicht nachgewiesen; für die lesenden Admin-API-Tests wurde ein gültiger Sessiontoken lokal signiert.

### Präsentation und Bildschirmdarstellung

- Die Auswahl in der Adminansicht verlinkt auf `/presentation`.
- Aktuelles Event, höchstes Gebot, Leaderboard, Gewinnerstatus und finaler Zustand werden angezeigt. Eventwechsel und Gebote erscheinen automatisch in der Demo.
- Vollbild lässt sich ein- und ausschalten.
- Bei sieben Teilnehmern zeigt die erste Ranglistenseite fünf und die zweite zwei Einträge. Die Ansicht wechselt nach acht Sekunden.
- Die PowerPoint-Testgrafik und deren Vorschau behalten in Admin-, Teilnehmer- und Präsentationsansicht das Verhältnis 16:9 und verwenden `object-fit: contain`.
- Die Präsentation passt bei 1920×1080 und 1280×720 ohne horizontalen oder vertikalen Seitenüberlauf. Die Bildrahmen haben gemessen ein Seitenverhältnis von ungefähr 1,7778.
- Teilnehmer- und Adminansicht zeigen bei 390×844 keinen horizontalen Überlauf.
- Eine leere Eventqueue zeigt den Wartezustand.
- Die echte Präsentationsansicht lädt das vorhandene Event ohne Registrierung und erreicht den Realtime-Status „Live“.
- In der zentralen Demo-Browserprüfung wurden keine unbehandelten Laufzeitexceptions erfasst.

Die 16:9-Anforderung wurde für die Eventbilder in allen drei Ansichten und für die Präsentation als gesamten 16:9-Bildschirm geprüft. Teilnehmer- und Adminseiten bleiben responsive und dürfen vertikal scrollen.

Screenshot mit ausschließlich lokalen Testdaten: [Präsentation bei 1280×720](qa/presentation-1280x720.png). Der kleine Next.js-Indikator unten links gehört zur lokalen Entwicklungsumgebung.

## Fehler aus der Erstprüfung, inzwischen korrigiert

### 1. Teilnehmeransicht bleibt nach verpasstem Eventwechsel beim alten Event

**Priorität: Hoch für den Livebetrieb.**

Reproduktion mit kontrollierten Browserantworten:

1. Queue enthält ein abgeschlossenes Event A und ein noch kommendes Event B. Die Teilnehmeransicht zeigt A.
2. Der simulierte Server startet B, während die Queue-Benachrichtigung ausbleibt, wie bei einer unterbrochenen Verbindung.
3. Im Browser werden `online` und `visibilitychange` ausgelöst.
4. Die Teilnehmeransicht lädt erneut das Dashboard von A, fragt aber die Eventqueue nicht erneut ab und bleibt bei A.
5. Die Präsentationsansicht fragt unter demselben Szenario die Queue erneut ab und wechselt zu B.

Ursache im aktuellen Code: Die Wiederherstellung der Teilnehmeransicht ruft `refreshDashboard()` für die bisherige Event-ID auf. Der Queuekanal lädt beim erneuten Abonnieren keinen vollständigen Queuestand nach. Die zusätzliche Queuewiederherstellung und das 15-Sekunden-Polling gelten nur für die Präsentation.

Referenzen: `src/components/auction-app.tsx`, Queueabonnement um Zeile 364, Wiederherstellung um Zeile 446 und Onlinebehandlung um Zeile 523; Präsentationswiederherstellung um Zeile 546.

Empfehlung: Queue beim Wiederverbinden, beim erneuten Sichtbarwerden und nach erneuter Queue-Subscription laden; anschließend das Dashboard des neu gewählten Events laden. Bis zur Korrektur hilft ein vollständiges Neuladen der Teilnehmerseite.

### 2. Adminaktionen über die lokale Adresse 127.0.0.1 werden abgelehnt

**Priorität: Mittel; lokale Vorschau betroffen.**

Mit gültiger Adminsession wurde eine sicher ungültige Aktion gesendet, die keinerlei Daten verändert:

| Requestadresse | Originheader | Ergebnis |
| --- | --- | --- |
| `http://127.0.0.1:3000` | `http://127.0.0.1:3000` | 403, „Cross-origin request rejected.“ |
| `http://localhost:3000` | `http://127.0.0.1:3000` | 403 |
| `http://127.0.0.1:3000` | `http://localhost:3000` | 400, erwartete Aktionsvalidierung |
| `http://localhost:3000` | `http://localhost:3000` | 400, erwartete Aktionsvalidierung |

Der Originvergleich in `src/lib/admin-api.ts` um Zeile 16 vergleicht mit `request.url`; im geprüften Next-Entwicklungsserver stimmt dieser Hostname für 127.0.0.1-Anfragen nicht mit dem Browserorigin überein. Derselbe Schutz wird für Login und Admin-Schreibaktionen verwendet.

**Sofortiger Workaround:** Lokale Vorschau über `http://localhost:3000` öffnen. Das Verhalten auf einer Netlify-Produktionsdomain wurde nicht geprüft.

Empfehlung: Den Originabgleich so implementieren, dass er die tatsächliche zulässige Requestadresse berücksichtigt, und beide lokalen Hostnamen durch einen Integrationstest absichern. Den Schutz gegen fremde Origins beibehalten.

### 3. Nichttextlicher Adminsecret verursacht Serverfehler

**Priorität: Niedrig; fehlerhafte API-Eingaben betroffen.**

Reproduktion: `POST /api/admin/session` mit gleichem Origin, JSON-Content-Type und Body `{"secret":123}` liefert HTTP 500. Erwartet wird eine kontrollierte 4xx-Antwort.

In `src/app/api/admin/session/route.ts` um Zeile 31 wird der Secretwert ohne Laufzeitprüfung an `secretIsValid()` übergeben. Die TypeScript-Typannahme verhindert keinen numerischen JSON-Wert. Die normale Loginoberfläche sendet einen String und ist von dieser konkreten Eingabe nicht betroffen.

Empfehlung: Vor dem Secretvergleich den Body und `typeof secret === "string"` validieren und ungültige Eingaben kontrolliert zurückweisen.

## Dokumentationsbefund aus der Erstprüfung

Die README beschrieb die Spendensumme als Summe aller angenommenen Gebote einschließlich wiederholter Erhöhungen. Tatsächlich verwendet die Demo die höchsten Gebote der Gewinner; die aktuelle SQL-Migration verwendet für beendete Events gespeicherte Gewinnerbeträge und sonst die aktuellen Gewinnergebote. Die Beschreibung wurde im Einleitungstext und im Abschnitt zur Spendensumme korrigiert. Die Spendensummenlogik selbst verhielt sich in der Demo wie vorgesehen.

## Grenzen der Prüfung

Es existiert laut Nutzer kein separates Supabase-Testprojekt. Deshalb wurden keine produktiven Testgebote, Registrierungen, Eventwechsel, Gewinnerfestschreibungen, gültigen Bild-Storage-Uploads, gültigen Datenbankimporte oder Zahlungsstatusänderungen ausgeführt. Die öffentliche Dashboardantwort enthielt keine privaten E-Mail-Felder; öffentliche Aufrufe der geprüften Admingebots- und Gewinnerbericht-RPCs wurden verweigert. Das ist keine vollständige Sicherheitsprüfung aller Datenbankobjekte.

Die Demo synchronisiert Browser-Tabs über LocalStorage. Sie ersetzt keine Prüfung mehrerer unabhängiger Authsessions und keine Prüfung konkurrierender, atomarer Datenbankgebote. Zusätzliche Ranglisteneinträge für den Darstellungstest wurden als lokale Testfixtures angelegt.

Ein Lasttest mit vielen gleichzeitig bietenden Nutzern wurde nicht durchgeführt. Aus diesen Ergebnissen lässt sich keine belastbare Zahl paralleler Nutzer für Netlify Free und Supabase Free ableiten. Das vorhandene `LIVE_AUCTION_RUNBOOK.md` für 300 Teilnehmer setzt Pro-Tarife und ein separates Stagingprojekt voraus; diese Voraussetzungen sind aktuell nicht erfüllt. Ein Lasttest gegen das echte Projekt wurde nicht gestartet.

Netlify-Deployment, Verhalten unter Veranstaltungslast, projektspezifische Auth-Ratelimits, Wiederherstellung von Backups und andere Browserengines wurden nicht geprüft.

## Verbleibende Generalprobe

Für die Generalprobe ein separates Supabase-Testprojekt einrichten und dort die echten Schreibabläufe, unabhängige Authsessions sowie die geplante Teilnehmerlast prüfen. Diese Prüfung bleibt nach den lokalen Fehlerkorrekturen offen.
