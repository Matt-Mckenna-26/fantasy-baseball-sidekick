import { loadConfig } from './config.js';
import { InMemoryTokenStore } from './tokenStore.js';
import { YahooFantasyProvider } from './fantasyProvider.js';
import { createApp } from './app.js';

const config = loadConfig();
const tokenStore = new InMemoryTokenStore();
const provider = new YahooFantasyProvider(config);
const app = createApp(config, { tokenStore, provider });

app.listen(config.port, () => {
  console.warn(
    `API listening on http://localhost:${config.port} (proxied via the Vite HTTPS dev server)`,
  );
});
