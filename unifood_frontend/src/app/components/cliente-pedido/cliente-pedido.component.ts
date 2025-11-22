import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { PedidoService } from '../../services/pedido.service';
import {
  CarritoPorArea,
  ItemCarrito,
  CrearPedidoDto,
  Pedido,
} from '../../models/pedido.model';
import Swal from 'sweetalert2';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { RecomendacionesHomeComponent } from '../recomendaciones-home/recomendaciones-home.component';
import { WebsocketService } from '../../services/websocket.service';
import { Subscription } from 'rxjs';

interface Validacion {
  nombre: string;
  status: 'pending' | 'processing' | 'success' | 'warning' | 'error';
  message?: string;
}

@Component({
  selector: 'app-cliente-pedido',
  imports: [CommonModule, FormsModule],
  templateUrl: './cliente-pedido.component.html',
  styleUrls: ['./cliente-pedido.component.scss'],
})
export class ClientePedidoComponent implements OnInit {
  @Input() ocultarRecomendaciones: boolean = false; // Nuevo input para ocultar recomendaciones
  @Output() pedidoCreado = new EventEmitter<Pedido>();
  @Output() solicitarModalPago = new EventEmitter<any>();

  carritosPorArea: CarritoPorArea[] = [];
  areaSeleccionada: CarritoPorArea | null = null;
  metodoPagoSeleccionado: 'efectivo' | 'tarjeta' | null = null;
  detallesPedido: string = '';
  procesando: boolean = false;

  private validacionSub?: Subscription;

  mostrarProgresoValidacion: boolean = false;
  validacionActual?: Validacion;

  validaciones: Validacion[] = [
    { nombre: 'Area de Venta.', status: 'pending' },
    { nombre: 'Disponibilidad Area de Venta.', status: 'pending' },
    { nombre: 'Disponibilidad de Productos.', status: 'pending' },
    { nombre: 'Alergias.', status: 'pending' },
    { nombre: 'Tiempo de espera.', status: 'pending' },
    { nombre: 'Pedido Validado.', status: 'pending' },
  ];

  constructor(
    private pedidoService: PedidoService,
    private authService: AuthService,
    private socketService: WebsocketService
  ) {}

  ngOnInit(): void {
    this.cargarCarrito();

    this.pedidoService.itemsCarrito$.subscribe((items) => {
      if (this.carritosPorArea.length > 0 && items.length === 0) {
        this.areaSeleccionada = null;
        this.metodoPagoSeleccionado = null;
        this.detallesPedido = '';
      }

      this.cargarCarrito();
    });

    this.validacionSub = this.socketService.onValidacionProgreso().subscribe({
      next: (data) => this.actualizarValidacion(data),
    });
  }

  ngOnDestroy() {
    this.validacionSub?.unsubscribe();
    this.socketService.off('validacion-progreso');
  }

  cargarCarrito(): void {
    this.carritosPorArea = this.pedidoService.obtenerCarritoPorArea();

    if (this.carritosPorArea.length === 0) {
      this.areaSeleccionada = null;
      return;
    } else if (this.carritosPorArea.length === 1) {
      this.areaSeleccionada = this.carritosPorArea[0];
    } else {
      this.areaSeleccionada =
        this.carritosPorArea.find(
          (a) => a.area_venta_id === this.areaSeleccionada?.area_venta_id
        ) || null;
    }
  }

  seleccionarArea(area: CarritoPorArea): void {
    this.areaSeleccionada = area;
  }

  actualizarCantidad(item: ItemCarrito, nuevaCantidad: number): void {
    let todosLosItems: ItemCarrito[] = [];
    this.pedidoService.itemsCarrito$
      .subscribe((items) => (todosLosItems = items))
      .unsubscribe();
    const index = todosLosItems.indexOf(item);
    this.pedidoService.actualizarCantidad(index, nuevaCantidad);
    this.cargarCarrito();
  }

