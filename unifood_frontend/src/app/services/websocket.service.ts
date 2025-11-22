import { Injectable, NgZone } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../enviroments/enviroment';
import { AuthService } from './auth.service';
import { Pedido } from '../models/pedido.model';

@Injectable({ providedIn: 'root' })
export class WebsocketService {
  private socket: Socket | null = null;
  private conectado = false;
  private eventBuffer: { name: string; callback: (...args: any[]) => void }[] =
    [];

  constructor(private authService: AuthService, private ngZone: NgZone) {}

  conectar(): void {
    if (this.conectado) {
      return;
    }

    const token = this.authService.obtenerToken();
    if (!token) {
      return;
    }

    this.socket = io(environment.wsUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      this.ngZone.run(() => {
        this.conectado = true;
        this.reRegisterBufferedListeners();
      });
    });

    this.socket.on('disconnect', (reason) => {
      this.conectado = false;
    });

    this.socket.on('connect_error', (err) =>
      console.error('Error al conectar WebSocket:', err)
    );
  }

  desconectar(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.conectado = false;
  }

  estaConectado(): boolean {
    return this.conectado && !!this.socket;
  }

  /**
   * Registra un listener de evento con autogestión
   */
  on<T = any>(evento: string): Observable<T> {
    const subject = new Subject<T>();

    const register = () => {
      if (!this.socket) return;
      const callback = (data: T) => {
        // Angular no detecta cambios fuera de NgZone
        this.ngZone.run(() => subject.next(data));
      };
      this.socket.on(evento, callback);
      this.eventBuffer.push({ name: evento, callback });
    };

    // Si el socket ya existe, registramos de inmediato
    if (this.socket) register();
    // Si no, esperamos a que se conecte
    else {
      const checkInterval = setInterval(() => {
        if (this.socket) {
          clearInterval(checkInterval);
          register();
        }
      }, 300);
    }

    return subject.asObservable();
  }

  /**
   * Reatachar todos los listeners después de reconectar
   */
  private reRegisterBufferedListeners(): void {
    if (!this.socket) return;
    for (const { name, callback } of this.eventBuffer) {
      this.socket.off(name); // evita duplicados
      this.socket.on(name, callback);
    }
  }

  /**
   * Emitir un evento
   */
  emit(evento: string, data?: any): void {
    if (!this.socket) {
      console.warn('No se puede emitir, socket no conectado (f5)');
      return;
    }
    this.socket.emit(evento, data);
  }

  // ========= EVENTOS DE DOMINIO ========= //

  onActualizarPedido() {
    return this.on<Pedido>('actualizarPedido');
  }
  onPedidoListo() {
    return this.on<Pedido>('pedidoListo');
  }
  onPedidoCancelado() {
    return this.on<Pedido>('pedidoCancelado');
  }
  onNuevoPedido() {
    return this.on<Pedido>('nuevoPedido');
  }
  onPedidoAceptado() {
    return this.on<Pedido>('pedidoAceptado');
  }
  onPedidoRechazado() {
    return this.on<Pedido>('pedidoRechazado');
  }
  onPedidoEntregado() {
    return this.on<Pedido>('pedidoEntregado');
  }
  onPedidoCreado() {
    return this.on<Pedido>('pedidoCreado');
  }

  suscribirPedido(pedidoId: number) {
    this.emit('suscribirPedido', pedidoId);
  }

  suscribirArea(areaId: number) {
    this.emit('suscribirArea', areaId);
  }

  /**
   * Suscribir a un vendedor a su área (permite recibir eventos específicos)
   */
  suscribirVendedor(payload: { areaId: number }): void {
    if (!this.socket) {
      return;
    }

    this.socket.emit('suscribirVendedor', payload);
  }

  /**
   * Método para remover un listener específico
   */
  off(evento: string): void {
    if (!this.socket) return;
    this.socket.off(evento);
    // Remover del buffer también
    this.eventBuffer = this.eventBuffer.filter((e) => e.name !== evento);
  }

  /**
   * Método para escuchar eventos de progreso de validación
   */
  onValidacionProgreso() {
    return this.on<{
      handler: string;
      status: 'processing' | 'success' | 'error';
      message?: string;
      timestamp: string;
    }>('validacion-progreso');
  }
}
