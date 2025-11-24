import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PagosClient } from '../clients/pagos.client';
import { ComunicacionClient } from '../clients/comunicacion.client';
import {
  CrearPedidoDto,
  RechazarPedidoDto,
  EntregarPedidoDto,
  CalificarProductoDto,
  ProcesarPagoTarjetaDto,
  FiltrosReporteDto,
  OpcionesReporteDto,
  OpcionesTicketDto,
} from '../models/pedido.model';
import { PedidoGateway } from './../gateways/pedido.gateway';
import { AlergiaIAService } from './alergia-ia.service';

//Cadena de responsabilidades
import { PedidoChainFactory } from 'src/pedido-chain-of-responsability/pedido-chain.factory';
import { PedidoContext } from 'src/pedido-chain-of-responsability/interfaces/pedido-context.interface';

@Injectable()
export class PedidosService {
  private prisma = new PrismaClient();
  private readonly MAX_PEDIDOS_EN_PROCESO = 3;
  // Almacenamiento temporal de contextos de validación en espera de decisión
  private contextosPendientes: Map<string, PedidoContext> = new Map();

  constructor(
    private readonly pagosClient: PagosClient,
    private readonly comunicacionClient: ComunicacionClient,
    private readonly pedidoGateway: PedidoGateway,
    private readonly alergiaIAService: AlergiaIAService,
  ) {}

  // =============== MÉTODOS PARA CLIENTE ===============
  //Crear con cadena de responsabilidades.
  async crear(dto: CrearPedidoDto, clienteId: number) {
    const chain = PedidoChainFactory.create();

    // Ejecutar la cadena de responsabilidades
    const context: PedidoContext = {
      dto,
      clienteId,
      prisma: this.prisma,
      gateway: this.pedidoGateway,
      alergiaIAService: this.alergiaIAService,
    };

    //Ejecutar las validaciones
    await chain.handle(context);

    // Si la cadena se detuvo esperando decisión del usuario, retornar información
    if (context.validacionEstado?.shouldStop && context.validacionEstado.waitingForDecision) {
      const sessionId = `pedido_${Date.now()}_${clienteId}_${Math.random().toString(36).substr(2, 9)}`;
      this.contextosPendientes.set(sessionId, context);
      
      // Limpiar contexto después de 10 minutos
      setTimeout(() => {
        this.contextosPendientes.delete(sessionId);
      }, 10 * 60 * 1000);

      // Type assertion explícito para ayudar a TypeScript
      const decision = context.validacionEstado.waitingForDecision as {
        productoId: number;
        productoNombre: string;
        alergiasEncontradas: string[];
        ingredientesProblema: string[];
        alternativa?: {
          producto: any;
          razon: string;
        };
      };

      return {
        waitingForDecision: true,
        sessionId,
        producto: {
          id: decision.productoId,
          nombre: decision.productoNombre,
          alergiasEncontradas: decision.alergiasEncontradas,
          ingredientesProblema: decision.ingredientesProblema,
        },
        alternativa: decision.alternativa ? {
          producto: {
            id: decision.alternativa.producto.id,
            nombre: decision.alternativa.producto.nombre,
            precio: Number(decision.alternativa.producto.precio),
            descripcion: decision.alternativa.producto.descripcion,
            imagen_url: decision.alternativa.producto.imagen_url,
          },
          razon: decision.alternativa.razon,
        } : null,
      };
    }

    //Si llega aquí, todas las validaciones pasaron
    const total = dto.productos.reduce((sum, p) => sum + p.precio_unitario * p.cantidad, 0);

    const codigo = `PED-${Date.now()}-${clienteId}`;

    const pagoMetodoId = dto.metodo_pago === 'tarjeta' ? 1 : 2; // 1=tarjeta, 2=efectivo

    if (dto.metodo_pago === 'tarjeta') {
      // ===== PAGO CON TARJETA =====
      if (!dto.datos_tarjeta) {
        throw new BadRequestException('Datos de tarjeta requeridos');
      }

      try {
        // Procesar pago en el microservicio PRIMERO
        const resultadoPago = await this.pagosClient.procesarPago({
          pedidoId: 0, // Temporal, se actualizará
          monto: total,
          tarjeta: dto.datos_tarjeta,
        });

        if (!resultadoPago.success) {
          throw new BadRequestException(resultadoPago.mensaje || 'Error al procesar el pago');
        }

        // Crear pedido SOLO si el pago fue exitoso
        const pedido = await this.prisma.pedido.create({
          data: {
            codigo,
            cliente_id: clienteId,
            area_venta_id: dto.area_venta_id,
            total_pedido: new Prisma.Decimal(total),
            detalles_pedido: dto.detalles_pedido || null,
            pedido_estado_id: 1, // pendiente
            pedido_productos: {
              create: dto.productos.map((p) => ({
                producto_id: p.producto_id,
                cantidad: p.cantidad,
                precio_unitario: new Prisma.Decimal(p.precio_unitario),
                detalles_producto: p.detalles_producto || null,
              })),
            },
          },
          include: {
            cliente: true,
            pedido_productos: { include: { producto: true } },
            area_venta: true,
            pagos: {
              include: {
                pago_metodo: true,
                pago_estado: true,
              },
            },
          },
        });

        // Actualizar el pedido_id en el pago del microservicio
        await this.prisma.pago.update({
          where: { id: resultadoPago.pagoId },
          data: { pedido_id: pedido.id },
        });

        // Recargar pedido con pagos actualizados
        const pedidoCompleto = await this.prisma.pedido.findUnique({
          where: { id: pedido.id },
          include: {
            cliente: true,
            pedido_productos: { include: { producto: true } },
            area_venta: true,
            pagos: {
              include: {
                pago_metodo: true,
                pago_estado: true,
              },
            },
          },
        });

        // Notificar por WebSocket
        this.pedidoGateway.notificarNuevoPedidoCliente(pedidoCompleto);
        this.pedidoGateway.notificarNuevoPedido(pedidoCompleto);

        return {
          pedido: pedidoCompleto,
          advertencias: context.advertencias || [],
        };
      } catch (error) {
        console.error('Error al crear pedido con tarjeta:', error);
        throw new BadRequestException(error.message || 'Error al procesar el pedido con tarjeta');
      }
    } else {
      // ===== PAGO EN EFECTIVO =====
      const pedido = await this.prisma.pedido.create({
        data: {
          codigo,
          cliente_id: clienteId,
          area_venta_id: dto.area_venta_id,
          total_pedido: new Prisma.Decimal(total),
          detalles_pedido: dto.detalles_pedido || null,
          pedido_estado_id: 1, // pendiente
          pedido_productos: {
            create: dto.productos.map((p) => ({
              producto_id: p.producto_id,
              cantidad: p.cantidad,
              precio_unitario: new Prisma.Decimal(p.precio_unitario),
              detalles_producto: p.detalles_producto || null,
            })),
          },
          // Crear el registro de pago PENDIENTE para efectivo
          pagos: {
            create: {
              cantidad: new Prisma.Decimal(total),
              pago_metodo_id: pagoMetodoId,
              pago_estado_id: 2, // pendiente
              fecha: new Date(),
            },
          },
        },
        include: {
          cliente: true,
          pedido_productos: { include: { producto: true } },
          area_venta: true,
          pagos: {
            include: {
              pago_metodo: true,
              pago_estado: true,
            },
          },
        },
      });

      // Notificar por WebSocket
      this.pedidoGateway.notificarNuevoPedidoCliente(pedido);
      this.pedidoGateway.notificarNuevoPedido(pedido);

      return {
        pedido,
        advertencias: context.advertencias || [],
      };
    }
  }

