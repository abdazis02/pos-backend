const master = require('../config/knexMaster');

const WalletTransaction = {
  paginateWalletTransactions(owner_id, offset, limit, filters) {
    const items = master("wallet_transactions")
      .where("owner_id", owner_id)
      .orderBy("created_at", "DESC")
      .orderBy("id", "DESC")
    const total = items.clone().count({ cnt: 'id' }).first()

    if (!!filters.search) {
      const k = `%${filters.search}%`
      items.where("description", "like", k);
    }

    if (!!filters.type) {
      items.where('type', filters.type);
    }

    const filtered = items.clone().count({ cnt: 'id' }).first()
    return [items.offset(offset).limit(limit), total, filtered];
  },

  createTransaction(trx, data) {
    return trx("wallet_transactions").insert(data);
  }
}

module.exports = WalletTransaction;