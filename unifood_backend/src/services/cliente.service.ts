import { Injectable, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../services/prisma.service';
import * as bcrypt from 'bcrypt';
import { CreateClienteDto } from './../models/cliente.model';

interface ResultadoRegistrarCliente {
  usuario_id: number;
  cliente_id: number;
  correo: string;
  nombre: string;
}

@Injectable()
export class ClienteService {
  constructor(private prisma: PrismaService) {}

  async registrarCliente(createClienteDto: CreateClienteDto) {
    try {
      // Hashear la contraseña
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(createClienteDto.contrasena, saltRounds);

      // Llamar a la función de la base de datos
      const resultado = await this.prisma.$queryRaw<ResultadoRegistrarCliente[]>`
  SELECT * FROM registrar_cliente(
    ${createClienteDto.correo_electronico},
    ${hashedPassword},
    ${createClienteDto.nombre_completo},
    ${createClienteDto.telefono},
    ${JSON.stringify(createClienteDto.alergias || [])}::jsonb
  )
`;

      // El resultado es un array con un objeto
      const clienteRegistrado = resultado[0];

      return {
        success: true,
        data: {
          usuario_id: clienteRegistrado.usuario_id,
          cliente_id: clienteRegistrado.cliente_id,
          correo: clienteRegistrado.correo,
          nombre: clienteRegistrado.nombre,
        },
        message: 'Cliente registrado exitosamente',
      };
    } catch (error) {
      // Manejo de errores específicos
      if (error.message.includes('ya está registrado')) {
        throw new ConflictException('El correo electrónico ya está registrado');
      }

      throw new InternalServerErrorException(`Error al registrar el cliente: ${error.message}`);
    }
  }
}
