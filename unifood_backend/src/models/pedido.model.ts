import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsArray,
  IsOptional,
  ValidateNested,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// Datos de tarjeta si el metodo de pago es tarjeta
export class DatosTarjetaDto {
  @IsString()
  @IsNotEmpty()
  numero: string;

  @IsString()
  @IsNotEmpty()
  cvv: string;

  @IsString()
  @IsNotEmpty()
  expiracion: string; // MM/AA
}

// DTO para crear un pedido
export class CrearPedidoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductoPedidoDto)
  productos: ProductoPedidoDto[];

  @IsString()
  @IsOptional()
  detalles_pedido?: string;

  @IsNumber()
  @IsNotEmpty()
  area_venta_id: number;

  @IsEnum(['efectivo', 'tarjeta'])
  @IsNotEmpty()
  metodo_pago: 'efectivo' | 'tarjeta';

  @ValidateNested()
  @Type(() => DatosTarjetaDto)
  @IsOptional()
  datos_tarjeta?: DatosTarjetaDto;
}

// Productos de un pedido
export class ProductoPedidoDto {
  @IsNumber()
  @IsNotEmpty()
  producto_id: number;

  @IsNumber()
  @IsNotEmpty()
  cantidad: number;

  @IsNumber()
  @IsNotEmpty()
  precio_unitario: number;

  @IsString()
  @IsOptional()
  detalles_producto?: string;
}

//PAgo con tarjeta
export class ProcesarPagoTarjetaDto {
  @ValidateNested()
  @Type(() => DatosTarjetaDto)
  @IsNotEmpty()
  datos_tarjeta: DatosTarjetaDto;
}

// DTO para actualizar el estado de un pedido
export class ActualizarEstadoPedidoDto {
  @IsNumber()
  @IsNotEmpty()
  pedido_estado_id: number;

  @IsString()
  @IsOptional()
  comentarios?: string;
}

//Dto para rechazar pedido
export class RechazarPedidoDto {
  @IsString()
  @IsNotEmpty()
  motivo: string;
}

// DTO para entregar pedido
export class EntregarPedidoDto {
  @IsNumber()
  @IsNotEmpty()
  pago_metodo_id: number; // 1:tarjeta, 2:efectivo

  @IsOptional()
  @IsNumber()
  monto_efectivo?: number; // Solo si es efectivo
}

// DTO para calificar un producto en un pedido
export class CalificarProductoDto {
  @IsNumber()
  @IsNotEmpty()
  producto_id: number;

  @IsNumber()
  @IsNotEmpty()
  calificacion: number; // 1 a 5

  @IsString()
  @IsOptional()
  comentario?: string;
}

// DTO para agregar producto al carrito
export class AgregarCarritoDto {
  @IsNumber()
  @IsNotEmpty()
  producto_id: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  cantidad: number;

  @IsString()
  @IsOptional()
  detalles?: string;
}

//Modelos para la generacion de reportes cawn
// ORM
//dTO para los filtros del reporte
// DTO para filtros de reporte
export interface FiltrosReporteDto {
  fecha_inicio?: string;
  fecha_fin?: string;
  pago_metodo_id?: number;
  pedido_estado_id?: number;
  area_venta_id?: number;
}

//Para el reporte general
export interface OpcionesReporteDto {
  incluir_nombre_cliente?: boolean;
  incluir_correo_cliente?: boolean;
  incluir_telefono_cliente?: boolean;
  incluir_detalles_pedido?: boolean;
}

//Para cada pedido individual
export interface OpcionesTicketDto {
  incluir_descripcion_producto?: boolean;
  incluir_detalles_producto?: boolean;
  incluir_calificaciones?: boolean;
}

export interface CatalogoMetodoPago {
  id: number;
  pago_metodo: string;
}

export interface CatalogoEstadoPedido {
  id: number;
  estado: string;
}

export interface CatalogoAreaVenta {
  id: number;
  area_venta: string;
}

// DTO para decisión del usuario sobre producto con alergias
export class DecisionAlergiaDto {
  @IsEnum(['REMOVE', 'ADD_DETAILS', 'CONTINUE'])
  @IsNotEmpty()
  accion: 'REMOVE' | 'ADD_DETAILS' | 'CONTINUE';

  @IsNumber()
  @IsNotEmpty()
  producto_id: number;

  @IsString()
  @IsOptional()
  detalles_especiales?: string; // Solo para ADD_DETAILS (ej: "sin nuez")
}