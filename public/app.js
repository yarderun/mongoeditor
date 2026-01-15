// Global state
let currentDatabase = ""
let currentCollection = ""
let currentPage = 1
let currentSort = "_id"
let currentOrder = "desc"
let currentFilter = "{}"
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

// UI helpers
function showToast(message, type = "success") {
  const toast = document.getElementById("toast")
  toast.textContent = message
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

// Initialize
async function init() {
  await loadDatabases()
  attachEventListeners()
}

// Load databases
async function loadDatabases() {
  try {
    const data = await fetchAPI("/api/databases")
    const selector = document.getElementById("databaseSelector")

    selector.innerHTML = '<option value="">Veritabanı Seçin...</option>'
    data.databases.forEach((db) => {
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
    const data = await fetchAPI(`/api/collections?database=${database}`)
    const list = document.getElementById("collectionsList")

    if (data.collections.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3h18v18H3zM3 9h18M9 21V9"/>
          </svg>
          <p>Koleksiyon bulunamadı</p>
        </div>
      `
      return
    }

    list.innerHTML = ""

    for (const collection of data.collections) {
      const stats = await fetchAPI(`/api/collections/${collection}/stats?database=${database}`)

      const item = document.createElement("div")
      item.className = "collection-item"
      item.innerHTML = `
        <div class="collection-info">
          <div class="collection-item-name">${collection}</div>
          <div class="collection-item-count">${formatNumber(stats.count)} döküman</div>
        </div>
        <div class="collection-actions">
          <button class="icon-btn danger" onclick="deleteCollection('${collection}')" title="Koleksiyonu Sil">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      `

      item.onclick = (e) => {
        if (!e.target.closest(".collection-actions")) {
          selectCollection(collection, stats)
        }
      }

      list.appendChild(item)
    }
  } catch (error) {
    console.error("Koleksiyonlar yüklenemedi:", error)
  }
}

// Select collection
async function selectCollection(collection, stats) {
  currentCollection = collection
  currentPage = 1
  selectedDocuments.clear()

  // Update UI
  document.querySelectorAll(".collection-item").forEach((item) => {
    item.classList.remove("active")
  })
  event.currentTarget.classList.add("active")

  document.getElementById("collectionName").textContent = collection

  // Update stats
  const statsContainer = document.getElementById("collectionStats")
  statsContainer.innerHTML = `
    <div class="stat-item">
      <span class="stat-label">Döküman</span>
      <span class="stat-value">${formatNumber(stats.count)}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Boyut</span>
      <span class="stat-value">${formatBytes(stats.size)}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Index</span>
      <span class="stat-value">${stats.indexes}</span>
    </div>
  `

  await loadDocuments()
}

// Load documents
async function loadDocuments() {
  if (!currentCollection) return

  try {
    const params = new URLSearchParams({
      database: currentDatabase,
      page: currentPage,
      limit: 20,
      sort: currentSort,
      order: currentOrder,
      filter: currentFilter,
    })

    const data = await fetchAPI(`/api/collections/${currentCollection}/documents?${params}`)

    renderDocumentsTable(data.documents)
    renderPagination(data.pagination)
  } catch (error) {
    console.error("Dökümanlar yüklenemedi:", error)
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
        <h3>Döküman bulunamadı</h3>
        <p>Bu koleksiyonda henüz döküman yok</p>
      </div>
    `
    return
  }

  // Get all unique keys from documents
  const allKeys = new Set()
  documents.forEach((doc) => {
    Object.keys(doc).forEach((key) => allKeys.add(key))
  })

  const keys = ["_id", ...Array.from(allKeys).filter((k) => k !== "_id")].slice(0, 6)

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
            const id = doc._id.toString()
            return `
            <tr class="${selectedDocuments.has(id) ? "selected" : ""}">
              <td class="checkbox-cell">
                <input type="checkbox" class="checkbox doc-checkbox" data-id="${id}" ${selectedDocuments.has(id) ? "checked" : ""}>
              </td>
              ${keys
                .map((key) => {
                  let value = doc[key]
                  if (value === undefined || value === null) return "<td>-</td>"

                  if (key === "_id") {
                    return `<td class="id-cell">${truncate(value.toString(), 24)}</td>`
                  }

                  if (typeof value === "object") {
                    value = JSON.stringify(value)
                  }

                  return `<td class="code-cell" title="${value}">${truncate(String(value), 50)}</td>`
                })
                .join("")}
              <td class="actions-cell">
                <div class="action-buttons">
                  <button class="icon-btn" onclick="editDocument('${id}')" title="Düzenle">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button class="icon-btn danger" onclick="deleteDocument('${id}')" title="Sil">
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
    const documentData = await fetchAPI(
      `/api/collections/${currentCollection}/documents/${id}?database=${currentDatabase}`,
    )

    const modal = document.getElementById("modal")
    const editor = document.getElementById("documentEditor")
    const modalTitle = document.getElementById("modalTitle")

    modalTitle.textContent = "Döküman Düzenle"
    editor.value = JSON.stringify(documentData, null, 2)
    editor.dataset.documentId = id
    editor.dataset.mode = "edit"

    modal.classList.add("show")
  } catch (error) {
    console.error("Döküman yüklenemedi:", error)
  }
}

async function deleteDocument(id) {
  if (!confirm("Bu dökümanı silmek istediğinizden emin misiniz?")) return

  try {
    await fetchAPI(`/api/collections/${currentCollection}/documents/${id}?database=${currentDatabase}`, {
      method: "DELETE",
    })

    showToast("Döküman başarıyla silindi", "success")
    selectedDocuments.delete(id)
    await loadDocuments()
  } catch (error) {
    console.error("Döküman silinemedi:", error)
  }
}

async function bulkDelete() {
  if (selectedDocuments.size === 0) return

  if (!confirm(`${selectedDocuments.size} dökümanı silmek istediğinizden emin misiniz?`)) return

  try {
    await fetchAPI(`/api/collections/${currentCollection}/bulk-delete`, {
      method: "POST",
      body: JSON.stringify({
        database: currentDatabase,
        ids: Array.from(selectedDocuments),
      }),
    })

    showToast(`${selectedDocuments.size} döküman başarıyla silindi`, "success")
    selectedDocuments.clear()
    await loadDocuments()
  } catch (error) {
    console.error("Dökümanlar silinemedi:", error)
  }
}

function addDocument() {
  const modal = document.getElementById("modal")
  const editor = document.getElementById("documentEditor")
  const modalTitle = document.getElementById("modalTitle")

  modalTitle.textContent = "Yeni Döküman Ekle"
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
    if (mode === "add") {
      await fetchAPI(`/api/collections/${currentCollection}/documents`, {
        method: "POST",
        body: JSON.stringify({
          database: currentDatabase,
          document: docData,
        }),
      })
      showToast("Döküman başarıyla eklendi", "success")
    } else {
      await fetchAPI(`/api/collections/${currentCollection}/documents/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          database: currentDatabase,
          document: docData,
        }),
      })
      showToast("Döküman başarıyla güncellendi", "success")
    }

    closeModal()
    await loadDocuments()
  } catch (error) {
    errorDiv.textContent = error.message
    errorDiv.classList.add("show")
  }
}

async function deleteCollection(collection) {
  if (!confirm(`"${collection}" koleksiyonunu silmek istediğinizden emin misiniz? Bu işlem geri alınamaz!`)) return

  try {
    await fetchAPI(`/api/collections/${collection}?database=${currentDatabase}`, {
      method: "DELETE",
    })

    showToast("Koleksiyon başarıyla silindi", "success")

    if (currentCollection === collection) {
      currentCollection = ""
      document.getElementById("collectionName").textContent = "Koleksiyon seçilmedi"
      document.getElementById("documentsTable").innerHTML = `
        <div class="empty-state-large">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <h3>Bir koleksiyon seçin</h3>
          <p>Sol taraftaki koleksiyon listesinden başlayın</p>
        </div>
      `
    }

    await loadCollections(currentDatabase)
  } catch (error) {
    console.error("Koleksiyon silinemedi:", error)
  }
}

async function createCollection() {
  const name = prompt("Yeni koleksiyon adı:")
  if (!name) return

  try {
    await fetchAPI("/api/collections", {
      method: "POST",
      body: JSON.stringify({
        database: currentDatabase,
        name,
      }),
    })

    showToast("Koleksiyon başarıyla oluşturuldu", "success")
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
