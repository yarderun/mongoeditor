// Global state
let currentDatabase = ""
let currentCollection = ""
let currentPage = 1
let currentSort = "_id"
let currentOrder = "desc"
let currentFilter = "{}"
let currentEngine = "mongo"
let currentPrimaryKey = "_id"
const DEFAULT_PG_SCHEMA = "public"
const selectedDocuments = new Set()

// API helpers
const API_BASE = ""

async function fetchAPI(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || "API hatası")
    }

    return await response.json()
  } catch (error) {
    showToast(error.message, "error")
    throw error
  }
}

function buildQuery(extra = {}) {
  const params = new URLSearchParams()

  if (currentDatabase) {
    params.set("database", currentDatabase)
  }
  if (currentEngine === "postgres") {
    params.set("schema", DEFAULT_PG_SCHEMA)
  }

  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value)
    }
  }

  const query = params.toString()
  return query ? `?${query}` : ""
}

// UI helpers
function showToast(message, type = "success") {
  const toast = document.getElementById("toast")
  toast.textContent = normalizeText(message)
  toast.className = `toast ${type} show`

  setTimeout(() => {
    toast.classList.remove("show")
  }, 3000)
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i]
}

function formatNumber(num) {
  return new Intl.NumberFormat("tr-TR").format(num)
}

function truncate(str, length = 50) {
  if (str.length <= length) return str
  return str.substring(0, length) + "..."
}

// Attempt to fix common UTF-8 mojibake (Ã, Â, Å etc.) when text was decoded with wrong encoding
function normalizeText(text) {
  if (typeof text !== "string") return text
  if (!/[ÃÅÄÂ]/.test(text)) return text
  try {
    const bytes = Uint8Array.from(Array.from(text, (ch) => ch.charCodeAt(0)))
    const decoded = new TextDecoder("utf-8").decode(bytes)
    const looksBetter =
      /[ğĞüÜşŞöÖçÇıİâîûÂÎÛ]/.test(decoded) || (decoded.length > 0 && decoded.length <= text.length + 3)
    return looksBetter ? decoded : decoded
  } catch (e) {
    return text
  }
}

function updateEngineTexts() {
  const sidebarTitle = document.querySelector(".sidebar-title")
  if (sidebarTitle) {
    sidebarTitle.textContent = currentEngine === "mongo" ? "Koleksiyonlar" : "Tablolar"
  }

  const collectionName = document.getElementById("collectionName")
  if (collectionName && !currentCollection) {
    collectionName.textContent = currentEngine === "mongo" ? "Koleksiyon seçilmedi" : "Tablo seçilmedi"
  }

  const searchInput = document.getElementById("searchInput")
  if (searchInput) {
    searchInput.placeholder =
      currentEngine === "mongo" ? "Filtre (JSON): {name: 'test'}" : 'Filtre (JSON): {"column": "value"}'
    searchInput.value = ""
  }

  const createBtn = document.getElementById("createCollectionBtn")
  if (createBtn) {
    createBtn.title = currentEngine === "mongo" ? "Yeni Koleksiyon" : "Yeni Tablo"
  }
}

