import express from 'express';
import cors from 'cors';
import { taskRouter } from './api/tasks';
import { userRouter } from './api/users';
import { webhookRouter } from './api/webhooks';

const app = express();

// "just make it work" CORS
app.use(cors());
app.use(express.json());

app.use('/api/tasks', taskRouter);
app.use('/api/users', userRouter);
app.use('/api/webhooks', webhookRouter);

// Global error handler (sort of)
app.use((err, req, res, next) => {
  console.log('Something went wrong:', err);
  res.status(500).json({ error: err.message, stack: err.stack });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { app };
