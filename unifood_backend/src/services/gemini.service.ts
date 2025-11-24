import { randomUUID } from 'node:crypto';
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { CacheService } from './cache.service';
import {
  ChatMessageDto,
  ChatResponseDto,
  ProductRecommendationDto,
} from '../models/chat.model';

type GeminiJsonPayload = {
  respuesta?: string;
  recomendaciones?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

type UserContext = {
  userId: number;
  preferences: Array<{ categoria: string; cantidad: number }>;
  orderHistory: Array<{
    fecha: string;
    total: number;
    productos: Array<{
      nombre: string;
      cantidad: number;
      precio: number;
    }>;
  }>;
};

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly availableModels: string[];
  private geminiModelName: string;
  private readonly recommendationLimit: number;
  private readonly fallbackTemplates: string[] = [
    'Hola, soy tu asistente UniFood. Para opciones ligeras puedes probar una ensalada fresca o un wrap de pollo a la plancha.',
    'Basado en tus pedidos recientes te recomiendo un bowl de quinoa con verduras asadas y agua infusionada sin azucar.',
    'Si buscas algo rapido y completo, una pechuga a la plancha con arroz integral y ensalada es una gran eleccion.',
    'Puedes combinar una sopa de verduras, una baguette de pavo y un licuado natural para mantenerte con energia.',
  ];
  private model: any = null;
  private geminiApiKey?: string;
  private geminiApiKeys: string[] = [];
  private currentApiKeyIndex = 0;
  private currentModelIndex = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
  ) {
    const configuredModel = this.normalizeModelName(
      this.configService.get<string>('GEMINI_MODEL', 'gemini-2.5-flash-lite'),
    );
    this.availableModels = this.buildModelPreferenceList(configuredModel);
    this.geminiModelName = this.availableModels[0];
    this.recommendationLimit = this.configService.get<number>(
      'CHAT_RECOMMENDATION_LIMIT',
      3,
    );

    // Soporte para múltiples API keys (nuevo formato)
    const apiKeysString = this.configService.get<string>('GEMINI_API_KEYS');
    if (apiKeysString) {
      this.geminiApiKeys = apiKeysString
        .split(',')
        .map(key => key.trim())
        .filter(key => key.length > 0);
      
      if (this.geminiApiKeys.length > 0) {
        this.geminiApiKey = this.geminiApiKeys[0];
        this.logger.log(`🔑 Loaded ${this.geminiApiKeys.length} Gemini API key(s) for rotation`);
      }
    }

    // Fallback al formato antiguo (una sola key)
    if (!this.geminiApiKey) {
      this.geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');
      if (this.geminiApiKey) {
        this.geminiApiKeys = [this.geminiApiKey];
        this.logger.log('🔑 Loaded single Gemini API key (legacy format)');
      }
    }

    if (!this.geminiApiKey || this.geminiApiKeys.length === 0) {
      this.logger.warn('⚠️  Gemini API key missing. Running in fallback mode.');
      return;
    }

    this.initializeModel(this.geminiModelName);
  }

  async generateRecommendation(
    message: ChatMessageDto,
    userId: number,
  ): Promise<ChatResponseDto> {
    if (!message?.mensaje) {
      throw new HttpException(
        'mensaje field is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const sanitizedMessage = this.sanitizeMessage(message.mensaje);
    
    // Validar que el mensaje sea apropiado
    const validation = this.validateMessage(sanitizedMessage);
    if (!validation.valid) {
      return {
        respuesta: validation.reason || 'Por favor, escribe un mensaje apropiado.',
        sessionId: this.normalizeSessionId(message.sessionId),
        timestamp: Date.now(),
        recomendaciones: [],
        metadata: {
          isFallback: true,
          validationError: true,
        },
      };
    }

    // Verificar si el mensaje es relevante para la cafetería
    if (!this.isRelevantToCafeteria(sanitizedMessage)) {
      return {
        respuesta: 'Lo siento, solo puedo ayudarte con preguntas relacionadas con nuestro menú, productos, pedidos y recomendaciones de comida. ¿En qué puedo ayudarte con nuestro menú?',
        sessionId: this.normalizeSessionId(message.sessionId),
        timestamp: Date.now(),
        recomendaciones: [],
        metadata: {
          isFallback: true,
          offTopic: true,
        },
      };
    }

    const sessionId = this.normalizeSessionId(message.sessionId);

    const [userContext, products, cachedConversation] = await Promise.all([
      this.getUserContext(userId),
      this.getAvailableProducts(),
      this.cacheService.getConversation(sessionId, userId),
    ]);

    const prompt = await this.buildPrompt(
      sanitizedMessage,
      userContext,
      products,
      cachedConversation,
    );

    let payload: GeminiJsonPayload | null = null;
    let usageMetadata: Record<string, unknown> | undefined;

    if (this.model) {
      const inferenceResult = await this.tryGenerateWithFallback(prompt);
      if (inferenceResult) {
        payload = inferenceResult.payload;
        usageMetadata = inferenceResult.usageMetadata;
      }
    }

    const fallbackApplied = !payload;
    if (!payload) {
      payload = this.buildFallbackPayload(sanitizedMessage, products);
    }

    const responseDto = this.buildResponseDto(
      payload,
      sessionId,
      userId,
      products,
      usageMetadata,
      fallbackApplied,
    );

    await Promise.allSettled([
      this.saveChatRecord(userId, sanitizedMessage, responseDto, sessionId),
      this.cacheConversation(userId, sessionId, sanitizedMessage, responseDto),
      this.cacheService.incrementChatCounter(userId),
    ]);

    return responseDto;
  }

  async getChatHistory(userId: number, sessionId?: string) {
    try {
      const whereClause: Record<string, unknown> = { usuario_id: userId };
      if (sessionId) {
        whereClause.session_id = sessionId;
      }

      const history = await this.prismaService.registro_chat.findMany({
        where: whereClause,
        orderBy: { timestamp: 'desc' },
        take: 50,
      });

      return history.map((entry) => ({
        id: entry.id,
        usuario_id: entry.usuario_id,
        mensaje_usuario: entry.mensaje_usuario,
        respuesta_gemini: entry.respuesta_gemini as Record<string, unknown>,
        timestamp: entry.timestamp?.toISOString(),
        session_id: entry.session_id ?? undefined,
        metadata: entry.metadata as Record<string, unknown> | undefined,
      }));
    } catch (error: any) {
      this.logger.error(
        `Error getting chat history: ${error.message}`,
        error.stack,
      );
      return [];
    }
  }

  async clearChatHistory(userId: number): Promise<number> {
    try {
      const result = await this.prismaService.registro_chat.deleteMany({
        where: { usuario_id: userId },
      });

      await this.cacheService.clearUserCache(userId);
      return result.count;
    } catch (error: any) {
      this.logger.error(
        `Error clearing chat history: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Error clearing chat history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private sanitizeMessage(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
  }

  /**
   * Valida si el mensaje es apropiado y relevante para el chat de la cafetería
   */
  private validateMessage(message: string): { valid: boolean; reason?: string } {
    const lowerMessage = message.toLowerCase().trim();
    
    // Lista de palabras groseras/inapropiadas (en español)
    const inappropriateWords = [
      'puto', 'puta', 'joder', 'jodido', 'jodida', 'jodete', 'jodete',
      'chingar', 'chingado', 'chingada', 'chinga', 'chinguen',
      'pinche', 'pinches', 'pendejo', 'pendeja', 'pendejos', 'pendejas',
      'cabron', 'cabrón', 'cabrones', 'culero', 'culera', 'culeros', 'culeras',
      'mamada', 'mamadas', 'mamón', 'mamona', 'mamones', 'mamonas',
      'verga', 'vergas', 'vrg', 'vrga',
      'hijo de puta', 'hija de puta', 'hijos de puta', 'hijas de puta',
      'me vale', 'me vale madre', 'me vale verga',
      'chinga tu madre', 'chinga tu pinche madre',
    ];

    // Verificar palabras inapropiadas
    for (const word of inappropriateWords) {
      if (lowerMessage.includes(word)) {
        return {
          valid: false,
          reason: 'Lenguaje inapropiado detectado. Por favor, mantén un lenguaje respetuoso.',
        };
      }
    }

    // Verificar si el mensaje es muy corto o solo caracteres especiales
    const cleanMessage = message.replace(/[^\w\s]/g, '').trim();
    if (cleanMessage.length < 2) {
      return {
        valid: false,
        reason: 'Por favor, escribe un mensaje más completo.',
      };
    }

    // Verificar si el mensaje es solo repetición de caracteres
    if (/^(.)\1{10,}$/.test(cleanMessage)) {
      return {
        valid: false,
        reason: 'Por favor, escribe un mensaje con sentido.',
      };
    }

    return { valid: true };
  }

  /**
   * Detecta si el mensaje es relevante para la cafetería/restaurante
   */
  private isRelevantToCafeteria(message: string): boolean {
    const lowerMessage = message.toLowerCase().trim();
    
    // Palabras clave relacionadas con comida, menú, pedidos, etc.
    const relevantKeywords = [
      // Comida y bebida
      'comida', 'bebida', 'alimento', 'platillo', 'plato', 'producto', 'productos',
      'menú', 'menu', 'carta', 'catalogo', 'catálogo',
      'postre', 'postres', 'torta', 'tortas', 'antojito', 'antojitos',
      'bebida fría', 'bebida caliente', 'bebidas frías', 'bebidas calientes',
      'café', 'cafe', 'té', 'te', 'refresco', 'agua', 'jugo',
      // Acciones relacionadas
      'recomienda', 'recomendación', 'recomendacion', 'recomiéndame', 'recomiendame',
      'sugiere', 'sugerencia', 'quiero', 'dame', 'traeme', 'traeme',
      'pedido', 'pedidos', 'orden', 'ordenar', 'comprar', 'comprar',
      'precio', 'precios', 'cuanto cuesta', 'cuánto cuesta', 'cuesta',
      'ingrediente', 'ingredientes', 'contiene', 'tiene',
      'calorías', 'calorias', 'caloría', 'caloria',
      'alergia', 'alergias', 'alérgico', 'alergico', 'intolerante',
      'sin gluten', 'sin lactosa', 'sin nueces', 'vegetariano', 'vegano',
      // Preguntas comunes
      'qué hay', 'que hay', 'qué tienen', 'que tienen', 'qué venden', 'que venden',
      'qué recomiendas', 'que recomiendas', 'qué sugieres', 'que sugieres',
      'cuéntame', 'cuentame', 'dime', 'háblame', 'hablame',
      'información', 'informacion', 'detalles', 'más info', 'mas info',
      // Características
      'dulce', 'salado', 'picante', 'caliente', 'frío', 'frio',
      'saludable', 'ligero', 'ligera', 'sustancioso', 'sustanciosa',
      'sacie', 'hambre', 'sed', 'antojito', 'antojo',
      // Saludos y cortesía (permitidos)
      'hola', 'buenos días', 'buenos dias', 'buenas tardes', 'buenas noches',
      'gracias', 'por favor', 'porfavor', 'disculpa', 'perdón', 'perdon',
      'adiós', 'adios', 'hasta luego', 'nos vemos',
    ];

    // Si el mensaje contiene alguna palabra clave relevante, es válido
    if (relevantKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return true;
    }

    // Si el mensaje es muy corto (saludo simple), permitirlo
    if (lowerMessage.length <= 20 && /^(hola|hi|hey|buenos|buenas|gracias|ok|okay)$/i.test(lowerMessage)) {
      return true;
    }

    // Si no tiene palabras relevantes y es largo, probablemente no es relevante
    if (lowerMessage.length > 30) {
      return false;
    }

    // Por defecto, permitir mensajes cortos (podrían ser saludos o preguntas simples)
    return true;
  }

  private normalizeSessionId(sessionId?: string): string {
    const safeId = sessionId?.trim();
    if (safeId && safeId.length >= 6) {
      return safeId;
    }
    return `chat_${randomUUID()}`;
  }

  private buildSystemInstruction(): string {
    return [
      'Eres un asistente de UniFood especializado en recomendar alimentos de manera interactiva.',
      'Debes analizar historial de pedidos, preferencias y disponibilidad actual.',
      'Responde siempre en JSON valido con la estructura solicitada.',
      'Evita recomendaciones que no existan en el catalogo proporcionado.',
      '',
      'REGLAS IMPORTANTES:',
      '1. SOLO responde preguntas relacionadas con:',
      '   - Menú, productos, comida y bebidas disponibles',
      '   - Recomendaciones de productos',
      '   - Información sobre ingredientes, precios, calorías',
      '   - Alergias e intolerancias alimentarias',
      '   - Pedidos y compras',
      '   - Características de productos (dulce, salado, saludable, etc.)',
      '',
      '2. Si el usuario pregunta algo que NO está relacionado con comida, menú o pedidos:',
      '   - Responde amablemente: "Lo siento, solo puedo ayudarte con preguntas sobre nuestro menú y productos. ¿En qué puedo ayudarte con la comida?"',
      '   - NO respondas preguntas sobre: política, deportes, tecnología, chistes, conversación casual fuera de tema, etc.',
      '   - NO uses lenguaje grosero, ofensivo o inapropiado.',
      '',
      '3. Si el usuario usa lenguaje inapropiado o grosero:',
      '   - Responde educadamente: "Por favor, mantén un lenguaje respetuoso. ¿En qué puedo ayudarte con nuestro menú?"',
      '   - NO repitas ni uses el lenguaje inapropiado.',
      '',
      '4. Si el mensaje no tiene sentido o es muy confuso:',
      '   - Responde: "No entendí bien tu pregunta. ¿Podrías reformularla? Estoy aquí para ayudarte con nuestro menú y productos."',
      '',
      'SISTEMA DE MENÚ INTERACTIVO:',
      '- Si el usuario pregunta "¿Qué hay en el menú?" o similar, muestra opciones numeradas:',
      '  1. Postres, 2. Tortas, 3. Antojitos, 4. Bebidas Frías, 5. Bebidas Calientes, 6. Menú completo, 7. Más populares, 8. Mejor calificados',
      '- Si el usuario responde con un número (1-8), filtra productos según la opción elegida.',
      '- Si el usuario pregunta sobre un producto específico, da detalles SOLO de ese producto sin mostrar recomendaciones adicionales.',
      '- Personaliza tus respuestas según el historial y preferencias del usuario.',
      '',
      'MANTÉN SIEMPRE EL FOCO: Tu único propósito es ayudar con el menú y productos de UniFood.',
    ].join('\n');
  }

  private async buildPrompt(
    message: string,
    context: UserContext,
    products: any[],
    cachedConversation: any,
  ): Promise<string> {
    const productLines = products
      .map(
        (product) => {
          const line = `ID:${product.id}|Nombre:${product.nombre}|Precio:${Number(
            product.precio,
          ).toFixed(2)}|Categoria:${
            product.categoria?.nombre ?? 'Sin categoria'
          }`;
          // Incluir calorías si están disponibles
          if (product.calorias !== null && product.calorias !== undefined) {
            return `${line}|Calorias:${product.calorias}`;
          }
          return line;
        }
      )
      .join('\n');

    const previousMessages = Array.isArray(cachedConversation?.messages)
      ? cachedConversation.messages
          .slice(-6)
          .map((item: any) => `[${item.role}] ${item.content}`)
          .join('\n')
      : '';

    // Detectar el tipo de consulta
    const queryType = this.detectQueryType(message, products, cachedConversation);
    
    const instructions = [
      this.buildSystemInstruction(),
      '',
      'Contexto del usuario:',
      JSON.stringify(context),
      'Catalogo disponible (todas las categorías):',
      productLines,
      previousMessages ? `Conversacion reciente:\n${previousMessages}` : '',
      '',
      'Instrucciones específicas para este mensaje:',
      `- Mensaje del usuario: "${message}"`,
      '- Devuelve solo JSON valido sin texto adicional.',
      '- Campo respuesta debe ser texto amigable y conversacional.',
      '- Si el mensaje no es relevante para comida/menú, redirige amablemente al tema del menú.',
      '- Si detectas lenguaje inapropiado, responde educadamente sin repetir el lenguaje ofensivo.',
      '- Si el mensaje no tiene sentido, pide aclaración de manera amigable.',
    ];

    switch (queryType.type) {
      case 'menu_request':
        instructions.push(
          '- El usuario quiere ver el menú. Responde así:',
          '- "¡Claro! ¿Qué te gustaría ver? Elige una opción:"',
          '- "1️⃣ Postres 🍰"',
          '- "2️⃣ Tortas 🥪"',
          '- "3️⃣ Antojitos 🌮"',
          '- "4️⃣ Bebidas Frías 🥤"',
          '- "5️⃣ Bebidas Calientes ☕"',
          '- "6️⃣ Ver todo el menú 📋"',
          '- "7️⃣ Los más populares ⭐"',
          '- "8️⃣ Mejor calificados 🏆"',
          '- NO incluyas recomendaciones en este paso.',
          '- Espera a que el usuario elija una opción.',
        );
        break;

      case 'category_selection':
        const categoryFilter = queryType.data;
        const filteredProducts = await this.filterProductsByCategory(products, categoryFilter);
        const filteredLines = filteredProducts
          .map(p => `ID:${p.id}|Nombre:${p.nombre}|Precio:${p.precio}|Categoria:${p.categoria?.nombre || 'Sin categoría'}`)
          .join('\n');
        
        instructions.push(
          `- El usuario eligió ver: ${categoryFilter}`,
          `- Productos filtrados:\n${filteredLines}`,
          '- Muestra estos productos de manera amigable.',
          '- Incluye SOLO productos de esta categoría en las recomendaciones.',
          '- Máximo 3 recomendaciones.',
        );
        break;

      case 'specific_product':
        instructions.push(
          '- El usuario está preguntando sobre un PRODUCTO ESPECÍFICO.',
          '- Da detalles detallados SOLO de ese producto (ingredientes, preparación, beneficios).',
          '- NO incluyas recomendaciones en el campo "recomendaciones" (déjalo vacío o null).',
          '- Enfócate en explicar por qué ese producto es una buena elección.',
        );
        break;

      default: // general_query
        // Detectar si el usuario pide algo específico
        const lowerMessage = message.toLowerCase();
        const wantsLowCalories = lowerMessage.includes('bajo en calorías') || 
                                 lowerMessage.includes('bajo en calorias') ||
                                 lowerMessage.includes('pocas calorías') ||
                                 lowerMessage.includes('pocas calorias') ||
                                 (lowerMessage.includes('calorías') && lowerMessage.includes('bajo')) ||
                                 (lowerMessage.includes('calorias') && lowerMessage.includes('bajo'));
        
        const wantsFilling = lowerMessage.includes('sacie') || 
                            lowerMessage.includes('hambre') ||
                            lowerMessage.includes('sustancioso') ||
                            lowerMessage.includes('sustanciosa') ||
                            lowerMessage.includes('llene');
        
        instructions.push(
          '- Campo recomendaciones es un arreglo de máximo tres opciones.',
          '- Usa los IDs de producto proporcionados; evita duplicados.',
          '- Personaliza según las preferencias del usuario.',
        );
        
        if (wantsLowCalories) {
          instructions.push(
            '- IMPORTANTE: El usuario quiere productos BAJOS EN CALORÍAS.',
            '- Considera "bajo en calorías" como productos con MENOS DE 200 calorías.',
            '- Si un producto tiene más de 200 calorías, NO lo recomiendes a menos que sea la única opción disponible.',
            '- Prioriza productos con las calorías MÁS BAJAS disponibles.',
            '- Si hay productos sin información de calorías, puedes incluirlos pero menciona que no tienes esa información.',
            '- En tu respuesta, menciona las calorías de cada producto recomendado.',
          );
        } else if (wantsFilling) {
          instructions.push(
            '- El usuario quiere algo que SACIÉ o LLENE el hambre.',
            '- Prioriza productos más sustanciosos, con más calorías o que tradicionalmente son más llenadores.',
            '- Productos como tortas, antojitos o postres más grandes son mejores opciones.',
          );
        } else {
          instructions.push(
            '- Si el usuario menciona "saludable", "ligero", "ligera", etc.,',
            '  analiza los productos disponibles y recomienda aquellos que mejor se ajusten a esos criterios.',
            '- Si un producto tiene información de calorías, úsala para hacer recomendaciones más precisas.',
          );
        }
        
        instructions.push(
          '- Explica en la respuesta por qué esos productos cumplen con los criterios solicitados.',
          '- Sé honesto: si no hay productos que cumplan perfectamente con los criterios, menciona las limitaciones.',
        );
    }

    return instructions.filter(Boolean).join('\n');
  }

  private detectQueryType(message: string, products: any[], conversation: any): { type: string; data?: any } {
    const lowerMessage = message.toLowerCase().trim();
    
    // 1. Detectar solicitud de menú (solo si es una pregunta simple sobre el menú, no una solicitud de recomendación)
    const menuKeywords = ['qué hay', 'que hay', 'qué tienen', 'que tienen', 'qué venden', 'que venden', 'muéstrame el menú', 'muestrame el menu', 'ver el menú', 'ver el menu'];
    const recommendationKeywords = ['recomienda', 'recomendación', 'recomendacion', 'recomiéndame', 'recomiendame', 'sugiere', 'sugerencia', 'bajo en', 'sin', 'que sea', 'que tenga', 'que contenga', 'calorías', 'calorias', 'sacie', 'hambre', 'saludable', 'ligero', 'ligera'];
    
    // Si el mensaje contiene palabras de recomendación, NO es una solicitud de menú simple
    const hasRecommendationIntent = recommendationKeywords.some(keyword => lowerMessage.includes(keyword));
    const hasSimpleMenuRequest = menuKeywords.some(keyword => lowerMessage.includes(keyword)) && !hasRecommendationIntent;
    
    // Solo clasificar como menu_request si es una pregunta simple sobre el menú sin intención de recomendación
    if (hasSimpleMenuRequest || (lowerMessage.includes('menú') && !hasRecommendationIntent && lowerMessage.length < 30)) {
      return { type: 'menu_request' };
    }

    // 2. Detectar selección por número (1-8)
    const numberMatch = lowerMessage.match(/^(\d+)$/);
    if (numberMatch) {
      const option = parseInt(numberMatch[1]);
      const categoryMap: Record<number, string> = {
        1: 'Postres',
        2: 'Tortas',
        3: 'Antojitos',
        4: 'Bebidas Frías',
        5: 'Bebidas Calientes',
        6: 'all', // Menú completo
        7: 'popular', // Más populares
        8: 'rated', // Mejor calificados
      };
      
      if (categoryMap[option]) {
        return { type: 'category_selection', data: categoryMap[option] };
      }
    }

    // 3. Detectar selección por nombre de categoría
    const categoryKeywords = {
      'Postres': ['postre', 'postres', 'dulce', 'dulces', 'pastel', 'pasteles'],
      'Tortas': ['torta', 'tortas', 'sandwich', 'sandwiches'],
      'Antojitos': ['antojito', 'antojitos', 'taco', 'tacos', 'quesadilla', 'quesadillas'],
      'Bebidas Frías': ['bebida fría', 'bebidas frías', 'refresco', 'refrescos', 'agua', 'jugo'],
      'Bebidas Calientes': ['bebida caliente', 'bebidas calientes', 'café', 'cafes', 'té', 'te'],
    };

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(keyword => lowerMessage.includes(keyword))) {
        return { type: 'category_selection', data: category };
      }
    }

    // 4. Detectar consulta sobre producto específico
    const specificKeywords = [
      'cuéntame más sobre',
      'cuéntame sobre',
      'dime sobre',
      'háblame de',
      'háblame sobre',
      'información de',
      'información sobre',
      'detalles de',
      'detalles sobre',
      'ingredientes de',
      'ingredientes del',
      'cómo se prepara',
      'qué lleva el',
      'qué lleva la',
      'qué contiene',
    ];

    const hasSpecificKeyword = specificKeywords.some(keyword => lowerMessage.includes(keyword));
    const mentionsProduct = products.some(product => lowerMessage.includes(product.nombre.toLowerCase()));

    if (hasSpecificKeyword || mentionsProduct) {
      return { type: 'specific_product' };
    }

    // 5. Consulta general
    return { type: 'general_query' };
  }

  private async filterProductsByCategory(products: any[], category: string): Promise<any[]> {
    if (category === 'all') {
      return products; // Retornar todos
    }

    if (category === 'popular') {
      return await this.getMostPopularProducts();
    }

    if (category === 'rated') {
      return await this.getBestRatedProducts();
    }

    // Filtrar por categoría específica
    return products.filter(product => 
      product.categoria?.nombre === category
    );
  }

  private async getMostPopularProducts(): Promise<any[]> {
    try {
      // Obtener productos más pedidos basados en la cantidad de pedidos
      const popularProducts = await this.prismaService.$queryRaw`
        SELECT 
          p.id,
          p.nombre,
          p.precio,
          p.descripcion,
          p.imagen_url,
          c.nombre as categoria_nombre,
          COUNT(pp.producto_id) as total_pedidos
        FROM producto p
        LEFT JOIN categoria c ON p.categoria_id = c.id
        LEFT JOIN pedido_producto pp ON p.producto_id = pp.producto_id
        WHERE p.estado = true
        GROUP BY p.id, p.nombre, p.precio, p.descripcion, p.imagen_url, c.nombre
        ORDER BY total_pedidos DESC
        LIMIT 5
      `;

      return (popularProducts as any[]).map(p => ({
        id: p.id,
        nombre: p.nombre,
        precio: p.precio,
        descripcion: p.descripcion,
        imagen_url: p.imagen_url,
        categoria: { nombre: p.categoria_nombre },
        total_pedidos: p.total_pedidos,
      }));
    } catch (error) {
      this.logger.warn('Error al obtener productos populares, usando fallback');
      const allProducts = await this.getAvailableProducts();
      return allProducts.slice(0, 5);
    }
  }

  private async getBestRatedProducts(): Promise<any[]> {
    try {
      // Obtener productos mejor calificados
      const ratedProducts = await this.prismaService.$queryRaw`
        SELECT 
          p.id,
          p.nombre,
          p.precio,
          p.descripcion,
          p.imagen_url,
          c.nombre as categoria_nombre,
          AVG(cp.calificacion) as calificacion_promedio,
          COUNT(cp.id) as total_calificaciones
        FROM producto p
        LEFT JOIN categoria c ON p.categoria_id = c.id
        LEFT JOIN calificacion_producto cp ON p.producto_id = cp.producto_id
        WHERE p.estado = true
        GROUP BY p.id, p.nombre, p.precio, p.descripcion, p.imagen_url, c.nombre
        HAVING COUNT(cp.id) > 0
        ORDER BY calificacion_promedio DESC, total_calificaciones DESC
        LIMIT 5
      `;

      return (ratedProducts as any[]).map(p => ({
        id: p.id,
        nombre: p.nombre,
        precio: p.precio,
        descripcion: p.descripcion,
        imagen_url: p.imagen_url,
        categoria: { nombre: p.categoria_nombre },
        calificacion_promedio: p.calificacion_promedio,
      }));
    } catch (error) {
      this.logger.warn('Error al obtener productos mejor calificados, usando fallback');
      const allProducts = await this.getAvailableProducts();
      return allProducts.slice(0, 5);
    }
  }

  private parseGeminiResponse(text: string): GeminiJsonPayload | null {
    if (!text) {
      return null;
    }

    const trimmed = text.trim();

    try {
      return JSON.parse(trimmed);
    } catch {
      const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      try {
        return JSON.parse(jsonMatch[0]);
      } catch (error: any) {
        this.logger.warn(
          `Unable to parse Gemini JSON payload: ${error.message}`,
        );
      }
    }
    return null;
  }

  private validateResponsePayload(payload: GeminiJsonPayload): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    if (!payload.respuesta || typeof payload.respuesta !== 'string') {
      return false;
    }

    if (
      payload.recomendaciones &&
      !Array.isArray(payload.recomendaciones)
    ) {
      return false;
    }

    return true;
  }

  private buildResponseDto(
    payload: GeminiJsonPayload,
    sessionId: string,
    userId: number,
    products: any[],
    usageMetadata: Record<string, unknown> | undefined,
    fallbackApplied: boolean,
  ): ChatResponseDto {
    const timestamp = Date.now();
    const recomendaciones = this.normalizeRecommendations(
      payload.recomendaciones,
      products,
    );

    const metadata: Record<string, unknown> = {
      ...(this.isPlainObject(payload.metadata) ? payload.metadata : {}),
      model: this.model ? this.geminiModelName : 'fallback',
      isFallback: fallbackApplied,
      userId,
      generatedAt: new Date(timestamp).toISOString(),
    };

    if (usageMetadata) {
      metadata.usage = usageMetadata;
    }

    return {
      respuesta: this.sanitizeAssistantResponse(payload.respuesta ?? ''),
      sessionId,
      timestamp,
      recomendaciones,
      metadata,
    };
  }

  private sanitizeAssistantResponse(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private normalizeRecommendations(
    items: GeminiJsonPayload['recomendaciones'],
    products: any[],
  ): ProductRecommendationDto[] {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const productIndex = new Map<number, any>();
    products.forEach((product) => productIndex.set(product.id, product));

    const normalized: ProductRecommendationDto[] = [];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }

      const productId = this.coerceNumber(
        raw.producto_id ?? raw.id ?? raw.productId,
      );
      if (!productId) {
        continue;
      }

      const product = productIndex.get(productId);
      const nombreSource =
        typeof raw.nombre === 'string' && raw.nombre.trim().length > 0
          ? raw.nombre.trim()
          : product?.nombre;
      if (!nombreSource) {
        continue;
      }

      const precio =
        this.coerceNumber(raw.precio) ??
        this.coerceNumber(product?.precio) ??
        0;

      if (precio <= 0) {
        continue;
      }

      const recommendation: ProductRecommendationDto = {
        producto_id: productId,
        nombre: nombreSource,
        descripcion:
          typeof raw.descripcion === 'string'
            ? raw.descripcion.trim()
            : product?.descripcion ?? undefined,
        precio,
        imagen_url:
          typeof raw.imagen_url === 'string'
            ? raw.imagen_url.trim()
            : product?.imagen_url ?? undefined,
        categoria:
          typeof raw.categoria === 'string'
            ? raw.categoria.trim()
            : product?.categoria?.nombre ?? undefined,
        score_recomendacion: this.coerceNumber(raw.score_recomendacion) ?? undefined,
      };

      normalized.push(recommendation);

      if (normalized.length >= this.recommendationLimit) {
        break;
      }
    }

    return normalized;
  }

  private coerceNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value && typeof value === 'object' && 'toNumber' in value) {
      try {
        return Number((value as any).toNumber());
      } catch {
        return null;
      }
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private buildFallbackPayload(
    message: string,
    products: any[],
  ): GeminiJsonPayload {
    const respuesta = this.selectFallbackMessage(message);
    const sortedProducts = [...products].sort(
      (a, b) => Number(a.id) - Number(b.id),
    );

    const recomendaciones = sortedProducts.slice(0, this.recommendationLimit).map(
      (product) =>
        ({
          producto_id: product.id,
          nombre: product.nombre,
          descripcion: product.descripcion ?? undefined,
          precio: Number(product.precio),
          imagen_url: product.imagen_url ?? undefined,
          categoria: product.categoria?.nombre ?? undefined,
          score_recomendacion: 0.5,
        } as Record<string, unknown>),
    );

    return {
      respuesta,
      recomendaciones,
      metadata: { source: 'fallback' },
    };
  }

  private selectFallbackMessage(message: string): string {
    if (!this.fallbackTemplates.length) {
      return 'Lo siento, no puedo procesar tu solicitud en este momento.';
    }

    const index = this.deterministicIndex(
      message || 'default_fallback_message',
      this.fallbackTemplates.length,
    );
    return this.fallbackTemplates[index];
  }

  private deterministicIndex(seed: string, length: number): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return hash % length;
  }

  private async saveChatRecord(
    userId: number,
    userMessage: string,
    response: ChatResponseDto,
    sessionId: string,
  ): Promise<void> {
    try {
      await this.prismaService.registro_chat.create({
        data: {
          usuario_id: userId,
          mensaje_usuario: userMessage,
          respuesta_gemini: response as unknown as Prisma.JsonObject,
          session_id: sessionId,
          timestamp: new Date(response.timestamp),
          metadata: (response.metadata ?? null) as Prisma.InputJsonValue,
        },
      });
    } catch (error: any) {
      this.logger.error(
        `Error saving chat record: ${error.message}`,
        error.stack,
      );
    }
  }

  private async cacheConversation(
    userId: number,
    sessionId: string,
    userMessage: string,
    response: ChatResponseDto,
  ): Promise<void> {
    try {
      const existing = await this.cacheService.getConversation(sessionId, userId);
      const messages = Array.isArray(existing?.messages)
        ? existing.messages.slice()
        : [];

      messages.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString(),
      });

      messages.push({
        role: 'assistant',
        content: response.respuesta,
        recomendaciones: response.recomendaciones,
        timestamp: new Date(response.timestamp).toISOString(),
      });

      const payload = {
        sessionId,
        userId,
        updatedAt: new Date().toISOString(),
        messages: messages.slice(-10),
      };

      await this.cacheService.cacheConversation(sessionId, payload, 3600, userId);
    } catch (error: any) {
      this.logger.warn(
        `Error caching conversation: ${error.message}`,
      );
    }
  }

  private async getUserContext(userId: number): Promise<UserContext> {
    try {
      const cached = await this.cacheService.getUserContext(userId);
      if (cached) {
        return cached as UserContext;
      }

      const user = await this.prismaService.usuario.findUnique({
        where: { id: userId },
        include: {
          clientes: {
            include: {
              pedidos: {
                include: {
                  pedido_productos: {
                    include: {
                      producto: {
                        include: { categoria: true },
                      },
                    },
                  },
                },
                orderBy: { fecha_registro: 'desc' },
                take: 10,
              },
            },
          },
        },
      });

      const context: UserContext = {
        userId,
        preferences: this.extractUserPreferences(user),
        orderHistory: this.extractOrderHistory(user),
      };

      await this.cacheService.cacheUserContext(userId, context, 3600);
      return context;
    } catch (error: any) {
      this.logger.warn(`Error building user context: ${error.message}`);
      return {
        userId,
        preferences: [],
        orderHistory: [],
      };
    }
  }

  private extractUserPreferences(user: any) {
    if (!user?.clientes?.[0]?.pedidos) {
      return [];
    }

    const counters: Record<string, number> = {};
    user.clientes[0].pedidos.forEach((pedido: any) => {
      pedido.pedido_productos.forEach((item: any) => {
        const category = item.producto?.categoria?.nombre ?? 'Sin categoria';
        counters[category] = (counters[category] ?? 0) + item.cantidad;
      });
    });

    return Object.entries(counters)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([categoria, cantidad]) => ({ categoria, cantidad: cantidad as number }));
  }

  private extractOrderHistory(user: any) {
    if (!user?.clientes?.[0]?.pedidos) {
      return [];
    }

    return user.clientes[0].pedidos.map((pedido: any) => ({
      fecha: pedido.fecha_registro?.toISOString?.() ?? pedido.fecha_registro,
      total: this.coerceNumber(pedido.total_pedido) ?? 0,
      productos: (pedido.pedido_productos ?? []).map((item: any) => ({
        nombre: item.producto?.nombre ?? 'Producto',
        cantidad: item.cantidad,
        precio: this.coerceNumber(item.precio_unitario) ?? 0,
      })),
    }));
  }

  private async getAvailableProducts(): Promise<any[]> {
    try {
      const cached = await this.cacheService.getAvailableProducts();
      if (cached && Array.isArray(cached)) {
        return cached;
      }

      const products = await this.prismaService.producto.findMany({
        where: { estado: true },
        include: {
          categoria: true,
          area_venta: { select: { area_venta: true } },
        },
        take: 50,
      });

      const serialized = products.map((product) => ({
        ...product,
        precio: Number(product.precio),
      }));

      await this.cacheService.cacheAvailableProducts(serialized);
      return serialized;
    } catch (error: any) {
      this.logger.warn(`Error retrieving available products: ${error.message}`);
      return [];
    }
  }

  private buildUsageMetadata(response: any, durationMs: number) {
    if (!response?.response?.usageMetadata) {
      return undefined;
    }

    const usage = response.response.usageMetadata;
    return {
      promptTokens: usage.promptTokenCount ?? usage.promptTokens ?? 0,
      completionTokens:
        usage.candidatesTokenCount ?? usage.completionTokens ?? 0,
      totalTokens: usage.totalTokenCount ?? 0,
      durationMs,
    };
  }

  private buildModelPreferenceList(primary: string): string[] {
    const fallbacksEnv = this.configService
      .get<string>('GEMINI_MODEL_FALLBACKS', '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((model) => this.normalizeModelName(model));

    // Modelos que funcionan según pruebas actuales
    const defaults = [
      'gemini-2.5-flash-lite', // ✅ Más estable y rápido
      'gemini-2.5-flash',      // ✅ Funciona perfectamente
      'gemini-2.5-pro',        // ✅ Funciona perfectamente
    ];

    const allModels = [primary, ...fallbacksEnv, ...defaults];
    const unique: string[] = [];

    for (const model of allModels) {
      if (!unique.includes(model)) {
        unique.push(model);
      }
    }

    return unique;
  }

  private initializeModel(modelName: string): void {
    if (!this.geminiApiKey) {
      this.logger.warn('Gemini API key not configured. Running in fallback mode.');
      this.model = null;
      return;
    }

    try {
      const genAI = new GoogleGenerativeAI(this.geminiApiKey);
      this.model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.buildSystemInstruction(),
      });
      this.geminiModelName = modelName;
      this.logger.log(`Gemini model ${modelName} initialised`);
    } catch (error: any) {
      this.logger.error(
        `Failed to initialise Gemini model ${modelName}: ${error.message}`,
        error.stack,
      );
      this.model = null;
    }
  }

  private async tryGenerateWithFallback(prompt: string): Promise<{
    payload: GeminiJsonPayload | null;
    usageMetadata?: Record<string, unknown>;
  } | null> {
    if (!this.model) {
      return null;
    }

    const maxAttempts = this.availableModels.length;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!this.model) {
        return null;
      }

      try {
        const inferenceStart = Date.now();
        const temperature = Number(
          this.configService.get('GEMINI_TEMPERATURE', 0.4),
        );

        const response = await this.model.generateContent({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
          },
        });

        const text = response.response?.text() ?? '';
        const parsed = this.parseGeminiResponse(text);

        if (!parsed || !this.validateResponsePayload(parsed)) {
          this.logger.warn(
            JSON.stringify({
              event: 'gemini.invalidPayload',
              reason: 'validation_failed',
              text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            }),
          );
          
          // Si el payload es inválido, intentar con el siguiente modelo
          const switched = this.switchToNextModel();
          if (switched) {
            this.logger.warn(
              `Gemini model ${this.geminiModelName} returned invalid payload. Switching to next candidate.`,
            );
            continue;
          }
        }

        const usageMetadata = this.buildUsageMetadata(
          response,
          Date.now() - inferenceStart,
        );

        return {
          payload: parsed ?? null,
          usageMetadata,
        };
      } catch (error: any) {
        // 1. Primero intentar rotar API key si hay error de cuota
        if (this.isQuotaExceededError(error)) {
          const rotated = this.rotateToNextApiKey();
          if (rotated) {
            this.logger.warn(
              `⚠️  API key quota exceeded. Rotated to next key (${this.currentApiKeyIndex + 1}/${this.geminiApiKeys.length})`,
            );
            continue; // Reintentar con la nueva key
          } else {
            this.logger.error(
              `❌ All API keys exhausted or only one key available. Quota limit reached.`,
            );
            // No continuar, ir directamente a fallback
            return null;
          }
        }

        // 2. Luego manejar errores de modelo no disponible o sobrecargado
        if (this.isModelNotFoundError(error) || this.isModelOverloadedError(error)) {
          const switched = this.switchToNextModel();
          if (switched) {
            this.logger.warn(
              `Gemini model ${this.geminiModelName} not available or overloaded. Switching to next candidate.`,
            );
            continue;
          } else {
            this.logger.warn(
              `All Gemini models exhausted. Falling back to template responses.`,
            );
            return null;
          }
        }

        // 3. Cualquier otro error
        this.logger.error(
          `Gemini inference failed: ${error.message}`,
          error.stack,
        );
        return null;
      }
    }

    return null;
  }

  private switchToNextModel(): boolean {
    if (this.currentModelIndex >= this.availableModels.length - 1) {
      return false;
    }

    this.currentModelIndex += 1;
    const nextModel = this.availableModels[this.currentModelIndex];
    this.initializeModel(nextModel);

    if (this.model) {
      return true;
    }

    return this.switchToNextModel();
  }

  private isModelNotFoundError(error: any): boolean {
    if (!error) {
      return false;
    }

    const message = String(error.message ?? '').toLowerCase();
    return (
      message.includes('404') ||
      message.includes('not found') ||
      message.includes('is not supported for generatecontent')
    );
  }

  private isModelOverloadedError(error: any): boolean {
    if (!error) {
      return false;
    }

    const message = String(error.message ?? '').toLowerCase();
    return (
      message.includes('503') ||
      message.includes('service unavailable') ||
      message.includes('overloaded') ||
      message.includes('try again later')
    );
  }

  private isQuotaExceededError(error: any): boolean {
    if (!error) {
      return false;
    }

    const message = String(error.message ?? '').toLowerCase();
    const errorString = JSON.stringify(error).toLowerCase();
    
    return (
      message.includes('429') ||
      message.includes('too many requests') ||
      message.includes('quota exceeded') ||
      message.includes('rate limit') ||
      // Detectar API keys expiradas o inválidas
      message.includes('api key expired') ||
      message.includes('api key invalid') ||
      message.includes('api_key_invalid') ||
      errorString.includes('api_key_invalid') ||
      errorString.includes('api key expired') ||
      // Detectar errores 400 relacionados con API keys
      (message.includes('400') && (message.includes('api key') || message.includes('api_key')))
    );
  }

  private rotateToNextApiKey(): boolean {
    if (this.geminiApiKeys.length <= 1) {
      // Solo hay una key, no se puede rotar
      return false;
    }

    const previousIndex = this.currentApiKeyIndex;
    this.currentApiKeyIndex = (this.currentApiKeyIndex + 1) % this.geminiApiKeys.length;
    
    // Si volvimos a la primera key, significa que intentamos todas
    if (this.currentApiKeyIndex === 0 && previousIndex !== 0) {
      this.logger.warn(`🔄 All ${this.geminiApiKeys.length} API keys exhausted. Resetting to first key.`);
      // Nota: No retornamos false aquí porque queremos reintentar con la primera key
      // después de un ciclo completo (quizás los límites ya se refrescaron)
    }

    this.geminiApiKey = this.geminiApiKeys[this.currentApiKeyIndex];
    this.logger.log(`🔑 Rotated to API key ${this.currentApiKeyIndex + 1}/${this.geminiApiKeys.length}`);
    
    // Reinicializamos el modelo con la nueva key
    this.initializeModel(this.geminiModelName);
    
    return true;
  }

  private normalizeModelName(model: string): string {
    const trimmed = (model ?? '').trim();
    if (!trimmed) {
      return 'gemini-2.5-flash-lite';
    }

    const aliases: Record<string, string> = {
      // Modelos oficiales 2.5
      'gemini-2.5-flash-latest': 'gemini-2.5-flash-lite',
      'gemini-2.5-pro-latest': 'gemini-2.5-pro',
      
      // Modelos legacy
      'gemini-1.5-flash-latest': 'gemini-1.5-flash',
      'gemini-1.5-pro-latest': 'gemini-1.5-pro',
      'gemini-1.5-flash-001': 'gemini-1.5-flash',
      'gemini-pro': 'gemini-1.5-pro',
      
      // Alias comunes
      'flash': 'gemini-2.5-flash-lite',
      'pro': 'gemini-1.5-pro',
      'lite': 'gemini-2.5-flash-lite',
    };

    const normalizedKey = trimmed.toLowerCase();
    return aliases[normalizedKey] ?? trimmed;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    );
  }
}
