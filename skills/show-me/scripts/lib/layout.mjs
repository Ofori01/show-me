// Deterministic layout: rank by dependency depth, fill a uniform cell grid in
// reading order, route every edge through the corridors between cells.
//
// Two properties matter here:
//
//   * Determinism. The same map JSON always yields the same coordinates, so two
//     renders are diffable and a changed picture means changed code.
//   * Compactness. A long dependency chain must fold, not stretch. Ranking
//     alone turns a nine-stage pipeline into a nine-cell diagonal, which is
//     unreadable; cells wrap like text instead.
//
// Uniform cells are what make edge routing sound: every cell reserves the same
// gutter on its +gx and +gy sides, so the gaps form a continuous corridor grid
// and a route assembled from corridor segments can never cross a footprint.

import { massOf, project } from './geometry.mjs'

const GUTTER = 2.4        // tiles of clear corridor on every side of a cell
const MAX_COLS = 6

/** Longest-path ranking, tolerant of cycles (relaxes at most |V| times). */
function rankNodes(nodes, edges) {
  const rank = new Map(nodes.map((node) => [node.id, 0]))
  const structural = edges.filter((edge) => edge.kind !== 'import')
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let moved = false
    for (const edge of structural) {
      const next = rank.get(edge.from) + 1
      if (next > rank.get(edge.to)) {
        rank.set(edge.to, next)
        moved = true
      }
    }
    if (!moved) break
  }
  return rank
}

/** Columns that keep the field close to square once projected. */
function columnCount(total) {
  return Math.max(2, Math.min(MAX_COLS, Math.round(Math.sqrt(total * 1.1))))
}

