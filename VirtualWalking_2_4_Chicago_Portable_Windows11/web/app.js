'use strict';
const FTMS='00001826-0000-1000-8000-00805f9b34fb', DATA='00002acd-0000-1000-8000-00805f9b34fb';
const MACHINE_STATUS='00002ada-0000-1000-8000-00805f9b34fb';
const $=id=>document.getElementById(id);
let device=null, characteristic=null, speed=0, distance=null, session=null, elapsed=0, startedAt=0, timer=null, videoObjectUrl=null;
let lastTelemetry=0, activeVideoKind="none", lastVideoRate=1, syncPaused=false;
let ytPlayer=null,tvSource=null,tvActive=false,remoteTvMode=false,remoteTvPlaying=false,remoteTvLoaded=false,remoteTvVideoId=null;
let remoteTvQueue=Promise.resolve();
let lastRemoteRate=null,lastRemoteRateAt=0;
function experimentalTvRate(){
 const status=$('loungeRateStatus'),opt=$('loungeRateExperiment');
 if(!opt?.checked||!remoteTvMode||!remoteTvLoaded||!remoteTvPlaying||!session?.running||!treadmillIsMoving())return;
 if(!$('syncEnabled').checked){status.textContent='Geschwindigkeitstest wartet: Synchronisation aktivieren.';return;}
 const ref=Number($('referenceSpeed').value);
 if(!Number.isFinite(ref)||ref<1)return;
 const desired=Math.max(.5,Math.min(2,speed/ref));
 const rate=tvRateSteps.reduce((best,step)=>Math.abs(step-desired)<Math.abs(best-desired)?step:best,1);
 const now=Date.now();
 if(rate===lastRemoteRate||now-lastRemoteRateAt<4000)return;
 lastRemoteRate=rate;lastRemoteRateAt=now;
 remoteTvQueue=remoteTvQueue.catch(()=>{}).then(async()=>{
  if(!remoteTvMode||!remoteTvLoaded||!remoteTvPlaying||!opt.checked)return;
  try{
   await window.vwDesktop.loungeSetRate(rate);
   status.textContent='Testbefehl '+rate.toLocaleString('de-DE')+'× gesendet – bitte Wirkung am Philips prüfen.';
  }catch(e){
   opt.checked=false;status.textContent='Geschwindigkeitstest deaktiviert: '+e.message;
  }
 });
}

function treadmillIsMoving(){return !!device?.gatt?.connected&&speed>=0.2;}
function remoteTvSetPlaying(playing){
 if(!remoteTvMode)return;
 // TV playback requires actual belt movement; Start alone must not autoplay.
 const shouldPlay=!!playing&&treadmillIsMoving();
 if(remoteTvPlaying===shouldPlay)return;
 remoteTvPlaying=shouldPlay;
 remoteTvQueue=remoteTvQueue.catch(()=>{}).then(async()=>{
  if(!remoteTvMode)return;
  try{
   if(shouldPlay){
    if(!remoteTvLoaded){
     if(!remoteTvVideoId)throw Error('Kein YouTube-Video vorgemerkt.');
     await window.vwDesktop.loungePlay(remoteTvVideoId);
     remoteTvLoaded=true;lastRemoteRate=null;
    }else await window.vwDesktop.loungeResume();
    $('loungeStatus').textContent='Philips: Video läuft mit dem Laufband.';
   }else if(remoteTvLoaded){
    await window.vwDesktop.loungePause();
    $('loungeStatus').textContent='Philips: Video pausiert.';
   }
  }catch(e){
   remoteTvPlaying=false;
   $('loungeStatus').textContent='Philips-Steuerung fehlgeschlagen: '+e.message;
  }
 });
}
let statusCharacteristic=null, zeroSince=0, movingSince=0, movingSamples=0;
let automaticStopLock=false, manualPauseHold=false;
const AUTO_ZERO_PAUSE_MS=2500;
function clearMotionCounters(){zeroSince=0;movingSince=0;movingSamples=0;}
function onMachineStatus(event){
 const v=event.target.value;
 if(!v||v.byteLength<1)return;
 const op=v.getUint8(0);
 // FTMS Fitness Machine Status: 0x02 stop/pause by user, 0x03 safety stop,
 // 0x04 started/resumed by user. No motor-control commands are sent.
 if(op===0x02&&v.byteLength>=2){
  const reason=v.getUint8(1);
  if(reason===0x01){automaticStopLock=true;manualPauseHold=false;speed=0;clearMotionCounters();if(session)stop();announce('Laufband per Fernbedienung beendet – Training gespeichert.');ui();}
  else if(reason===0x02){manualPauseHold=true;speed=0;clearMotionCounters();if(session?.running)pause(true);announce('Laufband per Fernbedienung pausiert.');ui();}
 }else if(op===0x03){
  automaticStopLock=true;manualPauseHold=false;speed=0;clearMotionCounters();if(session)stop();announce('Sicherheitsstopp erkannt – Training gespeichert.');ui();
 }else if(op===0x04){
  automaticStopLock=false;manualPauseHold=false;clearMotionCounters();if(!session?.running)begin(true);announce('Laufband gestartet – Training läuft.');ui();
 }
}
function followTreadmillMotion(){
 if(!device?.gatt?.connected)return;
 const now=Date.now();
 if(speed>=0.2){
  zeroSince=0;
  if(automaticStopLock||manualPauseHold)return;
  if(!movingSince)movingSince=now;
  movingSamples++;
  if(!session?.running&&movingSamples>=2&&now-movingSince>=250)begin(true);
 }else if(speed<0.1){
  movingSince=0;movingSamples=0;
  if(!zeroSince)zeroSince=now;
  if(automaticStopLock)automaticStopLock=false;
  // Manual pause remains in force until the user explicitly resumes.
  if(session?.running&&now-zeroSince>=AUTO_ZERO_PAUSE_MS){
   pause(true);announce('Laufband steht – Training und Video pausiert.');
  }
 }
}

