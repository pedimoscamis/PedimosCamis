// =======================================================================
// CUENTAS DE CLIENTE (login por código al email, sin contraseña)
// =======================================================================
// CÓMO INSTALARLO (una sola vez):
//  1. En el proyecto de Apps Script, crea un archivo nuevo "cuentas" y pega
//     TODO este contenido.
//  2. En doPost(e), justo DESPUÉS de la línea
//         var data = JSON.parse(e.postData.contents);
//     añade:
//         if (data.action) { return manejarAccion(data); }
//     (los pedidos normales no llevan "action", así que no les afecta).
//     Y en doGet(e), al principio (comprobación que usa la web para saber
//     que las cuentas están activas y no mandar nada al script viejo):
//         if (e.parameter && e.parameter.accountsPing) { return _json({ status: 'success', accounts: true }); }
//  3. Implementar > Gestionar implementaciones > editar la implementación
//     existente > Versión nueva > Implementar. (La URL /exec NO cambia.)
//  4. La primera vez, ejecuta manualmente "autorizarCuentas" desde el editor
//     para aceptar los permisos (CacheService / hojas / correo).
//
// Hojas que crea solas: "cuentas" y "sesiones".
// Seguridad: los códigos (6 dígitos) caducan a los 10 min, máx. 5 intentos y
// máx. 5 solicitudes por hora y correo. El token de sesión se guarda solo
// como hash SHA-256; la sesión dura hasta que el cliente cierra sesión.
// =======================================================================

function autorizarCuentas() {
  _hojaCuentas();
  _hojaSesiones();
  CacheService.getScriptCache().put('probe', '1', 5);
  Logger.log('OK — permisos concedidos');
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function _sha256(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function _hojaCuentas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName('cuentas');
  if (!h) { h = ss.insertSheet('cuentas'); h.appendRow(['email', 'perfil_json', 'favoritos_json', 'creada']); }
  return h;
}
function _hojaSesiones() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName('sesiones');
  if (!h) { h = ss.insertSheet('sesiones'); h.appendRow(['token_hash', 'email', 'creada']); }
  return h;
}

function _emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function manejarAccion(data) {
  try {
    switch (data.action) {
      case 'requestCode': return solicitarCodigo(data.email);
      case 'verifyCode':  return verificarCodigo(data.email, data.code);
      case 'getAccount':  return obtenerCuenta(data.token);
      case 'saveAccount': return guardarCuenta(data.token, data.perfil, data.favoritos);
      case 'logout':      return cuentaCerrarSesion(data.token);
      default:            return _json({ status: 'error', message: 'Acción desconocida' });
    }
  } catch (err) {
    return _json({ status: 'error', message: err.message });
  }
}

// ── 1. Pedir código ──────────────────────────────────────────────────────
function solicitarCodigo(emailRaw) {
  var email = (emailRaw || '').toString().trim().toLowerCase();
  if (!_emailValido(email)) return _json({ status: 'error', message: 'Correo no válido' });

  var cache = CacheService.getScriptCache();
  var rlKey = 'rl:' + email;
  var n = parseInt(cache.get(rlKey) || '0', 10);
  if (n >= 5) return _json({ status: 'error', message: 'Demasiadas solicitudes. Inténtalo en una hora.' });
  cache.put(rlKey, String(n + 1), 3600);

  var code = ('' + Math.floor(100000 + Math.random() * 900000));
  cache.put('code:' + email, _sha256(email + ':' + code), 600);
  cache.remove('att:' + email);

  var html = '<div style="background:#f4f4f4;padding:20px;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e0e0e0;overflow:hidden;">' +
    '<div style="background:#080808;padding:22px;text-align:center;color:#fff;font-size:22px;font-weight:bold;letter-spacing:1px;">PEDIMOS<span style="color:#e8173c;">CAMIS?</span></div>' +
    '<div style="padding:28px;color:#333;line-height:1.6;">' +
    '<h2 style="margin-top:0;color:#080808;">Tu código de acceso</h2>' +
    '<p>Usa este código para entrar en tu cuenta. Caduca en 10 minutos.</p>' +
    '<p style="font-size:34px;font-weight:bold;letter-spacing:8px;text-align:center;background:#f9f9f9;border-radius:6px;padding:14px;margin:20px 0;">' + code + '</p>' +
    '<p style="font-size:12px;color:#888;">Si no lo has pedido tú, ignora este correo.</p>' +
    '</div></div></div>';
  MailApp.sendEmail({ to: email, subject: 'Tu código de acceso: ' + code, htmlBody: html });
  return _json({ status: 'success' });
}

