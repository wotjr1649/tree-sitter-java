import com.sun.source.tree.*;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreePath;
import com.sun.source.util.TreePathScanner;
import com.sun.source.util.Trees;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.Map;
import java.util.StringJoiner;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaFileObject;

// java -cp <empty dir> StructuralOracle.java <kinds.txt> <cases.jsonl> <structures.jsonl>
public class StructuralOracle {
    public static void main(String[] args) {
        try {
            ParseOracle.requireJdk();
            if (args.length != 3) throw new ParseOracle.Fault("need <kinds.txt> <cases.jsonl> <structures.jsonl>");
            var kinds = EnumSet.noneOf(Tree.Kind.class);
            for (String line : Files.readAllLines(Path.of(args[0]), StandardCharsets.UTF_8))
                kinds.add(Tree.Kind.valueOf(line));
            if (kinds.isEmpty()) throw new ParseOracle.Fault("empty kind list");

            var ids = new HashSet<String>();
            try (var input = Files.newBufferedReader(Path.of(args[1]), StandardCharsets.UTF_8);
                 var output = Files.newBufferedWriter(Path.of(args[2]), StandardCharsets.UTF_8)) {
                for (String line; (line = input.readLine()) != null;) {
                    if (line.isBlank()) continue;
                    if (!(new ParseOracle.Json(line).value() instanceof Map<?, ?> c))
                        throw new ParseOracle.Fault("case line must be an object");
                    String id = ParseOracle.str(c, "id"), source = ParseOracle.str(c, "source");
                    if (!ids.add(id)) throw new ParseOracle.Fault("duplicate case id " + id);
                    Object file = c.get("file");
                    if (file != null && !(file instanceof String name && ParseOracle.FILE_NAME.matcher(name).matches()))
                        throw new ParseOracle.Fault("invalid virtual file name for " + id);
                    int[] offsets = byteOffsets(source);
                    if (!ParseOracle.sha256(source.getBytes(StandardCharsets.UTF_8)).equals(ParseOracle.str(c, "sha256")))
                        throw new ParseOracle.Fault("source hash mismatch for " + id);
                    output.write(structure(id, file == null ? ParseOracle.DEFAULT_FILE : (String) file, source, offsets, kinds));
                    output.write('\n');
                }
            }
            if (ids.isEmpty()) throw new ParseOracle.Fault("empty case file");
        } catch (Throwable t) {
            System.err.println("structural runner fault: " + t);
            System.exit(2);
        }
    }

    static String structure(String id, String file, String source, int[] offsets, EnumSet<Tree.Kind> kinds)
            throws java.io.IOException {
        var diagnostics = new DiagnosticCollector<JavaFileObject>();
        var task = ParseOracle.task(file, source, diagnostics);
        var units = task.parse();
        var errors = ParseOracle.errors(diagnostics);
        var nodes = new StringJoiner(",", "[", "]");
        if (errors.isEmpty()) {
            var positions = Trees.instance(task).getSourcePositions();
            for (var unit : units) {
                new TreePathScanner<Void, Void>() {
                    @Override public Void scan(Tree tree, Void unused) {
                        if (tree != null && kinds.contains(tree.getKind())) {
                            long start = positions.getStartPosition(unit, tree), end = positions.getEndPosition(unit, tree);
                            String context = context(tree, getCurrentPath(), source, start, end, positions, unit);
                            nodes.add("{\"kind\":" + ParseOracle.quote(tree.getKind().name())
                                + ",\"start\":" + bytePosition(offsets, start) + ",\"end\":" + bytePosition(offsets, end)
                                + (context == null ? "" : ",\"context\":" + ParseOracle.quote(context))
                                + attributes(tree, source, start, positions, unit, offsets) + "}");
                        }
                        return super.scan(tree, unused);
                    }
                }.scan(unit, null);
            }
        }
        return "{\"id\":" + ParseOracle.quote(id) + ",\"errors\":" + ParseOracle.value(errors) + ",\"nodes\":" + nodes + "}";
    }

