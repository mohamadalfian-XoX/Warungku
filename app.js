import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDoc, deleteDoc,
  query, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const $ = id => document.getElementById(id);
const DELIVERY_FEE = 5000;

const PAYMENT_METHODS = {
  transfer_bca: "Transfer BCA",
  transfer_bri: "Transfer BRI",
  transfer_mandiri: "Transfer Mandiri",
  transfer_bni: "Transfer BNI",
  qris: "QRIS",
  ewallet: "E-wallet (DANA/OVO/GoPay/ShopeePay)",
  va: "Virtual Account"
};

let allProducts = [];
let allOrders = [];
let paymentSettings = {};
let cart = [];              // [{ id, qty }]
let activeCategory = "Semua";
let user = null;
let adminMode = false;
let ordersUnsub = null;

/* ---------- Util ---------- */
function rp(n){ return "Rp" + Math.round(n).toLocaleString("id-ID"); }
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch])); }
function genCode(len){
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
function toast(msg){
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2500);
}
function statusLabel(s){
  return {pending_confirmation:"Menunggu konfirmasi", rejected:"Ditolak", confirmed:"Dikonfirmasi",
    processing:"Diproses", ready:"Siap", out_for_delivery:"Sedang dikirim", completed:"Selesai", cancelled:"Dibatalkan"}[s] || s;
}

/* ---------- WhatsApp & pembayaran ---------- */
function paymentInstructions(method, total){
  const s = paymentSettings;
  if (method && method.startsWith("transfer_")){
    const bankKey = method.replace("transfer_", "").toUpperCase();
    return `Transfer ${rp(total)} ke rekening ${bankKey}: ${(s.bank && s.bank[bankKey]) || "(hubungi admin)"}`;
  }
  if (method === "qris") return `Scan QRIS lalu bayar ${rp(total)}` + (s.qrisImageUrl ? ` (gambar QRIS: ${s.qrisImageUrl})` : "");
  if (method === "ewallet") return `Bayar ${rp(total)} ke: ${s.ewallet || "(hubungi admin)"}`;
  if (method === "va") return `Bayar ${rp(total)} ke Virtual Account: ${s.va || "(hubungi admin)"}`;
  return "";
}
function toWaNumber(phone){
  let p = String(phone || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  return p;
}
function waLink(phone, text){
  return `https://wa.me/${toWaNumber(phone)}?text=${encodeURIComponent(text)}`;
}
function confirmMessage(o){
  const pay = PAYMENT_METHODS[o.paymentMethod] || "-";
  const items = o.items.map(i => `- ${i.name} x${i.qty} = ${rp(i.subtotal)}`).join("\n");
  const statusTxt = o.status === "pending_confirmation"
    ? "Pesanan kamu sudah kami terima dan sedang diperiksa admin."
    : "Pesanan kamu sudah *DIKONFIRMASI*.";
  return `Halo ${o.customerName}, ini dari WarungKu.\n\n` +
    `No. pesanan: *${o.orderNumber}*\n${statusTxt}\n\n` +
    `Rincian:\n${items}\n` +
    `Ongkir: ${rp(o.deliveryFee || 0)}\n` +
    `*Total: ${rp(o.total)}*\n\n` +
    `Metode pembayaran: ${pay}\n${paymentInstructions(o.paymentMethod, o.total)}\n\n` +
    `Terima kasih sudah belanja di WarungKu!`;
}

onSnapshot(doc(db, "settings", "payment"), snap => {
  paymentSettings = snap.exists() ? snap.data() : {};
}, err => console.error(err));

/* ---------- Modal ---------- */
function openModal(html){
  $("modal-root").innerHTML = `<div class="backdrop" id="modal-backdrop"></div>
    <div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  $("modal-backdrop").onclick = closeModal;
}
function closeModal(){
  $("modal-root").innerHTML = "";
  adminMode = false;
}

/* ---------- Keranjang (drawer) ---------- */
function openCart(){
  $("cart-drawer").classList.add("open");
  $("cart-drawer").setAttribute("aria-hidden", "false");
  $("drawer-backdrop").classList.remove("hidden");
}
function closeCart(){
  $("cart-drawer").classList.remove("open");
  $("cart-drawer").setAttribute("aria-hidden", "true");
  $("drawer-backdrop").classList.add("hidden");
}
$("cart-open").onclick = openCart;
$("cart-close").onclick = closeCart;
$("drawer-backdrop").onclick = closeCart;
$("btnCartTop") && ($("btnCartTop").onclick = openCart);

/* ---------- Katalog realtime ---------- */
onSnapshot(query(collection(db, "products"), orderBy("name")), snap => {
  allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  $("catalog-error").classList.add("hidden");
  renderCategories();
  renderProducts();
  renderCart();
  renderSummary();
  renderAdminProducts();
}, err => {
  console.error(err);
  $("result-count").textContent = "Gagal memuat";
  $("catalog-error").textContent = "Katalog gagal dimuat: " + err.message;
  $("catalog-error").classList.remove("hidden");
});

function activeProducts(){ return allProducts.filter(p => p.active); }

function renderCategories(){
  const cats = ["Semua", ...new Set(activeProducts().map(p => p.category).filter(Boolean))];
  $("categories").innerHTML = cats.map(c =>
    `<button class="category ${c === activeCategory ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`
  ).join("");
  $("categories").querySelectorAll("[data-cat]").forEach(b => b.onclick = () => {
    activeCategory = b.dataset.cat;
    renderCategories();
    renderProducts();
  });
}

