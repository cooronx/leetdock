const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
let quickPickOptions;
class EventEmitter {
  constructor() {
    this.event = () => ({ dispose() {} });
  }
  fire() {}
  dispose() {}
}
class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}
class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}
class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}
const vscodeStub = {
  EventEmitter,
  TreeItem,
  ThemeIcon,
  ThemeColor,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  Uri: { parse: (value) => ({ value }) },
  window: {
    showQuickPick: async (items, options) => {
      quickPickOptions = options;
      return items[0];
    },
  },
};
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { LeetCodeClient } = require("../dist/leetcode/client.js");
const { LeetDockTreeProvider } = require("../dist/explorer/leetDockTreeProvider.js");
const { TagService } = require("../dist/tag/tagService.js");
const manifest = require("../package.json");

const arrayTag = { name: "Array", translatedName: "数组", slug: "array" };
const hashTag = { name: "Hash Table", translatedName: "哈希表", slug: "hash-table" };
const firstProblem = {
  frontendId: "1",
  title: "Two Sum",
  translatedTitle: "两数之和",
  titleSlug: "two-sum",
  difficulty: "Easy",
  paidOnly: false,
  status: null,
};
const secondProblem = {
  frontendId: "4",
  title: "Median of Two Sorted Arrays",
  translatedTitle: "寻找两个正序数组的中位数",
  titleSlug: "median-of-two-sorted-arrays",
  difficulty: "Hard",
  paidOnly: true,
  status: "TRIED",
};

async function checkClientQueries() {
  const requests = [];
  const responses = [
    {
      data: {
        questionTagTypeWithTags: [
          {
            tagRelation: [
              { tag: { name: "Array", nameTranslated: "数组", slug: "array" } },
              { tag: { name: "Hash Table", nameTranslated: "哈希表", slug: "hash-table" } },
            ],
          },
          {
            tagRelation: [
              { tag: { name: "Array duplicate", nameTranslated: "数组", slug: "array" } },
            ],
          },
        ],
      },
    },
    {
      data: {
        problemsetQuestionList: {
          questions: [{
            frontendQuestionId: "1",
            title: "Two Sum",
            titleCn: "两数之和",
            titleSlug: "two-sum",
            difficulty: "EASY",
            paidOnly: false,
            status: "NOT_STARTED",
          }],
          total: 2371,
          hasMore: true,
        },
      },
    },
  ];
  const client = new LeetCodeClient(
    { getCookie: async () => undefined },
    {
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), init });
        const payload = responses.shift();
        assert.notEqual(payload, undefined);
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      maxRetries: 0,
      minRequestIntervalMs: 0,
    },
  );

  assert.deepEqual(await client.getTags(), [arrayTag, hashTag]);
  assert.deepEqual(await client.getTagQuestions("array", 0, 50), {
    questions: [firstProblem],
    total: 2371,
    hasMore: true,
  });
  assert.deepEqual(
    requests.map(({ init }) => JSON.parse(init.body).operationName),
    ["QuestionTagTypeWithTags", "ProblemsetQuestionList"],
  );
  assert.deepEqual(JSON.parse(requests[1].init.body).variables, {
    limit: 50,
    skip: 0,
    filters: { tags: ["array"] },
  });
  assert.equal(requests[1].init.headers.Referer, "https://leetcode.cn/tag/array/problemset/");
  assert.equal(requests[0].init.headers.Cookie, undefined);
  assert.equal(responses.length, 0);
}

async function checkService() {
  let pageCalls = 0;
  const service = new TagService({
    getTags: async () => [arrayTag, hashTag],
    getTagQuestions: async (_slug, skip) => {
      pageCalls += 1;
      return skip === 0
        ? { questions: [firstProblem, secondProblem], total: 3, hasMore: true }
        : {
          questions: [
            secondProblem,
            { ...firstProblem, frontendId: "15", titleSlug: "three-sum" },
          ],
          total: 3,
          hasMore: false,
        };
    },
  });
  const expectedOrder = [arrayTag, hashTag].sort((left, right) =>
    (left.translatedName ?? left.name).localeCompare(
      right.translatedName ?? right.name,
      "zh-CN",
      { sensitivity: "base" },
    )
  );
  assert.deepEqual(await service.loadCatalog(), expectedOrder);
  assert.equal((await service.loadDetail(arrayTag)).questions.length, 2);
  const loaded = await service.loadMore("array");
  assert.equal(loaded.questions.length, 3);
  assert.equal(pageCalls, 2);
  assert.equal(service.markAccepted("two-sum"), true);
  assert.equal(service.getDetailSnapshot("array").questions[0].status, "AC");
  assert.equal(service.markAccepted("two-sum"), false);

  let resolveCatalog;
  const stale = new TagService({
    getTags: () => new Promise((resolve) => { resolveCatalog = resolve; }),
  });
  const pending = stale.loadCatalog();
  stale.reset();
  resolveCatalog([arrayTag]);
  await assert.rejects(pending, (error) => error?.kind === "stale-session");
}

