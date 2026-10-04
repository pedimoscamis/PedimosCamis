// =======================================================================
// CÓDIGO PRINCIPAL (pedidos, robot de estados, correos y tracker)
// Sustituye TODO el contenido de tu archivo actual por este.
// Requiere que el archivo "cuentas" (cuentas.gs) siga en el proyecto:
// de ahí salen manejarAccion() y _json().
// =======================================================================

// -----------------------------------------------------------------------
// CORREO: envío único para todos los emails (menos probabilidad de spam)
//  - nombre de remitente, reply-to y versión en texto plano
//  - logo alojado en Cloudinary (el r2.dev público es solo de desarrollo)
// -----------------------------------------------------------------------
var LOGO_URL = "https://res.cloudinary.com/dbeystyls/image/upload/v1779456332/ChatGPT_Image_22_may_2026_15_11_57_asrrdf.png";
var CORREO_TIENDA = "pedimoscamis@gmail.com";

function htmlATexto(html) {
  return String(html || "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<\/(p|div|h1|h2|h3|h4|tr|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function enviarCorreo(destino, asunto, html, nombreRemitente) {
  MailApp.sendEmail({
    to: destino,
    subject: asunto,
    name: nombreRemitente || "PedimosCamis?",
    replyTo: CORREO_TIENDA,
    body: htmlATexto(html),
    htmlBody: html
  });
}

// =======================================================================
// 1. RECIBE EL PEDIDO DE LA WEB, LO REPARTE Y ORDENA LAS HOJAS (WEBHOOK)
// =======================================================================
function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetPedidos = ss.getSheetByName("pedidos");
    var sheetArticulos = ss.getSheetByName("articulos");

    var data = JSON.parse(e.postData.contents);
    if (data.action) { return manejarAccion(data);}

    var fecha = new Date();
    var fechaFormateada = Utilities.formatDate(fecha, "GMT+2", "dd/MM/yyyy HH:mm");

    var cliente = data.cliente || "Cliente Web";
    var telefono = data.telefono || "";
    var direccion = (data.direccion && data.direccion.trim() !== "") ? data.direccion : "Rivas";
    var metodoPago = data.metodoPago || "Bizum";
    var correoCliente = data.correo || "";

    var codigoDescuento = data.codigoDescuento || data.cupon || data.coupon || "";

    var items = data.carrito || [];
    var costeTotalPedido = 0;
    var cobroTotalPedido = 0;
    var precioEnvioParaCorreo = 0;

    var htmlListaAdmin = "";

    items.forEach(function(item) {
      var gastoItem = Number(item.coste) || Number(item.gasto) || 0;
      var priceItem = Number(item.cobro) || Number(item.price) || Number(item.precio) || 0;
      var beneficioItem = priceItem - gastoItem;

      costeTotalPedido += gastoItem;
      cobroTotalPedido += priceItem;

      sheetArticulos.appendRow([
        fechaFormateada,     // A
        cliente,             // B
        item.jersey || "",   // C
        "",                  // D
        item.version || "",  // E
        item.name || "",     // F
        item.patches || "",  // G
        item.size || "",     // H
        gastoItem,           // I
        priceItem,           // J
        beneficioItem,       // K
        "Pending",           // L
        ""                   // M (Order ID / Encargo)
      ]);

      if (item.picture) {
        var ultimaFilaArt = sheetArticulos.getLastRow();
        sheetArticulos.getRange(ultimaFilaArt, 4).setFormula('=IMAGE("' + item.picture + '")');
      }

      var tagImagenAdmin = "";
      if (item.picture && item.picture.trim() !== "") {
        tagImagenAdmin = '<td style="width: 65px; vertical-align: top; padding-right: 15px;"><img src="' + item.picture + '" style="width: 55px; height: auto; border-radius: 4px; border: 1px solid #ddd;" /></td>';
      }

      htmlListaAdmin += '<div style="border-bottom: 1px solid #eeeeee; padding: 10px 0;">' +
                        '<table style="width: 100%; border-collapse: collapse;"><tr>' + tagImagenAdmin +
                        '<td style="vertical-align: top;">' +
                        '<p style="margin: 0 0 5px 0;"><strong>' + (item.jersey || "Cami") + '</strong> <span style="color: #e8173c; font-weight: bold;">(' + priceItem + '€)</span></p>' +
                        '<p style="margin: 0; font-size: 13px; color: #555555;">Talla: ' + (item.size || "-") + ' | Versión: ' + (item.version || "-") + '</p>';
      if (item.name) htmlListaAdmin += '<p style="margin: 0; font-size: 13px; color: #555555;">Dorsal/Nombre: ' + item.name + '</p>';
      if (item.patches) htmlListaAdmin += '<p style="margin: 0; font-size: 13px; color: #555555;">Parches: ' + item.patches + '</p>';
      htmlListaAdmin += '</td></tr></table></div>';
    });

    var beneficioTotalPedido = cobroTotalPedido - costeTotalPedido;

    sheetPedidos.appendRow([
      fechaFormateada,
      cliente,
      costeTotalPedido,
      cobroTotalPedido,
      beneficioTotalPedido,
      false,
      "Pending",
      "",
      metodoPago,
      telefono,
      direccion,
      correoCliente,
      codigoDescuento
    ]);

    // Obligamos a la nueva fila a mantener una altura fina (21 píxeles)
    var ultimaFila = sheetPedidos.getLastRow();
    sheetPedidos.setRowHeight(ultimaFila, 21);

    if (sheetPedidos.getLastRow() > 1) {
      sheetPedidos.getRange(2, 1, sheetPedidos.getLastRow() - 1, sheetPedidos.getLastColumn()).sort({column: 1, ascending: false});
    }
    if (sheetArticulos.getLastRow() > 1) {
      sheetArticulos.getRange(2, 1, sheetArticulos.getLastRow() - 1, sheetArticulos.getLastColumn()).sort({column: 1, ascending: false});
    }

    var asuntoCliente = "Hemos recibido tu pedido en PedimosCamis";
    var htmlPlantilla = '<div style="background-color: #f4f4f4; padding: 20px; font-family: Arial, Helvetica, sans-serif;">' +
                        '<div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">' +
                        '<div style="background-color: #080808; padding: 25px; text-align: center;">' +
                        '<img src="' + LOGO_URL + '" alt="PEDIMOSCAMIS?" style="max-width: 280px; height: auto; display: block; margin: 0 auto;">' +
                        '</div>' +
                        '<div style="padding: 30px; color: #333333; line-height: 1.6;">' +
                        '<h2 style="color: #080808; margin-top: 0;">¡Hola, ' + cliente + '!</h2>' +
                        '<p>Tu pedido ha sido registrado correctamente. En cuanto recibamos el pago, nos pondremos en marcha para procesarlo.</p>' +
                        '<div style="background-color: #f9f9f9; padding: 15px; border-radius: 6px; margin: 25px 0;">' +
                        '<p style="margin: 5px 0;"><strong>📱 Teléfono:</strong> ' + telefono + '</p>' +
                        '<p style="margin: 5px 0;"><strong>💳 Método de pago:</strong> ' + metodoPago + '</p>' +
                        '<p style="margin: 5px 0;"><strong>📍 Entrega/Dirección:</strong> ' + direccion + '</p>' +
                        '</div>' +
                        '<h3 style="border-bottom: 2px solid #080808; padding-bottom: 8px; color: #080808;">🛒 Tus Camis:</h3>';

    var contadorCamisetas = 1;
    items.forEach(function(item) {
      if (item.jersey && item.jersey.toLowerCase().includes("gasto") && item.jersey.toLowerCase().includes("envío")) {
        precioEnvioParaCorreo = Number(item.cobro) || Number(item.price) || 0;
      } else if (esFilaNoArticulo(item.jersey)) {
        // Tax aduana: solo coste interno, no se muestra al cliente
      } else {
        var precioMuestra = Number(item.cobro) || Number(item.price) || Number(item.precio) || 0;

        var tagImagenHtml = "";
        if (item.picture && item.picture.trim() !== "") {
          tagImagenHtml = '<td style="width: 70px; vertical-align: top; padding-right: 15px;"><img src="' + item.picture + '" style="width: 60px; height: auto; border-radius: 4px; border: 1px solid #ddd;" /></td>';
        }

        htmlPlantilla += '<div style="border-bottom: 1px solid #eeeeee; padding: 15px 0;">' +
                         '<table style="width: 100%; border-collapse: collapse;"><tr>' + tagImagenHtml +
                         '<td style="vertical-align: top;">' +
                         '<p style="margin: 0 0 5px 0;"><strong>' + contadorCamisetas + '. ' + (item.jersey || "Cami") + '</strong></p>' +
                         '<p style="margin: 0; font-size: 14px; color: #555555;">Talla: ' + (item.size || "-") + ' | Versión: ' + (item.version || "-") + '</p>';
        if (item.name) htmlPlantilla += '<p style="margin: 0; font-size: 14px; color: #555555;">Dorsal/Nombre: ' + item.name + '</p>';
        if (item.patches) htmlPlantilla += '<p style="margin: 0; font-size: 14px; color: #555555;">Parches: ' + item.patches + '</p>';
        htmlPlantilla += '<p style="margin: 8px 0 0 0; color: #e8173c; font-weight: bold;">Precio: ' + precioMuestra + '€</p>' +
                         '</td></tr></table>' +
                         '</div>';
        contadorCamisetas++;
      }
    });

    htmlPlantilla += '<div style="margin-top: 25px; background-color: #080808; color: #ffffff; padding: 20px; border-radius: 6px; text-align: right;">';
    if (precioEnvioParaCorreo > 0) {
      htmlPlantilla += '<p style="margin: 0 0 10px 0; font-size: 14px; color: #aaaaaa;">📦 Gastos de envío: ' + precioEnvioParaCorreo + '€</p>';
    }
    htmlPlantilla += '<h2 style="margin: 0; color: #ffffff;">TOTAL DEL PEDIDO: <span style="color: #e8173c;">' + cobroTotalPedido + '€</span></h2>' +
                     '</div>' +
                     '<div style="background-color: #f0f7ff; border-left: 4px solid #1c7cd5; padding: 15px; margin-top: 25px; border-radius: 4px;">' +
                     '<p style="margin: 0; color: #1c7cd5; font-size: 14px;">⏱️ <strong>Plazo de entrega estimado:</strong> aproximadamente 2 semanas.</p>' +
                     '</div></div>' +
                     '<div style="background-color: #eeeeee; padding: 20px; text-align: center; font-size: 12px; color: #888888;">' +
                     '<p style="margin: 0;">¡Muchas gracias por confiar en <strong>PEDIMOSCAMIS?</strong> Si tienes dudas, responde a este correo.</p>' +
                     '</div></div></div>';

    if (correoCliente && correoCliente.trim() !== "") {
      enviarCorreo(correoCliente, asuntoCliente, htmlPlantilla);
    }

    var asuntoAdmin = "🚨 NUEVO PEDIDO: " + cobroTotalPedido + "€ - " + cliente;

    var htmlAdmin = '<div style="font-family: Arial, Helvetica, sans-serif; color: #333333; line-height: 1.5; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 600px;">' +
                    '<h2 style="color: #1c7cd5; margin-top: 0; border-bottom: 2px solid #eee; padding-bottom: 10px;">Nuevo pedido recibido</h2>' +
                    '<div style="background-color: #f9f9f9; padding: 15px; border-radius: 6px; margin-bottom: 20px;">' +
                    '<p style="margin: 5px 0;"><strong>👤 Cliente:</strong> ' + cliente + '</p>' +
                    '<p style="margin: 5px 0;"><strong>📧 Correo:</strong> ' + correoCliente + '</p>' +
                    '<p style="margin: 5px 0;"><strong>📱 Teléfono:</strong> ' + telefono + '</p>' +
                    '<p style="margin: 5px 0;"><strong>📍 Dirección:</strong> ' + direccion + '</p>' +
                    '<p style="margin: 5px 0;"><strong>💳 Pago:</strong> ' + metodoPago + '</p>' +
                    '<p style="margin: 5px 0;"><strong>🎟️ Cupón:</strong> ' + (codigoDescuento !== "" ? '<span style="color:#e8173c; font-weight:bold;">' + codigoDescuento + '</span>' : 'Ninguno') + '</p>' +
                    '</div>' +
                    '<h3 style="margin-bottom: 10px;">Artículos:</h3>' +
                    htmlListaAdmin +
                    '<div style="background-color: #080808; color: #ffffff; padding: 15px; border-radius: 6px; text-align: right; margin-top: 20px;">' +
                    '<h2 style="margin: 0; font-size: 20px;">Total a cobrar: <span style="color: #4CAF50;">' + cobroTotalPedido + '€</span></h2>' +
                    '</div></div>';

    enviarCorreo(CORREO_TIENDA, asuntoAdmin, htmlAdmin, "PedimosCamis? Pedidos");

    return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": error.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

// =======================================================================
// 2. EL ROBOT VIGILANTE COMPLETO (Sincronización y Correos con FOTOS)
// =======================================================================

// Textos de cada estado (un único sitio para los dos escenarios)
function datosCorreoEstado(estado) {
  if (estado === "Shipped") {
    return {
      asunto: "Tu pedido de PedimosCamis ya está en camino",
      titulo: "¡Tu pedido está en camino!",
      cuerpo: "Te escribimos para informarte de que tus camis ya han salido oficialmente de fábrica.<br><br>📍 <strong>¡Recuerda!</strong> Ya puedes seguir el trayecto de tu paquete y ver tu código de seguimiento entrando en <b>Mi cuenta → Mis pedidos</b> de nuestra página web con el correo de tu pedido."
    };
  }
  if (estado === "Arrived") {
    return {
      asunto: "Tu pedido de PedimosCamis ya está listo",
      titulo: "¡Pedido Listo!",
      cuerpo: "Te escribimos para avisarte de que ya han llegado tus camis a nuestro almacén."
    };
  }
  if (estado === "Delivered") {
    return {
      asunto: "Tu pedido de PedimosCamis ha sido entregado",
      titulo: "¡Esperamos que te encanten tus camis! 😍",
      cuerpo: "Hemos marcado tu pedido como ENTREGADO.<br><br>¡Esperamos que te flipen tus nuevas camisetas! Si te ha gustado el resultado, no dudes en <b>pasarnos una foto guapa por mail</b> y compartir la tienda con tus amigos y en tus redes sociales. ¡Nos ayuda muchísimo a seguir creciendo! ✨"
    };
  }
  return null;
}

function onEdit(e) {
  if (!e || !e.range) return;
  var range = e.range;
  var sheet = range.getSheet();
  var sheetName = sheet.getName();
  var columnaEditada = range.getColumn();
  var filaEditada = range.getRow();

  if (filaEditada <= 1) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ESCENARIO A: EDICIÓN EN HOJA "ENCARGOS"
  if (sheetName === "encargos" && columnaEditada === 2) {
    var numEncargoTexto = normalizarATexto(sheet.getRange(filaEditada, 1).getValue());
    var nuevoEstado = range.getValue().toString().trim();

    if (numEncargoTexto === "" || nuevoEstado === "") return;

    var sheetPedidos = ss.getSheetByName("pedidos");
    var sheetArticulos = ss.getSheetByName("articulos");

    var datosPedidos = sheetPedidos.getDataRange().getValues();
    var datosArticulos = sheetArticulos.getDataRange().getValues();
    var formulasArticulos = sheetArticulos.getDataRange().getFormulas();

    for (var i = 1; i < datosPedidos.length; i++) {
      var pedidoLoteTexto = normalizarATexto(datosPedidos[i][7]);

      if (pedidoLoteTexto === numEncargoTexto) {
        sheetPedidos.getRange(i + 1, 7).setValue(nuevoEstado);

        var fechaPedido = normalizarATexto(datosPedidos[i][0]);
        var nombreCliente = datosPedidos[i][1].toString().trim();
        var correoCliente = datosPedidos[i][11].toString();

        var htmlListaArticulos = "";
        for (var f = 1; f < datosArticulos.length; f++) {
          var fechaArt = normalizarATexto(datosArticulos[f][0]);
          var clienteArt = datosArticulos[f][1].toString().trim();

          if (clienteArt === nombreCliente && fechaArt === fechaPedido) {
            var jersey = datosArticulos[f][2].toString();
            var talla = datosArticulos[f][7];

            if (!esFilaNoArticulo(jersey)) {

              var imgUrl = "";
              var formulaImg = formulasArticulos[f][3];
              if (formulaImg && formulaImg !== "") {
                var match = formulaImg.match(/=IMAGE\("([^"]+)"/i);
                if (match && match[1]) imgUrl = match[1];
              }

              var tagImagenHtml = "";
              if (imgUrl !== "") {
                tagImagenHtml = '<td style="width: 60px; vertical-align: middle; padding-right: 15px;"><img src="' + imgUrl + '" style="width: 50px; height: auto; border-radius: 4px; border: 1px solid #ccc;" /></td>';
              }

              htmlListaArticulos += '<div style="border-bottom: 1px solid #eeeeee; padding: 10px 0;">' +
                                    '<table style="width: 100%; border-collapse: collapse;"><tr>' + tagImagenHtml +
                                    '<td style="vertical-align: middle;">' +
                                    '<p style="margin: 0; color: #333;"><strong>' + jersey + '</strong></p>' +
                                    '<p style="margin: 0; font-size: 13px; color: #777;">Talla: ' + talla + '</p>' +
                                    '</td></tr></table></div>';
            }
            sheetArticulos.getRange(f + 1, 12).setValue(nuevoEstado);
          }
        }

        if (htmlListaArticulos === "") htmlListaArticulos = "<p>Cami(s) de tu encargo actual.</p>";

        if (correoCliente && correoCliente.trim() !== "") {
          var datosCorreo = datosCorreoEstado(nuevoEstado);
          if (datosCorreo) {
            var mensajeHtml = crearPlantilla(datosCorreo.titulo, datosCorreo.cuerpo, "", htmlListaArticulos);
            enviarCorreo(correoCliente, datosCorreo.asunto, mensajeHtml);
          }
        }
      }
    }
    actualizarTotalesDeEncargo(numEncargoTexto, sheet, filaEditada);
  }

  // ESCENARIO B: EDICIÓN EN HOJA "PEDIDOS"
  if (sheetName === "pedidos" && (columnaEditada === 6 || columnaEditada === 7 || columnaEditada === 8)) {
    var fechaPedido = normalizarATexto(sheet.getRange(filaEditada, 1).getValue());
    var nombreCliente = sheet.getRange(filaEditada, 2).getValue().toString().trim();
    var cobroTotal = sheet.getRange(filaEditada, 4).getValue().toString();
    var correoCliente = sheet.getRange(filaEditada, 12).getValue().toString();

    var sheetArticulos = ss.getSheetByName("articulos");
    var datosArticulos = sheetArticulos.getDataRange().getValues();
    var formulasArticulos = sheetArticulos.getDataRange().getFormulas();

    var htmlListaArticulos = "";

    for (var f = 1; f < datosArticulos.length; f++) {
      var fechaArt = normalizarATexto(datosArticulos[f][0]);
      var clienteArt = datosArticulos[f][1].toString().trim();

      if (clienteArt === nombreCliente && fechaArt === fechaPedido) {
        var jersey = datosArticulos[f][2].toString();
        var talla = datosArticulos[f][7];

        if (!esFilaNoArticulo(jersey)) {

          var imgUrl = "";
          var formulaImg = formulasArticulos[f][3];
          if (formulaImg && formulaImg !== "") {
            var match = formulaImg.match(/=IMAGE\("([^"]+)"/i);
            if (match && match[1]) imgUrl = match[1];
          }

          var tagImagenHtml = "";
          if (imgUrl !== "") {
            tagImagenHtml = '<td style="width: 60px; vertical-align: middle; padding-right: 15px;"><img src="' + imgUrl + '" style="width: 50px; height: auto; border-radius: 4px; border: 1px solid #ccc;" /></td>';
          }

          htmlListaArticulos += '<div style="border-bottom: 1px solid #eeeeee; padding: 10px 0;">' +
                                '<table style="width: 100%; border-collapse: collapse;"><tr>' + tagImagenHtml +
                                '<td style="vertical-align: middle;">' +
                                '<p style="margin: 0; color: #333;"><strong>' + jersey + '</strong></p>' +
                                '<p style="margin: 0; font-size: 13px; color: #777;">Talla: ' + talla + '</p>' +
                                '</td></tr></table></div>';
        }

        if (columnaEditada === 7) {
          sheetArticulos.getRange(f + 1, 12).setValue(range.getValue());
        }
        if (columnaEditada === 8) {
          sheetArticulos.getRange(f + 1, 13).setValue(range.getValue());
        }
      }
    }

    if (htmlListaArticulos === "") htmlListaArticulos = "<p>Cami(s) de tu pedido actual.</p>";

    if (columnaEditada === 6) {
      var estaPagado = range.getValue();
      if (estaPagado === true && correoCliente && correoCliente.trim() !== "") {
        var txtTotal = '<div style="text-align: right; border-top: 2px solid #080808; padding-top: 15px;"><h3 style="margin: 0;">TOTAL PAGADO: <span style="color: #e8173c;">' + cobroTotal + '€</span></h3></div>';
        enviarCorreo(correoCliente, "Pago recibido: empezamos a procesar tu pedido", crearPlantilla("¡Pago Recibido!", "Te confirmamos que hemos recibido correctamente el pago. Ya nos hemos puesto manos a la obra para procesar las camis con fábrica.", txtTotal, htmlListaArticulos));
      }
    }

    var nuevoEstado = sheet.getRange(filaEditada, 7).getValue().toString().trim();
    var numEncargoTexto = sheet.getRange(filaEditada, 8).getValue().toString().trim();

    if (columnaEditada === 7 && numEncargoTexto !== "") sincronizarHaciaEncargos(numEncargoTexto, nuevoEstado);
    if (columnaEditada === 8 && numEncargoTexto !== "") sincronizarHaciaEncargos(numEncargoTexto, nuevoEstado);

    if (columnaEditada === 7 && correoCliente && correoCliente.trim() !== "") {
      var datosCorreoB = datosCorreoEstado(nuevoEstado);
      if (datosCorreoB) {
        enviarCorreo(correoCliente, datosCorreoB.asunto, crearPlantilla(datosCorreoB.titulo, datosCorreoB.cuerpo, "", htmlListaArticulos));
      }
    }
  }
}

// =======================================================================
// 3. FUNCIONES AUXILIARES Y MENÚ PERSONALIZADO
// =======================================================================

function normalizarATexto(valor) {
  if (valor === "" || valor === null || valor === undefined) return "";
  if (valor instanceof Date) return Utilities.formatDate(valor, "GMT+2", "dd/MM/yyyy HH:mm");
  return valor.toString().trim();
}

function actualizarTotalesDeEncargo(numEncargoTexto, sheetEncargos, filaDestino) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var datosPedidos = ss.getSheetByName("pedidos").getDataRange().getValues();
  var datosArticulos = ss.getSheetByName("articulos").getDataRange().getValues();
  var totalBeneficio = 0;
  var totalArticulos = 0;
  var clavesPedidosEnEncargo = [];

  for (var p = 1; p < datosPedidos.length; p++) {
    var lotePedido = normalizarATexto(datosPedidos[p][7]);
    if (lotePedido === numEncargoTexto) {
      totalBeneficio += (Number(datosPedidos[p][4]) || 0);
      var fechaPed = normalizarATexto(datosPedidos[p][0]);
      var clientePed = datosPedidos[p][1].toString().trim();
      clavesPedidosEnEncargo.push(fechaPed + "|" + clientePed);
    }
  }

  for (var a = 1; a < datosArticulos.length; a++) {
    var fechaArt = normalizarATexto(datosArticulos[a][0]);
    var clienteArt = datosArticulos[a][1].toString().trim();
    var claveArt = fechaArt + "|" + clienteArt;

    if (clavesPedidosEnEncargo.indexOf(claveArt) !== -1) {
      var jersey = datosArticulos[a][2].toString();
      if (!esFilaNoArticulo(jersey)) {
        totalArticulos++;
      }
    }
  }

  sheetEncargos.getRange(filaDestino, 5).setValue(totalBeneficio);
  sheetEncargos.getRange(filaDestino, 6).setValue(totalArticulos);
}

