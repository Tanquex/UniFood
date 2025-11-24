import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  NgZone,
} from '@angular/core';
import {
  Router,
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { WebsocketService } from '../../../services/websocket.service';
import { PedidoService } from '../../../services/pedido.service';
import { Pedido, ProcesarPagoDto } from '../../../models/pedido.model';
import Swal from 'sweetalert2';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatFloatComponent } from '../../chat-float/chat-float.component';
import { ClientePedidoComponent } from '../../cliente-pedido/cliente-pedido.component';
import { QrService } from '../../../services/qr.service';

@Component({
  selector: 'app-cliente-layout',
  imports: [
    CommonModule,
    RouterOutlet,
    FormsModule,
    ChatFloatComponent,
    ClientePedidoComponent,
  ],
  templateUrl: './cliente-layout.component.html',
  styleUrls: ['./cliente-layout.component.scss'],
})
export class ClienteLayoutComponent implements OnInit, OnDestroy {
  nombreCliente: string = '';
  cantidadCarrito: number = 0;
  pedidosActivos: Pedido[] = [];
  pedidoSeleccionado: Pedido | null = null;
  mostrarListaPedidos = false;
  menuAbierto = false;
  mostrarModalCarrito = false;

  //Estado pago
  estaPagado: boolean = false;

  // Control de modales
  mostrarModalSeguimiento = false;
  mostrarModalPago = false;
  mostrarModalCalificacion = false;

  numeroTarjeta: string = '';
  expiracion: string = '';
  cvv: string = '';
  calificaciones: number[] = [];
  comentarios: string[] = [];

  datosTemporalesPedido: any = null;

  private subscriptions: Subscription[] = [];
  private pollingInterval: any;

  @ViewChild('audioPendiente') audioPendiente!: ElementRef<HTMLAudioElement>;

  constructor(
    private authService: AuthService,
    private wsService: WebsocketService,
    private pedidoService: PedidoService,
    private router: Router,
    private ngZone: NgZone,
    private qrService: QrService
  ) {}

  ngOnInit(): void {
    const usuario = this.authService.obtenerUsuario();
    this.nombreCliente = usuario?.nombre_completo || 'Cliente';

    // Suscribirse al carrito
    this.subscriptions.push(
      this.pedidoService.itemsCarrito$.subscribe(() => {
        this.cantidadCarrito = this.pedidoService.obtenerCantidadTotalCarrito();
      })
    );

    // Conectar WebSocket
    this.wsService.conectar();

    // Verificar si hay pedido activo
    this.verificarPedidosActivos();

    // Escuchar actualizaciones
    this.escucharWebSockets();

    window.addEventListener('abrirModalPago', () => {
      this.ngZone.run(() => {
        this.abrirModalPagoDesdeCarrito();
      });
    });
    // Polling de respaldo cada 15 segundos
    /*this.pollingInterval = setInterval(() => {
      if (this.pedidosActivos) {
        this.verificarPedidosActivos();
      }
    }, 15000);*/
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.wsService.desconectar();

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }

  verificarPedidosActivos(): void {
    this.pedidoService.obtenerMisPedidosActivos().subscribe({
      next: (pedidos) => {
        this.pedidosActivos = pedidos;

        if (pedidos.length > 0) {
          pedidos.forEach((pedido) => {
            this.wsService.suscribirPedido(pedido.id);
          });
        }
      },
      error: (err) => {
        //console.error('Error al obtener pedidos activos:', err);
        this.pedidosActivos = [];
      },
    });
  }

