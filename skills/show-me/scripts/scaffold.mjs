#!/usr/bin/env node
// Lay out the clerical parts of a new map so the author starts from a skeleton.
//
//   node scripts/scaffold.mjs --repo <dir> [--branch develop] \
//     [--scope 'src/**/*.py'] [--mode feature|subsystem|system] [--out draft.json]
//
// This deliberately infers no architecture. It reads git for the revision,
// counts files and lines, finds manifests, and emits empty structure shells with
// candidate globs. Which files are one structure, what any of them are for, and
// what connects to what all stay with the author -- that is the judgment a
// script cannot do, and an earlier version of this project proved the point by
// trying.
//
// The prose it writes is a placeholder that `validate.mjs` rejects, so a
// scaffold cannot be mistaken for a finished map.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expandGlobs, fileMetrics, TEST_PATTERN } from './lib/metrics.mjs'

const BUDGET = {
  feature: { nodes: [8, 16], districts: [3, 6] },
  subsystem: { nodes: [16, 28], districts: [5, 8] },
  system: { nodes: [24, 40], districts: [6, 10] },
}

const MANIFESTS = [
  'package.json', 'requirements.txt', 'pyproject.toml', 'setup.py', 'go.mod',
  'Gemfile', 'composer.json', 'Cargo.toml', 'pom.xml', 'build.gradle', 'mix.exs',
  'pubspec.yaml', 'Package.swift', 'deno.json',
]

// Filenames that tend to be doorways. Reported so the author knows where to
// start reading -- never written into the map as structure.
const DOORWAYS = [
  ['Next.js / Remix routes', /(^|\/)(route|page|layout)\.(ts|tsx|js|jsx)$/],
  ['controllers', /controller/i],
  ['Django urls / views', /(^|\/)(urls|views)\.py$/],
  ['app entry points', /(^|\/)(main|app|index|server|cli)\.(ts|js|mjs|py|go|rb)$/],
  ['migrations', /(^|\/)migrations?\//],
  ['schema files', /\.(prisma|sql|graphql)$/],
]

function git(repoRoot, args, fallback = null) {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim()
  } catch {
    return fallback
  }
}

