# Demo Script — Medplum Coverage Harness
# 15-minute walkthrough: ~10 min slides + ~5 min live terminal

## BEFORE YOU START

Pre-flight checklist (do this the night before):
  [ ] medplum repo cloned at ../medplum
  [ ] npm ci && npm run build done in this repo
  [ ] npm test passes (139 tests across 10 files)
  [ ] Terminal font size bumped to 18+
  [ ] Split terminal: left = commands, right = file tree (or VS Code)
  [ ] Close Slack, notifications

If claude CLI is NOT installed → use the pre-recorded close/loop sections below.
If claude CLI IS installed → run live.

---

## SLIDE 1 — Problem & Rubric (1 min)
# Just talk. Quote the brief. No terminal.

---

## SLIDE 2 — Coverage Vocabulary (2 min)
# Just talk. Draw the triple on a whiteboard or point at the slide.

---

## SLIDE 3 — Why MockClient Is an Axis (1 min)
# Just talk. Point at the auto-discovery section of the slide.

---

## SLIDE 4 — Architecture (1 min)
# Just talk. Walk the diagram top-to-bottom.

---

## SLIDE 5 — Live: harness scan (2 min)
# Switch to terminal. This works RIGHT NOW (no claude CLI needed).

cd /home/ali/projects/medplum-coverage-harness

# Show the config first
cat harness.config.json
# Expected: { "target": "../medplum", "scope": ["packages/app/src"] }

# Run the scan
./bin/run.js scan
# Takes ~5-10 seconds. Shows:
#   Surfaces: 69
#   Units: 556
#   P0 gaps: 40
#   etc.

# Show the generated report
cat reports/$(ls -t reports/ | grep "^scan" | head -1)
# Or open it in VS Code: code reports/scan-latest.md

# KEY TALKING POINT:
# "556 units — that's every (page, mock-state, behavior) combination
#  the app needs tested. 511 are gaps. That's the baseline we attack."

---

## SLIDE 6 — Live or Recorded: harness close (2 min)

### OPTION A — Live (if claude CLI is installed)

cd /home/ali/projects/medplum-coverage-harness

# Show the gap we're going to close
./bin/run.js close \
  --gap unit.signin.unauthed.form-validation-error \
  --verify

# While it runs, narrate:
# "Claude gets a prompt telling it: page=/signin, setup=unauthenticated,
#  assert=validation error. It can ONLY use the Write tool. A bash hook
#  rejects any write to the wrong path before it happens."

# After it finishes, show the generated file:
cat ../medplum/packages/app/src/SignInPage.beh.form-validation-error.test.tsx

# Show the close report:
cat reports/$(ls -t reports/ | grep "^close" | head -1)

# KEY TALKING POINT:
# "The test doesn't need to pass on first try. It needs to compile,
#  set up MockClient correctly, and assert the right thing. That's enough
#  to move the unit from GAP to COVERED in the next scan."

### OPTION B — Pre-recorded (if claude CLI is NOT installed)

# Record this in advance using:
#   asciinema rec demo-close.cast
#   ./bin/run.js close --gap unit.signin.unauthed.form-validation-error
#   asciinema play demo-close.cast

# Or just show the slide + the pre-written example test file.
# Walk through what a generated test would look like — point at
# agent-context/.claude/CLAUDE.md to show what Claude is told.

---

## SLIDE 7 — Agent Constraints (30 sec)
# Show the two files. No commands needed.

cat agent-context/.claude/settings.json
# Expected: allow: ["Write"], deny: [Bash, Edit, WebFetch, ...]

cat agent-context/.claude/hooks/pre-write-fence.sh
# Expected: checks $EXPECTED_TEST_FILE env var, rejects mismatches

# KEY TALKING POINT:
# "This is not prompt engineering. The rejection happens at the OS level,
#  before Claude's write executes. It cannot be talked past."

---

## SLIDE 8 — Autonomous Loop (1 min)

### OPTION A — Live (if claude CLI is installed)

./bin/run.js loop \
  --until delta-stalled \
  --iterations 5 \
  --budget 10 \
  --verify

