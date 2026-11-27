import { useEffect, useState } from "react";

export function useSystemVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const load = () => setVoices(synth.getVoices());
    synth.addEventListener("voiceschanged", load);
    load();
    return () => synth.removeEventListener("voiceschanged", load);
  }, []);
  return voices;
}
