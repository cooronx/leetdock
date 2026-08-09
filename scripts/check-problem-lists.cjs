const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
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
};
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { LeetCodeClient } = require("../dist/leetcode/client.js");
const { ProblemListService } = require("../dist/problemList/problemListService.js");
const { LeetDockTreeProvider } = require("../dist/explorer/leetDockTreeProvider.js");
const manifest = require("../package.json");

const cookie = "LEETCODE_SESSION=session; csrftoken=csrf-token";
const createdList = { name: "面试准备", slug: "interview", source: "created" };
const collectedList = { name: "经典题单", slug: "classic", source: "collected" };
const firstProblem = {
  frontendId: "1",
  title: "Two Sum",
  translatedTitle: "两数之和",
  titleSlug: "two-sum",
  difficulty: "Easy",
  paidOnly: false,
  status: null,
  previouslySolved: false,
};
const secondProblem = {
  frontendId: "3",
  title: "Longest Substring Without Repeating Characters",
  translatedTitle: "无重复字符的最长子串",
  titleSlug: "longest-substring-without-repeating-characters",
  difficulty: "Medium",
  paidOnly: false,
  status: "TRIED",
  previouslySolved: false,
};
const pastSolvedProblem = {
  frontendId: "42",
  title: "Trapping Rain Water",
  translatedTitle: "接雨水",
  titleSlug: "trapping-rain-water",
  difficulty: "Hard",
  paidOnly: false,
  status: null,
  previouslySolved: true,
};

