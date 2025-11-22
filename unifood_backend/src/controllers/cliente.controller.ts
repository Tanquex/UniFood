import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ClienteService } from 'src/services/cliente.service';
import { CreateClienteDto } from 'src/models/cliente.model';

@Controller('cliente')
export class ClienteController {
  constructor(private readonly clienteService: ClienteService) {}

  @Post('registro')
  @HttpCode(HttpStatus.CREATED)
  async registrarCliente(@Body() createClienteDto: CreateClienteDto) {
    return this.clienteService.registrarCliente(createClienteDto);
  }
}