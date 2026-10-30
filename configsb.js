/**
 * FlujoCaja Pro - Configuración Cifrada de Conexión a Supabase (configsb.js)
 * ==============================================================================
 * Contiene las credenciales de Supabase provenientes de .env cifradas con algoritmo
 * de derivación XOR-Salt reversible para despliegues estáticos / en la nube (ej. Vercel).
 * Cada vez que la aplicación se conecta o interactúa con Supabase, desencripta los
 * valores en tiempo de ejecución (runtime) protegiendo las credenciales en el código fuente.
 * ==============================================================================
 */

(function (global) {
  'use strict';

  // Clave secreta interna para derivación de cifrado/descifrado
  const CIPHER_SECRET = 'FlujoCajaPro_Supabase_Secret_2026_SecureKey';

  // Valores de .env cifrados
  const _ENCRYPTED_PAYLOAD = {
    // URL encriptada de Supabase (.env: URL)
    URL: 'Hldvl7CypEw8ZHGMmPT9ByIxXn6clPPrCT9CbOXyl7NHEnx7ivDb4w==',
    // APIKEY encriptada de Supabase (.env: APIKEY)
    APIKEY: 'BUFEl7bq5wo6f3WIl/XICCYCXVaOptbJF3RdbpPXvfNMAUhriIHx/g0jDkSR5g==',
    // Configuración de tabla y paginación
    TABLE_NAME: 'fc_mov',
    PAGE_SIZE_DEFAULT: 25
  };

  /**
   * Desencripta un valor cifrado en Base64 utilizando la clave secreta y salt rotativo.
   * @param {string} cipherText - Cadena en Base64
   * @param {string} [secret=CIPHER_SECRET] - Clave secreta
   * @returns {string} - Cadena de texto desencriptada
   */
  function decrypt(cipherText, secret = CIPHER_SECRET) {
    if (!cipherText || typeof cipherText !== 'string') return '';
    try {
      const binary = (typeof atob === 'function')
        ? atob(cipherText)
        : (typeof Buffer !== 'undefined' ? Buffer.from(cipherText, 'base64').toString('binary') : '');
      
      let plain = '';
      for (let i = 0; i < binary.length; i++) {
        const k = secret.charCodeAt(i % secret.length);
        const salt = ((i + 1) * 31 + 17) & 0xFF;
        const charCode = (binary.charCodeAt(i) ^ k ^ salt) & 0xFF;
        plain += String.fromCharCode(charCode);
      }
      return plain;
    } catch (err) {
      console.error('[CONFIG_SB] Error al desencriptar credencial:', err);
      return '';
    }
  }

  /**
   * Encripta una cadena en texto claro a Base64 con clave secreta y salt rotativo.
   * @param {string} plainText - Cadena original
   * @param {string} [secret=CIPHER_SECRET] - Clave secreta
   * @returns {string} - Cadena cifrada en Base64
   */
  function encrypt(plainText, secret = CIPHER_SECRET) {
    if (!plainText || typeof plainText !== 'string') return '';
    try {
      let raw = '';
      for (let i = 0; i < plainText.length; i++) {
        const k = secret.charCodeAt(i % secret.length);
        const salt = ((i + 1) * 31 + 17) & 0xFF;
        const charCode = (plainText.charCodeAt(i) ^ k ^ salt) & 0xFF;
        raw += String.fromCharCode(charCode);
      }
      return (typeof btoa === 'function')
        ? btoa(raw)
        : (typeof Buffer !== 'undefined' ? Buffer.from(raw, 'binary').toString('base64') : '');
    } catch (err) {
      console.error('[CONFIG_SB] Error al encriptar credencial:', err);
      return '';
    }
  }

  /**
   * Desencripta y obtiene las credenciales de Supabase en el momento exacto de uso.
   * Se ejecuta dinámicamente cada vez que se requiere la conexión.
   * @returns {{SUPABASE_URL: string, SUPABASE_KEY: string, TABLE_NAME: string, PAGE_SIZE_DEFAULT: number}}
   */
  function getCredentials() {
    return {
      SUPABASE_URL: decrypt(_ENCRYPTED_PAYLOAD.URL),
      SUPABASE_KEY: decrypt(_ENCRYPTED_PAYLOAD.APIKEY),
      TABLE_NAME: _ENCRYPTED_PAYLOAD.TABLE_NAME,
      PAGE_SIZE_DEFAULT: _ENCRYPTED_PAYLOAD.PAGE_SIZE_DEFAULT
    };
  }

  // Módulo exportado
  const CONFIG_SB = {
    encrypted: _ENCRYPTED_PAYLOAD,
    decrypt: decrypt,
    encrypt: encrypt,
    getCredentials: getCredentials,
    // Atajo para obtener la URL desencriptada
    getUrl: function () {
      return decrypt(_ENCRYPTED_PAYLOAD.URL);
    },
    // Atajo para obtener la APIKEY desencriptada
    getKey: function () {
      return decrypt(_ENCRYPTED_PAYLOAD.APIKEY);
    }
  };

  // Exponer CONFIG_SB globalmente
  global.CONFIG_SB = CONFIG_SB;

  // Interceptar window.CONFIG mediante getters para compatibilidad transparente.
  // Cada vez que se lea window.CONFIG.SUPABASE_URL o window.CONFIG.SUPABASE_KEY,
  // se desencripta el valor desde configsb.js en tiempo real.
  Object.defineProperty(global, 'CONFIG', {
    configurable: true,
    enumerable: true,
    get: function () {
      return getCredentials();
    }
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG_SB;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
