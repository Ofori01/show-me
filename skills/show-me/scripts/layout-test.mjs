#!/usr/bin/env node
// Layout invariant tests.
//
//   node scripts/layout-test.mjs --repo <root>
//
// The scene draws every edge before every building and never depth-sorts the
// lines. That is only correct because a route cannot enter a footprint: edges
// travel exclusively in the gutters between cells. This file tests that claim
// instead of trusting the argument for it.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveNodeFiles } from './validate.mjs'
import { layout } from './lib/layout.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const examples = join(here, '..', 'examples')
const repoFlag = process.argv.indexOf('--repo')
const repoRoot = repoFlag !== -1 ? resolve(process.argv[repoFlag + 1]) : process.cwd()

const EPS = 1e-6

/** Does an axis-aligned segment pass through the open interior of a rect? */
function entersRect(a, b, rect) {
  const x1 = Math.min(a.gx, b.gx)
  const x2 = Math.max(a.gx, b.gx)
  const y1 = Math.min(a.gy, b.gy)
  const y2 = Math.max(a.gy, b.gy)
  const rx1 = rect.gx
  const rx2 = rect.gx + rect.w
  const ry1 = rect.gy
  const ry2 = rect.gy + rect.d
  const overlap = (lo1, hi1, lo2, hi2) => Math.min(hi1, hi2) - Math.max(lo1, lo2)

  if (Math.abs(a.gy - b.gy) < EPS) {
    // Horizontal: strictly inside the rect's y-span, and overlapping in x.
    return a.gy > ry1 + EPS && a.gy < ry2 - EPS && overlap(x1, x2, rx1, rx2) > EPS
  }
  if (Math.abs(a.gx - b.gx) < EPS) {
    return a.gx > rx1 + EPS && a.gx < rx2 - EPS && overlap(y1, y2, ry1, ry2) > EPS
  }
  // A diagonal segment would break the corridor model outright.
  return overlap(x1, x2, rx1, rx2) > EPS && overlap(y1, y2, ry1, ry2) > EPS
}

const failures = []
const fail = (message) => failures.push(message)
let checked = 0
let skipped = 0

const maps = readdirSync(examples).filter((name) => name.endsWith('.system-map.json'))
if (maps.length === 0) {
  console.error('no example maps found')
  process.exit(2)
}

for (const name of maps) {
  const map = JSON.parse(readFileSync(join(examples, name), 'utf8'))
  const { resolved, errors } = await resolveNodeFiles(map, repoRoot)
  if (errors.length > 0) {
    // An example map cites paths in the repo it was built from. Extracted on its
    // own, or pointed at a different --repo, those paths stop resolving -- which
    // says nothing about the layout code these tests exist to check.
    console.log(`  skip  ${name}: citations do not resolve against --repo`)
    skipped += 1
    continue
  }
  checked += 1
  const geo = layout(map, resolved)
  const boxes = [...geo.placed.values()]

  // 1. No route may enter a footprint.
  let crossings = 0
  for (const route of geo.routed) {
    for (let i = 0; i < route.gridPoints.length - 1; i += 1) {
      const a = route.gridPoints[i]
      const b = route.gridPoints[i + 1]
      if (Math.abs(a.gx - b.gx) > EPS && Math.abs(a.gy - b.gy) > EPS) {
        fail(`${name}: ${route.from}->${route.to} segment ${i} is diagonal, not a corridor run`)
      }
      for (const box of boxes) {
        if (entersRect(a, b, box)) {
          crossings += 1
          if (crossings <= 4) {
            fail(`${name}: route ${route.from}->${route.to} segment ${i} crosses ${box.id}`)
          }
        }
      }
    }
  }
  if (crossings > 4) fail(`${name}: ...and ${crossings - 4} further footprint crossings`)
  if (crossings === 0) console.log(`  ok    ${name}: ${geo.routed.length} routes stay in the corridors`)

  // 2. No two footprints may overlap.
  let overlaps = 0
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      const dx = Math.min(a.gx + a.w, b.gx + b.w) - Math.max(a.gx, b.gx)
      const dy = Math.min(a.gy + a.d, b.gy + b.d) - Math.max(a.gy, b.gy)
      if (dx > EPS && dy > EPS) {
        overlaps += 1
        if (overlaps <= 3) fail(`${name}: footprints of ${a.id} and ${b.id} overlap`)
      }
    }
  }
  if (overlaps === 0) console.log(`  ok    ${name}: ${boxes.length} footprints are disjoint`)

  // 3. Every drawn point must sit inside the viewBox.
  const { bounds } = geo
  let outside = 0
  const check = (x, y, what) => {
    if (x < bounds.minX - EPS || x > bounds.maxX + EPS || y < bounds.minY - EPS || y > bounds.maxY + EPS) {
      outside += 1
      if (outside <= 3) fail(`${name}: ${what} at ${Math.round(x)},${Math.round(y)} falls outside the viewBox`)
    }
  }
  for (const route of geo.routed) for (const point of route.points) check(point.x, point.y, `route ${route.from}->${route.to}`)
  if (outside === 0) console.log(`  ok    ${name}: all routed points fall inside the viewBox`)

  // 4. Districts must be contiguous bands, in the author's group order.
  let expectedRow = 0
  for (const district of geo.districts) {
    if (district.rowStart !== expectedRow) {
      fail(`${name}: district ${district.id} starts at row ${district.rowStart}, expected ${expectedRow}`)
    }
    expectedRow = district.rowEnd + 1
  }
  const grouped = geo.districts.every((district) => {
    const ids = [...geo.placed.values()].filter((box) => box.row >= district.rowStart && box.row <= district.rowEnd)
    return ids.every((box) => map.nodes.find((node) => node.id === box.id).group === district.id)
  })
  if (!grouped) fail(`${name}: a district band contains a node from another group`)
  else console.log(`  ok    ${name}: ${geo.districts.length} districts are contiguous and pure`)

  // 5. Layout must be deterministic.
  const again = layout(map, resolved)
  const shape = (g) => JSON.stringify([...g.placed.values()].concat(g.routed.map((r) => r.gridPoints)))
  if (shape(geo) !== shape(again)) fail(`${name}: layout is not deterministic across runs`)
  else console.log(`  ok    ${name}: layout is deterministic`)
}

console.log()
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`)
  console.error(`\n${failures.length} layout invariant failure(s)`)
  process.exit(1)
}
if (checked === 0) {
  console.error(`no example map resolved against --repo ${repoRoot}, so nothing was checked.`)
  console.error(`Point --repo at the repository an example was built from.`)
  process.exit(1)
}
console.log(`all layout invariants hold (${checked} map(s) checked`
  + (skipped > 0 ? `, ${skipped} skipped` : '') + ')')
