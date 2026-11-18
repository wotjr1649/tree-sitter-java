const assert = require("node:assert");
const { test } = require("node:test");

const Parser = require("tree-sitter");

test("can parse Java", () => {
  const parser = new Parser();
  parser.setLanguage(require("."));
  assert.equal(parser.parse("class Example {}").rootNode.hasError, false);
});
