# 🧪 Guía de Pruebas - Sistema de Detección y Validación de Alergias con IA

Esta guía te ayudará a probar el sistema completo de detección y validación de alergias.

## 📋 Requisitos Previos

1. ✅ Backend corriendo en `http://localhost:3000`
2. ✅ Base de datos PostgreSQL conectada
3. ✅ Variable de entorno `GEMINI_API_KEY` configurada (opcional, tiene fallback)
4. ✅ Cliente de Prisma generado (`npx prisma generate`)

---

## 🧪 Método 1: Prueba Manual con el Chat (WebSocket)

### Paso 1: Conectar al Chat

**Opción A: Desde el Frontend Angular**
1. Inicia el frontend: `cd unifood_frontend && npm start`
2. Navega a la página del chat
3. Conéctate al WebSocket

**Opción B: Usando un cliente WebSocket (Postman, Insomnia, o script)**

### Paso 2: Detectar Alergias en el Chat

Envía mensajes al chat mencionando alergias:

```
Ejemplos de mensajes para probar:

1. "Soy alérgico al gluten"
2. "Tengo intolerancia a la lactosa"
3. "Soy celíaco"
4. "No puedo comer productos con nueces"
5. "Soy alérgico a los mariscos y al huevo"
```

**Qué esperar:**
- El sistema detectará las alergias automáticamente
- Recibirás un evento `alergias_detectadas` con las alergias encontradas
- Las alergias se guardarán en tu perfil de cliente
- Verás logs en la consola del backend:
  ```
  🔍 Alergias detectadas para usuario X: gluten, lactosa
  ✅ Alergias actualizadas para cliente Y: gluten, lactosa
  ```

### Paso 3: Verificar que se Guardaron las Alergias

Consulta la base de datos:
```sql
SELECT id, nombre_completo, alergia 
FROM cliente 
WHERE usuario_id = [TU_USER_ID];
```

O usa el script de verificación (ver Método 3).

---

## 🧪 Método 2: Probar la Validación en Pedidos

### Paso 1: Preparar un Producto con Ingredientes

Asegúrate de tener productos en la base de datos con ingredientes. Ejemplo:

```sql
-- Actualizar un producto con ingredientes que contengan gluten
UPDATE producto 
SET ingredientes = '["harina de trigo", "azúcar", "huevos", "mantequilla"]'::jsonb
WHERE id = 1;

-- O crear un producto nuevo
INSERT INTO producto (nombre, precio, estado, tiempo_preparacion, ingredientes, vendedorFK)
VALUES (
  'Pastel de Chocolate',
  150.00,
  true,
  30,
  '["harina de trigo", "chocolate", "azúcar", "huevos"]'::jsonb,
  1
);
```

### Paso 2: Crear un Pedido con el Producto

**Usando el Frontend:**
1. Agrega el producto al carrito
2. Intenta crear el pedido

**Usando Postman/Insomnia:**
```http
POST http://localhost:3000/pedidos
Authorization: Bearer [TU_TOKEN]
Content-Type: application/json

{
  "area_venta_id": 1,
  "productos": [
    {
      "producto_id": 1,
      "cantidad": 2,
      "precio_unitario": 150.00
    }
  ],
  "metodo_pago": "efectivo"
}
```

**Qué esperar:**
- Si el cliente tiene alergias registradas y el producto contiene ingredientes problemáticos:
  - Se ejecutará el handler `ValidarAlergiasHandler`
  - Verás progreso en tiempo real vía WebSocket (si estás conectado)
  - Se lanzará una excepción `AlergiasDetectadasException` con detalles
  - El pedido NO se creará

**Ejemplo de respuesta de error:**
```json
{
  "statusCode": 400,
  "message": "Se detectaron productos que contienen ingredientes a los que eres alérgico",
  "errorType": "ALERGIAS_DETECTADAS",
  "details": {
    "alergias": ["gluten"],
    "productosConAlergenos": ["Pastel de Chocolate"]
  }
}
```

### Paso 3: Probar con Producto Seguro

