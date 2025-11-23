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

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || 
                   this.configService.get<string>('GEMINI_API_KEYS')?.split(',')[0]?.trim();
    
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash-exp' 
      });
      this.logger.log('✅ AlergiaIAService inicializado con Gemini');
    } else {
      this.logger.warn('⚠️  Gemini API key no encontrada. AlergiaIAService en modo fallback');
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

    try {
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
      this.logger.error(`Error detectando alergias: ${error.message}`);
      // Fallback a detección básica
      return this.detectarAlergiasBasico(mensaje);
    }
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

    try {
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
      this.logger.error(`Error verificando ingrediente: ${error.message}`);
      return this.verificarIngredienteBasico(ingrediente, alergia);
    }
  }

  /**
   * Verifica múltiples ingredientes contra múltiples alergias
   * @param ingredientes - Array de ingredientes
   * @param alergias - Array de alergias del cliente
   * @returns Objeto con productos que contienen alergias
   */
  async verificarProductoContieneAlergias(
    ingredientes: string[],
    alergias: string[]
  ): Promise<{ contiene: boolean; alergiasEncontradas: string[]; ingredientesProblema: string[] }> {
    if (alergias.length === 0 || ingredientes.length === 0) {
      return { contiene: false, alergiasEncontradas: [], ingredientesProblema: [] };
    }

    const alergiasEncontradas: string[] = [];
    const ingredientesProblema: string[] = [];

    // Verificar cada combinación de alergia e ingrediente
    for (const alergia of alergias) {
      for (const ingrediente of ingredientes) {
        const contiene = await this.verificarIngredienteContieneAlergia(ingrediente, alergia);
        if (contiene) {
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

    try {
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
      this.logger.error(`Error recomendando producto alternativo: ${error.message}`);
      return this.recomendarProductoAlternativoBasico(productoOriginal, alergias, productosDisponibles);
    }
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
}


