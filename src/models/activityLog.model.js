const ActivityLogModel = {
  // Insert log aktivitas
  async create(db, { user_id, store_id = null, action, detail }) {
    await db("activity_logs").insert({ user_id, store_id, action, detail })
  },

  // Ambil log aktivitas per store dengan pagination
  paginateActivityLogs(db, store_id, offset, limit, q) {
    const logs = db("activity_logs as l")
      .select('l.id', 'l.action', 'l.detail', 'u.name', 'u.email', 'l.created_at')
      .leftJoin(process.env.DB_NAME + ".users as u", "l.user_id", "u.id")
      .where("l.store_id", store_id)
      .orderBy("l.created_at", "DESC")
    const logs_total = logs.clone().clearSelect().count({ cnt: 'l.id' }).first()

    if (!!q) {
      const k = `%${q}%`
      logs.where((q) => q
        .where("u.name", "like", k)
        .orWhere("u.email", "like", k)
        .orWhere("l.action", "like", k)
        .orWhere("l.detail", "like", k)
      )
    }

    const logs_filtered = logs.clone().clearSelect().count({ cnt: 'l.id' }).first()
    return [logs.offset(offset).limit(limit), logs_total, logs_filtered];
  },
};

module.exports = ActivityLogModel;
