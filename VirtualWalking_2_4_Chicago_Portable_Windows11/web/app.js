'use strict';
const FTMS='00001826-0000-1000-8000-00805f9b34fb', DATA='00002acd-0000-1000-8000-00805f9b34fb';
const MACHINE_STATUS='00002ada-0000-1000-8000-00805f9b34fb';
const $=id=>document.getElementById(id);
let device=null, characteristic=null, speed=0, distance=null, session=null, elapsed=0, startedAt=0, timer=null, videoObjectUrl=null;
let lastTelemetry=0, activeVideoKind="none", lastVideoRate=1, syncPaused=false;
let ytPlayer=null;
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
  if(manualPauseHold)manualPauseHold=false;
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
function videoAction(action){
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
function ui(){const secs=getSeconds();$('speed').textContent=speed.toFixed(1).replace('.',',');$('distance').textContent=fmt(workoutKm());$('duration').textContent=formatTime(secs);$('averageSpeed').textContent=(session&&secs>0?session.sumKmhSeconds/secs:0).toFixed(1).replace('.',',');const kcal=session?caloriesFor(session,secs):null;$('calories').textContent=kcal===null?'—':kcal;$('start').disabled=!!session?.running;$('pause').disabled=!session?.running;$('stop').disabled=!session;$('start').textContent=session?'▶ Fortsetzen':'▶ Training starten';updateVideoSync();}
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
 if(!fromTreadmill){manualPauseHold=false;automaticStopLock=false;} if(session?.running)return;
 if(session){session.running=true;startedAt=Date.now();lastTelemetry=0;}else{session={started:new Date().toISOString(),startDistance:distance,running:true,estimatedKm:0,sumKmhSeconds:0};elapsed=0;startedAt=Date.now();lastTelemetry=0;}videoAction('play');announce('Trainingsaufzeichnung läuft.');ui();}
