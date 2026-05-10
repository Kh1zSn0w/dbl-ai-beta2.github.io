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

function showMessage(targetId, text, isError = false) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.textContent = text;
  el.className = isError ? "error" : "";
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function table(headers, rowsHtml) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="${headers.length}">No data</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".tabs button[data-tab]").forEach(el => el.classList.remove("active"));
  document.getElementById(tabId).classList.remove("hidden");
  document.querySelector(`.tabs button[data-tab='${tabId}']`)?.classList.add("active");
}

function bindTabs() {
  document.querySelectorAll(".tabs button[data-tab]").forEach(btn => {
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
  const topRows = data.top_products.map(p => `<tr><td>${p.name}</td><td>${p.quantity_sold}</td></tr>`).join("");

  document.getElementById("dashboard").innerHTML = `
    <h2>Business Performance Dashboard</h2>
    <p>Total Customers: <strong>${m.total_customers}</strong> | Total Products: <strong>${m.total_products}</strong></p>
    <p>Total Transactions: <strong>${m.total_transactions}</strong> | Total Revenue: <strong>${formatMoney(m.total_revenue)}</strong></p>
    <p>Today's Revenue (UTC date): <strong>${formatMoney(m.today_revenue)}</strong></p>
    <h3>Top Selling Products</h3>
    ${table(["Product", "Units Sold"], topRows)}
  `;
}

async function loadCustomers(query = "") {
  const data = await api(`/api/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  state.customers = data;
  const rows = data.map(c => `
    <tr>
      <td>${c.id}</td>
      <td>${c.name}</td>
      <td>${c.email || ""}</td>
      <td>${c.phone || ""}</td>
      <td>${c.address || ""}</td>
      <td>
        <button onclick='editCustomer(${JSON.stringify(c)})'>Edit</button>
        ${state.user.role === "admin" ? `<button class='danger' onclick='deleteCustomer(${c.id})'>Delete</button>` : ""}
      </td>
    </tr>`).join("");

  document.getElementById("customersTable").innerHTML = table(["ID", "Name", "Email", "Phone", "Address", "Actions"], rows);
  fillCustomerSelect();
}

window.editCustomer = function(customer) {
  document.getElementById("customerId").value = customer.id;
  document.getElementById("customerName").value = customer.name;
  document.getElementById("customerEmail").value = customer.email || "";
  document.getElementById("customerPhone").value = customer.phone || "";
  document.getElementById("customerAddress").value = customer.address || "";
};

window.deleteCustomer = async function(id) {
  if (!confirm("Delete this customer?")) return;
  try {
    await api(`/api/customers/${id}`, { method: "DELETE" });
    await loadCustomers(document.getElementById("customerSearch").value);
  } catch (err) {
    alert(err.message);
  }
};

async function loadProducts() {
  const data = await api("/api/products");
  state.products = data;
  const rows = data.map(p => `
    <tr>
      <td>${p.id}</td><td>${p.sku}</td><td>${p.name}</td><td>${formatMoney(p.price)}</td>
      <td>${p.stock_quantity}</td>
      <td>${p.stock_quantity <= 10 ? `<span class='tag low'>Low</span>` : "<span class='tag'>OK</span>"}</td>
      <td>
        <button onclick='editProduct(${JSON.stringify(p)})'>Edit</button>
        ${state.user.role === "admin" ? `<button class='danger' onclick='deleteProduct(${p.id})'>Delete</button>` : ""}
      </td>
    </tr>
  `).join("");

  document.getElementById("productsTable").innerHTML = table(["ID", "SKU", "Name", "Price", "Stock", "Status", "Actions"], rows);
  fillProductSelect();
  await loadLowStock();
}

window.editProduct = function(product) {
  document.getElementById("productId").value = product.id;
  document.getElementById("productSku").value = product.sku;
  document.getElementById("productName").value = product.name;
  document.getElementById("productPrice").value = product.price;
  document.getElementById("productStock").value = product.stock_quantity;
};

window.deleteProduct = async function(id) {
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
    ? data.map(p => `<span class='tag low'>${p.sku} - ${p.name}: ${p.stock_quantity}</span>`).join(" ")
    : "<span class='tag'>No low stock items</span>";
  document.getElementById("lowStockList").innerHTML = html;
}

function fillCustomerSelect() {
  const sel = document.getElementById("saleCustomer");
  sel.innerHTML = `<option value=''>Walk-in Customer</option>` + state.customers.map(c => `<option value='${c.id}'>${c.name}</option>`).join("");
}

function fillProductSelect() {
  const sel = document.getElementById("saleProduct");
  sel.innerHTML = state.products.map(p => `<option value='${p.id}'>${p.sku} | ${p.name} (${p.stock_quantity})</option>`).join("");
}

function renderCart() {
  const rows = state.salesCart.map((item, i) => `
    <tr>
      <td>${item.product.name}</td>
      <td>${item.qty}</td>
      <td>${formatMoney(item.product.price)}</td>
      <td>${formatMoney(item.qty * item.product.price)}</td>
      <td><button class='danger' onclick='removeCartItem(${i})'>Remove</button></td>
    </tr>
  `).join("");

  const total = state.salesCart.reduce((sum, item) => sum + item.qty * Number(item.product.price), 0);
  document.getElementById("saleCart").innerHTML = `<h3>Current Cart</h3>${table(["Product", "Qty", "Unit", "Line Total", ""], rows)}<p><strong>Total: ${formatMoney(total)}</strong></p>`;
}

window.removeCartItem = function(index) {
  state.salesCart.splice(index, 1);
  renderCart();
};

async function loadSales() {
  const data = await api("/api/sales");
  const rows = data.map(s => `
    <tr>
      <td>${s.id}</td><td>${s.customer_name || "Walk-in"}</td><td>${formatMoney(s.total_amount)}</td>
      <td>${new Date(s.created_at).toLocaleString()}</td>
      <td>${s.created_by_username}</td>
      <td><button onclick='viewReceipt(${s.id})'>Receipt</button></td>
    </tr>
  `).join("");
  document.getElementById("salesList").innerHTML = `<h3>Sales History</h3>${table(["ID", "Customer", "Total", "Date", "Cashier", "Receipt"], rows)}`;
}

window.viewReceipt = async function(saleId) {
  try {
    const data = await api(`/api/sales/${saleId}/receipt`);
    const items = data.items.map(i => `<tr><td>${i.sku}</td><td>${i.name}</td><td>${i.quantity}</td><td>${formatMoney(i.unit_price)}</td><td>${formatMoney(i.line_total)}</td></tr>`).join("");
    document.getElementById("receiptView").innerHTML = `
      <h3>Digital Receipt #${data.sale.id}</h3>
      <p>Customer: ${data.sale.customer_name || "Walk-in"} | Cashier: ${data.sale.cashier}</p>
      <p>Date: ${new Date(data.sale.created_at).toLocaleString()}</p>
      ${table(["SKU", "Item", "Qty", "Unit", "Total"], items)}
      <p><strong>Grand Total: ${formatMoney(data.sale.total_amount)}</strong></p>
    `;
  } catch (err) {
    alert(err.message);
  }
};

async function loadReports() {
  const sales = await api("/api/reports/sales");
  const inventory = await api("/api/reports/inventory");

  const dailyRows = sales.daily.map(r => `<tr><td>${r.date}</td><td>${r.total_transactions}</td><td>${formatMoney(r.total_sales)}</td></tr>`).join("");
  const monthlyRows = sales.monthly.map(r => `<tr><td>${r.month}</td><td>${r.total_transactions}</td><td>${formatMoney(r.total_sales)}</td></tr>`).join("");
  const lowRows = inventory.low_stock.map(r => `<tr><td>${r.sku}</td><td>${r.name}</td><td>${r.stock_quantity}</td></tr>`).join("");

  document.getElementById("reportsView").innerHTML = `
    <h3>Sales Reports</h3>
    ${table(["Date", "Transactions", "Sales"], dailyRows)}
    ${table(["Month", "Transactions", "Sales"], monthlyRows)}
    <h3>Inventory Report</h3>
    <p>Total Products: <strong>${inventory.summary.total_products}</strong></p>
    <p>Total Units: <strong>${inventory.summary.total_units}</strong> | Inventory Value: <strong>${formatMoney(inventory.summary.inventory_value)}</strong></p>
    ${table(["SKU", "Name", "Stock"], lowRows)}
  `;
}

async function loadUsers() {
  if (state.user.role !== "admin") {
    document.getElementById("usersList").innerHTML = "<p>Only admins can view users.</p>";
    return;
  }
  const users = await api("/api/users");
  const rows = users.map(u => `<tr><td>${u.id}</td><td>${u.full_name}</td><td>${u.username}</td><td>${u.role}</td><td>${new Date(u.created_at).toLocaleString()}</td></tr>`).join("");
  document.getElementById("usersList").innerHTML = table(["ID", "Full Name", "Username", "Role", "Created"], rows);
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

document.getElementById("loginForm").addEventListener("submit", async (e) => {
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

document.getElementById("logoutBtn").addEventListener("click", () => {
  clearAuth();
  window.location.reload();
});

document.getElementById("customerForm").addEventListener("submit", async (e) => {
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

document.getElementById("customerSearch").addEventListener("input", async (e) => {
  await loadCustomers(e.target.value);
});

document.getElementById("productForm").addEventListener("submit", async (e) => {
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

document.getElementById("addSaleItem").addEventListener("click", () => {
  const productId = Number(document.getElementById("saleProduct").value);
  const qty = Number(document.getElementById("saleQty").value);
  const product = state.products.find(p => p.id === productId);
  if (!product || qty < 1) return;

  const existing = state.salesCart.find(i => i.product.id === productId);
  if (existing) {
    existing.qty += qty;
  } else {
    state.salesCart.push({ product, qty });
  }
  renderCart();
});

document.getElementById("saleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.salesCart.length) {
    alert("Add at least one item.");
    return;
  }

  const payload = {
    customer_id: saleCustomer.value || null,
    items: state.salesCart.map(i => ({ product_id: i.product.id, quantity: i.qty }))
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

document.getElementById("userForm").addEventListener("submit", async (e) => {
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
