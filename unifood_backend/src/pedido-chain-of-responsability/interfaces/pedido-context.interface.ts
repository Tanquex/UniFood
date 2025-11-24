import { PrismaServiceInterface } from './prisma-service.interface';
import { CrearPedidoDto } from 'src/models/pedido.model';

export interface PedidoContext {
  dto: CrearPedidoDto;
  clienteId: number;
  prisma: PrismaServiceInterface;
  areaVenta?: any;
  pedidosEnEspera?: number;
  advertencias?: string[];
  gateway?: any;
  alergiaIAService?: any; // Servicio de IA para validación de alergias
  alternativasProductos?: Array<{
    productoOriginalId: number;
    productoOriginalNombre: string;
    productoAlternativo: any;
    razon: string;
  }>; // Productos alternativos recomendados
  
  // Estado de validación para manejo de decisiones del usuario
  validacionEstado?: {
    currentProductIndex: number; // Índice del producto actual siendo validado
    validatedProducts: Set<number>; // IDs de productos validados exitosamente
    ignoredProducts: Set<number>; // IDs de productos que el usuario decidió ignorar
    modifiedProducts: Map<number, string>; // ID → detalles especiales agregados
    shouldStop: boolean; // Flag para detener la cadena y esperar decisión
    waitingForDecision?: {
      productoId: number;
      productoNombre: string;
      alergiasEncontradas: string[];
      ingredientesProblema: string[];
      alternativa?: {
        producto: any;
        razon: string;
      };
    };
  };
}
