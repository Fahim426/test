import { env } from './lib/env';
import { createApp } from './app';

const app = createApp();
app.listen(env.port, () => console.log(`SmartSpare ERP API listening on http://localhost:${env.port}`));
