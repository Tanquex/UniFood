import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Request,
  UseGuards,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PedidosService } from './../services/pedido.service';
import { PagosClient } from 'src/clients/pagos.client';
import {
  CrearPedidoDto,
  RechazarPedidoDto,
  EntregarPedidoDto,
  CalificarProductoDto,
  ProcesarPagoTarjetaDto,
  AgregarCarritoDto,
  DecisionAlergiaDto,
  //OpcionesTicketDto,
  FiltrosReporteDto,
  OpcionesReporteDto,
} from './../models/pedido.model';
import type { OpcionesTicketDto } from './../models/pedido.model';
import { ComunicacionClient } from '../clients/comunicacion.client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/services/prisma.service';

@Controller('pedidos')
export class PedidosController {
  constructor(
    private readonly pedidosService: PedidosService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly comunicationClient: ComunicacionClient,
    private readonly pagosClient: PagosClient,
  ) {}

  // Método auxiliar para verificar autenticación
  private verificarAuth(authorization: string) {
    if (!authorization) {
      throw new UnauthorizedException('Token no proporcionado');
    }
    try {
      const token = authorization.replace('Bearer ', '');
      return this.jwtService.verify(token);
    } catch (error) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  // Método auxiliar para obtener área del vendedor
  private async obtenerAreaVendedor(usuarioId: number): Promise<number> {
    const vendedor = await this.prisma.vendedor.findFirst({
      where: { usuario_id: usuarioId },
      include: {
        vendedor_areas: true, // Incluir la relación con vendedor_area
      },
    });

    if (!vendedor) {
      throw new UnauthorizedException('Vendedor no encontrado');
    }

    // Buscar el área activa del vendedor
    const areaActiva = vendedor.vendedor_areas.find((va) => va.estatus === true);

    if (!areaActiva) {
      throw new UnauthorizedException('El vendedor no tiene un área de venta activa asignada');
    }

    if (!areaActiva.area_id) {
      throw new UnauthorizedException('El área de venta activa no es válida');
    }

    return areaActiva.area_id;
  }

  // =============== ENDPOINTS PARA CLIENTE ===============

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crear(@Body() dto: CrearPedidoDto, @Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'cliente') {
      throw new UnauthorizedException('Solo los clientes pueden crear pedidos');
    }

    if (!usuario.id_rol) {
      throw new UnauthorizedException('Cliente no encontrado para este usuario');
    }

    return this.pedidosService.crear(dto, usuario.id_rol);
  }

