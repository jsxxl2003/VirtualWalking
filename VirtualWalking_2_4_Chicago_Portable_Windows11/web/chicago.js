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
 let cachedEntries=[],selected=new Set();
 function updateSelection(){
  const count=selected.size,total=cachedEntries.length;
  $('chicagoDeleteSelected').disabled=count===0;
  $('chicagoDeleteSelected').textContent='Ausgewählte löschen ('+count+')';
  $('chicagoSelectAll').checked=total>0&&count===total;
  $('chicagoSelectAll').indeterminate=count>0&&count<total;
  $('chicagoCount').textContent='Gespeicherte Videos: '+total+' · Ausgewählt: '+count;
 }
 $('chicagoSelectAll').onchange=()=>{
  selected=$('chicagoSelectAll').checked?new Set(cachedEntries.map(e=>e.id)):new Set();
  for(const checkbox of $('chicagoFiles').querySelectorAll('input[data-video-id]'))checkbox.checked=selected.has(checkbox.dataset.videoId);
  updateSelection();
 };
 $('chicagoDeleteSelected').onclick=async()=>{
  const ids=[...selected],names=cachedEntries.filter(e=>selected.has(e.id)).map(e=>e.name);
  if(!ids.length)return;
  const preview=names.slice(0,5).join('\n')+(names.length>5?'\n… und '+(names.length-5)+' weitere':'');
  if(!confirm(ids.length+' ausgewählte Videos dauerhaft löschen?\n\n'+preview+'\n\nNicht ausgewählte Videos bleiben erhalten.'))return;
  $('chicagoDeleteSelected').disabled=true;
  let removed=0,failed=0;
  for(const id of ids){
   try{await api.removeChicago(id);selected.delete(id);removed++;}
   catch(e){failed++;status('Löschen fehlgeschlagen: '+e.message);}
  }
  await refresh();
  status(removed+' Videos gelöscht.'+(failed?' '+failed+' konnten nicht gelöscht werden.':''));
 };
 async function refresh(){
  try{
   const entries=await api.listChicago(),root=$('chicagoFiles');
   cachedEntries=Array.isArray(entries)?entries.slice().sort((a,b)=>String(b.added||'').localeCompare(String(a.added||''))):[];
   selected=new Set([...selected].filter(id=>cachedEntries.some(e=>e.id===id)));
   root.replaceChildren();
   if(!cachedEntries.length){const p=document.createElement('p');p.className='mini';p.textContent='Noch keine Videos gespeichert.';root.append(p);}
   for(const entry of cachedEntries){
    const row=document.createElement('div');row.className='chicago-entry';
    const choose=document.createElement('input');choose.type='checkbox';choose.dataset.videoId=entry.id;choose.checked=selected.has(entry.id);
    choose.setAttribute('aria-label','Video zum Löschen auswählen: '+entry.name);
    choose.onchange=()=>{if(choose.checked)selected.add(entry.id);else selected.delete(entry.id);updateSelection();};
    const label=document.createElement('span');label.className='chicago-video-name';label.textContent=entry.name;
    const info=document.createElement('small');info.textContent=(entry.source||'Lokales Video')+(entry.added?' · '+new Date(entry.added).toLocaleDateString('de-DE'):'');
    const title=document.createElement('div');title.className='chicago-video-info';title.append(label,info);
    const play=document.createElement('button');play.textContent='▶ Abspielen';play.onclick=()=>{
     if(typeof window.virtualWalkingLoadLocalUrl==='function')window.virtualWalkingLoadLocalUrl(entry.url,entry.name);
     else status('Videoplayer noch nicht bereit.');
    };
    const del=document.createElement('button');del.textContent='Entfernen';del.className='subtle';del.onclick=async()=>{
     if(!confirm('Dieses Video dauerhaft löschen?\n'+entry.name))return;
     try{await api.removeChicago(entry.id);selected.delete(entry.id);await refresh();}catch(e){status(e.message);}
    };
    row.append(choose,title,play,del);root.append(row);
   }
   updateSelection();
   const path=await api.chicagoPath();$('chicagoFolder').textContent=path;
   status(cachedEntries.length+' gespeicherte Videos in der Bibliothek.');
  }catch(e){status('Bibliothek konnte nicht geladen werden: '+e.message);}
 }
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
