import { BadRequestException } from '@nestjs/common';
import { PedidoHandler, PedidoContext } from './pedido-handler.base';
import { ProductosNoDisponiblesException } from './pedido.exceptions';

export class ValidarDisponibilidadProductosHandler extends PedidoHandler {
  constructor() {
    super('Disponibilidad de Productos.'); 
  }
  protected async process(context: PedidoContext): Promise<void> {
    console.log('Verificando disponibilidad de productos...');
    
    const productosInactivos: string[] = [];

    // Verificar cada producto del pedido
    for (const item of context.dto.productos) {
      const producto = await context.prisma.producto.findUnique({
        where: { id: item.producto_id },
        select: {
          id: true,
          nombre: true,
          estado: true,
          //status: true,
        },
      });

      if (!producto) {
        throw new BadRequestException(
          `El producto con ID ${item.producto_id} no existe`
        );
      }

      // Verificar si está inactivo
      if (producto.estado === false) {
        productosInactivos.push(producto.nombre);
      }
    }

    // Si hay productos con problemas, lanzar excepción con detalle
    if (productosInactivos.length > 0) {
      throw new ProductosNoDisponiblesException(
        productosInactivos,
      );
    }
    
    console.log('Todos los productos están disponibles');
  }
}