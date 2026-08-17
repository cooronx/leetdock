const assert = require("node:assert/strict");
const http = require("node:http");

async function main() {
  const requests = [];
  const proxy = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        url: request.url,
        method: request.method,
        body,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: { userStatus: { isSignedIn: true } } }));
    });
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));

  const address = proxy.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  const originalEnvironment = {
    ALL_PROXY: process.env.ALL_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    NO_PROXY: process.env.NO_PROXY,
    all_proxy: process.env.all_proxy,
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy,
    no_proxy: process.env.no_proxy,
  };

  try {
    process.env.ALL_PROXY = proxyUrl;
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.NO_PROXY = "";
    process.env.all_proxy = proxyUrl;
    process.env.http_proxy = proxyUrl;
    process.env.https_proxy = proxyUrl;
    process.env.no_proxy = "";

    const { createProxyAwareFetch } = require("../dist/leetcode/httpTransport.js");
    const proxyAwareFetch = createProxyAwareFetch();
    const response = await proxyAwareFetch("http://leetdock.invalid/graphql/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "query Test { userStatus { isSignedIn } }" }),
      redirect: "manual",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: { userStatus: { isSignedIn: true } },
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "http://leetdock.invalid/graphql/");
    assert.equal(requests[0].method, "POST");
    assert.match(requests[0].body, /query Test/);
  } finally {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await new Promise((resolve, reject) => proxy.close((error) => {
      if (error) reject(error);
      else resolve();
    }));
  }

  console.log("LeetDock HTTP transport honors environment proxy settings.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
