import express from "express";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFile = process.env.RULES_FILE || path.join(__dirname, "rules.json");
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.static(path.join(__dirname, "public")));

async function readRules() {
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeRules(rules) {
  await fs.writeFile(dataFile, JSON.stringify(rules, null, 2));
}

function normalizePath(value) {
  if (!value) return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function routeKey(method, pathname) {
  return `${method.toUpperCase()} ${normalizePath(pathname)}`;
}

function ruleMatches(rule, method, targetUrl) {
  const target = new URL(targetUrl);
  const source = rule.sourceUrl ? new URL(rule.sourceUrl) : null;
  const requestMethod = method.toUpperCase();
  const methodMatches = rule.method === requestMethod || (requestMethod === "HEAD" && rule.method === "GET");
  const pathMatches = normalizePath(rule.pathname) === normalizePath(target.pathname);
  const hostMatches = !source || source.host === target.host;
  return methodMatches && pathMatches && hostMatches;
}

function resolveProxyTarget(req) {
  const directTarget = req.get("x-mocker-url")
    || req.get("x-original-url")
    || req.query.url
    || req.query.target;

  if (directTarget) return parseProxyUrl(directTarget);

  const baseUrl = req.get("x-mocker-base-url");
  if (baseUrl) {
    const suffix = req.originalUrl.replace(/^\/proxy/, "") || "/";
    return parseProxyUrl(suffix, baseUrl);
  }

  throw new Error("Missing proxy target. Send X-Mocker-Url or ?url=<encoded original url>.");
}

function parseProxyUrl(value, base) {
  let target;
  try {
    target = new URL(value, base);
  } catch {
    throw Object.assign(new Error("Invalid proxy target URL."), { statusCode: 400 });
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    throw Object.assign(new Error("Proxy target must use http or https."), { statusCode: 400 });
  }

  return target;
}

function proxiedHeaders(req) {
  const blocked = new Set([
    "accept-encoding",
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "x-mocker-base-url",
    "x-mocker-url",
    "x-original-url"
  ]);
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!blocked.has(name.toLowerCase()) && value !== undefined) headers[name] = value;
  }
  headers["accept-encoding"] = "identity";
  return headers;
}

function sendMock(rule, res) {
  for (const [header, value] of Object.entries(rule.headers || {})) {
    res.set(header, value);
  }
  res.set("x-mocker-hit", "true");
  res.status(rule.status || 200).send(rule.body);
}

app.all(["/proxy", "/proxy/*"], express.raw({ type: "*/*", limit: "20mb" }), async (req, res, next) => {
  try {
    const target = resolveProxyTarget(req);
    const rules = await readRules();
    const rule = rules.find((item) => ruleMatches(item, req.method, target.href));

    if (rule) {
      sendMock(rule, res);
      return;
    }

    const shouldSendBody = !["GET", "HEAD"].includes(req.method.toUpperCase()) && req.body?.length;
    const upstream = await fetch(target, {
      method: req.method,
      headers: proxiedHeaders(req),
      body: shouldSendBody ? req.body : undefined,
      redirect: "manual"
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, header) => {
      if (!["content-encoding", "content-length", "connection", "transfer-encoding"].includes(header.toLowerCase())) {
        res.set(header, value);
      }
    });
    res.set("x-mocker-hit", "false");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    if (error.message?.startsWith("Missing proxy target")) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.use(express.json({ limit: "5mb" }));

app.get("/api/rules", async (_req, res, next) => {
  try {
    res.json(await readRules());
  } catch (error) {
    next(error);
  }
});

app.post("/api/rules", async (req, res, next) => {
  try {
    const rules = await readRules();
    const incoming = req.body;
    const now = new Date().toISOString();
    const rule = {
      id: incoming.id || randomUUID(),
      method: (incoming.method || "GET").toUpperCase(),
      sourceUrl: incoming.sourceUrl || "",
      pathname: normalizePath(incoming.pathname),
      pathChunks: incoming.pathChunks || [],
      status: Number(incoming.status || 200),
      headers: incoming.headers || { "content-type": "application/json" },
      body: incoming.body ?? {},
      createdAt: incoming.createdAt || now,
      updatedAt: now
    };
    const existingIndex = rules.findIndex((item) => item.id === rule.id);
    if (existingIndex >= 0) rules.splice(existingIndex, 1, rule);
    else rules.push(rule);
    await writeRules(rules);
    res.status(existingIndex >= 0 ? 200 : 201).json(rule);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/rules/:id", async (req, res, next) => {
  try {
    const rules = await readRules();
    const nextRules = rules.filter((rule) => rule.id !== req.params.id);
    await writeRules(nextRules);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.all("/mock/*", async (req, res, next) => {
  try {
    const rules = await readRules();
    const mockedPath = normalizePath(req.path.replace(/^\/mock/, ""));
    const key = routeKey(req.method, mockedPath);
    const fallbackKey = req.method.toUpperCase() === "HEAD" ? routeKey("GET", mockedPath) : null;
    const rule = rules.find((item) => routeKey(item.method, item.pathname) === key)
      || (fallbackKey ? rules.find((item) => routeKey(item.method, item.pathname) === fallbackKey) : null);

    if (!rule) {
      res.status(404).json({
        error: "No mock rule found",
        method: req.method,
        path: mockedPath
      });
      return;
    }

    sendMock(rule, res);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

if (process.argv[1] === __filename) {
  app.listen(port, () => {
    console.log(`Mocker running at http://localhost:${port}`);
  });
}

export { app, normalizePath, routeKey };