function renderProducts(){
  const q = $("search").value.trim().toLowerCase();
  const list = activeProducts().filter(p =>
    (activeCategory === "Semua" || p.category === activeCategory) &&
    (!q || (p.name || "").toLowerCase().includes(q))
  );
  $("result-count").textContent = list.length + " produk";
  if (!list.length){
    $("products").innerHTML = '<div class="loading-card">Produk tidak ditemukan.</div>';
    return;
  }
  $("products").innerHTML = list.map(p => {
    const out = p.stock <= 0;
    const low = !out && p.stock <= (p.lowStockThreshold || 0);
    const inCart = cart.find(c => c.id === p.id)?.qty || 0;
    const stockText = out ? '<span class="badge rejected">Habis</span>'
      : low ? `<span class="badge pending_confirmation">Stok menipis (${p.stock})</span>`
      : `Stok ${p.stock}`;
    return `<article class="product-card">
      <div class="product-name">${esc(p.name)}</div>
      <div class="muted small">${esc(p.category || "")}</div>
      <div class="price">${rp(p.price)} <small>/ ${esc(p.unit || "pcs")}</small></div>
      <div class="small">${stockText}</div>
      <button class="primary-button small-btn" data-add="${p.id}" ${out ? "disabled" : ""}>
        ${inCart ? "Di keranjang (" + inCart + ")" : "+ Keranjang"}
      </button>
    </article>`;
  }).join("");
  $("products").querySelectorAll("[data-add]").forEach(b => b.onclick = () => addToCart(b.dataset.add));
}
$("search").oninput = renderProducts;

/* ---------- Keranjang ---------- */
function addToCart(id){
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  const it = cart.find(x => x.id === id);
  if (it){
    if (it.qty >= p.stock){ toast("Stok " + p.name + " tinggal " + p.stock); return; }
    it.qty++;
  } else {
    cart.push({ id, qty: 1 });
  }
  renderCart();
  renderProducts();
  toast(p.name + " ditambahkan");
}
function changeQty(id, d){
  const it = cart.find(x => x.id === id);
  if (!it) return;
  const p = allProducts.find(x => x.id === id);
  if (d > 0 && p && it.qty >= p.stock){ toast("Stok tidak mencukupi"); return; }
  it.qty += d;
  if (it.qty <= 0) cart = cart.filter(x => x.id !== id);
  renderCart();
  renderProducts();
}
function renderCart(){
  const count = cart.reduce((s, c) => s + c.qty, 0);
  $("cart-count").textContent = count;
  if (!cart.length){
    $("cart-items").innerHTML = '<p class="muted">Keranjang masih kosong.</p>';
    $("cart-subtotal").textContent = "Rp0";
    return;
  }
  let subtotal = 0;
  $("cart-items").innerHTML = cart.map(c => {
    const p = allProducts.find(x => x.id === c.id);
    if (!p) return "";
    const line = p.price * c.qty;
    subtotal += line;
    return `<div class="cart-item">
      <div><strong>${esc(p.name)}</strong><div class="muted small">${rp(p.price)} / ${esc(p.unit || "pcs")}</div></div>
      <div class="stepper"><button data-dec="${c.id}">−</button><span>${c.qty}</span><button data-inc="${c.id}">+</button></div>
      <div class="price">${rp(line)}</div>
    </div>`;
  }).join("");
  $("cart-subtotal").textContent = rp(subtotal);
  $("cart-items").querySelectorAll("[data-dec]").forEach(b => b.onclick = () => changeQty(b.dataset.dec, -1));
  $("cart-items").querySelectorAll("[data-inc]").forEach(b => b.onclick = () => changeQty(b.dataset.inc, 1));
}

