# Project BetaKasir - Backend

Backend REST API untuk aplikasi kasir multi-tenant, multi-cabang, dan multi-role.  
Dibangun dengan Node.js, Express, dan MySQL.

---

## Fitur Utama

- Multi-owner, multi-cabang (store), multi-role (owner, admin, cashier)
- Manajemen produk, transaksi, dan user
- Sistem paket berlangganan (subscription)
- Otentikasi JWT
- Validasi input & error handling
- Siap untuk integrasi dengan aplikasi mobile (Flutter) & Electron JS
- **Fitur Laporan/Report lengkap dengan filter waktu dan laporan persisten**

---

## Struktur Folder

    src/
    ├── app.js
    ├── server.js
    ├── config/
    ├── controllers/
    ├── middleware/
    ├── models/
    ├── routes/
    ├── tests/
    ├── utils/
    └── validations/

---

## Environment Variables

Buat file `.env` di root project:

```
PORT=5000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=
DB_NAME=kasir_multi_tenant
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRE=1d
BCRYPT_SALT_ROUNDS=10
```

---

## API Endpoints

### AUTH

#### Login

- **POST** `/api/auth/login`
  - **Body:**
    ```json
    { "username": "admin", "password": "yourpassword" }
    ```
  - **Response:**
    ```json
    { "token": "..." }
    ```

---

## REPORTS (LAPORAN)

### 1. Summary Laporan Keuangan

- **GET** `/api/stores/:store_id/reports/summary?start=YYYY-MM-DD&end=YYYY-MM-DD`
  - **Headers:** Authorization: Bearer {token}
  - **Query Params:**
    - `start`: tanggal mulai (format YYYY-MM-DD)
    - `end`: tanggal akhir (format YYYY-MM-DD)
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "total_transaksi": 123,
        "total_pendapatan": 15000000,
        "total_diskon": 500000,
        "net_revenue": 14500000,
        "total_hpp": 9000000,
        "gross_profit": 5500000,
        "operational_cost": 0,
        "net_profit": 5500000,
        "margin": "37%",
        "best_sales_day": 2500000,
        "lowest_sales_day": 100000,
        "avg_daily": 500000,
        "top_products": [
          {
            "product_id": 1,
            "sku": "SKU001",
            "name": "Produk A",
            "sold": 50,
            "revenue": 500000
          }
        ],
        "stok_menipis": [
          {
            "id": 2,
            "name": "Produk B",
            "remaining": 3
          }
        ]
      }
    }
    ```

### 2. Laporan Produk

- **GET** `/api/stores/:store_id/reports/products?start=YYYY-MM-DD&end=YYYY-MM-DD`
  - **Headers:** Authorization: Bearer {token}
  - **Query Params:**
    - `start`: tanggal mulai (format YYYY-MM-DD)
    - `end`: tanggal akhir (format YYYY-MM-DD)
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "total_products": 120,
        "total_sold": 350,
        "top_products": [
          {
            "product_id": 1,
            "sku": "SKU001",
            "name": "Produk A",
            "sold": 50,
            "revenue": 500000
          }
        ],
        "stok_menipis": [
          {
            "id": 2,
            "name": "Produk B",
            "remaining": 3
          }
        ],
        "stok_habis": 4
      }
    }
    ```

### 3. Laporan Karyawan/Kasir

- **GET** `/api/stores/:store_id/reports/cashiers?start=YYYY-MM-DD&end=YYYY-MM-DD`
  - **Headers:** Authorization: Bearer {token}
  - **Query Params:**
    - `start`: tanggal mulai (format YYYY-MM-DD)
    - `end`: tanggal akhir (format YYYY-MM-DD)
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "total_karyawan": 5,
        "avg_performance": 20,
        "avg_attendance": 98.5,
        "cashiers": [
          {
            "id": 1,
            "name": "Kasir A",
            "role": "cashier",
            "total_transaksi": 30,
            "total_penjualan": 1500000
          }
        ]
      }
    }
    ```

### 4. Generate & Simpan Laporan Harian

- **POST** `/api/stores/:store_id/reports/daily/generate?date=YYYY-MM-DD`
  - **Headers:** Authorization: Bearer {token}
  - **Query Params:**
    - `date`: tanggal laporan (format YYYY-MM-DD)
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "message": "Laporan harian berhasil disimpan."
      }
    }
    ```

### 5. Ambil Laporan Harian