Crea un pedido con un producto que NO contenga las alergias del cliente:

```sql
-- Producto sin gluten
UPDATE producto 
SET ingredientes = '["harina de arroz", "azúcar", "huevos", "aceite de oliva"]'::jsonb
WHERE id = 2;
```

El pedido debería crearse exitosamente.

---

## 🧪 Método 3: Script de Prueba Automatizado

Crea un archivo `test-alergias.js` en la raíz del backend:

```javascript
// test-alergias.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testAlergias() {
  console.log('🧪 Iniciando pruebas de alergias...\n');

  try {
    // 1. Buscar un cliente de prueba
    const cliente = await prisma.cliente.findFirst({
      include: { usuario: true }
    });

    if (!cliente) {
      console.log('❌ No se encontró ningún cliente. Crea uno primero.');
      return;
    }

    console.log(`✅ Cliente encontrado: ${cliente.nombre_completo} (ID: ${cliente.id})`);
    console.log(`   Usuario ID: ${cliente.usuario_id}`);
    console.log(`   Alergias actuales:`, cliente.alergia || 'Ninguna');
    console.log('');

    // 2. Buscar productos con ingredientes
    const productos = await prisma.producto.findMany({
      where: { estado: true },
      take: 5
    });

    console.log('📦 Productos disponibles:');
    productos.forEach(p => {
      console.log(`   - ${p.nombre} (ID: ${p.id})`);
      console.log(`     Ingredientes: ${JSON.stringify(p.ingredientes)}`);
    });
    console.log('');

    // 3. Simular detección de alergias
    console.log('🔍 Simulando detección de alergias...');
    const alergiasTest = ['gluten', 'lactosa'];
    
    await prisma.$executeRaw`
      UPDATE cliente 
      SET alergia = ${JSON.stringify(alergiasTest)}::jsonb
      WHERE id = ${cliente.id}
    `;

    console.log(`✅ Alergias actualizadas: ${alergiasTest.join(', ')}`);
    console.log('');

    // 4. Verificar productos problemáticos
    console.log('⚠️  Verificando productos problemáticos...');
    for (const producto of productos) {
      if (producto.ingredientes) {
        const ingredientes = Array.isArray(producto.ingredientes) 
          ? producto.ingredientes 
          : JSON.parse(producto.ingredientes);
        
        const ingredientesStr = ingredientes.join(' ').toLowerCase();
        const tieneGluten = ingredientesStr.includes('trigo') || ingredientesStr.includes('gluten');
        const tieneLactosa = ingredientesStr.includes('leche') || ingredientesStr.includes('queso') || ingredientesStr.includes('lactosa');

        if (tieneGluten || tieneLactosa) {
          console.log(`   ⚠️  ${producto.nombre} puede contener alergias:`);
          if (tieneGluten) console.log(`      - Gluten detectado`);
          if (tieneLactosa) console.log(`      - Lactosa detectada`);
        }
      }
    }

    console.log('\n✅ Pruebas completadas!');
    console.log('\n📝 Próximos pasos:');
    console.log('   1. Prueba crear un pedido con un producto problemático');
    console.log('   2. Verifica que se lance la excepción AlergiasDetectadasException');
    console.log('   3. Prueba con un producto seguro');

  } catch (error) {
    console.error('❌ Error en las pruebas:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAlergias();
```

**Ejecutar:**
```bash
cd unifood_backend
node test-alergias.js
```

---

## 🧪 Método 4: Prueba con cURL (Terminal)

### Probar Detección de Alergias vía Chat HTTP

```bash
# 1. Enviar mensaje al chat (detecta alergias)
curl -X POST http://localhost:3000/chat/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer [TU_TOKEN]" \
  -d '{
    "mensaje": "Soy alérgico al gluten y a la lactosa",
    "sessionId": "test-session-123"
  }'

# 2. Verificar historial del chat
curl -X GET http://localhost:3000/chat/history \
  -H "Authorization: Bearer [TU_TOKEN]"
```

### Probar Validación en Pedido

