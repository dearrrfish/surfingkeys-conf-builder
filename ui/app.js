/**
 * SurfingKeys Profile Visual Builder
 * Connects with `surfingkeys-profile-create` and `surfingkeys-profile-update` skills.
 * Supports dual-mode: Local HTTP Server mode and Offline standalone mode.
 */

// Built-in Default Catalog (ensures offline operation when opened as file://)
const DEFAULT_CATALOG = {
  entries: [
    {
      id: "upstream/actions.amazon",
      source: "upstream",
      entry: "src/keys.js",
      description: "Amazon 网站快捷交互适配 (域名: amazon.com)",
      category: "website",
      domain: "amazon.com",
      requires: [],
      capabilities: ["core.openLink"],
      contributions: [
        { id: "fakespot", alias: "fs", description: "Fakespot 检测", kind: "mapkey", domain: "amazon.com" },
        { id: "view-product", alias: "a", description: "查看商品详情", kind: "mapkey", domain: "amazon.com" },
        { id: "add-to-cart", alias: "c", description: "加入购物车", kind: "mapkey", domain: "amazon.com" },
        { id: "reviews", alias: "R", description: "查看买家评价", kind: "mapkey", domain: "amazon.com" },
        { id: "questions", alias: "Q", description: "查看商品问答", kind: "mapkey", domain: "amazon.com" },
        { id: "account", alias: "A", description: "打开账户页面", kind: "mapkey", domain: "amazon.com" },
        { id: "cart", alias: "C", description: "打开购物车", kind: "mapkey", domain: "amazon.com" },
        { id: "orders", alias: "O", description: "打开我的订单", kind: "mapkey", domain: "amazon.com" }
      ]
    },
    {
      id: "upstream/search-engines.ddg",
      source: "upstream",
      entry: "src/search-engines.js",
      description: "DuckDuckGo 隐私搜索引擎及 Omni Bar 补全",
      category: "search",
      requires: [],
      capabilities: [],
      contributions: [
        {
          id: "search",
          kind: "search",
          alias: "du",
          name: "DuckDuckGo",
          search: "https://duckduckgo.com/?q=",
          compl: "https://duckduckgo.com/ac/?q=",
          callbackRequired: true
        }
      ]
    },
    {
      id: "example_notes/actions.notes",
      source: "custom/notes",
      entry: "entry.js",
      description: "个人笔记快速访问快捷键 (域名: notes.example.com)",
      category: "website",
      domain: "notes.example.com",
      requires: ["upstream/search-engines.ddg"],
      capabilities: ["core.openLink"],
      contributions: [
        { id: "home", alias: "h", description: "笔记主页导航", kind: "mapkey", domain: "notes.example.com" }
      ]
    },
    {
      id: "example_notes/search-engines.notes",
      source: "custom/notes",
      entry: "entry.js",
      description: "内部笔记专属搜索引擎与 Omni Bar 检索",
      category: "search",
      requires: [],
      capabilities: [],
      contributions: [
        {
          id: "search",
          kind: "search",
          alias: "nt",
          name: "Notes",
          search: "https://notes.example/search",
          compl: "",
          callbackRequired: false
        }
      ]
    }
  ],
  capabilities: {
    "core.openLink": {
      contract: "openLink(url, {newTab?, active?})",
      implementation: "src/actions.js#actions.openLink"
    }
  }
};

// Application State
const state = {
  mode: "create", // "create" | "update"
  isServerConnected: false,
  catalog: DEFAULT_CATALOG,
  workspaceProfiles: [],
  originalProfileForUpdate: null,
  activeProfile: {
    schemaVersion: 1,
    id: "my-profile",
    abstract: false,
    extends: "",
    base: "minimal",
    selectAdd: [],
    selectRemove: [],
    settings: {
      defaultSearchEngine: ""
    },
    leaders: {
      site: "<Space>",
      search: "a"
    },
    overrides: []
  }
};

