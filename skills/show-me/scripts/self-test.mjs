#!/usr/bin/env node
// Self-test for the citation gate.
//
//   node scripts/self-test.mjs --repo <root>
//
// The skill's whole claim is that a fabricated relationship cannot render. That
// claim needs a test: each case below mutates a known-good map into a specific
// lie and asserts the gate rejects it.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateMap, resolveNodeFiles } from './validate.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const examples = join(here, '..', 'examples')
const repoFlag = process.argv.indexOf('--repo')
const repoRoot = repoFlag !== -1 ? resolve(process.argv[repoFlag + 1]) : resolve(here, '..', '..', '..', '..')

// Any example works as the fixture, so use whichever one resolves here. Naming
// a single map meant the gate could not be tested at all from a checkout where
// that map's cited paths were absent.
let base = null
let fixtureName = null
for (const name of readdirSync(examples).filter((f) => f.endsWith('.system-map.json')).sort()) {
  const candidate = JSON.parse(readFileSync(join(examples, name), 'utf8'))
  const structural = validateMap(candidate, repoRoot)
  if (structural.errors.length > 0) continue
  const globs = await resolveNodeFiles(candidate, repoRoot)
  if (globs.errors.length > 0) continue
  base = candidate
  fixtureName = name
  break
}
if (!base) {
  console.error(`no example map resolves against --repo ${repoRoot}, so the gate cannot be tested.`)
  console.error(`Point --repo at the repository an example was built from.`)
  process.exit(1)
}
console.log(`fixture: ${fixtureName}\n`)
const clone = () => JSON.parse(JSON.stringify(base))

// Mutations must not assume one map's shape. Locating their targets in whatever
// fixture resolved keeps these tests about the gate rather than about a
// particular example, which is what let two of them pass vacuously.
function longEnoughCitation(map) {
  for (const [nodeIndex, node] of map.nodes.entries()) {
    for (const [citeIndex, citation] of node.citations.entries()) {
      try {
        const lines = readFileSync(join(repoRoot, citation.file), 'utf8').split('\n').length
        if (lines >= 60) return { nodeIndex, citeIndex, lines }
      } catch { /* unreadable */ }
    }
  }
  return null
}

function branchStep(map) {
  for (const [flowIndex, flow] of (map.flows ?? []).entries()) {
    for (const [stepIndex, step] of flow.steps.entries()) {
      if (step.branch) return { flowIndex, stepIndex }
    }
  }
  return null
}

const longCite = longEnoughCitation(base)
const branch = branchStep(base)
if (!longCite) { console.error('fixture has no citation in a file of 60+ lines'); process.exit(2) }
if (!branch) { console.error('fixture has no branch step to test against'); process.exit(2) }

const cases = [
  {
    name: 'clean fixture passes',
    expect: 'pass',
    mutate: (map) => map,
  },
  {
    name: 'fabricated evidence string is rejected',
    expect: 'fail',
    match: /unverifiable citation/,
    mutate: (map) => {
      map.edges[0].citation.evidence = 'this.events.emit(GRC_EVENTS.TOTALLY_MADE_UP_EVENT'
      return map
    },
  },
  {
    name: 'real string cited at the wrong line is rejected',
    expect: 'fail',
    match: /evidence appears at line/,
    mutate: (map) => {
      // A line inside the file but far from the evidence: this is the case a
      // copy-paste citation lands in, and it must not pass.
      const target = map.nodes[longCite.nodeIndex].citations[longCite.citeIndex]
      const real = target.line
      target.line = real > 40 ? real - 35 : Math.min(longCite.lines, real + 35)
      return map
    },
  },
  {
    name: 'a line past the end of the file is rejected',
    expect: 'fail',
    match: /is past end of/,
    mutate: (map) => {
      map.nodes[longCite.nodeIndex].citations[longCite.citeIndex].line = 999999
      return map
    },
  },
  {
    name: 'citation to a file that does not exist is rejected',
    expect: 'fail',
    match: /cited file does not exist/,
    mutate: (map) => {
      map.nodes[0].citations[0].file = 'no-such-directory-anywhere/imaginary.file.ts'
      return map
    },
  },
  {
    name: 'a flow that teleports between nodes is rejected',
    expect: 'fail',
    match: /does not chain/,
    mutate: (map) => {
      // Point a mid-flow step at a node the path has not reached.
      const flow = map.flows[0]
      const elsewhere = map.nodes.find((node) => node.id !== flow.steps[1].from
        && node.id !== flow.steps[1].to && node.id !== flow.steps[0].from)
      flow.steps[1].from = elsewhere.id
      return map
    },
  },
  {
    name: 'a branch step does not advance the path',
    expect: 'pass',
    mutate: (map) => map, // fixture already relies on this; guards a regression
  },
  {
    name: 'a branch step wrongly treated as a hop breaks the chain',
    expect: 'fail',
    match: /does not chain/,
    mutate: (map) => {
      delete map.flows[branch.flowIndex].steps[branch.stepIndex].branch
      return map
    },
  },
  {
    name: 'a glob matching nothing is rejected',
    expect: 'fail',
    match: /globs matched nothing/,
    mutate: (map) => {
      map.nodes[2].files = ['no-such-directory-anywhere/**/*.nope']
      return map
    },
  },
  {
    name: 'an unknown node id on an edge is rejected',
    expect: 'fail',
    match: /unknown to/,
    mutate: (map) => {
      map.edges[1].to = 'ZZ'
      return map
    },
  },
  {
    name: 'prose too thin to be an explanation is rejected',
    expect: 'fail',
    match: /whatItDoes/,
    mutate: (map) => {
      map.nodes[1].whatItDoes = 'it does stuff'
      return map
    },
  },
]

let failures = 0
for (const testCase of cases) {
  const map = testCase.mutate(clone())
  let errors = validateMap(map, repoRoot).errors
  if (errors.length === 0) {
    errors = (await resolveNodeFiles(map, repoRoot)).errors
  }
  const passed = errors.length === 0
  const asExpected = testCase.expect === 'pass' ? passed : !passed
  const matched = testCase.expect === 'fail' && testCase.match
    ? errors.some((error) => testCase.match.test(error))
    : true

  if (asExpected && matched) {
    console.log(`  ok    ${testCase.name}`)
  } else {
    failures += 1
    console.error(`  FAIL  ${testCase.name}`)
    console.error(`        expected ${testCase.expect}, got ${passed ? 'pass' : 'fail'}`)
    if (!matched) console.error(`        no error matched ${testCase.match}`)
    for (const error of errors.slice(0, 3)) console.error(`        - ${error}`)
  }
}

console.log()
if (failures > 0) {
  console.error(`${failures} of ${cases.length} gate tests failed`)
  process.exit(1)
}
console.log(`all ${cases.length} gate tests passed`)
