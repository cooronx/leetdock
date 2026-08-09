const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const {
  createDebugProblemSpec,
  getDebugSampleInputs,
} = require("../dist/debug/problemSpec.js");
const {
  DebugInputError,
  parseDebugTestCase,
  renderCppDebugProgram,
} = require("../dist/debug/cppDebugProgram.js");
const { PROBLEM_DETAIL_QUERY } = require("../dist/leetcode/graphql.js");
const { CacheStorage } = require("../dist/storage/cacheStorage.js");
const { ProblemCache } = require("../dist/problem/problemCache.js");
const manifest = require("../package.json");

const twoSumSpec = createDebugProblemSpec({
  metadata: JSON.stringify({
    name: "twoSum",
    params: [
      { name: "nums", type: "integer[]" },
      { name: "target", type: "integer" },
    ],
    return: { type: "integer[]" },
    manual: false,
  }),
  cppSnippet: "class Solution { public: vector<int> twoSum(vector<int>& nums, int target); };",
  exampleTestcases: "[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6",
  sampleTestCase: "[2,7,11,15]\n9",
});
assert.equal(twoSumSpec.kind, "supported");
assert.equal(twoSumSpec.methodName, "twoSum");
assert.deepEqual(twoSumSpec.parameters, [
  { name: "nums", type: { scalar: "integer", dimensions: 1 } },
  { name: "target", type: { scalar: "integer", dimensions: 0 } },
]);
assert.deepEqual(getDebugSampleInputs(twoSumSpec), [
  "[2,7,11,15]\n9",
  "[3,2,4]\n6",
  "[3,3]\n6",
]);

const twoSumCase = parseDebugTestCase("[2,7,11,15]\n9", twoSumSpec.parameters);
const twoSumProgram = renderCppDebugProgram({
  solutionPath: "/tmp/solution.cpp",
  spec: twoSumSpec,
  testCase: twoSumCase,
});
assert.match(twoSumProgram, /std::vector<int> arg0 = \{2, 7, 11, 15\};/);
assert.match(twoSumProgram, /int arg1 = 9;/);
assert.match(twoSumProgram, /auto result = solution\.twoSum\(arg0, arg1\);/);
assert.doesNotMatch(twoSumProgram, /cJSON/);

const voidSpec = createDebugProblemSpec({
  metadata: JSON.stringify({
    name: "moveZeroes",
    params: [{ name: "nums", type: "integer[]" }],
    return: { type: "void" },
    manual: false,
  }),
  cppSnippet: "class Solution { public: void moveZeroes(vector<int>& nums); };",
  sampleTestCase: "[0,1,0,3,12]",
});
assert.equal(voidSpec.kind, "supported");
assert.equal(voidSpec.returnType, "void");
const voidCase = parseDebugTestCase("[0,1,0,3,12]", voidSpec.parameters);
const voidProgram = renderCppDebugProgram({
  solutionPath: "/tmp/solution.cpp",
  spec: voidSpec,
  testCase: voidCase,
});
assert.match(voidProgram, /solution\.moveZeroes\(arg0\);/);
assert.match(voidProgram, /leetdock_debug_internal::print\(arg0\);/);
assert.doesNotMatch(voidProgram, /auto result/);

const unsupportedTree = createDebugProblemSpec({
  metadata: JSON.stringify({
    name: "maxDepth",
    params: [{ name: "root", type: "TreeNode" }],
    return: { type: "integer" },
  }),
  cppSnippet: "class Solution {};",
});
assert.equal(unsupportedTree.kind, "unsupported");
assert.match(unsupportedTree.reason, /root.*TreeNode/);

const unsupportedDesign = createDebugProblemSpec({
  metadata: JSON.stringify({
    name: "TimeMap",
    params: [],
    return: { type: "void" },
  }),
  cppSnippet: "class TimeMap {};",
});
assert.equal(unsupportedDesign.kind, "unsupported");
assert.match(unsupportedDesign.reason, /class Solution/);

const unsupportedSolutionConstructor = createDebugProblemSpec({
  metadata: JSON.stringify({
    name: "Solution",
    params: [{ name: "nums", type: "integer[]" }],
    return: { type: "void" },
  }),
  cppSnippet: "class Solution { public: Solution(vector<int>& nums); int pickIndex(); };",
});
assert.equal(unsupportedSolutionConstructor.kind, "unsupported");
assert.match(unsupportedSolutionConstructor.reason, /设计题/);

assert.throws(
  () => parseDebugTestCase("[1,2]; system(\"boom\")\n3", twoSumSpec.parameters),
  (error) => error instanceof DebugInputError && /nums.*第 1 行/.test(error.message),
);
assert.throws(
  () => parseDebugTestCase("[1,2]", twoSumSpec.parameters),
  (error) => error instanceof DebugInputError && /需要 2 行/.test(error.message),
);

const longSpec = createDebugProblemSpec({
  metadata: JSON.stringify({
    name: "identity",
    params: [{ name: "value", type: "long" }],
    return: { type: "long" },
  }),
  cppSnippet: "class Solution { public: long long identity(long long value); };",
});
assert.equal(longSpec.kind, "supported");
const longProgram = renderCppDebugProgram({
  solutionPath: "/tmp/solution.cpp",
  spec: longSpec,
  testCase: parseDebugTestCase("-9223372036854775808", longSpec.parameters),
});
assert.match(longProgram, /\(-9223372036854775807LL - 1LL\)/);

