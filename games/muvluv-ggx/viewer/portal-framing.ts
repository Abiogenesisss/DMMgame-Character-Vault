// SCS stands use the same authored coordinate units. A fixed-height crop keeps
// heads at a consistent scale even when a weapon or a skirt widens the bounds.
export function portalPlacement(bounds, width, height) {
  const scale = height / 1000;
  return { scale, x: width / 2, y: height * 0.02 - bounds.y * scale };
}
