#!/usr/bin/env node
// Show me: install the skill, or run its scripts directly.
//
//   npx @ofori_01/show-me install            put the skill in ~/.claude/skills
//   npx @ofori_01/show-me install --here     put it in ./.claude/skills
//   npx @ofori_01/show-me validate <map> --repo <dir>
//   npx @ofori_01/show-me render   <map> --repo <dir> --out <file.html> [--standalone]
//   npx @ofori_01/show-me twin     <map> --repo <dir> --out SYSTEM.md
//   npx @ofori_01/show-me preview  <map> --repo <dir> --out flow.svg [--flow <id>]

import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const skillSource = resolve(here, '..', 'skills', 'show-me')
const version = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8')).version

const SCRIPTS = {
  validate: 'validate.mjs',
  render: 'render.mjs',
  twin: 'twin.mjs',
  preview: 'preview.mjs',
  'self-test': 'self-test.mjs',
  'layout-test': 'layout-test.mjs',
}

function help() {
  console.log(`show-me ${version} — turn a codebase into a map you can check

  show-me install [--here]        install the skill for your agent
                                   default: ~/.claude/skills/show-me
                                   --here:  ./.claude/skills/show-me

  show-me validate <map> --repo <dir> [--relocate] [--globs-only]
  show-me render   <map> --repo <dir> --out <file.html> [--standalone]
  show-me twin     <map> --repo <dir> --out <file.md>
  show-me preview  <map> --repo <dir> --out <file.svg> [--flow <id>]

Once installed, you do not usually call these yourself — the agent does. Ask it
for what you want instead:

  "Show me how authentication works in this repo."

Docs: https://github.com/Ofori01/show-me`)
}

// Buildings at three heights on an isometric grid: the shape the tool draws,
// where height is how much code a thing holds.
const ART = String.raw`
                ____
               /   /|
    ____      /___/ |     ____
   /   /|     |   | |    /   /|
  /___/ |     |   | |   /___/ |
  |   | |     |   | |   |   | |
  |   |/      |   |/    |   |/
  '---'       '---'     '---'
`

// Colour only when a terminal is actually attached and NO_COLOR is unset, so
// piping the output somewhere never fills it with escape codes.
const tty = process.stdout.isTTY && !process.env.NO_COLOR
const dim = (text) => (tty ? `\x1b[2m${text}\x1b[0m` : text)
const bold = (text) => (tty ? `\x1b[1m${text}\x1b[0m` : text)

function install(args) {
  const here_ = args.includes('--here')
  const base = here_ ? resolve(process.cwd(), '.claude', 'skills') : join(homedir(), '.claude', 'skills')
  const target = join(base, 'show-me')
  const existed = existsSync(target)
  mkdirSync(base, { recursive: true })
  // Overwrite in place so upgrading is the same command as installing.
  cpSync(skillSource, target, { recursive: true })

  console.log(dim(ART))
  console.log(`  ${bold('Show me')} ${dim(version)} — ${existed ? 'updated' : 'installed'}`)
  console.log(`  ${dim(target)}\n`)
  console.log(`  Point it at a codebase and it draws one: buildings sized from the`)
  console.log(`  real source, connections traced through actual call paths, and every`)
  console.log(`  claim citing a file, a line, and the text found there.\n`)
  console.log(`  ${bold('Try it.')} Ask your agent:\n`)
  console.log(`    ${dim('"Show me how authentication works in this repo."')}`)
  console.log(`    ${dim('"Map this service end to end and explain it to someone new."')}\n`)
  console.log(`  ${dim(here_ ? 'Installed for this project only.'
    : 'Available in every project. Use --here to scope it to one.')}`)
  console.log(`  ${dim('Docs and a live demo: https://github.com/Ofori01/show-me')}\n`)
}

const [command, ...rest] = process.argv.slice(2)

if (!command || command === 'help' || command === '--help' || command === '-h') {
  help()
} else if (command === 'version' || command === '--version' || command === '-v') {
  console.log(version)
} else if (command === 'install') {
  install(rest)
} else if (SCRIPTS[command]) {
  // Hand the rest of the line straight to the script, so its own flags and
  // messages are the ones the user sees.
  process.argv = [process.argv[0], join(skillSource, 'scripts', SCRIPTS[command]), ...rest]
  await import(pathToFileURL(join(skillSource, 'scripts', SCRIPTS[command])).href)
} else {
  console.error(`unknown command "${command}"\n`)
  help()
  process.exit(2)
}
