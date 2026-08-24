# Show me

Point it at a codebase. Get back a map you can check.

[![A traced flow playing across the map of Show me](https://raw.githubusercontent.com/Ofori01/show-me/main/media/flow.svg)](https://ofori01.github.io/show-me/)

### [→ Open the live demo](https://ofori01.github.io/show-me/)

That is Show me, mapped by Show me — real geometry, not a mock-up. Walk the
chapters, click a building to read what it does, watch a payload travel a real
path. The same map as text is [SYSTEM.md](https://github.com/Ofori01/show-me/blob/main/SYSTEM.md).

## What it is

A skill for coding agents. It reads a repository and draws it: buildings sized
from the real source, connections traced through actual call and data paths, each
part explained in plain English — and **every claim citing a file, a line, and
the text found at that line.**


## Why that matters

Diagrams go stale, and a stale one is worse than none: people plan against it.
An AI will also happily draw a dependency that does not exist.

So before anything renders, a script opens every cited file and confirms the
quotation is really there. A map does not get to be pretty unless it is
checkable.

It catches fabrication, not misreading — a wrong reading with a real citation
still passes. That is exactly why the reading stays with the agent and is never
handed to a pattern.

## Install

```bash
npx @ofori_01/show-me install          # for every project
npx @ofori_01/show-me install --here   # for this one only
```

Run that from anywhere except a clone of this repository. Inside one, npx sees a
local package of the same name and looks for a binary that was never built,
which fails with `show-me: command not found`. From a checkout, use
`node bin/show-me.mjs install` instead.

Then ask for what you want:

> Show me how authentication works in this repo.

Run the same command again to upgrade. Node 18 or newer, no dependencies, no
build step. If you would rather not use npm, copy `skills/show-me` into
`~/.claude/skills/` yourself — that is all `install` does.

## Run it on itself

The one example that ships is the map of the skill itself, and its citations are relative to
the skill directory — so it resolves here, and anywhere you install it.

```bash
cd skills/show-me
node scripts/validate.mjs examples/show-me.system-map.json --repo .
node scripts/render.mjs   examples/show-me.system-map.json --repo . --out /tmp/map.html --standalone
node scripts/twin.mjs     examples/show-me.system-map.json --repo . --out /tmp/SYSTEM.md
```

Break a citation on purpose and run the gate again. That is the whole idea in one
command.

`SKILL.md` is what the agent follows; `references/` explains the data contract,
how to read a codebase, and what every shape means.


## License

MIT