const manager=new VirtualWalkingVideoManager({
 video:$('video'),
 onStatus:status=>{$('videoHealth').textContent=status;},
 onMessage:message=>announce(message),
 onFallback:kind=>window.virtualWalkingFallback?.(kind)
});
function sendTvState(){
 if(!tvActive||!window.vwDesktop)return;
 const enabled=$('syncEnabled').checked,ref=Number($('referenceSpeed').value);
 const rate=enabled&&device?.gatt?.connected&&ref>=1?Math.max(.5,Math.min(2,speed/ref)):1;
 const playing=!!session?.running&&(!enabled||!$('pauseAtZero').checked||speed>=.1);
 window.vwDesktop.sendTvState({playing,rate,time:null});
}
// TV-Direkt-Test: YouTube plays in the TV's own app via the browser's Cast menu.
// The YouTube remote receiver is NOT controlled by VirtualWalking; show the
// suggested playback speed honestly rather than claiming automatic TV sync.
const tvRateSteps=[.5,.75,1,1.25,1.5,1.75,2];
let lastTvSpokenRate=null,lastTvSpokenAt=0;
function directTvSuggestedRate(){
 const ref=Number($('referenceSpeed').value);
 return $('syncEnabled').checked&&device?.gatt?.connected&&ref>=1
  ?Math.max(.5,Math.min(2,speed/ref)):1;
}
function directTvStep(rate){
 return tvRateSteps.reduce((best,item)=>Math.abs(item-rate)<Math.abs(best-rate)?item:best,1);
}
function updateDirectTvHint(){
 const el=$('directTvRate');
 if(!el)return;
 const youtube=tvSource?.kind==='youtube';
 const connected=$('directTvConnected').checked;
 const rate=directTvStep(directTvSuggestedRate());
 const label=rate.toLocaleString('de-DE',{maximumFractionDigits:2})+'×';
 el.textContent=youtube?label:'—';
 $('directTvConnection').textContent=connected?'Übertragung manuell bestätigt':'Noch nicht bestätigt';
 $('directTvRateHelp').textContent=youtube?(device?.gatt?.connected?'Nach Laufbandtempo – manuell am TV einstellen':'Laufband verbinden für Live-Empfehlung'):'Zuerst YouTube-Video auswählen';
 if(!youtube||!connected||!$('directTvVoice').checked||!session?.running||!device?.gatt?.connected){lastTvSpokenRate=null;return;}
 if(lastTvSpokenRate===null){lastTvSpokenRate=rate;return;}
 if(rate===lastTvSpokenRate)return;
 const now=Date.now();
 if(now-lastTvSpokenAt<10000)return;
 lastTvSpokenRate=rate;lastTvSpokenAt=now;
 if('speechSynthesis' in window){
  window.speechSynthesis.cancel();
  const msg=new SpeechSynthesisUtterance('Fernseher Geschwindigkeit '+rate.toLocaleString('de-DE',{maximumFractionDigits:2}));
  msg.lang='de-DE';msg.rate=1;
  window.speechSynthesis.speak(msg);
 }
}
$('directTvConnected').addEventListener('change',()=>{
 lastTvSpokenRate=null;
 announce($('directTvConnected').checked?'TV-Übertragung manuell bestätigt. Die angezeigte Geschwindigkeit bitte am Philips einstellen.':'TV-Übertragung als getrennt markiert.');
 updateDirectTvHint();
});
$('directTvVoice').addEventListener('change',()=>{lastTvSpokenRate=null;if(!$('directTvVoice').checked&&'speechSynthesis' in window)window.speechSynthesis.cancel();});
$('sendYoutubeToPhilips').addEventListener('click',async()=>{
 const button=$('sendYoutubeToPhilips'),status=$('philipsDialStatus');
 if(tvSource?.kind!=='youtube'||!/^[a-zA-Z0-9_-]{11}$/.test(tvSource.youtubeId||'')){
  status.textContent='Bitte zuerst ein YouTube-Laufvideo auswählen.';return;
 }
 if(!window.vwDesktop?.sendYoutubeToPhilips){status.textContent='Nur in der Windows-EXE verfügbar.';return;}
 button.disabled=true;status.textContent='Sende ausgewähltes Video direkt an Philips 192.168.0.27 (DIAL-Test) …';
 try{const result=await window.vwDesktop.sendYoutubeToPhilips(tvSource.youtubeId);status.textContent=result.message;}
 catch(e){status.textContent='Direkte Übertragung fehlgeschlagen: '+e.message;}
 finally{button.disabled=false;}
});
$('launchPhilipsYoutube').addEventListener('click',async()=>{
 const button=$('launchPhilipsYoutube'),status=$('philipsDialStatus');
 if(!window.vwDesktop?.launchPhilipsYoutube){status.textContent='Nur in der Windows-EXE verfügbar.';return;}
 button.disabled=true;status.textContent='Sende YouTube-Startbefehl direkt an Philips 192.168.0.27 …';
 try{const result=await window.vwDesktop.launchPhilipsYoutube();status.textContent=result.message;}
 catch(e){status.textContent='TV-Starttest fehlgeschlagen: '+e.message;}
 finally{button.disabled=false;}
});
$('checkPhilipsCast').addEventListener('click',async()=>{
 const button=$('checkPhilipsCast'),status=$('philipsCastStatus');
 if(!window.vwDesktop?.checkPhilipsCast){status.textContent='Dieser Test ist nur in der Windows-EXE verfügbar.';return;}
 button.disabled=true;status.textContent='Prüfe Google-Cast-Verbindung zu Philips 192.168.0.27 …';
 try{
  const result=await window.vwDesktop.checkPhilipsCast();
  status.textContent=result.message;
 }catch(e){status.textContent='Kompatibilitätsprüfung fehlgeschlagen: '+e.message;}
 finally{button.disabled=false;}
});
$('checkPhilipsDial').addEventListener('click',async()=>{
 const button=$('checkPhilipsDial'),status=$('philipsDialStatus');
 if(!window.vwDesktop?.checkPhilipsDial){status.textContent='Nur in der Windows-EXE verfügbar.';return;}
 button.disabled=true;status.textContent='Prüfe DIAL-/YouTube-Schnittstelle des Philips …';
 try{const result=await window.vwDesktop.checkPhilipsDial();status.textContent=result.message+(result.state?' (App-Status: '+result.state+')':'');}
 catch(e){status.textContent='Verbindungstest fehlgeschlagen: '+e.message;}
 finally{button.disabled=false;}
});
$('discoverTv').addEventListener('click',async()=>{
 const button=$('discoverTv'),status=$('tvDiscoveryStatus'),results=$('tvDiscoveryResults');
 if(!window.vwDesktop?.discoverTv){status.textContent='Die Suche funktioniert nur in der Windows-EXE.';return;}
 button.disabled=true;results.replaceChildren();status.textContent='Suche im Heimnetzwerk (ca. 4 Sekunden) …';
 try{
  const devices=await window.vwDesktop.discoverTv();
  if(!devices.length){status.textContent='Kein kompatibler Empfänger gefunden. Die manuelle YouTube-Übertragung bleibt möglich.';return;}
  status.textContent=devices.length+' mögliche(r) TV-Empfänger gefunden. Noch keine automatische Steuerung.';
  const philips=devices.find(d=>d.ip==='192.168.0.27');
  $('philipsTarget').textContent=philips?'Philips Ambilight unter 192.168.0.27 gefunden ('+philips.kind+'). Direkte Wiedergabe wird noch geprüft.':'Philips unter 192.168.0.27 nicht gefunden. Möglicherweise hat sich die IP-Adresse geändert.';
  for(const item of devices){
   const line=document.createElement('div');
   line.textContent=item.kind+' – '+item.ip+(item.description?' ('+item.description+')':'');
   results.append(line);
  }
 }catch(e){status.textContent='Gerätesuche fehlgeschlagen: '+e.message;}
 finally{button.disabled=false;}
});
// Direct YouTube TV-code test (unofficial Lounge API).
async function refreshLoungeStatus(){
 const el=$('loungeStatus');
 if(!window.vwDesktop?.loungeStatus){el.textContent='TV-Code-Kopplung nur in der Windows-EXE verfügbar.';return;}
 try{const result=await window.vwDesktop.loungeStatus();
  el.textContent=result.paired?'Philips/YouTube gekoppelt – Video auswählen und an TV senden.':'Noch kein TV-Code gekoppelt.';
 }catch(e){el.textContent='Status konnte nicht gelesen werden: '+e.message;}
}
$('loungePair').addEventListener('click',async()=>{
 const btn=$('loungePair'),code=$('loungeCode').value.trim();
 if(!window.vwDesktop?.loungePair){announce('Bitte die neue Windows-EXE starten.');return;}
 btn.disabled=true;$('loungeStatus').textContent='TV-Code wird geprüft …';
 try{const result=await window.vwDesktop.loungePair(code);
  $('loungeCode').value='';
  $('loungeStatus').textContent='Gekoppelt: '+result.name+'. Jetzt ein YouTube-Video an den Philips senden.';
 }catch(e){$('loungeStatus').textContent='Kopplung fehlgeschlagen: '+e.message;}
 finally{btn.disabled=false;}
});
$('loungePlay').addEventListener('click',()=>{
 if(tvSource?.kind!=='youtube'||!/^[a-zA-Z0-9_-]{11}$/.test(tvSource.youtubeId||'')){
  announce('Bitte zuerst ein YouTube-Video in VirtualWalking auswählen.');return;
 }
 if(!window.vwDesktop?.loungePlay){announce('Bitte die neue Windows-EXE starten.');return;}
 const newId=tvSource.youtubeId;
 if(remoteTvVideoId!==newId)remoteTvLoaded=false;
 remoteTvVideoId=newId;remoteTvMode=true;remoteTvPlaying=false;lastRemoteRate=null;
 manager.pause();$('video').pause();
 $('videoWrap').classList.add('tv-remote');$('loungeBackToApp').hidden=false;
 $('loungeStatus').textContent='Video für Philips vorgemerkt. Start erst bei laufendem Laufband.';
 remoteTvSetPlaying(!!session?.running);
 updateVideoSync();
});
$('loungeRateExperiment').addEventListener('change',()=>{
 lastRemoteRate=null;lastRemoteRateAt=0;
 $('loungeRateStatus').textContent=$('loungeRateExperiment').checked?'Geschwindigkeitstest aktiv. Starte das Laufband und beobachte den Philips.':'Geschwindigkeitstest aus.';
 if($('loungeRateExperiment').checked)experimentalTvRate();
});
$('loungeBackToApp').addEventListener('click',async()=>{
 const btn=$('loungeBackToApp');btn.disabled=true;
 try{
  if(remoteTvLoaded)await window.vwDesktop.loungePause();
  remoteTvMode=false;remoteTvPlaying=false;remoteTvLoaded=false;remoteTvVideoId=null;$('videoWrap').classList.remove('tv-remote');btn.hidden=true;
  if(session?.running)manager.play();
  $('loungeStatus').textContent='App-Modus aktiv: Pause-Befehl an Philips gesendet.';
  updateVideoSync();
 }catch(e){$('loungeStatus').textContent='TV konnte nicht pausiert werden: '+e.message+' – App bleibt im TV-Modus.';}
 finally{btn.disabled=false;}
});
$('loungeUnpair').addEventListener('click',async()=>{
 if(!window.vwDesktop?.loungeUnpair)return;
 try{await window.vwDesktop.loungeUnpair();remoteTvMode=false;remoteTvPlaying=false;$('videoWrap').classList.remove('tv-remote');$('loungeBackToApp').hidden=true;$('loungeStatus').textContent='Kopplung gelöscht. TV-Wiedergabe gegebenenfalls direkt am Philips beenden.';}
 catch(e){$('loungeStatus').textContent='Löschen fehlgeschlagen: '+e.message;}
});
refreshLoungeStatus();

