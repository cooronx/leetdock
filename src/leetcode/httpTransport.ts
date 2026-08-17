import axios from "axios";

/** Adapts Axios' proxy-aware Node transport to the Fetch API used by the client. */
export function createProxyAwareFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestHeaders: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      requestHeaders[name] = value;
    });
    const response = await axios.request<ArrayBuffer>({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      headers: requestHeaders,
      data: init?.body,
      signal: init?.signal ?? undefined,
      responseType: "arraybuffer",
      maxRedirects: init?.redirect === "follow" || init?.redirect === undefined ? 21 : 0,
      validateStatus: () => true,
    });

    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value === undefined || value === null) {
        continue;
      }
      headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
    }
    // Axios decompresses response bodies before returning them.
    headers.delete("content-encoding");
    headers.delete("content-length");

    return new Response(response.data, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}
