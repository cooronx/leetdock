import { LeetCodeError } from "./errors";
import type { JudgeAction, JudgeResult } from "./types";

export function isJudgePending(payload: Readonly<Record<string, unknown>>): boolean {
  const state = requiredString(payload.state, "judge state").toUpperCase();
  return state === "STARTED" || state === "PENDING";
}

export function mapJudgeResult(
  action: JudgeAction,
  taskId: string,
  payload: Readonly<Record<string, unknown>>,
  input?: string,
): JudgeResult {
  const state = requiredString(payload.state, "judge state");
  const statusCode = asFiniteNumber(payload.status_code);
  const testAccepted = payload.correct_answer === true;
  const accepted = action === "test" ? testAccepted : statusCode === 10;
  const rawStatusMessage = asString(payload.status_msg)?.trim();
  const statusMessage =
    action === "test" && !testAccepted && statusCode === 10
      ? "Wrong Answer"
      : rawStatusMessage || statusLabel(statusCode);

  return {
    action,
    taskId,
    state,
    ...(statusCode === undefined ? {} : { statusCode }),
    statusMessage,
    accepted,
    runSuccess: payload.run_success === true,
    ...optionalStringField("runtime", payload.status_runtime),
    ...optionalStringField("memory", payload.status_memory),
    ...optionalStringField("compileError", payload.full_compile_error),
    ...optionalStringField("runtimeError", payload.runtime_error),
    ...optionalStringField(
      "input",
      action === "test" ? input : payload.last_testcase,
    ),
    ...optionalOutputField(
      "actualOutput",
      action === "test" ? payload.code_answer : payload.code_output,
    ),
    ...optionalOutputField(
      "expectedOutput",
      action === "test" ? payload.expected_code_answer : payload.expected_output,
    ),
    ...optionalOutputField(
      "standardOutput",
      payload.std_output_list ?? payload.std_output,
    ),
    ...optionalNumberField("totalCorrect", payload.total_correct),
    ...optionalNumberField("totalTestcases", payload.total_testcases),
    ...optionalNumberField("runtimePercentile", payload.runtime_percentile),
    ...optionalNumberField("memoryPercentile", payload.memory_percentile),
  };
}

function optionalStringField<Key extends string>(
  key: Key,
  value: unknown,
): Partial<Record<Key, string>> {
  const text = asString(value)?.trim();
  return text === undefined || text.length === 0
    ? {}
    : { [key]: text } as Record<Key, string>;
}

function optionalOutputField<Key extends string>(
  key: Key,
  value: unknown,
): Partial<Record<Key, string>> {
  const output = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join("\n")
    : asString(value);
  return output === undefined ? {} : { [key]: output } as Record<Key, string>;
}

function optionalNumberField<Key extends string>(
  key: Key,
  value: unknown,
): Partial<Record<Key, number>> {
  const number = asFiniteNumber(value);
  return number === undefined ? {} : { [key]: number } as Record<Key, number>;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredString(value: unknown, field: string): string {
  const result = asString(value);
  if (result === undefined || result.length === 0) {
    throw new LeetCodeError("invalid-response", `Missing ${field} in response.`);
  }
  return result;
}

function statusLabel(statusCode: number | undefined): string {
  switch (statusCode) {
    case 10:
      return "Accepted";
    case 11:
      return "Wrong Answer";
    case 12:
      return "Memory Limit Exceeded";
    case 13:
      return "Output Limit Exceeded";
    case 14:
      return "Time Limit Exceeded";
    case 15:
      return "Runtime Error";
    case 20:
      return "Compile Error";
    default:
      return "Finished";
  }
}
