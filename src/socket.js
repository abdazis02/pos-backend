const socket = require('socket.io')

let io;

function init(httpServer) {
    io = new socket.Server(httpServer, { cors: { origin: "*" } })

    io.on('connection', (socket) => {
        console.log('New client: ', socket.id)

        socket.on("join-order", (orderId) => {
            socket.join(orderId);
        });

        socket.on("leave-order", (orderId) => {
            socket.leave(orderId);
        });
    })
}

function getIO() {
    if (!io) {
        throw new Error("Socket.io belum di-init!");
    }

    return io;
}

module.exports = { init, getIO }