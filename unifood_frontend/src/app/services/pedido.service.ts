// src/app/services/pedido.service.ts
import { map, catchError } from 'rxjs/operators'; // ⬅️ AGREGAR
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { environment } from '../../enviroments/enviroment';
import {
  Pedido,
  CrearPedidoDto,
  ProcesarPagoDto,
  RechazarPedidoDto,
  EntregarPedidoDto,
  CalificarProductoDto,
  ItemCarrito,
  CarritoPorArea,
  Producto,
  AgregarCarritoDto,
  CatalogoMetodoPago,
  CatalogoEstadoPedido,
  CatalogoAreaVenta,
  FiltrosReporte,
  OpcionesReporte,
  ReporteResponse,
  OpcionesTicket,
} from '../models/pedido.model';

@Injectable({
  providedIn: 'root',
})
export class PedidoService {
  private apiUrl = environment.apiUrl + '/pedidos';

  // ========== CARRITO ==========
  private itemsCarritoSubject = new BehaviorSubject<ItemCarrito[]>(
    this.obtenerCarritoStorage()
  );
  public itemsCarrito$ = this.itemsCarritoSubject.asObservable();

  constructor(private http: HttpClient) {}

  // ===== MÉTODOS DE CARRITO =====

  // Agregar producto al carrito (versión local - se mantiene igual)
  agregarAlCarrito(
    producto: Producto,
    cantidad: number = 1,
    detalles?: string
  ): void {
    const items = this.itemsCarritoSubject.value;
    const index = items.findIndex(
      (item) => item.producto.id === producto.id && item.detalles === detalles
    );

    if (index > -1) {
      items[index].cantidad += cantidad;
      items[index].subtotal =
        items[index].cantidad * items[index].producto.precio;
    } else {
      const nuevoItem: ItemCarrito = {
        producto,
        cantidad,
        detalles,
        subtotal: cantidad * producto.precio,
      };
      items.push(nuevoItem);
    }

    this.actualizarCarrito(items);
  }

  // AGREGAR NUEVA VERSIÓN que valide con el API
  agregarAlCarritoDesdeApi(
    productoId: number,
    cantidad: number = 1,
    detalles?: string
  ): Observable<any> {
    return new Observable((observer) => {
      this.agregarProductoAlCarrito(productoId, cantidad, detalles).subscribe({
        next: (response) => {
          // El backend retorna el producto validado
          const producto: Producto = response.producto;

          // Agregar al carrito local
          this.agregarAlCarrito(producto, response.cantidad, response.detalles);

          observer.next({
            success: true,
            mensaje: response.mensaje,
            producto,
          });
          observer.complete();
        },
        error: (err) => {
          observer.error(err);
        },
      });
    });
  }

  actualizarCantidad(index: number, cantidad: number): void {
    const items = this.itemsCarritoSubject.value;
    if (cantidad <= 0) {
      items.splice(index, 1);
    } else {
      items[index].cantidad = cantidad;
      items[index].subtotal = cantidad * items[index].producto.precio;
    }
    this.actualizarCarrito(items);
  }

  eliminarItem(index: number): void {
    const items = this.itemsCarritoSubject.value;
    items.splice(index, 1);
    this.actualizarCarrito(items);
  }

  obtenerCarritoPorArea(): CarritoPorArea[] {
    const items = this.itemsCarritoSubject.value;
    const areaMap = new Map<number, CarritoPorArea>();

    items.forEach((item) => {
      const areaId = item.producto.area_venta_id;
      const areaNombre = 'Área ' + areaId; // Ajustar según necesites

      if (!areaMap.has(areaId)) {
        areaMap.set(areaId, {
          area_venta_id: areaId,
          area_nombre: areaNombre,
          items: [],
          total: 0,
        });
      }

      const carritoArea = areaMap.get(areaId)!;
      carritoArea.items.push(item);
      carritoArea.total += item.subtotal;
    });

    return Array.from(areaMap.values());
  }

  obtenerTotalCarrito(): number {
    return this.itemsCarritoSubject.value.reduce(
      (sum, item) => sum + item.subtotal,
      0
    );
  }

  obtenerCantidadTotalCarrito(): number {
    return this.itemsCarritoSubject.value.reduce(
      (sum, item) => sum + item.cantidad,
      0
    );
  }

  limpiarCarrito(): void {
    this.actualizarCarrito([]);
  }

  private actualizarCarrito(items: ItemCarrito[]): void {
    this.itemsCarritoSubject.next(items);
    localStorage.setItem('carrito', JSON.stringify(items));
  }

  private obtenerCarritoStorage(): ItemCarrito[] {
    const carritoStr = localStorage.getItem('carrito');
    return carritoStr ? JSON.parse(carritoStr) : [];
  }

  // Agregar DESPUÉS de obtenerCarritoStorage():

  obtenerItemsCarrito(): ItemCarrito[] {
    return this.itemsCarritoSubject.value;
  }

  // ===== MÉTODOS DE PEDIDOS CLIENTE =====

  crearPedido(dto: CrearPedidoDto): Observable<Pedido | any> {
    return this.http.post<Pedido | any>(this.apiUrl, dto);
  }

  manejarDecisionAlergia(sessionId: string, decision: { accion: 'REMOVE' | 'ADD_DETAILS' | 'CONTINUE'; producto_id: number; detalles_especiales?: string }): Observable<Pedido | any> {
    return this.http.post<Pedido | any>(`${this.apiUrl}/decision-alergia/${sessionId}`, decision);
  }

