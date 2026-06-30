const master = require('../config/knexMaster'); // Menggunakan koneksi master Knex Anda
const { getTenantConnection } = require('../config/knexTenant');

const toNumber = (value) => Number(value || 0);

const dayDiffFromNow = (dateValue) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

const mapTopupRow = (row) => ({
  id: row.id,
  owner_id: row.owner_id,
  nama_toko: row.nama_toko,
  amount: toNumber(row.amount),
  admin_fee: toNumber(row.admin_fee),
  total_amount: toNumber(row.total_amount || row.amount),
  status: row.status,
  payment_method: row.payment_method,
  bank_code: row.bank_code,
  channel_code: row.channel_code,
  va_number: row.va_number,
  xendit_id: row.xendit_id,
  created_at: row.created_at,
  paid_at: row.paid_at,
  expired_at: row.expired_at,
});

const QUICK_RANGE_CONFIG = {
  today: { label: 'Hari Ini', days: 1 },
  '7d': { label: '7 Hari', days: 7 },
  '30d': { label: '1 Bulan', days: 30 },
  '90d': { label: '3 Bulan', days: 90 },
  all: { label: 'All Time', days: null },
};

const normalizeQuickRange = (value) => {
  const key = String(value || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(QUICK_RANGE_CONFIG, key) ? key : null;
};

const resolveRangeBounds = (rangeValue, fallbackDays = 7) => {
  const normalized = normalizeQuickRange(rangeValue);
  if (normalized === 'all') {
    return { key: 'all', label: QUICK_RANGE_CONFIG.all.label, start: null, end: null };
  }

  const days = normalized
    ? QUICK_RANGE_CONFIG[normalized].days
    : (Number.isFinite(fallbackDays) && fallbackDays > 0 ? fallbackDays : 7);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const key = normalized || (days === 1 ? 'today' : `${days}d`);
  const label = QUICK_RANGE_CONFIG[normalized || '7d']?.label || `${days} Hari`;

  return { key, label, start, end };
};

const applyDateRange = (query, column, rangeValue, fallbackDays = 7) => {
  const range = resolveRangeBounds(rangeValue, fallbackDays);
  if (range.start && range.end) {
    const pad = (n) => String(n).padStart(2, '0');
    const formatSql = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    query.whereBetween(column, [formatSql(range.start), formatSql(range.end)]);
  }
  return range;
};

const normalizeTransactionStatus = (detail) => {
  if (!detail) return 'Sukses';
  if (detail.status === 'pending' || detail.payment_status === 'pending') return 'Pending';
  if (detail.status === 'failed' || detail.payment_status === 'failed') return 'Gagal';
  return 'Sukses';
};

const matchesStatusFilter = (status, statusFilter) => {
  if (!statusFilter || statusFilter === 'Semua') return true;
  return String(status || '').toLowerCase() === String(statusFilter).toLowerCase();
};

const matchesTransactionSearch = (row, query) => {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return true;

  return [
    row?.tanggal,
    row?.nama_toko,
    row?.tipe,
    row?.produk,
    row?.no_tujuan,
    row?.ref_id,
    row?.metode_pembayaran,
    row?.status,
  ].some((value) => String(value || '').toLowerCase().includes(term));
};

const buildTransactionStatsFromRows = (rows) => ({
  total: rows.length,
  pos: rows.filter((row) => String(row.tipe || '').toLowerCase().includes('pos')).length,
  ppob: rows.filter((row) => String(row.tipe || '').toLowerCase().includes('ppob')).length,
  pending: rows.filter((row) => row.status === 'Pending').length,
  laba: rows.reduce((sum, row) => sum + toNumber(row.laba), 0),
});

const formatDateKey = (dateValue) => {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildDateSeries = (startDate, endDate) => {
  const dates = [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);
  cursor.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
};

const enrichTransactionLogs = async (logs) => {
  if (!Array.isArray(logs) || logs.length === 0) return [];

  const formattedData = [];
  const uniqueMap = new Map();
  const uniqueOwnerIds = [...new Set(logs.map((log) => log.owner_id).filter(Boolean))];
  const tenants = uniqueOwnerIds.length
    ? await master('tenants').whereIn('owner_id', uniqueOwnerIds)
    : [];
  const tenantMap = new Map(tenants.map((tenant) => [tenant.owner_id, tenant]));

  const logsWithDetails = await Promise.all(
    logs.map(async (log) => {
      let detail = null;
      try {
        const tenantInfo = tenantMap.get(log.owner_id);
        if (tenantInfo?.db_name) {
          const clientDb = getTenantConnection({
            db_name: tenantInfo.db_name,
            db_user: tenantInfo.db_user,
            db_pass: tenantInfo.db_pass,
          });

          if (log.reference_type === 'transactions' && log.reference_id) {
            detail = await clientDb('transactions').where('id', log.reference_id).first();
          } else if (log.reference_type === 'ppob_orders' && log.reference_id) {
            detail = await clientDb('ppob_orders').where('id', log.reference_id).first();
          }
        }
      } catch (error) {
        detail = null;
      }
      return { log, detail };
    })
  );

  for (const { log, detail } of logsWithDetails) {
    let tipe = log.reference_type === 'transactions'
      ? 'POS'
      : (log.reference_type === 'ppob_orders' ? 'PPOB' : log.tipe);

    const status = normalizeTransactionStatus(detail);
    let laba = Math.abs(parseFloat(log.amount)) || 0;
    let grandTotal = detail ? parseFloat(detail.total_cost || detail.amount || detail.sale_price || detail.price || 0) : 0;
    let hargaModal = detail ? parseFloat(detail.capital_price || detail.amount || detail.price || 0) : 0;

    if (log.tipe === 'topup' || tipe === 'topup') {
      grandTotal = Math.abs(parseFloat(log.amount)) || 0;
      laba = 0;
      hargaModal = 0;
    }

    if (log.reference_type === 'ppob_orders') {
      tipe = 'PPOB';
      const uniqueKey = `ppob-${log.owner_id}-${log.reference_id}`;

      if (!uniqueMap.has(uniqueKey)) {
        uniqueMap.set(uniqueKey, {
          id: log.id,
          tanggal: log.tanggal,
          nama_toko: log.nama_toko,
          tipe,
          produk: detail ? (detail.product_name || detail.description || log.produk) : log.produk,
          no_tujuan: detail ? (detail.target_number || '-') : '-',
          ref_id: log.reference_id || '-',
          harga_modal: hargaModal,
          tax: detail ? parseFloat(detail.tax || 0) : 0,
          grand_total: grandTotal,
          laba: 0,
          metode_pembayaran: detail ? (detail.payment_method || '-') : '-',
          status,
        });
        formattedData.push(uniqueMap.get(uniqueKey));
      }

      const entry = uniqueMap.get(uniqueKey);
      if (['transaction_fee', 'ppob_margin', 'ppob_fee'].includes(log.tipe)) {
        entry.laba += laba;
      }
      continue;
    }

    formattedData.push({
      id: log.id,
      tanggal: log.tanggal,
      nama_toko: log.nama_toko,
      tipe,
      produk: detail ? (detail.product_name || detail.description || log.produk) : log.produk,
      no_tujuan: detail ? (detail.target_number || '-') : '-',
      ref_id: log.reference_id || '-',
      harga_modal: hargaModal,
      tax: detail ? parseFloat(detail.tax || 0) : 0,
      grand_total: grandTotal,
      laba,
      metode_pembayaran: detail ? (detail.payment_method || '-') : '-',
      status,
    });
  }

  return formattedData;
};

// ============================================
// 1. MANAJEMEN KLIEN / MITRA TOKO
// ============================================

exports.getClients = async (req, res) => {
  try {
    const owners = await master('owners')
      .select(
        'id',
        'business_name as nama_toko',
        'business_name as nama_owner',
        'email',
        'phone as no_hp',
        'address as alamat',
        'wallet_balance as saldo_dompet',
        'status',
        'created_at as tanggal_gabung'
      )
      .orderBy('created_at', 'desc');

    res.status(200).json({ success: true, data: owners });
  } catch (error) {
    console.error("Error getClients:", error);
    res.status(500).json({ success: false, message: "Terjadi kesalahan pada server" });
  }
};

exports.getClientSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const owner = await master('owners as o')
      .leftJoin('tenants as t', 'o.id', 't.owner_id')
      .where('o.id', id)
      .select(
        'o.id',
        'o.business_name as nama_toko',
        'o.business_category',
        'o.email',
        'o.phone as no_hp',
        'o.address as alamat',
        'o.wallet_balance as saldo_dompet',
        'o.status',
        'o.created_at as tanggal_gabung',
        'o.updated_at as updated_at',
        't.id as tenant_id',
        't.db_name',
        't.db_user',
        't.db_pass'
      )
      .first();

    if (!owner) {
      return res.status(404).json({ success: false, message: 'Mitra tidak ditemukan' });
    }

    const walletStatsRow = await master('wallet_transactions')
      .where('owner_id', owner.id)
      .select(
        master.raw('COUNT(*) as total_wallet_mutations'),
        master.raw("COUNT(CASE WHEN reference_type = 'transactions' THEN 1 END) as pos_fee_count"),
        master.raw("COUNT(DISTINCT CASE WHEN reference_type = 'ppob_orders' THEN reference_id END) as ppob_count"),
        master.raw("COALESCE(SUM(CASE WHEN type IN ('transaction_fee', 'ppob_margin', 'ppob_fee') THEN ABS(amount) ELSE 0 END), 0) as total_admin_profit"),
        master.raw('MAX(created_at) as last_wallet_activity_at')
      )
      .first();

    const topupStatsRow = await master('wallet_topups')
      .where('owner_id', owner.id)
      .select(
        master.raw('COUNT(*) as total_topup_count'),
        master.raw("COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_topup_count"),
        master.raw("COUNT(CASE WHEN status = 'success' THEN 1 END) as success_topup_count"),
        master.raw("COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_topup_count"),
        master.raw("COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0) as total_success_topup"),
        master.raw("COALESCE(SUM(CASE WHEN status = 'pending' THEN COALESCE(total_amount, amount) ELSE 0 END), 0) as total_pending_topup_bill"),
        master.raw('MAX(COALESCE(paid_at, created_at)) as last_topup_at')
      )
      .first();

    const recentTopups = await master('wallet_topups as wt')
      .join('owners as o', 'o.id', 'wt.owner_id')
      .where('wt.owner_id', owner.id)
      .select(
        'wt.id',
        'wt.owner_id',
        'o.business_name as nama_toko',
        'wt.amount',
        'wt.admin_fee',
        'wt.total_amount',
        'wt.status',
        'wt.payment_method',
        'wt.bank_code',
        'wt.channel_code',
        'wt.va_number',
        'wt.xendit_id',
        'wt.created_at',
        'wt.paid_at',
        'wt.expired_at'
      )
      .orderBy('wt.created_at', 'desc')
      .limit(10);

    const recentWalletTransactions = await master('wallet_transactions')
      .where('owner_id', owner.id)
      .select(
        'id',
        'type',
        'amount',
        'balance_after',
        'reference_type',
        'reference_id',
        'description',
        'created_at'
      )
      .orderBy('created_at', 'desc')
      .limit(10);

    const tenantData = {
      stores: [],
      pos: {
        total_count: 0,
        total_amount: 0,
        paid_count: 0,
        pending_count: 0,
        refunded_count: 0,
        last_transaction_at: null,
      },
      ppob: {
        total_count: 0,
        total_amount: 0,
        success_count: 0,
        pending_count: 0,
        failed_count: 0,
        last_transaction_at: null,
      },
      recent_pos: [],
      recent_ppob: [],
      error: null,
    };

    if (owner.db_name && owner.db_user) {
      try {
        const tenantDb = getTenantConnection({
          db_name: owner.db_name,
          db_user: owner.db_user,
          db_pass: owner.db_pass,
        });

        const stores = await tenantDb('stores')
          .select('id', 'name', 'type', 'address', 'phone', 'created_at', 'updated_at')
          .orderBy('id', 'asc')
          .catch(() => []);

        const posByStore = await tenantDb('transactions')
          .select('store_id')
          .count('* as pos_count')
          .sum({ pos_total: 'total_cost' })
          .max({ last_pos_at: 'created_at' })
          .groupBy('store_id')
          .catch(() => []);

        const ppobByStore = await tenantDb('ppob_orders')
          .select('store_id')
          .count('* as ppob_count')
          .sum({ ppob_total: 'sale_price' })
          .max({ last_ppob_at: 'created_at' })
          .groupBy('store_id')
          .catch(() => []);

        const posByStoreMap = new Map(posByStore.map((row) => [Number(row.store_id), row]));
        const ppobByStoreMap = new Map(ppobByStore.map((row) => [Number(row.store_id), row]));

        tenantData.stores = stores.map((store) => {
          const pos = posByStoreMap.get(Number(store.id)) || {};
          const ppob = ppobByStoreMap.get(Number(store.id)) || {};
          const lastDates = [pos.last_pos_at, ppob.last_ppob_at]
            .filter(Boolean)
            .map((value) => new Date(value))
            .filter((date) => !Number.isNaN(date.getTime()));
          return {
            ...store,
            pos_count: parseInt(pos.pos_count || 0, 10),
            pos_total: toNumber(pos.pos_total),
            ppob_count: parseInt(ppob.ppob_count || 0, 10),
            ppob_total: toNumber(ppob.ppob_total),
            last_activity_at: lastDates.length
              ? new Date(Math.max(...lastDates.map((date) => date.getTime()))).toISOString()
              : null,
          };
        });

        tenantData.pos = await tenantDb('transactions')
          .select(
            tenantDb.raw('COUNT(*) as total_count'),
            tenantDb.raw('COALESCE(SUM(total_cost), 0) as total_amount'),
            tenantDb.raw("COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as paid_count"),
            tenantDb.raw("COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_count"),
            tenantDb.raw("COUNT(CASE WHEN payment_status = 'refunded' THEN 1 END) as refunded_count"),
            tenantDb.raw('MAX(created_at) as last_transaction_at')
          )
          .first()
          .catch(() => tenantData.pos);

        tenantData.ppob = await tenantDb('ppob_orders')
          .select(
            tenantDb.raw('COUNT(*) as total_count'),
            tenantDb.raw('COALESCE(SUM(sale_price), 0) as total_amount'),
            tenantDb.raw("COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count"),
            tenantDb.raw("COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count"),
            tenantDb.raw("COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count"),
            tenantDb.raw('MAX(created_at) as last_transaction_at')
          )
          .first()
          .catch(() => tenantData.ppob);

        tenantData.recent_pos = await tenantDb('transactions as tr')
          .leftJoin('stores as s', 's.id', 'tr.store_id')
          .select(
            'tr.id',
            's.name as store_name',
            'tr.total_cost',
            'tr.payment_method',
            'tr.payment_status',
            'tr.customer_name',
            'tr.created_at'
          )
          .orderBy('tr.created_at', 'desc')
          .limit(8)
          .catch(() => []);

        tenantData.recent_ppob = await tenantDb('ppob_orders as po')
          .leftJoin('stores as s', 's.id', 'po.store_id')
          .select(
            'po.id',
            's.name as store_name',
            'po.product_name',
            'po.buyer_sku_code',
            'po.customer_no',
            'po.sale_price',
            'po.status',
            'po.created_at'
          )
          .orderBy('po.created_at', 'desc')
          .limit(8)
          .catch(() => []);
      } catch (tenantError) {
        tenantData.error = tenantError.message;
      }
    }

    const candidateActivityDates = [
      walletStatsRow?.last_wallet_activity_at,
      topupStatsRow?.last_topup_at,
      tenantData.pos?.last_transaction_at,
      tenantData.ppob?.last_transaction_at,
    ].filter(Boolean).map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime()));

    const lastActivityDate = candidateActivityDates.length
      ? new Date(Math.max(...candidateActivityDates.map((date) => date.getTime())))
      : null;

    const statusLower = String(owner.status || '').toLowerCase();
    const isActive = statusLower === 'active' || statusLower === 'aktif';

    res.json({
      success: true,
      data: {
        client: {
          id: owner.id,
          nama_toko: owner.nama_toko,
          business_category: owner.business_category,
          email: owner.email,
          no_hp: owner.no_hp,
          alamat: owner.alamat,
          saldo_dompet: toNumber(owner.saldo_dompet),
          status: owner.status,
          tanggal_gabung: owner.tanggal_gabung,
          updated_at: owner.updated_at,
          tenant_id: owner.tenant_id,
        },
        summary: {
          wallet_mutations: parseInt(walletStatsRow?.total_wallet_mutations || 0, 10),
          pos_fee_count: parseInt(walletStatsRow?.pos_fee_count || 0, 10),
          ppob_count: parseInt(walletStatsRow?.ppob_count || 0, 10),
          total_admin_profit: toNumber(walletStatsRow?.total_admin_profit),
          total_topup_count: parseInt(topupStatsRow?.total_topup_count || 0, 10),
          success_topup_count: parseInt(topupStatsRow?.success_topup_count || 0, 10),
          pending_topup_count: parseInt(topupStatsRow?.pending_topup_count || 0, 10),
          failed_topup_count: parseInt(topupStatsRow?.failed_topup_count || 0, 10),
          total_success_topup: toNumber(topupStatsRow?.total_success_topup),
          total_pending_topup_bill: toNumber(topupStatsRow?.total_pending_topup_bill),
          last_activity_at: lastActivityDate ? lastActivityDate.toISOString() : null,
          inactive_days: dayDiffFromNow(lastActivityDate),
          suspended_days: isActive ? null : dayDiffFromNow(owner.updated_at || owner.tanggal_gabung),
        },
        tenant: {
          ...tenantData,
          pos: {
            total_count: parseInt(tenantData.pos?.total_count || 0, 10),
            total_amount: toNumber(tenantData.pos?.total_amount),
            paid_count: parseInt(tenantData.pos?.paid_count || 0, 10),
            pending_count: parseInt(tenantData.pos?.pending_count || 0, 10),
            refunded_count: parseInt(tenantData.pos?.refunded_count || 0, 10),
            last_transaction_at: tenantData.pos?.last_transaction_at || null,
          },
          ppob: {
            total_count: parseInt(tenantData.ppob?.total_count || 0, 10),
            total_amount: toNumber(tenantData.ppob?.total_amount),
            success_count: parseInt(tenantData.ppob?.success_count || 0, 10),
            pending_count: parseInt(tenantData.ppob?.pending_count || 0, 10),
            failed_count: parseInt(tenantData.ppob?.failed_count || 0, 10),
            last_transaction_at: tenantData.ppob?.last_transaction_at || null,
          },
        },
        recent_topups: recentTopups.map(mapTopupRow),
        recent_wallet_transactions: recentWalletTransactions.map((row) => ({
          ...row,
          amount: toNumber(row.amount),
          balance_after: toNumber(row.balance_after),
        })),
      },
    });
  } catch (error) {
    console.error('Error getClientSummary:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil rekap mitra' });
  }
};

