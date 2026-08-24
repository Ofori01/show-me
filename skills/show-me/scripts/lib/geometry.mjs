// Isometric projection and building meshes.
//
// Pure functions over plain numbers: given a footprint on the grid and a height
// in floors, produce screen-space polygons. Nothing here knows about the map
// schema, so it is trivially testable.

export const TILE = 34      // half-width of one grid cell
export const FLOOR_H = 5    // screen pixels per floor of elevation
export const MAX_FLOORS = 30

/** Project grid coords + elevation to screen coords. */
export function project(gx, gy, z = 0) {
  return {
    x: (gx - gy) * TILE,
    y: (gx + gy) * (TILE / 2) - z * FLOOR_H,
  }
}

const pt = (p) => `${round(p.x)},${round(p.y)}`
const round = (n) => Math.round(n * 100) / 100
const poly = (points) => points.map(pt).join(' ')

/**
 * Derive footprint and height from measured source metrics.
 *
 * Height is a square-root scale, not linear. Real codebases span three orders
 * of magnitude of LOC per module, and a linear map flattens everything below the
 * largest file into an indistinguishable two-floor slab. The square root keeps
 * the ordering exact while making the middle of the range legible, which is the
 * whole job of the height channel.
 */
export function massOf({ fileCount, loc }) {
  const w = clamp(1 + Math.floor(fileCount / 6), 1, 4)
  const d = clamp(1 + Math.floor(fileCount / 14), 1, 3)
  const rawFloors = Math.round(3 * Math.sqrt(loc / 40))
  const floors = clamp(rawFloors, 2, MAX_FLOORS)
  return { w, d, floors, capped: rawFloors > MAX_FLOORS, rawFloors }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * The three visible faces of a box on the grid.
 *
 * With `sx = (gx - gy) * TILE`, the face at constant `gx + w` lands on the
 * right of the silhouette and the face at constant `gy + d` lands on the left,
 * so those two plus the roof are exactly what a viewer can see.
 */
export function boxFaces(gx, gy, w, d, zBottom, zTop) {
  const p = (x, y, z) => project(x, y, z)
  return {
    top: poly([
      p(gx, gy, zTop),
      p(gx + w, gy, zTop),
      p(gx + w, gy + d, zTop),
      p(gx, gy + d, zTop),
    ]),
    right: poly([
      p(gx + w, gy, zTop),
      p(gx + w, gy + d, zTop),
      p(gx + w, gy + d, zBottom),
      p(gx + w, gy, zBottom),
    ]),
    left: poly([
      p(gx, gy + d, zTop),
      p(gx + w, gy + d, zTop),
      p(gx + w, gy + d, zBottom),
      p(gx, gy + d, zBottom),
    ]),
  }
}

/** Horizontal striations across both side faces, one per floor. */
export function floorLines(gx, gy, w, d, floors) {
  const step = floors <= 20 ? 1 : floors <= 40 ? 2 : 4
  const lines = []
  for (let z = step; z < floors; z += step) {
    const a = project(gx, gy + d, z)
    const b = project(gx + w, gy + d, z)
    const c = project(gx + w, gy, z)
    lines.push(`M ${pt(a)} L ${pt(b)} L ${pt(c)}`)
  }
  return lines
}

/**
 * Build the drawable parts for one node's shape.
 * Returns `{ faces: [...], outlines: [...], roofAnchor, labelAnchor }`.
 */
export function buildMesh(shape, gx, gy, w, d, floors) {
  const faces = []
  const outlines = []
  const roofAt = (height) => project(gx + w / 2, gy + d / 2, height)
  const solid = (bottom, top) => {
    const box = boxFaces(gx, gy, w, d, bottom, top)
    faces.push(
      { kind: 'left', points: box.left },
      { kind: 'right', points: box.right },
      { kind: 'top', points: box.top },
    )
    return box
  }

  // One branch per shape, each returning its own mesh. An earlier version let
  // most shapes fall through to a shared tail, which meant the tail existed for
  // exactly one of them and read as a fallback that was never a fallback.
  if (shape === 'ghost') {
    // Outline only: nothing inside this was measured, and the blankness says so.
    const box = boxFaces(gx, gy, w, d, 0, floors)
    outlines.push(box.top, box.left, box.right)
    return { faces, outlines, striations: [], roof: roofAt(floors), height: floors }
  }

  if (shape === 'pad') {
    const height = Math.min(floors, 3)
    solid(0, height)
    return { faces, outlines, striations: [], roof: roofAt(height), height }
  }

  if (shape === 'slabs') {
    // Discrete plates with gaps: a collection, not a single running thing.
    const plates = clamp(Math.round(floors / 4), 2, 8)
    const plateH = Math.max(1.5, (floors * 0.62) / plates)
    const gap = (floors - plates * plateH) / Math.max(1, plates - 1)
    for (let i = 0; i < plates; i += 1) {
      const bottom = i * (plateH + gap)
      solid(bottom, bottom + plateH)
    }
    return { faces, outlines, striations: [], roof: roofAt(floors), height: floors }
  }

  if (shape === 'fan') {
    // Thin sheets offset along +gx: many of these, waiting.
    const sheets = clamp(Math.round(floors / 5), 3, 7)
    const spread = Math.min(w, 0.9)
    for (let i = 0; i < sheets; i += 1) {
      const offset = (i / (sheets - 1 || 1)) * spread
      const box = boxFaces(gx + offset, gy + offset * 0.35, 0.16, d, 0, floors)
      faces.push(
        { kind: 'left', points: box.left },
        { kind: 'right', points: box.right },
        { kind: 'top', points: box.top },
      )
    }
    return { faces, outlines, striations: [], roof: roofAt(floors), height: floors }
  }

  // tower: a solid extrusion with floor striations. Also the fallback, though
  // `shape` is validated against the known set before it reaches here.
  solid(0, floors)
  return {
    faces,
    outlines,
    striations: floorLines(gx, gy, w, d, floors),
    roof: roofAt(floors),
    height: floors,
  }
}

/** Ground-plane grid lines covering the given tile extent. */
export function groundGrid(minX, minY, maxX, maxY) {
  const paths = []
  for (let gx = minX; gx <= maxX; gx += 1) {
    paths.push(`M ${pt(project(gx, minY))} L ${pt(project(gx, maxY))}`)
  }
  for (let gy = minY; gy <= maxY; gy += 1) {
    paths.push(`M ${pt(project(minX, gy))} L ${pt(project(maxX, gy))}`)
  }
  return paths
}

export { pt as screenPoint, round as roundCoord }
