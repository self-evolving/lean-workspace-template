---
title: "Writing your first proof"
description: "Prove the demo's one open lemma and watch its node turn green."
---

> [!note] Setup first
> This walkthrough assumes the [local setup](../quick-start#locally) is
> running — `lake build` succeeded and `npm run dev` is serving
> `http://localhost:8080`.

The demo ships with exactly one open task, kept deliberately small:
[Lemma 1.4 · sumOdds-pos](../../blueprint/ch01_sumsofoddnumbers#lemmasumodds-pos)
says the sum of the first $n+1$ odd numbers is positive, and its declaration
still contains a `sorry`. You can spot it on the
[dependency canvas](../../blueprint/dep-graph.canvas) — the one amber
"in progress" card in a green neighborhood.

## Prove the lemma

Open `content/blueprint/Ch01_SumsOfOddNumbers.lean` — the
[chapter page](../../blueprint/ch01_sumsofoddnumbers) shows the same source
inline — and replace the `sorry`:

```lean
theorem sumOdds_pos (n : Nat) : 0 < sumOdds (n + 1) := by
  simp [sumOdds_succ]
```

## Let the kernel judge

Statuses are never hand-maintained — they are recomputed from the compiled
environment:

```bash
lake build && npm run blueprint:sync
```

Reload the page: Lemma 1.4 turns green, and so does everything that was only
waiting on it. In CI the same thing happens automatically — a PR that proves
a lemma shows its node changing status in its own diff, and on the PR's
[live preview](../features/per-branch-preview).

## Or hand it to the agent

The same task works without a clone. Open an issue — or the
[Sepo drawer](../features/sepo-agent-drawer) on any page — and write
`@sepo-agent /implement prove sumOdds_pos in Ch01_SumsOfOddNumbers.lean`.
The agent opens a pull request, and you review the result on its preview.

## Steal from the demo chapters

Both chapters are small on purpose; read them next to their source when
writing your own:

- [Sums of odd numbers](../../blueprint/ch01_sumsofoddnumbers) — a literate
  Lean chapter: real declarations interleaved with prose in
  `Ch01_SumsOfOddNumbers.lean`.
- [Further sums](../../blueprint/02-further-sums) — a plan-stage markdown
  chapter: no Lean yet, intent declared with `uses=`.

When you are ready to add a chapter of your own, continue with
[the two proof-writing styles](../writing-proofs/two-styles-of-proving) and
the [chapter grammar](../../documentation/grammar).
