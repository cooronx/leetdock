const assert = require("node:assert/strict");
const Module = require("node:module");

class EventEmitter {
  constructor() {
    this.event = () => ({ dispose() {} });
  }
  fire() {}
  dispose() {}
}

class Uri {
  constructor(value, fsPath = "/tmp/solution.cpp") {
    this.value = value;
    this.fsPath = fsPath;
  }
  toString() {
    return this.value;
  }
}

const vscodeStub = {
  EventEmitter,
  Uri,
  window: {},
  workspace: {},
};
const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  isSolutionFileName,
  parseSolutionDocument,
} = require("../dist/workspace/solutionDocument.js");
const {
  isJudgePending,
  mapJudgeResult,
} = require("../dist/leetcode/judgeResult.js");
const { LeetCodeClient } = require("../dist/leetcode/client.js");
const {
  SolutionExecutionService,
} = require("../dist/commands/solutionCommands.js");
const manifest = require("../package.json");

const cpp = `// @leetdock
// id: 1
// title: 两数之和
// slug: two-sum
// language: cpp

class Solution {};
`;
assert.deepEqual(parseSolutionDocument(cpp, "solution.cpp"), {
  frontendId: "1",
  title: "两数之和",
  titleSlug: "two-sum",
  language: "cpp",
});
assert.equal(parseSolutionDocument(cpp, "solution.py"), undefined);
assert.equal(parseSolutionDocument("class Solution {};", "solution.cpp"), undefined);
assert.equal(
  parseSolutionDocument(cpp.replace("// language: cpp", "// language: cpp\n// language: rust"), "solution.cpp"),
  undefined,
);
assert.equal(isSolutionFileName("solution.ts"), true);
assert.equal(isSolutionFileName("main.cpp"), false);

assert.equal(isJudgePending({ state: "PENDING" }), true);
assert.equal(isJudgePending({ state: "SUCCESS" }), false);
const failedTest = mapJudgeResult("test", "run-1", {
  state: "SUCCESS",
  status_code: 10,
  status_msg: "Accepted",
  run_success: true,
  correct_answer: false,
  code_answer: ["[0,2]"],
  expected_code_answer: ["[0,1]"],
  std_output_list: ["debug"],
}, "[2,7,11,15]\n9");
assert.equal(failedTest.accepted, false);
assert.equal(failedTest.statusMessage, "Wrong Answer");
assert.equal(failedTest.actualOutput, "[0,2]");
assert.equal(failedTest.input, "[2,7,11,15]\n9");

const acceptedSubmit = mapJudgeResult("submit", "submission-1", {
  state: "SUCCESS",
  status_code: 10,
  status_msg: "Accepted",
  run_success: true,
  status_runtime: "0 ms",
  status_memory: "8.1 MB",
  total_correct: 63,
  total_testcases: 63,
});
assert.equal(acceptedSubmit.accepted, true);
assert.equal(acceptedSubmit.totalCorrect, 63);

const commandIds = new Set(manifest.contributes.commands.map((command) => command.command));
assert.equal(commandIds.has("leetdock.testSolution"), true);
assert.equal(commandIds.has("leetdock.submitSolution"), true);
assert.ok(Array.isArray(manifest.contributes.menus["explorer/context"]));
assert.ok(Array.isArray(manifest.contributes.menus["editor/context"]));