function resetUiForEngineChange() {
  currentPrimaryKey = currentEngine === "mongo" ? "_id" : "id"
  currentSort = currentPrimaryKey
  currentCollection = ""
  currentPage = 1
  currentOrder = "desc"
  currentFilter = "{}"
  selectedDocuments.clear()

  const collectionsList = document.getElementById("collectionsList")
  if (collectionsList) {
    collectionsList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3h18v18H3zM3 9h18M9 21V9"/>
          </svg>
          <p>Bir veritabanı seçin</p>
        </div>
      `
  }

  const documentsTable = document.getElementById("documentsTable")
  if (documentsTable) {
    documentsTable.innerHTML = `
      <div class="empty-state-large">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <h3>${currentEngine === "mongo" ? "Bir koleksiyon seçin" : "Bir tablo seçin"}</h3>
        <p>Sol taraftaki listeden başlayın</p>
      </div>
    `
  }

  const pagination = document.getElementById("pagination")
  if (pagination) {
    pagination.style.display = "none"
  }

  updateEngineTexts()
}

// Initialize
async function init() {
  updateEngineTexts()
  await loadDatabases()
  attachEventListeners()
}

// Load databases
async function loadDatabases() {
  try {
    const endpoint = currentEngine === "postgres" ? "/api/pg/databases" : "/api/databases"
    const data = await fetchAPI(endpoint)
    const selector = document.getElementById("databaseSelector")

    selector.innerHTML = '<option value="">Veritabanı seçin...</option>'
    ;(data.databases || []).forEach((db) => {
      const option = document.createElement("option")
      option.value = db
      option.textContent = db
      selector.appendChild(option)
    })
  } catch (error) {
    console.error("Veritabanları yüklenemedi:", error)
  }
}

// Load collections
async function loadCollections(database) {
  try {
    const query = buildQuery({ database })
    const endpoint = currentEngine === "postgres" ? `/api/pg/tables${query}` : `/api/collections${query}`
    const data = await fetchAPI(endpoint)
    const list = document.getElementById("collectionsList")
    const items = currentEngine === "postgres" ? data.tables : data.collections

    if (!items || items.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3h18v18H3zM3 9h18M9 21V9"/>
          </svg>
          <p>${currentEngine === "mongo" ? "Koleksiyon bulunamadı" : "Tablo bulunamadı"}</p>
        </div>
      `
      return
    }

    list.innerHTML = ""

    for (const collection of items) {
    const stats = await fetchAPI(
      currentEngine === "postgres"
        ? `/api/pg/tables/${collection}/stats${query}`
        : `/api/collections/${collection}/stats${query}`,
    )

      const item = document.createElement("div")
      item.className = "collection-item"
      item.innerHTML = `
        <div class="collection-info">
          <div class="collection-item-name">${normalizeText(collection)}</div>
          <div class="collection-item-count">${formatNumber(stats.count)} ${currentEngine === "mongo" ? "döküman" : "satır"}</div>
        </div>
        <div class="collection-actions">
          <button class="icon-btn danger" onclick="deleteCollection('${collection}')" title="${currentEngine === "mongo" ? "Koleksiyonu Sil" : "Tabloyu Sil"}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      `

      item.onclick = (e) => {
        if (!e.target.closest(".collection-actions")) {
          selectCollection(collection, stats, e)
        }
      }

      list.appendChild(item)
    }
  } catch (error) {
    console.error("Koleksiyonlar yüklenemedi:", error)
  }
}

// Select collection
async function selectCollection(collection, stats, evt) {
  currentCollection = collection
  currentPage = 1
  selectedDocuments.clear()

  document.querySelectorAll(".collection-item").forEach((item) => {
    item.classList.remove("active")
  })

  const clickEvent = evt || window.event
  if (clickEvent && clickEvent.currentTarget) {
    clickEvent.currentTarget.classList.add("active")
  }

  currentPrimaryKey = stats?.primaryKey || (currentEngine === "mongo" ? "_id" : "id")
  currentSort = currentPrimaryKey

  document.getElementById("collectionName").textContent = normalizeText(collection)

  const statsContainer = document.getElementById("collectionStats")
  const itemLabel = currentEngine === "mongo" ? "döküman" : "satır"
  statsContainer.innerHTML = `
    <div class="stat-item">
      <span class="stat-label">${itemLabel}</span>
      <span class="stat-value">${formatNumber(stats.count || 0)}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Boyut</span>
      <span class="stat-value">${formatBytes(stats.size || stats.storageSize || 0)}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Index</span>
      <span class="stat-value">${stats.indexes ?? "-"}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">PK</span>
      <span class="stat-value">${currentPrimaryKey || "-"}</span>
    </div>
  `

  await loadDocuments()
}

// Load documents
async function loadDocuments() {
  if (!currentCollection) return

  try {
    const params = new URLSearchParams({
      page: currentPage,
      limit: 20,
      sort: currentSort,
      order: currentOrder,
      filter: currentFilter,
    })

    if (currentDatabase) {
      params.set("database", currentDatabase)
    }
    if (currentEngine === "postgres") {
      params.set("schema", DEFAULT_PG_SCHEMA)
    }

    const endpoint =
      currentEngine === "postgres"
        ? `/api/pg/tables/${currentCollection}/rows?${params}`
        : `/api/collections/${currentCollection}/documents?${params}`

    const data = await fetchAPI(endpoint)

    if (data.primaryKey) {
      currentPrimaryKey = data.primaryKey
    }

    renderDocumentsTable(data.documents)
    renderPagination(data.pagination)
  } catch (error) {
    console.error("dökümanlar yüklenemedi:", error)
  }
}

