import { PedidoHandler, PedidoContext } from './pedido-handler.base';

export class ValidarAlergiasHandler extends PedidoHandler {

  constructor() {
    super('Alergias.'); 
  }
  protected async process(context: PedidoContext): Promise<void> {
    console.log('Verificando alergias del cliente...');
    
    // TODO: Implementar lógica de validación de alergias
    // Por ahora solo estructura base
    
    // Ejemplo de lo que vendría:
    // const cliente = await context.prisma.cliente.findUnique({
    //   where: { id: context.clienteId },
    //   select: { alergias: true }
    // });
    
    // if (cliente?.alergias && cliente.alergias.length > 0) {
    //   // Verificar productos contra alergias
    //   // Agregar advertencias si es necesario
    // }
    
    console.log('Validación de alergias (pendiente de implementar)');
  }
}