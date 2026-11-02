import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  voiceDurationSeconds,
  voiceSignalLevel,
  startVoiceRecording,
} from "../src/lib/voiceRecord.ts";
import {
  normalizeVoiceInputLanguage,
  resolveVoiceInputLanguageTag,
} from "../src/lib/voiceInputLanguage.ts";

test("voice duration requires a complete second", () => {
  assert.equal(voiceDurationSeconds(120), 0);
  assert.equal(voiceDurationSeconds(999), 0);
  assert.equal(voiceDurationSeconds(1000), 1);
  assert.equal(voiceDurationSeconds(2400), 2);
});

test("voice signal level distinguishes silence from microphone activity", () => {
  assert.equal(voiceSignalLevel(new Uint8Array([128, 128, 128])), 0);
  assert.ok(voiceSignalLevel(new Uint8Array([96, 128, 160])) > 0.4);
});

test("recorder initialization failures release the microphone stream", async () => {
  const keys=["window","navigator","MediaRecorder","AudioContext"];
  const descriptors=keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  try {
    for(const failure of ["constructor","start"]){
      let stopped=0;
      const values={window:{},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}},AudioContext:class {constructor(){throw Error("meter unavailable");}},MediaRecorder:class {
        static isTypeSupported(){return true;}
        constructor(){if(failure==="constructor")throw Error("recorder failed");}
        start(){throw Error("recorder failed");}
      }};
      for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:values[key]});
      await assert.rejects(startVoiceRecording(),/recorder failed/);assert.equal(stopped,1);
    }
  } finally {
    for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});

test("voice input language is independent from translation language", () => {
  assert.equal(normalizeVoiceInputLanguage("FR"), "fr");
  assert.equal(resolveVoiceInputLanguageTag("fr", "zh-CN"), "fr-FR");
  assert.equal(resolveVoiceInputLanguageTag("", "zh-CN"), "zh-CN");
});

test("browser speech only appends recognition results changed by this event", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/lib/speechToText.ts"),
    "utf8"
  );
  assert.match(source, /for \(let i = event\.resultIndex \?\? 0;/);
});

test("AI transcription sends an explicitly selected language", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/lib/transcribeVoice.ts"),
    "utf8"
  );
  assert.match(source, /form\.append\("language", language\)/);
});
