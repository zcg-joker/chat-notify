const test = require("node:test");
const assert = require("node:assert/strict");
const { createPromptExcerpt } = require("../src/core/prompt-excerpt.js");

test("returns empty string for empty input", () => {
  assert.equal(createPromptExcerpt(""), "");
  assert.equal(createPromptExcerpt(" \n\t "), "");
  assert.equal(createPromptExcerpt(null), "");
});

test("collapses whitespace", () => {
  assert.equal(createPromptExcerpt("hello\n\nworld\tfrom   chatgpt"), "hello world from chatgpt");
});

test("keeps short Chinese text", () => {
  assert.equal(createPromptExcerpt("请帮我总结这篇论文"), "请帮我总结这篇论文");
});

test("truncates long mixed text to visible character limit", () => {
  assert.equal(
    createPromptExcerpt("请帮我总结这篇论文并提取关键观点，然后给出三个行动建议", 12),
    "请帮我总结这篇论文并提..."
  );
});

test("does not append ellipsis when text exactly matches the limit", () => {
  assert.equal(createPromptExcerpt("abcdef", 6), "abcdef");
});