/* ---------- Checkout ---------- */
$("checkout-open").onclick = () => {
  if (!cart.length){ toast("Keranjang masih kosong"); return; }
  closeCart();
  openModal(`<h2>Checkout</h2>
    <label>Nama</label><input id="cName">
    <label>Nomor telepon</label><input id="cPhone" type="tel">
    <label>Cara terima</label>
    <select id="cFulfill">
      <option value="pickup">Ambil sendiri</option>
      <option value="delivery">Diantar (+${rp(DELIVERY_FEE)})</option>
    </select>
    <div id="addrWrap" class="hidden"><label>Alamat pengiriman</label><textarea id="cAddress"></textarea></div>
    <label>Metode pembayaran</label>
    <select id="cPayment">
      <option value="transfer_bca">Transfer BCA</option>
      <option value="transfer_bri">Transfer BRI</option>
      <option value="transfer_mandiri">Transfer Mandiri</option>
      <option value="transfer_bni">Transfer BNI</option>
      <option value="qris">QRIS</option>
      <option value="ewallet">E-wallet (DANA/OVO/GoPay/ShopeePay)</option>
      <option value="va">Virtual Account</option>
    </select>
    <label>Catatan</label><textarea id="cNotes"></textarea>
    <div class="row">
      <button class="secondary-button" id="cancelOrder">Batal</button>
      <button class="primary-button" id="submitOrder">Pesan</button>
    </div>`);
  $("cFulfill").onchange = e => $("addrWrap").classList.toggle("hidden", e.target.value !== "delivery");
  $("cancelOrder").onclick = closeModal;
  $("submitOrder").onclick = submitOrder;
};

async function submitOrder(){
  const cname = $("cName").value.trim();
  const phone = $("cPhone").value.trim();
  const fulfill = $("cFulfill").value;
  const address = $("cAddress").value.trim();
  const notes = $("cNotes").value.trim();
  const payMethod = $("cPayment").value;
  if (cname.length < 2) return toast("Isi nama");
  if (phone.length < 8) return toast("Isi nomor telepon yang valid");
  if (fulfill === "delivery" && address.length < 5) return toast("Isi alamat pengiriman");

  const btn = $("submitOrder");
  btn.disabled = true;
  btn.textContent = "Memproses…";
  try{
    const items = [];
    let subtotal = 0;
    for (const c of cart){
      const snap = await getDoc(doc(db, "products", c.id));
      if (!snap.exists() || !snap.data().active) throw new Error("Ada produk yang sudah tidak tersedia.");
      const p = snap.data();
      if (p.stock < c.qty) throw new Error(`Stok ${p.name} tinggal ${p.stock}.`);
      const line = p.price * c.qty;
      items.push({ productId: c.id, name: p.name, unit: p.unit || "pcs", price: p.price, qty: c.qty, subtotal: line });
      subtotal += line;
    }
    const deliveryFee = fulfill === "delivery" ? DELIVERY_FEE : 0;
    const total = subtotal + deliveryFee;
    const orderNumber = "WK-" + genCode(6);
    const accessCode = genCode(6);
    await setDoc(doc(db, "orders", orderNumber), {
      orderNumber, accessCode, customerName: cname, customerPhone: phone,
      fulfillment: fulfill, address: fulfill === "delivery" ? address : "", notes,
      paymentMethod: payMethod,
      items, subtotal, deliveryFee, total,
      status: "pending_confirmation", paymentStatus: "not_started",
      history: [{ status: "pending_confirmation", at: new Date().toISOString() }],
      createdAt: serverTimestamp()
    });
    cart = [];
    renderCart();
    renderProducts();
    openModal(`<h2>Pesanan terkirim ✅</h2>
      <p>Nomor: <strong>${orderNumber}</strong></p>
      <p>Kode akses: <strong>${accessCode}</strong></p>
      <p>Total: <strong>${rp(total)}</strong></p>
      <p>Metode: ${PAYMENT_METHODS[payMethod]}</p>
      <p class="muted small">${paymentInstructions(payMethod, total)}</p>
      <p class="muted small">Simpan nomor dan kode akses untuk melacak status. Pembayaran dikonfirmasi setelah admin memeriksa pembayaranmu.</p>
      <button class="primary-button" id="doneOrder">Tutup</button>`);
    $("doneOrder").onclick = closeModal;
  } catch (e){
    toast(e.message);
    btn.disabled = false;
    btn.textContent = "Pesan";
  }
}

/* ---------- Admin ---------- */
$("admin-open").onclick = () => { adminMode = true; renderAdmin(); };

onAuthStateChanged(auth, u => {
  user = u;
  if (u) subscribeOrders();
  else unsubscribeOrders();
  if (adminMode) renderAdmin();
});

