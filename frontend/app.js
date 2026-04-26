const DEFAULT_CONFIG = {
  baseUrl: "http://localhost:3000",
  endpoints: {
    search: "/api/products",
    suggest: "/api/products/suggest"
  },
  debounceMs: 300,
  suggestMinChars: 2,
  requestTimeoutMs: 7000
};

const CONFIG = {
  ...DEFAULT_CONFIG,
  ...(window.SEARCH_APP_CONFIG || {}),
  endpoints: {
    ...DEFAULT_CONFIG.endpoints,
    ...((window.SEARCH_APP_CONFIG && window.SEARCH_APP_CONFIG.endpoints) || {})
  }
};

const state = {
  suggestions: [],
  activeSuggestionIndex: -1,
  suggestAbortController: null,
  searchAbortController: null,
  debounceTimer: null,
  lastSearchQuery: ""
};

const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const suggestionsEl = document.getElementById("suggestions");
const resultsListEl = document.getElementById("resultsList");
const resultsMetaEl = document.getElementById("resultsMeta");
const statusTextEl = document.getElementById("statusText");

function setStatus(message) {
  statusTextEl.textContent = message;
}

function encodeQuery(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, value);
    }
  });
  return searchParams.toString();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeHighlight(htmlFragment) {
  const fallback = escapeHtml(htmlFragment || "");

  if (!window.DOMPurify || typeof window.DOMPurify.sanitize !== "function") {
    return fallback;
  }

  return window.DOMPurify.sanitize(String(htmlFragment || ""), {
    ALLOWED_TAGS: ["em"],
    ALLOWED_ATTR: []
  });
}

function clearSuggestions() {
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  suggestionsEl.innerHTML = "";
  suggestionsEl.classList.add("hidden");
  searchInput.setAttribute("aria-expanded", "false");
}

