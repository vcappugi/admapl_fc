/**
 * config.js - Proxy de configuración para compatibilidad con FlujoCaja Pro
 * Las credenciales reales se encuentran encriptadas en configsb.js
 */
(function (global) {
  'use strict';

  // Si configsb.js ya cargó, CONFIG ya está configurado dinámicamente
  if (global.CONFIG_SB && typeof global.CONFIG_SB.getCredentials === 'function') {
    return;
  }

  // Si no ha cargado, definir getter hacia CONFIG_SB cuando esté disponible
  Object.defineProperty(global, 'CONFIG', {
    configurable: true,
    enumerable: true,
    get: function () {
      if (global.CONFIG_SB && typeof global.CONFIG_SB.getCredentials === 'function') {
        return global.CONFIG_SB.getCredentials();
      }
      return {
        SUPABASE_URL: '',
        SUPABASE_KEY: '',
        TABLE_NAME: 'fc_mov',
        PAGE_SIZE_DEFAULT: 25
      };
    }
  });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
