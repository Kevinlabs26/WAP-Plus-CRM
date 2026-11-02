export type ModelPurpose = "chat" | "transcription";

export function isTranscriptionModel(model: string): boolean {
  return /^(?:whisper(?:-|$)|distil-whisper(?:-|$)|gpt-4o(?:-mini)?-transcribe(?:-|$))/i.test(model.split("/").at(-1) || "");
}

// The compatible /models API often mixes tasks; unknown custom IDs remain available.
export function isChatModel(model: string): boolean {
  return !isTranscriptionModel(model) && !/(?:^|\/)(?:tts-|playai-tts|orpheus|text-embedding-|embedding|dall-e-|imagen|.*prompt-guard|.*safeguard)|-tts(?:-|$)|moderation/i.test(model);
}