  escucharWebSockets(): void {
    // Actualizar lista pedidos
    this.subscriptions.push(
      this.wsService.onPedidoCreado().subscribe((pedido) => {
        this.ngZone.run(() => {
          //console.log('Nuevo pedido creado:', pedido);

          const index = this.pedidosActivos.findIndex(
            (p) => p.id === pedido.id
          );
          if (index === -1) {
            this.pedidosActivos.push(pedido);
            //console.log('Pedido agregado a la lista:', pedido.codigo);
          } else {
            this.pedidosActivos[index] = pedido;
            //console.log('Pedido actualizado en la lista:', pedido.codigo);
          }

          // Asegurarse de estar suscrito al nuevo pedido
          this.wsService.suscribirPedido(pedido.id);

          // Mostrar notificación visual
          //this.reproducirSonido();
          Swal.fire({
            icon: 'success',
            title: '¡Pedido creado!',
            text: `Tu pedido #${pedido.codigo} ha sido registrado`,
            timer: 2000,
            showConfirmButton: false,
          }).then((result) => {
            this.onPedidoCreado(pedido);
          });
        });
      })
    );

    // Actualizar pedido
    this.subscriptions.push(
      this.wsService.onActualizarPedido().subscribe((pedido) => {
        //console.log('Pedido actualizado (cliente):', pedido);

        const index = this.pedidosActivos.findIndex((p) => p.id === pedido.id);
        if (index !== -1) {
          const calificacionesAnteriores = [...this.calificaciones];
          const comentariosAnteriores = [...this.comentarios];

          this.pedidosActivos[index] = pedido;

          if (this.pedidoSeleccionado?.id === pedido.id) {
            this.pedidoSeleccionado = pedido;
          }

          if (calificacionesAnteriores.length > 0) {
            this.calificaciones = calificacionesAnteriores;
            this.comentarios = comentariosAnteriores;
          }
        }
      })
    );

    // Pedido listo
    this.subscriptions.push(
      this.wsService.onPedidoListo().subscribe((pedido) => {
        // Buscar y actualizar el pedido
        const index = this.pedidosActivos.findIndex((p) => p.id === pedido.id);

        if (index !== -1) {
          this.pedidosActivos[index] = pedido;

          // Actualizar seleccionado si es el mismo
          if (this.pedidoSeleccionado?.id === pedido.id) {
            this.pedidoSeleccionado = pedido;
          }

          this.reproducirSonido();

          const areaNombre =
            pedido.area_venta?.area_venta || 'tu área correspondiente';

          Swal.fire({
            icon: 'success',
            title: '¡Tu pedido está listo!',
            html: `
        <p style="font-size: 1.3rem; color: #5B9A97; font-weight: bold;">
          📍 Area de ${areaNombre}
        </p>
      `,
            confirmButtonText: 'Ir a recoger',
            confirmButtonColor: '#5B9A97',
          }).then((result) => this.abrirSeguimiento());
        }
      })
    );

    // Pedido cancelado
    this.subscriptions.push(
      this.wsService.onPedidoCancelado().subscribe((pedido) => {
        this.pedidosActivos = this.pedidosActivos.filter(
          (p) => p.id !== pedido.id
        );

        if (this.pedidoSeleccionado?.id === pedido.id) {
          this.pedidoSeleccionado = null;
          this.mostrarModalSeguimiento = false;
        }

        Swal.fire({
          icon: 'info',
          title: 'Pedido cancelado',
          text: 'Tu pedido ha sido cancelado',
          confirmButtonColor: '#5B9A97',
        }).then(() => {
          if (this.pedidosActivos.length > 0) {
            this.abrirListaPedidos();
          }
        });
      })
    );

    // Pedido rechazado
    this.subscriptions.push(
      this.wsService.onPedidoRechazado().subscribe((pedido) => {
        this.ngZone.run(() => {
          //fuerza detección de cambios
          //console.log('Pedido rechazado recibido en cliente:', pedido);

          this.pedidosActivos = this.pedidosActivos.filter(
            (p) => p.id !== pedido.id
          );

          if (this.pedidoSeleccionado?.id === pedido.id) {
            this.pedidoSeleccionado = null;
            this.mostrarModalSeguimiento = false;
          }

          this.reproducirSonido();
          let motivo =
            pedido.detalles_pedido?.replace('RECHAZADO: ', '') ||
            'Sin motivo especificado';

          Swal.fire({
            icon: 'error',
            title: 'Pedido rechazado',
            html: `<p>Tu pedido fue rechazado por el vendedor.</p><p><strong>Motivo:</strong> ${motivo}</p>
                <p>Si tu pago fue con tarjeta, el reembolso se vera reflejado al instante</p>
            `,
            confirmButtonColor: '#5B9A97',
          }).then(() => {
            this.verificarPedidosActivos();
          });
        });
      })
    );

    // Pedido entregado
    this.subscriptions.push(
      this.wsService.onPedidoEntregado().subscribe((pedido) => {
        this.reproducirSonido();
        //console.log('Pedido entregado:', pedido);

        // Buscar y actualizar el pedido en el array
        const index = this.pedidosActivos.findIndex((p) => p.id === pedido.id);

        if (index !== -1) {
          // Actualizar el pedido
          this.pedidosActivos[index] = pedido;

          // Si es el seleccionado, actualizarlo también
          if (this.pedidoSeleccionado?.id === pedido.id) {
            this.pedidoSeleccionado = pedido;
          }

          // Mostrar notificación
          Swal.fire({
            icon: 'success',
            title: '¡Tu pedido ha sido entregado!',
            text: '¡Disfrútalo! 🎉',
            confirmButtonText: 'Calificar productos',
            cancelButtonText: 'Cerrar',
            showCancelButton: true,
            confirmButtonColor: '#5B9A97',
            cancelButtonColor: '#7A8A8B',
          }).then((result) => {
            if (result.isConfirmed) {
              // Abrir modal de calificación
              this.abrirModalCalificacion(pedido);
            } else {
              // Remover el pedido de la lista de activos
              this.pedidosActivos = this.pedidosActivos.filter(
                (p) => p.id !== pedido.id
              );

              // Si era el seleccionado, cerrar el modal
              if (this.pedidoSeleccionado?.id === pedido.id) {
                this.pedidoSeleccionado = null;
                this.mostrarModalSeguimiento = false;
              }
            }
          });
          this.verificarPedidosActivos();
        }
      })
    );
  }

