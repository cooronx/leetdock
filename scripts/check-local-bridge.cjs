const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const registeredCommands = new Map();
let registeredUriHandler;
const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return {
      commands: {
        executeCommand: async () => undefined,
        registerCommand: (command, handler) => {
          registeredCommands.set(command, handler);
          return { dispose() {} };
        },
      },
      window: {
        registerUriHandler: (handler) => {
          registeredUriHandler = handler;
          return { dispose() {} };
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const root = path.resolve(__dirname, "..");
const manifest = require(path.join(root, "package.json"));
const companionManifest = require(path.join(root, "companion", "package.json"));

assert.deepEqual(manifest.extensionKind, ["workspace"]);
assert.ok(
  manifest.extensionDependencies?.includes("cooronx.leetdock-auth"),
  "the workspace extension must depend on the local companion",
);
assert.equal(
  manifest.activationEvents.includes("onUri"),
  false,
  "the remote extension must not receive browser credentials",
);
assert.ok(
  manifest.activationEvents.includes("onCommand:leetdock.internal.remoteAuth.changed"),
  "the local companion must be able to activate the remote authentication receiver",
);
assert.deepEqual(companionManifest.extensionKind, ["ui"]);
assert.ok(companionManifest.activationEvents.includes("onUri"));
const releasePlugins = manifest.release.plugins.map((plugin) =>
  Array.isArray(plugin) ? plugin[0] : plugin
);
assert.ok(
  releasePlugins.indexOf("./scripts/semantic-release-companion.cjs") <
    releasePlugins.indexOf("semantic-release-vsce"),
  "the local companion must publish before the workspace extension",
);

const extensionSource = fs.readFileSync(
  path.join(root, "src", "extension.ts"),
  "utf8",
);
assert.match(extensionSource, /RemoteLeetCodeClient/);
assert.doesNotMatch(extensionSource, /new CredentialStore/);
assert.doesNotMatch(extensionSource, /registerUriHandler/);

const {
  LOCAL_AUTH_STATE_COMMAND,
  LOCAL_AUTH_SIGN_IN_COMMAND,
  LOCAL_AUTH_SIGN_OUT_COMMAND,
  LOCAL_NETWORK_COMMAND,
} = require("../dist/bridge/protocol.js");
const { LocalAuthBridge } = require("../dist/auth/localAuthBridge.js");
const {
  RemoteLeetCodeClient,
} = require("../dist/bridge/remoteLeetCodeClient.js");
const {
  dispatchNetworkRequest,
} = require("../companion/dist/companion/src/networkDispatcher.js");
const companionExtension = require("../companion/dist/companion/src/extension.js");
const { LeetCodeError } = require("../dist/leetcode/errors.js");

async function checkNetworkRouting() {
  const calls = [];
  const execute = async (command, request) => {
    calls.push({ command, request });
    return {
      version: 1,
      ok: true,
      value: request.method === "getProblem" ? {
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
      } : {},
    };
  };
  const client = new RemoteLeetCodeClient(execute);

  const problem = await client.getProblem("two-sum");
  await client.searchProblems("two", 1, 20);
  await client.getDifficultyQuestions("Easy", 2, 30);
  await client.getTags();
  await client.getTagQuestions("array", 3, 40);
  await client.getDailyChallenge();
  await client.getDailyStreak();
  await client.getMyProblemLists();
  await client.getProblemListQuestions("favorites", 4, 50);
  await client.getProblemListProgress("favorites");
  await client.getProblemListQuestionAccepted("favorites", "two-sum");
  await client.getCompanies();
  await client.getCompanyQuestionSource("google");
  await client.getCompanyQuestions("google", "google-list", 5, 60);
  await client.testSolution(problem, "cpp", "code", "input");
  await client.submitSolution(problem, "cpp", "code");
  await client.getProblemIndex();

  assert.equal(problem.titleSlug, "two-sum");
  assert.deepEqual(
    calls.map(({ command, request }) => [command, request.method, request.args]),
    [
      [LOCAL_NETWORK_COMMAND, "getProblem", ["two-sum"]],
      [LOCAL_NETWORK_COMMAND, "searchProblems", ["two", 1, 20]],
      [LOCAL_NETWORK_COMMAND, "getDifficultyQuestions", ["Easy", 2, 30]],
      [LOCAL_NETWORK_COMMAND, "getTags", []],
      [LOCAL_NETWORK_COMMAND, "getTagQuestions", ["array", 3, 40]],
      [LOCAL_NETWORK_COMMAND, "getDailyChallenge", []],
      [LOCAL_NETWORK_COMMAND, "getDailyStreak", []],
      [LOCAL_NETWORK_COMMAND, "getMyProblemLists", []],
      [LOCAL_NETWORK_COMMAND, "getProblemListQuestions", ["favorites", 4, 50]],
      [LOCAL_NETWORK_COMMAND, "getProblemListProgress", ["favorites"]],
      [LOCAL_NETWORK_COMMAND, "getProblemListQuestionAccepted", ["favorites", "two-sum"]],
      [LOCAL_NETWORK_COMMAND, "getCompanies", []],
      [LOCAL_NETWORK_COMMAND, "getCompanyQuestionSource", ["google"]],
      [LOCAL_NETWORK_COMMAND, "getCompanyQuestions", ["google", "google-list", 5, 60]],
      [LOCAL_NETWORK_COMMAND, "testSolution", [problem, "cpp", "code", "input"]],
      [LOCAL_NETWORK_COMMAND, "submitSolution", [problem, "cpp", "code"]],
      [LOCAL_NETWORK_COMMAND, "getProblemIndex", []],
    ],
  );
}

async function checkErrorTransport() {
  const client = new RemoteLeetCodeClient(async () => ({
    version: 1,
    ok: false,
    error: {
      name: "LeetDockError",
      message: "Forbidden",
      kind: "authorization",
      retryable: false,
      statusCode: 403,
    },
  }));

  await assert.rejects(
    client.getTags(),
    (error) =>
      error instanceof LeetCodeError &&
      error.kind === "authorization" &&
      error.statusCode === 403,
  );
}

async function checkAuthenticationRouting() {
  const calls = [];
  const execute = async (command, argument) => {
    calls.push({ command, argument });
    if (command === LOCAL_AUTH_STATE_COMMAND) {
      return {
        version: 1,
        ok: true,
        value: {
          status: "signed-in",
          user: {
            isSignedIn: true,
            username: "test-user",
            isPremium: false,
          },
        },
      };
    }
    return { version: 1, ok: true };
  };
  const auth = new LocalAuthBridge(execute);

  const state = await auth.getState();
  await auth.signIn("old-user");
  await auth.signOut();

  assert.equal(state.user.username, "test-user");
  assert.deepEqual(calls, [
    { command: LOCAL_AUTH_STATE_COMMAND, argument: undefined },
    { command: LOCAL_AUTH_SIGN_IN_COMMAND, argument: "old-user" },
    { command: LOCAL_AUTH_SIGN_OUT_COMMAND, argument: undefined },
  ]);
}

async function checkLocalDispatcherAllowList() {
  const calls = [];
  const client = {
    getProblem: async (...args) => {
      calls.push(args);
      return { titleSlug: args[0] };
    },
  };
  const result = await dispatchNetworkRequest(client, {
    version: 1,
    method: "getProblem",
    args: ["two-sum"],
  });
  assert.equal(result.titleSlug, "two-sum");
  assert.deepEqual(calls, [["two-sum"]]);
  assert.throws(
    () => dispatchNetworkRequest(client, {
      version: 1,
      method: "readLocalSecret",
      args: [],
    }),
    /invalid local network request/i,
  );
}

function checkCompanionActivation() {
  const context = {
    extension: { id: "cooronx.leetdock-auth" },
    globalState: {},
    secrets: {},
    subscriptions: [],
  };
  companionExtension.activate(context);
  assert.deepEqual(
    [...registeredCommands.keys()].sort(),
    [
      LOCAL_AUTH_SIGN_IN_COMMAND,
      LOCAL_AUTH_SIGN_OUT_COMMAND,
      LOCAL_AUTH_STATE_COMMAND,
      LOCAL_NETWORK_COMMAND,
    ].sort(),
  );
  assert.equal(typeof registeredUriHandler?.handleUri, "function");
  assert.equal(context.subscriptions.length, 5);
}

checkCompanionActivation();

Promise.all([
  checkNetworkRouting(),
  checkErrorTransport(),
  checkAuthenticationRouting(),
  checkLocalDispatcherAllowList(),
]).then(() => {
  console.log("Local companion bridge checks passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
