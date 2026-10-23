export function searchFit(
  maxPx: number,
  minPx: number,
  fits: (px: number) => boolean,
): { size: number; uncap: boolean } {
  if (fits(maxPx)) return { size: maxPx, uncap: false }
  let low = minPx
  let high = maxPx - 1
  let size = minPx
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (fits(mid)) {
      size = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return { size, uncap: !fits(size) }
}