    static int[] byteOffsets(String source) {
        int[] offsets = new int[source.length() + 1];
        int bytes = 0;
        for (int i = 0; i < source.length();) {
            offsets[i] = bytes;
            int cp = source.codePointAt(i++);
            if (cp >= Character.MIN_SURROGATE && cp <= Character.MAX_SURROGATE)
                throw new ParseOracle.Fault("source has an unpaired UTF-16 surrogate");
            if (Character.isSupplementaryCodePoint(cp)) {
                offsets[i++] = -1;
                bytes += 4;
            } else {
                bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : 3;
            }
        }
        offsets[source.length()] = bytes;
        return offsets;
    }

    static String bytePosition(int[] offsets, long position) {
        if (position == -1) return "null"; // Diagnostic.NOPOS, including synthetic trees.
        if (position < 0 || position >= offsets.length || offsets[(int) position] < 0)
            throw new ParseOracle.Fault("not a UTF-8 byte boundary: " + position);
        return Integer.toString(offsets[(int) position]);
    }

    static String attributes(Tree tree, String source, long start, SourcePositions positions,
                             CompilationUnitTree unit, int[] offsets) {
        String operator = switch (tree.getKind()) {
            case MULTIPLY -> "*";
            case DIVIDE -> "/";
            case REMAINDER -> "%";
            case PLUS, UNARY_PLUS -> "+";
            case MINUS, UNARY_MINUS -> "-";
            case LEFT_SHIFT -> "<<";
            case RIGHT_SHIFT -> ">>";
            case UNSIGNED_RIGHT_SHIFT -> ">>>";
            case LESS_THAN -> "<";
            case GREATER_THAN -> ">";
            case LESS_THAN_EQUAL -> "<=";
            case GREATER_THAN_EQUAL -> ">=";
            case EQUAL_TO -> "==";
            case NOT_EQUAL_TO -> "!=";
            case AND -> "&";
            case XOR -> "^";
            case OR -> "|";
            case CONDITIONAL_AND -> "&&";
            case CONDITIONAL_OR -> "||";
            case PREFIX_INCREMENT, POSTFIX_INCREMENT -> "++";
            case PREFIX_DECREMENT, POSTFIX_DECREMENT -> "--";
            case BITWISE_COMPLEMENT -> "~";
            case LOGICAL_COMPLEMENT -> "!";
            case ASSIGNMENT -> "=";
            case MULTIPLY_ASSIGNMENT -> "*=";
            case DIVIDE_ASSIGNMENT -> "/=";
            case REMAINDER_ASSIGNMENT -> "%=";
            case PLUS_ASSIGNMENT -> "+=";
            case MINUS_ASSIGNMENT -> "-=";
            case LEFT_SHIFT_ASSIGNMENT -> "<<=";
            case RIGHT_SHIFT_ASSIGNMENT -> ">>=";
            case UNSIGNED_RIGHT_SHIFT_ASSIGNMENT -> ">>>=";
            case AND_ASSIGNMENT -> "&=";
            case XOR_ASSIGNMENT -> "^=";
            case OR_ASSIGNMENT -> "|=";
            default -> null;
        };
        if (operator != null) return ",\"operator\":" + ParseOracle.quote(operator);
        return switch (tree) {
            case ParenthesizedTree t -> ",\"wrapsCast\":" + (t.getExpression().getKind() == Tree.Kind.TYPE_CAST);
            case MethodInvocationTree t -> ",\"explicitTypeArguments\":" + !t.getTypeArguments().isEmpty();
            case MemberReferenceTree t -> ",\"qualifiedSuper\":" + (t.getQualifierExpression() instanceof MemberSelectTree q
                && q.getIdentifier().contentEquals("super"));
            case NewArrayTree t -> ",\"bareInitializer\":" + (t.getType() == null);
            case ProvidesTree t -> {
                var providers = new StringJoiner(",", "[", "]");
                for (var implementation : t.getImplementationNames())
                    providers.add("[" + bytePosition(offsets, positions.getStartPosition(unit, implementation))
                        + "," + bytePosition(offsets, positions.getEndPosition(unit, implementation)) + "]");
                yield ",\"providerRanges\":" + providers;
            }
            case LiteralTree t when t.getKind() == Tree.Kind.STRING_LITERAL && start >= 0
                    && source.startsWith("\"\"\"", (int) start) -> ",\"textBlock\":true";
            default -> "";
        };
    }


