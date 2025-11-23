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
}
