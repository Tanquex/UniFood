import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseConfig} from './config/database.config';
import { RecursoModule } from './modules/ejemplo.module';
import { VendedoresModule } from './modules/vendedores.module';
import { ConfigModule } from '@nestjs/config';
import { authModule } from './modules/auth.module';
import { PrismaModule } from './modules/prisma.module';
import { PedidosModule } from './modules/pedido.module';
import { ChatModule } from './modules/chat.module';
import { AreaVentaModule } from './modules/area-venta.module';
import { CategoriaModule } from './modules/categoria.module';
import { ProductoModule } from './modules/producto.module';
import { RecomendacionModule } from './modules/recomendacion.module';
import { ClienteModule } from './modules/cliente.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, 
    }),
    authModule,
    DatabaseConfig,
    RecursoModule, // Ejemplo de módulo importado
    VendedoresModule,
    PrismaModule,
    PedidosModule,
    ChatModule,
    AreaVentaModule,
    CategoriaModule,
    ProductoModule,
    RecomendacionModule,
    ClienteModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
