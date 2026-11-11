# Funktionstest und Fehlerkorrekturen des Auktionstools

Stand: 11. November 2026. Geprüft wurde der aktuelle lokale Projektstand mit Next.js 16.4.2 und Microsoft Edge. Gebuchte Tarife laut Nutzer: Netlify Free und Supabase Free.

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
