# Walkthrough — Speaker Notes

Section headers mirror the slide outline in [design.md §12](./design.md).

## 1. Problem & rubric

> "a coverage report nobody acts on, or a test generator with no model behind it,
> both miss what we're evaluating." — that's the rubric.

## 2. Coverage vocabulary

The `(Surface, Precondition, Behavior)` decomposition. The most important slide.

## 3. Why MockClient is an axis

Promoting it from fixture detail to a coverage dimension is how I respond to
the brief's signal.

## 4. Architecture

Four-module diagram from §4. Discovery, scoring, closing, looping.

## 5. Single-shot demo

Live or recorded `harness close --gap unit-X --verify`.

## 6. Autonomous demo

Live or recorded `harness loop --until p0-gaps==0 --verify`. Show the iteration
log + final report. This is what proves the loop is real.

## 7. Guardrails

Walk §5.3. Iteration cap, budget cap, failure cap, quality-decay detection.

## 8. The delta report

Show the actual report file: before, generated test, after, verify result, what
stopped the loop and why.

## 9. Limitations

Walk §11. *"These are the questions I'd ask if I were grading this."*

## 10. What I'd do with another day

Healthcare-specific behaviors, retry-with-feedback per gap, mutation testing
oracle, Playwright matcher, adaptive priority.
