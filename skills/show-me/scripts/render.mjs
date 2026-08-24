#!/usr/bin/env node
// Render a validated system-map.json into one self-contained HTML page.
//
//   node scripts/render.mjs <map.json> --repo <root> --out <file.html>
//
// Output is a fragment (title + style + markup + script) with everything inlined
// and no build step: publishable as an Artifact as-is, and it also opens straight
// from disk in a browser. One external request remains by design -- app.css
// @imports Google Fonts, the single font host an Artifact's CSP admits -- and
// every face declares a real fallback stack so the page holds without it.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateMap, resolveNodeFiles } from './validate.mjs'
import { layout } from './lib/layout.mjs'
import { renderScene, escapeHtml as esc, DEFAULT_SHAPE } from './lib/svg.mjs'
import { massOf } from './lib/geometry.mjs'
import { expandGlobs, TEST_PATTERN, testsWithSourceCounterpart } from './lib/metrics.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const assets = join(here, '..', 'assets')

function statBlock(label, value, { wide = false, strong = false } = {}) {
  return `<div class="stat${wide ? ' stat--wide' : ''}">`
    + `<div class="stat__label">${esc(label)}</div>`
    + `<div class="stat__value${strong ? ' stat__value--strong' : ''}">${esc(value)}</div></div>`
}

function sidebar(map, resolved) {
  const revealOf = (id) => {
    const index = (map.chapters ?? []).findIndex((chapter) => (chapter.reveals ?? []).includes(id))
    return index === -1 ? 0 : index
  }
  return map.groups
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((group) => {
      const rows = map.nodes
        .filter((node) => node.group === group.id)
        .map((node) => `<button class="node-row" type="button" data-node="${esc(node.id)}" `
          + `data-reveal="${revealOf(node.id)}" aria-current="false">`
          + `<span class="node-row__id">${esc(node.id)}</span>`
          + `<span class="node-row__label">${esc(node.label)}</span>`
          + `<span class="node-row__count">${resolved[node.id].fileCount}</span></button>`)
        .join('')
      return `<div class="sidebar__title">${esc(group.label)}</div>${rows}`
    })
    .join('')
}

/** Tiny isometric swatches so the legend shows the actual shape vocabulary. */
function shapeSwatch(shape) {
  const box = (points, cls = 'face--top') => `<polygon class="face ${cls}" points="${points}"/>`
  if (shape === 'ghost') {
    return `<svg width="20" height="18" viewBox="-10 -13 20 18">`
      + `<polygon class="face face--ghost" points="0,-10 8,-6 0,-2 -8,-6"/>`
      + `<polygon class="face face--ghost" points="-8,-6 0,-2 0,3 -8,-1"/>`
      + `<polygon class="face face--ghost" points="8,-6 0,-2 0,3 8,-1"/></svg>`
  }
  if (shape === 'pad') {
    return `<svg width="20" height="18" viewBox="-10 -13 20 18">`
      + box('0,-4 8,0 0,4 -8,0') + box('-8,0 0,4 0,6 -8,2', 'face--left') + box('8,0 0,4 0,6 8,2', 'face--right')
      + `</svg>`
  }
  if (shape === 'slabs') {
    let out = `<svg width="20" height="18" viewBox="-10 -13 20 18">`
    for (const y of [2, -3, -8]) {
      out += box(`0,${y - 3} 7,${y} 0,${y + 3} -7,${y}`)
        + box(`-7,${y} 0,${y + 3} 0,${y + 4.6} -7,${y + 1.6}`, 'face--left')
        + box(`7,${y} 0,${y + 3} 0,${y + 4.6} 7,${y + 1.6}`, 'face--right')
    }
    return `${out}</svg>`
  }
  if (shape === 'fan') {
    let out = `<svg width="20" height="18" viewBox="-10 -13 20 18">`
    for (const dx of [-5, -1, 3]) {
      out += box(`${dx},-9 ${dx + 2},-8 ${dx + 2},2 ${dx},1`, 'face--left')
        + box(`${dx},-9 ${dx + 2},-8 ${dx + 2},-7.4 ${dx},-8.4`)
    }
    return `${out}</svg>`
  }
  return `<svg width="20" height="18" viewBox="-10 -13 20 18">`
    + box('0,-11 8,-7 0,-3 -8,-7')
    + box('-8,-7 0,-3 0,3 -8,-1', 'face--left')
    + box('8,-7 0,-3 0,3 8,-1', 'face--right')
    + `<path class="striation" d="M -8 -3 L 0 1 L 8 -3"/></svg>`
}

const SHAPE_MEANING = [
  ['tower', 'code that runs'],
  ['slabs', 'a stored collection'],
  ['fan', 'a queue or buffer'],
  ['pad', 'types and constants'],
  ['ghost', 'outside this repo'],
]