  @Post('decision-alergia/:sessionId')
  @HttpCode(HttpStatus.OK)
  async manejarDecisionAlergia(
    @Param('sessionId') sessionId: string,
    @Body() decisionDto: DecisionAlergiaDto,
    @Request() req
  ) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'cliente') {
      throw new UnauthorizedException('Solo los clientes pueden tomar decisiones sobre alergias');
    }

    if (!usuario.id_rol) {
      throw new UnauthorizedException('Cliente no encontrado para este usuario');
    }

    return this.pedidosService.manejarDecisionAlergia(sessionId, decisionDto, usuario.id_rol);
  }

  @Get('mis-pedidos-activos')
  async obtenerMisPedidosActivos(@Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'cliente') {
      throw new UnauthorizedException('Solo los clientes pueden ver sus pedidos');
    }

    if (!usuario.id_rol) {
      throw new UnauthorizedException('Cliente no encontrado para este usuario');
    }
    return this.pedidosService.obtenerMisPedidosActivos(usuario.id_rol);
  }

  @Get('verificar-pagos')
  async verificarMicroservicioPagos() {
    try {
      const disponible = await this.pagosClient.verificarDisponibilidad();
      return { disponible };
    } catch (error) {
      return { disponible: false };
    }
  }

  @Patch(':id/cancelar')
  async cancelarPorCliente(@Param('id') id: string, @Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'cliente') {
      throw new UnauthorizedException('Solo los clientes pueden cancelar pedidos');
    }

    if (!usuario.id_rol) {
      throw new UnauthorizedException('Cliente no encontrado para este usuario');
    }

    return this.pedidosService.cancelarPorCliente(+id, usuario.id_rol);
  }

  @Post(':id/calificar')
  async calificarPedido(
    @Param('id') id: string,
    @Body() dto: CalificarProductoDto,
    @Request() req,
  ) {
    const usuario = this.verificarAuth(req.headers.authorization);
    if (usuario.rol !== 'cliente') {
      throw new UnauthorizedException('Solo los clientes pueden calificar');
    }

    if (!usuario.id_rol) {
      throw new UnauthorizedException('Cliente no encontrado para este usuario');
    }

    return this.pedidosService.calificarPedido(+id, usuario.id_rol, dto);
  }

  @Get('historial')
  async obtenerHistorial(@Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'cliente') {
      throw new UnauthorizedException('Solo los clientes pueden ver su historial');
    }

    if (!usuario.id_rol) {
      throw new UnauthorizedException('Cliente no encontrado para este usuario');
    }

    return this.pedidosService.obtenerHistorial(usuario.id_rol);
  }

  // =============== ENDPOINTS PARA VENDEDOR ===============

  @Get('pendientes')
  async obtenerPendientes(@Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'vendedor') {
      throw new UnauthorizedException('Solo los vendedores pueden ver pedidos pendientes');
    }

    // Obtener el área del vendedor
    const areaVentaId = await this.obtenerAreaVendedor(usuario.id);

    return this.pedidosService.obtenerPendientes(areaVentaId);
  }

  @Get('en-proceso')
  async obtenerEnProceso(@Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'vendedor') {
      throw new UnauthorizedException('Solo los vendedores pueden ver pedidos en proceso');
    }

    // Obtener el área del vendedor
    const areaVentaId = await this.obtenerAreaVendedor(usuario.id);

    return this.pedidosService.obtenerEnProceso(areaVentaId);
  }

  @Get('listos')
  async obtenerListos(@Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'vendedor') {
      throw new UnauthorizedException('Solo los vendedores pueden ver pedidos listos');
    }

    // Obtener el área del vendedor
    const areaVentaId = await this.obtenerAreaVendedor(usuario.id);

    return this.pedidosService.obtenerListos(areaVentaId);
  }

  @Patch(':id/aceptar')
  async aceptarPedido(@Param('id') id: string, @Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'vendedor') {
      throw new UnauthorizedException('Solo los vendedores pueden aceptar pedidos');
    }

    // Obtener el área del vendedor para validaciones
    const areaVentaId = await this.obtenerAreaVendedor(usuario.id);

    return this.pedidosService.aceptarPedido(+id, areaVentaId);
  }

  @Patch(':id/rechazar')
  async rechazarPedido(@Param('id') id: string, @Body() dto: RechazarPedidoDto, @Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'vendedor') {
      throw new UnauthorizedException('Solo los vendedores pueden rechazar pedidos');
    }

    return this.pedidosService.rechazarPedido(+id, dto);
  }

  @Patch(':id/listo')
  async marcarComoListo(@Param('id') id: string, @Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'vendedor') {
      throw new UnauthorizedException('Solo los vendedores pueden marcar pedidos como listos');
    }

    return this.pedidosService.marcarComoListo(+id);
  }

  @Patch(':id/entregar')
  async entregarPedido(@Param('id') id: string, @Body() dto: EntregarPedidoDto, @Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'vendedor') {
      throw new UnauthorizedException('Solo los vendedores pueden entregar pedidos');
    }

    return this.pedidosService.entregarPedido(+id, dto);
  }

  @Get('mi-area')
  async obtenerMiArea(@Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'vendedor') {
      throw new UnauthorizedException('Solo los vendedores pueden consultar su área');
    }

    const areaVentaId = await this.obtenerAreaVendedor(usuario.id);

    return {
      area_venta_id: areaVentaId,
      mensaje: 'Área obtenida correctamente',
    };
  }

  // =============== ENDPOINT PARA CARRITO ===============

  @Post('carrito/agregar')
  @HttpCode(HttpStatus.OK)
  async agregarAlCarrito(@Body() dto: AgregarCarritoDto, @Request() req) {
    const usuario = this.verificarAuth(req.headers.authorization);

    if (usuario.rol !== 'cliente') {
      throw new UnauthorizedException('Solo los clientes pueden agregar productos al carrito');
    }

    // Buscar el producto para validar y obtener datos
    const producto = await this.prisma.producto.findUnique({
      where: { id: dto.producto_id },
      include: {
        area_venta: true,
        categoria: true,
      },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    if (!producto.estado) {
      throw new BadRequestException('El producto no está disponible');
    }

    // Retornar producto completo para que el frontend lo agregue al carrito
    return {
      mensaje: 'Producto listo para agregar al carrito',
      producto: {
        id: producto.id,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        precio: Number(producto.precio),
        imagen_url: producto.imagen_url,
        categoria_id: producto.categoria_id,
        area_venta_id: producto.area_venta_id,
        tiempo_preparacion: producto.tiempo_preparacion,
        ingredientes: producto.ingredientes,
        calorias: Number(producto.calorias),
      },
      cantidad: dto.cantidad,
      detalles: dto.detalles || null,
    };
  }

  // Obtener catálogos para filtros
  @Get('catalogos-reportes')
  async obtenerCatalogosPagoYEstado() {
    return this.pedidosService.obtenerCatalogosPagoYEstado();
  }

  // Generar reporte de pedidos
  @Post('reporte')
  async generarReportePedidos(
    @Body() body: { filtros: FiltrosReporteDto; opciones: OpcionesReporteDto },
    @Request() req,
  ) {
    const usuario = this.verificarAuth(req.headers.authorization);

    // Si es vendedor, filtrar por su área
    const vendedorId = usuario.rol === 'vendedor' ? usuario.id_rol : undefined;

    return this.pedidosService.generarReportePedidos(body.filtros, body.opciones, vendedorId);
  }

  // Generar ticket individual
  @Post('ticket/:id')
  async generarTicketPedido(
    @Param('id') id: string,
    @Body() opciones: OpcionesTicketDto,
    @Request() req,
  ) {
    this.verificarAuth(req.headers.authorization);
    return this.pedidosService.generarTicketPedido(Number(id), opciones);
  }

  // Obtener pedido para el seguimiento publico
  @Get('publico/:id')
  async obtenerPedidoPublico(@Param('id') id: string) {
    return this.pedidosService.obtenerPedidoPorIdPublico(+id);
  }
}
