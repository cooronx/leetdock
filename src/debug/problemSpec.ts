export const DEBUG_PROBLEM_SPEC_VERSION = 1;

export type DebugScalarType =
  | "integer"
  | "long"
  | "double"
  | "boolean"
  | "string"
  | "character";

export interface DebugValueType {
  readonly scalar: DebugScalarType;
  readonly dimensions: 0 | 1 | 2;
}

export interface DebugParameter {
  readonly name: string;
  readonly type: DebugValueType;
}

interface DebugProblemSpecBase {
  readonly version: typeof DEBUG_PROBLEM_SPEC_VERSION;
  readonly exampleTestcases?: string;
  readonly sampleTestCase?: string;
}

export interface SupportedDebugProblemSpec extends DebugProblemSpecBase {
  readonly kind: "supported";
  readonly methodName: string;
  readonly parameters: readonly DebugParameter[];
  readonly returnType: DebugValueType | "void";
}

export interface UnsupportedDebugProblemSpec extends DebugProblemSpecBase {
  readonly kind: "unsupported";
  readonly reason: string;
}

export type DebugProblemSpec =
  | SupportedDebugProblemSpec
  | UnsupportedDebugProblemSpec;

export interface DebugProblemMetadataSource {
  readonly metadata?: string;
  readonly cppSnippet?: string;
  readonly exampleTestcases?: string;
  readonly sampleTestCase?: string;
}

/** Normalizes LeetCode metadata into the small value model used by local debuggers. */
export function createDebugProblemSpec(
  source: DebugProblemMetadataSource,
): DebugProblemSpec {
  const samples = sampleFields(source);
  const metadataText = source.metadata?.trim();
  if (metadataText === undefined || metadataText.length === 0) {
    return unsupported("题目未提供可用的函数签名元数据。", samples);
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataText);
  } catch {
    return unsupported("题目的函数签名元数据格式无效。", samples);
  }
  if (!isRecord(metadata)) {
    return unsupported("题目的函数签名元数据格式无效。", samples);
  }
  if (metadata.manual === true) {
    return unsupported("该题需要手动或交互式调用，首版暂不支持调试。", samples);
  }
  if (!/\bclass\s+Solution\b/.test(source.cppSnippet ?? "")) {
    return unsupported("该题不是普通的 C++ class Solution 单方法题。", samples);
  }
  if (/\bSolution\s*\(/.test(source.cppSnippet ?? "")) {
    return unsupported("该题包含自定义构造器，属于暂不支持的设计题。", samples);
  }

  const methodName = nonEmptyString(metadata.name);
  if (methodName === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(methodName)) {
    return unsupported("题目的 C++ 方法名无效。", samples);
  }
  if (methodName === "Solution") {
    return unsupported("该题通过构造器和多次操作执行，属于暂不支持的设计题。", samples);
  }

  if (!Array.isArray(metadata.params)) {
    return unsupported("题目未提供有效的参数列表。", samples);
  }
  const parameters: DebugParameter[] = [];
  for (let index = 0; index < metadata.params.length; index += 1) {
    const rawParameter = metadata.params[index];
    if (!isRecord(rawParameter)) {
      return unsupported(`第 ${index + 1} 个参数的元数据格式无效。`, samples);
    }
    const name = nonEmptyString(rawParameter.name);
    const rawType = nonEmptyString(rawParameter.type);
    if (name === undefined || rawType === undefined) {
      return unsupported(`第 ${index + 1} 个参数的元数据不完整。`, samples);
    }
    const type = parseDebugValueType(rawType);
    if (type === undefined) {
      return unsupported(
        `参数“${name}”使用了暂不支持的类型 ${rawType}。`,
        samples,
      );
    }
    parameters.push({ name, type });
  }

  if (!isRecord(metadata.return)) {
    return unsupported("题目未提供有效的返回值类型。", samples);
  }
  const rawReturnType = nonEmptyString(metadata.return.type);
  if (rawReturnType === undefined) {
    return unsupported("题目未提供有效的返回值类型。", samples);
  }
  const returnType = rawReturnType.trim().toLocaleLowerCase("en-US") === "void"
    ? "void"
    : parseDebugValueType(rawReturnType);
  if (returnType === undefined) {
    return unsupported(`返回值使用了暂不支持的类型 ${rawReturnType}。`, samples);
  }

  return {
    version: DEBUG_PROBLEM_SPEC_VERSION,
    kind: "supported",
    methodName,
    parameters,
    returnType,
    ...samples,
  };
}