async function checkExplorer() {
  const tags = new TagService({
    getTags: async () => [arrayTag, hashTag],
    getTagQuestions: async () => ({
      questions: [firstProblem, secondProblem],
      total: 51,
      hasMore: true,
    }),
  });
  const dailyState = {
    challenge: { date: "2026-08-07", problem: firstProblem },
    challengeSource: "network",
    signedIn: false,
    streakStatus: "signed-out",
  };
  const provider = new LeetDockTreeProvider(
    {
      snapshot: { status: "signed-out" },
      onDidChange: () => ({ dispose() {} }),
    },
    { snapshot: dailyState, load: async () => dailyState, markCompleted: () => false },
    { reset() {} },
    { reset() {} },
    tags,
  );

  await provider.refreshTags(true);
  const root = await provider.getChildren();
  const library = root.find((node) => node.kind === "library");
  const libraryChildren = await provider.getChildren(library);
  assert.deepEqual(libraryChildren.map((node) => node.kind), ["tags", "companies"]);
  const tagGroup = libraryChildren[0];
  assert.equal(provider.getTreeItem(tagGroup).label, "标签/tag");
  assert.equal(provider.getTreeItem(tagGroup).description, "2 个");
  assert.equal(provider.getParent(tagGroup).kind, "library");

  const tagNodes = await provider.getChildren(tagGroup);
  assert.equal(tagNodes[0].kind, "tag-search");
  assert.equal(provider.getTreeItem(tagNodes[0]).command.command, "leetdock.searchTag");
  const arrayNode = tagNodes.find((node) => node.kind === "tag" && node.summary.slug === "array");
  assert.equal(provider.getTreeItem(arrayNode).label, "数组");
  assert.match(provider.getTreeItem(arrayNode).tooltip, /数组\nArray · array/);
  assert.equal(provider.getParent(arrayNode).kind, "tags");

  const picked = await provider.pickTag();
  assert.equal(picked.kind, "tag");
  assert.equal(quickPickOptions.matchOnDescription, true);
  assert.equal(quickPickOptions.matchOnDetail, true);

  await provider.refreshTag("array");
  const refreshedTags = await provider.getChildren(tagGroup);
  const refreshedArray = refreshedTags.find(
    (node) => node.kind === "tag" && node.summary.slug === "array",
  );
  assert.equal(provider.getTreeItem(refreshedArray).description, "51 题");
  const questions = await provider.getChildren(refreshedArray);
  assert.deepEqual(questions.map((node) => node.kind), ["tag-problem", "tag-problem", "tag-more"]);
  const firstItem = provider.getTreeItem(questions[0]);
  assert.equal(firstItem.label, "1. 两数之和");
  assert.equal(firstItem.command.command, "leetdock.openProblem");
  assert.equal(provider.getTreeItem(questions[1]).description, "困难 · 尝试过");
  assert.equal(provider.getTreeItem(questions[2]).command.command, "leetdock.loadMoreTag");
  assert.equal(provider.getParent(questions[0]).kind, "tag");

  provider.markTagProblemAccepted("two-sum");
  const accepted = (await provider.getChildren(refreshedArray))[0];
  assert.equal(provider.getTreeItem(accepted).description, "简单 · 已通过");
  provider.dispose();
}

function checkManifest() {
  const commands = new Set(manifest.contributes.commands.map(({ command }) => command));
  for (const command of [
    "leetdock.searchTag",
    "leetdock.refreshTags",
    "leetdock.refreshTag",
    "leetdock.loadMoreTag",
  ]) {
    assert.equal(commands.has(command), true, `missing command: ${command}`);
  }
}

Promise.all([
  checkClientQueries(),
  checkService(),
  checkExplorer(),
])
  .then(() => {
    checkManifest();
    console.log("tag library checks passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
