---
name: show-me
description: >-
  Analyze a repository (or one feature of it) and produce an interactive
  isometric system map: varied 3D structures on a grid whose size is measured
  from real source metrics, dependency edges and animated payload flows traced
  from actual control and data paths, a shape legend, and an explainer panel
  where every claim cites a file and line. Works on any language. Use when
  asked to map, diagram, visualize or explain a codebase's architecture, to
  show how a feature works end to end, or to onboard someone onto an
  unfamiliar system.
---

# Show me

Produce one self-contained HTML page: an isometric field of structures whose
geometry is measured from the code, connected by cited dependencies, with
traced flows that animate a payload along a real control path.

## How the work is split

**You read the code. Scripts do what reading cannot.**

That division is the whole design, and it is why this skill has no language
support to speak of — nothing here parses source. You are the parser. The
scripts only do the three things a careful reader reliably gets wrong:

| Script | Why it is not your job |
|---|---|
| `validate.mjs` | Opens every cited file and proves the evidence is there. Ninety citations is exactly the tedium a reader skims. It also reports **which files in scope no structure claims** — the blind spot you cannot see from inside, because skipping a subsystem feels identical to finishing. |
| `lib/metrics.mjs` | Counts files and lines. Building geometry is *measured*; the moment a size is estimated, the picture is decoration. |
| `render.mjs` (+ `lib/*`) | Turns the map into a deterministic scene whose edges provably never cross a footprint. Same input, same coordinates, every run. |

None of them knows what a language is. They match bytes, count lines and do
geometry, so a Python, Go, Rust or COBOL repository needs no configuration.

An earlier version of this skill also shipped a detector layer that extracted
relations with regexes. It was deleted. Every false relation it ever produced
came from a pattern misreading code, it needed a new pack per stack, and the one
genuinely valuable thing it did — telling you which files you had not accounted
for — turned out to be set subtraction over a file list, which needs no
detectors at all. **If you find yourself wanting to pattern-match structure out
of source, read it instead.**

## The pipeline

```
1. Pin the revision   -> a clean checkout of the target branch
2. Survey             -> what is in scope, and what the big pieces are
3. Aggregate          -> 12-24 structures, never one-per-file
4. Read and cite      -> relations and flows, every one with file:line:evidence
5. Validate           -> node scripts/validate.mjs   (hard gate + coverage)
6. Render             -> node scripts/render.mjs
7. Publish            -> Artifact, and hand over the URL
```

Read `references/schema.md` before writing any JSON — it is the contract.
Read `references/extraction.md` for how to find structure by reading, and how
to get citations without typing line numbers.
Read `references/visual-language.md` for what each shape and channel means.

## Two rules that are not negotiable

**Everything carries evidence.** Every node, edge and flow step needs a
`citation` of `{ file, line, evidence }`, where `evidence` is a literal
substring that really appears within a few lines of `line`. `validate.mjs`
opens the file and checks.

When validation fails, **fix the analysis, never the evidence string.** If you
genuinely cannot pin a real relationship to a line — dynamic dispatch, a
runtime-resolved token, a handler pulled from a registry — mark it
`"confidence": "inferred"` and it renders dashed and faded, with the legend
saying so. `inferred` is an honest answer; a fudged citation is not.

Note what the gate does *not* catch: it proves a cited line exists and says
what you quoted, not that you read it correctly. A misreading passes. That is
why interpretation stays with you and is never delegated to a pattern.

**Geometry is measured, never asserted.** A node declares `files` globs; the
renderer counts source files and lines and derives footprint, height and hatch
density. There is no field that makes a building bigger. Test files are found
by sibling discovery, so the untested marker reflects the repo rather than how
carefully you wrote a glob.

## Step 1 — pin the revision

A map is a claim about one revision. Analyze a **clean checkout of the target
branch**, never a dirty working tree, or the picture mixes shipped code with
someone's in-progress edits.

```bash
git fetch origin main --quiet
git worktree add -b map/<subject> /tmp/<repo>-map origin/main
git -C /tmp/<repo>-map rev-parse --short HEAD    # goes in meta.commit
```

Analyze inside that worktree and pass it as `--repo`. Remove it when done.

## Step 2 — survey before you read

Decide the region, then get its shape. `meta.scopeGlobs` is that region stated
as globs, and it is what makes coverage checkable rather than a claim.