function pause(fromTreadmill=false){if(!session?.running)return;if(!fromTreadmill&&speed>=0.2)manualPauseHold=true;elapsed+=(Date.now()-startedAt)/1000;session.running=false;lastTelemetry=0;videoAction('pause');announce('Aufzeichnung pausiert. Das Laufband läuft gegebenenfalls weiter!');ui();}
function stop(){if(!session)return;if(session.running)pause(true);const secs=Math.round(elapsed),km=Number(Math.max(0,workoutKm()).toFixed(3));const item={date:session.started,duration:secs,km,averageSpeed:Number((secs?session.sumKmhSeconds/secs:0).toFixed(2)),calories:caloriesFor(session,secs),route:$('videoTitle').textContent,source:device?.gatt?.connected?'FTMS':'Ohne Gerät'};const arr=history();arr.unshift(item);try{localStorage.setItem('virtualwalking_history',JSON.stringify(arr.slice(0,500)));}catch(e){announce('Speicherung fehlgeschlagen: '+e.message);}videoAction('stop');session=null;elapsed=0;renderHistory();announce('Training gespeichert.');ui();}
$('start').onclick=()=>begin();$('pause').onclick=()=>pause();$('stop').onclick=()=>{automaticStopLock=true;stop();};timer=setInterval(()=>{followTreadmillMotion();ui();},500);ui();
function history(){try{return JSON.parse(localStorage.getItem('virtualwalking_history')||'[]')}catch{return []}}
function renderHistory(){const hist=history();$('history').replaceChildren();if(!hist.length){const t=document.createElement('small');t.textContent='Noch keine abgeschlossenen Einheiten.';$('history').append(t);}for(let h of hist.slice(0,20)){const e=document.createElement('div');e.className='history-item';const a=document.createElement('b');a.textContent=`${Number(h.km||0).toFixed(2).replace('.',',')} km · ${formatTime(h.duration||0)}`;const b=document.createElement('small');b.textContent=`${new Date(h.date).toLocaleString('de-DE')} · Ø ${h.averageSpeed==null?'—':Number(h.averageSpeed).toFixed(1)+' km/h'} · ${h.calories==null?'—':h.calories+' kcal'} · ${h.route||h.source}`;e.append(a,b);$('history').append(e);}const now=new Date(),weekStart=new Date(now);weekStart.setDate(now.getDate()-((now.getDay()+6)%7));weekStart.setHours(0,0,0,0);const monthStart=new Date(now.getFullYear(),now.getMonth(),1);$('summary').replaceChildren();for(const [title,from] of [['Diese Woche',weekStart],['Dieser Monat',monthStart]]){const records=hist.filter(h=>new Date(h.date)>=from);const div=document.createElement('div');div.className='summary-item';const label=document.createElement('small');label.textContent=title;const value=document.createElement('b');value.textContent=`${fmt(records.reduce((n,h)=>n+Number(h.km||0),0))} km`;const sub=document.createElement('small');sub.textContent=`${records.length} Einheiten · ${formatTime(records.reduce((n,h)=>n+Number(h.duration||0),0))}`;div.append(label,value,sub);$('summary').append(div);}}
renderHistory();
$('clear').onclick=()=>{if(confirm('Alle lokal gespeicherten Trainingseinheiten löschen?')){localStorage.removeItem('virtualwalking_history');renderHistory();announce('Trainingshistorie gelöscht.');}};
$('export').onclick=()=>{const data=history(), rows=['Datum;Dauer_Sekunden;Strecke_km;Durchschnitt_kmh;Kalorien_geschaetzt;Quelle;Strecke_Name',...data.map(h=>[h.date,h.duration,String(h.km).replace('.',','),h.averageSpeed==null?'':String(h.averageSpeed).replace('.',','),h.calories??'',h.source, String(h.route||'').replaceAll(';',',').replaceAll('\n',' ')].join(';'))];const file=new Blob(['\uFEFF'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download='VirtualWalking_Trainingshistorie.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function videoReset(){manager.pause();if(ytPlayer){try{ytPlayer.destroy();}catch{}}ytPlayer=null;activeVideoKind="none";syncPaused=false;const v=$('video');v.pause();v.removeAttribute('src');v.load();if(videoObjectUrl)URL.revokeObjectURL(videoObjectUrl);videoObjectUrl=null;$('youtube').replaceChildren();$('youtube').hidden=true;v.hidden=false;$('placeholder').hidden=true;}
function loadFile(file){if(!file)return;videoReset();videoObjectUrl=URL.createObjectURL(file);$('video').src=videoObjectUrl;activeVideoKind='html5';manager.setLocal(videoObjectUrl);$('videoTitle').textContent=file.name;announce('Lokales Video geladen.');if(session?.running)videoAction('play');}
$('fileInput').onchange=e=>loadFile(e.target.files[0]);
function youtubeId(u){try{const x=new URL(u);let host=x.hostname.replace(/^www\./,'');if(host==='youtu.be')return x.pathname.split('/')[1];if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)){if(x.pathname==='/watch')return x.searchParams.get('v');let match=x.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);return match?.[1]??null;}}catch{}return null;}
$('loadUrl').onclick=()=>{const value=$('videoUrl').value.trim();if(!value){announce('Bitte Video-Adresse einfügen.');return;}let url;try{url=new URL(value);if(!['https:','http:'].includes(url.protocol))throw Error();}catch{announce('Bitte eine gültige HTTP(S)-Adresse eingeben.');return;}videoReset();const id=youtubeId(value);if(id){if(!/^[a-zA-Z0-9_-]{11}$/.test(id)){announce('Ungültige YouTube-Video-ID.');return;}const iframe=document.createElement('iframe');iframe.src=`https://www.youtube-nocookie.com/embed/${id}?rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;iframe.title='YouTube Laufvideo';iframe.allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share';iframe.allowFullscreen=true;activeVideoKind='youtube';$('video').hidden=true;$('youtube').hidden=false;$('youtube').append(iframe);const attach=()=>{if(window.YT?.Player){try{ytPlayer=new YT.Player(iframe,{events:{onReady:(event)=>{manager.setYoutube(event.target);if(session?.running)videoAction('play');},onError:()=>{$('videoHealth').textContent='YouTube: Video nicht abspielbar';}}});}catch(e){announce('YouTube: '+e.message);}}else setTimeout(attach,250);};attach();$('videoTitle').textContent='YouTube-Laufvideo';announce('YouTube-Player geöffnet. Einbettung und Verbindung hängen vom Videoanbieter ab.');}else{activeVideoKind='online';$('video').src=value;manager.setOnline(value);$('videoTitle').textContent='Online-Laufvideo';announce('Onlinevideo geladen. Direkter MP4/WebM-Link erforderlich.');if(session?.running)videoAction('play');}};
for(const b of document.querySelectorAll('.searchlink'))b.onclick=()=>window.open('https://www.youtube.com/results?search_query='+encodeURIComponent(b.dataset.search),'_blank','noopener');
$('video').addEventListener('error',()=>{if($('video').src)announce('Dieses Video konnte nicht abgespielt werden. Bitte direkten MP4/WebM-Link oder lokale Datei verwenden.');});

// Version 2: nur HTML5-Videos werden per playbackRate synchronisiert.
function updateVideoSync(){const enabled=$('syncEnabled').checked,video=$('video');if(!enabled){$('syncState').textContent='Aus';$('syncInfo').textContent='Synchronisation deaktiviert.';if(['html5','online'].includes(activeVideoKind))manager.setTargetRate(1);return;}
 if(activeVideoKind==='youtube'){$('syncState').textContent='YouTube: manuell';$('syncInfo').textContent='YouTube-Einbettung: automatische Steuerung nicht verfügbar. Im Player manuell regeln.';return;}
 if(!['html5','online'].includes(activeVideoKind)){$('syncState').textContent='Video wählen';return;}
 if(!device?.gatt?.connected){$('syncState').textContent='Warte auf FTMS';$('syncInfo').textContent='Bitte Laufband verbinden. Ohne Live-Daten keine Tempoanpassung.';return;}
 const ref=Number($('referenceSpeed').value);if(!Number.isFinite(ref)||ref<1)return;
 if(speed<0.1&&$('pauseAtZero').checked){if(!video.paused){video.pause();syncPaused=true;}$('syncState').textContent='Stillstand';$('syncInfo').textContent='Laufband steht. Video pausiert.';return;}
 const rate=Math.max(.5,Math.min(2,speed/ref));manager.setTargetRate(rate);lastVideoRate=rate;
 $('syncState').textContent=rate.toFixed(2).replace('.',',')+'×';$('syncInfo').textContent=`${speed.toFixed(1).replace('.',',')} km/h → ${rate.toFixed(2).replace('.',',')}× Videotempo (Referenz ${ref} km/h).`;
 if(syncPaused&&speed>=.1&&session?.running){syncPaused=false;manager.play();}}
for(const id of ['syncEnabled','pauseAtZero','referenceSpeed'])$(id).addEventListener('change',updateVideoSync);
$('weight').value=localStorage.getItem('virtualwalking_weight')||'';
$('weight').addEventListener('change',()=>{const x=Number($('weight').value);if(!$('weight').value||x<25||x>300)localStorage.removeItem('virtualwalking_weight');else localStorage.setItem('virtualwalking_weight',String(x));ui();});
const routeThemes=[['🌲','Waldwege','POV forest walking 4K treadmill 60 minutes'],['🏖️','Strand','POV beach walk 4K treadmill workout'],['🏙️','Städte','POV city walking tour 4K no talking'],['⛰️','Berge','POV mountain hiking 4K virtual treadmill'],['🌊','Seen & Flüsse','POV lakeside river walk 4K'],['🌷','Parks','POV park walk spring 4K treadmill']];
function favorites(){try{return JSON.parse(localStorage.getItem('virtualwalking_routes')||'[]')}catch{return []}}
function renderLibrary(){const root=$('routeLibrary');root.replaceChildren();for(const [emoji,name,query] of routeThemes){const b=document.createElement('button');b.className='route-card';b.textContent=emoji+' '+name;b.title='Videosuche öffnen';b.onclick=()=>window.open('https://www.youtube.com/results?search_query='+encodeURIComponent(query),'_blank','noopener');root.append(b);}
 for(const route of favorites()){const holder=document.createElement('div');holder.className='favorite-card';const b=document.createElement('button');b.textContent='★ '+route.name;b.onclick=()=>{$('videoUrl').value=route.url;$('loadUrl').click();};const rm=document.createElement('button');rm.textContent='×';rm.title='Favorit entfernen';rm.onclick=()=>{if(!confirm('Favorit entfernen?'))return;localStorage.setItem('virtualwalking_routes',JSON.stringify(favorites().filter(x=>x.id!==route.id)));renderLibrary();};holder.append(b,rm);root.append(holder);}}
$('saveFavorite').onclick=()=>{const name=$('favoriteName').value.trim(),url=$('videoUrl').value.trim();try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw Error();if(!name)throw Error('Name fehlt');const existing=favorites();existing.push({id:Date.now()+':'+Math.random(),name:name.slice(0,80),url});localStorage.setItem('virtualwalking_routes',JSON.stringify(existing.slice(-60)));$('favoriteName').value='';renderLibrary();announce('Strecke als Favorit gespeichert.');}catch(e){announce('Bitte Streckenname und gültigen Video-Link eingeben.');}};
renderLibrary();

// Native Windows Chicago library: stream saved files through the local server (supports Range).
window.virtualWalkingLoadLocalUrl=(url,name)=>{
 try{const u=new URL(url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!/^\/library\/[0-9a-f-]{36}$/.test(u.pathname))throw Error('Ungültiger Bibliothekseintrag');
  videoReset();$('video').src=u.toString();activeVideoKind='html5';manager.setLocal(u.toString());$('videoTitle').textContent=name;announce('Privates Chicago-Video von der Festplatte geladen.');if(session?.running)videoAction('play');
 }catch(e){announce('Chicago-Video konnte nicht geöffnet werden: '+e.message);}
};
