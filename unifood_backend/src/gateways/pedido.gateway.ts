import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class PedidoGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  constructor(private jwtService: JwtService) {}

  handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        socket.disconnect(true);
        return;
      }

      const payload = this.jwtService.verify(token);

      // tu payload usa id_rol, no sub
      const usuarioId = payload.id;
      const clienteId = payload.id_rol;
      const rol = payload.rol;

      if (rol === 'cliente' && clienteId) {
        socket.join(`cliente-${clienteId}`);
      }

      if (rol === 'vendedor' && clienteId) {
        // si un vendedor también tiene id_rol = id del área o del vendedor
        socket.join(`vendedor-area-${clienteId}`);
      }
    } catch (error) {
      socket.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    //console.log(`Cliente desconectado: ${client.id}`);
    return;
  }

  // Cliente se suscribe a su pedido específico
  @SubscribeMessage('suscribirPedido')
  handleSuscribirPedido(client: Socket, pedidoId: number) {
    client.join(`pedido-${pedidoId}`);
  }

  // Vendedor se suscribe a pedidos de su área (MODIFICADO)
  @SubscribeMessage('suscribirVendedor')
  handleSuscribirVendedor(client: Socket, payload: { areaId: number }) {
    client.join(`vendedor-area-${payload.areaId}`);
  }

  // Notificar nuevo pedido a vendedores del área específica (MODIFICADO)
  notificarNuevoPedido(pedido: any) {
    this.server.to(`vendedor-area-${pedido.area_venta_id}`).emit('nuevoPedido', pedido);
  }

  // Notificar cambio de estado de pedido
  notificarCambioPedido(pedido: any) {
    // Al cliente específico
    this.server.to(`pedido-${pedido.id}`).emit('actualizarPedido', pedido);

    // A todos los vendedores del área
    this.server.to(`vendedor-area-${pedido.area_venta_id}`).emit('actualizarPedido', pedido);
  }

  // Notificar pedido listo
  notificarPedidoListo(pedido: any) {
    // Al cliente
    this.server.to(`pedido-${pedido.id}`).emit('pedidoListo', pedido);

    // A los vendedores del área
    this.server.to(`vendedor-area-${pedido.area_venta_id}`).emit('pedidoListo', pedido);
  }

  // MÉTODO ADICIONAL: Notificar cancelación
  notificarPedidoCancelado(pedido: any) {
    this.server.to(`pedido-${pedido.id}`).emit('pedidoCancelado', pedido);
    this.server.to(`vendedor-area-${pedido.area_venta_id}`).emit('pedidoCancelado', pedido);
  }

  // MÉTODO ADICIONAL: Notificar pago procesado
  notificarPagoProcesado(pedido: any) {
    this.server.to(`pedido-${pedido.id}`).emit('pagoProcesado', pedido);
    this.server.to(`vendedor-area-${pedido.area_venta_id}`).emit('pagoProcesado', pedido);
  }

  // Notificar pedido rechazado
  notificarPedidoRechazado(pedido: any) {
    this.server.to(`pedido-${pedido.id}`).emit('pedidoRechazado', pedido);
    this.server.to(`vendedor-area-${pedido.area_venta_id}`).emit('pedidoRechazado', pedido);
  }

  // Notificar al cliente de la creacion de su pedido
  notificarNuevoPedidoCliente(pedido: any) {
    this.server.to(`cliente-${pedido.cliente_id}`).emit('pedidoCreado', pedido);
    this.server.to(`vendedor-area-${pedido.area_venta_id}`).emit('pedidoCreado', pedido);
  }

  //{ return this.on<Pedido>('pedidoCreado');}

  //Notificar pedido entregado al cliente
  notificarPedidoEntregado(pedido: any): void {
    this.server.to(`pedido-${pedido.id}`).emit('pedidoEntregado', pedido);
    this.server.to(`vendedor-area-${pedido.area_venta_id}`).emit('pedidoEntregado', pedido);
  }

  emitValidacionProgreso(
    clienteId: number,
    data: {
      handler: string;
      status: 'processing' | 'success' | 'error';
      message?: string;
      timestamp: string;
    },
  ) {
    this.server.to(`cliente-${clienteId}`).emit('validacion-progreso', data);
  }
}