```bash
# Crear pedido (debe fallar si hay alergias)
curl -X POST http://localhost:3000/pedidos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer [TU_TOKEN]" \
  -d '{
    "area_venta_id": 1,
    "productos": [
      {
        "producto_id": 1,
        "cantidad": 1,
        "precio_unitario": 150.00
      }
    ],
    "metodo_pago": "efectivo"
  }'
```

---

## 📊 Verificación de Logs

### Logs del Backend

Observa los logs del backend mientras pruebas:

**Detección de Alergias:**
```
🔍 Alergias detectadas para usuario X: gluten, lactosa
✅ Alergias actualizadas para cliente Y: gluten, lactosa
```

**Validación de Pedidos:**
```
Verificando alergias del cliente...
Alergias del cliente: gluten, lactosa
⚠️ El producto "Pastel de Chocolate" contiene ingredientes que pueden causar reacción alérgica: harina de trigo. Alergias detectadas: gluten.
```

**Errores:**
```
Error detectando alergias: [mensaje de error]
⚠️ AlergiaIAService no disponible, usando verificación básica
```

---

## 🎯 Casos de Prueba Recomendados

### Caso 1: Detección Básica
- **Mensaje:** "Soy alérgico al gluten"
- **Esperado:** Detecta "gluten" y lo guarda

### Caso 2: Detección Múltiple
- **Mensaje:** "Tengo intolerancia a la lactosa y soy celíaco"
- **Esperado:** Detecta "lactosa" y "gluten"

### Caso 3: Validación Exitosa (Sin Conflictos)
- **Cliente:** Alérgico a "gluten"
- **Producto:** Ingredientes: ["harina de arroz", "azúcar"]
- **Esperado:** Pedido se crea exitosamente

### Caso 4: Validación Fallida (Con Conflictos)
- **Cliente:** Alérgico a "gluten"
- **Producto:** Ingredientes: ["harina de trigo", "azúcar"]
- **Esperado:** Excepción `AlergiasDetectadasException`

### Caso 5: Matching Inteligente
- **Cliente:** Alérgico a "gluten"
- **Producto:** Ingredientes: ["harina de trigo", "levadura"]
- **Esperado:** IA detecta que "harina de trigo" contiene gluten

### Caso 6: Sin Alergias
- **Cliente:** Sin alergias registradas
- **Producto:** Cualquier producto
- **Esperado:** Validación pasa sin problemas

---

## 🔧 Troubleshooting

### Problema: No se detectan alergias
- ✅ Verifica que `GEMINI_API_KEY` esté configurada
- ✅ Revisa los logs del backend
- ✅ Verifica que el mensaje contenga palabras clave de alergias

### Problema: No se validan alergias en pedidos
- ✅ Verifica que el cliente tenga alergias guardadas en la BD
- ✅ Verifica que los productos tengan ingredientes
- ✅ Revisa los logs del handler `ValidarAlergiasHandler`

### Problema: Error de tipos TypeScript
- ✅ Ejecuta `npx prisma generate`
- ✅ Reinicia el servidor de desarrollo

---

## 📝 Notas Importantes

1. **Modo Fallback:** Si la IA no está disponible, el sistema usa búsqueda básica por palabras clave
2. **WebSocket:** Las notificaciones de alergias solo funcionan si estás conectado vía WebSocket
3. **Base de Datos:** Las alergias se guardan como JSON en el campo `alergia` de la tabla `cliente`
4. **Ingredientes:** Los ingredientes deben estar en formato JSON array en el campo `ingredientes` de `producto`

---

## ✅ Checklist de Pruebas

- [ ] Detectar alergias en el chat
- [ ] Verificar que se guardan en la BD
- [ ] Crear pedido con producto seguro (debe pasar)
- [ ] Crear pedido con producto problemático (debe fallar)
- [ ] Verificar logs del backend
- [ ] Verificar eventos WebSocket (si aplica)
- [ ] Probar con múltiples alergias
- [ ] Probar matching inteligente (ej: "harina de trigo" → gluten)

---

¡Listo para probar! 🚀

