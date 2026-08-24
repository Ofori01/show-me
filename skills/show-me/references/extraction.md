# Finding structure by reading

You are the parser. Nothing in this skill extracts relations from source, and
that is deliberate: patterns that try produce relations that do not exist, and
they do it *with a real citation attached*, because the line they point at is
real. The gate catches fabricated evidence, never misread evidence. Only reading
catches a misreading.

What follows is how to read efficiently, and how to get citations without ever
typing a line number.

## Never type a line number

```bash
rg -n --no-heading 'await this.queue.enqueue' src/
# src/thing/release.service.ts:53:    await this.queue.enqueue({
```

That gives you the file, the line and the literal text in one step. Copy the
text as `evidence` verbatim. This works in any language, cannot mistype, and is
the reason hand-authored citations are cheap rather than laborious.

Two habits worth keeping:

- Quote something **distinctive and short** — a decorator, a method signature, a
  queue name, an `await` expression. Not a whole line with trailing whitespace.
- Quote the line that *states the relationship*, not a line near it. A citation
  is an argument, and the reader should see the claim in the quoted text.

## Evidence, strongest first

**1. Injected dependencies and constructor parameters.** Where a language has
them, the parameter list *is* the dependency graph, stated once, one citable
line per dependency.

```bash
rg -n -A 20 'constructor\(' path/to/thing.service.ts
rg -n -A 12 'def __init__\(self' path/to/thing.py
```

A ten-parameter constructor is itself a finding — put it in `concerns`.

**2. Imports.** A direct import of something that is then invoked is a `call`;
an import of only types, enums or constants is `import` and should stay faint.
Search for what a directory pulls in from its siblings:

```bash
rg -n "^(import|from) .*sibling-name" path/to/dir/
```

**3. Persistence calls.** Cite the call, not the model definition:

```bash
rg -n '\.objects\.(create|filter)|prisma\.\w+\.(create|findMany)|db\.(insert|select)|INSERT INTO'
```

Writes and reads are different edge kinds and worth separating.

**4. Names that merely look related.** Not evidence. If an event is emitted,
**grep for the subscriber** before drawing an edge; if nothing subscribes, that
is a finding, not a connection.

## Crossing an async boundary

This is the part most worth doing carefully, because a queue or event bus is
where a system's real shape hides — and where every automated attempt to guess
went wrong. Both codebases this skill was built against wrap their queue library
in their own service under different names, so the library's own method names
never appear where a job is actually enqueued.

Work from the **name**, which both ends must share:

```bash
rg -n "'my-queue-name'"                  # the literal, wherever it appears
rg -n 'QUEUE_NAME_CONSTANT'              # the constant, producer and consumer
rg -n 'new Worker|@Processor|celery.task|sidekiq_options|registerProcessor'
```

Cite the producer and the consumer as **separate flow steps**. If you cannot
find the consumer, say so rather than assuming one exists.

## Anything dynamic

A handler pulled from a registry, a token resolved by string, a dynamic import:
real, but not pinnable to one line. Mark the edge `"confidence": "inferred"` and
cite the closest honest line — the registry entry or the token declaration. It
renders dashed and the legend explains why.

## Measuring instead of asserting

Never estimate a size. Point the glob at the files and let the renderer count.
Check what a glob actually resolved to before trusting it:

```bash
# Run from the skill directory; REPO is the worktree you are mapping.
REPO=/path/to/worktree node -e "import('./scripts/lib/metrics.mjs').then(m => {
  const root = process.env.REPO
  const r = m.expandGlobs(root, ['src/thing/**/*.py'])
  console.log(r.files.length, r.unmatched, m.fileMetrics(root, r.files))
})"
```

Two glob mistakes to avoid:

- **Overlap.** Two nodes matching the same file double-counts its mass. The
  validator warns; give each source file one owner.
- **Over-reach.** `**/*` under a shared directory quietly swallows unrelated
  code and inflates the building. Prefer explicit prefixes.