  // Manejar decisión del usuario sobre producto con alergias
  async manejarDecisionAlergia(
    sessionId: string,
    decisionDto: { accion: 'REMOVE' | 'ADD_DETAILS' | 'CONTINUE'; producto_id: number; detalles_especiales?: string },
    clienteId: number
  ) {
    const context = this.contextosPendientes.get(sessionId);
    
    if (!context) {
      throw new NotFoundException('Sesión de validación no encontrada o expirada');
    }

    if (context.clienteId !== clienteId) {
      throw new UnauthorizedException('No tienes permiso para esta sesión');
    }

    const estado = context.validacionEstado;
    if (!estado || !estado.waitingForDecision) {
      throw new BadRequestException('No hay decisión pendiente para esta sesión');
    }

    if (estado.waitingForDecision.productoId !== decisionDto.producto_id) {
      throw new BadRequestException('El producto no coincide con la decisión pendiente');
    }

    // Aplicar la decisión del usuario
    switch (decisionDto.accion) {
      case 'REMOVE':
        // Eliminar el producto del DTO
        context.dto.productos = context.dto.productos.filter(
          p => p.producto_id !== decisionDto.producto_id
        );
        // No avanzar el índice (el siguiente producto tomará su lugar)
        estado.shouldStop = false;
        estado.waitingForDecision = undefined;
        break;

      case 'ADD_DETAILS':
        // Agregar detalles especiales al producto
        const productoIndex = context.dto.productos.findIndex(
          p => p.producto_id === decisionDto.producto_id
        );
        if (productoIndex !== -1) {
          const detallesActuales = context.dto.productos[productoIndex].detalles_producto || '';
          context.dto.productos[productoIndex].detalles_producto = 
            detallesActuales ? `${detallesActuales}, ${decisionDto.detalles_especiales}` : decisionDto.detalles_especiales;
          
          // Guardar modificaciones para revalidar
          estado.modifiedProducts.set(decisionDto.producto_id, decisionDto.detalles_especiales || '');
        }
        // NO avanzar el índice - revalidar el mismo producto
        estado.shouldStop = false;
        estado.waitingForDecision = undefined;
        break;

      case 'CONTINUE':
        // Marcar producto como ignorado y continuar
        estado.ignoredProducts.add(decisionDto.producto_id);
        estado.validatedProducts.add(decisionDto.producto_id);
        estado.currentProductIndex++;
        estado.shouldStop = false;
        estado.waitingForDecision = undefined;
        break;
    }

    // Continuar la validación desde donde se detuvo
    const chain = PedidoChainFactory.create();
    await chain.handle(context);

    // Si se detuvo nuevamente, retornar nueva decisión pendiente
    if (estado.shouldStop && estado.waitingForDecision) {
      // Type assertion explícito para ayudar a TypeScript
      const decision = estado.waitingForDecision as {
        productoId: number;
        productoNombre: string;
        alergiasEncontradas: string[];
        ingredientesProblema: string[];
        alternativa?: {
          producto: any;
          razon: string;
        };
      };
      return {
        waitingForDecision: true,
        sessionId, // Mantener el mismo sessionId
        producto: {
          id: decision.productoId,
          nombre: decision.productoNombre,
          alergiasEncontradas: decision.alergiasEncontradas,
          ingredientesProblema: decision.ingredientesProblema,
        },
        alternativa: decision.alternativa ? {
          producto: {
            id: decision.alternativa.producto.id,
            nombre: decision.alternativa.producto.nombre,
            precio: Number(decision.alternativa.producto.precio),
            descripcion: decision.alternativa.producto.descripcion,
            imagen_url: decision.alternativa.producto.imagen_url,
          },
          razon: decision.alternativa.razon,
        } : null,
      };
    }

    // Si llegamos aquí, todas las validaciones pasaron
    // Limpiar el contexto pendiente
    this.contextosPendientes.delete(sessionId);

    // Crear el pedido
    const total = context.dto.productos.reduce((sum, p) => sum + p.precio_unitario * p.cantidad, 0);
    const codigo = `PED-${Date.now()}-${clienteId}`;
    const pagoMetodoId = context.dto.metodo_pago === 'tarjeta' ? 1 : 2;

    if (context.dto.metodo_pago === 'tarjeta') {
      if (!context.dto.datos_tarjeta) {
        throw new BadRequestException('Datos de tarjeta requeridos');
      }

      try {
        const resultadoPago = await this.pagosClient.procesarPago({
          pedidoId: 0,
          monto: total,
          tarjeta: context.dto.datos_tarjeta,
        });

        if (!resultadoPago.success) {
          throw new BadRequestException(resultadoPago.mensaje || 'Error al procesar el pago');
        }

        const pedido = await this.prisma.pedido.create({
          data: {
            codigo,
            cliente_id: clienteId,
            area_venta_id: context.dto.area_venta_id,
            total_pedido: new Prisma.Decimal(total),
            detalles_pedido: context.dto.detalles_pedido || null,
            pedido_estado_id: 1,
            pedido_productos: {
              create: context.dto.productos.map((p) => ({
                producto_id: p.producto_id,
                cantidad: p.cantidad,
                precio_unitario: new Prisma.Decimal(p.precio_unitario),
                detalles_producto: p.detalles_producto || null,
              })),
            },
          },
          include: {
            cliente: true,
            pedido_productos: { include: { producto: true } },
            area_venta: true,
            pagos: {
              include: {
                pago_metodo: true,
                pago_estado: true,
              },
            },
          },
        });

        await this.prisma.pago.update({
          where: { id: resultadoPago.pagoId },
          data: { pedido_id: pedido.id },
        });

        const pedidoCompleto = await this.prisma.pedido.findUnique({
          where: { id: pedido.id },
          include: {
            cliente: true,
            pedido_productos: { include: { producto: true } },
            area_venta: true,
            pagos: {
              include: {
                pago_metodo: true,
                pago_estado: true,
              },
            },
          },
        });

        this.pedidoGateway.notificarNuevoPedidoCliente(pedidoCompleto);
        this.pedidoGateway.notificarNuevoPedido(pedidoCompleto);

        return {
          pedido: pedidoCompleto,
          advertencias: context.advertencias || [],
        };
      } catch (error) {
        console.error('Error al crear pedido con tarjeta:', error);
        throw new BadRequestException(error.message || 'Error al procesar el pedido con tarjeta');
      }
    } else {
      // Pago en efectivo
      const pedido = await this.prisma.pedido.create({
        data: {
          codigo,
          cliente_id: clienteId,
          area_venta_id: context.dto.area_venta_id,
          total_pedido: new Prisma.Decimal(total),
          detalles_pedido: context.dto.detalles_pedido || null,
          pedido_estado_id: 1,
          pedido_productos: {
            create: context.dto.productos.map((p) => ({
              producto_id: p.producto_id,
              cantidad: p.cantidad,
              precio_unitario: new Prisma.Decimal(p.precio_unitario),
              detalles_producto: p.detalles_producto || null,
            })),
          },
          pagos: {
            create: {
              cantidad: new Prisma.Decimal(total),
              pago_metodo_id: pagoMetodoId,
              pago_estado_id: 2,
              fecha: new Date(),
            },
          },
        },
        include: {
          cliente: true,
          pedido_productos: { include: { producto: true } },
          area_venta: true,
          pagos: {
            include: {
              pago_metodo: true,
              pago_estado: true,
            },
          },
        },
      });

      this.pedidoGateway.notificarNuevoPedidoCliente(pedido);
      this.pedidoGateway.notificarNuevoPedido(pedido);

      return {
        pedido,
        advertencias: context.advertencias || [],
      };
    }
  }

