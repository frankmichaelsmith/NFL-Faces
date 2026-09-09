/**
 * Face crop helpers. Pure geometry here; sharp only in the exported I/O helpers.
 *
 * ESPN headshots are uniformly framed PNGs on a transparent background, so
 * the head can be located from the alpha channel: the widest opaque run in
 * the upper part of the silhouette is the head. The square crop is a fixed
 * multiple of that width, so every face lands at the same scale and the
 * jersey stays out of frame.
 */
import sharp from 'sharp'

export const FACE_SIZE = 400
export const FACE_BACKGROUND = '#182036'
/** Square side as a multiple of head width (chosen by eye on a contact sheet, 2026-09-09). */
export const HEAD_FACTOR = 1.5
/** Fraction of the square left above the top of the head. */
export const TOP_MARGIN = 0.12

export interface Silhouette {
  width: number
  height: number
  /** First opaque row. */
  top: number
  /** Horizontal centre of the widest opaque run in the upper silhouette. */
  headCenterX: number
  headWidth: number
}

export interface CropBox {
  left: number
  top: number
  width: number
  height: number
}

/** Square crop around the head; clamped to the image. */
export function planCrop(s: Silhouette, factor = HEAD_FACTOR, topMargin = TOP_MARGIN): CropBox {
  const side = Math.min(Math.round(s.headWidth * factor), s.width, s.height)
  const left = clamp(Math.round(s.headCenterX - side / 2), 0, s.width - side)
  const top = clamp(Math.round(s.top - side * topMargin), 0, s.height - side)
  return { left, top, width: side, height: side }
}

/** Normalized "x,y,w,h" (0–1 of the source) → pixel box, squared on the shorter side. */
export function parseCropSpec(spec: string, width: number, height: number): CropBox {
  const parts = spec.split(',').map((v) => Number(v.trim()))
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v) || v < 0 || v > 1))
    throw new Error(`Bad crop spec "${spec}" (want x,y,w,h in 0–1)`)
  const [x, y, w, h] = parts as [number, number, number, number]
  const side = Math.round(Math.min(w * width, h * height))
  return {
    left: clamp(Math.round(x * width), 0, width - side),
    top: clamp(Math.round(y * height), 0, height - side),
    width: side,
    height: side,
  }
}

/** Default crop for a photo with no alpha and no spec: a centered square biased to the top third. */
export function defaultCrop(width: number, height: number): CropBox {
  const side = Math.round(Math.min(width, height) * 0.7)
  return {
    left: Math.round((width - side) / 2),
    top: clamp(Math.round(height * 0.08), 0, height - side),
    width: side,
    height: side,
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Measure the silhouette of a transparent-background headshot. Null if it has no alpha edge. */
export async function measureSilhouette(input: Buffer | string): Promise<Silhouette | null> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const opaque = (x: number, y: number) => data[(y * width + x) * 4 + 3]! > 40
  let top = -1
  let bottom = -1
  for (let y = 0; y < height && top === -1; y++)
    for (let x = 0; x < width; x++) if (opaque(x, y)) top = y
  for (let y = height - 1; y >= 0 && bottom === -1; y--)
    for (let x = 0; x < width; x++) if (opaque(x, y)) bottom = y
  if (top === -1) return null
  // A photo with no transparent background is fully opaque: not a silhouette.
  if (top === 0 && bottom === height - 1 && opaque(0, 0) && opaque(width - 1, 0)) return null
  const headBottom = top + Math.round((bottom - top) * 0.35)
  let headWidth = 0
  let headCenterX = width / 2
  for (let y = top; y < headBottom; y++) {
    let l = -1
    let r = -1
    for (let x = 0; x < width; x++)
      if (opaque(x, y)) {
        if (l === -1) l = x
        r = x
      }
    if (r - l > headWidth) {
      headWidth = r - l
      headCenterX = (l + r) / 2
    }
  }
  return { width, height, top, headCenterX, headWidth }
}

/** Crop, flatten onto the card colour, fade the bottom edge, resize, write JPEG. */
export async function renderFace(
  input: Buffer | string,
  box: CropBox,
  outFile: string,
): Promise<void> {
  const fade = Buffer.from(
    `<svg width="${FACE_SIZE}" height="${FACE_SIZE}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0.82" stop-color="${FACE_BACKGROUND}" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="${FACE_BACKGROUND}" stop-opacity="0.9"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  )
  await sharp(input)
    .extract(box)
    .flatten({ background: FACE_BACKGROUND })
    .resize(FACE_SIZE, FACE_SIZE)
    .composite([{ input: fade }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(outFile)
}