- **GET** `/api/stores/:store_id/reports/daily?date=YYYY-MM-DD`
  - **Headers:** Authorization: Bearer {token}
  - **Query Params:**
    - `date`: tanggal laporan (format YYYY-MM-DD)
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "id": 1,
        "store_id": 1,
        "report_date": "2025-12-16",
        "total_transactions": 20,
        "total_income": 2000000,
        "total_discount": 50000,
        "net_revenue": 1950000,
        "total_hpp": 1200000,
        "gross_profit": 750000,
        "operational_cost": 0,
        "net_profit": 750000,
        "margin": "38%",
        "best_sales_day": 2000000,
        "lowest_sales_day": 2000000,
        "avg_daily": 2000000,
        "created_at": "2025-12-16T23:59:59"
      }
    }
    ```

### 6. List Laporan Harian (Rentang Waktu)

- **GET** `/api/stores/:store_id/reports/daily/list?start=YYYY-MM-DD&end=YYYY-MM-DD`
  - **Headers:** Authorization: Bearer {token}
  - **Query Params:**
    - `start`: tanggal mulai (format YYYY-MM-DD)
    - `end`: tanggal akhir (format YYYY-MM-DD)
  - **Response:**
    ```json
    {
      "success": true,
      "data": [
        {
          "id": 1,
          "store_id": 1,
          "report_date": "2025-12-16",
          "total_transactions": 20,
          "total_income": 2000000,
          "total_discount": 50000,
          "net_revenue": 1950000,
          "total_hpp": 1200000,
          "gross_profit": 750000,
          "operational_cost": 0,
          "net_profit": 750000,
          "margin": "38%",
          "best_sales_day": 2000000,
          "lowest_sales_day": 2000000,
          "avg_daily": 2000000,
          "created_at": "2025-12-16T23:59:59"
        }
      ]
    }
    ```

### 7. Laporan Periodik (Mingguan/Bulanan/Tahunan)

- **GET** `/api/stores/:store_id/reports/periodic?type=weekly|monthly|yearly&start=YYYY-MM-DD&end=YYYY-MM-DD`
  - **Headers:** Authorization: Bearer {token}
  - **Query Params:**
    - `type`: weekly, monthly, yearly
    - `start`: tanggal mulai (format YYYY-MM-DD)
    - `end`: tanggal akhir (format YYYY-MM-DD)
  - **Response:**
    ```json
    {
      "success": true,
      "data": [
        {
          "period_start": "2025-12-01",
          "period_end": "2025-12-07",
          "total_transactions": 100,
          "total_income": 10000000,
          "total_discount": 200000,
          "net_revenue": 9800000,
          "total_hpp": 6000000,
          "gross_profit": 3800000,
          "operational_cost": 0,
          "net_profit": 3800000
        }
      ]
    }
    ```

---

### Mapping Filter Frontend ke Backend

| Filter Frontend | start (YYYY-MM-DD) | end (YYYY-MM-DD) |
| --------------- | ------------------ | ---------------- |
| Hari ini        | hari ini           | hari ini         |
| 7 hari          | hari ini - 6 hari  | hari ini         |
| 30 hari         | hari ini - 29 hari | hari ini         |
| 1 tahun         | hari ini - 1 tahun | hari ini         |
| Semua data      | tanggal awal data  | hari ini         |

---

### Database

- **Cukup 1 database per tenant/client** (multi-tenant).
- **Tabel utama untuk report:** `reports_daily` (sudah sesuai skema yang Anda punya).

---

**Dokumentasi ini siap digunakan untuk frontend Electron JS dan Flutter.  
Jika ada kebutuhan field tambahan, tinggal extend response di backend.**

### USERS (Manajemen Karyawan/Admin/Kasir)

#### List Karyawan/Admin/Kasir di Store

- **GET** `/api/stores/:store_id/users`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Array of user objects (role: admin/kasir) di store tersebut

#### Tambah Karyawan/Admin/Kasir ke Store

- **POST** `/api/stores/:store_id/users`
  - **Headers:** Authorization: Bearer {token}
  - **Akses:** Owner **dan** Admin
  - **Body:**
    ```json
    {
      "name": "Nama Karyawan",
      "username": "username",
      "password": "password",
      "role": "cashier" // atau "admin"
    }
    ```
  - **owner_id** diambil otomatis dari token login.

#### Update Data Karyawan/Admin/Kasir

- **PUT** `/api/users/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Body:** (fields yang ingin diupdate, misal:)
    ```json
    {
      "name": "Nama Baru",
      "username": "username_baru",
      "password": "password_baru",
      "role": "admin",
      "is_active": 1
    }
    ```
  - **Response:**
    ```json
    { "success": true, "message": "User berhasil diupdate" }
    ```

#### Nonaktifkan/Hapus Karyawan/Admin/Kasir

- **DELETE** `/api/users/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:**
    ```json
    { "success": true, "message": "User berhasil dinonaktifkan" }
    ```

---

### OWNERS

#### Get Owner Info

- **GET** `/api/owners/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Owner object

```json
{
  "success": true,
  "data": {
    "id": 1,
    "business_name": "PT Sukses Jaya",
    "email": "owner@email.com",
    "phone": "08123456789",
    "address": "Jl. Bisnis No. 1",
    "created_at": "2025-12-01 10:22:11"
  }
}
```

#### Update Owner Info (Edit Profil Bisnis)

**PUT** `/api/owners/:id`
**Headers:** Authorization: Bearer {token}
Body:

```json
{
  "business_name": "PT Sukses Jaya",
  "email": "owner@email.com",
  "phone": "08123456789",
  "address": "Jl. Bisnis No. 1"
}
```

- response

```json
{
  "success": true,
  "data": {
    "id": 1,
    "business_name": "PT Sukses Jaya",
    "email": "owner@email.com",
    "phone": "08123456789",
    "address": "Jl. Bisnis No. 1",
    "created_at": "2025-12-01 10:22:11"
  },
  "message": "Owner berhasil diupdate"
}
```

---

### STORES (CABANG)

#### List Stores

- **GET** `/api/stores`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Array of store objects

