
import { PedidoHandler, PedidoContext } from './pedido-handler.base';

export class ProcesarPedidoHandler extends PedidoHandler {

  constructor() {
    super('Pedido Validado.'); 
  }
  protected async process(context: PedidoContext): Promise<void> {
    console.log('Todas las validaciones completadas');
    console.log('Procesar pedido');
    
    // Este handler no hace nada más que confirmar que todo está listo
    // La lógica de creación del pedido seguirá en el servicio
    
    if (context.advertencias && context.advertencias.length > 0) {
      console.log('Advertencias detectadas:', context.advertencias);
    }
  }
}