async function checkClientQueries() {
  const requests = [];
  const responses = [
    {
      data: {
        myCreatedFavoriteList: {
          favorites: [
            { name: "面试准备", slug: "interview", favoriteType: "NORMAL" },
            { name: "动态未完成", slug: "smart", favoriteType: "SMART_LIST" },
          ],
        },
        myCollectedFavoriteList: {
          favorites: [
            { name: "重复收藏", slug: "interview", favoriteType: "NORMAL" },
            { name: "经典题单", slug: "classic", favoriteType: "NORMAL" },
          ],
        },
      },
    },
    {
      data: {
        favoriteQuestionList: {
          questions: [
            {
              questionFrontendId: "1",
              title: "Two Sum",
              translatedTitle: "两数之和",
              titleSlug: "two-sum",
              difficulty: "EASY",
              paidOnly: false,
              status: null,
            },
            {
              questionFrontendId: "3",
              title: "Longest Substring Without Repeating Characters",
              translatedTitle: "无重复字符的最长子串",
              titleSlug: "longest-substring-without-repeating-characters",
              difficulty: "MEDIUM",
              paidOnly: false,
              status: "ATTEMPTED",
            },
            {
              questionFrontendId: "42",
              title: "Trapping Rain Water",
              translatedTitle: "接雨水",
              titleSlug: "trapping-rain-water",
              difficulty: "HARD",
              paidOnly: false,
              status: "PAST_SOLVED",
            },
          ],
          totalLength: 51,
          hasMore: true,
        },
      },
    },
    {
      data: {
        favoriteUserQuestionProgressV2: {
          numAcceptedQuestions: [
            { count: 1, difficulty: "EASY" },
            { count: 2, difficulty: "MEDIUM" },
          ],
          numFailedQuestions: [{ count: 4, difficulty: "MEDIUM" }],
          numUntouchedQuestions: [{ count: 44, difficulty: "HARD" }],
        },
      },
    },
    { data: { favoriteQuestionAcStatus: true } },
  ];
  const client = new LeetCodeClient(
    { getCookie: async () => cookie },
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

  assert.deepEqual(await client.getMyProblemLists(), [createdList, collectedList]);
  assert.deepEqual(await client.getProblemListQuestions("interview", 0, 50), {
    questions: [firstProblem, secondProblem, pastSolvedProblem],
    total: 51,
    hasMore: true,
  });
  assert.deepEqual(await client.getProblemListProgress("interview"), {
    accepted: 3,
    failed: 4,
    untouched: 44,
  });
  assert.equal(
    await client.getProblemListQuestionAccepted("interview", "two-sum"),
    true,
  );

  assert.deepEqual(
    requests.map(({ init }) => JSON.parse(init.body).operationName),
    [
      "MyFavoriteLists",
      "FavoriteQuestionList",
      "FavoriteUserQuestionProgress",
      "FavoriteQuestionAcStatus",
    ],
  );
  assert.equal(requests[0].init.headers.Cookie, cookie);
  assert.equal(requests[0].init.headers["X-CSRFToken"], "csrf-token");
  assert.equal(
    requests[1].init.headers.Referer,
    "https://leetcode.cn/problem-list/interview/",
  );
  assert.deepEqual(JSON.parse(requests[1].init.body).variables, {
    favoriteSlug: "interview",
    skip: 0,
    limit: 50,
  });
  assert.equal(responses.length, 0);
}

async function checkAuthenticationRequired() {
  let requests = 0;
  const client = new LeetCodeClient(
    { getCookie: async () => undefined },
    {
      fetchImplementation: async () => {
        requests += 1;
        throw new Error("request should not be sent");
      },
      maxRetries: 0,
      minRequestIntervalMs: 0,
    },
  );
  await assert.rejects(
    client.getMyProblemLists(),
    (error) => error?.kind === "authentication",
  );
  assert.equal(requests, 0);
}

async function checkInMemoryService() {
  let pageCalls = 0;
  let progressAccepted = 0;
  const service = new ProblemListService({
    getMyProblemLists: async () => [createdList],
    getProblemListQuestions: async (_slug, skip) => {
      pageCalls += 1;
      return skip === 0
        ? { questions: [firstProblem, secondProblem], total: 3, hasMore: true }
        : {
          questions: [{
            ...secondProblem,
            frontendId: "42",
            title: "Trapping Rain Water",
            translatedTitle: "接雨水",
            titleSlug: "trapping-rain-water",
            difficulty: "Hard",
            status: null,
            previouslySolved: false,
          }],
          total: 3,
          hasMore: false,
        };
    },
    getProblemListProgress: async () => ({
      accepted: progressAccepted,
      failed: 1,
      untouched: 2 - progressAccepted,
    }),
    getProblemListQuestionAccepted: async () => true,
  });

  assert.deepEqual(await service.loadCatalog(), [createdList]);
  const detail = await service.loadDetail(createdList);
  assert.equal(detail.questions.length, 2);
  assert.equal(detail.progress.accepted, 0);
  assert.equal((await service.loadMore("interview")).questions.length, 3);
  assert.equal(pageCalls, 2);

  progressAccepted = 1;
  await service.refreshLoadedAfterAccepted("two-sum");
  assert.equal(service.getDetailSnapshot("interview").progress.accepted, 1);
  assert.equal(service.getDetailSnapshot("interview").questions[0].status, "AC");

  let resolveCatalog;
  const staleService = new ProblemListService({
    getMyProblemLists: () => new Promise((resolve) => {
      resolveCatalog = resolve;
    }),
  });
  const pending = staleService.loadCatalog();
  staleService.reset();
  resolveCatalog([createdList]);
  await assert.rejects(pending, (error) => error?.kind === "stale-session");
  assert.equal(staleService.catalogSnapshot, undefined);

  service.reset();
  assert.equal(service.catalogSnapshot, undefined);
  assert.equal(service.getDetailSnapshot("interview"), undefined);
}

async function checkExplorerPresentation() {
  const problemLists = new ProblemListService({
    getMyProblemLists: async () => [createdList, collectedList],
    getProblemListQuestions: async () => ({
      questions: [firstProblem, pastSolvedProblem],
      total: 3,
      hasMore: true,
    }),
    getProblemListProgress: async () => ({ accepted: 1, failed: 1, untouched: 1 }),
    getProblemListQuestionAccepted: async () => true,
  });
  const dailyState = {
    challenge: { date: "2026-08-06", problem: firstProblem },
    challengeSource: "network",
    signedIn: true,
    streakStatus: "available",
  };
  const provider = new LeetDockTreeProvider(
    {
      snapshot: {
        status: "signed-in",
        user: { isSignedIn: true, username: "leet", isPremium: false },
      },
      onDidChange: () => ({ dispose() {} }),
    },
    {
      snapshot: dailyState,
      load: async () => dailyState,
      markCompleted: () => false,
    },
    problemLists,
    { reset() {} },
    { reset() {} },
  );

  await provider.refreshMyProblemLists(true);
  const root = await provider.getChildren();
  const groupNode = root.find((node) => node.kind === "my-lists");
  const groupItem = provider.getTreeItem(groupNode);
  assert.equal(groupItem.label, "我的题单");
  assert.equal(groupItem.description, "2 个");
  assert.equal(groupItem.collapsibleState, vscodeStub.TreeItemCollapsibleState.Collapsed);

  const lists = await provider.getChildren(groupNode);
  assert.deepEqual(lists.map((node) => node.kind), ["problem-list", "problem-list"]);
  assert.equal(provider.getTreeItem(lists[0]).description, "创建");
  assert.equal(provider.getTreeItem(lists[1]).description, "收藏");

  await provider.refreshMyProblemList("interview");
  const refreshedRoot = await provider.getChildren();
  const refreshedGroup = refreshedRoot.find((node) => node.kind === "my-lists");
  const refreshedLists = await provider.getChildren(refreshedGroup);
  assert.equal(provider.getTreeItem(refreshedLists[0]).description, "1/3 · 创建");
  const questions = await provider.getChildren(refreshedLists[0]);
  assert.deepEqual(
    questions.map((node) => node.kind),
    ["problem-list-problem", "problem-list-problem", "problem-list-more"],
  );
  const problemItem = provider.getTreeItem(questions[0]);
  assert.equal(problemItem.label, "1. 两数之和");
  assert.equal(problemItem.command.command, "leetdock.openProblem");
  assert.deepEqual(problemItem.command.arguments, ["two-sum"]);
  assert.equal(
    provider.getTreeItem(questions[1]).description,
    "困难 · 曾通过",
  );
  assert.equal(
    provider.getTreeItem(questions[2]).command.command,
    "leetdock.loadMoreMyProblemList",
  );
  provider.dispose();

  const signedOutProvider = new LeetDockTreeProvider(
    {
      snapshot: { status: "signed-out" },
      onDidChange: () => ({ dispose() {} }),
    },
    { load: async () => dailyState, markCompleted: () => false },
    new ProblemListService({}),
    { reset() {} },
    { reset() {} },
  );
  const signedOutRoot = await signedOutProvider.getChildren();
  const signedOutGroup = signedOutRoot.find((node) => node.kind === "my-lists");
  assert.equal(providerLabel(signedOutProvider, signedOutGroup), "我的题单");
  const signedOutChildren = await signedOutProvider.getChildren(signedOutGroup);
  assert.equal(
    signedOutProvider.getTreeItem(signedOutChildren[0]).command.command,
    "leetdock.signIn",
  );
  signedOutProvider.dispose();

  const commandIds = new Set(manifest.contributes.commands.map((command) => command.command));
  assert.equal(commandIds.has("leetdock.refreshMyProblemLists"), true);
}

function providerLabel(provider, node) {
  return provider.getTreeItem(node).label;
}

Promise.all([
  checkClientQueries(),
  checkAuthenticationRequired(),
  checkInMemoryService(),
  checkExplorerPresentation(),
]).then(
  () => console.log("LeetDock problem-list API checks passed."),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
