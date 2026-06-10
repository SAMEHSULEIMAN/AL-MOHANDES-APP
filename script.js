// ============================================
// النظام المحاسبي المتكامل - النسخة الكاملة
// ============================================

// ===== ثوابت الترخيص =====
const LICENSE_PASSWORD = 'alexandria@191075$';
const LICENSE_DURATION_DAYS = 365;
const SUPPORT_PHONE = '01221490962';

function getLicenseStartDate() {
  const stored = localStorage.getItem('licenseStartDate');
  return stored ? new Date(stored) : null;
}
function setLicenseStartDate(date) { localStorage.setItem('licenseStartDate', date.toISOString()); }
function getRemainingDays() {
  const start = getLicenseStartDate();
  if (!start) return null;
  const diffTime = new Date() - start;
  return LICENSE_DURATION_DAYS - Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
function isLicenseExpired() { const r = getRemainingDays(); return r !== null && r <= 0; }
function isLicenseValid() { return !isLicenseExpired() && getLicenseStartDate() !== null; }

// ===== ثوابت المستخدمين =====
const USER_STORAGE_KEY = 'appUsers';
const SESSION_KEY = 'currentUser';

function getUsers() {
  const stored = localStorage.getItem(USER_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}
function saveUsers(users) {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(users));
}
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString();
}
function initDefaultAdmin() {
  const users = getUsers();
  if (!users.some(u => u.role === 'admin')) {
    users.push({
      email: 'admin@admin',
      passwordHash: simpleHash('admin'),
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    saveUsers(users);
  }
}
function loginUser(email, password) {
  const users = getUsers();
  const user = users.find(u => u.email === email);
  if (user && user.passwordHash === simpleHash(password)) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: user.email, role: user.role }));
    return user;
  }
  return null;
}
function getCurrentUser() {
  const stored = sessionStorage.getItem(SESSION_KEY);
  return stored ? JSON.parse(stored) : null;
}
function logoutUser() {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
}
function addUserByAdmin(email, password) {
  const users = getUsers();
  if (users.some(u => u.email === email)) return false;
  users.push({
    email,
    passwordHash: simpleHash(password),
    role: 'user',
    createdAt: new Date().toISOString()
  });
  saveUsers(users);
  return true;
}
function deleteUserByAdmin(email) {
  const users = getUsers();
  const index = users.findIndex(u => u.email === email && u.role !== 'admin');
  if (index === -1) return false;
  users.splice(index, 1);
  saveUsers(users);
  return true;
}

// ===== خروج كامل =====
function fullLogout() {
  localStorage.removeItem('licenseStartDate');
  localStorage.removeItem('licenseAuth');
  sessionStorage.removeItem('currentUser');
  location.reload();
}

// ===== تنبيه صوتي =====
function playBeep(frequency = 800, duration = 150, type = 'sine') {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration / 1000);
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration / 1000);
  } catch (e) {}
}

// ===== ثوابت النظام =====
const DATA_VERSION = 5;
const ACCOUNTS = {
  CASH: 'النقدية',
  INVENTORY: 'المخزون',
  SALES: 'المبيعات',
  COGS: 'تكلفة البضاعة المباعة',
  CUSTOMERS: 'العملاء',
  SUPPLIERS: 'الموردين',
  CAPITAL: 'رأس المال'
};
const LOW_STOCK_THRESHOLD = 5;
const CHART_COLORS = [
  '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
  '#FF9F40', '#C9CBCF', '#7BC043', '#F37735', '#8492A6',
  '#E74C3C', '#3498DB', '#2ECC71', '#F1C40F', '#9B59B6',
  '#1ABC9C', '#E67E22', '#95A5A6', '#D35400', '#27AE60'
];

class AccountingApp {
  constructor(user) {
    this.currentUser = user;
    this.categories = [];
    this.products = [];
    this.customers = [];
    this.suppliers = [];
    this.invoices = [];
    this.journalEntries = [];
    this.cashBalance = 0;
    this.nextProductId = 1;
    this.nextInvoiceId = 1;
    this.nextJournalId = 1;

    this.currentInvoice = null;
    this.categoryCollapsedState = {};
    this.searchText = '';
    this.sectionStates = {
      categories: false,
      'products-management': false,
      'products-list': false,
      parties: false,
      'supplier-payment': false,
      'journal-entries': false,
      receiving: false,
      'users-management': false,
      'account-settings': false
    };

    this.elements = {};
    this.chart = null;
    this.html5QrCode = null;
    this.isScanning = false;

    this.barcodeSaleMode = {
      quickSale: false,
      continuousScan: false,
      lastScanTime: 0,
      scanDebounce: 2000
    };
    this.receiveScan = {
      active: false,
      currentProduct: null,
      scanner: null
    };

    this.chartSettings = this.loadChartSettings();

    this.bindEvents();
    this.loadData();
    this.initUIByRole();
    this.restoreChartControls();
    this.renderAll();
  }

  // ========== دوال مساعدة ==========
  ensureNumber(value, defaultValue = 0) {
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }

