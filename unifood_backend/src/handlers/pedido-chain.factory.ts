import { PedidoHandler } from './pedido-handler.base';
import { ValidarAreaVentaHandler } from './validar-area-venta.handler';
import { ValidarStatusAreaHandler } from './validar-status-area.handler';
import { ValidarDisponibilidadProductosHandler } from './productos.handler';
import { ValidarAlergiasHandler } from './verificar-alergias.handler';
import { VerificarPedidosEsperaHandler } from './verificar-pedidos-espera';
import { ProcesarPedidoHandler } from './procesar-pedido.handler';

export class PedidoChainFactory {
  static create(): PedidoHandler {
    // Crear los handlers
    const validarArea = new ValidarAreaVentaHandler();
    const validarStatus = new ValidarStatusAreaHandler();
    const validarDisponibilidad = new ValidarDisponibilidadProductosHandler();
    const validarAlergias = new ValidarAlergiasHandler();
    const verificarEspera = new VerificarPedidosEsperaHandler();
    const procesarPedido = new ProcesarPedidoHandler();

    // Encadenar en el orden correcto:
    // 1. Validar área existe
    // 2. Validar área está activa
    // 3. Validar disponibilidad de productos
    // 4. Validar alergias del cliente
    // 5. Verificar pedidos en espera (advertencia)
    // 6. Procesar pedido
    validarArea
      .setNext(validarStatus)
      .setNext(validarDisponibilidad)
      .setNext(validarAlergias)
      .setNext(verificarEspera)
      .setNext(procesarPedido);

    return validarArea;
  }
}