import type {
  DebugParameter,
  DebugScalarType,
  DebugValueType,
  SupportedDebugProblemSpec,
} from "./problemSpec";

const INTEGER_MIN = -2_147_483_648n;
const INTEGER_MAX = 2_147_483_647n;
const LONG_MIN = -9_223_372_036_854_775_808n;
const LONG_MAX = 9_223_372_036_854_775_807n;

export type DebugValue =
  | { readonly kind: "integer"; readonly value: bigint }
  | { readonly kind: "long"; readonly value: bigint }
  | { readonly kind: "double"; readonly source: string; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "character"; readonly value: string }
  | { readonly kind: "array"; readonly values: readonly DebugValue[] };

export interface DebugTestCase {
  readonly rawInput: string;
  readonly arguments: readonly DebugValue[];
}

export interface CppDebugProgramInput {
  readonly solutionPath: string;
  readonly spec: SupportedDebugProblemSpec;
  readonly testCase: DebugTestCase;
}

export class DebugInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DebugInputError";
  }
}

export function parseDebugTestCase(
  input: string,
  parameters: readonly DebugParameter[],
): DebugTestCase {
  if (parameters.length === 0) {
    if (input.trim().length !== 0) {
      throw new DebugInputError("该方法没有参数，调试输入必须为空。");
    }
    return { rawInput: "", arguments: [] };
  }

  const normalized = input.trim();
  const lines = normalized.length === 0 ? [] : normalized.split(/\r?\n/);
  if (lines.length !== parameters.length) {
    throw new DebugInputError(
      `调试输入需要 ${parameters.length} 行参数，当前为 ${lines.length} 行。`,
    );
  }

  const values = parameters.map((parameter, index) => {
    const line = lines[index];
    if (line === undefined) {
      throw new DebugInputError(`缺少参数“${parameter.name}”。`);
    }
    try {
      return new TypedJsonParser(line).parse(parameter.type);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DebugInputError(
        `参数“${parameter.name}”（第 ${index + 1} 行）无效：${detail}`,
      );
    }
  });
  return { rawInput: normalized, arguments: values };
}

export function renderCppDebugProgram(input: CppDebugProgramInput): string {
  if (input.testCase.arguments.length !== input.spec.parameters.length) {
    throw new Error("Debug argument count does not match the problem signature.");
  }

  const declarations = input.spec.parameters.map((parameter, index) => {
    const value = input.testCase.arguments[index];
    if (value === undefined) {
      throw new Error(`Missing debug argument ${index}.`);
    }
    return `  ${renderCppType(parameter.type)} arg${index} = ${renderCppValue(value)};`;
  });
  const argumentsList = input.spec.parameters
    .map((_parameter, index) => `arg${index}`)
    .join(", ");
  const invocation = input.spec.returnType === "void"
    ? [
        `  solution.${input.spec.methodName}(${argumentsList});`,
        ...input.spec.parameters.flatMap((_parameter, index) => [
          `  leetdock_debug_internal::print(arg${index});`,
          "  std::cout << '\\n';",
        ]),
      ]
    : [
        `  auto result = solution.${input.spec.methodName}(${argumentsList});`,
        "  leetdock_debug_internal::print(result);",
        "  std::cout << '\\n';",
      ];

  return `#include <bits/stdc++.h>

using namespace std;

#include "${escapeCppIncludePath(input.solutionPath)}"

${CPP_PRINT_HELPERS}

int main() {
${declarations.join("\n")}
  Solution solution;
${invocation.join("\n")}
  return 0;
}
`;
}

class TypedJsonParser {
  private index = 0;

  public constructor(private readonly text: string) {}

  public parse(type: DebugValueType): DebugValue {
    const value = this.parseValue(type);
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      throw new Error(`位置 ${this.index + 1} 存在多余内容。`);
    }
    return value;
  }

  private parseValue(type: DebugValueType): DebugValue {
    this.skipWhitespace();
    if (type.dimensions > 0) {
      return this.parseArray({
        scalar: type.scalar,
        dimensions: (type.dimensions - 1) as 0 | 1,
      });
    }
    return this.parseScalar(type.scalar);
  }

  private parseArray(elementType: DebugValueType): DebugValue {
    this.expect("[");
    this.skipWhitespace();
    const values: DebugValue[] = [];
    if (this.peek() === "]") {
      this.index += 1;
      return { kind: "array", values };
    }

    while (true) {
      values.push(this.parseValue(elementType));
      this.skipWhitespace();
      const next = this.peek();
      if (next === "]") {
        this.index += 1;
        return { kind: "array", values };
      }
      if (next !== ",") {
        throw new Error(`位置 ${this.index + 1} 应为逗号或右方括号。`);
      }
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseScalar(type: DebugScalarType): DebugValue {
    switch (type) {
      case "integer": {
        const token = this.parseNumberToken();
        const value = parseIntegerToken(token, INTEGER_MIN, INTEGER_MAX, "integer");
        return { kind: "integer", value };
      }
      case "long": {
        const token = this.parseNumberToken();
        const value = parseIntegerToken(token, LONG_MIN, LONG_MAX, "long");
        return { kind: "long", value };
      }
      case "double": {
        const source = this.parseNumberToken();
        const value = Number(source);
        if (!Number.isFinite(value)) {
          throw new Error("double 超出有限数值范围。");
        }
        return { kind: "double", source, value };
      }
      case "boolean":
        if (this.text.startsWith("true", this.index)) {
          this.index += 4;
          return { kind: "boolean", value: true };
        }
        if (this.text.startsWith("false", this.index)) {
          this.index += 5;
          return { kind: "boolean", value: false };
        }
        throw new Error("boolean 必须是 true 或 false。");
      case "string":
        return { kind: "string", value: this.parseStringToken() };
      case "character": {
        const value = this.parseStringToken();
        if (Array.from(value).length !== 1 || Buffer.byteLength(value, "utf8") !== 1) {
          throw new Error("character 必须是一个单字节字符。");
        }
        return { kind: "character", value };
      }
    }
  }

  private parseNumberToken(): string {
    const remaining = this.text.slice(this.index);
    const match = remaining.match(
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    );
    const token = match?.[0];
    if (token === undefined) {
      throw new Error("需要一个合法的 JSON 数字。");
    }
    this.index += token.length;
    return token;
  }

  private parseStringToken(): string {
    this.skipWhitespace();
    if (this.peek() !== '"') {
      throw new Error("字符串和字符必须使用双引号。");
    }
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === "\\") {
        this.index += 2;
        continue;
      }
      this.index += 1;
      if (character === '"') {
        const token = this.text.slice(start, this.index);
        try {
          const parsed: unknown = JSON.parse(token);
          if (typeof parsed !== "string") {
            throw new Error("not a string");
          }
          return parsed;
        } catch {
          throw new Error("字符串不是合法的 JSON 字符串。");
        }
      }
    }
    throw new Error("字符串缺少结束双引号。");
  }

  private expect(expected: string): void {
    this.skipWhitespace();
    if (this.peek() !== expected) {
      throw new Error(`位置 ${this.index + 1} 应为 ${expected}。`);
    }
    this.index += 1;
  }

  private peek(): string | undefined {
    return this.text[this.index];
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.text[this.index] ?? "")) {
      this.index += 1;
    }
  }
}

