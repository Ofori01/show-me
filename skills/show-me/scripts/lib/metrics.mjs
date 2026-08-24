// Glob expansion and source metrics.
//
// Zero dependencies and no experimental Node APIs on purpose: this skill has to
// run in any repo on any Node >= 18 without an install step. Metrics computed
// here are the sole source of building geometry, so the agent authoring a
// system map cannot inflate a node beyond the code it actually points at.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const IGNORED_DIRS = new Set([
  // JS/TS
  'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.cache', 'out',
  // Python
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  // JVM / .NET / Rust / Go
  'target', 'obj', 'bin', '.gradle', '.mvn',
  // other ecosystems
  'vendor', 'Pods', '_build', 'deps', 'elm-stuff', '.dart_tool', '.terraform',
  '.git', '.svn',
])

// Test-file conventions vary by language and the untested marker is only
// honest if it recognises them: Python writes `test_foo.py`, Ruby
// `foo_spec.rb`, JVM and .NET `FooTest.java` / `FooTests.cs`, Go `foo_test.go`.
// The directory alternatives are anchored on a path start as well as a slash,
// so a top-level `tests/` directory is not missed.
export const TEST_PATTERN = new RegExp([
  '\\.spec\\.', '\\.test\\.',            // foo.spec.ts, foo.test.js
  '[_-]test\\.', '[_-]spec\\.',              // foo_test.go, foo_spec.rb, self-test.mjs
  '(^|[\\\\/])test_[^\\\\/]*$',              // test_foo.py
  '(^|[\\\\/])(__tests__|tests?|spec|specs)[\\\\/]', // tests/, spec/ at any depth
  'Tests?\\.(java|kt|kts|cs|scala|swift)$',  // FooTest.java, FooTests.cs
].join('|'))

/** Turn one glob into an anchored RegExp. Supports `**`, `*`, `?` and `{a,b}`. */
function globToRegExp(glob) {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        // `**/` spans zero or more directories; a bare `**` spans anything.
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2 } else { out += '.*'; i += 1 }
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else if (char === '{') {
      const close = glob.indexOf('}', i)
      if (close === -1) { out += '\\{'; continue }
      const alts = glob.slice(i + 1, close).split(',').map((a) => a.replace(/[.+^$()|[\]\\]/g, '\\$&'))
      out += `(?:${alts.join('|')})`
      i = close
    } else if ('.+^$()|[]\\'.includes(char)) {
      out += `\\${char}`
    } else {
      out += char
    }
  }
  return new RegExp(`^${out}$`)
}

function walk(root, dir, acc) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      walk(root, full, acc)
    } else if (entry.isFile()) {
      acc.push(relative(root, full).split(sep).join('/'))
    }
  }
  return acc
}

let cachedRoot = null
let cachedFiles = null

/** Every tracked-ish file in the repo, relative and slash-normalised. */
function repoFiles(repoRoot) {
  if (cachedRoot !== repoRoot) {
    cachedRoot = repoRoot
    cachedFiles = walk(repoRoot, repoRoot, []).sort()
  }
  return cachedFiles
}

/**
 * Expand globs against the repo. Returns `{ files, unmatched }` so callers can
 * report a glob that matched nothing rather than silently drawing an empty node.
 */
export function expandGlobs(repoRoot, patterns) {
  const all = repoFiles(repoRoot)
  const matched = new Set()
  const unmatched = []
  for (const pattern of patterns) {
    const re = globToRegExp(pattern)
    const hits = all.filter((file) => re.test(file))
    if (hits.length === 0) unmatched.push(pattern)
    for (const hit of hits) matched.add(hit)
  }
  return { files: [...matched].sort(), unmatched }
}

function countLines(repoRoot, file) {
  try {
    const text = readFileSync(join(repoRoot, file), 'utf8')
    let total = 0
    for (const line of text.split('\n')) if (line.trim() !== '') total += 1
    return total
  } catch {
    return 0
  }
}

