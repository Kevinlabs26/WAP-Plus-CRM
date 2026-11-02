import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ensureOggOpusPtt } from '../baileys-bridge/audioConvert.mjs';

function recording(seconds) {
  const wav=Buffer.alloc(44+16000*2*seconds);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  return 'data:audio/wav;base64,'+wav.toString('base64');
}

test('voice conversion preserves supported audio and rejects overlong files instead of sending a truncated note', {
  skip: spawnSync('ffmpeg',['-version'],{windowsHide:true}).status!==0,
}, async()=>{
  for(const seconds of [1,2]){
    const result=await ensureOggOpusPtt(recording(seconds),'audio/wav',2);
    assert.equal(result.buf.subarray(0,4).toString(),'OggS');
    assert.ok(result.buf.includes(Buffer.from('OpusHead')));assert.equal(result.waveform.length,64);
  }
  await assert.rejects(ensureOggOpusPtt(recording(3),'audio/wav',2),/超过 2 秒/);
});