  async crear3(dto: CrearPedidoDto, clienteId: number) {
    // Validar que el área de venta exista y esté activa
    const areaVenta = await this.prisma.area_venta.findUnique({
      where: { id: dto.area_venta_id },
    });

    if (!areaVenta) {
      throw new NotFoundException('Área de venta no encontrada');
    }

    if (areaVenta.status === false) {
      throw new BadRequestException('El área de venta no está activa en este momento');
    }

    // Calcular total
    const total = dto.productos.reduce((sum, p) => sum + p.precio_unitario * p.cantidad, 0);

    // Generar código único
    const codigo = `PED-${Date.now()}-${clienteId}`;

    const pagoMetodoId = dto.metodo_pago === 'tarjeta' ? 1 : 2; // 1=tarjeta, 2=efectivo

    if (dto.metodo_pago === 'tarjeta') {
      // ===== PAGO CON TARJETA =====
      if (!dto.datos_tarjeta) {
        throw new BadRequestException('Datos de tarjeta requeridos');
      }

      try {
        //  Procesar pago en el microservicio PRIMERO
        const resultadoPago = await this.pagosClient.procesarPago({
          pedidoId: 0, // Temporal, se actualizará
          monto: total,
          tarjeta: dto.datos_tarjeta,
        });

        if (!resultadoPago.success) {
          throw new BadRequestException(resultadoPago.mensaje || 'Error al procesar el pago');
        }

        //  Crear pedido SOLO si el pago fue exitoso
        const pedido = await this.prisma.pedido.create({
          data: {
            codigo,
            cliente_id: clienteId,
            area_venta_id: dto.area_venta_id,
            total_pedido: new Prisma.Decimal(total),
            detalles_pedido: dto.detalles_pedido || null,
            pedido_estado_id: 1, // pendiente
            pedido_productos: {
              create: dto.productos.map((p) => ({
                producto_id: p.producto_id,
                cantidad: p.cantidad,
                precio_unitario: new Prisma.Decimal(p.precio_unitario),
                detalles_producto: p.detalles_producto || null,
              })),
            },
          },
          include: {
            cliente: true,
            pedido_productos: { include: { producto: true } },
            area_venta: true,
            pagos: {
              include: {
                pago_metodo: true,
                pago_estado: true,
              },
            },
          },
        });

        //Actualizar el pedido_id en el pago del microservicio
        await this.prisma.pago.update({
          where: { id: resultadoPago.pagoId },
          data: { pedido_id: pedido.id },
        });

        // Recargar pedido con pagos actualizados
        const pedidoCompleto = await this.prisma.pedido.findUnique({
          where: { id: pedido.id },
          include: {
            cliente: true,
            pedido_productos: { include: { producto: true } },
            area_venta: true,
            pagos: {
              include: {
                pago_metodo: true,
                pago_estado: true,
              },
            },
          },
        });

        // Notificar por WebSocket
        this.pedidoGateway.notificarNuevoPedidoCliente(pedidoCompleto);
        this.pedidoGateway.notificarNuevoPedido(pedidoCompleto);

        return pedidoCompleto;
      } catch (error) {
        console.error('❌ Error al crear pedido con tarjeta:', error);
        throw new BadRequestException(error.message || 'Error al procesar el pedido con tarjeta');
      }
    } else {
      // ===== PAGO EN EFECTIVO (FLUJO ORIGINAL SIN CAMBIOS) =====
      const pedido = await this.prisma.pedido.create({
        data: {
          codigo,
          cliente_id: clienteId,
          area_venta_id: dto.area_venta_id,
          total_pedido: new Prisma.Decimal(total),
          detalles_pedido: dto.detalles_pedido || null,
          pedido_estado_id: 1, // pendiente
          pedido_productos: {
            create: dto.productos.map((p) => ({
              producto_id: p.producto_id,
              cantidad: p.cantidad,
              precio_unitario: new Prisma.Decimal(p.precio_unitario),
              detalles_producto: p.detalles_producto || null,
            })),
          },
          // Crear el registro de pago PENDIENTE para efectivo
          pagos: {
            create: {
              cantidad: new Prisma.Decimal(total),
              pago_metodo_id: pagoMetodoId,
              pago_estado_id: 2, // pendiente
              fecha: new Date(),
            },
          },
        },
        include: {
          cliente: true,
          pedido_productos: { include: { producto: true } },
          area_venta: true,
          pagos: {
            include: {
              pago_metodo: true,
              pago_estado: true,
            },
          },
        },
      });

      // Notificar por WebSocket
      this.pedidoGateway.notificarNuevoPedidoCliente(pedido);
      this.pedidoGateway.notificarNuevoPedido(pedido);

      return pedido;
    }
  }

