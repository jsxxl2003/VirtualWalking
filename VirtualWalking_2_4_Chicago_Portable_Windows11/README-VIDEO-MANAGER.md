# VirtualWalking 2.3 – Intelligenter Video-Manager

## Neue Funktionen
- Gemeinsame Start/Pause/Stopp-Bedienung für lokale MP4/WebM, direkte HTTP(S)-MP4/WebM und eingebettete YouTube-Videos (YouTube-API soweit vom Anbieter erlaubt).
- Onlinevideo-Überwachung: wartet auf Wiedergabefortschritt, erkennt längere Hänger und versucht maximal dreimal mit Abstand eine Wiederherstellung samt Zeitposition, soweit der Server Seeking unterstützt.
- Sichtbare Puffer- und Wiedergabestatusanzeige.
- Sanftere FTMS-Geschwindigkeitsanpassung bei HTML5-Videos.
- Trainingsaufzeichnung läuft unabhängig von Videoproblemen weiter.
- Keine Downloads, kein Umgehen von YouTube-Beschränkungen.

## Grenzen
- YouTube verwaltet seinen eigenen Puffer und die Qualität. Die App kann keine feste Puffergröße garantieren oder eine gesperrte Einbettung umgehen.
- Eine Online-MP4-Adresse muss eine tatsächlich direkt abspielbare Videodatei liefern; nicht jede Webseite mit Video ist geeignet.
- Browser können Autoplay blockieren.
- Wiederaufnahme an der Zeitposition setzt voraus, dass der Server Range/Seeking unterstützt.
- FTMS-Motorsteuerung bleibt deaktiviert.
- Windows-Electron-Paket ist ein Buildprojekt, noch keine kompilierte EXE.

## Build unter Windows 11
Node.js LTS installieren, im entpackten Ordner `npm install`, `npm test`, `npm run dist:win` ausführen.
Die EXE wird nach erfolgreichem Build im Ordner `dist` erzeugt.
Für die Web-App nur den Unterordner `web` nutzen und mit einem lokalen HTTP-Server öffnen (z.B. Python `py -m http.server 8765` im Ordner web).
