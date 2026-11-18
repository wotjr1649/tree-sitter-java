// javac parse-only oracle for tree-sitter-java.
//
// Verdict = the diagnostics javac's parser reports (JavacTask.parse()), nothing later: no enter, attribute or flow.
// Fixed level: --release 25, preview off, on the pinned JDK (EXPECTED_RUNTIME). Any other JDK is a runner fault.
//
// Always start it with the JVM class path set to one existing EMPTY directory, so that no plugin or annotation processor
// found on a class path can add diagnostics (the runner refuses to run otherwise). Not `-cp ""`: an empty class path
// element means the current directory, where javac would find plugins.
//
//   mkdir -p build/oracle/empty
//   java -cp build/oracle/empty oracle/runner/ParseOracle.java --self-test
//   java -cp build/oracle/empty oracle/runner/ParseOracle.java --cases oracle/data/cases/<set>.jsonl --out oracle/data/verdicts/<name>.json
//
// Exit 0: done. 1: the self-test failed. 2: runner fault (crash, unreadable or inconsistent case file, wrong JDK);
// a fault is never recorded as a rejection.
import com.sun.source.util.JavacTask;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;

public class ParseOracle {
    static final String RELEASE = "25";
    static final String EXPECTED_RUNTIME = "25.0.5+8-LTS"; // Eclipse Temurin 25.0.5+8
    static final String EXPECTED_VENDOR = "Eclipse Adoptium";
    // No --enable-preview: preview is off. parse() reports only the preview diagnostics the parser itself emits (for
    // example a preview keyword or module syntax); a preview feature that javac rejects in a later phase is accepted
    // here (primitive type patterns in switch are: javac --release 25 rejects them, parse() does not).
    // -proc:none: no annotation processing.
    static final List<String> OPTIONS = List.of("--release", RELEASE, "-proc:none");
    static final String DEFAULT_FILE = "Case.java";
    // The optional case field "file" is the virtual file name: a plain Java file name, nothing else.
    static final java.util.regex.Pattern FILE_NAME = java.util.regex.Pattern.compile("[A-Za-z0-9_.-]{1,64}\\.java");

    static class Fault extends RuntimeException {
        Fault(String m) { super(m); }
    }

    public static void main(String[] args) {
        try {
            System.exit(run(args));
        } catch (Throwable t) {
            System.err.println("runner fault: " + t);
            System.exit(2);
        }
    }