// Render documents table
function renderDocumentsTable(documents) {
  const container = document.getElementById("documentsTable")

  if (documents.length === 0) {
    container.innerHTML = `
      <div class="empty-state-large">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <h3>${currentEngine === "mongo" ? "döküman bulunamadı" : "satır bulunamadı"}</h3>
        <p>${currentEngine === "mongo" ? "Bu koleksiyonda henüz döküman yok" : "Bu tabloda henüz satır yok"}</p>
      </div>
    `
    return
  }

  // Get all unique keys from documents
  const allKeys = new Set()
  documents.forEach((doc) => {
    Object.keys(doc).forEach((key) => allKeys.add(key))
  })

  const keyOrder = []
  if (currentPrimaryKey && allKeys.has(currentPrimaryKey)) {
    keyOrder.push(currentPrimaryKey)
  }
  allKeys.forEach((key) => {
    if (!keyOrder.includes(key)) {
      keyOrder.push(key)
    }
  })
  const keys = keyOrder.slice(0, 6)

  const table = document.createElement("div")
  table.className = "table-wrapper"
  table.innerHTML = `
    <table>
      <thead>
        <tr>
          <th class="checkbox-cell">
            <input type="checkbox" class="checkbox" id="selectAll">
          </th>
          ${keys
            .map(
              (key) => `
            <th class="sortable" onclick="sortBy('${key}')">
              ${key}
              ${currentSort === key ? (currentOrder === "desc" ? "↓" : "↑") : ""}
            </th>
          `,
            )
            .join("")}
          <th class="actions-cell">İşlemler</th>
        </tr>
      </thead>
      <tbody>
        ${documents
          .map((doc) => {
            const rawId = doc[currentPrimaryKey] ?? doc._id ?? doc.id
            const id = rawId === undefined || rawId === null ? "" : String(rawId)
            const isSelected = id && selectedDocuments.has(id)

            const cells = keys
              .map((key) => {
                let value = doc[key]
                if (value === undefined || value === null) return "<td>-</td>"

                if (typeof value === "object") {
                  value = JSON.stringify(value)
                }

                value = normalizeText(String(value))
                const displayValue = truncate(value, key === currentPrimaryKey ? 24 : 50)

                if (key === currentPrimaryKey) {
                  return `<td class="id-cell">${displayValue}</td>`
                }

                return `<td class="code-cell" title="${value}">${displayValue}</td>`
              })
              .join("")

            return `
            <tr class="${isSelected ? "selected" : ""}">
              <td class="checkbox-cell">
                <input type="checkbox" class="checkbox doc-checkbox" data-id="${id}" ${isSelected ? "checked" : ""} ${
              id ? "" : "disabled"
            }>
              </td>
              ${cells}
              <td class="actions-cell">
                <div class="action-buttons">
                  <button class="icon-btn" onclick="viewBeautiful('${id}')" title="Güzel Görünüm" ${
              id ? "" : "disabled"
            }>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <button class="icon-btn" onclick="editDocument('${id}')" title="Düzenle" ${id ? "" : "disabled"}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button class="icon-btn danger" onclick="deleteDocument('${id}')" title="Sil" ${
              id ? "" : "disabled"
            }>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          `
          })
          .join("")}
      </tbody>
    </table>
  `

  container.innerHTML = ""
  container.appendChild(table)

  // Attach checkbox listeners
  document.getElementById("selectAll").addEventListener("change", handleSelectAll)
  document.querySelectorAll(".doc-checkbox").forEach((cb) => {
    cb.addEventListener("change", handleDocumentSelect)
  })

  updateBulkDeleteButton()
}

// Render pagination
function renderPagination(pagination) {
  const container = document.getElementById("pagination")

  if (pagination.pages <= 1) {
    container.style.display = "none"
    return
  }

  container.style.display = "flex"

  const pages = []
  const maxPages = 7

  if (pagination.pages <= maxPages) {
    for (let i = 1; i <= pagination.pages; i++) {
      pages.push(i)
    }
  } else {
    if (pagination.page <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i)
      pages.push("...")
      pages.push(pagination.pages)
    } else if (pagination.page >= pagination.pages - 3) {
      pages.push(1)
      pages.push("...")
      for (let i = pagination.pages - 4; i <= pagination.pages; i++) pages.push(i)
    } else {
      pages.push(1)
      pages.push("...")
      for (let i = pagination.page - 1; i <= pagination.page + 1; i++) pages.push(i)
      pages.push("...")
      pages.push(pagination.pages)
    }
  }

  container.innerHTML = `
    <div class="pagination-info">
      ${formatNumber((pagination.page - 1) * pagination.limit + 1)}-${formatNumber(Math.min(pagination.page * pagination.limit, pagination.total))} / ${formatNumber(pagination.total)}
    </div>
    <div class="pagination-buttons">
      <button class="page-btn" onclick="goToPage(${pagination.page - 1})" ${pagination.page === 1 ? "disabled" : ""}>
        Önceki
      </button>
      ${pages
        .map((page) => {
          if (page === "...") {
            return '<span class="page-btn" disabled>...</span>'
          }
          return `<button class="page-btn ${page === pagination.page ? "active" : ""}" onclick="goToPage(${page})">${page}</button>`
        })
        .join("")}
      <button class="page-btn" onclick="goToPage(${pagination.page + 1})" ${pagination.page === pagination.pages ? "disabled" : ""}>
        Sonraki
      </button>
    </div>
  `
}

