import { BadRequestException, NotFoundException } from '@nestjs/common';

// Tipos de error para identificación en el frontend
export enum PedidoErrorType {
  AREA_NO_ENCONTRADA = 'AREA_NO_ENCONTRADA',
  AREA_INACTIVA = 'AREA_INACTIVA',
  PRODUCTOS_NO_DISPONIBLES = 'PRODUCTOS_NO_DISPONIBLES',
  PRODUCTOS_INACTIVOS = 'PRODUCTOS_INACTIVOS',
  ALERGIAS_DETECTADAS = 'ALERGIAS_DETECTADAS',
  ERROR_PAGO = 'ERROR_PAGO',
  ERROR_GENERAL = 'ERROR_GENERAL',
}

// Excepción base para pedidos
export class PedidoException extends BadRequestException {
  constructor(
    public readonly errorType: PedidoErrorType,
    message: string,
    public readonly details?: any
  ) {
    super({
      errorType,
      message,
      details,
      timestamp: new Date().toISOString(),
    });
  }
}

// Excepciones específicas
export class AreaNoEncontradaException extends NotFoundException {
  constructor(areaId: number) {
    super({
      errorType: PedidoErrorType.AREA_NO_ENCONTRADA,
      message: 'Área de venta no encontrada',
      details: { areaId },
      timestamp: new Date().toISOString(),
    });
  }
}

export class AreaInactivaException extends PedidoException {
  constructor(areaNombre: string) {
    super(
      PedidoErrorType.AREA_INACTIVA,
      'El área de venta no está activa en este momento',
      { areaNombre }
    );
  }
}

export class ProductosNoDisponiblesException extends PedidoException {
  constructor(
    productosInactivos: string[],
  ) {
    let mensaje = 'Productos no disponibles:';
    
    if (productosInactivos.length > 0) {
      mensaje += `\n ${productosInactivos.join('\n ')}`;
    }

    super(
      productosInactivos.length > 0 
        ? PedidoErrorType.PRODUCTOS_INACTIVOS 
        : PedidoErrorType.PRODUCTOS_NO_DISPONIBLES,
      mensaje,
      { productosInactivos }
    );
  }
}

export class AlergiasDetectadasException extends PedidoException {
  constructor(alergias: string[], productosConAlergenos: string[]) {
    super(
      PedidoErrorType.ALERGIAS_DETECTADAS,
      'Se detectaron productos que contienen ingredientes a los que eres alérgico',
      { alergias, productosConAlergenos }
    );
  }
}