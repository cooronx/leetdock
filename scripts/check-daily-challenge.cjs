const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { LeetCodeClient } = require("../dist/leetcode/client.js");

async function checkDailyChallengeRequests() {
  const requests = [];
  const responses = [
    {
      data: {
        todayRecord: [{
          date: "2026-08-05",
          question: {
            frontendQuestionId: "3310",
            title: "Remove Methods From Project",
            titleCn: "移除可疑的方法",
            titleSlug: "remove-methods-from-project",
            difficulty: "Medium",
            paidOnly: false,
            status: null,
          },
        }],
      },
    },
    {
      data: {
        problemsetStreakCounter: {
          today: "2026-08-05",
          streakCount: 12,
          daysSkipped: 0,
          todayCompleted: true,
        },
      },
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
    },
  );

  assert.deepEqual(await client.getDailyChallenge(), {
    date: "2026-08-05",
    problem: {
      frontendId: "3310",
      title: "Remove Methods From Project",
      translatedTitle: "移除可疑的方法",
      titleSlug: "remove-methods-from-project",
      difficulty: "Medium",
      paidOnly: false,
      status: null,
    },
  });
  assert.equal(requests[0].url, "https://leetcode.cn/graphql/");
  assert.equal(JSON.parse(requests[0].init.body).operationName, "DailyChallenge");

  assert.deepEqual(await client.getDailyStreak(), {
    today: "2026-08-05",
    streakCount: 12,
    daysSkipped: 0,
    todayCompleted: true,
  });
  assert.equal(requests[1].url, "https://leetcode.cn/graphql/noj-go/");
  assert.equal(JSON.parse(requests[1].init.body).operationName, "DailyStreak");
  assert.equal(requests[1].init.headers.Cookie, "LEETCODE_SESSION=session; csrftoken=csrf-token");
  assert.equal(requests[1].init.headers["X-CSRFToken"], "csrf-token");
  assert.equal(responses.length, 0);
}

async function checkDailyStreakRequiresAuthentication() {
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
    client.getDailyStreak(),
    (error) => error?.kind === "authentication",
  );
  assert.equal(requests, 0);
}

Promise.all([
  checkDailyChallengeRequests(),
  checkDailyStreakRequiresAuthentication(),
]).then(
  () => console.log("LeetDock daily challenge API checks passed."),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