function sincronizarHaciaEncargos(numEncargoTexto, estado) {
  if (numEncargoTexto === "") return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEncargos = ss.getSheetByName("encargos");
  var datosEncargos = sheetEncargos.getDataRange().getValues();
  var encontrado = false;
  var filaDestino = -1;

  for (var j = 1; j < datosEncargos.length; j++) {
    var encargoActual = normalizarATexto(datosEncargos[j][0]);
    if (encargoActual === numEncargoTexto) {
      sheetEncargos.getRange(j + 1, 2).setValue(estado);
      filaDestino = j + 1;
      encontrado = true;
      break;
    }
  }

  if (!encontrado) {
    sheetEncargos.appendRow([numEncargoTexto, estado, "", "", "Cargando...", "Cargando..."]);
    filaDestino = sheetEncargos.getLastRow();
  }

  actualizarTotalesDeEncargo(numEncargoTexto, sheetEncargos, filaDestino);
}

function crearPlantilla(tituloHtml, textoPrincipal, totalPagadoHtml, htmlListaArticulos) {
  return '<div style="background-color: #f4f4f4; padding: 20px; font-family: Arial, Helvetica, sans-serif;">' +
         '<div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">' +
         '<div style="background-color: #080808; padding: 25px; text-align: center;">' +
         '<img src="' + LOGO_URL + '" alt="PEDIMOSCAMIS?" style="max-width: 280px; height: auto; display: block; margin: 0 auto;">' +
         '</div>' +
         '<div style="padding: 30px; color: #333333; line-height: 1.6;">' +
         '<h2 style="color: #080808; margin-top: 0;">' + tituloHtml + '</h2>' +
         '<p>' + textoPrincipal + '</p>' +
         '<div style="background-color: #f9f9f9; padding: 20px; border-radius: 6px; margin: 20px 0;">' +
         '<h4 style="margin-top: 0; color: #080808; margin-bottom: 10px;">Resumen de tu pedido:</h4>' +
         '<div>' + htmlListaArticulos + '</div>' +
         '</div>' + (totalPagadoHtml || '') + '</div>' +
         '<div style="background-color: #eeeeee; padding: 20px; text-align: center; font-size: 12px; color: #888888;">' +
         '<p style="margin: 0;">Gracias por tu confianza. Si tienes dudas, responde a este correo.</p>' +
         '</div></div></div>';
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 PedimosCamis?')
    .addItem('🔄 Recalcular Beneficios y Artículos', 'ejecutarActualizacionManual')
    .addItem('🔗 Sincronizar Order IDs en Artículos', 'rellenarOrderIdsRetroactivo')
    .addToUi();
}

