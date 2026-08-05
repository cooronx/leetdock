import { AuthService } from "./authService";
import { LeetCodeError } from "../leetcode/errors";

export async function withAuthExpiryHandling<T>(
  auth: AuthService,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof LeetCodeError && error.kind === "authentication") {
      const validation = await auth.revalidateAuthentication();
      if (validation === "valid") {
        throw new LeetCodeError(
          "authorization",
          "LeetDock rejected the request while the session remained valid.",
        );
      }
      if (validation === "unavailable") {
        throw new LeetCodeError(
          "service",
          "Could not verify whether the LeetDock session expired.",
        );
      }
    }
    throw error;
  }
}
