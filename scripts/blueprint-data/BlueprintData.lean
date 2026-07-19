import Lean

/-!
# Blueprint extractor

Emits kernel-truth data about the project's declarations as JSON:

- `usedConstants` — the *real* dependency edges (which project declarations each
  proof/definition actually references, with compiler-generated auxiliaries
  collapsed onto their parent declaration);
- `axioms` — the axioms each declaration transitively relies on; `sorryAx`
  present ⇔ the proof contains a `sorry` (`hasSorry`).

The blueprint model (`scripts/lib/blueprint-model.mjs`) merges this with the
chapter sources in `content/blueprint/` so node statuses on the dependency
canvas are computed, not hand-declared.

Usage: `lake exe blueprint-data [outPath] <rootModule> [rootModule...] [--decls=<file>]`
Default outPath: `content/blueprint/blueprint-data.json`. Root modules are
required — pass the values from `blueprint.config.json` `lakeRoots` (CI does
this automatically).

`--decls=<file>` names extra declarations (one per line) to resolve from the
compiled environment even though they live outside the root modules — chapters
routinely reference theory upstreamed to mathlib (leanblueprint's `\mathlibok`)
or code in a dependency package, and those items would otherwise never receive
a kernel status. `scripts/blueprint-data.mjs` collects the chapters' `lean=`
names into this file automatically. Entries resolved this way carry
`"origin": "external"`.
-/

open Lean

def kindOf : ConstantInfo → String
  | .thmInfo _ => "theorem"
  | .defnInfo _ => "def"
  | .axiomInfo _ => "axiom"
  | .opaqueInfo _ => "opaque"
  | .inductInfo _ => "inductive"
  | .ctorInfo _ => "constructor"
  | .recInfo _ => "recursor"
  | .quotInfo _ => "quotient"

def isInProjectModule (env : Environment) (roots : List Name) (n : Name) : Bool :=
  match env.getModuleIdxFor? n with
  | some idx =>
    match env.header.moduleNames[idx.toNat]? with
    | some modName => roots.any (·.isPrefixOf modName)
    | none => false
  | none => false

/-- Source path of the module that declares `n`, relative to the Lake root
(e.g. `Demo/Sums.lean`). -/
def moduleFileOf (env : Environment) (n : Name) : Option String := do
  let idx ← env.getModuleIdxFor? n
  let modName ← env.header.moduleNames[idx.toNat]?
  return (modName.components.map Name.toString).foldl
    (fun acc c => if acc.isEmpty then c else acc ++ "/" ++ c) "" ++ ".lean"

/-- Generated-name suffixes we never surface as blueprint nodes. -/
def isGeneratedSuffix (s : String) : Bool :=
  s.startsWith "eq_" || s.startsWith "match_" || s.startsWith "proof_" ||
  s.startsWith "_" || s == "sizeOf_spec" || s.startsWith "injEq" ||
  s.startsWith "noConfusion" || s.startsWith "rec" || s.startsWith "casesOn" ||
  s.startsWith "brecOn" || s.startsWith "below" || s.startsWith "ibelow" ||
  s.startsWith "ndrec"

/-- A declaration we surface: lives in a project module, user-visible kind,
not compiler-internal or generated. -/
def isPublicDecl (env : Environment) (roots : List Name) (n : Name) (ci : ConstantInfo) : Bool :=
  isInProjectModule env roots n &&
  !n.isInternal &&
  (match ci with
   | .thmInfo _ | .defnInfo _ | .inductInfo _ | .axiomInfo _ | .opaqueInfo _ => true
   | _ => false) &&
  (match n with
   | .str _ s => !isGeneratedSuffix s
   | _ => true)

/-- Collapse a project-internal name (e.g. `Demo.foo.match_1`) onto the nearest
enclosing public declaration (`Demo.foo`). -/
partial def publicAncestor (env : Environment) (roots : List Name) (n : Name) : Option Name :=
  let up := match n with
    | .str p _ => some p
    | .num p _ => some p
    | .anonymous => none
  match env.find? n with
  | some ci =>
    if isPublicDecl env roots n ci then some n
    else up.bind (publicAncestor env roots)
  | none => up.bind (publicAncestor env roots)

/-- The declaration's body, when it has one. (`ConstantInfo.value?` stopped
returning theorem proofs on recent toolchains, so match constructors directly.) -/
def valueOf? : ConstantInfo → Option Expr
  | .defnInfo dv => some dv.value
  | .thmInfo tv => some tv.value
  | .opaqueInfo ov => some ov.value
  | _ => none

def usedConstantsOf (ci : ConstantInfo) : Array Name :=
  let fromType := ci.type.getUsedConstants
  match valueOf? ci with
  | some v => fromType ++ v.getUsedConstants
  | none => fromType

