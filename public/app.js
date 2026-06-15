const state = {
  rules: [],
  requests: [],
  activeRuleId: null,
  activeRequestId: null,
  collapsedPaths: new Set(),
  parsedUrl: null,
  json: null
};

const els = {
  urlInput: document.querySelector("#urlInput"),
  ruleNameInput: document.querySelector("#ruleNameInput"),
  ruleEnabledInput: document.querySelector("#ruleEnabledInput"),
  methodInput: document.querySelector("#methodInput"),
  statusInput: document.querySelector("#statusInput"),
  pathChips: document.querySelector("#pathChips"),
  ruleList: document.querySelector("#ruleList"),
  requestList: document.querySelector("#requestList"),
  requestCount: document.querySelector("#requestCount"),
  clearRequestsBtn: document.querySelector("#clearRequestsBtn"),
  formatBtn: document.querySelector("#formatBtn"),
  saveBtn: document.querySelector("#saveBtn"),
  saveAsNewBtn: document.querySelector("#saveAsNewBtn"),
  loadJsonBtn: document.querySelector("#loadJsonBtn"),
  jsonInput: document.querySelector("#jsonInput"),
  jsonError: document.querySelector("#jsonError"),
  jsonTree: document.querySelector("#jsonTree"),
  mockUrl: document.querySelector("#mockUrl"),
  proxyUrl: document.querySelector("#proxyUrl")
};

function parseRequestUrl(value) {
  if (!value.trim()) return null;
  const parsed = new URL(value);
  const chunks = parsed.pathname.split("/").filter(Boolean);
  return {
    sourceUrl: parsed.href,
    origin: parsed.origin,
    pathname: parsed.pathname || "/",
    chunks
  };
}

function renderParsedUrl() {
  const parsed = state.parsedUrl;
  if (!parsed) {
    els.pathChips.className = "chips empty";
    els.pathChips.textContent = "Paste a URL to split it into chunks.";
    els.mockUrl.textContent = "";
    els.proxyUrl.textContent = "";
    return;
  }
  els.pathChips.className = "chips";
  els.pathChips.replaceChildren(...parsed.chunks.map((chunk) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = chunk;
    return chip;
  }));
  els.mockUrl.textContent = `Mock: ${location.origin}/mock${parsed.pathname}`;
  const emulatorOrigin = location.origin.replace("localhost", "10.0.2.2").replace("127.0.0.1", "10.0.2.2");
  els.proxyUrl.textContent = `Proxy: ${emulatorOrigin}/proxy?url=${encodeURIComponent(parsed.sourceUrl)}`;
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function readJsonFromTextarea() {
  try {
    const value = JSON.parse(els.jsonInput.value);
    els.jsonError.textContent = "";
    return value;
  } catch (error) {
    els.jsonError.textContent = error.message;
    return undefined;
  }
}

function syncTextarea() {
  els.jsonInput.value = formatJson(state.json);
}

function updateAtPath(path, updater) {
  if (path.length === 0) {
    state.json = updater(state.json);
    syncTextarea();
    renderJsonTree();
    return;
  }
  let target = state.json;
  for (const key of path.slice(0, -1)) target = target[key];
  const last = path.at(-1);
  target[last] = updater(target[last], target, last);
  syncTextarea();
  renderJsonTree();
}

function deleteAtPath(path) {
  if (path.length === 0) {
    state.json = {};
  } else {
    let target = state.json;
    for (const key of path.slice(0, -1)) target = target[key];
    const last = path.at(-1);
    if (Array.isArray(target)) target.splice(last, 1);
    else delete target[last];
  }
  syncTextarea();
  renderJsonTree();
}

function parseLooseValue(value) {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function nextCopyNumber(array) {
  let max = 0;
  const scan = (value) => {
    if (typeof value === "string") {
      const match = value.match(/_copy(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
      return;
    }
    if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === "object") Object.values(value).forEach(scan);
  };
  array.forEach(scan);
  return max + 1;
}

function uniquify(value, copyNumber) {
  if (typeof value === "string") return `${value.replace(/_copy\d+$/, "")}_copy${copyNumber}`;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.map((item) => uniquify(item, copyNumber));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, uniquify(item, copyNumber)])
    );
  }
  return value;
}