You do not need to glob test files — siblings are discovered automatically, and
the conventions covered include `foo.spec.ts`, `foo_test.go`, `test_foo.py`,
`foo_spec.rb`, `FooTest.java` and `FooTests.cs`.

## Let the coverage check find what you skipped

Declare the region you set out to map as `meta.scopeGlobs`, and `validate.mjs`
reports every file inside it that no structure claims, grouped by directory.

**Use this, do not skip it.** Reading a directory, feeling finished and moving
on is the normal failure, and it is invisible from the inside — an author who
skipped a subsystem has no sensation of having skipped one. On this skill's own
example map that check surfaced twenty-two files and about 3,900 lines of
signature-of-record machinery in a directory the author had already read.

A handful of unclaimed files is ordinary: fixtures, barrels, generated code. A
**cluster** sharing a directory prefix is a subsystem you read past. Claim it,
or narrow `scopeGlobs` and say in `meta.scope` what you left out.

## Writing the prose

**Write for the person who has to make a decision about this system, not for
the person who built it.** That reader is often a new engineer, a lead choosing
where to spend a quarter, someone in support tracing a complaint, or an auditor.
They are perfectly capable; they just do not have the vocabulary of this
codebase, and prose that assumes it excludes exactly the reader who most needed
a picture. An engineer reading plain language loses nothing. A non-specialist
reading jargon loses everything.

Two registers, and keeping them apart is what makes the panel worth reading:

- **`whatItDoes`** — plain English. No class names, no filenames, no framework
  nouns. Say what it is *for*, and say what it is *not* responsible for when
  that is the surprising part. This is the sentence someone quotes in a meeting.
- **`howItsBuilt`** — for someone about to change it. Name the real classes,
  libraries and mechanisms here. Still explain a term the first time rather
  than assuming it.

`validate.mjs` warns when reader-facing prose contains a code identifier, uses
a term with a plainer alternative, or runs a sentence past thirty words. They
are warnings, not errors — sometimes a term genuinely is the clearest word —
but read them, because each one is a place a reader would stall.

### Six rules, with the fix

**Name things in words, not identifiers.** A reader cannot say `ControlledDocumentReleaseQueueService` out loud.

> ✗ `ControlledDocumentReleaseQueueService` wraps `QueueService` to add jobs to `grc-controlled-document-release`.
> ✓ Holds the work of building a released document until a separate process is ready to pick it up.

**Say what it is for, not what it is made of.** The parts belong in the other register.

> ✗ A Prisma-backed repository exposing CRUD operations over the document aggregate.
> ✓ The document as a thing: creating one, finding one, and cutting a new version of it.

**Prefer the concrete to the categorical.** Categories describe; examples explain.

> ✗ Handles authorization concerns via a policy abstraction.
> ✓ Decides who is allowed to approve a document, and how strongly they have to prove it is them.

**One idea per sentence, under twenty-five words.** Long sentences are usually two ideas that have not been separated yet.

**Explain the surprise.** The most valuable sentence is often what a thing does *not* do.

> ✓ Publishing does not produce the released file. It only announces that publishing happened; everything after that runs later.

**Skip words that carry no weight.** "Essentially", "leverages", "robust",
"seamlessly", "utilise". If deleting a word changes nothing, it was noise.

### The same applies to chapters and flows

A chapter's `lede` and `story` and a flow step's `note` are read by the same
person, out loud, in order. A `note` is also the timing for playback, so it has
to be one clear sentence anyway.

> ✗ The processor dequeues the job and invokes the generation service with the release identifier.
> ✓ A separate process picks the job up, possibly minutes later, and starts building the document.

`concerns` is where the map earns trust: real defects you saw while reading — a
swallowed error, a constructor with twelve dependencies, a hardcoded value, an
announcement nobody waits for. Only things you actually observed, and say why it
matters in plain words rather than naming the smell.