  async crear2(dto: CrearPedidoDto, clienteId: number) {
    // Validar que el área de venta exista y esté activa
    const areaVenta = await this.prisma.area_venta.findUnique({
      where: { id: dto.area_venta_id },
    });

    if (!areaVenta) {
      throw new NotFoundException('Área de venta no encontrada');
    }

    if (areaVenta.status === false) {
      throw new BadRequestException('El área de venta no está activa en este momento');
    }

    // Calcular total
    const total = dto.productos.reduce((sum, p) => sum + p.precio_unitario * p.cantidad, 0);

    // Generar código único
    const codigo = `PED-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${clienteId}`;

    const pagoMetodoId = dto.metodo_pago === 'tarjeta' ? 1 : 2; // 1=tarjeta, 2=efectivo

    // Crear pedido en BD (estado pendiente, SIN procesar pago todavía)
    const pedido = await this.prisma.pedido.create({
      data: {
        codigo,
        cliente_id: clienteId,
        area_venta_id: dto.area_venta_id,
        total_pedido: new Prisma.Decimal(total),
        detalles_pedido: dto.detalles_pedido || null,
        pedido_estado_id: 1, // pendiente
        //metodo_pago_seleccionado: dto.metodo_pago,
        pedido_productos: {
          create: dto.productos.map((p) => ({
            producto_id: p.producto_id,
            cantidad: p.cantidad,
            precio_unitario: new Prisma.Decimal(p.precio_unitario),
            detalles_producto: p.detalles_producto || null,
          })),
        },
        // AGREGAR: Crear el registro de pago PENDIENTE
        pagos: {
          create: {
            cantidad: new Prisma.Decimal(total),
            pago_metodo_id: pagoMetodoId,
            pago_estado_id: 2, // 2=pendiente (tarjeta), 1=completado (efectivo)
            fecha: new Date(),
          },
        },
      },
      include: {
        cliente: true,
        pedido_productos: { include: { producto: true } },
        area_venta: true,
        pagos: {
          include: {
            pago_metodo: true,
            pago_estado: true,
          },
        },
      },
    });

    // Notificar por WebSocket a vendedores del área
    this.pedidoGateway.notificarNuevoPedidoCliente(pedido);
    this.pedidoGateway.notificarNuevoPedido(pedido);

    return pedido;
  }

