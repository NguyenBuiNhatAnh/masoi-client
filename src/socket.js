import { io } from 'socket.io-client';

// Đổi VITE_SERVER_URL trong file .env nếu backend chạy ở địa chỉ khác.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

export const socket = io(SERVER_URL, {
  autoConnect: true,
  reconnection: true,
});
