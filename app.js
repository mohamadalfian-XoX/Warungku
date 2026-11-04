import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let products = [];
let cart = [];
let allProducts = [];
let allOrders = [];
let currentUser = null;

function rp(n){ return "Rp" + Math.round(n).toLocaleString("id-ID"); }
function genCode(len){
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
function esc(s){ return (s || "").replace(/[&<>"]/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[ch])); }
function statusLabel(s){ return {pending_confirmation:"Menunggu Konfirmasi",rejected:"Ditolak",confirmed:"Dikonfirmasi",processing:"Diproses",ready:"Siap",out_for_delivery:"Sedang Dikirim",completed:"Selesai",cancelled:"Dibatalkan"}[s] || s; }
function payLabel(s){ return {not_started:"Belum dimulai",pending:"Menunggu pembayaran",paid:"Lunas",failed:"Gagal",expired:"Kedaluwarsa",cancelled:"Dibatalkan",refund_pending:"Proses refund",refunded:"Direfund"}[s] || s; }

/* ---------- Navigasi tab ---------- */
document.querySelectorAll("nav button").forEach(b => b.onclick = () => switchTab(b.dataset.tab));
function switchTab(t){
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
  ["toko", "lacak", "admin"].forEach(id => document.getElementById("tab-" + id).classList.toggle("hidden", id !== t));
}

/* ---------- Katalog & keranjang ---------- */
function subscribeCatalog(){
  const q = query(collection(db, "products"), where("active", "==", true), orderBy("name"));
  onSnapshot(q, snap => {
    products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCatalog();
  }, err => console.error(err));
}
function renderCatalog(){
  const el = document.getElementById("catalog");
  if (products.length === 0){ el.innerHTML = '<p class="muted">Belum ada produk.</p>'; return; }
  el.innerHTML = products.map(p => {
    const out = p.stock <= 0;
    const low = !out && p.stock <= (p.lowStockThreshold || 0);
    const status = out ? '<span class="badge rejected">Habis</span>' : (low ? '<span class="badge pending_confirmation">Stok Menipis</span>' : "");
    return `<div class="card row">
      <div><div><strong>${esc(p.name)}</strong> ${status}</div>
      <div class="muted">${rp(p.price)} / ${esc(p.unit || "pcs")} · stok ${p.stock}</div></div>
      <button class="btn small" ${out ? "disabled" : ""} data-add="${p.id}">+ Keranjang</button>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-add]").forEach(b => b.onclick = () => addToCart(b.dataset.add));
  renderCart();
}
function addToCart(id){
  const p = products.find(x => x.id === id); if (!p) return;
  const it = cart.find(x => x.id === id);
  if (it) it.qty++; else cart.push({ id, name: p.name, price: p.price, unit: p.unit, qty: 1 });
  renderCart();
}
function changeQty(id, d){
  const it = cart.find(x => x.id === id); if (!it) return;
  it.qty += d; if (it.qty <= 0) cart = cart.filter(x => x.id !== id);
  renderCart();
}
function renderCart(){
  const card = document.getElementById("cartCard");
  if (cart.length === 0){ card.style.display = "none"; return; }
  card.style.display = "block";
  let subtotal = 0;
  document.getElementById("cartItems").innerHTML = cart.map(c => {
    subtotal += c.price * c.qty;
    return `<div class="row" style="margin-top:8px;"><span>${esc(c.name)}</span>
      <span class="stepper"><button data-dec="${c.id}">−</button>${c.qty}<button data-inc="${c.id}">+</button></span>
      <span class="price">${rp(c.price * c.qty)}</span></div>`;
  }).join("");
  document.getElementById("cartSubtotal").textContent = rp(subtotal);
  card.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => changeQty(b.dataset.dec, -1));
  card.querySelectorAll("[data-inc]").forEach(b => b.onclick = () => changeQty(b.dataset.inc, 1));
}

/* ---------- Checkout ---------- */
document.getElementById("btnOpenCheckout").onclick = () => document.getElementById("checkoutModal").classList.remove("hidden");
document.getElementById("btnCloseCheckout").onclick = () => document.getElementById("checkoutModal").classList.add("hidden");
document.getElementById("cFulfill").onchange = e => document.getElementById("addrWrap").classList.toggle("hidden", e.target.value !== "delivery");
document.getElementById("btnSubmitOrder").onclick = submitOrder;

async function submitOrder(){
  const name = document.getElementById("cName").value.trim();
  const phone = document.getElementById("cPhone").value.trim();
  const fulfill = document.getElementById("cFulfill").value;
  const address = document.getElementById("cAddress").value.trim();
  const notes = document.getElementById("cNotes").value.trim();
  if (name.length < 2){ alert("Isi nama."); return; }
  if (phone.length < 8){ alert("Isi nomor telepon yang valid."); return; }
  if (fulfill === "delivery" && address.length < 5){ alert("Isi alamat pengiriman."); return; }
  if (cart.length === 0){ alert("Keranjang kosong."); return; }

  let items = [], subtotal = 0;
  for (const c of cart){
    const snap = await getDoc(doc(db, "products", c.id));
    if (!snap.exists() || !snap.data().active){ alert(c.name + " sudah tidak tersedia."); return; }
    const p = snap.data();
    if (p.stock < c.qty){ alert("Stok " + p.name + " tidak mencukupi (sisa " + p.stock + ")."); return; }
    const line = p.price * c.qty;
    items.push({ productId: c.id, name: p.name, unit: p.unit || "pcs", price: p.price, qty: c.qty, subtotal: line });
    subtotal += line;
  }
  const deliveryFee = fulfill === "delivery" ? 5000 : 0;
  const total = subtotal + deliveryFee;
  const orderNumber = "WK-" + genCode(6);
  const accessCode = genCode(6);
  const order = {
    orderNumber, accessCode, customerName: name, customerPhone: phone,
    fulfillment: fulfill, address: fulfill === "delivery" ? address : "", notes,
    items, subtotal, deliveryFee, total,
    status: "pending_confirmation", paymentStatus: "not_started",
    history: [{ status: "pending_confirmation", at: new Date().toISOString() }],
    createdAt: serverTimestamp()
  };
  await setDoc(doc(db, "orders", orderNumber), order);
  cart = []; renderCart();
  document.getElementById("checkoutModal").classList.add("hidden");
  document.getElementById("catalog").insertAdjacentHTML("afterbegin",
    `<div class="card"><strong>Pesanan terkirim ✅</strong><br>
     Nomor: <strong>${orderNumber}</strong><br>Kode akses: <strong>${accessCode}</strong><br>
     <span class="muted">Simpan kedua kode ini untuk melacak status di tab "Lacak Pesanan". Pesanan menunggu konfirmasi admin; stok belum dikurangi.</span></div>`);
}

/* ---------- Lacak pesanan ---------- */
document.getElementById("btnTrack").onclick = trackOrder;
async function trackOrder(){
  const num = document.getElementById("trackNum").value.trim().toUpperCase();
  const code = document.getElementById("trackCode").value.trim().toUpperCase();
  const out = document.getElementById("trackResult");
  if (!num || !code){ out.innerHTML = '<p class="muted">Isi nomor dan kode akses.</p>'; return; }
  const snap = await getDoc(doc(db, "orders", num));
  if (!snap.exists() || snap.data().accessCode !== code){ out.innerHTML = '<p class="muted">Pesanan tidak ditemukan atau kode salah.</p>'; return; }
  const o = snap.data();
  out.innerHTML = `<div class="row"><strong>${o.orderNumber}</strong><span class="badge ${o.status}">${statusLabel(o.status)}</span></div>
    <div class="muted" style="margin-top:4px;">Pembayaran: ${payLabel(o.paymentStatus)}</div>
    <div style="margin-top:8px;">${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join("<br>")}</div>
    <div class="row" style="margin-top:8px;"><span>Total</span><span class="price">${rp(o.total)}</span></div>`;
}

/* ---------- Admin: login ---------- */
document.getElementById("btnLogin").onclick = async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;
  const msg = document.getElementById("loginMsg");
  msg.textContent = "Memproses…";
  try { await signInWithEmailAndPassword(auth, email, pass); msg.textContent = ""; }
  catch (e){ msg.textContent = "Email atau kata sandi salah."; }
};
document.getElementById("btnLogout").onclick = () => signOut(auth);
document.getElementById("subProduk").onclick = () => showAdminSub("produk");
document.getElementById("subPesanan").onclick = () => showAdminSub("pesanan");

onAuthStateChanged(auth, user => {
  currentUser = user;
  const login = document.getElementById("adminLogin"), area = document.getElementById("adminArea");
  if (user){
    login.classList.add("hidden"); area.classList.remove("hidden");
    document.getElementById("adminWho").textContent = user.email;
    loadAdminProducts(); loadAdminOrders(); showAdminSub("pesanan");
  } else {
    login.classList.remove("hidden"); area.classList.add("hidden");
  }
});

function showAdminSub(which){
  document.getElementById("admin-produk").classList.toggle("hidden", which !== "produk");
  document.getElementById("admin-pesanan").classList.toggle("hidden", which !== "pesanan");
}

/* ---------- Admin: produk ---------- */
function loadAdminProducts(){
  onSnapshot(query(collection(db, "products"), orderBy("name")), snap => {
    allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAdminProducts(); renderSummary();
  });
}
function renderAdminProducts(){
  const el = document.getElementById("admin-produk");
  el.innerHTML = `<div class="card">
    <strong>Tambah Produk</strong>
    <label>Nama</label><input id="npName">
    <label>Kategori</label><input id="npCat">
    <label>Harga</label><input id="npPrice" type="number">
    <label>Satuan</label><input id="npUnit" placeholder="pcs, kg, botol...">
    <label>Stok awal</label><input id="npStock" type="number">
    <label>Ambang stok rendah</label><input id="npLow" type="number" value="5">
    <button class="btn" style="margin-top:10px;" id="btnAddProduct">Simpan Produk</button>
  </div>` + allProducts.map(p => `<div class="card">
    <div class="row"><strong>${esc(p.name)}</strong><span class="muted">${p.active ? "Aktif" : "Nonaktif"}</span></div>
    <div class="muted">${esc(p.category || "-")} · ${rp(p.price)} / ${esc(p.unit || "pcs")}</div>
    <label>Stok</label><input id="st-${p.id}" type="number" value="${p.stock}">
    <div class="row" style="margin-top:8px;gap:6px;">
      <button class="btn small" data-save="${p.id}">Update Stok</button>
      <button class="btn small secondary" data-toggle="${p.id}" data-val="${!p.active}">${p.active ? "Nonaktifkan" : "Aktifkan"}</button>
    </div></div>`).join("");
  document.getElementById("btnAddProduct").onclick = addProduct;
  el.querySelectorAll("[data-save]").forEach(b => b.onclick = () => saveStock(b.dataset.save));
  el.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => toggleActive(b.dataset.toggle, b.dataset.val === "true"));
}
async function addProduct(){
  const name = document.getElementById("npName").value.trim();
  const price = parseFloat(document.getElementById("npPrice").value);
  if (!name || isNaN(price) || price < 0){ alert("Nama dan harga wajib valid."); return; }
  await addDoc(collection(db, "products"), {
    name, category: document.getElementById("npCat").value.trim(),
    price, unit: document.getElementById("npUnit").value.trim() || "pcs",
    stock: parseInt(document.getElementById("npStock").value) || 0,
    lowStockThreshold: parseInt(document.getElementById("npLow").value) || 5,
    active: true, createdAt: serverTimestamp()
  });
}
async function saveStock(id){
  const v = parseInt(document.getElementById("st-" + id).value);
  if (isNaN(v) || v < 0){ alert("Stok tidak valid."); return; }
  await updateDoc(doc(db, "products", id), { stock: v });
}
async function toggleActive(id, val){ await updateDoc(doc(db, "products", id), { active: val }); }

/* ---------- Admin: pesanan ---------- */
function loadAdminOrders(){
  onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100)), snap => {
    allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAdminOrders(); renderSummary();
  });
}
function renderSummary(){
  const out = allProducts.filter(p => p.stock <= 0).length;
  const low = allProducts.filter(p => p.stock > 0 && p.stock <= (p.lowStockThreshold || 0)).length;
  const pend = allOrders.filter(o => o.status === "pending_confirmation").length;
  const paid = allOrders.filter(o => o.paymentStatus === "paid").length;
  document.getElementById("adminSummary").innerHTML =
    `<div class="row"><span>Produk aktif</span><strong>${allProducts.filter(p => p.active).length}</strong></div>
     <div class="row"><span>Stok habis / menipis</span><strong>${out} / ${low}</strong></div>
     <div class="row"><span>Pesanan menunggu konfirmasi</span><strong>${pend}</strong></div>
     <div class="row"><span>Pesanan sudah dibayar</span><strong>${paid}</strong></div>`;
}
function renderAdminOrders(){
  const el = document.getElementById("admin-pesanan");
  if (allOrders.length === 0){ el.innerHTML = '<p class="muted">Belum ada pesanan.</p>'; return; }
  el.innerHTML = allOrders.map(o => `<div class="card" data-order="${o.id}">
    <div class="row"><strong>${o.orderNumber}</strong><span class="badge ${o.status}">${statusLabel(o.status)}</span></div>
    <div class="muted">${esc(o.customerName)} · ${esc(o.customerPhone)} · ${o.fulfillment === "delivery" ? "Diantar" : "Ambil sendiri"}</div>
    <div style="margin-top:6px;">${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join("<br>")}</div>
    <div class="row" style="margin-top:6px;"><span>Total</span><span class="price">${rp(o.total)}</span></div>
    <div class="muted">Pembayaran: ${payLabel(o.paymentStatus)}</div>
    <div class="action-slot" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;"></div>
  </div>`).join("");
  el.querySelectorAll("[data-order]").forEach(card => {
    const o = allOrders.find(x => x.id === card.dataset.order);
    card.querySelector(".action-slot").innerHTML = adminActionsHtml(o);
    wireAdminActions(card, o);
  });
}
function adminActionsHtml(o){
  if (o.status === "pending_confirmation") return '<button class="btn small" data-act="confirm">Konfirmasi</button><button class="btn small danger" data-act="reject">Tolak</button>';
  if (o.status === "confirmed" && o.paymentStatus !== "paid") return '<button class="btn small" data-act="paid">Tandai Lunas (simulasi)</button>';
  if (o.status === "confirmed" && o.paymentStatus === "paid") return '<button class="btn small" data-act="processing">Mulai Diproses</button>';
  if (o.status === "processing") return '<button class="btn small" data-act="ready">Tandai Siap</button>';
  if (o.status === "ready" && o.fulfillment === "delivery") return '<button class="btn small" data-act="out_for_delivery">Kirim Sekarang</button>';
  if (o.status === "ready" || o.status === "out_for_delivery") return '<button class="btn small" data-act="completed">Tandai Selesai</button>';
  return "";
}
function wireAdminActions(card, o){
  card.querySelectorAll("[data-act]").forEach(b => b.onclick = () => handleAction(b.dataset.act, o));
}
async function addHistory(id, status){
  const ref = doc(db, "orders", id);
  const snap = await getDoc(ref);
  const hist = (snap.data().history || []).concat([{ status, at: new Date().toISOString() }]);
  await updateDoc(ref, { status, history: hist });
}
async function handleAction(act, o){
  if (act === "confirm"){
    for (const it of o.items){
      const p = await getDoc(doc(db, "products", it.productId));
      if (!p.exists() || p.data().stock < it.qty){ alert("Stok " + it.name + " tidak cukup lagi."); return; }
    }
    for (const it of o.items){
      const ref = doc(db, "products", it.productId);
      const p = await getDoc(ref);
      await updateDoc(ref, { stock: p.data().stock - it.qty });
    }
    const ref = doc(db, "orders", o.id);
    const hist = (o.history || []).concat([{ status: "confirmed", at: new Date().toISOString() }]);
    await updateDoc(ref, { status: "confirmed", paymentStatus: "pending", history: hist });
    return;
  }
  if (act === "reject"){ await addHistory(o.id, "rejected"); await updateDoc(doc(db, "orders", o.id), { paymentStatus: "cancelled" }); return; }
  if (act === "paid"){ await updateDoc(doc(db, "orders", o.id), { paymentStatus: "paid" }); return; }
  await addHistory(o.id, act); // processing, ready, out_for_delivery, completed
}

subscribeCatalog();