exports.getTopupHistory = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const search = String(req.query.search || '').trim();

    let query = master('wallet_topups as wt').join('owners as o', 'o.id', 'wt.owner_id');

    if (status && status !== 'Semua') {
      query = query.where('wt.status', status);
    }

    if (search) {
      query = query.where(function () {
        this.where('o.business_name', 'like', `%${search}%`)
          .orWhere('wt.payment_method', 'like', `%${search}%`)
          .orWhere('wt.bank_code', 'like', `%${search}%`)
          .orWhere('wt.channel_code', 'like', `%${search}%`)
          .orWhere('wt.va_number', 'like', `%${search}%`)
          .orWhere('wt.xendit_id', 'like', `%${search}%`);
      });
    }

    const countRow = await query.clone().count('wt.id as total').first();
    const total = parseInt(countRow?.total || 0, 10);

    const rows = await query.clone()
      .select(
        'wt.id',
        'wt.owner_id',
        'o.business_name as nama_toko',
        'wt.amount',
        'wt.admin_fee',
        'wt.total_amount',
        'wt.status',
        'wt.payment_method',
        'wt.bank_code',
        'wt.channel_code',
        'wt.va_number',
        'wt.xendit_id',
        'wt.created_at',
        'wt.paid_at',
        'wt.expired_at'
      )
      .orderBy('wt.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const statsRow = await master('wallet_topups')
      .select(
        master.raw('COUNT(*) as total_count'),
        master.raw("COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count"),
        master.raw("COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count"),
        master.raw("COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count"),
        master.raw("COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0) as success_amount"),
        master.raw("COALESCE(SUM(CASE WHEN status = 'pending' THEN COALESCE(total_amount, amount) ELSE 0 END), 0) as pending_bill_amount"),
        master.raw('COALESCE(SUM(admin_fee), 0) as admin_fee_total')
      )
      .first();

    res.json({
      success: true,
      total,
      page,
      limit,
      stats: {
        total: parseInt(statsRow?.total_count || 0, 10),
        pending: parseInt(statsRow?.pending_count || 0, 10),
        success: parseInt(statsRow?.success_count || 0, 10),
        failed: parseInt(statsRow?.failed_count || 0, 10),
        success_amount: toNumber(statsRow?.success_amount),
        pending_bill_amount: toNumber(statsRow?.pending_bill_amount),
        admin_fee_total: toNumber(statsRow?.admin_fee_total),
      },
      data: rows.map(mapTopupRow),
    });
  } catch (error) {
    console.error('Error getTopupHistory:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil riwayat topup' });
  }
};

