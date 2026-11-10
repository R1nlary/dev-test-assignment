// @rev kc-31
import { createServer } from 'node:http';
import { branches, orders } from './store.ts';
import { createHandler } from './app.ts';

const port = Number(process.env.PORT ?? 3001);

createServer(createHandler(branches, orders)).listen(port, () => {
  console.log(`dispatch: http://localhost:${port}`);
});
