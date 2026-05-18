const master = require("../config/knexMaster");

const UserModel = {
    // Find user by email (from master db)
    findByEmail(email) {
        return master("users as u")
            .leftJoin("tenants as t", "t.id", "u.tenant_id")
            .leftJoin("owners as o", "o.id", "t.owner_id")
            .where({
                "u.email": email,
                "u.is_active": true,
            })
            .whereNotNull("u.verified_at")
            .select("u.*", "o.business_category", "o.address", "o.phone")
            .first();
    },

    // Find user by ID (tenant)
    findById(tenant_id, store_id, id) {
        return master("users as u")
            .leftJoin("tenants as t", "t.id", "u.tenant_id")
            .leftJoin("owners as o", "o.id", "t.owner_id")
            .where({ "u.tenant_id": tenant_id, "u.store_id": store_id, "u.id": id })
            .select("u.*", "o.business_category", "o.address", "o.phone")
            .first();
    },

    // List user by store (tenant)
    findByStore(tenant_id, store_id, roles, search) {
        const query = master("users").where({ tenant_id, store_id }).whereIn('role', roles)
        if (search) {
            const keyword = `%${search}%`
            query.where((q) => q.where("name", "like", keyword).orWhere("email", "like", keyword))
        }
        return query;
    },

    // List semua user milik owner (semua toko)
    async findAllByOwner(conn, owner_id, search) {
        let query = `SELECT * FROM users WHERE owner_id = ? AND role IN ('admin','cashier')`;
        let params = [owner_id];
        if (search) {
            query += ` AND (name LIKE ? OR username LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }
        const [rows] = await conn.execute(query, params);
        return rows;
    },

    // Create user (tenant)
    async create({ tenant_id, store_id, name, email, is_active, password, role }) {
        const verified_at = master.fn.now() // TODO: jangan langsung verifikasi, tapi kirim email dulu
        const [id] = await master("users").insert({ tenant_id, store_id, name, email, is_active, password, role, verified_at })
        return id;
    },

    // Update user by id (tenant)
    update(id, data) {
        data.updated_at = master.fn.now();
        return master("users").where("id", id).update(data);
    },

    delete(id) {
        return master("users").where("id", id).delete();
    }
};

module.exports = UserModel;