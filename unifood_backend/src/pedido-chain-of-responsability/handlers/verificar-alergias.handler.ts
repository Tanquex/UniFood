import { PedidoHandler } from '../abstract/pedido-handler.base';
import { PedidoContext } from '../interfaces/pedido-context.interface';
import { AlergiasDetectadasException } from '../exceptions/pedido.exceptions';

export class ValidarAlergiasHandler extends PedidoHandler {

  constructor() {
    super('Alergias.'); 
  }
  
  protected async process(context: PedidoContext): Promise<void> {
    console.log('Verificando alergias del cliente...');
    
    // Obtener alergias del cliente
    const cliente = await context.prisma.cliente.findUnique({
      where: { id: context.clienteId },
    });

    if (!cliente) {
      console.log('Cliente no encontrado, saltando validación de alergias');
      return;
    }

    // Parsear alergias (puede ser JSON o array)
    let alergiasCliente: string[] = [];
    const alergiaField = (cliente as any).alergia;
    if (alergiaField) {
      if (typeof alergiaField === 'string') {
        try {
          alergiasCliente = JSON.parse(alergiaField);
        } catch {
          alergiasCliente = [alergiaField];
        }
      } else if (Array.isArray(alergiaField)) {
        alergiasCliente = alergiaField;
      }
    }

    // Si no tiene alergias, no hay nada que validar
    if (!alergiasCliente || alergiasCliente.length === 0) {
      console.log('Cliente no tiene alergias registradas');
      return;
    }

    console.log(`Alergias del cliente: ${alergiasCliente.join(', ')}`);

    // Verificar cada producto del pedido
    const productosConAlergenos: string[] = [];
    const alergiasEncontradas: string[] = [];
    const alternativas: Array<{
      productoOriginalId: number;
      productoOriginalNombre: string;
      productoAlternativo: any;
      razon: string;
    }> = [];

    // Obtener productos disponibles del área para recomendaciones
    let productosDisponibles: any[] = [];
    if (context.areaVenta?.id) {
      productosDisponibles = await context.prisma.producto.findMany({
        where: {
          area_venta_id: context.areaVenta.id,
          estado: true,
        },
        include: {
          categoria: true,
        },
      });
    }

    for (const item of context.dto.productos) {
      // Obtener el producto con sus ingredientes
      const producto = await context.prisma.producto.findUnique({
        where: { id: item.producto_id },
        select: {
          id: true,
          nombre: true,
          descripcion: true,
          ingredientes: true,
        },
      });

      if (!producto || !producto.ingredientes) {
        continue;
      }

      // Parsear ingredientes
      let ingredientes: string[] = [];
      if (typeof producto.ingredientes === 'string') {
        try {
          ingredientes = JSON.parse(producto.ingredientes);
        } catch {
          ingredientes = [producto.ingredientes];
        }
      } else if (Array.isArray(producto.ingredientes)) {
        ingredientes = producto.ingredientes;
      }

      if (ingredientes.length === 0) {
        continue;
      }

      // Verificar si el producto contiene alguna alergia usando IA
      if (context.alergiaIAService) {
        const resultado = await context.alergiaIAService.verificarProductoContieneAlergias(
          ingredientes,
          alergiasCliente
        );

        if (resultado.contiene) {
          productosConAlergenos.push(producto.nombre);
          resultado.alergiasEncontradas.forEach(alergia => {
            if (!alergiasEncontradas.includes(alergia)) {
              alergiasEncontradas.push(alergia);
            }
          });

          // Buscar producto alternativo usando IA
          let alternativa: { producto: any; razon: string } | null = null;
          if (context.alergiaIAService && productosDisponibles.length > 0) {
            alternativa = await context.alergiaIAService.recomendarProductoAlternativo(
              {
                id: producto.id,
                nombre: producto.nombre,
                ingredientes: producto.ingredientes,
                descripcion: producto.descripcion || null,
              },
              alergiasCliente,
              productosDisponibles
            );

            if (alternativa) {
              alternativas.push({
                productoOriginalId: producto.id,
                productoOriginalNombre: producto.nombre,
                productoAlternativo: alternativa.producto,
                razon: alternativa.razon,
              });
            }
          }

          // Agregar advertencia al contexto
          if (!context.advertencias) {
            context.advertencias = [];
          }
          
          const ingredientesProblema = resultado.ingredientesProblema.join(', ');
          let mensaje = `⚠️ El producto "${producto.nombre}" contiene ingredientes que pueden causar reacción alérgica: ${ingredientesProblema}. Alergias detectadas: ${resultado.alergiasEncontradas.join(', ')}.`;
          
          if (alternativa) {
            mensaje += ` Sugerencia: "${alternativa.producto.nombre}" - ${alternativa.razon}`;
          }
          
          context.advertencias.push(mensaje);

          // Emitir advertencia por WebSocket si está disponible
          if (context.gateway) {
            context.gateway.emitValidacionProgreso(context.clienteId, {
              handler: this.handlerName,
              status: 'warning',
              message: mensaje,
              timestamp: new Date().toISOString(),
              alternativa: alternativa ? {
                productoOriginalId: producto.id,
                productoOriginalNombre: producto.nombre,
                productoAlternativo: {
                  id: alternativa.producto.id,
                  nombre: alternativa.producto.nombre,
                  precio: Number(alternativa.producto.precio),
                  descripcion: alternativa.producto.descripcion,
                  imagen_url: alternativa.producto.imagen_url,
                },
                razon: alternativa.razon,
              } : null,
            });
          }
        }
      } else {
        // Fallback: verificación básica sin IA
        console.warn('⚠️ AlergiaIAService no disponible, usando verificación básica');
        for (const alergia of alergiasCliente) {
          const ingredientesStr = ingredientes.join(' ').toLowerCase();
          const alergiaLower = alergia.toLowerCase();
          
          if (ingredientesStr.includes(alergiaLower)) {
            productosConAlergenos.push(producto.nombre);
            if (!alergiasEncontradas.includes(alergia)) {
              alergiasEncontradas.push(alergia);
            }
          }
        }
      }
    }

    // Guardar alternativas en el contexto
    if (alternativas.length > 0) {
      context.alternativasProductos = alternativas;
    }

    // Si se encontraron productos con alergenos, lanzar excepción
    if (productosConAlergenos.length > 0) {
      throw new AlergiasDetectadasException(
        alergiasEncontradas,
        productosConAlergenos,
        alternativas
      );
    }

    console.log('✅ Validación de alergias completada: no se encontraron conflictos');
  }
}