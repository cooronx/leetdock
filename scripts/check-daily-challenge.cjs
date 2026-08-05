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
const { LeetCodeError } = require("../dist/leetcode/errors.js");
const { CacheStorage } = require("../dist/storage/cacheStorage.js");
const {
  DailyChallengeCache,
} = require("../dist/daily/dailyChallengeCache.js");
const {
  DailyChallengeService,
  beijingDateKey,
} = require("../dist/daily/dailyChallengeService.js");

class Memento {
  constructor() {
    this.values = new Map();
  }
  get(key) {
    return this.values.get(key);
  }
  keys() {
    return [...this.values.keys()];
  }
  async update(key, value) {
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
  }
}

const dailyChallenge = {
  date: "2026-08-05",
  problem: {
    frontendId: "3310",
    title: "Remove Methods From Project",
    translatedTitle: "移除可疑的方法",
    titleSlug: "remove-methods-from-project",
    difficulty: "Medium",
    paidOnly: false,
    status: "AC",
  },
};
const dailyStreak = {
  today: "2026-08-05",
  streakCount: 12,
  daysSkipped: 0,
  todayCompleted: true,
};

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

async function checkDailyStateAndOfflineFallback() {
  const state = new Memento();
  const cache = new DailyChallengeCache(new CacheStorage(state));
  let challengeRequests = 0;
  let streakRequests = 0;
  const service = new DailyChallengeService(
    {
      getDailyChallenge: async () => {
        challengeRequests += 1;
        return dailyChallenge;
      },
      getDailyStreak: async () => {
        streakRequests += 1;
        return dailyStreak;
      },
    },
    cache,
    () => new Date("2026-08-05T08:00:00.000Z"),
  );

  const fresh = await service.load(true);
  assert.equal(fresh.challengeSource, "network");
  assert.equal(fresh.streakSource, "network");
  assert.equal(fresh.streakStatus, "available");
  assert.equal(fresh.streak.streakCount, 12);
  assert.equal(challengeRequests, 1);
  assert.equal(streakRequests, 1);
  assert.equal((await cache.getChallenge("2026-08-05")).problem.status, null);

  assert.equal(await service.load(true), fresh, "same-day loads should reuse memory state");
  assert.equal(challengeRequests, 1);

  const offline = new DailyChallengeService(
    {
      getDailyChallenge: async () => {
        throw new LeetCodeError("network", "offline");
      },
      getDailyStreak: async () => {
        throw new LeetCodeError("network", "offline");
      },
    },
    cache,
    () => new Date("2026-08-05T12:00:00.000Z"),
  );
  const cached = await offline.load(true);
  assert.equal(cached.challengeSource, "cache");
  assert.equal(cached.streakSource, "cache");
  assert.equal(cached.warning.kind, "network");

  await assert.rejects(
    new DailyChallengeService(
      {
        getDailyChallenge: async () => {
          throw new LeetCodeError("network", "offline");
        },
      },
      cache,
      () => new Date("2026-08-06T01:00:00.000Z"),
    ).load(false),
    (error) => error?.kind === "network",
    "yesterday's challenge must not be used after the Beijing date changes",
  );
}

async function checkAccountBoundary() {
  const state = new Memento();
  const cache = new DailyChallengeCache(new CacheStorage(state));
  await cache.setChallenge(dailyChallenge);
  const generation = cache.captureUserDataGeneration();
  await cache.setStreak(dailyStreak, generation);
  assert.equal((await cache.getStreak("2026-08-05")).streakCount, 12);

  await cache.clearUserData();
  assert.equal(await cache.getStreak("2026-08-05"), undefined);
  assert.notEqual(await cache.getChallenge("2026-08-05"), undefined);

  await cache.setStreak({ ...dailyStreak, streakCount: 99 }, generation);
  assert.equal(
    await cache.getStreak("2026-08-05"),
    undefined,
    "a response from the previous account generation must not be cached",
  );
}

async function checkSignOutDuringRequest() {
  const state = new Memento();
  const cache = new DailyChallengeCache(new CacheStorage(state));
  let resolveStreak;
  const streakResponse = new Promise((resolve) => {
    resolveStreak = resolve;
  });
  const service = new DailyChallengeService(
    {
      getDailyChallenge: async () => dailyChallenge,
      getDailyStreak: async () => streakResponse,
    },
    cache,
    () => new Date("2026-08-05T08:00:00.000Z"),
  );

  const pending = service.load(true);
  await new Promise((resolve) => setImmediate(resolve));
  await service.clearUserData();
  resolveStreak(dailyStreak);
  const result = await pending;
  assert.equal(result.signedIn, false);
  assert.equal(result.streakStatus, "signed-out");
  assert.equal(result.streak, undefined);
  assert.equal(service.snapshot?.streak, undefined);
  assert.equal(await cache.getStreak("2026-08-05"), undefined);
}

function checkBeijingDateBoundary() {
  assert.equal(beijingDateKey(new Date("2026-08-05T15:59:59.999Z")), "2026-08-05");
  assert.equal(beijingDateKey(new Date("2026-08-05T16:00:00.000Z")), "2026-08-06");
  assert.throws(() => beijingDateKey(new Date(Number.NaN)), RangeError);
}

Promise.all([
  checkDailyChallengeRequests(),
  checkDailyStreakRequiresAuthentication(),
  checkDailyStateAndOfflineFallback(),
  checkAccountBoundary(),
  checkSignOutDuringRequest(),
]).then(
  () => console.log("LeetDock daily challenge API checks passed."),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);

checkBeijingDateBoundary();
