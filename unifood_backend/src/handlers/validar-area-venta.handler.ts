import { PedidoHandler, PedidoContext } from './pedido-handler.base';
import { AreaNoEncontradaException } from './pedido.exceptions';

export class ValidarAreaVentaHandler extends PedidoHandler {
  constructor() {
    super('Area de Venta.'); 
  }
  protected async process(context: PedidoContext): Promise<void> {
    console.log('Validando existencia del área de venta...');
    
    const areaVenta = await context.prisma.area_venta.findUnique({
      where: { id: context.dto.area_venta_id },
    });

    if (!areaVenta) {
      throw new AreaNoEncontradaException(context.dto.area_venta_id);
    }

    // Guardar en el contexto para que otros handlers lo usen
    context.areaVenta = areaVenta;
    
    console.log('Área de venta encontrada:', areaVenta.area_venta);
  }
}