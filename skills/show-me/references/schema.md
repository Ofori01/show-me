# `system-map.json` contract (v1)

This file is the **only** interface between analysis and rendering. The agent
produces it; `scripts/render.mjs` consumes it and never asks a question about
intent. Everything the picture shows must be derivable from this document.

Two rules govern the whole schema:

1. **Nothing appears without a citation.** Every node, edge and flow step
   carries at least one `citation`. `validate.mjs` rejects the file otherwise.
2. **Geometry is computed, not declared.** You give a node its `files` globs;
   the renderer counts files and lines and derives footprint, floors and mass.
   There is no way to declare a building bigger than its code.

## Top level

```jsonc
{
  "schema": "system-map/v1",   // required, exact string
  "meta":   { ... },                     // required
  "groups": [ ... ],                     // required, >= 1
  "nodes":  [ ... ],                     // required, 6..40 (see budget below)
  "edges":  [ ... ],                     // required, may be empty
  "flows":  [ ... ]                      // optional
}
```

## `meta`

```jsonc
{
  "title":       "Controlled documents",         // 1-4 words, the subject
  "subtitle":    "how a document is imported, approved and released",
  "repository":  "orion-grc",                    // as the user names it
  "commit":      "721bcb7c",                     // SHA the analysis ran against
  "branch":      "main",
  "scope":       "backend/src/modules/grc/services/controlled-documents + ...",
  "overview":    "Markdown-free prose, 2-5 paragraphs, rendered into the
                  explainer panel as the default reading. Say what the system
                  is, what the loop is, and what the hard problem turned out
                  to be.",
  "readingHint": "One sentence on how to read the map.",

  // Optional. Where the interactive map is published. The text twin links to
  // it, so a reader who wants to click rather than read has somewhere to go.
  "mapUrl": "https://example.github.io/repo/",

  // The region you set out to map, as globs. Strongly recommended: it is what
  // makes coverage checkable instead of a claim. validate.mjs reports every
  // file inside it that no structure claims, which is the check that catches a
  // subsystem you read past.
  "scopeGlobs": ["src/feature/**/*.py", "migrations/*.sql"],

  // Optional, and required in spirit whenever you curated edges down. A map
  // that quietly dropped connections reads as complete when it is not.
  "omitted": {
    "edges": 34,
    "note": "Utility and type-only imports below two references, dropped for
             readability. Run harvest.mjs to see the full set."
  }
}
```

`commit` is not decoration. The map is a claim about one revision, and the
header prints it so a stale map is visibly stale.

## `groups`

Groups are editorial: they are how you tell the reader which buildings belong
to the same story. Each one becomes a **district** -- its own band of rows on
the field, sitting on a raised plinth with the group's label beside it -- so
grouping is a spatial decision, not just a sidebar heading.

```jsonc
{ "id": "entry", "label": "ENTRY AND CONTROL", "order": 1 }
```

`order` sets the top-to-bottom order of the districts, so it should follow the
story you want read first to last. Dependency rank orders the buildings
*within* a district.

Aim for one district per chapter of the story: 3-6 for a feature, up to 10 for a
whole application. A group holding one node gets a whole band to itself, which is
usually a sign the grouping is wrong.

## `nodes`

```jsonc
{
  "id":    "CDR",                       // 1-3 uppercase chars, unique. Printed on the building.
  "label": "Release generation",        // 1-4 words
  "group": "loop",                      // must match a groups[].id
  "kind":  "service",                   // see kinds table
  "files": [                            // >= 1 glob, relative to repo root
    "backend/src/modules/grc/services/controlled-documents/rendering/controlled-document-release*.ts"
  ],
  "whatItDoes":  "Plain English for a reader who does not know the codebase and
                  does not have its vocabulary. No class names, no filenames, no
                  framework nouns. Say what it is for. 2-5 sentences, each under
                  25 words. The validator warns when this slips.",
  "howItsBuilt": "Implementation register: classes, libraries, the actual
                  mechanism. Type names welcome here. 2-5 sentences.",
  "concerns":    ["Optional. Each string is one known defect or smell."],
  "citations":   [ Citation, ... ],     // >= 1
  "confidence":  "verified"             // "verified" | "inferred"
}
```