function cloneForDuplicate(value) {
  return JSON.parse(JSON.stringify(value));
}

function pathKey(path) {
  return JSON.stringify(path);
}

function resetCollapsedPaths() {
  state.collapsedPaths.clear();
}

function chunksForPath(pathname) {
  return (pathname || "/").split("/").filter(Boolean);
}

function formatRequestTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function inputForKey(key, parentPath) {
  const input = document.createElement("input");
  input.className = "key-input";
  input.value = key;
  input.setAttribute("aria-label", "Field name");
  input.addEventListener("change", () => {
    const nextKey = input.value.trim();
    if (!nextKey || nextKey === key) return;
    let parent = state.json;
    for (const item of parentPath) parent = parent[item];
    if (Object.hasOwn(parent, nextKey)) {
      input.value = key;
      return;
    }
    parent[nextKey] = parent[key];
    delete parent[key];
    syncTextarea();
    renderJsonTree();
  });
  return input;
}

function primitiveEditor(value, path, key, parentPath) {
  const row = document.createElement("div");
  row.className = "primitive";
  if (key !== null && !Array.isArray(getValue(parentPath))) {
    row.append(inputForKey(String(key), parentPath));
  }

  const input = document.createElement("input");
  input.className = "value-input";
  input.value = typeof value === "string" ? value : JSON.stringify(value);
  input.setAttribute("aria-label", "Field value");
  input.addEventListener("change", () => updateAtPath(path, () => parseLooseValue(input.value)));

  const remove = document.createElement("button");
  remove.className = "icon-btn danger";
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Delete";
  remove.addEventListener("click", () => deleteAtPath(path));

  row.append(input, remove);
  return row;
}

function addFieldForm(path) {
  const template = document.querySelector("#addFieldTemplate");
  const container = document.createElement("div");
  container.className = "add-field-wrap";
  const reveal = document.createElement("button");
  reveal.className = "icon-btn";
  reveal.type = "button";
  reveal.textContent = "+";
  reveal.title = "Add field";
  const form = template.content.firstElementChild.cloneNode(true);
  form.hidden = true;
  reveal.addEventListener("click", () => {
    form.hidden = !form.hidden;
    if (!form.hidden) form.elements.name.focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    if (!name) return;
    updateAtPath(path, (object) => ({ ...object, [name]: parseLooseValue(String(data.get("value") || "")) }));
  });
  container.append(reveal, form);
  return container;
}

function renderNode(value, path = [], key = null, parentPath = []) {
  if (!value || typeof value !== "object") return primitiveEditor(value, path, key, parentPath);

  const wrapper = document.createElement("div");
  const isCollapsed = state.collapsedPaths.has(pathKey(path));
  wrapper.className = isCollapsed ? "node collapsed" : "node";

  const head = document.createElement("div");
  head.className = "node-head";

  const toggle = document.createElement("button");
  toggle.className = "icon-btn node-toggle";
  toggle.type = "button";
  toggle.textContent = isCollapsed ? ">" : "v";
  toggle.title = isCollapsed ? "Expand" : "Collapse";
  toggle.setAttribute("aria-label", isCollapsed ? "Expand object" : "Collapse object");
  toggle.setAttribute("aria-expanded", String(!isCollapsed));
  toggle.addEventListener("click", () => {
    const keyPath = pathKey(path);
    if (state.collapsedPaths.has(keyPath)) state.collapsedPaths.delete(keyPath);
    else state.collapsedPaths.add(keyPath);
    renderJsonTree();
  });
  head.append(toggle);

  if (key !== null && !Array.isArray(getValue(parentPath))) head.append(inputForKey(String(key), parentPath));

  const title = document.createElement("span");
  title.className = "node-title";
  title.textContent = Array.isArray(value) ? `Array (${value.length})` : `Object (${Object.keys(value).length})`;

  const remove = document.createElement("button");
  remove.className = "icon-btn danger";
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Delete";
  remove.addEventListener("click", () => deleteAtPath(path));
  if (path.length === 0) remove.disabled = true;

  head.append(title, remove);
  wrapper.append(head);
  if (isCollapsed) return wrapper;

  const children = document.createElement("div");
  children.className = "children";
  if (Array.isArray(value)) {
    value.forEach((item, index) => children.append(renderNode(item, [...path, index], index, path)));
    const actions = document.createElement("div");
    actions.className = "array-actions";
    const duplicate = document.createElement("button");
    duplicate.type = "button";
    duplicate.textContent = "+ duplicate last";
    duplicate.addEventListener("click", () => {
      updateAtPath(path, (array) => {
        const last = array.at(-1);
        const next = last === undefined ? {} : uniquify(cloneForDuplicate(last), nextCopyNumber(array));
        return [...array, next];
      });
    });
    actions.append(duplicate);
    children.append(actions);
  } else {
    for (const [childKey, childValue] of Object.entries(value)) {
      children.append(renderNode(childValue, [...path, childKey], childKey, path));
    }
    children.append(addFieldForm(path));
  }

  wrapper.append(children);
  return wrapper;
}

