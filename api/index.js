// Vercel Serverless Function 入口：所有动态请求都经 vercel.json 重写到这里
import { handle } from '@hono/node-server/vercel';
import app from '../src/app.js';

export default handle(app);