/-- Collapse raw used constants onto deduped public project declarations.
Names in `extra` (chapter-referenced declarations living outside the root
modules, e.g. in mathlib) count as targets too — as themselves, without
ancestor collapsing — so edges between blueprint items survive even when one
endpoint was upstreamed. -/
def projectUses (env : Environment) (roots : List Name) (extra : NameSet) (self : Name)
    (used : Array Name) : Array String := Id.run do
  let mut out : Array String := #[]
  for u in used do
    if u != self then
      if isInProjectModule env roots u then
        match publicAncestor env roots u with
        | some p =>
          if p != self && !out.contains p.toString then
            out := out.push p.toString
        | none => pure ()
      else if extra.contains u && !out.contains u.toString then
        out := out.push u.toString
  return out

/-- Transitive axiom collection (what `#print axioms` computes), memoized
across queries: per-constant axiom sets are bit masks over the environment's
distinct axioms, cached in `AxState` so the shared closure (on mathlib-scale
projects, nearly the whole environment) is traversed once — not once per
declaration, which is quadratic and takes hours on large projects.

The kernel constant graph is acyclic, so an iterative DFS with an explicit
child cursor finishes every dependency before its dependents: at combine time
each child's mask is already cached (`getD 0` only ever fires on self-edges
and kernel-impossible back edges). -/
structure AxState where
  axIdx   : Std.HashMap Name Nat := {}
  axNames : Array Name := #[]
  cache   : Std.HashMap Name UInt64 := {}
  visited : Std.HashMap Name Unit := {}

def childrenOf (env : Environment) (n : Name) : Array Name :=
  match env.find? n with
  | some ci => usedConstantsOf ci
  | none => #[]

def maskFrom (env : Environment) (st0 : AxState) (root : Name) : AxState × UInt64 := Id.run do
  let mut st := st0
  if let some m := st.cache[root]? then
    return (st, m)
  let mut stack : Array (Name × Array Name × Nat) := #[(root, childrenOf env root, 0)]
  st := { st with visited := st.visited.insert root () }
  while _h : stack.size > 0 do
    let (n, children, i) := stack[stack.size - 1]!
    if i < children.size then
      stack := stack.set! (stack.size - 1) (n, children, i + 1)
      let c := children[i]!
      if c != n && !st.visited.contains c then
        st := { st with visited := st.visited.insert c () }
        stack := stack.push (c, childrenOf env c, 0)
    else
      stack := stack.pop
      let mut m : UInt64 := 0
      match env.find? n with
      | some ci =>
        if ci matches .axiomInfo _ then
          match st.axIdx[n]? with
          | some j => m := m ||| ((1 : UInt64) <<< j.toUInt64)
          | none =>
            let j := st.axNames.size
            if j ≥ 64 then
              panic! "blueprint-data: more than 64 distinct axioms in the environment"
            st := { st with axIdx := st.axIdx.insert n j, axNames := st.axNames.push n }
            m := m ||| ((1 : UInt64) <<< j.toUInt64)
        for u in children do
          if u != n then
            m := m ||| (st.cache[u]?.getD 0)
      | none => pure ()
      st := { st with cache := st.cache.insert n m }
  return (st, st.cache[root]?.getD 0)

def axiomNamesOfMask (st : AxState) (m : UInt64) : List String := Id.run do
  let mut out : List String := []
  for j in [0:st.axNames.size] do
    if (m >>> j.toUInt64) &&& 1 == 1 then
      out := out ++ [st.axNames[j]!.toString]
  return out

def maskHasSorry (st : AxState) (m : UInt64) : Bool :=
  match st.axIdx[``sorryAx]? with
  | some j => (m >>> j.toUInt64) &&& 1 == 1
  | none => false

