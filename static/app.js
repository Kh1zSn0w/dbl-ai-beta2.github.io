const state = {
  token: null,
  user: null,
  customers: [],
  products: [],
  salesCart: []
};

const loginSection = document.getElementById("loginSection");
const appSection = document.getElementById("appSection");
const userInfo = document.getElementById("userInfo");

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

function clearAuth() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function showMessage(targetId, text, isError = false) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.textContent = text;
  el.className = isError ? "error" : "";
}

function table(headers, rowsHtml) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="${headers.length}">No data available</td></tr>`}</tbody>
      </table>
    </div>`;
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach((el) => el.classList.add("hidden"));
  document.querySelectorAll(".nav-stack button[data-tab]").forEach((el) => el.classList.remove("active"));
  document.getElementById(tabId).classList.remove("hidden");
  document.querySelector(`.nav-stack button[data-tab='${tabId}']`)?.classList.add("active");
}

function bindTabs() {
  document.querySelectorAll(".nav-stack button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function roleGate() {
  const isAdmin = state.user?.role === "admin";
  const usersTab = document.querySelector("button[data-tab='users']");
  if (usersTab) usersTab.style.display = isAdmin ? "inline-block" : "none";
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  const m = data.metrics;

  const topRows = data.top_products
    .map((p) => `<tr><td>${p.name}</td><td>${p.quantity_sold}</td></tr>`)
    .join("");

  document.getElementById("dashboard").innerHTML = `
    <div class="section-head"><h2>Executive Dashboard</h2></div>
    <div class="kpi-grid">
      <article class="kpi"><p>Total Customers</p><strong>${m.total_customers}</strong></article>
      <article class="kpi"><p>Total SKUs</p><strong>${m.total_products}</strong></article>
      <article class="kpi"><p>Total Transactions</p><strong>${m.total_transactions}</strong></article>
      <article class="kpi"><p>Total Revenue</p><strong>${formatMoney(m.total_revenue)}</strong></article>
      <article class="kpi"><p>Today's Revenue</p><strong>${formatMoney(m.today_revenue)}</strong></article>
    </div>
    <h3>Top Selling Items</h3>
    ${table(["Item", "Units Sold"], topRows)}
  `;
}

async function loadCustomers(query = "") {
  const data = await api(`/api/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  state.customers = data;

  const rows = data
    .map(
      (c) => `<tr>
      <td>${c.id}</td>
      <td>${c.name}</td>
      <td>${c.email || "-"}</td>
      <td>${c.phone || "-"}</td>
      <td>${c.address || "-"}</td>
      <td>
        <button onclick='editCustomer(${JSON.stringify(c)})'>Edit</button>
        ${state.user.role === "admin" ? `<button class="danger" onclick='deleteCustomer(${c.id})'>Delete</button>` : ""}
      </td>
    </tr>`
    )
    .join("");

  document.getElementById("customersTable").innerHTML = table(
    ["ID", "Customer", "Email", "Phone", "Address", "Actions"],
    rows
  );
  fillCustomerSelect();
}

window.editCustomer = function editCustomer(customer) {
  customerId.value = customer.id;
  customerName.value = customer.name;
  customerEmail.value = customer.email || "";
  customerPhone.value = customer.phone || "";
  customerAddress.value = customer.address || "";
};

window.deleteCustomer = async function deleteCustomer(id) {
  if (!confirm("Delete this customer?")) return;
  try {
    await api(`/api/customers/${id}`, { method: "DELETE" });
    await loadCustomers(customerSearch.value);
  } catch (err) {
    alert(err.message);
  }
};

async function loadProducts() {
  const data = await api("/api/products");
  state.products = data;

  const rows = data
    .map(
      (p) => `<tr>
      <td>${p.id}</td>
      <td>${p.sku}</td>
      <td>${p.name}</td>
      <td>${formatMoney(p.price)}</td>
      <td>${p.stock_quantity}</td>
      <td>${p.stock_quantity <= 10 ? '<span class="tag low">Low</span>' : '<span class="tag ok">Healthy</span>'}</td>
      <td>
        <button onclick='editProduct(${JSON.stringify(p)})'>Edit</button>
        ${state.user.role === "admin" ? `<button class="danger" onclick='deleteProduct(${p.id})'>Delete</button>` : ""}
      </td>
    </tr>`
    )
    .join("");

  document.getElementById("productsTable").innerHTML = table(
    ["ID", "SKU", "Item", "Price", "Stock", "Status", "Actions"],
    rows
  );

  fillProductSelect();
  await loadLowStock();
}

window.editProduct = function editProduct(product) {
  productId.value = product.id;
  productSku.value = product.sku;
  productName.value = product.name;
  productPrice.value = product.price;
  productStock.value = product.stock_quantity;
};

window.deleteProduct = async function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;
  try {
    await api(`/api/products/${id}`, { method: "DELETE" });
    await loadProducts();
  } catch (err) {
    alert(err.message);
  }
};

async function loadLowStock() {
  const data = await api("/api/inventory/low-stock");
  const html = data.length
    ? data.map((p) => `<span class="tag low">${p.sku} ${p.name} (${p.stock_quantity})</span>`).join(" ")
    : `<span class="tag ok">No low-stock items</span>`;
  document.getElementById("lowStockList").innerHTML = html;
}

function fillCustomerSelect() {
  saleCustomer.innerHTML = `<option value="">Walk-in Customer</option>${state.customers
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("")}`;
}

function fillProductSelect() {
  saleProduct.innerHTML = state.products
    .map((p) => `<option value="${p.id}">${p.sku} | ${p.name} | ${formatMoney(p.price)} | Stock ${p.stock_quantity}</option>`)
    .join("");
}

function renderCart() {
  const rows = state.salesCart
    .map(
      (item, i) => `<tr>
      <td>${item.product.name}</td>
      <td>${item.qty}</td>
      <td>${formatMoney(item.product.price)}</td>
      <td>${formatMoney(item.qty * item.product.price)}</td>
      <td><button class="danger" onclick="removeCartItem(${i})">Remove</button></td>
    </tr>`
    )
    .join("");

  const total = state.salesCart.reduce((sum, item) => sum + item.qty * Number(item.product.price), 0);
  saleCart.innerHTML = `<h3>Cart</h3>${table(["Item", "Qty", "Unit", "Line Total", ""], rows)}<p><strong>Total: ${formatMoney(total)}</strong></p>`;
}

window.removeCartItem = function removeCartItem(index) {
  state.salesCart.splice(index, 1);
  renderCart();
};

async function loadSales() {
  const data = await api("/api/sales");
  const rows = data
    .map(
      (s) => `<tr>
      <td>${s.id}</td>
      <td>${s.customer_name || "Walk-in"}</td>
      <td>${formatMoney(s.total_amount)}</td>
      <td>${new Date(s.created_at).toLocaleString()}</td>
      <td>${s.created_by_username}</td>
      <td><button onclick="viewReceipt(${s.id})">Receipt</button></td>
    </tr>`
    )
    .join("");

  salesList.innerHTML = `<h3>Recent Sales</h3>${table(["ID", "Customer", "Total", "Timestamp", "Cashier", "Receipt"], rows)}`;
}

window.viewReceipt = async function viewReceipt(saleId) {
  try {
    const data = await api(`/api/sales/${saleId}/receipt`);
    const itemRows = data.items
      .map(
        (i) => `<tr>
      <td>${i.sku}</td>
      <td>${i.name}</td>
      <td>${i.quantity}</td>
      <td>${formatMoney(i.unit_price)}</td>
      <td>${formatMoney(i.line_total)}</td>
    </tr>`
      )
      .join("");

    receiptView.innerHTML = `
      <div class="receipt-card">
        <h3>Digital Receipt #${data.sale.id}</h3>
        <p>Customer: <strong>${data.sale.customer_name || "Walk-in"}</strong> | Cashier: <strong>${data.sale.cashier}</strong></p>
        <p>Date: ${new Date(data.sale.created_at).toLocaleString()}</p>
        ${table(["SKU", "Item", "Qty", "Unit", "Total"], itemRows)}
        <p><strong>Grand Total: ${formatMoney(data.sale.total_amount)}</strong></p>
      </div>`;
  } catch (err) {
    alert(err.message);
  }
};

async function loadReports() {
  const sales = await api("/api/reports/sales");
  const inventory = await api("/api/reports/inventory");

  const dailyRows = sales.daily
    .map((r) => `<tr><td>${r.date}</td><td>${r.total_transactions}</td><td>${formatMoney(r.total_sales)}</td></tr>`)
    .join("");
  const monthlyRows = sales.monthly
    .map((r) => `<tr><td>${r.month}</td><td>${r.total_transactions}</td><td>${formatMoney(r.total_sales)}</td></tr>`)
    .join("");
  const lowRows = inventory.low_stock
    .map((r) => `<tr><td>${r.sku}</td><td>${r.name}</td><td>${r.stock_quantity}</td></tr>`)
    .join("");

  reportsView.innerHTML = `
    <h3>Daily Sales (Last 30 Days)</h3>
    ${table(["Date", "Transactions", "Sales"], dailyRows)}
    <h3>Monthly Sales (Last 12 Months)</h3>
    ${table(["Month", "Transactions", "Sales"], monthlyRows)}
    <h3>Inventory Value Summary</h3>
    <div class="kpi-grid">
      <article class="kpi"><p>Total SKUs</p><strong>${inventory.summary.total_products}</strong></article>
      <article class="kpi"><p>Total Units</p><strong>${inventory.summary.total_units}</strong></article>
      <article class="kpi"><p>Inventory Value</p><strong>${formatMoney(inventory.summary.inventory_value)}</strong></article>
    </div>
    <h3>Low Stock SKUs</h3>
    ${table(["SKU", "Item", "Units Left"], lowRows)}
  `;
}

async function loadUsers() {
  if (state.user.role !== "admin") {
    usersList.innerHTML = "<p>Only admins can view users.</p>";
    return;
  }

  const users = await api("/api/users");
  const rows = users
    .map((u) => `<tr><td>${u.id}</td><td>${u.full_name}</td><td>${u.username}</td><td>${u.role}</td><td>${new Date(u.created_at).toLocaleString()}</td></tr>`)
    .join("");
  usersList.innerHTML = table(["ID", "Name", "Username", "Role", "Created"], rows);
}

async function refreshAll() {
  await loadCustomers();
  await loadProducts();
  await loadSales();
  await loadDashboard();
  await loadReports();
  await loadUsers();
  renderCart();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage("loginError", "");

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: username.value, password: password.value })
    });
    setAuth(data.token, data.user);
    loginSection.classList.add("hidden");
    appSection.classList.remove("hidden");
    userInfo.textContent = `${data.user.full_name} (${data.user.role})`;
    roleGate();
    await refreshAll();
  } catch (err) {
    showMessage("loginError", err.message, true);
  }
});

logoutBtn.addEventListener("click", () => {
  clearAuth();
  window.location.reload();
});

customerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = customerId.value;
  const payload = {
    name: customerName.value,
    email: customerEmail.value,
    phone: customerPhone.value,
    address: customerAddress.value
  };

  try {
    if (id) {
      await api(`/api/customers/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/api/customers", { method: "POST", body: JSON.stringify(payload) });
    }
    e.target.reset();
    customerId.value = "";
    await loadCustomers(customerSearch.value);
  } catch (err) {
    alert(err.message);
  }
});