  async obtenerMisPedidosActivos(clienteId: number) {
    // Obtener el pedido más reciente que no esté entregado ni cancelado
    const pedidos = await this.prisma.pedido.findMany({
      where: {
        cliente_id: clienteId,
        pedido_estado_id: { in: [1, 2, 3] }, // pendiente, en_proceso, listo
      },
      include: {
        pedido_productos: {
          include: {
            producto: true,
          },
        },
        pedido_estado: true,
        pagos: {
          include: {
            pago_metodo: true,
            pago_estado: true,
          },
        },
        area_venta: true,
        cliente: true,
      },
      orderBy: { fecha_registro: 'desc' },
    });

    // Log para debugging
    if (pedidos) {
    } else {
    }

    return pedidos;
  }

  async cancelarPorCliente(pedidoId: number, clienteId: number) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: { cliente: true, pagos: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.cliente_id !== clienteId)
      throw new UnauthorizedException('No puedes cancelar este pedido');
    if (pedido.pedido_estado_id !== 1)
      throw new BadRequestException('Solo se pueden cancelar pedidos pendientes');

    // Si tiene pago con tarjeta, solicitar reembolso
    if (pedido.pagos.find((p) => p.pago_metodo_id === 1)) {
      const pagoTarjeta = pedido.pagos.find((p) => p.pago_metodo_id === 1);

      if (pagoTarjeta) {
        await this.pagosClient.reembolsarPago(pagoTarjeta.id, 'Pedido cancelado por el cliente');

        // Actualizar estado del pago a cancelado
        await this.prisma.pago.update({
          where: { id: pagoTarjeta.id },
          data: { pago_estado_id: 3 }, // 3 = cancelado
        });
      }
    } else {
      // Si solo está pendiente, simplemente cancelarlo siendo pago en efectivo
      const pagoPendiente = pedido.pagos.find((p) => p.pago_metodo_id === 2);

      if (pagoPendiente) {
        await this.prisma.pago.update({
          where: { id: pagoPendiente.id },
          data: { pago_estado_id: 3 }, // 3 = cancelado
        });
      }
    }

