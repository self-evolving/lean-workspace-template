/-! # Sums of odd numbers

The classic identity $1 + 3 + \cdots + (2n-1) = n^2$, formalized from scratch.
Everything in this chapter is done except [one open lemma](#lemma:sumOdds-pos),
which is left as a starter task.

## Definition: sumOdds {#def:sumOdds lean=next}

The sum of the first $n$ odd numbers:
$$S(n) = \sum_{k=1}^{n} (2k - 1),$$
defined by recursion: $S(0) = 0$ and $S(n+1) = S(n) + (2n + 1)$.
-/

namespace Demo

/-- Sum of the first `n` odd numbers: `1 + 3 + ⋯ + (2n − 1)`. -/
def sumOdds : Nat → Nat
  | 0 => 0
  | n + 1 => sumOdds n + (2 * n + 1)

/-! ## Lemma: sumOdds-succ {#lemma:sumOdds-succ lean=next}

For every $n$, $S(n+1) = S(n) + (2n + 1)$.

### Proof

Immediate from the recursive definition (it holds by `rfl`).
-/

/-- Unfolding lemma: adding the `(n+1)`-st odd number. -/
theorem sumOdds_succ (n : Nat) : sumOdds (n + 1) = sumOdds n + (2 * n + 1) := rfl

/-! ## Theorem: Sum of odd numbers {#thm:sumOdds-eq-sq lean=next}

The sum of the first $n$ odd numbers is a perfect square:
$$S(n) = n^2.$$

### Proof

Induction on $n$. The base case is trivial. For the step, using the induction
hypothesis and [the unfolding lemma](#lemma:sumOdds-succ):
$$S(n+1) = S(n) + (2n+1) = n^2 + 2n + 1 = (n+1)^2.$$
-/

/-- The sum of the first `n` odd numbers is `n²`. -/
theorem sumOdds_eq_sq (n : Nat) : sumOdds n = n * n := by
  induction n with
  | zero => rfl
  | succ n ih =>
    rw [sumOdds_succ, ih]
    simp only [Nat.add_mul, Nat.mul_add, Nat.mul_one, Nat.one_mul]
    omega

/-! ## Lemma: sumOdds-pos {#lemma:sumOdds-pos lean=next}

For every $n$, $S(n+1) > 0$.

### Proof {uses="lemma:sumOdds-succ"}

$S(n+1) = S(n) + (2n+1) \ge 2n + 1 > 0$. (The Lean proof is an open starter
task: the declaration below contains a `sorry` — which is also why this Proof
heading declares its dependency explicitly: a sorry'd proof has no term to
infer `uses` from.)
-/

/-- The sum of the first `n + 1` odd numbers is positive. Open starter task. -/
theorem sumOdds_pos (n : Nat) : 0 < sumOdds (n + 1) := by
  sorry

end Demo
