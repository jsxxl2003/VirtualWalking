const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(__dirname+'/app.js','utf8');
const block=src.match(/function parseTreadmillData\(view\)\{[\s\S]*?return \{speed:nextSpeed,distance:nextDistance,flags\};\}/)[0];
vm.runInThisContext(block);
const data=(b)=>new DataView(Uint8Array.from(b).buffer);
assert.deepEqual(parseTreadmillData(data([4,0,0xC2,0x01,0xDC,0x05,0])),{speed:4.5,distance:1.5,flags:4});
assert.deepEqual(parseTreadmillData(data([1,0])),{speed:null,distance:null,flags:1});
assert.throws(()=>parseTreadmillData(data([4,0,1,0])),/Unvollständige/);
console.log('3 FTMS-Parser-Tests bestanden');
