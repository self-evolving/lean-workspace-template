---
title: "Further sums"
type: "blueprint-chapter"
tags:
  - "blueprint"
---

Planned material: triangular numbers and the sum-of-cubes identity, which
reduces to [the sum of odd numbers](#thm:sumOdds-eq-sq).

## Definition: triangular {#def:triangular}

The $n$-th triangular number: $T(n) = \sum_{k=1}^{n} k$.

## Theorem: Gauss {#thm:gauss-sum uses="def:triangular"}

$T(n) = \dfrac{n(n+1)}{2}$.

### Proof {uses="def:triangular"}

Pair each $k$ with $n + 1 - k$; each of the $n$ pairs sums to $n + 1$.

## Theorem: Sum of the first cubes {#thm:sum-first-cubes uses="thm:sumOdds-eq-sq"}

$$\sum_{k=1}^{n} k^3 = \left(\frac{n(n+1)}{2}\right)^2.$$

### Proof {uses="thm:sumOdds-eq-sq"}

Each cube $k^3$ is the sum of $k$ consecutive odd numbers, so the left-hand
side is the sum of the first $T(n)$ odd numbers, which is $T(n)^2$ by
[the sum of odd numbers](#thm:sumOdds-eq-sq).