customerSearch.addEventListener("input", async (e) => {
  await loadCustomers(e.target.value);
});

productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = productId.value;
  const payload = {
    sku: productSku.value,
    name: productName.value,
    price: productPrice.value,
    stock_quantity: productStock.value
  };

  try {
    if (id) {
      await api(`/api/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/api/products", { method: "POST", body: JSON.stringify(payload) });
    }
    e.target.reset();
    productId.value = "";
    await loadProducts();
  } catch (err) {
    alert(err.message);
  }
});

addSaleItem.addEventListener("click", () => {
  const productId = Number(saleProduct.value);
  const qty = Number(saleQty.value);
  const product = state.products.find((p) => p.id === productId);
  if (!product || qty < 1) return;

  const existing = state.salesCart.find((i) => i.product.id === productId);
  if (existing) {
    existing.qty += qty;
  } else {
    state.salesCart.push({ product, qty });
  }

  renderCart();
});

saleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.salesCart.length) {
    alert("Add at least one item.");
    return;
  }

  const payload = {
    customer_id: saleCustomer.value || null,
    items: state.salesCart.map((i) => ({ product_id: i.product.id, quantity: i.qty }))
  };

  try {
    const sale = await api("/api/sales", { method: "POST", body: JSON.stringify(payload) });
    alert(`Sale completed. Receipt #${sale.sale_id}`);
    state.salesCart = [];
    renderCart();
    await loadProducts();
    await loadSales();
    await loadDashboard();
    await loadReports();
    await viewReceipt(sale.sale_id);
  } catch (err) {
    alert(err.message);
  }
});

userForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        full_name: newFullName.value,
        username: newUsername.value,
        password: newPassword.value,
        role: newRole.value
      })
    });
    e.target.reset();
    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
});

(async function init() {
  bindTabs();
  const token = localStorage.getItem("token");
  const user = localStorage.getItem("user");
  if (!token || !user) return;

  state.token = token;
  state.user = JSON.parse(user);
  loginSection.classList.add("hidden");
  appSection.classList.remove("hidden");
  userInfo.textContent = `${state.user.full_name} (${state.user.role})`;
  roleGate();

  try {
    await refreshAll();
  } catch (err) {
    clearAuth();
    window.location.reload();
  }
})();
