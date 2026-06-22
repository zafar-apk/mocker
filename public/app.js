const state = {
  view: "rules",
  editorTab: "visual",
  rules: [],
  requests: [],
  activeRuleId: null,
  activeRequestId: null,
  collapsedPaths: new Set(),
  parsedUrl: null,
  json: null,
  toastTimer: null
};

const els = Object.fromEntries(
  [
    "navRequestCount", "totalRulesCount", "enabledRulesCount", "matchedRulesCount",
    "ruleSearchInput", "ruleMethodFilter", "ruleStatusFilter", "ruleList", "newRuleBtn",
    "backToRulesBtn", "editorTitle", "saveState", "ruleNameInput", "urlInput",
    "methodInput", "statusInput", "ruleEnabledInput", "ruleStateLabel", "visualTabBtn",
    "rawTabBtn", "formatBtn", "visualPanel", "rawPanel", "jsonTree", "jsonInput",
    "jsonError", "pathChips", "mockUrl", "proxyUrl", "saveAsNewBtn", "saveBtn",
    "requestCount", "clearRequestsBtn", "requestSearchInput", "requestMethodFilter",
    "requestStatusFilter", "requestSourceFilter", "requestList", "requestDetail", "toast"
  ].map((id) => [id, document.querySelector(`#${id}`)])
);

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  state.toastTimer = window.setTimeout(() => els.toast.classList.remove("visible"), 2600);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((node) => {
    node.classList.toggle("active", node.dataset.view === view);
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === view || (view === "editor" && button.dataset.viewTarget === "rules"));
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function setSaveState(label, saved = false) {
  els.saveState.textContent = label;
  els.saveState.classList.toggle("saved", saved);
}

function markDirty() {
  setSaveState("Unsaved");
}

function parseRequestUrl(value) {
  if (!value.trim()) return null;
  const parsed = new URL(value);
  return {
    sourceUrl: parsed.href,
    origin: parsed.origin,
    pathname: parsed.pathname || "/",
    chunks: parsed.pathname.split("/").filter(Boolean)
  };
}

function chunksForPath(pathname) {
  return (pathname || "/").split("/").filter(Boolean);
}

function renderParsedUrl() {
  if (!state.parsedUrl) {
    els.pathChips.className = "chips empty";
    els.pathChips.textContent = "Paste a URL to split it into chunks.";
    els.mockUrl.textContent = "Available after entering a URL";
    els.proxyUrl.textContent = "Available after entering a URL";
    return;
  }

  els.pathChips.className = "chips";
  const chunks = state.parsedUrl.chunks.length ? state.parsedUrl.chunks : ["/"];
  els.pathChips.replaceChildren(...chunks.map((chunk) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = chunk;
    return chip;
  }));

  els.mockUrl.textContent = `${location.origin}/mock${state.parsedUrl.pathname}`;
  const emulatorOrigin = location.origin.replace("localhost", "10.0.2.2").replace("127.0.0.1", "10.0.2.2");
  els.proxyUrl.textContent = `${emulatorOrigin}/proxy?url=${encodeURIComponent(state.parsedUrl.sourceUrl)}`;
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

function pathKey(path) {
  return JSON.stringify(path);
}

function resetCollapsedPaths() {
  state.collapsedPaths.clear();
}

function getValue(path) {
  let value = state.json;
  for (const key of path) value = value?.[key];
  return value;
}

function updateAtPath(path, updater) {
  if (path.length === 0) {
    state.json = updater(state.json);
  } else {
    let target = state.json;
    for (const key of path.slice(0, -1)) target = target[key];
    const last = path.at(-1);
    target[last] = updater(target[last], target, last);
  }
  syncTextarea();
  renderJsonTree();
  markDirty();
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
  markDirty();
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

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function nextCopyNumber(array) {
  let max = 0;
  const scan = (value) => {
    if (typeof value === "string") {
      const match = value.match(/_copy(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    } else if (Array.isArray(value)) {
      value.forEach(scan);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(scan);
    }
  };
  array.forEach(scan);
  return max + 1;
}

function uniquify(value, copyNumber) {
  if (typeof value === "string") return `${value.replace(/_copy\d+$/, "")}_copy${copyNumber}`;
  if (Array.isArray(value)) return value.map((item) => uniquify(item, copyNumber));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, uniquify(item, copyNumber)]));
  }
  return value;
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
      showToast("That field name already exists.");
      return;
    }
    parent[nextKey] = parent[key];
    delete parent[key];
    syncTextarea();
    renderJsonTree();
    markDirty();
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
  remove.className = "icon-button delete";
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Delete field";
  remove.addEventListener("click", () => deleteAtPath(path));
  row.append(input, remove);
  return row;
}

