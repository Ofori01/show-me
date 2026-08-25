#!/usr/bin/env node
// Turn ripgrep output into citation JSON.
//
//   rg -n 'def create_app' api/ | node scripts/cite.mjs --repo <root>
//   node scripts/cite.mjs --repo <root> "api/main.py:54:def create_app() -> FastAPI:"
//
// Copying file, line and evidence by hand dozens of times is the grindiest part
// of authoring a map, and it is pure clerical work -- exactly the kind of thing
// a script should carry. This also verifies each citation as it converts, so a
// bad paste is caught here rather than at the gate.
//
//   --array     wrap the results in a JSON array (for a citations field)
//   --edge      emit edge-shaped stubs: { kind, citation } ready to fill in
//   --quiet     JSON only, no commentary on stderr

import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Parse one ripgrep hit, tolerating colons inside the matched text.
 *
 * Two shapes arrive in practice. `path:line:text` when several files were
 * searched, and bare `line:text` when one file was named explicitly -- ripgrep
 * drops the filename in that case, which is easy to hit and confusing when the
 * parser silently finds nothing. `fallbackFile` covers the second shape.
 */
export function parseHit(line, fallbackFile = null) {
  const trimmed = line.trim()
  let file = fallbackFile
  let lineNumber
  let rest
  const withFile = /^([^:]+):(\d+):(.*)$/.exec(trimmed)
  const withoutFile = /^(\d+):(.*)$/.exec(trimmed)
  if (withFile) {
    [, file, lineNumber, rest] = withFile
  } else if (withoutFile && fallbackFile) {
    [, lineNumber, rest] = withoutFile
  } else {
    return null
  }
  const evidence = rest.trim()
  return evidence === '' || !file ? null : { file, line: Number(lineNumber), evidence }
}

/** Confirm the evidence really sits at that line, the same way the gate will. */
export function verify(citation, repoRoot, window = 4) {
  const full = join(repoRoot, citation.file)
  if (!existsSync(full)) return `file not found: ${citation.file}`
  const lines = readFileSync(full, 'utf8').split('\n')
  if (citation.line > lines.length) return `line ${citation.line} is past end of file (${lines.length} lines)`
  const from = Math.max(0, citation.line - 1 - window)
  const slice = lines.slice(from, Math.min(lines.length, citation.line + window)).join('\n')
  if (!slice.includes(citation.evidence)) {
    const actual = lines.findIndex((text) => text.includes(citation.evidence))
    return actual === -1
      ? 'evidence does not appear in the file'
      : `evidence is at line ${actual + 1}, not near ${citation.line}`
  }
  return null
}

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const repoFlag = args.indexOf('--repo')
const repoRoot = repoFlag !== -1 ? resolve(args[repoFlag + 1]) : process.cwd()
const valueFlags = new Set(['--repo', '--file'])
const positional = args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]))

const fileFlag = args.indexOf('--file')
const fallbackFile = fileFlag !== -1 ? args[fileFlag + 1] : null

let stdin = ''
try { stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8') } catch { stdin = '' }
const raw = [...positional, ...stdin.split('\n')].filter((line) => line.trim() !== '')
const hits = raw.map((line) => parseHit(line, fallbackFile)).filter(Boolean)

if (hits.length === 0) {
  console.error('usage: rg -nH <pattern> <path> | node scripts/cite.mjs --repo <root>')
  console.error('   or: node scripts/cite.mjs --repo <root> "path/file.py:54:some literal text"')
  console.error('')
  console.error('flags: --array  always emit an array   --edge  emit edge stubs')
  console.error('       --file <path>  for hits with no filename   --quiet  JSON only')
  if (raw.length > 0) {
    console.error('')
    console.error(`  ${raw.length} input line(s) matched no known shape. Ripgrep omits the`)
    console.error('  filename when you name a single file, so use -H (or --with-filename),')
    console.error('  or pass --file <path>.')
  }
  process.exit(2)
}

const good = []
let bad = 0
for (const hit of hits) {
  const problem = verify(hit, repoRoot)
  if (problem) {
    console.error(`  skipped ${hit.file}:${hit.line} — ${problem}`)
    bad += 1
  } else {
    good.push(hit)
  }
}

const shape = (citation) => (flags.has('--edge')
  ? { from: 'FROM', to: 'TO', kind: 'call', confidence: 'verified', citation }
  : citation)
const payload = good.map(shape)
console.log(JSON.stringify(flags.has('--array') || payload.length > 1 ? payload : payload[0], null, 2))

if (!flags.has('--quiet')) {
  console.error(`\n  ${good.length} verified${bad > 0 ? `, ${bad} rejected` : ''}`)
}
