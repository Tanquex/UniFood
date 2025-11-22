import { PedidoHandler} from '../abstract/pedido-handler.base';
import { PedidoContext } from '../interfaces/pedido-context.interface';

export class VerificarPedidosEsperaHandler extends PedidoHandler {
  private readonly UMBRAL_ADVERTENCIA = 5; // Advertir si hay más de 5 pedidos en espera

  constructor() {
    super('Tiempo de espera.'); 
  }

  protected async process(context: PedidoContext): Promise<void> {
    console.log('Verificando pedidos en espera del área...');
    
    // Contar pedidos en estado pendiente (1) o en preparación (2) para esta área
    const pedidosEnEspera = await context.prisma.pedido.count({
      where: {
        area_venta_id: context.dto.area_venta_id,
        pedido_estado_id: {
          in: [1, 2], // 1: pendiente, 2: en preparación
        },
      },
    });

    context.pedidosEnEspera = pedidosEnEspera;

    if (pedidosEnEspera >= this.UMBRAL_ADVERTENCIA) {
      const mensaje = `Hay ${pedidosEnEspera} pedidos en espera en esta área. Tu pedido puede tardar más de lo habitual.`;
      
      if (!context.advertencias) {
        context.advertencias = [];
      }
      context.advertencias.push(mensaje);

      if (context.gateway) {
        context.gateway.emitValidacionProgreso(context.clienteId, {
          handler: this.handlerName,
          status: 'warning', 
          message: mensaje,
          timestamp: new Date().toISOString(),
        });
      }
      
      console.log(mensaje);
    } else {
      console.log(`Carga normal: ${pedidosEnEspera} pedidos en espera`);
    }
  }
}