#### Create Store

- **POST** `/api/stores`
  - **Headers:** Authorization: Bearer {token}
  - **Body:**
    ```json
    {
      "owner_id": 1,
      "name": "Toko A",
      "address": "Alamat",
      "phone": "08123456789"
    }
    ```
  - **Response:** Store object

#### Get Store by ID

- **GET** `/api/stores/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Store object

#### Update Store

- **PUT** `/api/stores/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Body:** (fields to update)
  - **Response:** Updated store object

#### Delete Store

- **DELETE** `/api/stores/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Success message

#### Get Store Info (Toko/Bisnis)

- **GET** `/api/stores/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "id": 1,
        "owner_id": 10,
        "name": "Toko Sukses Jaya",
        "address": "Jl. Contoh No. 123, Jakarta, Indonesia",
        "phone": "+62 812-3456-7890",
        "receipt_template": "DEFAULT_TEMPLATE_V1",
        "created_at": "2025-12-01 10:22:11",
        "updated_at": "2025-12-15 19:05:45"
      }
    }
    ```

#### Update Store Info (Toko/Bisnis)

- **PUT** `/api/stores/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Body:**
    ```json
    {
      "name": "Nama Baru",
      "address": "Alamat Baru",
      "phone": "08123456789",
      "receipt_template": "TEMPLATE_BARU"
    }
    ```
  - **Response:** Updated store object

#### Get Receipt Template

- **GET** `/api/stores/:store_id/receipt-template`
  - **Headers:** Authorization: Bearer {token}
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "receipt_template": "TEMPLATE_BARU"
      },
      "message": "Template struk berhasil diambil"
    }
    ```

#### Set/Update Receipt Template

- **POST** `/api/stores/:store_id/receipt-template`
  - **Headers:** Authorization: Bearer {token}
  - **Body:**
    ```json
    {
      "receipt_template": "TEMPLATE_BARU"
    }
    ```
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "receipt_template": "TEMPLATE_BARU"
      },
      "message": "Template struk berhasil disimpan"
    }
    ```

---

### PRODUCTS

#### List Products in Store

- **GET** `/api/stores/:store_id/products`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Array of product objects
  ```json
  [
    {
      "id": 1,
      "name": "Indomie Goreng",
      "sku": "IND-001",
      "barcode": "1234567890123",
      "costPrice": 2500,
      "sellPrice": 3500,
      "stock": 100,
      "category": "Makanan & Minuman",
      "description": "Mi goreng favorit",
      "imageUrl": "https://...",
      "promoType": "percentage",
      "promoPercent": 10,
      "promoAmount": 10,
      "buyQty": 2,
      "freeQty": 1,
      "bundleQty": 3,
      "bundleTotalPrice": 5000,
      "isActive": 1,
      "createdAt": "2025-12-01 10:22:11",
      "updatedAt": "2025-12-15 19:05:45"
    }
  ]
  ```

#### Create Product

- **POST** `/api/stores/:store_id/products`
  - **Headers:** Authorization: Bearer {token}
  - **Body:**
    ```json
    {
      "name": "Nama Produk",
      "sku": "SKU001",
      "barcode": "1234567890123",
      "price": 10000,
      "cost_price": 8000,
      "stock": 10,
      "category": "Makanan & Minuman",
      "description": "Deskripsi produk",
      "image_url": "https://...",
      "promoType": "percentage",
      "promoPercent": 10,
      "promoAmount": 10,
      "buyQty": 2,
      "freeQty": 1,
      "bundleQty": 3,
      "bundleTotalPrice": 5000
    }
    ```
  - **Response:** Product object
    ```json
    {
      "success": true,
      "data": {
        "id": 2,
        "name": "Nama Produk",
        "sku": "SKU001",
        "barcode": "1234567890123",
        "costPrice": 8000,
        "sellPrice": 10000,
        "stock": 10,
        "category": "Makanan & Minuman",
        "description": "Deskripsi produk",
        "imageUrl": "https://...",
        "promoType": "percentage",
        "promoPercent": 10,
        "promoAmount": 10,
        "buyQty": 2,
        "freeQty": 1,
        "bundleQty": 3,
        "bundleTotalPrice": 5000,
        "isActive": 1,
        "createdAt": "2025-12-01 10:22:11",
        "updatedAt": "2025-12-15 19:05:45"
      },
      "message": "Produk berhasil ditambahkan"
    }
    ```

  ```

  ```

#### Get Product by ID

- **GET** `/api/stores/:store_id/products/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Product object
  ```json
  {
    "id": 2,
    "name": "Nama Produk",
    "sku": "SKU001",
    "barcode": "1234567890123",
    "costPrice": 8000,
    "sellPrice": 10000,
    "stock": 10,
    "category": "Makanan & Minuman",
    "description": "Deskripsi produk",
    "imageUrl": "https://...",
    "promoType": "percentage",
    "promoPercent": 10,
    "promoAmount": 10,
    "buyQty": 2,
    "freeQty": 1,
    "bundleQty": 3,
    "bundleTotalPrice": 5000,
    "isActive": 1,
    "createdAt": "2025-12-01 10:22:11",
    "updatedAt": "2025-12-15 19:05:45"
  }
  ```

#### Update Product

- **PUT** `/api/stores/:store_id/products/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Body:** (fields to update)
  - **Response:** Updated product object