Start with the manifest. It names the entry points, the jobs and the entire
external surface in one read, in every ecosystem:

```bash
cat package.json      # or pyproject.toml, go.mod, Gemfile, composer.json, pom.xml
```

Then find where the mass is. Use `find`, not a shell glob loop — an unquoted
glob over a deep tree aborts under zsh, and a one-level `*.*` pattern misses
everything in a nested framework:

```bash
find src -type f \( -name '*.ts' -o -name '*.py' -o -name '*.go' \) -not -path '*/node_modules/*' \
  | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -20
```

**Find the entry points the way this framework declares them.** There are two
conventions and the difference matters more than any other survey step:

- *Annotation frameworks* name entry points in the code — NestJS `@Controller`,
  Spring `@RestController`, Flask `@app.route`, Django `urlpatterns`. Grep for
  the annotation.
- *File-convention frameworks* name them by **path**: Next.js App Router
  `route.ts` and `page.tsx`, Remix `routes/`, SvelteKit `+page.server.ts`, Rails
  `app/controllers`. Grep finds nothing; `find` finds everything.

```bash
rg -l '@Controller|@RestController|@app\.route|urlpatterns'   # annotation style
find src/app -name 'route.ts' -o -name 'page.tsx' | wc -l     # convention style
```

Then the other anchors, adapting each pattern to what is actually in front of
you. These orient you; they do not extract a graph:

```bash
rg -n 'CREATE TABLE|^model |@Entity|pgTable|class .*\(.*Model'   # stores
rg -n 'new Worker|@Processor|@Cron|celery|sidekiq|pg-boss'       # async work
rg -n '@OnEvent|subscribe\(|EventBridge|SNS|Kafka'               # events
```

**Watch for a domain noun that collides with a framework word.** In a workforce
system `Worker` matches hundreds of files that have nothing to do with job
queues. If a pattern returns implausibly many hits, it is matching vocabulary,
not structure — narrow it before trusting it.

## Step 3 — aggregation is the hard part

**This is where most maps fail.** A feature with 160 files becomes ~20
buildings, so nearly every node is an aggregate of a directory or a role, not
a single file.

The budget scales with what you set out to cover, because a fixed number cannot
serve both a single feature and a whole system:

| Scope | Nodes | Districts |
|---|---|---|
| One feature or pipeline | 8-16 | 3-6 |
| A subsystem | 16-28 | 5-8 |
| A whole application | 24-40 | 6-10 |

Forty is the hard ceiling; the eye cannot hold sixty boxes, and a map nobody
reads has no value however accurate it is. **The test that overrides the numbers
is whether you can write two honest sentences about a node.** If hitting a
target means merging things you can no longer describe, the target is wrong and
the merge is worse — take the warning and go over.

Aggregate by **the role a group of files plays in the story you are telling**,
which is usually not the directory layout. Good nodes:

- one node per pipeline stage, even when a stage is nine files
- one node for "the renderers", when several formats share one front end
- one node per store, grouped by what the tables are *for*
- one node per external system, sized by the adapter code in *this* repo

Bad nodes: one per class; one per file; a "utils" node; anything you cannot
write two honest sentences about.

If you cannot get under 40, **the scope is too wide.** Narrow it, say so in
`meta.scope`, and offer the user a second map rather than one unreadable one.

**Or use chapters instead of shrinking.** A whole application shown all at once
is hard to parse however honest the aggregation is, and merging structures to hit
a number makes it worse. `chapters` reveals the system a few structures at a
time: the field is laid out once, so nothing moves, and each chapter lights up
what it introduces and frames it. That turns the node budget from a ceiling you
negotiate into a reading order you choose. See `references/schema.md`.

**Author the districts and the chapters as one partition.** Progressive
disclosure and spatial grouping want the same ordering — a chapter revealing
structures scattered across three districts forces the camera to frame the whole
field, so every chapter looks the same and the reveal reads as nothing.

## Step 4 — read, cite, trace

`references/extraction.md` has the recipes. The short version:

- **Never type a line number.** `rg -n 'exact text'` gives you file, line and
  the literal string in one step, in any language, and it cannot mistype.
- Evidence strength runs: injected dependencies and constructor parameters >
  imports > persistence calls > names that merely look related. The last is not
  evidence; grep for the other end before drawing an edge.
- A flow is an ordered, cited walk through one real operation. Each step cites
  its own line, steps must chain, and a side effect that does not advance the
  path is `"branch": true`.
