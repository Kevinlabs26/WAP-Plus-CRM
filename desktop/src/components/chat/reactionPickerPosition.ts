export function placeReactionPicker(
  anchor: { left: number; right: number; bottom: number },
  viewport: { width: number; height: number }
) {
  const width = 352;
  const height = 372;
  const gap = 8;
  return {
    left:
      anchor.right + gap + width <= viewport.width
        ? anchor.right + gap
        : Math.max(gap, anchor.left - width - gap),
    top: Math.max(
      gap,
      Math.min(anchor.bottom - height, viewport.height - height - gap)
    ),
  };
}
