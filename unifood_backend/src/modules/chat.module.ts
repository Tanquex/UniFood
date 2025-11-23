import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GeminiService } from '../services/gemini.service';
import { PrismaService } from '../services/prisma.service';
import { CacheService } from '../services/cache.service';
import { AlergiaIAService } from '../services/alergia-ia.service';
import { ChatController } from '../controllers/chat.controller';
import { ChatGateway } from '../gateways/chat.gateway';

@Module({
  imports: [
    ConfigModule,
  ],
  providers: [
    GeminiService,
    PrismaService,
    CacheService,
    AlergiaIAService,
    ChatGateway,
  ],
  controllers: [ChatController],
  exports: [GeminiService, AlergiaIAService],
})
export class ChatModule {}