- **Fewer verified flows beat many plausible ones.** If you confidently traced
  one, ship one. Do not pad to look thorough.
- **A flow crossing a network round-trip.** In a web application many flows span
  more than one request — issue a presigned URL, the browser uploads, a second
  request finalises. The chain rule models one call stack, so model the far side
  as `branch: true` from the structure that issued it and say in the note that
  control left the process. Do not silently draw it as one continuous call.
- **An external system may share its adapter file** with the domain node that
  owns it, and may declare no files at all. Ghosts are exempt from the
  no-overlap rule precisely so you never carve an adapter out of the node it
  belongs to just to satisfy the validator.
- **Write it in plain English.** The reader who most needs this picture is the
  one without the codebase's vocabulary — a new engineer, a lead deciding where
  to spend a quarter, someone tracing a complaint. An engineer reading plain
  language loses nothing; a non-specialist reading jargon loses everything. Name
  things in words rather than identifiers, keep sentences under twenty-five
  words, and put the class names in `howItsBuilt` where they belong.
  `validate.mjs` warns when reader-facing prose slips. See
  `references/extraction.md`.
- **A step's `note` is its timing, not its caption.** Playback dwells on each
  step for as long as its note takes to read, and the panel scrolls that note
  into view while the hop is lit. One clear sentence of fifteen to thirty words.

## Step 5-7 — validate, render, publish

```bash
# Before writing any prose: are the globs right?
node scripts/validate.mjs <map>.json --repo <worktree> --globs-only

node scripts/validate.mjs <map>.json --repo <worktree>
node scripts/render.mjs   <map>.json --repo <worktree> --out <out>.html
node scripts/twin.mjs     <map>.json --repo <worktree> --out SYSTEM.md
```

`--globs-only` checks file ownership, overlap and coverage while the grouping is
still cheap to change, and skips the citation and prose checks. Run it as soon
as you have a grouping and before you write a sentence.

`validate.mjs` exits non-zero on any error. Read the warnings too — the
readability target, orphan nodes, files claimed by two nodes, and above all
**scope coverage**: a cluster of unclaimed files sharing a directory prefix is
a subsystem you read past. That check has caught a missing subsystem in a map
whose author had already read the directory it lived in.

A map goes stale the moment the code moves and the gate will reject it.
`--relocate` repairs the mechanical part:

```bash
node scripts/validate.mjs <map>.json --repo <worktree> --relocate
```

The evidence string is the real anchor, so when it still exists in the cited
file the line moves and nothing about the claim changes. When the evidence has
gone, the code itself changed — go read the call site and cite what is there.

Two further checks guard the renderer rather than any one map, and are worth
running after changing anything under `scripts/lib/`:

```bash
node scripts/self-test.mjs    --repo <skill-repo>   # the citation gate
node scripts/layout-test.mjs  --repo <skill-repo>   # the layout invariants
```

**Note the argument.** Both run against the *shipped example maps*, so `--repo`
must point at a repository those examples were authored from — not at the repo
you are currently mapping. Pointed at your target they will skip every example
and check nothing, and say so. They test the renderer, not your map; there is no
way to assert the layout invariants against a map you just wrote, and the
guarantee is that the renderer upholds them for any valid map.

`layout-test.mjs` asserts that no edge enters a footprint, which is the only
reason the renderer can draw every line before every building and never
depth-sort. Do not weaken it to make a layout change pass.

The output is one fragment file — a `<title>`, inlined CSS and JS, pure ASCII —
so it survives whatever charset a host page declares. Publish it with the
Artifact tool and give the user the URL; a map that lives only in a local file
has not been delivered.

**Generate the twin as well.** `twin.mjs` writes the same map as a document, with
every citation inline. The picture is better for grasping shape; the text is
better for everything that happens afterwards — it greps, it diffs between two
commits, it can be reviewed in a pull request, and it works in a terminal. Both
come from one source file, so they cannot disagree. Offer the user both, and if
the repo has a docs directory, `SYSTEM.md` belongs in it while the map is
published as an Artifact.

## Report honestly

Tell the user what you could not verify: relationships marked `inferred`, the
parts of the scope you left out, and anything the warnings flagged. The value
of this artifact rests entirely on the reader being able to trust it, so a map
that quietly overstates its confidence is a worse deliverable than a smaller
one that does not.