// Pagination
function goToPage(page) {
  currentPage = page
  loadDocuments()
}

// Sort
function sortBy(field) {
  if (currentSort === field) {
    currentOrder = currentOrder === "desc" ? "asc" : "desc"
  } else {
    currentSort = field
    currentOrder = "desc"
  }
  loadDocuments()
}

// Selection
function handleSelectAll(e) {
  const checked = e.target.checked
  document.querySelectorAll(".doc-checkbox").forEach((cb) => {
    cb.checked = checked
    const id = cb.dataset.id
    if (checked) {
      selectedDocuments.add(id)
    } else {
      selectedDocuments.delete(id)
    }
  })
  updateBulkDeleteButton()
}

function handleDocumentSelect(e) {
  const id = e.target.dataset.id
  if (e.target.checked) {
    selectedDocuments.add(id)
  } else {
    selectedDocuments.delete(id)
  }
  updateBulkDeleteButton()
}

function updateBulkDeleteButton() {
  const btn = document.getElementById("bulkDeleteBtn")
  const count = document.getElementById("bulkDeleteCount")

  if (selectedDocuments.size > 0) {
    btn.style.display = "inline-flex"
    count.textContent = `Seçilenleri Sil (${selectedDocuments.size})`
  } else {
    btn.style.display = "none"
  }
}

// CRUD operations
async function editDocument(id) {
  try {
    const endpoint =
      currentEngine === "postgres"
        ? `/api/pg/tables/${currentCollection}/rows/${id}${buildQuery()}`
        : `/api/collections/${currentCollection}/documents/${id}${buildQuery()}`
    const documentData = await fetchAPI(endpoint)

    const modal = document.getElementById("modal")
    const editor = document.getElementById("documentEditor")
    const modalTitle = document.getElementById("modalTitle")

    modalTitle.textContent = "döküman Düzenle"
    editor.value = JSON.stringify(documentData, null, 2)
    editor.dataset.documentId = id
    editor.dataset.mode = "edit"

    modal.classList.add("show")
  } catch (error) {
    console.error("döküman yüklenemedi:", error)
  }
}

async function deleteDocument(id) {
  const message =
    currentEngine === "mongo"
      ? "Bu dökümanı silmek istediğinizden emin misiniz?"
      : "Bu satırı silmek istediğinizden emin misiniz?"
  if (!confirm(message)) return

  try {
    const endpoint =
      currentEngine === "postgres"
        ? `/api/pg/tables/${currentCollection}/rows/${id}${buildQuery()}`
        : `/api/collections/${currentCollection}/documents/${id}${buildQuery()}`

    await fetchAPI(endpoint, {
      method: "DELETE",
    })

    showToast(currentEngine === "mongo" ? "döküman başarıyla silindi" : "satır başarıyla silindi", "success")
    selectedDocuments.delete(id)
    await loadDocuments()
  } catch (error) {
    console.error("döküman silinemedi:", error)
  }
}

async function bulkDelete() {
  if (selectedDocuments.size === 0) return

  const bulkMessage =
    currentEngine === "mongo"
      ? `${selectedDocuments.size} dökümanı silmek istediğinizden emin misiniz?`
      : `${selectedDocuments.size} satırı silmek istediğinizden emin misiniz?`
  if (!confirm(bulkMessage)) return

  try {
    const endpoint =
      currentEngine === "postgres"
        ? `/api/pg/tables/${currentCollection}/bulk-delete`
        : `/api/collections/${currentCollection}/bulk-delete`

    const payload = {
      database: currentDatabase,
      ids: Array.from(selectedDocuments),
    }
    if (currentEngine === "postgres") {
      payload.schema = DEFAULT_PG_SCHEMA
    }

    await fetchAPI(endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    })

    const deletedLabel = currentEngine === "mongo" ? "döküman" : "satır"
    showToast(`${selectedDocuments.size} ${deletedLabel} başarıyla silindi`, "success")
    selectedDocuments.clear()
    await loadDocuments()
  } catch (error) {
    console.error("dökümanlar silinemedi:", error)
  }
}

