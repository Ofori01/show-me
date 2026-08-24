#!/usr/bin/env node
// Validate a system-map.json against the v1 contract.
//
//   node scripts/validate.mjs <map.json> [--repo <root>] [--window 4]
//
// Errors block rendering. Warnings print but pass. The point of this gate is
// that every claim on the map is checkable: each citation names a file, a line
// and a literal `evidence` substring, and we go read the file to confirm it.

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { needsShort } from './lib/svg.mjs'

const KINDS = new Set(['entry', 'service', 'store', 'queue', 'worker', 'external', 'config', 'ui'])
const SHAPES = new Set(['tower', 'slabs', 'fan', 'ghost', 'pad'])
const EDGE_KINDS = new Set(['call', 'read', 'write', 'emit', 'consume', 'http', 'import'])
const CONFIDENCE = new Set(['verified', 'inferred'])

const NODE_MIN = 6
const NODE_MAX = 40
const NODE_TARGET_MAX = 24

export function validateMap(map, repoRoot, { evidenceWindow = 4 } = {}) {
  const errors = []
  const warnings = []
  const err = (where, message) => errors.push(`${where}: ${message}`)
  const warn = (where, message) => warnings.push(`${where}: ${message}`)

  const fileCache = new Map()
  const readLines = (file) => {
    if (!fileCache.has(file)) {
      const full = join(repoRoot, file)
      fileCache.set(file, existsSync(full) ? readFileSync(full, 'utf8').split('\n') : null)
    }
    return fileCache.get(file)
  }

  /** The heart of the gate: prove `evidence` really sits near `line` in `file`. */
  const checkCitation = (citation, where) => {
    if (!citation || typeof citation !== 'object') return err(where, 'missing citation')
    const { file, line, evidence } = citation
    if (typeof file !== 'string' || file === '') return err(where, 'citation.file must be a non-empty string')
    if (file.startsWith('/') || file.includes('..')) return err(where, `citation.file must be repo-relative: ${file}`)
    if (!Number.isInteger(line) || line < 1) return err(where, `citation.line must be a positive integer, got ${line}`)
    if (typeof evidence !== 'string' || evidence.trim() === '') {
      return err(where, 'citation.evidence must be a non-empty literal substring of the cited file')
    }
    const lines = readLines(file)
    if (lines === null) return err(where, `cited file does not exist: ${file}`)
    if (line > lines.length) {
      return err(where, `citation.line ${line} is past end of ${file} (${lines.length} lines)`)
    }
    const from = Math.max(0, line - 1 - evidenceWindow)
    const to = Math.min(lines.length, line + evidenceWindow)
    const window = lines.slice(from, to).join('\n')
    if (!window.includes(evidence)) {
      const exact = lines.findIndex((text) => text.includes(evidence))
      const hint = exact === -1
        ? 'evidence string does not appear anywhere in the file'
        : `evidence appears at line ${exact + 1}, not within ${evidenceWindow} lines of ${line}`
      return err(where, `unverifiable citation in ${file}: ${hint}`)
    }
    return undefined
  }

  // ---- top level -----------------------------------------------------------
  if (map?.schema !== 'system-map/v1') {
    err('root', `schema must be "system-map/v1", got ${JSON.stringify(map?.schema)}`)
  }
  for (const field of ['meta', 'groups', 'nodes', 'edges']) {
    if (map?.[field] === undefined) err('root', `missing required field "${field}"`)
  }
  if (errors.length > 0) return { errors, warnings, metrics: null }

  // ---- meta ----------------------------------------------------------------
  for (const field of ['title', 'repository', 'commit', 'scope', 'overview']) {
    if (typeof map.meta[field] !== 'string' || map.meta[field].trim() === '') {
      err('meta', `missing required string "${field}"`)
    }
  }

  // A map that hid connections has to say so, in numbers.
  if (map.meta.omitted !== undefined) {
    const { edges: omittedEdges, note } = map.meta.omitted
    if (!Number.isInteger(omittedEdges) || omittedEdges < 0) {
      err('meta.omitted', 'edges must be a non-negative integer')
    }
    if (typeof note !== 'string' || note.trim().length < 10) {
      err('meta.omitted', 'note must say what was left out and why')
    }
  }

  // ---- groups --------------------------------------------------------------
  const groupIds = new Set()
  if (!Array.isArray(map.groups) || map.groups.length === 0) err('groups', 'must be a non-empty array')
  for (const [index, group] of (map.groups ?? []).entries()) {
    const where = `groups[${index}]`
    if (typeof group.id !== 'string' || group.id === '') err(where, 'missing id')
    else if (groupIds.has(group.id)) err(where, `duplicate group id "${group.id}"`)
    else groupIds.add(group.id)
    if (typeof group.label !== 'string' || group.label === '') err(where, 'missing label')
  }

  // ---- nodes ---------------------------------------------------------------
  const nodeIds = new Set()
  if (!Array.isArray(map.nodes)) err('nodes', 'must be an array')
  const nodes = Array.isArray(map.nodes) ? map.nodes : []
  if (nodes.length < NODE_MIN) err('nodes', `need at least ${NODE_MIN} nodes, got ${nodes.length}`)
  if (nodes.length > NODE_MAX) {
    err('nodes', `${nodes.length} nodes exceeds the ${NODE_MAX} ceiling — narrow the scope or aggregate harder`)
  } else if (nodes.length > NODE_TARGET_MAX) {
    warn('nodes', `${nodes.length} nodes is above the ${NODE_TARGET_MAX} readability target`)
  }

  for (const [index, node] of nodes.entries()) {
    const where = `nodes[${index}]${node.id ? ` (${node.id})` : ''}`
    if (typeof node.id !== 'string' || !/^[A-Z][A-Z0-9]{0,2}$/.test(node.id)) {
      err(where, `id must be 1-3 uppercase alphanumerics starting with a letter, got ${JSON.stringify(node.id)}`)
    } else if (nodeIds.has(node.id)) {
      err(where, `duplicate node id "${node.id}"`)
    } else {
      nodeIds.add(node.id)
    }
    if (typeof node.label !== 'string' || node.label === '') err(where, 'missing label')
    if (!groupIds.has(node.group)) err(where, `group "${node.group}" is not declared in groups`)
    if (!KINDS.has(node.kind)) err(where, `kind must be one of ${[...KINDS].join(', ')}, got ${JSON.stringify(node.kind)}`)
    if (node.shape !== undefined && !SHAPES.has(node.shape)) {
      err(where, `shape must be one of ${[...SHAPES].join(', ')}, got ${JSON.stringify(node.shape)}`)
    }
    if (node.confidence !== undefined && !CONFIDENCE.has(node.confidence)) {
      err(where, `confidence must be "verified" or "inferred"`)
    }
    if (node.short !== undefined && (typeof node.short !== 'string' || node.short.length > 16)) {
      err(where, 'short must be a string of at most 16 characters')
    }
    // The field carries a readable name under every building, and a label too
    // long to fit gets truncated into something that no longer means anything.
    if (needsShort(node)) {
      warn(where, `label "${node.label}" is too long for the map tag; give it a "short" of <= 16 chars`)
    }
    for (const field of ['whatItDoes', 'howItsBuilt']) {
      if (typeof node[field] !== 'string' || node[field].trim().length < 20) {
        err(where, `"${field}" must be prose of at least 20 characters`)
      } else if (/^\s*(TODO|FIXME|TBD|describe|placeholder)\b/i.test(node[field])) {
        // A drafted map arrives with placeholders. Rendering one would publish a
        // picture nobody has explained, which is the failure this gate exists
        // to prevent, so the marker has to block.
        err(where, `"${field}" is still a placeholder; write the explanation before rendering`)
      }
    }
    if (!Array.isArray(node.files) || node.files.length === 0) err(where, 'files must be a non-empty array of globs')
    if (!Array.isArray(node.citations) || node.citations.length === 0) {
      err(where, 'citations must be a non-empty array')
    } else {
      node.citations.forEach((citation, i) => checkCitation(citation, `${where}.citations[${i}]`))
    }
  }

  // ---- edges ---------------------------------------------------------------
  const edgeKeys = new Set()
  const edges = Array.isArray(map.edges) ? map.edges : []
  for (const [index, edge] of edges.entries()) {
    const where = `edges[${index}] (${edge.from}->${edge.to})`
    if (!nodeIds.has(edge.from)) err(where, `unknown from "${edge.from}"`)
    if (!nodeIds.has(edge.to)) err(where, `unknown to "${edge.to}"`)
    if (edge.from === edge.to) err(where, 'self-edges are not renderable')
    if (!EDGE_KINDS.has(edge.kind)) err(where, `kind must be one of ${[...EDGE_KINDS].join(', ')}`)
    if (edge.confidence !== undefined && !CONFIDENCE.has(edge.confidence)) {
      err(where, 'confidence must be "verified" or "inferred"')
    }
    if (edge.label !== undefined && String(edge.label).length > 24) warn(where, 'label longer than 24 chars will be clipped')
    if (edge.weight !== undefined && (!Number.isInteger(edge.weight) || edge.weight < 1)) {
      err(where, 'weight must be a positive integer (how many source references back this edge)')
    }
    const key = `${edge.from}>${edge.to}>${edge.kind}`
    if (edgeKeys.has(key)) warn(where, 'duplicate edge')
    edgeKeys.add(key)
    checkCitation(edge.citation, `${where}.citation`)
  }

  const orphans = [...nodeIds].filter(
    (id) => !edges.some((edge) => edge.from === id || edge.to === id),
  )
  if (orphans.length > 0) warn('edges', `nodes with no connections: ${orphans.join(', ')}`)

  const flows = Array.isArray(map.flows) ? map.flows : []

  // ---- plain language ------------------------------------------------------
  // A map is read by the person who has to make a decision about the system,
  // and that person is often not the one who wrote it. Prose that assumes the
  // vocabulary excludes exactly the reader who needed the picture most. These
  // are warnings, never errors: sometimes a term is the clearest word there is.
  const PLAINER = new Map([
    ['dto', 'say what the data is'],
    ['orm', 'the database layer'],
    ['crud', 'create, read, update and delete'],
    ['idempotent', 'safe to run twice'],
    ['idempotency', 'being safe to run twice'],
    ['middleware', 'a step every request passes through'],
    ['polymorphic', 'handles several shapes'],
    ['serialize', 'turn into text'],
    ['deserialize', 'read back from text'],
    ['instantiate', 'create'],
    ['abstraction', 'name the actual thing'],
    ['monorepo', 'one repository holding several projects'],
    ['invariant', 'a rule that always holds'],
    ['dependency injection', 'dependencies handed in from outside'],
    ['barrel', 'a file that re-exports others'],
  ])
  const CODE_IDENTIFIER = /\b(?:[a-z]+[A-Z][A-Za-z]*|[A-Z][a-z]+[A-Z][A-Za-z]*|[a-z]+_[a-z_]+|[A-Z]{2,}_[A-Z_]+)\b|\b[\w/-]+\.(?:ts|tsx|mjs|js|jsx|py|go|rb|java|cs|sql|prisma|json)\b/g
  // Product and protocol names are camel-cased too, and they are exactly the
  // plain words a reader would use. Flagging "GitHub" as jargon would push an
  // author towards something worse. Extend this list rather than loosening the
  // pattern -- a real identifier like QueueService must still be caught.
  const PROPER_NOUNS = new Set([
    'github', 'gitlab', 'bitbucket', 'javascript', 'typescript', 'nodejs', 'next.js',
    'nestjs', 'postgresql', 'mysql', 'mongodb', 'dynamodb', 'localstack', 'eventbridge',
    'webauthn', 'oauth', 'openid', 'graphql', 'bullmq', 'redis', 'prisma', 'drizzle',
    'supabase', 'cognito', 'sendgrid', 'openai', 'anthropic', 'openrouter', 'livekit',
    'kubernetes', 'terraform', 'cloudfront', 'googleapis', 'microsoft', 'sharepoint',
    'onedrive', 'salesforce', 'quickbooks', 'stripe', 'paypal', 'docusign', 'youtube',
  ])

  const readable = (text, where, what) => {
    if (typeof text !== 'string' || text === '') return
    // Reader-facing prose names things in words, not in identifiers. The
    // implementation register is where a class or a filename belongs.
    const found = [...text.matchAll(CODE_IDENTIFIER)]
      .map((match) => match[0])
      .filter((word) => !PROPER_NOUNS.has(word.toLowerCase()))
    if (found.length > 0) {
      warn(where, `${what} names "${found[0]}" in code rather than in words — put identifiers in howItsBuilt`)
    }
    const lower = text.toLowerCase()
    for (const [term, plainer] of PLAINER) {
      if (new RegExp(`\\b${term}\\b`).test(lower)) {
        warn(where, `${what} uses "${term}"; plainer: ${plainer}`)
      }
    }
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const words = sentence.trim().split(/\s+/).filter(Boolean).length
      if (words > 30) warn(where, `${what} has a ${words}-word sentence; split it (aim under 25)`)
    }
  }

  for (const [index, node] of nodes.entries()) {
    readable(node.whatItDoes, `nodes[${index}] (${node.id})`, 'whatItDoes')
  }

  // ---- chapters ------------------------------------------------------------
  // Progressive disclosure is what makes a large system readable without
  // pretending it is small. Buildings never move between chapters -- the field
  // is laid out once and the camera fits the revealed subset -- so the reader
  // builds one mental model and adds to it.
  const chapters = Array.isArray(map.chapters) ? map.chapters : []
  if (chapters.length > 0) {
    if (chapters.length < 2) err('chapters', 'a single chapter is not progressive disclosure; drop the field or write more')
    if (chapters.length > 12) warn('chapters', `${chapters.length} chapters is a long read; 4-10 is usual`)
    const chapterIds = new Set()
    const revealedBy = new Map()
    chapters.forEach((chapter, index) => {
      const where = `chapters[${index}]${chapter.id ? ` (${chapter.id})` : ''}`
      if (typeof chapter.id !== 'string' || chapter.id === '') err(where, 'missing id')
      else if (chapterIds.has(chapter.id)) err(where, `duplicate chapter id "${chapter.id}"`)
      else chapterIds.add(chapter.id)
      if (typeof chapter.title !== 'string' || chapter.title === '') err(where, 'missing title')
      for (const field of ['lede', 'story']) {
        readable(chapter[field], where, field)
        if (typeof chapter[field] !== 'string' || chapter[field].trim().length < 15) {
          err(where, `"${field}" must be prose of at least 15 characters`)
        } else if (/^\s*(TODO|FIXME|TBD)\b/i.test(chapter[field])) {
          err(where, `"${field}" is still a placeholder`)
        }
      }
      const isLast = index === chapters.length - 1
      if (!Array.isArray(chapter.reveals)) {
        err(where, 'reveals must be an array of structure ids')
      } else if (chapter.reveals.length === 0 && !isLast) {
        err(where, 'reveals must list the structures this chapter introduces')
      } else {
        if (chapter.reveals.length > 4) {
          warn(where, `reveals ${chapter.reveals.length} structures; 1-4 keeps a chapter digestible`)
        }
        for (const id of chapter.reveals) {
          if (!nodeIds.has(id)) err(where, `reveals unknown structure "${id}"`)
          else if (revealedBy.has(id)) err(where, `"${id}" was already revealed by chapter ${revealedBy.get(id) + 1}`)
          else revealedBy.set(id, index)
        }
      }
      // A chapter's flow may only touch what the reader has already been shown.
      if (chapter.flow !== undefined) {
        const flow = flows.find((entry) => entry.id === chapter.flow)
        if (!flow) err(where, `flow "${chapter.flow}" is not declared in flows`)
        else {
          const availableAt = new Set(
            chapters.slice(0, index + 1).flatMap((entry) => entry.reveals ?? []),
          )
          const unseen = [...new Set(flow.steps.flatMap((step) => [step.from, step.to]))]
            .filter((id) => !availableAt.has(id))
          if (unseen.length > 0) {
            err(where, `flow "${chapter.flow}" touches ${unseen.join(', ')}, not yet revealed here`)
          }
        }
      }
    })
    const unrevealed = [...nodeIds].filter((id) => !revealedBy.has(id))
    if (unrevealed.length > 0) {
      err('chapters', `never revealed by any chapter: ${unrevealed.join(', ')}`)
    }
  }

  // ---- flows ---------------------------------------------------------------
  const flowIds = new Set()
  for (const [index, flow] of flows.entries()) {
    const where = `flows[${index}]${flow.id ? ` (${flow.id})` : ''}`
    if (typeof flow.id !== 'string' || flow.id === '') err(where, 'missing id')
    else if (flowIds.has(flow.id)) err(where, `duplicate flow id "${flow.id}"`)
    else flowIds.add(flow.id)
    if (typeof flow.label !== 'string' || flow.label === '') err(where, 'missing label')
    if (typeof flow.summary !== 'string' || flow.summary.trim().length < 20) {
      err(where, 'summary must be prose of at least 20 characters')
    }
    readable(flow.summary, where, 'summary')
    if (!Array.isArray(flow.steps) || flow.steps.length < 2) {
      err(where, 'a flow needs at least 2 steps')
      continue
    }
    if (flow.steps.length > 12) warn(where, `${flow.steps.length} steps is long; consider splitting the flow`)
    // `position` is where the traced path currently stands. A branch step is a
    // side effect (a write, an audit record, a notification) that fires from the
    // current position without moving it, so the path resumes where it forked.
    let position = flow.steps[0]?.from
    flow.steps.forEach((step, i) => {
      const stepWhere = `${where}.steps[${i}]`
      if (!nodeIds.has(step.from)) err(stepWhere, `unknown from "${step.from}"`)
      if (!nodeIds.has(step.to)) err(stepWhere, `unknown to "${step.to}"`)
      if (typeof step.note !== 'string' || step.note.trim() === '') err(stepWhere, 'missing note')
      readable(step.note, stepWhere, 'note')
      if (step.branch !== undefined && typeof step.branch !== 'boolean') err(stepWhere, 'branch must be a boolean')
      checkCitation(step.citation, `${stepWhere}.citation`)
      // A traced flow moves along real connections and never teleports.
      if (step.from !== position) {
        err(stepWhere, `does not chain: path stands at "${position}" but this step starts at "${step.from}"`)
      }
      if (!step.branch) position = step.to
      if (!edges.some((edge) => edge.from === step.from && edge.to === step.to)) {
        warn(stepWhere, `traverses ${step.from}->${step.to}, which is not in edges`)
      }
    })
    if (flow.steps.every((step) => step.branch)) err(where, 'every step is a branch — the flow never goes anywhere')
  }

  // Glob resolution and measurement happen in `resolveNodeFiles`, which callers
  // run separately so a structural failure short-circuits before any file I/O.
  return { errors, warnings, nodeIds, groupIds }
}

