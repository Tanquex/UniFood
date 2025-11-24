import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../enviroments/enviroment';
import { Pedido } from '../../models/pedido.model';
import { PedidoService } from '../../services/pedido.service';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-seguimiento-pedido',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './seguimiento-pedido.component.html',
  styleUrls: ['./seguimiento-pedido.component.scss'],
})
export class SeguimientoPedidoComponent implements OnInit, OnDestroy {
  pedido: Pedido | null = null;
  pedidoId: number | null = null;
  cargando = true;
  error = false;
  mensajeError = '';
  metodoPagoId: number | null = null;

  private socket: Socket | null = null;

  @ViewChild('audioPendiente') audioPendiente!: ElementRef<HTMLAudioElement>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private pedidoService: PedidoService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    // Obtener el ID del pedido desde la URL
    const id = this.route.snapshot.paramMap.get('id');

    if (!id || isNaN(Number(id))) {
      this.mostrarError('ID de pedido inválido');
      return;
    }

    this.pedidoId = Number(id);
    this.cargarPedido();
  }

  ngOnDestroy(): void {
    this.desconectarWebSocket();
  }

  /**
   * Cargar información inicial del pedido (sin JWT)
   */
  cargarPedido(): void {
    this.pedidoService.obtenerPedidoPorIdPublico(this.pedidoId!).subscribe({
      next: (pedido) => {
        this.pedido = {
          ...pedido,
          total_pedido: Number(pedido.total_pedido),
          pedido_productos: pedido.pedido_productos || [],
          pagos: pedido.pagos || [],
          //pago_metodo_id: pedido.pagos.map(p => p.pago_metodo_id)[0],
        };

        /*if(this.pedido.pagos.map(p => p.pago_metodo_id)[0] === 1){
          this.metodoPagoId = 1;
      }else{
          this.metodoPagoId = 2;
      }*/
        this.cargando = false;
        this.conectarWebSocket();
      },
      error: (err) => {
        this.cargando = false;
        this.mostrarError(err.error?.message || 'No se pudo cargar el pedido');
      },
    });
  }

  /**
   * Conectar WebSocket SIN JWT, usando solo el orderId
   */
  conectarWebSocket(): void {
    if (!this.pedidoId) return;

    // Conexión pública sin autenticación
    this.socket = io(environment.wsUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      autoConnect: true,
      query: { public: 'true' },
    });

    this.socket.on('connect', () => {
      //console.log('✅ WebSocket conectado (público)');
      // Unirse a la sala del pedido específico
      this.socket?.emit('suscribirPedidoPublico', this.pedidoId);
    });

    this.socket.on('disconnect', (reason) => {
      //console.log('❌ WebSocket desconectado', reason);
    });

    this.socket.on('connect_error', (err) => {
      console.error('Error de conexión WebSocket:', err);
    });

    // OBSERVER PATTERN: Escuchar eventos del pedido
    this.escucharActualizaciones();
  }

  /**
   * OBSERVER PATTERN: Suscribirse a eventos del pedido
   */
  escucharActualizaciones(): void {
    if (!this.socket) return;

    // Actualización general del pedido
    this.socket.on('actualizarPedido', (pedidoActualizado: Pedido) => {
      this.ngZone.run(() => {
        if (pedidoActualizado.id === this.pedidoId) {
          //console.log('📦 Pedido actualizado:', pedidoActualizado);
          this.pedido = pedidoActualizado;
        }
      });
    });

    // Pedido listo para recoger
    this.socket.on('pedidoListo', (pedidoListo: Pedido) => {
      this.ngZone.run(() => {
        if (pedidoListo.id === this.pedidoId) {
          //console.log('✅ ¡Pedido listo!');
          this.pedido = pedidoListo;
          this.notificarPedidoListo();
        }
      });
    });

    // Pedido cancelado
    this.socket.on('pedidoCancelado', (pedidoCancelado: Pedido) => {
      this.ngZone.run(() => {
        if (pedidoCancelado.id === this.pedidoId) {
          //console.log('❌ Pedido cancelado');
          this.pedido = pedidoCancelado;
          this.notificarPedidoCancelado();
        }
      });
    });

    // Pedido entregado
    this.socket.on('pedidoEntregado', (pedidoEntregado: Pedido) => {
      this.ngZone.run(() => {
        if (pedidoEntregado.id === this.pedidoId) {
          //console.log('🎉 Pedido entregado');
          this.pedido = pedidoEntregado;
          this.notificarPedidoEntregado();
        }
      });
    });
  }

  /**
   * Notificación cuando el pedido está listo
   */
  notificarPedidoListo(): void {
    this.reproducirSonido();

    const areaNombre =
      this.pedido?.area_venta?.area_venta || 'tu área correspondiente';

    Swal.fire({
      icon: 'success',
      title: '🎉 ¡Tu pedido está listo!',
      html: `
        <p style="font-size: 1.3rem; color: #5B9A97; font-weight: bold;">
          📍 Recógelo en: ${areaNombre}
        </p>
      `,
      confirmButtonText: 'Entendido',
      confirmButtonColor: '#5B9A97',
    });
  }

  /**
   * Notificación cuando el pedido es cancelado
   */
  notificarPedidoCancelado(): void {
    Swal.fire({
      icon: 'error',
      title: 'Pedido cancelado',
      text: 'Tu pedido ha sido cancelado. Contacta al establecimiento para más información.',
      confirmButtonColor: '#E76F51',
    });
  }

  /**
   * Notificación cuando el pedido es entregado
   */
  notificarPedidoEntregado(): void {
    Swal.fire({
      icon: 'success',
      title: '✅ Pedido entregado',
      text: '¡Gracias por tu compra! Disfruta tu pedido.',
      confirmButtonColor: '#5B9A97',
    });
  }

  /**
   * Desconectar WebSocket al destruir componente
   */
  desconectarWebSocket(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Mostrar error y redirigir
   */
  mostrarError(mensaje: string): void {
    this.error = true;
    this.mensajeError = mensaje;
    setTimeout(() => {
      this.router.navigate(['/']);
    }, 3000);
  }

  /**
   * Reproducir sonido de notificación
   */
  reproducirSonido(): void {
    try {
      if (this.audioPendiente?.nativeElement) {
        const audio = this.audioPendiente.nativeElement;
        audio.currentTime = 0;
        audio.play().catch(() => {
          this.reproducirSonidoAlternativo();
        });
      }
    } catch (error) {
      this.reproducirSonidoAlternativo();
    }
  }

  /**
   * Sonido alternativo con Web Audio API
   */
  reproducirSonidoAlternativo(): void {
    try {
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.5
      );

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.error('No se pudo reproducir sonido alternativo:', e);
    }
  }

  /**
   * Obtener clase CSS según el estado
   */
  obtenerClaseEstado(): string {
    return `estado-${this.pedido?.pedido_estado_id || 1}`;
  }
}