function getValue(path) {
  let value = state.json;
  for (const key of path) value = value?.[key];
  return value;
}

function renderJsonTree() {
  els.jsonTree.replaceChildren(renderNode(state.json));
}

function ruleDisplayName(rule) {
  return String(rule.name || "").trim() || `${rule.method} ${rule.pathname}`;
}

function renderRules() {
  if (!state.rules.length) {
    els.ruleList.textContent = "No rules saved yet.";
    return;
  }

  const rules = [...state.rules].sort((left, right) => {
    return ruleDisplayName(left).localeCompare(ruleDisplayName(right), undefined, { sensitivity: "base" });
  });

  const nodes = [];
  for (const rule of rules) {
    const item = document.createElement("div");
    item.className = rule.enabled === false ? "rule disabled" : "rule";

    const enabled = document.createElement("input");
    enabled.className = "rule-enabled";
    enabled.type = "checkbox";
    enabled.checked = rule.enabled !== false;
    enabled.title = enabled.checked ? "Disable rule" : "Enable rule";
    enabled.setAttribute("aria-label", `${enabled.checked ? "Disable" : "Enable"} ${ruleDisplayName(rule)}`);
    enabled.addEventListener("click", (event) => event.stopPropagation());
    enabled.addEventListener("change", () => updateRule(rule, { enabled: enabled.checked }));

    const button = document.createElement("button");
    button.className = "rule-main";
    button.type = "button";
    const title = document.createElement("strong");
    title.textContent = ruleDisplayName(rule);
    const route = document.createElement("span");
    route.textContent = `${rule.enabled === false ? "Disabled / " : ""}${rule.method} ${rule.pathname}`;
    const endpoint = document.createElement("span");
    endpoint.textContent = `${location.origin}/proxy?url=${encodeURIComponent(rule.sourceUrl)}`;
    button.append(title, route, endpoint);
    button.addEventListener("click", () => loadRule(rule));

    const remove = document.createElement("button");
    remove.className = "icon-btn danger";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Delete rule";
    remove.addEventListener("click", async () => {
      await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
      if (state.activeRuleId === rule.id) state.activeRuleId = null;
      await fetchRules();
    });

    item.append(enabled, button, remove);
    nodes.push(item);
  }
  els.ruleList.replaceChildren(...nodes);
}

function renderRequests() {
  els.requestCount.textContent = state.requests.length
    ? `${state.requests.length} captured`
    : "Watching proxy and mock traffic";

  if (!state.requests.length) {
    els.requestList.textContent = "No requests captured yet.";
    return;
  }

  const nodes = state.requests.map((request) => {
    const item = document.createElement("button");
    item.className = request.id === state.activeRequestId ? "request-item active" : "request-item";
    item.type = "button";

    const head = document.createElement("span");
    head.className = "request-head";
    const method = document.createElement("strong");
    method.textContent = request.method;
    const status = document.createElement("span");
    status.className = request.status >= 400 ? "request-status error-status" : "request-status";
    status.textContent = request.status || "";
    head.append(method, status);

    const path = document.createElement("span");
    path.className = "request-path";
    path.textContent = request.pathname || "/";

    const meta = document.createElement("span");
    meta.className = "request-meta";
    meta.textContent = `${request.mocked ? "mocked" : "upstream"} / ${formatRequestTime(request.createdAt)}`;

    item.append(head, path, meta);
    item.addEventListener("click", () => loadRequest(request));
    return item;
  });

  els.requestList.replaceChildren(...nodes);
}