async function checkJudgeRequests() {
  const requests = [];
  const responses = [
    { interpret_id: "run-42" },
    { state: "PENDING" },
    {
      state: "SUCCESS",
      status_code: 10,
      status_msg: "Accepted",
      run_success: true,
      correct_answer: true,
      code_answer: ["[0,1]"],
      expected_code_answer: ["[0,1]"],
    },
    { submission_id: 99 },
    {
      state: "SUCCESS",
      status_code: 10,
      status_msg: "Accepted",
      run_success: true,
    },
  ];
  const client = new LeetCodeClient(
    { getCookie: async () => "LEETCODE_SESSION=session; csrftoken=csrf-token" },
    {
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), init });
        const payload = responses.shift();
        assert.notEqual(payload, undefined);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      maxRetries: 0,
      minRequestIntervalMs: 0,
      judgePollIntervalMs: 0,
      judgeTimeoutMs: 1_000,
    },
  );
  const problem = {
    internalId: "1",
    frontendId: "1",
    title: "Two Sum",
    titleSlug: "two-sum",
    difficulty: "Easy",
    paidOnly: false,
    status: null,
    content: "",
    tags: [],
    codeSnippets: [],
    hints: [],
  };

  const testResult = await client.testSolution(problem, "cpp", "class Solution {};", "[2,7]\n9");
  assert.equal(testResult.accepted, true);
  const testRequest = requests[0];
  assert.equal(testRequest.url, "https://leetcode.cn/problems/two-sum/interpret_solution/");
  assert.equal(testRequest.init.method, "POST");
  assert.deepEqual(JSON.parse(testRequest.init.body), {
    lang: "cpp",
    question_id: "1",
    typed_code: "class Solution {};",
    data_input: "[2,7]\n9",
  });
  assert.equal(testRequest.init.headers["X-CSRFToken"], "csrf-token");

  const submitResult = await client.submitSolution(problem, "cpp", "class Solution {};");
  assert.equal(submitResult.accepted, true);
  const submitRequest = requests[3];
  assert.equal(submitRequest.url, "https://leetcode.cn/problems/two-sum/submit/");
  assert.deepEqual(JSON.parse(submitRequest.init.body), {
    lang: "cpp",
    question_id: "1",
    typed_code: "class Solution {};",
  });
  assert.equal(requests[4].url, "https://leetcode.cn/submissions/detail/99/check/");
  assert.equal(responses.length, 0);

  let failedSubmitRequests = 0;
  const failingClient = new LeetCodeClient(
    { getCookie: async () => "LEETCODE_SESSION=session; csrftoken=csrf-token" },
    {
      fetchImplementation: async () => {
        failedSubmitRequests += 1;
        throw new TypeError("connection lost");
      },
      maxRetries: 2,
      minRequestIntervalMs: 0,
    },
  );
  await assert.rejects(
    failingClient.submitSolution(problem, "cpp", "class Solution {};"),
  );
  assert.equal(
    failedSubmitRequests,
    1,
    "submit creation must not be retried because that can create duplicates",
  );
}

async function checkBusyReleaseDoesNotWaitForNotification() {
  const source = `// @leetdock
// id: 1
// title: 两数之和
// slug: two-sum
// language: cpp

class Solution {};
`;
  const uri = new Uri("file:///tmp/solution.cpp");
  const document = {
    uri,
    isDirty: false,
    getText: () => source,
    save: async () => true,
  };
  let resultShown = false;
  let successNotificationShown = false;
  vscodeStub.workspace.openTextDocument = async () => document;
  vscodeStub.window.activeTextEditor = { document };
  vscodeStub.window.showQuickPick = async (items) => items[0];
  vscodeStub.window.showInformationMessage = (message) => {
    if (message === "测试通过。") {
      successNotificationShown = true;
      return new Promise(() => {});
    }
    return Promise.resolve();
  };
  vscodeStub.window.showWarningMessage = async () => undefined;
  vscodeStub.window.showErrorMessage = async () => undefined;

  const problem = {
    internalId: "1",
    frontendId: "1",
    title: "Two Sum",
    translatedTitle: "两数之和",
    titleSlug: "two-sum",
    difficulty: "Easy",
    paidOnly: false,
    status: null,
    content: "",
    tags: [],
    codeSnippets: [],
    exampleTestcases: "[2,7]\n9",
    hints: [],
  };
  const service = new SolutionExecutionService(
    {
      testSolution: async () => ({
        action: "test",
        taskId: "42",
        state: "SUCCESS",
        statusMessage: "Accepted",
        accepted: true,
        runSuccess: true,
      }),
    },
    {},
    { openProblem: async () => problem },
    {
      showPending() {},
      showResult() {
        resultShown = true;
      },
      showError() {},
      close() {},
    },
    async () => {},
  );

  void service.test(uri);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resultShown, true, "judge result should already be rendered");
  assert.equal(successNotificationShown, true, "success notification should be shown");
  assert.equal(
    service.isBusy(uri),
    false,
    "solution must leave the running state without waiting for notification dismissal",
  );
}

Promise.all([
  checkJudgeRequests(),
  checkBusyReleaseDoesNotWaitForNotification(),
]).then(
  () => console.log("LeetDock solution test/submit support checks passed."),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
