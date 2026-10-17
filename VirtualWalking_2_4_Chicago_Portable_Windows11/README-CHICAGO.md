# VirtualWalking 2.4 – Chicago Collection (Windows 11)

## Neu
- Private Chicago-Bibliothek getrennt von der EXE unter `Videos\VirtualWalking\Chicago` (oder Windows-Dokumente als Ersatz).
- Lokale MP4/WebM-Dateien über **Importieren** in die Sammlung kopieren.
- Bibliothek zeigt gespeicherte Videos und spielt sie per internem HTTP-Server mit Byte-Range-Unterstützung ab.
- Direkte HTTPS-MP4/WebM-Dateien können bei bestätigter Downloadberechtigung **parallel zur Onlinewiedergabe** in die Bibliothek gespeichert werden. Download vollständig und atomar; nach Abschluss offline nutzbar.
- Chicago-Suchkategorien Riverwalk, Downtown/Loop, Lakefront Trail, Magnificent Mile, Millennium Park und Nacht. Die Links öffnen nur die Suche, enthalten keine Videos.
- Bei längerem Ausfall eines Onlinevideos kann automatisch das erste gespeicherte Chicago-Video als Ersatz gestartet werden (in der Oberfläche abschaltbar; kein nahtloser Ortswechsel).
- Anzeige der verfügbaren Puffersekunden bei direkten Onlinevideos; 60 Sekunden sind ein Zielwert, keine garantierte Vorpufferung.
- YouTube wird ausschließlich über den offiziellen eingebetteten Player abgespielt, ohne Download.
- Bestehende FTMS-Laufbandverbindung, Trainingshistorie und Video-Manager bleiben erhalten.

## Wichtige Grenzen
- Die App enthält keine urheberrechtlich geschützten Chicago-Videos und verteilt deine persönliche Sammlung nicht mit.
- Die Puffergröße von YouTube lässt sich nicht frei festlegen. Bei direkten MP4-Dateien zeigt der Video-Manager Pufferprobleme an, eine feste 60-Sekunden-Vorpufferung ist noch nicht implementiert.
- Der Ersatzvideo-Wechsel ist nicht nahtlos und startet die lokale Aufnahme am Anfang. Keine automatische Offline-Übernahme beim ersten Online-Aufruf; der Download muss explizit gestartet werden.
- Downloads erfordern einen direkten HTTPS-Link mit `.mp4` oder `.webm` und deine Berechtigungsbestätigung. Nicht alle Anbieter erlauben dies.
- Kein echter Windows-Hardwaretest und kein fertig kompiliertes EXE-Binary enthalten.

## EXE auf Windows 11 bauen
1. Node.js LTS installieren.
2. ZIP entpacken, im Projektordner Windows-Terminal öffnen.
3. `npm install`
4. `npm test`
5. `npm run dist:win`
6. Fertige `VirtualWalking-Portable-2.4.0.exe` aus `dist` starten.

Alternativ den kompletten Projektinhalt in ein GitHub-Repository hochladen und **Actions > Windows Portable EXE > Run workflow** ausführen. Das Build-Artefakt enthält die EXE.

Die EXE kann ohne klassische Installation gestartet werden; die private Chicago-Sammlung bleibt separat im Benutzerordner.
