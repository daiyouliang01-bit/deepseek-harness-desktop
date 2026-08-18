import WebSocket from '/Users/litong/.dsh/profiles/web/node_modules/ws/index.js';

const url = process.env.WS_URL || 'wss://dsh.dpharness.xyz/api/events/mux';
const timeout = setTimeout(() => { console.log('TIMEOUT: no frames in 15s'); process.exit(2); }, 15000);

const ws = new WebSocket(url, {
  headers: { Origin: 'https://dsh.dpharness.xyz' }
});
let frames = 0;
ws.on('open', () => console.log('OPEN:', ws.url));
ws.on('unexpected-response', (req, res) => {
  console.log('UNEXPECTED_RESPONSE:', res.statusCode, res.statusMessage);
  clearTimeout(timeout);
  process.exit(3);
});
ws.on('message', (data) => {
  frames++;
  const text = data.toString().slice(0, 200);
  if (frames <= 3) console.log('FRAME', frames, ':', text);
  if (frames >= 3) { clearTimeout(timeout); console.log('GOT', frames, 'frames — WS OK'); process.exit(0); }
});
ws.on('error', (e) => { console.log('ERROR:', e.message); clearTimeout(timeout); process.exit(4); });
ws.on('close', (code, reason) => { console.log('CLOSE:', code, reason.toString()); clearTimeout(timeout); process.exit(5); });