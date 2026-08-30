(function () {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }

  function b64ToBuf(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptSecret(password, payload) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(JSON.stringify(payload))
    );
    return { salt: bufToB64(salt), iv: bufToB64(iv), ciphertext: bufToB64(cipher) };
  }

  async function decryptSecret(password, salt, iv, ciphertext) {
    const key = await deriveKey(password, b64ToBuf(salt));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBuf(iv) },
      key,
      b64ToBuf(ciphertext)
    );
    return JSON.parse(dec.decode(plain));
  }

  window.WrapNestCrypto = { encryptSecret, decryptSecret };
})();