  procesarPago(pedidoId: number, dto: ProcesarPagoDto): Observable<any> {
    return this.http.post(`${this.apiUrl}/${pedidoId}/procesar-pago`, dto);
  }

  obtenerMisPedidosActivos(): Observable<Pedido[]> {
    return this.http.get<any>(`${this.apiUrl}/mis-pedidos-activos`).pipe(
      map((response) => {
        // Si la respuesta es un array, retornarlo directamente
        if (Array.isArray(response)) {
          return response;
        }
        // Si es un objeto con propiedad 'pedidos', retornar esa propiedad
        if (response && Array.isArray(response.pedidos)) {
          return response.pedidos;
        }
        // Si es un solo objeto, envolverlo en array
        if (response && typeof response === 'object') {
          return [response];
        }
        // Caso por defecto: array vacío
        return [];
      })
    );
  }

  cancelarPedido(pedidoId: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${pedidoId}/cancelar`, {});
  }

  calificarProducto(
    pedidoId: number,
    dto: CalificarProductoDto
  ): Observable<any> {
    return this.http.post(`${this.apiUrl}/${pedidoId}/calificar`, dto);
  }

  obtenerHistorial(): Observable<Pedido[]> {
    return this.http.get<Pedido[]>(`${this.apiUrl}/historial`);
  }

  // ===== MÉTODOS DE PEDIDOS VENDEDOR =====

  obtenerPendientes(): Observable<Pedido[]> {
    return this.http.get<Pedido[]>(`${this.apiUrl}/pendientes`);
  }

  obtenerEnProceso(): Observable<Pedido[]> {
    return this.http.get<Pedido[]>(`${this.apiUrl}/en-proceso`);
  }

  obtenerListos(): Observable<Pedido[]> {
    return this.http.get<Pedido[]>(`${this.apiUrl}/listos`);
  }

  aceptarPedido(pedidoId: number): Observable<Pedido> {
    return this.http.patch<Pedido>(`${this.apiUrl}/${pedidoId}/aceptar`, {});
  }

  rechazarPedido(pedidoId: number, dto: RechazarPedidoDto): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${pedidoId}/rechazar`, dto);
  }

  marcarComoListo(pedidoId: number): Observable<Pedido> {
    return this.http.patch<Pedido>(`${this.apiUrl}/${pedidoId}/listo`, {});
  }

  entregarPedido(pedidoId: number, dto: EntregarPedidoDto): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${pedidoId}/entregar`, dto);
  }

  // Obtener área del vendedor actual
  obtenerMiArea(): Observable<{ area_venta_id: number; mensaje: string }> {
    return this.http.get<{ area_venta_id: number; mensaje: string }>(
      `${this.apiUrl}/mi-area`
    );
  }

  // ===== MÉTODO PARA AGREGAR AL CARRITO DESDE LA API =====

  agregarProductoAlCarrito(
    productoId: number,
    cantidad: number = 1,
    detalles?: string
  ): Observable<any> {
    const dto: AgregarCarritoDto = {
      producto_id: productoId,
      cantidad,
      detalles,
    };

    return this.http.post(`${this.apiUrl}/carrito/agregar`, dto);
  }

  // Verificar si el microservicio de pagos está disponible
  verificarMicroservicioPagos(): Observable<boolean> {
    return this.http
      .get<{ disponible: boolean }>(`${this.apiUrl}/verificar-pagos`)
      .pipe(
        map((response) => response.disponible),
        catchError((err) => {
          return of(false);
        })
      );
  }

  // Limpiar items de un área específica
  limpiarItemsPorArea(areaVentaId: number): void {
    const itemsActuales = this.itemsCarritoSubject.value;

    // Filtrar: mantener solo los items que NO sean del área especificada
    const itemsRestantes = itemsActuales.filter(
      (item) => item.producto.area_venta_id !== areaVentaId
    );

    // Actualizar carrito
    this.itemsCarritoSubject.next(itemsRestantes);

    // Guardar en localStorage
    localStorage.setItem('carrito', JSON.stringify(itemsRestantes));
  }

  //Funciones para reportes
  // Obtener catálogos
  obtenerCatalogosReportes(): Observable<{
    metodosPago: CatalogoMetodoPago[];
    estadosPedido: CatalogoEstadoPedido[];
    areasVenta: CatalogoAreaVenta[];
  }> {
    return this.http.get<any>(`${this.apiUrl}/catalogos-reportes`);
  }

  // Generar reporte
  generarReporte(
    filtros: FiltrosReporte,
    opciones: OpcionesReporte
  ): Observable<ReporteResponse> {
    return this.http.post<ReporteResponse>(`${this.apiUrl}/reporte`, {
      filtros,
      opciones,
    });
  }

  // Generar ticket
  generarTicket(
    pedidoId: number,
    opciones: OpcionesTicket
  ): Observable<Pedido> {
    return this.http.post<Pedido>(
      `${this.apiUrl}/ticket/${pedidoId}`,
      opciones
    );
  }

  ///Obtener el pedido por ID para seguimiento público
  obtenerPedidoPorIdPublico(id: number): Observable<Pedido> {
    return this.http.get<Pedido>(`${this.apiUrl}/publico/${id}`).pipe(
      map((pedido) => ({
        ...pedido,
        total_pedido: Number(pedido.total_pedido), // CONVERTIR A NÚMERO
        pedido_productos: pedido.pedido_productos || [],
        pagos: pedido.pagos || [],
      }))
    );
  }
}
