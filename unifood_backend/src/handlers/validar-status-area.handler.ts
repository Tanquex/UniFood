import { PedidoHandler, PedidoContext } from './pedido-handler.base';
import { AreaInactivaException } from './pedido.exceptions';

export class ValidarStatusAreaHandler extends PedidoHandler {
  constructor() {
    super('Disponibilidad Area de Venta.'); 
  }
  protected async process(context: PedidoContext): Promise<void> {
    console.log('Validando status del área de venta...');
    
    if (!context.areaVenta) {
      throw new Error('El área de venta debe ser validada primero');
    }

    if (context.areaVenta.status === false) {
      throw new AreaInactivaException(context.areaVenta.area_venta);
    }
    
    console.log('Área de venta activa');
  }
}