export function parseDebugValueType(value: string): DebugValueType | undefined {
  let normalized = value.trim().toLocaleLowerCase("en-US");
  let dimensions = 0;
  while (normalized.endsWith("[]")) {
    dimensions += 1;
    normalized = normalized.slice(0, -2).trimEnd();
  }
  if (dimensions > 2 || !isDebugScalarType(normalized)) {
    return undefined;
  }
  return {
    scalar: normalized,
    dimensions: dimensions as 0 | 1 | 2,
  };
}

export function getDebugSampleInputs(
  spec: SupportedDebugProblemSpec,
): readonly string[] {
  const parameterCount = spec.parameters.length;
  if (parameterCount === 0) {
    return [""];
  }

  const examples = groupTestcaseLines(spec.exampleTestcases, parameterCount);
  const fallback = groupTestcaseLines(spec.sampleTestCase, parameterCount);
  const inputs = examples.length > 0 ? examples : fallback;
  return [...new Set(inputs)];
}

export function previewDebugInput(input: string, maxLength = 80): string {
  const preview = input.replace(/\r?\n/g, " · ").trim();
  return preview.length <= maxLength
    ? preview
    : `${preview.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function isDebugProblemSpec(value: unknown): value is DebugProblemSpec {
  if (
    !isRecord(value) ||
    value.version !== DEBUG_PROBLEM_SPEC_VERSION ||
    (value.exampleTestcases !== undefined && typeof value.exampleTestcases !== "string") ||
    (value.sampleTestCase !== undefined && typeof value.sampleTestCase !== "string")
  ) {
    return false;
  }
  if (value.kind === "unsupported") {
    return typeof value.reason === "string" && value.reason.trim().length > 0;
  }
  if (
    value.kind !== "supported" ||
    typeof value.methodName !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.methodName) ||
    !Array.isArray(value.parameters) ||
    !(value.returnType === "void" || isDebugValueType(value.returnType))
  ) {
    return false;
  }
  return value.parameters.every(
    (parameter) =>
      isRecord(parameter) &&
      typeof parameter.name === "string" &&
      parameter.name.trim().length > 0 &&
      isDebugValueType(parameter.type),
  );
}

function groupTestcaseLines(
  value: string | undefined,
  parameterCount: number,
): readonly string[] {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return [];
  }
  const lines = normalized.split(/\r?\n/).map((line) => line.trim());
  if (lines.length % parameterCount !== 0) {
    return [];
  }
  const groups: string[] = [];
  for (let index = 0; index < lines.length; index += parameterCount) {
    groups.push(lines.slice(index, index + parameterCount).join("\n"));
  }
  return groups;
}

function sampleFields(
  source: DebugProblemMetadataSource,
): Pick<DebugProblemSpecBase, "exampleTestcases" | "sampleTestCase"> {
  return {
    ...(source.exampleTestcases === undefined
      ? {}
      : { exampleTestcases: source.exampleTestcases }),
    ...(source.sampleTestCase === undefined
      ? {}
      : { sampleTestCase: source.sampleTestCase }),
  };
}

function unsupported(
  reason: string,
  samples: Pick<DebugProblemSpecBase, "exampleTestcases" | "sampleTestCase">,
): UnsupportedDebugProblemSpec {
  return {
    version: DEBUG_PROBLEM_SPEC_VERSION,
    kind: "unsupported",
    reason,
    ...samples,
  };
}

function isDebugScalarType(value: unknown): value is DebugScalarType {
  return (
    value === "integer" ||
    value === "long" ||
    value === "double" ||
    value === "boolean" ||
    value === "string" ||
    value === "character"
  );
}

function isDebugValueType(value: unknown): value is DebugValueType {
  return (
    isRecord(value) &&
    isDebugScalarType(value.scalar) &&
    (value.dimensions === 0 || value.dimensions === 1 || value.dimensions === 2)
  );
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