// ============================================
// APP SETTINGS
// ============================================

exports.getAppSettings = async (req, res) => {
  try {
    const settingsRaw = await master("app_settings").select("setting_key", "setting_value");
    const settings = {};
    settingsRaw.forEach(item => {
      settings[item.setting_key] = item.setting_value;
    });

    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    console.error("Error getAppSettings:", error);
    res.status(500).json({ success: false, message: "Gagal mengambil pengaturan" });
  }
};

exports.updateAppSettings = async (req, res) => {
  try {
    const updates = req.body; // { bank_name: "BCA", ... }
    
    // Gunakan transaksi atau simpan satu-satu
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'string') {
        await master.raw(
          `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?`,
          [key, value, value]
        );
      }
    }

    res.status(200).json({ success: true, message: "Pengaturan berhasil disimpan" });
  } catch (error) {
    console.error("Error updateAppSettings:", error);
    res.status(500).json({ success: false, message: "Gagal menyimpan pengaturan" });
  }
};

exports.createClient = async (req, res) => {
  try {
    const { nama_toko, nama_owner, email, no_hp, alamat } = req.body;

    const [id] = await master('owners').insert({
      business_name: nama_toko,
      email: email,
      phone: no_hp,
      address: alamat,
      status: 'active',
      wallet_balance: 0
    });

    const newOwner = await master('owners').where('id', id).first();

    res.status(201).json({
      success: true,
      message: "Mitra berhasil ditambahkan",
      data: {
        id: newOwner.id,
        nama_toko: newOwner.business_name,
        nama_owner: newOwner.business_name, // Sementara disamakan
        email: newOwner.email,
        no_hp: newOwner.phone,
        alamat: newOwner.address,
        saldo_dompet: newOwner.wallet_balance,
        status: 'Aktif'
      }
    });
  } catch (error) {
    console.error("Error createClient:", error);
    res.status(500).json({ success: false, message: "Gagal menambahkan mitra" });
  }
};

