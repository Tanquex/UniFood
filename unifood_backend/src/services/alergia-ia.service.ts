import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Servicio para detectar y validar alergias usando IA
 */
@Injectable()
export class AlergiaIAService {
  private readonly logger = new Logger(AlergiaIAService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;
  private geminiApiKey?: string;
  private geminiApiKeys: string[] = [];
  private currentApiKeyIndex = 0;
  private readonly geminiModelName: string;

  constructor(private readonly configService: ConfigService) {
    // Obtener modelo configurado (por defecto gemini-2.5-flash-lite)
    this.geminiModelName = this.configService.get<string>('GEMINI_MODEL', 'gemini-2.5-flash-lite');

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
      this.logger.warn('⚠️  Gemini API key no encontrada. AlergiaIAService en modo fallback');
      return;
    }

    this.initializeModel();
  }

  /**
   * Inicializa el modelo de Gemini con la API key actual
   */
  private initializeModel(): void {
    if (!this.geminiApiKey) {
      this.logger.warn('⚠️ No hay API key disponible para inicializar el modelo');
      this.model = null;
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(this.geminiApiKey);
      this.model = this.genAI.getGenerativeModel({ 
        model: this.geminiModelName 
      });
      this.logger.log(`✅ AlergiaIAService inicializado con Gemini (modelo: ${this.geminiModelName}, key: ${this.currentApiKeyIndex + 1}/${this.geminiApiKeys.length})`);
    } catch (error: any) {
      this.logger.error(`❌ Error inicializando modelo Gemini: ${error.message}`);
      this.model = null;
    }
  }