    static String context(Tree tree, TreePath path, String source, long start, long end,
                          SourcePositions positions, CompilationUnitTree unit) {
        Tree parent = path == null ? null : path.getLeaf();
        Tree grandparent = path == null || path.getParentPath() == null ? null : path.getParentPath().getLeaf();
        String span = start >= 0 && end >= start && end <= source.length()
            ? source.substring((int) start, (int) end) : "";
        return switch (tree) {
            case AssignmentTree ignored -> parent instanceof AnnotationTree ? "annotation-element" : null;
            case MethodInvocationTree t -> isConstructor(t) ? "explicit-constructor-invocation" : null;
            case ExpressionStatementTree t -> {
                if (t.getExpression() instanceof MethodInvocationTree call && isConstructor(call))
                    yield "explicit-constructor-invocation";
                if (parent instanceof ForLoopTree loop && (loop.getInitializer().contains(t) || loop.getUpdate().contains(t)))
                    yield "for-header";
                yield null;
            }
            case MemberSelectTree t -> {
                if (span.startsWith("@") && catchNamePrefix(path)) yield "annotated-catch-qualification";
                if (t.getIdentifier().contentEquals("class")) yield "class-literal";
                if (t.getIdentifier().contentEquals("*") && parent instanceof ImportTree
                    || parent instanceof MethodInvocationTree call && call.getMethodSelect() == t
                    || t.getIdentifier().contentEquals("super") && (parent instanceof MemberSelectTree
                        || parent instanceof MemberReferenceTree ref && ref.getQualifierExpression() == t)
                    || receiverName(path, t)) yield "flattened-selector";
                yield typeOrUnresolvedName(path, t) ? "qualified-name" : null;
            }
            case IdentifierTree t -> {
                if (end < 0 && (enumInitializer(path, positions, unit)
                    || parent instanceof NewClassTree creation && creation.getIdentifier() == t
                        && enumInitializer(path.getParentPath(), positions, unit)))
                    yield "synthetic-enum-type";
                if (annotatedVarargsElement(path, source, end, positions, unit)) yield "annotated-varargs-element";
                if (t.getName().contentEquals("this") || t.getName().contentEquals("super")) {
                    if (parent instanceof MethodInvocationTree call && call.getMethodSelect() == t
                        && !call.getTypeArguments().isEmpty()) yield "constructor-keyword-with-type-arguments";
                    yield "this-or-super";
                }
                yield typeOrUnresolvedName(path, t) ? "type-or-unresolved-name" : null;
            }
            case BlockTree t -> {
                if (t.isStatic()) yield "static-initializer";
                if (!(parent instanceof MethodTree method) || !method.getName().contentEquals("<init>")) yield null;
                if (grandparent instanceof ClassTree owner && owner.getKind() == Tree.Kind.RECORD) {
                    long methodStart = positions.getStartPosition(unit, method);
                    if (methodStart >= 0 && methodStart < start) {
                        String header = source.substring((int) methodStart, (int) start)
                            .replaceAll("(?s)/\\*.*?\\*/|//[^\\r\\n]*", " ").stripTrailing();
                        if (header.endsWith(owner.getSimpleName().toString()) && !header.contains(")")) yield null;
                    }
                }
                yield "constructor-body";
            }
            case PatternCaseLabelTree ignored -> mixedCasePattern(path) ? "non-jls-mixed-switch-label" : null;
            case DeconstructionPatternTree ignored -> mixedCasePattern(path) ? "non-jls-mixed-switch-label" : null;
            case CaseTree t -> t.getCaseKind() == CaseTree.CaseKind.RULE ? "arrow-rule" : "colon-case";
            case BindingPatternTree ignored -> parent instanceof InstanceOfTree ? "instanceof-type-binding" : "switch-or-record-component";
            case ModifiersTree ignored -> {
                if (span.isEmpty() || span.equals("@")
                    || parent instanceof ClassTree owner && owner.getKind() == Tree.Kind.ANNOTATION_TYPE
                        && span.endsWith("@")
                    || parent instanceof VariableTree v && grandparent instanceof MethodTree m && m.getReceiverParameter() == v)
                    yield "empty-synthetic-or-split";
                if (grandparent instanceof BindingPatternTree && path.getParentPath().getParentPath() != null
                    && path.getParentPath().getParentPath().getLeaf() instanceof InstanceOfTree) {
                    if (span.equals("final")) yield "instanceof-bare-final";
                    if (span.startsWith("final")) yield "empty-synthetic-or-split";
                }
                yield "contiguous-modifiers";
            }
            case AnnotatedTypeTree t -> span.startsWith("@") && !span.endsWith("...")
                    && !(t.getUnderlyingType() instanceof ArrayTypeTree) && !creationType(path, t)
                    && !(parent instanceof MemberSelectTree && catchNamePrefix(path))
                ? "leading-annotated-type" : "distributed-annotations";
            case ArrayTypeTree t -> {
                if (parent instanceof ArrayTypeTree || parent instanceof NewArrayTree
                    || parent instanceof AnnotatedTypeTree && (grandparent instanceof ArrayTypeTree || grandparent instanceof NewArrayTree))
                    yield "nested-or-distributed-array-type";
                Tree element = t.getType();
                while (element instanceof ArrayTypeTree || element instanceof AnnotatedTypeTree)
                    element = element instanceof ArrayTypeTree a ? a.getType() : ((AnnotatedTypeTree) element).getUnderlyingType();
                long elementEnd = positions.getEndPosition(unit, element);
                String suffix = elementEnd >= 0 && elementEnd <= end
                    ? source.substring((int) elementEnd, (int) end).strip() : "";
                yield (suffix.startsWith("[") || suffix.startsWith("@")) && suffix.endsWith("]")
                    ? "outer-contiguous-array-type" : "nested-or-distributed-array-type";
            }
            case VariableTree t -> {
                if (end < 0) yield null;
                if (parent instanceof CatchTree) yield "ordinary-formal-or-catch-parameter";
                if (t.getType() != null && !span.contains("...") && (parent instanceof MethodTree m && m.getParameters().contains(t)
                    || parent instanceof LambdaExpressionTree lambda && lambda.getParameters().contains(t)))
                    yield "ordinary-formal-or-catch-parameter";
                var siblings = parent instanceof BlockTree b ? b.getStatements() : parent instanceof CaseTree c ? c.getStatements() : null;
                if (siblings != null && span.endsWith(";") && siblings.stream()
                    .noneMatch(sibling -> sibling != t && sibling instanceof VariableTree && positions.getStartPosition(unit, sibling) == start))
                    yield "single-local-declaration";
                yield null;
            }
            case ParameterizedTypeTree ignored -> annotatedVarargsElement(path, source, end, positions, unit)
                ? "annotated-varargs-element" : null;
            case NewClassTree ignored -> enumInitializer(path, positions, unit) ? "enum-constant-initializer" : null;
            case ClassTree t -> {
                if (t.getKind() == Tree.Kind.CLASS && parent instanceof CompilationUnitTree && end < 0)
                    yield "implicit-class";
                yield t.getSimpleName().isEmpty() ? "anonymous-class" : null;
            }
            case LiteralTree t -> switch (t.getKind()) {
                case INT_LITERAL, LONG_LITERAL -> span.startsWith("-") ? "absorbed-decimal-minus" : null;
                case STRING_LITERAL -> foldedString(span) ? "folded-string-concatenation" : null;
                default -> null;
            };
            default -> null;
        };
    }