function lineSwatch(cls) {
  return `<svg width="26" height="8" viewBox="0 0 26 8">`
    + `<path class="edge ${cls}" d="M 1 4 L 25 4"/></svg>`
}

function legend(map) {
  const shapes = SHAPE_MEANING
    .filter(([shape]) => map.nodes.some((node) => (node.shape ?? DEFAULT_SHAPE[node.kind]) === shape))
    .map(([shape, meaning]) => `<span class="legend__item">${shapeSwatch(shape)}${esc(meaning)}</span>`)
    .join('')

  const usedKinds = new Set(map.edges.map((edge) => edge.kind))
  const lines = [
    ['call', 'call'],
    ['write', 'writes state'],
    ['read', 'reads state'],
    ['emit', 'publishes'],
    ['consume', 'consumes'],
    ['http', 'leaves the process'],
    ['import', 'types only'],
  ].filter(([kind]) => usedKinds.has(kind))
    .map(([kind, meaning]) => `<span class="legend__item">${lineSwatch(`edge--${kind}`)}${esc(meaning)}</span>`)
    .join('')

  const hasInferred = map.edges.some((edge) => edge.confidence === 'inferred')
    || map.nodes.some((node) => node.confidence === 'inferred')

  return `<div class="legend__group">${shapes}</div>`
    + `<span class="legend__sep">|</span>`
    + `<div class="legend__group">${lines}`
    + (hasInferred ? `<span class="legend__item">${lineSwatch('edge--inferred')}inferred, not pinned to a line</span>` : '')
    + `</div>`
    + `<span class="legend__sep">|</span>`
    + `<span class="legend__item">taller = more code &middot; wider = more files &middot; denser = more dependents</span>`
}

function flowSelect(map) {
  const flows = map.flows ?? []
  if (flows.length === 0) return ''
  const options = flows
    .map((flow) => `<option value="${esc(flow.id)}">${esc(flow.label)}</option>`)
    .join('')
  return `<select id="flow-select" aria-label="Choose a traced flow">${options}</select>`
    + `<button id="toggle-flow" type="button" aria-pressed="false">&#9654; Play flow</button>`
    + `<button id="trace-step" type="button">Trace one step</button>`
}

