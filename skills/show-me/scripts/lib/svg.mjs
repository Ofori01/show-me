// Emit the isometric scene as SVG. Build-time only: the browser receives final
// coordinates, so the page does no layout work and the markup stays diffable.

import { buildMesh, groundGrid, project } from './geometry.mjs'

// Escapes markup AND folds every non-ASCII character to a numeric entity. The
// published page inherits its charset from a host <head> we do not control, so
// an all-ASCII payload is the only way an em dash survives everywhere.
const esc = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  .replace(/[^\x20-\x7E\n\t]/g, (char) => `&#${char.codePointAt(0)};`)

const DEFAULT_SHAPE = {
  entry: 'tower', service: 'tower', worker: 'tower', ui: 'tower',
  store: 'slabs', queue: 'fan', external: 'ghost', config: 'pad',
}

/** Hatch density band from fan-in, so a heavily depended-on box reads denser. */
function hatchBand(fanIn) {
  if (fanIn >= 6) return 3
  if (fanIn >= 3) return 2
  if (fanIn >= 1) return 1
  return 0
}

/** Flat plinth and label for one group's band of rows. */
function districtShape(district, reveal = 0) {
  const { gx, gy, w, d } = district.rect
  const corners = [
    project(gx, gy, 0), project(gx + w, gy, 0),
    project(gx + w, gy + d, 0), project(gx, gy + d, 0),
  ]
  const points = corners.map((point) => `${round(point.x)},${round(point.y)}`).join(' ')
  // Label hangs off the plinth's leftmost corner, outside the field.
  const anchor = project(gx, gy + d, 0)
  return `<g class="district" data-group="${esc(district.id)}" data-reveal="${reveal}">`
    + `<polygon class="district__pad" points="${points}"/>`
    + `<text class="district__label" x="${round(anchor.x - 10)}" y="${round(anchor.y - 4)}">${esc(district.label)}</text>`
    + `</g>`
}

/**
 * Place an edge's label on its longest straight run, where there is room for
 * it. Labels stay hidden until the edge is highlighted; drawing all of them at
 * once buries the field in text.
 */
function edgeLabel(route, reveal = 0) {
  if (!route.label) return ''
  let best = null
  for (let i = 0; i < route.points.length - 1; i += 1) {
    const a = route.points[i]
    const b = route.points[i + 1]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!best || length > best.length) best = { a, b, length }
  }
  if (!best) return ''
  const x = round((best.a.x + best.b.x) / 2)
  const y = round((best.a.y + best.b.y) / 2)
  // Monospace at 8px: ~5.1px per character is close enough to size the plate.
  const width = round(route.label.length * 5.1 + 9)
  return `<g class="edge-label" data-edge="${route.index}" data-reveal="${reveal}">`
    + `<rect x="${round(x - width / 2)}" y="${y - 6}" width="${width}" height="12" rx="1.5"/>`
    + `<text x="${x}" y="${y + 3}">${esc(route.label)}</text></g>`
}

/**
 * A readable name tag under each building's front corner.
 *
 * A two-letter chip on the roof identifies a structure only if you already know
 * the map; a reader meeting it for the first time has to look every code up in
 * the sidebar. Letters on boxes are not enough, so the name goes on the field
 * next to the thing it names.
 */
function nodeTag(box, node, selected = false) {
  const text = tagText(node)
  if (!text) return ''
  const anchor = project(box.gx + box.w, box.gy + box.d, 0)
  const width = round(text.length * 5.4 + 10)
  const y = round(anchor.y + 6)
  const x = round(anchor.x)
  const cls = ['bldg__tag', node.kind === 'external' ? 'bldg__tag--ghost' : ''].filter(Boolean).join(' ')
  return `<g class="${cls}">`
    + `<rect x="${round(x - width / 2)}" y="${y}" width="${width}" height="13" rx="1.5"/>`
    + `<text x="${x}" y="${round(y + 9.3)}">${esc(text)}</text></g>`
}

/**
 * Short, uppercase, and short enough to sit under a building.
 *
 * Auto-shortening a long label mangles it -- "The citation gate" survives, but
 * "Projection and meshes" becomes "PROJECTION" and stops meaning anything. The
 * fallback exists so a map still renders; the validator warns so the author
 * writes a real `short` instead of shipping a truncation.
 */
export function tagText(node, limit = 16) {
  let raw = (node.short ?? node.label ?? '').trim()
  if (raw.length > limit) raw = raw.replace(/^(the|a|an)\s+/i, '')
  if (raw.length <= limit) return raw.toUpperCase()
  const words = raw.split(/\s+/)
  let out = words[0]
  for (const word of words.slice(1)) {
    if (`${out} ${word}`.length > limit) break
    out += ` ${word}`
  }
  return (out.length <= limit ? out : raw.slice(0, limit - 1)).toUpperCase()
}

/** True when this node's tag would be a truncation rather than a name. */
export function needsShort(node, limit = 16) {
  if (node.short) return node.short.length > limit
  const trimmed = (node.label ?? '').replace(/^(the|a|an)\s+/i, '')
  return trimmed.length > limit
}