export function scaffold(repoRoot, { branch = null, scope = [], mode = 'system' } = {}) {
  const globs = scope.length > 0 ? scope : ['**/*']
  const { files } = expandGlobs(repoRoot, globs)
  const source = files.filter((file) => !TEST_PATTERN.test(file))

  // Directory rollup: where the mass actually is.
  const dirs = new Map()
  for (const file of source) {
    const cut = file.lastIndexOf('/')
    const dir = cut === -1 ? '.' : file.slice(0, cut)
    if (!dirs.has(dir)) dirs.set(dir, [])
    dirs.get(dir).push(file)
  }
  const clusters = [...dirs.entries()]
    .map(([dir, list]) => ({ dir, files: list.length, ...fileMetrics(repoRoot, list) }))
    .sort((a, b) => b.loc - a.loc)

  const manifests = files.filter((file) => MANIFESTS.includes(file.slice(file.lastIndexOf('/') + 1)))
  const doorways = DOORWAYS
    .map(([label, pattern]) => ({ label, hits: source.filter((file) => pattern.test(file)) }))
    .filter((entry) => entry.hits.length > 0)

  const budget = BUDGET[mode] ?? BUDGET.system
  const shells = clusters.slice(0, budget.nodes[1])

  const head = git(repoRoot, ['rev-parse', '--short', 'HEAD'], 'UNKNOWN')
  const currentBranch = branch
    ?? git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], 'main')
  const name = git(repoRoot, ['rev-parse', '--show-toplevel'], repoRoot).split('/').pop()

  const id = (dir, taken) => {
    const words = dir.split('/').filter((part) => part !== '.' && part !== 'src')
    const base = (words[words.length - 1] ?? 'X').replace(/[^A-Za-z]/g, '').toUpperCase()
    let candidate = base.slice(0, 3) || 'X'
    let n = 1
    while (taken.has(candidate)) { candidate = `${base.slice(0, 2)}${n}`; n += 1 }
    taken.add(candidate)
    return candidate
  }

  const taken = new Set()
  const draft = {
    schema: 'system-map/v1',
    meta: {
      title: name,
      subtitle: 'TODO one line: what this map is about',
      repository: name,
      commit: head,
      branch: currentBranch,
      scope: 'TODO say in prose what this map covers, and what it deliberately leaves out',
      scopeGlobs: scope.length > 0 ? scope : clusters.slice(0, 8).map((c) => `${c.dir}/*`),
      overview: 'TODO two to five paragraphs. What is this system for, what is the shape of it, '
        + 'and what turned out to be the hard part.',
      readingHint: 'TODO one sentence on how to read the map',
    },
    groups: [{ id: 'group-1', label: 'TODO DISTRICT NAME', order: 1 }],
    nodes: shells.map((cluster) => ({
      id: id(cluster.dir, taken),
      label: 'TODO name',
      short: 'TODO',
      group: 'group-1',
      kind: 'service',
      files: [`${cluster.dir}/*`],
      whatItDoes: 'TODO plain English, for a reader without this codebase in their head.',
      howItsBuilt: 'TODO the mechanism, for someone about to change it.',
      citations: [],
      confidence: 'verified',
    })),
    edges: [],
    flows: [],
  }

  return { draft, clusters, manifests, doorways, budget, mode, source: source.length, files: files.length }
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith('scaffold.mjs')
if (isMain) {
  const args = process.argv.slice(2)
  const scope = []
  const flags = new Map()
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--scope') { scope.push(args[i + 1]); i += 1 }
    else if (args[i].startsWith('--')) { flags.set(args[i].slice(2), args[i + 1]); i += 1 }
  }
  const repoRoot = resolve(flags.get('repo') ?? process.cwd())
  const mode = flags.get('mode') ?? 'system'
  const result = scaffold(repoRoot, { branch: flags.get('branch'), scope, mode })
  const { draft, clusters, manifests, doorways, budget } = result

  console.log(`${draft.meta.repository} @ ${draft.meta.branch} ${draft.meta.commit}`)
  console.log(`${result.source} source files in scope (${result.files} including tests)\n`)

  if (manifests.length > 0) {
    console.log(`manifests — read these first, they name the entry points and the whole`)
    console.log(`external surface in one go:`)
    for (const file of manifests.slice(0, 8)) console.log(`  ${file}`)
    console.log('')
  }

  console.log(`where the mass is:`)
  for (const cluster of clusters.slice(0, 20)) {
    console.log(`  ${String(cluster.loc).padStart(7)} LOC  ${String(cluster.files).padStart(4)} files  ${cluster.dir}`)
  }
  if (clusters.length > 20) console.log(`  ...and ${clusters.length - 20} more directories`)
  console.log('')

  if (doorways.length > 0) {
    console.log(`likely doorways — where to start reading, not structure to copy:`)
    for (const entry of doorways) {
      console.log(`  ${String(entry.hits.length).padStart(4)}  ${entry.label}`)
      for (const hit of entry.hits.slice(0, 3)) console.log(`        ${hit}`)
    }
    console.log('')
  }

  console.log(`${result.mode} map: aim for ${budget.nodes[0]}-${budget.nodes[1]} structures `
    + `in ${budget.districts[0]}-${budget.districts[1]} districts.`)
  console.log(`${draft.nodes.length} shell(s) written, one per directory, as a starting partition.`)
  console.log(`\nThe shells are a guess at the seams and nothing more. Merge them by the role`)
  console.log(`things play, delete what is not a structure, and replace every TODO. Nothing`)
  console.log(`here has a citation yet, so the gate will reject this until you have read the`)
  console.log(`code and cited it.`)

  if (flags.has('out')) {
    writeFileSync(resolve(flags.get('out')), `${JSON.stringify(draft, null, 2)}\n`, 'utf8')
    console.log(`\nwrote ${flags.get('out')}`)
  } else {
    console.log(`\npass --out <file>.json to write the skeleton`)
  }
}
