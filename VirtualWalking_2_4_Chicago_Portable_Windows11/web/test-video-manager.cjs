'use strict';
const assert=require('node:assert/strict');
const {VideoManager,clamp,smooth}=require('./video-manager.js');
assert.equal(clamp(5,.5,2),2);
assert.equal(clamp(-1,.5,2),.5);
assert.equal(smooth(1,2,.2),1.2);
const video={currentTime:0,currentSrc:'https://example.org/route.mp4',paused:false,ended:false,seeking:false,playbackRate:1,
 buffered:{length:0},addEventListener(){},load(){},play(){return Promise.resolve();},pause(){}};
let fallbacks=0;
const vm=new VideoManager({video,onFallback:()=>fallbacks++});
vm.setOnline(video.currentSrc);vm.running=true;
vm.lastAdvance=Date.now()-30000;vm.bufferStart=Date.now()-20000;vm.check();vm.check();
assert.equal(fallbacks,1,'Fallback must only fire once per stalled video');
vm.setTargetRate(2);assert.ok(video.playbackRate>1&&video.playbackRate<2);
vm.dispose();
console.log('Video-Manager: 5 Tests bestanden.');
