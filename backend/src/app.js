import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import inwardRoutes from './routes/inwardRoutes.js';
import outwardRoutes from './routes/outwardRoutes.js';
import uploadRoutes from "./routes/uploadRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import warehouseRoutes from "./routes/warehouseRoutes.js";
import companyRoutes from "./routes/companyRoutes.js";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());
app.get("/", (req, res) => {
  res.json({
    message: "Warehouse backend is running"
  });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/grn', inwardRoutes);
app.use('/api/outward', outwardRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/companies", companyRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

export default app;
