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

const { CompanyService } = require("../dist/company/companyService.js");
const { LeetCodeClient } = require("../dist/leetcode/client.js");
const { LeetDockTreeProvider } = require("../dist/explorer/leetDockTreeProvider.js");
const manifest = require("../package.json");

const cookie = "LEETCODE_SESSION=session; csrftoken=csrf-token";
const amazon = {
  name: "Amazon",
  translatedName: "亚马逊",
  slug: "amazon",
};
const google = { name: "Google", translatedName: "谷歌", slug: "google" };
const firstProblem = {
  frontendId: "1",
  title: "Two Sum",
  translatedTitle: "两数之和",
  titleSlug: "two-sum",
  difficulty: "Easy",
  paidOnly: false,
  status: null,
  frequency: 87.25,
};
const secondProblem = {
  frontendId: "3",
  title: "Longest Substring Without Repeating Characters",
  translatedTitle: "无重复字符的最长子串",
  titleSlug: "longest-substring-without-repeating-characters",
  difficulty: "Medium",
  paidOnly: false,
  status: "TRIED",
  frequency: 41,
};

async function checkClientQueries() {
  const requests = [];
  const responses = [
    {
      data: {
        companyTags: [
          { name: "Amazon", translatedName: "亚马逊", slug: "amazon" },
          { name: "Amazon duplicate", translatedName: null, slug: "amazon" },
          { name: "Google", translatedName: "谷歌", slug: "google" },
        ],
      },
    },
    {
      data: {
        favoriteDetailV2: {
          questionNumber: 706,
          generatedFavoritesInfo: { defaultFavoriteSlug: "amazon-thirty-days" },
        },
      },
    },
    {
      data: {
        favoriteQuestionList: {
          questions: [{
            questionFrontendId: "1",
            title: "Two Sum",
            translatedTitle: "两数之和",
            titleSlug: "two-sum",
            difficulty: "EASY",
            paidOnly: false,
            status: null,
            frequency: 87.25,
          }],
          totalLength: 63,
          hasMore: true,
        },
      },
    },
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

  assert.deepEqual(await client.getCompanies(), [amazon, google]);
  assert.deepEqual(await client.getCompanyQuestionSource("amazon"), {
    favoriteSlug: "amazon-thirty-days",
    questionNumber: 706,
  });
  assert.deepEqual(
    await client.getCompanyQuestions("amazon", "amazon-thirty-days", 0, 50),
    { questions: [firstProblem], total: 63, hasMore: true },
  );
  assert.deepEqual(
    requests.map(({ init }) => JSON.parse(init.body).operationName),
    ["CompanyTags", "CompanyQuestionSource", "CompanyQuestionList"],
  );
  assert.equal(requests[1].init.headers.Referer, "https://leetcode.cn/company/amazon/");
  assert.deepEqual(JSON.parse(requests[2].init.body).variables, {
    favoriteSlug: "amazon-thirty-days",
    skip: 0,
    limit: 50,
  });
  assert.equal(responses.length, 0);
}

async function checkService() {
  let pageCalls = 0;
  const service = new CompanyService({
    getCompanies: async () => [google, amazon],
    getCompanyQuestionSource: async () => ({
      favoriteSlug: "amazon-thirty-days",
      questionNumber: 706,
    }),
    getCompanyQuestions: async (_company, _favorite, skip) => {
      pageCalls += 1;
      return skip === 0
        ? { questions: [firstProblem, secondProblem], total: 3, hasMore: true }
        : {
          questions: [
            secondProblem,
            { ...firstProblem, frontendId: "42", titleSlug: "trapping-rain-water" },
          ],
          total: 3,
          hasMore: false,
        };
    },
  });
  assert.deepEqual(await service.loadCatalog(), [google, amazon]);
  assert.equal((await service.loadDetail(amazon)).questions.length, 2);
  const loaded = await service.loadMore("amazon");
  assert.equal(loaded.questions.length, 3);
  assert.equal(pageCalls, 2);
  assert.equal(service.markAccepted("two-sum"), true);
  assert.equal(service.getDetailSnapshot("amazon").questions[0].status, "AC");
  assert.equal(service.markAccepted("two-sum"), false);

  let resolveCatalog;
  const stale = new CompanyService({
    getCompanies: () => new Promise((resolve) => { resolveCatalog = resolve; }),
  });
  const pending = stale.loadCatalog();
  stale.reset();
  resolveCatalog([amazon]);
  await assert.rejects(pending, (error) => error?.kind === "stale-session");
}

async function checkExplorer() {
  const companies = new CompanyService({
    getCompanies: async () => [amazon],
    getCompanyQuestionSource: async () => ({
      favoriteSlug: "amazon-thirty-days",
      questionNumber: 706,
    }),
    getCompanyQuestions: async () => ({
      questions: [firstProblem],
      total: 1,
      hasMore: false,
    }),
  });
  const dailyState = {
    challenge: { date: "2026-08-07", problem: firstProblem },
    challengeSource: "network",
    signedIn: true,
    streakStatus: "available",
  };
  const provider = new LeetDockTreeProvider(
    {
      snapshot: {
        status: "signed-in",
        user: { isSignedIn: true, username: "leet", isPremium: true },
      },
      onDidChange: () => ({ dispose() {} }),
    },
    { snapshot: dailyState, load: async () => dailyState, markCompleted: () => false },
    { reset() {} },
    companies,
    { reset() {} },
  );
  await provider.refreshCompanies(true);
  const root = await provider.getChildren();
  const library = root.find((node) => node.kind === "library");
  assert.notEqual(library, undefined);
  assert.equal(provider.getTreeItem(library).label, "题库");
  const libraryChildren = await provider.getChildren(library);
  assert.deepEqual(libraryChildren.map((node) => node.kind), ["tags", "companies"]);
  const companyGroup = libraryChildren[1];
  assert.equal(companyGroup.kind, "companies");
  assert.equal(provider.getTreeItem(companyGroup).description, "1 个");
  const companyNodes = await provider.getChildren(companyGroup);
  assert.deepEqual(companyNodes.map((node) => node.kind), ["company-search", "company"]);
  assert.equal(provider.getTreeItem(companyNodes[0]).command.command, "leetdock.searchCompany");
  assert.equal(provider.getTreeItem(companyNodes[1]).label, "亚马逊");
  assert.equal(provider.getParent(companyNodes[1]).kind, "companies");

  await provider.refreshCompany("amazon");
  const refreshedCompanies = await provider.getChildren(companyGroup);
  const company = refreshedCompanies[1];
  assert.equal(provider.getTreeItem(company).description, "1 题");
  const questions = await provider.getChildren(company);
  assert.equal(questions[0].kind, "company-problem");
  const problemItem = provider.getTreeItem(questions[0]);
  assert.equal(problemItem.label, "1. 两数之和");
  assert.match(problemItem.tooltip, /出题频率：87\.25/);
  assert.equal(problemItem.command.command, "leetdock.openProblem");
  assert.equal((await provider.pickCompany()).summary.slug, "amazon");
  provider.dispose();

  const nonPremium = new LeetDockTreeProvider(
    {
      snapshot: {
        status: "signed-in",
        user: { isSignedIn: true, username: "free", isPremium: false },
      },
      onDidChange: () => ({ dispose() {} }),
    },
    { load: async () => dailyState, markCompleted: () => false },
    { reset() {} },
    new CompanyService({}),
    { reset() {} },
  );
  const freeRoot = await nonPremium.getChildren();
  const freeLibrary = freeRoot.find((node) => node.kind === "library");
  const freeCompanies = (await nonPremium.getChildren(freeLibrary))[1];
  const premiumStatus = (await nonPremium.getChildren(freeCompanies))[0];
  assert.equal(premiumStatus.status, "premium");
  assert.equal(providerLabel(nonPremium, premiumStatus), "升级 Plus 会员后查看");
  nonPremium.dispose();
}

function checkManifest() {
  const commands = new Set(manifest.contributes.commands.map(({ command }) => command));
  for (const command of [
    "leetdock.searchCompany",
    "leetdock.refreshCompanies",
    "leetdock.refreshCompany",
    "leetdock.loadMoreCompany",
  ]) {
    assert.equal(commands.has(command), true, `missing command ${command}`);
  }
}

function providerLabel(provider, node) {
  return provider.getTreeItem(node).label;
}

Promise.all([
  checkClientQueries(),
  checkService(),
  checkExplorer(),
]).then(() => {
  checkManifest();
  console.log("LeetDock company library checks passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
