/**
 * Script: fix_ppob_pending.js
 * Tujuan: Update status order PPOB yang stuck 'pending' dengan cek ke Digiflazz
 *
 * Cara pakai:
 *   node scripts/fix_ppob_pending.js PPB-14-1-1779215466427
 *
 * Atau untuk update SEMUA order pending:
 *   node scripts/fix_ppob_pending.js --all
 */

require('dotenv').config();
const crypto = require('crypto');
const https = require('https');

const DIGIFLAZZ_URL = (process.env.DIGIFLAZZ_URL || 'https://api.digiflazz.com').replace(/^["']|["']$/g, '').trim();
const DIGIFLAZZ_USERNAME = (process.env.DIGIFLAZZ_USERNAME || '').replace(/^["']|["']$/g, '').trim();
const DIGIFLAZZ_API_KEY = (process.env.DIGIFLAZZ_API_KEY || '').replace(/^["']|["']$/g, '').trim();

const knexMaster = require('../src/config/knexMaster');
const { getTenantConnection } = require('../src/config/knexTenant');

function buildSign(ref_id) {
  return crypto.createHash('md5').update(`${DIGIFLAZZ_USERNAME}${DIGIFLAZZ_API_KEY}${ref_id}`).digest('hex');
}

function checkStatusFromDigiflazz(ref_id) {
  const payload = JSON.stringify({
    commands: 'check-status',
    username: DIGIFLAZZ_USERNAME,
    ref_id,
    sign: buildSign(ref_id),
  });

  const url = new URL('/v1/transaction', DIGIFLAZZ_URL);

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Accept': 'application/json',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Parse error: ' + raw)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function parsePpobRefId(ref_id) {
  const match = /^PPB-(\d+)-(\d+)-(.+)$/.exec(ref_id);
  if (!match) return null;
  return { tenant_id: parseInt(match[1], 10), store_id: parseInt(match[2], 10) };
}

async function fixOrder(ref_id) {
  console.log(`\n🔍 Cek status untuk: ${ref_id}`);

  const parsed = parsePpobRefId(ref_id);
  if (!parsed) {
    console.error('❌ Format ref_id tidak valid. Harus format: PPB-{tenant_id}-{store_id}-{timestamp}');
    return;
  }

  // Ambil tenant info
  const tenant = await knexMaster('tenants').where({ id: parsed.tenant_id }).first();
  if (!tenant) {
    console.error(`❌ Tenant ID ${parsed.tenant_id} tidak ditemukan`);
    return;
  }

  const tenantDb = getTenantConnection(tenant);

  // Cek order di DB
  const order = await tenantDb('ppob_orders').where({ ref_id }).first();
  if (!order) {
    console.error(`❌ Order ${ref_id} tidak ditemukan di database tenant`);
    return;
  }

  console.log(`📦 Order ditemukan — Status saat ini: ${order.status}`);

  if (order.status !== 'pending') {
    console.log(`✅ Order sudah ${order.status}, tidak perlu update.`);
    return;
  }

  // Cek ke Digiflazz
  console.log(`🌐 Query ke Digiflazz...`);
  const result = await checkStatusFromDigiflazz(ref_id);
  console.log(`📩 Response Digiflazz:`, JSON.stringify(result, null, 2));

  const data = result?.data || result;
  const rc = String(data?.rc || '');
  const statusText = String(data?.status || '').toLowerCase();

  let newStatus;
  if (rc === '00' || statusText === 'sukses') {
    newStatus = 'success';
  } else if (['06', '07', '08', '09'].includes(rc)) {
    newStatus = 'failed';
  } else {
    newStatus = 'pending';
    console.log(`⏳ Masih pending (rc=${rc}). Belum ada update.`);
    return;
  }

  // Update DB
  await tenantDb('ppob_orders').where({ ref_id }).update({
    status: newStatus,
    sn: data?.sn || order.sn || '',
    product_name: data?.product_name || order.product_name || null,
    response: JSON.stringify(data),
    updated_at: new Date(),
  });

  console.log(`\n✅ BERHASIL! Order ${ref_id} diupdate: '${order.status}' → '${newStatus}'`);
  console.log(`   SN: ${data?.sn || '-'}`);
  console.log(`   Product: ${data?.product_name || '-'}`);
}

async function fixAllPending() {
  console.log(`\n🔄 Mode: Update SEMUA order pending...`);

  const tenants = await knexMaster('tenants').select('*');
  let totalFixed = 0;

  for (const tenant of tenants) {
    try {
      const tenantDb = getTenantConnection(tenant);
      const pendingOrders = await tenantDb('ppob_orders').where({ status: 'pending' }).select('ref_id');

      if (pendingOrders.length === 0) continue;

      console.log(`\n📋 Tenant ${tenant.id} (${tenant.db_name}): ${pendingOrders.length} order pending`);

      for (const o of pendingOrders) {
        try {
          await fixOrder(o.ref_id);
          totalFixed++;
          // Delay 500ms antar request agar tidak kena rate limit Digiflazz
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`  ⚠️ Error saat fix ${o.ref_id}: ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`  ⚠️ Skip tenant ${tenant.id}: ${e.message}`);
    }
  }

  console.log(`\n✅ Selesai. Total order yang diproses: ${totalFixed}`);
}

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.log('Usage:');
    console.log('  node scripts/fix_ppob_pending.js PPB-14-1-1779215466427   ← fix 1 order');
    console.log('  node scripts/fix_ppob_pending.js --all                    ← fix semua pending');
    process.exit(0);
  }

  try {
    if (arg === '--all') {
      await fixAllPending();
    } else {
      await fixOrder(arg);
    }
  } catch (e) {
    console.error('❌ Fatal error:', e.message);
  } finally {
    await knexMaster.destroy();
    process.exit(0);
  }
}

main();
