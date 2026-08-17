import { LeetCodeError, type LeetCodeErrorKind } from "../leetcode/errors";
import type { UserInfo } from "../leetcode/types";

export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const LOCAL_NETWORK_COMMAND = "leetdock.internal.local.network";
export const LOCAL_AUTH_STATE_COMMAND = "leetdock.internal.localAuth.state";
export const LOCAL_AUTH_SIGN_IN_COMMAND = "leetdock.internal.localAuth.signIn";
export const LOCAL_AUTH_SIGN_OUT_COMMAND = "leetdock.internal.localAuth.signOut";
export const REMOTE_AUTH_CHANGED_COMMAND = "leetdock.internal.remoteAuth.changed";

export type LeetCodeMethod =
  | "searchProblems"
  | "getDifficultyQuestions"
  | "getTags"
  | "getTagQuestions"
  | "getProblem"
  | "getDailyChallenge"
  | "getDailyStreak"
  | "getMyProblemLists"
  | "getProblemListQuestions"
  | "getProblemListProgress"
  | "getProblemListQuestionAccepted"
  | "getCompanies"
  | "getCompanyQuestionSource"
  | "getCompanyQuestions"
  | "testSolution"
  | "submitSolution"
  | "getProblemIndex";

export interface NetworkBridgeRequest {
  readonly version: typeof BRIDGE_PROTOCOL_VERSION;
  readonly method: LeetCodeMethod;
  readonly args: readonly unknown[];
}

interface SerializedBridgeError {
  readonly name: string;
  readonly message: string;
  readonly kind?: LeetCodeErrorKind;
  readonly retryable?: boolean;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
}

export type BridgeResult<T = unknown> =
  | {
      readonly version: typeof BRIDGE_PROTOCOL_VERSION;
      readonly ok: true;
      readonly value?: T;
    }
  | {
      readonly version: typeof BRIDGE_PROTOCOL_VERSION;
      readonly ok: false;
      readonly error: SerializedBridgeError;
    };

export type LocalAuthenticationState =
  | { readonly status: "signed-out"; readonly reason?: "expired" | "missing" }
  | { readonly status: "signed-in"; readonly user: UserInfo }
  | { readonly status: "offline"; readonly user?: UserInfo };

export type CommandExecutor = (
  command: string,
  argument?: unknown,
) => Thenable<unknown>;

export async function executeBridgeCommand<T>(
  execute: CommandExecutor,
  command: string,
  argument?: unknown,
): Promise<T> {
  let response: unknown;
  try {
    response = await execute(command, argument);
  } catch (error) {
    throw companionUnavailableError(error);
  }
  if (!isBridgeResult(response)) {
    throw companionUnavailableError();
  }
  if (response.ok) {
    return response.value as T;
  }
  throw deserializeBridgeError(response.error);
}

export function bridgeSuccess<T>(value?: T): BridgeResult<T> {
  return {
    version: BRIDGE_PROTOCOL_VERSION,
    ok: true,
    ...(value === undefined ? {} : { value }),
  };
}

export function bridgeFailure(error: unknown): BridgeResult<never> {
  const base = {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
  if (!(error instanceof LeetCodeError)) {
    return {
      version: BRIDGE_PROTOCOL_VERSION,
      ok: false,
      error: base,
    };
  }
  return {
    version: BRIDGE_PROTOCOL_VERSION,
    ok: false,
    error: {
      ...base,
      kind: error.kind,
      retryable: error.retryable,
      ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
      ...(error.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: error.retryAfterMs }),
    },
  };
}

function isBridgeResult(value: unknown): value is BridgeResult {
  if (!isRecord(value) || value.version !== BRIDGE_PROTOCOL_VERSION) {
    return false;
  }
  if (value.ok === true) {
    return true;
  }
  return value.ok === false && isSerializedBridgeError(value.error);
}

function isSerializedBridgeError(value: unknown): value is SerializedBridgeError {
  return isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.message === "string";
}

function deserializeBridgeError(error: SerializedBridgeError): Error {
  if (error.kind !== undefined && isLeetCodeErrorKind(error.kind)) {
    return new LeetCodeError(error.kind, error.message, {
      retryable: error.retryable === true,
      ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
      ...(error.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: error.retryAfterMs }),
    });
  }
  const result = new Error(error.message);
  result.name = error.name;
  return result;
}

function companionUnavailableError(cause?: unknown): LeetCodeError {
  return new LeetCodeError(
    "companion",
    "The LeetDock local network companion is unavailable.",
    cause === undefined ? {} : { cause },
  );
}

function isLeetCodeErrorKind(value: string): value is LeetCodeErrorKind {
  return [
    "authentication",
    "authorization",
    "companion",
    "dns",
    "graphql",
    "invalid-response",
    "network",
    "not-found",
    "rate-limit",
    "service",
    "stale-session",
    "timeout",
  ].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
