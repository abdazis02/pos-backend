function calculateBundlePrice(qty, price, bundleQty, bundleValue) {
  if (!bundleQty || !bundleValue || qty < bundleQty)
    return qty * price;

  const bundleCount = Math.floor(qty / bundleQty);
  const sisa = qty % bundleQty;
  return (bundleCount * bundleValue) + (sisa * price);
}

module.exports = { calculateBundlePrice };