const mixedVoidSpec = createDebugProblemSpec({
  metadata: JSON.stringify({
    name: "touch",
    params: [
      { name: "text", type: "string" },
      { name: "marker", type: "character" },
      { name: "values", type: "double[]" },
      { name: "flags", type: "boolean[][]" },
      { name: "limit", type: "long" },
    ],
    return: { type: "void" },
  }),
  cppSnippet: "class Solution { public: void touch(string&, char&, vector<double>&, vector<vector<bool>>&, long long); };",
});
assert.equal(mixedVoidSpec.kind, "supported");
const mixedVoidCase = parseDebugTestCase(
  '"你好"\n"!"\n[1,2.5]\n[[true,false],[false,true]]\n9223372036854775807',
  mixedVoidSpec.parameters,
);
const mixedVoidProgram = renderCppDebugProgram({
  solutionPath: "/tmp/solution.cpp",
  spec: mixedVoidSpec,
  testCase: mixedVoidCase,
});
assert.match(mixedVoidProgram, /std::vector<std::vector<bool>> arg3/);
assert.match(mixedVoidProgram, /9223372036854775807LL/);

assert.match(PROBLEM_DETAIL_QUERY, /\bmetaData\b/);
const commandIds = new Set(manifest.contributes.commands.map((command) => command.command));
assert.equal(commandIds.has("leetdock.debugSolution"), true);
assert.equal(
  manifest.contributes.configuration.properties["leetdock.debug.cpp.compilerPath"].default,
  "g++",
);
assert.equal(
  manifest.contributes.configuration.properties["leetdock.debug.cpp.debuggerPath"].default,
  "gdb",
);
assert.ok(
  manifest.contributes.menus["explorer/context"].some(
    (item) => item.command === "leetdock.debugSolution",
  ),
);
assert.ok(
  manifest.contributes.menus["leetdock.solutionActions"].some(
    (item) => item.command === "leetdock.debugSolution",
  ),
);

if (process.platform === "linux" && compilerAvailable()) {
  compileAndRunSmokeTest(twoSumSpec, twoSumCase, `
class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> seen;
        for (int i = 0; i < static_cast<int>(nums.size()); ++i) {
            const auto found = seen.find(target - nums[i]);
            if (found != seen.end()) return {found->second, i};
            seen[nums[i]] = i;
        }
        return {};
    }
};
`, "[0,1]\n", "Solution::twoSum");

  compileAndRunSmokeTest(voidSpec, voidCase, `
class Solution {
public:
    void moveZeroes(vector<int>& nums) {
        stable_partition(nums.begin(), nums.end(), [](int value) { return value != 0; });
    }
};
`, "[1,3,12,0,0]\n");

  compileAndRunSmokeTest(mixedVoidSpec, mixedVoidCase, `
class Solution {
public:
    void touch(
        string& text,
        char& marker,
        vector<double>& values,
        vector<vector<bool>>& flags,
        long long limit
    ) {
        text += marker;
        values[0] += 0.5;
        flags[0][0] = !flags[0][0];
        if (limit == 0) marker = '?';
    }
};
`, '"你好!"\n"!"\n[1.5,2.5]\n[[false,false],[false,true]]\n9223372036854775807\n');
}

checkPersistentDebugSpec().then(
  () => console.log("LeetDock local C++ debug support checks passed."),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);

function compilerAvailable() {
  const result = spawnSync("g++", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

function compileAndRunSmokeTest(spec, testCase, solution, expectedOutput, symbol) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "leetdock-debug-check-"));
  try {
    const solutionPath = path.join(directory, "solution.cpp");
    const mainPath = path.join(directory, "main.cpp");
    const programPath = path.join(directory, "program");
    fs.writeFileSync(solutionPath, solution, "utf8");
    fs.writeFileSync(
      mainPath,
      renderCppDebugProgram({ solutionPath, spec, testCase }),
      "utf8",
    );
    const compiled = spawnSync(
      "g++",
      ["-std=c++17", "-O0", "-g3", mainPath, "-o", programPath],
      { encoding: "utf8" },
    );
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const executed = spawnSync(programPath, [], { encoding: "utf8" });
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.equal(executed.stdout, expectedOutput);
    if (symbol !== undefined && debuggerAvailable()) {
      const inspected = spawnSync(
        "gdb",
        ["--batch", "--quiet", "-ex", `info line ${symbol}`, programPath],
        { encoding: "utf8" },
      );
      assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
      assert.match(inspected.stdout, /solution\.cpp/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function debuggerAvailable() {
  const result = spawnSync("gdb", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

async function checkPersistentDebugSpec() {
  const values = new Map();
  const storage = new CacheStorage({
    get: (key) => values.get(key),
    update: async (key, value) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    },
    keys: () => [...values.keys()],
  });
  const cache = new ProblemCache(storage);
  await cache.setDetail({
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
    debugProblemSpec: twoSumSpec,
    hints: [],
  }, cache.captureUserDataGeneration());
  assert.deepEqual(await cache.getDebugProblemSpec("two-sum"), twoSumSpec);
  const storedDebugEntry = [...values.entries()].find(([key]) =>
    key.includes("problem.debugSpec.two-sum")
  )?.[1];
  assert.notEqual(storedDebugEntry, undefined);
  assert.equal(storedDebugEntry.expiresAt, undefined, "debug signature must not expire");
  await cache.clearAll();
  assert.equal(await cache.getDebugProblemSpec("two-sum"), undefined);
}
