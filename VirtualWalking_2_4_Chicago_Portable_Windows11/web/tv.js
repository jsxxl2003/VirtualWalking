'use strict';
const video=document.getElementById('video'),youtube=document.getElementById('youtube'),hint=document.getElementById('hint');
let player=null,kind='none',ready=false,desired={playing:false,rate:1,time:0};
function message(s){hint.textContent=s;}
function apply(){if(kind==='youtube'){if(!ready||!player)return;try{const rates=player.getAvailablePlaybackRates()||[1];const rate=rates.reduce((a,b)=>Math.abs(b-desired.rate)<Math.abs(a-desired.rate)?b:a,rates[0]);player.setPlaybackRate(rate);if(desired.playing)player.playVideo();else player.pauseVideo();}catch(e){message('YouTube: '+e.message);}return;}
 if(kind==='html5'){video.playbackRate=Math.max(.5,Math.min(2,desired.rate));if(Number.isFinite(desired.time)&&Math.abs(video.currentTime-desired.time)>2.5&&video.readyState>=1)try{video.currentTime=desired.time;}catch{}
 if(desired.playing)video.play().catch(()=>message('Zum Abspielen bitte auf das Video klicken.'));else video.pause();
 }}
function load(data){try{kind=data.kind;ready=false;video.pause();video.removeAttribute('src');video.load();youtube.replaceChildren();youtube.hidden=true;video.hidden=true;if(player){try{player.destroy();}catch{}}player=null;
 if(kind==='youtube'){youtube.hidden=false;const frame=document.createElement('div');frame.id='ytScreen';youtube.append(frame);const init=()=>{if(!window.YT?.Player){setTimeout(init,200);return;}player=new YT.Player('ytScreen',{videoId:data.youtubeId,playerVars:{autoplay:0,controls:1,rel:0,origin:location.origin},events:{onReady:()=>{ready=true;message('');apply();},onError:()=>message('YouTube-Video kann nicht eingebettet werden.')}});};init();}
 else if(kind==='html5'){video.hidden=false;video.src=data.url;video.addEventListener('loadedmetadata',apply,{once:true});message('');apply();}
 else message('Bitte zuerst ein Laufvideo auswählen.');
 }catch(e){message('Fernseher-Wiedergabe: '+e.message);}}
window.vwDesktop?.onTvLoad(load);
window.vwDesktop?.onTvState(state=>{desired=state;apply();});
video.addEventListener('click',()=>{if(video.paused)video.play().catch(()=>{});});