function addFieldForm(path) {
  const container = document.createElement("div");
  container.className = "add-field-wrap";

  const reveal = document.createElement("button");
  reveal.className = "secondary compact";
  reveal.type = "button";
  reveal.textContent = "+ Add field";

  const form = document.querySelector("#addFieldTemplate").content.firstElementChild.cloneNode(true);
  form.hidden = true;
  reveal.addEventListener("click", () => {
    form.hidden = !form.hidden;
    reveal.textContent = form.hidden ? "+ Add field" : "Cancel";
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
  const collapsed = state.collapsedPaths.has(pathKey(path));
  wrapper.className = collapsed ? "node collapsed" : "node";

  const head = document.createElement("div");
  head.className = "node-head";

  const toggle = document.createElement("button");
  toggle.className = "node-toggle";
  toggle.type = "button";
  toggle.textContent = collapsed ? "›" : "⌄";
  toggle.setAttribute("aria-label", collapsed ? "Expand object" : "Collapse object");
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.addEventListener("click", () => {
    const keyPath = pathKey(path);
    if (collapsed) state.collapsedPaths.delete(keyPath);
    else state.collapsedPaths.add(keyPath);
    renderJsonTree();
  });
  head.append(toggle);

  if (key !== null && !Array.isArray(getValue(parentPath))) {
    head.append(inputForKey(String(key), parentPath));
  }

  const title = document.createElement("span");
  title.className = "node-title";
  title.textContent = Array.isArray(value) ? `Array (${value.length})` : `Object (${Object.keys(value).length})`;

  const remove = document.createElement("button");
  remove.className = "icon-button delete";
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Delete";
  remove.disabled = path.length === 0;
  remove.addEventListener("click", () => deleteAtPath(path));
  head.append(title, remove);
  wrapper.append(head);
  if (collapsed) return wrapper;

  const children = document.createElement("div");
  children.className = "children";
  if (Array.isArray(value)) {
    value.forEach((item, index) => children.append(renderNode(item, [...path, index], index, path)));
    const actions = document.createElement("div");
    actions.className = "array-actions";
    const duplicate = document.createElement("button");
    duplicate.className = "secondary compact";
    duplicate.type = "button";
    duplicate.textContent = "Duplicate last";
    duplicate.addEventListener("click", () => {
      updateAtPath(path, (array) => {
        const last = array.at(-1);
        const next = last === undefined ? {} : uniquify(cloneValue(last), nextCopyNumber(array));
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

function renderJsonTree() {
  els.jsonTree.replaceChildren(renderNode(state.json));
}

function setEditorTab(tab) {
  if (tab === "visual") {
    const next = readJsonFromTextarea();
    if (next === undefined) return false;
    state.json = next;
    renderJsonTree();
  }
  state.editorTab = tab;
  const visual = tab === "visual";
  els.visualTabBtn.classList.toggle("active", visual);
  els.rawTabBtn.classList.toggle("active", !visual);
  els.visualTabBtn.setAttribute("aria-selected", String(visual));
  els.rawTabBtn.setAttribute("aria-selected", String(!visual));
  els.visualPanel.classList.toggle("active", visual);
  els.rawPanel.classList.toggle("active", !visual);
  els.formatBtn.classList.toggle("hidden", visual);
  return true;
}

function ruleDisplayName(rule) {
  return String(rule.name || "").trim() || `${rule.method} ${rule.pathname}`;
}

function formatRequestTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function relativeTime(value) {
  if (!value) return "Never";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function lastMatchForRule(rule) {
  return state.requests.find((request) => request.ruleId === rule.id || (
    request.mocked && request.method === rule.method && request.pathname === rule.pathname
  ))?.createdAt;
}

function ruleMatchesFilters(rule) {
  const query = els.ruleSearchInput.value.trim().toLowerCase();
  const method = els.ruleMethodFilter.value;
  const statusGroup = els.ruleStatusFilter.value;
  return (!query || `${ruleDisplayName(rule)} ${rule.pathname}`.toLowerCase().includes(query))
    && (!method || rule.method === method)
    && (!statusGroup || String(rule.status).startsWith(statusGroup));
}

function renderRuleSummary() {
  els.totalRulesCount.textContent = state.rules.length;
  els.enabledRulesCount.textContent = state.rules.filter((rule) => rule.enabled !== false).length;
  const matched = new Set();
  for (const rule of state.rules) {
    if (lastMatchForRule(rule)) matched.add(rule.id);
  }
  els.matchedRulesCount.textContent = matched.size;
}

function renderRules() {
  renderRuleSummary();
  const rules = state.rules
    .filter(ruleMatchesFilters)
    .sort((left, right) => ruleDisplayName(left).localeCompare(ruleDisplayName(right), undefined, { sensitivity: "base" }));

  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "table-empty";
    empty.textContent = state.rules.length ? "No rules match these filters." : "No rules saved yet. Create your first rule.";
    els.ruleList.replaceChildren(empty);
    return;
  }

  const nodes = rules.map((rule) => {
    const row = document.createElement("div");
    row.className = "rule-table table-row";

    const name = document.createElement("button");
    name.className = "rule-name-button";
    name.type = "button";
    const strong = document.createElement("strong");
    strong.textContent = ruleDisplayName(rule);
    const source = document.createElement("span");
    source.textContent = rule.sourceUrl;
    name.append(strong, source);
    name.addEventListener("click", () => loadRule(rule));

    const method = document.createElement("span");
    method.className = "method-badge";
    method.textContent = rule.method;

    const path = document.createElement("span");
    path.className = "path-cell";
    path.title = rule.pathname;
    path.textContent = rule.pathname;

    const status = document.createElement("span");
    status.className = Number(rule.status) >= 400 ? "status-badge error-status" : "status-badge";
    status.textContent = rule.status;

    const switchWrap = document.createElement("label");
    const enabled = document.createElement("input");
    enabled.className = "row-switch";
    enabled.type = "checkbox";
    enabled.checked = rule.enabled !== false;
    enabled.setAttribute("aria-label", `${enabled.checked ? "Disable" : "Enable"} ${ruleDisplayName(rule)}`);
    const switchUi = document.createElement("span");
    switchUi.className = "row-switch-label";
    enabled.addEventListener("change", () => updateRule(rule, { enabled: enabled.checked }));
    switchWrap.append(enabled, switchUi);

    const matched = document.createElement("span");
    matched.className = "muted-cell";
    matched.textContent = relativeTime(lastMatchForRule(rule));

    const actions = document.createElement("div");
    actions.className = "table-actions";
    const edit = iconButton("✎", "Edit rule", () => loadRule(rule));
    const duplicate = iconButton("⧉", "Duplicate rule", () => duplicateRule(rule));
    const remove = iconButton("×", "Delete rule", () => deleteRule(rule), "delete");
    actions.append(edit, duplicate, remove);

    row.append(name, method, path, status, switchWrap, matched, actions);
    return row;
  });
  els.ruleList.replaceChildren(...nodes);
}

function iconButton(symbol, title, onClick, extraClass = "") {
  const button = document.createElement("button");
  button.className = `icon-button ${extraClass}`.trim();
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.textContent = symbol;
  button.addEventListener("click", onClick);
  return button;
}

function requestMatchesFilters(request) {
  const query = els.requestSearchInput.value.trim().toLowerCase();
  const method = els.requestMethodFilter.value;
  const statusGroup = els.requestStatusFilter.value;
  const source = els.requestSourceFilter.value;
  return (!query || String(request.pathname || "/").toLowerCase().includes(query))
    && (!method || request.method === method)
    && (!statusGroup || String(request.status).startsWith(statusGroup))
    && (!source || (source === "mocked") === Boolean(request.mocked));
}

function renderRequests() {
  els.navRequestCount.textContent = state.requests.length > 99 ? "99+" : state.requests.length;
  els.requestCount.textContent = state.requests.length
    ? `${state.requests.length} captured request${state.requests.length === 1 ? "" : "s"} · updates automatically`
    : "Watching proxy and mock traffic";

  const requests = state.requests.filter(requestMatchesFilters);
  if (!requests.length) {
    const empty = document.createElement("div");
    empty.className = "table-empty";
    empty.textContent = state.requests.length ? "No requests match these filters." : "No requests captured yet.";
    els.requestList.replaceChildren(empty);
  } else {
    const nodes = requests.map((request) => {
      const button = document.createElement("button");
      button.className = request.id === state.activeRequestId ? "request-row-button active" : "request-row-button";
      button.type = "button";

      const row = document.createElement("span");
      row.className = "request-table";

      const method = document.createElement("span");
      method.className = "method-badge";
      method.textContent = request.method;
      const status = document.createElement("span");
      status.className = Number(request.status) >= 400 ? "status-badge error-status" : "status-badge";
      status.textContent = request.status || "—";
      const path = document.createElement("span");
      path.className = "path-cell";
      path.textContent = request.pathname || "/";
      const source = document.createElement("span");
      source.className = request.mocked ? "source-badge mocked" : "source-badge";
      source.textContent = request.mocked ? "Mocked" : "Upstream";
      const time = document.createElement("span");
      time.className = "muted-cell";
      time.textContent = formatRequestTime(request.createdAt);

      row.append(method, status, path, source, time);
      button.append(row);
      button.addEventListener("click", () => selectRequest(request));
      return button;
    });
    els.requestList.replaceChildren(...nodes);
  }

  const selected = state.requests.find((request) => request.id === state.activeRequestId);
  renderRequestDetail(selected);
  renderRuleSummary();
}

function renderRequestDetail(request) {
  if (!request) {
    const empty = document.createElement("div");
    empty.className = "empty-detail";
    empty.innerHTML = '<span class="empty-icon" aria-hidden="true">◉</span><h3>Select a request</h3><p>Inspect its response and turn it into a reusable rule.</p>';
    els.requestDetail.replaceChildren(empty);
    return;
  }

  const head = document.createElement("div");
  head.className = "request-detail-head";
  const title = document.createElement("div");
  const method = document.createElement("span");
  method.className = "method-badge";
  method.textContent = request.method;
  const path = document.createElement("h3");
  path.textContent = request.pathname || "/";
  title.append(method, path);
  const source = document.createElement("span");
  source.className = request.mocked ? "source-badge mocked" : "source-badge";
  source.textContent = request.mocked ? "Mocked" : "Upstream";
  head.append(title, source);

  const meta = document.createElement("div");
  meta.className = "request-meta-grid";
  meta.append(
    requestMeta("Status", request.status || "—"),
    requestMeta("Captured", formatRequestTime(request.createdAt)),
    requestMeta("Original host", requestHost(request)),
    requestMeta("Matched rule", matchedRuleName(request))
  );

  const previewLabel = document.createElement("span");
  previewLabel.className = "response-preview-label";
  previewLabel.textContent = "Response preview";
  const preview = document.createElement("pre");
  preview.className = "response-preview";
  preview.textContent = formatJson(request.responseBody ?? {});

  const actions = document.createElement("div");
  actions.className = "request-detail-actions";
  const create = document.createElement("button");
  create.type = "button";
  create.textContent = "+ Create rule from request";
  create.addEventListener("click", () => createRuleFromRequest(request));
  actions.append(create);

  els.requestDetail.replaceChildren(head, meta, previewLabel, preview, actions);
}

function requestMeta(label, value) {
  const item = document.createElement("div");
  item.className = "request-meta";
  const name = document.createElement("span");
  name.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  item.append(name, content);
  return item;
}

function requestHost(request) {
  try {
    return new URL(request.sourceUrl).host;
  } catch {
    return "Local request";
  }
}

function matchedRuleName(request) {
  const rule = state.rules.find((item) => item.id === request.ruleId);
  return rule ? ruleDisplayName(rule) : request.mocked ? "Matched rule" : "None";
}

function populateEditor({ id = null, name = "", enabled = true, method = "GET", status = 200, sourceUrl = "", pathname = "/", pathChunks = [], body = {} }) {
  state.activeRuleId = id;
  resetCollapsedPaths();
  els.ruleNameInput.value = name;
  els.ruleEnabledInput.checked = enabled !== false;
  els.ruleStateLabel.textContent = enabled === false ? "Disabled" : "Enabled";
  els.methodInput.value = method;
  els.statusInput.value = status;
  els.urlInput.value = sourceUrl;
  state.parsedUrl = sourceUrl ? { sourceUrl, pathname, chunks: pathChunks.length ? pathChunks : chunksForPath(pathname) } : null;
  state.json = cloneValue(body ?? {});
  syncTextarea();
  renderParsedUrl();
  renderJsonTree();
  setEditorTab("visual");
}

function newRule() {
  populateEditor({ body: { id: 1, name: "Sample user", active: true, roles: [{ id: "admin", label: "Administrator" }] } });
  els.editorTitle.textContent = "New rule";
  setSaveState("Unsaved");
  setView("editor");
}

function loadRule(rule) {
  populateEditor(rule);
  els.editorTitle.textContent = ruleDisplayName(rule);
  setSaveState("Saved", true);
  setView("editor");
}

function duplicateRule(rule) {
  populateEditor({ ...rule, id: null, name: `${ruleDisplayName(rule)} copy` });
  els.editorTitle.textContent = "Duplicate rule";
  setSaveState("Unsaved");
  setView("editor");
}

function selectRequest(request) {
  state.activeRequestId = request.id;
  renderRequests();
}

function createRuleFromRequest(request) {
  const sourceUrl = request.sourceUrl || `${location.origin}${request.pathname || "/"}`;
  populateEditor({
    name: `${request.method} ${request.pathname || "/"}`,
    method: request.method,
    status: request.status || 200,
    sourceUrl,
    pathname: request.pathname || "/",
    pathChunks: request.pathChunks || chunksForPath(request.pathname),
    body: request.responseBody ?? {}
  });
  els.editorTitle.textContent = "New rule from request";
  setSaveState("Unsaved");
  setView("editor");
}

async function fetchRules() {
  const response = await fetch("/api/rules");
  if (!response.ok) throw new Error("Could not load rules");
  state.rules = await response.json();
  renderRules();
}

async function fetchRequests() {
  const response = await fetch("/api/requests");
  if (!response.ok) throw new Error("Could not load requests");
  state.requests = await response.json();
  if (state.activeRequestId && !state.requests.some((request) => request.id === state.activeRequestId)) {
    state.activeRequestId = null;
  }
  renderRequests();
}

async function updateRule(rule, changes) {
  try {
    const response = await fetch("/api/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...rule, ...changes })
    });
    if (!response.ok) throw new Error("Update failed");
    await fetchRules();
    showToast(changes.enabled ? "Rule enabled." : "Rule disabled.");
  } catch {
    showToast("Could not update the rule.");
    await fetchRules();
  }
}

async function deleteRule(rule) {
  try {
    const response = await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Delete failed");
    if (state.activeRuleId === rule.id) state.activeRuleId = null;
    await fetchRules();
    showToast("Rule deleted.");
  } catch {
    showToast("Could not delete the rule.");
  }
}

async function saveRule({ asNew = false } = {}) {
  let parsed;
  try {
    parsed = parseRequestUrl(els.urlInput.value);
  } catch {
    showToast("Enter a valid http or https request URL.");
    els.urlInput.focus();
    return;
  }
  if (!parsed) {
    showToast("A request URL is required.");
    els.urlInput.focus();
    return;
  }
  if (!["http:", "https:"].includes(new URL(parsed.sourceUrl).protocol)) {
    showToast("The request URL must use http or https.");
    return;
  }

  const body = readJsonFromTextarea();
  if (body === undefined) {
    setEditorTab("raw");
    showToast("Fix the JSON before saving.");
    return;
  }

  els.saveBtn.disabled = true;
  els.saveAsNewBtn.disabled = true;
  setSaveState("Saving…");
  try {
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
    if (!response.ok) throw new Error("Save failed");
    const saved = await response.json();
    state.activeRuleId = saved.id;
    state.json = body;
    els.editorTitle.textContent = ruleDisplayName(saved);
    setSaveState("Saved", true);
    await fetchRules();
    showToast(asNew ? "Saved as a new rule." : "Rule saved.");
  } catch {
    setSaveState("Save failed");
    showToast("Could not save the rule.");
  } finally {
    els.saveBtn.disabled = false;
    els.saveAsNewBtn.disabled = false;
  }
}

async function clearRequests() {
  try {
    const response = await fetch("/api/requests", { method: "DELETE" });
    if (!response.ok) throw new Error("Clear failed");
    state.activeRequestId = null;
    await fetchRequests();
    showToast("Request history cleared.");
  } catch {
    showToast("Could not clear request history.");
  }
}

document.querySelectorAll("[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewTarget));
});

els.newRuleBtn.addEventListener("click", newRule);
els.backToRulesBtn.addEventListener("click", () => setView("rules"));
els.visualTabBtn.addEventListener("click", () => setEditorTab("visual"));
els.rawTabBtn.addEventListener("click", () => setEditorTab("raw"));
els.formatBtn.addEventListener("click", () => {
  const next = readJsonFromTextarea();
  if (next === undefined) return;
  state.json = next;
  syncTextarea();
  markDirty();
});
els.urlInput.addEventListener("input", () => {
  try {
    state.parsedUrl = parseRequestUrl(els.urlInput.value);
  } catch {
    state.parsedUrl = null;
  }
  renderParsedUrl();
  markDirty();
});
els.ruleEnabledInput.addEventListener("change", () => {
  els.ruleStateLabel.textContent = els.ruleEnabledInput.checked ? "Enabled" : "Disabled";
  markDirty();
});
[els.ruleNameInput, els.methodInput, els.statusInput, els.jsonInput].forEach((input) => input.addEventListener("input", markDirty));
els.saveBtn.addEventListener("click", () => saveRule());
els.saveAsNewBtn.addEventListener("click", () => saveRule({ asNew: true }));
els.clearRequestsBtn.addEventListener("click", clearRequests);
[els.ruleSearchInput, els.ruleMethodFilter, els.ruleStatusFilter].forEach((input) => input.addEventListener("input", renderRules));
[els.requestSearchInput, els.requestMethodFilter, els.requestStatusFilter, els.requestSourceFilter].forEach((input) => input.addEventListener("input", renderRequests));

state.json = readJsonFromTextarea();
renderJsonTree();
renderParsedUrl();

Promise.all([fetchRules(), fetchRequests()]).catch(() => {
  showToast("Could not connect to the Mocker server.");
});

window.setInterval(() => {
  fetchRequests().catch(() => {});
}, 2000);
