import type { LeetCodeApi } from "../../src/leetcode/api";
import {
  BRIDGE_PROTOCOL_VERSION,
  type NetworkBridgeRequest,
} from "../../src/bridge/protocol";
import type { Difficulty, ProblemDetail } from "../../src/leetcode/types";

const NETWORK_METHODS = [
  "searchProblems",
  "getDifficultyQuestions",
  "getTags",
  "getTagQuestions",
  "getProblem",
  "getDailyChallenge",
  "getDailyStreak",
  "getMyProblemLists",
  "getProblemListQuestions",
  "getProblemListProgress",
  "getProblemListQuestionAccepted",
  "getCompanies",
  "getCompanyQuestionSource",
  "getCompanyQuestions",
  "testSolution",
  "submitSolution",
  "getProblemIndex",
] as const;

export function dispatchNetworkRequest(
  client: LeetCodeApi,
  request: unknown,
): Promise<unknown> {
  if (!isNetworkBridgeRequest(request)) {
    throw new Error("LeetDock received an invalid local network request.");
  }
  const args = request.args;
  switch (request.method) {
    case "searchProblems":
      return client.searchProblems(asString(args[0]), asNumber(args[1]), asNumber(args[2]));
    case "getDifficultyQuestions":
      return client.getDifficultyQuestions(
        asDifficulty(args[0]),
        asNumber(args[1]),
        asNumber(args[2]),
      );
    case "getTags":
      return client.getTags();
    case "getTagQuestions":
      return client.getTagQuestions(asString(args[0]), asNumber(args[1]), asNumber(args[2]));
    case "getProblem":
      return client.getProblem(asString(args[0]));
    case "getDailyChallenge":
      return client.getDailyChallenge();
    case "getDailyStreak":
      return client.getDailyStreak();
    case "getMyProblemLists":
      return client.getMyProblemLists();
    case "getProblemListQuestions":
      return client.getProblemListQuestions(
        asString(args[0]),
        asNumber(args[1]),
        asNumber(args[2]),
      );
    case "getProblemListProgress":
      return client.getProblemListProgress(asString(args[0]));
    case "getProblemListQuestionAccepted":
      return client.getProblemListQuestionAccepted(
        asString(args[0]),
        asString(args[1]),
      );
    case "getCompanies":
      return client.getCompanies();
    case "getCompanyQuestionSource":
      return client.getCompanyQuestionSource(asString(args[0]));
    case "getCompanyQuestions":
      return client.getCompanyQuestions(
        asString(args[0]),
        asString(args[1]),
        asNumber(args[2]),
        asNumber(args[3]),
      );
    case "testSolution":
      return client.testSolution(
        asProblemDetail(args[0]),
        asString(args[1]),
        asString(args[2]),
        asString(args[3]),
      );
    case "submitSolution":
      return client.submitSolution(
        asProblemDetail(args[0]),
        asString(args[1]),
        asString(args[2]),
      );
    case "getProblemIndex":
      return client.getProblemIndex();
  }
}

function isNetworkBridgeRequest(value: unknown): value is NetworkBridgeRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const method = Reflect.get(value, "method");
  return Reflect.get(value, "version") === BRIDGE_PROTOCOL_VERSION &&
    typeof method === "string" &&
    (NETWORK_METHODS as readonly string[]).includes(method) &&
    Array.isArray(Reflect.get(value, "args"));
}

function asString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("LeetDock local network request expected a string argument.");
  }
  return value;
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("LeetDock local network request expected a number argument.");
  }
  return value;
}

function asDifficulty(value: unknown): Difficulty {
  if (value !== "Easy" && value !== "Medium" && value !== "Hard") {
    throw new Error("LeetDock local network request expected a difficulty.");
  }
  return value;
}

function asProblemDetail(value: unknown): ProblemDetail {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof Reflect.get(value, "titleSlug") !== "string" ||
    typeof Reflect.get(value, "internalId") !== "string"
  ) {
    throw new Error("LeetDock local network request expected a problem detail.");
  }
  return value as ProblemDetail;
}