/**
 * Files inside the map's declared scope that no node claimed.
 *
 * This is the check that catches the thing a reader cannot catch in themselves.
 * Reading a directory, feeling done and moving on is the normal failure, and it
 * is invisible from the inside -- an author who skipped a subsystem has no
 * sensation of having skipped it. Set subtraction over a file list has no such
 * blind spot, and it needs to know nothing whatsoever about the language.
 *
 * A handful of unclaimed files is ordinary: fixtures, barrels, generated code.
 * A cluster of them with a common prefix is a part of the system you missed.
 */
export async function scopeCoverage(map, repoRoot) {
  const globs = map.meta?.scopeGlobs
  if (!Array.isArray(globs) || globs.length === 0) return null
  const { expandGlobs } = await import('./lib/metrics.mjs')
  const scope = expandGlobs(repoRoot, globs)
  const claimed = new Set()
  for (const node of map.nodes) {
    for (const file of expandGlobs(repoRoot, node.files).files) claimed.add(file)
  }
  const unclaimed = scope.files.filter((file) => !claimed.has(file))
  // Group by directory so a missed subsystem reads as one finding, not thirty.
  const byDir = new Map()
  for (const file of unclaimed) {
    const dir = file.slice(0, file.lastIndexOf('/')) || '.'
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
  }
  return {
    inScope: scope.files.length,
    claimed: scope.files.length - unclaimed.length,
    unclaimed,
    unmatchedGlobs: scope.unmatched,
    clusters: [...byDir.entries()].sort((a, b) => b[1] - a[1]),
  }
}