  abrirModalPagoDesdeCarrito(): void {
    // Cerrar el modal del carrito primero
    this.mostrarModalCarrito = false;

    const datosStr = localStorage.getItem('pedido_temporal');
    if (!datosStr) return;

    const datos = JSON.parse(datosStr);
    this.datosTemporalesPedido = datos;

    this.pedidoSeleccionado = {
      total_pedido: datos.areaSeleccionada.total,
      codigo: 'NUEVO',
    } as any;

    this.mostrarModalPago = true;

    // Limpiar localStorage
    localStorage.removeItem('pedido_temporal');
  }

  abrirSeguimiento(): void {
    this.verificarPedidosActivos();
    if (this.pedidosActivos.length === 1) {
      this.pedidoSeleccionado = this.pedidosActivos[0];
      this.mostrarModalSeguimiento = true;
    } else if (this.pedidosActivos.length > 1) {
      this.abrirListaPedidos();
    } else {
      Swal.fire({
        icon: 'info',
        title: 'Sin pedidos activos',
        text: 'No tienes pedidos en este momento',
        confirmButtonColor: '#5B9A97',
      });
    }
  }

  abrirModalPago(): void {
    this.mostrarModalPago = true;
  }

  abrirModalCalificacion(pedido?: Pedido): void {
    // Si se pasa un pedido específico, usarlo; si no, usar el seleccionado
    const pedidoACalificar = pedido || this.pedidoSeleccionado;

    if (pedidoACalificar && pedidoACalificar.pedido_estado_id === 4) {
      // Actualizar el pedido seleccionado
      this.pedidoSeleccionado = pedidoACalificar;

      const cantidadProductos = pedidoACalificar.pedido_productos?.length || 0;
      this.calificaciones = new Array(cantidadProductos).fill(0);
      this.comentarios = new Array(cantidadProductos).fill('');
      this.mostrarModalCalificacion = true;

      // Cerrar modal de seguimiento si está abierto
      this.mostrarModalSeguimiento = false;
    }
  }

  onPedidoCreado(pedido: Pedido): void {
    this.pedidosActivos.push(pedido);
    this.pedidoSeleccionado = pedido;
    this.wsService.suscribirPedido(pedido.id);
    //console.log('Pedido creado cliente layout: ', pedido);

    const pagoPendiente = pedido.pagos?.find(
      (p) => p.pago_metodo_id === 1 && p.pago_estado_id === 2
    );

    if (pagoPendiente) {
      setTimeout(() => {
        this.mostrarModalPago = true;
      }, 500);
    } else {
      this.verificarPedidosActivos();
    }
  }

