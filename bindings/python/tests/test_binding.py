from unittest import TestCase

import tree_sitter, tree_sitter_java


class TestLanguage(TestCase):
    def test_can_parse_java(self):
        language = tree_sitter.Language(tree_sitter_java.language())
        parser = tree_sitter.Parser(language)
        self.assertFalse(parser.parse(b"class Example {}").root_node.has_error)