exports.updateClientStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const dbStatus = status === 'Aktif' ? 'active' : 'suspended';

    await master('owners').where('id', id).update({
      status: dbStatus,
      updated_at: new Date()
    });

    res.status(200).json({ success: true, message: `Status mitra berhasil diubah menjadi ${status}` });
  } catch (error) {
    console.error("Error updateClientStatus:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui status" });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_toko, email, no_hp, alamat } = req.body;

    await master('owners').where('id', id).update({
      business_name: nama_toko,
      email: email,
      phone: no_hp,
      address: alamat,
      updated_at: new Date()
    });

    res.status(200).json({ success: true, message: "Data mitra berhasil diperbarui" });
  } catch (error) {
    console.error("Error updateClient:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui data mitra" });
  }
};


// ============================================
// 2. DASHBOARD & STATISTIK
// ============================================

exports.getDashboardStats = async (req, res) => {
  try {
    // 1. Dapatkan Statistik Mitra & Saldo (Gunakan SUM agar lebih akurat)
    const owners = await master("owners").select('status', 'wallet_balance');
    const saldoRow = await master("owners").sum('wallet_balance as total').first();

    let aktif = 0, suspend = 0, blokir = 0;
    let saldoMitra = parseFloat(saldoRow?.total || 0);

    owners.forEach(c => {
      const statusLower = String(c.status || '').toLowerCase();
      if (statusLower === 'active' || statusLower === 'aktif') aktif++;
      else if (statusLower === 'suspended' || statusLower === 'suspend') suspend++;
      else blokir++;
    });

    // 2. Tarik Saldo Asli Perusahaan dari Digiflazz
    let saldoDigiflazz = 0;
    try {
      const axios = require('axios');
      const crypto = require('crypto');
      const username = process.env.DIGIFLAZZ_USERNAME;
      const key = process.env.DIGIFLAZZ_API_KEY || process.env.DIGIFLAZZ_DEV_KEY || process.env.DIGIFLAZZ_PRODUCTION_KEY;
      
      if (username && key) {
         const sign = crypto.createHash('md5').update(username + key + "depo").digest('hex');
         const digiRes = await axios.post('https://api.digiflazz.com/v1/cek-saldo', { cmd: 'deposit', username, sign });
         if (digiRes.data && digiRes.data.data) {
            saldoDigiflazz = digiRes.data.data.deposit || 0;
         }
      }
    } catch(e) {
      console.error("Gagal menarik saldo Digiflazz:", e.message);
    }

    // 3. Hitung Total Transaksi
    let totalTransaksiAllTime = 0;
    let totalTransaksiHariIni = 0;
    try {
       const today = new Date();
       today.setHours(0,0,0,0);
       
       const txCountAll = await master("wallet_transactions").count('* as total').first();
       totalTransaksiAllTime = txCountAll.total || 0;
       
       const txCountToday = await master("wallet_transactions")
          .where('created_at', '>=', today)
          .count('* as total').first();
       totalTransaksiHariIni = txCountToday.total || 0;
    } catch(e) {
       console.error("Gagal menghitung transaksi:", e.message);
    }

    // 4. Kirimkan Data ke Frontend
    res.status(200).json({
      success: true,
      data: {
        saldoDigiflazz,
        saldoMitra, 
        totalTransaksiAllTime, 
        totalTransaksiHariIni, 
        mitraAktif: aktif, 
        mitraSuspend: suspend, 
        mitraBlokir: blokir 
      }
    });
  } catch (error) {
    console.error("Error getDashboardStats:", error);
    res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
};

exports.getDashboardChart = async (req, res) => {
  try {
    const chartData = await master.raw(`
      SELECT 
        DATE_FORMAT(created_at, '%a') as hari_en,
        DATE(created_at) as tgl,
        SUM(ABS(amount)) as laba
      FROM wallet_transactions
      WHERE type IN ('transaction_fee', 'ppob_margin', 'ppob_fee')
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY tgl, hari_en
      ORDER BY tgl ASC
    `);

    const dayMap = {
      'Sun': 'Min', 'Mon': 'Sen', 'Tue': 'Sel', 
      'Wed': 'Rab', 'Thu': 'Kam', 'Fri': 'Jum', 'Sat': 'Sab'
    };

    const formattedData = chartData[0].map(item => ({
      hari: dayMap[item.hari_en] || item.hari_en,
      laba: item.laba
    }));

    res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Error getDashboardChart:", error);
    res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
};


// ============================================
// 3. RIWAYAT TRANSAKSI (VERSI ENRICHED DYNAMIC)
// ============================================

exports.getTransactions = async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const page   = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const typeFilter = req.query.type;
    const searchFilter = String(req.query.search || '').trim();
    const statusFilter = String(req.query.status || 'Semua');
    const rangeFilter = String(req.query.range || 'all').toLowerCase();
    const hasSearchFilter = searchFilter.length > 0;

    let baseQuery = master('wallet_transactions as wt').join('owners as o', 'o.id', 'wt.owner_id');

    if (typeFilter === 'POS') {
      baseQuery = baseQuery.where('wt.reference_type', 'transactions');
    } else if (typeFilter === 'PPOB') {
      baseQuery = baseQuery.where('wt.reference_type', 'ppob_orders');
    }

    const rangeInfo = applyDateRange(baseQuery, 'wt.created_at', rangeFilter, 7);
    const selectColumns = [
      'wt.id',
      master.raw("DATE_FORMAT(wt.created_at, '%Y-%m-%d %H:%i') as tanggal"),
      'o.business_name as nama_toko',
      'wt.type as tipe',
      'wt.description as produk',
      'wt.amount',
      'wt.balance_after',
      'wt.reference_type',
      'wt.reference_id',
      'o.id as owner_id',
    ];

    if (statusFilter !== 'Semua' || hasSearchFilter) {
      const expandedLimit = Math.min(Math.max(page * limit * 16, 1000), 10000);
      const candidateLogs = await baseQuery.clone()
        .select(selectColumns)
        .orderBy('wt.created_at', 'desc')
        .limit(expandedLimit);

      const formattedData = await enrichTransactionLogs(candidateLogs);
      const filteredData = formattedData.filter((row) => (
        matchesStatusFilter(row.status, statusFilter)
        && matchesTransactionSearch(row, searchFilter)
      ));
      const pagedData = filteredData.slice(offset, offset + limit);
      const stats = buildTransactionStatsFromRows(filteredData);

      return res.json({
        success: true,
        total: filteredData.length,
        stats,
        range: rangeInfo.key,
        data: pagedData,
      });
    }

    const statsRow = await baseQuery.clone()
      .select(
        master.raw(`
          COUNT(DISTINCT CASE
            WHEN wt.reference_type IN ('transactions', 'ppob_orders') AND wt.reference_id IS NOT NULL
              THEN CONCAT(wt.reference_type, '-', wt.reference_id)
            ELSE CONCAT('wallet-', wt.id)
          END) as total_count
        `),
        master.raw(`
          COUNT(DISTINCT CASE
            WHEN wt.reference_type = 'transactions' AND wt.reference_id IS NOT NULL
              THEN CONCAT('transactions-', wt.reference_id)
          END) as pos_count
        `),
        master.raw(`
          COUNT(DISTINCT CASE
            WHEN wt.reference_type = 'ppob_orders' AND wt.reference_id IS NOT NULL
              THEN CONCAT('ppob_orders-', wt.reference_id)
          END) as ppob_count
        `),
        master.raw("COALESCE(SUM(CASE WHEN wt.type IN ('transaction_fee', 'ppob_margin', 'ppob_fee') THEN ABS(wt.amount) ELSE 0 END), 0) as total_laba")
      )
      .first();

    const total = parseInt(statsRow?.total_count || 0, 10);
    const logs = await baseQuery.clone()
      .select(selectColumns)
      .orderBy('wt.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const formattedData = await enrichTransactionLogs(logs);
    const stats = {
      total,
      pos: parseInt(statsRow?.pos_count || 0, 10),
      ppob: parseInt(statsRow?.ppob_count || 0, 10),
      pending: 0,
      laba: toNumber(statsRow?.total_laba),
    };

    res.json({ success: true, total, stats, range: rangeInfo.key, data: formattedData });
  } catch (e) {
    console.error('getTransactions error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};


// ============================================
// 4. SETTING LAYANAN GLOBAL
// ============================================

exports.getServices = async (req, res) => {
  try {
    const services = await master('services').select(
      'id', 
      'name', 
      'description as desc', // ALIAS PENTING: Menyesuaikan database ke Frontend
      'is_active'
    );
    const mapped = services.map(s => ({ ...s, is_active: !!s.is_active }));
    res.status(200).json({ success: true, data: mapped });
  } catch (error) {
    res.status(500).json({ success: false, message: "Gagal memuat layanan" });
  }
};

exports.updateServiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body; 

    await master('services').where('id', id).update({ is_active: is_active ? 1 : 0 });
    res.status(200).json({ success: true, message: "Status layanan diperbarui" });
  } catch (error) {
    console.error("Error updateServiceStatus:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui status layanan" });
  }
};


// ============================================
// 5. MANAJEMEN PRODUK & MARGIN
// ============================================

exports.getProducts = async (req, res) => {
  try {
    const { type } = req.query; 
    
    let query = master('ppob_products').select(
      'id',
      'product_name as nama',
      'category as kategori',
      'buyer_sku_code as sku',
      'price as harga_modal',
      'type',
      'margin'
    );

    if (type) {
      query = query.where('type', type);
    }

    const products = await query;
    const mappedProducts = products.map(p => ({
      ...p,
      margin: p.margin !== null ? parseFloat(p.margin) : 500 
    }));

    res.status(200).json({ success: true, data: mappedProducts });
  } catch (error) {
    console.error("Error getProducts:", error);
    res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
};

exports.updateProductMargin = async (req, res) => {
  try {
    const { id } = req.params;
    const { margin } = req.body;
    
    await master('ppob_products').where('id', id).update({ margin, updated_at: new Date() });
    res.status(200).json({ success: true, message: "Margin produk berhasil diperbarui" });
  } catch (error) {
    console.error("Error updateProductMargin:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui margin" });
  }
};


// ============================================
// 6. SETTING BIAYA POS (ADMINISTRASI APP)
// ============================================

exports.getPosFee = async (req, res) => {
  try {
    const setting = await master('settings').where('setting_key', 'pos_fee').first();
    // Ambil nilai dari setting_value, jika kosong default ke 150
    const fee = setting ? parseFloat(setting.setting_value) : 150;
    res.status(200).json({ success: true, data: { fee } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Gagal memuat biaya POS" });
  }
};

exports.updatePosFee = async (req, res) => {
  try {
    const { fee } = req.body;
    
    const exists = await master('settings').where('setting_key', 'pos_fee').first();
    if (exists) {
      await master('settings').where('setting_key', 'pos_fee').update({ setting_value: fee.toString() });
    } else {
      await master('settings').insert({ setting_key: 'pos_fee', setting_value: fee.toString() });
    }
    
    res.status(200).json({ success: true, message: "Biaya POS berhasil diperbarui" });
  } catch (error) {
    console.error("Error updatePosFee:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui biaya POS" });
  }
};

// ============================================
// BIAYA ADMIN BULANAN (dipotong dari saldo tiap tanggal 1)
// ============================================

exports.getMonthlyFee = async (req, res) => {
  try {
    const setting = await master('settings').where('setting_key', 'monthly_admin_fee').first();
    const fee = setting ? parseFloat(setting.setting_value) : 10000; // default 10.000
    res.status(200).json({ success: true, data: { fee } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Gagal memuat biaya admin bulanan" });
  }
};

exports.updateMonthlyFee = async (req, res) => {
  try {
    const fee = parseInt(req.body.fee, 10);
    if (isNaN(fee) || fee < 0) {
      return res.status(400).json({ success: false, message: "Nilai biaya tidak valid" });
    }

    const exists = await master('settings').where('setting_key', 'monthly_admin_fee').first();
    if (exists) {
      await master('settings').where('setting_key', 'monthly_admin_fee').update({ setting_value: fee.toString() });
    } else {
      await master('settings').insert({ setting_key: 'monthly_admin_fee', setting_value: fee.toString() });
    }

    res.status(200).json({ success: true, message: "Biaya admin bulanan berhasil diperbarui" });
  } catch (error) {
    console.error("Error updateMonthlyFee:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui biaya admin bulanan" });
  }
};

// Menghapus Mitra beserta data terkait (Tenants, Users, Wallet)
exports.deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    // Menggunakan query transaction agar aman (jika ada yg gagal, semua dibatalkan)
    await master.transaction(async (trx) => {
      // 1. Ambil daftar tenant_id milik owner ini
      const tenants = await trx('tenants').where('owner_id', id).select('id');
      const tenantIds = tenants.map(t => t.id);

      // 2. Hapus data users yang menginduk ke tenant tersebut
      if (tenantIds.length > 0) {
        await trx('users').whereIn('tenant_id', tenantIds).del();
      }

      // 3. Hapus data tenants
      await trx('tenants').where('owner_id', id).del();

      // 4. Hapus data wallet dompet
      await trx('wallet_topups').where('owner_id', id).del();
      await trx('wallet_transactions').where('owner_id', id).del();

      // 5. Terakhir, setelah semua dependensi bersih, hapus owner-nya
      await trx('owners').where('id', id).del();
    });

    res.status(200).json({ success: true, message: "Mitra dan data terkait berhasil dihapus" });
  } catch (error) {
    console.error("Error deleteClient:", error);
    res.status(500).json({ success: false, message: "Gagal menghapus mitra karena masih ada data yang terikat" });
  }
};

const bcrypt = require('bcryptjs'); // Pastikan package ini sudah di-install

// ============================================
// 7. MANAJEMEN PROFIL SUPERADMIN
// ============================================

exports.getProfile = async (req, res) => {
  try {
    // 🔒 Ambil HANYA akun superadmin yang sedang login (bukan sembarang superadmin)
    const admin = await master('users').where('id', req.user.id).first();

    if (!admin) {
        return res.status(404).json({ success: false, message: "Admin tidak ditemukan" });
    }

    res.status(200).json({ 
      success: true, 
      data: {
        id: admin.id,
        name: admin.name || "John Admin",
        email: admin.email
      } 
    });
  } catch (error) {
    console.error("Error getProfile:", error);
    res.status(500).json({ success: false, message: "Gagal memuat profil admin" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;
    
    // 🔒 Update HANYA akun superadmin yang sedang login (cegah ubah semua superadmin)
    await master('users').where('id', req.user.id).update({
      name: name,
      email: email,
      updated_at: new Date()
    });

    res.status(200).json({ success: true, message: "Profil berhasil diperbarui" });
  } catch (error) {
    console.error("Error updateProfile:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui profil admin" });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const admin = await master('users').where('id', req.user.id).first();
    if (!admin) {
        return res.status(404).json({ success: false, message: "Admin tidak ditemukan" });
    }

    // Verifikasi password saat ini
    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Password saat ini tidak cocok" });
    }

    // Hash password baru
    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(newPassword, salt);

    // 🔒 Ubah HANYA password akun yang sedang login
    await master('users').where('id', req.user.id).update({
      password: hashPassword,
      updated_at: new Date()
    });

    res.status(200).json({ success: true, message: "Password berhasil diperbarui" });
  } catch (error) {
    console.error("Error updatePassword:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui password admin" });
  }
};