  /**
   * Detecta alergias mencionadas en un mensaje del chat
   * @param mensaje - Mensaje del usuario
   * @returns Array de alergias detectadas (ej: ['gluten', 'lactosa', 'nueces'])
   */
  async detectarAlergiasEnMensaje(mensaje: string): Promise<string[]> {
    if (!this.model) {
      // Fallback: búsqueda básica por palabras clave
      return this.detectarAlergiasBasico(mensaje);
    }

      const prompt = `Analiza el siguiente mensaje y detecta si el usuario menciona alguna alergia o intolerancia alimentaria.

Mensaje: "${mensaje}"

Responde SOLO con un JSON válido en este formato:
{
  "tieneAlergias": true/false,
  "alergias": ["alergia1", "alergia2", ...]
}

Ejemplos de alergias comunes:
- gluten, celiaco, celíaco
- lactosa, lácteos, leche
- nueces, frutos secos, almendras, cacahuates
- mariscos, pescado
- soja, soya
- huevo, huevos
- etc.

Si no detectas alergias, devuelve {"tieneAlergias": false, "alergias": []}
Responde SOLO con el JSON, sin texto adicional.`;

    // Intentar con rotación de API keys si hay error de cuota
    const maxAttempts = Math.max(this.geminiApiKeys.length, 1);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const text = response.text();
      
      // Extraer JSON de la respuesta
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.tieneAlergias && Array.isArray(parsed.alergias)) {
          // Normalizar nombres de alergias (minúsculas, sin acentos)
          const alergiasNormalizadas = parsed.alergias.map((a: string) => 
            this.normalizarAlergia(a)
          ).filter((a: string) => a.length > 0);
          
          this.logger.log(`🔍 Alergias detectadas: ${alergiasNormalizadas.join(', ')}`);
          return alergiasNormalizadas;
        }
      }
      
      return [];
    } catch (error: any) {
        // Si es error de cuota, intentar rotar API key
        if (this.isQuotaExceededError(error)) {
          const rotated = this.rotateToNextApiKey();
          if (rotated && attempt < maxAttempts - 1) {
            this.logger.warn(
              `⚠️  API key quota exceeded. Rotated to next key (${this.currentApiKeyIndex + 1}/${this.geminiApiKeys.length})`
            );
            continue; // Reintentar con la nueva key
          } else {
            this.logger.error(`❌ All API keys exhausted. Using fallback detection.`);
            return this.detectarAlergiasBasico(mensaje);
          }
        }
        
        // Otros errores: usar fallback
      this.logger.error(`Error detectando alergias: ${error.message}`);
      return this.detectarAlergiasBasico(mensaje);
    }
    }

    return this.detectarAlergiasBasico(mensaje);
  }

  /**
   * Verifica si un ingrediente contiene o puede contener una alergia específica
   * usando matching inteligente con IA
   * @param ingrediente - Nombre del ingrediente
   * @param alergia - Alergia a verificar
   * @returns true si el ingrediente contiene o puede contener la alergia
   */
  async verificarIngredienteContieneAlergia(
    ingrediente: string,
    alergia: string
  ): Promise<boolean> {
    if (!this.model) {
      // Fallback: búsqueda básica
      return this.verificarIngredienteBasico(ingrediente, alergia);
    }

      const prompt = `Analiza si el siguiente ingrediente contiene o puede contener la alergia mencionada.

Ingrediente: "${ingrediente}"
Alergia a verificar: "${alergia}"

Ejemplos:
- "harina de trigo" contiene "gluten" → true
- "queso" contiene "lactosa" → true
- "leche entera" contiene "lactosa" → true
- "aceite de oliva" contiene "gluten" → false
- "harina de arroz" contiene "gluten" → false (arroz no tiene gluten)

Responde SOLO con un JSON válido:
{
  "contiene": true/false,
  "razon": "breve explicación"
}

Responde SOLO con el JSON, sin texto adicional.`;

    // Intentar con rotación de API keys si hay error de cuota
    const maxAttempts = Math.max(this.geminiApiKeys.length, 1);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const text = response.text();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.contiene === true;
      }
      
      return false;
    } catch (error: any) {
        // Si es error de cuota, intentar rotar API key
        if (this.isQuotaExceededError(error)) {
          const rotated = this.rotateToNextApiKey();
          if (rotated && attempt < maxAttempts - 1) {
            this.logger.warn(
              `⚠️  API key quota exceeded. Rotated to next key (${this.currentApiKeyIndex + 1}/${this.geminiApiKeys.length})`
            );
            continue; // Reintentar con la nueva key
          } else {
            this.logger.error(`❌ All API keys exhausted. Using fallback verification.`);
            return this.verificarIngredienteBasico(ingrediente, alergia);
          }
        }
        
        // Otros errores: usar fallback
      this.logger.error(`Error verificando ingrediente: ${error.message}`);
      return this.verificarIngredienteBasico(ingrediente, alergia);
    }
    }

    return this.verificarIngredienteBasico(ingrediente, alergia);
  }

  /**
   * Verifica múltiples ingredientes contra múltiples alergias
   * @param ingredientes - Array de ingredientes
   * @param alergias - Array de alergias del cliente
   * @param detallesEspeciales - Detalles especiales del pedido (ej: "sin nuez", "sin gluten")
   * @returns Objeto con productos que contienen alergias
   */
  async verificarProductoContieneAlergias(
    ingredientes: string[],
    alergias: string[],
    detallesEspeciales?: string
  ): Promise<{ contiene: boolean; alergiasEncontradas: string[]; ingredientesProblema: string[] }> {
    if (alergias.length === 0 || ingredientes.length === 0) {
      return { contiene: false, alergiasEncontradas: [], ingredientesProblema: [] };
    }

    // Si no hay modelo de IA, usar verificación básica
    if (!this.model) {
      this.logger.warn('⚠️ Modelo de IA no disponible, usando verificación básica');
      return this.verificarProductoBasico(ingredientes, alergias, detallesEspeciales);
    }

    // OPTIMIZACIÓN: Una sola llamada a la IA que analiza todo (ingredientes, alergias y detalles especiales)
    this.logger.log(`🤖 Usando IA para verificar ${ingredientes.length} ingrediente(s) contra ${alergias.length} alergia(s)`);
    
    try {
      // Construir prompt incluyendo detalles especiales si existen
      const detallesInfo = detallesEspeciales 
        ? `\n\nDETALLES ESPECIALES DEL PEDIDO: "${detallesEspeciales}"
IMPORTANTE: Si el cliente solicitó excluir algún ingrediente (ej: "sin nuez", "sin lactosa"), 
NO consideres esas alergias como problemáticas. El cliente ya indicó que quiere el producto sin esos ingredientes.`
        : '';

      const prompt = `Analiza si alguno de los siguientes ingredientes contiene o puede contener alguna de las alergias mencionadas.

INGREDIENTES:
${ingredientes.map((ing, i) => `${i + 1}. ${ing}`).join('\n')}

ALERGIAS DEL CLIENTE:
${alergias.map((alg, i) => `${i + 1}. ${alg}`).join('\n')}${detallesInfo}

Ejemplos de matching:
- "harina de trigo" contiene "gluten" → SÍ incluir en ingredientesProblema
- "queso crema" contiene "lactosa" → SÍ incluir en ingredientesProblema
- "galleta" puede contener "gluten" si está hecha con harina de trigo → SÍ incluir
- "aceite de oliva" contiene "gluten" → NO incluir (no tiene gluten)
- "harina de arroz" contiene "gluten" → NO incluir (arroz no tiene gluten)
- "lechuga" contiene "gluten" → NO incluir (lechuga no tiene gluten ni lactosa)
- "jitomate" contiene "gluten" → NO incluir (jitomate no tiene alergias comunes)
- "aguacate" contiene "gluten" → NO incluir (aguacate no tiene alergias comunes)

REGLAS ESTRICTAS:
1. Solo incluye en "ingredientesProblema" ingredientes que REALMENTE contienen o pueden contener las alergias mencionadas.
2. NO incluyas ingredientes que claramente NO tienen esas alergias (ej: lechuga, jitomate, aguacate, jamón de pavo puro).
3. Si un ingrediente NO contiene ninguna alergia, NO lo incluyas en "ingredientesProblema" para nada.
4. NO pongas arrays vacíos []. Si un ingrediente no tiene alergias, simplemente no lo incluyas en el objeto.

Responde SOLO con un JSON válido:
{
  "alergiasEncontradas": ["alergia1", "alergia2"],
  "ingredientesProblema": {
    "ingrediente1": ["alergia1", "alergia2"],
    "ingrediente2": ["alergia1"]
  }
}

Si no se encuentra ninguna alergia, responde:
{
  "alergiasEncontradas": [],
  "ingredientesProblema": {}
}

Responde SOLO con el JSON, sin texto adicional.`;

        const maxAttempts = Math.max(this.geminiApiKeys.length, 1);
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            this.logger.log(`🤖 Llamando a Gemini API (intento ${attempt + 1}/${maxAttempts})...`);
            const result = await this.model.generateContent(prompt);
            const response = result.response;
            const text = response.text();
            
            this.logger.debug(`📝 Respuesta de IA: ${text.substring(0, 200)}...`);
            
            // Extraer JSON de la respuesta (puede venir con markdown code blocks)
            let jsonText = text.trim();
            // Remover markdown code blocks si existen
            jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
            
            const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                
                // Log completo de la respuesta parseada
                this.logger.debug(`📋 Respuesta completa parseada: ${JSON.stringify(parsed, null, 2)}`);
                
                const alergiasEncontradas: string[] = Array.isArray(parsed.alergiasEncontradas) 
                  ? parsed.alergiasEncontradas 
                  : [];
                
                const ingredientesProblema: string[] = [];
                if (parsed.ingredientesProblema && typeof parsed.ingredientesProblema === 'object') {
                  // El objeto puede tener ingredientes como keys, necesitamos buscar coincidencias
                  Object.keys(parsed.ingredientesProblema).forEach(ingredienteKey => {
                    // Solo agregar si el ingrediente tiene al menos una alergia asociada
                    const alergiasDelIngrediente = parsed.ingredientesProblema[ingredienteKey];
                    
                    // Log para debugging
                    this.logger.debug(`🔍 Ingrediente "${ingredienteKey}": alergias=${JSON.stringify(alergiasDelIngrediente)}`);
                    
                    if (Array.isArray(alergiasDelIngrediente) && alergiasDelIngrediente.length > 0) {
                      // Buscar coincidencia parcial o exacta con los ingredientes originales
                      const ingredienteEncontrado = ingredientes.find(ing => 
                        ing.toLowerCase().includes(ingredienteKey.toLowerCase()) || 
                        ingredienteKey.toLowerCase().includes(ing.toLowerCase())
                      );
                      
                      if (ingredienteEncontrado && !ingredientesProblema.includes(ingredienteEncontrado)) {
                        ingredientesProblema.push(ingredienteEncontrado);
                        this.logger.debug(`✅ Agregado ingrediente problemático: "${ingredienteEncontrado}"`);
                      }
                    } else {
                      this.logger.debug(`⏭️  Omitido "${ingredienteKey}" (sin alergias o array vacío)`);
                    }
                  });
                }
                
                this.logger.log(`📋 Ingredientes problemáticos finales: ${ingredientesProblema.join(', ')}`);

                this.logger.log(`✅ IA completó verificación: ${alergiasEncontradas.length} alergia(s) encontrada(s)`);

                // Delay de 200ms después de una llamada exitosa para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 200));

                return {
                  contiene: alergiasEncontradas.length > 0,
                  alergiasEncontradas,
                  ingredientesProblema,
                };
              } catch (parseError: any) {
                this.logger.warn(`⚠️ Error parseando JSON de IA: ${parseError.message}. Respuesta: ${text.substring(0, 100)}`);
                // Continuar al siguiente intento si hay más keys
                if (attempt < maxAttempts - 1) {
                  continue;
                }
              }
            } else {
              this.logger.warn(`⚠️ No se encontró JSON en la respuesta de IA. Respuesta: ${text.substring(0, 100)}`);
              // Continuar al siguiente intento si hay más keys
              if (attempt < maxAttempts - 1) {
                continue;
              }
            }
          } catch (error: any) {
            // Si es error de cuota, intentar rotar API key
            if (this.isQuotaExceededError(error)) {
              const rotated = this.rotateToNextApiKey();
              if (rotated && attempt < maxAttempts - 1) {
                this.logger.warn(
                  `⚠️  API key quota exceeded. Rotated to next key (${this.currentApiKeyIndex + 1}/${this.geminiApiKeys.length})`
                );
                // Delay más largo antes de reintentar (500ms)
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
              } else {
                this.logger.error(`❌ All API keys exhausted. Using fallback verification.`);
                break; // Salir del loop y usar fallback
              }
            } else {
              this.logger.error(`❌ Error verificando con IA: ${error.message}`);
              // Si no es error de cuota, intentar con la siguiente key si hay
              if (attempt < maxAttempts - 1) {
                const rotated = this.rotateToNextApiKey();
                if (rotated) {
                  this.logger.log(`🔄 Rotando a siguiente key debido a error: ${error.message}`);
                  await new Promise(resolve => setTimeout(resolve, 500));
                  continue;
                }
              }
              break; // Otro tipo de error, usar fallback
            }
          }
        }
      } catch (error: any) {
        this.logger.error(`Error en verificación optimizada: ${error.message}`);
      }

      // FALLBACK: Verificación básica si la IA falla
      return this.verificarProductoBasico(ingredientes, alergias, detallesEspeciales);
    }

  /**
   * Normaliza el nombre de una alergia (minúsculas, sin acentos, etc.)
   */
  private normalizarAlergia(alergia: string): string {
    return alergia
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remover acentos
      .replace(/[^a-z0-9\s]/g, '') // Remover caracteres especiales
      .replace(/\s+/g, ' '); // Normalizar espacios
  }

  /**
   * Detección básica de alergias por palabras clave (fallback)
   */
  private detectarAlergiasBasico(mensaje: string): string[] {
    const mensajeLower = mensaje.toLowerCase();
    const alergias: string[] = [];

    const patrones: Record<string, string[]> = {
      gluten: ['gluten', 'celiaco', 'celíaco', 'celiaquia', 'celiaquía', 'trigo'],
      lactosa: ['lactosa', 'lácteos', 'lacteos', 'leche', 'queso', 'yogur', 'yogurt'],
      nueces: ['nueces', 'frutos secos', 'almendras', 'cacahuates', 'maní', 'mani', 'avellanas'],
      mariscos: ['mariscos', 'pescado', 'camarones', 'langosta', 'cangrejo'],
      soja: ['soja', 'soya', 'soja'],
      huevo: ['huevo', 'huevos', 'ovo'],
    };

    for (const [alergia, palabras] of Object.entries(patrones)) {
      if (palabras.some(palabra => mensajeLower.includes(palabra))) {
        alergias.push(alergia);
      }
    }

    return alergias;
  }

  /**
   * Verificación básica de producto completo (fallback cuando no hay IA)
   */
  private verificarProductoBasico(
    ingredientes: string[],
    alergias: string[],
    detallesEspeciales?: string
  ): { contiene: boolean; alergiasEncontradas: string[]; ingredientesProblema: string[] } {
    const alergiasEncontradas: string[] = [];
    const ingredientesProblema: string[] = [];

    // Filtrar alergias excluidas por detalles especiales (básico)
    const alergiasAVerificar = alergias.filter(alergia => {
      if (!detallesEspeciales) return true;
      const detallesLower = detallesEspeciales.toLowerCase();
      const alergiaLower = alergia.toLowerCase();
      
      // Verificación básica: si dice "sin X" y la alergia contiene X, excluirla
      if (detallesLower.includes(`sin ${alergiaLower}`) || detallesLower.includes(`sin ${alergiaLower.slice(0, -1)}`)) {
        return false;
      }
      return true;
    });

    for (const alergia of alergiasAVerificar) {
      for (const ingrediente of ingredientes) {
        if (this.verificarIngredienteBasico(ingrediente, alergia)) {
          if (!alergiasEncontradas.includes(alergia)) {
            alergiasEncontradas.push(alergia);
          }
          if (!ingredientesProblema.includes(ingrediente)) {
            ingredientesProblema.push(ingrediente);
          }
        }
      }
    }

    return {
      contiene: alergiasEncontradas.length > 0,
      alergiasEncontradas,
      ingredientesProblema,
    };
  }

  /**
   * Verificación básica de ingrediente (fallback)
   */
  private verificarIngredienteBasico(ingrediente: string, alergia: string): boolean {
    const ingredienteLower = ingrediente.toLowerCase();
    const alergiaLower = alergia.toLowerCase();

    const reglas: Record<string, string[]> = {
      gluten: ['trigo', 'harina de trigo', 'gluten', 'cebada', 'centeno', 'avena'],
      lactosa: ['leche', 'queso', 'yogur', 'yogurt', 'mantequilla', 'crema', 'lactosa'],
      nueces: ['nuez', 'almendra', 'cacahuate', 'maní', 'mani', 'avellana', 'pistache'],
      mariscos: ['pescado', 'camarón', 'camarones', 'langosta', 'cangrejo', 'atún', 'salmón'],
      soja: ['soja', 'soya', 'tofu', 'miso'],
      huevo: ['huevo', 'huevos', 'ovo'],
    };

    const palabrasClave = reglas[alergiaLower] || [];
    return palabrasClave.some(palabra => ingredienteLower.includes(palabra));
  }

  /**
   * Recomienda productos alternativos sin alergias usando IA
   * @param productoOriginal - Producto que tiene alergias
   * @param alergias - Alergias del cliente
   * @param productosDisponibles - Lista de productos disponibles
   * @returns Producto alternativo recomendado o null
   */
  async recomendarProductoAlternativo(
    productoOriginal: { id: number; nombre: string; ingredientes: any; descripcion?: string },
    alergias: string[],
    productosDisponibles: any[]
  ): Promise<{ producto: any; razon: string } | null> {
    if (!this.model || productosDisponibles.length === 0) {
      // Fallback: buscar productos similares sin las alergias
      return this.recomendarProductoAlternativoBasico(productoOriginal, alergias, productosDisponibles);
    }

      // Parsear ingredientes del producto original
      let ingredientesOriginal: string[] = [];
      if (productoOriginal.ingredientes) {
        if (typeof productoOriginal.ingredientes === 'string') {
          try {
            ingredientesOriginal = JSON.parse(productoOriginal.ingredientes);
          } catch {
            ingredientesOriginal = [productoOriginal.ingredientes];
          }
        } else if (Array.isArray(productoOriginal.ingredientes)) {
          ingredientesOriginal = productoOriginal.ingredientes;
        }
      }

      // Preparar lista de productos disponibles (excluyendo el original)
      const productosFiltrados = productosDisponibles.filter(p => p.id !== productoOriginal.id);
      
      if (productosFiltrados.length === 0) {
        return null;
      }

      // Crear lista de productos con sus ingredientes
      const productosInfo = productosFiltrados.map(p => {
        let ingredientes: string[] = [];
        if (p.ingredientes) {
          if (typeof p.ingredientes === 'string') {
            try {
              ingredientes = JSON.parse(p.ingredientes);
            } catch {
              ingredientes = [p.ingredientes];
            }
          } else if (Array.isArray(p.ingredientes)) {
            ingredientes = p.ingredientes;
          }
        }
        return {
          id: p.id,
          nombre: p.nombre,
          descripcion: p.descripcion || '',
          ingredientes: ingredientes.join(', '),
          precio: Number(p.precio) || 0,
        };
      });

      const prompt = `El cliente es alérgico a: ${alergias.join(', ')}.

Producto original que no puede consumir:
- Nombre: "${productoOriginal.nombre}"
- Descripción: "${productoOriginal.descripcion || 'Sin descripción'}"
- Ingredientes: ${ingredientesOriginal.join(', ')}

Productos disponibles como alternativas:
${productosInfo.map((p, i) => `${i + 1}. ${p.nombre} (ID: ${p.id}) - Precio: $${p.precio}
   Descripción: ${p.descripcion || 'Sin descripción'}
   Ingredientes: ${p.ingredientes || 'No especificados'}`).join('\n\n')}

Analiza y recomienda UN producto alternativo que:
1. NO contenga ninguna de las alergias mencionadas
2. Sea similar en tipo/categoría al producto original
3. Tenga un precio similar (preferiblemente)
4. Sea una buena alternativa

Responde SOLO con un JSON válido:
{
  "producto_id": [ID del producto recomendado],
  "razon": "Breve explicación de por qué es una buena alternativa"
}

Si no encuentras una buena alternativa, responde: {"producto_id": null, "razon": "No se encontró alternativa adecuada"}

Responde SOLO con el JSON, sin texto adicional.`;

    // Intentar con rotación de API keys si hay error de cuota
    const maxAttempts = Math.max(this.geminiApiKeys.length, 1);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const text = response.text();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        if (parsed.producto_id && parsed.razon) {
          const productoRecomendado = productosFiltrados.find(p => p.id === parsed.producto_id);
          
          if (productoRecomendado) {
            // Verificar que realmente no contiene alergias
            let ingredientesRec: string[] = [];
            if (productoRecomendado.ingredientes) {
              if (typeof productoRecomendado.ingredientes === 'string') {
                try {
                  ingredientesRec = JSON.parse(productoRecomendado.ingredientes);
                } catch {
                  ingredientesRec = [productoRecomendado.ingredientes];
                }
              } else if (Array.isArray(productoRecomendado.ingredientes)) {
                ingredientesRec = productoRecomendado.ingredientes;
              }
            }

            const verificar = await this.verificarProductoContieneAlergias(ingredientesRec, alergias);
            
            if (!verificar.contiene) {
              return {
                producto: productoRecomendado,
                razon: parsed.razon
              };
            }
          }
        }
      }
      
      return null;
    } catch (error: any) {
        // Si es error de cuota, intentar rotar API key
        if (this.isQuotaExceededError(error)) {
          const rotated = this.rotateToNextApiKey();
          if (rotated && attempt < maxAttempts - 1) {
            this.logger.warn(
              `⚠️  API key quota exceeded. Rotated to next key (${this.currentApiKeyIndex + 1}/${this.geminiApiKeys.length})`
            );
            continue; // Reintentar con la nueva key
          } else {
            this.logger.error(`❌ All API keys exhausted. Using fallback recommendation.`);
            return this.recomendarProductoAlternativoBasico(productoOriginal, alergias, productosDisponibles);
          }
        }
        
        // Otros errores: usar fallback
      this.logger.error(`Error recomendando producto alternativo: ${error.message}`);
      return this.recomendarProductoAlternativoBasico(productoOriginal, alergias, productosDisponibles);
    }
    }

    return this.recomendarProductoAlternativoBasico(productoOriginal, alergias, productosDisponibles);
  }

  /**
   * Recomendación básica sin IA (fallback)
   */
  private async recomendarProductoAlternativoBasico(
    productoOriginal: { id: number; nombre: string; ingredientes: any },
    alergias: string[],
    productosDisponibles: any[]
  ): Promise<{ producto: any; razon: string } | null> {
    // Filtrar productos que no contengan las alergias
    const productosSeguros: any[] = [];

    for (const producto of productosDisponibles) {
      if (producto.id === productoOriginal.id) continue;

      let ingredientes: string[] = [];
      if (producto.ingredientes) {
        if (typeof producto.ingredientes === 'string') {
          try {
            ingredientes = JSON.parse(producto.ingredientes);
          } catch {
            ingredientes = [producto.ingredientes];
          }
        } else if (Array.isArray(producto.ingredientes)) {
          ingredientes = producto.ingredientes;
        }
      }

      const ingredientesStr = ingredientes.join(' ').toLowerCase();
      let esSeguro = true;

      for (const alergia of alergias) {
        const alergiaLower = alergia.toLowerCase();
        if (ingredientesStr.includes(alergiaLower)) {
          esSeguro = false;
          break;
        }
      }

      if (esSeguro) {
        productosSeguros.push(producto);
      }
    }

    if (productosSeguros.length > 0) {
      // Retornar el primero disponible
      return {
        producto: productosSeguros[0],
        razon: `Alternativa segura sin ${alergias.join(', ')}`
      };
    }

    return null;
  }

  /**
   * Detecta si un error es de cuota excedida (429)
   */
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

  /**
   * Rota a la siguiente API key disponible
   */
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
      return false; // No más keys disponibles
    }

    this.geminiApiKey = this.geminiApiKeys[this.currentApiKeyIndex];
    this.logger.log(`🔑 Rotated to API key ${this.currentApiKeyIndex + 1}/${this.geminiApiKeys.length}`);
    
    // Reinicializamos el modelo con la nueva key
    this.initializeModel();
    
    return true;
  }
}


