const assert = require("node:assert/strict");
const Module = require("node:module");

class Uri {
  constructor(value) {
    this.value = value;
  }
  static joinPath(base, ...segments) {
    return new Uri(`${base.value}/${segments.join("/")}`);
  }
  toString() {
    return this.value;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return { Uri };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { renderProblemHtml } = require("../dist/webview/problemRenderer.js");

const imageUrl = "https://assets.leetcode.com/uploads/2021/01/18/uniquebstn3.jpg";
const problem95 = {
  internalId: "95",
  frontendId: "95",
  title: "Unique Binary Search Trees II",
  translatedTitle: "不同的二叉搜索树 II",
  titleSlug: "unique-binary-search-trees-ii",
  difficulty: "Medium",
  paidOnly: false,
  status: null,
  content: "",
  translatedContent: `<p>示例 1：</p><img alt="" src="${imageUrl}" style="width: 600px; height: 148px;" />`,
  tags: [],
  codeSnippets: [],
  hints: [],
};
const webview = {
  cspSource: "vscode-webview://leetdock-test",
  asWebviewUri: (uri) => new Uri(`vscode-resource:${uri.value}`),
};

const html = renderProblemHtml(webview, new Uri("file:///extension"), problem95);

assert.match(
  html,
  new RegExp(`<img[^>]+src="${imageUrl.replaceAll(".", "\\.")}"`),
  "the problem sanitizer must preserve question 95's image",
);
assert.match(
  html,
  /img-src[^";]*(?:https:\/\/assets\.leetcode\.com|https:\/\/\*\.leetcode\.com)/,
  "the Webview CSP must allow question 95's image host",
);

console.log("LeetDock problem renderer checks passed.");
