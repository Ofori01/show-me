# Visual language

Every visual property is bound to a measured fact. If a reader asks "why is
that one taller?" the answer is always a number from the code, never taste.

## Projection

True 2:1 isometric. Grid cell `(gx, gy)` at elevation `z` floors:

```
sx = (gx - gy) * TILE
sy = (gx + gy) * TILE / 2 - z * FLOOR_H
```

`+gx` reads right-and-down, `+gy` reads left-and-down. Rank (dependency depth)
advances along `gx`, so **the map reads left to right: entry points at the left
tip of the diamond, storage and externals at the right.**

## Buildings

| Property        | Bound to                                  | Formula |
|-----------------|-------------------------------------------|---------|
| Footprint `w×d` | source file count                         | `w = clamp(1 + floor(files/6), 1, 4)`, `d = clamp(1 + floor(files/14), 1, 3)` |
| Height (floors) | non-test LOC, on a square-root scale      | `floors = clamp(round(3 * sqrt(loc / 40)), 2, 30)` |
| Shape           | `kind` (overridable)                      | see below |
| Fill intensity  | fan-in (how many nodes depend on it)      | denser hatch = more dependents |
| Untested badge  | `testFiles === 0` and `loc > 200`         | a hollow marker on the roof |

The height scale is a square root, not linear. Real modules span three orders of
magnitude of LOC, and a linear map flattens everything below the largest file
into an indistinguishable two-floor slab; the square root keeps the ordering
exact while making the middle of the range legible.

Heights are capped at 30 floors. When a node caps, the panel says so — a
silently flattened tower would hide the largest thing on the map.

These formulas live in `scripts/lib/geometry.mjs`. If you change them there,
change them here — a doc that misstates the measurement quietly undoes the one
promise the geometry makes.

## Shapes and what they read as

- **`tower`** — solid extrusion with floor striations. Code that runs: a
  service, a controller, a worker. Floors are literal LOC mass.
- **`slabs`** — discrete stacked plates with gaps. A *collection*: database
  tables, a record set, an archive. Plate count tracks the number of models.
- **`fan`** — thin sheets offset along `+gx`. A *buffer*: a queue, a topic, a
  batch. Sheets say "many of these, waiting".
- **`ghost`** — outline only, dashed, unfilled. Something **outside this
  repository**. Nothing inside a ghost was measured, and its blankness is the
  point: we cannot see in.
- **`pad`** — a wide, near-flat slab. A surface with breadth but no behaviour:
  DTOs, enums, constants, schemas.

## Districts

Each group occupies its own band of rows on a raised plinth, labelled at its
left edge, ordered top to bottom by the group's `order`. Buildings inside a
district are ordered by dependency rank.

Ranking globally instead is tempting -- it puts entry points at one end and
storage at the other -- but it scatters each group across the field and leaves
the sidebar as the only place group membership exists. The groups are how the
author chose to tell the story, so they get the space.

## Edges

Edges run at ground level and **only through reserved gutters**, never across a
footprint. That is a routing constraint, not a drawing trick: because a lane can
never cross a building, no edge is ever ambiguously in front of or behind one,
and the picture stays readable without depth-sorting the lines.

Lanes inside a corridor are spaced by how crowded that corridor turns out to
be, assigned in a second pass once demand is known. A fixed step per lane grows
without bound and a busy corridor then pushes its outer lanes straight through
the neighbouring building, breaking the invariant silently.
`scripts/layout-test.mjs` asserts it instead of trusting the argument.

Style carries `kind` (solid / dashed / dotted, thickness by read-vs-write) and
`confidence`: an `inferred` edge is always dashed and faded, whatever its kind,
and the legend says why.

## Flows

A flow lights its own path and sends a payload token along it. Branch steps
pulse to the side and return, because that is what a write or an audit record
actually does to control flow.

**A flow is read, not watched, and it is paced by reading time.** Pacing by
path length is what the geometry suggests and it is wrong: a short hop with a
long explanation flashes past while a long hop with three words crawls. Each
step gets a travel time from its path length (clamped, 0.7-1.9s) and then a
**dwell** computed from its own note at roughly 3.2 words per second
(1.5-4.4s), so the reader has time to finish the sentence before the token
moves on. A ten-step flow runs about a minute. That is the correct order of
magnitude for something whose job is comprehension; a reader who wants to go
faster has Trace one step, and one who wants to stop has Pause.

**The panel follows the token.** The step being animated is marked in the step
list and scrolled into view, its edge is drawn heavier than the rest of the lit
path, and its label is the only one showing. Without that, the animation is
decoration: the reader watches a dot move and reads nothing, because the
sentence explaining the hop is somewhere else on the page. The whole value of
the flow view is that the moving token and the sentence about it are on screen
together.

Two mechanics matter to anyone changing this. The current step is a distinct
state (`is-current`) from the rest of the flow's lit path (`is-active`), so the
path stays legible while one hop is emphasised. And the step highlight is
applied by mutating attributes in place rather than re-rendering the panel --
re-rendering would discard the reader's scroll position on every step.

## Colour

Monochrome plus one accent, in two themes: warm parchment for light, deep navy
for dark. Colour never encodes a category — that is what shape and line style
are for — so the map stays readable for colour-blind viewers and in print. The
accent marks exactly one thing at a time: the current selection or the active
flow.