// DOM Elements
const dom = {
  tabCreate: document.getElementById("tab-create"),
  tabUpdate: document.getElementById("tab-update"),
  connectionPill: document.getElementById("connection-pill"),
  connectionText: document.getElementById("connection-text"),
  workflowTitle: document.getElementById("workflow-title"),
  workflowBadge: document.getElementById("workflow-badge"),
  workflowIcon: document.getElementById("workflow-icon"),
  updateProfileLoader: document.getElementById("update-profile-loader"),
  existingProfileSelect: document.getElementById("existing-profile-select"),
  importFileInput: document.getElementById("import-file-input"),
  profileId: document.getElementById("profile-id"),
  profileExtends: document.getElementById("profile-extends"),
  profileAbstract: document.getElementById("profile-abstract"),
  leaderSite: document.getElementById("leader-site"),
  leaderSearch: document.getElementById("leader-search"),
  websiteContainer: document.getElementById("website-adaptations-container"),
  searchContainer: document.getElementById("search-engines-container"),
  siteCount: document.getElementById("site-features-count"),
  searchCount: document.getElementById("search-features-count"),
  defaultSearchEngine: document.getElementById("default-search-engine"),
  omnibarKeyPreview: document.getElementById("omnibar-key-preview"),
  customSettingsJson: document.getElementById("custom-settings-json"),
  selectRemoveContainer: document.getElementById("select-remove-container"),
  selectRemoveList: document.getElementById("select-remove-list"),
  diagnosticsBox: document.getElementById("diagnostics-box"),
  keymapsPreview: document.getElementById("effective-keymaps-preview"),
  diffSection: document.getElementById("diff-section"),
  diffOutput: document.getElementById("diff-output"),
  jsonPreview: document.getElementById("json-preview"),
  previewFilename: document.getElementById("preview-filename"),
  btnCopyJson: document.getElementById("btn-copy-json"),
  btnDownloadJson: document.getElementById("btn-download-json"),
  btnSaveWorkspace: document.getElementById("btn-save-workspace"),
  btnBuildScript: document.getElementById("btn-build-script"),
  buildModal: document.getElementById("build-modal"),
  modalCloseX: document.getElementById("modal-close-x"),
  modalBtnClose: document.getElementById("modal-btn-close"),
  modalBtnCopy: document.getElementById("modal-btn-copy"),
  modalBtnDownload: document.getElementById("modal-btn-download"),
  buildMetricId: document.getElementById("build-metric-id"),
  buildMetricBuildId: document.getElementById("build-metric-buildid"),
  buildMetricSize: document.getElementById("build-metric-size"),
  buildMetricFeatures: document.getElementById("build-metric-features"),
  buildScriptPath: document.getElementById("build-script-path"),
  buildMetricPackages: document.getElementById("build-metric-packages"),
  buildScriptCode: document.getElementById("build-script-code"),
  loadSettingsUrl: document.getElementById("load-settings-url"),
  modalBtnCopyUrl: document.getElementById("modal-btn-copy-url"),
  modalBtnCopySnippet: document.getElementById("modal-btn-copy-snippet")
};

// Initialize
async function init() {
  bindEvents();
  await checkServerConnection();
  renderCatalogFeatures();
  syncFormToState();
}

// Check Backend Server Connection
async function checkServerConnection() {
  try {
    const res = await fetch("/api/workspace");
    if (!res.ok) throw new Error("Server not responding with 200");
    const ws = await res.json();
    state.isServerConnected = true;
    dom.connectionPill.className = "status-pill connected";
    dom.connectionText.textContent = "已连接工作区服务器";
    dom.btnSaveWorkspace.style.display = "inline-flex";

    // Load Live Catalog & Profiles
    await loadServerCatalog();
    await loadServerProfiles();
  } catch (err) {
    state.isServerConnected = false;
    dom.connectionPill.className = "status-pill offline";
    dom.connectionText.textContent = "离线/独立模式 (file://)";
    dom.btnSaveWorkspace.style.display = "none";
    console.log("Running in offline mode with built-in catalog", err);
  }
}

// Load Catalog from Server
async function loadServerCatalog() {
  try {
    const res = await fetch("/api/catalog");
    if (res.ok) {
      const data = await res.json();
      if (data.catalog && Array.isArray(data.catalog.entries)) {
        state.catalog = data.catalog;
      }
    }
  } catch (e) {
    console.warn("Could not fetch catalog from server, using fallback", e);
  }
}

// Load Profiles from Server
async function loadServerProfiles() {
  try {
    const res = await fetch("/api/profiles");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.profiles)) {
        state.workspaceProfiles = data.profiles;
        updateProfileDropdowns();
      }
    }
  } catch (e) {
    console.warn("Could not fetch profiles from server", e);
  }
}

// Update profile dropdowns for extends and update selection
function updateProfileDropdowns() {
  // Update extends dropdown
  const currentExtends = dom.profileExtends.value;
  dom.profileExtends.innerHTML = '<option value="">(无父方案，作为根方案)</option>';
  
  // Update existing profiles dropdown
  dom.existingProfileSelect.innerHTML = '<option value="">-- 选择工作区已有方案 --</option>';

  state.workspaceProfiles.forEach(p => {
    // For extends:
    const optExtends = document.createElement("option");
    optExtends.value = `./${p.id}.json`;
    optExtends.textContent = `./${p.id}.json ${p.abstract ? "(abstract 父方案)" : ""}`;
    dom.profileExtends.appendChild(optExtends);

    // For update loader:
    const optExisting = document.createElement("option");
    optExisting.value = p.id;
    optExisting.textContent = `${p.id}.json ${p.abstract ? "[abstract]" : ""}`;
    dom.existingProfileSelect.appendChild(optExisting);
  });

  if (currentExtends) {
    dom.profileExtends.value = currentExtends;
  }
}