# Watch iterations tick. Show the loop report after it stops.
cat reports/$(ls -t reports/ | grep "^loop" | head -1)

### OPTION B — Explain the stopping conditions instead

# Show the stopping-conditions code
cat src/loop/stopping-conditions.ts | head -60

# KEY TALKING POINT:
# "Four guardrails are always on. They fire before user goals are checked.
#  You cannot run this unbounded — even with --until coverage>=100%,
#  the iteration cap saves you."

# Show what the loop report looks like (the format):
cat reports/$(ls -t reports/ | grep "^scan" | head -1)
# (use a scan report as a proxy if no loop report exists)

---

## SLIDE 9 — Limitations (1 min)
# Just talk. Lead with: "These are the questions I'd ask if I were grading this."
# The table on the slide is your script.

---

## SLIDE 10 — What I'd Do With Another Day (30 sec)
# Brief. Don't go deep. Leave time for Q&A.

---

## Q&A PREP — Questions they will ask

Q: "Why not just use jest --coverage?"
A: "jest --coverage tells you which lines ran. It doesn't tell you which
    user scenarios were tested, what auth state the app was in, or whether
    the test actually asserted anything meaningful. A test that calls
    render() and asserts nothing gets 100% line coverage. Our model
    wouldn't count that as COVERED."

Q: "What happens if Claude generates a test that passes trivially?"
A: "That's the mutation oracle gap I called out in limitations. Right now,
    a test with expect(true).toBe(true) looks COVERED to us. The fix is
    mutation testing — inject a fault, check the test catches it.
    That's design doc §11.3. I didn't build it yet, but the slot is there."

Q: "How does the harness stay in sync when the app changes?"
A: "Two ways. First, surfaces are re-discovered from AppRoutes.tsx on every
    scan — new routes automatically appear. Second, the precondition catalog
    walks existing test files on every scan and auto-synthesizes new entries
    when it sees MockClient patterns it hasn't seen before. The catalog
    literally learns from the codebase."

Q: "What's PARTIAL status?"
A: "PARTIAL means the test file's name matches a surface component, but we
    couldn't confidently identify which precondition it exercises — usually
    because it uses bare new MockClient() with no profile hint. We could
    call it COVERED and look better on paper, but honest > generous. A PARTIAL
    doesn't count toward the gap closure metric, but it doesn't get re-generated
    either — a human should look at it."

Q: "How does the path fence work exactly?"
A: "Claude has a PreToolUse hook wired to a bash script. Before any Write
    call executes, the hook reads the file_path from the tool input JSON and
    compares it to the EXPECTED_TEST_FILE environment variable we set before
    spawning Claude. If they don't match, the hook exits with code 2 — Claude
    sees a rejection and cannot retry. It's enforced at the child process
    level, not in the prompt."

Q: "Why oclif instead of a simpler CLI library?"
A: "oclif gives us typed flags, --help generation, and plugin architecture
    for free. The commands are already structured to be extended — if you
    wanted to add harness report or harness ignore, you'd just add a file
    to src/commands/. The flag definitions are self-documenting."

Q: "What's the delta metric?"
A: "After every close, we re-scan and count: how many units moved from GAP
    to COVERED vs the manifest before the agent ran. That number is the delta.
    It's the only metric that matters — not absolute coverage %, because
    systematic matcher errors cancel out across before/after."

---

## TIMING GUIDE

Slide 1  — Problem         1:00
Slide 2  — Vocabulary      2:00
Slide 3  — MockClient      1:00
Slide 4  — Architecture    1:00
Slide 5  — Scan demo       2:00  ← LIVE TERMINAL
Slide 6  — Close demo      2:00  ← LIVE or RECORDED
Slide 7  — Constraints     0:30
Slide 8  — Loop            1:00  ← LIVE or RECORDED
Slide 9  — Limitations     1:00
Slide 10 — Next steps      0:30
                          ------
Total                     12:00

Q&A buffer                 3:00
                          ------
Hard stop                 15:00
