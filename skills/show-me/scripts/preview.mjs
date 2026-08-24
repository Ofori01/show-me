#!/usr/bin/env node
// Generate a shareable animated preview of one traced flow.
//
//   node scripts/preview.mjs <map>.json --repo <root> --flow <id> --out preview.svg
//
// A still image cannot show what this tool is for -- the interesting part is a
// payload walking a real, cited path. This emits an animated SVG straight from
// the map, using the same layout the page uses, so the preview is the actual
// geometry rather than an illustration of it.
//
// SVG rather than a raster GIF: it needs no browser to record and no encoder to
// build, it stays sharp at any size, it is a few kilobytes, and SMIL animation
// plays inside an <img> tag on GitHub.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { validateMap, resolveNodeFiles } from './validate.mjs'
import { layout } from './lib/layout.mjs'
import { buildMesh, project } from './lib/geometry.mjs'
import { tagText, DEFAULT_SHAPE, escapeHtml as esc } from './lib/svg.mjs'

const INK = '#d9e2f0'
const DIM = '#3a465c'
const PAPER = '#080b11'
const FACE = ['#26324a', '#1a2436', '#131b29']   // top, left, right
const ACCENT = '#4d9bff'
const TRACK = '#33507a'   // the route, always visible
const RULE = '#1e2836'

const round = (n) => Math.round(n * 100) / 100
const pts = (points) => points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')