$('youtubeDirectTv').addEventListener('click',()=>{
 if(tvSource?.kind!=='youtube'||!/^[a-zA-Z0-9_-]{11}$/.test(tvSource.youtubeId||'')){
  announce('Bitte zuerst einen YouTube-Link als Laufvideo öffnen.');return;
 }
 const url='https://www.youtube.com/watch?v='+tvSource.youtubeId;
 // Electron's existing setWindowOpenHandler opens HTTPS links in the system browser.
 const opened=window.open(url,'_blank','noopener,noreferrer');
 updateDirectTvHint();
 announce('YouTube wurde im Browser geöffnet. Beim ersten Mal Philips über „Übertragen“ auswählen. Beim nächsten Video prüfen, ob die Chrome-Verbindung bestehen bleibt.');
});
$('sendToTv').addEventListener('click',async()=>{
 if(!window.vwDesktop?.openTv){announce('Die Fernseher-Funktion ist nur in der Windows-EXE verfügbar.');return;}
 if(!tvSource){announce('Bitte zuerst ein Laufvideo auswählen.');return;}
 try{
  await window.vwDesktop.openTv();
  await window.vwDesktop.loadTv(tvSource);
  tvActive=true;$('closeTv').hidden=false;$('tvStatus').textContent='Fernseher aktiv';
  manager.pause();sendTvState();announce('Video auf dem zweiten Bildschirm geöffnet.');
 }catch(e){announce('Fernseher: '+e.message);$('tvStatus').textContent='Verbindung nicht möglich';}
});
$('closeTv').addEventListener('click',async()=>{await window.vwDesktop?.closeTv();tvActive=false;$('closeTv').hidden=true;$('tvStatus').textContent='';if(session?.running)manager.play();});
window.vwDesktop?.onTvClosed(()=>{tvActive=false;$('closeTv').hidden=true;$('tvStatus').textContent='';if(session?.running)manager.play();});
function videoAction(action){
 if(remoteTvMode){manager.pause();remoteTvSetPlaying(action==='play');return;}
 if(tvActive){if(action==='stop')window.vwDesktop?.sendTvState({playing:false,rate:1,time:0});else sendTvState();return;}
 if(action==='play')manager.play();
 else if(action==='pause')manager.pause();
 else manager.stop();
}