function ejecutarActualizacionManual() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetEncargos = ss.getSheetByName("encargos");
  if (!sheetEncargos) return;
  var datosEncargos = sheetEncargos.getDataRange().getValues();
  SpreadsheetApp.getActiveSpreadsheet().toast("Recalculando...", "⏳ Procesando", 5);
  for (var j = 1; j < datosEncargos.length; j++) {
    var numEncargoTexto = normalizarATexto(datosEncargos[j][0]);
    if (numEncargoTexto !== "") actualizarTotalesDeEncargo(numEncargoTexto, sheetEncargos, j + 1);
  }
}

function rellenarOrderIdsRetroactivo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetPedidos = ss.getSheetByName("pedidos");
  var sheetArticulos = ss.getSheetByName("articulos");

  if (!sheetPedidos || !sheetArticulos) return;

  var datosPedidos = sheetPedidos.getDataRange().getValues();
  var datosArticulos = sheetArticulos.getDataRange().getValues();

  var mapaPedidos = {};
  for (var i = 1; i < datosPedidos.length; i++) {
    var fecha = normalizarATexto(datosPedidos[i][0]);
    var cliente = datosPedidos[i][1].toString().trim();
    var orderId = datosPedidos[i][7] ? datosPedidos[i][7].toString().trim() : "";
    if (orderId !== "") {
      mapaPedidos[fecha + "|" + cliente] = orderId;
    }
  }

  SpreadsheetApp.getActiveSpreadsheet().toast("Sincronizando Order IDs...", "⏳ Procesando", 5);

  var count = 0;
  for (var f = 1; f < datosArticulos.length; f++) {
    var fechaArt = normalizarATexto(datosArticulos[f][0]);
    var clienteArt = datosArticulos[f][1].toString().trim();
    var clave = fechaArt + "|" + clienteArt;

    if (mapaPedidos[clave]) {
      var currentVal = datosArticulos[f][12] ? datosArticulos[f][12].toString().trim() : "";
      if (currentVal !== mapaPedidos[clave]) {
        sheetArticulos.getRange(f + 1, 13).setValue(mapaPedidos[clave]);
        count++;
      }
    }
  }
  SpreadsheetApp.getActiveSpreadsheet().toast("Se han actualizado " + count + " artículos.", "✅ Terminado", 5);
}

