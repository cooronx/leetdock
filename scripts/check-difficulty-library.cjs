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
  Uri: { parse: (value) => ({ value }) },
  window: { showQuickPick: async (items) => items[0] },
};
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { DifficultyService } = require("../dist/difficulty/difficultyService.js");
const { LeetCodeClient } = require("../dist/leetcode/client.js");
const { LeetDockTreeProvider } = require("../dist/explorer/leetDockTreeProvider.js");
const manifest = require("../package.json");

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
  frontendId: "9",
  title: "Palindrome Number",
  translatedTitle: "回文数",
  titleSlug: "palindrome-number",
  difficulty: "Easy",
  paidOnly: true,
  status: "TRIED",
};

async function checkClientQuery() {
  const requests = [];
  const client = new LeetCodeClient(
    { getCookie: async () => undefined },
    {
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({
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
              total: 1078,
              hasMore: true,
            },
          },
        }), { status: 200 });
      },
      maxRetries: 0,
      minRequestIntervalMs: 0,
    },
  );

  assert.deepEqual(await client.getDifficultyQuestions("Easy", 0, 50), {
    questions: [firstProblem],
    total: 1078,
    hasMore: true,
  });
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.operationName, "ProblemsetQuestionList");
  assert.deepEqual(body.variables, {
    limit: 50,
    skip: 0,
    filters: { difficulty: "EASY" },
  });
  assert.equal(
    requests[0].init.headers.Referer,
    "https://leetcode.cn/problemset/?difficulty=EASY",
  );
}

async function checkService() {
  let pageCalls = 0;
  const service = new DifficultyService({
    getDifficultyQuestions: async (_difficulty, skip) => {
      pageCalls += 1;
      return skip === 0
        ? { questions: [firstProblem, secondProblem], total: 3, hasMore: true }
        : {
          questions: [
            secondProblem,
            { ...firstProblem, frontendId: "13", titleSlug: "roman-to-integer" },
          ],
          total: 3,
          hasMore: false,
        };
    },
  });
  assert.equal((await service.loadDetail("Easy")).questions.length, 2);
  const loaded = await service.loadMore("Easy");
  assert.equal(loaded.questions.length, 3);
  assert.equal(loaded.hasMore, false);
  assert.equal(pageCalls, 2);
  assert.equal(service.markAccepted("two-sum"), true);
  assert.equal(service.getDetailSnapshot("Easy").questions[0].status, "AC");
  assert.equal(service.markAccepted("two-sum"), false);

  let resolvePage;
  const stale = new DifficultyService({
    getDifficultyQuestions: () => new Promise((resolve) => { resolvePage = resolve; }),
  });
  const pending = stale.loadDetail("Hard");
  stale.reset();
  resolvePage({ questions: [], total: 0, hasMore: false });
  await assert.rejects(pending, (error) => error?.kind === "stale-session");
}

async function checkExplorer() {
  let pageCalls = 0;
  const difficulties = new DifficultyService({
    getDifficultyQuestions: async () => {
      pageCalls += 1;
      return {
        questions: [firstProblem, secondProblem],
        total: 1078,
        hasMore: true,
      };
    },
  });
  const dailyState = {
    challenge: { date: "2026-08-11", problem: firstProblem },
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
    { reset() {} },
    difficulties,
  );

  const root = await provider.getChildren();
  const library = root.find((node) => node.kind === "library");
  const libraryChildren = await provider.getChildren(library);
  assert.deepEqual(
    libraryChildren.map((node) => node.kind),
    ["difficulties", "tags", "companies"],
  );
  const group = libraryChildren[0];
  assert.equal(provider.getTreeItem(group).label, "难度/difficulty");
  assert.equal(provider.getTreeItem(group).iconPath.color, undefined);
  assert.equal(provider.getParent(group).kind, "library");

  const levels = await provider.getChildren(group);
  assert.deepEqual(levels.map((node) => node.difficulty), ["Easy", "Medium", "Hard"]);
  assert.deepEqual(
    levels.map((node) => provider.getTreeItem(node).label),
    ["简单/easy", "中等/medium", "困难/hard"],
  );
  assert.deepEqual(
    levels.map((node) => provider.getTreeItem(node).iconPath.color.id),
    ["testing.iconPassed", "list.warningForeground", "list.errorForeground"],
  );
  assert.equal(pageCalls, 0, "difficulty pages must remain lazy");

  const easy = levels[0];
  await provider.refreshDifficulty("Easy");
  assert.equal(pageCalls, 1);
  const refreshedLevels = await provider.getChildren(group);
  assert.equal(provider.getTreeItem(refreshedLevels[0]).description, "1078 题");
  const questions = await provider.getChildren(easy);
  assert.deepEqual(
    questions.map((node) => node.kind),
    ["difficulty-problem", "difficulty-problem", "difficulty-more"],
  );
  assert.equal(provider.getTreeItem(questions[0]).label, "1. 两数之和");
  assert.equal(provider.getTreeItem(questions[0]).description, "简单");
  assert.equal(provider.getTreeItem(questions[1]).description, "简单 · 尝试过");
  assert.equal(provider.getTreeItem(questions[2]).command.command, "leetdock.loadMoreDifficulty");
  assert.equal(provider.getParent(questions[0]).difficulty, "Easy");

  provider.markDifficultyProblemAccepted("two-sum");
  const accepted = (await provider.getChildren(easy))[0];
  assert.equal(provider.getTreeItem(accepted).description, "简单 · 已通过");
  provider.dispose();
}

function checkManifest() {
  const commands = new Set(manifest.contributes.commands.map(({ command }) => command));
  for (const command of [
    "leetdock.refreshDifficulty",
    "leetdock.loadMoreDifficulty",
  ]) {
    assert.equal(commands.has(command), true, `missing command ${command}`);
  }
  assert.equal(manifest.contributes.colors, undefined);
}

Promise.all([
  checkClientQuery(),
  checkService(),
  checkExplorer(),
]).then(() => {
  checkManifest();
  console.log("LeetDock difficulty library checks passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
