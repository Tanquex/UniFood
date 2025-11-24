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
import { Router, RouterOutlet } from '@angular/router';
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
    private socketService: WebsocketService,
    private router: Router
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
      next: (response) => {
        // Si la respuesta indica que está esperando una decisión del usuario
        if (response && response.waitingForDecision) {
          this.procesando = false;
          setTimeout(() => {
            this.mostrarProgresoValidacion = false;
          }, 500);
          
          // Mostrar modal con 3 opciones
          this.mostrarModalDecisionAlergia(
            response.sessionId,
            response.producto,
            response.alternativa
          );
          return;
        }

        // Si llegamos aquí, el pedido se creó exitosamente
        const pedido = response as any;
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
        
        // Ocultar el progreso de validación cuando hay un error
        setTimeout(() => {
          this.mostrarProgresoValidacion = false;
        }, 500);
        
        // Si es error de alergias (fallback para compatibilidad con versión anterior)
        if (err.error?.errorType === 'ALERGIAS_DETECTADAS') {
          const detalles = err.error?.details || {};
          const alergias = detalles.alergias || [];
          const productos = detalles.productosConAlergenos || [];
          const alternativas = detalles.alternativas || [];
          
          // Limpiar advertencias del progreso para evitar duplicados
          this.advertenciasAlergias = [];
          this.alternativasProductos = [];
          
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
    data.status = (data.status || "").toLowerCase();

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
      } else if (data.status === 'warning' && data.message && data.handler !== 'Alergias.') {
        // Para otras advertencias que no sean de alergias, usar el método simple
        this.mostrarAdvertencia(data.message);
      }

      if (data.status === 'processing' || data.status === 'error' || data.status === 'warning') {
        this.validacionActual = this.validaciones[index];
      }
    }
  }

  private mostrarAdvertencia(mensaje: string) {
    Swal.fire({
      title: 'Advertencia!',
      position: 'top-end',
      text: mensaje,
      icon: 'warning',
      showConfirmButton: true,
      confirmButtonText: 'Entendido',
      confirmButtonColor: '#dcbb6cff',
      toast: true,
    });
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
      <div style="text-align: left;">
        <p style="margin-bottom: 15px; font-size: 15px;">
          <strong>No podemos procesar tu pedido</strong> porque contiene productos 
          con ingredientes a los que eres alérgico.
        </p>
        <div style="margin: 15px 0; padding: 12px; background: #fef2f2; border-radius: 6px; border-left: 4px solid #dc2626;">
          <p style="margin: 0 0 8px 0; font-weight: 600; color: #991b1b;">
            <i class="fas fa-exclamation-triangle"></i> Alergias detectadas:
          </p>
          <ul style="margin: 5px 0; padding-left: 20px; color: #7f1d1d;">
            ${alergias.map((a: string) => `<li style="margin: 4px 0;">${a}</li>`).join('')}
          </ul>
        </div>
        <div style="margin: 15px 0; padding: 12px; background: #fff7ed; border-radius: 6px; border-left: 4px solid #f59e0b;">
          <p style="margin: 0 0 8px 0; font-weight: 600; color: #92400e;">
            <i class="fas fa-shopping-bag"></i> Productos problemáticos:
          </p>
          <ul style="margin: 5px 0; padding-left: 20px; color: #78350f;">
            ${productos.map((p: string) => `<li style="margin: 4px 0;">${p}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;

    if (alternativas && alternativas.length > 0) {
      htmlContent += `
        <div style="margin-top: 20px; padding: 15px; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 8px; border: 2px solid #5B9A97;">
          <p style="margin-bottom: 12px; font-weight: 700; color: #1e40af; font-size: 16px; display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">💡</span> Recomendaciones de IA - Productos alternativos seguros:
          </p>
          ${alternativas.map((alt, index) => `
            <div style="margin: 12px 0; padding: 15px; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 1px solid #e5e7eb;">
              <div style="margin-bottom: 10px;">
                <p style="margin: 0 0 6px 0; font-weight: 600; color: #374151;">
                  <span style="color: #dc2626; text-decoration: line-through;">${alt.productoOriginalNombre}</span>
                  <span style="margin: 0 8px; color: #9ca3af;">→</span>
                  <span style="color: #059669; font-size: 16px;">${alt.productoAlternativo.nombre}</span>
                </p>
                <p style="margin: 4px 0; color: #059669; font-weight: 700; font-size: 18px;">
                  $${alt.productoAlternativo.precio}
                </p>
              </div>
              <div style="padding: 10px; background: #f9fafb; border-radius: 6px; margin: 10px 0;">
                <p style="margin: 0; font-size: 13px; color: #4b5563; line-height: 1.5;">
                  <strong>💬 Razón de la recomendación:</strong><br/>
                  ${alt.razon}
                </p>
              </div>
              <button 
                id="reemplazar-${index}" 
                style="width: 100%; margin-top: 10px; padding: 12px 20px; background: linear-gradient(135deg, #5B9A97 0%, #4a8a87 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.3s; box-shadow: 0 2px 4px rgba(91, 154, 151, 0.3);"
                onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 4px 8px rgba(91, 154, 151, 0.4)';"
                onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 2px 4px rgba(91, 154, 151, 0.3)';"
                onclick="window.reemplazarProducto(${alt.productoOriginalId}, ${alt.productoAlternativo.id}, '${alt.productoAlternativo.nombre}', ${alt.productoAlternativo.precio})"
              >
                <i class="fas fa-exchange-alt"></i> Reemplazar por este producto
              </button>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      htmlContent += `
        <div style="margin-top: 15px; padding: 12px; background: #f3f4f6; border-radius: 6px;">
          <p style="margin: 0; font-size: 14px; color: #4b5563;">
            <i class="fas fa-info-circle"></i> Por favor, elimina estos productos de tu carrito o consulta con el vendedor 
            sobre alternativas sin estos ingredientes.
          </p>
        </div>
      `;
    }

    // Guardar alternativas en el componente para acceso desde el botón
    (window as any).alternativasActuales = alternativas;
    (window as any).componentePedido = this;
    (window as any).navegarAMenu = () => {
      this.router.navigate(['/cliente/productos']);
      Swal.close();
    };

    Swal.fire({
      icon: 'error',
      title: '⚠️ Alergias detectadas',
      html: htmlContent,
      width: '750px',
      showCancelButton: true,
      confirmButtonText: alternativas && alternativas.length > 0 ? '<i class="fas fa-utensils"></i> Explorar más del menú' : 'Entendido',
      cancelButtonText: 'Cerrar',
      confirmButtonColor: '#5B9A97',
      cancelButtonColor: '#6b7280',
      reverseButtons: true,
      didOpen: () => {
        // Agregar evento al botón de confirmación para navegar al menú
        const confirmButton = document.querySelector('.swal2-confirm') as HTMLElement;
        if (confirmButton && alternativas && alternativas.length > 0) {
          confirmButton.addEventListener('click', (e) => {
            e.preventDefault();
            (window as any).navegarAMenu();
          });
        }
      }
    });
  }

  mostrarModalDecisionAlergia(
    sessionId: string,
    producto: { id: number; nombre: string; alergiasEncontradas: string[]; ingredientesProblema: string[] },
    alternativa?: { producto: any; razon: string } | null
  ): void {
    let htmlContent = `
      <div style="text-align: left;">
        <p style="margin-bottom: 15px; font-size: 15px;">
          <strong>⚠️ Alerta de alergias</strong>
        </p>
        <div style="margin: 15px 0; padding: 12px; background: #fef2f2; border-radius: 6px; border-left: 4px solid #dc2626;">
          <p style="margin: 0 0 8px 0; font-weight: 600; color: #991b1b;">
            Producto: <strong>${producto.nombre}</strong>
          </p>
          <p style="margin: 5px 0; font-weight: 600; color: #7f1d1d;">
            Alergias detectadas:
          </p>
          <ul style="margin: 5px 0; padding-left: 20px; color: #7f1d1d;">
            ${producto.alergiasEncontradas.map((a: string) => `<li style="margin: 4px 0;">${a}</li>`).join('')}
          </ul>
          <p style="margin: 10px 0 5px 0; font-weight: 600; color: #7f1d1d;">
            Ingredientes problemáticos:
          </p>
          <ul style="margin: 5px 0; padding-left: 20px; color: #7f1d1d;">
            ${producto.ingredientesProblema.map((i: string) => `<li style="margin: 4px 0;">${i}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;

    if (alternativa) {
      htmlContent += `
        <div style="margin-top: 20px; padding: 15px; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 8px; border: 2px solid #5B9A97;">
          <p style="margin-bottom: 12px; font-weight: 700; color: #1e40af; font-size: 16px;">
            💡 Recomendación de IA:
          </p>
          <div style="padding: 15px; background: white; border-radius: 8px;">
            <p style="margin: 0 0 6px 0; font-weight: 600; color: #374151;">
              <span style="color: #059669; font-size: 16px;">${alternativa.producto.nombre}</span>
            </p>
            <p style="margin: 4px 0; color: #059669; font-weight: 700; font-size: 18px;">
              $${alternativa.producto.precio}
            </p>
            <p style="margin: 10px 0 0 0; font-size: 13px; color: #4b5563; line-height: 1.5;">
              <strong>💬 Razón:</strong> ${alternativa.razon}
            </p>
          </div>
        </div>
      `;
    }

    // Guardar sessionId y productoId para los botones
    (window as any).sessionIdActual = sessionId;
    (window as any).productoIdActual = producto.id;
    (window as any).componentePedido = this;

    Swal.fire({
      icon: 'warning',
      title: '⚠️ Alergias detectadas',
      html: htmlContent,
      width: '700px',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: alternativa ? '<i class="fas fa-exchange-alt"></i> Reemplazar producto' : '<i class="fas fa-trash"></i> Retirar producto',
      denyButtonText: '<i class="fas fa-edit"></i> Agregar detalles',
      cancelButtonText: '<i class="fas fa-check"></i> Continuar de todos modos',
      confirmButtonColor: alternativa ? '#5B9A97' : '#dc2626',
      denyButtonColor: '#f59e0b',
      cancelButtonColor: '#6b7280',
      reverseButtons: true,
      allowOutsideClick: false,
      didOpen: () => {
        // Si hay alternativa, el botón de confirmación reemplaza el producto
        if (alternativa) {
          const confirmButton = document.querySelector('.swal2-confirm') as HTMLElement;
          if (confirmButton) {
            confirmButton.addEventListener('click', (e) => {
              e.preventDefault();
              this.reemplazarProductoYContinuar(sessionId, producto.id, alternativa.producto);
            });
          }
        } else {
          // Si no hay alternativa, el botón de confirmación retira el producto
          const confirmButton = document.querySelector('.swal2-confirm') as HTMLElement;
          if (confirmButton) {
            confirmButton.addEventListener('click', (e) => {
              e.preventDefault();
              this.tomarDecisionAlergia(sessionId, 'REMOVE', producto.id);
            });
          }
        }

        // Botón "Agregar detalles"
        const denyButton = document.querySelector('.swal2-deny') as HTMLElement;
        if (denyButton) {
          denyButton.addEventListener('click', (e) => {
            e.preventDefault();
            this.mostrarInputDetalles(sessionId, producto.id);
          });
        }

        // Botón "Continuar de todos modos"
        const cancelButton = document.querySelector('.swal2-cancel') as HTMLElement;
        if (cancelButton) {
          cancelButton.addEventListener('click', (e) => {
            e.preventDefault();
            this.tomarDecisionAlergia(sessionId, 'CONTINUE', producto.id);
          });
        }
      }
    });
  }

  mostrarInputDetalles(sessionId: string, productoId: number): void {
    Swal.fire({
      icon: 'question',
      title: 'Agregar detalles especiales',
      html: `
        <p style="margin-bottom: 15px; text-align: left;">
          Especifica cómo quieres modificar el producto (ej: "sin nuez", "sin lactosa", "sin gluten"):
        </p>
        <input id="detalles-input" type="text" class="swal2-input" placeholder="Ej: sin nuez, sin lactosa" style="width: 100%;">
      `,
      showCancelButton: true,
      confirmButtonText: 'Agregar y continuar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#5B9A97',
      cancelButtonColor: '#6b7280',
      preConfirm: () => {
        const input = document.getElementById('detalles-input') as HTMLInputElement;
        const detalles = input?.value?.trim();
        if (!detalles) {
          Swal.showValidationMessage('Por favor, ingresa los detalles especiales');
          return false;
        }
        return detalles;
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        this.tomarDecisionAlergia(sessionId, 'ADD_DETAILS', productoId, result.value);
      }
    });
  }

  tomarDecisionAlergia(
    sessionId: string,
    accion: 'REMOVE' | 'ADD_DETAILS' | 'CONTINUE',
    productoId: number,
    detallesEspeciales?: string
  ): void {
    this.procesando = true;
    this.mostrarProgresoValidacion = true;
    this.resetearValidaciones();

    const decision = {
      accion,
      producto_id: productoId,
      detalles_especiales: detallesEspeciales,
    };

    this.pedidoService.manejarDecisionAlergia(sessionId, decision).subscribe({
      next: (response) => {
        // Si aún hay más decisiones pendientes
        if (response && response.waitingForDecision) {
          this.procesando = false;
          setTimeout(() => {
            this.mostrarProgresoValidacion = false;
          }, 500);
          
          this.mostrarModalDecisionAlergia(
            response.sessionId,
            response.producto,
            response.alternativa
          );
          return;
        }

        // Si llegamos aquí, el pedido se creó exitosamente
        const pedido = response as any;
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
        console.error('❌ Error al procesar decisión:', err);
        setTimeout(() => {
          this.mostrarProgresoValidacion = false;
        }, 500);
        
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: err.error?.message || 'No se pudo procesar tu decisión',
          confirmButtonColor: '#5B9A97',
        });
      },
    });
  }

  reemplazarProductoYContinuar(
    sessionId: string,
    productoOriginalId: number,
    productoAlternativo: any
  ): void {
    // Primero reemplazar en el carrito
    this.reemplazarProductoEnCarrito(
      productoOriginalId,
      productoAlternativo.id,
      productoAlternativo.nombre,
      productoAlternativo.precio
    );

    // Luego retirar el producto original de la validación
    setTimeout(() => {
      this.tomarDecisionAlergia(sessionId, 'REMOVE', productoOriginalId);
    }, 500);
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