#### Delete Product

- **DELETE** `/api/stores/:store_id/products/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Success message

#### Cari Produk Berdasarkan Barcode

- **GET** `/api/stores/:store_id/products/barcode/:barcode`
  - **Headers:** Authorization: Bearer {token}
  - **Response jika ditemukan:**
    ```json
    {
      "success": true,
      "data": {
        "id": 2,
        "name": "Nama Produk",
        "sku": "SKU001",
        "barcode": "1234567890123",
        "costPrice": 8000,
        "sellPrice": 10000,
        "stock": 10,
        "category": "Makanan & Minuman",
        "description": "Deskripsi produk",
        "imageUrl": "https://...",
        "promoType": "percentage",
        "promoPercent": 10,
        "promoAmount": 10,
        "buyQty": 2,
        "freeQty": 1,
        "bundleQty": 3,
        "bundleTotalPrice": 5000,
        "isActive": 1,
        "createdAt": "2025-12-01 10:22:11",
        "updatedAt": "2025-12-15 19:05:45"
      },
      "message": "Produk ditemukan"
    }
    ```
  - **Response jika tidak ditemukan:**
    ```json
    {
      "success": false,
      "message": "Produk dengan barcode ini belum terdaftar"
    }
    ```

#### Tambah Produk (dengan Barcode)

- **POST** `/api/stores/:store_id/products`
  - **Headers:** Authorization: Bearer {token}
  - **Body:**
    ```json
    {
      "name": "Nama Produk",
      "sku": "SKU001",
      "barcode": "1234567890123",
      "price": 10000,
      "stock": 10,
      "category": "Makanan & Minuman",
      "description": "Deskripsi produk",
      "image_url": "https://...",
      "jenis_diskon": null,
      "nilai_diskon": null,
      "diskon_bundle_min_qty": null,
      "diskon_bundle_value": null,
      "buy_qty": null,
      "free_qty": null
    }
    ```
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "id": 2,
        "store_id": 3,
        "name": "Nama Produk",
        "barcode": "1234567890123",
        ...
      },
      "message": "Produk berhasil ditambah"
    }
    ```

# Upload Gambar Produk

**POST** `/api/products/upload-image`
**Headers:** Authorization: Bearer {token}
**Body:** form-data
**image:** file gambar produk
**product_id:** ID produk yang akan diupdate gambarnya
**Response:**

```json
{
  "success": true,
  "image_url": "uploads/tenant_1/1702730000000-nama-gambar.jpg"
}
```

---

### TRANSACTIONS

#### List Transactions in Store

- **GET** `/api/stores/:store_id/transactions`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Array of transaction objects

#### Create Transaction

- **POST** `/api/stores/:store_id/transactions`
  - **Headers:** Authorization: Bearer {token}
  - **Body:**
    ```json
    {
      "cashier_id": 2,
      "payment_method": "cash",
      "total": 10000,
      "received": 15000,
      "change_amount": 5000,
      "customer_name": "Budi",
      "customer_phone": "08123456789",
      "notes": "Terima kasih",
      "items": [
        {
          "product_id": 1,
          "quantity": 2,
          "price": 5000
        }
      ]
    }
    ```
  - **Response:** Transaction object

#### Get Transaction by ID

- **GET** `/api/stores/:store_id/transactions/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:**
    ```json
    {
      "idFull": "TX000123",
      "createdAt": "2025-12-17T10:22:11.000Z",
      "method": "Tunai",
      "total": 15000,
      "received": 20000,
      "change": 5000,
      "items": [
        {
          "productId": 1,
          "name": "Indomie Goreng",
          "sku": "IND-001",
          "price": 3500,
          "qty": 2,
          "lineTotal": 7000
        }
      ]
    }
    ```

#### Update Transaction

- **PUT** `/api/stores/:store_id/transactions/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Body:** (fields to update)
  - **Response:** Updated transaction object

#### Delete Transaction