    static boolean annotatedVarargsElement(TreePath path, String source, long end,
                                           SourcePositions positions, CompilationUnitTree unit) {
        if (end < 0 || path == null || !(path.getLeaf() instanceof ArrayTypeTree)) return false;
        TreePath outer = path.getParentPath();
        if (outer == null || !(outer.getLeaf() instanceof AnnotatedTypeTree type)) return false;
        long typeEnd = positions.getEndPosition(unit, type);
        return typeEnd >= end + 3 && source.startsWith("...", (int) typeEnd - 3)
            && type.getAnnotations().stream().anyMatch(a -> positions.getEndPosition(unit, a) == end);
    }

    static boolean catchNamePrefix(TreePath path) {
        while (path != null && path.getLeaf() instanceof MemberSelectTree) path = path.getParentPath();
        return path != null && path.getLeaf() instanceof UnionTypeTree;
    }

    static boolean creationType(TreePath path, Tree child) {
        while (path != null) {
            Tree parent = path.getLeaf();
            if (parent instanceof NewClassTree t) return t.getIdentifier() == child;
            if (parent instanceof NewArrayTree t) return t.getType() == child;
            if (!(parent instanceof ArrayTypeTree t && t.getType() == child
                || parent instanceof AnnotatedTypeTree a && a.getUnderlyingType() == child
                || parent instanceof ParameterizedTypeTree p && p.getType() == child)) return false;
            child = parent;
            path = path.getParentPath();
        }
        return false;
    }

