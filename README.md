# Show me

Point it at a codebase. Get back a picture you can trust, and a document that says the same thing.

### [→ Open the live demo](https://ofori01.github.io/show-me/)

Show me, mapped by Show me. Nothing to install — walk the six chapters, click a
building to read what it does, play a flow and watch a payload travel a real,
cited path. The same map as text is [SYSTEM.md](SYSTEM.md).

Show me is a skill for coding agents. It reads a repository and produces an
interactive isometric map of it: buildings on a grid whose size is measured from
the real source, connections traced through actual call and data paths, and a
panel explaining each part in plain English — where **every single claim cites a
file, a line, and the text found at that line.**

It works on any language. Nothing in it parses source code.


## Why the citations matter

Architecture diagrams go stale, and a stale diagram is worse than none: people
plan against it. Worse, a diagram produced by an AI can be confidently, fluently
wrong — it will happily draw a dependency that does not exist.

So the design makes that failure loud instead of quiet. Every structure,
connection and step names a file, a line, and a literal string. Before anything
renders, a script opens each file and checks the quotation is really there. A map
does not get to be pretty unless it is checkable.

**What that does not cover:** the check proves a cited line exists and says what
was quoted, not that it was read correctly. A misreading passes. That is why
interpretation stays with the agent and is never handed to a pattern.

## The idea in one line

**The agent reads the code. Scripts do only what reading reliably gets wrong.**

| Script | Why it is not the agent's job |
|---|---|
| `validate.mjs` | Opens every cited file and proves the quotation. Ninety citations is exactly the tedium a reader skims. It also reports **which files in scope nothing claims** — the blind spot you cannot see from inside, because skipping a subsystem feels identical to finishing. |
| `lib/metrics.mjs` | Counts files and lines. Building size is *measured*; the moment it is estimated, the picture is decoration. |
| `render.mjs` | Draws a deterministic scene whose connections provably never cross a building. Same input, same coordinates, every run — so two maps are comparable. |
| `twin.mjs` | Writes the same map as Markdown, so it greps, diffs, and survives a pull request. |

None of them knows what a language is. They match bytes, count lines and do
geometry, so a Python, Go, Rust or Ruby repository needs no configuration.

An earlier version shipped regex detectors that extracted relations
automatically. They were deleted: every false relation came from a pattern
misreading code, they needed new rules per framework, and the one genuinely
valuable thing they did turned out to need no language knowledge at all.

## Install

Copy the skill where your agent looks for skills.

```bash
git clone https://github.com/Ofori01/show-me.git
cp -R show-me/skills/show-me ~/.claude/skills/        # available everywhere
# or, for one project only:
cp -R show-me/skills/show-me /path/to/repo/.claude/skills/
```

Then ask for what you want:

> Show me how authentication works in this repo.
> Map this service end to end and explain it to someone new.

Requires Node 18 or newer. **No dependencies, no install step, no build.**

## Build it yourself

The repository ships one example: the map of Show me, made by Show me. Its
citations point inside this repo, so every one of them resolves and you can
watch the gate check them.

```bash
cd skills/show-me
node scripts/validate.mjs examples/show-me.system-map.json --repo ../..
node scripts/render.mjs   examples/show-me.system-map.json --repo ../.. --out /tmp/map.html --standalone
node scripts/twin.mjs     examples/show-me.system-map.json --repo ../.. --out /tmp/SYSTEM.md
```

`--standalone` wraps the page as its own document, which is what
[the demo](https://ofori01.github.io/show-me/) is. Without it you get a fragment
meant to be embedded in a host page.

Open `/tmp/map.html` in a browser. If nothing moves, serve it instead — some
browsers render a local file as a static snapshot with no scripts:

```bash
python3 -m http.server 8000 --directory /tmp
```

Break a citation on purpose and run the gate again. That is the whole idea in one
command.

## What you get

- **An isometric map.** Building height is lines of code, footprint is file
  count, hatch density is how many things depend on it. Shape says what a thing
  is: a tower runs, stacked slabs store, thin sheets buffer, a hollow outline is
  something outside the repo.
- **Chapters.** A large system reveals a few structures at a time, so it can be
  read rather than stared at. The field is laid out once, so nothing moves.
- **Traced flows.** A payload walks a real path, one cited step at a time, paced
  by how long each step takes to read.
- **A text twin.** The same map as Markdown, citations inline.
- **One file.** Self-contained HTML. No server, no CDN, no build.

## What is in the box

```
skills/show-me/
  SKILL.md                    what the agent reads and follows
  references/
    schema.md                 the data contract
    extraction.md             how to find structure by reading, and plain-language rules
    visual-language.md        what every shape and line means
  scripts/
    validate.mjs              the citation gate, coverage, --relocate, --globs-only
    render.mjs                map -> one HTML file
    twin.mjs                  map -> Markdown
    self-test.mjs             eleven ways a map can lie, each asserted caught
    layout-test.mjs           connections never cross a building; layout is deterministic
    lib/                      measuring, projection, placement, scene
  assets/                     theme and interaction, inlined at render time
  examples/                   the map of this repo, by this repo
docs/index.html               the live demo, rebuilt whenever the map changes
SYSTEM.md                     the text twin of the same map
```

## Honest limits

- **The gate catches fabrication, not misreading.** See above.
- **A map is a claim about one revision.** It goes stale when code moves and the
  gate will reject it. `validate.mjs --relocate` repairs the mechanical part;
  where the quoted code is gone, a person has to go and look.
- **Plain language is checked, not enforced.** The validator warns when prose
  names something in code or runs long. Warnings, not errors.

## Credit

The reference for the visual language was a "codebase as interactive isometric
diagram" screenshot: khaki paper, hatched structures, an index on the left, a
panel on the right.

[inkboard/system-atlas](https://github.com/inkboard/system-atlas) was built from
the same reference for the opposite purpose — designing a system in
conversation, rather than reading one that exists. Three of its ideas are here
because they are better than what I had: readable name tags on the field
("letters on boxes are not enough"), a generated text twin from a single source,
and progressive-disclosure chapters.

## License

MIT
