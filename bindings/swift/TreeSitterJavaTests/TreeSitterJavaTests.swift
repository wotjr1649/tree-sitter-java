import XCTest
import SwiftTreeSitter
import TreeSitterJava

final class TreeSitterJavaTests: XCTestCase {
    func testCanParseJava() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_java())
        try parser.setLanguage(language)
        let root = try XCTUnwrap(parser.parse("class Example {}")?.rootNode)
        XCTAssertFalse(root.hasError)
    }
}