  formatDate(isoString) {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date)) return isoString;
      return date.toLocaleString('ar-EG');
    } catch(e) { return isoString; }
  }

  normalizeData() {
    this.customers.forEach(c => { c.balance = this.ensureNumber(c.balance); });
    this.suppliers.forEach(s => { s.balance = this.ensureNumber(s.balance); });
    this.products.forEach(p => {
      p.cost = this.ensureNumber(p.cost);
      p.price = this.ensureNumber(p.price);
      p.stock = this.ensureNumber(p.stock);
    });
    this.invoices.forEach(inv => {
      inv.totalAmount = this.ensureNumber(inv.totalAmount);
      if (inv.productsSold) {
        inv.productsSold.forEach(item => {
          item.amount = this.ensureNumber(item.amount);
          item.totalCost = this.ensureNumber(item.totalCost);
        });
      }
    });
    this.cashBalance = this.ensureNumber(this.cashBalance);
    this.nextProductId = this.ensureNumber(this.nextProductId, 1);
    this.nextInvoiceId = this.ensureNumber(this.nextInvoiceId, 1);
    this.nextJournalId = this.ensureNumber(this.nextJournalId, 1);
  }

  loadData() {
    const stored = localStorage.getItem('inventoryAppData');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.version !== DATA_VERSION) {
          this.migrateData(data);
        } else {
          this.categories = data.categories || [];
          this.products = data.products || [];
          this.customers = data.customers || [];
          this.suppliers = data.suppliers || [];
          this.invoices = data.invoices || [];
          this.journalEntries = data.journalEntries || [];
          this.cashBalance = data.cashBalance ?? 0;
          this.nextProductId = data.nextProductId ?? 1;
          this.nextInvoiceId = data.nextInvoiceId ?? 1;
          this.nextJournalId = data.nextJournalId ?? 1;
        }
        if (data.sectionStates) this.sectionStates = { ...this.sectionStates, ...data.sectionStates };
      } catch(e) { console.error(e); this.resetToDefaults(); }
    } else {
      this.resetToDefaults();
    }
    this.normalizeData();
  }

  migrateData(oldData) {
    this.categories = oldData.categories || [];
    this.customers = oldData.customers || [];
    this.suppliers = oldData.suppliers || [];
    this.invoices = oldData.invoices || [];
    this.journalEntries = oldData.journalEntries || [];
    this.cashBalance = oldData.cashBalance ?? 0;
    this.nextInvoiceId = oldData.nextInvoiceId ?? 1;
    this.nextJournalId = oldData.nextJournalId ?? 1;

    if (oldData.products) {
      this.products = oldData.products.map((p, idx) => ({
        id: this.nextProductId++,
        name: p.name,
        categoryId: this.getCategoryIdByName(p.category),
        cost: this.ensureNumber(p.cost),
        price: this.ensureNumber(p.price),
        stock: this.ensureNumber(p.stock),
        supplierId: p.supplierId,
        barcode: p.barcode || null
      }));
    } else this.products = [];

    const fixDate = (dateStr) => {
      if (!dateStr) return new Date().toISOString();
      const d = new Date(dateStr);
      if (!isNaN(d)) return d.toISOString();
      return new Date().toISOString();
    };
    this.invoices = this.invoices.map(inv => ({ ...inv, date: fixDate(inv.date) }));
    this.journalEntries = this.journalEntries.map(entry => ({ ...entry, date: fixDate(entry.date) }));
    this.normalizeData();
  }

  getCategoryIdByName(name) {
    const cat = this.categories.find(c => c.name === name);
    return cat ? cat.id : null;
  }

  resetToDefaults() {
    this.categories = []; this.products = []; this.customers = []; this.suppliers = [];
    this.invoices = []; this.journalEntries = []; this.cashBalance = 0;
    this.nextProductId = 1; this.nextInvoiceId = 1; this.nextJournalId = 1;
    this.addJournalEntry('رأس المال الافتتاحي', ACCOUNTS.CASH, ACCOUNTS.CAPITAL, 10000);
    this.cashBalance = 10000;
  }

  saveData() {
    const data = {
      version: DATA_VERSION,
      categories: this.categories,
      products: this.products,
      customers: this.customers,
      suppliers: this.suppliers,
      invoices: this.invoices,
      journalEntries: this.journalEntries,
      cashBalance: this.cashBalance,
      nextProductId: this.nextProductId,
      nextInvoiceId: this.nextInvoiceId,
      nextJournalId: this.nextJournalId,
      sectionStates: this.sectionStates
    };
    localStorage.setItem('inventoryAppData', JSON.stringify(data));
  }

  getCategoryName(categoryId) {
    const cat = this.categories.find(c => c.id === categoryId);
    return cat ? cat.name : 'غير مصنف';
  }
  getSupplierName(supplierId) {
    const sup = this.suppliers.find(s => s.id === supplierId);
    return sup ? sup.name : 'غير محدد';
  }
  isLowStock(stock) { return this.ensureNumber(stock) <= LOW_STOCK_THRESHOLD; }

  addJournalEntry(description, debitAccount, creditAccount, amount) {
    amount = this.ensureNumber(amount);
    if (amount <= 0) return;
    const entry = {
      id: this.nextJournalId++,
      date: new Date().toISOString(),
      description,
      debitAccount,
      creditAccount,
      amount
    };
    this.journalEntries.push(entry);
    if (debitAccount === ACCOUNTS.CASH) this.cashBalance += amount;
    if (creditAccount === ACCOUNTS.CASH) this.cashBalance -= amount;
    this.saveData();
  }

  initUIByRole() {
    const isAdmin = this.currentUser.role === 'admin';
    document.getElementById('adminSections').style.display = isAdmin ? '' : 'none';
    document.getElementById('currentUserDisplay').textContent =
      `${this.currentUser.email} (${isAdmin ? 'مدير' : 'موظف'})`;
    if (isAdmin) {
      this.renderUsersList();
    }
  }

  // ========== إدارة الأقسام ==========
  addCategory(name) {
    if (!name.trim()) return alert('الرجاء إدخال اسم القسم');
    if (this.categories.some(c => c.name === name.trim())) return alert('القسم موجود بالفعل');
    this.categories.push({ id: Date.now(), name: name.trim() });
    this.saveData();
    this.renderCategories();
    this.updateCategoryDropdown();
    this.renderProductsByCategory();
  }
  editCategory(id) {
    const cat = this.categories.find(c => c.id === id);
    if (!cat) return;
    const newName = prompt('تعديل اسم القسم:', cat.name);
    if (newName && newName.trim() && newName.trim() !== cat.name) {
      if (this.categories.some(c => c.name === newName.trim())) return alert('الاسم موجود');
      cat.name = newName.trim();
      this.saveData();
      this.renderCategories();
      this.updateCategoryDropdown();
      this.renderProductsByCategory();
    }
  }
  deleteCategory(id) {
    const cat = this.categories.find(c => c.id === id);
    if (!cat) return;
    if (this.products.some(p => p.categoryId === cat.id)) return alert('لا يمكن حذف قسم يحتوي على منتجات');
    if (confirm(`حذف القسم "${cat.name}"؟`)) {
      this.categories = this.categories.filter(c => c.id !== id);
      this.saveData();
      this.renderCategories();
      this.updateCategoryDropdown();
      this.renderProductsByCategory();
    }
  }
  renderCategories() {
    const container = this.elements.categoriesList;
    if (!container) return;
    if (this.categories.length === 0) { container.innerHTML = '<p class="empty">لا توجد أقسام بعد.</p>'; return; }
    let html = '<ul class="category-items">';
    this.categories.forEach(cat => {
      html += `<li><span>${this.escapeHtml(cat.name)}</span><div><button class="small-btn edit-category" data-id="${cat.id}">✏️</button><button class="small-btn delete-btn delete-category" data-id="${cat.id}">🗑️</button></div></li>`;
    });
    html += '</ul>';
    container.innerHTML = html;
    container.querySelectorAll('.edit-category').forEach(btn => btn.addEventListener('click', () => this.editCategory(parseInt(btn.dataset.id))));
    container.querySelectorAll('.delete-category').forEach(btn => btn.addEventListener('click', () => this.deleteCategory(parseInt(btn.dataset.id))));
  }
  updateCategoryDropdown() {
    const select = this.elements.productCategory;
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>-- اختر القسم --</option>';
    this.categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = cat.name;
      select.appendChild(option);
    });
  }

  // ========== إدارة المنتجات ==========
  addProduct() {
    const name = this.elements.productName.value.trim();
    const categoryId = parseInt(this.elements.productCategory.value);
    const supplierId = parseInt(this.elements.productSupplier.value);
    const cost = parseFloat(this.elements.productCost.value);
    const price = parseFloat(this.elements.productPrice.value);
    const stock = parseInt(this.elements.productStock.value);
    const barcode = this.elements.productBarcode.value.trim();
    if (!name || isNaN(categoryId) || isNaN(supplierId) || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock <= 0)
      return alert('يرجى إدخال جميع البيانات بشكل صحيح');
    if (cost >= price) return alert('سعر الشراء يجب أن يكون أقل من سعر البيع');
    if (barcode && this.products.some(p => p.barcode === barcode)) return alert('هذا الباركود موجود بالفعل');
    const newId = this.nextProductId++;
    this.products.push({ id: newId, name, categoryId, cost, price, stock, supplierId, barcode: barcode || null });
    const supplier = this.suppliers.find(s => s.id === supplierId);
    if (supplier) {
      const purchaseValue = cost * stock;
      supplier.balance -= purchaseValue;
      this.addJournalEntry(`شراء منتج ${name} (${stock} وحدة) من ${supplier.name}`, ACCOUNTS.INVENTORY, ACCOUNTS.SUPPLIERS, purchaseValue);
    }
    this.saveData();
    this.clearProductForm();
    this.renderProductsByCategory();
    this.updateSupplierDropdown();
    this.populateProductSelects();
  }
  clearProductForm() {
    this.elements.productName.value = '';
    this.elements.productCategory.value = '';
    this.elements.productSupplier.value = '';
    this.elements.productCost.value = '';
    this.elements.productPrice.value = '';
    this.elements.productStock.value = '';
    this.elements.productBarcode.value = '';
  }
  renderProductsByCategory() {
    const container = this.elements.productsByCategory;
    if (!container) return;
    const filtered = this.filterProducts();
    if (filtered.length === 0) {
      container.innerHTML = '<p class="empty">لا توجد منتجات تطابق البحث.</p>';
      this.renderLowStockSummary();
      return;
    }
    const grouped = {};
    filtered.forEach(product => { if (!grouped[product.categoryId]) grouped[product.categoryId] = []; grouped[product.categoryId].push(product); });
    let html = '';
    for (const catId in grouped) {
      const catName = this.getCategoryName(parseInt(catId));
      const collapsed = this.categoryCollapsedState[catId] ? 'collapsed' : '';
      const toggleSymbol = this.categoryCollapsedState[catId] ? '▼' : '▲';
      html += `<div class="category-group ${collapsed}" data-category="${catId}"><div class="category-header" data-cat-id="${catId}"><span class="toggle-btn">${toggleSymbol}</span><h4>📁 ${this.escapeHtml(catName)}</h4></div>`;
      grouped[catId].forEach(product => {
        const supplierName = this.getSupplierName(product.supplierId);
        const lowStockClass = this.isLowStock(product.stock) ? 'low-stock' : '';
        const lowStockBadge = this.isLowStock(product.stock) ? '<span class="low-stock-badge">⚠️ مخزون منخفض</span>' : '';
        html += `<div class="product-item ${lowStockClass}" data-product-id="${product.id}"><p><strong>${this.escapeHtml(product.name)}</strong> - شراء: ${this.ensureNumber(product.cost).toFixed(2)} - بيع: ${this.ensureNumber(product.price).toFixed(2)} - الكمية: ${this.ensureNumber(product.stock)} - المورد: ${this.escapeHtml(supplierName)}${product.barcode ? `<span class="barcode">(باركود: ${this.escapeHtml(product.barcode)})</span>` : ''}${lowStockBadge}</p><div class="product-actions"><button class="sell-product" data-id="${product.id}">بيع</button><button class="edit-product" data-id="${product.id}">تعديل</button><button class="edit-quantity" data-id="${product.id}">تعديل الكمية</button><button class="delete-product delete-btn" data-id="${product.id}">حذف</button></div></div>`;
      });
      html += '</div>';
    }
    container.innerHTML = html;
    this.renderLowStockSummary();
    container.querySelectorAll('.sell-product').forEach(btn => btn.addEventListener('click', () => this.sellProduct(parseInt(btn.dataset.id))));
    container.querySelectorAll('.edit-product').forEach(btn => btn.addEventListener('click', () => this.editProduct(parseInt(btn.dataset.id))));
    container.querySelectorAll('.edit-quantity').forEach(btn => btn.addEventListener('click', () => this.editProductQuantity(parseInt(btn.dataset.id))));
    container.querySelectorAll('.delete-product').forEach(btn => btn.addEventListener('click', () => this.deleteProduct(parseInt(btn.dataset.id))));
    container.querySelectorAll('.category-header').forEach(header => header.addEventListener('click', () => this.toggleCategoryGroup(parseInt(header.dataset.catId))));
  }
  filterProducts() { return !this.searchText ? [...this.products] : this.products.filter(p => p.name.toLowerCase().includes(this.searchText)); }
  toggleCategoryGroup(categoryId) { this.categoryCollapsedState[categoryId] = !this.categoryCollapsedState[categoryId]; this.renderProductsByCategory(); }
  renderLowStockSummary() {
    const summary = this.elements.lowStockSummary;
    if (!summary) return;
    const lowCount = this.products.filter(p => this.isLowStock(p.stock)).length;
    if (lowCount > 0) {
      summary.textContent = `⚠️ ${lowCount} منتج ${lowCount === 1 ? 'بحاجة' : 'بحاجة'} لإعادة تموين`;
      summary.style.backgroundColor = '#dc3545';
    } else {
      summary.textContent = '✅ كل المنتجات متوفرة';
      summary.style.backgroundColor = '#28a745';
    }
  }
  deleteProduct(id) {
    const product = this.products.find(p => p.id === id);
    if (!product) return;
    if (this.invoices.some(inv => inv.productsSold.some(item => item.productId === id))) return alert('لا يمكن حذف منتج موجود في فواتير سابقة');
    if (confirm(`حذف المنتج "${product.name}"؟`)) {
      this.products = this.products.filter(p => p.id !== id);
      this.saveData();
      this.renderProductsByCategory();
      this.populateProductSelects();
    }
  }
  editProduct(id) {
    const product = this.products.find(p => p.id === id);
    if (!product) return;
    const productDiv = document.querySelector(`.product-item[data-product-id="${id}"]`);
    if (!productDiv) return;
    let catOpt = '', supOpt = '';
    this.categories.forEach(cat => { catOpt += `<option value="${cat.id}" ${cat.id === product.categoryId ? 'selected' : ''}>${this.escapeHtml(cat.name)}</option>`; });
    this.suppliers.forEach(sup => { supOpt += `<option value="${sup.id}" ${sup.id === product.supplierId ? 'selected' : ''}>${this.escapeHtml(sup.name)}</option>`; });
    productDiv.innerHTML = `<div class="edit-form"><label>اسم المنتج:</label><input type="text" class="edit-product-name" value="${this.escapeHtml(product.name)}"><label>القسم:</label><select class="edit-product-category">${catOpt}</select><label>المورد:</label><select class="edit-product-supplier">${supOpt}</select><label>سعر الشراء:</label><input type="number" class="edit-product-cost" value="${this.ensureNumber(product.cost)}" step="0.01"><label>سعر البيع:</label><input type="number" class="edit-product-price" value="${this.ensureNumber(product.price)}" step="0.01"><label>الباركود:</label><input type="text" class="edit-product-barcode" value="${product.barcode || ''}"><button class="save-product-edit" data-id="${id}">حفظ</button><button class="cancel-product-edit">إلغاء</button></div>`;
    productDiv.querySelector('.save-product-edit').addEventListener('click', () => this.saveProductEdit(id));
    productDiv.querySelector('.cancel-product-edit').addEventListener('click', () => this.renderProductsByCategory());
  }
  saveProductEdit(id) {
    const productDiv = document.querySelector(`.product-item[data-product-id="${id}"]`);
    if (!productDiv) return;
    const newName = productDiv.querySelector('.edit-product-name').value.trim();
    const newCategoryId = parseInt(productDiv.querySelector('.edit-product-category').value);
    const newSupplierId = parseInt(productDiv.querySelector('.edit-product-supplier').value);
    const newCost = parseFloat(productDiv.querySelector('.edit-product-cost').value);
    const newPrice = parseFloat(productDiv.querySelector('.edit-product-price').value);
    const newBarcode = productDiv.querySelector('.edit-product-barcode').value.trim();
    if (!newName || isNaN(newCategoryId) || isNaN(newSupplierId) || isNaN(newCost) || newCost <= 0 || isNaN(newPrice) || newPrice <= 0) return alert('بيانات غير صحيحة');
    if (newCost >= newPrice) return alert('سعر الشراء يجب أن يكون أقل من سعر البيع');
    if (newBarcode && this.products.some(p => p.id !== id && p.barcode === newBarcode)) return alert('الباركود موجود بالفعل');
    const product = this.products.find(p => p.id === id);
    if (product) {
      product.name = newName; product.categoryId = newCategoryId; product.supplierId = newSupplierId; product.cost = newCost; product.price = newPrice; product.barcode = newBarcode || null;
      this.saveData(); this.renderProductsByCategory(); this.populateProductSelects();
    }
  }
  editProductQuantity(id) {
    const product = this.products.find(p => p.id === id);
    if (!product) return;
    const productDiv = document.querySelector(`.product-item[data-product-id="${id}"]`);
    if (!productDiv) return;
    productDiv.innerHTML = `<div class="edit-form"><label>الكمية الجديدة:</label><input type="number" class="edit-quantity-input" value="${this.ensureNumber(product.stock)}" min="0"><button class="save-quantity" data-id="${id}">حفظ</button><button class="cancel-quantity">إلغاء</button></div>`;
    productDiv.querySelector('.save-quantity').addEventListener('click', () => {
      const newQty = parseInt(productDiv.querySelector('.edit-quantity-input').value);
      if (isNaN(newQty) || newQty < 0) return alert('كمية غير صحيحة');
      product.stock = newQty; this.saveData(); this.renderProductsByCategory();
    });
    productDiv.querySelector('.cancel-quantity').addEventListener('click', () => this.renderProductsByCategory());
  }

  // ========== العملاء والموردين ==========
  addCustomer() {
    const name = this.elements.customerName.value.trim();
    const phone = this.elements.customerPhone.value.trim();
    if (!name) return alert('الرجاء إدخال اسم العميل');
    if (this.customers.some(c => c.name === name)) return alert('العميل موجود بالفعل');
    this.customers.push({ id: Date.now(), name, phone, balance: 0 });
    this.elements.customerName.value = ''; this.elements.customerPhone.value = '';
    this.saveData(); this.renderCustomers(); this.updateBuyerDropdown();
  }
  addSupplier() {
    const name = this.elements.supplierName.value.trim();
    const phone = this.elements.supplierPhone.value.trim();
    if (!name) return alert('الرجاء إدخال اسم المورد');
    if (this.suppliers.some(s => s.name === name)) return alert('المورد موجود بالفعل');
    this.suppliers.push({ id: Date.now(), name, phone, balance: 0 });
    this.elements.supplierName.value = ''; this.elements.supplierPhone.value = '';
    this.saveData(); this.renderSuppliers(); this.updateSupplierDropdown(); this.updatePaymentSupplierDropdown(); this.updateReceivingSupplierDropdown();
  }
  renderCustomers() {
    const container = this.elements.customersList;
    if (!container) return;
    const search = this.elements.searchCustomer?.value.toLowerCase() || '';
    const filtered = this.customers.filter(c => c.name.toLowerCase().includes(search));
    if (filtered.length === 0) { container.innerHTML = '<p class="empty">لا يوجد عملاء.</p>'; return; }
    let html = '';
    filtered.forEach(c => {
      const balance = this.ensureNumber(c.balance);
      html += `<div class="party-item"><span>${this.escapeHtml(c.name)} (${this.escapeHtml(c.phone || '')})</span><span class="party-balance ${balance >= 0 ? 'positive-balance' : 'negative-balance'}">الرصيد: ${balance.toFixed(2)}</span><div><button class="small-btn show-statement" data-id="${c.id}" data-type="customer">📋 بيان</button><button class="small-btn edit-customer" data-id="${c.id}">✏️</button><button class="small-btn delete-btn delete-customer" data-id="${c.id}">🗑️</button></div></div>`;
    });
    container.innerHTML = html;
    container.querySelectorAll('.show-statement').forEach(btn => btn.addEventListener('click', () => this.showCustomerStatement(parseInt(btn.dataset.id))));
    container.querySelectorAll('.edit-customer').forEach(btn => btn.addEventListener('click', () => this.editCustomer(parseInt(btn.dataset.id))));
    container.querySelectorAll('.delete-customer').forEach(btn => btn.addEventListener('click', () => this.deleteCustomer(parseInt(btn.dataset.id))));
  }
  renderSuppliers() {
    const container = this.elements.suppliersList;
    if (!container) return;
    const search = this.elements.searchSupplier?.value.toLowerCase() || '';
    const filtered = this.suppliers.filter(s => s.name.toLowerCase().includes(search));
    if (filtered.length === 0) { container.innerHTML = '<p class="empty">لا يوجد موردين.</p>'; return; }
    let html = '';
    filtered.forEach(s => {
      const balance = this.ensureNumber(s.balance);
      html += `<div class="party-item"><span>${this.escapeHtml(s.name)} (${this.escapeHtml(s.phone || '')})</span><span class="party-balance ${balance <= 0 ? 'positive-balance' : 'negative-balance'}">الرصيد: ${balance.toFixed(2)}</span><div><button class="small-btn show-statement" data-id="${s.id}" data-type="supplier">📋 بيان</button><button class="small-btn edit-supplier" data-id="${s.id}">✏️</button><button class="small-btn delete-btn delete-supplier" data-id="${s.id}">🗑️</button></div></div>`;
    });
    container.innerHTML = html;
    container.querySelectorAll('.show-statement').forEach(btn => btn.addEventListener('click', () => this.showSupplierStatement(parseInt(btn.dataset.id))));
    container.querySelectorAll('.edit-supplier').forEach(btn => btn.addEventListener('click', () => this.editSupplier(parseInt(btn.dataset.id))));
    container.querySelectorAll('.delete-supplier').forEach(btn => btn.addEventListener('click', () => this.deleteSupplier(parseInt(btn.dataset.id))));
  }
  editCustomer(id) {
    const c = this.customers.find(c => c.id === id);
    if (!c) return;
    const newName = prompt('اسم العميل الجديد:', c.name);
    if (newName && newName.trim() && newName.trim() !== c.name) {
      if (this.customers.some(c => c.name === newName.trim())) return alert('الاسم موجود');
      c.name = newName.trim();
    }
    const newPhone = prompt('رقم الهاتف الجديد:', c.phone);
    if (newPhone !== null) c.phone = newPhone;
    this.saveData(); this.renderCustomers(); this.updateBuyerDropdown();
  }
  deleteCustomer(id) { if (confirm('حذف العميل؟')) { this.customers = this.customers.filter(c => c.id !== id); this.saveData(); this.renderCustomers(); this.updateBuyerDropdown(); } }
  editSupplier(id) {
    const s = this.suppliers.find(s => s.id === id);
    if (!s) return;
    const newName = prompt('اسم المورد الجديد:', s.name);
    if (newName && newName.trim() && newName.trim() !== s.name) {
      if (this.suppliers.some(s => s.name === newName.trim())) return alert('الاسم موجود');
      s.name = newName.trim();
    }
    const newPhone = prompt('رقم الهاتف الجديد:', s.phone);
    if (newPhone !== null) s.phone = newPhone;
    this.saveData(); this.renderSuppliers(); this.updateSupplierDropdown(); this.updatePaymentSupplierDropdown(); this.updateReceivingSupplierDropdown();
  }
  deleteSupplier(id) { if (confirm('حذف المورد؟')) { this.suppliers = this.suppliers.filter(s => s.id !== id); this.saveData(); this.renderSuppliers(); this.updateSupplierDropdown(); this.updatePaymentSupplierDropdown(); this.updateReceivingSupplierDropdown(); } }
  updateBuyerDropdown() {
    const select = this.elements.buyerSelect;
    if (!select) return;
    select.innerHTML = '<option value="" selected disabled>-- اختر عميل --</option>';
    this.customers.forEach(c => { const opt = document.createElement('option'); opt.value = c.id; opt.textContent = `${c.name} (الرصيد: ${this.ensureNumber(c.balance).toFixed(2)})`; select.appendChild(opt); });
  }
  updateSupplierDropdown() {
    const select = this.elements.productSupplier;
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>-- اختر المورد --</option>';
    this.suppliers.forEach(sup => { const opt = document.createElement('option'); opt.value = sup.id; opt.textContent = sup.name; select.appendChild(opt); });
  }
  updatePaymentSupplierDropdown() {
    const select = this.elements.paymentSupplier;
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>-- اختر مورد --</option>';
    this.suppliers.forEach(sup => { const opt = document.createElement('option'); opt.value = sup.id; const due = this.ensureNumber(sup.balance) < 0 ? -this.ensureNumber(sup.balance) : 0; opt.textContent = `${sup.name} (المستحق: ${due.toFixed(2)})`; select.appendChild(opt); });
  }
  updateReceivingSupplierDropdown() {
    const select = this.elements.receivingSupplier;
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>اختر مورد</option>';
    this.suppliers.forEach(sup => { const opt = document.createElement('option'); opt.value = sup.id; opt.textContent = sup.name; select.appendChild(opt); });
  }
  processSupplierPayment() {
    const supplierId = parseInt(this.elements.paymentSupplier.value);
    const amount = parseFloat(this.elements.paymentAmount.value);
    const note = this.elements.paymentNote.value.trim();
    if (isNaN(supplierId)) return alert('اختر مورداً');
    if (isNaN(amount) || amount <= 0) return alert('أدخل مبلغاً صحيحاً أكبر من صفر');
    const supplier = this.suppliers.find(s => s.id === supplierId);
    if (!supplier) return alert('المورد غير موجود');
    const due = this.ensureNumber(supplier.balance) < 0 ? -this.ensureNumber(supplier.balance) : 0;
    if (amount > due) return alert(`المبلغ أكبر من المستحق (${due.toFixed(2)})`);
    supplier.balance += amount;
    this.addJournalEntry(note ? `سداد للمورد ${supplier.name} - ${note}` : `سداد للمورد ${supplier.name}`, ACCOUNTS.SUPPLIERS, ACCOUNTS.CASH, amount);
    this.saveData(); this.renderSuppliers(); this.updateSupplierDropdown(); this.updatePaymentSupplierDropdown(); this.showJournalEntries();
    this.elements.paymentResult.innerHTML = `<p class="success-message">✅ تم تسجيل سداد ${this.ensureNumber(amount).toFixed(2)} للمورد ${supplier.name}. الرصيد المتبقي: ${due.toFixed(2)}</p>`;
    this.elements.paymentAmount.value = ''; this.elements.paymentNote.value = '';
  }

  // ========== استلام البضاعة ==========
  startReceiveScanner() {
    if (this.receiveScan.active) return;
    if (typeof Html5Qrcode === 'undefined') { alert('مكتبة الباركود غير متوفرة.'); return; }
    document.getElementById('receiveScannerContainer').style.display = 'block';
    this.elements.startReceiveScannerBtn.style.display = 'none';
    this.elements.stopReceiveScannerBtn.style.display = 'inline-block';
    this.receiveScan.scanner = new Html5Qrcode("qr-reader-receive");
    this.receiveScan.scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => this.handleReceiveScan(decodedText),
      (err) => { console.log(err); }
    ).catch(err => { console.error(err); alert("تعذر الوصول إلى الكاميرا"); this.stopReceiveScanner(); });
    this.receiveScan.active = true;
  }
  stopReceiveScanner() {
    if (this.receiveScan.scanner && this.receiveScan.active) {
      this.receiveScan.scanner.stop().then(() => {
        this.receiveScan.active = false;
        document.getElementById('receiveScannerContainer').style.display = 'none';
        this.elements.startReceiveScannerBtn.style.display = 'inline-block';
        this.elements.stopReceiveScannerBtn.style.display = 'none';
      }).catch(e => console.error(e));
    }
  }
  handleReceiveScan(barcode) {
    this.stopReceiveScanner();
    const product = this.findProductByBarcode(barcode);
    if (product) {
      this.receiveScan.currentProduct = product;
      document.getElementById('receiveProductName').textContent = product.name;
      document.getElementById('receiveProductBarcode').textContent = product.barcode;
      document.getElementById('receivePreview').style.display = 'block';
      playBeep(800, 120, 'triangle');
    } else {
      if (confirm('المنتج غير موجود. هل تريد إنشاءه؟')) {
        document.getElementById('productBarcode').value = barcode;
        document.getElementById('productName').focus();
        alert('تم تعبئة الباركود، يرجى إكمال بيانات المنتج.');
        playBeep(600, 100, 'sine');
      }
    }
  }
  confirmReceive() {
    if (!this.receiveScan.currentProduct) return;
    const quantity = parseInt(this.elements.receiveQuantity.value);
    const costInput = this.elements.receiveCost.value;
    const newCost = costInput ? parseFloat(costInput) : this.receiveScan.currentProduct.cost;
    const supplierId = parseInt(this.elements.receivingSupplier.value);
    if (isNaN(quantity) || quantity <= 0) return alert('كمية غير صحيحة');
    if (isNaN(newCost) || newCost <= 0) return alert('سعر شراء غير صحيح');
    if (isNaN(supplierId)) return alert('اختر مورداً');
    const product = this.receiveScan.currentProduct;
    product.stock += quantity;
    product.cost = newCost;
    const supplier = this.suppliers.find(s => s.id === supplierId);
    if (supplier) {
      supplier.balance -= (newCost * quantity);
      this.addJournalEntry(`استلام ${quantity} وحدة من ${product.name} من ${supplier.name}`, ACCOUNTS.INVENTORY, ACCOUNTS.SUPPLIERS, newCost * quantity);
    }
    this.saveData();
    this.renderProductsByCategory();
    this.renderSuppliers();
    this.updateSupplierDropdowns();
    document.getElementById('receivePreview').style.display = 'none';
    this.receiveScan.currentProduct = null;
    playBeep(900, 150, 'triangle');
    alert('تم استلام البضاعة بنجاح');
  }
  cancelReceive() {
    document.getElementById('receivePreview').style.display = 'none';
    this.receiveScan.currentProduct = null;
  }

  // ========== الفواتير والباركود (بيع) ==========
  createInvoice() {
    const buyerName = this.elements.buyerName.value.trim();
    if (!buyerName) return alert('أدخل اسم المشتري');
    if (this.currentInvoice && !confirm('لديك فاتورة حالية. إلغاؤها وإنشاء جديدة؟')) return;
    this.currentInvoice = { buyerName, buyerId: null, productsSold: [], totalAmount: 0, date: new Date().toISOString() };
    const selected = this.customers.find(c => c.name === buyerName);
    if (selected) this.currentInvoice.buyerId = selected.id;
    this.elements.buyerName.value = '';
    this.displayCurrentInvoice();
    alert('تم إنشاء الفاتورة. يمكنك إضافة المنتجات.');
  }
  sellProduct(productId) {
    if (!this.currentInvoice) return alert('أنشئ فاتورة أولاً');
    const product = this.products.find(p => p.id === productId);
    if (!product) return;
    const qty = parseInt(prompt(`الكمية من ${product.name} (المتاح: ${product.stock}):`));
    if (isNaN(qty) || qty <= 0 || qty > product.stock) return alert('كمية غير صحيحة');
    this.addToCurrentInvoice(product.id, qty);
  }
  findProductByBarcode(barcode) {
    if (!barcode) return null;
    let p = this.products.find(p => p.barcode === barcode);
    if (!p) p = this.products.find(p => p.name.toLowerCase() === barcode.toLowerCase());
    return p;
  }
  processBarcodeSale(barcode) {
    if (!this.currentInvoice) {
      this.currentInvoice = {
        buyerName: 'مشتري نقدي',
        buyerId: null,
        productsSold: [],
        totalAmount: 0,
        date: new Date().toISOString()
      };
      if (!this.customers.some(c => c.name === 'مشتري نقدي')) {
        this.customers.push({ id: Date.now(), name: 'مشتري نقدي', phone: '', balance: 0 });
        this.saveData();
        this.renderCustomers();
        this.updateBuyerDropdown();
      }
      this.displayCurrentInvoice();
    }
    const product = this.findProductByBarcode(barcode);
    if (!product) {
      this.showScanNotification('لم يتم العثور على المنتج', 'error');
      playBeep(200, 300, 'square');
      return false;
    }
    if (product.stock <= 0) {
      alert(`المخزون غير كافٍ لـ ${product.name}`);
      return false;
    }
    const quickSale = this.elements.quickSaleMode.checked;
    if (quickSale) {
      this.addToCurrentInvoice(product.id, 1);
      this.showScanNotification(`تمت إضافة ${product.name}`, 'success');
      playBeep(1000, 100, 'sine');
      return true;
    } else {
      const qty = parseInt(prompt(`الكمية من ${product.name} (المتاح: ${product.stock}):`));
      if (isNaN(qty) || qty <= 0 || qty > product.stock) {
        alert('كمية غير صحيحة');
        return false;
      }
      this.addToCurrentInvoice(product.id, qty);
      this.showScanNotification(`تمت إضافة ${qty} من ${product.name}`, 'success');
      playBeep(1000, 100, 'sine');
      return true;
    }
  }
  addToCurrentInvoice(productId, quantity) {
    const product = this.products.find(p => p.id === productId);
    if (!product) return;
    product.stock -= quantity;
    const existingItem = this.currentInvoice.productsSold.find(item => item.productId === productId);
    if (existingItem) {
      existingItem.quantity += quantity;
      existingItem.amount += product.price * quantity;
      existingItem.totalCost += product.cost * quantity;
    } else {
      this.currentInvoice.productsSold.push({
        productId: product.id,
        productName: product.name,
        quantity: quantity,
        amount: product.price * quantity,
        cost: product.cost,
        totalCost: product.cost * quantity
      });
    }
    this.currentInvoice.totalAmount += product.price * quantity;
    this.saveData();
    this.renderProductsByCategory();
    this.displayCurrentInvoice();
  }
  showScanNotification(message, type) {
    const notif = document.createElement('div');
    notif.className = `scan-notification ${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => { notif.classList.add('fadeout'); setTimeout(() => notif.remove(), 500); }, 1500);
  }
  displayCurrentInvoice() {
    const container = this.elements.currentInvoiceDetails;
    if (!container) return;
    if (!this.currentInvoice) { container.innerHTML = '<p class="empty">لا توجد فاتورة حالية.</p>'; return; }
    let html = `<p><strong>المشتري:</strong> ${this.escapeHtml(this.currentInvoice.buyerName)}</p><p><strong>التاريخ:</strong> ${this.formatDate(this.currentInvoice.date)}</p><table class="invoice-table"><thead><tr><th>المنتج</th><th>الكمية</th><th>الإجمالي</th><th></th></tr></thead><tbody>`;
    this.currentInvoice.productsSold.forEach((item, idx) => {
      html += `<tr><td>${this.escapeHtml(item.productName)}</td><td>${this.ensureNumber(item.quantity)}</td><td>${this.ensureNumber(item.amount).toFixed(2)}</td><td><button class="remove-invoice-item" data-index="${idx}">إزالة</button></td></tr>`;
    });
    html += `</tbody><tfoot><tr><td colspan="2"><strong>الإجمالي</strong></td><td>${this.ensureNumber(this.currentInvoice.totalAmount).toFixed(2)}</td><td></td></tr></tfoot></table>`;
    container.innerHTML = html;
    container.querySelectorAll('.remove-invoice-item').forEach(btn => btn.addEventListener('click', () => this.removeFromCurrentInvoice(parseInt(btn.dataset.index))));
  }
  removeFromCurrentInvoice(index) { if (this.currentInvoice) { const removed = this.currentInvoice.productsSold.splice(index, 1)[0]; this.currentInvoice.totalAmount -= removed.amount; this.displayCurrentInvoice(); } }
  cancelCurrentInvoice() { if (this.currentInvoice && confirm('إلغاء الفاتورة الحالية؟')) { this.currentInvoice = null; this.displayCurrentInvoice(); this.stopBarcodeScanner(); } }
  finalizeInvoice() {
    if (!this.currentInvoice || this.currentInvoice.productsSold.length === 0) return alert('الفاتورة فارغة');
    const invCopy = { ...this.currentInvoice, id: this.nextInvoiceId++ };
    this.invoices.push(invCopy);
    this.addJournalEntry(`فاتورة بيع رقم ${invCopy.id} - ${invCopy.buyerName}`, ACCOUNTS.CUSTOMERS, ACCOUNTS.SALES, invCopy.totalAmount);
    const totalCost = invCopy.productsSold.reduce((sum, item) => sum + this.ensureNumber(item.totalCost), 0);
    this.addJournalEntry(`تكلفة البضاعة المباعة للفاتورة ${invCopy.id}`, ACCOUNTS.COGS, ACCOUNTS.INVENTORY, totalCost);
    let customer = this.customers.find(c => c.name === invCopy.buyerName);
    if (customer) customer.balance += invCopy.totalAmount;
    else this.customers.push({ id: Date.now(), name: invCopy.buyerName, phone: '', balance: invCopy.totalAmount });
    this.saveData(); this.updateInvoiceSelector(); this.updateBuyerDropdown(); this.renderCustomers();
    this.currentInvoice = null; this.displayCurrentInvoice(); this.stopBarcodeScanner();
    alert('تم تحرير الفاتورة');
  }
  updateInvoiceSelector() {
    const selector = this.elements.invoiceSelector;
    if (!selector) return;
    selector.innerHTML = '<option value="" selected disabled>اختر فاتورة</option>';
    this.invoices.forEach((inv, idx) => { const opt = document.createElement('option'); opt.value = idx; opt.textContent = `فاتورة #${inv.id} - ${inv.buyerName} (${this.formatDate(inv.date)})`; selector.appendChild(opt); });
  }
  displaySelectedInvoice() {
    const idx = parseInt(this.elements.invoiceSelector.value);
    if (isNaN(idx)) { if (this.elements.invoiceDetails) this.elements.invoiceDetails.innerHTML = ''; return; }
    const inv = this.invoices[idx];
    if (!inv) return;
    let html = `<h3>تفاصيل الفاتورة</h3><p><strong>المشتري:</strong> ${this.escapeHtml(inv.buyerName)}</p><p><strong>التاريخ:</strong> ${this.formatDate(inv.date)}</p><table class="invoice-table"><thead><tr><th>المنتج</th><th>الكمية</th><th>الإجمالي</th></tr></thead><tbody>`;
    inv.productsSold.forEach(item => { html += `<tr><td>${this.escapeHtml(item.productName)}</td><td>${this.ensureNumber(item.quantity)}</td><td>${this.ensureNumber(item.amount).toFixed(2)}</td></tr>`; });
    html += `</tbody><tfoot><tr><td colspan="2"><strong>الإجمالي الكلي</strong></td><td>${this.ensureNumber(inv.totalAmount).toFixed(2)}</td></tr></tfoot></table>`;
    if (this.elements.invoiceDetails) this.elements.invoiceDetails.innerHTML = html;
  }
  deleteSelectedInvoice() {
    const idx = parseInt(this.elements.invoiceSelector.value);
    if (isNaN(idx)) return alert('اختر فاتورة أولاً');
    if (confirm('حذف الفاتورة؟')) { this.invoices.splice(idx, 1); this.saveData(); this.updateInvoiceSelector(); if (this.elements.invoiceDetails) this.elements.invoiceDetails.innerHTML = ''; }
  }
  printSelectedInvoice() {
    const idx = parseInt(this.elements.invoiceSelector.value);
    if (isNaN(idx)) return alert('اختر فاتورة');
    const inv = this.invoices[idx];
    const win = window.open('', '_blank');
    win.document.write(`<html dir="rtl"><head><title>فاتورة #${inv.id}</title><style>body{font-family:'Cairo',sans-serif;padding:20px;}table{width:100%;border-collapse:collapse;margin:20px 0;}th,td{border:1px solid #333;padding:8px;text-align:center;}th{background:#f2f2f2;}</style></head><body><h2 style="text-align:center;">فاتورة بيع</h2><p><strong>اسم المشتري:</strong> ${this.escapeHtml(inv.buyerName)}</p><p><strong>التاريخ:</strong> ${this.formatDate(inv.date)}</p><table><thead><tr><th>المنتج</th><th>الكمية</th><th>الإجمالي</th></tr></thead><tbody>`);
    inv.productsSold.forEach(item => { win.document.write(`<tr><td>${this.escapeHtml(item.productName)}</td><td>${this.ensureNumber(item.quantity)}</td><td>${this.ensureNumber(item.amount).toFixed(2)}</td></tr>`); });
    win.document.write(`</tbody><tfoot><tr><td colspan="2">الإجمالي</td><td>${this.ensureNumber(inv.totalAmount).toFixed(2)}</td></tr></tfoot></table><script>window.onload = function() { window.print(); window.close(); }<\/script></body></html>`);
    win.document.close();
  }

  // ========== القيود اليومية ==========
  showJournalEntries() {
    const container = this.elements.journalEntriesList;
    if (!container) return;
    if (this.journalEntries.length === 0) { container.innerHTML = '<p class="empty">لا توجد قيود بعد.</p>'; return; }
    let html = '<div class="journal-entries">';
    this.journalEntries.forEach(e => {
      html += `<div class="journal-entry"><h4>${this.escapeHtml(e.description)}</h4><p>التاريخ: ${this.formatDate(e.date)}</p><p>مدين: ${e.debitAccount} - دائن: ${e.creditAccount} - المبلغ: ${this.ensureNumber(e.amount).toFixed(2)}</p></div>`;
    });
    html += '</div>';
    container.innerHTML = html;
  }

  // ========== التقارير المالية ==========
  showIncomeStatement() {
    let rev = 0, cogs = 0;
    this.invoices.forEach(inv => { rev += this.ensureNumber(inv.totalAmount); cogs += inv.productsSold.reduce((s,i)=>s+this.ensureNumber(i.totalCost),0); });
    const gp = rev - cogs;
    this.elements.financialReport.innerHTML = `<div class="financial-report"><h3>قائمة الدخل</h3><table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody><tr><td>إجمالي المبيعات</td><td>${this.ensureNumber(rev).toFixed(2)}</td></tr><tr><td>تكلفة البضاعة المباعة</td><td>${this.ensureNumber(cogs).toFixed(2)}</td></tr><tr><td><strong>إجمالي الربح</strong></td><td><strong>${this.ensureNumber(gp).toFixed(2)}</strong></td></tr><tr><td><strong>صافي الربح</strong></td><td><strong>${this.ensureNumber(gp).toFixed(2)}</strong></td></tr></tbody></table></div>`;
  }
  showBalanceSheet() {
    const invVal = this.products.reduce((s,p)=>s+(this.ensureNumber(p.cost)*this.ensureNumber(p.stock)),0);
    const rec = this.customers.reduce((s,c)=>s+(this.ensureNumber(c.balance)>0?this.ensureNumber(c.balance):0),0);
    const pay = this.suppliers.reduce((s,sup)=>s+(this.ensureNumber(sup.balance)<0?-this.ensureNumber(sup.balance):0),0);
    const assets = this.ensureNumber(this.cashBalance)+invVal+rec;
    const equity = assets-pay;
    this.elements.financialReport.innerHTML = `<div class="financial-report"><h3>الميزانية العمومية</h3><h4>الأصول</h4><table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody><tr><td>النقدية</td><td>${this.ensureNumber(this.cashBalance).toFixed(2)}</td></tr><tr><td>المخزون</td><td>${invVal.toFixed(2)}</td></tr><tr><td>حسابات العملاء</td><td>${rec.toFixed(2)}</td></tr><tr><td><strong>إجمالي الأصول</strong></td><td><strong>${assets.toFixed(2)}</strong></td></tr></tbody></table><h4>الخصوم وحقوق الملكية</h4><table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody><tr><td>حسابات الموردين</td><td>${pay.toFixed(2)}</td></tr><tr><td>حقوق الملكية</td><td>${equity.toFixed(2)}</td></tr><tr><td><strong>الإجمالي</strong></td><td><strong>${(pay+equity).toFixed(2)}</strong></td></tr></tbody></table></div>`;
  }
  showProfitMarginReport() {
    if (this.products.length === 0) { this.elements.financialReport.innerHTML = '<div class="financial-report"><p class="empty">لا توجد منتجات.</p></div>'; return; }
    let html = '<div class="financial-report"><h3>تقرير هامش الربح لكل منتج</h3><table><thead><tr><th>المنتج</th><th>سعر الشراء</th><th>سعر البيع</th><th>الهامش المطلق</th><th>نسبة الهامش</th></tr></thead><tbody>';
    this.products.forEach(p => { const cost = this.ensureNumber(p.cost), price = this.ensureNumber(p.price), margin = price - cost, percent = cost > 0 ? (margin / cost) * 100 : 0; html += `<tr><td>${this.escapeHtml(p.name)}</td><td>${cost.toFixed(2)}</td><td>${price.toFixed(2)}</td><td>${margin.toFixed(2)}</td><td>${percent.toFixed(2)}%</td></tr>`; });
    html += '</tbody></table></div>';
    this.elements.financialReport.innerHTML = html;
  }
  showProductSalesReport() {
    const data = {};
    this.invoices.forEach(inv => { inv.productsSold.forEach(item => { if (!data[item.productId]) { const prod = this.products.find(p=>p.id===item.productId); data[item.productId] = { name: prod?prod.name:(item.productName||'منتج محذوف'), qty:0, total:0, stock: prod?prod.stock:0 }; } data[item.productId].qty += item.quantity; data[item.productId].total += item.amount; }); });
    if (Object.keys(data).length === 0) { this.elements.financialReport.innerHTML = '<div class="financial-report"><p class="empty">لا توجد مبيعات مسجلة بعد.</p></div>'; return; }
    let grand = 0; Object.values(data).forEach(d=>grand+=d.total);
    let html = `<div class="financial-report"><h3>📊 تقرير المبيعات حسب المنتج</h3><table><thead><tr><th>اسم المنتج</th><th>الكمية المباعة</th><th>الكمية المتبقية</th><th>إجمالي المبيعات</th></tr></thead><tbody>`;
    for (const id in data) { const d = data[id]; html += `<tr><td>${this.escapeHtml(d.name)}</td><td>${d.qty}</td><td>${this.ensureNumber(d.stock)}</td><td>${this.ensureNumber(d.total).toFixed(2)}</td></tr>`; }
    html += `</tbody><tfoot><tr><td colspan="3"><strong>إجمالي المبيعات الكلي</strong></td><td><strong>${grand.toFixed(2)}</strong></td></tr></tfoot></table></div>`;
    this.elements.financialReport.innerHTML = html;
  }

  // ========== بيانات العملاء والموردين التفصيلية ==========
  showCustomerStatement(customerId) {
    const customer = this.customers.find(c => c.id === customerId);
    if (!customer) return;
    const invoices = this.invoices.filter(inv => inv.buyerName === customer.name);
    if (invoices.length === 0) { alert(`لا توجد فواتير للعميل ${customer.name}`); return; }
    let html = `<div class="statement-details"><h3>📄 بيان العميل: ${this.escapeHtml(customer.name)}</h3><p><strong>الهاتف:</strong> ${this.escapeHtml(customer.phone || 'غير مسجل')}</p><p><strong>الرصيد الحالي:</strong> ${this.ensureNumber(customer.balance).toFixed(2)}</p><table class="statement-table"><thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>المنتجات (الكمية × السعر)</th><th>إجمالي الفاتورة</th><th>الرصيد التراكمي</th></tr></thead><tbody>`;
    let bal = 0;
    const sorted = [...invoices].sort((a,b)=>new Date(a.date)-new Date(b.date));
    for (const inv of sorted) {
      const items = inv.productsSold.map(item => `${this.escapeHtml(item.productName)} (${item.quantity} × ${(item.amount/item.quantity).toFixed(2)})`).join('<br>');
      bal += inv.totalAmount;
      html += `<tr><td>${this.formatDate(inv.date)}</td><td>#${inv.id}</td><td>${items}</td><td>${this.ensureNumber(inv.totalAmount).toFixed(2)}</td><td>${bal.toFixed(2)}</td></tr>`;
    }
    html += `</tbody></table><div class="statement-actions"><button class="print-statement-btn" data-type="customer" data-id="${customer.id}">🖨️ طباعة البيان</button><button class="close-statement-btn">إغلاق</button></div></div>`;
    this.showStatementModal(html, 'customer', customer.id);
  }
  showSupplierStatement(supplierId) {
    const supplier = this.suppliers.find(s => s.id === supplierId);
    if (!supplier) return;
    const entries = this.journalEntries.filter(e => e.description.includes(supplier.name));
    if (entries.length === 0) { alert(`لا توجد حركات للمورد ${supplier.name}`); return; }
    let html = `<div class="statement-details"><h3>📄 بيان المورد: ${this.escapeHtml(supplier.name)}</h3><p><strong>الهاتف:</strong> ${this.escapeHtml(supplier.phone || 'غير مسجل')}</p><p><strong>الرصيد الحالي:</strong> ${this.ensureNumber(supplier.balance).toFixed(2)}</p><table class="statement-table"><thead><tr><th>التاريخ</th><th>البيان</th><th>النوع</th><th>المبلغ</th><th>الرصيد التراكمي</th></tr></thead><tbody>`;
    let bal = 0;
    const sorted = [...entries].sort((a,b)=>new Date(a.date)-new Date(b.date));
    for (const e of sorted) {
      let type = '', amount = e.amount;
      if (e.creditAccount === ACCOUNTS.SUPPLIERS) { type = 'شراء'; bal += amount; }
      else if (e.debitAccount === ACCOUNTS.SUPPLIERS) { type = 'سداد'; bal -= amount; }
      else continue;
      html += `<tr><td>${this.formatDate(e.date)}</td><td>${this.escapeHtml(e.description)}</td><td>${type}</td><td>${amount.toFixed(2)}</td><td>${bal.toFixed(2)}</td></tr>`;
    }
    html += `</tbody></table><div class="statement-actions"><button class="print-statement-btn" data-type="supplier" data-id="${supplier.id}">🖨️ طباعة البيان</button><button class="close-statement-btn">إغلاق</button></div></div>`;
    this.showStatementModal(html, 'supplier', supplier.id);
  }
  showStatementModal(html, type, id) {
    const modal = document.createElement('div');
    modal.id = 'statementModal';
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `<div class="modal-content" style="width: 90%; max-width: 1000px; max-height: 80vh; overflow-y: auto;">${html}</div>`;
    document.body.appendChild(modal);
    const printBtn = modal.querySelector('.print-statement-btn');
    const closeBtn = modal.querySelector('.close-statement-btn');
    if (printBtn) printBtn.addEventListener('click', () => this.printStatement(type, id));
    if (closeBtn) closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }
  printStatement(type, id) {
    const modal = document.getElementById('statementModal');
    if (!modal) return;
    const content = modal.querySelector('.modal-content');
    if (!content) return;
    const win = window.open('', '_blank');
    win.document.write(`<html dir="rtl"><head><title>بيان ${type === 'customer' ? 'عميل' : 'مورد'}</title><style>body{font-family:'Cairo',sans-serif;padding:20px;direction:rtl;}.statement-details{max-width:100%;margin:auto;}table{width:100%;border-collapse:collapse;margin:20px 0;}th,td{border:1px solid #333;padding:8px;text-align:center;}th{background:#f2f2f2;}.statement-actions{display:none;}</style></head><body>${content.cloneNode(true).innerHTML}<script>window.onload = function() { window.print(); window.close(); }<\/script></body></html>`);
    win.document.close();
  }

  // ========== الرسوم البيانية ==========
  loadChartSettings() {
    const saved = localStorage.getItem('chartSettings');
    return saved ? JSON.parse(saved) : {
      chartType: 'line', periodType: 'monthly', productSelect: 'all',
      comparisonMode: 'single', compareProducts: [], dateFrom: '', dateTo: '',
      trendLine: false, trendWindow: 3, yearCompareMonth: 'all'
    };
  }
  saveChartSettings() {
    const settings = {
      chartType: this.elements.chartType.value,
      periodType: this.elements.periodType.value,
      productSelect: this.elements.productSelect.value,
      comparisonMode: this.elements.comparisonMode.value,
      compareProducts: Array.from(this.elements.compareProductsList.selectedOptions).map(o => o.value),
      dateFrom: this.elements.dateFrom.value,
      dateTo: this.elements.dateTo.value,
      trendLine: this.elements.trendLineToggle.checked,
      trendWindow: parseInt(this.elements.trendWindow.value) || 3,
      yearCompareMonth: this.elements.compareYearMonth ? this.elements.compareYearMonth.value : 'all'
    };
    localStorage.setItem('chartSettings', JSON.stringify(settings));
  }
  restoreChartControls() {
    const s = this.chartSettings;
    if (!this.elements.chartType) return;
    this.elements.chartType.value = s.chartType;
    this.elements.periodType.value = s.periodType;
    this.elements.productSelect.value = s.productSelect;
    this.elements.comparisonMode.value = s.comparisonMode;
    if (s.dateFrom) this.elements.dateFrom.value = s.dateFrom;
    if (s.dateTo) this.elements.dateTo.value = s.dateTo;
    this.elements.trendLineToggle.checked = s.trendLine;
    this.elements.trendWindow.value = s.trendWindow;
    if (this.elements.compareYearMonth) this.elements.compareYearMonth.value = s.yearCompareMonth;
    if (s.comparisonMode === 'compare' && s.compareProducts.length > 0) {
      Array.from(this.elements.compareProductsList.options).forEach(opt => {
        opt.selected = s.compareProducts.includes(opt.value);
      });
    }
    this.updateComparisonVisibility();
  }
  calculateMovingAverage(data, windowSize = 3) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const subset = data.slice(start, i + 1);
      const avg = subset.reduce((a, b) => a + b, 0) / subset.length;
      result.push(avg);
    }
    return result;
  }
  generateYearCompareData(month) {
    const salesByYear = {};
    this.invoices.forEach(inv => {
      const d = new Date(inv.date);
      const year = d.getFullYear();
      const invMonth = d.getMonth() + 1;
      if (month !== 'all' && invMonth !== parseInt(month)) return;
      inv.productsSold.forEach(item => {
        if (!salesByYear[year]) salesByYear[year] = 0;
        salesByYear[year] += item.amount;
      });
    });
    const years = Object.keys(salesByYear).sort();
    const datasets = [{
      label: `مبيعات ${month === 'all' ? 'كل السنة' : 'شهر ' + month}`,
      data: years.map(y => salesByYear[y]),
      backgroundColor: CHART_COLORS.slice(0, years.length),
      borderColor: CHART_COLORS.slice(0, years.length)
    }];
    return { labels: years, datasets };
  }
  calculateChartStats(chartData) {
    if (!chartData || !chartData.labels || chartData.labels.length === 0) return null;
    let total = 0, maxVal = 0, maxPeriod = '';
    chartData.datasets.forEach(ds => {
      ds.data.forEach((val, idx) => {
        total += val;
        if (val > maxVal) { maxVal = val; maxPeriod = chartData.labels[idx]; }
      });
    });
    const avgPerPeriod = total / chartData.labels.length;
    return { total, avg: avgPerPeriod, max: maxVal, maxPeriod };
  }
  calculateTopBottomProducts() {
    const productSales = {};
    this.products.forEach(p => productSales[p.id] = 0);
    this.invoices.forEach(inv => {
      inv.productsSold.forEach(item => {
        if (productSales[item.productId] !== undefined) productSales[item.productId] += item.amount;
      });
    });
    const sorted = Object.entries(productSales)
      .map(([id, amount]) => ({ id: parseInt(id), amount }))
      .sort((a, b) => b.amount - a.amount);
    const top = sorted.slice(0, 5);
    const bottom = sorted.slice(-5).reverse();
    return { top, bottom };
  }
  renderStats(stats) {
    const container = this.elements.chartStatsContainer;
    if (!container) return;
    if (!stats) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div class="stat-item"><div>💰 إجمالي المبيعات</div><div class="stat-value">${stats.total.toFixed(2)}</div></div>
      <div class="stat-item"><div>📊 متوسط الفترة</div><div class="stat-value">${stats.avg.toFixed(2)}</div></div>
      <div class="stat-item"><div>🏆 أعلى فترة</div><div class="stat-value">${stats.max.toFixed(2)}</div><small>${stats.maxPeriod}</small></div>
    `;
  }
  renderTopBottom() {
    const { top, bottom } = this.calculateTopBottomProducts();
    const topContainer = document.querySelector('.top-products ul');
    const bottomContainer = document.querySelector('.bottom-products ul');
    if (!topContainer || !bottomContainer) return;
    topContainer.innerHTML = '';
    bottomContainer.innerHTML = '';
    top.forEach(p => {
      const prod = this.products.find(x => x.id === p.id);
      if (prod) topContainer.innerHTML += `<li>${this.escapeHtml(prod.name)}: ${p.amount.toFixed(2)}</li>`;
    });
    bottom.forEach(p => {
      const prod = this.products.find(x => x.id === p.id);
      if (prod) bottomContainer.innerHTML += `<li>${this.escapeHtml(prod.name)}: ${p.amount.toFixed(2)}</li>`;
    });
  }
  renderChartDataTable(chartData) {
    const tableHead = document.querySelector('#chartDataTable thead');
    const tableBody = document.querySelector('#chartDataTable tbody');
    if (!tableHead || !tableBody) return;
    if (!chartData || !chartData.labels) { tableHead.innerHTML = ''; tableBody.innerHTML = ''; return; }
    let headHtml = '<tr><th>الفترة</th>';
    chartData.datasets.forEach(ds => headHtml += `<th>${ds.label}</th>`);
    headHtml += '</tr>';
    tableHead.innerHTML = headHtml;
    let bodyHtml = '';
    chartData.labels.forEach((label, i) => {
      bodyHtml += `<tr><td>${label}</td>`;
      chartData.datasets.forEach(ds => bodyHtml += `<td>${(ds.data[i] || 0).toFixed(2)}</td>`);
      bodyHtml += '</tr>';
    });
    tableBody.innerHTML = bodyHtml;
  }
  downloadChart() {
    const canvas = document.getElementById('salesChart');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'مبيعات.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }
  refreshChart() {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    this.populateProductSelects();
    this.setDefaultDateRange();
    this.renderChart();
  }
  updateComparisonVisibility() {
    const mode = this.elements.comparisonMode.value;
    document.getElementById('compareProductsGroup').style.display = mode === 'compare' ? 'block' : 'none';
    document.getElementById('yearCompareGroup').style.display = mode === 'yearCompare' ? 'block' : 'none';
    document.getElementById('trendWindowGroup').style.display = this.elements.trendLineToggle.checked ? 'block' : 'none';
  }
  populateProductSelects() {
    const productSelect = this.elements.productSelect;
    const compareSelect = this.elements.compareProductsList;
    if (!productSelect || !compareSelect) return;
    productSelect.innerHTML = '<option value="all">كل المنتجات</option>';
    compareSelect.innerHTML = '';
    this.products.forEach(p => {
      const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name; productSelect.appendChild(opt);
      const opt2 = document.createElement('option'); opt2.value = p.id; opt2.textContent = p.name; compareSelect.appendChild(opt2);
    });
  }
  setDefaultDateRange() {
    if (this.invoices.length === 0) return;
    const dates = this.invoices.map(inv => new Date(inv.date)).filter(d => !isNaN(d));
    if (dates.length === 0) return;
    const min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates));
    if (this.elements.dateFrom && !this.elements.dateFrom.value) this.elements.dateFrom.value = min.toISOString().split('T')[0];
    if (this.elements.dateTo && !this.elements.dateTo.value) this.elements.dateTo.value = max.toISOString().split('T')[0];
  }
  generateChartData(periodType, productIds, comparisonMode, dateFrom, dateTo) {
    const salesByPeriod = {};
    const from = dateFrom ? new Date(dateFrom) : null, to = dateTo ? new Date(dateTo) : null;
    const getKey = (dateStr, type) => {
      const d = new Date(dateStr);
      const y = d.getFullYear(), m = d.getMonth()+1, day = d.getDate(), week = Math.ceil(day/7);
      switch(type) {
        case 'daily': return `${y}-${m}-${day}`;
        case 'weekly': return `${y}-أسبوع ${week}`;
        case 'monthly': return `${y}-${m}`;
        case 'yearly': return `${y}`;
        default: return `${y}-${m}-${day}`;
      }
    };
    this.invoices.forEach(inv => {
      const invDate = new Date(inv.date);
      if ((from && invDate < from) || (to && invDate > to)) return;
      const period = getKey(inv.date, periodType);
      inv.productsSold.forEach(item => {
        if (productIds === 'all' || (Array.isArray(productIds) && productIds.includes(item.productId))) {
          if (!salesByPeriod[period]) salesByPeriod[period] = {};
          if (!salesByPeriod[period][item.productId]) salesByPeriod[period][item.productId] = 0;
          salesByPeriod[period][item.productId] += item.amount;
        }
      });
    });
    const labels = Object.keys(salesByPeriod).sort();
    if (comparisonMode === 'single') {
      const pid = productIds === 'all' ? 'all' : (Array.isArray(productIds) ? productIds[0] : productIds);
      const data = labels.map(p => pid === 'all' ? Object.values(salesByPeriod[p]).reduce((a,b)=>a+b,0) : (salesByPeriod[p][pid] || 0));
      const label = pid === 'all' ? 'إجمالي المبيعات' : (this.products.find(p=>p.id==pid)?.name || 'منتج');
      return { labels, datasets: [{ label, data }] };
    } else {
      const productList = productIds === 'all' ? this.products.map(p=>p.id) : productIds;
      const datasets = [];
      productList.forEach(pid => {
        const name = this.products.find(p=>p.id==pid)?.name || 'منتج غير معروف';
        const data = labels.map(p => salesByPeriod[p]?.[pid] || 0);
        datasets.push({ label: name, data });
      });
      return { labels, datasets };
    }
  }
  renderChart() {
    this.saveChartSettings();
    const chartType = this.elements.chartType.value;
    const periodType = this.elements.periodType.value;
    const compMode = this.elements.comparisonMode.value;
    const dateFrom = this.elements.dateFrom.value, dateTo = this.elements.dateTo.value;
    const trendActive = this.elements.trendLineToggle.checked;
    const trendWindow = parseInt(this.elements.trendWindow.value) || 3;
    let chartData;
    if (compMode === 'yearCompare') {
      chartData = this.generateYearCompareData(this.elements.compareYearMonth.value);
    } else {
      let productIds;
      if (compMode === 'single') {
        productIds = this.elements.productSelect.value === 'all' ? 'all' : [parseInt(this.elements.productSelect.value)];
      } else {
        productIds = Array.from(this.elements.compareProductsList.selectedOptions).map(opt => parseInt(opt.value));
        if (productIds.length === 0) { alert('اختر منتجاً واحداً على الأقل'); return; }
      }
      chartData = this.generateChartData(periodType, productIds, compMode, dateFrom, dateTo);
    }
    if (chartData.labels.length === 0) { alert('لا توجد بيانات في هذه الفترة'); this.clearChartExtras(); return; }
    chartData.datasets.forEach((ds, i) => {
      if (!ds.backgroundColor) {
        const color = CHART_COLORS[i % CHART_COLORS.length];
        ds.backgroundColor = chartType === 'line' ? 'transparent' : color;
        ds.borderColor = color;
      }
    });
    if (trendActive && (compMode === 'single' || compMode === 'compare') && chartType !== 'pie' && chartType !== 'stacked') {
      chartData.datasets.forEach(ds => {
        if (ds.data.length >= trendWindow) {
          chartData.datasets.push({
            label: ds.label + ' (اتجاه)',
            data: this.calculateMovingAverage(ds.data, trendWindow),
            borderColor: ds.borderColor, backgroundColor: 'transparent',
            borderDash: [5, 5], pointRadius: 0, fill: false
          });
        }
      });
    }
    if (this.chart) this.chart.destroy();
    const ctx = document.getElementById('salesChart').getContext('2d');
    const isStacked = chartType === 'stacked';
    this.chart = new Chart(ctx, {
      type: isStacked ? 'bar' : chartType,
      data: chartData,
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(2)}` } } },
        scales: (isStacked || chartType !== 'pie') ? { x: { stacked: isStacked }, y: { stacked: isStacked, beginAtZero: true, title: { display: true, text: 'المبيعات (ج.م)' } } } : {}
      }
    });
    const stats = this.calculateChartStats(chartData);
    this.renderStats(stats);
    this.renderTopBottom();
    this.renderChartDataTable(chartData);
  }
  clearChartExtras() {
    if (this.elements.chartStatsContainer) this.elements.chartStatsContainer.innerHTML = '';
    const topUl = document.querySelector('.top-products ul');
    const bottomUl = document.querySelector('.bottom-products ul');
    if (topUl) topUl.innerHTML = '';
    if (bottomUl) bottomUl.innerHTML = '';
    const tHead = document.querySelector('#chartDataTable thead');
    const tBody = document.querySelector('#chartDataTable tbody');
    if (tHead) tHead.innerHTML = '';
    if (tBody) tBody.innerHTML = '';
  }

  // ========== تصدير/استيراد ==========
  async exportToExcel() {
    const reportDiv = this.elements.financialReport;
    if (!reportDiv || !reportDiv.innerHTML.trim()) { alert('لا يوجد تقرير لتصديره'); return; }
    const content = reportDiv.cloneNode(true);
    content.querySelectorAll('button').forEach(btn => btn.remove());
    const tables = content.querySelectorAll('table');
    if (tables.length === 0) { alert('لا توجد بيانات جدولية'); return; }
    const wb = XLSX.utils.book_new();
    tables.forEach((t, i) => { const sheet = XLSX.utils.table_to_sheet(t); XLSX.utils.book_append_sheet(wb, sheet, `تقرير_${i+1}`); });
    XLSX.writeFile(wb, `تقرير_${new Date().toLocaleString('ar-EG')}.xlsx`);
  }
  async exportToPDF() {
    const reportDiv = this.elements.financialReport;
    if (!reportDiv || !reportDiv.innerHTML.trim()) { alert('لا يوجد تقرير لتصديره'); return; }
    const printCont = document.createElement('div');
    printCont.style.position = 'absolute'; printCont.style.top = '-10000px'; printCont.style.left = '-10000px';
    printCont.style.width = '800px'; printCont.style.background = 'white'; printCont.style.padding = '20px';
    printCont.style.fontFamily = "'Cairo', sans-serif"; printCont.style.direction = 'rtl';
    printCont.innerHTML = reportDiv.cloneNode(true).innerHTML;
    document.body.appendChild(printCont);
    try {
      const canvas = await html2canvas(printCont, { scale: 2, useCORS: true, logging: false });
      const imgData = canvas.toDataURL('image/png');
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgW = 190, pageH = 297;
      const imgH = (canvas.height * imgW) / canvas.width;
      let hLeft = imgH, pos = 0;
      pdf.addImage(imgData, 'PNG', 10, pos, imgW, imgH);
      hLeft -= pageH;
      while (hLeft > 0) {
        pos = hLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 10, pos, imgW, imgH);
        hLeft -= pageH;
      }
      pdf.save(`تقرير_${new Date().toLocaleString('ar-EG')}.pdf`);
    } catch(e) { console.error(e); alert('خطأ في PDF'); }
    finally { document.body.removeChild(printCont); }
  }
  exportToJSON() {
    const data = { version: DATA_VERSION, categories: this.categories, products: this.products, customers: this.customers, suppliers: this.suppliers, invoices: this.invoices, journalEntries: this.journalEntries, cashBalance: this.cashBalance, nextProductId: this.nextProductId, nextInvoiceId: this.nextInvoiceId, nextJournalId: this.nextJournalId, sectionStates: this.sectionStates };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'بيانات_المخزون.json'; a.click();
    URL.revokeObjectURL(url);
  }
  importFromJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.version !== DATA_VERSION && !confirm('إصدار قديم، استمر؟')) return;
        this.categories = data.categories || [];
        this.products = data.products || [];
        this.customers = data.customers || [];
        this.suppliers = data.suppliers || [];
        this.invoices = data.invoices || [];
        this.journalEntries = data.journalEntries || [];
        this.cashBalance = data.cashBalance ?? 0;
        this.nextProductId = data.nextProductId ?? 1;
        this.nextInvoiceId = data.nextInvoiceId ?? 1;
        this.nextJournalId = data.nextJournalId ?? 1;
        if (data.sectionStates) this.sectionStates = { ...this.sectionStates, ...data.sectionStates };
        this.normalizeData(); this.saveData(); this.renderAll();
        alert('تم استيراد البيانات بنجاح');
      } catch(err) { alert('خطأ: ' + err.message); }
    };
    reader.readAsText(file);
  }
  resetData() {
    if (confirm('حذف جميع البيانات نهائياً؟')) { localStorage.removeItem('inventoryAppData'); this.resetToDefaults(); this.saveData(); this.renderAll(); alert('تم إعادة ضبط البيانات'); }
  }

  // ========== إدارة المستخدمين (للأدمن) ==========
  addUser() {
    const email = this.elements.newUserEmail.value.trim();
    const password = this.elements.newUserPassword.value;
    if (!email || !password) return alert('أدخل البريد وكلمة المرور');
    if (addUserByAdmin(email, password)) {
      this.elements.newUserEmail.value = '';
      this.elements.newUserPassword.value = '';
      this.renderUsersList();
    } else {
      alert('البريد موجود بالفعل');
    }
  }
  deleteUser(email) {
    if (confirm(`حذف المستخدم ${email}؟`)) {
      deleteUserByAdmin(email);
      this.renderUsersList();
    }
  }
  renderUsersList() {
    const container = this.elements.usersList;
    if (!container) return;
    const users = getUsers().filter(u => u.role !== 'admin');
    let html = '';
    users.forEach(u => {
      html += `<div class="user-item"><span>${this.escapeHtml(u.email)} (موظف)</span><button class="delete-btn small-btn" data-email="${this.escapeHtml(u.email)}">🗑 حذف</button></div>`;
    });
    container.innerHTML = html || '<p class="empty">لا يوجد مستخدمون</p>';
    container.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this.deleteUser(btn.dataset.email));
    });
  }

  // ========== إعدادات الحساب ==========
  changeEmail() {
    const newEmail = this.elements.newEmailInput.value.trim();
    if (!newEmail) {
      this.elements.emailChangeMsg.innerHTML = '<span style="color:red;">أدخل بريداً إلكترونياً صحيحاً</span>';
      return;
    }
    const users = getUsers();
    if (users.some(u => u.email === newEmail && u.email !== this.currentUser.email)) {
      this.elements.emailChangeMsg.innerHTML = '<span style="color:red;">البريد الإلكتروني مستخدم بالفعل</span>';
      return;
    }
    const userIndex = users.findIndex(u => u.email === this.currentUser.email);
    if (userIndex !== -1) {
      users[userIndex].email = newEmail;
      saveUsers(users);
    }
    const sessionData = { email: newEmail, role: this.currentUser.role };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    this.currentUser.email = newEmail;
    document.getElementById('currentUserDisplay').textContent = `${newEmail} (${this.currentUser.role === 'admin' ? 'مدير' : 'موظف'})`;
    this.elements.emailChangeMsg.innerHTML = '<span style="color:green;">✅ تم تغيير البريد بنجاح</span>';
    this.elements.newEmailInput.value = '';
  }

  changePassword() {
    const oldPass = this.elements.oldPasswordInput.value;
    const newPass = this.elements.newPasswordInput.value;
    if (!oldPass || !newPass) {
      this.elements.passwordChangeMsg.innerHTML = '<span style="color:red;">جميع الحقول مطلوبة</span>';
      return;
    }
    const users = getUsers();
    const user = users.find(u => u.email === this.currentUser.email);
    if (!user || user.passwordHash !== simpleHash(oldPass)) {
      this.elements.passwordChangeMsg.innerHTML = '<span style="color:red;">كلمة المرور الحالية غير صحيحة</span>';
      return;
    }
    user.passwordHash = simpleHash(newPass);
    saveUsers(users);
    this.elements.passwordChangeMsg.innerHTML = '<span style="color:green;">✅ تم تغيير كلمة المرور بنجاح</span>';
    this.elements.oldPasswordInput.value = '';
    this.elements.newPasswordInput.value = '';
  }

  // ========== الطي والتبويب ==========
  toggleSection(sectionId) {
    const content = document.getElementById(`${sectionId}-content`);
    const btn = document.querySelector(`.toggle-section-btn[data-section="${sectionId}"]`);
    if (!content || !btn) return;
    this.sectionStates[sectionId] = !this.sectionStates[sectionId];
    if (this.sectionStates[sectionId]) { content.classList.add('collapsed'); btn.innerHTML = '🔼 إظهار'; }
    else { content.classList.remove('collapsed'); btn.innerHTML = '🔽 إخفاء'; }
    this.saveData();
  }
  showPartyTab(tab) {
    const cust = document.getElementById('customersTab'), supp = document.getElementById('suppliersTab');
    const btns = document.querySelectorAll('.tab-btn');
    if (!cust || !supp) return;
    if (tab === 'customers') { cust.classList.add('active'); supp.classList.remove('active'); btns[0].classList.add('active'); btns[1].classList.remove('active'); }
    else { cust.classList.remove('active'); supp.classList.add('active'); btns[0].classList.remove('active'); btns[1].classList.add('active'); }
  }

  // ========== الكاميرا (البيع) ==========
  startBarcodeScanner() {
    if (this.isScanning) return;
    if (typeof Html5Qrcode === 'undefined') { alert('مكتبة الباركود غير متوفرة.'); return; }
    document.getElementById('scannerContainer').style.display = 'block';
    this.elements.startScannerBtn.style.display = 'none';
    this.elements.stopScannerBtn.style.display = 'inline-block';
    this.html5QrCode = new Html5Qrcode("qr-reader");
    this.html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        const now = Date.now();
        if (now - this.barcodeSaleMode.lastScanTime < this.barcodeSaleMode.scanDebounce) return;
        this.barcodeSaleMode.lastScanTime = now;
        this.processBarcodeSale(decodedText);
        if (!this.elements.continuousScanMode.checked) this.stopBarcodeScanner();
      },
      (err) => { console.log(err); }
    ).catch(err => { console.error(err); alert("تعذر الوصول إلى الكاميرا"); this.stopBarcodeScanner(); });
    this.isScanning = true;
  }
  stopBarcodeScanner() {
    if (this.html5QrCode && this.isScanning) {
      this.html5QrCode.stop().then(() => {
        document.getElementById('scannerContainer').style.display = 'none';
        this.elements.startScannerBtn.style.display = 'inline-block';
        this.elements.stopScannerBtn.style.display = 'none';
        this.isScanning = false;
      }).catch(e => console.error(e));
    }
  }

  // ========== العرض الكامل ==========
  renderAll() {
    this.renderCategories(); this.updateCategoryDropdown(); this.renderProductsByCategory();
    this.renderCustomers(); this.renderSuppliers(); this.updateBuyerDropdown(); this.updateSupplierDropdown(); this.updatePaymentSupplierDropdown(); this.updateReceivingSupplierDropdown();
    this.updateInvoiceSelector(); this.displayCurrentInvoice(); this.showJournalEntries();
    this.populateProductSelects(); this.setDefaultDateRange();
    for (const [sid, collapsed] of Object.entries(this.sectionStates)) {
      const cont = document.getElementById(`${sid}-content`);
      const btn = document.querySelector(`.toggle-section-btn[data-section="${sid}"]`);
      if (cont && btn) {
        if (collapsed) { cont.classList.add('collapsed'); btn.innerHTML = '🔼 إظهار'; }
        else { cont.classList.remove('collapsed'); btn.innerHTML = '🔽 إخفاء'; }
      }
    }
  }
  handleSearch() { this.searchText = this.elements.searchProduct.value.trim().toLowerCase(); this.renderProductsByCategory(); }
  escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, m => m==='&'?'&amp;':m==='<'?'&lt;':'>'); }

  // ========== ربط الأحداث ==========
  bindEvents() {
    this.elements = {
      categoryName: document.getElementById('categoryName'), addCategoryBtn: document.getElementById('addCategoryBtn'),
      categoriesList: document.getElementById('categoriesList'), productCategory: document.getElementById('productCategory'),
      productSupplier: document.getElementById('productSupplier'), productName: document.getElementById('productName'),
      productCost: document.getElementById('productCost'), productPrice: document.getElementById('productPrice'),
      productStock: document.getElementById('productStock'), productBarcode: document.getElementById('productBarcode'),
      addProductBtn: document.getElementById('addProductBtn'), searchProduct: document.getElementById('searchProduct'),
      lowStockSummary: document.getElementById('lowStockSummary'), productsByCategory: document.getElementById('productsByCategory'),
      customerName: document.getElementById('customerName'), customerPhone: document.getElementById('customerPhone'),
      addCustomerBtn: document.getElementById('addCustomerBtn'), customersList: document.getElementById('customersList'),
      searchCustomer: document.getElementById('searchCustomer'), supplierName: document.getElementById('supplierName'),
      supplierPhone: document.getElementById('supplierPhone'), addSupplierBtn: document.getElementById('addSupplierBtn'),
      suppliersList: document.getElementById('suppliersList'), searchSupplier: document.getElementById('searchSupplier'),
      paymentSupplier: document.getElementById('paymentSupplier'), paymentAmount: document.getElementById('paymentAmount'),
      paymentNote: document.getElementById('paymentNote'), processPaymentBtn: document.getElementById('processPaymentBtn'),
      paymentResult: document.getElementById('paymentResult'), buyerSelect: document.getElementById('buyerSelect'),
      buyerName: document.getElementById('buyerName'), createInvoiceBtn: document.getElementById('createInvoiceBtn'),
      finalizeInvoiceBtn: document.getElementById('finalizeInvoiceBtn'), cancelInvoiceBtn: document.getElementById('cancelInvoiceBtn'),
      barcodeInput: document.getElementById('barcodeInput'), addByBarcodeBtn: document.getElementById('addByBarcodeBtn'),
      currentInvoiceDetails: document.getElementById('currentInvoiceDetails'), invoiceSelector: document.getElementById('invoiceSelector'),
      deleteInvoiceBtn: document.getElementById('deleteInvoiceBtn'), printInvoiceBtn: document.getElementById('printInvoiceBtn'),
      invoiceDetails: document.getElementById('invoiceDetails'), showJournalEntriesBtn: document.getElementById('showJournalEntriesBtn'),
      journalEntriesList: document.getElementById('journalEntriesList'), incomeStatementBtn: document.getElementById('incomeStatementBtn'),
      balanceSheetBtn: document.getElementById('balanceSheetBtn'), profitMarginBtn: document.getElementById('profitMarginBtn'),
      productSalesReportBtn: document.getElementById('productSalesReportBtn'), financialReport: document.getElementById('financialReport'),
      exportJSONBtn: document.getElementById('exportJSONBtn'), importJSONFile: document.getElementById('importJSONFile'),
      resetDataBtn: document.getElementById('resetDataBtn'), openSupplierModalBtn: document.getElementById('openSupplierModalBtn'),
      supplierModal: document.getElementById('supplierModal'), modalSupplierName: document.getElementById('modalSupplierName'),
      modalSupplierPhone: document.getElementById('modalSupplierPhone'), modalAddSupplierBtn: document.getElementById('modalAddSupplierBtn'),
      modalClose: document.querySelector('#supplierModal .close'), chartType: document.getElementById('chartType'),
      periodType: document.getElementById('periodType'), productSelect: document.getElementById('productSelect'),
      comparisonMode: document.getElementById('comparisonMode'), compareProductsGroup: document.getElementById('compareProductsGroup'),
      compareProductsList: document.getElementById('compareProductsList'), dateFrom: document.getElementById('dateFrom'),
      dateTo: document.getElementById('dateTo'), resetDateRangeBtn: document.getElementById('resetDateRangeBtn'),
      generateChartBtn: document.getElementById('generateChartBtn'), exportToExcelBtn: document.getElementById('exportToExcelBtn'),
      exportToPDFBtn: document.getElementById('exportToPDFBtn'),
      startScannerBtn: document.getElementById('startScannerBtn'), stopScannerBtn: document.getElementById('stopScannerBtn'),
      quickSaleMode: document.getElementById('quickSaleMode'), continuousScanMode: document.getElementById('continuousScanMode'),
      trendLineToggle: document.getElementById('trendLineToggle'), trendWindow: document.getElementById('trendWindow'),
      downloadChartBtn: document.getElementById('downloadChartBtn'), refreshChartBtn: document.getElementById('refreshChartBtn'),
      compareYearMonth: document.getElementById('compareYearMonth'), chartStatsContainer: document.getElementById('chartStatsContainer'),
      startReceiveScannerBtn: document.getElementById('startReceiveScannerBtn'),
      stopReceiveScannerBtn: document.getElementById('stopReceiveScannerBtn'),
      confirmReceiveBtn: document.getElementById('confirmReceiveBtn'),
      cancelReceiveBtn: document.getElementById('cancelReceiveBtn'),
      receivingSupplier: document.getElementById('receivingSupplier'),
      receiveQuantity: document.getElementById('receiveQuantity'),
      receiveCost: document.getElementById('receiveCost'),
      newUserEmail: document.getElementById('newUserEmail'),
      newUserPassword: document.getElementById('newUserPassword'),
      addUserBtn: document.getElementById('addUserBtn'),
      usersList: document.getElementById('usersList'),
      newEmailInput: document.getElementById('newEmailInput'),
      changeEmailBtn: document.getElementById('changeEmailBtn'),
      emailChangeMsg: document.getElementById('emailChangeMsg'),
      oldPasswordInput: document.getElementById('oldPasswordInput'),
      newPasswordInput: document.getElementById('newPasswordInput'),
      changePasswordBtn: document.getElementById('changePasswordBtn'),
      passwordChangeMsg: document.getElementById('passwordChangeMsg'),
      fullLogoutBtn: document.getElementById('fullLogoutBtn')
    };

    this.elements.addCategoryBtn.addEventListener('click', () => this.addCategory(this.elements.categoryName.value));
    this.elements.addProductBtn.addEventListener('click', () => this.addProduct());
    this.elements.searchProduct.addEventListener('input', () => this.handleSearch());
    this.elements.addCustomerBtn.addEventListener('click', () => this.addCustomer());
    this.elements.addSupplierBtn.addEventListener('click', () => this.addSupplier());
    this.elements.searchCustomer.addEventListener('input', () => this.renderCustomers());
    this.elements.searchSupplier.addEventListener('input', () => this.renderSuppliers());
    this.elements.processPaymentBtn.addEventListener('click', () => this.processSupplierPayment());
    this.elements.createInvoiceBtn.addEventListener('click', () => this.createInvoice());
    this.elements.finalizeInvoiceBtn.addEventListener('click', () => this.finalizeInvoice());
    this.elements.cancelInvoiceBtn.addEventListener('click', () => this.cancelCurrentInvoice());
    this.elements.invoiceSelector.addEventListener('change', () => this.displaySelectedInvoice());
    this.elements.deleteInvoiceBtn.addEventListener('click', () => this.deleteSelectedInvoice());
    this.elements.printInvoiceBtn.addEventListener('click', () => this.printSelectedInvoice());
    this.elements.showJournalEntriesBtn.addEventListener('click', () => this.showJournalEntries());
    this.elements.incomeStatementBtn.addEventListener('click', () => this.showIncomeStatement());
    this.elements.balanceSheetBtn.addEventListener('click', () => this.showBalanceSheet());
    this.elements.profitMarginBtn.addEventListener('click', () => this.showProfitMarginReport());
    this.elements.productSalesReportBtn.addEventListener('click', () => this.showProductSalesReport());
    this.elements.exportJSONBtn.addEventListener('click', () => this.exportToJSON());
    this.elements.importJSONFile.addEventListener('change', (e) => this.importFromJSON(e.target.files[0]));
    this.elements.resetDataBtn.addEventListener('click', () => this.resetData());

    this.elements.addByBarcodeBtn.addEventListener('click', () => {
      const barcode = this.elements.barcodeInput.value.trim();
      if (barcode) { this.processBarcodeSale(barcode); this.elements.barcodeInput.value = ''; }
    });
    this.elements.barcodeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.elements.addByBarcodeBtn.click(); } });
    this.elements.startScannerBtn.addEventListener('click', () => this.startBarcodeScanner());
    this.elements.stopScannerBtn.addEventListener('click', () => this.stopBarcodeScanner());

    this.elements.startReceiveScannerBtn.addEventListener('click', () => this.startReceiveScanner());
    this.elements.stopReceiveScannerBtn.addEventListener('click', () => this.stopReceiveScanner());
    this.elements.confirmReceiveBtn.addEventListener('click', () => this.confirmReceive());
    this.elements.cancelReceiveBtn.addEventListener('click', () => this.cancelReceive());

    this.elements.comparisonMode.addEventListener('change', () => this.updateComparisonVisibility());
    this.elements.trendLineToggle.addEventListener('change', () => this.updateComparisonVisibility());
    this.elements.generateChartBtn.addEventListener('click', () => this.renderChart());
    this.elements.downloadChartBtn.addEventListener('click', () => this.downloadChart());
    this.elements.refreshChartBtn.addEventListener('click', () => this.refreshChart());
    this.elements.resetDateRangeBtn.addEventListener('click', () => { this.elements.dateFrom.value = ''; this.elements.dateTo.value = ''; this.setDefaultDateRange(); this.renderChart(); });
    this.elements.exportToExcelBtn.addEventListener('click', () => this.exportToExcel());
    this.elements.exportToPDFBtn.addEventListener('click', () => this.exportToPDF());

    this.elements.openSupplierModalBtn.addEventListener('click', () => this.openSupplierModal());
    this.elements.modalAddSupplierBtn.addEventListener('click', () => this.quickAddSupplier());
    if (this.elements.modalClose) this.elements.modalClose.addEventListener('click', () => this.closeSupplierModal());
    window.addEventListener('click', (e) => { if (e.target === this.elements.supplierModal) this.closeSupplierModal(); });
    document.querySelectorAll('.toggle-section-btn').forEach(btn => btn.addEventListener('click', (e) => { const sid = btn.dataset.section; if (sid) this.toggleSection(sid); }));
    const tbs = document.querySelectorAll('.tab-btn');
    if (tbs.length >= 2) { tbs[0].addEventListener('click', () => this.showPartyTab('customers')); tbs[1].addEventListener('click', () => this.showPartyTab('suppliers')); }
    this.elements.buyerSelect.addEventListener('change', () => { const id = parseInt(this.elements.buyerSelect.value); if (id) { const c = this.customers.find(c => c.id === id); if (c) this.elements.buyerName.value = c.name; } else this.elements.buyerName.value = ''; });

    this.elements.addUserBtn.addEventListener('click', () => this.addUser());

    this.elements.changeEmailBtn.addEventListener('click', () => this.changeEmail());
    this.elements.changePasswordBtn.addEventListener('click', () => this.changePassword());

    this.elements.fullLogoutBtn.addEventListener('click', () => {
      if (confirm('سيؤدي هذا إلى مسح الترخيص بالكامل والخروج من التطبيق. متابعة؟')) {
        fullLogout();
      }
    });

    ['chartType','periodType','productSelect','comparisonMode','dateFrom','dateTo','trendLineToggle','trendWindow','compareYearMonth'].forEach(id => {
      if (this.elements[id]) this.elements[id].addEventListener('change', () => this.saveChartSettings());
    });
  }

  openSupplierModal() { if (this.elements.supplierModal) this.elements.supplierModal.style.display = 'flex'; }
  closeSupplierModal() { if (this.elements.supplierModal) this.elements.supplierModal.style.display = 'none'; if (this.elements.modalSupplierName) this.elements.modalSupplierName.value = ''; if (this.elements.modalSupplierPhone) this.elements.modalSupplierPhone.value = ''; }
  quickAddSupplier() {
    const name = this.elements.modalSupplierName.value.trim(), phone = this.elements.modalSupplierPhone.value.trim();
    if (!name) return alert('أدخل اسم المورد');
    if (this.suppliers.some(s => s.name === name)) return alert('المورد موجود');
    this.suppliers.push({ id: Date.now(), name, phone, balance: 0 });
    this.saveData(); this.renderSuppliers(); this.updateSupplierDropdown(); this.updatePaymentSupplierDropdown(); this.updateReceivingSupplierDropdown();
    this.closeSupplierModal();
  }
}

