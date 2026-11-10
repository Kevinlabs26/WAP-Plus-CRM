type ImageData = { mimeType: string; data: string };

function wrapLine(line: string, maxWidth: number, context: CanvasRenderingContext2D) {
  const words = line.match(/\s+|[^\s]+/gu) || [line];
  const output: string[] = [];
  let current = "";
  for (const word of words) {
    const token = current ? word : word.trimStart();
    if (context.measureText(current + token).width <= maxWidth) {
      current += token;
      continue;
    }
    if (current) output.push(current.trimEnd());
    current = "";
    for (const char of Array.from(token.trimStart())) {
      if (current && context.measureText(current + char).width > maxWidth) {
        output.push(current);
        current = char.trimStart();
      } else current += char;
    }
  }
  if (current || !output.length) output.push(current.trimEnd());
  return output;
}

function blobData(blob: Blob): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
      if (match) resolve({ mimeType: match[1]!, data: match[2]! });
      else reject(new Error("图片文字合成失败"));
    };
    reader.onerror = () => reject(new Error("图片文字合成失败"));
    reader.readAsDataURL(blob);
  });
}

export async function applyExactImageText(imageData: ImageData, rawText: string): Promise<ImageData | null> {
  const text = rawText.trim();
  if (!text) return imageData;
  const image = new Image();
  image.src = `data:${imageData.mimeType};base64,${imageData.data}`;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) throw new Error("图片文字合成失败");
  context.drawImage(image, 0, 0);

  const maxWidth = canvas.width * 0.84;
  const maxBand = canvas.height * 0.42;
  const padding = Math.max(24, canvas.width * 0.055);
  let fontSize = Math.max(18, Math.round(Math.min(canvas.width * 0.05, canvas.height * 0.035)));
  let lines: string[] = [];
  let lineHeight = 0;
  while (fontSize >= 18) {
    context.font = `600 ${fontSize}px system-ui, "Segoe UI", sans-serif`;
    lines = text.split(/\r?\n/).flatMap(line => line ? wrapLine(line, maxWidth, context) : [""]);
    lineHeight = fontSize * 1.35;
    if (lines.length * lineHeight + padding * 2 <= maxBand) break;
    fontSize -= 2;
  }
  if (fontSize < 18) return null;

  const bandHeight = Math.max(canvas.height * 0.18, lines.length * lineHeight + padding * 2);
  const top = canvas.height - bandHeight;
  const gradient = context.createLinearGradient(0, top, 0, canvas.height);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.2, "rgba(0,0,0,0.52)");
  gradient.addColorStop(1, "rgba(0,0,0,0.78)");
  context.fillStyle = gradient;
  context.fillRect(0, top, canvas.width, bandHeight);
  context.font = `600 ${fontSize}px system-ui, "Segoe UI", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fff";
  context.shadowColor = "rgba(0,0,0,0.7)";
  context.shadowBlur = Math.max(2, fontSize * 0.12);
  const firstY = top + (bandHeight - lines.length * lineHeight) / 2 + lineHeight / 2;
  lines.forEach((line, index) => context.fillText(line, canvas.width / 2, firstY + index * lineHeight));

  const toBlob = (type: string, quality?: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("图片文字合成失败")), type, quality));
  let blob = await toBlob("image/png");
  if (blob.size > 8 * 1024 * 1024) blob = await toBlob("image/jpeg", 0.92);
  if (blob.size > 8 * 1024 * 1024) throw new Error("合成后的图片超过 8 MB");
  return blobData(blob);
}