    static int run(String[] args) throws Exception {
        String cases = null, out = null;
        boolean selfTest = false;
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--self-test" -> selfTest = true;
                case "--cases" -> cases = arg(args, ++i);
                case "--out" -> out = arg(args, ++i);
                default -> throw new Fault("unknown argument " + args[i]);
            }
        }
        requireJdk();
        if (selfTest) return selfTest();
        if (cases == null || out == null) throw new Fault("need --cases and --out (or --self-test)");
        byte[] caseBytes = readBytes(cases);
        // The runner hashes the file the launcher is running, never a file the caller names.
        String running = System.getProperty("jdk.launcher.sourcefile");
        if (running == null) throw new Fault("run the runner as a source file: java -cp <empty dir> ParseOracle.java");
        byte[] runnerBytes = readBytes(running);

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("api", "com.sun.source.util.JavacTask.parse()");
        meta.put("case_count", 0);
        meta.put("cases_sha256", sha256(caseBytes));
        meta.put("java.runtime.version", System.getProperty("java.runtime.version"));
        meta.put("java.vendor", System.getProperty("java.vendor"));
        meta.put("options", OPTIONS);
        meta.put("preview", false);
        meta.put("release", RELEASE);
        meta.put("runner_sha256", sha256(runnerBytes));
        meta.put("source_encoding", "UTF-8");

        Map<String, List<String>> verdicts = new LinkedHashMap<>();
        for (String line : decode(caseBytes, cases).split("\n", -1)) {
            if (line.isBlank()) continue;
            Object parsed = new Json(line).value();
            if (!(parsed instanceof Map<?, ?> c)) throw new Fault("case line is not an object: " + line);
            String id = str(c, "id"), source = str(c, "source"), sha = str(c, "sha256");
            Object file = c.get("file");
            if (file != null && !(file instanceof String f && FILE_NAME.matcher(f).matches()))
                throw new Fault("case " + id + ": file must match " + FILE_NAME.pattern());
            if (!sha.equals(sha256(source.getBytes(StandardCharsets.UTF_8))))
                throw new Fault("case " + id + ": sha256 does not match its source");
            if (verdicts.put(id, parse(file == null ? DEFAULT_FILE : (String) file, source)) != null)
                throw new Fault("duplicate case id " + id);
        }
        if (verdicts.isEmpty()) throw new Fault(cases + " has no cases");
        meta.put("case_count", verdicts.size());
        Files.write(Path.of(out), render(meta, verdicts).getBytes(StandardCharsets.UTF_8));
        System.out.println("wrote " + out + " (" + verdicts.size() + " cases, " + System.getProperty("java.runtime.version") + ")");
        return 0;
    }

    static void requireJdk() {
        String rt = System.getProperty("java.runtime.version"), vendor = System.getProperty("java.vendor");
        if (!EXPECTED_RUNTIME.equals(rt) || !EXPECTED_VENDOR.equals(vendor))
            throw new Fault("expected " + EXPECTED_VENDOR + " " + EXPECTED_RUNTIME + ", running " + vendor + " " + rt);
        // javac loads plugins and processors through the JVM's class and module paths. Verdicts must not depend on them.
        String cp = System.getProperty("java.class.path", ""), mp = System.getProperty("jdk.module.path");
        if (mp != null && !mp.isEmpty()) throw new Fault("start the runner without a module path; jdk.module.path=[" + mp + "]");
        if (cp.contains(java.io.File.pathSeparator) || !emptyDirectory(cp))
            throw new Fault("start the runner with the class path set to one existing empty directory"
                + " (java -cp <empty dir> ParseOracle.java); java.class.path=[" + cp + "]");
    }

    static boolean emptyDirectory(String dir) {
        if (dir.isEmpty()) return false;
        try (var entries = Files.newDirectoryStream(Path.of(dir))) {
            return !entries.iterator().hasNext();
        } catch (IOException | RuntimeException e) {
            return false;
        }
    }

    static String arg(String[] a, int i) {
        if (i >= a.length) throw new Fault("missing value for " + a[i - 1]);
        return a[i];
    }

    static byte[] readBytes(String path) {
        try {
            return Files.readAllBytes(Path.of(path));
        } catch (IOException e) {
            throw new Fault("cannot read " + path + ": " + e);
        }
    }

    static String decode(byte[] bytes, String what) {
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            throw new Fault(what + " is not valid UTF-8");
        }
    }

    static String sha256(byte[] b) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));
    }

    static String str(Map<?, ?> c, String key) {
        if (!(c.get(key) instanceof String s)) throw new Fault("case without string field " + key);
        return s;
    }

    static class Source extends SimpleJavaFileObject {
        final String text;
        Source(String name, String text) {
            super(URI.create("string:///" + name), Kind.SOURCE);
            this.text = text;
        }
        @Override public CharSequence getCharContent(boolean ignore) { return text; }
    }

    static JavacTask task(String name, String source, DiagnosticCollector<JavaFileObject> diags) {
        JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
        if (javac == null) throw new Fault("no system Java compiler (a JDK, not a JRE, is required)");
        return (JavacTask) javac.getTask(null, null, diags, OPTIONS, null, List.of(new Source(name, source)));
    }

    // The error codes of the parse phase; [] means accepted. Warnings are not part of the verdict.
    static List<String> parse(String name, String source) throws IOException {
        DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
        task(name, source, diags).parse();
        return errors(diags);
    }

    static List<String> errors(DiagnosticCollector<JavaFileObject> diags) {
        List<String> codes = new ArrayList<>();
        for (Diagnostic<? extends JavaFileObject> d : diags.getDiagnostics())
            if (d.getKind() == Diagnostic.Kind.ERROR) codes.add(d.getCode());
        return codes;
    }

    static String render(Map<String, Object> meta, Map<String, List<String>> verdicts) {
        StringBuilder sb = new StringBuilder("{\n  \"meta\": {\n");
        int i = 0;
        for (Map.Entry<String, Object> e : meta.entrySet())
            sb.append("    ").append(quote(e.getKey())).append(": ").append(value(e.getValue()))
                .append(++i < meta.size() ? ",\n" : "\n");
        sb.append("  },\n  \"verdicts\": {\n");
        i = 0;
        for (Map.Entry<String, List<String>> e : verdicts.entrySet())
            sb.append("    ").append(quote(e.getKey())).append(": ").append(value(e.getValue()))
                .append(++i < verdicts.size() ? ",\n" : "\n");
        return sb.append("  }\n}\n").toString();
    }

    static String value(Object v) {
        if (v instanceof List<?> l) {
            List<String> parts = new ArrayList<>();
            for (Object o : l) parts.add(value(o));
            return "[" + String.join(", ", parts) + "]";
        }
        return v instanceof String s ? quote(s) : String.valueOf(v);
    }

    static String quote(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        return sb.append('"').toString();
    }

    // --self-test: syntax accepted, syntax rejected, a semantic error that parse-only accepts (out of scope).
    static int selfTest() throws Exception {
        int failures = 0;
        System.out.println("java.vendor=" + System.getProperty("java.vendor")
            + " java.runtime.version=" + System.getProperty("java.runtime.version")
            + " release=" + RELEASE + " preview=off");

        List<String> accepted = parse(DEFAULT_FILE, "class A { void f() { int x = 1; } }");
        failures += check("syntax accepted", accepted.isEmpty(), accepted);

        List<String> rejected = parse(DEFAULT_FILE, "class A { void f( { } }");
        failures += check("syntax rejected", !rejected.isEmpty(), rejected);

        // A type mismatch and an undefined name: javac only finds them after parsing.
        String semantic = "class A { int x = \"s\"; void g() { undefinedName(); } }";
        List<String> parseOnly = parse(DEFAULT_FILE, semantic);
        DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
        task(DEFAULT_FILE, semantic, diags).analyze();
        List<String> analyzed = errors(diags);
        failures += check("semantic error accepted by parse-only (out of scope)", parseOnly.isEmpty(), parseOnly);
        failures += check("same input is rejected by analyze() (so the error is real)", analyzed.size() >= 2, analyzed);

        // The parser does not look at the file name: a module declaration parses under any name.
        String module = "module m { requires java.base; }";
        List<String> asCase = parse(DEFAULT_FILE, module), asModuleInfo = parse("module-info.java", module);
        failures += check("module declaration accepted as Case.java and as module-info.java",
            asCase.isEmpty() && asModuleInfo.isEmpty(), List.of(asCase.toString(), asModuleInfo.toString()));

        System.out.println(failures == 0 ? "self-test passed" : "self-test FAILED (" + failures + ")");
        return failures == 0 ? 0 : 1;
    }

    static int check(String name, boolean ok, Object detail) {
        System.out.println((ok ? "PASS " : "FAIL ") + name + " -> " + detail);
        return ok ? 0 : 1;
    }

    // Small JSON reader (objects, arrays, strings, numbers, literals) so the runner needs no library.
    static class Json {
        final String s;
        int i;
        Json(String s) { this.s = s; }

        Object value() {
            Object v = next();
            ws();
            if (i != s.length()) throw new Fault("trailing characters in JSON");
            return v;
        }

        void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

        Object next() {
            ws();
            if (i >= s.length()) throw new Fault("unexpected end of JSON");
            char c = s.charAt(i);
            if (c == '{') {
                i++;
                Map<String, Object> m = new LinkedHashMap<>();
                ws();
                if (s.charAt(i) == '}') { i++; return m; }
                while (true) {
                    ws();
                    String k = string();
                    ws();
                    expect(':');
                    if (m.put(k, next()) != null) throw new Fault("duplicate JSON key " + k);
                    ws();
                    if (s.charAt(i) == ',') { i++; continue; }
                    expect('}');
                    return m;
                }
            }
            if (c == '[') {
                i++;
                List<Object> l = new ArrayList<>();
                ws();
                if (s.charAt(i) == ']') { i++; return l; }
                while (true) {
                    l.add(next());
                    ws();
                    if (s.charAt(i) == ',') { i++; continue; }
                    expect(']');
                    return l;
                }
            }
            if (c == '"') return string();
            int start = i;
            while (i < s.length() && ",}] \t\r\n".indexOf(s.charAt(i)) < 0) i++;
            String lit = s.substring(start, i);
            return switch (lit) {
                case "true" -> Boolean.TRUE;
                case "false" -> Boolean.FALSE;
                case "null" -> null;
                default -> {
                    try { yield Double.valueOf(lit); } catch (NumberFormatException e) { throw new Fault("bad JSON literal " + lit); }
                }
            };
        }

        void expect(char c) {
            if (i >= s.length() || s.charAt(i) != c) throw new Fault("expected '" + c + "' at " + i);
            i++;
        }

        String string() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                if (i >= s.length()) throw new Fault("unterminated JSON string");
                char c = s.charAt(i++);
                if (c == '"') return sb.toString();
                if (c != '\\') { sb.append(c); continue; }
                char e = s.charAt(i++);
                switch (e) {
                    case '"', '\\', '/' -> sb.append(e);
                    case 'n' -> sb.append('\n');
                    case 't' -> sb.append('\t');
                    case 'r' -> sb.append('\r');
                    case 'b' -> sb.append('\b');
                    case 'f' -> sb.append('\f');
                    case 'u' -> { sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; }
                    default -> throw new Fault("bad JSON escape \\" + e);
                }
            }
        }
    }
}