function addDocument() {
  const modal = document.getElementById("modal")
  const editor = document.getElementById("documentEditor")
  const modalTitle = document.getElementById("modalTitle")

  modalTitle.textContent = currentEngine === "mongo" ? "Yeni döküman Ekle" : "Yeni satır Ekle"
  editor.value = "{\n  \n}"
  editor.dataset.documentId = ""
  editor.dataset.mode = "add"

  modal.classList.add("show")
}

async function saveDocument() {
  const editor = document.getElementById("documentEditor")
  const errorDiv = document.getElementById("editorError")
  const mode = editor.dataset.mode
  const id = editor.dataset.documentId

  // Validate JSON
  let docData
  try {
    docData = JSON.parse(editor.value)
  } catch (error) {
    errorDiv.textContent = `JSON hatası: ${error.message}`
    errorDiv.classList.add("show")
    return
  }

  errorDiv.classList.remove("show")

  try {
    const payload = {
      database: currentDatabase,
      document: docData,
    }
    if (currentEngine === "postgres") {
      payload.schema = DEFAULT_PG_SCHEMA
    }

    if (mode === "add") {
      const endpoint =
        currentEngine === "postgres"
          ? `/api/pg/tables/${currentCollection}/rows`
          : `/api/collections/${currentCollection}/documents`
      await fetchAPI(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      })
      showToast(currentEngine === "mongo" ? "döküman başarıyla eklendi" : "satır başarıyla eklendi", "success")
    } else {
      const endpoint =
        currentEngine === "postgres"
          ? `/api/pg/tables/${currentCollection}/rows/${id}`
          : `/api/collections/${currentCollection}/documents/${id}`
      await fetchAPI(endpoint, {
        method: "PUT",
        body: JSON.stringify(payload),
      })
      showToast(
        currentEngine === "mongo" ? "döküman başarıyla güncellendi" : "satır başarıyla güncellendi",
        "success",
      )
    }

    closeModal()
    await loadDocuments()
  } catch (error) {
    errorDiv.textContent = error.message
    errorDiv.classList.add("show")
  }
}

async function deleteCollection(collection) {
  const confirmText =
    currentEngine === "mongo"
      ? `"${collection}" koleksiyonunu silmek istediğinizden emin misiniz? Bu işlem geri alınamaz!`
      : `"${collection}" tablosunu silmek istediğinizden emin misiniz? Bu işlem geri alınamaz!`
  if (!confirm(confirmText)) return

  try {
    const endpoint =
      currentEngine === "postgres"
        ? `/api/pg/tables/${collection}${buildQuery()}`
        : `/api/collections/${collection}${buildQuery()}`

    await fetchAPI(endpoint, {
      method: "DELETE",
    })

    showToast(currentEngine === "mongo" ? "Koleksiyon başarıyla silindi" : "Tablo başarıyla silindi", "success")

    if (currentCollection === collection) {
      currentCollection = ""
      document.getElementById("collectionName").textContent =
        currentEngine === "mongo" ? "Koleksiyon seçilmedi" : "Tablo seçilmedi"
      document.getElementById("documentsTable").innerHTML = `
        <div class="empty-state-large">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <h3>${currentEngine === "mongo" ? "Bir koleksiyon seçin" : "Bir tablo seçin"}</h3>
          <p>Sol taraftaki ${currentEngine === "mongo" ? "koleksiyon" : "tablo"} listesinden başlayın</p>
        </div>
      `
    }

    await loadCollections(currentDatabase)
  } catch (error) {
    console.error("Koleksiyon silinemedi:", error)
  }
}

async function createCollection() {
  const name = prompt(currentEngine === "mongo" ? "Yeni koleksiyon adı:" : "Yeni tablo adı:")
  if (!name) return

  try {
    const endpoint = currentEngine === "postgres" ? "/api/pg/tables" : "/api/collections"
    const payload = {
      database: currentDatabase,
      name,
    }
    if (currentEngine === "postgres") {
      payload.schema = DEFAULT_PG_SCHEMA
    }

    await fetchAPI(endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    })

    showToast(
      currentEngine === "mongo" ? "Koleksiyon başarıyla oluşturuldu" : "Tablo başarıyla oluşturuldu",
      "success",
    )
    await loadCollections(currentDatabase)
  } catch (error) {
    console.error("Koleksiyon oluşturulamadı:", error)
  }
}

