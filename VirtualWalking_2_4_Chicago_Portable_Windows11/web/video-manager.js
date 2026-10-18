'use strict';
/* VirtualWalking VideoManager: does not download/cache third-party videos. */
(function(global){
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const smooth=(oldValue,target,alpha=.16)=>oldValue+(target-oldValue)*alpha;
 class VideoManager {
  constructor({video,onStatus=()=>{},onMessage=()=>{},onFallback=()=>{}}){
   this.video=video;this.onStatus=onStatus;this.onMessage=onMessage;this.onFallback=onFallback;this.onFallback=onFallback;
   this.kind='none';this.source='';this.youtube=null;this.running=false;
   this.lastTime=0;this.lastAdvance=Date.now();this.lastRecovery=0;
   this.retries=0;this.targetRate=1;this.manualPause=false;
   this.stallLimit=9000;this.fallbackAfter=16000;this.bufferTarget=60;this.bufferStart=0;this.fallbackSent=false;this.checkId=setInterval(()=>this.check(),1500);
   for(const event of ['waiting','stalled','playing','canplay','error','ended','progress']){
    video.addEventListener(event,()=>this.event(event));
   }
   this.onStatus('Kein Video gewählt');
  }
  setLocal(src){this.kind='html5';this.source=src;this.youtube=null;this.reset();this.onStatus('Lokales Video bereit');}
  setOnline(src){this.kind='online';this.source=src;this.youtube=null;this.reset();this.onStatus('Onlinevideo bereit');}
  setYoutube(player){this.kind='youtube';this.youtube=player;this.reset();this.onStatus('YouTube bereit (Puffer durch YouTube verwaltet)');}
  reset(){this.lastTime=0;this.lastAdvance=Date.now();this.retries=0;this.targetRate=1;this.manualPause=false;this.bufferStart=0;this.fallbackSent=false;}
  play(){
   this.running=true;this.manualPause=false;this.lastAdvance=Date.now();
   if(this.kind==='youtube'){try{this.youtube?.playVideo();}catch{}return;}
   if(this.kind==='html5'||this.kind==='online'){
    this.video.play().catch(()=>this.onMessage('Automatischer Videostart blockiert: bitte ▶ im Player drücken.'));
   }
  }
  pause(){this.running=false;this.manualPause=true;
   if(this.kind==='youtube'){try{this.youtube?.pauseVideo();}catch{}}
   else this.video.pause();
   this.onStatus('Pausiert');
  }
  stop(){this.pause();if(this.kind==='youtube'){try{this.youtube?.stopVideo();}catch{}}
   else if(this.kind!=='none'){try{this.video.currentTime=0;}catch{}}
   this.reset();this.onStatus('Beendet');
  }
  setTargetRate(rate){
   this.targetRate=clamp(Number.isFinite(rate)?rate:1,.5,2);
   if(this.kind==='youtube'){
    // YouTube supports only the rates exposed by its official IFrame Player API.
    // Pick the nearest supported rate; do not send commands until the player is ready.
    if(!this.youtube||typeof this.youtube.setPlaybackRate!=='function')return null;
    try{
     const available=this.youtube.getAvailablePlaybackRates?.()||[];
     if(!available.length)return null;
     const allowed=available.filter(r=>Number.isFinite(r)&&r>0);
     if(!allowed.length)return null;
     const closest=allowed.reduce((best,r)=>Math.abs(r-this.targetRate)<Math.abs(best-this.targetRate)?r:best);
     const current=this.youtube.getPlaybackRate?.();
     if(current!==closest)this.youtube.setPlaybackRate(closest);
     return closest;
    }catch(e){this.onMessage('YouTube-Tempo konnte nicht geändert werden: '+e.message);return null;}
   }
   if(this.kind!=='none'){
    const next=smooth(this.video.playbackRate,this.targetRate,.22);
    if(Math.abs(next-this.video.playbackRate)>.004)this.video.playbackRate=next;
   }
   return this.targetRate;
  }
  event(name){
   if(this.kind!=='online'&&this.kind!=='html5')return;
   if(name==='waiting'||name==='stalled')this.onStatus('Video puffert … Training läuft weiter');
   if(name==='playing'||name==='canplay'){
    this.onStatus(this.kind==='online'?'Onlinevideo läuft':'Lokales Video läuft');
   }
   if(name==='error')this.onStatus('Video-Fehler – Quelle prüfen');
   if(name==='ended')this.onStatus('Video beendet');
  }
  check(){
   if(!this.running)return;
   if(this.kind==='youtube'){
    // The official YouTube API owns buffering, recovery, and quality selection.
    try{const state=this.youtube?.getPlayerState();
     if(state===3){if(!this.bufferStart)this.bufferStart=Date.now();this.onStatus('YouTube puffert …');if(Date.now()-this.bufferStart>this.fallbackAfter)this.fallback();}
     else if(state===1){this.bufferStart=0;this.onStatus('YouTube läuft');}
     else if(state===-1||state===5)this.onStatus('YouTube wartet auf Start');
    }catch{}
    return;
   }
   if(this.kind!=='online'&&this.kind!=='html5')return;
   const v=this.video,now=Date.now();
   if(v.seeking||v.ended||!v.currentSrc)return;
   if(Math.abs(v.currentTime-this.lastTime)>.08){
    this.lastTime=v.currentTime;this.lastAdvance=now;this.retries=0;this.bufferStart=0;
    return;
   }
   if(v.paused){this.onStatus('Video pausiert – Training läuft weiter');return;}
   if(this.kind==='online'){try{let ahead=0;for(let i=0;i<v.buffered.length;i++){if(v.buffered.start(i)<=v.currentTime&&v.currentTime<=v.buffered.end(i))ahead=v.buffered.end(i)-v.currentTime;}
     if(now-this.lastAdvance<this.stallLimit)this.onStatus('Onlinevideo läuft · Puffer '+Math.floor(ahead)+' s / Ziel '+this.bufferTarget+' s');}catch{}}
   if(now-this.lastAdvance<this.stallLimit){this.bufferStart=0;return;}
   if(!this.bufferStart)this.bufferStart=now;
   if(now-this.bufferStart>this.fallbackAfter)this.fallback();
   this.onStatus('Video hängt – Wiederherstellung wird versucht');
   if(this.kind==='online'&&now-this.lastRecovery>10000&&this.retries<3){
    this.lastRecovery=now;this.retries++;
    const at=v.currentTime;
    v.load();
    const resume=()=>{v.removeEventListener('loadedmetadata',resume);
      try{if(v.seekable.length&&at<v.seekable.end(v.seekable.length-1))v.currentTime=at;}catch{}
      if(this.running)v.play().catch(()=>this.onMessage('Videostart bitte manuell bestätigen.'));
    };
    v.addEventListener('loadedmetadata',resume,{once:true});
    this.onMessage('Onlinevideo wird erneut geladen (Versuch '+this.retries+'/3).');
   }else if(this.kind==='html5'){
    this.onMessage('Lokales Video reagiert nicht. Datei oder Videoformat prüfen.');
   }else if(this.retries>=3){
    this.onStatus('Onlinevideo nicht verfügbar – anderes Video wählen');
   }
   // Keep lastAdvance tied to actual video progress, not recovery attempts.
  }
  fallback(){if(this.fallbackSent)return;this.fallbackSent=true;this.onFallback(this.kind);}
  dispose(){clearInterval(this.checkId);}
 }
 global.VirtualWalkingVideoManager=VideoManager;
 if(typeof module!=='undefined'&&module.exports)module.exports={VideoManager,clamp,smooth};
})(typeof window!=='undefined'?window:globalThis);
