const state = {
  rules: [],
  activeRuleId: null,
  parsedUrl: null,
  json: null
};

const els = {
  urlInput: document.querySelector("#urlInput"),
  methodInput: document.querySelector("#methodInput"),
  statusInput: document.querySelector("#statusInput"),
  pathChips: document.querySelector("#pathChips"),
  ruleList: document.querySelector("#ruleList"),
  postfixInput: document.querySelector("#postfixInput"),
  formatBtn: document.querySelector("#formatBtn"),
  saveBtn: document.querySelector("#saveBtn"),
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

function uniquify(value, postfix) {
  if (typeof value === "string") return `${value}${postfix}`;
  if (typeof value === "number") return value + 1;
  if (Array.isArray(value)) return value.map((item) => uniquify(item, postfix));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, uniquify(item, postfix)])
    );
  }
  return value;
}

function cloneForDuplicate(value) {
  return JSON.parse(JSON.stringify(value));
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
  wrapper.className = "node";

  const head = document.createElement("div");
  head.className = "node-head";
  if (key !== null && !Array.isArray(getValue(parentPath))) head.append(inputForKey(String(key), parentPath));

  const title = document.createElement("span");
  title.className = "node-title";
  title.textContent = Array.isArray(value) ? `Array (${value.length})` : "Object";

  const remove = document.createElement("button");
  remove.className = "icon-btn danger";
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Delete";
  remove.addEventListener("click", () => deleteAtPath(path));
  if (path.length === 0) remove.disabled = true;

  head.append(title, remove);
  wrapper.append(head);

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
        const next = last === undefined ? {} : uniquify(cloneForDuplicate(last), els.postfixInput.value || "_copy");
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

function renderRules() {
  if (!state.rules.length) {
    els.ruleList.textContent = "No rules saved yet.";
    return;
  }

  const grouped = new Map();
  for (const rule of state.rules) {
    const group = rule.pathChunks?.[0] || "/";
    grouped.set(group, [...(grouped.get(group) || []), rule]);
  }
  const nodes = [];
  for (const [group, rules] of grouped.entries()) {
    const heading = document.createElement("div");
    heading.className = "panel-title";
    heading.textContent = group;
    nodes.push(heading);

    for (const rule of rules) {
      const item = document.createElement("div");
      item.className = "rule";

      const button = document.createElement("button");
      button.className = "rule-main";
      button.type = "button";
      const title = document.createElement("strong");
      title.textContent = `${rule.method} ${rule.pathname}`;
      const endpoint = document.createElement("span");
      endpoint.textContent = `${location.origin}/proxy?url=${encodeURIComponent(rule.sourceUrl)}`;
      button.append(title, endpoint);
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

      item.append(button, remove);
      nodes.push(item);
    }
  }
  els.ruleList.replaceChildren(...nodes);
}

function loadRule(rule) {
  state.activeRuleId = rule.id;
  els.urlInput.value = rule.sourceUrl;
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
}

async function fetchRules() {
  const response = await fetch("/api/rules");
  state.rules = await response.json();
  renderRules();
}

async function saveRule() {
  const parsed = parseRequestUrl(els.urlInput.value);
  const body = readJsonFromTextarea();
  if (!parsed || body === undefined) return;
  const response = await fetch("/api/rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: state.activeRuleId,
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
  renderJsonTree();
});

els.formatBtn.addEventListener("click", () => {
  const next = readJsonFromTextarea();
  if (next === undefined) return;
  state.json = next;
  syncTextarea();
  renderJsonTree();
});

els.saveBtn.addEventListener("click", saveRule);

state.json = readJsonFromTextarea();
renderJsonTree();
fetchRules();