    // Actualizar estado a cancelado
    const pedidoActualizado = await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: { pedido_estado_id: 5 }, // 5 = cancelado
      include: {
        cliente: true,
        pedido_productos: { include: { producto: true } },
      },
    });

    this.pedidoGateway.notificarCambioPedido(pedidoActualizado);

    return { mensaje: 'Pedido cancelado exitosamente' };
  }

  // =============== MÉTODOS PARA VENDEDOR ===============

  async obtenerPendientes(areaVentaId?: number) {
    const where: any = { pedido_estado_id: 1 }; // pendiente

    if (areaVentaId) {
      where.area_venta_id = areaVentaId;
    }

    return this.prisma.pedido.findMany({
      where,
      include: {
        cliente: true,
        pedido_productos: { include: { producto: true } },
        pagos: true,
      },
      orderBy: { fecha_registro: 'asc' },
    });
  }

  async obtenerEnProceso(areaVentaId?: number) {
    const where: any = { pedido_estado_id: 2 }; // en_proceso

    if (areaVentaId) {
      where.area_venta_id = areaVentaId;
    }

    return this.prisma.pedido.findMany({
      where,
      include: {
        cliente: true,
        pedido_productos: { include: { producto: true } },
        pagos: true,
      },
      orderBy: { fecha_registro: 'asc' },
    });
  }

  async obtenerListos(areaVentaId?: number) {
    const where: any = { pedido_estado_id: 3 }; // listo

    if (areaVentaId) {
      where.area_venta_id = areaVentaId;
    }

    return this.prisma.pedido.findMany({
      where,
      include: {
        cliente: true,
        pedido_productos: { include: { producto: true } },
        pagos: true,
      },
      orderBy: { fecha_registro: 'asc' },
    });
  }

  async aceptarPedido(pedidoId: number, areaVentaId?: number) {
    // Buscar el pedido primero para obtener su área
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: {
        cliente: true,
        pedido_productos: {
          include: {
            producto: true,
          },
        },
        pagos: true,
      },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    if (pedido.pedido_estado_id !== 1) {
      throw new BadRequestException('Solo se pueden aceptar pedidos pendientes');
    }

    // Verificar límite de pedidos en proceso POR ÁREA
    const pedidosEnProceso = await this.prisma.pedido.count({
      where: {
        pedido_estado_id: 2,
        area_venta_id: pedido.area_venta_id,
      },
    });

    if (pedidosEnProceso >= this.MAX_PEDIDOS_EN_PROCESO) {
      throw new BadRequestException(
        `No se pueden tener más de ${this.MAX_PEDIDOS_EN_PROCESO} pedidos en proceso en esta área`,
      );
    }

    // Actualizar estado a en_proceso
    const pedidoActualizado = await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: { pedido_estado_id: 2 }, // en_proceso
      include: { cliente: true, pagos: true, pedido_productos: { include: { producto: true } } },
    });

    this.pedidoGateway.notificarCambioPedido(pedidoActualizado);

    return pedidoActualizado;
  }

  async rechazarPedido(pedidoId: number, dto: RechazarPedidoDto) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: { cliente: true, pagos: true },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.pedido_estado_id !== 1)
      throw new BadRequestException('Solo se pueden rechazar pedidos pendientes');

    // Si tiene pago con tarjeta COMPLETADO, solicitar reembolso
    if (pedido.pagos.find((p) => p.pago_metodo_id === 1)) {
      const pagoTarjeta = pedido.pagos.find((p) => p.pago_metodo_id === 1);

      if (pagoTarjeta) {
        await this.pagosClient.reembolsarPago(pagoTarjeta.id, `Pedido rechazado: ${dto.motivo}`);

        /* Actualizar estado del pago a cancelado
        await this.prisma.pago.update({
          where: { id: pagoTarjeta.id },
          data: { pago_estado_id: 3 }, // 3 = cancelado
        });*/
      }
    } else {
      // Si solo está pendiente, simplemente cancelarlo
      const pagoPendiente = pedido.pagos.find((p) => p.pago_metodo_id === 2);

      if (pagoPendiente) {
        await this.prisma.pago.update({
          where: { id: pagoPendiente.id },
          data: { pago_estado_id: 3 }, // 3 = cancelado
        });
      }
    }

    // Actualizar estado a cancelado Y guardar el motivo en detalles_pedido
    const pedidoActualizado = await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: {
        pedido_estado_id: 6, // cancelado
        detalles_pedido: `RECHAZADO: ${dto.motivo}`, // Guardar el motivo
      },
      include: {
        cliente: true,
        pedido_productos: { include: { producto: true } },
      },
    });

    this.pedidoGateway.notificarPedidoRechazado(pedidoActualizado);

    return { mensaje: 'Pedido rechazado y cliente notificado' };
  }

  async marcarComoListo(pedidoId: number) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: {
        cliente: true,
        pedido_productos: {
          include: { producto: true },
        },
        pagos: true,
      },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.pedido_estado_id !== 2)
      throw new BadRequestException('Solo se pueden marcar como listos pedidos en proceso');

    const pedidoActualizado = await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: { pedido_estado_id: 3 }, // listo
      include: {
        area_venta: true,
        cliente: true,
        pedido_productos: { include: { producto: true } },
        pagos: true,
      },
    });

    // Notificar al cliente que puede recoger (SMS)
    if (
      pedidoActualizado.cliente &&
      pedidoActualizado.cliente?.telefono &&
      pedidoActualizado.area_venta
    ) {
      await this.comunicacionClient.enviarSmsPedidoListo(
        pedidoActualizado.cliente.telefono,
        pedidoActualizado.area_venta.area_venta,
      );
    }
    this.pedidoGateway.notificarPedidoListo(pedidoActualizado);

    return pedidoActualizado;
  }

  async entregarPedido(pedidoId: number, dto: EntregarPedidoDto) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: {
        pagos: {
          include: {
            pago_metodo: true,
            pago_estado: true,
          },
        },
        cliente: true,
        pedido_productos: { include: { producto: true } },
        area_venta: true,
      },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (pedido.pedido_estado_id !== 3) {
      throw new BadRequestException('El pedido no está listo para entregar');
    }

    // Verificar si el pago es con TARJETA
    if (pedido.pagos.some((p) => p.pago_metodo_id === 1)) {
      // Pago con tarjeta: ya está completado (estado 2), solo entregar
      const pedidoActualizado = await this.prisma.pedido.update({
        where: { id: pedidoId },
        data: {
          pedido_estado_id: 4, // entregado
          fecha_entrega: new Date(),
        },
        include: {
          cliente: true,
          pedido_productos: { include: { producto: true } },
          area_venta: true,
          pagos: {
            include: {
              pago_metodo: true,
              pago_estado: true,
            },
          },
        },
      });

      this.pedidoGateway.notificarCambioPedido(pedidoActualizado);
      this.pedidoGateway.notificarPedidoEntregado(pedidoActualizado);

      return {
        mensaje: 'Pedido entregado exitosamente',
        pedido: pedidoActualizado,
      };
    }

    //Verificar si el pago es con EFECTIVO
    if (pedido.pagos.some((p) => p.pago_metodo_id === 2)) {
      // Buscar el pago pendiente con efectivo
      const pagoPendiente = pedido.pagos.find(
        (p) => p.pago_metodo_id === 2 && p.pago_estado_id === 2,
      );

      if (!pagoPendiente) {
        throw new BadRequestException('No hay un pago registrado');
      }

      // Actualizar el pago pendiente a completado
      await this.prisma.pago.update({
        where: { id: pagoPendiente.id },
        data: {
          pago_estado_id: 1, // 1 = completado
          fecha: new Date(), // Actualizar fecha de pago
        },
      });

      // Entregar el pedido
      const pedidoActualizado = await this.prisma.pedido.update({
        where: { id: pedidoId },
        data: {
          pedido_estado_id: 4, // entregado
          fecha_entrega: new Date(),
        },
        include: {
          cliente: true,
          pedido_productos: { include: { producto: true } },
          area_venta: true,
          pagos: {
            include: {
              pago_metodo: true,
              pago_estado: true,
            },
          },
        },
      });

      this.pedidoGateway.notificarCambioPedido(pedidoActualizado);
      this.pedidoGateway.notificarPedidoEntregado(pedidoActualizado);

      return {
        mensaje: 'Pedido entregado exitosamente',
        pedido: pedidoActualizado,
      };
    }

    // Si no tiene ningún método de pago válido
    throw new BadRequestException('No se encontró un método de pago válido');
  }

  // =============== MÉTODOS COMUNES ===============

  async calificarPedido(pedidoId: number, clienteId: number, dto: CalificarProductoDto) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
    });

    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.cliente_id !== clienteId)
      throw new UnauthorizedException('No puedes calificar este pedido');
    if (pedido.pedido_estado_id !== 4)
      throw new BadRequestException('Solo se pueden calificar pedidos entregados');

    // Verificar que el producto esté en el pedido
    const productoPedido = await this.prisma.pedido_producto.findFirst({
      where: {
        pedido_id: pedidoId,
        producto_id: dto.producto_id,
      },
    });

    if (!productoPedido) throw new BadRequestException('El producto no pertenece a este pedido');

    // Crear calificación
    // NOTA: Ajusta según tu schema. Si resena es Int, quita el Prisma.Decimal
    const calificacion = await this.prisma.producto_calificacion.create({
      data: {
        pedido_id: pedidoId,
        producto_id: dto.producto_id,
        resena: new Prisma.Decimal(dto.calificacion), // Si es Int en tu schema, usar: resena: dto.calificacion
        comentario: dto.comentario || null,
      },
    });

    return calificacion;
  }

  async obtenerHistorial(clienteId: number) {
    return this.prisma.pedido.findMany({
      where: { cliente_id: clienteId },
      include: {
        pedido_productos: { include: { producto: true } },
        pedido_estado: true,
        pagos: true,
      },
      orderBy: { fecha_registro: 'desc' },
    });
  }

  //Funciones necesarias para generar reportes de los pedidos
  async obtenerCatalogosPagoYEstado() {
    const [metodosPago, estadosPedido, areasVenta] = await Promise.all([
      this.prisma.pago_metodo.findMany({
        select: { id: true, pago_metodo: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.pedido_estado.findMany({
        select: { id: true, estado: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.area_venta.findMany({
        where: { status: true },
        select: { id: true, area_venta: true },
        orderBy: { area_venta: 'asc' },
      }),
    ]);

    return {
      metodosPago,
      estadosPedido,
      areasVenta,
    };
  }

  // Generar reporte de pedidos
  async generarReportePedidos(
    filtros: FiltrosReporteDto,
    opciones: OpcionesReporteDto,
    vendedorId?: number,
  ) {
    const where: any = {};

    // Filtro por rango de fechas
    if (filtros.fecha_inicio || filtros.fecha_fin) {
      where.fecha_registro = {};
      if (filtros.fecha_inicio) {
        where.fecha_registro.gte = new Date(filtros.fecha_inicio);
      }
      if (filtros.fecha_fin) {
        // Agregar 1 día para incluir todo el día final
        const fechaFin = new Date(filtros.fecha_fin);
        fechaFin.setDate(fechaFin.getDate() + 1);
        where.fecha_registro.lt = fechaFin;
      }
    }

    // Filtro por método de pago
    if (filtros.pago_metodo_id) {
      where.pagos = {
        some: { pago_metodo_id: Number(filtros.pago_metodo_id) },
      };
    }

    // Filtro por estado del pedido
    if (filtros.pedido_estado_id) {
      where.pedido_estado_id = Number(filtros.pedido_estado_id);
    }

    // Filtro por área de venta
    if (filtros.area_venta_id) {
      where.area_venta_id = Number(filtros.area_venta_id);
    }

    // Si es vendedor, filtrar por su área asignada
    if (vendedorId) {
      const vendedorAreas = await this.prisma.vendedor_area.findMany({
        where: {
          vendedor_id: vendedorId,
          estatus: true,
        },
        select: { area_id: true },
      });

      const areaIds = vendedorAreas.map((va) => va.area_id).filter(Boolean);

      if (areaIds.length > 0) {
        where.area_venta_id = { in: areaIds };
      } else {
        // Si no tiene áreas asignadas, retornar vacío
        return { pedidos: [], totalVentas: 0 };
      }
    }

    const pedidos = await this.prisma.pedido.findMany({
      where,
      include: {
        cliente:
          opciones.incluir_nombre_cliente ||
          opciones.incluir_correo_cliente ||
          opciones.incluir_telefono_cliente
            ? { include: { usuario: true } }
            : false,
        pedido_estado: true,
        area_venta: true,
        pagos: {
          include: {
            pago_metodo: true,
            pago_estado: true,
          },
          orderBy: { fecha: 'desc' },
          take: 1, // Solo el pago más reciente
        },
      },
      orderBy: { fecha_registro: 'desc' },
    });

    // Calcular total de ventas
    const totalVentas = pedidos.reduce((sum, p) => {
      return sum + Number(p.total_pedido || 0);
    }, 0);

    return {
      pedidos,
      totalVentas,
    };
  }

  // Generar ticket de un pedido individual
  async generarTicketPedido(pedidoId: number, opciones: OpcionesTicketDto) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: {
        cliente: { include: { usuario: true } },
        pedido_productos: {
          include: {
            producto: true,
          },
        },
        area_venta: true,
        pedido_estado: true,
        pagos: {
          include: {
            pago_metodo: true,
            pago_estado: true,
          },
          orderBy: { fecha: 'desc' },
          take: 1,
        },
        producto_calificaciones: opciones.incluir_calificaciones
          ? {
              include: {
                producto: true,
              },
            }
          : false,
      },
    });

    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    return pedido;
  }
}
