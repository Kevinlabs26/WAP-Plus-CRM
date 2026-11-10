export type ImageReference = { title: string; mimeType: "image/jpeg"; data: string };
export function imageGenerationReferences(subject?: ImageReference | null, style?: ImageReference | null) {
  const images = [subject, style].filter((image): image is ImageReference => !!image);
  const instructions = [
    subject ? "Image 1 is the SUBJECT photo. Keep this person's face and appearance, and put this person into the requested card or scene. Do not use this photo as the visual style reference." : "",
    style ? `Image ${subject ? 2 : 1} is the STYLE AND LAYOUT reference. Follow its composition, background, colors and visual treatment. ${subject ? "Use this image as the base card or scene to edit. Keep its background and other design elements unless the user requests changes. Replace any person in this reference with the person from Image 1, or insert that person if none is present; do not copy the reference person's face." : "Create the content requested by the user."}` : "",
    images.length ? "Follow the user's prompt for the requested text, placement and changes. Do not invent names or personal details." : "",
  ].filter(Boolean).join("\n");
  return { images, instructions };
}