export async function preview(map, repoRoot, flowId, { step = 1200 } = {}) {
  const gate = validateMap(map, repoRoot)
  if (gate.errors.length > 0) throw new Error(`map failed validation:\n${gate.errors.join('\n')}`)
  const { resolved } = await resolveNodeFiles(map, repoRoot)
  const geo = layout(map, resolved)

  const flow = (map.flows ?? []).find((entry) => entry.id === flowId) ?? (map.flows ?? [])[0]
  if (!flow) throw new Error('this map has no flows to preview')

  const byId = new Map(map.nodes.map((node) => [node.id, node]))
  const routeOf = new Map(geo.routed.map((route) => [`${route.from}>${route.to}`, route]))
  const hops = flow.steps
    .map((s, index) => ({ step: s, index, route: routeOf.get(`${s.from}>${s.to}`) }))
    .filter((hop) => hop.route)
  if (hops.length === 0) throw new Error(`no drawable hops in flow "${flow.id}"`)

  const cast = new Set(hops.flatMap((hop) => [hop.step.from, hop.step.to]))
  const cycle = hops.length * step + 900
  // What fraction of a whole cycle one hop's travel occupies.
  const travel = round((step * 0.62) / cycle)

  // Frame the cast, not the whole field: a preview should fill the image.
  const points = []
  for (const id of cast) {
    const box = geo.placed.get(id)
    points.push(
      project(box.gx, box.gy, box.floors), project(box.gx + box.w, box.gy, box.floors),
      project(box.gx + box.w, box.gy + box.d, 0), project(box.gx, box.gy + box.d, 0),
    )
    const front = project(box.gx + box.w, box.gy + box.d, 0)
    points.push({ x: front.x - 60, y: front.y + 26 }, { x: front.x + 60, y: front.y + 26 })
  }
  for (const hop of hops) points.push(...hop.route.points)
  const pad = 26
  const minX = Math.min(...points.map((p) => p.x)) - pad
  const minY = Math.min(...points.map((p) => p.y)) - pad
  const maxX = Math.max(...points.map((p) => p.x)) + pad
  const maxY = Math.max(...points.map((p) => p.y)) + pad * 2.4
  const width = maxX - minX
  const height = maxY - minY

  const out = []
  const w = (line) => out.push(line)

  w(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(minX)} ${round(minY)} ${round(width)} ${round(height)}"`)
  w(`  width="${Math.round(width)}" height="${Math.round(height)}" role="img"`)
  w(`  aria-label="${esc(map.meta.title)}: ${esc(flow.label)}">`)
  w(`<title>${esc(map.meta.title)} - ${esc(flow.label)}</title>`)
  w(`<rect x="${round(minX)}" y="${round(minY)}" width="${round(width)}" height="${round(height)}" fill="${PAPER}"/>`)
  w(`<style>`)
  w(`  .t{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}`)
  w(`</style>`)

  // Buildings, painted far to near. Anyone outside the flow stays quiet.
  const order = [...geo.placed.values()]
    .sort((a, b) => (a.gx + a.gy + (a.w + a.d) / 2) - (b.gx + b.gy + (b.w + b.d) / 2))
  for (const box of order) {
    const node = byId.get(box.id)
    const shape = node.shape ?? DEFAULT_SHAPE[node.kind] ?? 'tower'
    const mesh = buildMesh(shape, box.gx, box.gy, box.w, box.d, box.floors)
    const inFlow = cast.has(box.id)
    const opacity = inFlow ? 1 : 0.22
    w(`<g opacity="${opacity}">`)
    for (const face of mesh.faces) {
      const fill = face.kind === 'top' ? FACE[0] : face.kind === 'left' ? FACE[1] : FACE[2]
      w(`<polygon points="${face.points}" fill="${fill}" stroke="${inFlow ? INK : DIM}" stroke-width="0.7"/>`)
    }
    for (const outline of mesh.outlines) {
      w(`<polygon points="${outline}" fill="none" stroke="${DIM}" stroke-width="0.8" stroke-dasharray="3 3"/>`)
    }
    for (const line of mesh.striations) {
      w(`<path d="${line}" fill="none" stroke="${INK}" stroke-width="0.3" opacity="0.28"/>`)
    }
    if (inFlow) {
      const front = project(box.gx + box.w, box.gy + box.d, 0)
      const text = tagText(node)
      const tagW = text.length * 5.4 + 10
      w(`<g><rect x="${round(front.x - tagW / 2)}" y="${round(front.y + 6)}" width="${round(tagW)}" height="13"`
        + ` rx="1.5" fill="${PAPER}" stroke="${INK}" stroke-width="0.8"/>`)
      w(`<text class="t" x="${round(front.x)}" y="${round(front.y + 15.3)}" font-size="8" letter-spacing="0.7"`
        + ` text-anchor="middle" fill="${INK}">${esc(text)}</text></g>`)
    }
    w(`</g>`)
  }

  // Every hop drawn faint, then lit in turn as the payload reaches it.
  hops.forEach((hop, index) => {
    const d = hop.route.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ')
    // The route is always drawn: a viewer that shows a single frame -- a link
    // preview, a social card, a reader with animation disabled -- must still
    // see the path rather than an empty field.
    w(`<path d="${d}" fill="none" stroke="${TRACK}" stroke-width="1.5" stroke-linecap="round" opacity="0.75"/>`)
    // The first hop is lit at time zero, and that has to come from the
    // animation's own first value: a presentation attribute is overridden by
    // the animated value even while the clock is paused, so `opacity="1"`
    // alone leaves a still frame blank.
    // Two halves of one rule. Before an animation's `begin` the presentation
    // attribute applies, so it must be 0 or every hop shows at once from the
    // start. After `begin`, the animated value wins, so the first hop has to be
    // lit by its own first value rather than by an attribute.
    const first = index === 0
    w(`<path d="${d}" fill="none" stroke="${ACCENT}" stroke-width="2.6" stroke-linecap="round" opacity="0">`)
    w(`  <animate attributeName="opacity" values="${first ? '1;1;1;0.3' : '0;1;1;0.3'}" keyTimes="0;0.04;0.5;1"`)
    w(`    dur="${cycle}ms" begin="${index * step}ms" repeatCount="indefinite"/>`)
    w(`</path>`)
    // The payload itself: one token per hop, each waiting its turn.
    //
    // Both animations run for a whole cycle and are offset by `begin`, not
    // shortened -- a short `dur` with an indefinite repeat makes the token
    // shuttle continuously instead of travelling once. And keyTimes must start
    // at 0 and end at 1: an earlier version ended at 0.66, which is invalid, so
    // the browser discarded the animation and no token ever appeared.
    w(`<circle r="${hop.step.branch ? 2.8 : 3.8}" fill="${ACCENT}" stroke="${PAPER}" stroke-width="1" opacity="0">`)
    w(`  <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;${travel};${round(travel + 0.012)};1"`)
    w(`    dur="${cycle}ms" begin="${index * step}ms" repeatCount="indefinite"/>`)
    w(`  <animateMotion dur="${cycle}ms" begin="${index * step}ms" repeatCount="indefinite"`)
    w(`    path="${d}" keyPoints="0;1;1" keyTimes="0;${travel};1" calcMode="linear"/>`)
    w(`</circle>`)
  })

  // Caption: what is being watched, and where to go for the real thing.
  const capY = round(maxY - 26)
  w(`<text class="t" x="${round(minX + 20)}" y="${capY}" font-size="12.5" fill="${INK}">${esc(flow.label)}</text>`)
  w(`<text class="t" x="${round(minX + 20)}" y="${round(capY + 15)}" font-size="9" letter-spacing="0.9"`
    + ` fill="#5d7fb0">${hops.length} CITED STEPS &#183; CLICK TO EXPLORE THE LIVE MAP</text>`)
  w(`</svg>`)
  return `${out.join('\n')}\n`
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith('preview.mjs')
if (isMain) {
  const args = process.argv.slice(2)
  const flags = new Map()
  const positional = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) { flags.set(args[i].slice(2), args[i + 1]); i += 1 } else positional.push(args[i])
  }
  if (!positional[0] || !flags.has('out')) {
    console.error('usage: node scripts/preview.mjs <map.json> --repo <root> [--flow <id>] --out preview.svg')
    process.exit(2)
  }
  const repoRoot = resolve(flags.get('repo') ?? process.cwd())
  const map = JSON.parse(readFileSync(resolve(positional[0]), 'utf8'))
  try {
    const svg = await preview(map, repoRoot, flags.get('flow'), { step: Number(flags.get('step') ?? 1200) })
    writeFileSync(resolve(flags.get('out')), svg, 'utf8')
    console.log(`wrote ${flags.get('out')} (${(svg.length / 1024).toFixed(1)} KB)`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
