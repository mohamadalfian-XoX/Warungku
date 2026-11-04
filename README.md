# WarungKu

Website pemesanan & manajemen stok warung. Bisa diakses siapa saja lewat GitHub Pages (gratis), dengan data produk/stok/pesanan yang sama untuk semua orang (disimpan di Firebase, juga gratis).

## Kenapa butuh Firebase?

GitHub Pages cuma menyimpan dan menampilkan file HTML/CSS/JS — tidak ada database di dalamnya. Supaya semua pengunjung melihat katalog & stok yang sama, dan pesanan tersimpan permanen, website ini disambungkan ke **Firebase Firestore** (database gratis dari Google yang memang didesain dipakai langsung dari browser). Kamu perlu buat 1 project Firebase gratis (5 menit, tidak perlu kartu kredit untuk pemakaian skala warung).

## Langkah 1 — Buat project Firebase

1. Buka https://console.firebase.google.com, login pakai akun Google.
2. Klik **Add project**, kasih nama bebas (mis. `warungku`), lanjut sampai selesai (Google Analytics boleh dimatikan).

## Langkah 2 — Aktifkan Firestore Database

1. Di sidebar kiri, klik **Build > Firestore Database** > **Create database**.
2. Pilih lokasi server (mis. `asia-southeast2 (Jakarta)`), mode **Production**.
3. Setelah dibuat, buka tab **Rules**, hapus isinya, lalu tempel isi file `firestore.rules` yang sudah disediakan di folder ini. Klik **Publish**.

## Langkah 3 — Aktifkan login Admin

1. Sidebar kiri, klik **Build > Authentication > Get started**.
2. Di tab **Sign-in method**, aktifkan **Email/Password**.
3. Pindah ke tab **Users**, klik **Add user**. Isi email & password — ini akun yang kamu pakai untuk login di tab "Admin" website nanti.

## Langkah 4 — Ambil config Firebase

1. Klik ikon gerigi ⚙️ di sidebar > **Project settings**.
2. Scroll ke bawah ke bagian **Your apps**, klik ikon web `</>`.
3. Kasih nama app bebas, klik **Register app** (tidak perlu Firebase Hosting).
4. Akan muncul kode berisi objek `firebaseConfig = { apiKey: ..., ... }`. Salin semua nilainya.
5. Buka file `firebase-config.js` di folder ini, ganti semua `GANTI_DENGAN_...` dengan nilai yang kamu salin tadi. Simpan.

## Langkah 5 — Upload ke GitHub

**Cara termudah (tanpa command line):**
1. Buka https://github.com, login/daftar, klik **New repository**. Beri nama (mis. `warungku`), set **Public**, buat tanpa README (karena sudah ada).
2. Di halaman repo kosong, klik **uploading an existing file**.
3. Drag & drop semua file di folder ini (`index.html`, `style.css`, `app.js`, `firebase-config.js`, `firestore.rules`, `README.md`) sekaligus.
4. Klik **Commit changes**.

## Langkah 6 — Aktifkan GitHub Pages

1. Di repo, buka **Settings > Pages**.
2. Di **Source**, pilih **Deploy from a branch** → branch `main`, folder `/ (root)` → **Save**.
3. Tunggu 1-2 menit, lalu buka link yang muncul (bentuknya `https://namakamu.github.io/warungku/`). Itu website-nya, sudah bisa diakses semua orang.

## Cara pakai

- **Toko**: pelanggan pilih produk, checkout tanpa perlu akun, dapat nomor pesanan + kode akses.
- **Lacak Pesanan**: pelanggan cek status pakai nomor + kode akses tadi.
- **Admin**: login pakai akun yang dibuat di Langkah 3. Dari sini kelola produk/stok dan konfirmasi/tolak pesanan masuk — stok baru berkurang setelah pesanan dikonfirmasi.

## Keterbatasan yang perlu kamu tahu

- **Pembayaran**: belum tersambung ke payment gateway asli (Midtrans/Xendit/dll — itu butuh server & API key berbayar/terdaftar). Tombol "Tandai Lunas (simulasi)" adalah tempat nanti payment gateway sungguhan dipasang.
- **Pengurangan stok saat konfirmasi** dicek berurutan, bukan transaksi database atomik penuh. Cukup aman kalau admin yang mengonfirmasi cuma satu/sedikit orang; untuk skala lebih besar sebaiknya dipindah ke backend sungguhan.
- Siapa pun yang tahu nomor pesanan + kode akses bisa melihat pesanan itu (bukan berbasis login) — sesuai desain "checkout tanpa akun" di PRD, tapi pastikan kode akses tidak disebar sembarangan.
- Biaya kirim masih nilai tetap Rp5.000 (placeholder) — ganti sendiri di `app.js` kalau mau pakai perhitungan lain.