### `kind` — drives default shape and legend entry

| `kind`     | Means                                        | Default shape |
|------------|----------------------------------------------|---------------|
| `entry`    | HTTP surface, CLI, controller, route handler | `tower`       |
| `service`  | Business logic that other code calls         | `tower`       |
| `store`    | Database, table group, persistent record set | `slabs`       |
| `queue`    | Job queue, topic, buffered batch             | `fan`         |
| `worker`   | Consumer, processor, listener                | `tower`       |
| `external` | Third-party system outside the repo          | `ghost`       |
| `config`   | Constants, enums, schemas, DTO-only surface  | `pad`         |
| `ui`       | Client-side view or state surface            | `tower`       |

Set `shape` explicitly only to override the default; see
`visual-language.md` for what each shape reads as.

### Node budget

**6 minimum, 40 maximum**, with the target scaled to scope — 8-16 for one
feature, 16-28 for a subsystem, 24-40 for a whole application.

An `external` node is exempt from two rules that apply to everything else: its
`files` may resolve to nothing (a ghost stands for a system outside this repo),
and the files it does claim may overlap another node's. Adapter code genuinely
serves both the domain that calls it and the system it reaches, and forcing a
choice shapes node boundaries around the validator instead of the story. This is the hardest
constraint in the skill and the one that decides whether the map is useful.
A directory with 160 files becomes ~20 buildings, so most nodes are
*aggregates* of a directory or a role, not single files. If you cannot get
under 40, your scope is too wide — narrow it and say so in `meta.scope`.

## `edges`

```jsonc
{
  "from": "CDA",                 // nodes[].id
  "to":   "CDS",
  "kind": "call",                // see kinds table
  "label": "createDraft()",      // optional, <= 24 chars; see below
  "weight": 3,                   // optional: source references behind this edge
  "citation": Citation,          // required, singular
  "confidence": "verified"
}
```

`weight` is optional and says how many places in the source back this one
connection. It is shown in the Connections panel, and it is the honest way to
say "these two things touch in nineteen places" when the map draws one line.

| `kind`    | Means                                    | Line style     |
|-----------|------------------------------------------|----------------|
| `call`    | Direct invocation / DI dependency        | solid          |
| `read`    | Reads persistent state                   | solid, thin    |
| `write`   | Writes persistent state                  | solid, thick   |
| `emit`    | Publishes an event or enqueues a job     | solid + arrow  |
| `consume` | Subscribes to / processes                | solid + arrow  |
| `http`    | Network call leaving the process         | dashed         |
| `import`  | Type/constant dependency only            | dotted, faint  |

`label` is drawn on the map beside the edge, but only while that edge is
highlighted -- every label on screen at once buries the field in text. It also
appears in the selected node's **Connections** panel, which lists every edge in
and out with its citation, so an edge's evidence is reachable without hunting.

`confidence: "inferred"` renders any edge dashed-and-faded regardless of
kind, and the legend says so. Use it when the relationship is real but you
could not pin it to one line — dynamic dispatch, a name-matched event, a
DI token resolved at runtime.

## `flows`

An ordered, cited walk through one real operation. Flows drive the animated
payload view and the step-by-step tracer.

```jsonc
{
  "id":      "release",
  "label":   "Release generation",       // shown in the flow selector
  "summary": "Approval completes -> job enqueued -> worker renders PDF ->
              artifact stored -> release published.",
  "payload": "ControlledDocumentReleaseJob",   // the thing in motion
  "trigger": "An approver casts the final approval",
  "steps": [
    {
      "from": "CDA",
      "to":   "CDQ",
      "note": "Enqueues the render job on the release queue.",
      "citation": Citation
    },
    {
      "from":   "CDQ",
      "to":     "DB",
      "branch": true,                      // side effect; does not advance the path
      "note":   "Marks the release row GENERATING before handing off.",
      "citation": Citation
    }
  ]
}
```

