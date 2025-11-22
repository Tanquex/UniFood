import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  CrearRecomendacionDto,
  ActualizarRecomendacionDto,
  RegistrarInteraccionDto,
  FiltrosRecomendacionDto,
  TipoRecomendacion,
  TipoInteraccion,
  RecomendacionConProducto,
  MetricaProducto,
  ResumenRecomendaciones,
  EstadisticasInteraccion,
} from '../models/recomendacion.model';

@Injectable()
export class RecomendacionService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // CRUD BÁSICO
  // ============================================

  /**
   * Crear una nueva recomendación
   */
  async crearRecomendacion(dto: CrearRecomendacionDto, supervisorId?: number): Promise<any> {
    // Verificar que el producto existe
    const producto = await this.prisma.producto.findUnique({
      where: { id: dto.producto_id },
    });

    if (!producto) {
      throw new NotFoundException(`Producto con ID ${dto.producto_id} no encontrado`);
    }

    // Validar fechas
    if (dto.fecha_inicio && dto.fecha_fin) {
      const inicio = new Date(dto.fecha_inicio);
      const fin = new Date(dto.fecha_fin);

      if (fin <= inicio) {
        throw new BadRequestException('La fecha de fin debe ser posterior a la fecha de inicio');
      }
    }

    // Crear recomendación
    return this.prisma.recomendacion.create({
      data: {
        producto_id: dto.producto_id,
        tipo_recomendacion: dto.tipo_recomendacion,
        prioridad: dto.prioridad || 0,
        fecha_inicio: dto.fecha_inicio ? new Date(dto.fecha_inicio) : null,
        fecha_fin: dto.fecha_fin ? new Date(dto.fecha_fin) : null,
        supervisor_id: supervisorId,
        metadata: dto.metadata || {},
      },
      include: {
        // No incluimos relaciones porque no las definimos en el modelo
      },
    });
  }

  /**
   * Obtener recomendaciones con filtros
   */
  async obtenerRecomendaciones(filtros?: FiltrosRecomendacionDto): Promise<any[]> {
    const where: any = {};

    if (filtros?.tipo) {
      where.tipo_recomendacion = filtros.tipo;
    }

    if (filtros?.activo !== undefined) {
      where.activo = filtros.activo;
    }

    // Filtrar solo recomendaciones vigentes
    const ahora = new Date();
    where.OR = [
      { fecha_inicio: null, fecha_fin: null },
      { fecha_inicio: { lte: ahora }, fecha_fin: { gte: ahora } },
      { fecha_inicio: { lte: ahora }, fecha_fin: null },
      { fecha_inicio: null, fecha_fin: { gte: ahora } },
    ];

    const recomendaciones = await this.prisma.recomendacion.findMany({
      where,
      orderBy: [{ prioridad: 'desc' }, { created_at: 'desc' }],
      take: filtros?.limit || 10,
    });

    // Enriquecer con información del producto y métricas
    if (filtros?.incluir_producto || filtros?.incluir_metricas) {
      return Promise.all(
        recomendaciones.map(async (rec) => {
          const resultado: any = { ...rec };

          if (filtros.incluir_producto) {
            resultado.producto = await this.prisma.producto.findUnique({
              where: { id: rec.producto_id },
              include: {
                categoria: true,
              },
            });
          }

          if (filtros.incluir_metricas) {
            resultado.metricas = await this.prisma.metrica_producto.findUnique({
              where: { producto_id: rec.producto_id },
            });
          }

          return resultado;
        }),
      );
    }

    return recomendaciones;
  }

  /**
   * Obtener recomendación por ID
   */
  async obtenerRecomendacionPorId(id: number): Promise<any> {
    const recomendacion = await this.prisma.recomendacion.findUnique({
      where: { id },
    });

    if (!recomendacion) {
      throw new NotFoundException(`Recomendación con ID ${id} no encontrada`);
    }

    // Enriquecer con producto y métricas
    const producto = await this.prisma.producto.findUnique({
      where: { id: recomendacion.producto_id },
      include: { categoria: true },
    });

    const metricas = await this.prisma.metrica_producto.findUnique({
      where: { producto_id: recomendacion.producto_id },
    });

    return {
      ...recomendacion,
      producto,
      metricas,
    };
  }

  /**
   * Actualizar recomendación
   */
  async actualizarRecomendacion(id: number, dto: ActualizarRecomendacionDto): Promise<any> {
    // Verificar que existe
    const existe = await this.prisma.recomendacion.findUnique({
      where: { id },
    });

    if (!existe) {
      throw new NotFoundException(`Recomendación con ID ${id} no encontrada`);
    }

    // Validar fechas si se proporcionan
    if (dto.fecha_inicio && dto.fecha_fin) {
      const inicio = new Date(dto.fecha_inicio);
      const fin = new Date(dto.fecha_fin);

      if (fin <= inicio) {
        throw new BadRequestException('La fecha de fin debe ser posterior a la fecha de inicio');
      }
    }

    return this.prisma.recomendacion.update({
      where: { id },
      data: {
        ...(dto.tipo_recomendacion && {
          tipo_recomendacion: dto.tipo_recomendacion,
        }),
        ...(dto.prioridad !== undefined && { prioridad: dto.prioridad }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
        ...(dto.fecha_inicio && { fecha_inicio: new Date(dto.fecha_inicio) }),
        ...(dto.fecha_fin && { fecha_fin: new Date(dto.fecha_fin) }),
        ...(dto.metadata && { metadata: dto.metadata }),
      },
    });
  }

  /**
   * Eliminar recomendación
   */
  async eliminarRecomendacion(id: number): Promise<{ mensaje: string }> {
    const existe = await this.prisma.recomendacion.findUnique({
      where: { id },
    });

    if (!existe) {
      throw new NotFoundException(`Recomendación con ID ${id} no encontrada`);
    }

    await this.prisma.recomendacion.delete({ where: { id } });

    return { mensaje: 'Recomendación eliminada exitosamente' };
  }

  // ============================================
  // CÁLCULOS AUTOMÁTICOS
  // ============================================

  /**
   * Actualizar métricas de un producto
   */
  async actualizarMetricasProducto(productoId: number): Promise<MetricaProducto> {
    // Obtener total de ventas
    const ventasResult = await this.prisma.$queryRaw<any[]>`
      SELECT COUNT(DISTINCT pp.pedido_id) as total_ventas
      FROM pedido_producto pp
      WHERE pp.producto_id = ${productoId}
    `;

    // Convertir BigInt a Number
    const totalVentas = Number(ventasResult[0]?.total_ventas || 0);

    // Obtener calificaciones
    const calificacionesResult = await this.prisma.$queryRaw<any[]>`
      SELECT 
        AVG(pc.resena) as calificacion_promedio,
        COUNT(pc.id) as total_calificaciones
      FROM producto_calificacion pc
      WHERE pc.producto_id = ${productoId}
    `;

    const calificacionPromedio = parseFloat(calificacionesResult[0]?.calificacion_promedio) || 0;
    // Convertir BigInt a Number
    const totalCalificaciones = Number(calificacionesResult[0]?.total_calificaciones || 0);

    // Actualizar o crear métrica
    const resultado = await this.prisma.metrica_producto.upsert({
      where: { producto_id: productoId },
      update: {
        total_ventas: totalVentas,
        calificacion_promedio: calificacionPromedio,
        total_calificaciones: totalCalificaciones,
        ultima_actualizacion: new Date(),
      },
      create: {
        producto_id: productoId,
        total_ventas: totalVentas,
        calificacion_promedio: calificacionPromedio,
        total_calificaciones: totalCalificaciones,
      },
    });

    // Convertir Decimal a number para cumplir con la interfaz
    return {
      ...resultado,
      calificacion_promedio: resultado.calificacion_promedio
        ? parseFloat(resultado.calificacion_promedio.toString())
        : 0,
    } as MetricaProducto;
  }

  /**
   * Generar recomendaciones automáticas (más vendidos)
   */
  async generarRecomendacionesMasVendidos(limite: number = 5): Promise<any[]> {
    // Actualizar métricas de todos los productos activos
    const productos = await this.prisma.producto.findMany({
      where: { estado: true },
      select: { id: true },
    });

    await Promise.all(productos.map((p) => this.actualizarMetricasProducto(p.id)));

    // Obtener productos más vendidos
    const masVendidos = await this.prisma.metrica_producto.findMany({
      where: { total_ventas: { gt: 0 } },
      orderBy: { total_ventas: 'desc' },
      take: limite,
    });

    // Crear o actualizar recomendaciones
    const recomendaciones = await Promise.all(
      masVendidos.map(async (metrica, index) => {
        // Verificar si ya existe una recomendación de este tipo para este producto
        const existente = await this.prisma.recomendacion.findFirst({
          where: {
            producto_id: metrica.producto_id,
            tipo_recomendacion: TipoRecomendacion.MAS_VENDIDO,
          },
        });

        if (existente) {
          // Actualizar prioridad
          return this.prisma.recomendacion.update({
            where: { id: existente.id },
            data: {
              prioridad: limite - index,
              activo: true,
            },
          });
        } else {
          // Crear nueva
          return this.prisma.recomendacion.create({
            data: {
              producto_id: metrica.producto_id,
              tipo_recomendacion: TipoRecomendacion.MAS_VENDIDO,
              prioridad: limite - index,
              activo: true,
              metadata: { total_ventas: metrica.total_ventas },
            },
          });
        }
      }),
    );

    return recomendaciones;
  }

  /**
   * Generar recomendaciones automáticas (mejor calificados)
   */
  async generarRecomendacionesMejorCalificados(limite: number = 5): Promise<any[]> {
    // Actualizar métricas
    const productos = await this.prisma.producto.findMany({
      where: { estado: true },
      select: { id: true },
    });

    await Promise.all(productos.map((p) => this.actualizarMetricasProducto(p.id)));

    // Obtener mejor calificados (mínimo 3 calificaciones)
    const mejorCalificados = await this.prisma.metrica_producto.findMany({
      where: {
        total_calificaciones: { gte: 3 },
        calificacion_promedio: { gt: 0 },
      },
      orderBy: { calificacion_promedio: 'desc' },
      take: limite,
    });

    const recomendaciones = await Promise.all(
      mejorCalificados.map(async (metrica, index) => {
        const existente = await this.prisma.recomendacion.findFirst({
          where: {
            producto_id: metrica.producto_id,
            tipo_recomendacion: TipoRecomendacion.MEJOR_CALIFICADO,
          },
        });

        if (existente) {
          return this.prisma.recomendacion.update({
            where: { id: existente.id },
            data: {
              prioridad: limite - index,
              activo: true,
            },
          });
        } else {
          return this.prisma.recomendacion.create({
            data: {
              producto_id: metrica.producto_id,
              tipo_recomendacion: TipoRecomendacion.MEJOR_CALIFICADO,
              prioridad: limite - index,
              activo: true,
              metadata: { calificacion_promedio: metrica.calificacion_promedio },
            },
          });
        }
      }),
    );

    return recomendaciones;
  }

  // ============================================
  // INTERACCIONES Y ANALYTICS
  // ============================================

  /**
   * Registrar interacción del cliente con recomendación
   */
  async registrarInteraccion(dto: RegistrarInteraccionDto): Promise<any> {
    const recomendacion = await this.prisma.recomendacion.findUnique({
      where: { id: dto.recomendacion_id },
    });

    if (!recomendacion) {
      throw new NotFoundException(`Recomendación con ID ${dto.recomendacion_id} no encontrada`);
    }

    return this.prisma.recomendacion_interaccion.create({
      data: {
        recomendacion_id: dto.recomendacion_id,
        cliente_id: dto.cliente_id,
        tipo_interaccion: dto.tipo_interaccion,
        metadata: dto.metadata || {},
      },
    });
  }

  /**
   * Obtener estadísticas de una recomendación
   */
  async obtenerEstadisticasRecomendacion(
    recomendacionId: number,
  ): Promise<EstadisticasInteraccion> {
    const interacciones = await this.prisma.recomendacion_interaccion.findMany({
      where: { recomendacion_id: recomendacionId },
    });

    const total_vistas = interacciones.filter(
      (i) => i.tipo_interaccion === TipoInteraccion.VISTA,
    ).length;
    const total_clicks = interacciones.filter(
      (i) => i.tipo_interaccion === TipoInteraccion.CLICK,
    ).length;
    const total_agregados_carrito = interacciones.filter(
      (i) => i.tipo_interaccion === TipoInteraccion.AGREGADO_CARRITO,
    ).length;
    const total_comprados = interacciones.filter(
      (i) => i.tipo_interaccion === TipoInteraccion.COMPRADO,
    ).length;

    const tasa_conversion = total_vistas > 0 ? (total_comprados / total_vistas) * 100 : 0;

    return {
      recomendacion_id: recomendacionId,
      total_vistas,
      total_clicks,
      total_agregados_carrito,
      total_comprados,
      tasa_conversion: parseFloat(tasa_conversion.toFixed(2)),
    };
  }

  /**
   * Obtener resumen de todas las recomendaciones
   */
  async obtenerResumenRecomendaciones(): Promise<ResumenRecomendaciones> {
    const todas = await this.prisma.recomendacion.findMany();

    const activas = todas.filter((r) => r.activo).length;
    const inactivas = todas.length - activas;

    // Agrupar por tipo
    const porTipoMap = new Map<TipoRecomendacion, number>();
    todas.forEach((r) => {
      const tipo = r.tipo_recomendacion as TipoRecomendacion;
      porTipoMap.set(tipo, (porTipoMap.get(tipo) || 0) + 1);
    });

    const por_tipo = Array.from(porTipoMap.entries()).map(([tipo, cantidad]) => ({
      tipo,
      cantidad,
    }));

    return {
      total_recomendaciones: todas.length,
      activas,
      inactivas,
      por_tipo,
    };
  }
}