// LEADERBOARD (Top Mitra & Top PPOB)
exports.getLeaderboard = async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [yr, mo] = month.split('-').map(Number);
    const lastDay = new Date(yr, mo, 0).getDate(); // hari terakhir bulan (benar utk Feb/30 hari)
    const startDate = `${month}-01 00:00:00`;
    const endDate   = `${month}-${String(lastDay).padStart(2, '0')} 23:59:59`;

    // 1. Top 5 Mitra Paling Aktif Bulan Ini
    // KITA KEMBALIKAN 'transaction_fee' agar transaksi POS kasir (seperti Abijaya) terhitung!
    // Hanya buang ppob_margin dan ppob_fee agar tidak dihitung dua kali
    const topMitra = await master('wallet_transactions as wt')
      .join('owners as o', 'o.id', 'wt.owner_id')
      .whereBetween('wt.created_at', [startDate, endDate])
      .whereNotIn('wt.type', ['ppob_margin', 'ppob_fee']) 
      .select('o.id', 'o.business_name')
      .count('wt.id as total_trx')
      .groupBy('o.id', 'o.business_name')
      .orderByRaw('COUNT(wt.id) DESC')
      .limit(5);

    // 2. Top 5 Produk PPOB Terlaris Bulan Ini
    const ppobTransactions = await master('wallet_transactions as wt')
      .where('wt.reference_type', 'ppob_orders')
      .whereNotIn('wt.type', ['transaction_fee', 'ppob_margin', 'ppob_fee'])
      .whereBetween('wt.created_at', [startDate, endDate])
      .select('wt.description');

    const productCounts = {};
    for (let trx of ppobTransactions) {
       const match = trx.description.match(/PPOB\s+([^\s]+)\s+untuk/i);
       let sku = match ? match[1] : trx.description; 
       
       if (!productCounts[sku]) {
          productCounts[sku] = 0;
       }
       productCounts[sku]++;
    }

    const sortedSkus = Object.keys(productCounts)
       .map(sku => ({ sku, total_sold: productCounts[sku] }))
       .sort((a, b) => b.total_sold - a.total_sold)
       .slice(0, 5);

    const topProducts = [];
    for (let item of sortedSkus) {
      const productDetail = await master('ppob_products')
        .whereRaw('LOWER(buyer_sku_code) = ?', [item.sku.toLowerCase()])
        .first();

      topProducts.push({
        product_name: productDetail ? productDetail.product_name : item.sku,
        total_sold: item.total_sold,
        buyer_sku_code: item.sku,
        category: productDetail ? productDetail.category : 'PPOB'
      });
    }

    res.json({
      success: true,
      data: { topMitra, topProducts }
    });

  } catch (e) {
    console.error('getLeaderboard error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};


// REKONSILIASI
exports.getReconciliation = async (req, res) => {
  try {
    const fallbackDays = parseInt(req.query.days, 10) || 7;
    const rangeInfo = resolveRangeBounds(req.query.range, fallbackDays);
    const topupQuery = master('wallet_topups').where('status', 'success');
    const purchaseQuery = master('wallet_transactions').whereIn('type', ['ppob_purchase']);

    if (rangeInfo.start && rangeInfo.end) {
      const pad = (n) => String(n).padStart(2, '0');
      const formatSql = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      
      topupQuery.whereBetween('paid_at', [formatSql(rangeInfo.start), formatSql(rangeInfo.end)]);
      purchaseQuery.whereBetween('created_at', [formatSql(rangeInfo.start), formatSql(rangeInfo.end)]);
    }

    const [topupRows, purchaseRows] = await Promise.all([
      topupQuery.clone()
        .select(
          master.raw('DATE(paid_at) as tanggal'),
          master.raw('COALESCE(SUM(amount), 0) as total'),
          master.raw('COUNT(*) as cnt')
        )
        .groupBy('tanggal')
        .orderBy('tanggal', 'asc'),
      purchaseQuery.clone()
        .select(
          master.raw('DATE(created_at) as tanggal'),
          master.raw('COALESCE(SUM(ABS(amount)), 0) as total'),
          master.raw('COUNT(*) as cnt')
        )
        .groupBy('tanggal')
        .orderBy('tanggal', 'asc'),
    ]);

    let startDate = rangeInfo.start;
    let endDate = rangeInfo.end;
    if (!startDate || !endDate) {
      const topupDates = topupRows.map((row) => new Date(row.tanggal));
      const purchaseDates = purchaseRows.map((row) => new Date(row.tanggal));
      const allDates = [...topupDates, ...purchaseDates].filter((date) => !Number.isNaN(date.getTime()));
      if (allDates.length === 0) {
        startDate = new Date();
        endDate = new Date();
      } else {
        startDate = new Date(Math.min(...allDates.map((date) => date.getTime())));
        endDate = new Date(Math.max(...allDates.map((date) => date.getTime())));
      }
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    }

    const topupMap = new Map(
      topupRows.map((row) => [
        formatDateKey(row.tanggal),
        { total: toNumber(row.total), count: parseInt(row.cnt || 0, 10) },
      ])
    );
    const purchaseMap = new Map(
      purchaseRows.map((row) => [
        formatDateKey(row.tanggal),
        { total: toNumber(row.total), count: parseInt(row.cnt || 0, 10) },
      ])
    );

    const rows = buildDateSeries(startDate, endDate).map((date) => {
      const dateKey = formatDateKey(date);
      const topup = topupMap.get(dateKey) || { total: 0, count: 0 };
      const purchase = purchaseMap.get(dateKey) || { total: 0, count: 0 };
      return {
        date: dateKey,
        totalTopup: topup.total,
        topupCount: topup.count,
        totalPurchase: purchase.total,
        purchaseCount: purchase.count,
      };
    });

    res.json({ success: true, range: rangeInfo.key, data: rows });
  } catch (e) {
    console.error('Reconciliation error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};

// AUDIT LOG
exports.getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20, module } = req.query;
    const offset = (page - 1) * limit;
    let q = master('admin_logs').orderBy('created_at', 'desc').limit(limit).offset(offset);
    if (module) q = q.where('module', module);
    const logs = await q;
    res.json({ success: true, data: logs });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// LAPORAN BULANAN
// LAPORAN BULANAN
exports.getMonthlyReport = async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [yr, mo] = month.split('-').map(Number);
    const lastDay = new Date(yr, mo, 0).getDate(); // hari terakhir bulan (benar utk Feb/30 hari)
    const startDate = `${month}-01 00:00:00`;
    const endDate   = `${month}-${String(lastDay).padStart(2, '0')} 23:59:59`;

    // 1. Dapatkan daftar mitra yang AKTIF melakukan transaksi di bulan tersebut
    const activeClients = await master('owners as o')
      .join('wallet_transactions as wt', 'wt.owner_id', 'o.id')
      .whereBetween('wt.created_at', [startDate, endDate])
      .select('o.id', 'o.business_name as nama_toko', 'o.email', 'o.phone as no_hp', 'o.status', 'o.created_at as tanggal_gabung')
      .groupBy('o.id', 'o.business_name', 'o.email', 'o.phone', 'o.status', 'o.created_at')
      .orderByRaw('COUNT(wt.id) DESC');

    // 2. Total transaksi bulan ini
    const countRow = await master('wallet_transactions')
      .whereBetween('created_at', [startDate, endDate])
      .count('id as total').first();
    const totalTransactions = parseInt(countRow.total) || 0;

    // 3. Estimasi laba bulan ini
    const year  = parseInt(month.slice(0, 4));
    const mon   = parseInt(month.slice(5, 7));
    const profitRow = await master('wallet_transactions')
      .whereIn('type', ['transaction_fee', 'ppob_margin', 'ppob_fee'])
      .whereRaw('YEAR(created_at) = ? AND MONTH(created_at) = ?', [year, mon])
      .select(master.raw('COALESCE(SUM(ABS(amount)), 0) as total')).first();
    const totalProfit = parseFloat(profitRow.total) || 0;

    // 4. Sample 200 transaksi untuk PDF/CSV
    const logs = await master('wallet_transactions as wt')
      .join('owners as o', 'o.id', 'wt.owner_id')
      .whereBetween('wt.created_at', [startDate, endDate])
      .select(
        'wt.id',
        master.raw("DATE_FORMAT(wt.created_at, '%Y-%m-%d %H:%i') as tanggal"),
        'o.business_name as nama_toko',
        'wt.type as tipe',
        'wt.description as produk',
        master.raw('ABS(wt.amount) as laba'),
        'wt.reference_type',
        'wt.reference_id'
      )
      .orderBy('wt.created_at', 'desc');

    const transactions = [];
    const uniqueMap = new Map();

    for (let l of logs) {
      const isTopup = l.tipe === 'topup' || l.tipe?.includes('topup');
      
      if (l.reference_type === 'ppob_orders') {
         const uniqueKey = 'ppob-' + l.reference_id;
         if (!uniqueMap.has(uniqueKey)) {
             uniqueMap.set(uniqueKey, {
                id:          l.id,
                tanggal:     l.tanggal,
                nama_toko:   l.nama_toko,
                tipe:        'PPOB',
                produk:      l.produk || '-',
                grand_total: 0,
                laba:        0,
                status:      'Sukses',
                ref_id:      l.reference_id || '-'
             });
             transactions.push(uniqueMap.get(uniqueKey));
         }
         
         const entry = uniqueMap.get(uniqueKey);
         if (l.tipe === 'ppob_purchase') {
            entry.grand_total += parseFloat(l.laba) || 0; // Tambahkan modal ke total
         } else {
            entry.laba += parseFloat(l.laba) || 0; // Ini adalah fee admin (laba)
            entry.grand_total += parseFloat(l.laba) || 0; // Tambahkan fee ke total bayar
         }
         continue;
      }

      transactions.push({
        id:          l.id,
        tanggal:     l.tanggal,
        nama_toko:   l.nama_toko,
        tipe:        l.reference_type === 'transactions' ? 'POS' : (l.tipe || '-'),
        produk:      l.produk || '-',
        grand_total: parseFloat(l.laba) || 0,
        laba:        isTopup ? 0 : (parseFloat(l.laba) || 0),
        status:      'Sukses',
        ref_id:      l.reference_id || '-'
      });
    }

    res.json({
      success: true,
      data: { newClients: activeClients, totalTransactions, totalProfit, transactions }
    });

  } catch (e) {
    console.error('Monthly report error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};