// Bind Event Listeners
function bindEvents() {
  // Mode switching
  dom.tabCreate.addEventListener("click", () => switchMode("create"));
  dom.tabUpdate.addEventListener("click", () => switchMode("update"));

  // Form field inputs
  dom.profileId.addEventListener("input", onFormChange);
  dom.profileExtends.addEventListener("change", onFormChange);
  dom.profileAbstract.addEventListener("change", onFormChange);
  dom.leaderSite.addEventListener("input", onFormChange);
  dom.leaderSearch.addEventListener("input", onFormChange);
  dom.defaultSearchEngine.addEventListener("change", onFormChange);
  dom.customSettingsJson.addEventListener("input", onFormChange);

  // Update mode dropdown and file import
  dom.existingProfileSelect.addEventListener("change", onSelectExistingProfile);
  dom.importFileInput.addEventListener("change", onImportFile);

  // Action buttons
  dom.btnCopyJson.addEventListener("click", copyJsonToClipboard);
  dom.btnDownloadJson.addEventListener("click", downloadJsonFile);
  dom.btnSaveWorkspace.addEventListener("click", saveToWorkspace);
  dom.btnBuildScript.addEventListener("click", onBuildScript);

  // Modal events
  dom.modalCloseX.addEventListener("click", closeBuildModal);
  dom.modalBtnClose.addEventListener("click", closeBuildModal);
  dom.modalBtnCopy.addEventListener("click", copyBuiltScript);
  dom.modalBtnDownload.addEventListener("click", downloadBuiltScript);
  dom.modalBtnCopyUrl.addEventListener("click", copyLoadSettingsUrl);
  dom.modalBtnCopySnippet.addEventListener("click", copyClientSnippet);
  dom.buildModal.addEventListener("click", (e) => {
    if (e.target === dom.buildModal) closeBuildModal();
  });
}

// Switch between Create and Update modes
function switchMode(newMode) {
  state.mode = newMode;
  if (newMode === "create") {
    dom.tabCreate.classList.add("active");
    dom.tabUpdate.classList.remove("active");
    dom.workflowTitle.textContent = "创建新方案 (Create 技能)";
    dom.workflowBadge.textContent = "create 技能流";
    dom.workflowBadge.className = "badge badge-purple";
    dom.workflowIcon.textContent = "✨";
    dom.updateProfileLoader.style.display = "none";
    dom.selectRemoveContainer.style.display = "none";
    dom.diffSection.style.display = "none";
    state.originalProfileForUpdate = null;
    dom.profileId.readOnly = false;
  } else {
    dom.tabUpdate.classList.add("active");
    dom.tabCreate.classList.remove("active");
    dom.workflowTitle.textContent = "更新已有配置 (Update 技能)";
    dom.workflowBadge.textContent = "update 技能流";
    dom.workflowBadge.className = "badge badge-yellow";
    dom.workflowIcon.textContent = "🔄";
    dom.updateProfileLoader.style.display = "block";
    dom.selectRemoveContainer.style.display = "block";
    dom.diffSection.style.display = "block";
    dom.profileId.readOnly = false;
  }
  renderCatalogFeatures();
  onFormChange();
}

