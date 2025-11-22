import { Module } from '@nestjs/common';
import { ClienteService } from './../services/cliente.service';
import { ClienteController } from './../controllers/cliente.controller';
import { PrismaModule } from '../modules/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClienteController],
  providers: [ClienteService],
  exports: [ClienteService], 
})
export class ClienteModule {}