function renderAdmin(){
  if (!adminMode) return;
  if (!user){
    openModal(`<h2>Login Admin</h2>
      <label>Email</label><input id="loginEmail" type="email">
      <label>Kata sandi</label><input id="loginPass" type="password">
      <p id="loginMsg" class="muted small"></p>
      <div class="row">
        <button class="secondary-button" id="cancelAdmin">Batal</button>
        <button class="primary-button" id="btnLogin">Masuk</button>
      </div>`);
    $("cancelAdmin").onclick = closeModal;
    $("btnLogin").onclick = login;
    return;
  }
  openModal(`<div class="row"><h2>Admin</h2><button class="secondary-button" id="btnLogout">Keluar</button></div>
    <p class="muted small">${esc(user.email)}</p>
    <div id="adminSummary" class="card"></div>
    <h3>Tambah produk</h3>
    <div class="card">
      <input id="npName" placeholder="Nama produk">
      <input id="npCat" placeholder="Kategori">
      <input id="npPrice" type="number" placeholder="Harga">
      <input id="npUnit" placeholder="Satuan (pcs, kg, botol)">
      <input id="npStock" type="number" placeholder="Stok awal">
      <button class="primary-button" id="btnAddProduct">Tambah</button>
    </div>
    <h3>Produk</h3><div id="adminProducts"></div>
    <h3>Pesanan terbaru</h3><div id="adminOrders"></div>`);
  $("btnLogout").onclick = () => { signOut(auth); closeModal(); };
  $("btnAddProduct").onclick = addProduct;
  renderSummary();
  renderAdminProducts();
  renderAdminOrders();
}

async function login(){
  $("loginMsg").textContent = "Memproses…";
  try{
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPass").value);
  } catch (e){
    $("loginMsg").textContent = "Email atau kata sandi salah.";
  }
}

async function addProduct(){
  const name = $("npName").value.trim();
  const price = parseFloat($("npPrice").value);
  if (!name || isNaN(price) || price < 0) return toast("Nama dan harga wajib valid");
  await addDoc(collection(db, "products"), {
    name,
    category: $("npCat").value.trim(),
    price,
    unit: $("npUnit").value.trim() || "pcs",
    stock: parseInt($("npStock").value) || 0,
    lowStockThreshold: 5,
    active: true,
    createdAt: serverTimestamp()
  });
  ["npName","npCat","npPrice","npUnit","npStock"].forEach(id => $(id).value = "");
  toast("Produk ditambahkan");
}

function renderSummary(){
  const el = $("adminSummary");
  if (!el) return;
  const out = allProducts.filter(p => p.stock <= 0).length;
  const low = allProducts.filter(p => p.stock > 0 && p.stock <= (p.lowStockThreshold || 0)).length;
  const pend = allOrders.filter(o => o.status === "pending_confirmation").length;
  el.innerHTML = `<div class="row"><span>Produk aktif</span><strong>${activeProducts().length}</strong></div>
    <div class="row"><span>Habis / menipis</span><strong>${out} / ${low}</strong></div>
    <div class="row"><span>Menunggu konfirmasi</span><strong>${pend}</strong></div>`;
}

function renderAdminProducts(){
  const el = $("adminProducts");
  if (!el) return;
  el.innerHTML = allProducts.map(p => `<div class="row">
      <span>${esc(p.name)} <small class="muted">${p.active ? "aktif" : "nonaktif"}</small></span>
      <input type="number" class="stock-input" value="${p.stock}" data-stock="${p.id}">
      <button class="secondary-button small-btn" data-savestock="${p.id}">Simpan</button>
      <button class="secondary-button small-btn" data-toggle="${p.id}" data-val="${!p.active}">
        ${p.active ? "Nonaktifkan" : "Aktifkan"}</button>
      <button class="secondary-button small-btn danger" data-delprod="${p.id}">Hapus</button>
    </div>`).join("");
  el.querySelectorAll("[data-savestock]").forEach(b => b.onclick = async () => {
    const v = parseInt(el.querySelector(`[data-stock="${b.dataset.savestock}"]`).value);
    if (isNaN(v) || v < 0) return toast("Stok tidak valid");
    await updateDoc(doc(db, "products", b.dataset.savestock), { stock: v });
    toast("Stok disimpan");
  });
  el.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () =>
    updateDoc(doc(db, "products", b.dataset.toggle), { active: b.dataset.val === "true" })
  );
  el.querySelectorAll("[data-delprod]").forEach(b => b.onclick = () => deleteProduct(b.dataset.delprod));
}