- **DELETE** `/api/stores/:store_id/transactions/:id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Success message

---

### SUBSCRIPTION (PAKET)

#### Get Active Subscription

- **GET** `/api/subscription`
  - **Headers:** Authorization: Bearer {token}
  - **Response:** Subscription object

#### Create/Update Subscription

- **POST** `/api/subscription`
  - **Headers:** Authorization: Bearer {token}
  - **Body:**
    ```json
    {
      "plan": "Pro",
      "start_date": "2025-12-01",
      "end_date": "2025-12-31"
    }
    ```
  - **Response:** Subscription object

---

### Backup & Import Data (Offline/Online)

#### Backup Data (Export)

- Buka aplikasi, masuk ke menu **Pengaturan > Backup/Export**.
- Klik **Export Data**.
- File backup (format JSON) akan tersimpan di perangkat.

#### Import Data

- Buka aplikasi, masuk ke menu **Pengaturan > Import Data**.
- Pilih file backup (format JSON) yang sudah diekspor sebelumnya.
- Data akan otomatis diimpor ke aplikasi.

#### Format File Backup

- File backup berupa JSON dengan struktur:
  ```json
  {
    "products": [ ... ],
    "transactions": [ ... ],
    "transaction_items": [ ... ],
    "users": [ ... ]
  }
  ```

---

## Testing

- Jalankan test dengan:
  npm test

- Contoh test ada di folder `tests/`

---

## Import Database

- Import file [kasir_multi_tenant.sql](http://_vscodecontentref_/0) ke MySQL sebelum menjalankan backend.

---

## Menjalankan Server

npm install
npm run dev

---

## Dokumentasi API Otomatis

- (Opsional) Integrasi Swagger: akses di `/docs` jika sudah di-setup.

---

## Kontribusi

Pull request dan issue sangat terbuka untuk pengembangan lebih lanjut.

---

## Lisensi

MIT

---

### REPORTS (LAPORAN)

#### Summary Laporan Keuangan

- **GET** `/api/stores/:store_id/reports/summary?start=YYYY-MM-DD&end=YYYY-MM-DD`
  - **Headers:** Authorization: Bearer {token}
  - **Query Params:**
    - `start`: tanggal mulai (format YYYY-MM-DD)
    - `end`: tanggal akhir (format YYYY-MM-DD)
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "total_transaksi": 10,
        "total_pendapatan": 1500000,
        "margin": 0,
        "top_products": [
          { "product_id": 1, "name": "Indomie Goreng", "total_terjual": 50 }
        ],
        "stok_menipis": [{ "id": 2, "name": "Aqua 600ml", "stock": 3 }]
      }
    }
    ```

#### Laporan Produk (Top Produk & Stok Menipis)

- **GET** `/api/stores/:store_id/reports/products`
  - **Headers:** Authorization: Bearer {token}
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "top_products": [
          { "product_id": 1, "name": "Indomie Goreng", "total_terjual": 50 }
        ],
        "stok_menipis": [{ "id": 2, "name": "Aqua 600ml", "stock": 3 }]
      }
    }
    ```

#### Laporan Kasir/Karyawan

- **GET** `/api/stores/:store_id/reports/cashiers`
  - **Headers:** Authorization: Bearer {token}
  - **Response:**
    ```json
    {
      "success": true,
      "data": [
        {
          "id": 2,
          "name": "Kasir Toko 1",
          "total_transaksi": 20,
          "total_penjualan": 500000
        }
      ]
    }
    ```

---

### INFO TOKO & SUBSCRIPTION

#### Info Toko

- **GET** `/api/stores/:store_id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "id": 1,
        "owner_id": 10,
        "name": "Toko Sukses Jaya",
        "address": "Jl. Contoh No. 123, Jakarta, Indonesia",
        "phone": "+62 812-3456-7890",
        "receipt_template": "DEFAULT_TEMPLATE_V1",
        "created_at": "2025-12-01 10:22:11",
        "updated_at": "2025-12-15 19:05:45"
      }
    }
    ```

#### Info Subscription (Plan & Billing)

- **GET** `/api/subscription/:owner_id`
  - **Headers:** Authorization: Bearer {token}
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "id": 1,
        "owner_id": 10,
        "status": "Aktif",
        "plan": "Pro",
        "start_date": "2025-12-01",
        "end_date": "2025-12-31",
        "created_at": "2025-12-01 10:22:11"
      }
    }
    ```

#### Get Business Profile (Owner Only)

- **GET** `/api/business-profile`
  - **Headers:** Authorization: Bearer {token}
  - **Response:**
    ```json
    {
      "success": true,
      "data": {
        "id": 1,
        "owner_id": 10,
        "name": "PT Sukses Jaya",
        "address": "Jl. Bisnis No. 1",
        "phone": "08123456789"
      }
    }
    ```

#### Update Business Profile (Owner Only)

- **PUT** `/api/business-profile`
  - **Headers:** Authorization: Bearer {token}
  - **Body:**
    ```json
    {
      "name": "PT Sukses Jaya",
      "address": "Jl. Bisnis No. 1",
      "phone": "08123456789"
    }
    ```
  - **Response:** Updated business profile object

#### Get/Update Store (Admin)

- **GET** `/api/stores/:id`
- **PUT** `/api/stores/:id`
  - (Hanya untuk admin/toko/cabang, tidak untuk owner)

---

## Custom Limit Paket & Cara Testing (Untuk Developer Backend)

### 1. Membuat/Mengubah Limit Paket Custom

- Jalankan script berikut di terminal:
  node create_custom_package.js
- Masukkan nama paket (misal: Eksklusif, Platinum, dsb).
- Masukkan batas produk, user, image, dan role sesuai permintaan klien.
- File `src/config/custom_package_limits.json` akan otomatis terupdate.

### 2. Membuat Akun Owner Baru

- Register owner via API/script/manual.
- Set plan owner ke nama paket yang di-custom (misal: Eksklusif).

### 3. Upgrade Paket Owner

- Ubah plan owner di database ke nama paket custom.
- Pastikan file limit sudah sesuai.
- (Opsional) Restart server jika backend cache file limit.

### 4. Validasi Limit di Controller

- Semua pengecekan limit produk/user/image sudah otomatis pakai utility:

```js
const { getPackageLimit, getRoleLimit } = require("../config/package_limits");
const productLimit = getPackageLimit(plan, "product_limit");
const imageLimit = getPackageLimit(plan, "image_limit");
const roleLimit = getRoleLimit(plan, role);
```

