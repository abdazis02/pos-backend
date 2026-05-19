const { toWIT, convertToWIT } = require('./timezone');

const response = {
    // Success responses
    success: (res, data = null, message = 'Success', statusCode = 200) => {
        const responseObj = {
            success: true,
            message,
            timestamp: toWIT(new Date()) // 🕐 WIT (UTC+9)
        };

        if (data !== null) {
            if (typeof data === 'object' && !Array.isArray(data)) {
                responseObj.data = convertToWIT(data); // 🕐 Konversi semua timestamp ke WIT
            } else {
                responseObj.data = { items: convertToWIT(data) }; // 🕐
            }
        }

        return res.status(statusCode).json(responseObj);
    },

    created: (res, data = null, message = 'Resource created successfully') => {
        return response.success(res, data, message, 201);
    },

    // Error responses
    error: (res, err, message = 'Terjadi kesalahan', status = 500) => {
        // Pastikan status selalu angka
        if (typeof status !== 'number') status = 500;
        return res.status(status).json({
            success: false,
            message,
            timestamp: toWIT(new Date()), // 🕐 WIT (UTC+9)
            error: {
                name: err?.name || 'Error',
                message: err?.message || String(err),
                stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined
            }
        });
    },

    // Client error responses
    badRequest: (res, message = 'Bad Request', errors = null) => {
        const responseObj = {
            success: false,
            message,
            timestamp: toWIT(new Date()) // 🕐 WIT (UTC+9)
        };

        if (errors) {
            responseObj.errors = Array.isArray(errors) ? errors : [errors];
        }

        return res.status(400).json(responseObj);
    },

    unauthorized: (res, message = 'Unauthorized') => {
        return res.status(401).json({
            success: false,
            message,
            timestamp: toWIT(new Date()) // 🕐 WIT (UTC+9)
        });
    },

    forbidden: (res, message = 'Forbidden') => {
        return res.status(403).json({
            success: false,
            message,
            timestamp: toWIT(new Date()) // 🕐 WIT (UTC+9)
        });
    },

    notFound: (res, message = 'Resource not found') => {
        return res.status(404).json({
            success: false,
            message,
            timestamp: toWIT(new Date()) // 🕐 WIT (UTC+9)
        });
    },

    conflict: (res, message = 'Conflict', details = null) => {
        const responseObj = {
            success: false,
            message,
            timestamp: toWIT(new Date()) // 🕐 WIT (UTC+9)
        };

        if (details) {
            responseObj.details = details;
        }

        return res.status(409).json(responseObj);
    },

    validationError: (res, errors) => {
        return res.status(422).json({
            success: false,
            message: 'Validation failed',
            errors: Array.isArray(errors) ? errors : [errors],
            timestamp: toWIT(new Date()) // 🕐 WIT (UTC+9)
        });
    },

    // Pagination helper
    paginated: (res, data, pagination, message = 'Success') => {
        return res.status(200).json({
            success: true,
            message,
            data: {
                items: convertToWIT(data), // 🕐 Konversi ke WIT
                pagination: {
                    total: pagination.total,
                    page: pagination.page,
                    limit: pagination.limit,
                    totalPages: pagination.totalPages,
                    hasNext: pagination.hasNext,
                    hasPrev: pagination.hasPrev
                }
            },
            timestamp: toWIT(new Date()) // 🕐 WIT (UTC+9)
        });
    },
};

module.exports = response;