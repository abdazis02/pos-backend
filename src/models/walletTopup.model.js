const master = require('../config/knexMaster');

const WalletModel = {
  paginateWalletTopup(owner_id, offset, limit, filters) {
    const items = master("wallet_topups")
      .where("owner_id", owner_id)
      .orderBy("created_at", "DESC")
      .orderBy("id", "DESC")
    const total = items.clone().count({ cnt: 'id' }).first()

    if (!!filters.search) {
      const k = `%${filters.search}%`
      items.where("payment_method", "like", k);
    }

    if (!!filters.status) {
      items.where('status', filters.status);
    }

    const filtered = items.clone().count({ cnt: 'id' }).first()
    return [items.offset(offset).limit(limit), total, filtered];
  },

  findWalletTopupById(id) {
    return master("wallet_topups").where({ id }).first();
  },

  findWalletTopupByMidtransId(midtrans_transaction_id) {
    return master("wallet_topups").where({ midtrans_transaction_id }).first();
  },

  updateWallet(trx, id, data) {
    return trx("wallet_topups").where({ id }).update(data);
  }
}

module.exports = WalletModel;