Tidak perlu hardcode limit di controller.

5. Testing Limit di Postman
   Login sebagai user dari paket custom.
   Tambah produk/user/gambar hingga limit, pastikan API menolak jika melebihi.
   Tambah di bawah limit, pastikan API menerima.
6. Validasi Upload Gambar Produk
   Pada endpoint upload gambar produk (/api/products/upload-image), backend akan otomatis menolak upload jika jumlah gambar produk sudah mencapai limit paket.
   Contoh response jika limit tercapai:
   Catatan:

File limit hanya bisa diubah oleh developer backend/server admin.
Tidak bisa diubah lewat API oleh user biasa.

# Manajemen Karyawan

3. Rekomendasi Tambahan
   Pastikan semua response konsisten (gunakan camelCase di frontend).
   Pastikan endpoint hanya bisa diakses oleh owner/admin (kasir ditolak).
   Pastikan validasi role & store_id/owner_id selalu dicek.

---

## Testing Manajemen Karyawan (User)

### 1. List User/Karyawan

#### a. Sebagai Owner

- **Request:**  
  `GET /api/stores/{store_id}/users`  
  (dengan token owner)
- **Hasil:**  
  Mendapatkan semua user/karyawan di seluruh toko milik owner.

#### b. Sebagai Admin

- **Request:**  
  `GET /api/stores/{store_id}/users`  
  (dengan token admin)
- **Hasil:**  
  Mendapatkan hanya user/karyawan di toko admin tersebut.

#### c. Sebagai Kasir

- **Request:**  
  `GET /api/stores/{store_id}/users`  
  (dengan token kasir)
- **Hasil:**  
  Response: 403 Forbidden, akses ditolak.

---

### 2. Tambah/Edit/Hapus User

- **Owner:** Bisa tambah/edit/hapus user di semua toko miliknya.
- **Admin:** Hanya bisa tambah/edit/hapus user di tokonya sendiri.
- **Kasir:** Tidak bisa tambah/edit/hapus user.

---

### 3. Contoh Response List User

```json
{
  "success": true,
  "data": [
    {
      "id": 2,
      "owner_id": 1,
      "store_id": 3,
      "name": "Admin Toko A",
      "username": "admina",
      "role": "admin",
      "is_active": 1
    },
    {
      "id": 3,
      "owner_id": 1,
      "store_id": 3,
      "name": "Kasir 1",
      "username": "kasir1",
      "role": "cashier",
      "is_active": 1
    }
  ]
}
```

4. Catatan
   Pastikan token JWT sesuai role saat testing.
   Gunakan Postman untuk mencoba semua endpoint di atas.
   Jika ada error "Akses ditolak", cek role dan store_id di token.

---

**Kesimpulan:**

- Backend sudah sesuai kebutuhan manajemen karyawan.
- Dokumentasi testing siap ditambahkan ke README.md.
- Siap lanjut ke fitur/penyesuaian berikutnya!

### Penambahan User (Admin/Karyawan) oleh Owner

- Endpoint: `POST /api/stores/:store_id/users`
- Jika owner hanya punya satu toko, store_id bisa dikosongkan (atau tidak diisi di URL), backend akan otomatis memilihkan toko tersebut.
- Jika owner punya lebih dari satu toko, owner wajib memilih toko (store_id) untuk user baru.
- Jika owner belum punya toko, proses gagal dan akan diminta membuat toko terlebih dahulu.

**Contoh:**

- Owner punya 1 toko:
  - Request: `POST /api/stores/users` (tanpa store_id di URL)
  - Backend otomatis pakai store_id toko tersebut.
- Owner punya >1 toko:
  - Request: `POST /api/stores/users` (tanpa store_id di URL)
  - Response: "Pilih toko/cabang untuk user baru"
- Owner belum punya toko:
  - Response: "Owner belum punya toko/cabang"

### Backup Data (Export)

- **Endpoint:** `GET /api/backup/export?type=all`
- **Query param:**
  - `type=all` (default): semua data (users, products, transactions, transaction_items)
  - `type=users`: hanya data user
  - `type=products`: hanya data produk
  - `type=transactions`: hanya data transaksi & detailnya

- **Headers:** Authorization: Bearer {token}
- **Response:** File JSON berisi data backup

**Contoh response (type=all):**

```json
{
  "users": [ ... ],
  "products": [ ... ],
  "transactions": [ ... ],
  "transaction_items": [ ... ]
}
```

### Import Data (Restore)

- **Endpoint:** `POST /api/backup/import`
- **Headers:** Authorization: Bearer {token}
- **Body:** File JSON hasil export (format sama dengan backup)
- **Proses:**
  - Data akan di-insert/update ke database tenant.
  - Jika data sudah ada (berdasarkan id/unique key), akan diupdate.
  - Jika data belum ada, akan diinsert.
- **Response:**
  ```json
  { "success": true, "message": "Import data berhasil" }
  ```

### Reset Data Tenant

- **Endpoint:** `DELETE /api/backup/reset`
- **Headers:** Authorization: Bearer {token}
- **Fungsi:** Menghapus semua data produk, karyawan (kecuali owner), transaksi, dan detail transaksi di database tenant.
- **Data owner tidak dihapus** (karena owner diambil dari database utama).
- **Response:**
  ```json
  {
    "success": true,
    "message": "Semua data berhasil direset, kecuali data owner."
  }
  ```