export function layout(map, resolved) {
  const { nodes, edges } = map
  const groupOrder = new Map(map.groups.map((group, index) => [group.id, group.order ?? index]))
  const rank = rankNodes(nodes, edges)

  // Districts: each group gets its own band of rows, in the author's group
  // order, with dependency rank ordering the buildings inside it. Ranking
  // globally instead scatters a group across the field, which leaves the
  // sidebar as the only place group membership exists -- and the groups are
  // exactly how the author chose to tell the story, so they earn the space.
  const ordered = [...nodes].sort((a, b) => {
    const byGroup = (groupOrder.get(a.group) ?? 0) - (groupOrder.get(b.group) ?? 0)
    if (byGroup !== 0) return byGroup
    const byRank = rank.get(a.id) - rank.get(b.id)
    return byRank !== 0 ? byRank : a.id.localeCompare(b.id)
  })

  const mass = new Map(ordered.map((node) => [node.id, massOf(resolved[node.id])]))
  const cols = columnCount(ordered.length)

  // Assign each node a global (col, row); rows are allocated per district so a
  // group always occupies a contiguous band.
  const cell = new Map()
  const districts = []
  let nextRow = 0
  for (const group of [...map.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const members = ordered.filter((node) => node.group === group.id)
    if (members.length === 0) continue
    const rowStart = nextRow
    members.forEach((node, index) => {
      cell.set(node.id, { col: index % cols, row: rowStart + Math.floor(index / cols) })
    })
    const rowEnd = rowStart + Math.ceil(members.length / cols) - 1
    districts.push({
      id: group.id,
      label: group.label,
      rowStart,
      rowEnd,
      // A single-row district is only as wide as it needs to be; a wrapped one
      // spans the full field, because its later rows already do.
      colEnd: rowEnd > rowStart ? cols - 1 : members.length - 1,
      size: members.length,
    })
    nextRow = rowEnd + 1
  }
  const rows = nextRow

  // Column widths and row depths are sized to their own contents, like a table.
  // A single global cell size would pad every small building out to the largest
  // one's footprint and leave the field mostly empty corridor.
  const colW = Array.from({ length: cols }, () => 1)
  const rowD = Array.from({ length: rows }, () => 1)
  for (const node of ordered) {
    const { col, row } = cell.get(node.id)
    const m = mass.get(node.id)
    colW[col] = Math.max(colW[col], m.w)
    rowD[row] = Math.max(rowD[row], m.d)
  }

  const colX = []
  let xCursor = 0
  for (let col = 0; col < cols; col += 1) { colX.push(xCursor); xCursor += colW[col] + GUTTER }
  const rowY = []
  let yCursor = 0
  for (let row = 0; row < rows; row += 1) { rowY.push(yCursor); yCursor += rowD[row] + GUTTER }

  // ---- place buildings, centred in their cell ------------------------------
  const placed = new Map()
  for (const node of ordered) {
    const { col, row } = cell.get(node.id)
    const m = mass.get(node.id)
    placed.set(node.id, {
      id: node.id,
      col,
      row,
      gx: colX[col] + (colW[col] - m.w) / 2,
      gy: rowY[row] + (rowD[row] - m.d) / 2,
      w: m.w,
      d: m.d,
      floors: m.floors,
      capped: m.capped,
      rawFloors: m.rawFloors,
      rank: rank.get(node.id),
    })
  }

  // District plinths in grid space, inset so neighbouring bands stay distinct.
  const INSET = GUTTER / 2 - 0.35
  for (const district of districts) {
    district.rect = {
      gx: colX[0] - INSET,
      gy: rowY[district.rowStart] - INSET,
      w: (colX[district.colEnd] + colW[district.colEnd] + INSET) - (colX[0] - INSET),
      d: (rowY[district.rowEnd] + rowD[district.rowEnd] + INSET) - (rowY[district.rowStart] - INSET),
    }
  }

  // ---- corridor axes -------------------------------------------------------
  // Every column reserves a full gutter on each side, so the gaps form a
  // continuous corridor grid. A route built only from corridor segments can
  // never cross a footprint, which is why edges need no depth sorting.
  const vAfter = (col) => colX[col] + colW[col] + GUTTER / 2
  const vBefore = (col) => colX[col] - GUTTER / 2
  const hAfter = (row) => rowY[row] + rowD[row] + GUTTER / 2

  /** Drop repeated and collinear points so paths stay minimal. */
  function simplify(points) {
    const out = []
    for (const point of points) {
      const last = out[out.length - 1]
      if (last && Math.abs(last.gx - point.gx) < 1e-6 && Math.abs(last.gy - point.gy) < 1e-6) continue
      out.push(point)
    }
    if (out.length < 3) return out
    const kept = [out[0]]
    for (let i = 1; i < out.length - 1; i += 1) {
      const a = kept[kept.length - 1]
      const b = out[i]
      const c = out[i + 1]
      const collinear = (Math.abs(a.gx - b.gx) < 1e-6 && Math.abs(b.gx - c.gx) < 1e-6)
        || (Math.abs(a.gy - b.gy) < 1e-6 && Math.abs(b.gy - c.gy) < 1e-6)
      if (!collinear) kept.push(b)
    }
    kept.push(out[out.length - 1])
    return kept
  }

  // ---- lane assignment, in two passes --------------------------------------
  // Lanes must be spaced by how crowded a corridor turns out to be, not by a
  // fixed step. A fixed step grows without bound, and a busy corridor then
  // pushes its outer lanes clean through the neighbouring building -- which
  // silently breaks the one invariant that lets the scene skip depth sorting.
  //
  // Two edges only contend for a lane if they actually overlap *along* the
  // corridor. Counting every edge that touches a corridor instead subdivides
  // one pool between routes that never come near each other, so a busy row
  // crowds lanes that had room to spare.
  const plan = edges.map((edge) => {
    const from = placed.get(edge.from)
    const to = placed.get(edge.to)
    const leftward = to.col < from.col
    const exitY = from.gy + from.d / 2
    const entryY = to.gy + to.d / 2
    // Base axes, before lane offsets. Offsets shift these by less than a tile
    // while corridor runs are many tiles long, so they are a sound basis for
    // deciding overlap.
    const vOutBase = leftward ? vBefore(from.col) : vAfter(from.col)
    const vInBase = leftward ? vAfter(to.col) : vBefore(to.col)
    const hRunBase = hAfter(from.row)
    const span = (a, b) => ({ lo: Math.min(a, b), hi: Math.max(a, b) })
    return {
      edge, from, to, leftward, exitY, entryY, vOutBase, vInBase, hRunBase,
      lanes: [
        { key: `v${from.col}${leftward ? 'L' : 'R'}`, slot: 'out', ...span(exitY, hRunBase) },
        { key: `w${to.col}${leftward ? 'L' : 'R'}`, slot: 'in', ...span(hRunBase, entryY) },
        { key: `h${from.row}`, slot: 'run', ...span(vOutBase, vInBase) },
      ],
    }
  })

  // Greedy interval colouring per corridor: an edge takes the lowest lane whose
  // previous occupant ended before this one starts.
  const colourOf = new Map()   // `${corridorKey}#${edgeIndex}` -> lane index
  const laneCount = new Map()  // corridorKey -> lanes needed
  const byKey = new Map()
  plan.forEach((entry, index) => {
    for (const lane of entry.lanes) {
      if (!byKey.has(lane.key)) byKey.set(lane.key, [])
      byKey.get(lane.key).push({ index, ...lane })
    }
  })
  for (const [key, intervals] of byKey) {
    intervals.sort((a, b) => a.lo - b.lo || a.hi - b.hi || a.index - b.index)
    const laneEnds = []
    for (const interval of intervals) {
      let lane = laneEnds.findIndex((end) => end <= interval.lo + 1e-9)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(-Infinity) }
      laneEnds[lane] = interval.hi
      colourOf.set(`${key}#${interval.index}`, lane)
    }
    laneCount.set(key, laneEnds.length)
  }

  // Widest a lane may stray from its corridor axis, leaving clearance on both
  // sides. GUTTER / 2 is the wall; USABLE keeps every lane inside it.
  const USABLE = Math.max(0, GUTTER - 0.8)
  const laneOffset = (key, index) => {
    const total = laneCount.get(key) ?? 1
    if (total < 2) return 0
    return (colourOf.get(`${key}#${index}`) / (total - 1) - 0.5) * USABLE
  }

  /** Drop repeated and collinear points so paths stay minimal. */
  function simplify(points) {
    const out = []
    for (const point of points) {
      const last = out[out.length - 1]
      if (last && Math.abs(last.gx - point.gx) < 1e-6 && Math.abs(last.gy - point.gy) < 1e-6) continue
      out.push(point)
    }
    if (out.length < 3) return out
    const kept = [out[0]]
    for (let i = 1; i < out.length - 1; i += 1) {
      const a = kept[kept.length - 1]
      const b = out[i]
      const c = out[i + 1]
      const collinear = (Math.abs(a.gx - b.gx) < 1e-6 && Math.abs(b.gx - c.gx) < 1e-6)
        || (Math.abs(a.gy - b.gy) < 1e-6 && Math.abs(b.gy - c.gy) < 1e-6)
      if (!collinear) kept.push(b)
    }
    kept.push(out[out.length - 1])
    return kept
  }

  const routed = plan.map((entry, index) => {
    const { edge, from, to, leftward, exitY, entryY } = entry
    const [outLane, inLane, runLane] = entry.lanes
    const exitX = leftward ? from.gx : from.gx + from.w
    const entryX = leftward ? to.gx + to.w : to.gx
    const vOut = entry.vOutBase + laneOffset(outLane.key, index)
    const vIn = entry.vInBase + laneOffset(inLane.key, index)
    const hRun = entry.hRunBase + laneOffset(runLane.key, index)

    const grid = simplify([
      { gx: exitX, gy: exitY },
      { gx: vOut, gy: exitY },
      { gx: vOut, gy: hRun },
      { gx: vIn, gy: hRun },
      { gx: vIn, gy: entryY },
      { gx: entryX, gy: entryY },
    ])

    return {
      index,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      label: edge.label ?? null,
      confidence: edge.confidence ?? 'verified',
      citation: edge.citation,
      gridPoints: grid,
      points: grid.map((point) => project(point.gx, point.gy, 0)),
    }
  })

  // ---- fan-in / fan-out ----------------------------------------------------
  const fanIn = new Map(nodes.map((node) => [node.id, 0]))
  const fanOut = new Map(nodes.map((node) => [node.id, 0]))
  for (const edge of edges) {
    fanIn.set(edge.to, fanIn.get(edge.to) + 1)
    fanOut.set(edge.from, fanOut.get(edge.from) + 1)
  }

  // ---- chapters ------------------------------------------------------------
  // The field is laid out once, for the whole system, and chapters only change
  // what is visible and where the camera sits. Moving buildings between
  // chapters would destroy the thing progressive disclosure exists to build:
  // one mental model the reader keeps adding to.
  const chapters = Array.isArray(map.chapters) ? map.chapters : []
  const revealedAt = new Map(nodes.map((node) => [node.id, 0]))
  chapters.forEach((chapter, index) => {
    for (const id of chapter.reveals ?? []) revealedAt.set(id, index)
  })

  /** Screen-space box enclosing these structures, their tags and their edges. */
  const boxFor = (visible) => {
    const points = []
    for (const id of visible) {
      const box = placed.get(id)
      if (!box) continue
      const node = nodes.find((entry) => entry.id === id)
      points.push(
        project(box.gx, box.gy, box.floors),
        project(box.gx + box.w, box.gy, box.floors),
        project(box.gx, box.gy + box.d, box.floors),
        project(box.gx + box.w, box.gy + box.d, 0),
        project(box.gx, box.gy + box.d, 0),
      )
      const front = project(box.gx + box.w, box.gy + box.d, 0)
      const half = ((node?.short ?? node?.label ?? '').slice(0, 16).length * 5.4 + 10) / 2
      points.push({ x: front.x - half, y: front.y + 22 }, { x: front.x + half, y: front.y + 22 })
    }
    for (const route of routed) {
      if (visible.has(route.from) && visible.has(route.to)) points.push(...route.points)
    }
    if (points.length === 0) return null
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const pad = 40
    return {
      minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad,
      maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad,
    }
  }

  const chapterViews = chapters.map((_, index) => {
    const visible = new Set(nodes.filter((node) => revealedAt.get(node.id) <= index).map((node) => node.id))
    return boxFor(visible)
  })

  // ---- bounds --------------------------------------------------------------
  // The ground plane reaches past the outermost building, so its corners have
  // to be measured too or the viewBox clips the grid and the edge lanes on it.
  const gridExtent = { minX: -1, minY: -1, maxX: xCursor, maxY: yCursor }
  const corners = [
    project(gridExtent.minX, gridExtent.minY, 0),
    project(gridExtent.maxX, gridExtent.minY, 0),
    project(gridExtent.maxX, gridExtent.maxY, 0),
    project(gridExtent.minX, gridExtent.maxY, 0),
  ]
  for (const box of placed.values()) {
    corners.push(
      project(box.gx, box.gy, box.floors),
      project(box.gx + box.w, box.gy, box.floors),
      project(box.gx, box.gy + box.d, box.floors),
      project(box.gx + box.w, box.gy + box.d, 0),
      project(box.gx, box.gy + box.d, 0),
    )
  }
  for (const route of routed) corners.push(...route.points)
  // Name tags hang under each front corner and are wider than the footprint.
  for (const node of nodes) {
    const box = placed.get(node.id)
    const front = project(box.gx + box.w, box.gy + box.d, 0)
    const half = ((node.short ?? node.label ?? '').slice(0, 16).length * 5.4 + 10) / 2
    corners.push({ x: front.x - half, y: front.y + 22 }, { x: front.x + half, y: front.y + 22 })
  }
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const pad = 26   // roof badge half-width plus the untested marker
  // District labels are right-anchored outside the plinth, so the left edge
  // needs room for the longest one. Monospace at 8px is ~5.1px per character.
  const labelAllowance = districts.reduce(
    (widest, district) => Math.max(widest, district.label.length * 5.1 + 16),
    0,
  )
  const bounds = {
    minX: Math.min(...xs) - pad - labelAllowance,
    minY: Math.min(...ys) - pad,
    maxX: Math.max(...xs) + pad,
    maxY: Math.max(...ys) + pad,
  }

  return {
    placed,
    routed,
    districts,
    revealedAt,
    chapterViews,
    cols,
    rows,
    gridExtent,
    bounds: { ...bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY },
    fanIn,
    fanOut,
    rank,
  }
}

export { GUTTER }
