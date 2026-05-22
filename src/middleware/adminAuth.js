module.exports = function adminAuth(req, res, next){
    if(!req.user || (req.user.role !== 'superadmin' && req.user.role !== 'superadmin2')){
        return res.status(403).json({success: false, message : 'akses hanya untuk superadmin'})
    }
    next();
}
