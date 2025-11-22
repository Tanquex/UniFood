import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsObject,
  ValidateNested,
  IsArray,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessageDto {
  @IsString()
  @IsNotEmpty()
  mensaje!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ProductRecommendationDto {
  @IsNumber()
  producto_id!: number;

  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsNumber()
  precio!: number;

  @IsOptional()
  @IsString()
  imagen_url?: string;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsNumber()
  score_recomendacion?: number;
}

export class ChatResponseDto {
  @IsString()
  @IsNotEmpty()
  respuesta!: string;

  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsNumber()
  timestamp!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductRecommendationDto)
  recomendaciones?: ProductRecommendationDto[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ChatHistoryDto {
  @IsNumber()
  id!: number;

  @IsNumber()
  usuario_id!: number;

  @IsString()
  mensaje_usuario!: string;

  @IsObject()
  respuesta_gemini!: Record<string, unknown>;

  @IsDateString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  session_id?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ChatSessionDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsNumber()
  usuario_id!: number;

  @IsOptional()
  @IsNumber()
  total_mensajes?: number;

  @IsOptional()
  @IsString()
  ultimo_mensaje?: string;

  @IsOptional()
  @IsDateString()
  fecha_creacion?: string;

  @IsOptional()
  @IsDateString()
  fecha_ultima_actividad?: string;
}
