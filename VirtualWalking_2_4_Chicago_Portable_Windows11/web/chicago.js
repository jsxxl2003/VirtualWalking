 'use strict';
(function(){
 const $=id=>document.getElementById(id),api=window.vwDesktop;
 const status=s=>{$('chicagoStatus').textContent=s;};
 const tracks=[
  ['🌉 Chicago Riverwalk','Chicago Riverwalk 4K POV walking tour'],
  ['🏙️ Downtown / The Loop','Chicago Loop walking tour 4K POV'],
  ['🌊 Lakefront Trail','Chicago Lakefront Trail walking 4K POV'],
  ['🚶 Magnificent Mile','Chicago Magnificent Mile Michigan Avenue walking tour 4K'],
  ['🌳 Millennium Park','Chicago Millennium Park walking tour 4K'],
  ['🌃 Chicago bei Nacht','Chicago night walk downtown 4K']
 ];
 for(const [title,query] of tracks){const b=document.createElement('button');b.className='route-card';b.textContent=title;b.title='Auf YouTube nach dieser Strecke suchen';b.onclick=()=>window.open('https://www.youtube.com/results?search_query='+encodeURIComponent(query),'_blank','noopener');$('chicagoSuggestions').append(b);}
 window.virtualWalkingFallback=async kind=>{
  if(!$('chicagoAutoFallback').checked||!api)return;
  try{const entries=await api.listChicago();if(!entries.length){status('Kein lokales Chicago-Ersatzvideo vorhanden.');return;}
   status('Onlinevideo unterbrochen – starte lokales Chicago-Ersatzvideo.');
   window.virtualWalkingLoadLocalUrl(entries[0].url,entries[0].name+' (Ersatzvideo)');
  }catch(e){status('Ersatzvideo fehlgeschlagen: '+e.message);}
 };
 $('chicagoAutoFallback').checked=localStorage.getItem('vw_chicago_fallback')!=='off';
 $('chicagoAutoFallback').onchange=()=>localStorage.setItem('vw_chicago_fallback',$('chicagoAutoFallback').checked?'on':'off');
 if(!api){status('Chicago-Dateibibliothek steht in der portablen Windows-App zur Verfügung.');$('chicagoImport').disabled=true;$('chicagoDownload').disabled=true;$('chicagoOpenFolder').disabled=true;$('chicagoRefresh').disabled=true;return;}
 async function refresh(){try{const entries=await api.listChicago(),root=$('chicagoFiles');root.replaceChildren();
  if(!entries.length){const p=document.createElement('p');p.className='mini';p.textContent='Noch keine Chicago-Videos gespeichert.';root.append(p);}
  for(const entry of entries){const row=document.createElement('div');row.className='chicago-entry';
   const label=document.createElement('span');label.textContent=entry.name;
   const play=document.createElement('button');play.textContent='▶ Abspielen';play.onclick=()=>{
    if(typeof window.virtualWalkingLoadLocalUrl==='function')window.virtualWalkingLoadLocalUrl(entry.url,entry.name);
    else status('Videoplayer noch nicht bereit.');
   };
   const del=document.createElement('button');del.textContent='Entfernen';del.className='subtle';del.onclick=async()=>{
    if(!confirm('Dieses Video dauerhaft aus der privaten Chicago-Bibliothek löschen?'))return;
    try{await api.removeChicago(entry.id);await refresh();}catch(e){status(e.message);}
   };row.append(label,play,del);root.append(row);
  }
  const path=await api.chicagoPath();$('chicagoFolder').textContent=path;
  status(entries.length+' lokale Chicago-Videos verfügbar.');
 }catch(e){status('Bibliothek konnte nicht geladen werden: '+e.message);}}
 $('chicagoOpenFolder').onclick=async()=>{try{await api.openChicagoFolder();status('Videoordner im Windows-Explorer geöffnet.');}catch(e){status('Videoordner konnte nicht geöffnet werden: '+e.message);}};
 $('chicagoRefresh').onclick=()=>refresh();
 $('chicagoImport').onclick=async()=>{try{status('Videos werden importiert …');await api.importChicago();await refresh();}catch(e){status('Import fehlgeschlagen: '+e.message);}};
 $('chicagoDownload').onclick=async()=>{const url=$('videoUrl').value.trim(),permission=$('chicagoPermission').checked;
  if(!permission){status('Bitte zuerst die Downloadberechtigung bestätigen.');return;}
  if(!url){status('Bitte oben einen direkten MP4/WebM-Link eintragen.');return;}
  $('chicagoDownload').disabled=true;
  try{status('Video wird heruntergeladen. Onlinewiedergabe bleibt möglich …');await api.downloadChicago({url,name:($('favoriteName')?.value||'').trim()||'Chicago-Laufvideo',permission});await refresh();}
  catch(e){status('Download fehlgeschlagen: '+e.message);}finally{$('chicagoDownload').disabled=false;}
 };
 api.onDownloadProgress(({received,total,done})=>{
  if(done)return status('Download abgeschlossen – Video jetzt lokal verfügbar.');
  const mb=(received/1048576).toFixed(1);status(total?`Speichere Video: ${mb} von ${(total/1048576).toFixed(1)} MB`:`Speichere Video: ${mb} MB`);
 });
 refresh();
})();