/** Resolve node globs and report empties. Kept separate so render can reuse it. */
export async function resolveNodeFiles(map, repoRoot) {
  const { expandGlobs, fileMetrics, discoverTestSiblings } = await import('./lib/metrics.mjs')
  const errors = []
  const resolved = {}
  for (const node of map.nodes) {
    const { files, unmatched } = expandGlobs(repoRoot, node.files)
    if (unmatched.length > 0) {
      errors.push(`nodes (${node.id}): globs matched nothing: ${unmatched.join(', ')}`)
    }
    // A ghost stands for a system outside this repo. Sizing it by the adapter
    // code that reaches it is informative, but requiring that -- while also
    // forbidding overlap -- forces the author to carve adapter files out of the
    // domain nodes that own them, so node boundaries end up shaped by a
    // validator rule instead of by the story. An external may therefore own no
    // files, and may share the ones it does own.
    if (files.length === 0 && node.kind !== 'external') {
      errors.push(`nodes (${node.id}): resolved to zero files — a building with no code cannot be drawn`)
    }
    // Tests are attributed by sibling discovery, not by the author's globs, so
    // the untested marker reflects the repo rather than the map's phrasing.
    // Tests found by discovery are tied to a specific source file. Tests a
    // node's own globs swept up are not -- a node may simply claim the test
    // directory -- so the two are counted separately, or "attributed" would
    // include every test file in a repo that files them in one place.
    const discovered = discoverTestSiblings(repoRoot, files).filter((file) => !files.includes(file))
    const withTests = [...new Set([...files, ...discovered])].sort()
    const measured = fileMetrics(repoRoot, withTests)
    // A node can legitimately *be* the test suite -- a gate's own guard scripts
    // are a structure worth drawing. When every file it claims is a test file,
    // measuring it as empty would flatten it to a minimum building with zero
    // lines, so its subject counts as its source.
    if (measured.fileCount === 0 && measured.testFiles > 0) {
      measured.fileCount = measured.testFiles
      measured.loc = measured.testLoc
      measured.isTestSuite = true
    }
    resolved[node.id] = { files: withTests, globbed: files, discoveredTests: discovered, ...measured }
  }
  // A file claimed by many nodes usually means the aggregation double-counts.
  const externalIds = new Set(map.nodes.filter((node) => node.kind === 'external').map((node) => node.id))
  const owners = new Map()
  for (const [id, entry] of Object.entries(resolved)) {
    if (externalIds.has(id)) continue   // an adapter file legitimately serves both
    for (const file of entry.globbed) {
      if (!owners.has(file)) owners.set(file, [])
      owners.get(file).push(id)
    }
  }
  const shared = [...owners.entries()].filter(([, ids]) => ids.length > 1)
  const warnings = shared.length > 0
    ? [`nodes: ${shared.length} file(s) claimed by more than one node, e.g. ${shared[0][0]} -> ${shared[0][1].join(', ')}`]
    : []
  return { resolved, errors, warnings }
}

