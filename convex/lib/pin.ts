/*
  Hash de PIN (RNF06). bcrypt nativo não roda no runtime do Convex; usamos
  PBKDF2 via Web Crypto, que é nativo do runtime, com sal aleatório por PIN e
  muitas iterações — apropriado para senha, não "hash simples".

  Formato armazenado em `operadores.pinHash`:  pbkdf2$<iteracoes>$<saltHex>$<hashHex>
  O PIN em texto puro nunca é persistido (RF13); só o hash mora aqui (RNF05).
*/

const ITERACOES = 100_000;
const TAM_SALT = 16; // bytes
const TAM_HASH = 32; // bytes

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// PIN aleatório de 6 dígitos, uniforme (via crypto, não Math.random).
export function gerarPin(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  // Faixa [0, 4.29e9); o viés do módulo sobre 1e6 é desprezível para um PIN.
  return (arr[0] % 1_000_000).toString().padStart(6, "0");
}

async function derivar(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iteracoes: number,
  tamBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iteracoes, hash: "SHA-256" },
    key,
    tamBytes * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(TAM_SALT));
  const hash = await derivar(pin, salt, ITERACOES, TAM_HASH);
  return `pbkdf2$${ITERACOES}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

// Comparação em tempo constante para não vazar informação por tempo.
export async function verificarPin(
  pin: string,
  armazenado: string,
): Promise<boolean> {
  const partes = armazenado.split("$");
  if (partes.length !== 4 || partes[0] !== "pbkdf2") return false;

  const iteracoes = Number(partes[1]);
  const salt = hexToBytes(partes[2]);
  const esperado = hexToBytes(partes[3]);
  if (!Number.isFinite(iteracoes) || esperado.length === 0) return false;

  const atual = await derivar(pin, salt, iteracoes, esperado.length);
  if (atual.length !== esperado.length) return false;

  let diff = 0;
  for (let i = 0; i < atual.length; i++) diff |= atual[i] ^ esperado[i];
  return diff === 0;
}
