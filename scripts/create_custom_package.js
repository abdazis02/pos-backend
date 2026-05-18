const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LIMITS_FILE = path.join(__dirname, '../src/config/custom_package_limits.json');

function loadLimits() {
  if (fs.existsSync(LIMITS_FILE)) {
    return JSON.parse(fs.readFileSync(LIMITS_FILE, 'utf8'));
  }
  return {};
}

function saveLimits(limits) {
  fs.writeFileSync(LIMITS_FILE, JSON.stringify(limits, null, 2), 'utf8');
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer)));
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let limits = loadLimits();

  console.log('=== Custom Package Limit Creator ===');
  const plan = (await ask(rl, 'Nama paket (misal: Eksklusif): ')).trim() || 'Eksklusif';

  const product_limit = parseInt(await ask(rl, 'Batas produk (angka): '), 10) || 10000;
  const user_limit = parseInt(await ask(rl, 'Batas user total (angka): '), 10) || 11;

  const owner = parseInt(await ask(rl, 'Batas owner: '), 10) || 1;
  const admin = parseInt(await ask(rl, 'Batas admin: '), 10) || 2;
  const cashier = parseInt(await ask(rl, 'Batas cashier: '), 10) || 8;
  const user = parseInt(await ask(rl, 'Batas user: '), 10) || user_limit;

  limits[plan] = {
    product_limit,
    user_limit,
    role_limits: { owner, admin, cashier, user }
  };

  saveLimits(limits);

  console.log(`\nBerhasil update limit paket "${plan}":`);
  console.log(JSON.stringify(limits[plan], null, 2));

  rl.close();
}

main();