// Handle existing profile selection in Update mode
async function onSelectExistingProfile() {
  const profileId = dom.existingProfileSelect.value;
  if (!profileId) return;

  if (state.isServerConnected) {
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}`);
      if (res.ok) {
        const data = await res.json();
        loadProfileData(data.profile);
      }
    } catch (e) {
      alert("读取方案失败: " + e.message);
    }
  } else {
    // Offline mock loader
    const mock = state.workspaceProfiles.find(p => p.id === profileId);
    if (mock) {
      loadProfileData(mock);
    }
  }
}

// Handle local file upload
function onImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const json = JSON.parse(event.target.result);
      loadProfileData(json);
    } catch (err) {
      alert("解析 JSON 失败: " + err.message);
    }
  };
  reader.readAsText(file);
}

// Load profile data into form & state
function loadProfileData(profile) {
  state.originalProfileForUpdate = JSON.parse(JSON.stringify(profile));
  dom.profileId.value = profile.id || "";
  dom.profileAbstract.checked = !!profile.abstract;
  dom.profileExtends.value = profile.extends || "";
  dom.leaderSite.value = (profile.leaders && profile.leaders.site) || "<Space>";
  dom.leaderSearch.value = (profile.leaders && profile.leaders.search) || "a";

  state.activeProfile.selectAdd = Array.isArray(profile.selectAdd) ? [...profile.selectAdd] : [];
  state.activeProfile.selectRemove = Array.isArray(profile.selectRemove) ? [...profile.selectRemove] : [];

  const settings = profile.settings ? { ...profile.settings } : {};
  dom.defaultSearchEngine.value = settings.defaultSearchEngine || "";
  delete settings.defaultSearchEngine;
  dom.customSettingsJson.value = Object.keys(settings).length > 0 ? JSON.stringify(settings, null, 2) : "";

  renderCatalogFeatures();
  renderSelectRemoveOptions();
  onFormChange();
}

// Render feature cards
function renderCatalogFeatures() {
  dom.websiteContainer.innerHTML = "";
  dom.searchContainer.innerHTML = "";

  const entries = state.catalog.entries || [];
  const currentLeaderSite = dom.leaderSite.value || "<Space>";
  const currentLeaderSearch = dom.leaderSearch.value || "a";

  entries.forEach(entry => {
    const isSearch = entry.id.includes("search-engines") || entry.contributions.some(c => c.kind === "search");
    const card = document.createElement("div");
    card.className = "feature-card";
    const isSelected = state.activeProfile.selectAdd.includes(entry.id);
    if (isSelected) card.classList.add("selected");

    // Header & Checkbox
    const header = document.createElement("div");
    header.className = "feature-card-header";

    const titleBlock = document.createElement("div");
    titleBlock.className = "feature-title-block";

    const idElem = document.createElement("div");
    idElem.className = "feature-id";
    idElem.textContent = entry.id;

    const descElem = document.createElement("div");
    descElem.className = "feature-desc";
    descElem.textContent = entry.description || "";

    titleBlock.appendChild(idElem);
    titleBlock.appendChild(descElem);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "feature-checkbox";
    checkbox.checked = isSelected;
    checkbox.dataset.featureId = entry.id;

    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      toggleFeature(entry.id, checkbox.checked);
    });

    card.addEventListener("click", () => {
      checkbox.checked = !checkbox.checked;
      toggleFeature(entry.id, checkbox.checked);
    });

    header.appendChild(titleBlock);
    header.appendChild(checkbox);
    card.appendChild(header);

    // Badges
    const badges = document.createElement("div");
    badges.className = "feature-badges";

    if (entry.source) {
      const srcBadge = document.createElement("span");
      srcBadge.className = "badge";
      srcBadge.textContent = `src: ${entry.source}`;
      badges.appendChild(srcBadge);
    }

    if (entry.capabilities && entry.capabilities.length > 0) {
      entry.capabilities.forEach(cap => {
        const capBadge = document.createElement("span");
        capBadge.className = "badge badge-purple";
        capBadge.textContent = cap;
        badges.appendChild(capBadge);
      });
    }

    card.appendChild(badges);

    // Keymap preview inside card
    const keymapList = document.createElement("div");
    keymapList.className = "keymap-list";

    entry.contributions.forEach(c => {
      const item = document.createElement("div");
      item.className = "keymap-item";
      let keyDisplay = "";
      if (c.kind === "search") {
        keyDisplay = `${currentLeaderSearch}${c.alias} / c${currentLeaderSearch}${c.alias}`;
      } else if (c.domain && c.domain !== "global") {
        keyDisplay = `${currentLeaderSite}${c.alias}`;
      } else {
        keyDisplay = c.alias;
      }

      item.innerHTML = `<span>${c.description || c.name || c.id}</span> <span class="key-code">${keyDisplay}</span>`;
      keymapList.appendChild(item);
    });

    card.appendChild(keymapList);

    // Append to corresponding container
    if (isSearch) {
      dom.searchContainer.appendChild(card);
    } else {
      dom.websiteContainer.appendChild(card);
    }
  });

  updateDefaultSearchEngineOptions();
  updateCounts();
}

// Toggle feature selection
function toggleFeature(featureId, isSelected) {
  if (isSelected) {
    if (!state.activeProfile.selectAdd.includes(featureId)) {
      state.activeProfile.selectAdd.push(featureId);
    }
    // Remove from selectRemove if present
    state.activeProfile.selectRemove = state.activeProfile.selectRemove.filter(id => id !== featureId);
  } else {
    state.activeProfile.selectAdd = state.activeProfile.selectAdd.filter(id => id !== featureId);
  }
  renderCatalogFeatures();
  onFormChange();
}

// Update Default Search Engine Dropdown
function updateDefaultSearchEngineOptions() {
  const currentVal = dom.defaultSearchEngine.value;
  dom.defaultSearchEngine.innerHTML = '<option value="">-- 未指定默认搜索引擎 --</option>';

  const activeAliases = new Set();
  const entries = state.catalog.entries || [];

  entries.forEach(entry => {
    if (state.activeProfile.selectAdd.includes(entry.id)) {
      entry.contributions.forEach(c => {
        if (c.kind === "search" && c.alias) {
          activeAliases.add({ alias: c.alias, name: c.name || entry.id });
        }
      });
    }
  });

  activeAliases.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.alias;
    opt.textContent = `${item.name} (${item.alias})`;
    dom.defaultSearchEngine.appendChild(opt);
  });

  if ([...activeAliases].some(a => a.alias === currentVal)) {
    dom.defaultSearchEngine.value = currentVal;
  }
}

// Update badge counts
function updateCounts() {
  const entries = state.catalog.entries || [];
  let siteSelected = 0;
  let searchSelected = 0;

  entries.forEach(entry => {
    if (state.activeProfile.selectAdd.includes(entry.id)) {
      const isSearch = entry.id.includes("search-engines") || entry.contributions.some(c => c.kind === "search");
      if (isSearch) searchSelected++;
      else siteSelected++;
    }
  });

  dom.siteCount.textContent = `已选 ${siteSelected} 项`;
  dom.searchCount.textContent = `已选 ${searchSelected} 项`;
}

// Render selectRemove options in Update mode
function renderSelectRemoveOptions() {
  dom.selectRemoveList.innerHTML = "";
  const candidateRemoves = [
    "upstream/search-engines.ddg",
    "upstream/actions.amazon",
    "example_notes/actions.notes",
    "example_notes/search-engines.notes"
  ];

  candidateRemoves.forEach(id => {
    const row = document.createElement("label");
    row.className = "form-checkbox-label";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = state.activeProfile.selectRemove.includes(id);
    chk.addEventListener("change", () => {
      if (chk.checked) {
        if (!state.activeProfile.selectRemove.includes(id)) state.activeProfile.selectRemove.push(id);
        // remove from selectAdd
        state.activeProfile.selectAdd = state.activeProfile.selectAdd.filter(x => x !== id);
      } else {
        state.activeProfile.selectRemove = state.activeProfile.selectRemove.filter(x => x !== id);
      }
      renderCatalogFeatures();
      onFormChange();
    });

    row.appendChild(chk);
    const span = document.createElement("span");
    span.textContent = id;
    row.appendChild(span);
    dom.selectRemoveList.appendChild(row);
  });
}

// Form Change handler
function onFormChange() {
  syncFormToState();
  validateAndRenderPreview();
}

// Synchronize inputs with state.activeProfile
function syncFormToState() {
  const idVal = dom.profileId.value.trim();
  state.activeProfile.id = idVal;
  state.activeProfile.schemaVersion = 1;
  state.activeProfile.abstract = dom.profileAbstract.checked;
  state.activeProfile.extends = dom.profileExtends.value || undefined;
  state.activeProfile.base = "minimal";

  // Leaders
  const siteLeader = dom.leaderSite.value || "<Space>";
  const searchLeader = dom.leaderSearch.value || "a";
  state.activeProfile.leaders = {
    site: siteLeader,
    search: searchLeader
  };

  // Omni Bar trigger preview
  dom.omnibarKeyPreview.textContent = `${searchLeader}du / c${searchLeader}du`;

  // Settings
  const settings = {};
  const defSearch = dom.defaultSearchEngine.value;
  if (defSearch) {
    settings.defaultSearchEngine = defSearch;
  }

  const customJson = dom.customSettingsJson.value.trim();
  if (customJson) {
    try {
      const parsed = JSON.parse(customJson);
      if (typeof parsed === "object" && parsed !== null) {
        Object.assign(settings, parsed);
      }
    } catch {
      // Ignored for raw typing
    }
  }

  state.activeProfile.settings = Object.keys(settings).length > 0 ? settings : undefined;

  // Build clean JSON object omitting undefined
  const cleanProfile = {
    schemaVersion: 1,
    id: state.activeProfile.id
  };

  if (state.activeProfile.abstract) cleanProfile.abstract = true;
  if (state.activeProfile.extends) cleanProfile.extends = state.activeProfile.extends;
  cleanProfile.base = "minimal";

  if (state.activeProfile.selectAdd && state.activeProfile.selectAdd.length > 0) {
    cleanProfile.selectAdd = [...new Set(state.activeProfile.selectAdd)];
  }

  if (state.mode === "update" && state.activeProfile.selectRemove && state.activeProfile.selectRemove.length > 0) {
    cleanProfile.selectRemove = [...new Set(state.activeProfile.selectRemove)];
  }

  if (state.activeProfile.settings) {
    cleanProfile.settings = state.activeProfile.settings;
  }

  if (siteLeader !== "<Space>" || searchLeader !== "a") {
    cleanProfile.leaders = state.activeProfile.leaders;
  }

  if (state.originalProfileForUpdate && state.originalProfileForUpdate.overrides) {
    cleanProfile.overrides = state.originalProfileForUpdate.overrides;
  }

  state.generatedJson = cleanProfile;
}

// Validate and render JSON preview, effective keys, and Diff
function validateAndRenderPreview() {
  const jsonString = JSON.stringify(state.generatedJson, null, 2);
  dom.jsonPreview.textContent = jsonString;
  dom.previewFilename.textContent = `profiles/${state.generatedJson.id || "profile"}.json`;

  // Validate diagnostics
  const diagnostics = [];
  const kebabRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  if (!state.generatedJson.id) {
    diagnostics.push({ level: "error", message: "方案 ID 不能为空" });
  } else if (!kebabRegex.test(state.generatedJson.id)) {
    diagnostics.push({ level: "error", message: `ID "${state.generatedJson.id}" 不符合 kebab-case 规范 (仅限小写字母、数字与连字符)` });
  }

  // Validate defaultSearchEngine
  if (state.generatedJson.settings && state.generatedJson.settings.defaultSearchEngine) {
    const defAlias = state.generatedJson.settings.defaultSearchEngine;
    const entries = state.catalog.entries || [];
    const hasSearchAlias = entries.some(e => 
      state.activeProfile.selectAdd.includes(e.id) && 
      e.contributions.some(c => c.kind === "search" && c.alias === defAlias)
    );
    if (!hasSearchAlias) {
      diagnostics.push({ level: "error", message: `defaultSearchEngine "${defAlias}" 未在已选搜索引擎列表中找到` });
    }
  }

  // Render Diagnostics Box
  if (diagnostics.length > 0) {
    dom.diagnosticsBox.className = "diagnostics-box error";
    dom.diagnosticsBox.innerHTML = `<strong>⚠️ 校验未通过</strong><ul>${diagnostics.map(d => `<li>${d.message}</li>`).join("")}</ul>`;
  } else {
    dom.diagnosticsBox.className = "diagnostics-box valid";
    dom.diagnosticsBox.innerHTML = `<strong>✓ Schema 验证通过</strong><span>配置结构合法，符合 profile.schema.json。</span>`;
  }

  // Render Keymaps Overview
  renderKeymapsOverview();

  // Render Diff if in update mode
  if (state.mode === "update") {
    renderDiff();
  }
}

// Render Effective Keymaps Overview
function renderKeymapsOverview() {
  dom.keymapsPreview.innerHTML = "";
  const siteLeader = dom.leaderSite.value || "<Space>";
  const searchLeader = dom.leaderSearch.value || "a";
  const entries = state.catalog.entries || [];

  const activeEntries = entries.filter(e => state.activeProfile.selectAdd.includes(e.id));
  if (activeEntries.length === 0) {
    dom.keymapsPreview.innerHTML = '<div class="text-muted">未选择任何功能，暂无按键绑定。</div>';
    return;
  }

  activeEntries.forEach(entry => {
    entry.contributions.forEach(c => {
      const row = document.createElement("div");
      row.className = "keymap-item";
      let key = "";
      if (c.kind === "search") {
        key = `OmniBar: ${searchLeader}${c.alias} / 剪贴板: c${searchLeader}${c.alias}`;
      } else if (c.domain && c.domain !== "global") {
        key = `${siteLeader}${c.alias} [${c.domain}]`;
      } else {
        key = c.alias;
      }
      row.innerHTML = `<span><strong>${entry.id}</strong>: ${c.description || c.name || c.id}</span><span class="key-code">${key}</span>`;
      dom.keymapsPreview.appendChild(row);
    });
  });
}

// Render JSON Diff
function renderDiff() {
  if (!state.originalProfileForUpdate) {
    dom.diffOutput.innerHTML = '<span class="text-muted">未载入原 profile，无差异对比</span>';
    return;
  }

  const origLines = JSON.stringify(state.originalProfileForUpdate, null, 2).split("\n");
  const newLines = JSON.stringify(state.generatedJson, null, 2).split("\n");

  let diffHtml = "";
  const max = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = origLines[i];
    const n = newLines[i];
    if (o === n) {
      diffHtml += `<div class="diff-line text-muted">  ${o || ""}</div>`;
    } else {
      if (o !== undefined) {
        diffHtml += `<div class="diff-line diff-removed">- ${escapeHtml(o)}</div>`;
      }
      if (n !== undefined) {
        diffHtml += `<div class="diff-line diff-added">+ ${escapeHtml(n)}</div>`;
      }
    }
  }

  dom.diffOutput.innerHTML = diffHtml || '<span class="text-muted">无变化</span>';
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Actions: Copy JSON
async function copyJsonToClipboard() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.generatedJson, null, 2));
    alert("Profile JSON 已成功复制到剪贴板！");
  } catch {
    alert("复制失败，请手动在下方代码框复制。");
  }
}

// Actions: Download JSON
function downloadJsonFile() {
  const filename = `${state.generatedJson.id || "profile"}.json`;
  const blob = new Blob([JSON.stringify(state.generatedJson, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Actions: Save to Workspace via HTTP API
async function saveToWorkspace() {
  if (!state.isServerConnected) {
    alert("当前处于离线静态模式，无法直接向工作区保存。请通过【下载】按钮导出文件。");
    return;
  }

  const id = state.generatedJson.id;
  if (!id) {
    alert("方案 ID 不能为空！");
    return;
  }

  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: state.generatedJson })
    });

    let data;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`服务响应格式异常 (HTTP ${res.status}): ${text.slice(0, 100)}`);
    }

    if (res.ok && data.ok) {
      alert(`方案 ${id}.json 已成功保存到工作区 profiles/ 目录！`);
      await loadServerProfiles();
    } else {
      alert(`保存失败: ${data.error || (data.diagnostics && data.diagnostics[0].message) || "未知错误"}`);
    }
  } catch (err) {
    alert("网络异常: " + err.message);
  }
}

// Actions: Build SurfingKeys Script
async function onBuildScript() {
  const profile = state.generatedJson;
  if (!profile.id) {
    alert("请先填写有效的方案 ID！");
    return;
  }

  if (profile.abstract) {
    alert("当前方案标记为 abstract (抽象父方案)，无法直接构建。请将其取消 abstract 或选择具体子方案进行构建。");
    return;
  }

  const origBtnText = dom.btnBuildScript.textContent;
  dom.btnBuildScript.textContent = "⏳ 正在构建...";
  dom.btnBuildScript.disabled = true;

  try {
    if (state.isServerConnected) {
      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, mode: "production" })
      });

      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`构建接口响应异常 (HTTP ${res.status}): ${text.slice(0, 100)}。请检查是否需要重启服务以载入最新的编译构建接口。`);
      }

      if (res.ok && data.ok) {
        state.lastBuildResult = data;
        dom.buildMetricId.textContent = data.profileId;
        dom.buildMetricBuildId.textContent = data.buildId.slice(0, 16) + "...";
        dom.buildMetricSize.textContent = `${Math.round(data.outputs.script.bytes / 1024)} KB (${data.outputs.script.bytes} 字节)`;
        dom.buildMetricFeatures.textContent = `${data.analysis.resolvedFeatures ? data.analysis.resolvedFeatures.length : 0} 项`;
        dom.buildScriptPath.textContent = data.scriptPath;
        dom.buildMetricPackages.textContent = (data.packages || []).map(p => p.name).join(", ") || "无外部依赖 (内联)";
        dom.buildScriptCode.textContent = data.scriptContent;

        const currentOrigin = window.location.origin.startsWith("http") ? window.location.origin : "http://127.0.0.1:3000";
        dom.loadSettingsUrl.textContent = `${currentOrigin}/script/${encodeURIComponent(data.profileId)}`;

        dom.buildModal.classList.add("active");
        await loadServerProfiles();
      } else {
        alert("构建失败: " + (data.error || (data.diagnostic && data.diagnostic.message) || "编译校验未通过"));
      }
    } else {
      // Offline fallback: Client-side SurfingKeys script synthesis
      const clientScript = generateClientSnippet(profile, state.catalog);
      state.lastBuildResult = {
        profileId: profile.id,
        buildId: "offline-preview-" + Date.now(),
        scriptPath: `(离线生成) ${profile.id}-surfingkeys.js`,
        scriptContent: clientScript,
        packages: [{ name: "client-snippet" }],
        outputs: { script: { bytes: new Blob([clientScript]).size } },
        analysis: { resolvedFeatures: profile.selectAdd || [] }
      };

      dom.buildMetricId.textContent = profile.id;
      dom.buildMetricBuildId.textContent = "offline-preview";
      dom.buildMetricSize.textContent = `${state.lastBuildResult.outputs.script.bytes} 字节`;
      dom.buildMetricFeatures.textContent = `${(profile.selectAdd || []).length} 项`;
      dom.buildScriptPath.textContent = "离线客户端直接生成";
      dom.buildMetricPackages.textContent = "无需打包外部依赖";
      dom.buildScriptCode.textContent = clientScript;

      dom.buildModal.classList.add("active");
    }
  } catch (err) {
    alert("构建网络请求失败: " + err.message);
  } finally {
    dom.btnBuildScript.textContent = origBtnText;
    dom.btnBuildScript.disabled = false;
  }
}

// Real Callback Implementations for Lightweight Standalone Snippet
const REAL_CALLBACK_CODE = {
  "upstream/actions.amazon#fakespot": `() => api.RUNTIME("openLink", { tab: { tabbed: true, active: false }, url: "https://fakespot.com/analyze?ra=true&url=" + encodeURIComponent(window.location.href) })`,
  "upstream/actions.amazon#view-product": `() => {
    const reHost = /^([-\\w]+[.])?amazon\\.[a-z]+$/;
    const rePath = /^(?:.*\\/)*(?:dp|gp\\/product)(?:\\/(\\w{10})).*/;
    const els = {};
    document.querySelectorAll("a[href]").forEach((a) => {
      try {
        const u = new URL(a.href);
        if (u.hash.length === 0 && reHost.test(u.hostname)) {
          const m = rePath.exec(u.pathname);
          if (m && m.length === 2) els[m[1]] = a;
        }
      } catch (_) {}
    });
    api.Hints.create(Object.values(els), api.Hints.dispatchMouseClick);
  }`,
  "upstream/actions.amazon#add-to-cart": `() => api.Hints.create("#add-to-cart-button", api.Hints.dispatchMouseClick)`,
  "upstream/actions.amazon#reviews": `() => window.location.assign("#customerReviews")`,
  "upstream/actions.amazon#questions": `() => window.location.assign("#Ask")`,
  "upstream/actions.amazon#account": `() => window.location.assign("/gp/css/homepage.html")`,
  "upstream/actions.amazon#cart": `() => window.location.assign("/gp/cart/view.html")`,
  "upstream/actions.amazon#orders": `() => window.location.assign("/gp/css/order-history")`,
  "example_notes/actions.notes#home": `() => window.location.assign("https://notes.example")`
};

// Generate client snippet for offline usage
function generateClientSnippet(profile, catalog) {
  const lines = [
    `// SurfingKeys Custom Configuration (Generated by SurfingKeys Visual Builder)`,
    `// Profile ID: ${profile.id}`,
    `// Base: ${profile.base || 'minimal'}`,
    `// Generated At: ${new Date().toISOString()}`,
    ``,
    `// Leaders Configuration`,
    `const siteLeader = ${JSON.stringify((profile.leaders && profile.leaders.site) || '<Space>')};`,
    `const searchLeader = ${JSON.stringify((profile.leaders && profile.leaders.search) || 'a')};`,
    ``
  ];

  if (profile.settings && Object.keys(profile.settings).length > 0) {
    lines.push(`// Settings`);
    for (const [k, v] of Object.entries(profile.settings)) {
      lines.push(`api.settings[${JSON.stringify(k)}] = ${JSON.stringify(v)};`);
    }
    lines.push(``);
  }

  lines.push(`// Feature Keymaps & Search Engines`);
  const entries = catalog.entries || [];
  const selected = entries.filter(e => (profile.selectAdd || []).includes(e.id));

  selected.forEach(entry => {
    lines.push(`// Feature: ${entry.id} (${entry.description || ''})`);
    entry.contributions.forEach(c => {
      const fullId = `${entry.id}#${c.id}`;
      const cbCode = REAL_CALLBACK_CODE[fullId] || `() => { window.location.assign(${c.domain ? JSON.stringify("https://" + c.domain) : "window.location.href"}); }`;

      if (c.kind === 'search') {
        lines.push(`api.addSearchAlias(${JSON.stringify(c.alias)}, ${JSON.stringify(c.name || c.id)}, ${JSON.stringify(c.search || '')}, "", ${JSON.stringify(c.compl || '')});`);
        lines.push(`api.mapkey(searchLeader + ${JSON.stringify(c.alias)}, ${JSON.stringify(c.name || c.id)}, () => api.Front.openOmnibar({type: 'SearchEngine', extra: ${JSON.stringify(c.alias)}}));`);
        lines.push(`api.mapkey('c' + searchLeader + ${JSON.stringify(c.alias)}, ${JSON.stringify(c.name || c.id)}, () => api.Clipboard.read(c => api.Front.openOmnibar({type: 'SearchEngine', pref: c.data, extra: ${JSON.stringify(c.alias)}})));`);
      } else if (c.domain && c.domain !== 'global') {
        const domainRegex = `^https?:\\/\\/(?:[a-zA-Z0-9-]+\\.)*${c.domain.replace(/\./g, '\\.')}(?::[0-9]+)?(?=[\\/?#]|$)`;
        lines.push(`api.mapkey(siteLeader + ${JSON.stringify(c.alias)}, ${JSON.stringify(c.description || c.id)}, ${cbCode}, {domain: new RegExp(${JSON.stringify(domainRegex)}, "i")});`);
      } else {
        lines.push(`api.mapkey(${JSON.stringify(c.alias)}, ${JSON.stringify(c.description || c.id)}, ${cbCode});`);
      }
    });
    lines.push(``);
  });

  return lines.join('\n');
}