function edgePath(points) {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`)
    .join(' ')
}

const round = (n) => Math.round(n * 100) / 100

export function renderScene(map, geo, resolved, testAttribution = { reliable: true }) {
  const { placed, routed, districts, gridExtent, bounds, fanIn, revealedAt } = geo
  // An element belongs to the earliest chapter in which everything it depends
  // on has been revealed: a structure to its own chapter, an edge to the later
  // of its two ends, a district to its first member.
  const revealOf = (id) => revealedAt?.get(id) ?? 0
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]))

  // ---- ground plane --------------------------------------------------------
  const ground = groundGrid(gridExtent.minX, gridExtent.minY, gridExtent.maxX, gridExtent.maxY)
    .map((path) => `<path d="${path}"/>`)
    .join('')

  const plinths = districts.map((district) => {
    const members = map.nodes.filter((node) => node.group === district.id).map((node) => node.id)
    const first = members.length > 0 ? Math.min(...members.map(revealOf)) : 0
    return districtShape(district, first)
  }).join('')

  // ---- edges ---------------------------------------------------------------
  const edges = routed.map((route) => {
    const classes = [
      'edge',
      `edge--${route.kind}`,
      route.confidence === 'inferred' ? 'edge--inferred' : '',
    ].filter(Boolean).join(' ')
    const reveal = Math.max(revealOf(route.from), revealOf(route.to))
    return `<path id="edge-${route.index}" class="${classes}" d="${edgePath(route.points)}" `
      + `data-edge="${route.index}" data-from="${esc(route.from)}" data-to="${esc(route.to)}" `
      + `data-reveal="${reveal}" `
      + `marker-end="url(#arrow-${route.kind === 'emit' || route.kind === 'consume' ? 'strong' : 'plain'})"/>`
  }).join('')

  // ---- buildings, painted far to near -------------------------------------
  const order = [...placed.values()].sort(
    (a, b) => (a.gx + a.gy + (a.w + a.d) / 2) - (b.gx + b.gy + (b.w + b.d) / 2),
  )

  const buildings = order.map((box) => {
    const node = nodeById.get(box.id)
    const shape = node.shape ?? DEFAULT_SHAPE[node.kind] ?? 'tower'
    const mesh = buildMesh(shape, box.gx, box.gy, box.w, box.d, box.floors)
    const band = hatchBand(fanIn.get(box.id) ?? 0)
    const metrics = resolved[box.id]
    // Only claim untested where attribution is trustworthy in this repo.
    const untested = testAttribution.reliable && metrics.testFiles === 0 && metrics.loc > 200

    const faces = mesh.faces.map(
      (face) => `<polygon class="face face--${face.kind}" points="${face.points}"/>`,
    ).join('')
    const outlines = mesh.outlines.map(
      (points) => `<polygon class="face face--ghost" points="${points}"/>`,
    ).join('')
    const striations = mesh.striations.map(
      (path) => `<path class="striation" d="${path}"/>`,
    ).join('')

    // Hatch overlay reuses the roof polygon so density reads on the top face.
    const roofFace = mesh.faces.find((face) => face.kind === 'top')
    const hatch = band > 0 && roofFace
      ? `<polygon class="hatch" points="${roofFace.points}" fill="url(#hatch-${band})"/>`
      : ''

    const badge = project(box.gx + box.w / 2, box.gy + box.d / 2, mesh.height)
    const roofMark = untested
      ? `<circle class="untested" cx="${round(badge.x)}" cy="${round(badge.y - 16)}" r="3.2"/>`
      : ''

    return `<g class="bldg bldg--${shape} bldg--${node.kind}" data-node="${esc(box.id)}" `
      + `data-reveal="${revealOf(box.id)}" tabindex="0" role="button" aria-label="${esc(node.label)}">`
      + `<g class="bldg__mesh">${faces}${outlines}${hatch}${striations}</g>`
      + roofMark
      + `<g class="bldg__badge" transform="translate(${round(badge.x)},${round(badge.y)})">`
      + `<rect x="-13" y="-9.5" width="26" height="15" rx="2"/>`
      + `<text x="0" y="1.5">${esc(box.id)}</text></g>`
      + nodeTag(box, node)
      + `</g>`
  }).join('')

  const viewBox = `${round(bounds.minX)} ${round(bounds.minY)} ${round(bounds.width)} ${round(bounds.height)}`

  return `<svg id="scene" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" role="img"
  aria-label="Isometric system map of ${esc(map.meta.title)}">
  <defs>
    ${hatchDefs()}
    <marker id="arrow-plain" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path class="arrowhead" d="M 1 1 L 7 4 L 1 7 z"/>
    </marker>
    <marker id="arrow-strong" viewBox="0 0 9 9" refX="7" refY="4.5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path class="arrowhead arrowhead--strong" d="M 0.5 0.5 L 8 4.5 L 0.5 8.5 z"/>
    </marker>
  </defs>
  <g id="viewport">
    <g class="ground" aria-hidden="true">${ground}</g>
    <g class="districts" aria-hidden="true">${plinths}</g>
    <g class="edges">${edges}</g>
    <g class="buildings">${buildings}</g>
    <g class="flow-layer" aria-hidden="true"></g>
    <g class="edge-labels" aria-hidden="true">${routed.map((route) => edgeLabel(route, Math.max(revealOf(route.from), revealOf(route.to)))).join('')}</g>
  </g>
</svg>`
}

function hatchDefs() {
  const spacings = { 1: 7, 2: 4.5, 3: 2.8 }
  return Object.entries(spacings).map(([band, gap]) => `
    <pattern id="hatch-${band}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(26)">
      <line class="hatch-line" x1="0" y1="0" x2="0" y2="${gap}"/>
    </pattern>`).join('')
}

export { esc as escapeHtml, DEFAULT_SHAPE }