---

## 4. **Catatan**

- **Hanya data di tenant yang dihapus.**
- **Data owner tetap aman** (tidak dihapus).
- **Pastikan endpoint ini hanya bisa diakses oleh owner/admin!**

---

**Dengan ini, fitur reset data tenant sudah siap digunakan!**

---

## Arsitektur Offline-Online & Sinkronisasi Data

### Arsitektur

    +-------------------+         INTERNET        +-------------------+
    |   Device/Client   | <---------------------> |       Server      |
    |  (Mobile/Web/PC)  |                         |  (MySQL/MariaDB)  |
    +-------------------+                         +-------------------+
    | - SQLite Lokal    |                         | - Multi-tenant    |
    | - offline_db.sql  |                         | - kasir_tenant_X  |
    +-------------------+                         +-------------------+

### Flow Sinkronisasi

1. **Saat Online**
   - Semua transaksi, produk, dsb. langsung ke server via API.
   - Data di server (MySQL) selalu up-to-date.

2. **Saat Offline**
   - Semua transaksi, produk, dsb. disimpan di SQLite lokal (offline_db.sql).
   - Data baru diberi flag `unsynced` (misal: `is_synced = 0`).

3. **Saat Koneksi Kembali**
   - Aplikasi cek data `is_synced = 0` di SQLite.
   - Kirim data satu per satu ke server via API.
   - Jika sukses, update flag jadi `is_synced = 1`.
   - Jika gagal, tetap di queue untuk dicoba lagi nanti.

### Catatan

- **Database offline (SQLite)** hanya ada di device user, tidak dibuat otomatis oleh backend.
- **register_client.js** hanya membuat database tenant di server (MySQL).
- **Struktur tabel di SQLite sebaiknya mirip dengan MySQL** agar sinkronisasi mudah.
- **Keamanan:** Data offline di device harus diamankan (enkripsi, proteksi device).
- **Konflik data:** Jika ada perubahan data yang sama di beberapa device saat offline, perlu strategi merge/resolve saat sinkronisasi.

---

### Sinkronisasi Offline-Online (Client)

- Setiap device/user memiliki file SQLite sendiri (offline_db.db), disimpan di device (bukan di server).
- Data transaksi/produk baru disimpan ke SQLite saat offline.
- Saat online, aplikasi akan:
  - Membaca data yang belum sinkron (`is_synced = 0`)
  - Mengirim data ke server via API
  - Jika sukses, update flag `is_synced = 1`
- File SQLite **tidak pernah diupload ke server**. Hanya data baru yang dikirim via API.
- Penempatan file:
  - Android/iOS: folder aplikasi (otomatis oleh library SQLite)
  - Desktop: folder user (misal, AppData/Roaming/YourApp)
  - Web: IndexedDB (bukan file fisik)

Log Aktivitas (Activity Log)

# Fitur

Semua aktivitas penting user (login, tambah/edit/hapus produk, transaksi, update pengaturan, manajemen user, backup/import/reset data) dicatat otomatis di tabel activity_logs pada database tenant.
Semua role (owner, admin, cashier) bisa melihat log aktivitas di tenant/cabang yang sama.