function loadRule(rule) {
  state.activeRuleId = rule.id;
  state.activeRequestId = null;
  resetCollapsedPaths();
  els.urlInput.value = rule.sourceUrl;
  els.ruleNameInput.value = rule.name || "";
  els.ruleEnabledInput.checked = rule.enabled !== false;
  els.methodInput.value = rule.method;
  els.statusInput.value = rule.status;
  state.parsedUrl = {
    sourceUrl: rule.sourceUrl,
    pathname: rule.pathname,
    chunks: rule.pathChunks || []
  };
  state.json = rule.body;
  syncTextarea();
  renderParsedUrl();
  renderJsonTree();
  renderRequests();
}

function loadRequest(request) {
  const sourceUrl = request.sourceUrl || `${location.origin}${request.pathname || "/"}`;
  let parsed;
  try {
    parsed = parseRequestUrl(sourceUrl);
  } catch {
    parsed = null;
  }

  state.activeRuleId = request.ruleId || null;
  state.activeRequestId = request.id;
  resetCollapsedPaths();
  els.urlInput.value = sourceUrl;
  els.ruleNameInput.value = "";
  els.ruleEnabledInput.checked = true;
  els.methodInput.value = request.method;
  els.statusInput.value = request.status || 200;
  state.parsedUrl = {
    sourceUrl,
    origin: parsed?.origin || "",
    pathname: request.pathname || parsed?.pathname || "/",
    chunks: request.pathChunks || chunksForPath(request.pathname || parsed?.pathname)
  };
  state.json = request.responseBody ?? {};
  syncTextarea();
  renderParsedUrl();
  renderJsonTree();
  renderRequests();
}

async function fetchRules() {
  const response = await fetch("/api/rules");
  state.rules = await response.json();
  renderRules();
}

async function fetchRequests() {
  const response = await fetch("/api/requests");
  state.requests = await response.json();
  renderRequests();
}

async function updateRule(rule, changes) {
  const response = await fetch("/api/rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...rule, ...changes })
  });
  const saved = await response.json();
  if (state.activeRuleId === saved.id) {
    els.ruleEnabledInput.checked = saved.enabled !== false;
    els.ruleNameInput.value = saved.name || "";
  }
  await fetchRules();
}

async function saveRule({ asNew = false } = {}) {
  const parsed = parseRequestUrl(els.urlInput.value);
  const body = readJsonFromTextarea();
  if (!parsed || body === undefined) return;
  const response = await fetch("/api/rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: asNew ? null : state.activeRuleId,
      name: els.ruleNameInput.value,
      enabled: els.ruleEnabledInput.checked,
      method: els.methodInput.value,
      sourceUrl: parsed.sourceUrl,
      pathname: parsed.pathname,
      pathChunks: parsed.chunks,
      status: Number(els.statusInput.value || 200),
      body
    })
  });
  const saved = await response.json();
  state.activeRuleId = saved.id;
  await fetchRules();
}

async function clearRequests() {
  await fetch("/api/requests", { method: "DELETE" });
  state.activeRequestId = null;
  await fetchRequests();
}

els.urlInput.addEventListener("input", () => {
  try {
    state.parsedUrl = parseRequestUrl(els.urlInput.value);
  } catch {
    state.parsedUrl = null;
  }
  renderParsedUrl();
});

els.loadJsonBtn.addEventListener("click", () => {
  const next = readJsonFromTextarea();
  if (next === undefined) return;
  state.json = next;
  resetCollapsedPaths();
  renderJsonTree();
});

els.formatBtn.addEventListener("click", () => {
  const next = readJsonFromTextarea();
  if (next === undefined) return;
  state.json = next;
  syncTextarea();
  renderJsonTree();
});

els.saveBtn.addEventListener("click", () => saveRule());
els.saveAsNewBtn.addEventListener("click", () => saveRule({ asNew: true }));
els.clearRequestsBtn.addEventListener("click", clearRequests);

state.json = readJsonFromTextarea();
renderJsonTree();
fetchRules();
fetchRequests();
setInterval(fetchRequests, 2000);