function renderSuggestions(items) {
  state.suggestions = items;
  state.activeSuggestionIndex = -1;

  if (!items.length) {
    clearSuggestions();
    return;
  }

  suggestionsEl.innerHTML = "";

  items.forEach((item, idx) => {
    const li = document.createElement("li");
    li.className = "suggestion-item";
    li.id = `suggestion-${idx}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    li.textContent = item;
    li.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applySuggestion(item);
    });
    suggestionsEl.appendChild(li);
  });

  suggestionsEl.classList.remove("hidden");
  searchInput.setAttribute("aria-expanded", "true");
}

function updateSuggestionSelection() {
  const nodes = suggestionsEl.querySelectorAll(".suggestion-item");
  nodes.forEach((node, idx) => {
    const selected = idx === state.activeSuggestionIndex;
    node.setAttribute("aria-selected", selected ? "true" : "false");
  });

  if (state.activeSuggestionIndex >= 0 && nodes[state.activeSuggestionIndex]) {
    const activeId = nodes[state.activeSuggestionIndex].id;
    searchInput.setAttribute("aria-activedescendant", activeId);
    nodes[state.activeSuggestionIndex].scrollIntoView({ block: "nearest" });
  } else {
    searchInput.removeAttribute("aria-activedescendant");
  }
}

function normalizeSuggestResponse(payload) {
  const out = [];

  if (Array.isArray(payload?.suggestions)) {
    payload.suggestions.forEach((item) => {
      if (typeof item === "string") {
        out.push(item);
      } else if (item && typeof item.text === "string") {
        out.push(item.text);
      }
    });
  }

  if (!out.length && Array.isArray(payload?.items)) {
    payload.items.forEach((item) => {
      if (typeof item === "string") {
        out.push(item);
      }
    });
  }

  if (!out.length && payload?.suggest) {
    Object.values(payload.suggest).forEach((entries) => {
      (entries || []).forEach((entry) => {
        (entry.options || []).forEach((option) => {
          if (typeof option.text === "string") {
            out.push(option.text);
          }
        });
      });
    });
  }

  const unique = new Set(out.map((v) => v.trim()).filter(Boolean));
  return Array.from(unique).slice(0, 10);
}

function extractHighlight(item) {
  const hl = item?.highlight;

  if (Array.isArray(hl)) {
    return hl[0] || "";
  }

  if (hl && typeof hl === "object") {
    const allArrays = Object.values(hl).filter((v) => Array.isArray(v));
    if (allArrays.length && allArrays[0].length) {
      return allArrays[0][0] || "";
    }
  }

  if (typeof item?.snippet === "string") {
    return item.snippet;
  }

  return "";
}

function normalizeSearchResponse(payload) {
  const items = [];

  if (Array.isArray(payload?.results)) {
    payload.results.forEach((row) => items.push(row));
  }

  if (!items.length && Array.isArray(payload?.hits?.hits)) {
    payload.hits.hits.forEach((hit) => {
      items.push({
        id: hit._id,
        score: hit._score,
        source: hit._source,
        highlight: hit.highlight
      });
    });
  }

  if (!items.length && Array.isArray(payload?.hits)) {
    payload.hits.forEach((hit) => {
      items.push({
        id: hit.id,
        score: hit.score || 0,
        source: hit,
        highlight: hit.highlights
      });
    });
  }

  const normalized = items.map((item, idx) => {
    const source = item?.source || item?._source || item || {};
    const title = source.title || source.name || source.headline || `Kết quả ${idx + 1}`;
    const snippet = extractHighlight(item) || source.content || source.description || source.body || "";

    return {
      id: item.id || item._id || String(idx + 1),
      title: String(title),
      snippetHtml: sanitizeHighlight(snippet),
      score: typeof item.score === "number" ? item.score : item._score,
      rawSource: source
    };
  });

  const totalFromPayload =
    payload?.total ??
    payload?.hits?.total?.value ??
    payload?.hits?.total ??
    normalized.length;

  return {
    total: Number.isFinite(Number(totalFromPayload)) ? Number(totalFromPayload) : normalized.length,
    results: normalized
  };
}

async function fetchJson(url, abortController) {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), CONFIG.requestTimeoutMs);

  const signal = anySignal([abortController.signal, timeoutController.signal]);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache"
      },
      signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function anySignal(signals) {
  const controller = new AbortController();

  const onAbort = () => controller.abort();
  signals.forEach((sig) => {
    if (!sig) {
      return;
    }

    if (sig.aborted) {
      controller.abort();
    } else {
      sig.addEventListener("abort", onAbort, { once: true });
    }
  });

  return controller.signal;
}

function renderStateCard(message, isError = false) {
  resultsListEl.innerHTML = "";
  const card = document.createElement("div");
  card.className = `state-card${isError ? " error" : ""}`;
  card.textContent = message;
  resultsListEl.appendChild(card);
}

function renderResults(data, query, elapsedMs) {
  const { total, results } = data;

  if (!results.length) {
    resultsMetaEl.textContent = `Không có kết quả cho "${query}".`;
    renderStateCard("Không tìm thấy dữ liệu phù hợp. Hãy thử từ khóa khác.");
    return;
  }

  resultsMetaEl.textContent = `Tìm thấy ${total} kết quả cho "${query}" trong ${elapsedMs}ms.`;

  resultsListEl.innerHTML = "";

  results.forEach((result) => {
    const card = document.createElement("article");
    card.className = "result-card";

    const title = document.createElement("h3");
    title.className = "result-title";
    title.textContent = result.title;

    const snippet = document.createElement("p");
    snippet.className = "result-snippet";
    snippet.innerHTML = result.snippetHtml || escapeHtml("Không có đoạn highlight.");

    const meta = document.createElement("p");
    meta.className = "result-meta";

    const score = typeof result.score === "number" ? result.score.toFixed(3) : "n/a";
    const sourceType = result.rawSource.type || result.rawSource.category || "document";
    meta.textContent = `Score: ${score} | Source: ${sourceType}`;

    card.appendChild(title);
    card.appendChild(snippet);
    card.appendChild(meta);
    resultsListEl.appendChild(card);
  });
}

async function runSuggest(query) {
  if (query.length < CONFIG.suggestMinChars) {
    clearSuggestions();
    return;
  }

  if (state.suggestAbortController) {
    state.suggestAbortController.abort();
  }

  const controller = new AbortController();
  state.suggestAbortController = controller;

  const qs = encodeQuery({ query: query, limit: 8, request_cache: false });
  const url = `${CONFIG.baseUrl}${CONFIG.endpoints.suggest}?${qs}`;

  try {
    const payload = await fetchJson(url, controller);
    const suggestions = normalizeSuggestResponse(payload);

    if (controller.signal.aborted) {
      return;
    }

    renderSuggestions(suggestions);
    setStatus(suggestions.length ? "Đã cập nhật gợi ý." : "Không có gợi ý phù hợp.");
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }

    clearSuggestions();
    setStatus(`Lỗi gợi ý: ${error.message}`);
  }
}

function debounceSuggest(query) {
  if (state.debounceTimer) {
    window.clearTimeout(state.debounceTimer);
  }

  state.debounceTimer = window.setTimeout(() => {
    runSuggest(query);
  }, CONFIG.debounceMs);
}

async function runSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    resultsMetaEl.textContent = "Chưa có kết quả.";
    renderStateCard("Nhập từ khóa để bắt đầu tìm kiếm.");
    clearSuggestions();
    return;
  }

  if (state.searchAbortController) {
    state.searchAbortController.abort();
  }

  const controller = new AbortController();
  state.searchAbortController = controller;
  state.lastSearchQuery = trimmed;

  clearSuggestions();
  setStatus("Đang tìm kiếm...");
  resultsMetaEl.textContent = "Đang tải dữ liệu...";
  renderStateCard("Đang tải kết quả, vui lòng chờ.");

  const qs = encodeQuery({ query: trimmed, size: 12, request_cache: false });
  const url = `${CONFIG.baseUrl}${CONFIG.endpoints.search}?${qs}`;

  const startedAt = performance.now();

  try {
    const payload = await fetchJson(url, controller);
    if (controller.signal.aborted) {
      return;
    }

    const normalized = normalizeSearchResponse(payload);
    const elapsedMs = Math.round(performance.now() - startedAt);

    renderResults(normalized, trimmed, elapsedMs);
    setStatus(`Hoàn tất tìm kiếm trong ${elapsedMs}ms.`);
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }

    resultsMetaEl.textContent = `Không thể tải kết quả cho "${trimmed}".`;
    renderStateCard(`Lỗi tìm kiếm: ${error.message}`, true);
    setStatus(`Tìm kiếm thất bại: ${error.message}`);
  }
}

function applySuggestion(value) {
  searchInput.value = value;
  clearSuggestions();
  runSearch(value);
}

function handleInputKeydown(event) {
  const hasSuggestions = state.suggestions.length > 0;

  if (event.key === "ArrowDown" && hasSuggestions) {
    event.preventDefault();
    state.activeSuggestionIndex = Math.min(state.activeSuggestionIndex + 1, state.suggestions.length - 1);
    updateSuggestionSelection();
    return;
  }

  if (event.key === "ArrowUp" && hasSuggestions) {
    event.preventDefault();
    state.activeSuggestionIndex = Math.max(state.activeSuggestionIndex - 1, 0);
    updateSuggestionSelection();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();

    if (hasSuggestions && state.activeSuggestionIndex >= 0) {
      applySuggestion(state.suggestions[state.activeSuggestionIndex]);
      return;
    }

    runSearch(searchInput.value);
    return;
  }

  if (event.key === "Escape") {
    clearSuggestions();
  }
}

function bindEvents() {
  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();

    if (!query) {
      clearSuggestions();
      setStatus("Sẵn sàng.");
      return;
    }

    debounceSuggest(query);
  });

  searchInput.addEventListener("keydown", handleInputKeydown);

  searchInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      clearSuggestions();
    }, 120);
  });

  searchButton.addEventListener("click", () => {
    runSearch(searchInput.value);
  });
}

function initialize() {
  bindEvents();
  renderStateCard("Nhập từ khóa để bắt đầu tìm kiếm.");

  const initial = new URLSearchParams(window.location.search).get("q");
  if (initial) {
    searchInput.value = initial;
    runSearch(initial);
  }
}

initialize();