// ===== بدء التشغيل =====
window.addEventListener('DOMContentLoaded', () => {
  initDefaultAdmin();

  const licenseModal = document.getElementById('licenseModal');
  const loginModal = document.getElementById('loginModal');
  const appContainer = document.getElementById('appContainer');

  function updateLicenseDisplay() {
    const lr = document.getElementById('licenseRemaining');
    if (!lr) return;
    if (isLicenseExpired()) {
      lr.textContent = '🔒 انتهت صلاحية الترخيص';
      lr.style.background = '#f8d7da';
      lr.style.color = '#721c24';
      lr.style.display = 'block';
    } else {
      const remaining = getRemainingDays();
      if (remaining !== null && remaining > 0) {
        lr.textContent = `✅ الترخيص ساري - متبقي ${remaining} يوم`;
        lr.style.background = '#d4edda';
        lr.style.color = '#155724';
        lr.style.display = 'block';
      } else if (remaining === null) {
        lr.style.display = 'none';
      }
    }
  }

  if (!isLicenseValid()) {
    licenseModal.style.display = 'flex';
    const msg = document.getElementById('licenseMessage');
    const remain = getRemainingDays();
    if (remain !== null && remain <= 0) {
      msg.innerHTML = `انتهت صلاحية الترخيص. يرجى إدخال كلمة المرور الرئيسية للتجديد.<br>للدعم: ${SUPPORT_PHONE}`;
    } else {
      msg.innerHTML = `لم يتم تفعيل الترخيص بعد. أدخل كلمة المرور الرئيسية لبدء 12 شهراً.<br>للدعم: ${SUPPORT_PHONE}`;
    }

    document.getElementById('licenseActivateBtn').onclick = () => {
      const pass = document.getElementById('licensePasswordInput').value;
      if (pass === LICENSE_PASSWORD) {
        setLicenseStartDate(new Date());
        licenseModal.style.display = 'none';
        checkUserSession();
      } else {
        document.getElementById('licenseError').textContent = 'كلمة مرور غير صحيحة';
      }
    };
    document.getElementById('licensePasswordInput').addEventListener('keypress', e => {
      if (e.key === 'Enter') document.getElementById('licenseActivateBtn').click();
    });
  } else {
    checkUserSession();
  }

  function checkUserSession() {
    const currentUser = getCurrentUser();
    if (currentUser) {
      appContainer.style.display = 'block';
      new AccountingApp(currentUser);
      updateLicenseDisplay();
    } else {
      loginModal.style.display = 'flex';
      document.getElementById('loginBtn').onclick = () => {
        const email = document.getElementById('loginEmail').value.trim();
        const pass = document.getElementById('loginPassword').value;
        const user = loginUser(email, pass);
        if (user) {
          loginModal.style.display = 'none';
          appContainer.style.display = 'block';
          new AccountingApp(user);
          updateLicenseDisplay();
        } else {
          document.getElementById('loginError').textContent = 'بيانات الدخول غير صحيحة';
        }
      };
      document.getElementById('loginPassword').addEventListener('keypress', e => {
        if (e.key === 'Enter') document.getElementById('loginBtn').click();
      });
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', logoutUser);
});