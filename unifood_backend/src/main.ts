import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  //Prefijo global para todos los endpoints
  app.setGlobalPrefix('unifood/api');

  // CORS para que Angular pueda consumir la API
  app.enableCors({
    origin: [
      configService.get<string>('CORS_ORIGIN'),
      'http://192.168.0.112:4200','http://192.168.137.84:4200','http://192.168.1.181:4200','0.0.0.0', 'http://localhost:4200'
       //192.168.137.84
    ]
  });

  //Validar automáticamente DTOs en los controllers
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Elimina propiedades no definidas en el DTO
      forbidNonWhitelisted: true, // Lanza error si hay propiedades no definidas
      transform: true, // Convierte payloads a instancias de clases DTO
    }),
  );

  //Hashear contrasenas..
  async function generarHashes() {
    const password = 'Linux123#';

    const hash = await bcrypt.hash(password, 10);
    console.log(`Hash de '${password}': ${hash}`);
  }


  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  console.log('Backend corriendo en http://localhost:3000/unifood/api');
  console.log('CORS habilitado para ' + configService.get<string>('CORS_ORIGIN'));

  //solo para pruebas
  //await generarHashes();

}
bootstrap();