async function deleteProduct(id){
  const hasOrder = allOrders.some(o => (o.items || []).some(i => i.productId === id));
  if (hasOrder){
    if (!confirm("Produk ini pernah dipesan, jadi tidak bisa dihapus permanen. Nonaktifkan saja?")) return;
    await updateDoc(doc(db, "products", id), { active: false });
    toast("Produk dinonaktifkan");
    return;
  }
  if (!confirm("Hapus produk ini permanen?")) return;
  await deleteDoc(doc(db, "products", id));
  toast("Produk dihapus");
}

function subscribeOrders(){
  if (ordersUnsub) return;
  ordersUnsub = onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100)), snap => {
    allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSummary();
    renderAdminOrders();
  }, err => console.error(err));
}
function unsubscribeOrders(){
  if (ordersUnsub) ordersUnsub();
  ordersUnsub = null;
  allOrders = [];
}

function renderAdminOrders(){
  const el = $("adminOrders");
  if (!el) return;
  if (!allOrders.length){ el.innerHTML = '<p class="muted">Belum ada pesanan.</p>'; return; }
  el.innerHTML = allOrders.map(o => `<div class="card">
    <div class="row"><strong>${o.orderNumber}</strong><span class="badge ${o.status}">${statusLabel(o.status)}</span></div>
    <div class="muted small">${esc(o.customerName)} · ${esc(o.customerPhone)} · ${o.fulfillment === "delivery" ? "Diantar" : "Ambil sendiri"} · ${PAYMENT_METHODS[o.paymentMethod] || "-"}</div>
    <div class="small">${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join("<br>")}</div>
    <div class="row"><span>Total</span><strong>${rp(o.total)}</strong></div>
    <div class="row">${actionButtons(o)}</div>
  </div>`).join("");
  el.querySelectorAll("[data-act]").forEach(b => b.onclick = () => {
    const o = allOrders.find(x => x.id === b.dataset.oid);
    handleAction(b.dataset.act, o);
  });
}
function actionButtons(o){
  const b = (act, label, cls = "") => `<button class="secondary-button small-btn ${cls}" data-act="${act}" data-oid="${o.id}">${label}</button>`;
  const wa = `<a class="secondary-button small-btn" target="_blank" rel="noopener" href="${waLink(o.customerPhone, confirmMessage(o))}">Kirim WA</a>`;
  let html = "";
  if (o.status === "pending_confirmation") html = b("confirm", "Konfirmasi") + b("reject", "Tolak", "danger");
  else if (o.status === "confirmed" && o.paymentStatus !== "paid") html = b("paid", "Tandai lunas");
  else if (o.status === "confirmed") html = b("processing", "Mulai diproses");
  else if (o.status === "processing") html = b("ready", "Tandai siap");
  else if (o.status === "ready" && o.fulfillment === "delivery") html = b("out_for_delivery", "Kirim");
  else if (o.status === "ready" || o.status === "out_for_delivery") html = b("completed", "Selesai");
  if (["completed", "rejected", "cancelled"].includes(o.status)) html += b("delete", "Hapus", "danger");
  return html + wa;
}
async function addHistory(id, status, extra = {}){
  const ref = doc(db, "orders", id);
  const snap = await getDoc(ref);
  const hist = (snap.data().history || []).concat([{ status, at: new Date().toISOString() }]);
  await updateDoc(ref, { status, history: hist, ...extra });
}
async function handleAction(act, o){
  if (!o) return;
  try{
    if (act === "delete"){
      if (!confirm("Hapus pesanan " + o.orderNumber + " permanen?")) return;
      await deleteDoc(doc(db, "orders", o.id));
      toast("Pesanan dihapus");
      return;
    }
    if (act === "confirm"){
      for (const it of o.items){
        const p = await getDoc(doc(db, "products", it.productId));
        if (!p.exists() || p.data().stock < it.qty) return toast("Stok " + it.name + " tidak cukup lagi");
      }
      for (const it of o.items){
        const ref = doc(db, "products", it.productId);
        const p = await getDoc(ref);
        await updateDoc(ref, { stock: p.data().stock - it.qty });
      }
      await addHistory(o.id, "confirmed", { paymentStatus: "pending" });
    } else if (act === "reject"){
      await addHistory(o.id, "rejected", { paymentStatus: "cancelled" });
    } else if (act === "paid"){
      await updateDoc(doc(db, "orders", o.id), { paymentStatus: "paid" });
    } else {
      await addHistory(o.id, act); // processing, ready, out_for_delivery, completed
    }
    toast("Status diperbarui");
  } catch (e){
    toast("Gagal: " + e.message);
  }
}