/**
 * Repair citations whose line drifted while the code moved.
 *
 * Editing a file shifts every line below the edit, so a map goes stale against
 * the code it describes -- which the gate catches, correctly, as unverifiable.
 * The evidence string is the real anchor, though: when it still exists in the
 * cited file, relocating the line is a mechanical repair and not a weakening of
 * the claim. When the evidence has genuinely gone, that is a change in the code
 * and needs a person, so it is reported rather than guessed at.
 */
export function relocateCitations(map, repoRoot) {
  const moved = []
  const lost = []
  const visit = (citation, where) => {
    if (!citation?.file || !citation.evidence) return
    let lines
    try {
      lines = readFileSync(join(repoRoot, citation.file), 'utf8').split('\n')
    } catch {
      lost.push(`${where}: file not found: ${citation.file}`)
      return
    }
    const window = lines.slice(Math.max(0, citation.line - 5), citation.line + 4).join('\n')
    if (window.includes(citation.evidence)) return           // still resolves
    const found = lines.findIndex((text) => text.includes(citation.evidence))
    if (found === -1) {
      lost.push(`${where}: evidence no longer in ${citation.file}: ${JSON.stringify(citation.evidence.slice(0, 60))}`)
      return
    }
    moved.push(`${where}: ${citation.file} ${citation.line} -> ${found + 1}`)
    citation.line = found + 1
  }

  for (const [index, node] of (map.nodes ?? []).entries()) {
    for (const [i, citation] of (node.citations ?? []).entries()) {
      visit(citation, `nodes[${index}] (${node.id}).citations[${i}]`)
    }
  }
  for (const [index, edge] of (map.edges ?? []).entries()) {
    visit(edge.citation, `edges[${index}] (${edge.from}->${edge.to})`)
  }
  for (const [index, flow] of (map.flows ?? []).entries()) {
    for (const [i, step] of (flow.steps ?? []).entries()) {
      visit(step.citation, `flows[${index}] (${flow.id}).steps[${i}]`)
    }
  }
  return { moved, lost }
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith('validate.mjs')
if (isMain) {
  const args = process.argv.slice(2)
  const mapPath = args.find((a) => !a.startsWith('--'))
  if (!mapPath) {
    console.error('usage: node scripts/validate.mjs <map.json> [--repo <root>] [--window 4] [--relocate] [--globs-only]')
    process.exit(2)
  }
  const repoFlag = args.indexOf('--repo')
  const repoRoot = repoFlag !== -1 ? resolve(args[repoFlag + 1]) : process.cwd()
  const windowFlag = args.indexOf('--window')
  const evidenceWindow = windowFlag !== -1 ? Number(args[windowFlag + 1]) : 4
  const relocate = args.includes('--relocate')

  let map
  try {
    map = JSON.parse(readFileSync(resolve(mapPath), 'utf8'))
  } catch (error) {
    console.error(`could not parse ${mapPath}: ${error.message}`)
    process.exit(2)
  }

  if (relocate) {
    const { moved, lost } = relocateCitations(map, repoRoot)
    for (const entry of moved) console.log(`  moved  ${entry}`)
    for (const entry of lost) console.error(`  LOST   ${entry}`)
    if (moved.length > 0) {
      writeFileSync(resolve(mapPath), `${JSON.stringify(map, null, 2)}\n`, 'utf8')
      console.log(`\nrelocated ${moved.length} citation(s) in ${mapPath}`)
    }
    if (lost.length > 0) {
      console.error(`\n${lost.length} citation(s) could not be relocated: the code they quoted is gone.`)
      console.error(`Re-read those call sites and cite what is there now.`)
    }
    if (moved.length === 0 && lost.length === 0) console.log('every citation still resolves; nothing to relocate')
    console.log('')
  }

  if (args.includes('--globs-only')) {
    // Before writing prose. Overlap and coverage are the two mistakes worth
    // catching while the grouping is still cheap to change.
    const globs = await resolveNodeFiles(map, repoRoot)
    const coverage = await scopeCoverage(map, repoRoot)
    for (const node of map.nodes) {
      const entry = globs.resolved[node.id]
      console.log(`  ${node.id.padEnd(4)} ${String(entry.fileCount).padStart(4)} files `
        + `${String(entry.loc).padStart(7)} LOC  ${node.label}`)
    }
    if (coverage) {
      const pct = coverage.inScope === 0 ? 0 : Math.round((coverage.claimed / coverage.inScope) * 100)
      console.log(`\nscope coverage: ${coverage.claimed}/${coverage.inScope} (${pct}%)`)
      for (const [dir, count] of coverage.clusters.slice(0, 10)) {
        console.log(`  unclaimed ${String(count).padStart(4)}  ${dir}`)
      }
    } else {
      console.log('\nno meta.scopeGlobs, so coverage cannot be checked')
    }
    for (const warning of globs.warnings) console.log(`  warn  ${warning}`)
    for (const error of globs.errors) console.error(`  ERROR ${error}`)
    process.exit(globs.errors.length > 0 ? 1 : 0)
  }

  const result = validateMap(map, repoRoot, { evidenceWindow })
  let { errors, warnings } = result
  if (errors.length === 0) {
    const globs = await resolveNodeFiles(map, repoRoot)
    errors = errors.concat(globs.errors)
    warnings = warnings.concat(globs.warnings)
    if (globs.errors.length === 0) {
      const totals = Object.values(globs.resolved).reduce(
        (acc, entry) => ({
          files: acc.files + entry.fileCount,
          loc: acc.loc + entry.loc,
          testFiles: acc.testFiles + entry.testFiles,
        }),
        { files: 0, loc: 0, testFiles: 0 },
      )
      console.log(
        `resolved ${map.nodes.length} nodes -> ${totals.files} source files, `
        + `${totals.loc.toLocaleString()} LOC, ${totals.testFiles} test files`,
      )
    }
  }

  const coverage = await scopeCoverage(map, repoRoot)
  if (coverage) {
    const pct = coverage.inScope === 0 ? 0 : Math.round((coverage.claimed / coverage.inScope) * 100)
    console.log(`scope coverage: ${coverage.claimed}/${coverage.inScope} files claimed (${pct}%)`)
    if (coverage.unmatchedGlobs.length > 0) {
      warnings.push(`meta.scopeGlobs matched nothing: ${coverage.unmatchedGlobs.join(', ')}`)
    }
    if (coverage.unclaimed.length > 0) {
      console.log(`${coverage.unclaimed.length} file(s) in scope that no structure claims:`)
      for (const [dir, count] of coverage.clusters.slice(0, 12)) {
        console.log(`  ${String(count).padStart(4)}  ${dir}`)
      }
      if (coverage.clusters.length > 12) console.log(`  ...and ${coverage.clusters.length - 12} more directories`)
      console.log('A cluster here is usually a subsystem you read past. Claim it or narrow meta.scopeGlobs.\n')
    }
  } else {
    warnings.push('meta.scopeGlobs is absent, so coverage cannot be checked -- nothing verifies that the map covers what it claims to')
  }

  for (const warning of warnings) console.log(`  warn  ${warning}`)
  for (const error of errors) console.error(`  ERROR ${error}`)
  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s) — map rejected. Fix the analysis, not the evidence strings.`)
    process.exit(1)
  }
  console.log(`\nOK — ${map.nodes.length} nodes, ${map.edges.length} edges, ${(map.flows ?? []).length} flows, all citations verified.`)
}
