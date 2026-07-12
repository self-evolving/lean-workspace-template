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

Usage: `lake exe blueprint-data [outPath] <rootModule> [rootModule...]`
Default outPath: `content/blueprint/blueprint-data.json`. Root modules are
required — pass the values from `blueprint.config.json` `lakeRoots` (CI does
this automatically).
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

/-- Collapse raw used constants onto deduped public project declarations. -/
def projectUses (env : Environment) (roots : List Name) (self : Name)
    (used : Array Name) : Array String := Id.run do
  let mut out : Array String := #[]
  for u in used do
    if u != self && isInProjectModule env roots u then
      match publicAncestor env roots u with
      | some p =>
        if p != self && !out.contains p.toString then
          out := out.push p.toString
      | none => pure ()
  return out

/-- Transitive axiom collection by BFS over used constants (what `#print axioms`
computes), implemented directly to stay on stable core APIs. -/
partial def collectAxiomsFrom (env : Environment) (start : Name) : NameSet := Id.run do
  let mut visited : NameSet := {}
  let mut axioms : NameSet := {}
  let mut worklist : Array Name := #[start]
  while h : worklist.size > 0 do
    let n := worklist[worklist.size - 1]
    worklist := worklist.pop
    if visited.contains n then
      continue
    visited := visited.insert n
    match env.find? n with
    | some ci =>
      if ci matches .axiomInfo _ then
        axioms := axioms.insert n
      for u in usedConstantsOf ci do
        unless visited.contains u do
          worklist := worklist.push u
    | none => pure ()
  return axioms

def main (args : List String) : IO Unit := do
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

  for (n, ci) in sorted do
    -- statement-level vs proof-level dependencies (type vs value constants);
    -- consumers infer dashed (statement) / solid (proof) edges from the split
    let typeUses := projectUses env roots n ci.type.getUsedConstants
    let valueUses := match valueOf? ci with
      | some v => projectUses env roots n v.getUsedConstants
      | none => #[]
    let projUses := typeUses ++ valueUses.filter (!typeUses.contains ·)
    let axioms := collectAxiomsFrom env n
    let axiomNames := axioms.toList.map toString
    -- source location (module-relative path + 1-based line range), when recorded
    let locFields := match moduleFileOf env n, Lean.declRangeExt.find? env n with
      | some file, some dr => [
          ("file", Json.str file),
          ("startLine", Json.num dr.range.pos.line),
          ("endLine", Json.num dr.range.endPos.line)]
      | some file, none => [("file", Json.str file)]
      | _, _ => []
    decls := decls.push <| Json.mkObj ([
      ("name", Json.str n.toString),
      ("kind", Json.str (kindOf ci)),
      ("usedConstants", toJson projUses),
      ("typeUses", toJson typeUses),
      ("valueUses", toJson valueUses),
      ("axioms", toJson axiomNames),
      ("hasSorry", Json.bool (axioms.contains ``sorryAx))
    ] ++ locFields)

  let out := Json.mkObj [
    ("rootModules", toJson (roots.map toString)),
    ("decls", Json.arr decls)
  ]
  if let some dir := outPath.parent then
    IO.FS.createDirAll dir
  IO.FS.writeFile outPath (out.pretty ++ "\n")
  IO.println s!"blueprint-data: wrote {decls.size} declarations to {outPath}"
