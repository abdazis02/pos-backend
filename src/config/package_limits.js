const fs = require('fs');
const path = require('path');

const DEFAULT_LIMITS = {
  Standard: {
    product_limit: 100,
    user_limit: 3,
    image_limit: 0,
    role_limits: { owner: 1, admin: 1, cashier: 1, user: 3 }
  },
  Pro: {
    product_limit: 5000,
    user_limit: 6,
    image_limit: 100,
    role_limits: { owner: 1, admin: 1, cashier: 4, user: 6 }
  },
  Eksklusif: {
    product_limit: 10000,
    user_limit: 11,
    image_limit: 10000,
    role_limits: { owner: 1, admin: 2, cashier: 8, user: 11 }
  }
};

let customLimits = {};
try {
  const file = path.join(__dirname, 'custom_package_limits.json');
  if (fs.existsSync(file)) {
    customLimits = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
} catch (e) {
  customLimits = {};
}

function getPackageLimit(plan, key) {
  if (customLimits[plan] && customLimits[plan][key] !== undefined) {
    return customLimits[plan][key];
  }
  if (DEFAULT_LIMITS[plan] && DEFAULT_LIMITS[plan][key] !== undefined) {
    return DEFAULT_LIMITS[plan][key];
  }
  // Fallback: jika plan tidak ditemukan, pakai Standard
  if (DEFAULT_LIMITS['Standard'][key] !== undefined) {
    return DEFAULT_LIMITS['Standard'][key];
  }
  throw new Error(`Limit untuk plan "${plan}" dan key "${key}" tidak ditemukan`);
}

function getRoleLimit(plan, role) {
  if (customLimits[plan] && customLimits[plan].role_limits && customLimits[plan].role_limits[role] !== undefined) {
    return customLimits[plan].role_limits[role];
  }
  if (DEFAULT_LIMITS[plan] && DEFAULT_LIMITS[plan].role_limits && DEFAULT_LIMITS[plan].role_limits[role] !== undefined) {
    return DEFAULT_LIMITS[plan].role_limits[role];
  }
  // Fallback: jika plan tidak ditemukan, pakai Standard
  if (DEFAULT_LIMITS['Standard'].role_limits[role] !== undefined) {
    return DEFAULT_LIMITS['Standard'].role_limits[role];
  }
  throw new Error(`Role limit untuk plan "${plan}" dan role "${role}" tidak ditemukan`);
}

module.exports = { getPackageLimit, getRoleLimit };