/** Filename stem with any test-naming marker stripped, for pairing. */
function testStem(path) {
  return path
    .slice(path.lastIndexOf('/') + 1)
    .replace(/\.[^.]+$/, '')                       // extension
    .replace(/[._-](spec|test)$/i, '')              // foo.test / foo_test / foo-test
    .replace(/^test[._-]/i, '')                     // test_foo
    .replace(/(Tests?)$/, '')                       // FooTest / FooTests
    .toLowerCase()
}

/**
 * Find the test files that belong to a set of source files.
 *
 * Discovering these rather than trusting the author's globs keeps the untested
 * marker honest. But looking only *beside* the source file assumes tests live
 * next to what they test, which is one convention among several: a repo that
 * keeps everything under a top-level `tests/` tree would report every structure
 * untested while having fifty test files. That is a false claim rendered onto
 * the picture, so matching is by filename stem across the whole repo, with
 * path proximity breaking ties.
 */
export function discoverTestSiblings(repoRoot, files) {
  const all = repoFiles(repoRoot)
  const stemOf = testStem
  // Index every test file in the repo by the stem it appears to be testing.
  const byStem = new Map()
  for (const file of all) {
    if (!TEST_PATTERN.test(file)) continue
    const stem = stemOf(file)
    if (stem === '') continue
    if (!byStem.has(stem)) byStem.set(stem, [])
    byStem.get(stem).push(file)
  }

  /** Directory segments shared between two paths, counted from the end. */
  const proximity = (a, b) => {
    const left = a.split('/').slice(0, -1).reverse()
    const right = b.split('/').slice(0, -1).reverse()
    let shared = 0
    while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared += 1
    return shared
  }

  const found = new Set()
  for (const file of files) {
    if (TEST_PATTERN.test(file)) continue
    const candidates = byStem.get(stemOf(file))
    if (!candidates || candidates.length === 0) continue
    if (candidates.length === 1) { found.add(candidates[0]); continue }
    // Several tests share this stem, so keep the closest by directory overlap.
    const best = candidates.reduce(
      (winner, candidate) => (proximity(candidate, file) > proximity(winner, file) ? candidate : winner),
      candidates[0],
    )
    found.add(best)
  }
  return [...found]
}

/**
 * Of these test files, how many name a source file that exists in the repo?
 *
 * This measures the repo's *convention*, not the map's completeness. A repo
 * whose tests are named after the file under test can support a per-structure
 * untested marker; one whose tests are named after behaviour -- a contract or
 * integration suite -- cannot, by any scheme. Deriving reliability from how
 * many tests the author happened to claim conflates those two things, and
 * penalises a perfectly sibling-tested repo for having an incomplete map.
 */
export function testsWithSourceCounterpart(repoRoot, testFiles) {
  const all = repoFiles(repoRoot)
  const sourceStems = new Set()
  for (const file of all) {
    if (TEST_PATTERN.test(file)) continue
    sourceStems.add(testStem(file))
  }
  return testFiles.filter((file) => sourceStems.has(testStem(file))).length
}

/**
 * Source metrics for a node. Test files are counted separately: a large
 * building with zero test files is a fact worth seeing on the map.
 */
export function fileMetrics(repoRoot, files) {
  let loc = 0
  let testLoc = 0
  let testFiles = 0
  let bytes = 0
  for (const file of files) {
    const lines = countLines(repoRoot, file)
    try { bytes += statSync(join(repoRoot, file)).size } catch { /* unreadable */ }
    if (TEST_PATTERN.test(file)) { testFiles += 1; testLoc += lines } else { loc += lines }
  }
  return {
    fileCount: files.length - testFiles,
    testFiles,
    loc,
    testLoc,
    bytes,
    largestFile: files.reduce(
      (best, file) => {
        const lines = countLines(repoRoot, file)
        return lines > best.loc ? { file, loc: lines } : best
      },
      { file: null, loc: 0 },
    ),
  }
}