// =======================================================================
// 4. DEVOLVER ESTADOS Y RASTREO LOGÍSTICO AL FRONTEND (TRACKER & PROXY)
// =======================================================================
function doGet(e) {
  if (e.parameter && e.parameter.accountsPing) { return _json({ status: 'success', accounts: true }); }
  var salida = ContentService.createTextOutput();
  salida.setMimeType(ContentService.MimeType.JSON);

  try {
    // --- PROXY PARA EL TRACKING NUEVO (BLINDADO) ---
    if (e.parameter.action === "proxyTrack") {
      var trackingCode = e.parameter.tracking;
      if (!trackingCode) return salida.setContent(JSON.stringify({ "status": "error", "message": "Falta el código de seguimiento" }));

      var url      = "https://xxy819.github.io/track-website/";
      var response = UrlFetchApp.fetch(url, { "method": "get", "muteHttpExceptions": true });
      var html     = response.getContentText();

      var objetoTexto = extraerObjetoOrderData(html);
      if (!objetoTexto) {
        return salida.setContent(JSON.stringify({ "status": "success", "found": false }));
      }

      var orderData;
      try {
        var jsonTexto = convertirObjetoJsAJson(objetoTexto);
        orderData = JSON.parse(jsonTexto);
      } catch (parseErr) {
        return salida.setContent(JSON.stringify({ "status": "error", "message": "No se pudo interpretar el origen de datos" }));
      }

      var registro = orderData[trackingCode.trim()];
      if (!registro) {
        return salida.setContent(JSON.stringify({ "status": "success", "found": false }));
      }

      return salida.setContent(JSON.stringify({ "status": "success", "found": true, "data": registro }));
    }

    // --- FUNCIÓN ORIGINAL: BUSCAR EL HISTORIAL DE PEDIDOS POR EMAIL ---
    var emailBusqueda = e.parameter.email;
    if (!emailBusqueda) {
      return salida.setContent(JSON.stringify({ "status": "error", "message": "Falta el email" }));
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetPedidos = ss.getSheetByName("pedidos");
    var sheetEncargos = ss.getSheetByName("encargos");

    var datosPedidos = sheetPedidos.getDataRange().getValues();
    var datosEncargos = sheetEncargos.getDataRange().getValues();

    var pedidosEncontrados = [];

    for (var i = 1; i < datosPedidos.length; i++) {
      var emailFila = datosPedidos[i][11] ? datosPedidos[i][11].toString().trim().toLowerCase() : "";

      if (emailFila === emailBusqueda.toLowerCase().trim()) {
        var idEncargoPedido = datosPedidos[i][7] ? datosPedidos[i][7].toString().trim() : "";
        var trackingEncontrado = "";

        if (idEncargoPedido !== "") {
          for (var j = 1; j < datosEncargos.length; j++) {
            var idEncargoFila = datosEncargos[j][0] ? datosEncargos[j][0].toString().trim() : "";
            if (idEncargoFila === idEncargoPedido) {
              trackingEncontrado = datosEncargos[j][6] ? datosEncargos[j][6].toString().trim() : "";
              break;
            }
          }
        }

        pedidosEncontrados.push({
          fecha: datosPedidos[i][0].toString(),
          estado: datosPedidos[i][6].toString(),
          tracking: trackingEncontrado
        });
      }
    }

    if (pedidosEncontrados.length > 0) {
      var pedidosInvertidos = pedidosEncontrados.reverse();
      return salida.setContent(JSON.stringify({ "status": "success", "data": pedidosInvertidos }));
    } else {
      return salida.setContent(JSON.stringify({ "status": "not_found", "message": "No hay pedidos" }));
    }
  } catch (error) {
    return salida.setContent(JSON.stringify({ "status": "error", "message": error.message }));
  }
}

// ── Extrae el bloque `{...}` de "var orderData = {...}" ─────────────────
function extraerObjetoOrderData(html) {
  var inicio = html.indexOf('var orderData');
  if (inicio === -1) return null;
  var llaveInicio = html.indexOf('{', inicio);
  if (llaveInicio === -1) return null;
  var profundidad  = 0;
  var dentroString = false;
  var comilla      = '';
  for (var i = llaveInicio; i < html.length; i++) {
    var c = html[i];
    if (dentroString) {
      if (c === '\\') { i++; continue; }
      if (c === comilla) dentroString = false;
      continue;
    }
    if (c === "'" || c === '"') {
      dentroString = true;
      comilla = c;
      continue;
    }
    if (c === '{') profundidad++;
    if (c === '}') {
      profundidad--;
      if (profundidad === 0) return html.slice(llaveInicio, i + 1);
    }
  }
  return null;
}

// ── Convierte el objeto-literal JS en texto JSON válido ─────────────────────
function convertirObjetoJsAJson(texto) {
  var resultado = '';
  var i   = 0;
  var len = texto.length;
  while (i < len) {
    var ch = texto[i];
    if (ch === "'" || ch === '"') {
      var comillaOriginal = ch;
      var j = i + 1;
      var valor = '';
      while (j < len) {
        if (texto[j] === '\\' && j + 1 < len) {
          valor += texto[j] + texto[j + 1];
          j += 2;
          continue;
        }
        if (texto[j] === comillaOriginal) break;
        valor += texto[j];
        j++;
      }
      if (comillaOriginal === "'") valor = valor.replace(/\\'/g, "'");
      valor = valor.replace(/"/g, '\\"');
      resultado += '"' + valor + '"';
      i = j + 1;
      continue;
    }
    var restante   = texto.slice(i);
    var claveMatch = restante.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
    if (claveMatch) {
      resultado += '"' + claveMatch[1] + '":';
      i += claveMatch[0].length;
      continue;
    }
    resultado += ch;
    i++;
  }
  resultado = resultado.replace(/,\s*([}\]])/g, '$1');
  return resultado;
}

// Filas de la hoja Artículos que no son camisetas: gastos de envío y tax de
// aduana. No cuentan como artículo ni se muestran al cliente.
function esFilaNoArticulo(jersey) {
  var j = (jersey || "").toString().toLowerCase();
  return (j.indexOf("gasto") !== -1 && j.indexOf("envío") !== -1) || j.indexOf("tax aduana") !== -1;
}