function parseIntegerToken(
  token: string,
  minimum: bigint,
  maximum: bigint,
  label: string,
): bigint {
  if (!/^-?(?:0|[1-9]\d*)$/.test(token)) {
    throw new Error(`${label} 必须是不带小数或指数的整数。`);
  }
  const value = BigInt(token);
  if (value < minimum || value > maximum) {
    throw new Error(`${label} 超出支持范围。`);
  }
  return value;
}

function renderCppType(type: DebugValueType): string {
  let result = cppScalarType(type.scalar);
  for (let dimension = 0; dimension < type.dimensions; dimension += 1) {
    result = `std::vector<${result}>`;
  }
  return result;
}

function cppScalarType(type: DebugScalarType): string {
  switch (type) {
    case "integer":
      return "int";
    case "long":
      return "long long";
    case "double":
      return "double";
    case "boolean":
      return "bool";
    case "string":
      return "std::string";
    case "character":
      return "char";
  }
}

function renderCppValue(value: DebugValue): string {
  switch (value.kind) {
    case "integer":
      return value.value.toString();
    case "long":
      return value.value === LONG_MIN
        ? "(-9223372036854775807LL - 1LL)"
        : `${value.value.toString()}LL`;
    case "double":
      return /[.eE]/.test(value.source) ? value.source : `${value.source}.0`;
    case "boolean":
      return value.value ? "true" : "false";
    case "string":
      return renderCppString(value.value);
    case "character": {
      const byte = Buffer.from(value.value, "utf8")[0];
      if (byte === undefined) {
        throw new Error("Cannot render an empty C++ character.");
      }
      return `static_cast<char>(0x${byte.toString(16).padStart(2, "0")})`;
    }
    case "array":
      return `{${value.values.map(renderCppValue).join(", ")}}`;
  }
}

function renderCppString(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length === 0) {
    return "std::string()";
  }
  const literals = [...bytes]
    .map((byte) => `"\\x${byte.toString(16).padStart(2, "0")}"`)
    .join("");
  return `std::string(${literals}, ${bytes.length})`;
}

function escapeCppIncludePath(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error("Solution path cannot contain a line break.");
  }
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

const CPP_PRINT_HELPERS = String.raw`namespace leetdock_debug_internal {
inline void print_string(const std::string& value) {
  std::cout << '"';
  static constexpr char hex[] = "0123456789abcdef";
  for (const unsigned char byte : value) {
    switch (byte) {
      case '"': std::cout << "\\\""; break;
      case '\\': std::cout << "\\\\"; break;
      case '\b': std::cout << "\\b"; break;
      case '\f': std::cout << "\\f"; break;
      case '\n': std::cout << "\\n"; break;
      case '\r': std::cout << "\\r"; break;
      case '\t': std::cout << "\\t"; break;
      default:
        if (byte < 0x20) {
          std::cout << "\\u00" << hex[byte >> 4] << hex[byte & 0x0f];
        } else {
          std::cout.put(static_cast<char>(byte));
        }
    }
  }
  std::cout << '"';
}

inline void print(int value) { std::cout << value; }
inline void print(long long value) { std::cout << value; }
inline void print(double value) {
  if (std::isfinite(value)) {
    std::cout << std::setprecision(std::numeric_limits<double>::max_digits10) << value;
  } else {
    std::cout << "null";
  }
}
inline void print(bool value) { std::cout << (value ? "true" : "false"); }
inline void print(const std::string& value) { print_string(value); }
inline void print(char value) { print_string(std::string(1, value)); }

template <typename T>
void print(const std::vector<T>& values) {
  std::cout << '[';
  for (std::size_t index = 0; index < values.size(); ++index) {
    if (index != 0) std::cout << ',';
    const T element = values[index];
    print(element);
  }
  std::cout << ']';
}
}  // namespace leetdock_debug_internal`;