const fmt=n=>Number(n).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2});
const announce=(s)=>{$('message').textContent=s;};
function formatTime(sec){sec=Math.max(0,Math.floor(sec));return `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor(sec%3600/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function workoutKm(){if(!session)return distance??0;const native=(distance!==null&&session.startDistance!==null)?distance-session.startDistance:null;return native!==null&&native>=0?native:session.estimatedKm;}
function getSeconds(){return elapsed+(session?.running?(Date.now()-startedAt)/1000:0);}
function caloriesFor(s, secs){const weight=Number($('weight').value);if(!Number.isFinite(weight)||weight<25||weight>300)return null;const avg=secs>0?s.sumKmhSeconds/secs:0;const met=avg<1?1:avg<3?2.5:avg<5?3.5:avg<6.5?4.3:avg<8?6:8.3;return Math.round(met*3.5*weight/200*(secs/60));}
function ui(){const secs=getSeconds();$('speed').textContent=speed.toFixed(1).replace('.',',');$('distance').textContent=fmt(workoutKm());$('duration').textContent=formatTime(secs);$('averageSpeed').textContent=(session&&secs>0?session.sumKmhSeconds/secs:0).toFixed(1).replace('.',',');const kcal=session?caloriesFor(session,secs):null;$('calories').textContent=kcal===null?'—':kcal;$('start').disabled=!!session?.running;$('pause').disabled=!session?.running;$('stop').disabled=!session;$('start').textContent=session?'▶ Fortsetzen':'▶ Training starten';updateVideoSync();sendTvState();updateDirectTvHint();}
// FTMS 0x2ACD: flags uint16 LE, instantaneous speed uint16 / 100 km/h,
// optional avg speed (bit 1), total distance (bit 2, uint24 meters), etc.
function parseTreadmillData(view){if(view.byteLength<2)throw new Error('Zu kurzes FTMS-Datenpaket');let flags=view.getUint16(0,true), pos=2;const take=n=>{if(pos+n>view.byteLength)throw new Error('Unvollständige FTMS-Daten');let at=pos;pos+=n;return at;};let nextSpeed=null, nextDistance=null;
// FTMS field semantics: speed absent when bit 0 is set.
if(!(flags&1)) nextSpeed=view.getUint16(take(2),true)/100;
if(flags&2)take(2); // average speed
if(flags&4){let off=take(3); nextDistance=(view.getUint8(off)|(view.getUint8(off+1)<<8)|(view.getUint8(off+2)<<16))/1000;}
return {speed:nextSpeed,distance:nextDistance,flags};}
function onData(event){try{const now=performance.now();const d=parseTreadmillData(event.target.value);if(d.speed!==null)speed=d.speed;if(d.distance!==null)distance=d.distance;if(session?.running){const dt=lastTelemetry?Math.max(0,Math.min(5,(now-lastTelemetry)/1000)):0;session.sumKmhSeconds+=Math.max(0,speed)*dt;session.estimatedKm+=Math.max(0,speed)*dt/3600;}lastTelemetry=now;followTreadmillMotion();ui();}catch(err){announce('FTMS-Paket konnte nicht gelesen werden: '+err.message);}}
function disconnected(){if(session?.running){pause(true);announce('Bluetooth getrennt – Training und Video vorsorglich pausiert.');}device=null;characteristic=null;statusCharacteristic=null;speed=0;lastTelemetry=0;clearMotionCounters();automaticStopLock=false;manualPauseHold=false;$('dot').classList.remove('active');$('connectionStatus').textContent='Nicht verbunden';$('connectionHint').textContent='WELLFIT TM Linker';$('connect').disabled=false;$('disconnect').disabled=true;$('sourceBadge').textContent='Keine Live-Verbindung';announce('Bluetooth-Verbindung getrennt.');ui();}
async function connect(){if(!navigator.bluetooth){announce('Web Bluetooth ist hier nicht verfügbar. Verwende Chrome/Edge über http://localhost:8765.');return;}try{$('connect').disabled=true;announce('Warte auf die Auswahl des Laufbands …');device=await navigator.bluetooth.requestDevice({filters:[{services:[FTMS]}],optionalServices:[FTMS]});device.addEventListener('gattserverdisconnected',disconnected);const server=await device.gatt.connect();const service=await server.getPrimaryService(FTMS);characteristic=await service.getCharacteristic(DATA);await characteristic.startNotifications();characteristic.addEventListener('characteristicvaluechanged',onData);
 // Optional: FTMS status events distinguish remote pause from remote stop.
 try{
  statusCharacteristic=await service.getCharacteristic(MACHINE_STATUS);
  statusCharacteristic.addEventListener('characteristicvaluechanged',onMachineStatus);
  await statusCharacteristic.startNotifications();
 }catch(e){statusCharacteristic=null;console.info('FTMS-Maschinenstatus nicht verfügbar; Stillstand wird als Pause erkannt.',e);}
 clearMotionCounters();automaticStopLock=false;manualPauseHold=false;
 $('dot').classList.add('active');$('connectionStatus').textContent='Verbunden';$('connectionHint').textContent=device.name||'FTMS-Laufband';$('disconnect').disabled=false;$('sourceBadge').textContent='FTMS Live';announce('WELLFIT/FTMS verbunden. Laufband nur am Gerät bedienen.');}catch(e){$('connect').disabled=false;announce(e.name==='NotFoundError'?'Geräteauswahl abgebrochen oder kein FTMS-Gerät gefunden.':'Bluetooth-Fehler: '+e.message);if(device&&!device.gatt?.connected)disconnected();}}
$('connect').onclick=connect;$('disconnect').onclick=()=>{if(device?.gatt?.connected)device.gatt.disconnect();else disconnected();};
$('bleHint').textContent=navigator.bluetooth?'Bluetooth ist verfügbar. Chrome/Edge benötigt localhost oder HTTPS.':'Web Bluetooth nicht verfügbar – öffne die App in Chrome oder Edge über den lokalen Starter.';
function begin(fromTreadmill=false){if(!fromTreadmill&&!device?.gatt?.connected){if(!confirm('Kein Laufband verbunden. Die Aufzeichnung kann ohne Live-Daten keine echte Strecke erfassen. Trotzdem starten?'))return;}
 if(!fromTreadmill){manualPauseHold=false;automaticStopLock=false;clearMotionCounters();} if(session?.running)return;
 if(session){session.running=true;startedAt=Date.now();lastTelemetry=0;}else{session={started:new Date().toISOString(),startDistance:distance,running:true,estimatedKm:0,sumKmhSeconds:0};elapsed=0;startedAt=Date.now();lastTelemetry=0;}videoAction('play');announce('Trainingsaufzeichnung läuft.');ui();}
function pause(fromTreadmill=false){if(!session?.running)return;if(!fromTreadmill)manualPauseHold=true;elapsed+=(Date.now()-startedAt)/1000;session.running=false;lastTelemetry=0;videoAction('pause');announce('Aufzeichnung pausiert. Das Laufband läuft gegebenenfalls weiter!');ui();}
function stop(){manualPauseHold=true;if(!session){videoAction('stop');return;}if(session.running)pause(true);const secs=Math.round(elapsed),km=Number(Math.max(0,workoutKm()).toFixed(3));const item={date:session.started,duration:secs,km,averageSpeed:Number((secs?session.sumKmhSeconds/secs:0).toFixed(2)),calories:caloriesFor(session,secs),route:$('videoTitle').textContent,source:device?.gatt?.connected?'FTMS':'Ohne Gerät'};const arr=history();arr.unshift(item);try{localStorage.setItem('virtualwalking_history',JSON.stringify(arr.slice(0,500)));}catch(e){announce('Speicherung fehlgeschlagen: '+e.message);}videoAction('stop');session=null;elapsed=0;renderHistory();announce('Training gespeichert.');ui();}
$('start').onclick=()=>begin();$('pause').onclick=()=>pause();$('stop').onclick=()=>{automaticStopLock=true;stop();};timer=setInterval(()=>{followTreadmillMotion();if(remoteTvMode){remoteTvSetPlaying(!!session?.running);experimentalTvRate();}ui();},500);ui();
function history(){try{return JSON.parse(localStorage.getItem('virtualwalking_history')||'[]')}catch{return []}}
function renderHistory(){const hist=history();$('history').replaceChildren();if(!hist.length){const t=document.createElement('small');t.textContent='Noch keine abgeschlossenen Einheiten.';$('history').append(t);}for(let h of hist.slice(0,20)){const e=document.createElement('div');e.className='history-item';const a=document.createElement('b');a.textContent=`${Number(h.km||0).toFixed(2).replace('.',',')} km · ${formatTime(h.duration||0)}`;const b=document.createElement('small');b.textContent=`${new Date(h.date).toLocaleString('de-DE')} · Ø ${h.averageSpeed==null?'—':Number(h.averageSpeed).toFixed(1)+' km/h'} · ${h.calories==null?'—':h.calories+' kcal'} · ${h.route||h.source}`;e.append(a,b);$('history').append(e);}const now=new Date(),weekStart=new Date(now);weekStart.setDate(now.getDate()-((now.getDay()+6)%7));weekStart.setHours(0,0,0,0);const monthStart=new Date(now.getFullYear(),now.getMonth(),1);$('summary').replaceChildren();for(const [title,from] of [['Diese Woche',weekStart],['Dieser Monat',monthStart]]){const records=hist.filter(h=>new Date(h.date)>=from);const div=document.createElement('div');div.className='summary-item';const label=document.createElement('small');label.textContent=title;const value=document.createElement('b');value.textContent=`${fmt(records.reduce((n,h)=>n+Number(h.km||0),0))} km`;const sub=document.createElement('small');sub.textContent=`${records.length} Einheiten · ${formatTime(records.reduce((n,h)=>n+Number(h.duration||0),0))}`;div.append(label,value,sub);$('summary').append(div);}}
renderHistory();
$('clear').onclick=()=>{if(confirm('Alle lokal gespeicherten Trainingseinheiten löschen?')){localStorage.removeItem('virtualwalking_history');renderHistory();announce('Trainingshistorie gelöscht.');}};
$('export').onclick=()=>{const data=history(), rows=['Datum;Dauer_Sekunden;Strecke_km;Durchschnitt_kmh;Kalorien_geschaetzt;Quelle;Strecke_Name',...data.map(h=>[h.date,h.duration,String(h.km).replace('.',','),h.averageSpeed==null?'':String(h.averageSpeed).replace('.',','),h.calories??'',h.source, String(h.route||'').replaceAll(';',',').replaceAll('\n',' ')].join(';'))];const file=new Blob(['\uFEFF'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download='VirtualWalking_Trainingshistorie.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
// On Windows use the native Electron fullscreen window plus a fixed player surface.
// Browser Fullscreen API remains available for the web version.
const fullscreenSurface=$('videoWrap'),fullscreenButton=$('videoFullscreen');
let desktopVideoFullscreen=false;
function renderVideoFullscreen(active){
 desktopVideoFullscreen=!!active;
 fullscreenSurface.classList.toggle('desktop-video-fullscreen',desktopVideoFullscreen);
 fullscreenButton.textContent=active?'⛶ Vollbild beenden':'⛶ Vollbild';
 fullscreenButton.setAttribute('aria-label',active?'Vollbild beenden':'Video im Vollbild anzeigen');
}
fullscreenButton.addEventListener('click',async()=>{
 try{
  if(window.vwDesktop?.setDesktopFullscreen){
   const next=!desktopVideoFullscreen;
   renderVideoFullscreen(next);
   const result=await window.vwDesktop.setDesktopFullscreen(next);
   if(next&&!result){renderVideoFullscreen(false);announce('Vollbild konnte nicht aktiviert werden.');}
  }else if(document.fullscreenElement){await document.exitFullscreen();}
  else if(fullscreenSurface.requestFullscreen){await fullscreenSurface.requestFullscreen();}
  else announce('Vollbild wird von diesem Fenster nicht unterstützt.');
 }catch(e){renderVideoFullscreen(false);announce('Vollbild konnte nicht aktiviert werden: '+e.message);}
});
window.vwDesktop?.onDesktopFullscreenState(active=>renderVideoFullscreen(active));
document.addEventListener('fullscreenchange',()=>{
 if(!window.vwDesktop?.setDesktopFullscreen)renderVideoFullscreen(document.fullscreenElement===fullscreenSurface);
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&desktopVideoFullscreen&&window.vwDesktop?.setDesktopFullscreen){
  event.preventDefault();renderVideoFullscreen(false);window.vwDesktop.setDesktopFullscreen(false).catch(e=>announce('Vollbild: '+e.message));
 }
});
function videoReset(){if(remoteTvMode&&remoteTvLoaded){remoteTvQueue=remoteTvQueue.catch(()=>{}).then(()=>window.vwDesktop.loungePause()).catch(e=>{$('loungeStatus').textContent='TV-Pause fehlgeschlagen: '+e.message;});}remoteTvLoaded=false;remoteTvPlaying=false;remoteTvVideoId=null;tvSource=null;manager.pause();if(ytPlayer){try{ytPlayer.destroy();}catch{}}ytPlayer=null;activeVideoKind="none";syncPaused=false;const v=$('video');v.pause();v.removeAttribute('src');v.load();if(videoObjectUrl)URL.revokeObjectURL(videoObjectUrl);videoObjectUrl=null;$('youtube').replaceChildren();$('youtube').hidden=true;v.hidden=false;$('placeholder').hidden=true;}
function loadFile(file){if(!file)return;videoReset();try{const filePath=window.vwDesktop?.localFilePath(file);if(filePath)tvSource={kind:'local',path:filePath};}catch{}videoObjectUrl=URL.createObjectURL(file);$('video').src=videoObjectUrl;activeVideoKind='html5';manager.setLocal(videoObjectUrl);$('videoTitle').textContent=file.name;announce('Lokales Video geladen.');if(session?.running)videoAction('play');}
$('fileInput').onchange=e=>loadFile(e.target.files[0]);
function youtubeId(u){try{const x=new URL(u);let host=x.hostname.replace(/^www\./,'');if(host==='youtu.be')return x.pathname.split('/')[1];if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)){if(x.pathname==='/watch')return x.searchParams.get('v');let match=x.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);return match?.[1]??null;}}catch{}return null;}
let lastVideoChoice=null;
function rememberLastVideo(url,name){
 try{localStorage.setItem('virtualwalking_last_video',JSON.stringify({url,name}));}catch{}
 if(window.vwDesktop?.lastVideoWrite)window.vwDesktop.lastVideoWrite({url,name}).catch(e=>console.warn('Letztes Video konnte nicht gespeichert werden:',e));
 lastVideoChoice={url,name};
 $('restoreLastVideo').hidden=false;
 $('lastVideoHint').hidden=false;
 $('lastVideoHint').textContent='Zuletzt verwendet: '+name;
}
async function initLastVideo(){
 let saved=null;
 if(window.vwDesktop?.lastVideoRead)try{saved=await window.vwDesktop.lastVideoRead();}catch(e){console.warn(e);}
 if(!saved)try{saved=JSON.parse(localStorage.getItem('virtualwalking_last_video')||'null');}catch{}
 if(!saved||typeof saved.url!=='string')return;
 try{const u=new URL(saved.url);if(!['http:','https:'].includes(u.protocol))return;}catch{return;}
 lastVideoChoice=saved;
 $('restoreLastVideo').hidden=false;
 $('lastVideoHint').hidden=false;
 $('lastVideoHint').textContent='Zuletzt verwendet: '+String(saved.name||saved.url).slice(0,120)+' – noch nicht gestartet.';
 $('videoUrl').value=saved.url;
}
$('restoreLastVideo').addEventListener('click',()=>{
 if(!lastVideoChoice)return;
 $('videoUrl').value=lastVideoChoice.url;
 $('loadUrl').click();
});
initLastVideo();
$('loadUrl').onclick=()=>{const value=$('videoUrl').value.trim();if(!value){announce('Bitte Video-Adresse einfügen.');return;}let url;try{url=new URL(value);if(!['https:','http:'].includes(url.protocol))throw Error();}catch{announce('Bitte eine gültige HTTP(S)-Adresse eingeben.');return;}videoReset();const id=youtubeId(value);if(id){if(!/^[a-zA-Z0-9_-]{11}$/.test(id)){announce('Ungültige YouTube-Video-ID.');return;}const iframe=document.createElement('iframe');iframe.src=`https://www.youtube-nocookie.com/embed/${id}?rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;iframe.title='YouTube Laufvideo';iframe.allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share';iframe.allowFullscreen=true;activeVideoKind='youtube';tvSource={kind:'youtube',youtubeId:id};rememberLastVideo(value,'YouTube: '+id);$('video').hidden=true;$('youtube').hidden=false;$('youtube').append(iframe);const attach=()=>{if(window.YT?.Player){try{ytPlayer=new YT.Player(iframe,{events:{onReady:(event)=>{manager.setYoutube(event.target);updateVideoSync();if(session?.running)videoAction('play');},onError:()=>{$('videoHealth').textContent='YouTube: Video nicht abspielbar';}}});}catch(e){announce('YouTube: '+e.message);}}else setTimeout(attach,250);};attach();$('videoTitle').textContent='YouTube-Laufvideo';announce('YouTube-Player geöffnet. Einbettung und Verbindung hängen vom Videoanbieter ab.');}else{activeVideoKind='online';tvSource={kind:'url',url:value};rememberLastVideo(value,'Onlinevideo');$('video').src=value;manager.setOnline(value);$('videoTitle').textContent='Online-Laufvideo';announce('Onlinevideo geladen. Direkter MP4/WebM-Link erforderlich.');if(session?.running)videoAction('play');}};
$('video').addEventListener('error',()=>{if($('video').src)announce('Dieses Video konnte nicht abgespielt werden. Bitte direkten MP4/WebM-Link oder lokale Datei verwenden.');});

// HTML5 uses smooth playback rates; YouTube uses the official player's supported steps.
function updateVideoSync(){if(remoteTvMode){$('syncState').textContent='TV-Modus';$('syncInfo').textContent=$('loungeRateExperiment').checked?'Experimenteller TV-Geschwindigkeitstest aktiv (Wirkung unbestätigt).':'App-Player pausiert. TV-Geschwindigkeitstest optional aktivierbar.';return;}
 const enabled=$('syncEnabled').checked,video=$('video');if(!enabled){$('syncState').textContent='Aus';$('syncInfo').textContent='Synchronisation deaktiviert.';if(['html5','online','youtube'].includes(activeVideoKind))manager.setTargetRate(1);return;}
 if(!['html5','online','youtube'].includes(activeVideoKind)){$('syncState').textContent='Video wählen';return;}
 if(!device?.gatt?.connected){$('syncState').textContent='Warte auf FTMS';$('syncInfo').textContent='Bitte Laufband verbinden. Ohne Live-Daten keine Tempoanpassung.';return;}
 const ref=Number($('referenceSpeed').value);if(!Number.isFinite(ref)||ref<1)return;
 if(speed<0.1&&$('pauseAtZero').checked){if(activeVideoKind!=='youtube'&&!video.paused){video.pause();syncPaused=true;}$('syncState').textContent='Stillstand';$('syncInfo').textContent='Laufband steht. Video pausiert.';return;}
 const rate=Math.max(.5,Math.min(2,speed/ref));
 const applied=manager.setTargetRate(rate);lastVideoRate=rate;
 if(activeVideoKind==='youtube'&&applied===null){$('syncState').textContent='YouTube wartet';$('syncInfo').textContent='Warte auf die verfügbaren YouTube-Geschwindigkeiten.';return;}
 const actual=activeVideoKind==='youtube'?applied:rate;
 $('syncState').textContent=actual.toFixed(2).replace('.',',')+'×';
 $('syncInfo').textContent=`${speed.toFixed(1).replace('.',',')} km/h → ${actual.toFixed(2).replace('.',',')}× Videotempo (Referenz ${ref} km/h)${activeVideoKind==='youtube'?' · YouTube-Stufe':''}.`;
 if(syncPaused&&speed>=.1&&session?.running){syncPaused=false;manager.play();}}
for(const id of ['syncEnabled','pauseAtZero','referenceSpeed'])$(id).addEventListener('change',updateVideoSync);
// Windows profile persists in Electron userData, not the changing localhost origin.
const profileFields={weight:{min:25,max:300},height:{min:100,max:250},age:{min:10,max:120},gender:{values:['female','male','diverse']}};
let profileWriteQueue=Promise.resolve();
function currentProfile(){
 const values={};
 for(const field of Object.keys(profileFields))values[field]=$(field).value.trim();
 return values;
}
function validProfileField(field,raw){
 const rules=profileFields[field],value=Number(raw);
 return !raw||('values' in rules?rules.values.includes(raw):Number.isFinite(value)&&value>=rules.min&&value<=rules.max);
}
async function initializeProfile(){
 const saved={};
 for(const field of Object.keys(profileFields)){
  try{saved[field]=localStorage.getItem('virtualwalking_'+field)||'';}catch{saved[field]='';}
 }
 if(window.vwDesktop?.readProfile){
  try{
   const durable=await window.vwDesktop.readProfile();
   for(const field of Object.keys(profileFields))if(Object.hasOwn(durable,field))saved[field]=String(durable[field]);
  }catch(e){$('profileStatus').textContent='Profil konnte nicht geladen werden: '+e.message;}
 }
 for(const field of Object.keys(profileFields)){
  const input=$(field);
  if(!input.value&&validProfileField(field,saved[field]))input.value=saved[field];
  const save=()=>{
   const raw=input.value.trim();
   if(!validProfileField(field,raw)){$('profileStatus').textContent='Ungültige Angabe bei '+field+' – bitte korrigieren.';return;}
   try{if(raw)localStorage.setItem('virtualwalking_'+field,raw);else localStorage.removeItem('virtualwalking_'+field);}catch{}
   if(window.vwDesktop?.writeProfile){
    const snapshot=currentProfile();
    profileWriteQueue=profileWriteQueue.catch(()=>{}).then(()=>window.vwDesktop.writeProfile(snapshot));
    profileWriteQueue.then(()=>$('profileStatus').textContent='Persönliche Angaben dauerhaft gespeichert.',e=>$('profileStatus').textContent='Speichern fehlgeschlagen: '+e.message);
   }else $('profileStatus').textContent='Persönliche Angaben in diesem Browser gespeichert.';
   ui();
  };
  input.addEventListener('change',save);
  input.addEventListener('blur',save);
 }
 // Migrate any profile values recovered from the old browser storage.
 if(window.vwDesktop?.writeProfile&&Object.values(currentProfile()).some(Boolean)){
  profileWriteQueue=profileWriteQueue.then(()=>window.vwDesktop.writeProfile(currentProfile()));
  profileWriteQueue.catch(e=>$('profileStatus').textContent='Profilübernahme fehlgeschlagen: '+e.message);
 }
}
initializeProfile();
// Route discovery and favorites UI paused; existing saved favorites remain in localStorage.

// Native Windows Chicago library: stream saved files through the local server (supports Range).
window.virtualWalkingLoadLocalUrl=(url,name)=>{
 try{const u=new URL(url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!/^\/library\/[0-9a-f-]{36}$/.test(u.pathname))throw Error('Ungültiger Bibliothekseintrag');
  videoReset();tvSource={kind:'url',url:u.toString()};$('video').src=u.toString();activeVideoKind='html5';manager.setLocal(u.toString());$('videoTitle').textContent=name;announce('Privates Chicago-Video von der Festplatte geladen.');if(session?.running)videoAction('play');
 }catch(e){announce('Chicago-Video konnte nicht geöffnet werden: '+e.message);}
};
