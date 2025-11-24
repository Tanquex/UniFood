import { PedidoHandler } from '../abstract/pedido-handler.base';
import { PedidoContext } from '../interfaces/pedido-context.interface';
import { AlergiasDetectadasException } from '../exceptions/pedido.exceptions';

export class ValidarAlergiasHandler extends PedidoHandler {

  constructor() {
    super('Alergias.'); 
  }
  
  protected async process(context: PedidoContext): Promise<void> {
    console.log('Verificando alergias del cliente...');
    
    // Inicializar estado de validación si no existe
    if (!context.validacionEstado) {
      context.validacionEstado = {
        currentProductIndex: 0,
        validatedProducts: new Set<number>(),
        ignoredProducts: new Set<number>(),
        modifiedProducts: new Map<number, string>(),
        shouldStop: false,
      };
    }

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

    // Procesar productos uno por uno
    const estado = context.validacionEstado;
    const productos = context.dto.productos;

    // Si ya procesamos todos los productos, continuar
    if (estado.currentProductIndex >= productos.length) {
      console.log('✅ Validación de alergias completada: todos los productos validados');
      return;
    }

    // Obtener el producto actual
    const item = productos[estado.currentProductIndex];
    const productoId = item.producto_id;

    // CASO 1: Producto ya validado previamente
    if (estado.validatedProducts.has(productoId)) {
      estado.currentProductIndex++;
      // Continuar con el siguiente producto (llamada recursiva)
      await this.process(context);
      return;
    }

    // CASO 2: Usuario decidió ignorar warnings de este producto
    if (estado.ignoredProducts.has(productoId)) {
      estado.validatedProducts.add(productoId);
      estado.currentProductIndex++;
      // Continuar con el siguiente producto
      await this.process(context);
      return;
    }

    // CASO 3: Verificar el producto actual
    
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

    // Si no se encuentra el producto o no tiene ingredientes, marcarlo como validado y continuar
    if (!producto || !producto.ingredientes) {
      estado.validatedProducts.add(productoId);
      estado.currentProductIndex++;
      await this.process(context);
      return;
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

    // Si no hay ingredientes, marcar como validado y continuar
    if (ingredientes.length === 0) {
      estado.validatedProducts.add(productoId);
      estado.currentProductIndex++;
      await this.process(context);
      return;
    }

    // CASO 3a: Producto modificado - verificar con detalles especiales
    const modificaciones = estado.modifiedProducts.get(productoId);
    
    // Obtener detalles especiales del producto en el pedido
    const productoEnPedido = context.dto.productos.find(p => p.producto_id === productoId);
    const detallesEspeciales = productoEnPedido?.detalles_producto || modificaciones || undefined;

    // Verificar si el producto contiene alguna alergia usando IA
    if (context.alergiaIAService) {
        console.log(`🤖 Usando AlergiaIAService para verificar producto "${producto.nombre}"`);
        const resultado = await context.alergiaIAService.verificarProductoContieneAlergias(
          ingredientes,
          alergiasCliente,
          detallesEspeciales
        );
        console.log(`📊 Resultado de verificación: contiene=${resultado.contiene}, alergias=${resultado.alergiasEncontradas.join(', ') || 'ninguna'}`);

      if (resultado.contiene) {
        // DETENER la cadena y esperar decisión del usuario
        estado.shouldStop = true;

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
        }

        // Guardar información para la decisión del usuario
        estado.waitingForDecision = {
          productoId: producto.id,
          productoNombre: producto.nombre,
          alergiasEncontradas: resultado.alergiasEncontradas,
          ingredientesProblema: resultado.ingredientesProblema,
          alternativa: alternativa || undefined,
        };

        // Emitir evento de espera por decisión
        if (context.gateway) {
          context.gateway.emitValidacionProgreso(context.clienteId, {
            handler: this.handlerName,
            status: 'warning',
            message: `⚠️ El producto "${producto.nombre}" contiene ingredientes que pueden causar reacción alérgica: ${resultado.ingredientesProblema.join(', ')}. Alergias detectadas: ${resultado.alergiasEncontradas.join(', ')}.`,
            timestamp: new Date().toISOString(),
            waitingForDecision: true,
            productoId: producto.id,
            productoNombre: producto.nombre,
            alergiasEncontradas: resultado.alergiasEncontradas,
            ingredientesProblema: resultado.ingredientesProblema,
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

        // Detener aquí - no lanzar excepción, solo detener la cadena
        return;
      }
    } else {
      // Fallback: verificación básica sin IA
      console.warn('⚠️ AlergiaIAService no disponible, usando verificación básica');
      let tieneAlergenos = false;
      const alergiasEncontradas: string[] = [];
      
      for (const alergia of alergiasCliente) {
        const ingredientesStr = ingredientes.join(' ').toLowerCase();
        const alergiaLower = alergia.toLowerCase();
        
        if (ingredientesStr.includes(alergiaLower)) {
          tieneAlergenos = true;
          if (!alergiasEncontradas.includes(alergia)) {
            alergiasEncontradas.push(alergia);
          }
        }
      }

      if (tieneAlergenos) {
        // DETENER la cadena
        estado.shouldStop = true;
        estado.waitingForDecision = {
          productoId: producto.id,
          productoNombre: producto.nombre,
          alergiasEncontradas,
          ingredientesProblema: ingredientes.filter(ing => 
            alergiasEncontradas.some(al => ing.toLowerCase().includes(al.toLowerCase()))
          ),
        };

        if (context.gateway) {
          context.gateway.emitValidacionProgreso(context.clienteId, {
            handler: this.handlerName,
            status: 'warning',
            message: `⚠️ El producto "${producto.nombre}" puede contener ingredientes problemáticos.`,
            timestamp: new Date().toISOString(),
            waitingForDecision: true,
            productoId: producto.id,
            productoNombre: producto.nombre,
            alergiasEncontradas,
            ingredientesProblema: estado.waitingForDecision.ingredientesProblema,
          });
        }

        return;
      }
    }

    // CASO 4: Producto OK - marcar como validado y continuar
    estado.validatedProducts.add(productoId);
    estado.currentProductIndex++;
    
    // Continuar con el siguiente producto (llamada recursiva)
    await this.process(context);
  }
}