Rules that keep flows honest:

- **Each step needs its own citation.** A flow is a sequence of claims about
  call order; each one is checkable or it does not ship.
- **Consecutive steps must chain.** `steps[n].to` must equal
  `steps[n+1].from`. The validator enforces this — a flow that teleports is
  a flow you did not actually trace.
- **`branch: true` marks a side effect.** Real control flow writes to a store,
  emits an audit record or fires a notification without leaving the main path.
  A branch step must start at the current position and does **not** advance it,
  so the next step continues from where the branch began. Use it for writes,
  audit trails and fan-out notifications; do not use it to paper over a gap you
  could not trace.
- **Every step's `from`/`to` pair should exist in `edges`.** The validator
  warns when it does not, because a flow traversing a connection the
  topology does not show means one of the two is wrong.
- **2-6 flows, 3-12 steps each** (branch steps included in the count). Fewer,
  verified flows beat many plausible ones. If you only confidently traced one,
  ship one.
- **`note` sets the pace.** Playback holds each step for as long as its note
  takes to read, so a note is not a caption you can pad -- it is the timing.
  Write one clear sentence saying what happens at this hop and why it matters.
  Fifteen to thirty words is the sweet spot; past about forty the dwell hits
  its ceiling and the reader gets cut off mid-sentence.

## `chapters`

Optional, and the answer to a system too big to show at once. The field is laid
out **once, for the whole map**; a chapter changes only what is visible and
where the camera sits, so a structure never moves and the reader keeps one
mental model and adds to it.

```jsonc
{
  "id":      "gate",
  "title":   "The claim has to hold",
  "lede":    "One sentence. Shown above the story.",
  "story":   "Two or three sentences on what this chapter is about.",
  "reveals": ["VAL", "GT"],        // structures introduced here
  "flow":    "gate"                // optional, and see the rule below
}
```

Rules:

- **Every structure is revealed by exactly one chapter.** The validator rejects
  a map where anything is never revealed, or revealed twice.
- **1-4 reveals per chapter.** More than four stops being a chapter.
- **A chapter's `flow` may only touch structures already revealed** by it or an
  earlier chapter. The validator checks. If a flow does not fit anywhere, leave
  it off — it is still available in the final chapter's picker.
- **The last chapter may reveal nothing.** Its job is the whole system at once,
  with the flow picker enabled.

**Make chapters match districts.** This is the one piece of advice that changes
the result: progressive disclosure and spatial grouping want the same ordering.
A chapter that reveals four structures scattered across three districts forces
the camera to frame the entire field, so every chapter looks identical and the
zoom does nothing. When each chapter reveals one district, the camera walks
down the field a band at a time and the reveal reads as movement. Author the
groups and the chapters together, as one partition.

## `Citation`

```jsonc
{
  "file":     "backend/src/.../controlled-document-release.service.ts",
  "line":     84,
  "evidence": "await this.releaseQueue.add("
}
```

- `file` — repo-root-relative, must exist.
- `line` — 1-indexed.
- `evidence` — a **literal substring of that file**, near that line. The
  validator reads the file and searches a window of +/- `EVIDENCE_WINDOW`
  lines (default 4) for this exact substring. If it is not there, validation
  fails and the map does not render.

Keep `evidence` short and distinctive: a decorator, a method signature, a
queue name, an `await` expression. Do not paste whole lines with trailing
whitespace, and do not invent a paraphrase — it must be characters that are
actually in the file.

This is the anti-fabrication mechanism. Asserting a relationship that does
not exist requires guessing a string that does exist at a line you named,
which the gate catches. Treat a validation failure as a finding about your
analysis, never as a reason to soften `evidence` until it passes.
