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

  advertenciasAlergias: string[] = [];
  alternativasProductos: Array<{
    productoOriginalId: number;
    productoOriginalNombre: string;
    productoAlternativo: any;
    razon: string;
  }> = [];

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

    // Exponer método de reemplazo globalmente para los botones de SweetAlert
    (window as any).reemplazarProducto = (
      productoOriginalId: number,
      productoAlternativoId: number,
      productoAlternativoNombre: string,
      productoAlternativoPrecio: number
    ) => {
      this.reemplazarProductoEnCarrito(
        productoOriginalId,
        productoAlternativoId,
        productoAlternativoNombre,
        productoAlternativoPrecio
      );
      Swal.close();
    };
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
        console.error('❌ Error al crear pedido:', err);
        
        // Si es error de alergias, mostrar mensaje especial con alternativas
        if (err.error?.errorType === 'ALERGIAS_DETECTADAS') {
          const detalles = err.error?.details || {};
          const alergias = detalles.alergias || [];
          const productos = detalles.productosConAlergenos || [];
          const alternativas = detalles.alternativas || [];
          
          this.mostrarErrorConAlternativas(alergias, productos, alternativas);
        } else {
          Swal.fire({
            icon: 'warning',
            title: 'Intentelo de nuevo más tarde',
            html:
              err.error?.message?.replace(/\n/g, '<br>') ||
              'No se pudo crear el pedido',
            confirmButtonColor: '#5B9A97',
          });
        }
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

      // Si es una advertencia de alergias, guardar el mensaje y alternativas
      if (data.status === 'warning' && data.handler === 'Alergias.' && data.message) {
        if (!this.advertenciasAlergias.includes(data.message)) {
          this.advertenciasAlergias.push(data.message);
        }

        // Guardar alternativas si vienen en el mensaje
        if (data.alternativa) {
          const existe = this.alternativasProductos.find(
            alt => alt.productoOriginalId === data.alternativa.productoOriginalId
          );
          if (!existe) {
            this.alternativasProductos.push({
              productoOriginalId: data.alternativa.productoOriginalId,
              productoOriginalNombre: data.alternativa.productoOriginalNombre,
              productoAlternativo: data.alternativa.productoAlternativo,
              razon: data.alternativa.razon,
            });
          }
        }
      }

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
    this.advertenciasAlergias = [];
    this.alternativasProductos = [];
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

  mostrarErrorConAlternativas(
    alergias: string[],
    productos: string[],
    alternativas: Array<{
      productoOriginalId: number;
      productoOriginalNombre: string;
      productoAlternativo: any;
      razon: string;
    }>
  ): void {
    let htmlContent = `
      <p style="margin-bottom: 15px;">
        <strong>No podemos procesar tu pedido</strong> porque contiene productos 
        con ingredientes a los que eres alérgico.
      </p>
      <div style="text-align: left; margin: 15px 0;">
        <p><strong>Alergias detectadas:</strong></p>
        <ul style="margin: 10px 0; padding-left: 20px;">
          ${alergias.map((a: string) => `<li>${a}</li>`).join('')}
        </ul>
        <p style="margin-top: 15px;"><strong>Productos problemáticos:</strong></p>
        <ul style="margin: 10px 0; padding-left: 20px;">
          ${productos.map((p: string) => `<li>${p}</li>`).join('')}
        </ul>
      </div>
    `;

    if (alternativas && alternativas.length > 0) {
      htmlContent += `
        <div style="margin-top: 20px; padding: 15px; background: #f0f9ff; border-radius: 8px; border-left: 4px solid #5B9A97;">
          <p style="margin-bottom: 10px; font-weight: 600; color: #1e40af;">
            💡 Sugerencias de productos alternativos:
          </p>
          ${alternativas.map((alt, index) => `
            <div style="margin: 10px 0; padding: 10px; background: white; border-radius: 6px;">
              <p style="margin: 0 0 5px 0; font-weight: 600;">
                En lugar de: <span style="color: #dc2626;">${alt.productoOriginalNombre}</span>
              </p>
              <p style="margin: 5px 0; color: #059669; font-weight: 600;">
                → ${alt.productoAlternativo.nombre} - $${alt.productoAlternativo.precio}
              </p>
              <p style="margin: 5px 0; font-size: 13px; color: #666;">
                ${alt.razon}
              </p>
              <button 
                id="reemplazar-${index}" 
                style="margin-top: 8px; padding: 8px 16px; background: #5B9A97; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;"
                onclick="window.reemplazarProducto(${alt.productoOriginalId}, ${alt.productoAlternativo.id}, '${alt.productoAlternativo.nombre}', ${alt.productoAlternativo.precio})"
              >
                Reemplazar por este producto
              </button>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      htmlContent += `
        <p style="margin-top: 15px; font-size: 14px; color: #666;">
          Por favor, elimina estos productos de tu carrito o consulta con el vendedor 
          sobre alternativas sin estos ingredientes.
        </p>
      `;
    }

    // Guardar alternativas en el componente para acceso desde el botón
    (window as any).alternativasActuales = alternativas;
    (window as any).componentePedido = this;

    Swal.fire({
      icon: 'error',
      title: '⚠️ Alergias detectadas',
      html: htmlContent,
      confirmButtonText: alternativas && alternativas.length > 0 ? 'Entendido, veré las opciones' : 'Entendido',
      confirmButtonColor: '#E76F51',
      width: '700px',
      didOpen: () => {
        // Los botones se manejarán con eventos
      }
    });
  }

  reemplazarProductoEnCarrito(
    productoOriginalId: number,
    productoAlternativoId: number,
    productoAlternativoNombre: string,
    productoAlternativoPrecio: number
  ): void {
    if (!this.areaSeleccionada) return;

    // Buscar el item en el carrito
    const itemIndex = this.areaSeleccionada.items.findIndex(
      item => item.producto.id === productoOriginalId
    );

    if (itemIndex === -1) {
      Swal.fire('Error', 'No se encontró el producto en el carrito', 'error');
      return;
    }

    const item = this.areaSeleccionada.items[itemIndex];
    const cantidad = item.cantidad;
    const detalles = item.detalles;

    // Eliminar el producto original
    let todosLosItems: ItemCarrito[] = [];
    this.pedidoService.itemsCarrito$
      .subscribe((items) => (todosLosItems = items))
      .unsubscribe();
    
    const globalIndex = todosLosItems.findIndex(
      i => i.producto.id === productoOriginalId
    );

    if (globalIndex !== -1) {
      this.pedidoService.eliminarItem(globalIndex);
    }

    // Agregar el producto alternativo
    const productoAlternativo = {
      id: productoAlternativoId,
      nombre: productoAlternativoNombre,
      precio: productoAlternativoPrecio,
      imagen_url: item.producto.imagen_url, // Mantener imagen si existe
      categoria_id: item.producto.categoria_id,
      area_venta_id: item.producto.area_venta_id,
      estado: true,
      tiempo_preparacion: item.producto.tiempo_preparacion,
      descripcion: item.producto.descripcion,
      calorias: item.producto.calorias || 0, // Agregar calorías del producto original o 0 por defecto
    };

    this.pedidoService.agregarAlCarrito(
      productoAlternativo,
      cantidad,
      detalles
    );

    // Recargar carrito
    this.cargarCarrito();

    Swal.fire({
      icon: 'success',
      title: '✅ Producto reemplazado',
      html: `
        <p>Se reemplazó <strong>${item.producto.nombre}</strong> por <strong>${productoAlternativoNombre}</strong></p>
        <p style="margin-top: 10px; font-size: 14px;">Cantidad: ${cantidad}</p>
      `,
      confirmButtonText: 'Continuar',
      confirmButtonColor: '#5B9A97',
      timer: 3000,
      timerProgressBar: true
    });
  }
}
