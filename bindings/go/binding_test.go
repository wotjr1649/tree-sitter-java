package tree_sitter_java_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_java "github.com/wotjr1649/tree-sitter-java/v2/bindings/go"
)

func TestCanParseJava(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_java.Language())
	parser := tree_sitter.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(language); err != nil {
		t.Fatalf("Error loading Java grammar: %v", err)
	}
	tree := parser.Parse([]byte("class Example {}"), nil)
	if tree == nil {
		t.Fatal("Java parser returned no tree")
	}
	defer tree.Close()
	if root := tree.RootNode(); root.HasError() {
		t.Fatalf("Error parsing Java: %s", root.ToSexp())
	}
}
