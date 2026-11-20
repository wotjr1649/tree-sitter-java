# Changelog

## Unreleased

- Keep comment-like text inside text blocks in `multiline_string_fragment` nodes and preserve `escape_sequence`
  nodes (K18, JLS 25 §§3.7 and 3.10.6, grammar-orchard PR #41 and the Phase 3 `text-block-comments` report).
  A closing delimiter on the same line as `//` now closes the block. Comments outside the delimiters and within
  template interpolation expressions retain their roles. The node schema is unchanged. The existing tolerances for
  a missing opening line terminator and an illegal escape also apply when `//` text precedes the closing delimiter on
  the same line. Corpus and oracle cases record both forms along with valid counterparts that parse at 2.3.0.

## 2.3.0

Phase 2 of the final-release plan: OpenJDK 25.0.5+8 as a second pinned example set, the Java 25 syntax fixes that
it and the backlog triage found (K9-K14), and CI guards for incremental parsing and parser size. No node kind or
field name is removed or renamed; `node-types.json` only widens (K12). With the OpenJDK set the examples baseline
first held 192 paths; it now holds 183, and each has a committed javac verdict: 144 files javac's parser rejects, 29
forms only javac's parser accepts (a full compile rejects them), and 10 documented limits. None is a defect.
[docs/tolerances.md](docs/tolerances.md) lists every form where the grammar and javac 25 disagree.

- Extend the Ubuntu CI examples to parse OpenJDK 25.0.5+8 sources and javac langtools tests at pinned commit
  `fda231468e56663992785ec199a6efb8eca3cc7a`. No grammar change.
  The CI artifact of failing examples now holds the list of paths instead of the source files.
- Record the pinned javac parse verdict, diagnostic codes and original file hash for each example baseline failure.
  CI checks the verdict file against the failure list and the pinned checkouts.
- Add the CI jobs `fuzz` (`tree-sitter fuzz` over the corpus, up to 3 random edits and 10 iterations per case, 120 s
  cap; after the edits it checks the incremental tree's sizes and changed ranges, and after undoing them that the
  incremental reparse equals the expected corpus tree) and
  `parser-cost` (`scripts/parser-cost.mjs --check`: `parser.c` bytes and `STATE_COUNT` must equal
  `test/parser-cost.json`). No grammar change.
- Document the [grammar tolerances and known limits](docs/tolerances.md), including forms accepted by
  javac's parser and rejected during full compilation.
- Parse `open`, `module`, and `with` as type names in local and array declarations, casts, and `instanceof` (JLS 25
  §3.8, reported in grammar-orchard issue #43). Generic locals such as `module<String> x = null;` now form a
  `local_variable_declaration` instead of an `expression_statement`, and `module.class` now forms a `class_literal`
  instead of a `field_access`. Module declarations and ordinary identifier expressions keep their trees. The parser
  accepts some forms that javac rejects, as with an ordinary type name at 2.2.0. At the top level this includes
  variable and method declarations, including forms with initializers, arrays, parameters or annotations and
  declarations after a module declaration. It also accepts variable declarations as a labeled statement or the
  single-statement body of `if` or `while`, empty type arguments in local declarations and constructor references,
  generic class literals such as `module<A>.class`, and `instanceof final T` without a variable name. In the tested
  type positions, `permits`, `record`, `sealed`, `var`, and `yield` keep their previous acceptance.
- Parse Unicode escapes with repeated `u` in string literals and text blocks and escapes where `\u005c` supplies the
  backslash before a matching quote, as in `"\u005c""` and `'\u005c''` (JLS 25 §3.3 and §3.10.7,
  tree-sitter-java issues #207 and #209, based on PR #210 by theawless). String and text block escape nodes now span
  the complete repeated-`u` escape, an encoded backslash with an escaped double quote, or a pair of encoded
  backslashes. Strings and text blocks parse an encoded backslash paired with a raw backslash both before the
  closing delimiter and within the literal body. Each backslash in a mixed pair has its own `escape_sequence` node,
  and ordinary characters after the pair form a `string_fragment` or `multiline_string_fragment`.
  In `"\u005c\{1}"`, a `string_fragment` for `{1}` replaces the previous `string_interpolation`.
  An encoded backslash before the only closing double quote or text block delimiter now leaves the literal
  unterminated. Repeated `u` inherits ordinary string tolerances for encoded quotes and line breaks, illegal
  escape tails, raw line breaks and string templates. In `"\uuu005cu0041"`, `u0041` is a string fragment, as in the
  previously accepted single-`u` spelling.
- Parse multiple type or record patterns in a single `case` label, with an optional trailing `when` guard (K11,
  JLS 25 §14.11.1). The `switch_label` has a `pattern` child for each alternative, in source order. Empty record
  pattern lists such as `case R(), S()` previously appeared as `method_invocation` children and now appear as
  `pattern` children holding `record_pattern`, including the same syntax with lowercase names. The
  `node-types.json` bytes and the node-kind and field names are unchanged. Single record patterns retain `when`
  as a component binding name, including before a guard. Typed `_` in later record patterns uses the same
  incremental parsing fix as K13 and keeps its visible `identifier` node. Lists inherit existing single-pattern
  tolerances for `var` or `_` as a type name, duplicate `final` even with an annotation, and empty type arguments.
  Some keywords can be names, including `abstract` in `case String _, abstract _` and `case String _, abstract(_)`.
  This includes simple, qualified, generic and array type names, type arguments, and bindings in type patterns
  and record components, including nested components. Examples include `@A new _`, `Outer.new _`, `List<null> _`,
  `Integer static`, `int instanceof` and `R(int new)`. Record patterns in either position also accept annotations
  inside their types, such as `G<@A ?> (_)` and `O.@A Inner<?> (_)`. javac's parser rejects these forms.
  Additional patterns and their record components reserve specific keywords and literals in positions previously
  disambiguated by the expression alternative. Named bindings and preview or invalid types can still be parsed
  where javac's later phases reject them. Mixing a constant with a type pattern, as in `case 1, Integer i`, still
  produces an error. The five OpenJDK example files fixed by K11 leave `test/examples/failures.txt`.
- Parse parenthesized assignment targets (K12, JLS 25 §§15.8.5 and 15.26), including `(x) = 1`, `((x)) += 7`,
  `(this.field) = x` and `(a[0]) <<= 1` in statements, `for` clauses and lambda bodies. The
  `assignment_expression.left` field holds a `parenthesized_expression` for each pair of parentheses. In
  `src/node-types.json`, `left` gains that type, and `parenthesized_expression.children` explicitly lists
  `array_access`, `field_access`, `identifier` and `parenthesized_expression` alongside the existing `expression`
  supertype. The compared error-free trees retain their structure and the OpenJDK examples list drops four
  paths. Several forms that javac rejects now parse with parenthesized assignment targets, as with ordinary
  values at 2.2.0. These include whole parenthesized assignments as statements, `for` initializers or updates, and
  switch statement arrow bodies. Statement expressions can also wrap the assignment in binary, unary, ternary or
  cast expressions, field or array accesses, or method references. The same applies to unary `for` initializers,
  ternary `for` updates, and binary, unary or ternary switch statement arrow bodies. Annotation values include
  unkeyed, keyed, nested, array (including mixed entries) and element `default` values. Identifier tolerances cover
  right-hand `_`, including in a conditional expression's middle arm and in call arguments, and the targets `(_)`,
  `(obj.default)`, `(obj.if)`, `(obj._)`, `(_.field)`, `(_[0])` and `(a[_])`. A switch block can also contain an
  unqualified `yield()` call alongside a `yield` of the assignment. Corpus and oracle cases record these forms with
  controls that already parse at 2.2.0.
- Fix an incremental parse failure in typed unnamed record components such as `Point(int _, var _, _)` (K13).
  Typed `_` keeps its visible `identifier` node and uses `underscore_pattern` as its underlying grammar symbol.
  Bare `_` still exposes `underscore_pattern`. `node-types.json` is byte-identical, and the pinned example trees are
  unchanged.
- Fix incremental parsing of typed unnamed bindings in switch and `instanceof` type patterns (K14).
  The binding shares the `underscore_pattern` token and keeps its visible `identifier` node. The node schema is
  unchanged.

- Set `tree-sitter.json` `metadata.version` and the package manifests to 2.3.0 (the generated `parser.c` embeds it).
- Review criterion used in this release: a javac-rejected input that newly parses cleanly is kept, and pinned by
  corpus and oracle cases, when the same shape with the newly accepted part replaced by a valid value already parsed
  cleanly at 2.2.0 (existing tolerance). The entries above name each such case. Any other javac-rejected input that
  erred at 2.2.0 keeps erring; keywords read as identifiers are left for the reserved-words release. A defect is a
  construct whose own reproducer passes a full `javac --release 25` compile and is derivable from the JLS 25
  grammar (owner decision 2026-11-20): forms that javac's parser accepts but a full compile rejects are not defects
  and the grammar may stay stricter, and forms javac accepts outside the JLS 25 grammar are documented limits.
- Known limitations:
  - The two K5 forms with annotated dimensions before an annotated `...` (`int @A [] @B ... xs`) still contain ERROR
    and remain the oracle's expected failures.
  - A raw NUL outside any literal (`int x<NUL>y`) still errs, although javac accepts it.
  - Unicode escapes outside literals: javac translates unicode escapes (`\uXXXX`) before it splits the source into
    tokens, so an escape outside a string or char literal can form an identifier, a keyword, a separator, a comment
    delimiter or a line end (`int \u0061lpha;`). The grammar reads such escapes only inside literals; elsewhere
    they give ERROR, or, inside a comment, a token boundary that differs from javac's (`// \u000A int f;` stays one
    `line_comment`) (grammar-orchard issue #51). See the
    [pinned Unicode cases](docs/tolerances.md#unicode-escapes-outside-literals).
  - javac 25 accepts some forms that the JLS 25 grammar does not derive, and the grammar keeps erring on them:
    `o instanceof R(final _, int _)`, `case final _ ->` and `case @A _ ->` (JLS 25 §14.30.1: the match-all pattern
    is a bare `_`), and `java.util.@A Arrays.sort(a)` (§15.12 writes the qualifier as a TypeName).

## 2.2.0

More Java 25 syntax fixes found through the javac oracle and the pinned examples: numeric literals (K6), annotation
positions (K7) and a raw NUL inside literals (K8). No node kind or field name is removed or renamed;
`node-types.json` only widens (K7). Every pinned example file that javac accepts now parses without errors: the 6
remaining baseline paths are Maven archetype templates (`package ${package};`) that javac also rejects.

- Parse decimal floating point literals whose digits start with a zero followed by more digits, such as `00d`,
  `01d`, `00f`, `01e1` and `08d` (JLS 25 §3.10.2: the digits before an exponent or a type suffix may have leading
  zeros and are not octal). They used to split into an `octal_integer_literal` or `decimal_integer_literal` and an
  ERROR. They are now one `decimal_floating_point_literal`, like `0d` and `00.5`. Integer literals such as `00`,
  `007` and `08` keep their trees.
- Accept one or more underscores between digits in every numeric literal (JLS 25 §3.10.1-2; tree-sitter-java issue
  #227): decimal, octal, hex and binary integers (`1__0`, `0_7`, `0__7`, `0x1__F`, `0b1__0`) and decimal and hex
  floating point literals (`1__0.5`, `1e1__0`, `0x1__F.8p1`). A hex floating point exponent may start with zeros
  (`0x1p03`, `0x1p0_3`). These inputs used to contain ERROR. Underscores at the start or end of the digits, next to
  the point, a prefix, an exponent marker or a suffix still give ERROR (`1_`, `0x_1`, `1._5`, `1_.5`, `0_x1`, `1e_5`,
  `1_L`), as javac rejects them.
  The non-Java `0o`/`0O` octal prefix keeps the single-underscore rule it had (`0o1__7` still gives ERROR).
  The grammar keeps parsing hex floating point literals without a `p` exponent, which javac rejects, as it did for
  `0x5.4` and `0x1_F.8`. They now also take runs of underscores: `0x1__F.8`, `0x.8__8`, `0x1__F.` and `0x1__F.f` parse
  as one `hex_floating_point_literal` without ERROR. Hex digits directly followed by a point therefore still form
  such a literal, so `0x1__F.foo()` gives ERROR as `0x1F.foo()` does, while `0x1__F .foo()` and
  `(0x1__F).toString()` parse as calls.
  After a digit token that is newly accepted, member access keeps the existing tolerance for keywords as field
  names, as at v2.1.0: `0x1__F .class` and `1__0 .class` parse as `field_access` like `0x1F .class`, although javac
  rejects them.
- The two entries above change no node kind or field, and `node-types.json` is unchanged. Inputs that parsed without
  errors keep their trees. The pinned example file that failed on `00d` now parses, so `test/examples/failures.txt`
  drops it (7 to 6 paths, after K8).
- Accept a raw NUL byte (U+0000) inside string literals, text blocks and char literals, as javac's parser does. The
  generator renders a negated character class such as `[^"\\]` without NUL, so `"a<NUL>b"`, `"""…<NUL>…"""` and
  `'<NUL>'` used to produce an ERROR. `string_fragment`, `multiline_string_fragment` and `character_literal` now
  include NUL; no node kind or field changes and a fragment stays one node. Inputs without NUL keep their trees. A char
  literal accepts exactly one NUL and nothing else (`'<NUL>a'` and `'<NUL><NUL>'` stay ERROR); the grammar still
  tolerates `'ab'` as before. NUL in a string or text block follows the tolerance the grammar already had without NUL: a
  raw CR or LF in an ordinary string (also as `\<newline>`), text on the opening line of a text block and an invalid
  escape sequence such as `\q` parse cleanly with or without a NUL, although javac rejects all three. The same holds
  for string templates (`STR."a<NUL>\{x}b"`): the grammar keeps its existing template rule, which javac 25 rejects
  with or without a NUL. An unterminated
  string, text block or char literal that holds a NUL still contains an ERROR. Two pinned example files
  that failed on this (`MultiValueArrayOrderInlineNullBinaryDocValuesReaderTests.java`,
  `CsvRecordTokenizerTests.java`) now parse, so `test/examples/failures.txt` drops them (9 to 7 paths).
- Parse annotations in three more positions (K7). No node kind or field is removed or renamed; `src/node-types.json`
  gains two child types: `catch_type` takes `_type` instead of `_unannotated_type`, and `instanceof_expression` takes
  an optional `modifiers` child.
  - Annotated alternatives of a multi-catch, as in `catch (T1 | @A T2 e)` (JLS 25 §14.20; tree-sitter-java issue
    #208): every alternative after `|` may be an `annotated_type`. Annotations before the first alternative stay in
    the parameter's `modifiers`, as before. The idea is from tree-sitter-java PR #206 (by theawless).
  - An annotated receiver parameter without a qualifier, `void m(@A Inner this)` (JLS 25 §8.4; issue #234), used to
    parse cleanly as a `formal_parameter` whose name was an `identifier` spelled `this`. It is now a
    `receiver_parameter`, like the unannotated and the qualified forms. Its `this` is now captured as
    `@variable.builtin` instead of `@variable` in `queries/highlights.scm`. The receiver also wins in other
    lists that share `formal_parameters`: `(@A T this) -> 0` and `record R(@A T this) {}`, which javac rejects, also give a `receiver_parameter`
    through the shared `formal_parameters`, and an unannotated `(T this) -> 0` already did. This existing tolerance
    is unchanged. Other error-free trees change only as the next two bullets say.
  - Annotations before `final` in an `instanceof` type pattern, `o instanceof @A final String s` (JLS 25 §14.30.1):
    the annotations and `final` form a `modifiers` child, as in a `type_pattern` (K4). `instanceof final T x` keeps
    its anonymous `final` token and `instanceof final @A T x` its `annotated_type`. Two invalid inputs that used to
    parse cleanly by reading `final` as a type name, `o instanceof @A final String` and `o instanceof @A final`, now
    contain MISSING or ERROR; javac rejects both. The modifiers allow one `final` and any annotations around it, so
    `o instanceof @A final final T x` is an error, as it is without the annotation (javac: `repeated.modifier`).
  - `final` and `this` are reserved words (`reserved.global` in `grammar.js`): the lexer no longer falls back to an
    identifier for them where the parser state cannot use the keyword. Before this, `catch (T1 | @A final e)`,
    `catch (T1 | @A T2 this)` and `o instanceof @A final T this` parsed cleanly with `final` as a type name or `this`
    as a variable name; they now contain ERROR, as at the base. Inputs that javac rejects and that parsed cleanly
    before also contain ERROR now, for example `catch (T1 | final e)`, `o instanceof final T this`,
    `o instanceof @A T this`, `void m(@A Inner this, @B Inner this)` and `int this = 1;`. Against the base, the 63,832
    files of the pinned examples and every other corpus and oracle input keep their trees. Still read cleanly although
    javac rejects them: `o instanceof @A final var x`, like `o instanceof final var x` before, because `var` is a
    valid name in a qualified type. Likewise `catch (T1 | @A static e)` and `o instanceof @A final T static`, which javac
    rejects, parse cleanly with `static` read as a type name and as a variable name, as `catch (@A T1 | static e)` and
    `o instanceof final @A T static` already do at 2.1.0.

- Set `tree-sitter.json` `metadata.version` and the package manifests to 2.2.0 (the generated `parser.c` embeds it).
- Review criterion used in this release: a javac-rejected input that newly parses cleanly is kept, and pinned by
  corpus and oracle cases, when the same shape with the newly accepted part replaced by a valid value already parsed
  cleanly at 2.1.0 (existing tolerance). The entries above name each such case. Keywords read as identifiers in such
  positions are left for a later release.
- Known limitations:
  - The 2.1.0 limitation on a raw NUL inside a string literal is resolved (K8).
  - The two K5 forms with annotated dimensions before an annotated `...` (`int @A [] @B ... xs`) still contain ERROR
    and remain the oracle's expected failures.
  - A raw NUL outside any literal (`int x<NUL>y`) still errs, although javac accepts it.

## 2.1.0

More Java 25 syntax fixes found through the javac oracle and the pinned examples (K4, K5). Node kinds and field
names are unchanged; `node-types.json` only gains child types (K4). Some trees change, as described below.

- CI parses the six example repositories once on Ubuntu at pinned commits and fails when the failing paths differ
  from `test/examples/failures.txt` (a new failure or a baseline entry that now parses). It replaced the unpinned,
  non-blocking example step on all three OS (#13).
- Add `scripts/tree-compare.mjs`, a full-tree comparison of two parser builds over a file list that runs in batches
  of 100 files per child process by default (at most 500) with a memory cap that the child checks after every file and
  the parent watches while the child runs (`oracle/README.md`). No grammar or parser change.
- Parse qualified record patterns and `final` or annotated type patterns (K4, JLS 25 §14.30.1). A `record_pattern`
  may now name its type with a `scoped_type_identifier` (`o instanceof a.b.R(int x)`, `case Outer.Box(Outer.Point(var
  x, var y))`). A `type_pattern` in a `case` label and a `record_pattern_component` take an optional `modifiers` child
  holding only `final` and annotations, the variable modifiers that JLS 25 §4.12.4 allows there (`case final String
  s`, `case @A final a.b.C c`, `R(final var x, @A String s)`). No node kind or field is removed or renamed. `src/node-types.json` gains three
  child types: `scoped_type_identifier` under `record_pattern`, and `modifiers` under `type_pattern` and
  `record_pattern_component`. Inputs that parsed without errors keep their trees, with one exception: a qualified record
  pattern with an empty component list or only `_`, such as `case T.R() -> 1;` or `case T.R(_) -> 1;`, used to
  parse cleanly as a `method_invocation` and is now a `pattern` holding a `record_pattern`, as javac's parser reads
  it. The call captures on them go away: `@function.method` in `queries/highlights.scm` and `@reference.call`
  in `queries/tags.scm`; `T` and `R` are captured as `@type` instead. Inputs with these patterns that used to contain ERROR or MISSING now parse cleanly. `instanceof final T x` keeps its anonymous `final` token. Other
  modifier keywords are not accepted there (`case static String s` contains ERROR, as before), so a constant
  subtraction such as `case non-sealed -> 1` keeps its `binary_expression` tree. Two invalid
  inputs that used to parse cleanly by reading `final` as a type name, `case final s` and `case final String`, now
  contain MISSING. The expected-failure set is now empty. The 13 pinned example files that failed on qualified
  record patterns now parse, so `test/examples/failures.txt` drops them (36 to 23 paths). Upstream tree-sitter-java issue #229 and PRs #230 (by
  DragonAxe), #231 (by akd-devvine) and #232 (by mihailkirov) proposed the same two changes.
- Parse annotations before the `...` of a variable arity parameter, as in `Object @Nullable ... args` (JLS 25
  §8.4.1; tree-sitter-java issue #205), in methods, constructors, record components and lambda parameters. The
  annotations are children of `spread_parameter` before the anonymous `...` token, like the annotations after it.
  Only `spread_parameter` changes: `dimensions` is as in 2.0.0 and K5 adds no conflict or GLR split, so inputs that
  parsed without errors keep their trees (an array type with nine annotated dimensions keeps one flat `dimensions`;
  a corpus case fixes it). No node kind or field changes and `node-types.json` is unchanged. Known limit: an
  annotation right after an array dimension still starts another dimension, so `int @A [] @B ... xs` and
  `int @A [] @B @C [] [] @D @E ... r` contain ERROR as in 2.0.0, although javac accepts them; the oracle lists them
  as expected failures (`k5/v04-after-dimensions`, `k5/v05-many-dimensions`). Annotations after `...`
  (`int... @Foo x`) are still accepted, although javac rejects them. The 14 pinned example files that failed on
  annotations before `...` now parse, so `test/examples/failures.txt` drops them (23 to 9 paths).

- Set `tree-sitter.json` `metadata.version` and the package manifests to 2.1.0 (the generated `parser.c` embeds it).
- Known limitations:
  - A raw NUL byte (U+0000) inside a string literal makes the literal fail to parse (2 pinned example files): the
    current string rules exclude NUL, as the tree-sitter generator 0.27.2 renders negated character classes without
    it. An explicit NUL alternative in the grammar fixes this; it is planned for the next release.
  - The pinned examples baseline now holds 9 paths: 6 Maven archetype templates (`package ${package};`, which javac
    also rejects), 2 files with a raw NUL in a string, and 1 file with `00d`; the last three are planned for the next release.

## 2.0.0

First release with the owner's grammar fixes: Java 25 syntax (K1-K3). The 1.x line is the upstream v0.23.5
baseline; 2.x carries this repository's fixes (ADR-0001, amendment 2026-11-19). Node kinds and field names are
unchanged, but some trees change (K2, K3 below), which can affect consumers of named children and queries.

- Parse `import module` declarations (JEP 511, JLS 25 §7.5.5) as an `import_declaration` with an anonymous
  `module` token. No node kind or field changes. Inputs that parsed without errors keep their trees; inputs
  with `import module` that used to contain ERROR now parse cleanly. `module` as an ordinary name keeps its
  `identifier` tree.
- Add a javac parse-only oracle (Eclipse Temurin 25.0.5+8, `--release 25`, preview off) with committed
  cases, verdicts and a tree-sitter API replay (`oracle/`, `scripts/oracle-replay.mjs`). Known baseline mismatches
  are an expected-failure set that each fix removes (`oracle/README.md`). No grammar or `src/` change.
- Add a node kind and field snapshot (`test/node-kinds.txt`, `scripts/generate-node-kinds.mjs --check`) and a
  parser cost script (`scripts/parser-cost.mjs`).
- Add the `oracle-replay` and `oracle-javac` jobs to `ci.yml`.
- Parse statements before `super(...)` and `this(...)` in a constructor body (JEP 513, JLS 25 §8.8.7). The call
  stays an `explicit_constructor_invocation`, also when qualified (`outer.super(...)`) or generic (`<T>this(...)`).
  As in javac's parser, more than one invocation in a body is not a syntax error. No node kind or field changes.
  Inputs that parsed without errors keep their trees, with one exception: a qualified generic call after a
  statement, such as `outer.<T>super(n);`, used to parse cleanly as a `method_invocation` named `super` and is now
  an `explicit_constructor_invocation`. Constructor bodies with statements before the invocation that used to
  contain ERROR or MISSING now parse cleanly. The `repeat(choice(...))` form matches orchard's Java grammar.
- Parse `default` in a `case` label list, as in `case null, default` (JLS 25 §14.11.1), as the anonymous
  `default` token of `switch_label` instead of an `identifier`. No node kind or field changes. Trees change only
  where a `case` label list held `default` as an `identifier`: `default` is a reserved keyword, so no valid
  program names it. The grammar accepts `default` in any position of the list. This is wider than javac's parser,
  which accepts labels after `null, default` (`case null, default, 1` is rejected only in attribution) but rejects
  `case default` and `case 1, default`. Invalid inputs that used `default` as an expression, such as
  `case default + 1 ->`, may now get a different error-recovery tree with ERROR where they used to parse cleanly.
- The Go module path is now `github.com/wotjr1649/tree-sitter-java/v2`, as Go requires for v2 releases. Import the
  binding from `github.com/wotjr1649/tree-sitter-java/v2/bindings/go`.
- Set `tree-sitter.json` `metadata.version` and the package manifests to 2.0.0. CLI 0.27.2 embeds the metadata
  version in `src/parser.c`, so the generated parser differs from 1.0.0 in that field too.
- Known open item: two inputs that javac accepts still parse with errors (a qualified record pattern and
  `case final String s`, K4). They stay in `oracle/data/expected-failures.json` until their scope is decided.

## 1.0.0

- Establish the independent Java grammar baseline from upstream v0.23.5.
- Import the Go binding from `github.com/wotjr1649/tree-sitter-java/bindings/go`.
- Resolve the Swift test dependency from `tree-sitter/swift-tree-sitter` in the
  range `>=0.25.0, <0.26.0`.
- Set the Python wheel tag to `cp310-abi3` for CPython.
- Retain `tree-sitter.json` metadata at 0.23.5 to preserve the generated
  parser bytes. The first grammar behaviour change will use its release version.
- Remove the automated GitHub Release and registry publishing workflow and the
  upstream npm maintainer list.
- Use ABI 15 and set binding runtime lower bounds in the 0.25 line. The Go binding
  requires Go 1.23 or newer. The Python binding requires Python 3.10 or newer.