```sql
CREATE TABLE IF NOT EXISTS activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  store_id INT,
  action VARCHAR(64),
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Endpoint API

```sh
GET /api/stores/:store_id/activity-logs
Headers: Authorization: Bearer {token}
Response: Array log aktivitas terbaru (limit 50, urut terbaru)
```

Contoh response:

```json
[
  {
    "id": 1,
    "user": "Admin Toko",
    "action": "login",
    "title": "Login berhasil",
    "detail": "Login berhasil",
    "time": "2025-12-18 09:00:00"
  },
  {
    "id": 2,
    "user": "Kasir 1",
    "action": "transaction",
    "title": "Transaksi dibuat",
    "detail": "Transaksi baru, total: Rp10000",
    "time": "2025-12-18 09:10:00"
  }
]
```

Catatan
Tabel activity_logs hanya ada di database tenant (bukan di database utama).
Sudah otomatis dibuat saat tenant baru dibuat (via register_client.js).
Untuk tenant lama, jalankan SQL di atas secara manual.
Log aktivitas otomatis tercatat di backend pada setiap aksi penting.

Simulasi & Testing Upload Gambar Produk
Endpoint
POST /api/products/upload-image
Headers: Authorization: Bearer {token}
Body: form-data
image: file gambar produk
product_id: ID produk yang akan diupdate gambarnya
Langkah Testing di Postman
Login sebagai admin/owner, dapatkan token.
Pilih method POST, URL /api/products/upload-image.
Tambahkan header Authorization.
Pilih body form-data, upload file gambar dan isi product_id.
Klik Send.
Jika sukses, response:

```json
{
  "success": true,
  "image_url": "uploads/tenant_1/1702730000000-nama-gambar.jpg"
}
```

Catatan
Hanya owner/admin yang bisa upload gambar produk.
Path gambar disimpan di kolom image_url pada tabel products.

Arsitektur & Flow Sinkronisasi Offline-Online
Arsitektur

    +-------------------+         INTERNET        +-------------------+
    |   Device/Client   | <---------------------> |      Server       |
    | (Mobile/Web/PC)   |                         |   (MySQL/MariaDB) |
    +-------------------+                         +-------------------+
    |  - SQLite Lokal   |                         |  - Multi-tenant   |
    |  - offline_db.sql |                         |  - kasir_tenant_X |
    +-------------------+                         +-------------------+

Flow Sinkronisasi
Saat Online
Semua transaksi, produk, dsb. langsung ke server via API.
Saat Offline
Semua transaksi, produk, dsb. disimpan di SQLite lokal (offline_db.sql).
Data baru diberi flag is_synced = 0.
Saat Koneksi Kembali
Aplikasi cek data is_synced = 0 di SQLite.
Kirim data ke server via API.
Jika sukses, update flag jadi is_synced = 1

Catatan
Database offline (SQLite) hanya ada di device user, tidak dibuat otomatis oleh backend.
register_client.js hanya membuat database tenant di server (MySQL).
Struktur tabel di SQLite sebaiknya mirip dengan MySQL agar sinkronisasi mudah.
Data offline di device harus diamankan (enkripsi, proteksi device).
Jika ada perubahan data yang sama di beberapa device saat offline, perlu strategi merge/resolve saat sinkronisasi.
Sinkronisasi Offline-Online (Client)
Setiap device/user memiliki file SQLite sendiri (offline_db.db), disimpan di device (bukan di server).
Data transaksi/produk baru disimpan ke SQLite saat offline.
Saat online, aplikasi akan:
Membaca data yang belum sinkron (is_synced = 0)
Mengirim data ke server via API
Jika sukses, update flag is_synced = 1
File SQLite tidak pernah diupload ke server. Hanya data baru yang dikirim via API.

Penempatan file:
Android/iOS: folder aplikasi (otomatis oleh library SQLite)
Desktop: folder user (misal, AppData/Roaming/YourApp)
Web: IndexedDB (bukan file fisik)

Fitur Pajak Toko & Transaksi
Penambahan Kolom Pajak
Tabel stores
Tambahkan kolom:

tax_percentage (DECIMAL, default 0)
Menyimpan persentase pajak toko/bisnis yang akan diterapkan pada setiap transaksi.
Tabel transactions
Tambahkan kolom:

tax (DECIMAL, default 0)
Menyimpan nominal pajak pada transaksi tersebut.
tax_percentage (DECIMAL, default 0)
Menyimpan persentase pajak yang digunakan pada transaksi (agar histori tetap valid jika pengaturan pajak toko berubah).
grand_total (opsional, bisa dikalkulasi di backend/frontend)
Total akhir transaksi setelah pajak dan diskon.
Contoh SQL:

ALTER TABLE stores ADD COLUMN tax_percentage DECIMAL(5,2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN tax DECIMAL(12,2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN tax_percentage DECIMAL(5,2) DEFAULT 0;

API Terkait Pajak
Get/Update Info Toko (Pajak)

GET /api/stores/:id
Response akan mengandung field tax_percentage.
PUT /api/stores/:id
Body dapat mengandung field tax_percentage untuk mengubah persentase pajak toko.

Create Transaction (Dengan Pajak)
POST /api/stores/:store_id/transactions
Backend akan otomatis mengambil tax_percentage dari tabel stores, menghitung nominal pajak (tax), dan menyimpan kedua nilai tersebut di tabel transactions.
Response transaksi akan mengandung field:
tax
tax_percentage
grand_total

Get Transaction
GET /api/stores/:store_id/transactions/:id
Response akan mengandung field pajak (tax, tax_percentage, grand_total).

```json
{
  "success": true,
  "data": {
    "id": 123,
    "total": 100000,
    "tax_percentage": 10,
    "tax": 10000,
    "grand_total": 110000,
    "created_at": "2025-12-19T10:00:00Z",
    ...
  }
}
```

Catatan Implementasi
Frontend:
Tampilkan dan izinkan edit tax_percentage di halaman pengaturan toko/bisnis.
Saat menampilkan detail transaksi, tampilkan juga nominal pajak dan total akhir.
Backend:
Pastikan field baru (tax_percentage, tax, grand_total) sudah di-handle di model, controller, dan response API.
Jangan pernah mengirim nilai undefined ke query MySQL, gunakan angka atau null.

Testing Pajak di Postman

1. Update Pajak Toko
   Endpoint: PUT /api/stores/:id
   Body:

   ```json
   {
     "name": "Toko Beta",
     "tax_percentage": 10
   }
   ```

2. Buat Transaksi
   Endpoint: POST /api/stores/:store_id/transactions
   Body:
   ```json
   {
     "cashier_id": 2,
     "payment_method": "cash",
     "total": 100000,
     "received": 120000,
     "change_amount": 20000,
     "items": [{ "product_id": 1, "quantity": 2, "price": 50000 }]
   }
   ```
   Response akan mengandung field tax, tax_percentage, dan grand_total.
   Cek Detail Transaksi

Endpoint: GET /api/stores/:store_id/transactions/:id
Pastikan field pajak muncul di response.
Field Baru yang Perlu Diketahui
Store: tax_percentage
Transaction: tax, tax_percentage, grand_total