def main (rawArgs : List String) : IO Unit := do
  let (flags, args) := rawArgs.partition (·.startsWith "--")
  let declsFile? := flags.filterMap (fun f =>
    if f.startsWith "--decls=" then some ((f.drop "--decls=".length).toString) else none) |>.head?
  for f in flags do
    if !f.startsWith "--decls=" then
      throw <| IO.userError s!"blueprint-data: unknown flag `{f}` (known: --decls=<file>)"
  let outPathStr : String := args[0]?.getD "content/blueprint/blueprint-data.json"
  -- catch the classic mistake of passing a module name first: the output path
  -- comes first, then the root modules
  if !outPathStr.endsWith ".json" then
    throw <| IO.userError
      s!"blueprint-data: the first argument is the output path (a .json file), got `{outPathStr}` — \
         did you mean `lake exe blueprint-data content/blueprint/blueprint-data.json {outPathStr}`? \
         (or just run `npm run blueprint:data`, which reads blueprint.config.json)"
  let outPath : System.FilePath := outPathStr
  -- remaining args = root modules (each blueprint chapter lib root + any code libs).
  -- No silent default: a missing root list would quietly omit chapters from the
  -- kernel data while builds keep passing — fail loudly instead.
  let roots := args.drop 1 |>.map (·.toName)
  if roots.isEmpty then
    throw <| IO.userError
      "blueprint-data: no root modules given — pass them as arguments, e.g. \
       `lake exe blueprint-data content/blueprint/blueprint-data.json Ch01_SumsOfOddNumbers` \
       (or just run `npm run blueprint:data`, which reads blueprint.config.json)"
  -- extra chapter-referenced declarations to resolve beyond the root modules
  let extraNames : List Name ← match declsFile? with
    | none => pure []
    | some f => do
      let contents ← IO.FS.readFile f
      pure <| contents.splitOn "\n" |>.map (fun l => l.trimAscii.toString) |>.filter (· ≠ "")
        |>.map String.toName
  let extraSet : NameSet := extraNames.foldl (·.insert ·) {}

  initSearchPath (← findSysroot)
  -- importAll: load full (non-exported) environments so theorem proof terms are
  -- available — otherwise dependency edges and sorry/axiom detection see only types.
  let env ← importModules (roots.toArray.map ({ module := ·, importAll := true })) {}

  let mut decls : Array Json := #[]
  let mut names : Array (Name × ConstantInfo) := #[]
  for (n, ci) in env.constants.toList do
    if isPublicDecl env roots n ci then
      names := names.push (n, ci)
  let sorted := names.qsort (fun a b => a.1.toString < b.1.toString)

  -- external names come after the project walk, deduped against it, in a
  -- deterministic order; unresolvable ones are reported, not fatal
  let emitted : NameSet := sorted.foldl (fun s (n, _) => s.insert n) {}
  let externals := (extraNames.filter (!emitted.contains ·)).eraseDups
    |>.toArray.qsort (fun a b => a.toString < b.toString)
  let mut missing : Array Name := #[]

  let total := sorted.size + externals.size
  let mut analyzed := 0

  let emitDecl (st : AxState) (mask : UInt64) (n : Name) (ci : ConstantInfo)
      (external : Bool) : Json := Id.run do
    -- statement-level vs proof-level dependencies (type vs value constants);
    -- consumers infer dashed (statement) / solid (proof) edges from the split
    let typeUses := projectUses env roots extraSet n ci.type.getUsedConstants
    let valueUses := match valueOf? ci with
      | some v => projectUses env roots extraSet n v.getUsedConstants
      | none => #[]
    let projUses := typeUses ++ valueUses.filter (!typeUses.contains ·)
    let axiomNames := axiomNamesOfMask st mask
    -- source location (module-relative path + 1-based line range), when recorded
    let locFields := match moduleFileOf env n, Lean.declRangeExt.find? env n with
      | some file, some dr => [
          ("file", Json.str file),
          ("startLine", Json.num dr.range.pos.line),
          ("endLine", Json.num dr.range.endPos.line)]
      | some file, none => [("file", Json.str file)]
      | _, _ => []
    let originFields := if external then [("origin", Json.str "external")] else []
    return Json.mkObj ([
      ("name", Json.str n.toString),
      ("kind", Json.str (kindOf ci)),
      ("usedConstants", toJson projUses),
      ("typeUses", toJson typeUses),
      ("valueUses", toJson valueUses),
      ("axioms", toJson axiomNames),
      ("hasSorry", Json.bool (maskHasSorry st mask))
    ] ++ locFields ++ originFields)

  let mut axSt : AxState := {}
  for (n, ci) in sorted do
    let (st', mask) := maskFrom env axSt n
    axSt := st'
    decls := decls.push (emitDecl axSt mask n ci false)
    analyzed := analyzed + 1
    if analyzed % 200 == 0 then
      IO.eprintln s!"blueprint-data: analyzed {analyzed}/{total} declarations"

  for n in externals do
    match env.find? n with
    | some ci =>
      let (st', mask) := maskFrom env axSt n
      axSt := st'
      decls := decls.push (emitDecl axSt mask n ci true)
    | none => missing := missing.push n
    analyzed := analyzed + 1
    if analyzed % 200 == 0 then
      IO.eprintln s!"blueprint-data: analyzed {analyzed}/{total} declarations"

  if missing.size > 0 then
    IO.eprintln s!"blueprint-data: {missing.size} chapter-referenced declaration(s) not found in the environment (not imported by the root modules?):"
    for n in missing do
      IO.eprintln s!"  - {n}"

  let out := Json.mkObj [
    ("rootModules", toJson (roots.map toString)),
    ("decls", Json.arr decls)
  ]
  if let some dir := outPath.parent then
    IO.FS.createDirAll dir
  IO.FS.writeFile outPath (out.pretty ++ "\n")
  IO.println s!"blueprint-data: wrote {decls.size} declarations to {outPath}"