// Modal
function closeModal() {
  const modal = document.getElementById("modal")
  const errorDiv = document.getElementById("editorError")
  modal.classList.remove("show")
  errorDiv.classList.remove("show")
}

// Event listeners
function attachEventListeners() {
  // Engine selector
  const engineSelector = document.getElementById("engineSelector")
  if (engineSelector) {
    engineSelector.addEventListener("change", (e) => {
      currentEngine = e.target.value
      resetUiForEngineChange()
      document.getElementById("databaseSelector").value = ""
      currentDatabase = ""
      loadDatabases()
    })
  }

  // Database selector
  document.getElementById("databaseSelector").addEventListener("change", (e) => {
    currentDatabase = e.target.value
    if (currentDatabase) {
      loadCollections(currentDatabase)
    } else {
      document.getElementById("collectionsList").innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3h18v18H3zM3 9h18M9 21V9"/>
          </svg>
          <p>Bir veritabanı seçin</p>
        </div>
      `
    }
  })

  // Refresh
  document.getElementById("refreshBtn").addEventListener("click", () => {
    if (currentCollection) {
      loadDocuments()
    }
    if (currentDatabase) {
      loadCollections(currentDatabase)
    }
    loadDatabases()
  })

  // Search/Filter
  let searchTimeout
  document.getElementById("searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => {
      currentFilter = e.target.value || "{}"
      currentPage = 1
      loadDocuments()
    }, 500)
  })

  // Buttons
  document.getElementById("createCollectionBtn").addEventListener("click", createCollection)
  document.getElementById("addDocumentBtn").addEventListener("click", addDocument)
  document.getElementById("bulkDeleteBtn").addEventListener("click", bulkDelete)

  // Modal
  document.getElementById("closeModalBtn").addEventListener("click", closeModal)
  document.getElementById("cancelBtn").addEventListener("click", closeModal)
  document.getElementById("saveBtn").addEventListener("click", saveDocument)

  // Close modal on outside click
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") {
      closeModal()
    }
  })

  // Close modal on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal()
    }
  })
}

// Start the app
init()

// Beautiful View Functions
function formatTurkishDate(dateString) {
  const date = new Date(dateString)
  const months = [
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
  ]
  const day = date.getDate()
  const month = months[date.getMonth()]
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${day} ${month} ${year}, ${hours}:${minutes}`
}

async function viewBeautiful(id) {
  try {
    const endpoint =
      currentEngine === "postgres"
        ? `/api/pg/tables/${currentCollection}/rows/${id}${buildQuery()}`
        : `/api/collections/${currentCollection}/documents/${id}${buildQuery()}`
    const doc = await fetchAPI(endpoint)

    const modal = document.getElementById("beautifulViewModal")
    const content = document.getElementById("beautifulViewContent")

    // Build metadata from available fields
    const metaFields = []
    if (doc.language) metaFields.push(`<span class="meta-badge"><strong>Dil:</strong> ${normalizeText(doc.language)}</span>`)
    if (doc.model) metaFields.push(`<span class="meta-badge"><strong>Model:</strong> ${normalizeText(doc.model)}</span>`)
    if (doc.updatedAt) metaFields.push(`<span class="meta-badge"><strong>Güncellenme:</strong> ${formatTurkishDate(doc.updatedAt)}</span>`)
    if (doc.createdAt) metaFields.push(`<span class="meta-badge"><strong>Oluşturulma:</strong> ${formatTurkishDate(doc.createdAt)}</span>`)

    // Render the beautiful view
    let html = `
      <div class="beautiful-document">
        <div class="beautiful-header">
          <h1 class="beautiful-title">${normalizeText(doc.title || doc.subject || doc.name || "Başlıksız Kayıt")}</h1>
          <div class="beautiful-meta">
            ${metaFields.join("")}
          </div>
        </div>
    `

    // Check for messages directly
    if (doc.messages && Array.isArray(doc.messages) && doc.messages.length > 0) {
      html += renderMessagesChat(doc.messages, id)
    }
    // Check for chats object
    else if (doc.chats && typeof doc.chats === "object") {
      const chatsArray = Object.entries(doc.chats)
      if (chatsArray.length > 0) {
        html += renderChatsWithTabs(chatsArray, id)
      } else {
        html += renderOtherContent(doc)
      }
    } else {
      html += renderOtherContent(doc)
    }

    html += `</div>`

    content.innerHTML = html
    
    // Set the first chat tab as active if exists
    setTimeout(() => {
      const firstTab = document.querySelector(".chat-tab")
      if (firstTab) {
        firstTab.click()
      }
    }, 0)
    
    modal.classList.add("show")
  } catch (error) {
    console.error("döküman yüklenemedi:", error)
  }
}

function renderChatsWithTabs(chatsArray, docId) {
  let html = `
    <div class="chats-container">
      <div class="chat-tabs-wrapper">
        <div class="chat-tabs">
  `

  // Create tabs for each chat
  chatsArray.forEach(([chatId, chatData], index) => {
    const chatTitle = chatData.title || chatData.name || `Sohbet #${index + 1}`
    const messageCount = chatData.messages ? chatData.messages.length : 0
    const tabId = `chat-tab-${docId}-${chatId}`
    const contentId = `${docId}-${chatId}`
    const activeClass = index === 0 ? "active" : ""
    
    html += `
      <button class="chat-tab ${activeClass}" data-tab-id="${tabId}" onclick="switchChatTab('${tabId}', '${contentId}')">
        <span class="tab-title">${escapeHtml(chatTitle)}</span>
        <span class="tab-badge">${messageCount}</span>
      </button>
    `
  })

  html += `
        </div>
      </div>
      <div class="chat-content-wrapper">
  `

  // Create content for each chat
  chatsArray.forEach(([chatId, chatData], index) => {
    const contentId = `${docId}-${chatId}`
    const messages = chatData.messages || []
    const displayClass = index === 0 ? "active" : ""
    
    html += `
      <div class="chat-content ${displayClass}" data-content-id="${contentId}">
    `
    
    if (messages.length > 0) {
      html += `<div class="beautiful-messages">`
      
      messages.forEach((msg, msgIndex) => {
        const isUser = msg.role === "user" || msg.role === "user_message"
        const msgContent = msg.content || msg.text || ""
        const uniqueId = `msg-${docId}-${chatId}-${msgIndex}`
        const timeHtml = msg.timestamp ? `<span class="message-time">${formatTurkishDate(new Date(msg.timestamp).toISOString())}</span>` : ""

        if (msgContent.length > 400) {
          const shortened = msgContent.substring(0, 400)
          html += `
            <div class="message-bubble ${isUser ? "user-message" : "assistant-message"}">
              <div class="message-header">
                <span class="message-role">${isUser ? "👤 Sen" : "🤖 Asistan"}</span>
                ${timeHtml}
              </div>
              <div class="message-content">
                <span class="message-truncated" id="truncated-${uniqueId}">
                  ${escapeHtml(shortened)}...
                  <button class="expand-btn" onclick="toggleExpandMsg('${uniqueId}', '${escapeHtml(msgContent).replace(/'/g, "&#39;")}')">Devamını Göster</button>
                </span>
                <span class="message-expanded" id="expanded-${uniqueId}" style="display: none;">
                  ${escapeHtml(msgContent)}
                  <button class="expand-btn" onclick="toggleExpandMsg('${uniqueId}')">Gizle</button>
                </span>
              </div>
            </div>
          `
        } else {
          html += `
            <div class="message-bubble ${isUser ? "user-message" : "assistant-message"}">
              <div class="message-header">
                <span class="message-role">${isUser ? "👤 Sen" : "🤖 Asistan"}</span>
                ${timeHtml}
              </div>
              <div class="message-content">
                ${escapeHtml(msgContent)}
              </div>
            </div>
          `
        }
      })
      
      html += `</div>`
    } else {
      html += `
        <div class="empty-chat">
          <p>Bu sohbette mesaj yok</p>
        </div>
      `
    }
    
    html += `</div>`
  })

  html += `
      </div>
    </div>
  `
  
  return html
}

function switchChatTab(tabId, contentId) {
  // Remove active class from all tabs
  document.querySelectorAll(".chat-tab").forEach(tab => {
    tab.classList.remove("active")
  })
  
  // Add active class to clicked tab
  const clickedTab = document.querySelector(`[data-tab-id="${tabId}"]`)
  if (clickedTab) {
    clickedTab.classList.add("active")
  }
  
  // Hide all chat contents
  document.querySelectorAll(".chat-content").forEach(content => {
    content.classList.remove("active")
  })
  
  // Show the selected chat content
  const contentElement = document.querySelector(`[data-content-id="${contentId}"]`)
  if (contentElement) {
    contentElement.classList.add("active")
    // Scroll to top of chat content
    contentElement.scrollIntoView({ behavior: "smooth", block: "start" })
  }
}

function renderMessagesChat(messages, id) {
  let html = `<div class="beautiful-messages">`

  messages.forEach((msg, index) => {
    const isUser = msg.role === "user" || msg.role === "user_message"
    const msgContent = normalizeText(msg.content || msg.text || "")
    const uniqueId = `msg-${id}-${index}`
    const timeHtml = msg.timestamp ? `<span class="message-time">${formatTurkishDate(new Date(msg.timestamp).toISOString())}</span>` : ""

    if (msgContent.length > 400) {
      const shortened = msgContent.substring(0, 400)
      html += `
        <div class="message-bubble ${isUser ? "user-message" : "assistant-message"}">
          <div class="message-header">
            <span class="message-role">${isUser ? "👤 Sen" : "🤖 Asistan"}</span>
            ${timeHtml}
          </div>
          <div class="message-content">
            <span class="message-truncated" id="truncated-${uniqueId}">
              ${escapeHtml(shortened)}...
              <button class="expand-btn" onclick="toggleExpandMsg('${uniqueId}', '${escapeHtml(msgContent).replace(/'/g, "&#39;")}')">Devamını Göster</button>
            </span>
            <span class="message-expanded" id="expanded-${uniqueId}" style="display: none;">
              ${escapeHtml(msgContent)}
              <button class="expand-btn" onclick="toggleExpandMsg('${uniqueId}')">Gizle</button>
            </span>
          </div>
        </div>
      `
    } else {
      html += `
        <div class="message-bubble ${isUser ? "user-message" : "assistant-message"}">
          <div class="message-header">
            <span class="message-role">${isUser ? "👤 Sen" : "🤖 Asistan"}</span>
            ${timeHtml}
          </div>
          <div class="message-content">
            ${escapeHtml(msgContent)}
          </div>
        </div>
      `
    }
  })

  html += `</div>`
  return html
}

function renderOtherContent(doc) {
  let html = `<div class="beautiful-content">`

  // List all non-technical fields
  const technicalFields = ["_id", "userId", "user_id", "createdAt", "updatedAt", "__v", "id", "messages", "chats"]
  for (const [key, value] of Object.entries(doc)) {
    if (technicalFields.includes(key) || value === null || value === undefined) continue
    if (key === "title" || key === "subject" || key === "name") continue
    if (Array.isArray(value) && value.length === 0) continue

    const displayValue = normalizeText(typeof value === "object" ? JSON.stringify(value, null, 2) : String(value))
    const uniqueId = `field-${key}`

    if (displayValue.length > 300) {
      const shortened = displayValue.substring(0, 300)
      html += `
        <div class="content-field">
          <div class="field-label">${key}</div>
          <div class="field-content">
            <span class="message-truncated" id="truncated-${uniqueId}">
              ${escapeHtml(shortened)}...
              <button class="expand-btn" onclick="toggleExpandMsg('${uniqueId}', '${escapeHtml(displayValue).replace(/'/g, "&#39;")}')">Devamını Göster</button>
            </span>
            <span class="message-expanded" id="expanded-${uniqueId}" style="display: none;">
              ${escapeHtml(displayValue)}
              <button class="expand-btn" onclick="toggleExpandMsg('${uniqueId}')">Gizle</button>
            </span>
          </div>
        </div>
      `
    } else {
      html += `
        <div class="content-field">
          <div class="field-label">${key}</div>
          <div class="field-content">
            ${escapeHtml(displayValue)}
          </div>
        </div>
      `
    }
  }

  html += `</div>`
  return html
}

function truncateWithToggle(text, limit, id) {
  if (text.length <= limit) {
    return escapeHtml(text)
  }

  const shortened = text.substring(0, limit)
  return `
    <span class="message-truncated" id="truncated-${id}">
      ${escapeHtml(shortened)}...
      <button class="expand-btn" onclick="toggleExpand('${id}', '${escapeHtml(text)}')">Devamını Göster</button>
    </span>
    <span class="message-expanded" id="expanded-${id}" style="display: none;">
      ${escapeHtml(text)}
      <button class="expand-btn" onclick="toggleExpand('${id}')">Gizle</button>
    </span>
  `
}

function toggleExpandMsg(id, fullText) {
  const truncated = document.getElementById(`truncated-${id}`)
  const expanded = document.getElementById(`expanded-${id}`)

  if (truncated && expanded) {
    if (truncated.style.display === "none") {
      truncated.style.display = "inline"
      expanded.style.display = "none"
    } else {
      truncated.style.display = "none"
      expanded.style.display = "inline"
    }
  }
}

function toggleExpand(id, fullText) {
  toggleExpandMsg(id, fullText)
}

function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

function closeBeautifulView() {
  const modal = document.getElementById("beautifulViewModal")
  modal.classList.remove("show")
}






