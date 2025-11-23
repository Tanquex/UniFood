import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import {JwtModule} from '@nestjs/jwt';
import { PedidosController } from "src/controllers/pedido.controller";
import { PedidosService } from "src/services/pedido.service";
import { PedidoGateway } from "src/gateways/pedido.gateway";
import { PagosClient } from "src/clients/pagos.client";
import { ComunicacionClient } from "src/clients/comunicacion.client";
import { AlergiaIAService } from "src/services/alergia-ia.service";
import { PrismaClient } from "@prisma/client";




@Module({
  imports: [
    HttpModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [PedidosController],
  providers: [
    PedidosService,
    PedidoGateway,
    PagosClient,
    ComunicacionClient,
    AlergiaIAService,
    PrismaClient
  ],
  exports: [PedidosService, PedidoGateway, AlergiaIAService]
})
export class PedidosModule {}