export function render(map, repoRoot) {
  const gate = validateMap(map, repoRoot)
  if (gate.errors.length > 0) {
    const detail = gate.errors.map((error) => `  ${error}`).join('\n')
    throw new Error(`map failed validation:\n${detail}`)
  }
  return resolveNodeFiles(map, repoRoot).then(({ resolved, errors }) => {
    if (errors.length > 0) throw new Error(`map failed validation:\n${errors.map((e) => `  ${e}`).join('\n')}`)

    // Can per-structure test coverage be claimed at all?
    //
    // The untested marker says "no test file references this structure", and
    // that is only a fair claim if attribution works in this repo. Tests named
    // after the source file attribute cleanly; contract or integration tests
    // named after a concern -- `legacy-cutover.test.ts` -- cannot be tied to
    // one file by any scheme. Marking every building untested because a repo
    // organises its tests by behaviour is a false statement rendered onto the
    // picture, so the marker is suppressed and the numbers are disclosed instead.
    const scopeGlobs = map.meta?.scopeGlobs
    const scopedTests = Array.isArray(scopeGlobs) && scopeGlobs.length > 0
      ? new Set(expandGlobs(repoRoot, scopeGlobs).files.filter((file) => TEST_PATTERN.test(file)))
      : null
    const discovered = new Set(Object.values(resolved).flatMap((entry) => entry.discoveredTests ?? []))
    // Both sides of the ratio must describe the same set of files. Discovery
    // ranges over the whole repo, so counting it against a scoped total once
    // produced more attributions than there were tests.
    const attributed = scopedTests === null
      ? discovered.size
      : [...discovered].filter((file) => scopedTests.has(file)).length
    const inScope = scopedTests === null ? null : scopedTests.size
    // Reliability is a property of the repo's naming convention, not of how
    // completely this map claims files.
    const pairable = scopedTests === null ? null : testsWithSourceCounterpart(repoRoot, [...scopedTests])
    const testAttribution = {
      inScope,
      attributed,
      pairable,
      reliable: inScope === null ? true : inScope === 0 || pairable / inScope >= 0.5,
    }

    const geo = layout(map, resolved)
    const scene = renderScene(map, geo, resolved, testAttribution)

    // Metrics handed to the page: measured facts plus the derived mass, so the
    // panel can say "capped at 30 floors" honestly.
    const metrics = {}
    for (const node of map.nodes) {
      const mass = massOf(resolved[node.id])
      metrics[node.id] = {
        fileCount: resolved[node.id].fileCount,
        testFiles: resolved[node.id].testFiles,
        loc: resolved[node.id].loc,
        testLoc: resolved[node.id].testLoc,
        largestFile: resolved[node.id].largestFile,
        fanIn: geo.fanIn.get(node.id) ?? 0,
        fanOut: geo.fanOut.get(node.id) ?? 0,
        rank: geo.rank.get(node.id) ?? 0,
        floors: mass.floors,
        capped: mass.capped,
        rawFloors: mass.rawFloors,
      }
    }

    const totals = Object.values(metrics).reduce(
      (acc, entry) => ({
        files: acc.files + entry.fileCount,
        loc: acc.loc + entry.loc,
        tests: acc.tests + entry.testFiles,
      }),
      { files: 0, loc: 0, tests: 0 },
    )

    const css = readFileSync(join(assets, 'app.css'), 'utf8')
    const js = readFileSync(join(assets, 'app.js'), 'utf8')
    // \u-escape every non-ASCII code point so the payload survives any charset.
    const payload = JSON.stringify({
      map, metrics, testAttribution,
      chapterViews: geo.chapterViews,
      revealedAt: Object.fromEntries(geo.revealedAt),
    })
      .replace(/</g, '\\u003c')
      .replace(/[^\x20-\x7E]/g, (char) => `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`)

    const statbar = [
      statBlock('repository', `${map.meta.repository} / ${map.meta.title}`, { wide: true, strong: true }),
      statBlock('revision', `${map.meta.branch || 'main'} @ ${map.meta.commit}`),
      statBlock('structures', `${map.nodes.length} in ${map.groups.length} groups`),
      statBlock('connections', `${map.edges.length}`),
      statBlock('source measured', `${totals.files} files / ${totals.loc.toLocaleString()} LOC`),
      statBlock('traced flows', `${(map.flows ?? []).length}`),
      ...((map.chapters ?? []).length > 0 ? [statBlock('chapters', `${map.chapters.length}`)] : []),
    ].join('')

    // The title is the artifact's name in a gallery, so it carries the subject
    // and nothing else; "isometric system map" belongs in the publish
    // description, where an explanation is what the field is for.
    return `<title>${esc(map.meta.title)}</title>
<style>
${css}</style>
<div class="app">
  <header class="statbar">
    ${statbar}
    <div class="controls">${flowSelect(map)}<button id="reset-view" type="button">Reset view</button></div>
  </header>

  <nav class="sidebar" aria-label="Structures">${sidebar(map, resolved)}</nav>

  <main class="stage">
    <div class="stage__head">
      <div class="stage__eyebrow">Isometric system map</div>
      <div class="stage__title">${esc(map.meta.subtitle || map.meta.title)}</div>
    </div>
    <div class="stage__zoom">
      <button id="zoom-in" type="button" aria-label="Zoom in">+</button>
      <button id="zoom-out" type="button" aria-label="Zoom out">&minus;</button>
    </div>
    ${scene}
    <div class="stage__hint">drag to pan &middot; scroll to zoom &middot; click a structure to read it &middot; "." traces one step &middot; esc returns to the overview</div>
  </main>

  <aside class="explainer">
    <div class="tabs" role="tablist">
      <button class="tab" type="button" role="tab" aria-selected="true">What it does</button>
      <button class="tab" type="button" role="tab" aria-selected="false">How it's built</button>
    </div>
    <div class="panel" id="panel" role="tabpanel"></div>
  </aside>

  <footer class="legend">${legend(map)}</footer>
</div>
<script>window.__SYSTEM_MAP__ = ${payload};</script>
<script>
${js}</script>
`
  })
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith('render.mjs')
if (isMain) {
  const args = process.argv.slice(2)
  const flags = new Map()
  const positional = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) { flags.set(args[i].slice(2), args[i + 1]); i += 1 } else positional.push(args[i])
  }
  const mapPath = positional[0]
  const repoFlag = flags.has('repo') ? 1 : -1
  const outFlag = flags.has('out') ? 1 : -1
  if (!mapPath || outFlag === -1) {
    console.error('usage: node scripts/render.mjs <map.json> --repo <root> --out <file.html>')
    process.exit(2)
  }
  const repoRoot = repoFlag !== -1 ? resolve(flags.get('repo')) : process.cwd()
  const map = JSON.parse(readFileSync(resolve(mapPath), 'utf8'))
  try {
    const html = await render(map, repoRoot)
    writeFileSync(resolve(flags.get('out')), html, 'utf8')
    console.log(`wrote ${flags.get('out')} (${(html.length / 1024).toFixed(1)} KB)`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