// ── 2. Verificar código → crea cuenta (si no existe) y sesión ────────────
function verificarCodigo(emailRaw, codeRaw) {
  var email = (emailRaw || '').toString().trim().toLowerCase();
  var code  = (codeRaw || '').toString().trim();
  if (!_emailValido(email) || !/^\d{6}$/.test(code)) return _json({ status: 'error', message: 'Código no válido' });

  var cache = CacheService.getScriptCache();
  var esperado = cache.get('code:' + email);
  if (!esperado) return _json({ status: 'error', message: 'El código ha caducado. Pide uno nuevo.' });

  var intentos = parseInt(cache.get('att:' + email) || '0', 10) + 1;
  if (intentos > 5) { cache.remove('code:' + email); return _json({ status: 'error', message: 'Demasiados intentos. Pide un código nuevo.' }); }
  cache.put('att:' + email, String(intentos), 600);

  if (_sha256(email + ':' + code) !== esperado) return _json({ status: 'error', message: 'Código incorrecto' });
  cache.remove('code:' + email); cache.remove('att:' + email);

  // Crear cuenta si es nueva
  var hc = _hojaCuentas();
  if (_filaCuenta(hc, email) === -1) hc.appendRow([email, '{}', '[]', new Date()]);

  var token = Utilities.getUuid() + Utilities.getUuid();
  _hojaSesiones().appendRow([_sha256(token), email, new Date()]);
  return _json({ status: 'success', token: token, email: email });
}

function _filaCuenta(hoja, email) {
  var datos = hoja.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (datos[i][0].toString().toLowerCase() === email) return i + 1;
  }
  return -1;
}

function _emailDeToken(token) {
  if (!token) return null;
  var hash = _sha256(token.toString());
  var datos = _hojaSesiones().getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (datos[i][0] === hash) return datos[i][1].toString().toLowerCase();
  }
  return null;
}

// ── 3. Datos de la cuenta + historial de pedidos ─────────────────────────
function obtenerCuenta(token) {
  var email = _emailDeToken(token);
  if (!email) return _json({ status: 'invalid_session' });

  var hc = _hojaCuentas();
  var fila = _filaCuenta(hc, email);
  var perfil = {}, favoritos = [];
  if (fila !== -1) {
    try { perfil = JSON.parse(hc.getRange(fila, 2).getValue() || '{}'); } catch (e) {}
    try { favoritos = JSON.parse(hc.getRange(fila, 3).getValue() || '[]'); } catch (e) {}
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pedidos = ss.getSheetByName('pedidos').getDataRange().getValues();
  var articulos = ss.getSheetByName('articulos').getDataRange().getValues();
  var encargos = ss.getSheetByName('encargos').getDataRange().getValues();

  var lista = [];
  for (var i = 1; i < pedidos.length; i++) {
    var fila_p = pedidos[i];
    var emailFila = fila_p[11] ? fila_p[11].toString().trim().toLowerCase() : '';
    if (emailFila !== email) continue;

    var fecha = normalizarATexto(fila_p[0]);
    var cliente = fila_p[1].toString().trim();
    var idEncargo = fila_p[7] ? fila_p[7].toString().trim() : '';
    var tracking = '';
    if (idEncargo !== '') {
      for (var j = 1; j < encargos.length; j++) {
        if (encargos[j][0] && encargos[j][0].toString().trim() === idEncargo) {
          tracking = encargos[j][6] ? encargos[j][6].toString().trim() : '';
          break;
        }
      }
    }
    var items = [];
    for (var k = 1; k < articulos.length; k++) {
      if (normalizarATexto(articulos[k][0]) === fecha && articulos[k][1].toString().trim() === cliente) {
        var jersey = articulos[k][2].toString();
        var esEnvio = jersey.toLowerCase().indexOf('gasto') !== -1 && jersey.toLowerCase().indexOf('envío') !== -1;
        items.push({ jersey: jersey, version: articulos[k][4], name: articulos[k][5], patches: articulos[k][6],
                     size: articulos[k][7], cobro: articulos[k][9], envio: esEnvio });
      }
    }
    lista.push({ fecha: fecha, estado: fila_p[6].toString(), total: fila_p[3], metodoPago: fila_p[8].toString(),
                 tracking: tracking, items: items });
  }
  lista.reverse(); // más reciente primero (la hoja está ordenada desc; esto la deja igual si no)

  return _json({ status: 'success', email: email, perfil: perfil, favoritos: favoritos, pedidos: lista });
}

// ── 4. Guardar perfil y/o favoritos (parcial) ────────────────────────────
function guardarCuenta(token, perfil, favoritos) {
  var email = _emailDeToken(token);
  if (!email) return _json({ status: 'invalid_session' });
  var hc = _hojaCuentas();
  var fila = _filaCuenta(hc, email);
  if (fila === -1) { hc.appendRow([email, '{}', '[]', new Date()]); fila = hc.getLastRow(); }
  if (perfil && typeof perfil === 'object') {
    var p = {};
    ['nombre', 'telefono', 'pais', 'region', 'ciudad', 'camino', 'cp'].forEach(function (k) { p[k] = (perfil[k] || '').toString().slice(0, 200); });
    hc.getRange(fila, 2).setValue(JSON.stringify(p));
  }
  if (Array.isArray(favoritos)) {
    hc.getRange(fila, 3).setValue(JSON.stringify(favoritos.slice(0, 500).map(function (x) { return x.toString().slice(0, 200); })));
  }
  return _json({ status: 'success' });
}

// ── 5. Cerrar sesión ─────────────────────────────────────────────────────
function cuentaCerrarSesion(token) {
  if (!token) return _json({ status: 'success' });
  var hash = _sha256(token.toString());
  var hoja = _hojaSesiones();
  var datos = hoja.getDataRange().getValues();
  for (var i = datos.length - 1; i >= 1; i--) {
    if (datos[i][0] === hash) hoja.deleteRow(i + 1);
  }
  return _json({ status: 'success' });
}
