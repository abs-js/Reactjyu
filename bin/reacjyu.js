#!/usr/bin/env node
import { start } from '../src/index.js';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) options.port = Number(args[++i]);
  else if (args[i] === '--index' && args[i + 1]) options.indexFile = args[++i];
  else if (args[i] === '--host' && args[i + 1]) options.host = args[++i];
  else if (args[i] === '--no-console') options.console = false;
  else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Uso: reacjyu [opções]\n\n  --port <porta>       Porta HTTP (padrão: 3000 ou PORT)\n  --index <arquivo>    Arquivo inicial (padrão: public/app.cjy)\n  --host <endereço>    Endereço de bind (padrão: 127.0.0.1)\n  --no-console        Desativa o console interativo\n  --help, -h           Mostra esta ajuda');
    process.exit(0);
  }
}
start(options);