    static boolean enumInitializer(TreePath path, SourcePositions positions, CompilationUnitTree unit) {
        if (path == null || !(path.getLeaf() instanceof VariableTree variable)
            || !(variable.getInitializer() instanceof NewClassTree)) return false;
        TreePath owner = path.getParentPath();
        return owner != null && owner.getLeaf().getKind() == Tree.Kind.ENUM
            && variable.getType() != null && positions.getEndPosition(unit, variable.getType()) < 0;
    }

    static boolean mixedCasePattern(TreePath path) {
        while (path != null && (path.getLeaf() instanceof PatternTree || path.getLeaf() instanceof PatternCaseLabelTree))
            path = path.getParentPath();
        return path != null && path.getLeaf() instanceof CaseTree branch
            && branch.getLabels().stream().anyMatch(label -> !(label instanceof PatternCaseLabelTree));
    }

    static boolean isConstructor(MethodInvocationTree call) {
        Tree selector = call.getMethodSelect();
        if (selector instanceof IdentifierTree id)
            return id.getName().contentEquals("this") || id.getName().contentEquals("super");
        return selector instanceof MemberSelectTree q && q.getIdentifier().contentEquals("super");
    }

    static boolean typeOrUnresolvedName(TreePath path, Tree child) {
        if (path == null) return false;
        return switch (path.getLeaf()) {
            case VariableTree t -> t.getType() == child;
            case MethodTree t -> t.getReturnType() == child || t.getThrows().contains(child);
            case NewClassTree t -> t.getIdentifier() == child || t.getTypeArguments().contains(child);
            case NewArrayTree t -> t.getType() == child;
            case TypeCastTree t -> t.getType() == child;
            case InstanceOfTree t -> t.getType() == child;
            case DeconstructionPatternTree t -> t.getDeconstructor() == child;
            case PackageTree t -> t.getPackageName() == child;
            case ModuleTree t -> t.getName() == child;
            case ExportsTree ignored -> true;
            case OpensTree ignored -> true;
            case ProvidesTree ignored -> true;
            case RequiresTree ignored -> true;
            case UsesTree ignored -> true;
            case MethodInvocationTree t -> t.getTypeArguments().contains(child);
            case MemberReferenceTree t -> t.getQualifierExpression() == child || t.getTypeArguments() != null && t.getTypeArguments().contains(child);
            case ClassTree t -> t.getExtendsClause() == child || t.getImplementsClause().contains(child) || t.getPermitsClause().contains(child);
            case AnnotationTree t -> t.getAnnotationType() == child;
            case MemberSelectTree t -> t.getExpression() == child
                && (t.getIdentifier().contentEquals("class") || typeOrUnresolvedName(path.getParentPath(), t));
            case ImportTree ignored -> true;
            case ParameterizedTypeTree ignored -> true;
            case ArrayTypeTree ignored -> true;
            case AnnotatedTypeTree ignored -> true;
            case IntersectionTypeTree ignored -> true;
            case UnionTypeTree ignored -> true;
            case TypeParameterTree ignored -> true;
            case WildcardTree ignored -> true;
            default -> false;
        };
    }

    static boolean receiverName(TreePath path, Tree child) {
        while (path != null && path.getLeaf() instanceof MemberSelectTree q && q.getExpression() == child) {
            child = q;
            path = path.getParentPath();
        }
        return path != null && path.getLeaf() instanceof VariableTree v && v.getNameExpression() == child;
    }

    static boolean foldedString(String span) {
        if (!span.startsWith("\"")) return false;
        String delimiter = span.startsWith("\"\"\"") ? "\"\"\"" : "\"";
        for (int i = delimiter.length(); i < span.length(); i++) {
            if (span.charAt(i) == '\\') i++;
            else if (span.startsWith(delimiter, i)) return i + delimiter.length() < span.length();
        }
        return false;
    }
}