  onPagoProcesado(): void {
    this.mostrarModalPago = false;
    this.verificarPedidosActivos();
    //this.mostrarModalSeguimiento = true;
  }

  cancelarPedido(): void {
    if (!this.pedidoSeleccionado) {
      Swal.fire('Error', 'No hay pedido seleccionado', 'error');
      return;
    }

    if (this.pedidoSeleccionado.pedido_estado_id !== 1) {
      Swal.fire({
        icon: 'warning',
        title: 'No se puede cancelar',
        text: 'Solo se pueden cancelar pedidos pendientes',
        confirmButtonColor: '#5B9A97',
      });
      return;
    }

    Swal.fire({
      title: '¿Cancelar pedido?',
      html: `<p>Esta acción no se puede deshacer</p>
           <p><strong>Pedido:</strong> #${this.pedidoSeleccionado.codigo}</p>
           <p><strong>Total:</strong> $${this.pedidoSeleccionado.total_pedido}</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, cancelar',
      cancelButtonText: 'No',
      confirmButtonColor: '#E76F51',
      cancelButtonColor: '#7A8A8B',
    }).then((result) => {
      if (result.isConfirmed && this.pedidoSeleccionado) {
        Swal.fire({
          title: 'Cancelando pedido...',
          allowOutsideClick: false,
          didOpen: () => {
            Swal.showLoading();
          },
        });

        this.pedidoService
          .cancelarPedido(this.pedidoSeleccionado.id)
          .subscribe({
            next: () => {
              this.pedidosActivos = this.pedidosActivos.filter(
                (p) => p.id !== this.pedidoSeleccionado!.id
              );

              this.pedidoSeleccionado = null;
              this.mostrarModalSeguimiento = false;

              Swal.fire({
                icon: 'success',
                title: 'Cancelado',
                text: 'Tu pedido ha sido cancelado',
                confirmButtonColor: '#5B9A97',
              }).then(() => {
                if (this.pedidosActivos.length > 0) {
                  this.abrirListaPedidos();
                }
              });
            },
            error: (err) => {
              Swal.fire({
                icon: 'error',
                title: 'Error',
                text: err.error?.message || 'No se pudo cancelar el pedido',
                confirmButtonColor: '#5B9A97',
              });
            },
          });
      }
    });
  }

  procesarPago(): void {
    if (!this.numeroTarjeta || !this.cvv || !this.expiracion) {
      Swal.fire({
        icon: 'warning',
        title: 'Campos incompletos',
        text: 'Por favor completa todos los datos de la tarjeta',
        confirmButtonColor: '#5B9A97',
      });
      return;
    }

    // Verificar si es pedido nuevo o existente
    if (this.datosTemporalesPedido) {
      this.crearPedidoConTarjeta();
    } else {
      this.procesarPagoPendiente();
    }
  }

  crearPedidoConTarjeta(): void {
    Swal.fire({
      title: 'Procesando...',
      html: 'Creando pedido y procesando pago',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    const datos = this.datosTemporalesPedido;
    const productos = datos.areaSeleccionada.items.map((item: any) => ({
      producto_id: item.producto.id,
      cantidad: item.cantidad,
      precio_unitario: item.producto.precio,
      detalles_producto: item.detalles || undefined,
    }));

    const dto: any = {
      productos,
      detalles_pedido: datos.detallesPedido || undefined,
      area_venta_id: datos.areaSeleccionada.area_venta_id,
      metodo_pago: 'tarjeta',
      datos_tarjeta: {
        numero: this.numeroTarjeta.replace(/\s/g, ''),
        cvv: this.cvv,
        expiracion: this.expiracion,
      },
    };

    this.pedidoService.crearPedido(dto).subscribe({
      next: (pedido) => {
        const areaId = datos.areaSeleccionada.area_venta_id;
        this.pedidoService.limpiarItemsPorArea(areaId);

        localStorage.setItem('carrito_limpiado', areaId.toString());

        this.cerrarModalPago();
        this.datosTemporalesPedido = null;

        Swal.fire({
          icon: 'success',
          title: '¡Pedido creado y pagado!',
          text: `Tu pedido #${pedido.codigo} ha sido registrado`,
          confirmButtonColor: '#5B9A97',
        });

        this.verificarPedidosActivos();
      },
      error: (err) => {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: err.error?.message || 'No se pudo procesar el pedido',
          confirmButtonColor: '#5B9A97',
        });
      },
    });
  }

  procesarPagoPendiente(): void {
    // Mantener tu código existente para pedidos ya creados
    if (!this.pedidoSeleccionado) return;

    Swal.fire({
      title: 'Procesando pago...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    const dto: ProcesarPagoDto = {
      datos_tarjeta: {
        numero: this.numeroTarjeta.replace(/\s/g, ''),
        cvv: this.cvv,
        expiracion: this.expiracion,
      },
    };

    this.pedidoService.procesarPago(this.pedidoSeleccionado.id, dto).subscribe({
      next: () => {
        this.cerrarModalPago();
        Swal.fire('¡Pago exitoso!', 'Tu pago ha sido procesado', 'success');
        this.verificarPedidosActivos();
        this.mostrarModalSeguimiento = true;
      },
      error: (err) => {
        Swal.fire(
          'Error',
          err.error.message || 'No se pudo procesar el pago',
          'error'
        );
      },
    });
  }

  setCalificacion(index: number, calificacion: number): void {
    if (!this.calificaciones || this.calificaciones.length === 0) {
      const cantidadProductos =
        this.pedidoSeleccionado?.pedido_productos?.length || 0;
      this.calificaciones = new Array(cantidadProductos).fill(0);
      this.comentarios = new Array(cantidadProductos).fill('');
    }

    if (index >= 0 && index < this.calificaciones.length) {
      this.calificaciones[index] = calificacion;
    }
  }

  enviarCalificaciones(): void {
    if (!this.pedidoSeleccionado) {
      Swal.fire('Error', 'No hay pedido seleccionado para calificar', 'error');
      return;
    }

    if (
      !this.pedidoSeleccionado.pedido_productos ||
      this.pedidoSeleccionado.pedido_productos.length === 0
    ) {
      Swal.fire('Error', 'No hay productos para calificar', 'error');
      return;
    }

    const calificacionesValidas = this.pedidoSeleccionado.pedido_productos
      .map((item, index) => ({
        producto_id: item.producto_id,
        calificacion: this.calificaciones[index],
        comentario: this.comentarios[index] || '',
      }))
      .filter((c) => c.calificacion > 0);

    if (calificacionesValidas.length === 0) {
      Swal.fire({
        icon: 'info',
        title: 'Sin calificaciones',
        text: 'Selecciona al menos una calificación',
        confirmButtonColor: '#5B9A97',
      });
      return;
    }

    Swal.fire({
      title: 'Enviando calificaciones...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    const promesas = calificacionesValidas.map((c) =>
      this.pedidoService
        .calificarProducto(this.pedidoSeleccionado!.id, c)
        .toPromise()
    );

    Promise.all(promesas)
      .then(() => {
        Swal.fire({
          icon: 'success',
          title: '¡Gracias!',
          text: 'Tus calificaciones han sido registradas',
          confirmButtonColor: '#5B9A97',
        }).then(() => {
          // Cerrar modal y limpiar
          this.mostrarModalCalificacion = false;
          this.calificaciones = [];
          this.comentarios = [];

          // Remover el pedido de activos
          if (this.pedidoSeleccionado) {
            this.pedidosActivos = this.pedidosActivos.filter(
              (p) => p.id !== this.pedidoSeleccionado!.id
            );
            this.pedidoSeleccionado = null;
          }
        });
      })
      .catch((err) => {
        //console.error('Error al enviar calificaciones:', err);
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text:
            err.error?.message || 'No se pudieron enviar las calificaciones',
          confirmButtonColor: '#5B9A97',
        });
      });
  }

  cerrarModalPago(): void {
    this.mostrarModalPago = false;
    this.numeroTarjeta = '';
    this.expiracion = '';
    this.cvv = '';
    this.datosTemporalesPedido = null; //Agregar
  }

  cerrarModalSeguimiento(): void {
    this.mostrarModalSeguimiento = false;
  }

  cerrarModalCalificacion(): void {
    this.mostrarModalCalificacion = false;
    this.calificaciones = [];
    this.comentarios = [];

    // Remover el pedido de la lista de activos
    if (this.pedidoSeleccionado) {
      this.pedidosActivos = this.pedidosActivos.filter(
        (p) => p.id !== this.pedidoSeleccionado!.id
      );
      this.pedidoSeleccionado = null;
    }
  }

  logout(): void {
    Swal.fire({
      title: '¿Cerrar sesión?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, salir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#5B9A97',
      cancelButtonColor: '#E76F51',
    }).then((result) => {
      if (result.isConfirmed) {
        this.authService.logout();
      }
    });
  }

  formatearNumeroTarjeta(event: any): void {
    let valor = event.target.value.replace(/\s/g, '');
    valor = valor.replace(/\D/g, '');
    if (valor.length > 0) {
      valor = valor.match(/.{1,4}/g)?.join(' ') || valor;
    }
    this.numeroTarjeta = valor;
  }

  formatearExpiracion(event: any): void {
    let valor = event.target.value.replace(/\D/g, '');
    if (valor.length >= 2) {
      valor = valor.slice(0, 2) + '/' + valor.slice(2, 4);
    }
    this.expiracion = valor;
  }

  abrirListaPedidos(): void {
    if (this.pedidosActivos.length > 0) {
      this.mostrarListaPedidos = true;
    } else {
      Swal.fire({
        icon: 'info',
        title: 'Sin pedidos activos',
        text: 'No tienes pedidos en este momento',
        confirmButtonColor: '#5B9A97',
      });
    }
  }

  seleccionarPedido(pedido: Pedido): void {
    this.pedidoSeleccionado = pedido;
    this.mostrarListaPedidos = false;
    this.mostrarModalSeguimiento = true;
  }

  obtenerEstadoPago(): boolean {
    return (
      this.pedidoSeleccionado?.pagos?.some((p) => p.pago_metodo_id === 1) ??
      false
    );
  }

  reproducirSonido(): void {
    try {
      if (this.audioPendiente && this.audioPendiente.nativeElement) {
        const audio = this.audioPendiente.nativeElement;
        audio.currentTime = 0; // Reiniciar el audio
        audio.play().catch((err) => {
          //console.warn('No se pudo reproducir el sonido:', err);
          this.reproducirSonidoAlternativo();
        });
      }
    } catch (error) {
      console.error('Error en reproducirSonido:', error);
    }
  }

  reproducirSonidoAlternativo(): void {
    // Beep simple como fallback
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

  irAPedidos(): void {
    this.menuAbierto = false;
    this.abrirSeguimiento();
  }

  irAProductos(): void {
    this.menuAbierto = false;
    this.router.navigate(['/cliente/productos']);
  }

  irARecomendaciones(): void {
    this.menuAbierto = false;
    this.router.navigate(['/cliente/recomendaciones']);
  }

  irACarrito(): void {
    this.menuAbierto = false;
    this.router.navigate(['/cliente/carrito']);
  }

  cerrarModalCarrito(): void {
    this.mostrarModalCarrito = false;
  }

  abrirMenu() {
    this.menuAbierto = !this.menuAbierto;
  }

  //Generar QR seguimiento

  async mostrarQR(pedido: Pedido): Promise<void> {
    try {
      const qrImage = await this.qrService.generarQR(pedido.id);

      Swal.fire({
        title: 'Código QR del Pedido',
        html: `
        <img src="${qrImage}" alt="QR Code" style="width: 100%; max-width: 300px; margin: 1rem auto; display: block;">
        <p style="margin-top: 1rem; color: #7A8A8B;">
          Escanea este código para seguir tu pedido sin iniciar sesión
        </p>
      `,
        showCancelButton: true,
        confirmButtonText: 'Descargar QR',
        cancelButtonText: 'Cerrar',
        confirmButtonColor: '#5B9A97',
        cancelButtonColor: '#E76F51',
      }).then((result) => {
        if (result.isConfirmed) {
          this.descargarQR(qrImage, pedido.id);
        }
      });
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo generar el código QR',
        confirmButtonColor: '#E76F51',
      });
    }
  }

  descargarQR(qrImage: string, pedidoId: number): void {
    const link = document.createElement('a');
    link.href = qrImage;
    link.download = `pedido-${pedidoId}-qr.png`;
    link.click();
  }
}