  eliminarItem(item: ItemCarrito): void {
    Swal.fire({
      title: '¿Eliminar producto?',
      text: `¿Deseas eliminar ${item.producto.nombre}?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#5B9A97',
      cancelButtonColor: '#E76F51',
    }).then((result) => {
      if (result.isConfirmed) {
        let todosLosItems: ItemCarrito[] = [];
        this.pedidoService.itemsCarrito$
          .subscribe((items) => (todosLosItems = items))
          .unsubscribe();
        const index = todosLosItems.indexOf(item);
        this.pedidoService.eliminarItem(index);
        this.cargarCarrito();
      }
    });
  }

  confirmarPedido(): void {
    if (!this.areaSeleccionada || this.areaSeleccionada.items.length === 0) {
      Swal.fire('Error', 'No hay productos en el área seleccionada', 'error');
      return;
    }

    if (!this.metodoPagoSeleccionado) {
      Swal.fire({
        icon: 'warning',
        title: 'Selecciona un método de pago',
        text: 'Debes seleccionar cómo deseas pagar',
        confirmButtonColor: '#5B9A97',
      });
      return;
    }

    if (this.detallesPedido.length > 80) {
      Swal.fire(
        'Advertencia',
        'Los detalles exceden el limite permitido',
        'warning'
      );
      return;
    }

    // Validar microservicio si es pago con tarjeta
    if (this.metodoPagoSeleccionado === 'tarjeta') {
      this.validarYAbrirModalPago();
    } else {
      // Si es efectivo, crear pedido directamente
      this.crearPedidoDirecto();
    }
  }

  validarYAbrirModalPago(): void {
    Swal.fire({
      title: 'Validando...',
      text: 'Verificando disponibilidad del servicio de pagos',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    this.pedidoService.verificarMicroservicioPagos().subscribe({
      next: (disponible) => {
        Swal.close();
        if (disponible) {
          //  Guardar datos temporales en localStorage
          localStorage.setItem(
            'pedido_temporal',
            JSON.stringify({
              areaSeleccionada: this.areaSeleccionada!,
              detallesPedido: this.detallesPedido,
            })
          );

          //Disparar evento personalizado del navegador
          window.dispatchEvent(new CustomEvent('abrirModalPago'));
        } else {
          this.mostrarErrorMicroservicio();
        }
      },
      error: () => {
        Swal.close();
        this.mostrarErrorMicroservicio();
      },
    });
  }

  /* validarMicroservicioPagos(): void {
    Swal.fire({
      title: 'Validando...',
      text: 'Verificando disponibilidad del servicio de pagos',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });

    this.pedidoService.verificarMicroservicioPagos().subscribe({
      next: (disponible) => {
        Swal.close();

        if (disponible) {
          this.crearPedidoDirecto();
        } else {
          this.mostrarErrorMicroservicio();
        }
      },
      error: (err) => {
        console.error('Error al validar microservicio:', err);
        Swal.close();
        this.mostrarErrorMicroservicio();
      },
    });
  }*/

  crearPedidoDirecto(): void {
    if (!this.areaSeleccionada) {
      Swal.fire('Error', 'No hay área seleccionada', 'error');
      return;
    }

    this.procesando = true;
    this.resetearValidaciones();
    this.mostrarProgresoValidacion = true;

    const productos = this.areaSeleccionada.items.map((item) => ({
      producto_id: item.producto.id,
      cantidad: item.cantidad,
      precio_unitario: item.producto.precio,
      detalles_producto: item.detalles || undefined,
    }));

    const dto: CrearPedidoDto = {
      productos: productos,
      detalles_pedido: this.detallesPedido || undefined,
      area_venta_id: this.areaSeleccionada.area_venta_id,
      metodo_pago: this.metodoPagoSeleccionado!,
    };

    this.pedidoService.crearPedido(dto).subscribe({
      next: (pedido) => {
        this.procesando = false;
        setTimeout(() => {
          this.mostrarProgresoValidacion = false;
        }, 2000);

        // Limpiar SOLO los items del área confirmada
        this.pedidoService.limpiarItemsPorArea(
          this.areaSeleccionada!.area_venta_id
        );
        // Resetear datos
        this.areaSeleccionada = null;
        this.metodoPagoSeleccionado = null;
        this.detallesPedido = '';

        // Emitir evento al padre
        this.pedidoCreado.emit(pedido);

        setTimeout(() => {
          this.cargarCarrito();
        }, 2100);
      },
      error: (err) => {
        this.procesando = false;
        //this.mostrarProgresoValidacion = false;
        console.error('❌ Error al crear pedido:', err);
        Swal.fire({
          icon: 'warning',
          title: 'Intentelo de nuevo más tarde',
          html:
            err.error?.message.replace(
              /\n/g,
              '<br>'
            ) /*.join('\n Intentelo de nuevo más tarde.')*/ ||
            'No se pudo crear el pedido',
          confirmButtonColor: '#5B9A97',
        });
      },
    });
  }

  cerrarValidacion() {
    this.mostrarProgresoValidacion = false;
  }

  private actualizarValidacion(data: any) {
    const index = this.validaciones.findIndex((v) => v.nombre === data.handler);
    if (index !== -1) {
      this.validaciones[index].status = data.status;
      this.validaciones[index].message = data.message;

      if (data.status === 'processing' || data.status === 'error' || data.status === 'warning') {
        this.validacionActual = this.validaciones[index];
      }
    }
  }

  private resetearValidaciones() {
    this.validaciones = this.validaciones.map((v) => ({
      ...v,
      status: 'pending',
      message: undefined,
    }));
    this.validacionActual = undefined;
  }

  mostrarErrorMicroservicio(): void {
    Swal.fire({
      icon: 'error',
      title: 'Servicio de pagos no disponible',
      html: `
      <p>El servicio de pagos con tarjeta no está disponible en este momento.</p>
      <p><strong>Por favor, selecciona "Pago en efectivo"</strong></p>
    `,
      confirmButtonText: 'Entendido',
      confirmButtonColor: '#5B9A97',
      allowOutsideClick: false,
    }).then(() => {
      this.metodoPagoSeleccionado = 'efectivo';
    });
  }

  volver(): void {
    this.areaSeleccionada = null;
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
}
