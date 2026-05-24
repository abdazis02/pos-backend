const master = require('../config/knexMaster');
const bcrypt = require('bcryptjs');
const response = require('../utils/response');
const UserModel = require('../models/user.model');
const ActivityLogModel = require('../models/activityLog.model');

const UserController = {
  // List user by store
  async listByStore(req, res) {
    try {
      const { tenant_id } = req.user;
      const { store_id } = req.params;
      const { search } = req.query;

      const roles = req.user.role == 'owner' ? ['admin', 'cashier'] : ['cashier'];
      const users = await UserModel.findByStore(tenant_id, store_id, roles, search);

      return response.success(res, users);
    } catch (error) {
      response.error(res, error, "Gagal mengambil data user", 500)
    }
  },

  // Create user
  async create(req, res) {
    try {
      const { store_id } = req.params;
      const { name, email, password, role, commission_rate } = req.body;
      const { tenant_id, role: user_role, is_active } = req.user;

      // validasi unique email
      const user = await master("users").where("email", email).first();
      if (!!user) {
        return response.badRequest(res, "Email sudah terdaftar disistem, silahkan menggunakan email lain!");
      }

      // cek owner eksis di tenant
      const tenant = await master("tenants").where("id", tenant_id).first();
      if (!tenant)
        return response.notFound(res, 'Owner tidak ditemukan di database tenant. Jalankan register client.');

      // validasi store ownership
      const store = await req.db("stores").where("id", store_id).first();
      if (!store)
        return response.notFound(res, 'Store tidak ditemukan di tenant.');

      const hashed = await bcrypt.hash(password, 10);
      await UserModel.create({
        tenant_id, store_id, name, email, is_active, password: hashed, role: user_role == 'owner' ? role : 'cashier',
        commission_rate: commission_rate || 0
      });

      // Logging aktivitas: tambah user
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: store_id,
        action: 'add_user',
        detail: `Tambah user: ${name} (${role})`
      });

      response.created(res, null, 'User berhasil ditambah');
    } catch (error) {
      response.error(res, error, 'Gagal menambah user')
    }
  },

  // Update user (termasuk nonaktifkan)
  async update(req, res) {
    try {
      const { tenant_id } = req.user;
      const { store_id, id } = req.params;
      const { name, email, password, role, is_active, commission_rate } = req.body;

      const user = await UserModel.findById(tenant_id, store_id, id);
      if (!user)
        return response.notFound(res, 'User tidak ditemukan');

      // Validasi email unik jika diubah
      if (email && email !== user.email) {
        // Cek di tenant
        const existingUser = await master("users").where("email", email).first();
        if (existingUser && existingUser.id !== Number(id)) {
          return response.badRequest(res, 'Email sudah terdaftar disistem, silakan menggunakan email lain.');
        }
      }

      let updateData = {};
      if (name !== undefined) updateData.name = name;
      if (email !== undefined) updateData.email = email;
      if (role !== undefined) updateData.role = role;
      if (is_active !== undefined) updateData.is_active = is_active;
      if (commission_rate !== undefined) updateData.commission_rate = commission_rate;
      if (password) updateData.password = await bcrypt.hash(password, 10);

      await UserModel.update(id, updateData);

      // Logging aktivitas: edit user
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: user.store_id,
        action: 'edit_user',
        detail: `Edit user: ${name || user.name} (${role || user.role})`
      });

      response.success(res, null, 'User berhasil diupdate');
    } catch (error) {
      response.error(res, error, 'Gagal update user');
    }
  },

  // Delete user (hard delete, hapus permanen)
  async delete(req, res) {
    try {
      const { tenant_id } = req.user;
      const { store_id, id } = req.params;

      const user = await UserModel.findById(tenant_id, store_id, id);
      if (!user)
        return response.notFound(res, 'User tidak ditemukan');

      await UserModel.delete(id);

      // Logging aktivitas: hapus user
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: user.store_id,
        action: 'delete_user',
        detail: `Hapus user: ${user.name} (${user.role})`
      });

      response.success(res, null, 'User berhasil dihapus permanen');
    } catch (error) {
      response.error(res, error, 'Gagal hapus user: ' + error.message);
    }
  }
};

module.exports = UserController;