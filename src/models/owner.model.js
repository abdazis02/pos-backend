const master = require("../config/knexMaster");

const OwnerModel = {
  getBussinesNameByTenantId(tenant_id) {
    return master("tenants as t")
      .join("owners as o", "o.id", "t.owner_id")
      .where("t.id", tenant_id)
      // 🔥 Tambahkan address dan phone
      .first("o.business_name", "o.business_category", "o.address", "o.phone");
  },

  getTenantByID(id) {
    return master("tenants").where("id", id).first();
  },

  getByTenantId(id) {
    return master("owners as o")
      .join("tenants as t", "o.id", "t.owner_id")
      // Karena o.*, business_category otomatis terambil
      .where('t.id', id).first('o.*'); 
  },

  async getBalanceByTenant(trx, id) {
    const owner = await trx("owners as o")
      .join("tenants as t", "o.id", "t.owner_id")
      .forUpdate()
      .where('t.id', id)
      .first('o.wallet_balance')
    return owner?.wallet_balance;
  },

  addBalance(trx, id, amount) {
    return trx("owners").where({ id }).increment("wallet_balance", amount)
  },

  subtractBalance(trx, id, fee) {
    return trx("owners").where({ id }).decrement("wallet_balance", fee)
  },

  updateById(id, data) {
    data.updated_at = master.fn.now();
    return master("owners").where('id', id).update(data);
  }
};

module.exports = OwnerModel;