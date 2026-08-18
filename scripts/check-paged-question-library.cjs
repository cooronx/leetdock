const assert = require("node:assert/strict");
const {
  PagedQuestionLibrary,
} = require("../dist/library/pagedQuestionLibrary.js");

const first = {
  titleSlug: "two-sum",
  status: null,
};
const second = {
  titleSlug: "add-two-numbers",
  status: "TRIED",
};
const third = {
  titleSlug: "longest-substring",
  status: null,
};

function detail(key, questions, total, hasMore) {
  return { key, questions, total, hasMore };
}

async function checkCatalogAndDetailState() {
  let catalogCalls = 0;
  let firstPageCalls = 0;
  const library = new PagedQuestionLibrary({
    keyOf: (key) => key,
    loadCatalog: async () => {
      catalogCalls += 1;
      return ["array", "hash-table"];
    },
    loadFirst: async (key) => {
      firstPageCalls += 1;
      return detail(key, [first, second], 3, true);
    },
    loadNextPage: async () => ({
      questions: [second, third],
      total: 3,
      hasMore: false,
    }),
    staleErrorMessage: "Library request became stale.",
    notFoundErrorMessage: (key) => `Library is not loaded: ${key}`,
  });

  assert.deepEqual(library.catalogState, { kind: "idle" });
  const catalogRequest = library.loadCatalog();
  assert.equal(library.catalogState.kind, "loading");
  assert.equal(library.loadCatalog(), catalogRequest, "catalog loads must be single-flight");
  assert.deepEqual(await catalogRequest, ["array", "hash-table"]);
  assert.deepEqual(library.catalogState, {
    kind: "ready",
    value: ["array", "hash-table"],
  });
  assert.equal(catalogCalls, 1);

  const detailRequest = library.loadDetail("array");
  assert.equal(library.getDetailState("array").kind, "loading");
  assert.equal(library.loadDetail("array"), detailRequest, "detail loads must be single-flight");
  assert.equal((await detailRequest).questions.length, 2);
  assert.equal(firstPageCalls, 1);

  const moreRequest = library.loadMore("array");
  const loadingMore = library.getDetailState("array");
  assert.equal(loadingMore.kind, "ready");
  assert.equal(loadingMore.loadingMore, true);
  assert.equal(library.loadMore("array"), moreRequest, "page loads must be single-flight");
  const loaded = await moreRequest;
  assert.deepEqual(loaded.questions, [first, second, third]);
  assert.equal(loaded.hasMore, false);
  assert.equal(library.getDetailState("array").loadingMore, false);

  assert.equal(library.markAccepted("two-sum"), true);
  assert.equal(library.getDetailSnapshot("array").questions[0].status, "AC");
  assert.equal(library.markAccepted("two-sum"), false);
}

async function checkResetInvalidatesPendingRequest() {
  let resolveFirstPage;
  const library = new PagedQuestionLibrary({
    keyOf: (key) => key,
    loadFirst: () => new Promise((resolve) => {
      resolveFirstPage = resolve;
    }),
    loadNextPage: async () => ({ questions: [], total: 0, hasMore: false }),
    staleErrorMessage: "Library request became stale.",
    notFoundErrorMessage: (key) => `Library is not loaded: ${key}`,
  });

  const pending = library.loadDetail("array");
  assert.equal(library.getDetailState("array").kind, "loading");
  library.reset();
  assert.deepEqual(library.getDetailState("array"), { kind: "idle" });
  resolveFirstPage(detail("array", [first], 1, false));

  await assert.rejects(pending, (error) => error?.kind === "stale-session");
  assert.deepEqual(
    library.getDetailState("array"),
    { kind: "idle" },
    "a stale request must not restore loading or error state after reset",
  );
}

async function checkFailuresRemainRetryable() {
  let firstPageCalls = 0;
  let rejectNextPage;
  const library = new PagedQuestionLibrary({
    keyOf: (key) => key,
    loadFirst: async (key) => {
      firstPageCalls += 1;
      if (firstPageCalls === 1) {
        throw new Error("first page failed");
      }
      return detail(key, [first], 2, true);
    },
    loadNextPage: () => new Promise((_resolve, reject) => {
      rejectNextPage = reject;
    }),
    staleErrorMessage: "Library request became stale.",
    notFoundErrorMessage: (key) => `Library is not loaded: ${key}`,
  });

  await assert.rejects(library.loadDetail("array"), /first page failed/);
  assert.equal(library.getDetailState("array").kind, "error");
  await library.loadDetail("array");
  assert.equal(firstPageCalls, 2, "an error state must allow a retry");

  const pendingPage = library.loadMore("array");
  assert.equal(library.getDetailState("array").loadingMore, true);
  rejectNextPage(new Error("next page failed"));
  await assert.rejects(pendingPage, /next page failed/);
  const state = library.getDetailState("array");
  assert.equal(state.kind, "ready");
  assert.equal(state.loadingMore, false);
  assert.deepEqual(state.value.questions, [first]);
}

Promise.all([
  checkCatalogAndDetailState(),
  checkResetInvalidatesPendingRequest(),
  checkFailuresRemainRetryable(),
]).then(
  () => console.log("Paged question library checks passed."),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