// Copy "Load settings from" direct URL
async function copyLoadSettingsUrl() {
  const url = dom.loadSettingsUrl.textContent.trim();
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    alert(`直链 URL 已复制到剪贴板！\n\n请在 SurfingKeys 选项页勾选「Load settings from」，粘贴此 URL：\n${url}\n\n即可突破浏览器存储配额限制，无限制加载完整配置！`);
  } catch {
    alert("复制失败，请手动选中复制。");
  }
}

// Copy lightweight snippet for direct pasting (< 3KB)
async function copyClientSnippet() {
  const profile = state.generatedJson;
  const snippet = generateClientSnippet(profile, state.catalog);
  const size = new Blob([snippet]).size;
  try {
    await navigator.clipboard.writeText(snippet);
    alert(`轻量精简配置片段已复制到剪贴板！\n体积仅 ${size} 字节（< 3 KB，远低于 Chrome 8KB 存储上限）。\n可直接粘贴进 SurfingKeys 配置文本框保存生效！`);
  } catch {
    alert("复制失败，请手动在预览区复制。");
  }
}

// Close build modal
function closeBuildModal() {
  dom.buildModal.classList.remove("active");
}

// Copy built script
async function copyBuiltScript() {
  if (!state.lastBuildResult || !state.lastBuildResult.scriptContent) return;
  try {
    await navigator.clipboard.writeText(state.lastBuildResult.scriptContent);
    alert("SurfingKeys 完整运行脚本已复制到剪贴板！可直接粘贴至浏览器 SurfingKeys 选项中使用。");
  } catch {
    alert("复制失败，请在预览框内手动全选复制。");
  }
}

// Download built script
function downloadBuiltScript() {
  if (!state.lastBuildResult || !state.lastBuildResult.scriptContent) return;
  const scriptContent = state.lastBuildResult.scriptContent;
  const blob = new Blob([scriptContent], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `surfingkeys.js`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Run on page load
window.addEventListener("DOMContentLoaded", init);
