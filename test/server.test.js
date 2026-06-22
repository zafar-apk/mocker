import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tempDir = await mkdtemp(path.join(tmpdir(), "mocker-test-"));
const rulesFile = path.join(tempDir, "rules.json");
process.env.RULES_FILE = rulesFile;

const { app } = await import("../server.js");

let server;
let baseUrl;

function listenLocal(target) {
  return new Promise((resolve, reject) => {
    const nextServer = target.listen(0, "127.0.0.1", () => resolve(nextServer));
    nextServer.once("error", reject);
  });
}

before(async () => {
  await writeFile(rulesFile, "[]");
  server = await listenLocal(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await rm(tempDir, { recursive: true, force: true });
});

test("saves a rule and serves it from the mock endpoint", async () => {
  const createResponse = await fetch(`${baseUrl}/api/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "GET",
      name: "Accepted user",
      enabled: true,
      sourceUrl: "https://api.example.test/users/42",
      pathname: "/users/42",
      status: 202,
      body: { ok: true }
    })
  });

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.name, "Accepted user");
  assert.equal(created.enabled, true);

  const mockResponse = await fetch(`${baseUrl}/mock/users/42`);
  assert.equal(mockResponse.status, 202);
  assert.equal(mockResponse.headers.get("x-mocker-hit"), "true");
  assert.deepEqual(await mockResponse.json(), { ok: true });
});

test("keeps disabled rules saved but ignores them for mock matching", async () => {
  const createResponse = await fetch(`${baseUrl}/api/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "GET",
      name: "Disabled variant",
      enabled: false,
      sourceUrl: "https://api.example.test/disabled",
      pathname: "/disabled",
      status: 299,
      body: { disabled: true }
    })
  });

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.name, "Disabled variant");
  assert.equal(created.enabled, false);

  const rulesResponse = await fetch(`${baseUrl}/api/rules`);
  const rules = await rulesResponse.json();
  assert.equal(rules.some((rule) => rule.id === created.id && rule.enabled === false), true);

  const mockResponse = await fetch(`${baseUrl}/mock/disabled`);
  assert.equal(mockResponse.status, 404);
});

test("updates an existing rule name and enabled state", async () => {
  const createResponse = await fetch(`${baseUrl}/api/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "GET",
      name: "Enabled before edit",
      enabled: true,
      sourceUrl: "https://api.example.test/toggle-me",
      pathname: "/toggle-me",
      status: 209,
      body: { active: true }
    })
  });

  const created = await createResponse.json();
  const updateResponse = await fetch(`${baseUrl}/api/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...created,
      name: "Disabled after edit",
      enabled: false
    })
  });

  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.id, created.id);
  assert.equal(updated.name, "Disabled after edit");
  assert.equal(updated.enabled, false);

  const rulesResponse = await fetch(`${baseUrl}/api/rules`);
  const rules = await rulesResponse.json();
  assert.equal(rules.filter((rule) => rule.id === created.id).length, 1);

  const mockResponse = await fetch(`${baseUrl}/mock/toggle-me`);
  assert.equal(mockResponse.status, 404);
});

test("does not use GET rules for non-GET requests", async () => {
  const response = await fetch(`${baseUrl}/mock/users/42`, { method: "POST" });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "No mock rule found",
    method: "POST",
    path: "/users/42"
  });
});

test("returns a 400 for invalid proxy targets", async () => {
  const response = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent("file:///etc/passwd")}`);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Proxy target must use http or https." });
});

test("proxies original-path requests when a proxy target header is present", async () => {
  const upstream = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ url: req.url, body: JSON.parse(body) }));
    });
  });
  await listenLocal(upstream);
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/orders/123`;

  try {
    const response = await fetch(`${baseUrl}/orders/123`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mocker-url": upstreamUrl
      },
      body: JSON.stringify({ forwarded: true })
    });

    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-mocker-hit"), "false");
    assert.deepEqual(await response.json(), {
      url: "/orders/123",
      body: { forwarded: true }
    });
  } finally {
    await new Promise((resolve, reject) => {
      upstream.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("returns a structured 502 when the upstream proxy request fails", async () => {
  const upstream = await listenLocal(createServer((_req, res) => {
    res.end("closing");
  }));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/disconnect`;

  await new Promise((resolve, reject) => {
    upstream.close((error) => (error ? reject(error) : resolve()));
  });

  const response = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(upstreamUrl)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ test: true })
  });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Upstream request failed" });
});

test("omits content-length from app and mocked responses", async () => {
  const createResponse = await fetch(`${baseUrl}/api/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "GET",
      sourceUrl: "https://api.example.test/length-check",
      pathname: "/length-check",
      status: 200,
      headers: {
        "content-length": "1",
        "content-type": "application/json"
      },
      body: { updated: "this body is longer than one byte" }
    })
  });

  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.headers.get("content-length"), null);

  const mockResponse = await fetch(`${baseUrl}/mock/length-check`);
  assert.equal(mockResponse.status, 200);
  assert.equal(mockResponse.headers.get("content-length"), null);
  assert.deepEqual(await mockResponse.json(), { updated: "this body is longer than one byte" });

  const rulesResponse = await fetch(`${baseUrl}/api/rules`);
  assert.equal(rulesResponse.headers.get("content-length"), null);
});

test("records proxied requests for the request monitor", async () => {
  await fetch(`${baseUrl}/api/requests`, { method: "DELETE" });

  const upstream = createServer((_req, res) => {
    res.writeHead(203, { "content-type": "application/json" });
    res.end(JSON.stringify({ from: "upstream" }));
  });
  await listenLocal(upstream);
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/users/7`;

  try {
    const proxyResponse = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(upstreamUrl)}`);

    assert.equal(proxyResponse.status, 203);
    assert.deepEqual(await proxyResponse.json(), { from: "upstream" });

    const requestsResponse = await fetch(`${baseUrl}/api/requests`);
    const requests = await requestsResponse.json();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].sourceUrl, upstreamUrl);
    assert.equal(requests[0].pathname, "/users/7");
    assert.equal(requests[0].status, 203);
    assert.equal(requests[0].mocked, false);
    assert.deepEqual(requests[0].responseBody, { from: "upstream" });

    const clearResponse = await fetch(`${baseUrl}/api/requests`, { method: "DELETE" });
    assert.equal(clearResponse.status, 204);
    const emptyResponse = await fetch(`${baseUrl}/api/requests`);
    assert.deepEqual(await emptyResponse.json(), []);
  } finally {
    await new Promise((resolve, reject) => {
      upstream.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("forwards non-GET proxy requests when only a GET rule exists", async () => {
  const upstream = await listenLocal(app);
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/upstream`;

  try {
    const createResponse = await fetch(`${baseUrl}/api/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "GET",
        sourceUrl: upstreamUrl,
        pathname: "/upstream",
        body: { mocked: true }
      })
    });
    assert.equal(createResponse.status, 201);

    const proxyResponse = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(upstreamUrl)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ forwarded: true })
    });

    assert.equal(proxyResponse.status, 404);
    assert.equal(proxyResponse.headers.get("x-mocker-hit"), "false");
  } finally {
    await new Promise((resolve, reject) => {
      upstream.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
