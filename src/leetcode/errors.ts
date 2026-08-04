export type LeetCodeErrorKind =
  | "authentication"
  | "authorization"
  | "dns"
  | "graphql"
  | "invalid-response"
  | "network"
  | "not-found"
  | "rate-limit"
  | "service"
  | "stale-session"
  | "timeout";

interface LeetCodeErrorOptions {
  readonly cause?: unknown;
  readonly retryable?: boolean;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
}

export class LeetCodeError extends Error {
  public readonly retryable: boolean;
  public readonly statusCode?: number;
  public readonly retryAfterMs?: number;

  public constructor(
    public readonly kind: LeetCodeErrorKind,
    message: string,
    options: LeetCodeErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LeetCodeError";
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function toUserMessage(error: unknown): string {
  if (!(error instanceof LeetCodeError)) {
    return "LeetDock 遇到了未预期的错误，请重试。";
  }

  switch (error.kind) {
    case "authentication":
      return "LeetCode 登录已过期，请重新登录。";
    case "authorization":
      return "当前 LeetCode 账号无权访问该内容或请求被拒绝。";
    case "dns":
      return "无法解析 leetcode.cn，请检查 DNS 或网络设置。";
    case "timeout":
      return "连接 LeetCode 超时，请稍后重试。";
    case "rate-limit":
      return "请求过于频繁，请稍后再试。";
    case "service":
      return "LeetCode 服务暂时不可用，请稍后重试。";
    case "stale-session":
      return "LeetCode 登录状态已发生变化，请重试。";
    case "graphql":
      return "LeetCode 返回了接口错误，请稍后重试。";
    case "not-found":
      return "没有找到对应题目，请检查题号、名称或 URL。";
    case "invalid-response":
      return "LeetCode 返回了无法识别的数据。";
    case "network":
      return "无法连接 LeetCode，请检查网络连接。";
  }
}
